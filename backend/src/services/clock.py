"""
Phase 27: Clock-in / clock-out rules.

Window  : clock-in opens `venue.clock_in_early_minutes` before start and closes at the scheduled end.
          Late arrivals can still clock in (flagged late after LATE_GRACE).
Geofence: only when on for the event (event.geofence_mode, else venue.geofence_enabled).
            inside radius             -> accepted, 'on_site'
            inside radius + buffer    -> accepted, 'outside_geofence' (flagged for the manager)
            beyond the buffer         -> BLOCKED (clock-in only)
            no location from phone    -> BLOCKED (clock-in only)
          Clock-out is never blocked; it's just recorded / flagged.
Undo    : clocking out under a minute after clocking in removes the entry (a mis-tap).
Auto    : open entries are closed at the scheduled end once `venue.auto_clock_out_hours` have passed.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, TimeEntry, User, Venue, VenueLocation
from src.schemas import ClockBody, ClockResult, TimeEntryResponse
from src.services.locations import geofence_on, effective_place, haversine_m, fmt_distance

logger = logging.getLogger("shiftboard.clock")

BOOKED_STATUSES = ("approved", "confirmed", "checked_in")
LATE_GRACE = timedelta(minutes=10)
UNDO_WINDOW = timedelta(seconds=60)


def as_utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def late_minutes(clock_in, shift_start) -> int:
    if clock_in is None or shift_start is None:
        return 0
    diff = as_utc(clock_in) - as_utc(shift_start)
    return int(diff.total_seconds() // 60) if diff > LATE_GRACE else 0


def clock_in_opens_at(shift: Shift, venue: Venue) -> datetime:
    return as_utc(shift.start_time) - timedelta(minutes=int(venue.clock_in_early_minutes or 0))


def _local_time(dt: datetime, venue: Venue) -> str:
    try:
        tz = ZoneInfo(venue.timezone or "America/New_York")
    except Exception:
        tz = ZoneInfo("America/New_York")
    local = as_utc(dt).astimezone(tz)
    today = datetime.now(timezone.utc).astimezone(tz).date()
    time_txt = local.strftime("%-I:%M %p")
    return time_txt if local.date() == today else f"{local.strftime('%a %b %-d')}, {time_txt}"


async def _context(db: AsyncSession, shift_id) -> Tuple[Shift, Venue, Optional[ShiftEvent], Optional[VenueLocation]]:
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found.")
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
    location = None
    if event is not None and event.location_id:
        location = await db.scalar(select(VenueLocation).where(VenueLocation.id == event.location_id))
    return shift, venue, event, location


def _judge(body: Optional[ClockBody], venue: Venue, place: dict) -> Tuple[str, Optional[int], Optional[float], Optional[float]]:
    """Returns (geo_status, distance_m, lat, lng). geo_status 'blocked_far' / 'blocked_no_fix' mean block (clock-in)."""
    lat = body.latitude if body else None
    lng = body.longitude if body else None
    if lat is None or lng is None:
        return "blocked_no_fix", None, None, None
    if place["lat"] is None or place["lng"] is None:
        return "not_checked", None, lat, lng
    d = haversine_m(float(lat), float(lng), float(place["lat"]), float(place["lng"]))
    radius = int(place["radius"] or 100)
    buffer = int(venue.geofence_buffer_meters or 0)
    if d <= radius:
        return "on_site", int(round(d)), lat, lng
    if d <= radius + buffer:
        return "outside_geofence", int(round(d)), lat, lng
    return "blocked_far", int(round(d)), lat, lng


async def clock_in(db: AsyncSession, user: User, shift_id, body: Optional[ClockBody]) -> ClockResult:
    await auto_close_open_entries(db, worker_id=user.id)
    shift, venue, event, location = await _context(db, shift_id)

    req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == shift.id,
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
        )
    )
    if req is None:
        raise HTTPException(status_code=400, detail="You're not booked on this shift.")

    open_entry = await db.scalar(
        select(TimeEntry).where(
            TimeEntry.shift_id == shift.id,
            TimeEntry.worker_id == user.id,
            TimeEntry.clock_out_time.is_(None),
        )
    )
    if open_entry is not None:
        return ClockResult(
            status="already_clocked_in",
            message="You're already clocked in.",
            entry=TimeEntryResponse.model_validate(open_entry),
            geo_status=open_entry.clock_in_geo_status,
            distance_m=open_entry.clock_in_distance_m,
            late_minutes=late_minutes(open_entry.clock_in_time, shift.start_time),
        )

    if (shift.status or "").upper() == "CANCELLED" or (event is not None and event.cancelled_at is not None):
        raise HTTPException(status_code=400, detail="This shift was cancelled.")

    now = datetime.now(timezone.utc)
    opens = clock_in_opens_at(shift, venue)
    if now < opens:
        raise HTTPException(status_code=400, detail=f"Too early. You can clock in from {_local_time(opens, venue)}.")
    if now >= as_utc(shift.end_time):
        raise HTTPException(status_code=400, detail="This shift has already ended. Ask your manager to add your hours.")

    geo_status, distance, lat, lng = "not_checked", None, None, None
    place = effective_place(venue, location)
    if geofence_on(event, venue):
        geo_status, distance, lat, lng = _judge(body, venue, place)
        if geo_status == "blocked_no_fix":
            raise HTTPException(
                status_code=400,
                detail="This shift needs your location to clock in. Turn on location for this site in your browser settings and try again.",
            )
        if geo_status == "blocked_far":
            raise HTTPException(
                status_code=400,
                detail=f"You're {fmt_distance(distance)} from {place['name']}. Clock in when you arrive. "
                       "If you're already there, move closer to the entrance or ask your manager to clock you in.",
            )

    try:
        entry = TimeEntry(
            worker_id=user.id,
            shift_id=shift.id,
            clock_in_time=now,
            clock_in_lat=lat,
            clock_in_lng=lng,
            clock_in_distance_m=distance,
            clock_in_geo_status=geo_status,
        )
        db.add(entry)
        req.status = "checked_in"
        if not req.check_in_time:
            req.check_in_time = now
        req.check_in_verified = geo_status == "on_site"
        await db.commit()
        await db.refresh(entry)
    except Exception as e:
        await db.rollback()
        logger.exception("clock_in failed")
        raise HTTPException(status_code=500, detail=f"Could not clock in: {e}")

    late = late_minutes(now, shift.start_time)
    if geo_status == "outside_geofence":
        msg = f"Clocked in. You're {fmt_distance(distance)} from {place['name']}, so your manager will see this clock-in flagged."
    else:
        msg = "Clocked in. Have a great shift!"
    if late:
        msg += f" (Recorded {late} min after start.)"
    return ClockResult(
        status="clocked_in", message=msg, entry=TimeEntryResponse.model_validate(entry),
        geo_status=geo_status, distance_m=distance, late_minutes=late,
    )


async def clock_out(db: AsyncSession, user: User, shift_id, body: Optional[ClockBody]) -> ClockResult:
    shift, venue, event, location = await _context(db, shift_id)
    entry = await db.scalar(
        select(TimeEntry).where(
            TimeEntry.shift_id == shift.id,
            TimeEntry.worker_id == user.id,
            TimeEntry.clock_out_time.is_(None),
        )
    )
    if entry is None:
        raise HTTPException(status_code=400, detail="You're not clocked in on this shift.")
    req = await db.scalar(
        select(ShiftRequest).where(ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == user.id)
    )
    now = datetime.now(timezone.utc)

    try:
        # A mis-tap: clocked out within a minute. Remove the entry instead of logging a 0-hour shift.
        if now - as_utc(entry.clock_in_time) < UNDO_WINDOW:
            await db.execute(delete(TimeEntry).where(TimeEntry.id == entry.id))
            await db.flush()
            remaining = await db.scalar(
                select(func.count(TimeEntry.id)).where(TimeEntry.shift_id == shift.id, TimeEntry.worker_id == user.id)
            )
            if req is not None and not remaining:
                req.status = "approved"
                req.check_in_time = None
                req.check_in_verified = False
            await db.commit()
            return ClockResult(status="undone", message="Clock-in undone (that was under a minute).")

        geo_status, distance, lat, lng = "not_checked", None, None, None
        if geofence_on(event, venue) and body is not None and body.latitude is not None:
            geo_status, distance, lat, lng = _judge(body, venue, effective_place(venue, location))
            if geo_status == "blocked_far":
                geo_status = "outside_geofence"   # never block a clock-out; just flag it
            if geo_status == "blocked_no_fix":
                geo_status = "not_checked"

        entry.clock_out_time = now
        entry.clock_out_lat = lat
        entry.clock_out_lng = lng
        entry.clock_out_distance_m = distance
        entry.clock_out_geo_status = geo_status
        if req is not None:
            was_completed = (req.status or "").lower() == "completed"
            req.status = "completed"
            req.check_out_time = now
            req.check_out_verified = geo_status == "on_site"
            if not was_completed:
                user.total_shifts = (user.total_shifts or 0) + 1
        await db.commit()
        await db.refresh(entry)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("clock_out failed")
        raise HTTPException(status_code=500, detail=f"Could not clock out: {e}")

    return ClockResult(
        status="clocked_out", message="Clocked out. Thanks for your shift!",
        entry=TimeEntryResponse.model_validate(entry), geo_status=geo_status, distance_m=distance,
    )


async def auto_close_open_entries(db: AsyncSession, venue_id=None, worker_id=None) -> int:
    """
    Closes entries still open `venue.auto_clock_out_hours` after the scheduled end.
    The clock-out is set to the SCHEDULED END and flagged (auto_closed=True, status 'auto').
    Safe to call from any endpoint; failures are logged and never break the caller.
    """
    now = datetime.now(timezone.utc)
    q = (
        select(TimeEntry, Shift, Venue)
        .join(Shift, TimeEntry.shift_id == Shift.id)
        .join(Venue, Venue.id == Shift.venue_id)
        .where(TimeEntry.clock_out_time.is_(None), Shift.end_time < now)
    )
    if venue_id is not None:
        q = q.where(Shift.venue_id == venue_id)
    if worker_id is not None:
        q = q.where(TimeEntry.worker_id == worker_id)
    try:
        rows = (await db.execute(q)).all()
        closed = 0
        for entry, shift, venue in rows:
            end = as_utc(shift.end_time)
            if now < end + timedelta(hours=int(venue.auto_clock_out_hours or 2)):
                continue
            entry.clock_out_time = max(end, as_utc(entry.clock_in_time))
            entry.clock_out_geo_status = "auto"
            entry.auto_closed = True
            req = await db.scalar(
                select(ShiftRequest).where(ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == entry.worker_id)
            )
            if req is not None and (req.status or "").lower() == "checked_in":
                req.status = "completed"
                req.check_out_time = entry.clock_out_time
                worker = await db.scalar(select(User).where(User.id == entry.worker_id))
                if worker is not None:
                    worker.total_shifts = (worker.total_shifts or 0) + 1
            closed += 1
        if closed:
            await db.commit()
        return closed
    except Exception:
        await db.rollback()
        logger.exception("auto_close_open_entries failed")
        return 0
