
import os
import logging
import re

from urllib.parse import (
    urlparse,
    urlunparse,
    parse_qsl,
    urlencode
)

from dotenv import load_dotenv
from tavily import TavilyClient


# ==================================================
# CONFIGURATION
# ==================================================

load_dotenv()

logger = logging.getLogger("litechatbot.search")

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

if not TAVILY_API_KEY:
    raise ValueError("TAVILY_API_KEY is missing from .env")

DEBUG_SEARCH = (
    os.getenv("LITECHATBOT_SEARCH_DEBUG", "false").lower()
    == "true"
)

tavily_client = TavilyClient(api_key=TAVILY_API_KEY)


# ==================================================
# URL NORMALIZATION
# ==================================================

TRACKING_PARAMS = {
    "fbclid",
    "gclid",
    "dclid",
    "msclkid",
    "ref",
    "source",
    "campaign",
    "mc_cid",
    "mc_eid",
}


def normalize_url(url: str) -> str:
    """Normalize URLs for duplicate detection."""

    if not isinstance(url, str) or not url.strip():
        return ""

    try:
        parsed = urlparse(url.strip())

        if parsed.scheme not in ("http", "https"):
            return ""

        if not parsed.hostname:
            return ""

        scheme = parsed.scheme.lower()
        hostname = parsed.hostname.lower()

        # Remove default ports.
        port = parsed.port

        if port and not (
            (scheme == "http" and port == 80)
            or (scheme == "https" and port == 443)
        ):
            hostname = f"{hostname}:{port}"

        path = parsed.path.rstrip("/") or "/"

        # Remove known tracking parameters only.
        clean_params = []

        for key, value in parse_qsl(
            parsed.query,
            keep_blank_values=True
        ):
            key_lower = key.lower()

            if key_lower.startswith("utm_"):
                continue

            if key_lower in TRACKING_PARAMS:
                continue

            clean_params.append((key, value))

        clean_params.sort()

        query = urlencode(clean_params, doseq=True)

        return urlunparse((
            scheme,
            hostname,
            path,
            "",
            query,
            ""
        ))

    except Exception:
        return ""


# ==================================================
# DOMAIN INFORMATION
# ==================================================

def get_domain(url: str) -> str:
    try:
        hostname = urlparse(url).hostname or ""
        return hostname.lower()
    except Exception:
        return ""


# ==================================================
# SOURCE QUALITY HEURISTICS
# ==================================================

OFFICIAL_DOMAINS = {
    # Government
    "kerala.gov.in",
    "keralacm.gov.in",
    "india.gov.in",

    # Python
    "python.org",
    "docs.python.org",

    # Microsoft
    "microsoft.com",
    "learn.microsoft.com",

    # Google
    "google.com",
    "cloud.google.com",
    "ai.google.dev",

    # OpenAI
    "openai.com",
    "platform.openai.com",

    # GitHub - primary code/project sources
    "github.com",
}


DOCUMENTATION_DOMAINS = {
    "docs.python.org",
    "developer.mozilla.org",
    "learn.microsoft.com",
    "docs.github.com",
    "cloud.google.com",
    "ai.google.dev",
}


def domain_matches(domain: str, known_domain: str) -> bool:
    return (
        domain == known_domain
        or domain.endswith("." + known_domain)
    )


def get_source_type(url: str) -> str:
    domain = get_domain(url)

    for known in DOCUMENTATION_DOMAINS:
        if domain_matches(domain, known):
            return "official_documentation"

    for known in OFFICIAL_DOMAINS:
        if domain_matches(domain, known):
            return "official_or_primary"

    if domain.endswith((".gov", ".gov.in", ".gov.uk")):
        return "government"

    if domain.endswith((".edu", ".ac.in", ".edu.in")):
        return "academic"

    if "wikipedia.org" in domain:
        return "reference"

    return "general"


def source_quality_bonus(url: str) -> float:
    source_type = get_source_type(url)

    bonuses = {
        "official_documentation": 0.12,
        "official_or_primary": 0.10,
        "government": 0.10,
        "academic": 0.07,
        "reference": 0.02,
        "general": 0.0,
    }

    return bonuses.get(source_type, 0.0)


# ==================================================
# RELEVANCE SCORING
# ==================================================

def tokenize(text: str) -> set:
    """Simple keyword extraction for relevance scoring."""

    if not isinstance(text, str):
        return set()

    words = re.findall(
        r"[a-zA-Z0-9_+#.-]+",
        text.lower()
    )

    ignored = {
        "the", "and", "for", "with", "from",
        "that", "this", "what", "when", "where",
        "how", "why", "who", "are", "was", "were",
        "will", "can", "does", "did", "use", "using",
        "about", "into", "their", "they", "them",
        "have", "has", "had", "not", "but", "all",
        "its", "our", "your", "you", "more", "most",
        "some", "any", "each", "which"
    }

    return {
        word
        for word in words
        if word not in ignored and len(word) > 1
    }


def relevance_score(query: str, title: str, content: str) -> float:
    """
    Estimate keyword relevance.

    This is a simple heuristic, not semantic understanding.
    """

    query_tokens = tokenize(query)

    if not query_tokens:
        return 0.0

    title_tokens = tokenize(title)
    content_tokens = tokenize(content)

    title_overlap = len(query_tokens & title_tokens)
    content_overlap = len(query_tokens & content_tokens)

    title_score = title_overlap / len(query_tokens)
    content_score = content_overlap / len(query_tokens)

    return (title_score * 0.65) + (content_score * 0.35)


# ==================================================
# WEB SEARCH
# ==================================================

def search_web(query: str) -> list:
    """Search Tavily, clean, deduplicate and rank results."""

    if not isinstance(query, str) or not query.strip():
        raise ValueError("Search query cannot be empty.")

    try:

        response = tavily_client.search(
            query=query.strip(),
            search_depth="basic",
            max_results=8
        )

        cleaned_results = []
        seen_urls = set()

        raw_results = response.get("results", [])

        for item in raw_results:

            original_url = item.get("url", "")
            clean_url = normalize_url(original_url)

            if not clean_url or clean_url in seen_urls:
                continue

            seen_urls.add(clean_url)

            title = item.get("title", "").strip()
            content = item.get("content", "").strip()

            if not title and not content:
                continue

            tavily_score = float(item.get("score", 0) or 0)

            quality_bonus = source_quality_bonus(clean_url)

            relevance = relevance_score(
                query,
                title,
                content
            )

            # Relevance remains the primary ranking signal.
            # Source authority is only a modest bonus.
            ranking_score = (
                tavily_score
                + (relevance * 0.20)
                + quality_bonus
            )

            source_type = get_source_type(clean_url)

            cleaned_results.append({
                "title": title,
                "url": clean_url,
                "content": content,
                "score": tavily_score,
                "relevance_score": round(relevance, 4),
                "quality_bonus": quality_bonus,
                "ranking_score": round(ranking_score, 4),
                "source_type": source_type,
            })

        cleaned_results.sort(
            key=lambda item: item["ranking_score"],
            reverse=True
        )

        if DEBUG_SEARCH:

            logger.info("WEB SEARCH: %s", query)
            logger.info(
                "RESULTS: raw=%s cleaned=%s",
                len(raw_results),
                len(cleaned_results)
            )

            for result in cleaned_results:

                logger.info(
                    "TYPE=%s | TAVILY=%.3f | RELEVANCE=%.3f "
                    "| QUALITY=%.3f | RANK=%.3f | URL=%s",
                    result["source_type"],
                    result["score"],
                    result["relevance_score"],
                    result["quality_bonus"],
                    result["ranking_score"],
                    result["url"]
                )

        return cleaned_results[:5]

    except Exception as e:

        logger.exception("TAVILY SEARCH ERROR")

        raise RuntimeError(
            "Unable to search the web."
        ) from e
