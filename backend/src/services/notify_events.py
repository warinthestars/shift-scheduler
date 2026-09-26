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
