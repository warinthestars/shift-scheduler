"""
Phase 26.2: The worker's own calendar, plus "did they read it?" tracking.

A booked worker must acknowledge the shift info when:
* the shift has any notes they haven't acknowledged yet (venue, event, position or staff-only notes), or
* the manager changed the time / notes / pay after the worker booked or last acknowledged.
Staff-only notes are shown only to people BOOKED on the shift (and to managers / admins).
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, Venue, TimeEntry, User
from src.schemas import WorkerCalendarItem, WorkerCalendarResponse, ListingVenue
from src.services.booking import as_utc, ASSIGNED_STATUSES, PENDING_STATUSES

CALENDAR_STATUSES = PENDING_STATUSES + ASSIGNED_STATUSES + ("cancelled", "removed", "no_show")
DEFAULT_PAST = timedelta(days=60)
DEFAULT_FUTURE = timedelta(days=180)
MAX_SPAN = timedelta(days=400)


def latest_info_update(event: Optional[ShiftEvent], shift: Shift) -> Optional[datetime]:
    stamps = [as_utc(d) for d in (
        event.info_updated_at if event is not None else None,
        shift.info_updated_at,
    ) if d is not None]
    return max(stamps) if stamps else None


def info_change_text(event: Optional[ShiftEvent], shift: Shift) -> Optional[str]:
    parts = []
    if event is not None and event.info_change:
        parts.append(event.info_change)
    if shift.info_change:
        parts.append(f"{shift.role_type}: {shift.info_change}")
    return " · ".join(parts) or None


def has_any_notes(venue: Optional[Venue], event: Optional[ShiftEvent], shift: Shift) -> bool:
    values = [shift.description, shift.staff_notes]
    if event is not None:
        values += [event.notes, event.staff_notes]
    if venue is not None:
        values += [venue.default_shift_notes, venue.dress_code, venue.arrival_instructions]
    return any((v or "").strip() for v in values)


def needs_ack(
    *,
    booked: bool,
    has_notes: bool,
    updated_at: Optional[datetime],
    seen_at: Optional[datetime],
    booked_at: Optional[datetime],
) -> bool:
    """True = show the "Please read" flag until the worker taps "Got it"."""
    if not booked:
        return False
    if seen_at is None:
        if has_notes:
            return True
        return updated_at is not None and booked_at is not None and as_utc(updated_at) > as_utc(booked_at)
    return updated_at is not None and as_utc(updated_at) > as_utc(seen_at)


async def build_worker_calendar(
    db: AsyncSession,
    user: User,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> WorkerCalendarResponse:
    now = datetime.now(timezone.utc)
    range_start = as_utc(start) if start else now - DEFAULT_PAST
    range_end = as_utc(end) if end else now + DEFAULT_FUTURE
    if range_end <= range_start:
        raise HTTPException(status_code=400, detail="end must be after start.")
    if range_end - range_start > MAX_SPAN:
        raise HTTPException(status_code=400, detail="Pick a range of 400 days or less.")

    rows = (await db.execute(
        select(ShiftRequest, Shift)
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(CALENDAR_STATUSES),
            Shift.start_time < range_end,
            Shift.end_time > range_start,
        )
        .order_by(Shift.start_time.asc())
    )).all()
    if not rows:
        return WorkerCalendarResponse(range_start=range_start, range_end=range_end, unread_count=0, items=[])

    shifts = [s for _, s in rows]
    event_ids = {s.event_id for s in shifts if s.event_id}
    venue_ids = {s.venue_id for s in shifts}
    events = {}
    if event_ids:
        events = {e.id: e for e in (await db.execute(
            select(ShiftEvent).where(ShiftEvent.id.in_(event_ids))
        )).scalars().all()}
    venues = {v.id: v for v in (await db.execute(
        select(Venue).where(Venue.id.in_(venue_ids))
    )).scalars().all()}

    open_entries = set((await db.execute(
        select(TimeEntry.shift_id).where(
            TimeEntry.worker_id == user.id,
            TimeEntry.shift_id.in_([s.id for s in shifts]),
            TimeEntry.clock_out_time.is_(None),
        )
    )).scalars().all())

    items: List[WorkerCalendarItem] = []
    for req, s in rows:
        venue = venues.get(s.venue_id)
        if venue is None:
            continue
        event = events.get(s.event_id) if s.event_id else None
        status = (req.status or "").lower()
        booked = status in ASSIGNED_STATUSES
        start_utc, end_utc = as_utc(s.start_time), as_utc(s.end_time)
        hours = round(max(0.0, (end_utc - start_utc).total_seconds() / 3600.0), 2)

        show_pay = booked or not s.hide_rate
        ev_staff = event.staff_notes if event is not None else None
        updated = latest_info_update(event, s)
        seen = req.info_seen_at
        booked_at = req.approved_at or req.created_at
        flag = needs_ack(
            booked=booked,
            has_notes=has_any_notes(venue, event, s),
            updated_at=updated,
            seen_at=seen,
            booked_at=booked_at,
        )
        # Only describe changes the worker hasn't seen, and only ones made after they booked.
        change = None
        if booked and updated is not None:
            reference = seen or booked_at
            if reference is None or updated > as_utc(reference):
                change = info_change_text(event, s)

        items.append(WorkerCalendarItem(
            request_id=req.id,
            shift_id=s.id,
            event_id=s.event_id,
            status=status,
            status_reason=req.status_reason,
            booked=booked,
            title=(event.title if event is not None else s.title) or "Shift",
            role_type=s.role_type or "Worker",
            start_time=s.start_time,
            end_time=s.end_time,
            hours=hours,
            venue=ListingVenue(
                id=venue.id,
                name=venue.name,
                address=venue.address,
                timezone=venue.timezone or "America/New_York",
                logo_url=venue.logo_url,
                phone=venue.phone,
                lat=float(venue.lat) if venue.lat is not None else None,
                lng=float(venue.lng) if venue.lng is not None else None,
                dress_code=venue.dress_code,
                arrival_instructions=venue.arrival_instructions,
                default_shift_notes=venue.default_shift_notes,
            ),
            hourly_rate=float(s.hourly_rate) if (show_pay and s.hourly_rate is not None) else None,
            hourly_rate_max=float(s.hourly_rate_max) if (show_pay and s.hourly_rate_max is not None) else None,
            pay_rate=float(req.pay_rate) if (booked and req.pay_rate is not None) else None,
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            event_notes=event.notes if event is not None else None,
            role_notes=s.description,
            event_staff_notes=ev_staff if booked else None,
            position_staff_notes=s.staff_notes if booked else None,
            staff_notes_locked=(not booked) and bool((ev_staff or "").strip() or (s.staff_notes or "").strip()),
            info_change=change,
            info_updated_at=updated,
            info_seen_at=seen,
            needs_ack=flag,
            clocked_in=(status == "checked_in") or (s.id in open_entries),
            cancelled=(event is not None and event.cancelled_at is not None) or (s.status or "").upper() == "CANCELLED",
            cancel_reason=(event.cancel_reason if event is not None and event.cancelled_at is not None else s.cancel_reason),
        ))

    unread = sum(1 for i in items if i.needs_ack and as_utc(i.end_time) > now)
    return WorkerCalendarResponse(range_start=range_start, range_end=range_end, unread_count=unread, items=items)


async def acknowledge_info(db: AsyncSession, user: User, request_id: UUID) -> datetime:
    """Worker taps "Got it". Only for their own booked shifts. Commits."""
    try:
        req = await db.scalar(
            select(ShiftRequest).where(ShiftRequest.id == request_id, ShiftRequest.worker_id == user.id)
        )
        if req is None:
            raise HTTPException(status_code=404, detail="Shift not found.")
        if (req.status or "").lower() not in ASSIGNED_STATUSES:
            raise HTTPException(status_code=400, detail="Only booked shifts can be marked as read.")
        stamp = datetime.now(timezone.utc)
        req.info_seen_at = stamp
        await db.commit()
        return stamp
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")
