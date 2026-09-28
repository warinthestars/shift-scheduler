# Phase 33.0.1: Notifications Go Out Instantly, Firebase Cloud Messaging, Official Libraries

**Why:** Phase 33 was applied cleanly. The agent's report and a follow-up review found:
1. **Instant delivery only reached the test button.** `deliver_soon()` was wired into `notify()`, but every real trigger (booked, request waiting, assigned, cancelled, hand-offs, team…) goes through `notify_events._run()`. So push, email and text still waited for the 60-second worker tick. **Fixed:** `_run()` now calls `deliver_soon()` after its commit.
2. **"You're on the The Hippodrome team"**: the team notification and the invite email doubled "the" for venues whose names start with "The". **Fixed** with `team_name()`.
3. **`TimeOffCard.jsx` is still in the repo** (from 32.1). **Delete it** (step D3).
4. **Workarounds replaced with the official packages you chose:**
   * **Firebase Cloud Messaging** for phone / browser notifications, using `firebase-admin`, which was already installed.
   * **pywebpush** for the Web Push fallback. The hand-written encryption is removed.

## How push works after this phase
* **When Firebase messaging is set up** (the three keys in §F):
  - New devices register a **Firebase token** (the browser uses the Firebase JS SDK, which is already a dependency).
  - The server sends through **Firebase Cloud Messaging** with `firebase-admin` (`messaging.send_each_async`).
  - You get the Firebase console, delivery through Google, and tokens that native apps can use later.
* **Until then (or if the keys are removed):** everything keeps using ShiftBoard's own **Web Push**, now sent with **pywebpush**. Nothing to configure.
* **Devices move automatically:** each time the app opens it asks the server which route to use and re-registers (Web Push → Firebase once the keys are in; back again if they're removed).
* **Messages:**
  - Firebase messages are **data-only**, so the same `sw.js` shows both kinds identically (title, text, link, urgent ones stay on screen).
  - Tokens Firebase reports as gone are deleted, like dead Web Push devices.
* **Admin → System** gets a **Phone notifications** row: which route is in use, how many devices are on, and **exactly what's missing** for Firebase.
* Texts stay on Twilio. Firebase can't send regular SMS (its texts are sign-in codes only).

⚠️ **Schema change (small):**
* `push_subscriptions.provider` (`webpush` | `fcm`) is added.
* `p256dh` / `auth` become nullable, since Firebase devices don't have them.

**Requirements changed** (`firebase-admin>=7.0.0`, `pywebpush==2.3.0`, `py-vapid>=1.9`), so the backend image must be rebuilt.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `main.py` (unchanged)
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
  - `frontend/public/icons/`, and **anything inside `.secrets/` except appending to `.secrets.env.template` (step A5)**
* **Package changes are ONLY the three lines in `backend/requirements.txt` (step A4).**
  - No npm changes: `firebase` (which includes `firebase/messaging`) is already installed.
  - `pywebpush` is pinned to 2.3.0 because 2.4+ forces `cryptography>=47`.
* No native PostgreSQL ENUMs: `provider` is `VARCHAR(10)`.
* Aware UTC datetimes only.
* Notification hooks run after the commit and never raise. `deliver_soon()` and every push / Firebase function never raise.
* **Never read, print or commit secret values.** You only append placeholder lines to the template.
* **NEW FILE / FULL FILE REPLACEMENT**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from your **current** files: all 16 Phase 33 files in your repo were checked and match. They were verified:
  - **Backend:** imports cleanly; still **175** API operations (the push endpoints gained fields, no new routes).
  - **Frontend:** bundles with no missing imports.
  - **A new 24-check suite** passes. It replaces the Phase 33 push suite, whose hand-written-encryption checks no longer apply. It covers:
    - pywebpush against a local push service that **decrypts with the device's keys and verifies the VAPID signature**
    - **a real trigger (added to a team) reaching the device within seconds**, with push and email both marked sent
    - Firebase set up with a generated service account: data-only messages with string values, the high-urgency header, dead tokens removed
    - a device holding both routes; moving Web Push → Firebase; keys removed → back to Web Push (device kept with the reason)
    - Admin → System reporting the route and what's missing
  - **All earlier suites pass** (28, 20, 97, 36, 64, 67, 39, 49, 107, 32, 17).
  - The keep-data SQL was tested on a Phase 33 database: safe to run twice, and the **whole schema** is identical to a fresh install.
  - In real Chromium, the service worker shows **both** a Firebase-shaped message and a Web Push one correctly, and the Admin → System row renders.

  Don't "improve" them.

---

# PART A: Database, models, schemas, packages, config

## A1. `database/init.sql` (EDIT)

**Edit 1.** Find:
```sql
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,                            -- the browser's push service URL for this device
    p256dh VARCHAR(200) NOT NULL,                             -- the device's public key (base64url)
    auth VARCHAR(100) NOT NULL,                               -- the device's auth secret (base64url)
    device_label VARCHAR(120),                                -- e.g. "iPhone", "Android · Chrome"
    last_success_at TIMESTAMPTZ,
```
Replace with:
```sql
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,                            -- Web Push: the browser's push URL. Firebase: the device token
    p256dh VARCHAR(200),                                      -- Web Push only: the device's public key (base64url)
    auth VARCHAR(100),                                        -- Web Push only: the device's auth secret (base64url)
    provider VARCHAR(10) NOT NULL DEFAULT 'webpush',          -- Phase 33.0.1: webpush | fcm
    device_label VARCHAR(120),                                -- e.g. "iPhone", "Android · Chrome"
    last_success_at TIMESTAMPTZ,
```

---

## A2. `backend/src/models.py` (EDIT)

**Edit 1.** Find:
```python
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(100), nullable=False)
    device_label = Column(String(120), nullable=True)                   # "iPhone", "Android · Chrome", ...
    last_success_at = Column(DateTime(timezone=True), nullable=True)
```
Replace with:
```python
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(Text, nullable=False, unique=True)                # Web Push URL, or the Firebase token (Phase 33.0.1)
    p256dh = Column(String(200), nullable=True)                         # Web Push only
    auth = Column(String(100), nullable=True)                           # Web Push only
    provider = Column(String(10), nullable=False, default="webpush")    # Phase 33.0.1: webpush | fcm
    device_label = Column(String(120), nullable=True)                   # "iPhone", "Android · Chrome", ...
    last_success_at = Column(DateTime(timezone=True), nullable=True)
```

---

## A3. `backend/src/schemas.py` (EDITS)
The subscribe body takes `provider` + `token` for Firebase (the Phase 33 Web Push body still works). The push config gains `provider` / `fcm_vapid_key` / `fcm_config`; Admin System gains the `push_*` fields.

**Edit 1.** Find:
```python

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
```
Replace with:
```python

class PushSubscribeBody(BaseModel):
    provider: str = "webpush"                          # Phase 33.0.1: webpush | fcm
    endpoint: Optional[str] = Field(None, max_length=2000)   # webpush
    keys: Optional[PushKeys] = None                          # webpush
    token: Optional[str] = Field(None, max_length=4096)      # fcm: from firebase getToken()
    device_label: Optional[str] = Field(None, max_length=120)


class PushUnsubscribeBody(BaseModel):
    endpoint: str = Field(..., max_length=4096)              # the Web Push URL, or the Firebase token


class PushDevice(BaseModel):
    id: UUID
    provider: str = "webpush"                          # Phase 33.0.1
    device_label: Optional[str] = None
    created_at: datetime
```

**Edit 2.** Find:
```python
    public_key: str                          # VAPID application server key (base64url) for pushManager.subscribe
    devices: List[PushDevice] = []


```
Replace with:
```python
    public_key: str                          # VAPID application server key (base64url) for pushManager.subscribe
    devices: List[PushDevice] = []
    provider: str = "webpush"                # Phase 33.0.1: the route new devices use (fcm when Firebase messaging is set up)
    fcm_vapid_key: Optional[str] = None      # Phase 33.0.1: Firebase "Web Push certificate" key, for getToken()
    fcm_config: Optional[dict] = None        # Phase 33.0.1: the public Firebase web config, for initializeApp()


```

**Edit 3.** Find:
```python
    email_from: str = ""
    email_ready: bool = False
    sms_provider: str = "off"
    sms_ready: bool = False
```
Replace with:
```python
    email_from: str = ""
    email_ready: bool = False
    push_route: str = "webpush"              # Phase 33.0.1: fcm | webpush (what new devices use)
    push_firebase_missing: List[str] = []    # Phase 33.0.1: what Firebase messaging still needs
    push_firebase_error: Optional[str] = None
    push_devices: int = 0
    sms_provider: str = "off"
    sms_ready: bool = False
```

---

## A4. `backend/requirements.txt` (FULL FILE REPLACEMENT)
Only `firebase-admin>=7.0.0` (was `>=6.5.0`) and the last three lines are new.

```text
fastapi>=0.110.0
uvicorn[standard]>=0.28.0
pydantic[email]>=2.6.0
email-validator>=2.1.0
pydantic-settings>=2.2.0
sqlalchemy[asyncio]>=2.0.28
greenlet>=3.0.0
asyncpg>=0.29.0
psycopg2-binary>=2.9.9
alembic>=1.13.1
redis>=5.0.3
firebase-admin>=7.0.0
boto3>=1.34.0
python-dotenv>=1.0.1
httpx>=0.27.0
pytest>=8.1.0
passlib[bcrypt]>=1.7.4
bcrypt>=4.0.0,<4.1.0
python-jose[cryptography]>=3.3.0
pyjwt>=2.8.0
python-multipart>=0.0.9
google-auth>=2.27.0
requests>=2.31.0
tzdata>=2024.1
segno>=1.6.0
# Phase 33.0.1: phone / browser notifications (Web Push fallback when Firebase messaging isn't set up)
pywebpush==2.3.0
py-vapid>=1.9
```

---

## A5. `.secrets/.secrets.env.template` (APPEND at the very end, change nothing else)
Don't open or edit `.secrets/.secrets.env` itself; Andrew adds the real values there (§F2).
```bash
# ------------------------------------------------------------------------------
# Phone / browser notifications (Phase 33 / 33.0.1)
# ------------------------------------------------------------------------------
# Firebase Cloud Messaging is used when ALL of these exist, otherwise ShiftBoard's own Web Push:
#   .secrets/firebase_service_account.json   (Firebase console > Project settings > Service accounts > Generate new private key)
#   FIREBASE_VAPID_KEY below                 (Project settings > Cloud Messaging > Web Push certificates > Key pair)
#   messagingSenderId + appId in .secrets/firebase-web-config.js
FIREBASE_VAPID_KEY=
# Optional: pin ShiftBoard's own Web Push key (PEM or base64url). Blank = generated once and kept in the database.
VAPID_PRIVATE_KEY=
# Optional: contact for push services, e.g. mailto:you@yourdomain.com (blank = APP_BASE_URL when it's https)
VAPID_SUBJECT=
```

---

## A6. `.gitignore` (EDIT)
**Find:**
```text
*.pem
*.key
```
**Replace with:**
```text
*.pem
*.key
# Phase 33.0.1: Firebase service-account keys, wherever they get saved
*service_account*.json
*firebase-adminsdk*.json
```

---

# PART B: Backend

## B1. `backend/src/services/notify_events.py` (EDITS)
**The gap:** `_run()` calls `deliver_soon()` after its commit. Also uses `team_name()`.

**Edit 1.** Find:
```python
    Shift, ShiftEvent, ShiftRequest, ShiftTransfer, User, Venue, VenueManager, VenueLocation, ShiftOffer,
)
from src.services.notify import notify_in
from src.services.team import _team_filter

```
Replace with:
```python
    Shift, ShiftEvent, ShiftRequest, ShiftTransfer, User, Venue, VenueManager, VenueLocation, ShiftOffer,
)
from src.services.notify import notify_in, deliver_soon
from src.services.messaging import team_name                    # Phase 33.0.1
from src.services.team import _team_filter

```

**Edit 2.** Find:
```python
            await fn(db, *args)
            await db.commit()
    except Exception:
        logger.exception(f"notification hook '{label}' failed")
```
Replace with:
```python
            await fn(db, *args)
            await db.commit()
        deliver_soon()       # Phase 33.0.1: push / email / text go out now, not at the next minute tick
    except Exception:
        logger.exception(f"notification hook '{label}' failed")
```

**Edit 3.** Find:
```python
    await notify_in(
        db, [worker_id], "team_added",
        f"You're on the {venue.name} team",
        f"A manager at {venue.name} added you to their team. You'll see their shifts first and get alerts when they post new ones.",
        "/worker", venue_id=venue_id, dedupe_key=f"team-added:{venue_id}:{worker_id}:{datetime.now(timezone.utc).date()}",
```
Replace with:
```python
    await notify_in(
        db, [worker_id], "team_added",
        f"You're on the {team_name(venue.name)} team",           # Phase 33.0.1: no "the The Hippodrome"
        f"A manager at {venue.name} added you to their team. You'll see their shifts first and get alerts when they post new ones.",
        "/worker", venue_id=venue_id, dedupe_key=f"team-added:{venue_id}:{worker_id}:{datetime.now(timezone.utc).date()}",
```

---

## B2. `backend/src/services/messaging.py` (EDIT)
New `team_name()`: "The Hippodrome" → "Hippodrome".

**Edit 1.** Find:
```python
def sms_available() -> bool:
    return (settings.SMS_PROVIDER or "off").lower() in ("twilio", "console")


```
Replace with:
```python
def sms_available() -> bool:
    return (settings.SMS_PROVIDER or "off").lower() in ("twilio", "console")


def team_name(name: str) -> str:
    """Phase 33.0.1: "The Hippodrome" -> "Hippodrome", so "the {team_name} team" never reads "the The ..."."""
    name = (name or "").strip()
    return name[4:] if name.lower().startswith("the ") and len(name) > 4 else name


```

---

## B3. `backend/src/services/invites.py` (EDITS)

**Edit 1.** Find:
```python
from src.services.messaging import (
    absolute_link, email_available, sms_available, send_email, send_sms, render_email, normalize_phone,
)

```
Replace with:
```python
from src.services.messaging import (
    absolute_link, email_available, sms_available, send_email, send_sms, render_email, normalize_phone,
    team_name,                                                    # Phase 33.0.1
)

```

**Edit 2.** Find:
```python
    hello = f"Hi {first}, " if first else ""
    title = f"Join {venue.name} on ShiftBoard"
    body = (f"{hello}{inviter_name} invited you to join the {venue.name} team on ShiftBoard. "
            "You'll see their open shifts, can book them and get reminders.\n\n"
            "Tap the button to create your account (or sign in) and join. The link works for 14 days.")
```
Replace with:
```python
    hello = f"Hi {first}, " if first else ""
    title = f"Join {venue.name} on ShiftBoard"
    body = (f"{hello}{inviter_name} invited you to join the {team_name(venue.name)} team on ShiftBoard. "
            "You'll see their open shifts, can book them and get reminders.\n\n"
            "Tap the button to create your account (or sign in) and join. The link works for 14 days.")
```

---

## B4. NEW FILE `backend/src/services/fcm.py`
Firebase Cloud Messaging with the existing `firebase-admin`. Its own named app (`shiftboard-messaging`), so it never touches sign-in.

```python
"""
Phase 33.0.1: Firebase Cloud Messaging (FCM) for phone / browser notifications.

Used when all of these are in place (otherwise ShiftBoard keeps using its own Web Push, services/webpush.py):
  * the service-account key file   .secrets/firebase_service_account.json   (FIREBASE_CREDENTIALS_PATH)
  * FIREBASE_VAPID_KEY in .secrets/.secrets.env  (Firebase console -> Project settings -> Cloud Messaging ->
    Web Push certificates -> the "Key pair" value)
  * messagingSenderId and appId in .secrets/firebase-web-config.js (already there when sign-in with Firebase works)

Messages are DATA-only, so ShiftBoard's own service worker (public/sw.js) shows them exactly like Web Push ones.
Every function here returns results and never raises.
"""
import logging
import os
from typing import Dict, List, Optional, Tuple

from src.config import settings

logger = logging.getLogger("shiftboard.fcm")

APP_NAME = "shiftboard-messaging"
TTL_SECONDS = 24 * 3600
_state: Dict[str, object] = {"app": None, "error": None, "path": None}


def vapid_key() -> str:
    return (os.getenv("FIREBASE_VAPID_KEY") or "").strip()


def web_config() -> Optional[Dict[str, str]]:
    try:
        from src.services.firebase import load_firebase_web_config
        return load_firebase_web_config()
    except Exception:
        return None


def missing() -> List[str]:
    """What's still needed before Firebase can send (empty list = ready to try)."""
    out = []
    if not os.path.isfile(settings.FIREBASE_CREDENTIALS_PATH):
        out.append("service account key (.secrets/firebase_service_account.json)")
    if not vapid_key():
        out.append("FIREBASE_VAPID_KEY in .secrets/.secrets.env")
    cfg = web_config() or {}
    if not cfg.get("messagingSenderId") or not cfg.get("appId"):
        out.append("messagingSenderId and appId in .secrets/firebase-web-config.js")
    return out


def _app():
    """The firebase_admin app used for messaging, or None (the reason is kept in _state['error'])."""
    path = settings.FIREBASE_CREDENTIALS_PATH
    if _state["app"] is not None and _state["path"] == path:
        return _state["app"]
    try:
        import firebase_admin
        from firebase_admin import credentials
        try:
            app = firebase_admin.get_app(APP_NAME)
        except ValueError:
            app = firebase_admin.initialize_app(credentials.Certificate(path), name=APP_NAME)
        _state.update(app=app, error=None, path=path)
        return app
    except Exception as e:
        _state.update(app=None, error=f"Firebase couldn't start: {e}", path=path)
        logger.warning(_state["error"])
        return None


def ready() -> bool:
    return not missing() and _app() is not None


def status() -> Dict[str, object]:
    """For Admin -> System."""
    need = missing()
    ok = not need and _app() is not None
    return {"ready": ok, "missing": need, "error": None if ok or need else _state["error"]}


def client_config() -> Optional[Dict[str, object]]:
    """What the browser needs to get a Firebase token: the web config and the Web Push certificate key."""
    if not ready():
        return None
    return {"config": web_config(), "vapid_key": vapid_key()}


def _is_gone(exc) -> bool:
    """The token will never work again (app uninstalled, notifications revoked, wrong project)."""
    try:
        from firebase_admin import messaging
        if isinstance(exc, (messaging.UnregisteredError, messaging.SenderIdMismatchError)):
            return True
    except Exception:
        pass
    code = str(getattr(exc, "code", "") or "").upper()
    return code in ("NOT_FOUND", "UNREGISTERED") or "registration-token-not-registered" in str(exc)


async def send(tokens: List[str], data: Dict[str, str], urgent: bool = False) -> List[Tuple[str, bool, bool, Optional[str]]]:
    """Sends one data message to each token. Returns [(token, ok, gone, error)]."""
    if not tokens:
        return []
    app = _app()
    if app is None or missing():
        err = "Firebase messaging isn't set up" + (f": {', '.join(missing())}" if missing() else "")
        return [(t, False, False, err) for t in tokens]
    try:
        from firebase_admin import messaging
        payload = {k: str(v) for k, v in data.items() if v is not None}     # FCM data values must be strings
        webpush = messaging.WebpushConfig(headers={"Urgency": "high" if urgent else "normal", "TTL": str(TTL_SECONDS)})
        messages = [messaging.Message(token=t, data=payload, webpush=webpush) for t in tokens]
        batch = await messaging.send_each_async(messages, app=app)
    except Exception as e:
        return [(t, False, False, f"Firebase: {e}") for t in tokens]
    out = []
    for token, resp in zip(tokens, batch.responses):
        if resp.success:
            out.append((token, True, False, None))
        else:
            out.append((token, False, _is_gone(resp.exception), f"Firebase: {resp.exception}"))
    return out
```

---

## B5. `backend/src/services/webpush.py` (FULL FILE REPLACEMENT)
Same key handling. Sending is now `pywebpush.webpush_async`, and `send_to_user()` sends each device through its own route. `encrypt()` / `vapid_headers()` are gone (nothing else used them).

```python
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
```

---

## B6. `backend/src/routers/notifications.py` (EDITS)
`GET /api/notifications/push` says which route to use. `POST /api/notifications/push/subscribe` accepts `{provider:"fcm", token}` (400 until Firebase is set up) as well as the Web Push body.

**Edit 1.** Find:
```python
from src.services.messaging import email_available, sms_available, normalize_phone
from src.services import webpush                                       # Phase 33

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])
```
Replace with:
```python
from src.services.messaging import email_available, sms_available, normalize_phone
from src.services import webpush                                       # Phase 33
from src.services import fcm                                           # Phase 33.0.1

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])
```

**Edit 2.** Find:
```python
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
```
Replace with:
```python
        select(PushSubscription).where(PushSubscription.user_id == user.id).order_by(PushSubscription.created_at.asc())
    )).scalars().all()
    client = fcm.client_config()                                             # Phase 33.0.1
    return PushConfigResponse(
        public_key=public_b64,
        devices=[PushDevice(id=s.id, provider=s.provider or "webpush", device_label=s.device_label, created_at=s.created_at,
                            last_success_at=s.last_success_at, last_error=s.last_error) for s in subs],
        provider="fcm" if client else "webpush",
        fcm_vapid_key=client["vapid_key"] if client else None,
        fcm_config=client["config"] if client else None,
    )


def _check_subscription(body: PushSubscribeBody) -> dict:
    """Validates the body and returns the row values (endpoint, p256dh, auth, provider). Raises 400."""
    if body.provider == "fcm":                                                # Phase 33.0.1
        token = (body.token or "").strip()
        if not fcm.ready():
            raise HTTPException(status_code=400, detail="Firebase messaging isn't set up on this server.")
        if len(token) < 20 or any(c.isspace() for c in token):
            raise HTTPException(status_code=400, detail="That device token isn't valid.")
        return dict(endpoint=token, p256dh=None, auth=None, provider="fcm")
    if body.provider != "webpush":
        raise HTTPException(status_code=400, detail="Unknown push provider.")
    if not body.endpoint or not body.endpoint.startswith("https://") or body.keys is None:
        raise HTTPException(status_code=400, detail="That push address isn't valid.")
    try:
```

**Edit 3.** Find:
```python
    if len(key) != 65 or key[0] != 4 or len(secret) != 16:
        raise HTTPException(status_code=400, detail="That device's keys aren't valid.")


```
Replace with:
```python
    if len(key) != 65 or key[0] != 4 or len(secret) != 16:
        raise HTTPException(status_code=400, detail="That device's keys aren't valid.")
    return dict(endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth, provider="webpush")


```

**Edit 4.** Find:
```python
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
```
Replace with:
```python
):
    """Turn on notifications for this device. The same device signing in as someone else moves to them."""
    row = _check_subscription(body)
    label = (body.device_label or "").strip()[:120] or None
    try:
        await db.execute(
            pg_insert(PushSubscription)
            .values(user_id=current_user.id, device_label=label, created_at=datetime.now(timezone.utc), **row)
            .on_conflict_do_update(
                index_elements=["endpoint"],
                set_=dict(user_id=current_user.id, p256dh=row["p256dh"], auth=row["auth"], provider=row["provider"],
                          device_label=label, last_error=None),
            )
        )
```

---

## B7. `backend/src/routers/admin_console.py` (EDITS)

**Edit 1.** Find:
```python
    User, Venue, VenueManager, VenueWhitelist, VenuePosition, VenueLocation, Shift, ShiftEvent, ShiftRequest,
    ShiftTransfer, TimeEntry, VenueActivity, AdminAudit, Notification, NotificationDelivery, NotificationPreference,
)
from src.schemas import (
```
Replace with:
```python
    User, Venue, VenueManager, VenueWhitelist, VenuePosition, VenueLocation, Shift, ShiftEvent, ShiftRequest,
    ShiftTransfer, TimeEntry, VenueActivity, AdminAudit, Notification, NotificationDelivery, NotificationPreference,
    PushSubscription,
)
from src.schemas import (
```

**Edit 2.** Find:
```python
        heartbeat = None

    counts = {}
    for label, model in (
```
Replace with:
```python
        heartbeat = None

    from src.services import fcm                    # Phase 33.0.1
    push_status = fcm.status()

    counts = {}
    for label, model in (
```

**Edit 3.** Find:
```python
        email_provider=(settings.EMAIL_PROVIDER or "console").lower(), email_from=settings.EMAIL_FROM or "",
        email_ready=email_available(), sms_provider=(settings.SMS_PROVIDER or "off").lower(), sms_ready=sms_available(),
        firebase=firebase, self_registration=bool(settings.ALLOW_SELF_REGISTRATION),
        always_admin_count=len(get_always_admin_emails()),
```
Replace with:
```python
        email_provider=(settings.EMAIL_PROVIDER or "console").lower(), email_from=settings.EMAIL_FROM or "",
        email_ready=email_available(), sms_provider=(settings.SMS_PROVIDER or "off").lower(), sms_ready=sms_available(),
        push_route="fcm" if push_status["ready"] else "webpush",                          # Phase 33.0.1
        push_firebase_missing=push_status["missing"], push_firebase_error=push_status["error"],
        push_devices=int(await db.scalar(select(func.count()).select_from(PushSubscription)) or 0),
        firebase=firebase, self_registration=bool(settings.ALLOW_SELF_REGISTRATION),
        always_admin_count=len(get_always_admin_emails()),
```

---

# PART C: Frontend

## C1. `frontend/src/utils/push.js` (EDITS)
Firebase path: `getToken(messaging, { vapidKey, serviceWorkerRegistration })` on ShiftBoard's own `sw.js`. It removes a Web Push subscription first if one exists. Sync follows the server's route, and sign-out also deletes the Firebase token.

**Edit 1.** Find:
```js
import api from '../api/client';

/**
 * Phase 33: the installed app (PWA) and Web Push on THIS device.
 * Nothing here throws at import time; every helper is safe on browsers without push.
 */

export const isStandalone = () =>
```
Replace with:
```js
import { initializeApp, getApp } from 'firebase/app';
import { getMessaging, getToken, deleteToken, isSupported as messagingSupported } from 'firebase/messaging';
import api from '../api/client';

/**
 * Phase 33: the installed app (PWA) and Web Push on THIS device.
 * Phase 33.0.1: when the server has Firebase messaging set up (GET /notifications/push -> provider 'fcm'),
 * devices register a Firebase token instead; otherwise ShiftBoard's own Web Push is used. Either way the
 * messages land in public/sw.js.
 * Nothing here throws at import time; every helper is safe on browsers without push.
 */
const FCM_APP = 'shiftboard-messaging';
const FCM_TOKEN_KEY = 'shiftboard_fcm_token';

function fcmApp(config) {
  try {
    return getApp(FCM_APP);
  } catch (e) {
    return initializeApp(config, FCM_APP);
  }
}

function storedToken() {
  try { return localStorage.getItem(FCM_TOKEN_KEY); } catch (e) { return null; }
}

function storeToken(token) {
  try {
    if (token) localStorage.setItem(FCM_TOKEN_KEY, token);
    else localStorage.removeItem(FCM_TOKEN_KEY);
  } catch (e) { /* private mode */ }
}

export const isStandalone = () =>
```

**Edit 2.** Find:
```js
  const json = sub.toJSON();
  const res = await api.post('/notifications/push/subscribe', {
    endpoint: json.endpoint,
    keys: json.keys,
    device_label: deviceLabel(),
  });
  return res.data;   // { public_key, devices }
}

```
Replace with:
```js
  const json = sub.toJSON();
  const res = await api.post('/notifications/push/subscribe', {
    provider: 'webpush',
    endpoint: json.endpoint,
    keys: json.keys,
    device_label: deviceLabel(),
  });
  return res.data;   // { public_key, devices, provider, ... }
}

/** Phase 33.0.1: register this device with Firebase. Falls back to Web Push if this browser can't use Firebase messaging. */
async function subscribeFcm(reg, cfg) {
  if (!(await messagingSupported().catch(() => false))) {
    return saveSubscription(await subscribeFresh(reg, cfg.public_key));
  }
  // A subscription made with ShiftBoard's own key would block Firebase's: remove it first.
  const existing = await reg.pushManager.getSubscription();
  if (existing && !sameKey(existing, cfg.fcm_vapid_key)) {
    await api.post('/notifications/push/unsubscribe', { endpoint: existing.endpoint }).catch(() => {});
    await existing.unsubscribe().catch(() => {});
  }
  const token = await getToken(getMessaging(fcmApp(cfg.fcm_config)), {
    vapidKey: cfg.fcm_vapid_key,
    serviceWorkerRegistration: reg,
  });
  if (!token) throw new Error("Firebase didn't return a token for this device.");
  const old = storedToken();
  if (old && old !== token) await api.post('/notifications/push/unsubscribe', { endpoint: old }).catch(() => {});
  const res = await api.post('/notifications/push/subscribe', { provider: 'fcm', token, device_label: deviceLabel() });
  storeToken(token);
  return res.data;
}

```

**Edit 3.** Find:
```js
  if (!reg) throw new Error("Notifications need the secure (https) address of ShiftBoard.");
  const { data } = await api.get('/notifications/push');
  const sub = await subscribeFresh(reg, data.public_key);
  return saveSubscription(sub);
```
Replace with:
```js
  if (!reg) throw new Error("Notifications need the secure (https) address of ShiftBoard.");
  const { data } = await api.get('/notifications/push');
  if (data.provider === 'fcm') return subscribeFcm(reg, data);          // Phase 33.0.1
  const sub = await subscribeFresh(reg, data.public_key);
  return saveSubscription(sub);
```

**Edit 4.** Find:
```js
export async function disablePush() {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
```
Replace with:
```js
export async function disablePush() {
  try {
    const token = storedToken();                                          // Phase 33.0.1: Firebase device
    if (token) {
      await api.post('/notifications/push/unsubscribe', { endpoint: token }).catch(() => {});
      try {
        await deleteToken(getMessaging(getApp(FCM_APP)));
      } catch (e) { /* app not started on this page load: unsubscribing below is enough */ }
      storeToken(null);
    }
    const sub = await currentSubscription();
    if (!sub) return;
```

**Edit 5.** Find:
```js
    if (!existing) return;                       // they never turned it on here (or turned it off)
    const { data } = await api.get('/notifications/push');
    await saveSubscription(await subscribeFresh(reg, data.public_key));
  } catch (e) {
    /* best effort */
```
Replace with:
```js
    if (!existing) return;                       // they never turned it on here (or turned it off)
    const { data } = await api.get('/notifications/push');
    // Phase 33.0.1: follows the server's route, so devices move to Firebase once it's set up (and back if it's removed)
    if (data.provider === 'fcm') {
      await subscribeFcm(reg, data);
    } else {
      if (storedToken()) {
        await api.post('/notifications/push/unsubscribe', { endpoint: storedToken() }).catch(() => {});
        storeToken(null);
      }
      await saveSubscription(await subscribeFresh(reg, data.public_key));
    }
  } catch (e) {
    /* best effort */
```

---

## C2. `frontend/public/sw.js` (EDITS)
Reads Firebase's `{ data: {...} }` wrapper as well as ShiftBoard's own messages. `urgent` may arrive as the string `"true"`.

**Edit 1.** Find:
```js
 */
const CACHE = 'shiftboard-shell-v1';
const OFFLINE_URL = '/offline.html';

```
Replace with:
```js
 */
const CACHE = 'shiftboard-shell-v1';
// Phase 33.0.1: messages arrive either straight from ShiftBoard (Web Push) or through Firebase Cloud Messaging.
const OFFLINE_URL = '/offline.html';

```

**Edit 2.** Find:
```js

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
```
Replace with:
```js

self.addEventListener('push', (event) => {
  let raw = {};
  try {
    raw = event.data ? event.data.json() : {};
  } catch (e) {
    raw = { title: 'ShiftBoard', body: event.data ? event.data.text() : '' };
  }
  // Firebase wraps our fields: { data: { title, body, url, tag, urgent: "true" }, from, fcmMessageId, ... }
  const data = raw && raw.data && typeof raw.data === 'object' && !raw.title ? raw.data : raw;
  const urgent = data.urgent === true || data.urgent === 'true';
  event.waitUntil(
    self.registration.showNotification(data.title || 'ShiftBoard', {
```

---

## C3. `frontend/src/components/PushDeviceCard.jsx` (EDIT)

**Edit 1.** Find:
```jsx
              <Smartphone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {d.device_label || 'Device'} <span className="text-slate-500">· added {fmtDay(d.created_at)}</span>
                {d.last_error && <span className="text-amber-300"> · last try failed</span>}
              </span>
```
Replace with:
```jsx
              <Smartphone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {d.device_label || 'Device'} <span className="text-slate-500">· added {fmtDay(d.created_at)}{d.provider === 'fcm' ? ' · via Firebase' : ''}</span>
                {d.last_error && <span className="text-amber-300"> · last try failed</span>}
              </span>
```

---

## C4. `frontend/src/components/admin/AdminSystem.jsx` (EDIT)
The **Phone notifications** row.

**Edit 1.** Find:
```jsx
                ? 'Console mode: texts are only written to the backend log.'
                : sys.sms_ready ? `Sending with ${sys.sms_provider}` : `Not sending (provider "${sys.sms_provider}"). People only get emails and in-app notifications.`}
            </Row>
            <Row state={sys.firebase === 'real' ? 'ok' : 'warn'} label="Google / Firebase sign-in">
```
Replace with:
```jsx
                ? 'Console mode: texts are only written to the backend log.'
                : sys.sms_ready ? `Sending with ${sys.sms_provider}` : `Not sending (provider "${sys.sms_provider}"). People only get emails and in-app notifications.`}
            </Row>
            {/* Phase 33.0.1: which route phone / browser notifications take */}
            <Row state={sys.push_route === 'fcm' ? 'ok' : 'warn'} label="Phone notifications">
              {sys.push_route === 'fcm'
                ? `Sending through Firebase Cloud Messaging · ${sys.push_devices} device${sys.push_devices === 1 ? '' : 's'} turned on.`
                : `Sending with ShiftBoard's own Web Push (works without Firebase) · ${sys.push_devices} device${sys.push_devices === 1 ? '' : 's'} turned on.`}
              {sys.push_route !== 'fcm' && (sys.push_firebase_missing || []).length > 0 && (
                <span className="block text-slate-500">To use Firebase, add: {sys.push_firebase_missing.join('; ')}.</span>
              )}
              {sys.push_firebase_error && <span className="block text-amber-300">{sys.push_firebase_error}</span>}
            </Row>
            <Row state={sys.firebase === 'real' ? 'ok' : 'warn'} label="Google / Firebase sign-in">
```

---

# PART D: Cleanup

## D3. DELETE `frontend/src/components/manager/TimeOffCard.jsx`
Left over from 32.1. Nothing imports it. Check with a search for `TimeOffCard`: the only hit should be the file itself.

Delete it with `git rm frontend/src/components/manager/TimeOffCard.jsx`, or your file tools. **If your tools can't delete files, stop and tell Andrew** so he can delete it himself. Don't empty it or leave a stub.

---

## F. Rebuild, Firebase setup & verification

### F1. Rebuild (schema + requirements changed). Choose ONE:
* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data** (safe to run twice):
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS provider VARCHAR(10) NOT NULL DEFAULT 'webpush';
ALTER TABLE push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE push_subscriptions ALTER COLUMN auth DROP NOT NULL;
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ.) `--build` matters: the backend image must install `pywebpush`.

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

### F2. Turn on Firebase Cloud Messaging (you, in the Firebase console, about 5 minutes)
Until this is done, push keeps working through Web Push, so this can wait.
1. **Service account key:**
   * Firebase console → ⚙ **Project settings** → **Service accounts** → **Generate new private key**.
   * Save the file as **`.secrets/firebase_service_account.json`** (git already ignores it).
2. **Web Push certificate:**
   * **Project settings** → **Cloud Messaging** → **Web configuration** → **Web Push certificates** → **Generate key pair**.
   * Copy the **Key pair** value into `.secrets/.secrets.env` as `FIREBASE_VAPID_KEY=<that value>`.
3. On the same **Cloud Messaging** tab, **Firebase Cloud Messaging API (V1)** must say *Enabled*. If it doesn't, click ⋮ → *Manage API in Google Cloud Console* → **Enable**.
4. `.secrets/firebase-web-config.js` must include `messagingSenderId` and `appId`. The full snippet from Project settings → Your apps has both.
5. **If you restricted your web API key** in Google Cloud Console → Credentials, also allow **Firebase Installations API** and **Firebase Cloud Messaging API**.
6. Restart the backend: `docker compose restart backend`.

### Checklist
1. **Instant:**
   * Approve a worker's request (or add them to your team).
   * Their phone gets the notification within **a few seconds**, not up to a minute later.
   * Their email arrives right away too (if email is set up).
2. **Wording:** adding someone to "The Hippodrome" says **"You're on the Hippodrome team"**, and so does the invite email.
3. **Before Firebase:** Admin → System → **Phone notifications** says *"Sending with ShiftBoard's own Web Push"* and lists what Firebase still needs. Turning on and testing a device works as in Phase 33.
4. **After F2:**
   * Admin → System says **"Sending through Firebase Cloud Messaging"**.
   * Open the app on a phone that already had notifications on: it moves to Firebase by itself, and Settings → devices shows **"· via Firebase"**.
   * **Send a test** still arrives, and tapping it opens ShiftBoard.
5. Remove `FIREBASE_VAPID_KEY` and restart the backend: System shows Web Push again, and devices move back the next time the app opens.
6. `frontend/src/components/manager/TimeOffCard.jsx` no longer exists.