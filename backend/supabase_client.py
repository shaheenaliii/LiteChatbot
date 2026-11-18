
import os

from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# Read Supabase credentials
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY")

# Validate configuration
if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
    raise ValueError(
        "SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is missing from .env"
    )


# Create a separate Supabase client when needed
def create_supabase_client() -> Client:
    return create_client(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
    )
