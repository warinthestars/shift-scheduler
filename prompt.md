# Phase 33: Installable App, Phone Notifications & Phone Tab Bar

**Why:** Service workers live on their phones. Today ShiftBoard is a website they have to find in a browser, and it can only reach them by email or text. Phase 33 makes it:
* **an app on their Home Screen** (full screen, own icon, offline page)
* able to send **free push notifications** to their phone or computer, the same alerts as email, instantly
* easy to use with one thumb, through a **bottom tab bar** for workers on phones

(Hours & earnings and the plain-language pass are **Phase 33.1**, next. The big Clock-in button already lives on each My shifts card.)

## What changes

### Install ("Add to Home Screen")
* New `frontend/public/` folder (Vite serves it at the site root; it's included in `vite build` too):
  - `manifest.webmanifest`: name, colours, icons, and shortcuts to My shifts / Find shifts
  - `sw.js`: the service worker
  - `offline.html`
  - `icons/`: **already placed in your repo by Claude**, because they're images:
    - `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png`, `badge-96.png`, `favicon.svg`
    - **Do not create, edit or delete them.**
* `index.html` links the manifest and the icons, and adds the iOS app tags.
* `main.jsx` registers the service worker.
* **The service worker:**
  - shows push notifications and opens the right page when one is tapped
  - shows the offline page when a page can't load
  - **never caches the app code or API calls**, so updates always show up
* **Dashboard nudge** (`AppNudge`, dismissible per device):
  - On a phone that hasn't installed the app: **"Get the ShiftBoard app on your phone"**, with an **Install** button (Android / Chrome) or **Share → Add to Home Screen** steps (iPhone).
  - Otherwise, if this device's notifications are off: **"Get shift alerts on this device"** with **Turn on notifications**. Managers get wording about requests, drops and late clock-ins.

### Phone notifications (Web Push): a third channel next to email and text
* **Settings → Notifications** gets a **Phone notifications** card:
  - **Turn on for this device**, then "On for this device" with **Send a test** and **Turn off here**
  - **Send notifications to my devices** (a new `push_enabled` preference)
  - a list of **Your devices**, with 🗑 to remove an old phone
  - iPhone users outside the Home Screen app see the steps (Apple only allows push there); blocked permission shows how to allow it
* **What gets pushed:**
  - The same notifications as email, with the same "What to send" choices.
  - New-shift alerts only when set to "Right away" (the daily digest stays email-only).
  - **Quiet hours apply**; urgent ones still come through.
  - Tapping a notification opens the page it's about. Urgent ones stay on screen until tapped.
* **Delivery:**
  - Push goes out **immediately**. Email and text now also go right away instead of waiting for the next minute tick.
  - The outbox rows are locked with `FOR UPDATE SKIP LOCKED`, so the background worker and the immediate send can never double-send.
  - Devices the browser dropped (404/410) are removed automatically.
  - Signing out turns this device off. A device someone else signs in on moves to them.
* **No new packages:**
  - Encryption (RFC 8291) uses `cryptography`, already installed via `python-jose[cryptography]`.
  - The VAPID token uses `pyjwt`; sending uses `httpx`.
  - The encryption was checked against the RFC's official test vector, byte for byte.
* **Keys:** nothing to set up.
  - The server generates a VAPID key pair on first use and keeps it in the new `app_keys` table.
  - **Optional:** put `VAPID_PRIVATE_KEY=` (PEM or base64url) and `VAPID_SUBJECT=mailto:you@yourdomain` in `.secrets/.secrets.env` to pin them.
  - Push needs the **https** address: your Cloudflare hostname works. Plain `http://<LAN-IP>` won't, and the card says so.

### Phone tab bar (workers)
* On phones (below `md`), workers get a fixed bottom bar: **My shifts · Find · Calendar · Hand-offs · Profile**.
  - It shows badges (offers, unread updates, hand-offs waiting) and works on the dashboard, Venues and Profile pages.
  - The in-page tab buttons hide on phones for workers, and a title shows the open tab instead.
* Desktop, managers and admins are unchanged.
* The Profile page's sticky **Save** bar sits above the tab bar.

⚠️ **Schema change:**
* new tables `push_subscriptions` and `app_keys`
* new column `notification_preferences.push_enabled`

The keep-data SQL is in §F.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `main.py` (unchanged: the push endpoints live in the existing notifications router)
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`
  - **`frontend/vite.config.js`**: the app uses plain static files in `frontend/public/`, **not** `vite-plugin-pwa`. Don't enable the plugin.
* **No new npm or Python packages.**
* No native PostgreSQL ENUMs: `notification_deliveries.channel` stays `VARCHAR(10)` and gains the value `push`.
* Aware UTC datetimes only.
* Notification hooks run after the commit and never raise. `deliver_soon()` and every push function never raise.
* **Do not create, modify or delete anything in `frontend/public/icons/`**: those six files are already in your repo.
* **NEW FILE / FULL FILE REPLACEMENT**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from your **current** files: every file touched here was checked against your repo and matched. They were verified:
  - The backend imports cleanly: **175** API operations (170 + 5 push endpoints).
  - The frontend bundles with no missing imports.
  - A new **31-check push suite** passes:
    - the RFC 8291 test vector
    - a fake push service that **decrypts every message with the device's keys and verifies the VAPID signature**
    - preferences, quiet hours, new-shift rules, three senders at once sending once
    - dead devices removed, a device moving accounts, unsubscribe
  - **All earlier suites pass** (28, 20, 97, 36, 64, 67, 39, 49, 107, 32, 17).
  - The keep-data SQL was tested on a 32.3 database: safe to run twice, and identical to a fresh install.
  - In real Chromium:
    - the service worker registers and controls the page
    - Chrome's installability check passes
    - a simulated push shows the notification (right title, text, link, urgency)
    - with the server stopped, the offline page shows (this caught and fixed a blank-page case)
    - "Turn on for this device" saves the device
    - the tab bar, iPhone steps, settings card and manager nudge were rendered on phone and desktop

  Don't "improve" them.

---

# PART A: Database, models, schemas

## A1. `database/init.sql` (EDITS)
`push_enabled` column; `push_subscriptions` and `app_keys` tables at the end.

**Edit 1.** Find:
```sql
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL,                 -- email | sms
    status VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped
    digest BOOLEAN NOT NULL DEFAULT FALSE,
```
Replace with:
```sql
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL,                 -- email | sms | push (Phase 33)
    status VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped
    digest BOOLEAN NOT NULL DEFAULT FALSE,
```

**Edit 2.** Find:
```sql
    new_shift_alerts VARCHAR(10) NOT NULL DEFAULT 'daily',   -- off | instant | daily
    manager_alerts_email BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_start SMALLINT,                                     -- hour 0-23, NULL = no quiet hours
    quiet_end SMALLINT,
```
Replace with:
```sql
    new_shift_alerts VARCHAR(10) NOT NULL DEFAULT 'daily',   -- off | instant | daily
    manager_alerts_email BOOLEAN NOT NULL DEFAULT TRUE,
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,               -- Phase 33: phone / browser notifications
    quiet_start SMALLINT,                                     -- hour 0-23, NULL = no quiet hours
    quiet_end SMALLINT,
```

**Edit 3.** Find:
```sql
);
CREATE INDEX idx_worker_certs_worker ON worker_certifications(worker_id);
```
Replace with:
```sql
);
CREATE INDEX idx_worker_certs_worker ON worker_certifications(worker_id);

-- ==============================================================================
-- Phase 33: Web Push (installed app / browser notifications)
-- ==============================================================================
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,                            -- the browser's push service URL for this device
    p256dh VARCHAR(200) NOT NULL,                             -- the device's public key (base64url)
    auth VARCHAR(100) NOT NULL,                               -- the device's auth secret (base64url)
    device_label VARCHAR(120),                                -- e.g. "iPhone", "Android · Chrome"
    last_success_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE app_keys (
    name VARCHAR(50) PRIMARY KEY,                             -- vapid_private_pem
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## A2. `backend/src/models.py` (EDITS)
`NotificationPreference.push_enabled`; new `PushSubscription` and `AppKey` classes at the end of the file.

**Edit 1.** Find:
```python
    notification_id = Column(UUID(as_uuid=True), ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    channel = Column(String(10), nullable=False)                     # email | sms
    status = Column(String(12), nullable=False, default="pending")   # pending | sent | failed | skipped
    digest = Column(Boolean, nullable=False, default=False)
```
Replace with:
```python
    notification_id = Column(UUID(as_uuid=True), ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    channel = Column(String(10), nullable=False)                     # email | sms | push (Phase 33)
    status = Column(String(12), nullable=False, default="pending")   # pending | sent | failed | skipped
    digest = Column(Boolean, nullable=False, default=False)
```

**Edit 2.** Find:
```python
    new_shift_alerts = Column(String(10), nullable=False, default="daily")   # off | instant | daily
    manager_alerts_email = Column(Boolean, nullable=False, default=True)
    quiet_start = Column(Integer, nullable=True)                             # hour 0-23
    quiet_end = Column(Integer, nullable=True)
```
Replace with:
```python
    new_shift_alerts = Column(String(10), nullable=False, default="daily")   # off | instant | daily
    manager_alerts_email = Column(Boolean, nullable=False, default=True)
    push_enabled = Column(Boolean, nullable=False, default=True)             # Phase 33: phone / browser notifications
    quiet_start = Column(Integer, nullable=True)                             # hour 0-23
    quiet_end = Column(Integer, nullable=True)
```

**Edit 3.** Find:
```python

    __table_args__ = (UniqueConstraint("worker_id", "cert_type", name="uq_worker_cert"),)
```
Replace with:
```python

    __table_args__ = (UniqueConstraint("worker_id", "cert_type", name="uq_worker_cert"),)


class PushSubscription(Base):
    """Phase 33: one browser / installed app that turned on notifications (Web Push)."""
    __tablename__ = "push_subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(100), nullable=False)
    device_label = Column(String(120), nullable=True)                   # "iPhone", "Android · Chrome", ...
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class AppKey(Base):
    """Phase 33: server-generated keys (the Web Push VAPID key pair when .secrets doesn't set one)."""
    __tablename__ = "app_keys"

    name = Column(String(50), primary_key=True)
    value = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```

---

## A3. `backend/src/schemas.py` (EDITS)

**Edit 1.** Find:
```python
    new_shift_alerts: str = "daily"          # off | instant | daily
    manager_alerts_email: bool = True
    quiet_start: Optional[int] = None        # hour 0-23
    quiet_end: Optional[int] = None
```
Replace with:
```python
    new_shift_alerts: str = "daily"          # off | instant | daily
    manager_alerts_email: bool = True
    push_enabled: bool = True                # Phase 33: phone / browser notifications (on the devices you turned on)
    quiet_start: Optional[int] = None        # hour 0-23
    quiet_end: Optional[int] = None
```

**Edit 2.** Find:
```python


class NotificationPreferencesUpdate(BaseModel):
    email_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
    reminders_enabled: Optional[bool] = None
    new_shift_alerts: Optional[str] = None
    manager_alerts_email: Optional[bool] = None
    quiet_start: Optional[int] = None
    quiet_end: Optional[int] = None
```
Replace with:
```python


class PushKeys(BaseModel):
    """Phase 33: from the browser's PushSubscription.toJSON().keys"""
    p256dh: str = Field(..., max_length=200)
    auth: str = Field(..., max_length=100)


class PushSubscribeBody(BaseModel):
    endpoint: str = Field(..., max_length=2000)
    keys: PushKeys
    device_label: Optional[str] = Field(None, max_length=120)


class PushUnsubscribeBody(BaseModel):
    endpoint: str = Field(..., max_length=2000)


class PushDevice(BaseModel):
    id: UUID
    device_label: Optional[str] = None
    created_at: datetime
    last_success_at: Optional[datetime] = None
    last_error: Optional[str] = None


class PushConfigResponse(BaseModel):
    public_key: str                          # VAPID application server key (base64url) for pushManager.subscribe
    devices: List[PushDevice] = []


class PushTestResult(BaseModel):
    reached: int
    error: Optional[str] = None


class NotificationPreferencesUpdate(BaseModel):
    email_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
    reminders_enabled: Optional[bool] = None
    new_shift_alerts: Optional[str] = None
    manager_alerts_email: Optional[bool] = None
    push_enabled: Optional[bool] = None      # Phase 33
    quiet_start: Optional[int] = None
    quiet_end: Optional[int] = None
```

---

# PART B: Backend

## B1. NEW FILE `backend/src/services/webpush.py`
VAPID keys, RFC 8291 encryption, sending. No new packages.

```python
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
```

---

## B2. `backend/src/services/notify.py` (EDITS)
The `push` channel: `wants_push()`, `push_payload()`, outbox rows for users with devices, sending in `deliver_pending()` (now `SKIP LOCKED`), and `deliver_soon()` after `notify()`.

**Edit 1.** Find:
```python
* If the user already read it in the app before a delayed email goes out, that email is skipped.
"""
import logging
from collections import defaultdict
```
Replace with:
```python
* If the user already read it in the app before a delayed email goes out, that email is skipped.
"""
import asyncio
import logging
from collections import defaultdict
```

**Edit 2.** Find:
```python
from src.config import settings
from src.database import AsyncSessionLocal
from src.models import Notification, NotificationDelivery, NotificationPreference, User
from src.auth import normalize_role
from src.services.messaging import (
    send_email, send_sms, render_email, render_digest, absolute_link, normalize_phone, sms_available,
```
Replace with:
```python
from src.config import settings
from src.database import AsyncSessionLocal
from src.models import Notification, NotificationDelivery, NotificationPreference, User, PushSubscription
from src.auth import normalize_role
from src.services import webpush                                   # Phase 33
from src.services.messaging import (
    send_email, send_sms, render_email, render_digest, absolute_link, normalize_phone, sms_available,
```

**Edit 3.** Find:
```python
    email_enabled=True, sms_enabled=False, reminders_enabled=True, new_shift_alerts="daily",
    manager_alerts_email=True, quiet_start=None, quiet_end=None, timezone="America/New_York",
)

```
Replace with:
```python
    email_enabled=True, sms_enabled=False, reminders_enabled=True, new_shift_alerts="daily",
    manager_alerts_email=True, quiet_start=None, quiet_end=None, timezone="America/New_York",
    push_enabled=True,                                    # Phase 33
)

```

**Edit 4.** Find:
```python


def settings_link_for(user: User) -> str:
    role = normalize_role(user.role)
```
Replace with:
```python


def wants_push(kind: str, prefs) -> bool:
    """Phase 33: phone / browser notifications. Same categories as email, except new shifts only when 'right away'."""
    if not getattr(prefs, "push_enabled", True):
        return False
    category = KINDS.get(kind, ("booking", False))[0]
    if category == "reminder":
        return bool(prefs.reminders_enabled)
    if category == "new_shift":
        return prefs.new_shift_alerts == "instant"
    return True


def push_payload(n: Notification) -> dict:
    """Phase 33: what the service worker shows. Kept small (push messages max out around 4 KB)."""
    lines = [l.strip() for l in (n.body or "").split("\n") if l.strip()]
    body = " · ".join(lines[:2])
    return {
        "title": (n.title or "ShiftBoard")[:120],
        "body": body[:240],
        "url": n.link or "/",
        "tag": str(n.id),
        "urgent": bool(n.urgent),
    }


def settings_link_for(user: User) -> str:
    role = normalize_role(user.role)
```

**Edit 5.** Find:
```python
    users = (await db.execute(select(User).where(User.id.in_(ids), User.is_active == True))).scalars().all()
    prefs = await load_prefs(db, [u.id for u in users])
    now = datetime.now(timezone.utc)
    title = (title or "")[:200]
```
Replace with:
```python
    users = (await db.execute(select(User).where(User.id.in_(ids), User.is_active == True))).scalars().all()
    prefs = await load_prefs(db, [u.id for u in users])
    with_devices = set((await db.execute(                                   # Phase 33: users with push turned on somewhere
        select(PushSubscription.user_id).where(PushSubscription.user_id.in_([u.id for u in users])).distinct()
    )).scalars().all()) if users else set()
    now = datetime.now(timezone.utc)
    title = (title or "")[:200]
```

**Edit 6.** Find:
```python
                send_after=release_time(p, now, urgent), created_at=now,
            ))
    await db.flush()
    return created
```
Replace with:
```python
                send_after=release_time(p, now, urgent), created_at=now,
            ))
        if u.id in with_devices and wants_push(kind, p):                    # Phase 33
            db.add(NotificationDelivery(
                notification_id=nid, user_id=u.id, channel="push", digest=False,
                send_after=release_time(p, now, urgent), created_at=now,
            ))
    await db.flush()
    return created
```

**Edit 7.** Find:
```python
            n = await notify_in(db, user_ids, kind, title, body, link, **kw)
            await db.commit()
            return n
    except Exception:
        logger.exception(f"notify({kind}) failed")
        return 0


```
Replace with:
```python
            n = await notify_in(db, user_ids, kind, title, body, link, **kw)
            await db.commit()
        if n:
            deliver_soon()        # Phase 33: push (and email / text) go out now instead of at the next minute tick
        return n
    except Exception:
        logger.exception(f"notify({kind}) failed")
        return 0


_background = set()


def deliver_soon() -> None:
    """Phase 33: run the outbox once in the background. Rows are locked (SKIP LOCKED), so this never
    double-sends with the minute worker. Never raises."""
    async def _run():
        try:
            async with AsyncSessionLocal() as db:
                await deliver_pending(db)
        except Exception:
            logger.exception("deliver_soon failed")
    try:
        task = asyncio.get_running_loop().create_task(_run())
        _background.add(task)
        task.add_done_callback(_background.discard)
    except Exception:
        pass


```

**Edit 8.** Find:
```python
        .order_by(NotificationDelivery.created_at.asc())
        .limit(limit)
    )).all()
    if not rows:
```
Replace with:
```python
        .order_by(NotificationDelivery.created_at.asc())
        .limit(limit)
        .with_for_update(of=NotificationDelivery, skip_locked=True)     # Phase 33: two senders never take the same row
    )).all()
    if not rows:
```

**Edit 9.** Find:
```python
        elif d.channel == "sms":
            ok, err = await send_sms(u.phone or "", _sms_text(n))
        else:
            ok, err = False, f"Unknown channel {d.channel}"
```
Replace with:
```python
        elif d.channel == "sms":
            ok, err = await send_sms(u.phone or "", _sms_text(n))
        elif d.channel == "push":                                          # Phase 33
            reached, err = await webpush.send_to_user(db, u.id, push_payload(n), urgent=bool(n.urgent))
            if reached == 0 and err == "No devices turned on":
                d.status = "skipped"
                d.last_error = err
                continue
            ok = reached > 0
        else:
            ok, err = False, f"Unknown channel {d.channel}"
```

---

## B3. `backend/src/routers/notifications.py` (EDITS)
New endpoints (same router, so `main.py` is unchanged):
* `GET /api/notifications/push`: the public key and your devices
* `POST /api/notifications/push/subscribe` `{endpoint, keys:{p256dh, auth}, device_label}`: 400 on a bad key or non-https endpoint
* `POST /api/notifications/push/unsubscribe` `{endpoint}`
* `DELETE /api/notifications/push/devices/{id}`: yours only, else 404
* `POST /api/notifications/push/test`: returns `{reached, error}`

**Edit 1.** Find:
```python

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import Notification, NotificationPreference, User, VenueManager
from src.schemas import (
    NotificationResponse, UnreadCountResponse,
    NotificationPreferencesResponse, NotificationPreferencesUpdate,
)
from src.auth import get_current_user, normalize_role
from src.services.notify import DEFAULT_PREFS, NEW_SHIFT_MODES, notify
from src.services.messaging import email_available, sms_available, normalize_phone

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])
```
Replace with:
```python

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, update, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import Notification, NotificationPreference, User, VenueManager, PushSubscription
from src.schemas import (
    NotificationResponse, UnreadCountResponse,
    NotificationPreferencesResponse, NotificationPreferencesUpdate,
    PushSubscribeBody, PushUnsubscribeBody, PushConfigResponse, PushDevice, PushTestResult,   # Phase 33
)
from src.auth import get_current_user, normalize_role
from src.services.notify import DEFAULT_PREFS, NEW_SHIFT_MODES, notify
from src.services.messaging import email_available, sms_available, normalize_phone
from src.services import webpush                                       # Phase 33

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])
```

**Edit 2.** Find:
```python
    )
    return await unread_count(current_user, db)
```
Replace with:
```python
    )
    return await unread_count(current_user, db)


# ------------------------------------------------------------------------------
# Phase 33: Web Push devices (the installed app / browser). The bell and email / text are unchanged.
# ------------------------------------------------------------------------------
async def _push_config(db: AsyncSession, user: User) -> PushConfigResponse:
    _, public_b64 = await webpush.ensure_keys(db)
    subs = (await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == user.id).order_by(PushSubscription.created_at.asc())
    )).scalars().all()
    return PushConfigResponse(
        public_key=public_b64,
        devices=[PushDevice(id=s.id, device_label=s.device_label, created_at=s.created_at,
                            last_success_at=s.last_success_at, last_error=s.last_error) for s in subs],
    )


def _check_subscription(body: PushSubscribeBody) -> None:
    if not body.endpoint.startswith("https://"):
        raise HTTPException(status_code=400, detail="That push address isn't valid.")
    try:
        key = webpush.b64u_decode(body.keys.p256dh)
        secret = webpush.b64u_decode(body.keys.auth)
    except Exception:
        raise HTTPException(status_code=400, detail="That device's keys aren't valid.")
    if len(key) != 65 or key[0] != 4 or len(secret) != 16:
        raise HTTPException(status_code=400, detail="That device's keys aren't valid.")


@router.get("/push", response_model=PushConfigResponse)
async def push_config(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The key the browser needs to subscribe, and the devices this account turned on."""
    return await _push_config(db, current_user)


@router.post("/push/subscribe", response_model=PushConfigResponse)
async def push_subscribe(
    body: PushSubscribeBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Turn on notifications for this device. The same device signing in as someone else moves to them."""
    _check_subscription(body)
    try:
        await db.execute(
            pg_insert(PushSubscription)
            .values(user_id=current_user.id, endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth,
                    device_label=(body.device_label or "").strip()[:120] or None, created_at=datetime.now(timezone.utc))
            .on_conflict_do_update(
                index_elements=["endpoint"],
                set_=dict(user_id=current_user.id, p256dh=body.keys.p256dh, auth=body.keys.auth,
                          device_label=(body.device_label or "").strip()[:120] or None, last_error=None),
            )
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not turn on notifications: {e}")
    return await _push_config(db, current_user)


@router.post("/push/unsubscribe", response_model=PushConfigResponse)
async def push_unsubscribe(
    body: PushUnsubscribeBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Turn off notifications for this device (also used on sign-out)."""
    try:
        await db.execute(delete(PushSubscription).where(
            PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == current_user.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not turn off notifications: {e}")
    return await _push_config(db, current_user)


@router.delete("/push/devices/{device_id}", response_model=PushConfigResponse)
async def push_remove_device(
    device_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove one of your devices (e.g. an old phone)."""
    sub = await db.scalar(select(PushSubscription).where(
        PushSubscription.id == device_id, PushSubscription.user_id == current_user.id))
    if sub is None:
        raise HTTPException(status_code=404, detail="Device not found.")
    try:
        await db.delete(sub)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove the device: {e}")
    return await _push_config(db, current_user)


@router.post("/push/test", response_model=PushTestResult)
async def push_test(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a test to every device you turned on, right now (not through the outbox)."""
    try:
        reached, err = await webpush.send_to_user(db, current_user.id, {
            "title": "ShiftBoard notifications are on",
            "body": "This is how shift updates will reach this device.",
            "url": "/", "tag": "push-test", "urgent": False,
        })
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not send a test: {e}")
    return PushTestResult(reached=reached, error=None if reached else err)
```

---

# PART C: Frontend, the app shell (`frontend/public/`, `index.html`, `main.jsx`)

## C0. `frontend/public/icons/`: ALREADY IN YOUR REPO, DO NOTHING
Claude placed `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png`, `badge-96.png` and `favicon.svg` there. Don't create, change or delete them.

---

## C1. NEW FILE `frontend/public/manifest.webmanifest`

```json
{
  "name": "ShiftBoard",
  "short_name": "ShiftBoard",
  "description": "Find, book and work shifts.",
  "id": "/",
  "start_url": "/?source=app",
  "scope": "/",
  "display": "standalone",
  "background_color": "#020617",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "My shifts", "url": "/worker?tab=schedule", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }] },
    { "name": "Find shifts", "url": "/worker?tab=find", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }] }
  ]
}
```

---

## C2. NEW FILE `frontend/public/sw.js`
The service worker. It must be at the site root (`/sw.js`) so it covers every page.

```js
/*
 * Phase 33: ShiftBoard service worker.
 * - Shows Web Push notifications and opens the right page when one is tapped.
 * - Keeps a tiny offline page for when the phone has no signal.
 * - It NEVER caches the app code or API calls (the dev server serves fresh code on every load),
 *   so an update can't get stuck behind a stale cache.
 * Bump CACHE when offline.html or the icons change.
 */
const CACHE = 'shiftboard-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Only page loads go through here: online = the network, offline = the offline page.
// cache: 'no-store' so a page is never half-loaded from the browser cache while the app code can't load.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(OFFLINE_URL)));
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'ShiftBoard', body: event.data ? event.data.text() : '' };
  }
  const urgent = Boolean(data.urgent);
  event.waitUntil(
    self.registration.showNotification(data.title || 'ShiftBoard', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag) && urgent,
      requireInteraction: urgent,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) return client.navigate(url);
        return undefined;
      }
    }
    return self.clients.openWindow(url);
  })());
});
```

---

## C3. NEW FILE `frontend/public/offline.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <title>ShiftBoard · Offline</title>
    <style>
      html, body { margin: 0; height: 100%; background: #020617; color: #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
      main { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px; padding: 24px; text-align: center; box-sizing: border-box; }
      img { width: 72px; height: 72px; border-radius: 18px; }
      h1 { margin: 0; font-size: 20px; color: #fff; }
      p { margin: 0; max-width: 320px; font-size: 14px; line-height: 1.5; color: #94a3b8; }
      button { margin-top: 6px; padding: 12px 22px; border: 0; border-radius: 12px; background: #10b981; color: #020617;
        font-size: 15px; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <img src="/icons/icon-192.png" alt="" />
      <h1>You're offline</h1>
      <p>ShiftBoard needs a connection to show your shifts. Check your signal or Wi-Fi, then try again.</p>
      <button type="button" onclick="location.reload()">Try again</button>
    </main>
  </body>
</html>
```

---

## C4. `frontend/index.html` (FULL FILE REPLACEMENT)
Manifest, icons, iOS app tags, `viewport-fit=cover`. The old `/vite.svg` favicon didn't exist.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/icons/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <!-- Phase 33: installable app (Add to Home Screen) -->
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <meta name="apple-mobile-web-app-title" content="ShiftBoard" />
    <title>ShiftBoard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

---

## C5. `frontend/src/main.jsx` (FULL FILE REPLACEMENT)

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerServiceWorker } from './utils/push'   // Phase 33: installable app + push notifications

registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

---

## C6. `frontend/src/index.css` (EDIT)
Appends the tab-bar height variable.

**Edit 1.** Find:
```css
  color: #94a3b8;
}

```
Replace with:
```css
  color: #94a3b8;
}


/* Phase 33: on phones, workers get a bottom tab bar. Sticky bars (e.g. Save profile) sit above it. */
@media (max-width: 767px) {
  html.has-tabbar {
    --tabbar-h: calc(4rem + env(safe-area-inset-bottom));
  }
}
```

---

# PART D: Frontend, push & install

## D1. NEW FILE `frontend/src/utils/push.js`
This device's permission / subscription, enable / disable / sync / test, and the install prompt. Service worker registration (https or localhost only).

```js
import api from '../api/client';

/**
 * Phase 33: the installed app (PWA) and Web Push on THIS device.
 * Nothing here throws at import time; every helper is safe on browsers without push.
 */

export const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  || (typeof navigator !== 'undefined' && navigator.standalone === true);

export const isIOS = () =>
  typeof navigator !== 'undefined'
  && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'unsupported' | 'needs_install' (iPhone / iPad outside the home-screen app) | 'denied' | 'default' | 'granted' */
export function permissionState() {
  if (isIOS() && !isStandalone()) return 'needs_install';
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

export function deviceLabel() {
  const ua = navigator.userAgent || '';
  const device = /iphone/i.test(ua) ? 'iPhone'
    : /ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /android/i.test(ua) ? 'Android'
    : /mac os/i.test(ua) ? 'Mac'
    : /windows/i.test(ua) ? 'Windows'
    : 'Computer';
  const browser = /edg\//i.test(ua) ? 'Edge' : /firefox|fxios/i.test(ua) ? 'Firefox'
    : /crios|chrome/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : '';
  const app = isStandalone() ? 'app' : browser;
  return app ? `${device} · ${app}` : device;
}

function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(sub, publicKey) {
  try {
    const a = new Uint8Array(sub.options.applicationServerKey);
    const b = keyBytes(publicKey);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  } catch (e) {
    return true;   // browser doesn't expose it: assume it's fine
  }
}

/** The service worker registration, or null after `ms` (e.g. not served over https). */
export async function swRegistration(ms = 4000) {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await swRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function saveSubscription(sub) {
  const json = sub.toJSON();
  const res = await api.post('/notifications/push/subscribe', {
    endpoint: json.endpoint,
    keys: json.keys,
    device_label: deviceLabel(),
  });
  return res.data;   // { public_key, devices }
}

async function subscribeFresh(reg, publicKey) {
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) {   // the server's key changed (e.g. after a database wipe)
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  return sub;
}

/** Ask permission (must be called from a tap), subscribe this device and save it. Returns { public_key, devices }. */
export async function enablePush() {
  const state = permissionState();
  if (state === 'needs_install') throw new Error('Add ShiftBoard to your Home Screen first, then open it from there.');
  if (state === 'unsupported') throw new Error("This browser can't show notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for ShiftBoard. Allow them in your browser or phone settings.'
      : 'Notifications were not turned on.');
  }
  const reg = await swRegistration();
  if (!reg) throw new Error("Notifications need the secure (https) address of ShiftBoard.");
  const { data } = await api.get('/notifications/push');
  const sub = await subscribeFresh(reg, data.public_key);
  return saveSubscription(sub);
}

/** Turn off this device (server + browser). Never throws. */
export async function disablePush() {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await api.post('/notifications/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch (e) {
    /* nothing to undo */
  }
}

/** On app start: if this device already allowed notifications, make sure the server has it (and the right key). */
export async function syncPush() {
  try {
    if (permissionState() !== 'granted') return;
    const reg = await swRegistration();
    if (!reg) return;
    const existing = await reg.pushManager.getSubscription();
    if (!existing) return;                       // they never turned it on here (or turned it off)
    const { data } = await api.get('/notifications/push');
    await saveSubscription(await subscribeFresh(reg, data.public_key));
  } catch (e) {
    /* best effort */
  }
}

export async function sendTestPush() {
  const res = await api.post('/notifications/push/test');
  return res.data;   // { reached, error }
}

// ---- Install ("Add to Home Screen") -----------------------------------------------------------
// Chrome / Edge / Android fire `beforeinstallprompt` once, early. Keep it so a button can use it later.
let deferredInstall = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    window.dispatchEvent(new Event('shiftboard_install_ready'));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    window.dispatchEvent(new Event('shiftboard_install_ready'));
  });
}

export const canPromptInstall = () => Boolean(deferredInstall);

/** Shows the browser's install dialog. Returns true if they installed. */
export async function promptInstall() {
  if (!deferredInstall) return false;
  const e = deferredInstall;
  deferredInstall = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  window.dispatchEvent(new Event('shiftboard_install_ready'));
  return choice?.outcome === 'accepted';
}

/** Register the service worker (called once from main.jsx). */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const secure = window.isSecureContext;   // https, or localhost
  if (!secure) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker not registered:', err));
  });
}
```

---

## D2. NEW FILE `frontend/src/components/PushDeviceCard.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { Smartphone, BellRing, BellOff, Send, Trash2, Share, PlusSquare, Info } from 'lucide-react';
import api from '../api/client';
import {
  permissionState, currentSubscription, enablePush, disablePush, sendTestPush, isIOS,
} from '../utils/push';

const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50';

function fmtDay(value) {
  try {
    return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

/**
 * Phase 33: phone / browser notifications (Web Push) for THIS device, plus the account's other devices.
 * Props: pushEnabled (prefs.push_enabled), onPushEnabled(bool) (saved with the modal's Save button)
 */
export default function PushDeviceCard({ pushEnabled, onPushEnabled }) {
  const [state, setState] = useState(permissionState());
  const [subscribed, setSubscribed] = useState(false);
  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // { type, text }

  const refresh = async () => {
    setState(permissionState());
    try {
      const [sub, cfg] = await Promise.all([currentSubscription(), api.get('/notifications/push')]);
      setDevices(cfg.data.devices || []);
      setSubscribed(Boolean(sub) && (cfg.data.devices || []).length > 0);
    } catch (e) {
      /* keep what we have */
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const run = async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await fn();
      if (okText) setMsg({ type: 'success', text: typeof okText === 'function' ? okText(out) : okText });
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.detail || err.message || 'Something went wrong.' });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const turnOn = () => run(async () => {
    await enablePush();
    if (!pushEnabled) onPushEnabled(true);
  }, "Notifications are on for this device. Tap Save to keep your other settings.");
  const turnOff = () => run(disablePush, 'Turned off for this device.');
  const test = () => run(sendTestPush, (r) => (r.reached ? `Sent to ${r.reached} device${r.reached === 1 ? '' : 's'}.` : r.error || 'No device got it.'));
  const remove = (id) => run(async () => {
    await api.delete(`/notifications/push/devices/${id}`);
  }, 'Device removed.');

  return (
    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Smartphone className="w-4 h-4 text-emerald-400" /> Phone notifications
      </div>
      <p className="text-xs text-slate-400">
        Pop-up alerts on your phone or computer, like a text but free. Same messages as email, plus new shifts if you
        chose "Right away". Quiet hours apply.
      </p>

      {state === 'needs_install' && (
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 space-y-1.5">
          <p className="font-semibold text-white">On iPhone and iPad, notifications work from the ShiftBoard app on your Home Screen:</p>
          <p className="flex items-start gap-1.5"><Share className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" /><span>1. Tap <b>Share</b> in Safari.</span></p>
          <p className="flex items-start gap-1.5"><PlusSquare className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" /><span>2. Tap <b>Add to Home Screen</b>.</span></p>
          <p>3. Open ShiftBoard from your Home Screen and come back here.</p>
        </div>
      )}
      {state === 'unsupported' && (
        <p className="text-xs text-slate-500">This browser can't show notifications. Try Chrome, Edge, Firefox or Safari.</p>
      )}
      {state === 'denied' && (
        <p className="text-xs text-amber-300 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Notifications are blocked for ShiftBoard on this device. Allow them in your {isIOS() ? 'iPhone Settings → Notifications → ShiftBoard' : 'browser’s site settings'}, then come back.</span>
        </p>
      )}

      {(state === 'default' || state === 'granted') && (
        <div className="flex flex-wrap items-center gap-2">
          {subscribed ? (
            <>
              <span className="text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5 mr-auto">
                <BellRing className="w-4 h-4" /> On for this device
              </span>
              <button type="button" onClick={test} disabled={busy} className={`${btn} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200`}>
                <Send className="w-3.5 h-3.5" /> Send a test
              </button>
              <button type="button" onClick={turnOff} disabled={busy} className={`${btn} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300`}>
                <BellOff className="w-3.5 h-3.5" /> Turn off here
              </button>
            </>
          ) : (
            <button type="button" onClick={turnOn} disabled={busy} className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950`}>
              <BellRing className="w-3.5 h-3.5" /> {busy ? 'Turning on…' : 'Turn on for this device'}
            </button>
          )}
        </div>
      )}

      {msg && (
        <p className={`text-xs ${msg.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</p>
      )}

      {devices.length > 0 && (
        <div className="pt-1 space-y-1.5">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={!!pushEnabled} onChange={(e) => onPushEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
            <span className="text-xs text-slate-300">Send notifications to my devices</span>
          </label>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Your devices ({devices.length})</div>
          {devices.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-xs text-slate-300">
              <Smartphone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {d.device_label || 'Device'} <span className="text-slate-500">· added {fmtDay(d.created_at)}</span>
                {d.last_error && <span className="text-amber-300"> · last try failed</span>}
              </span>
              <button type="button" onClick={() => remove(d.id)} disabled={busy} title="Remove this device"
                className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-rose-500/10">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## D3. NEW FILE `frontend/src/components/AppNudge.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { Smartphone, BellRing, X, Share, PlusSquare, Download } from 'lucide-react';
import {
  isStandalone, isIOS, permissionState, currentSubscription, enablePush, canPromptInstall, promptInstall,
} from '../utils/push';

const KEY_INSTALL = 'shiftboard_nudge_install_dismissed';
const KEY_PUSH = 'shiftboard_nudge_push_dismissed';
const isPhone = () => window.matchMedia && window.matchMedia('(max-width: 767px)').matches;

/**
 * Phase 33: one small, dismissible card on the dashboard:
 *   1. on a phone, not installed yet  -> "Get the ShiftBoard app" (Install button, or iPhone steps)
 *   2. installed / on a computer, notifications not on here -> "Turn on notifications"
 * Dismissing hides it on this device (localStorage).
 * Props: manager (bool) for the manager dashboard's wording.
 */
export default function AppNudge({ manager = false }) {
  const [mode, setMode] = useState(null);      // 'install' | 'push' | null
  const [showSteps, setShowSteps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const decide = async () => {
    const dismissed = (k) => {
      try { return localStorage.getItem(k) === '1'; } catch (e) { return false; }
    };
    if (!isStandalone() && isPhone() && !dismissed(KEY_INSTALL) && (isIOS() || canPromptInstall())) {
      setMode('install');
      return;
    }
    const state = permissionState();
    if ((state === 'default' || state === 'granted') && !dismissed(KEY_PUSH)) {
      const sub = await currentSubscription().catch(() => null);
      setMode(sub ? null : 'push');
      return;
    }
    setMode(null);
  };

  useEffect(() => {
    decide();
    const again = () => decide();
    window.addEventListener('shiftboard_install_ready', again);
    return () => window.removeEventListener('shiftboard_install_ready', again);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mode) return null;

  const dismiss = () => {
    try { localStorage.setItem(mode === 'install' ? KEY_INSTALL : KEY_PUSH, '1'); } catch (e) { /* private mode */ }
    setMode(null);
  };

  const install = async () => {
    if (isIOS()) {
      setShowSteps(true);
      return;
    }
    setBusy(true);
    await promptInstall();
    setBusy(false);
    decide();
  };

  const turnOn = async () => {
    setBusy(true);
    setError('');
    try {
      await enablePush();
      setMode(null);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Could not turn on notifications.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 p-3.5 rounded-xl border border-emerald-500/40 bg-emerald-500/5 flex items-start gap-3">
      {mode === 'install' ? <Smartphone className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" /> : <BellRing className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">
          {mode === 'install' ? 'Get the ShiftBoard app on your phone' : 'Get shift alerts on this device'}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          {mode === 'install'
            ? 'One tap from your Home Screen, full screen, and notifications when shifts change.'
            : manager
              ? 'Know right away about new requests, drops, and people who haven’t clocked in.'
              : 'Know right away when you’re booked, a shift changes, or it’s time to clock in.'}
        </p>
        {showSteps && (
          <div className="mt-2 text-xs text-slate-300 space-y-1">
            <p className="flex items-start gap-1.5"><Share className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" /><span>1. Tap <b>Share</b> at the bottom of Safari.</span></p>
            <p className="flex items-start gap-1.5"><PlusSquare className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" /><span>2. Tap <b>Add to Home Screen</b>, then <b>Add</b>.</span></p>
            <p>3. Open ShiftBoard from your Home Screen.</p>
          </div>
        )}
        {error && <p className="mt-1.5 text-xs text-rose-300">{error}</p>}
        {!showSteps && (
          <button type="button" onClick={mode === 'install' ? install : turnOn} disabled={busy}
            className="mt-2 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
            {mode === 'install' ? <Download className="w-3.5 h-3.5" /> : <BellRing className="w-3.5 h-3.5" />}
            {busy ? 'One moment…' : mode === 'install' ? (isIOS() ? 'Show me how' : 'Install') : 'Turn on notifications'}
          </button>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label="Not now" className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
```

---

## D4. `frontend/src/components/NotificationSettingsModal.jsx` (EDITS)
Adds the Phone notifications card, and saves `push_enabled`.

**Edit 1.** Find:
```jsx
import ModalShell from './ModalShell';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';

const inputCls =
```
Replace with:
```jsx
import ModalShell from './ModalShell';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';
import PushDeviceCard from './PushDeviceCard';   // Phase 33

const inputCls =
```

**Edit 2.** Find:
```jsx
        new_shift_alerts: prefs.new_shift_alerts,
        manager_alerts_email: prefs.manager_alerts_email,
        timezone: prefs.timezone,
        phone,
```
Replace with:
```jsx
        new_shift_alerts: prefs.new_shift_alerts,
        manager_alerts_email: prefs.manager_alerts_email,
        push_enabled: prefs.push_enabled !== false,        // Phase 33
        timezone: prefs.timezone,
        phone,
```

**Edit 3.** Find:
```jsx
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Mail className="w-4 h-4 text-emerald-400" /> Email</div>
```
Replace with:
```jsx
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            {/* Phase 33: phone / browser notifications */}
            <PushDeviceCard pushEnabled={prefs.push_enabled !== false} onPushEnabled={(v) => set('push_enabled', v)} />

            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Mail className="w-4 h-4 text-emerald-400" /> Email</div>
```

**Edit 4.** Find:
```jsx
                checked={quietOn}
                onChange={setQuietOn}
                title="Hold non-urgent email and texts overnight"
                body="Urgent ones (cancellations, last-minute changes) still come through."
              />
```
Replace with:
```jsx
                checked={quietOn}
                onChange={setQuietOn}
                title="Hold non-urgent email, texts and phone notifications overnight"
                body="Urgent ones (cancellations, last-minute changes) still come through."
              />
```

---

## D5. `frontend/src/components/Navbar.jsx` (EDITS)
Re-syncs this device on load; signing out turns this device off first.

**Edit 1.** Find:
```jsx
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin, UserRound } from 'lucide-react';
import { Avatar } from './WorkerProfilePanel';

export default function Navbar() {
```
Replace with:
```jsx
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin, UserRound } from 'lucide-react';
import { Avatar } from './WorkerProfilePanel';
import { syncPush, disablePush } from '../utils/push';   // Phase 33

export default function Navbar() {
```

**Edit 2.** Find:
```jsx
  const isManagerRole = userRole === 'venue_manager';

  const handleLogout = () => {
    setMobileOpen(false);
    logout();
    navigate('/login');
  };

  // Close the mobile menu whenever the route changes
```
Replace with:
```jsx
  const isManagerRole = userRole === 'venue_manager';

  const handleLogout = async () => {
    setMobileOpen(false);
    await disablePush();          // Phase 33: this device stops getting this account's notifications
    logout();
    navigate('/login');
  };

  // Phase 33: if this device already allowed notifications, make sure the server still has it
  useEffect(() => {
    if (user?.id) syncPush();
  }, [user?.id]);

  // Close the mobile menu whenever the route changes
```

---

## D6. `frontend/src/pages/VenueManagerDashboard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import TonightBoard from '../components/manager/TonightBoard';
import NeedsYouStrip from '../components/manager/NeedsYouStrip';

/**
```
Replace with:
```jsx
import TonightBoard from '../components/manager/TonightBoard';
import NeedsYouStrip from '../components/manager/NeedsYouStrip';
import AppNudge from '../components/AppNudge';   // Phase 33

/**
```

**Edit 2.** Find:
```jsx

      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
        {notification && (
          <div
```
Replace with:
```jsx

      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
        <AppNudge manager />
        {notification && (
          <div
```

---

# PART E: Frontend, phone tab bar

## E1. NEW FILE `frontend/src/components/WorkerTabBar.jsx`
Renders nothing for managers and admins, and nothing from `md` up.

```jsx
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ListChecks, Search, CalendarDays, ArrowRightLeft, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ITEMS = [
  { id: 'schedule', label: 'My shifts', icon: ListChecks },
  { id: 'find', label: 'Find', icon: Search },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'transfers', label: 'Hand-offs', icon: ArrowRightLeft },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

function savedState() {
  try {
    return JSON.parse(sessionStorage.getItem('shiftboard_worker_tab') || 'null') || { tab: 'schedule', badges: {} };
  } catch (e) {
    return { tab: 'schedule', badges: {} };
  }
}

/**
 * Phase 33: bottom tab bar for workers on phones (hidden from md up). WorkerDashboard reports the open tab
 * and badge counts with a 'worker_tab_state' event; tapping a tab opens /worker?tab=… (the dashboard reads it).
 */
export default function WorkerTabBar() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState(savedState);
  const isWorker = String(user?.role || '').toLowerCase() === 'worker';

  useEffect(() => {
    const onState = (e) => setState(e.detail);
    window.addEventListener('worker_tab_state', onState);
    return () => window.removeEventListener('worker_tab_state', onState);
  }, []);

  useEffect(() => {
    if (!isWorker) return undefined;
    document.documentElement.classList.add('has-tabbar');
    return () => document.documentElement.classList.remove('has-tabbar');
  }, [isWorker]);

  if (!isWorker) return null;

  const activeId = location.pathname === '/profile' ? 'profile' : location.pathname === '/worker' ? state.tab : null;
  const go = (id) => {
    window.scrollTo({ top: 0 });
    navigate(id === 'profile' ? '/profile' : `/worker?tab=${id}`);
  };

  return (
    <>
      <div className="md:hidden" style={{ height: 'var(--tabbar-h, 4rem)' }} aria-hidden="true" />
      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur border-t border-slate-800"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5">
          {ITEMS.map(({ id, label, icon: Icon }) => {
            const on = activeId === id;
            const badge = (state.badges || {})[id] || 0;
            return (
              <button key={id} type="button" onClick={() => go(id)} aria-current={on ? 'page' : undefined}
                className={`relative h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
                  on ? 'text-emerald-400' : 'text-slate-400 active:text-white'}`}>
                {on && <span className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-emerald-400" />}
                <span className="relative">
                  <Icon className="w-5 h-5" />
                  {badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black inline-flex items-center justify-center">
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
```

---

## E2. `frontend/src/App.jsx` (EDITS)
`<WorkerTabBar />` after the page on /worker, /venues, /venues/:id and /profile.

**Edit 1.** Find:
```jsx
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import WorkerDashboard from './pages/WorkerDashboard';
```
Replace with:
```jsx
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import WorkerTabBar from './components/WorkerTabBar';   // Phase 33: phone tab bar (workers only)
import LoginPage from './pages/LoginPage';
import WorkerDashboard from './pages/WorkerDashboard';
```

**Edit 2.** Find:
```jsx
                  <Navbar />
                  <WorkerDashboard />
                </ProtectedRoute>
              }
```
Replace with:
```jsx
                  <Navbar />
                  <WorkerDashboard />
                  <WorkerTabBar />
                </ProtectedRoute>
              }
```

**Edit 3.** Find:
```jsx
                  <Navbar />
                  <VenuesDirectory />
                </ProtectedRoute>
              }
```
Replace with:
```jsx
                  <Navbar />
                  <VenuesDirectory />
                  <WorkerTabBar />
                </ProtectedRoute>
              }
```

**Edit 4.** Find:
```jsx
                  <Navbar />
                  <VenueProfile />
                </ProtectedRoute>
              }
```
Replace with:
```jsx
                  <Navbar />
                  <VenueProfile />
                  <WorkerTabBar />
                </ProtectedRoute>
              }
```

**Edit 5.** Find:
```jsx
                  <Navbar />
                  <ProfilePage />
                </ProtectedRoute>
              }
```
Replace with:
```jsx
                  <Navbar />
                  <ProfilePage />
                  <WorkerTabBar />
                </ProtectedRoute>
              }
```

---

## E3. `frontend/src/pages/WorkerDashboard.jsx` (EDITS)
Reports the open tab and badges to the bar, hides the in-page tabs on phones for workers, and shows `AppNudge`.

**Edit 1.** Find:
```jsx
import HandoffsPanel from '../components/worker/HandoffsPanel';
import ProfileNudge from '../components/worker/ProfileNudge';
import { PENDING_INVITE_KEY } from './JoinPage';
import {
```
Replace with:
```jsx
import HandoffsPanel from '../components/worker/HandoffsPanel';
import ProfileNudge from '../components/worker/ProfileNudge';
import AppNudge from '../components/AppNudge';   // Phase 33
import { PENDING_INVITE_KEY } from './JoinPage';
import {
```

**Edit 2.** Find:
```jsx
  };

  const tabs = [
    { id: 'schedule', label: 'My shifts', icon: ListChecks, count: upcomingRequests.length },
```
Replace with:
```jsx
  };

  // Phase 33: tell the phone tab bar which tab is open and what needs attention
  useEffect(() => {
    if (!activeTab) return;
    const detail = {
      tab: activeTab,
      badges: { schedule: offers.length, calendar: calendar.unread_count || 0, transfers: incomingTransfers.length },
    };
    try { sessionStorage.setItem('shiftboard_worker_tab', JSON.stringify(detail)); } catch (e) { /* private mode */ }
    window.dispatchEvent(new CustomEvent('worker_tab_state', { detail }));
  }, [activeTab, offers.length, calendar.unread_count, incomingTransfers.length]);

  const tabs = [
    { id: 'schedule', label: 'My shifts', icon: ListChecks, count: upcomingRequests.length },
```

**Edit 3.** Find:
```jsx
  ];
  const isWorker = String(user?.role || '').toLowerCase() === 'worker';
  const chipBtn = 'px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-600 text-xs text-slate-300 inline-flex items-center gap-1.5';

```
Replace with:
```jsx
  ];
  const isWorker = String(user?.role || '').toLowerCase() === 'worker';
  const activeTabLabel = (tabs.find((t) => t.id === activeTab) || {}).label;
  const chipBtn = 'px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-600 text-xs text-slate-300 inline-flex items-center gap-1.5';

```

**Edit 4.** Find:
```jsx
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6">
        {isWorker && <ProfileNudge />}
        {notification && (
          <div className={`mb-5 p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
```
Replace with:
```jsx
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6">
        {isWorker && <ProfileNudge />}
        <AppNudge />
        {notification && (
          <div className={`mb-5 p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
```

**Edit 5.** Find:
```jsx
        )}

        {/* Tabs: 2×2 on phones so none are hidden */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 border-b border-slate-800 pb-4">
          {tabs.map((t) => {
            const Icon = t.icon;
```
Replace with:
```jsx
        )}

        {/* Tabs: 2×2 on phones so none are hidden. Phase 33: workers on phones use the bottom tab bar instead. */}
        {isWorker && activeTabLabel && (
          <h2 className="md:hidden text-lg font-bold text-white border-b border-slate-800 pb-3">{activeTabLabel}</h2>
        )}
        <div className={`${isWorker ? 'hidden md:flex md:flex-wrap' : 'grid grid-cols-2 sm:flex sm:flex-wrap'} gap-2 border-b border-slate-800 pb-4`}>
          {tabs.map((t) => {
            const Icon = t.icon;
```

---

## E4. `frontend/src/components/profile/AboutSection.jsx` (EDIT)
The Save bar sits above the tab bar.

**Edit 1.** Find:
```jsx

      {/* Phase 32.2.1: pinned to the bottom of the screen while there are unsaved changes; save errors show right here */}
      <div className={`${dirty || saveStatus?.type === 'error' ? 'sticky bottom-3 z-20 p-3 rounded-2xl bg-slate-900/95 border border-slate-700 shadow-xl backdrop-blur' : ''} flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3`}>
        {saveStatus?.type === 'error' ? (
          <p role="alert" className="flex-1 text-sm text-rose-300 inline-flex items-start gap-1.5">
```
Replace with:
```jsx

      {/* Phase 32.2.1: pinned to the bottom of the screen while there are unsaved changes; save errors show right here */}
      <div style={{ bottom: 'calc(var(--tabbar-h, 0px) + 0.75rem)' }}   /* Phase 33: above the phone tab bar */
        className={`${dirty || saveStatus?.type === 'error' ? 'sticky z-20 p-3 rounded-2xl bg-slate-900/95 border border-slate-700 shadow-xl backdrop-blur' : ''} flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3`}>
        {saveStatus?.type === 'error' ? (
          <p role="alert" className="flex-1 text-sm text-rose-300 inline-flex items-start gap-1.5">
```

---

## F. Rebuild & verification

**Schema changed** (two new tables and one new column). Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data** (safe to run twice):
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh VARCHAR(200) NOT NULL,
    auth VARCHAR(100) NOT NULL,
    device_label VARCHAR(120),
    last_success_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS app_keys (
    name VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ.)

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

**Use the https address** (`https://dev-scheduler-local.jaccollective.com` or your Cloudflare hostname) for everything below. Service workers and push don't run on plain `http://` except `localhost`.

### Checklist
**Install**
1. Desktop Chrome/Edge: the address bar shows an **Install** icon. Install it; ShiftBoard opens in its own window with the green calendar icon.
2. Android (Chrome):
   * The dashboard shows **"Get the ShiftBoard app on your phone" → Install**.
   * It lands on the Home Screen and opens full screen.
   * Long-pressing the icon shows **My shifts / Find shifts** shortcuts.
3. iPhone (Safari):
   * The card says **Show me how** (Share → Add to Home Screen).
   * After adding, open ShiftBoard **from the Home Screen**: it runs full screen.

**Notifications**

4. In the app, open the bell → settings. On the **Phone notifications** card, tap **Turn on for this device** and allow.
   * It shows **On for this device**, and the device appears under **Your devices**.
   * **Send a test** pops up "ShiftBoard notifications are on".
5. As a manager, approve that worker's request. The worker's phone gets **"You're booked"** within seconds. Tapping it opens the shift.
6. Set quiet hours around now: a non-urgent notification waits, while an urgent one (e.g. cancel the shift) still arrives.
7. **Turn off here** (or sign out): tests no longer reach that device.

**Phone layout (worker)**

8. On a phone, the bottom bar shows **My shifts · Find · Calendar · Hand-offs · Profile**:
   * The badges match the counts.
   * Tapping switches tabs, and the top tab buttons are hidden.
   * On Profile, the **Save** bar floats above the tab bar.
9. Turn on airplane mode and reload: the **"You're offline"** page shows. Turn it off and tap **Try again**.
10. Desktop, managers and admins look the same as before, apart from the dismissible "Get shift alerts on this device" card.