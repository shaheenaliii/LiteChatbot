
import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.supabase_client import create_supabase_client
from backend.llm_service import generate_response


# ==================================================
# LOGGING
# ==================================================

logger = logging.getLogger("litechatbot")


# ==================================================
# APP CONFIGURATION
# ==================================================

app = FastAPI(title="LiteChatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

security = HTTPBearer()


# ==================================================
# REQUEST MODELS
# ==================================================

class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ChatRequest(BaseModel):
    message: str
    conversation_id: str


class ConversationRequest(BaseModel):
    title: str = "New Chat"


class MessageRequest(BaseModel):
    role: Literal["user", "assistant"] = "user"
    content: str


# ==================================================
# AUTHENTICATION
# ==================================================

def get_authenticated_context(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    access_token = credentials.credentials

    try:
        supabase = create_supabase_client()

        # Verify access token with Supabase.
        user_response = supabase.auth.get_user(access_token)

        user = user_response.user

        if not user:
            logger.warning(
                "Authentication failed: Supabase returned no user."
            )

            raise HTTPException(
                status_code=401,
                detail="Invalid authentication token."
            )

        # Forward JWT to PostgREST for Row Level Security.
        supabase.postgrest.auth(access_token)

        return {
            "user": user,
            "supabase": supabase
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(
            "Authentication verification failed. Error type: %s",
            type(e).__name__
        )

        raise HTTPException(
            status_code=401,
            detail="Authentication failed."
        ) from e


# ==================================================
# BASIC ROUTES
# ==================================================

@app.get("/")
def home():
    return {
        "message": "Welcome to LiteChatbot API!"
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy"
    }


@app.get("/db-health")
def database_health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))

        return {
            "database": "connected"
        }

    except Exception as e:
        logger.exception("Database health check failed.")

        raise HTTPException(
            status_code=500,
            detail="Database connection failed."
        ) from e


# ==================================================
# AUTHENTICATION ROUTES
# ==================================================

@app.post("/auth/signup")
def signup(request: SignupRequest):
    try:
        supabase = create_supabase_client()

        response = supabase.auth.sign_up({
            "email": request.email,
            "password": request.password,
            "options": {
                "data": {
                    "display_name": request.display_name
                }
            }
        })

        return {
            "message": (
                "Account created successfully. "
                "Please check your email to confirm your account."
            ),
            "user": response.user
        }

    except Exception as e:
        logger.exception("Signup failed.")

        raise HTTPException(
            status_code=400,
            detail="Unable to create account. Please check your details."
        ) from e


@app.post("/auth/login")
def login(request: LoginRequest):
    try:
        supabase = create_supabase_client()

        response = supabase.auth.sign_in_with_password({
            "email": request.email,
            "password": request.password
        })

        if not response.session:
            raise HTTPException(
                status_code=401,
                detail="Login failed."
            )

        return {
            "message": "Login successful.",
            "access_token": response.session.access_token,
            "refresh_token": response.session.refresh_token,
            "user": response.user
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("Login failed.")

        raise HTTPException(
            status_code=401,
            detail="Invalid email or password."
        ) from e


@app.post("/auth/refresh")
def refresh_access_token(request: RefreshRequest):
    """Exchange a refresh token for a new Supabase session."""

    try:
        supabase = create_supabase_client()

        response = supabase.auth.refresh_session(
            request.refresh_token
        )

        if not response.session:
            raise HTTPException(
                status_code=401,
                detail="Unable to refresh session. Please log in again."
            )

        return {
            "message": "Session refreshed successfully.",
            "access_token": response.session.access_token,
            "refresh_token": response.session.refresh_token,
            "user": response.user
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("Token refresh failed.")

        raise HTTPException(
            status_code=401,
            detail="Session expired. Please log in again."
        ) from e


@app.get("/auth/me")
def get_current_user(
    context=Depends(get_authenticated_context)
):
    user = context["user"]

    return {
        "id": user.id,
        "email": user.email
    }


# ==================================================
# CONVERSATION ROUTES
# ==================================================

@app.post("/conversations")
def create_conversation(
    request: ConversationRequest,
    context=Depends(get_authenticated_context)
):
    supabase = context["supabase"]
    user = context["user"]

    try:
        response = (
            supabase.table("conversations")
            .insert({
                "user_id": user.id,
                "title": request.title
            })
            .execute()
        )

        return {
            "message": "Conversation created successfully.",
            "conversation": response.data[0]
        }

    except Exception as e:
        logger.exception("Create conversation failed.")

        raise HTTPException(
            status_code=500,
            detail="Unable to create conversation."
        ) from e


@app.get("/conversations")
def get_conversations(
    context=Depends(get_authenticated_context)
):
    supabase = context["supabase"]

    try:
        response = (
            supabase.table("conversations")
            .select("*")
            .order("updated_at", desc=True)
            .execute()
        )

        return {
            "conversations": response.data
        }

    except Exception as e:
        logger.exception("Get conversations failed.")

        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve conversations."
        ) from e


@app.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    context=Depends(get_authenticated_context)
):
    supabase = context["supabase"]

    try:
        # Verify conversation ownership through RLS.
        existing = (
            supabase.table("conversations")
            .select("id")
            .eq("id", conversation_id)
            .limit(1)
            .execute()
        )

        if not existing.data:
            raise HTTPException(
                status_code=404,
                detail="Conversation not found."
            )

        # Delete conversation.
        # Related messages are removed through ON DELETE CASCADE.
        (
            supabase.table("conversations")
            .delete()
            .eq("id", conversation_id)
            .execute()
        )

        return {
            "message": "Conversation deleted successfully."
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("Delete conversation failed.")

        raise HTTPException(
            status_code=500,
            detail="Unable to delete conversation."
        ) from e


# ==================================================
# MESSAGE ROUTES
# ==================================================

@app.post("/conversations/{conversation_id}/messages")
def save_message(
    conversation_id: str,
    request: MessageRequest,
    context=Depends(get_authenticated_context)
):
    supabase = context["supabase"]

    try:
        # Save the message.
        response = (
            supabase.table("messages")
            .insert({
                "conversation_id": conversation_id,
                "role": request.role,
                "content": request.content
            })
            .execute()
        )

        saved_message = response.data[0]

        # Update conversation timestamp.
        update_data = {
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

        # Set conversation title from its first user message.
        if request.role == "user":

            first_message = (
                supabase.table("messages")
                .select("id, content")
                .eq("conversation_id", conversation_id)
                .eq("role", "user")
                .order("created_at", desc=False)
                .limit(1)
                .execute()
            )

            if (
                first_message.data
                and first_message.data[0]["id"] == saved_message["id"]
            ):
                title = request.content.strip()

                if len(title) > 40:
                    title = title[:37] + "..."

                update_data["title"] = title

        (
            supabase.table("conversations")
            .update(update_data)
            .eq("id", conversation_id)
            .execute()
        )

        return {
            "message": "Message saved successfully.",
            "data": saved_message
        }

    except Exception as e:
        logger.exception("Save message failed.")

        raise HTTPException(
            status_code=500,
            detail="Unable to save message."
        ) from e


@app.get("/conversations/{conversation_id}/messages")
def get_messages(
    conversation_id: str,
    context=Depends(get_authenticated_context)
):
    supabase = context["supabase"]

    try:
        response = (
            supabase.table("messages")
            .select("*")
            .eq("conversation_id", conversation_id)
            .order("created_at", desc=False)
            .execute()
        )

        return {
            "messages": response.data
        }

    except Exception as e:
        logger.exception("Get messages failed.")

        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve messages."
        ) from e


# ==================================================
# AI CHAT ROUTE WITH GEMINI FUNCTION CALLING
# ==================================================

@app.post("/chat")
def chat(
    request: ChatRequest,
    context=Depends(get_authenticated_context)
):
    supabase = context["supabase"]

    try:
        # 1. Retrieve latest 21 messages.
        response = (
            supabase.table("messages")
            .select("role, content")
            .eq("conversation_id", request.conversation_id)
            .order("created_at", desc=True)
            .limit(21)
            .execute()
        )

        # Reverse to chronological order.
        messages = list(reversed(response.data))

        # 2. Verify the latest saved user message.
        if (
            not messages
            or messages[-1]["role"] != "user"
            or messages[-1]["content"] != request.message
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "The latest user message was not found "
                    "in this conversation."
                )
            )

        # 3. Separate previous conversation history.
        conversation_history = messages[:-1]

        # 4. Ask Gemini to understand the request.
        # Gemini decides whether to use Tavily.
        ai_result = generate_response(
            request.message,
            conversation_history
        )

        # 5. Validate AI response.
        if not isinstance(ai_result, dict):
            raise HTTPException(
                status_code=502,
                detail="Invalid response from the AI service."
            )

        bot_response = ai_result.get("text")
        sources = ai_result.get("sources", [])

        if (
            not isinstance(bot_response, str)
            or not bot_response.strip()
        ):
            raise HTTPException(
                status_code=502,
                detail="The AI service returned an empty response."
            )

        if not isinstance(sources, list):
            sources = []

        # 6. Return answer and sources.
        return {
            "user_message": request.message,
            "bot_response": bot_response,
            "sources": sources
        }

    except HTTPException:
        raise

    except RuntimeError as e:
        logger.exception("AI service failed.")

        raise HTTPException(
            status_code=502,
            detail=(
                "The AI service is temporarily unavailable. "
                "Please try again."
            )
        ) from e

    except Exception as e:
        logger.exception("Chat processing failed.")

        raise HTTPException(
            status_code=500,
            detail="Unable to process your message."
        ) from e
