"""
Phase 33: Web Push (the browser / home-screen app notifications) with no extra packages.

* Keys (VAPID): VAPID_PRIVATE_KEY in .secrets (PEM, or the raw base64url key from any VAPID generator) wins.
  Otherwise a key pair is generated once and kept in the app_keys table (a database wipe makes a new one,
  which is fine: the subscriptions are wiped with it).
* Payload encryption: RFC 8291 (aes128gcm) with `cryptography`. VAPID token: RFC 8292 (ES256) with `pyjwt`.
* Sending: httpx. 404 / 410 from the push service means the subscription is gone, so it's deleted.
Every send function returns results and never raises.
"""
import base64
import json
import logging
import os
import struct
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple
from urllib.parse import urlparse

import httpx
import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models import AppKey, PushSubscription

logger = logging.getLogger("shiftboard.webpush")

KEY_NAME = "vapid_private_pem"
RECORD_SIZE = 4096
TTL_SECONDS = 24 * 3600

_cache: Dict[str, object] = {}      # {"private": EllipticCurvePrivateKey, "public_b64": str}


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
    _cache["private"] = private
    _cache["public_b64"] = _public_b64(private)
    return private, _cache["public_b64"]


def vapid_subject() -> str:
    explicit = os.getenv("VAPID_SUBJECT", "").strip()
    if explicit:
        return explicit
    base = (settings.APP_BASE_URL or "").strip().rstrip("/")
    if base.startswith("https://"):
        return base
    return "mailto:no-reply@shiftboard.app"


def encrypt(p256dh_b64: str, auth_b64: str, plaintext: bytes, _as_private=None, _salt: Optional[bytes] = None) -> bytes:
    """RFC 8291 aes128gcm body for one push message. (_as_private / _salt are only for the RFC test vector.)"""
    ua_public = b64u_decode(p256dh_b64)
    auth_secret = b64u_decode(auth_b64)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    as_private = _as_private or ec.generate_private_key(ec.SECP256R1())
    as_public = as_private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = as_private.exchange(ec.ECDH(), ua_key)
    ikm = HKDF(algorithm=hashes.SHA256(), length=32, salt=auth_secret,
               info=b"WebPush: info\x00" + ua_public + as_public).derive(shared)
    salt = _salt or os.urandom(16)
    cek = HKDF(algorithm=hashes.SHA256(), length=16, salt=salt, info=b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(algorithm=hashes.SHA256(), length=12, salt=salt, info=b"Content-Encoding: nonce\x00").derive(ikm)
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)     # \x02 = last (only) record
    header = salt + struct.pack(">I", RECORD_SIZE) + bytes([len(as_public)]) + as_public
    return header + ciphertext


def vapid_headers(endpoint: str, private_key, public_b64: str) -> Dict[str, str]:
    u = urlparse(endpoint)
    token = jwt.encode(
        {"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": vapid_subject()},
        private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()),
        algorithm="ES256",
    )
    return {"Authorization": f"vapid t={token}, k={public_b64}"}


async def send_one(sub: PushSubscription, payload: dict, private_key, public_b64: str,
                   urgent: bool = False, client: Optional[httpx.AsyncClient] = None) -> Tuple[bool, bool, Optional[str]]:
    """Returns (ok, gone, error). gone=True means the browser dropped this subscription."""
    try:
        body = encrypt(sub.p256dh, sub.auth, json.dumps(payload, separators=(",", ":")).encode())
        headers = {
            **vapid_headers(sub.endpoint, private_key, public_b64),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(TTL_SECONDS),
            "Urgency": "high" if urgent else "normal",
        }
        own = client is None
        client = client or httpx.AsyncClient(timeout=10)
        try:
            r = await client.post(sub.endpoint, content=body, headers=headers)
        finally:
            if own:
                await client.aclose()
        if r.status_code in (200, 201, 202):
            return True, False, None
        if r.status_code in (404, 410):
            return False, True, f"Subscription expired ({r.status_code})"
        return False, False, f"Push service said {r.status_code}: {r.text[:200]}"
    except Exception as e:
        return False, False, f"Push failed: {e}"


async def send_to_user(db: AsyncSession, user_id, payload: dict, urgent: bool = False,
                       client: Optional[httpx.AsyncClient] = None) -> Tuple[int, Optional[str]]:
    """Sends to every device the user turned on. Returns (devices reached, last error). Deletes dead subscriptions.
    Does not commit."""
    subs = (await db.execute(select(PushSubscription).where(PushSubscription.user_id == user_id))).scalars().all()
    if not subs:
        return 0, "No devices turned on"
    private_key, public_b64 = await ensure_keys(db)
    reached, last_error = 0, None
    now = datetime.now(timezone.utc)
    for sub in subs:
        ok, gone, err = await send_one(sub, payload, private_key, public_b64, urgent=urgent, client=client)
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
