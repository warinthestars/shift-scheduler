"""
Phase 25.2: Create / update / describe events (one posting with 1+ positions).
Each position is a row in `shifts` linked by shifts.event_id.
"""
from datetime import timezone
from typing import Dict, Tuple

from fastapi import HTTPException
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ShiftEvent, Shift, ShiftRequest, Venue, User
from src.schemas import (
    EventCreate, EventUpdate, EventPositionInput, EventDetail, EventDetailPosition,
)

VALID_APPROVAL_MODES = ("venue_default", "auto", "manual")
ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
PENDING_STATUSES = ("pending", "pending_manager_approval")


def _as_utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _clean(text):
    if text is None:
        return None
    text = str(text).strip()
    return text or None


def _validate_basics(data) -> None:
    if not (data.title or "").strip():
        raise HTTPException(status_code=400, detail="Give the event a name.")
    if _as_utc(data.end_time) <= _as_utc(data.start_time):
        raise HTTPException(status_code=400, detail="End time must be after the start time.")
    if not data.positions:
        raise HTTPException(status_code=400, detail="Add at least one position.")


def _validate_position(p: EventPositionInput) -> None:
    name = (p.role_type or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Every position needs a name.")
    if p.capacity is None or p.capacity < 1:
        raise HTTPException(status_code=400, detail=f"{name}: needs at least 1 spot.")
    if p.hourly_rate is None or p.hourly_rate <= 0:
        raise HTTPException(status_code=400, detail=f"{name}: pay must be more than $0.")
    if p.hourly_rate_max is not None and p.hourly_rate_max < p.hourly_rate:
        raise HTTPException(status_code=400, detail=f"{name}: the top of the pay range can't be lower than the bottom.")
    mode = (p.approval_mode or "venue_default").lower()
    if mode not in VALID_APPROVAL_MODES:
        raise HTTPException(status_code=400, detail=f"{name}: approval must be venue_default, auto, or manual.")


def _apply_position(shift: Shift, p: EventPositionInput, event: ShiftEvent) -> None:
    mode = (p.approval_mode or "venue_default").lower()
    shift.title = event.title
    shift.start_time = event.start_time
    shift.end_time = event.end_time
    shift.role_type = p.role_type.strip()[:100]
    shift.capacity = int(p.capacity)
    shift.hourly_rate = p.hourly_rate
    shift.hourly_rate_max = p.hourly_rate_max if (p.hourly_rate_max is not None and p.hourly_rate_max > p.hourly_rate) else None
    shift.hide_rate = bool(p.hide_rate)
    shift.tips_eligible = bool(p.tips_eligible)
    shift.tip_pool = bool(p.tips_eligible and p.tip_pool)
    shift.description = _clean(p.role_notes)          # description = position notes
    shift.approval_mode = mode
    shift.is_shift_auto_confirm = (mode == "auto")    # kept in sync for older screens


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


async def create_event_with_positions(db: AsyncSession, venue: Venue, user: User, data: EventCreate) -> ShiftEvent:
    _validate_basics(data)
    for p in data.positions:
        _validate_position(p)
    try:
        event = ShiftEvent(
            venue_id=venue.id,
            created_by_user_id=user.id,
            title=data.title.strip()[:255],
            start_time=_as_utc(data.start_time),
            end_time=_as_utc(data.end_time),
            notes=_clean(data.notes),
        )
        db.add(event)
        await db.flush()
        for p in data.positions:
            s = Shift(venue_id=venue.id, event_id=event.id, created_by_user_id=user.id, spots_filled=0, status="OPEN")
            _apply_position(s, p, event)
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
    _validate_basics(data)
    for p in data.positions:
        _validate_position(p)

    existing = (await db.execute(select(Shift).where(Shift.event_id == event.id))).scalars().all()
    by_id = {s.id: s for s in existing}
    counts = await _request_counts(db, list(by_id.keys()))

    keep_ids = {p.shift_id for p in data.positions if p.shift_id}
    unknown = keep_ids - set(by_id.keys())
    if unknown:
        raise HTTPException(status_code=400, detail="One of the positions doesn't belong to this event.")

    for s in existing:
        if s.id not in keep_ids:
            a, pn = counts.get(s.id, (0, 0))
            if a + pn > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{s.role_type}' has {a} booked and {pn} waiting. Remove or deny them before deleting this position."
                )

    for p in data.positions:
        if p.shift_id:
            a, _ = counts.get(p.shift_id, (0, 0))
            if p.capacity < a:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{p.role_type}' already has {a} people booked, so it needs at least {a} spots."
                )

    try:
        event.title = data.title.strip()[:255]
        event.start_time = _as_utc(data.start_time)
        event.end_time = _as_utc(data.end_time)
        event.notes = _clean(data.notes)

        remove_ids = [s.id for s in existing if s.id not in keep_ids]
        if remove_ids:
            await db.execute(delete(Shift).where(Shift.id.in_(remove_ids)))

        for p in data.positions:
            if p.shift_id:
                s = by_id[p.shift_id]
                _apply_position(s, p, event)
                if (s.status or "OPEN").upper() in ("OPEN", "FILLED"):
                    s.status = "FILLED" if (s.spots_filled or 0) >= s.capacity else "OPEN"
            else:
                s = Shift(
                    venue_id=event.venue_id, event_id=event.id,
                    created_by_user_id=event.created_by_user_id, spots_filled=0, status="OPEN",
                )
                _apply_position(s, p, event)
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
        select(Shift).where(Shift.event_id == event.id).order_by(Shift.created_at.asc(), Shift.role_type.asc())
    )).scalars().all()
    counts = await _request_counts(db, [s.id for s in shifts])
    return EventDetail(
        id=event.id,
        venue_id=event.venue_id,
        title=event.title,
        start_time=event.start_time,
        end_time=event.end_time,
        notes=event.notes,
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
                approval_mode=s.approval_mode or "venue_default",
                status=s.status or "OPEN",
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
