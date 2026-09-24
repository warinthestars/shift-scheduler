"""
Phase 22 & 22.1: Firebase helpers.
- load_firebase_web_config(): parses pasted JS `firebaseConfig = {...}` snippet.
- verify_firebase_id_token(): verifies Firebase ID token using Google's public certs.
- get_enabled_providers(): queries enabled sign-in providers with TTL cache and referer forwarding.
"""
import os
import re
import time
import logging
from typing import Optional, Dict

import httpx
from starlette.concurrency import run_in_threadpool
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from src.config import settings

logger = logging.getLogger(__name__)

_ALLOWED_KEYS = (
    "apiKey", "authDomain", "projectId", "storageBucket",
    "messagingSenderId", "appId", "measurementId",
)
_REQUIRED_KEYS = ("apiKey", "authDomain", "projectId", "appId")
_PLACEHOLDER_PROJECT_IDS = ("your-project-id", "shiftboard-firebase-project", "")
_KV_PATTERN = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)\s*:\s*["\']([^"\']*)["\']')

_google_request = google_requests.Request()

_cache: Dict[str, object] = {"path": None, "mtime": None, "config": None}


def load_firebase_web_config() -> Optional[Dict[str, str]]:
    """
    Returns the Firebase web config dict, or None if the file is missing,
    incomplete, or still contains template placeholders.
    Re-reads the file only when its modification time changes.
    """
    path = settings.FIREBASE_WEB_CONFIG_PATH
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        _cache["path"], _cache["mtime"], _cache["config"] = None, None, None
        return None

    if _cache.get("path") == path and _cache.get("mtime") == mtime:
        return _cache["config"]

    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = fh.read()
    except OSError:
        return None

    # Strip // line comments and /* */ block comments before parsing
    raw = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
    raw = re.sub(r"(^|[^:])//.*$", r"\1", raw, flags=re.M)

    parsed = {k: v.strip() for k, v in _KV_PATTERN.findall(raw) if k in _ALLOWED_KEYS}
    if any(not parsed.get(k) for k in _REQUIRED_KEYS):
        config = None
    elif parsed["projectId"] in _PLACEHOLDER_PROJECT_IDS or parsed["apiKey"].startswith("your-"):
        config = None
    else:
        config = parsed

    _cache["path"], _cache["mtime"], _cache["config"] = path, mtime, config
    return config


def _verify_sync(token: str, project_id: str) -> dict:
    claims = google_id_token.verify_firebase_token(
        token, _google_request, audience=project_id, clock_skew_in_seconds=10
    )
    if not claims:
        raise ValueError("Empty token claims")
    if claims.get("iss") != f"https://securetoken.google.com/{project_id}":
        raise ValueError("Invalid token issuer")
    if not claims.get("sub"):
        raise ValueError("Token has no subject (uid)")
    return claims


async def verify_firebase_id_token(token: str, project_id: str) -> dict:
    """Verify signature, expiry, audience and issuer. Runs the blocking call in a threadpool."""
    return await run_in_threadpool(_verify_sync, token, project_id)


# ------------------------------------------------------------------------------
# Phase 22.1: Sign-in provider discovery
# ------------------------------------------------------------------------------
SUPPORTED_PROVIDERS = (
    "password", "google.com", "microsoft.com", "apple.com",
    "github.com", "facebook.com", "twitter.com", "yahoo.com",
)
_DISCOVERY_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig"
_SUCCESS_TTL_SECONDS = 300
_FAILURE_TTL_SECONDS = 30
_providers_cache: Dict[str, object] = {"api_key": None, "expires": 0.0, "value": None}


def _parse_provider_override(raw: str) -> list:
    out = []
    for p in raw.split(","):
        p = p.strip()
        if p in SUPPORTED_PROVIDERS and p not in out:
            out.append(p)
    return out


async def get_enabled_providers(cfg: Dict[str, str], referer: Optional[str] = None) -> dict:
    """
    Returns {"providers": [...], "source": "override" | "firebase" | "firebase-stale" | "fallback"}.
    Uses only the public web API key (no service account). Cached 5 min on success, 30 s on failure.
    """
    override = (settings.FIREBASE_AUTH_PROVIDERS or "").strip()
    if override:
        return {"providers": _parse_provider_override(override), "source": "override"}

    now = time.monotonic()
    if _providers_cache["api_key"] == cfg["apiKey"] and _providers_cache["expires"] > now:
        return _providers_cache["value"]

    # Browser API keys are often HTTP-referrer restricted; forward the page's referer.
    headers = {"Referer": referer or f"https://{cfg['authDomain']}/"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(_DISCOVERY_URL, params={"key": cfg["apiKey"]}, headers=headers)
        resp.raise_for_status()
        data = resp.json()

        providers = []
        if data.get("allowPasswordUser"):
            providers.append("password")
        for idp in data.get("idpConfig") or []:
            pid = idp.get("provider")
            if idp.get("enabled") and pid in SUPPORTED_PROVIDERS and pid not in providers:
                providers.append(pid)

        value = {"providers": providers, "source": "firebase"}
        ttl = _SUCCESS_TTL_SECONDS
    except Exception as e:
        logger.warning(f"Firebase provider discovery failed: {e}")
        prev = _providers_cache["value"] if _providers_cache["api_key"] == cfg["apiKey"] else None
        if prev and prev.get("source") in ("firebase", "firebase-stale"):
            value = {"providers": prev["providers"], "source": "firebase-stale"}
        else:
            value = {"providers": ["google.com"], "source": "fallback"}
        ttl = _FAILURE_TTL_SECONDS

    _providers_cache.update(api_key=cfg["apiKey"], expires=now + ttl, value=value)
    return value
