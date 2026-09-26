# Phase 28: Notifications (bell, email, text messages, reminders)

**Why:** today, posts, approvals, edits, cancellations and late arrivals reach no one unless they happen to open the site. This was the #1 blocker in the venue-readiness review. Service workers live on their phones.

## What this phase adds

1. **Bell in the navbar** on every page, for every role.
   - Shows an unread count (checked every minute and whenever the tab comes back into focus).
   - Shows the latest 30 notifications. Clicking one marks it read and opens the exact screen it's about:
     - a worker's Shift Details
     - an event popout
     - the manager's event roster, switching venue if needed
   - Includes **Mark all read** and a ⚙ button for **Notification settings**.
2. **Email** through `console` (logged only, the default), `smtp` or `resend`.
   **Text messages** through Twilio, behind `SMS_PROVIDER` (default `off`).
   - Only **urgent** notifications are ever texted:
     - cancellations and removals
     - changes within 48 h of the shift
     - 2-hour reminders
     - missed clock-ins
     - "Send me a test"
3. **Worker triggers:**

   | What happened | Notification | Urgent (text) |
   |---|---|---|
   | Request approved / denied | ✅ / ❌ with reason | no |
   | Event or position edited, staff-only notes added, location edited globally | "Updated: …" + the 26.2 change text + "tap Got it" | yes if the shift starts within 48 h |
   | Shifts cancelled (event or position) | "Cancelled: …" with reason | yes |
   | Removed from a shift | "Removed from …" with reason | yes |
   | Hand-off offered to you; accepted / declined / withdrawn / approved / denied | to whichever worker needs to know | no |
   | 24 h before a booked shift | "Tomorrow: …" (+ "you haven't read the latest info" when needs_ack) | no |
   | 2 h before | "Starts soon: …" | yes |
   | 10 min after start, not clocked in | "You haven't clocked in" | yes |
   | New event posted at a venue where you're on the team | "New shifts: …" (instant, daily digest, or off) | no |

   - Booking at the last minute skips the reminder you'd otherwise get (you just booked; you know).
   - Instant bookings produce no manager "request waiting" ping.
4. **Manager triggers:**
   - **new request waiting** (only when it needs approval)
   - **hand-off waiting for approval**
   - **"N people haven't read the update"**: once per update, for shifts starting within 24 h
   - **"<name> hasn't clocked in"**: 10 min after start (urgent)
5. **Per-user settings:**
   - email on/off; mobile number + texts on/off
   - reminders on/off
   - new-shift alerts: **once a day** (default), **right away**, or **off**
   - manager alerts by email (managers only)
   - **quiet hours** and timezone. Non-urgent email and texts wait until quiet hours end; urgent ones still go.
6. **Daily digest:**
   - New-shift alerts set to "once a day" collect into one email at `NOTIFICATIONS_DIGEST_HOUR` (default 9 AM), in each person's timezone.
   - Anything the person already opened in the app is left out of later emails.
7. **Background worker** (inside the backend, every 60 s, one process at a time via a Redis lock):
   - reminders, late alerts, unread-update alerts
   - email/text delivery, with 5 retries and 5-minute backoff
   - the Phase 27 **auto clock-out** sweep, which now runs even when nobody opens a screen
8. **Links in emails** use `APP_BASE_URL`.
   - The email footer's "Notification settings" link opens the settings modal (`?notifications=settings`).

⚠️ **Schema change** (3 new tables) and **new `.secrets` settings**: see §E.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`
  - `main.py` CORS logic (only add the import, lifespan-worker and `include_router` lines shown)
  - `frontend/src/context/AuthContext.jsx`
  - `frontend/src/api/client.js`
  - `frontend/vite.config.js`
* No native PostgreSQL ENUMs. All new status/kind columns are VARCHAR:
  - `notifications.kind`: `request_approved` | `request_denied` | `shift_updated` | `shift_cancelled` | `removed` | `transfer_offered` | `transfer_update` | `reminder_24h` | `reminder_2h` | `not_clocked_in` | `new_shift` | `request_pending` | `swap_pending` | `unread_update` | `late_worker` | `test`
  - `notification_deliveries.channel`: `email` | `sms`
  - `notification_deliveries.status`: `pending` | `sent` | `failed` | `skipped`
  - `notification_preferences.new_shift_alerts`: `off` | `instant` | `daily`
* Aware UTC datetimes only (`datetime.now(timezone.utc)`).
* **Notifications never break the main action.**
  - Every `notify_events.*` call sits **after** the endpoint's `await db.commit()`, opens its own session, and swallows its own errors.
  - Do not move these calls inside the main `try` blocks.
  - Do not make them raise.
* Duplicate protection is done by `dedupe_key` (UNIQUE) with `INSERT … ON CONFLICT DO NOTHING`. Keep the `rem24:` / `rem2:` / `late-w:` / `late-m:` / `unread:` / `new_shift:` key formats exactly.
* Never read or print real secret values. Only edit `.secrets/.secrets.env.template`.
* **NEW FILE**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* block appears **exactly once** in the current file; apply them in order.
  - Some Python files use Windows line endings (CRLF). Match on the text, and keep the file's existing line endings.
* These blocks were generated from the real current (Phase 27) files and checked:
  - after applying them, the backend imports cleanly and all 90 API routes build
  - the frontend bundles with no missing imports
  - the notification flows pass integration tests against PostgreSQL 16

  Don't "improve" them.

---

# PART A: Database, models, settings

## A1. `database/init.sql` (EDITS)
Add the three new tables at the end of the Phase 26.2 message-board block.

**Edit 1.** Find:
```sql
CREATE INDEX idx_shift_board_messages_author ON shift_board_messages(author_id);

```
Replace with:
```sql
CREATE INDEX idx_shift_board_messages_author ON shift_board_messages(author_id);

-- ==============================================================================
-- Phase 28: Notifications (in-app bell + email/SMS outbox + per-user preferences)
-- ==============================================================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(40) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT,
    link VARCHAR(300),
    venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
    event_id UUID REFERENCES shift_events(id) ON DELETE CASCADE,
    request_id UUID REFERENCES shift_requests(id) ON DELETE CASCADE,
    urgent BOOLEAN NOT NULL DEFAULT FALSE,
    dedupe_key VARCHAR(200) UNIQUE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

CREATE TABLE notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL,                 -- email | sms
    status VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped
    digest BOOLEAN NOT NULL DEFAULT FALSE,
    send_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notification_deliveries_due ON notification_deliveries(status, send_after);

CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    new_shift_alerts VARCHAR(10) NOT NULL DEFAULT 'daily',   -- off | instant | daily
    manager_alerts_email BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_start SMALLINT,                                     -- hour 0-23, NULL = no quiet hours
    quiet_end SMALLINT,
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

```

---

## A2. `backend/src/models.py` (EDITS)
Three new models, inserted right before `class ShiftTransfer`.

**Edit 1.** Find:
```python
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class ShiftTransfer(Base):
    __tablename__ = "shift_transfers"
```
Replace with:
```python
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class Notification(Base):
    """Phase 28: one message for one user (shown in the bell; may also go out by email / SMS)."""
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(40), nullable=False)
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    link = Column(String(300), nullable=True)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("shift_events.id", ondelete="CASCADE"), nullable=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="CASCADE"), nullable=True)
    urgent = Column(Boolean, nullable=False, default=False)
    dedupe_key = Column(String(200), nullable=True, unique=True)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class NotificationDelivery(Base):
    """Phase 28: outbox row for one channel (email / sms) of one notification."""
    __tablename__ = "notification_deliveries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notification_id = Column(UUID(as_uuid=True), ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    channel = Column(String(10), nullable=False)                     # email | sms
    status = Column(String(12), nullable=False, default="pending")   # pending | sent | failed | skipped
    digest = Column(Boolean, nullable=False, default=False)
    send_after = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class NotificationPreference(Base):
    """Phase 28: what a user wants sent where. No row = defaults."""
    __tablename__ = "notification_preferences"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    email_enabled = Column(Boolean, nullable=False, default=True)
    sms_enabled = Column(Boolean, nullable=False, default=False)
    reminders_enabled = Column(Boolean, nullable=False, default=True)
    new_shift_alerts = Column(String(10), nullable=False, default="daily")   # off | instant | daily
    manager_alerts_email = Column(Boolean, nullable=False, default=True)
    quiet_start = Column(Integer, nullable=True)                             # hour 0-23
    quiet_end = Column(Integer, nullable=True)
    timezone = Column(String(64), nullable=False, default="America/New_York")
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class ShiftTransfer(Base):
    __tablename__ = "shift_transfers"
```

---

## A3. `backend/src/schemas.py` (EDITS: append)

**Edit 1.** Find:
```python
    info_seen_at: datetime



```
Replace with:
```python
    info_seen_at: datetime





# ------------------------------------------------------------------------------
# Phase 28: Notifications
# ------------------------------------------------------------------------------
class NotificationResponse(BaseModel):
    id: UUID
    kind: str
    title: str
    body: Optional[str] = None
    link: Optional[str] = None
    urgent: bool = False
    read: bool = False
    created_at: datetime


class UnreadCountResponse(BaseModel):
    count: int


class NotificationPreferencesResponse(BaseModel):
    email_enabled: bool = True
    sms_enabled: bool = False
    reminders_enabled: bool = True
    new_shift_alerts: str = "daily"          # off | instant | daily
    manager_alerts_email: bool = True
    quiet_start: Optional[int] = None        # hour 0-23
    quiet_end: Optional[int] = None
    timezone: str = "America/New_York"
    email: Optional[str] = None              # the account email (read-only here)
    phone: Optional[str] = None              # users.phone (texts go here)
    email_available: bool = True             # server can send email (not console-only)
    sms_available: bool = False              # server has SMS configured
    is_manager: bool = False                 # show manager-only options


class NotificationPreferencesUpdate(BaseModel):
    email_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
    reminders_enabled: Optional[bool] = None
    new_shift_alerts: Optional[str] = None
    manager_alerts_email: Optional[bool] = None
    quiet_start: Optional[int] = None
    quiet_end: Optional[int] = None
    clear_quiet_hours: bool = False
    timezone: Optional[str] = None
    phone: Optional[str] = None              # saved to users.phone; "" clears it
```

---

## A4. `backend/src/config.py` (EDITS)

**Edit 1.** Find:
```python
    DEFAULT_GEOFENCE_RADIUS_METERS: int = int(os.getenv("DEFAULT_GEOFENCE_RADIUS_METERS", "100"))

    @property
    def cors_origins_list(self) -> List[str]:
```
Replace with:
```python
    DEFAULT_GEOFENCE_RADIUS_METERS: int = int(os.getenv("DEFAULT_GEOFENCE_RADIUS_METERS", "100"))

    # Phase 28: Notifications
    APP_BASE_URL: str = os.getenv("APP_BASE_URL", "http://localhost:5173")   # used for links in emails / texts
    NOTIFICATIONS_WORKER_ENABLED: bool = os.getenv("NOTIFICATIONS_WORKER_ENABLED", "true").lower() in ("true", "1", "yes")
    NOTIFICATIONS_DIGEST_HOUR: int = int(os.getenv("NOTIFICATIONS_DIGEST_HOUR") or "9")   # local hour for daily new-shift emails
    EMAIL_PROVIDER: str = os.getenv("EMAIL_PROVIDER", "console")   # console | smtp | resend
    EMAIL_FROM: str = os.getenv("EMAIL_FROM", "ShiftBoard <no-reply@example.com>")
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT") or "587")
    SMTP_USERNAME: str = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_STARTTLS: bool = os.getenv("SMTP_STARTTLS", "true").lower() in ("true", "1", "yes")
    SMTP_SSL: bool = os.getenv("SMTP_SSL", "false").lower() in ("true", "1", "yes")
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
    SMS_PROVIDER: str = os.getenv("SMS_PROVIDER", "off")           # off | console | twilio
    TWILIO_ACCOUNT_SID: str = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_FROM_NUMBER: str = os.getenv("TWILIO_FROM_NUMBER", "")

    @property
    def cors_origins_list(self) -> List[str]:
```

---

# PART B: Backend

## B1. NEW FILE `backend/src/services/messaging.py`
Sends email (console / SMTP / Resend) and SMS (console / Twilio). Every sender returns `(ok, error)` and never raises. Uses `httpx` (already in `requirements.txt`) and the standard library only.

```python
"""
Phase 28: Outbound email and SMS.

EMAIL_PROVIDER: console (log only, the default) | smtp | resend
SMS_PROVIDER:   off (default) | console (log only) | twilio
No extra packages: SMTP uses the standard library (run in a thread), Resend and Twilio use httpx.
Every function returns (ok: bool, error: Optional[str]) and never raises.
"""
import asyncio
import html
import logging
import re
import smtplib
import ssl
from email.message import EmailMessage
from typing import Optional, Tuple

import httpx

from src.config import settings

logger = logging.getLogger("shiftboard.messaging")


def email_available() -> bool:
    return (settings.EMAIL_PROVIDER or "console").lower() in ("smtp", "resend")


def sms_available() -> bool:
    return (settings.SMS_PROVIDER or "off").lower() in ("twilio", "console")


def absolute_link(link: Optional[str]) -> str:
    base = (settings.APP_BASE_URL or "").rstrip("/")
    if not link:
        return base or "/"
    if link.startswith("http://") or link.startswith("https://"):
        return link
    return f"{base}{link if link.startswith('/') else '/' + link}"


def normalize_phone(raw: Optional[str]) -> Optional[str]:
    """Best-effort E.164. US/Canada 10-digit numbers get +1. Returns None if it can't be used."""
    if not raw:
        return None
    s = raw.strip()
    digits = re.sub(r"\D", "", s)
    if s.startswith("+") and 8 <= len(digits) <= 15:
        return "+" + digits
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return None


def render_email(title: str, body: Optional[str], link: Optional[str], footer_link: Optional[str] = None) -> Tuple[str, str]:
    """Returns (plain_text, html) for a single notification."""
    url = absolute_link(link)
    settings_url = absolute_link(footer_link or "/?notifications=settings")
    text = f"{title}\n\n{body or ''}\n\nOpen ShiftBoard: {url}\n\nChange what we send you: {settings_url}\n"
    html_body = f"""<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px;color:#0f172a">
  <h2 style="margin:0 0 8px;font-size:18px">{html.escape(title)}</h2>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.5;white-space:pre-line">{html.escape(body or '')}</p>
  <a href="{html.escape(url)}" style="display:inline-block;background:#10b981;color:#0f172a;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:10px;font-size:14px">Open ShiftBoard</a>
  <p style="margin:24px 0 0;font-size:12px;color:#64748b">You're getting this because of your ShiftBoard notification settings.
  <a href="{html.escape(settings_url)}" style="color:#64748b">Change what we send you</a>.</p>
</div>"""
    return text, html_body


def render_digest(items, footer_link: Optional[str] = None) -> Tuple[str, str, str]:
    """items: list of (title, body, link). Returns (subject, plain_text, html)."""
    n = len(items)
    subject = f"{n} new shift{'s' if n != 1 else ''} posted" if n else "New shifts posted"
    settings_url = absolute_link(footer_link or "/?notifications=settings")
    lines = [f"- {t}\n  {b or ''}\n  {absolute_link(l)}" for t, b, l in items]
    text = f"{subject}\n\n" + "\n\n".join(lines) + f"\n\nChange what we send you: {settings_url}\n"
    rows = "".join(
        f'<li style="margin:0 0 12px"><a href="{html.escape(absolute_link(l))}" style="color:#047857;font-weight:700;text-decoration:none">{html.escape(t)}</a>'
        f'<div style="font-size:13px;color:#334155">{html.escape(b or "")}</div></li>'
        for t, b, l in items
    )
    html_body = f"""<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px;color:#0f172a">
  <h2 style="margin:0 0 12px;font-size:18px">{html.escape(subject)}</h2>
  <ul style="padding-left:18px;margin:0">{rows}</ul>
  <p style="margin:24px 0 0;font-size:12px;color:#64748b"><a href="{html.escape(settings_url)}" style="color:#64748b">Change what we send you</a>.</p>
</div>"""
    return subject, text, html_body


def _smtp_send_blocking(to: str, subject: str, text: str, html_body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.EMAIL_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    if settings.SMTP_SSL:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=ssl.create_default_context(), timeout=20) as s:
            if settings.SMTP_USERNAME:
                s.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            s.send_message(msg)
    else:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as s:
            if settings.SMTP_STARTTLS:
                s.starttls(context=ssl.create_default_context())
            if settings.SMTP_USERNAME:
                s.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            s.send_message(msg)


async def send_email(to: str, subject: str, text: str, html_body: str) -> Tuple[bool, Optional[str]]:
    provider = (settings.EMAIL_PROVIDER or "console").lower()
    try:
        if provider == "smtp":
            if not settings.SMTP_HOST:
                return False, "SMTP_HOST is not set"
            await asyncio.to_thread(_smtp_send_blocking, to, subject, text, html_body)
            return True, None
        if provider == "resend":
            if not settings.RESEND_API_KEY:
                return False, "RESEND_API_KEY is not set"
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                    json={"from": settings.EMAIL_FROM, "to": [to], "subject": subject, "text": text, "html": html_body},
                )
            if r.status_code >= 300:
                return False, f"Resend {r.status_code}: {r.text[:300]}"
            return True, None
        logger.info(f"[email:console] to={to} subject={subject!r}\n{text}")
        return True, None
    except Exception as e:
        logger.warning(f"Email to {to} failed: {e}")
        return False, str(e)[:500]


async def send_sms(to_raw: str, text: str) -> Tuple[bool, Optional[str]]:
    provider = (settings.SMS_PROVIDER or "off").lower()
    to = normalize_phone(to_raw)
    if not to:
        return False, "Phone number isn't usable for texts"
    body = text if len(text) <= 320 else text[:317] + "..."
    try:
        if provider == "twilio":
            if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_FROM_NUMBER):
                return False, "Twilio settings are incomplete"
            url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(
                    url,
                    auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
                    data={"From": settings.TWILIO_FROM_NUMBER, "To": to, "Body": body},
                )
            if r.status_code >= 300:
                return False, f"Twilio {r.status_code}: {r.text[:300]}"
            return True, None
        if provider == "console":
            logger.info(f"[sms:console] to={to}: {body}")
            return True, None
        return False, "SMS is off"
    except Exception as e:
        logger.warning(f"SMS to {to} failed: {e}")
        return False, str(e)[:500]
```

---

## B2. NEW FILE `backend/src/services/notify.py`
The core: writes notifications + outbox rows, applies preferences / quiet hours / digest, and delivers.

```python
"""
Phase 28: Notification core.

notify()      writes in-app notifications (+ email/SMS outbox rows) in its OWN session and commits.
              Call it AFTER the main action has committed. It never raises.
notify_in()   same, but inside a session you already have (no commit). Used by notify_events / the worker.
deliver_pending() sends due email/SMS rows (called by the background worker every minute).

Channel rules
* In-app: always (except new-shift alerts when the user turned them off).
* Email:  preferences.email_enabled, plus the category switch:
            reminder -> reminders_enabled, manager -> manager_alerts_email,
            new_shift -> new_shift_alerts 'instant' (now) or 'daily' (one digest email at NOTIFICATIONS_DIGEST_HOUR).
* SMS:    only URGENT notifications of SMS-eligible kinds, only if sms_enabled, a usable phone and SMS configured.
* Quiet hours delay non-urgent email/SMS until quiet_end (user's timezone). Urgent ones go right away.
* If the user already read it in the app before a delayed email goes out, that email is skipped.
"""
import logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from typing import Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import AsyncSessionLocal
from src.models import Notification, NotificationDelivery, NotificationPreference, User
from src.auth import normalize_role
from src.services.messaging import (
    send_email, send_sms, render_email, render_digest, absolute_link, normalize_phone, sms_available,
)

logger = logging.getLogger("shiftboard.notify")

# kind -> (category, can go by SMS when urgent)
KINDS = {
    "request_approved": ("booking", False),
    "request_denied": ("booking", False),
    "shift_updated": ("booking", True),
    "shift_cancelled": ("booking", True),
    "removed": ("booking", True),
    "transfer_offered": ("booking", False),
    "transfer_update": ("booking", False),
    "reminder_24h": ("reminder", False),
    "reminder_2h": ("reminder", True),
    "not_clocked_in": ("reminder", True),
    "new_shift": ("new_shift", False),
    "request_pending": ("manager", False),
    "swap_pending": ("manager", False),
    "unread_update": ("manager", False),
    "late_worker": ("manager", True),
    "test": ("test", True),
}
NEW_SHIFT_MODES = ("off", "instant", "daily")
MAX_ATTEMPTS = 5

DEFAULT_PREFS = dict(
    email_enabled=True, sms_enabled=False, reminders_enabled=True, new_shift_alerts="daily",
    manager_alerts_email=True, quiet_start=None, quiet_end=None, timezone="America/New_York",
)


def _tz(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or "America/New_York")
    except Exception:
        return ZoneInfo("America/New_York")


async def load_prefs(db: AsyncSession, user_ids: Iterable) -> Dict:
    ids = list({u for u in user_ids if u})
    rows = {}
    if ids:
        rows = {p.user_id: p for p in (await db.execute(
            select(NotificationPreference).where(NotificationPreference.user_id.in_(ids))
        )).scalars().all()}
    return {uid: rows.get(uid) or SimpleNamespace(user_id=uid, **DEFAULT_PREFS) for uid in ids}


def in_quiet_hours(prefs, now: datetime) -> bool:
    qs, qe = prefs.quiet_start, prefs.quiet_end
    if qs is None or qe is None or qs == qe:
        return False
    h = now.astimezone(_tz(prefs.timezone)).hour
    return (qs <= h < qe) if qs < qe else (h >= qs or h < qe)


def release_time(prefs, now: datetime, urgent: bool) -> datetime:
    """When a non-digest email/SMS may go out."""
    if urgent or not in_quiet_hours(prefs, now):
        return now
    local = now.astimezone(_tz(prefs.timezone))
    end = local.replace(hour=int(prefs.quiet_end), minute=0, second=0, microsecond=0)
    if end <= local:
        end += timedelta(days=1)
    return end.astimezone(timezone.utc)


def next_digest_time(prefs, now: datetime) -> datetime:
    local = now.astimezone(_tz(prefs.timezone))
    at = local.replace(hour=int(settings.NOTIFICATIONS_DIGEST_HOUR), minute=0, second=0, microsecond=0)
    if at <= local:
        at += timedelta(days=1)
    return at.astimezone(timezone.utc)


def wants_email(kind: str, prefs) -> bool:
    if not prefs.email_enabled:
        return False
    category = KINDS.get(kind, ("booking", False))[0]
    if category == "reminder":
        return bool(prefs.reminders_enabled)
    if category == "manager":
        return bool(prefs.manager_alerts_email)
    if category == "new_shift":
        return prefs.new_shift_alerts in ("instant", "daily")
    return True


def wants_sms(kind: str, prefs, urgent: bool) -> bool:
    category, sms_ok = KINDS.get(kind, ("booking", False))
    if not (urgent and sms_ok and prefs.sms_enabled and sms_available()):
        return False
    if category == "reminder" and not prefs.reminders_enabled:
        return False
    return True


def settings_link_for(user: User) -> str:
    role = normalize_role(user.role)
    base = {"worker": "/worker", "venue_manager": "/venue", "platform_admin": "/admin"}.get(role, "/worker")
    return f"{base}?notifications=settings"


async def notify_in(
    db: AsyncSession,
    user_ids: Iterable,
    kind: str,
    title: str,
    body: Optional[str] = None,
    link: Optional[str] = None,
    *,
    venue_id=None,
    event_id=None,
    request_id=None,
    urgent: bool = False,
    dedupe_key: Optional[str] = None,
) -> int:
    """Creates notifications (+ outbox rows) inside `db`. Flushes, does NOT commit. Returns how many were created."""
    ids = list(dict.fromkeys([u for u in user_ids if u]))
    if not ids:
        return 0
    users = (await db.execute(select(User).where(User.id.in_(ids), User.is_active == True))).scalars().all()
    prefs = await load_prefs(db, [u.id for u in users])
    now = datetime.now(timezone.utc)
    title = (title or "")[:200]
    created = 0
    for u in users:
        p = prefs[u.id]
        if kind == "new_shift" and p.new_shift_alerts == "off":
            continue
        values = dict(
            user_id=u.id, kind=kind, title=title, body=body, link=link,
            venue_id=venue_id, event_id=event_id, request_id=request_id,
            urgent=bool(urgent), created_at=now,
        )
        if dedupe_key:
            values["dedupe_key"] = f"{dedupe_key}:{u.id}"[:200]
            nid = (await db.execute(
                pg_insert(Notification).values(**values)
                .on_conflict_do_nothing(index_elements=["dedupe_key"])
                .returning(Notification.id)
            )).scalar()
            if nid is None:
                continue          # already sent this one
        else:
            n = Notification(**values)
            db.add(n)
            await db.flush()
            nid = n.id
        created += 1

        if u.email and wants_email(kind, p):
            digest = kind == "new_shift" and p.new_shift_alerts == "daily"
            db.add(NotificationDelivery(
                notification_id=nid, user_id=u.id, channel="email", digest=digest,
                send_after=next_digest_time(p, now) if digest else release_time(p, now, urgent),
                created_at=now,
            ))
        if wants_sms(kind, p, urgent) and normalize_phone(u.phone):
            db.add(NotificationDelivery(
                notification_id=nid, user_id=u.id, channel="sms", digest=False,
                send_after=release_time(p, now, urgent), created_at=now,
            ))
    await db.flush()
    return created


async def notify(user_ids, kind: str, title: str, body: Optional[str] = None, link: Optional[str] = None, **kw) -> int:
    """Own session + commit. Safe to call after your transaction committed. Never raises."""
    try:
        async with AsyncSessionLocal() as db:
            n = await notify_in(db, user_ids, kind, title, body, link, **kw)
            await db.commit()
            return n
    except Exception:
        logger.exception(f"notify({kind}) failed")
        return 0


def _sms_text(n: Notification) -> str:
    first = (n.body or "").strip().split("\n")[0]
    parts = [f"ShiftBoard: {n.title}."]
    if first:
        parts.append(first)
    parts.append(absolute_link(n.link))
    return " ".join(parts)


def _mark(d: NotificationDelivery, ok: bool, err: Optional[str], now: datetime) -> None:
    d.attempts = (d.attempts or 0) + 1
    if ok:
        d.status = "sent"
        d.sent_at = now
        d.last_error = None
    elif d.attempts >= MAX_ATTEMPTS:
        d.status = "failed"
        d.last_error = err
    else:
        d.last_error = err
        d.send_after = now + timedelta(minutes=5 * d.attempts)


async def deliver_pending(db: AsyncSession, limit: int = 200) -> int:
    """Sends due email/SMS. Commits. Returns how many rows were processed."""
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(NotificationDelivery, Notification, User)
        .join(Notification, Notification.id == NotificationDelivery.notification_id)
        .join(User, User.id == NotificationDelivery.user_id)
        .where(NotificationDelivery.status == "pending", NotificationDelivery.send_after <= now)
        .order_by(NotificationDelivery.created_at.asc())
        .limit(limit)
    )).all()
    if not rows:
        return 0

    digests = defaultdict(list)
    for d, n, u in rows:
        if d.digest and d.channel == "email":
            digests[u.id].append((d, n, u))
            continue
        if n.read_at is not None and not n.urgent:
            d.status = "skipped"          # already seen in the app
            d.last_error = "Read in app before sending"
            continue
        if d.channel == "email":
            text, html_body = render_email(n.title, n.body, n.link, settings_link_for(u))
            ok, err = await send_email(u.email, n.title, text, html_body)
        elif d.channel == "sms":
            ok, err = await send_sms(u.phone or "", _sms_text(n))
        else:
            ok, err = False, f"Unknown channel {d.channel}"
        _mark(d, ok, err, now)

    for user_id, items in digests.items():
        u = items[0][2]
        unread = [(d, n) for d, n, _ in items if n.read_at is None]
        for d, n, _ in items:
            if n.read_at is not None:
                d.status = "skipped"
                d.last_error = "Read in app before the digest"
        if not unread:
            continue
        subject, text, html_body = render_digest([(n.title, n.body, n.link) for _, n in unread], settings_link_for(u))
        ok, err = await send_email(u.email, subject, text, html_body)
        for d, _ in unread:
            _mark(d, ok, err, now)

    await db.commit()
    return len(rows)
```

---

## B3. NEW FILE `backend/src/services/notify_events.py`
What happened → who gets told. Every public function opens its own session and never raises.

```python
"""
Phase 28: What happened -> who gets told, in plain words, with a link that opens the right screen.

Every public function opens its own session, commits, and NEVER raises, so call them AFTER the
main action has committed. A notification failure must never undo a booking or an edit.

Links (the frontend opens these):
  worker shift details : /worker?tab=calendar&request=<request_id>
  worker event popout  : /worker?event=<event_id>
  worker hand-offs     : /worker?tab=transfers
  manager event        : /venue?venue=<venue_id>&event=<event_id>
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import AsyncSessionLocal
from src.models import (
    Shift, ShiftEvent, ShiftRequest, ShiftTransfer, User, Venue, VenueManager, VenueLocation,
)
from src.services.notify import notify_in
from src.services.team import _team_filter

logger = logging.getLogger("shiftboard.notify_events")

BOOKED = ("approved", "confirmed", "checked_in")
URGENT_WINDOW = timedelta(hours=48)


# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------
def _as_utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def when_text(start, venue: Optional[Venue]) -> str:
    try:
        tz = ZoneInfo((venue.timezone if venue else None) or "America/New_York")
    except Exception:
        tz = ZoneInfo("America/New_York")
    local = _as_utc(start).astimezone(tz)
    return local.strftime("%a %b %-d, %-I:%M %p")


def person(u: Optional[User]) -> str:
    if u is None:
        return "Someone"
    name = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return name or (u.email or "Someone")


def worker_shift_link(request_id) -> str:
    return f"/worker?tab=calendar&request={request_id}"


def worker_event_link(event_id) -> str:
    return f"/worker?event={event_id}" if event_id else "/worker"


def manager_link(venue_id, event_id=None) -> str:
    return f"/venue?venue={venue_id}" + (f"&event={event_id}" if event_id else "")


def is_soon(start) -> bool:
    return _as_utc(start) - datetime.now(timezone.utc) <= URGENT_WINDOW


async def manager_ids(db: AsyncSession, venue_id) -> List:
    return list((await db.execute(
        select(VenueManager.user_id).where(VenueManager.venue_id == venue_id)
    )).scalars().all())


async def _shift_bundle(db: AsyncSession, shift_id):
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if shift is None:
        return None, None, None, None
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
    location = None
    if event is not None and event.location_id:
        location = await db.scalar(select(VenueLocation).where(VenueLocation.id == event.location_id))
    return shift, venue, event, location


def place_text(venue: Optional[Venue], location: Optional[VenueLocation]) -> str:
    if location is not None:
        return f"{location.name} ({venue.name if venue else ''})".strip()
    return venue.name if venue else ""


async def _run(label: str, fn, *args) -> None:
    try:
        async with AsyncSessionLocal() as db:
            await fn(db, *args)
            await db.commit()
    except Exception:
        logger.exception(f"notification hook '{label}' failed")


# ---------------------------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------------------------
async def _request_pending(db: AsyncSession, request_id) -> None:
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if req is None or (req.status or "").lower() not in ("pending", "pending_manager_approval"):
        return
    shift, venue, event, _ = await _shift_bundle(db, req.shift_id)
    worker = await db.scalar(select(User).where(User.id == req.worker_id))
    if shift is None or venue is None:
        return
    title = f"{person(worker)} requested {shift.role_type}"
    body = f"{event.title if event else shift.title} · {when_text(shift.start_time, venue)}"
    if req.notes:
        body += f"\n“{req.notes}”"
    await notify_in(
        db, await manager_ids(db, venue.id), "request_pending", title, body,
        manager_link(venue.id, shift.event_id), venue_id=venue.id, event_id=shift.event_id, request_id=req.id,
        dedupe_key=f"pending:{req.id}:{int(_as_utc(req.created_at).timestamp())}",
    )


async def request_pending(request_id) -> None:
    await _run("request_pending", _request_pending, request_id)


async def _request_decided(db: AsyncSession, request_id, approved: bool) -> None:
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if req is None:
        return
    shift, venue, event, location = await _shift_bundle(db, req.shift_id)
    if shift is None:
        return
    name = event.title if event else shift.title
    if approved:
        await notify_in(
            db, [req.worker_id], "request_approved",
            f"You're confirmed: {shift.role_type} · {name}",
            f"{when_text(shift.start_time, venue)} at {place_text(venue, location)}. "
            "Open the shift for arrival info and notes.",
            worker_shift_link(req.id), venue_id=shift.venue_id, event_id=shift.event_id, request_id=req.id,
        )
    else:
        await notify_in(
            db, [req.worker_id], "request_denied",
            f"Not selected: {shift.role_type} · {name}",
            f"{when_text(shift.start_time, venue)}. You can request a different position or another shift.",
            worker_event_link(shift.event_id), venue_id=shift.venue_id, event_id=shift.event_id, request_id=req.id,
        )


async def request_decided(request_id, approved: bool) -> None:
    await _run("request_decided", _request_decided, request_id, approved)


# ---------------------------------------------------------------------------------------------
# Event edits, location edits, cancellations, removals
# ---------------------------------------------------------------------------------------------
async def _event_updated(db: AsyncSession, event_id, since: datetime) -> None:
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if event is None or event.cancelled_at is not None:
        return
    since = _as_utc(since) - timedelta(seconds=2)
    venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
    shifts = (await db.execute(select(Shift).where(Shift.event_id == event.id))).scalars().all()
    event_changed = event.info_updated_at is not None and _as_utc(event.info_updated_at) >= since
    changed_shift_ids = {s.id for s in shifts if s.info_updated_at is not None and _as_utc(s.info_updated_at) >= since}
    if not event_changed and not changed_shift_ids:
        return
    target_ids = [s.id for s in shifts] if event_changed else list(changed_shift_ids)
    by_id = {s.id: s for s in shifts}
    reqs = (await db.execute(
        select(ShiftRequest).where(
            ShiftRequest.shift_id.in_(target_ids),
            func.lower(ShiftRequest.status).in_(BOOKED),
        )
    )).scalars().all()
    urgent = is_soon(event.start_time)
    for r in reqs:
        s = by_id[r.shift_id]
        parts = []
        if event_changed and event.info_change:
            parts.append(event.info_change)
        if s.id in changed_shift_ids and s.info_change:
            parts.append(f"{s.role_type}: {s.info_change}")
        await notify_in(
            db, [r.worker_id], "shift_updated",
            f"Updated: {s.role_type} · {event.title}",
            f"{when_text(event.start_time, venue)}\n" + "\n".join(parts or ["Shift details changed."]) +
            "\nOpen it and tap “Got it” so your manager knows you've seen it.",
            worker_shift_link(r.id), venue_id=event.venue_id, event_id=event.id, request_id=r.id, urgent=urgent,
        )


async def event_updated(event_id, since: datetime) -> None:
    await _run("event_updated", _event_updated, event_id, since)


async def _location_updated(db: AsyncSession, location_id, since: datetime) -> None:
    since_m = _as_utc(since) - timedelta(seconds=2)
    events = (await db.execute(
        select(ShiftEvent.id).where(
            ShiftEvent.location_id == location_id,
            ShiftEvent.cancelled_at.is_(None),
            ShiftEvent.info_updated_at >= since_m,
        )
    )).scalars().all()
    for eid in events:
        await _event_updated(db, eid, since)


async def location_updated(location_id, since: datetime) -> None:
    await _run("location_updated", _location_updated, location_id, since)


async def _shifts_cancelled(db: AsyncSession, event_id, since: datetime) -> None:
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if event is None:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
    since = _as_utc(since) - timedelta(seconds=2)
    rows = (await db.execute(
        select(ShiftRequest, Shift)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            Shift.event_id == event.id,
            func.lower(ShiftRequest.status) == "cancelled",
            ShiftRequest.updated_at >= since,
        )
    )).all()
    for r, s in rows:
        reason = f"\nReason: {r.status_reason}" if r.status_reason else ""
        await notify_in(
            db, [r.worker_id], "shift_cancelled",
            f"Cancelled: {s.role_type} · {event.title}",
            f"{when_text(s.start_time, venue)} is cancelled. You don't need to go.{reason}",
            worker_shift_link(r.id), venue_id=event.venue_id, event_id=event.id, request_id=r.id, urgent=True,
        )


async def shifts_cancelled(event_id, since: datetime) -> None:
    await _run("shifts_cancelled", _shifts_cancelled, event_id, since)


async def _removed(db: AsyncSession, request_id) -> None:
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if req is None:
        return
    shift, venue, event, _ = await _shift_bundle(db, req.shift_id)
    if shift is None:
        return
    reason = f"\nReason: {req.status_reason}" if req.status_reason else ""
    await notify_in(
        db, [req.worker_id], "removed",
        f"Removed from {shift.role_type} · {event.title if event else shift.title}",
        f"{when_text(shift.start_time, venue)}. You're no longer on this shift.{reason}",
        worker_shift_link(req.id), venue_id=shift.venue_id, event_id=shift.event_id, request_id=req.id, urgent=True,
    )


async def removed(request_id) -> None:
    await _run("removed", _removed, request_id)


# ---------------------------------------------------------------------------------------------
# Hand-offs (transfers)
# ---------------------------------------------------------------------------------------------
async def _transfer_changed(db: AsyncSession, transfer_id) -> None:
    t = await db.scalar(select(ShiftTransfer).where(ShiftTransfer.id == transfer_id))
    if t is None:
        return
    shift, venue, event, location = await _shift_bundle(db, t.shift_id)
    if shift is None:
        return
    frm = await db.scalar(select(User).where(User.id == t.from_worker_id))
    to = await db.scalar(select(User).where(User.id == t.to_worker_id))
    what = f"{shift.role_type} · {event.title if event else shift.title}, {when_text(shift.start_time, venue)}"
    st = (t.status or "").lower()
    common = dict(venue_id=shift.venue_id, event_id=shift.event_id)
    key = f"transfer:{t.id}:{st}"

    if st == "pending_worker_acceptance":
        await notify_in(db, [t.to_worker_id], "transfer_offered",
                        f"{person(frm)} wants to hand you a shift", what, "/worker?tab=transfers",
                        dedupe_key=key, **common)
    elif st == "pending_manager_approval":
        await notify_in(db, await manager_ids(db, shift.venue_id), "swap_pending",
                        f"Hand-off waiting: {person(frm)} → {person(to)}", what,
                        manager_link(shift.venue_id, shift.event_id), dedupe_key=key, **common)
        await notify_in(db, [t.from_worker_id], "transfer_update",
                        f"{person(to)} accepted your hand-off", f"{what}\nWaiting for the manager to approve.",
                        "/worker?tab=schedule", dedupe_key=key, **common)
    elif st == "declined":
        await notify_in(db, [t.from_worker_id], "transfer_update",
                        f"{person(to)} declined your hand-off", f"{what}\nYou're still on this shift.",
                        "/worker?tab=schedule", dedupe_key=key, **common)
    elif st == "cancelled_by_sender":
        await notify_in(db, [t.to_worker_id], "transfer_update",
                        f"{person(frm)} withdrew the hand-off offer", what, "/worker?tab=transfers",
                        dedupe_key=key, **common)
    elif st == "approved":
        to_req = await db.scalar(select(ShiftRequest).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == t.to_worker_id))
        await notify_in(db, [t.to_worker_id], "request_approved",
                        f"You're confirmed: {shift.role_type} · {event.title if event else shift.title}",
                        f"{when_text(shift.start_time, venue)} at {place_text(venue, location)} "
                        f"(handed off from {person(frm)}). Open the shift for arrival info and notes.",
                        worker_shift_link(to_req.id) if to_req else "/worker?tab=schedule",
                        request_id=to_req.id if to_req else None, dedupe_key=key, **common)
        await notify_in(db, [t.from_worker_id], "transfer_update",
                        "Hand-off approved", f"{what}\n{person(to)} is taking it. You're off this shift.",
                        "/worker?tab=schedule", dedupe_key=key, **common)
    elif st == "denied":
        await notify_in(db, [t.from_worker_id, t.to_worker_id], "transfer_update",
                        "Hand-off not approved", f"{what}\n{person(frm)} stays on this shift.",
                        "/worker?tab=schedule", dedupe_key=key, **common)


async def transfer_changed(transfer_id) -> None:
    await _run("transfer_changed", _transfer_changed, transfer_id)


# ---------------------------------------------------------------------------------------------
# New shifts for the venue's team
# ---------------------------------------------------------------------------------------------
async def _new_event_posted(db: AsyncSession, event_id) -> None:
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if event is None or event.cancelled_at is not None or _as_utc(event.start_time) <= datetime.now(timezone.utc):
        return
    venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
    shifts = (await db.execute(
        select(Shift).where(Shift.event_id == event.id, func.upper(Shift.status) == "OPEN")
    )).scalars().all()
    if not shifts or venue is None:
        return
    team = (await db.execute(
        select(User.id).where(
            func.lower(User.role) == "worker",
            User.is_active == True,
            _team_filter(venue.id),
        )
    )).scalars().all()
    if not team:
        return
    roles = ", ".join(sorted({s.role_type for s in shifts}))
    location = await db.scalar(select(VenueLocation).where(VenueLocation.id == event.location_id)) if event.location_id else None
    body = f"{when_text(event.start_time, venue)} · {roles}"
    if location is not None:
        body += f" · at {location.name}"
    await notify_in(
        db, team, "new_shift", f"New shift at {venue.name}: {event.title}", body,
        worker_event_link(event.id), venue_id=venue.id, event_id=event.id, dedupe_key=f"new_shift:{event.id}",
    )


async def new_event_posted(event_id) -> None:
    await _run("new_event_posted", _new_event_posted, event_id)
```

---

## B4. NEW FILE `backend/src/services/notification_worker.py`
Runs every 60 s from the app lifespan.

```python
"""
Phase 28: Background notification worker (started from main.py's lifespan).

Every minute:
  1. auto clock-out sweep (Phase 27 rule, now also runs when nobody opens a screen)
  2. reminders to booked workers: ~24h before and ~2h before (each once, via dedupe keys)
  3. "not clocked in" 10 minutes after start -> the worker (urgent) and the venue's managers
  4. managers: people who haven't read an UPDATE to a shift starting within 24h (once per update)
  5. send due email / SMS from the outbox

Only one process runs a tick at a time (Redis lock). If Redis is unreachable the tick still runs;
dedupe keys keep reminders from doubling.
"""
import asyncio
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import AsyncSessionLocal
from src.models import Shift, ShiftEvent, ShiftRequest, TimeEntry, User, Venue, VenueLocation
from src.services.notify import notify_in, deliver_pending
from src.services.notify_events import (
    manager_ids, when_text, person, place_text, worker_shift_link, manager_link, _as_utc,
)
from src.services.worker_calendar import has_any_notes, latest_info_update, needs_ack
from src.services.clock import auto_close_open_entries

logger = logging.getLogger("shiftboard.notification_worker")

TICK_SECONDS = 60
LOCK_KEY = "shiftboard:notification-worker"
BOOKED_NOT_STARTED = ("approved", "confirmed")
BOOKED = ("approved", "confirmed", "checked_in")
LATE_AFTER = timedelta(minutes=10)


async def _booked_rows(db: AsyncSession, start_from: datetime, start_to: datetime, statuses):
    """(request, shift, event, venue, location) for booked requests whose shift starts in [from, to)."""
    rows = (await db.execute(
        select(ShiftRequest, Shift)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            func.lower(ShiftRequest.status).in_(statuses),
            Shift.start_time >= start_from,
            Shift.start_time < start_to,
            func.upper(Shift.status) != "CANCELLED",
        )
    )).all()
    if not rows:
        return []
    event_ids = {s.event_id for _, s in rows if s.event_id}
    venue_ids = {s.venue_id for _, s in rows}
    events = {e.id: e for e in (await db.execute(select(ShiftEvent).where(ShiftEvent.id.in_(event_ids)))).scalars().all()} if event_ids else {}
    venues = {v.id: v for v in (await db.execute(select(Venue).where(Venue.id.in_(venue_ids)))).scalars().all()}
    loc_ids = {e.location_id for e in events.values() if e.location_id}
    locations = {l.id: l for l in (await db.execute(select(VenueLocation).where(VenueLocation.id.in_(loc_ids)))).scalars().all()} if loc_ids else {}
    out = []
    for r, s in rows:
        ev = events.get(s.event_id)
        if ev is not None and ev.cancelled_at is not None:
            continue
        out.append((r, s, ev, venues.get(s.venue_id), locations.get(ev.location_id) if ev is not None and ev.location_id else None))
    return out


def _needs_ack(r, s, ev, venue, loc) -> bool:
    return needs_ack(
        booked=True,
        has_notes=has_any_notes(venue, ev, s, loc),
        updated_at=latest_info_update(ev, s),
        seen_at=r.info_seen_at,
        booked_at=r.approved_at or r.created_at,
    )


async def scan_reminders(db: AsyncSession, now: datetime) -> int:
    sent = 0
    for r, s, ev, venue, loc in await _booked_rows(db, now, now + timedelta(hours=24), BOOKED_NOT_STARTED):
        start = _as_utc(s.start_time)
        booked_at = _as_utc(r.approved_at or r.created_at) or now
        until = start - now
        if until <= timedelta(hours=2):
            if booked_at > start - timedelta(hours=2):
                continue             # booked at the last minute; they know
            kind, key, urgent, lead = "reminder_2h", f"rem2:{r.id}", True, "Starts soon"
        else:
            if booked_at > start - timedelta(hours=24):
                continue
            kind, key, urgent, lead = "reminder_24h", f"rem24:{r.id}", False, "Tomorrow"
        title = f"{lead}: {s.role_type} · {ev.title if ev else s.title}"
        body = f"{when_text(s.start_time, venue)} at {place_text(venue, loc)}."
        if _needs_ack(r, s, ev, venue, loc):
            body += "\nYou haven't read the latest shift info yet. Open it and tap “Got it”."
        sent += await notify_in(
            db, [r.worker_id], kind, title, body, worker_shift_link(r.id),
            venue_id=s.venue_id, event_id=s.event_id, request_id=r.id, urgent=urgent, dedupe_key=key,
        )
    return sent


async def scan_late(db: AsyncSession, now: datetime) -> int:
    sent = 0
    rows = await _booked_rows(db, now - timedelta(hours=24), now - LATE_AFTER, BOOKED_NOT_STARTED)
    for r, s, ev, venue, loc in rows:
        if _as_utc(s.end_time) <= now:
            continue
        has_entry = await db.scalar(
            select(func.count(TimeEntry.id)).where(TimeEntry.shift_id == s.id, TimeEntry.worker_id == r.worker_id)
        )
        if has_entry:
            continue
        worker = await db.scalar(select(User).where(User.id == r.worker_id))
        name = ev.title if ev else s.title
        sent += await notify_in(
            db, [r.worker_id], "not_clocked_in",
            f"You haven't clocked in: {s.role_type} · {name}",
            f"Your shift started at {when_text(s.start_time, venue)}. Clock in now, or message your manager if you're running late.",
            worker_shift_link(r.id), venue_id=s.venue_id, event_id=s.event_id, request_id=r.id,
            urgent=True, dedupe_key=f"late-w:{r.id}",
        )
        sent += await notify_in(
            db, await manager_ids(db, s.venue_id), "late_worker",
            f"{person(worker)} hasn't clocked in",
            f"{s.role_type} · {name} started {when_text(s.start_time, venue)}.",
            manager_link(s.venue_id, s.event_id), venue_id=s.venue_id, event_id=s.event_id, request_id=r.id,
            urgent=True, dedupe_key=f"late-m:{r.id}",
        )
    return sent


async def scan_unread_updates(db: AsyncSession, now: datetime) -> int:
    """One alert per event per update: 'N people haven't read the update'."""
    by_event = defaultdict(list)
    for r, s, ev, venue, loc in await _booked_rows(db, now, now + timedelta(hours=24), BOOKED):
        updated = latest_info_update(ev, s)
        booked_at = _as_utc(r.approved_at or r.created_at)
        if updated is None or booked_at is None or updated <= booked_at:
            continue                 # only real updates after they booked, not first-time notes
        if not _needs_ack(r, s, ev, venue, loc):
            continue
        by_event[(s.venue_id, s.event_id)].append((r, s, ev, venue, updated))
    sent = 0
    for (venue_id, event_id), items in by_event.items():
        names = []
        for r, *_ in items:
            u = await db.scalar(select(User).where(User.id == r.worker_id))
            names.append(person(u))
        _, s, ev, venue, updated = items[0]
        latest = max(i[4] for i in items)
        n = len(names)
        sent += await notify_in(
            db, await manager_ids(db, venue_id), "unread_update",
            f"{n} {'person hasn' if n == 1 else 'people haven'}'t read the update: {ev.title if ev else s.title}",
            f"Starts {when_text(s.start_time, venue)}. Not read yet: {', '.join(names)}.",
            manager_link(venue_id, event_id), venue_id=venue_id, event_id=event_id,
            dedupe_key=f"unread:{event_id or s.id}:{int(latest.timestamp())}",
        )
    return sent


async def run_tick() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        await auto_close_open_entries(db)
    for label, fn in (("reminders", scan_reminders), ("late", scan_late), ("unread", scan_unread_updates)):
        try:
            async with AsyncSessionLocal() as db:
                await fn(db, now)
                await db.commit()
        except Exception:
            logger.exception(f"notification scan '{label}' failed")
    try:
        async with AsyncSessionLocal() as db:
            await deliver_pending(db)
    except Exception:
        logger.exception("notification delivery failed")


async def _acquire_lock():
    """Returns (redis_client or None, got_lock: bool)."""
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(settings.REDIS_URL, socket_timeout=3)
        got = await client.set(LOCK_KEY, str(os.getpid()), nx=True, ex=TICK_SECONDS - 5)
        return client, bool(got)
    except Exception:
        return None, True   # no Redis: run anyway (single-process dev setup)


async def notification_worker_loop() -> None:
    logger.info("Notification worker started.")
    await asyncio.sleep(10)   # let startup/seed finish
    while True:
        client = None
        try:
            client, got = await _acquire_lock()
            if got:
                await run_tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("notification worker tick failed")
        finally:
            if client is not None:
                try:
                    await client.aclose()
                except Exception:
                    pass
        await asyncio.sleep(TICK_SECONDS)
```

---

## B5. NEW FILE `backend/src/routers/notifications.py`
Endpoints (all require a signed-in user; each user only ever sees their own rows):

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/notifications?limit=30&before=<iso>` | latest notifications |
| GET | `/api/notifications/unread-count` | `{count}` for the bell |
| POST | `/api/notifications/{id}/read` | mark one read → `{count}` |
| POST | `/api/notifications/read-all` | mark all read → `{count: 0}` |
| GET | `/api/notifications/preferences` | settings + email, phone, `email_available`, `sms_available`, `is_manager` |
| PUT | `/api/notifications/preferences` | save settings (400 on bad mode / hour / timezone / phone, or texts on without a phone) |
| POST | `/api/notifications/test` | send yourself an urgent test on every channel you have on |

```python
"""
Phase 28: The signed-in user's notifications (the bell) and notification settings.
"""
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

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


def _to_response(n: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=n.id, kind=n.kind, title=n.title, body=n.body, link=n.link,
        urgent=bool(n.urgent), read=n.read_at is not None, created_at=n.created_at,
    )


@router.get("", response_model=List[NotificationResponse])
async def list_notifications(
    limit: int = Query(30, ge=1, le=100),
    before: Optional[datetime] = Query(None, description="Older than this (for 'load more')"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Notification).where(Notification.user_id == current_user.id)
    if before is not None:
        q = q.where(Notification.created_at < before)
    rows = (await db.execute(q.order_by(Notification.created_at.desc()).limit(limit))).scalars().all()
    return [_to_response(n) for n in rows]


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    n = await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == current_user.id, Notification.read_at.is_(None)
        )
    )
    return UnreadCountResponse(count=int(n or 0))


@router.post("/{notification_id}/read", response_model=UnreadCountResponse)
async def mark_read(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await db.execute(
            update(Notification)
            .where(Notification.id == notification_id, Notification.user_id == current_user.id, Notification.read_at.is_(None))
            .values(read_at=datetime.now(timezone.utc))
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not update: {e}")
    return await unread_count(current_user, db)


@router.post("/read-all", response_model=UnreadCountResponse)
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await db.execute(
            update(Notification)
            .where(Notification.user_id == current_user.id, Notification.read_at.is_(None))
            .values(read_at=datetime.now(timezone.utc))
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not update: {e}")
    return UnreadCountResponse(count=0)


async def _prefs_response(db: AsyncSession, user: User) -> NotificationPreferencesResponse:
    row = await db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user.id))
    values = dict(DEFAULT_PREFS)
    if row is not None:
        for k in DEFAULT_PREFS:
            values[k] = getattr(row, k)
    role = normalize_role(user.role)
    is_manager = role == "platform_admin" or bool(await db.scalar(
        select(func.count(VenueManager.user_id)).where(VenueManager.user_id == user.id)
    ))
    return NotificationPreferencesResponse(
        **values,
        email=user.email,
        phone=user.phone,
        email_available=email_available(),
        sms_available=sms_available(),
        is_manager=is_manager,
    )


@router.get("/preferences", response_model=NotificationPreferencesResponse)
async def get_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _prefs_response(db, current_user)


@router.put("/preferences", response_model=NotificationPreferencesResponse)
async def update_preferences(
    body: NotificationPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump(exclude_unset=True)
    if "new_shift_alerts" in data and data["new_shift_alerts"] not in NEW_SHIFT_MODES:
        raise HTTPException(status_code=400, detail="New-shift alerts must be off, instant or daily.")
    for key in ("quiet_start", "quiet_end"):
        if data.get(key) is not None and not (0 <= int(data[key]) <= 23):
            raise HTTPException(status_code=400, detail="Quiet hours must be whole hours from 0 to 23.")
    if "timezone" in data and data["timezone"]:
        try:
            ZoneInfo(data["timezone"])
        except Exception:
            raise HTTPException(status_code=400, detail=f"Unknown timezone '{data['timezone']}'.")
    phone = data.pop("phone", None)
    clear_quiet = data.pop("clear_quiet_hours", False)
    if phone is not None and phone.strip() and not normalize_phone(phone):
        raise HTTPException(status_code=400, detail="Enter a mobile number like (555) 555-0100 or +15555550100.")
    if data.get("sms_enabled") and not (normalize_phone(phone) if phone is not None else normalize_phone(current_user.phone)):
        raise HTTPException(status_code=400, detail="Add a mobile number to get texts.")

    try:
        row = await db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == current_user.id))
        if row is None:
            row = NotificationPreference(user_id=current_user.id, **DEFAULT_PREFS)
            db.add(row)
        for key, value in data.items():
            if key in DEFAULT_PREFS and value is not None:
                setattr(row, key, value)
        if clear_quiet:
            row.quiet_start = None
            row.quiet_end = None
        if phone is not None:
            current_user.phone = phone.strip() or None
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save settings: {e}")
    return await _prefs_response(db, current_user)


@router.post("/test", response_model=UnreadCountResponse)
async def send_test(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sends yourself a test through every channel you have turned on (email / text within a minute)."""
    await notify(
        [current_user.id], "test", "Test notification",
        "If you can read this, ShiftBoard can reach you here.", "/",
        urgent=True,
    )
    return await unread_count(current_user, db)
```

---

## B6. `backend/src/main.py` (EDITS)
Only the router import/include and starting/stopping the worker inside the existing `lifespan`. **Do not touch the CORS block.**

**Edit 1.** Find:
```python
from src.routers.me import router as me_router
from src.routers.locations import router as locations_router


```
Replace with:
```python
from src.routers.me import router as me_router
from src.routers.locations import router as locations_router
from src.routers.notifications import router as notifications_router
from src.services.notification_worker import notification_worker_loop


```

**Edit 2.** Find:
```python
        logger.error(f"Error during startup data seeding: {e}", exc_info=True)

    yield

    logger.info("Shutting down ShiftBoard Backend Application...")
```
Replace with:
```python
        logger.error(f"Error during startup data seeding: {e}", exc_info=True)

    # Phase 28: background notification worker (reminders, alerts, email/SMS delivery)
    worker_task = None
    if settings.NOTIFICATIONS_WORKER_ENABLED:
        import asyncio
        worker_task = asyncio.create_task(notification_worker_loop())

    yield

    if worker_task is not None:
        worker_task.cancel()
        try:
            await worker_task
        except BaseException:
            pass

    logger.info("Shutting down ShiftBoard Backend Application...")
```

**Edit 3.** Find:
```python
app.include_router(me_router)
app.include_router(locations_router)


```
Replace with:
```python
app.include_router(me_router)
app.include_router(locations_router)
app.include_router(notifications_router)


```

---

## B7. `backend/src/services/booking.py` (EDITS)
`request_position` now commits inside the `try`, then notifies managers **after** the `except` blocks, then returns the request id.

**Edit 1.** Find:
```python
from src.models import Shift, ShiftEvent, ShiftRequest, User
from src.services.auto_confirm import evaluate_shift_request, check_double_booking

logger = logging.getLogger("shiftboard.booking")
```
Replace with:
```python
from src.models import Shift, ShiftEvent, ShiftRequest, User
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services import notify_events

logger = logging.getLogger("shiftboard.booking")
```

**Edit 2.** Find:
```python
        req_id = req.id          # read before commit (commit may expire attributes)
        await db.commit()
        return req_id
    except HTTPException:
        await db.rollback()
```
Replace with:
```python
        req_id = req.id          # read before commit (commit may expire attributes)
        await db.commit()
    except HTTPException:
        await db.rollback()
```

**Edit 3.** Find:
```python
        logger.exception("request_position failed")
        raise HTTPException(status_code=500, detail=f"Could not request this position: {e}")


```
Replace with:
```python
        logger.exception("request_position failed")
        raise HTTPException(status_code=500, detail=f"Could not request this position: {e}")

    # Phase 28: tell the venue's managers a request is waiting (runs after the commit; never raises)
    if status_val != "approved":
        await notify_events.request_pending(req_id)
    return req_id


```

---

## B8. `backend/src/routers/shifts.py` (EDITS)
Approve / deny tells the worker.

**Edit 1.** Find:
```python
from src.services.booking import request_position, withdraw_other_pending_in_event
from src.services.clock import clock_in, clock_out, auto_close_open_entries

router = APIRouter(prefix="/api/shifts", tags=["Shifts"])
```
Replace with:
```python
from src.services.booking import request_position, withdraw_other_pending_in_event
from src.services.clock import clock_in, clock_out, auto_close_open_entries
from src.services import notify_events

router = APIRouter(prefix="/api/shifts", tags=["Shifts"])
```

**Edit 2.** Find:
```python
    await db.commit()
    await db.refresh(shift_req)

    res = await db.execute(
```
Replace with:
```python
    await db.commit()
    await db.refresh(shift_req)

    # Phase 28: tell the worker (after commit; never raises)
    if target_clean == "approved" and prev_status != "approved":
        await notify_events.request_decided(shift_req.id, True)
    elif target_clean == "rejected" and prev_status != "rejected":
        await notify_events.request_decided(shift_req.id, False)

    res = await db.execute(
```

---

## B9. `backend/src/routers/events.py` (EDITS)
Create and duplicate → new-shift alerts to the team. Edit → "Updated" to booked workers. Both cancel endpoints → "Cancelled". `since` is captured **before** the change so only this action's changes are announced.

**Edit 1.** Find:
```python
)
from src.services.timesheets import build_timesheet

router = APIRouter(prefix="/api/events", tags=["Events"])
```
Replace with:
```python
)
from src.services.timesheets import build_timesheet
from src.services import notify_events
from datetime import datetime, timezone

router = APIRouter(prefix="/api/events", tags=["Events"])
```

**Edit 2.** Find:
```python
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    event = await create_event_with_positions(db, venue, current_user, data)
    return await build_event_detail(db, event)


```
Replace with:
```python
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    event = await create_event_with_positions(db, venue, current_user, data)
    detail = await build_event_detail(db, event)
    await notify_events.new_event_posted(event.id)          # Phase 28: tell the venue's team
    return detail


```

**Edit 3.** Find:
```python
    db: AsyncSession = Depends(get_db)
):
    event = await _load_managed_event(db, event_id, current_user)
    await update_event(db, event, data)
    await db.refresh(event)
    return await build_event_detail(db, event)


```
Replace with:
```python
    db: AsyncSession = Depends(get_db)
):
    since = datetime.now(timezone.utc)                      # Phase 28
    event = await _load_managed_event(db, event_id, current_user)
    await update_event(db, event, data)
    await db.refresh(event)
    detail = await build_event_detail(db, event)
    await notify_events.event_updated(event_id, since)      # Phase 28: tell booked people what changed
    return detail


```

**Edit 4.** Find:
```python
):
    """Phase 26: Cancel the whole event. Everyone booked or waiting is marked cancelled with the reason."""
    event = await _load_managed_event(db, event_id, current_user)
    affected = await cancel_shifts(db, event, None, body.reason)
    return {"detail": "Event cancelled.", "people_affected": affected}

```
Replace with:
```python
):
    """Phase 26: Cancel the whole event. Everyone booked or waiting is marked cancelled with the reason."""
    since = datetime.now(timezone.utc)                      # Phase 28
    event = await _load_managed_event(db, event_id, current_user)
    affected = await cancel_shifts(db, event, None, body.reason)
    await notify_events.shifts_cancelled(event_id, since)   # Phase 28
    return {"detail": "Event cancelled.", "people_affected": affected}

```

**Edit 5.** Find:
```python
):
    """Phase 26: Cancel one position. If it was the last open position, the event is cancelled too."""
    event = await _load_managed_event(db, event_id, current_user)
    affected = await cancel_shifts(db, event, [shift_id], body.reason)
    return {"detail": "Position cancelled.", "people_affected": affected}

```
Replace with:
```python
):
    """Phase 26: Cancel one position. If it was the last open position, the event is cancelled too."""
    since = datetime.now(timezone.utc)                      # Phase 28
    event = await _load_managed_event(db, event_id, current_user)
    affected = await cancel_shifts(db, event, [shift_id], body.reason)
    await notify_events.shifts_cancelled(event_id, since)   # Phase 28
    return {"detail": "Position cancelled.", "people_affected": affected}

```

**Edit 6.** Find:
```python
    venue = await _venue_for(db, event.venue_id)
    created = await duplicate_event(db, event, venue, current_user, body.dates)
    return DuplicateEventResult(created_event_ids=[e.id for e in created], count=len(created))

```
Replace with:
```python
    venue = await _venue_for(db, event.venue_id)
    created = await duplicate_event(db, event, venue, current_user, body.dates)
    for ev in created:
        await notify_events.new_event_posted(ev.id)         # Phase 28
    return DuplicateEventResult(created_event_ids=[e.id for e in created], count=len(created))

```

---

## B10. `backend/src/routers/timesheets.py` (EDITS)
Removing a person tells them.

**Edit 1.** Find:
```python
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services.timesheets import (
    ASSIGNED_STATUSES, as_utc, fmt_range, validate_times, require_reason, audit,
```
Replace with:
```python
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services import notify_events
from src.services.timesheets import (
    ASSIGNED_STATUSES, as_utc, fmt_range, validate_times, require_reason, audit,
```

**Edit 2.** Find:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to remove: {str(e)}")
    return {"detail": "Removed from shift."}

```
Replace with:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to remove: {str(e)}")
    await notify_events.removed(request_id)                  # Phase 28
    return {"detail": "Removed from shift."}

```

---

## B11. `backend/src/routers/locations.py` (EDITS)
A global location edit tells booked workers on the affected upcoming events.

**Edit 1.** Find:
```python
from src.services.venue_public import can_manage_venue
from src.services.locations import create_location, update_location, usage_counts, to_response

router = APIRouter(prefix="/api/venues", tags=["Locations"])
```
Replace with:
```python
from src.services.venue_public import can_manage_venue
from src.services.locations import create_location, update_location, usage_counts, to_response
from src.services import notify_events
from datetime import datetime, timezone

router = APIRouter(prefix="/api/venues", tags=["Locations"])
```

**Edit 2.** Find:
```python
):
    """Global edit: every event at this location changes. Upcoming events are flagged 'Updated'."""
    venue = await _venue(db, venue_id, current_user)
    loc = await _location(db, venue, location_id)
```
Replace with:
```python
):
    """Global edit: every event at this location changes. Upcoming events are flagged 'Updated'."""
    since = datetime.now(timezone.utc)                      # Phase 28
    venue = await _venue(db, venue_id, current_user)
    loc = await _location(db, venue, location_id)
```

**Edit 3.** Find:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not update location: {e}")
    return await _respond(db, loc)

```
Replace with:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not update location: {e}")
    await notify_events.location_updated(location_id, since)   # Phase 28: tell booked people at upcoming events
    return await _respond(db, loc)

```

---

## B12. `backend/src/routers/transfers.py` (EDITS)
Every hand-off state change (propose, accept, decline, withdraw, approve, deny) calls `transfer_changed` after its commit.

**Edit 1.** Find:
```python
from src.services.auto_confirm import check_double_booking
from src.services.booking import withdraw_other_pending_in_event
from src.services.team import get_transfer_candidates

```
Replace with:
```python
from src.services.auto_confirm import check_double_booking
from src.services.booking import withdraw_other_pending_in_event
from src.services import notify_events
from src.services.team import get_transfer_candidates

```

**Edit 2.** Find:
```python
    await db.commit()
    await db.refresh(transfer)

    # Reload with relations
```
Replace with:
```python
    await db.commit()
    await db.refresh(transfer)
    await notify_events.transfer_changed(transfer.id)   # Phase 28: tell the person being offered the shift

    # Reload with relations
```

**Edit 3.** Find:
```python

    await db.commit()
    await db.refresh(transfer)
    return transfer

@router.post("/{id}/accept", response_model=ShiftTransferResponse)
```
Replace with:
```python

    await db.commit()
    await db.refresh(transfer)
    await notify_events.transfer_changed(transfer.id)   # Phase 28 (after commit; never raises)
    return transfer

@router.post("/{id}/accept", response_model=ShiftTransferResponse)
```

**Edit 4.** Find:
```python

    await db.commit()
    await db.refresh(transfer)
    return transfer

@router.post("/{transfer_id}/manager-review", response_model=ShiftTransferResponse)
```
Replace with:
```python

    await db.commit()
    await db.refresh(transfer)
    await notify_events.transfer_changed(transfer.id)   # Phase 28 (after commit; never raises)
    return transfer

@router.post("/{transfer_id}/manager-review", response_model=ShiftTransferResponse)
```

**Edit 5.** Find:
```python

    await db.commit()
    await db.refresh(transfer)
    return transfer

@router.post("/{id}/approve", response_model=ShiftTransferResponse)
```
Replace with:
```python

    await db.commit()
    await db.refresh(transfer)
    await notify_events.transfer_changed(transfer.id)   # Phase 28 (after commit; never raises)
    return transfer

@router.post("/{id}/approve", response_model=ShiftTransferResponse)
```

---

# PART C: Frontend

## C1. NEW FILE `frontend/src/components/NotificationSettingsModal.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { Bell, Mail, MessageSquare, Moon, Send, Info } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const cardCls = 'p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3';

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }),
}));

function Toggle({ checked, onChange, title, body, disabled = false }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500"
      />
      <span>
        <span className="block text-sm font-semibold text-white">{title}</span>
        {body && <span className="block text-xs text-slate-400">{body}</span>}
      </span>
    </label>
  );
}

/**
 * Phase 28: What gets sent where. Everything always shows in the bell; these settings control
 * email and text messages, reminders, new-shift alerts and quiet hours.
 */
export default function NotificationSettingsModal({ onClose, onSent }) {
  const [prefs, setPrefs] = useState(null);
  const [phone, setPhone] = useState('');
  const [quietOn, setQuietOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState(null); // { type, text }

  useEffect(() => {
    api
      .get('/notifications/preferences')
      .then((res) => {
        setPrefs(res.data);
        setPhone(res.data.phone || '');
        setQuietOn(res.data.quiet_start !== null && res.data.quiet_start !== undefined);
      })
      .catch((err) => setMsg({ type: 'error', text: err.response?.data?.detail || 'Could not load your settings.' }));
  }, []);

  const set = (key, value) => setPrefs((p) => ({ ...p, [key]: value }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const body = {
        email_enabled: prefs.email_enabled,
        sms_enabled: prefs.sms_enabled,
        reminders_enabled: prefs.reminders_enabled,
        new_shift_alerts: prefs.new_shift_alerts,
        manager_alerts_email: prefs.manager_alerts_email,
        timezone: prefs.timezone,
        phone,
      };
      if (quietOn) {
        body.quiet_start = Number(prefs.quiet_start ?? 22);
        body.quiet_end = Number(prefs.quiet_end ?? 7);
      } else {
        body.clear_quiet_hours = true;
      }
      const res = await api.put('/notifications/preferences', body);
      setPrefs(res.data);
      setMsg({ type: 'success', text: 'Saved.' });
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setMsg(null);
    try {
      await api.post('/notifications/test');
      setMsg({ type: 'success', text: 'Test sent. Check the bell now; email / text arrive within a minute.' });
      if (onSent) onSent();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Could not send a test.' });
    } finally {
      setTesting(false);
    }
  };

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700 mr-auto">
        Close
      </button>
      <button type="button" onClick={sendTest} disabled={testing || !prefs}
        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50">
        <Send className="w-4 h-4" /> {testing ? 'Sending…' : 'Send me a test'}
      </button>
      <button type="button" onClick={save} disabled={saving || !prefs}
        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </>
  );

  return (
    <ModalShell
      title="Notification settings"
      subtitle="Everything always shows in the bell. Choose what also reaches your email and phone."
      icon={<Bell className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={footer}
    >
      {msg && (
        <div className={`mb-4 p-3 rounded-xl text-sm border ${msg.type === 'success' ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200' : 'bg-rose-950/60 border-rose-700 text-rose-200'}`}>
          {msg.text}
        </div>
      )}
      {!prefs ? (
        <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Mail className="w-4 h-4 text-emerald-400" /> Email</div>
              <Toggle
                checked={prefs.email_enabled}
                onChange={(v) => set('email_enabled', v)}
                title={`Email me at ${prefs.email || 'my account email'}`}
                body="Bookings, changes, cancellations and reminders."
              />
              {!prefs.email_available && (
                <p className="text-[11px] text-amber-300 flex items-start gap-1">
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> Email sending isn't set up on this server yet, so emails are only logged.
                </p>
              )}
            </div>

            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><MessageSquare className="w-4 h-4 text-emerald-400" /> Text messages</div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Mobile number</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="(555) 555-0100" />
              </div>
              <Toggle
                checked={prefs.sms_enabled}
                onChange={(v) => set('sms_enabled', v)}
                disabled={!prefs.sms_available}
                title="Text me when it's urgent"
                body="Cancellations, removals, last-minute changes, 2-hour reminders and missed clock-ins. Nothing else."
              />
              {!prefs.sms_available && (
                <p className="text-[11px] text-slate-500">Texts aren't set up on this server yet.</p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Bell className="w-4 h-4 text-emerald-400" /> What to send</div>
              <Toggle
                checked={prefs.reminders_enabled}
                onChange={(v) => set('reminders_enabled', v)}
                title="Shift reminders"
                body="The day before and 2 hours before each shift you're booked on."
              />
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">New shifts at venues I've worked</label>
                <select value={prefs.new_shift_alerts} onChange={(e) => set('new_shift_alerts', e.target.value)} className={inputCls}>
                  <option value="daily">Once a day (morning email)</option>
                  <option value="instant">Right away</option>
                  <option value="off">Don't tell me</option>
                </select>
              </div>
              {prefs.is_manager && (
                <Toggle
                  checked={prefs.manager_alerts_email}
                  onChange={(v) => set('manager_alerts_email', v)}
                  title="Manager alerts by email"
                  body="New requests, hand-offs waiting, people who haven't clocked in or read an update."
                />
              )}
            </div>

            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Moon className="w-4 h-4 text-emerald-400" /> Quiet hours</div>
              <Toggle
                checked={quietOn}
                onChange={setQuietOn}
                title="Hold non-urgent email and texts overnight"
                body="Urgent ones (cancellations, last-minute changes) still come through."
              />
              {quietOn && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">From</label>
                    <select value={prefs.quiet_start ?? 22} onChange={(e) => set('quiet_start', Number(e.target.value))} className={inputCls}>
                      {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Until</label>
                    <select value={prefs.quiet_end ?? 7} onChange={(e) => set('quiet_end', Number(e.target.value))} className={inputCls}>
                      {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">My timezone</label>
                <select value={prefs.timezone} onChange={(e) => set('timezone', e.target.value)} className={inputCls}>
                  {TIMEZONE_OPTIONS.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
```

---

## C2. NEW FILE `frontend/src/components/NotificationBell.jsx`

```jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, CheckCheck, Settings, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import NotificationSettingsModal from './NotificationSettingsModal';

const POLL_MS = 60000;

function timeAgo(value) {
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/**
 * Phase 28: Bell in the navbar. Polls the unread count every minute (and when the tab regains focus),
 * shows the latest notifications, opens the linked screen, and opens notification settings
 * (also when the URL has ?notifications=settings, e.g. from an email footer).
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const panelRef = useRef(null);

  const loadCount = useCallback(async () => {
    try {
      const res = await api.get('/notifications/unread-count');
      setCount(res.data?.count || 0);
    } catch (e) {
      /* not signed in / offline: keep the last value */
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications', { params: { limit: 30 } });
      setItems(res.data || []);
    } catch (e) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, POLL_MS);
    const onFocus = () => document.visibilityState === 'visible' && loadCount();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [loadCount]);

  // Refresh when the page changes (e.g. after acting on something)
  useEffect(() => {
    loadCount();
  }, [location.pathname, loadCount]);

  // ?notifications=settings opens the settings (email footer link)
  useEffect(() => {
    if (searchParams.get('notifications') === 'settings') {
      setShowSettings(true);
      const next = new URLSearchParams(searchParams);
      next.delete('notifications');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Close the panel on outside click
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadItems();
  };

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read) {
      try {
        const res = await api.post(`/notifications/${n.id}/read`);
        setCount(res.data?.count ?? Math.max(0, count - 1));
      } catch (e) {
        /* ignore */
      }
    }
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    try {
      await api.post('/notifications/read-all');
      setCount(0);
      setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    } catch (e) {
      /* ignore */
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={count ? `${count} unread notifications` : 'Notifications'}
        className="relative p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/80 transition"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed sm:absolute left-2 right-2 sm:left-auto sm:right-0 top-16 sm:top-auto sm:mt-2 sm:w-96 z-[70] rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <span className="text-sm font-bold text-white">Notifications</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={readAll} title="Mark all as read"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
                <CheckCheck className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => { setOpen(false); setShowSettings(true); }} title="Notification settings"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-800">
            {loading && items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">You're all caught up.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-800/70 transition flex gap-3 ${n.read ? 'opacity-70' : ''}`}
                >
                  <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${n.read ? 'bg-transparent' : n.urgent ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {n.urgent && !n.read && <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />}
                      <span className={`text-sm ${n.read ? 'text-slate-300' : 'text-white font-semibold'}`}>{n.title}</span>
                    </span>
                    {n.body && <span className="block text-xs text-slate-400 mt-0.5 whitespace-pre-line line-clamp-3">{n.body}</span>}
                    <span className="block text-[10px] text-slate-500 mt-1">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {showSettings && <NotificationSettingsModal onClose={() => setShowSettings(false)} onSent={loadCount} />}
    </div>
  );
}
```

---

## C3. `frontend/src/components/Navbar.jsx` (EDITS)
Bell for every signed-in user (first item on the right). The admin venue dropdown now also follows venue switches made by notification links.

**Edit 1.** Find:
```jsx
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin } from 'lucide-react';

```
Replace with:
```jsx
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import NotificationBell from './NotificationBell';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin } from 'lucide-react';

```

**Edit 2.** Find:
```jsx
    }
  }, [isPlatformAdmin]);

  const handleVenueChange = (e) => {
```
Replace with:
```jsx
    }
  }, [isPlatformAdmin]);

  // Phase 28: stay in sync when a notification link switches the venue
  useEffect(() => {
    const onSwitch = (e) => {
      if (e.detail) setSelectedVenueId(e.detail);
    };
    window.addEventListener('admin_venue_changed', onSwitch);
    return () => window.removeEventListener('admin_venue_changed', onSwitch);
  }, []);

  const handleVenueChange = (e) => {
```

**Edit 3.** Find:
```jsx
          {/* Right side */}
          <div className="flex items-center space-x-2">
            {user && userRole === 'worker' && (
              <div className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
```
Replace with:
```jsx
          {/* Right side */}
          <div className="flex items-center space-x-2">
            {user && <NotificationBell />}
            {user && userRole === 'worker' && (
              <div className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
```

---

## C4. `frontend/src/pages/WorkerDashboard.jsx` (EDITS)
Deep links: `?tab=` switches tab, `?event=` opens the event popout, `?request=` opens Shift Details (after a refresh so brand-new bookings are there). The params are removed afterwards; `?notifications=` is left for the bell.

**Edit 1.** Find:
```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
```
Replace with:
```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
```

**Edit 2.** Find:
```jsx
    }
  };

  // ---- Phase 26.1: Find Shifts (one card per event) ------------------------------------
```
Replace with:
```jsx
    }
  };

  // ---- Phase 28: deep links from notifications (?tab=, ?request=, ?event=) ----------------
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingDeepLink, setPendingDeepLink] = useState(null);

  useEffect(() => {
    const tab = searchParams.get('tab');
    const request = searchParams.get('request');
    const event = searchParams.get('event');
    if (!tab && !request && !event) return;
    if (tab && ['find', 'calendar', 'schedule', 'transfers'].includes(tab)) setActiveTab(tab);
    if (event) setOpenListing({ eventId: event, initial: null });
    if (request) {
      setPendingDeepLink(request);
      fetchWorkerData(false); // make sure the calendar has the newest booking
    }
    const next = new URLSearchParams(searchParams);
    ['tab', 'request', 'event'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true }); // keeps ?notifications= for the bell
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (pendingDeepLink && calendarByRequest.has(pendingDeepLink)) {
      setDetailRequestId(pendingDeepLink);
      setPendingDeepLink(null);
    }
  }, [pendingDeepLink, calendarByRequest]);

  // ---- Phase 26.1: Find Shifts (one card per event) ------------------------------------
```

---

## C5. `frontend/src/pages/VenueManagerDashboard.jsx` (EDITS)
Deep links: `?venue=` switches venue (admins: via the same `admin_venue_changed` event the navbar uses), `?event=` opens that event's roster on Posted Shifts.

**Edit 1.** Find:
```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
```
Replace with:
```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
```

**Edit 2.** Find:
```jsx
  const { user } = useAuth();
  const isPlatformAdmin = ['platform_admin', 'super_admin'].includes((user?.role || '').toLowerCase());
  const initialVenue = isPlatformAdmin
    ? (localStorage.getItem('shiftboard_admin_venue_id') || user?.venue_id || null)
    : (user?.venue_id || null);

  const [venueShifts, setVenueShifts] = useState([]);
```
Replace with:
```jsx
  const { user } = useAuth();
  const isPlatformAdmin = ['platform_admin', 'super_admin'].includes((user?.role || '').toLowerCase());
  // Phase 28: notification links open /venue?venue=<id>&event=<id>
  const [searchParams, setSearchParams] = useSearchParams();
  const urlVenue = searchParams.get('venue');
  if (urlVenue && isPlatformAdmin && localStorage.getItem('shiftboard_admin_venue_id') !== urlVenue) {
    localStorage.setItem('shiftboard_admin_venue_id', urlVenue);
  }
  const initialVenue = urlVenue
    || (isPlatformAdmin
      ? (localStorage.getItem('shiftboard_admin_venue_id') || user?.venue_id || null)
      : (user?.venue_id || null));

  const [venueShifts, setVenueShifts] = useState([]);
```

**Edit 3.** Find:
```jsx
  const [dupEvent, setDupEvent] = useState(null);
  const [timesheetEventId, setTimesheetEventId] = useState(null);

  const fetchVenueData = async (venueId) => {
```
Replace with:
```jsx
  const [dupEvent, setDupEvent] = useState(null);
  const [timesheetEventId, setTimesheetEventId] = useState(null);
  const [openTarget, setOpenTarget] = useState(null); // Phase 28: { venueId, eventId } from a notification link

  const fetchVenueData = async (venueId) => {
```

**Edit 4.** Find:
```jsx
    return () => window.removeEventListener('admin_venue_changed', handleAdminVenueSwitch);
  }, []);

  const loadVenuePositions = async (venueId) => {
```
Replace with:
```jsx
    return () => window.removeEventListener('admin_venue_changed', handleAdminVenueSwitch);
  }, []);

  // Phase 28: handle ?venue= / ?event= (also when already on this page)
  useEffect(() => {
    const venue = searchParams.get('venue');
    const event = searchParams.get('event');
    if (!venue && !event) return;
    const targetVenue = venue || currentVenueId;
    if (venue && String(venue) !== String(currentVenueId)) {
      if (isPlatformAdmin) {
        localStorage.setItem('shiftboard_admin_venue_id', venue);
        window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: venue })); // listener above reloads
      } else {
        fetchVenueData(venue);
      }
    }
    if (event) setOpenTarget({ venueId: targetVenue, eventId: event });
    const next = new URLSearchParams(searchParams);
    next.delete('venue');
    next.delete('event');
    setSearchParams(next, { replace: true }); // keeps ?notifications= for the bell
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadVenuePositions = async (venueId) => {
```

**Edit 5.** Find:
```jsx
        <PostedShiftsBoard
          venueId={currentVenueId}
          refreshKey={boardRefreshKey}
          reliabilityMap={reliabilityMap}
```
Replace with:
```jsx
        <PostedShiftsBoard
          venueId={currentVenueId}
          openEventId={openTarget && String(openTarget.venueId) === String(currentVenueId) ? openTarget.eventId : null}
          onOpenedEvent={() => setOpenTarget(null)}
          refreshKey={boardRefreshKey}
          reliabilityMap={reliabilityMap}
```

---

## C6. `frontend/src/components/PostedShiftsBoard.jsx` (EDITS)
New props `openEventId` / `onOpenedEvent`: once the list for the current venue has loaded, open that event; if it isn't in Upcoming, switch to All and look again; if it's gone, give up quietly.

**Edit 1.** Find:
```jsx
  actionLoading,
  timeZone,
}) {
  const [scope, setScope] = useState('upcoming');
```
Replace with:
```jsx
  actionLoading,
  timeZone,
  openEventId = null,      // Phase 28: open this event's roster once it loads (notification link)
  onOpenedEvent,
}) {
  const [scope, setScope] = useState('upcoming');
```

**Edit 2.** Find:
```jsx
  const [selectedKey, setSelectedKey] = useState(null);
  const [menuKey, setMenuKey] = useState(null);

  useEffect(() => {
```
Replace with:
```jsx
  const [selectedKey, setSelectedKey] = useState(null);
  const [menuKey, setMenuKey] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null); // `${venueId}|${scope}` of the events in state

  useEffect(() => {
```

**Edit 3.** Find:
```jsx
      .get(`/venues/${venueId}/events`, { params: { scope } })
      .then((res) => {
        if (active) setEvents(res.data || []);
      })
      .catch((err) => {
```
Replace with:
```jsx
      .get(`/venues/${venueId}/events`, { params: { scope } })
      .then((res) => {
        if (active) {
          setEvents(res.data || []);
          setLoadedFor(`${venueId}|${scope}`);
        }
      })
      .catch((err) => {
```

**Edit 4.** Find:
```jsx
    };
  }, [venueId, scope, refreshKey]);

  const selectedEvent = useMemo(
```
Replace with:
```jsx
    };
  }, [venueId, scope, refreshKey]);

  // Phase 28: open the event from a notification link (search 'all' if it's not in this list)
  useEffect(() => {
    if (!openEventId || loading || loadedFor !== `${venueId}|${scope}`) return;
    const hit = events.find((e) => e.event_key === String(openEventId));
    if (hit) {
      setSelectedKey(hit.event_key);
      if (onOpenedEvent) onOpenedEvent();
    } else if (scope !== 'all') {
      setScope('all');
    } else if (onOpenedEvent) {
      onOpenedEvent(); // gone (deleted) — give up quietly
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEventId, events, loading, loadedFor, scope, venueId]);

  const selectedEvent = useMemo(
```

---

# PART D: Settings template

## D1. `.secrets/.secrets.env.template` (EDITS: append)
Template only. **Do not create or edit `.secrets/.secrets.env` and do not print its contents**; the user copies the new lines into it.

**Edit 1.** Find:
```bash
#   password, google.com, microsoft.com, apple.com, github.com, facebook.com, twitter.com, yahoo.com
FIREBASE_AUTH_PROVIDERS=
```
Replace with:
```bash
#   password, google.com, microsoft.com, apple.com, github.com, facebook.com, twitter.com, yahoo.com
FIREBASE_AUTH_PROVIDERS=

# ------------------------------------------------------------------------------
# Notifications (Phase 28)
# ------------------------------------------------------------------------------
# Public address of the site; used for links inside emails and texts.
APP_BASE_URL=https://dev-scheduler.jaccollective.com

# Background worker (reminders, late alerts, digests, sending). Leave true.
NOTIFICATIONS_WORKER_ENABLED=true
# Hour (in each user's own timezone) the daily "new shifts" digest goes out.
NOTIFICATIONS_DIGEST_HOUR=9

# Email: console = only printed in the backend log (safe default)
#        smtp    = any SMTP server (Gmail/Workspace app password, Mailgun, SES, ...)
#        resend  = Resend.com API
EMAIL_PROVIDER=console
EMAIL_FROM=ShiftBoard <no-reply@example.com>
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_STARTTLS=true
SMTP_SSL=false
RESEND_API_KEY=

# Text messages: off | console | twilio  (only urgent messages are ever texted)
SMS_PROVIDER=off
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

---

## E. Rebuild, settings & verification

### E1. Add the new settings (the user does this, not AGY)
Copy the new **Notifications** block from `.secrets/.secrets.env.template` into `.secrets/.secrets.env`. The defaults are safe:
- email is only printed to the backend log (`EMAIL_PROVIDER=console`)
- texts are off (`SMS_PROVIDER=off`)

Turn real sending on when ready:

* **Email via SMTP** (Google Workspace / Gmail with an *app password*, Mailgun, Amazon SES, …):
  ```
  EMAIL_PROVIDER=smtp
  EMAIL_FROM=ShiftBoard <shifts@yourdomain.com>
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_USERNAME=shifts@yourdomain.com
  SMTP_PASSWORD=<app password>
  SMTP_STARTTLS=true
  SMTP_SSL=false
  ```
  (Port 465 instead: `SMTP_SSL=true`, `SMTP_STARTTLS=false`.)
* **Email via Resend:**
  - Verify your sending domain in Resend first.
  - Then set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=re_…`, and `EMAIL_FROM` to an address on that domain.
* **Texts via Twilio:**
  - Set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER=+1…`.
  - US numbers must be registered for A2P 10DLC (or a verified toll-free number) before carriers deliver business texts reliably.
  - For a dry run, use `SMS_PROVIDER=console`: texts are printed to the log and the SMS toggle becomes available.
* `APP_BASE_URL` must be the public site address so email links work: `https://dev-scheduler.jaccollective.com` on dev.

### E2. Rebuild
**Schema changed** (3 new tables; no existing columns change). Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data:**
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(40) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT,
    link VARCHAR(300),
    venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
    event_id UUID REFERENCES shift_events(id) ON DELETE CASCADE,
    request_id UUID REFERENCES shift_requests(id) ON DELETE CASCADE,
    urgent BOOLEAN NOT NULL DEFAULT FALSE,
    dedupe_key VARCHAR(200) UNIQUE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'pending',
    digest BOOLEAN NOT NULL DEFAULT FALSE,
    send_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due ON notification_deliveries(status, send_after);

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    new_shift_alerts VARCHAR(10) NOT NULL DEFAULT 'daily',
    manager_alerts_email BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_start SMALLINT,
    quiet_end SMALLINT,
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ.)
- With keep-data, the first worker tick sends 24 h / 2 h reminders for shifts already booked inside those windows. That's expected, and it happens once.

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

**Watching it work:** `docker compose logs -f backend`
- With the console providers, every email or text shows up as an `[email:console]` / `[sms:console]` log entry.
- `Notification worker started.` appears at boot.

### Checklist
Use two browsers: manager **demo_manager@shiftboard.com**, and worker **demo_worker@shiftboard.com**.

1. **Bell:** both users see a bell at the top right. The worker opens ⚙ → Notification settings: email on, texts off, reminders on, new shifts "Once a day". Save shows **Saved.**
2. **Test:** click **Send me a test**.
   - The bell shows **1**, and the item has a red dot (urgent).
   - The backend log shows an `[email:console]` entry within about a minute.
   - Clicking the item marks it read.
3. **Settings validation:**
   - With `SMS_PROVIDER=off`, the texts toggle is disabled with "Texts aren't set up on this server yet."
   - With `SMS_PROVIDER=console`: tick texts with no phone and Save. Error: "Add a mobile number to get texts."
   - Phone `12` gives an error.
   - Phone `(555) 555-0100` saves.
4. **New shift:** the manager posts an event at **The Hippodrome** for tomorrow.
   - The worker (on that venue's team) gets **"New shift at The Hippodrome: …"** in the bell.
   - Clicking it opens the event popout.
   - With "Once a day", no email goes out now. It goes as one digest at 9 AM in the worker's timezone.
5. **Request (needs approval):** the worker requests a position that isn't instant.
   - The manager's bell shows **"<worker> requested <position>"**.
   - Clicking opens Posted Shifts with that event's roster open. If the admin/manager was on the other venue, it switches venue first.
6. **Approve:** the worker gets **"You're confirmed: …"**. Clicking opens the Calendar tab with Shift Details for that booking.
7. **Instant booking:** booking an instant position sends **no** manager notification.
8. **Edit after booking:** the manager edits the event (change the time or add staff-only notes). The booked worker gets **"Updated: …"** with the change text. It's urgent (red) if the shift is within 48 h.
9. **Global location edit** (Phase 27 flow): booked workers on upcoming events at that location get **"Updated: …"**.
10. **Cancel a position** with reason "Low sales": the booked worker gets **"Cancelled: …"** with "Reason: Low sales" (urgent).
11. **Remove a person** from the time sheet / roster: they get **"Removed from …"** (urgent).
12. **Hand-off:**
    - worker1 offers a shift to worker2 → worker2 gets "… wants to hand you a shift".
    - worker2 accepts → the manager gets **"Hand-off waiting"**, and worker1 gets "accepted your hand-off".
    - The manager approves → worker2 gets "You're confirmed", and worker1 gets "Hand-off approved".
13. **Reminders:** book a shift more than 24 h out, then check again once it's within 24 h.
    - Within a minute, exactly **one** "Tomorrow: …" appears.
    - Within 2 h of the start, exactly one urgent **"Starts soon: …"** appears.
    - If the latest info wasn't read, both include "You haven't read the latest shift info yet."
    - **Quick test:** post a shift starting in about 25 h, book it, then edit its start to about 23 h.
14. **Not clocked in:** 10 minutes after a booked shift starts with no clock-in:
    - the worker gets **"You haven't clocked in"** (urgent)
    - the manager gets **"<worker> hasn't clocked in"**
    - each happens once
15. **Unread update:** a worker booked on a shift within 24 h hasn't tapped "Got it" on an edit. The manager gets **"1 person hasn't read the update: …"** once for that edit.
16. **Quiet hours:**
    - Set quiet hours covering now, then trigger a non-urgent notification (e.g. approve a request). The bell updates immediately, but the email waits until quiet hours end.
    - An urgent one (cancel) emails right away.
    - Reading the item in the app before quiet hours end means that email is skipped.
17. **Email footer link:** opening `APP_BASE_URL/worker?notifications=settings` opens the settings modal.
18. **Mark all read:** the ✓✓ button clears the count to 0.
19. **Robustness:** with `EMAIL_PROVIDER=smtp` and a wrong password, bookings and edits still succeed.
    - The log shows the failed send, retried up to 5 times.
    - The bell still works.