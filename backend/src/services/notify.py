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
import asyncio
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
from src.models import Notification, NotificationDelivery, NotificationPreference, User, PushSubscription
from src.auth import normalize_role
from src.services import webpush                                   # Phase 33
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
    "assigned": ("booking", True),           # Phase 29: a manager booked you
    "shift_offered": ("booking", True),      # Phase 29: offered to you (first to accept wins)
    "offer_update": ("manager", False),      # Phase 29: offer accepted / nobody took it
    "team_joined": ("manager", False),       # Phase 29: someone joined through an invite
    "team_added": ("booking", False),        # Phase 29.1: a manager added you to their team
    "shift_dropped": ("manager", True),      # Phase 29.1: a worker dropped a booked shift
    "no_show": ("booking", True),            # Phase 30: a manager marked you a no-show
    "unfilled_soon": ("manager", True),      # Phase 30: spots still open 3 h before start
    "time_off_conflict": ("manager", True),  # Phase 32.1: a worker blocked off time they're booked for
    "cert_review": ("booking", False),       # Phase 32: a manager verified / didn't accept a certificate
    "cert_expiring": ("reminder", False),    # Phase 32: a certificate expires in 30 / 7 days, or today
    "cover_needed": ("booking", True),       # Phase 34: a teammate needs someone to cover their shift
    "cover_update": ("booking", False),      # Phase 34: your cover request was taken / approved / not approved
    "cover_warning": ("booking", True),      # Phase 34: nobody has taken your shift 12 h / 3 h before it starts
    "cover_manager": ("manager", True),      # Phase 34: managers: cover asked / covered / still uncovered
    "waitlist_offer": ("booking", True),     # Phase 34: a spot opened and you're next (short time to take it)
    "waitlist_update": ("booking", False),   # Phase 34: booked / request sent / offer ran out / waitlist closed
    "shift_message": ("booking", True),      # Phase 36: a manager or shift lead sent an update to everyone booked on the shift
    "test": ("test", True),
}
NEW_SHIFT_MODES = ("off", "instant", "daily")
MAX_ATTEMPTS = 5

DEFAULT_PREFS = dict(
    email_enabled=True, sms_enabled=False, reminders_enabled=True, new_shift_alerts="daily",
    manager_alerts_email=True, quiet_start=None, quiet_end=None, timezone="America/New_York",
    push_enabled=True,                                    # Phase 33
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
        "title": (n.title or "ShiftUp")[:120],
        "body": body[:240],
        "url": n.link or "/",
        "tag": str(n.id),
        "urgent": bool(n.urgent),
    }


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
    with_devices = set((await db.execute(                                   # Phase 33: users with push turned on somewhere
        select(PushSubscription.user_id).where(PushSubscription.user_id.in_([u.id for u in users])).distinct()
    )).scalars().all()) if users else set()
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
        if u.id in with_devices and wants_push(kind, p):                    # Phase 33
            db.add(NotificationDelivery(
                notification_id=nid, user_id=u.id, channel="push", digest=False,
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


def _sms_text(n: Notification) -> str:
    first = (n.body or "").strip().split("\n")[0]
    parts = [f"ShiftUp: {n.title}."]
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
        .with_for_update(of=NotificationDelivery, skip_locked=True)     # Phase 33: two senders never take the same row
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
        elif d.channel == "push":                                          # Phase 33
            reached, err = await webpush.send_to_user(db, u.id, push_payload(n), urgent=bool(n.urgent))
            if reached == 0 and err == "No devices turned on":
                d.status = "skipped"
                d.last_error = err
                continue
            ok = reached > 0
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
