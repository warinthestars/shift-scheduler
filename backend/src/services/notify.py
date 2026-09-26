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
