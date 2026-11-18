// ============================================================
// LITECHATBOT FRONTEND
// ============================================================

const API_URL = "http://127.0.0.1:8000";

// ============================================================
// DOM ELEMENTS
// ============================================================

const authScreen = document.getElementById("authScreen");
const appScreen = document.getElementById("appScreen");

const authForm = document.getElementById("authForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authError = document.getElementById("authError");

const authSwitchText = document.getElementById("authSwitchText");
const authSwitchBtn = document.getElementById("authSwitchBtn");

const newChatBtn = document.getElementById("newChatBtn");
const logoutBtn = document.getElementById("logoutBtn");

const conversationList = document.getElementById("conversationList");

const chatArea = document.getElementById("chatArea");
const welcomeScreen = document.getElementById("welcomeScreen");
const messagesContainer = document.getElementById("messagesContainer");

const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

const userName = document.getElementById("userName");
const userAvatar = document.getElementById("userAvatar");

const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const mobileMenuBtn = document.getElementById("mobileMenuBtn");

const themeToggle = document.getElementById("themeToggle");


// ============================================================
// STATE
// ============================================================

let isSignupMode = false;
let currentUser = null;

let currentConversationId = null;
let conversations = [];

let isSending = false;
let refreshPromise = null;


// ============================================================
// THEME MANAGEMENT
// ============================================================

function applyTheme(theme) {

    document.body.setAttribute("data-theme", theme);

    if (themeToggle) {

        if (theme === "light") {
            themeToggle.textContent = "🌙";
            themeToggle.title = "Switch to dark mode";
            themeToggle.setAttribute("aria-label", "Switch to dark mode");
        } else {
            themeToggle.textContent = "☀️";
            themeToggle.title = "Switch to light mode";
            themeToggle.setAttribute("aria-label", "Switch to light mode");
        }

    }

    localStorage.setItem("litechatbot-theme", theme);
}


function initializeTheme() {

    const savedTheme = localStorage.getItem("litechatbot-theme");

    applyTheme(savedTheme || "dark");
}


if (themeToggle) {

    themeToggle.addEventListener("click", () => {

        const currentTheme =
            document.body.getAttribute("data-theme") || "dark";

        const newTheme =
            currentTheme === "dark" ? "light" : "dark";

        applyTheme(newTheme);

    });

}


// ============================================================
// TOKEN MANAGEMENT
// ============================================================

function getAccessToken() {
    return sessionStorage.getItem("accessToken");
}

function getRefreshToken() {
    return sessionStorage.getItem("refreshToken");
}

function saveTokens(data) {

    if (data.access_token) {
        sessionStorage.setItem("accessToken", data.access_token);
    }

    if (data.refresh_token) {
        sessionStorage.setItem("refreshToken", data.refresh_token);
    }
}

function clearTokens() {
    sessionStorage.removeItem("accessToken");
    sessionStorage.removeItem("refreshToken");
}


// ============================================================
// API REQUEST
// ============================================================

async function apiRequest(endpoint, options = {}, retry = true) {

    const headers = {
        ...(options.headers || {})
    };

    const token = getAccessToken();

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    if (
        options.body &&
        typeof options.body === "string" &&
        !headers["Content-Type"]
    ) {
        headers["Content-Type"] = "application/json";
    }

    let response;

    try {

        response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });

    } catch (error) {

        throw new Error(
            "Unable to connect to the server. Make sure the backend is running."
        );

    }


    // Authentication expiry handling
    if (response.status === 401 && retry) {

        const refreshed = await refreshAccessToken();

        if (refreshed) {
            return apiRequest(endpoint, options, false);
        }

        clearTokens();

        throw new Error("Your session has expired. Please sign in again.");

    }


    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }


    if (!response.ok) {

        const detail =
            data.detail ||
            data.message ||
            `Request failed (${response.status})`;

        throw new Error(detail);

    }

    return data;

}


// ============================================================
// TOKEN REFRESH
// ============================================================

async function refreshAccessToken() {

    const refreshToken = getRefreshToken();

    if (!refreshToken) {
        return false;
    }


    // Avoid simultaneous refresh requests
    if (refreshPromise) {
        return refreshPromise;
    }


    refreshPromise = (async () => {

        try {

            const response = await fetch(`${API_URL}/auth/refresh`, {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    refresh_token: refreshToken
                })
            });


            if (!response.ok) {
                return false;
            }


            const data = await response.json();

            saveTokens(data);

            return Boolean(data.access_token);


        } catch (error) {

            return false;

        } finally {

            refreshPromise = null;

        }

    })();


    return refreshPromise;

}


// ============================================================
// AUTH SCREEN
// ============================================================

function showAuthScreen() {

    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");

    closeMobileSidebar();

}


function showAppScreen() {

    authScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");

}


function setAuthMode(signup) {

    isSignupMode = signup;

    authError.textContent = "";


    if (signup) {

        authTitle.textContent = "Create your account";
        authSubtitle.textContent = "Get started with LiteChatbot.";
        authSubmitBtn.textContent = "Create account";

        authSwitchText.textContent = "Already have an account?";
        authSwitchBtn.textContent = "Sign in";

    } else {

        authTitle.textContent = "Welcome back";
        authSubtitle.textContent = "Sign in to continue your conversations.";
        authSubmitBtn.textContent = "Sign in";

        authSwitchText.textContent = "Don't have an account?";
        authSwitchBtn.textContent = "Sign up";

    }

}


authSwitchBtn.addEventListener("click", () => {

    setAuthMode(!isSignupMode);

});


// ============================================================
// LOGIN / SIGNUP
// ============================================================

authForm.addEventListener("submit", async (event) => {

    event.preventDefault();

    authError.textContent = "";


    const email = emailInput.value.trim();
    const password = passwordInput.value;


    if (!email || !password) {

        authError.textContent = "Please enter your email and password.";

        return;

    }


    authSubmitBtn.disabled = true;

    authSubmitBtn.textContent = isSignupMode
        ? "Creating account..."
        : "Signing in...";


    try {

        const endpoint = isSignupMode
            ? "/auth/signup"
            : "/auth/login";


        const data = await apiRequest(endpoint, {
            method: "POST",

            body: JSON.stringify({
                email,
                password
            })

        }, false);


        saveTokens(data);


        if (!getAccessToken()) {

            authError.textContent =
                data.message ||
                "Account request completed, but no access token was returned.";

            return;

        }


        await initializeApp();


    } catch (error) {

        authError.textContent = error.message;

    } finally {

        authSubmitBtn.disabled = false;

        authSubmitBtn.textContent = isSignupMode
            ? "Create account"
            : "Sign in";

    }

});


// ============================================================
// LOGOUT
// ============================================================

logoutBtn.addEventListener("click", () => {

    clearTokens();

    currentUser = null;
    currentConversationId = null;
    conversations = [];

    messagesContainer.innerHTML = "";
    conversationList.innerHTML = "";

    showAuthScreen();

});


// ============================================================
// INITIALIZATION
// ============================================================

async function initializeApp() {

    try {

        const data = await apiRequest("/auth/me");

        currentUser = data.user || data;

        updateUserInformation();

        showAppScreen();

        await loadConversations();

        createNewChatUI();


    } catch (error) {

        clearTokens();

        showAuthScreen();

    }

}


function updateUserInformation() {

    if (!currentUser) {
        return;
    }


    const email =
        currentUser.email ||
        currentUser.username ||
        "User";


    userName.textContent = email;

    userAvatar.textContent =
        email.charAt(0).toUpperCase();

}


// ============================================================
// CONVERSATIONS
// ============================================================

async function loadConversations() {

    try {

        const data = await apiRequest("/conversations");

        conversations = data.conversations || [];

        renderConversationList();


    } catch (error) {

        console.error("Failed to load conversations:", error);

        conversations = [];

        renderConversationList();

    }

}


function renderConversationList() {

    conversationList.innerHTML = "";


    if (!conversations.length) {

        const empty = document.createElement("div");

        empty.className = "empty-history";
        empty.textContent = "No conversations yet";

        conversationList.appendChild(empty);

        return;

    }


    conversations.forEach(conversation => {

        const id = conversation.id;

        const title =
            conversation.title ||
            conversation.name ||
            "New conversation";


        const item = document.createElement("div");

        item.className = "conversation-item";


        if (id === currentConversationId) {
            item.classList.add("active");
        }


        const titleElement = document.createElement("div");

        titleElement.className = "conversation-title";
        titleElement.textContent = title;
        titleElement.title = title;


        const deleteButton = document.createElement("button");

        deleteButton.className = "conversation-delete";
        deleteButton.textContent = "×";
        deleteButton.title = "Delete conversation";


        item.appendChild(titleElement);
        item.appendChild(deleteButton);


        item.addEventListener("click", async (event) => {

            if (event.target === deleteButton) {
                return;
            }

            await openConversation(id);

        });


        deleteButton.addEventListener("click", async (event) => {

            event.stopPropagation();

            await deleteConversation(id);

        });


        conversationList.appendChild(item);

    });

}


// ============================================================
// NEW CHAT
// ============================================================

newChatBtn.addEventListener("click", createNewChatUI);


function createNewChatUI() {

    currentConversationId = null;

    messagesContainer.innerHTML = "";

    welcomeScreen.classList.remove("hidden");

    messageInput.value = "";

    resizeTextarea();

    renderConversationList();

    closeMobileSidebar();

    messageInput.focus();

}


// ============================================================
// OPEN CONVERSATION
// ============================================================

async function openConversation(conversationId) {

    currentConversationId = conversationId;

    welcomeScreen.classList.add("hidden");

    messagesContainer.innerHTML = "";

    renderConversationList();

    closeMobileSidebar();


    try {

        const data = await apiRequest(
            `/conversations/${conversationId}/messages`
        );


        const messages = data.messages || [];


        messages.forEach(message => {

            if (message.role === "user") {

                addUserMessage(message.content);

            } else if (message.role === "assistant") {

                addAssistantMessage(
                    message.content,
                    null,
                    false
                );

            }

        });


        scrollToBottom();


    } catch (error) {

        addSystemMessage(
            "Unable to load this conversation. " + error.message
        );

    }

}


// ============================================================
// DELETE CONVERSATION
// ============================================================

async function deleteConversation(conversationId) {

    const confirmed = confirm(
        "Delete this conversation? This action cannot be undone."
    );

    if (!confirmed) {
        return;
    }


    try {

        await apiRequest(
            `/conversations/${conversationId}`,
            {
                method: "DELETE"
            }
        );


        conversations = conversations.filter(
            conversation => conversation.id !== conversationId
        );


        if (currentConversationId === conversationId) {

            createNewChatUI();

        }


        renderConversationList();


    } catch (error) {

        alert("Unable to delete conversation: " + error.message);

    }

}


// ============================================================
// INPUT
// ============================================================

messageInput.addEventListener("input", () => {

    resizeTextarea();

    updateSendButton();

});


messageInput.addEventListener("keydown", (event) => {

    if (
        event.key === "Enter" &&
        !event.shiftKey
    ) {

        event.preventDefault();

        sendMessage();

    }

});


sendBtn.addEventListener("click", sendMessage);


function resizeTextarea() {

    messageInput.style.height = "auto";

    messageInput.style.height =
        Math.min(messageInput.scrollHeight, 180) + "px";

}


function updateSendButton() {

    sendBtn.disabled =
        isSending ||
        messageInput.value.trim().length === 0;

}


// ============================================================
// SUGGESTION CARDS
// ============================================================

document.querySelectorAll(".suggestion-card").forEach(card => {

    card.addEventListener("click", () => {

        const prompt = card.dataset.prompt;

        messageInput.value = prompt;

        resizeTextarea();

        messageInput.focus();

    });

});


// ============================================================
// SEND MESSAGE
// ============================================================

async function sendMessage() {

    const message = messageInput.value.trim();


    if (!message || isSending) {
        return;
    }


    isSending = true;

    updateSendButton();


    // Hide welcome
    welcomeScreen.classList.add("hidden");


    // Display user message
    addUserMessage(message);


    // Clear input
    messageInput.value = "";

    resizeTextarea();


    // Typing animation
    const typingElement = addTypingIndicator();


    try {


        // Create conversation if necessary

        if (!currentConversationId) {

            const conversationData = await apiRequest(
                "/conversations",
                {
                    method: "POST",
                    body: JSON.stringify({})
                }
            );


            currentConversationId =
                conversationData.conversation.id;


            await loadConversations();

        }


        // Save user message

        await apiRequest(
            `/conversations/${currentConversationId}/messages`,
            {
                method: "POST",

                body: JSON.stringify({
                    role: "user",
                    content: message
                })

            }
        );


        // Get AI response

        const responseData = await apiRequest(
            "/chat",
            {
                method: "POST",

                body: JSON.stringify({
                    message: message,
                    conversation_id: currentConversationId
                })

            }
        );


        removeTypingIndicator(typingElement);


        const assistantResponse =
            responseData.bot_response ||
            responseData.response ||
            responseData.reply ||
            responseData.answer ||
            "No response received.";


        // Display AI response

        addAssistantMessage(
            assistantResponse,
            responseData.sources,
            true
        );


        // Save assistant response

        await apiRequest(
            `/conversations/${currentConversationId}/messages`,
            {
                method: "POST",

                body: JSON.stringify({
                    role: "assistant",
                    content: assistantResponse
                })

            }
        );


        // Refresh sidebar

        await loadConversations();


    } catch (error) {

        removeTypingIndicator(typingElement);

        addSystemMessage(
            error.message || "Something went wrong."
        );


    } finally {

        isSending = false;

        updateSendButton();

        messageInput.focus();

    }

}


// ============================================================
// USER MESSAGE
// ============================================================

function addUserMessage(content) {

    const messageElement = document.createElement("div");

    messageElement.className = "message user-message";


    const avatar = document.createElement("div");

    avatar.className = "message-avatar";
    avatar.textContent = "U";


    const contentElement = document.createElement("div");

    contentElement.className = "message-content";
    contentElement.textContent = content;


    messageElement.appendChild(contentElement);
    messageElement.appendChild(avatar);


    messagesContainer.appendChild(messageElement);

    scrollToBottom();

}


// ============================================================
// ASSISTANT MESSAGE
// ============================================================

function addAssistantMessage(
    content,
    sources = null,
    addActions = true
) {

    const messageElement = document.createElement("div");

    messageElement.className = "message assistant-message";


    const avatar = document.createElement("div");

    avatar.className = "message-avatar assistant-avatar";
    avatar.textContent = "✦";


    const contentElement = document.createElement("div");

    contentElement.className = "message-content";


    // Markdown rendering

    let renderedContent = content;


    if (typeof marked !== "undefined") {
        renderedContent = marked.parse(content);
    }


    // Safe HTML rendering

    if (typeof DOMPurify !== "undefined") {

        contentElement.innerHTML =
            DOMPurify.sanitize(renderedContent);

    } else {

        contentElement.textContent = content;

    }


    // Code block copy functionality

    processCodeBlocks(contentElement);


    // Copy response button

    if (addActions) {

        const actions = document.createElement("div");

        actions.className = "message-actions";


        const copyButton = document.createElement("button");

        copyButton.className = "message-action-button";
        copyButton.textContent = "Copy";


        copyButton.addEventListener("click", async () => {

            try {

                await navigator.clipboard.writeText(content);

                copyButton.textContent = "Copied!";


                setTimeout(() => {

                    copyButton.textContent = "Copy";

                }, 1500);


            } catch {

                copyButton.textContent = "Unable to copy";

            }

        });


        actions.appendChild(copyButton);

        contentElement.appendChild(actions);

    }


    // Sources

    if (sources && sources.length) {

        const sourcesContainer = document.createElement("div");

        sourcesContainer.className = "sources-container";


        const sourcesTitle = document.createElement("div");

        sourcesTitle.className = "sources-title";
        sourcesTitle.textContent = "Sources";


        sourcesContainer.appendChild(sourcesTitle);


        sources.forEach(source => {

            const url =
                typeof source === "string"
                    ? source
                    : source.url || source.link || "";


            if (!url) {
                return;
            }


            const link = document.createElement("a");

            link.className = "source-link";

            link.href = url;

            link.target = "_blank";

            link.rel = "noopener noreferrer";


            link.textContent =
                typeof source === "string"
                    ? source
                    : source.title || source.url || "Open source";


            sourcesContainer.appendChild(link);

        });


        contentElement.appendChild(sourcesContainer);

    }


    messageElement.appendChild(avatar);
    messageElement.appendChild(contentElement);


    messagesContainer.appendChild(messageElement);

    scrollToBottom();

}


// ============================================================
// CODE BLOCKS
// ============================================================

function processCodeBlocks(container) {

    const codeBlocks = container.querySelectorAll("pre");


    codeBlocks.forEach(pre => {

        if (pre.parentElement.classList.contains("code-wrapper")) {
            return;
        }


        const codeElement = pre.querySelector("code");


        const language = codeElement
            ? (
                Array.from(codeElement.classList)
                    .find(className => className.startsWith("language-"))
                    ?.replace("language-", "")
                || "code"
            )
            : "code";


        const wrapper = document.createElement("div");

        wrapper.className = "code-wrapper";


        const header = document.createElement("div");

        header.className = "code-header";


        const languageLabel = document.createElement("span");

        languageLabel.className = "code-language";
        languageLabel.textContent = language;


        const copyButton = document.createElement("button");

        copyButton.className = "copy-code-button";
        copyButton.textContent = "Copy code";


        copyButton.addEventListener("click", async () => {

            const code = codeElement
                ? codeElement.textContent
                : pre.textContent;


            try {

                await navigator.clipboard.writeText(code);

                copyButton.textContent = "Copied!";


                setTimeout(() => {

                    copyButton.textContent = "Copy code";

                }, 1500);


            } catch {

                copyButton.textContent = "Failed";

            }

        });


        header.appendChild(languageLabel);
        header.appendChild(copyButton);


        pre.parentNode.insertBefore(wrapper, pre);

        wrapper.appendChild(header);
        wrapper.appendChild(pre);

    });

}


// ============================================================
// TYPING INDICATOR
// ============================================================

function addTypingIndicator() {

    const messageElement = document.createElement("div");

    messageElement.className = "message assistant-message";


    const avatar = document.createElement("div");

    avatar.className = "message-avatar assistant-avatar";
    avatar.textContent = "✦";


    const contentElement = document.createElement("div");

    contentElement.className = "message-content";


    const typing = document.createElement("div");

    typing.className = "typing-indicator";


    for (let i = 0; i < 3; i++) {

        const dot = document.createElement("div");

        dot.className = "typing-dot";

        typing.appendChild(dot);

    }


    contentElement.appendChild(typing);

    messageElement.appendChild(avatar);
    messageElement.appendChild(contentElement);


    messagesContainer.appendChild(messageElement);

    scrollToBottom();

    return messageElement;

}


function removeTypingIndicator(element) {

    if (element && element.parentNode) {
        element.remove();
    }

}


// ============================================================
// SYSTEM MESSAGE
// ============================================================

function addSystemMessage(content) {

    const element = document.createElement("div");

    element.style.textAlign = "center";
    element.style.color = "#f87171";
    element.style.fontSize = "12px";
    element.style.padding = "12px";
    element.style.margin = "10px 0";


    element.textContent = content;

    messagesContainer.appendChild(element);

    scrollToBottom();

}


// ============================================================
// SCROLL
// ============================================================

function scrollToBottom() {

    chatArea.scrollTop = chatArea.scrollHeight;

}


// ============================================================
// MOBILE SIDEBAR
// ============================================================

mobileMenuBtn.addEventListener("click", openMobileSidebar);

sidebarBackdrop.addEventListener("click", closeMobileSidebar);


function openMobileSidebar() {

    sidebar.classList.add("open");

    sidebarBackdrop.classList.add("show");

}


function closeMobileSidebar() {

    sidebar.classList.remove("open");

    sidebarBackdrop.classList.remove("show");

}


// ============================================================
// STARTUP
// ============================================================

async function startup() {

    // Load saved theme before app initialization
    initializeTheme();

    setAuthMode(false);


    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();


    if (!accessToken && !refreshToken) {

        showAuthScreen();

        return;

    }


    // Refresh if access token is missing

    if (!accessToken && refreshToken) {

        const refreshed = await refreshAccessToken();


        if (!refreshed) {

            clearTokens();

            showAuthScreen();

            return;

        }

    }


    await initializeApp();

}


// Start application

startup();