"""
Phase 29.1: The venue activity log ("what happened here, and who did it").

Every public helper opens its own session, commits, and NEVER raises, so call it AFTER the
main action has committed (same rule as notify_events). record_in() works inside a session
you already have (no commit) - used by the background worker.

Categories (for the filter chips on the dashboard):
  bookings  - requests, instant bookings, approvals, denials, withdrawals, drops, removals, hand-offs
  staffing  - direct assigns and offers
  team      - team changes, invites, joins, co-managers
  changes   - events posted / edited / cancelled / copied, venue settings
  alerts    - not clocked in
"""
import logging
from typing import Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import AsyncSessionLocal
from src.models import VenueActivity, Shift, ShiftEvent, ShiftRequest, User, Venue

logger = logging.getLogger("shiftboard.activity")

CATEGORY = {
    "request_created": "bookings",
    "instant_booked": "bookings",
    "request_approved": "bookings",
    "request_denied": "bookings",
    "request_withdrawn": "bookings",
    "shift_dropped": "bookings",
    "person_removed": "bookings",
    "transfer_approved": "bookings",
    "transfer_denied": "bookings",
    "assigned": "staffing",
    "offers_sent": "staffing",
    "offer_accepted": "staffing",
    "offer_nobody": "staffing",
    "team_added": "team",
    "team_account": "team",
    "team_status": "team",
    "invites_sent": "team",
    "team_joined": "team",
    "manager_added": "team",
    "manager_removed": "team",
    "event_created": "changes",
    "event_updated": "changes",
    "event_cancelled": "changes",
    "position_cancelled": "changes",
    "event_duplicated": "changes",
    "venue_settings": "changes",
    "not_clocked_in": "alerts",
}
CATEGORIES = ("bookings", "staffing", "team", "changes", "alerts")


def person(u: Optional[User]) -> str:
    if u is None:
        return "Someone"
    name = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return name or (u.email or "Someone")


def short_when(start, venue: Optional[Venue]) -> str:
    try:
        tz = ZoneInfo((venue.timezone if venue else None) or "America/New_York")
    except Exception:
        tz = ZoneInfo("America/New_York")
    return start.astimezone(tz).strftime("%a %b %-d")


async def record_in(
    db: AsyncSession,
    venue_id,
    kind: str,
    summary: str,
    *,
    actor_id=None,
    event_id=None,
    request_id=None,
    worker_id=None,
) -> None:
    """Adds one log line inside `db`. Does NOT commit."""
    db.add(VenueActivity(
        venue_id=venue_id,
        actor_user_id=actor_id,
        kind=kind,
        category=CATEGORY.get(kind, "changes"),
        summary=(summary or "")[:400],
        event_id=event_id,
        request_id=request_id,
        worker_id=worker_id,
    ))
    await db.flush()


async def _run(label: str, fn, *args, **kwargs) -> None:
    try:
        async with AsyncSessionLocal() as db:
            await fn(db, *args, **kwargs)
            await db.commit()
    except Exception:
        logger.exception(f"activity '{label}' failed")


# ---------------------------------------------------------------------------------------------
# Public helpers (own session, never raise)
# ---------------------------------------------------------------------------------------------
async def _for_request(db: AsyncSession, kind: str, request_id, actor_id, extra: str) -> None:
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if req is None:
        return
    shift = await db.scalar(select(Shift).where(Shift.id == req.shift_id))
    if shift is None:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
    worker = await db.scalar(select(User).where(User.id == req.worker_id))
    what = f"{shift.role_type} · {event.title if event else shift.title} ({short_when(shift.start_time, venue)})"
    name = person(worker)
    text = {
        "request_created": f"{name} requested {what}",
        "instant_booked": f"{name} booked {what} (instant)",
        "request_approved": f"Approved {name} for {what}",
        "request_denied": f"Declined {name} for {what}",
        "request_withdrawn": f"{name} withdrew their request for {what}",
        "shift_dropped": f"{name} dropped {what}",
        "person_removed": f"Removed {name} from {what}",
        "assigned": f"Assigned {name} to {what}",
        "offer_accepted": f"{name} accepted the offer for {what}",
    }.get(kind, f"{name}: {what}")
    if extra:
        text += f" · {extra}"
    await record_in(db, shift.venue_id, kind, text, actor_id=actor_id, event_id=shift.event_id,
                    request_id=req.id, worker_id=req.worker_id)


async def for_request(kind: str, request_id, actor_id=None, extra: str = "") -> None:
    await _run(kind, _for_request, kind, request_id, actor_id, extra)


async def _for_shift(db: AsyncSession, kind: str, shift_id, actor_id, text_fmt: str) -> None:
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if shift is None:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
    what = f"{shift.role_type} · {event.title if event else shift.title} ({short_when(shift.start_time, venue)})"
    await record_in(db, shift.venue_id, kind, text_fmt.format(what=what), actor_id=actor_id, event_id=shift.event_id)


async def for_shift(kind: str, shift_id, actor_id=None, text_fmt: str = "{what}") -> None:
    """text_fmt may use {what} = 'Role · Event (Sat Oct 4)'."""
    await _run(kind, _for_shift, kind, shift_id, actor_id, text_fmt)


async def _for_event(db: AsyncSession, kind: str, event_id, actor_id, extra: str) -> None:
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if event is None:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
    what = f"{event.title} ({short_when(event.start_time, venue)})"
    text = {
        "event_created": f"Posted {what}",
        "event_updated": f"Edited {what}",
        "event_cancelled": f"Cancelled {what}",
        "position_cancelled": f"Cancelled a position in {what}",
        "event_duplicated": f"Copied {what}",
    }.get(kind, what)
    if extra:
        text += f" · {extra}"
    await record_in(db, event.venue_id, kind, text, actor_id=actor_id, event_id=event.id)


async def for_event(kind: str, event_id, actor_id=None, extra: str = "") -> None:
    await _run(kind, _for_event, kind, event_id, actor_id, extra)


async def _for_worker(db: AsyncSession, kind: str, venue_id, worker_id, actor_id, text_fmt: str) -> None:
    worker = await db.scalar(select(User).where(User.id == worker_id))
    await record_in(db, venue_id, kind, text_fmt.format(name=person(worker)), actor_id=actor_id, worker_id=worker_id)


async def for_worker(kind: str, venue_id, worker_id, actor_id=None, text_fmt: str = "{name}") -> None:
    """text_fmt may use {name} = the worker's name."""
    await _run(kind, _for_worker, kind, venue_id, worker_id, actor_id, text_fmt)


async def _for_venue(db: AsyncSession, kind: str, venue_id, actor_id, text: str) -> None:
    await record_in(db, venue_id, kind, text, actor_id=actor_id)


async def for_venue(kind: str, venue_id, actor_id=None, text: str = "") -> None:
    await _run(kind, _for_venue, kind, venue_id, actor_id, text)
