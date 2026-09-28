"""
Phase 33: phone / browser notifications.  Phase 33.0.1: two delivery routes, one list of devices.

  provider 'fcm'     -> Firebase Cloud Messaging (services/fcm.py), used when Firebase messaging is set up
  provider 'webpush' -> standard Web Push, sent with the `pywebpush` library (the fallback, no Firebase needed)

Web Push keys (VAPID): VAPID_PRIVATE_KEY in .secrets (PEM, or the raw base64url key from any VAPID generator) wins.
Otherwise a key pair is generated once and kept in the app_keys table (a database wipe makes a new one, which is
fine: the subscriptions are wiped with it).
Every send function returns results and never raises.
"""
import base64
import json
import logging
import os
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid02
from pywebpush import webpush_async, WebPushException
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models import AppKey, PushSubscription
from src.services import fcm

logger = logging.getLogger("shiftboard.webpush")

KEY_NAME = "vapid_private_pem"
TTL_SECONDS = 24 * 3600
TIMEOUT_SECONDS = 10

_cache: Dict[str, object] = {}      # {"private": EllipticCurvePrivateKey, "public_b64": str, "vapid": Vapid02}


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64u_decode(text: str) -> bytes:
    text = (text or "").strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _public_b64(private_key) -> str:
    return b64u(private_key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))


def _load_private(text: str):
    """PEM, or a raw 32-byte private number in base64url (what `web-push generate-vapid-keys` prints)."""
    text = (text or "").strip()
    if "BEGIN" in text:
        return serialization.load_pem_private_key(text.replace("\\n", "\n").encode(), password=None)
    return ec.derive_private_key(int.from_bytes(b64u_decode(text), "big"), ec.SECP256R1())


async def ensure_keys(db: AsyncSession) -> Tuple[object, str]:
    """Returns (private_key, public_key_b64url). Generates and stores a pair on first use."""
    if "private" in _cache:
        return _cache["private"], _cache["public_b64"]
    env_key = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    if env_key:
        private = _load_private(env_key)
    else:
        pem = await db.scalar(select(AppKey.value).where(AppKey.name == KEY_NAME))
        if not pem:
            new_key = ec.generate_private_key(ec.SECP256R1())
            new_pem = new_key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
            ).decode()
            await db.execute(
                pg_insert(AppKey).values(name=KEY_NAME, value=new_pem, created_at=datetime.now(timezone.utc))
                .on_conflict_do_nothing(index_elements=["name"])
            )
            await db.commit()
            pem = await db.scalar(select(AppKey.value).where(AppKey.name == KEY_NAME))   # another process may have won
        private = _load_private(pem)
    pem_bytes = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    _cache["private"] = private
    _cache["public_b64"] = _public_b64(private)
    _cache["vapid"] = Vapid02.from_pem(pem_bytes)
    return private, _cache["public_b64"]


def vapid_subject() -> str:
    explicit = os.getenv("VAPID_SUBJECT", "").strip()
    if explicit:
        return explicit
    base = (settings.APP_BASE_URL or "").strip().rstrip("/")
    if base.startswith("https://"):
        return base
    return "mailto:no-reply@shiftboard.app"


def provider() -> str:
    """The route new devices register with: 'fcm' when Firebase messaging is ready, else 'webpush'."""
    return "fcm" if fcm.ready() else "webpush"


async def send_one(sub: PushSubscription, payload: dict, urgent: bool = False) -> Tuple[bool, bool, Optional[str]]:
    """Web Push to one device with pywebpush. Returns (ok, gone, error). gone=True means the browser dropped it."""
    try:
        response = await webpush_async(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps(payload, separators=(",", ":")),
            vapid_private_key=_cache["vapid"],
            vapid_claims={"sub": vapid_subject()},        # pywebpush adds "aud" and "exp"
            ttl=TTL_SECONDS,
            headers={"Urgency": "high" if urgent else "normal"},
            timeout=TIMEOUT_SECONDS,
        )
        return True, False, None
    except WebPushException as e:
        status = getattr(getattr(e, "response", None), "status", None) or getattr(getattr(e, "response", None), "status_code", None)
        if status in (404, 410):
            return False, True, f"Subscription expired ({status})"
        return False, False, f"Push service said {status or '?'}: {str(e)[:200]}"
    except Exception as e:
        return False, False, f"Push failed: {e}"


async def send_to_user(db: AsyncSession, user_id, payload: dict, urgent: bool = False) -> Tuple[int, Optional[str]]:
    """Sends to every device the user turned on, through each device's route.
    Returns (devices reached, last error). Deletes devices that are gone for good. Does not commit."""
    subs = (await db.execute(select(PushSubscription).where(PushSubscription.user_id == user_id))).scalars().all()
    if not subs:
        return 0, "No devices turned on"
    now = datetime.now(timezone.utc)
    results = []   # (sub, ok, gone, err)

    web = [s for s in subs if (s.provider or "webpush") == "webpush"]
    if web:
        await ensure_keys(db)
        for sub in web:
            results.append((sub, *await send_one(sub, payload, urgent=urgent)))

    fb = [s for s in subs if s.provider == "fcm"]
    if fb:
        data = {k: ("true" if v is True else "false" if v is False else v) for k, v in payload.items()}
        by_token = {s.endpoint: s for s in fb}
        for token, ok, gone, err in await fcm.send(list(by_token), data, urgent=urgent):
            results.append((by_token[token], ok, gone, err))

    reached, last_error = 0, None
    for sub, ok, gone, err in results:
        if ok:
            reached += 1
            sub.last_success_at = now
            sub.last_error = None
        elif gone:
            await db.execute(delete(PushSubscription).where(PushSubscription.id == sub.id))
            last_error = err
        else:
            sub.last_error = (err or "")[:300]
            last_error = err
    return reached, last_error
