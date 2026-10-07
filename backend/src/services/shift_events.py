"""
Phase 25.2: Create / update / describe events (one posting with 1+ positions).
Each position is a row in `shifts` linked by shifts.event_id.
"""
from datetime import timezone, datetime, date, timedelta
from typing import Dict, Tuple, List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, func, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ShiftEvent, Shift, ShiftRequest, ShiftOffer, Venue, User, VenueLocation
from src.schemas import (
    EventCreate, EventUpdate, EventPositionInput, EventDetail, EventDetailPosition,
)
from src.services.locations import (
    resolve_event_location, validate_geofence_mode, check_geofence_possible, geofence_on,
    usage_counts, to_response as location_response,
)

VALID_APPROVAL_MODES = ("venue_default", "auto", "manual")
ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
PENDING_STATUSES = ("pending", "pending_manager_approval")
ACTIVE_REQUEST_STATUSES = PENDING_STATUSES + ("approved", "confirmed")
# Phase 29.3: a draft event's positions carry shift status DRAFT, so every worker-facing query that
# only looks at OPEN positions (listings, directory, offers, new-shift alerts) skips them.
DRAFT = "draft"
PUBLISHED = "published"
# Phase 37.2: each shift of an event has its own start (call) time. It must be before the event ends
# and at most this long before the event starts. Every shift still ends when the event ends.
EARLY_START_LIMIT = timedelta(hours=12)


def _as_utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _clean(text):
    if text is None:
        return None
    text = str(text).strip()
    return text or None


def _money(v):
    return None if v is None else round(float(v), 2)


def _fmt_range(start, end, tz_name: str) -> str:
    """Phase 26.2: 'Fri Oct 3, 6:00 PM – 11:00 PM' in the venue's timezone."""
    try:
        tz = ZoneInfo(tz_name or "America/New_York")
    except Exception:
        tz = ZoneInfo("America/New_York")
    s_local = _as_utc(start).astimezone(tz)
    e_local = _as_utc(end).astimezone(tz)
    return f"{s_local.strftime('%a %b %-d, %-I:%M %p')} – {e_local.strftime('%-I:%M %p')}"


def _zone(tz_name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or "America/New_York")
    except Exception:
        return ZoneInfo("America/New_York")


def _fmt_start(at, tz_name: Optional[str], with_day: bool = False) -> str:
    """Phase 37.2: '5:00 PM' (or 'Fri Oct 3, 5:00 PM') in the venue's timezone."""
    local = _as_utc(at).astimezone(_zone(tz_name))
    return local.strftime("%a %b %-d, %-I:%M %p" if with_day else "%-I:%M %p")


def start_gap(shift_start, event_start, tz_name: Optional[str]) -> timedelta:
    """
    Phase 37.2: how long after (+) or before (-) its event's start a shift starts, measured on the
    venue's clock. A bar call at 5:00 PM for a 6:00 PM event is -1 hour, also on the night the clocks change.
    """
    tz = _zone(tz_name)
    a = _as_utc(shift_start).astimezone(tz).replace(tzinfo=None)
    b = _as_utc(event_start).astimezone(tz).replace(tzinfo=None)
    return a - b


def start_from_gap(event_start, gap: Optional[timedelta], tz_name: Optional[str]) -> datetime:
    """Phase 37.2: the event's start moved by `gap` on the venue's clock, as a UTC datetime."""
    if not gap:
        return _as_utc(event_start)
    tz = _zone(tz_name)
    local = _as_utc(event_start).astimezone(tz).replace(tzinfo=None) + gap
    return local.replace(tzinfo=tz).astimezone(timezone.utc)


def role_start(p: EventPositionInput, event_start, event_end, tz_name: Optional[str], gap: Optional[timedelta] = None) -> datetime:
    """
    Phase 37.2: when this shift starts, checked against its event.
      p.start_time given -> that time
      otherwise          -> the event's start moved by `gap` (an existing shift's gap; None for a new shift)
    """
    ev_start, ev_end = _as_utc(event_start), _as_utc(event_end)
    start = _as_utc(p.start_time) if p.start_time is not None else start_from_gap(ev_start, gap, tz_name)
    name = (p.role_type or "").strip() or "This shift"
    if start >= ev_end:
        raise HTTPException(
            status_code=400,
            detail=f"{name}: its start time ({_fmt_start(start, tz_name)}) must be before the event ends ({_fmt_start(ev_end, tz_name)}).",
        )
    if start < ev_start - EARLY_START_LIMIT:
        raise HTTPException(status_code=400, detail=f"{name}: its start time can be at most 12 hours before the event starts.")
    return start


def first_start(event: ShiftEvent, shifts) -> datetime:
    """Phase 37.2: the earliest moment anyone is due at this event (a shift can start before the event does)."""
    return min([_as_utc(event.start_time)] + [_as_utc(s.start_time) for s in shifts])


def _validate_basics(data) -> None:
    if not (data.title or "").strip():
        raise HTTPException(status_code=400, detail="Give the event a name.")
    if _as_utc(data.end_time) <= _as_utc(data.start_time):
        raise HTTPException(status_code=400, detail="End time must be after the start time.")
    if not data.positions:
        raise HTTPException(status_code=400, detail="Add at least one shift.")


def _validate_position(p: EventPositionInput) -> None:
    name = (p.role_type or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Every shift needs a position (e.g. Bartender).")
    if p.capacity is None or p.capacity < 1:
        raise HTTPException(status_code=400, detail=f"{name}: needs at least 1 spot.")
    if p.hourly_rate is None or p.hourly_rate <= 0:
        raise HTTPException(status_code=400, detail=f"{name}: pay must be more than $0.")
    if p.hourly_rate_max is not None and p.hourly_rate_max < p.hourly_rate:
        raise HTTPException(status_code=400, detail=f"{name}: the top of the pay range can't be lower than the bottom.")
    mode = (p.approval_mode or "venue_default").lower()
    if mode not in VALID_APPROVAL_MODES:
        raise HTTPException(status_code=400, detail=f"{name}: choose how requests are approved.")


def _apply_position(
    shift: Shift, p: EventPositionInput, event: ShiftEvent, track_changes: bool = False,
    start: Optional[datetime] = None, start_note: Optional[str] = None,
) -> None:
    """
    Copy form values onto a Shift row. track_changes=True (existing positions being edited)
    records what changed in shift.info_change / info_updated_at so booked workers are told (Phase 26.2).
    Phase 37.2: `start` is this shift's own start (already checked by role_start; None = the event's start).
    `start_note` is the line to tell booked workers when their start time changed.
    """
    mode = (p.approval_mode or "venue_default").lower()
    new_role = p.role_type.strip()[:100]
    new_rate_max = p.hourly_rate_max if (p.hourly_rate_max is not None and p.hourly_rate_max > p.hourly_rate) else None
    new_desc = _clean(p.role_notes)
    new_staff = _clean(p.staff_notes)

    changes = []
    if track_changes:
        if (shift.role_type or "") != new_role:
            changes.append(f"Position renamed to {new_role}")
        if _money(shift.hourly_rate) != _money(p.hourly_rate) or _money(shift.hourly_rate_max) != _money(new_rate_max):
            changes.append("Pay updated")
        if _clean(shift.description) != new_desc:
            changes.append("Position notes updated")
        if _clean(shift.staff_notes) != new_staff:
            changes.append("Staff-only notes updated")
        if start_note:
            changes.insert(0, start_note)

    shift.title = event.title
    shift.start_time = start if start is not None else event.start_time     # Phase 37.2
    shift.end_time = event.end_time
    shift.role_type = new_role
    shift.capacity = int(p.capacity)
    shift.hourly_rate = p.hourly_rate
    shift.hourly_rate_max = new_rate_max
    shift.hide_rate = bool(p.hide_rate)
    shift.tips_eligible = bool(p.tips_eligible)
    shift.tip_pool = bool(p.tips_eligible and p.tip_pool)
    shift.description = new_desc                      # description = position notes
    shift.staff_notes = new_staff                     # Phase 26.2: booked staff only
    shift.approval_mode = mode
    shift.is_shift_auto_confirm = (mode == "auto")    # kept in sync for older screens

    if changes:
        shift.info_updated_at = datetime.now(timezone.utc)
        shift.info_change = "; ".join(changes)


async def _request_counts(db: AsyncSession, shift_ids) -> Dict:
    """{shift_id: (assigned, pending)}"""
    if not shift_ids:
        return {}
    rows = (await db.execute(
        select(ShiftRequest.shift_id, func.lower(ShiftRequest.status), func.count(ShiftRequest.id))
        .where(ShiftRequest.shift_id.in_(shift_ids))
        .group_by(ShiftRequest.shift_id, func.lower(ShiftRequest.status))
    )).all()
    out: Dict = {}
    for sid, st, n in rows:
        a, p = out.get(sid, (0, 0))
        if st in ASSIGNED_STATUSES:
            a += int(n)
        elif st in PENDING_STATUSES:
            p += int(n)
        out[sid] = (a, p)
    return out


async def create_event_with_positions(
    db: AsyncSession, venue: Venue, user: User, data: EventCreate, allow_archived_location: bool = False,
) -> ShiftEvent:
    _validate_basics(data)
    for p in data.positions:
        _validate_position(p)
    mode = validate_geofence_mode(data.geofence_mode)
    is_draft = not getattr(data, "publish", True)          # Phase 29.3
    # Phase 37.2: each shift's own start time (checked before anything is saved)
    starts = [role_start(p, data.start_time, data.end_time, venue.timezone) for p in data.positions]
    try:
        # Phase 27: where is it? (a typed-in new location is saved to the venue's list here)
        location = await resolve_event_location(
            db, venue, data.location_id, data.new_location,
            current_location_id=data.location_id if allow_archived_location else None,
        )
        check_geofence_possible(mode, venue, location)
        event = ShiftEvent(
            venue_id=venue.id,
            created_by_user_id=user.id,
            title=data.title.strip()[:255],
            start_time=_as_utc(data.start_time),
            end_time=_as_utc(data.end_time),
            notes=_clean(data.notes),
            staff_notes=_clean(data.staff_notes),
            location_id=location.id if location is not None else None,
            geofence_mode=mode,
            location_staff_notes=_clean(data.location_staff_notes),
            status=DRAFT if is_draft else PUBLISHED,                                   # Phase 29.3
            published_at=None if is_draft else datetime.now(timezone.utc),
        )
        db.add(event)
        await db.flush()
        for p, start in zip(data.positions, starts):
            s = Shift(venue_id=venue.id, event_id=event.id, created_by_user_id=user.id, spots_filled=0,
                      status="DRAFT" if is_draft else "OPEN")
            _apply_position(s, p, event, start=start)
            db.add(s)
        await db.commit()
        await db.refresh(event)
        return event
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to post shift: {str(e)}")


async def update_event(db: AsyncSession, event: ShiftEvent, data: EventUpdate) -> None:
    if event.cancelled_at is not None:
        raise HTTPException(status_code=400, detail="Cancelled events can't be edited.")
    _validate_basics(data)
    for p in data.positions:
        _validate_position(p)

    existing = (await db.execute(
        select(Shift).where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
    )).scalars().all()
    by_id = {s.id: s for s in existing}
    counts = await _request_counts(db, list(by_id.keys()))

    keep_ids = {p.shift_id for p in data.positions if p.shift_id}
    unknown = keep_ids - set(by_id.keys())
    if unknown:
        raise HTTPException(status_code=400, detail="One of the shifts doesn't belong to this event.")

    for s in existing:
        if s.id not in keep_ids:
            a, pn = counts.get(s.id, (0, 0))
            if a + pn > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{s.role_type}' has {a} booked and {pn} waiting. Remove or deny them before deleting this shift."
                )

    for p in data.positions:
        if p.shift_id:
            a, _ = counts.get(p.shift_id, (0, 0))
            if p.capacity < a:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{p.role_type}' already has {a} people booked, so it needs at least {a} spots."
                )

    is_draft = (event.status or PUBLISHED) == DRAFT      # Phase 29.3: nobody to tell about draft edits
    try:
        # Phase 26.2: work out what changed so booked workers are told
        venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
        tz_name = venue.timezone or "America/New_York"
        new_title = data.title.strip()[:255]
        new_start, new_end = _as_utc(data.start_time), _as_utc(data.end_time)
        # Phase 37.2: each existing shift's gap from the event's start, before the event moves
        old_gaps = {s.id: start_gap(s.start_time, event.start_time, tz_name) for s in existing}
        event_start_moved = _as_utc(event.start_time) != new_start
        changes = []
        if _as_utc(event.start_time) != new_start or _as_utc(event.end_time) != new_end:
            changes.append(
                f"Time changed: {_fmt_range(event.start_time, event.end_time, tz_name)} → {_fmt_range(new_start, new_end, tz_name)}"
            )
        if (event.title or "") != new_title:
            changes.append(f"Renamed to \u201c{new_title}\u201d")
        if _clean(event.notes) != _clean(data.notes):
            changes.append("Event notes updated")
        if _clean(event.staff_notes) != _clean(data.staff_notes):
            changes.append("Staff-only notes updated")

        # Phase 27: location, location notes for staff, and the clock-in location check
        mode = validate_geofence_mode(data.geofence_mode)
        old_location = await db.scalar(select(VenueLocation).where(VenueLocation.id == event.location_id)) if event.location_id else None
        new_location = await resolve_event_location(
            db, venue, data.location_id, data.new_location, current_location_id=event.location_id,
        )
        check_geofence_possible(mode, venue, new_location)
        old_loc_id = old_location.id if old_location is not None else None
        new_loc_id = new_location.id if new_location is not None else None
        if old_loc_id != new_loc_id:
            old_name = old_location.name if old_location is not None else "venue address"
            new_name = new_location.name if new_location is not None else "venue address"
            changes.append(f"Location changed: {old_name} → {new_name}")
        if _clean(event.location_staff_notes) != _clean(data.location_staff_notes):
            changes.append("Location notes for staff updated")
        was_on = geofence_on(event, venue)
        event.geofence_mode = mode
        now_on = geofence_on(event, venue)
        if was_on != now_on:
            changes.append("Clock-in location check turned " + ("on" if now_on else "off"))
        event.location_id = new_loc_id
        event.location_staff_notes = _clean(data.location_staff_notes)

        event.title = new_title
        event.start_time = new_start
        event.end_time = new_end
        event.notes = _clean(data.notes)
        event.staff_notes = _clean(data.staff_notes)
        if changes and not is_draft:
            event.info_updated_at = datetime.now(timezone.utc)
            event.info_change = "; ".join(changes)

        remove_ids = [s.id for s in existing if s.id not in keep_ids]
        if remove_ids:
            await db.execute(delete(Shift).where(Shift.id.in_(remove_ids)))

        for p in data.positions:
            if p.shift_id:
                s = by_id[p.shift_id]
                # Phase 37.2: its own start. Not sent = it keeps its gap, so it moves with the event.
                old_gap = old_gaps[s.id]
                old_shift_start = _as_utc(s.start_time)
                start = role_start(p, new_start, new_end, tz_name, old_gap)
                start_note = None
                # A shift that simply follows the event is covered by the event's own "Time changed" line.
                if start != old_shift_start and (old_gap or start != new_start):
                    with_day = (old_shift_start.astimezone(_zone(tz_name)).date() != start.astimezone(_zone(tz_name)).date())
                    start_note = (f"Start time changed: {_fmt_start(old_shift_start, tz_name, with_day)} → "
                                  f"{_fmt_start(start, tz_name, with_day)}")
                elif event_start_moved and start == old_shift_start and start != new_start:
                    # The event moved but this shift was kept where it was: say so, or its people would
                    # read the event's "Time changed" line as their own new start.
                    start_note = f"Start time is still {_fmt_start(start, tz_name)}"
                _apply_position(s, p, event, track_changes=not is_draft, start=start, start_note=start_note)
                if (s.status or "OPEN").upper() in ("OPEN", "FILLED"):
                    s.status = "FILLED" if (s.spots_filled or 0) >= s.capacity else "OPEN"
            else:
                s = Shift(
                    venue_id=event.venue_id, event_id=event.id,
                    created_by_user_id=event.created_by_user_id, spots_filled=0,
                    status="DRAFT" if is_draft else "OPEN",
                )
                _apply_position(s, p, event, start=role_start(p, new_start, new_end, tz_name))
                db.add(s)

        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update event: {str(e)}")


async def build_event_detail(db: AsyncSession, event: ShiftEvent) -> EventDetail:
    shifts = (await db.execute(
        select(Shift)
        .where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
        .order_by(Shift.created_at.asc(), Shift.role_type.asc())
    )).scalars().all()
    counts = await _request_counts(db, [s.id for s in shifts])
    venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
    location = await db.scalar(select(VenueLocation).where(VenueLocation.id == event.location_id)) if event.location_id else None
    loc_counts = await usage_counts(db, [location.id]) if location is not None else {}
    return EventDetail(
        id=event.id,
        venue_id=event.venue_id,
        title=event.title,
        start_time=event.start_time,
        end_time=event.end_time,
        notes=event.notes,
        staff_notes=event.staff_notes,
        location=location_response(location, loc_counts) if location is not None else None,
        geofence_mode=event.geofence_mode or "venue_default",
        geofence_on=geofence_on(event, venue) if venue is not None else False,
        location_staff_notes=event.location_staff_notes,
        cancelled=event.cancelled_at is not None,
        cancel_reason=event.cancel_reason,
        status=event.status or PUBLISHED,
        published_at=event.published_at,
        positions=[
            EventDetailPosition(
                shift_id=s.id,
                role_type=s.role_type,
                capacity=s.capacity,
                spots_filled=s.spots_filled or 0,
                assigned_count=counts.get(s.id, (0, 0))[0],
                pending_count=counts.get(s.id, (0, 0))[1],
                hourly_rate=float(s.hourly_rate),
                hourly_rate_max=float(s.hourly_rate_max) if s.hourly_rate_max is not None else None,
                hide_rate=bool(s.hide_rate),
                tips_eligible=bool(s.tips_eligible),
                tip_pool=bool(s.tip_pool),
                role_notes=s.description,
                staff_notes=s.staff_notes,
                approval_mode=s.approval_mode or "venue_default",
                status=s.status or "OPEN",
                start_time=s.start_time,                       # Phase 37.2
            )
            for s in shifts
        ],
    )


async def backfill_missing_events(db: AsyncSession) -> int:
    """Gives every shift without an event_id an event (grouped by venue + title + times). Idempotent."""
    orphans = (await db.execute(
        select(Shift).where(Shift.event_id.is_(None)).order_by(Shift.start_time.asc())
    )).scalars().all()
    if not orphans:
        return 0
    groups: Dict[Tuple, ShiftEvent] = {}
    try:
        for s in orphans:
            key = (s.venue_id, s.title, s.start_time, s.end_time)
            if key not in groups:
                ev = ShiftEvent(
                    venue_id=s.venue_id, created_by_user_id=s.created_by_user_id,
                    title=s.title, start_time=s.start_time, end_time=s.end_time,
                )
                db.add(ev)
                await db.flush()
                groups[key] = ev
            s.event_id = groups[key].id
            if s.is_shift_auto_confirm and (s.approval_mode or "venue_default") == "venue_default":
                s.approval_mode = "auto"
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return len(orphans)


# ------------------------------------------------------------------------------
# Phase 26: Cancel + duplicate
# ------------------------------------------------------------------------------
async def cancel_shifts(db: AsyncSession, event: ShiftEvent, shift_ids: Optional[List], reason: Optional[str]) -> int:
    """Cancel all positions (shift_ids=None) or some positions. Returns how many requests were cancelled."""
    now = datetime.now(timezone.utc)
    reason = _clean(reason)
    if not reason:
        raise HTTPException(status_code=400, detail="Please give a reason. Staff will see it.")
    if event.cancelled_at is not None:
        raise HTTPException(status_code=400, detail="This event is already cancelled.")

    q = select(Shift).where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
    if shift_ids is not None:
        q = q.where(Shift.id.in_(shift_ids))
    shifts = (await db.execute(q)).scalars().all()
    if shift_ids is not None and not shifts:
        raise HTTPException(status_code=404, detail="Shift not found or already cancelled.")
    # Phase 37.2: "started" = the first of these shifts has started (a shift can start before the event does)
    if first_start(event, shifts) <= now:
        raise HTTPException(
            status_code=400,
            detail="This event has already started. Remove individual people or fix the time sheet instead."
        )

    try:
        ids = [s.id for s in shifts]
        for s in shifts:
            s.status = "CANCELLED"
            s.cancelled_at = now
            s.cancel_reason = reason
            s.spots_filled = 0
        affected = 0
        if ids:
            res = await db.execute(
                update(ShiftRequest)
                .where(
                    ShiftRequest.shift_id.in_(ids),
                    func.lower(ShiftRequest.status).in_(ACTIVE_REQUEST_STATUSES),
                )
                .values(status="cancelled", status_reason=reason)
                .execution_options(synchronize_session=False)
            )
            affected = res.rowcount or 0
        await db.flush()
        remaining = await db.scalar(
            select(func.count(Shift.id)).where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
        )
        if not remaining:
            event.cancelled_at = now
            event.cancel_reason = reason
        await db.commit()
        return affected
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to cancel: {str(e)}")


async def duplicate_event(
    db: AsyncSession, event: ShiftEvent, venue: Venue, user: User, dates: List[date], as_draft: bool = False,
) -> List[ShiftEvent]:
    """Copy an event to each date, keeping the same local start time in the venue's timezone.
    Phase 29.3: copies are drafts when as_draft is set or the source is a draft."""
    as_draft = as_draft or (event.status or PUBLISHED) == DRAFT
    unique_dates = sorted(set(dates or []))
    if not unique_dates:
        raise HTTPException(status_code=400, detail="Pick at least one date.")
    if len(unique_dates) > 26:
        raise HTTPException(status_code=400, detail="You can make up to 26 copies at a time.")

    tz = ZoneInfo(venue.timezone or "America/New_York")
    start_local = _as_utc(event.start_time).astimezone(tz)
    duration = _as_utc(event.end_time) - _as_utc(event.start_time)
    now = datetime.now(timezone.utc)

    shifts = (await db.execute(
        select(Shift)
        .where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
        .order_by(Shift.created_at.asc())
    )).scalars().all()
    if not shifts:
        raise HTTPException(status_code=400, detail="Nothing to copy: every shift is cancelled.")

    def positions_for(new_start) -> List[EventPositionInput]:
        # Phase 37.2: each copy keeps every shift's own start time (the same gap from the event's start)
        return [
            EventPositionInput(
                role_type=s.role_type,
                capacity=s.capacity,
                hourly_rate=float(s.hourly_rate),
                hourly_rate_max=float(s.hourly_rate_max) if s.hourly_rate_max is not None else None,
                hide_rate=bool(s.hide_rate),
                tips_eligible=bool(s.tips_eligible),
                tip_pool=bool(s.tip_pool),
                role_notes=s.description,
                staff_notes=s.staff_notes,
                approval_mode=s.approval_mode or "venue_default",
                start_time=start_from_gap(new_start, start_gap(s.start_time, event.start_time, venue.timezone), venue.timezone),
            )
            for s in shifts
        ]

    # Phase 37.2: a shift can start before its event, so the first shift's start is what must be in the future
    earliest_gap = min([timedelta(0)] + [start_gap(s.start_time, event.start_time, venue.timezone) for s in shifts])
    starts = []
    for d in unique_dates:
        new_start = datetime.combine(d, start_local.time().replace(tzinfo=None), tzinfo=tz).astimezone(timezone.utc)
        if start_from_gap(new_start, earliest_gap, venue.timezone) <= now:
            raise HTTPException(status_code=400, detail=f"{d.isoformat()} is in the past.")
        starts.append(new_start)

    created = []
    for new_start in starts:
        ev = await create_event_with_positions(db, venue, user, EventCreate(
            venue_id=venue.id,
            title=event.title,
            start_time=new_start,
            end_time=new_start + duration,
            notes=event.notes,
            staff_notes=event.staff_notes,
            location_id=event.location_id,
            geofence_mode=event.geofence_mode or "venue_default",
            location_staff_notes=event.location_staff_notes,
            positions=positions_for(new_start),
            publish=not as_draft,
        ), allow_archived_location=True)
        created.append(ev)

    # Phase 32.3: the original and every copy belong to one series (the original's id), so workers
    # can request several dates at once. Copying a copy keeps the same series.
    series_id = event.series_id or event.id
    event.series_id = series_id
    for ev in created:
        ev.series_id = series_id
    await db.commit()
    return created


# ------------------------------------------------------------------------------
# Phase 29.3: Draft / publish
# ------------------------------------------------------------------------------
BLOCKING_REQUEST_STATUSES = ACTIVE_REQUEST_STATUSES + ("checked_in", "completed")


async def publish_event(db: AsyncSession, event: ShiftEvent) -> None:
    """Draft -> live. Positions become OPEN; the caller tells the team (new_event_posted)."""
    if event.cancelled_at is not None:
        raise HTTPException(status_code=400, detail="This event was cancelled.")
    if (event.status or PUBLISHED) != DRAFT:
        raise HTTPException(status_code=400, detail="This event is already published.")
    now = datetime.now(timezone.utc)
    shifts = (await db.execute(
        select(Shift).where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
    )).scalars().all()
    if first_start(event, shifts) <= now:                  # Phase 37.2: a shift can start before the event does
        raise HTTPException(status_code=400, detail="This draft's start time has passed. Change the date, then publish.")
    if not shifts:
        raise HTTPException(status_code=400, detail="Add at least one shift before publishing.")
    try:
        for s in shifts:
            s.status = "FILLED" if (s.spots_filled or 0) >= (s.capacity or 1) else "OPEN"
        event.status = PUBLISHED
        event.published_at = now
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to publish: {str(e)}")


async def unpublish_event(db: AsyncSession, event: ShiftEvent) -> None:
    """Live -> draft. Only while nobody has requested, been booked or been offered a spot."""
    if event.cancelled_at is not None:
        raise HTTPException(status_code=400, detail="This event was cancelled.")
    if (event.status or PUBLISHED) == DRAFT:
        raise HTTPException(status_code=400, detail="This event is already a draft.")
    shift_ids = (await db.execute(select(Shift.id).where(Shift.event_id == event.id))).scalars().all()
    if shift_ids:
        people = await db.scalar(
            select(func.count(ShiftRequest.id)).where(
                ShiftRequest.shift_id.in_(shift_ids),
                func.lower(ShiftRequest.status).in_(BLOCKING_REQUEST_STATUSES),
            )
        )
        if people:
            raise HTTPException(
                status_code=400,
                detail="People have already requested or been booked on this event, so it can't go back to a draft. Edit it, or cancel it instead.",
            )
        offers = await db.scalar(
            select(func.count(ShiftOffer.id)).where(ShiftOffer.shift_id.in_(shift_ids), ShiftOffer.status == "pending")
        )
        if offers:
            raise HTTPException(status_code=400, detail="Withdraw the open offers on this event first.")
    try:
        await db.execute(
            update(Shift)
            .where(Shift.event_id == event.id, func.upper(Shift.status).in_(("OPEN", "FILLED")))
            .values(status="DRAFT")
            .execution_options(synchronize_session=False)
        )
        event.status = DRAFT
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to move it back to drafts: {str(e)}")


async def discard_draft(db: AsyncSession, event: ShiftEvent) -> None:
    """Delete a draft outright (its positions cascade). Published events are cancelled, never deleted."""
    if (event.status or PUBLISHED) != DRAFT:
        raise HTTPException(status_code=400, detail="Only drafts can be deleted. Cancel a published event instead.")
    try:
        await db.execute(delete(ShiftEvent).where(ShiftEvent.id == event.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete the draft: {str(e)}")
