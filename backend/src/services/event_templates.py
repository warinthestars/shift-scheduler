"""
Phase 29.3: Event templates - a venue's reusable event setups (name, times, where, notes, positions).

Times are venue-local 'HH:MM' strings. An end earlier than (or equal to) the start means the event ends
the next day. Templates never create anything by themselves: the "Post a shift" form fills itself in
from one, and the manager picks the date.
"""
import re
from datetime import timezone
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import EventTemplate, ShiftEvent, Shift, Venue, User, VenueLocation
from src.schemas import EventTemplateInput, EventTemplatePosition, EventTemplateResponse, EventPositionInput
from src.services.shift_events import _validate_position, _clean
from src.services.locations import (
    validate_geofence_mode, check_geofence_possible, usage_counts, to_response as location_response,
)

MAX_TEMPLATES_PER_VENUE = 50
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _name(u: Optional[User]) -> Optional[str]:
    if u is None:
        return None
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email


def _norm_time(value: str, label: str) -> str:
    v = (value or "").strip()
    if len(v) == 4 and v[1] == ":":
        v = "0" + v                                   # '9:30' -> '09:30'
    if not TIME_RE.match(v):
        raise HTTPException(status_code=400, detail=f"{label} must be a time like 18:00.")
    return v


def _position_dicts(positions: List[EventTemplatePosition]) -> List[dict]:
    if not positions:
        raise HTTPException(status_code=400, detail="Add at least one shift.")
    out = []
    for p in positions:
        _validate_position(EventPositionInput(**p.model_dump()))
        rate = round(float(p.hourly_rate), 2)
        rate_max = round(float(p.hourly_rate_max), 2) if p.hourly_rate_max is not None and p.hourly_rate_max > p.hourly_rate else None
        out.append({
            "role_type": p.role_type.strip()[:100],
            "capacity": int(p.capacity),
            "hourly_rate": rate,
            "hourly_rate_max": rate_max,
            "hide_rate": bool(p.hide_rate),
            "tips_eligible": bool(p.tips_eligible),
            "tip_pool": bool(p.tips_eligible and p.tip_pool),
            "role_notes": _clean(p.role_notes),
            "staff_notes": _clean(p.staff_notes),
            "approval_mode": (p.approval_mode or "venue_default").lower(),
        })
    return out


async def _location_for(db: AsyncSession, venue: Venue, location_id, keep_id=None) -> Optional[VenueLocation]:
    """A saved, non-archived location of this venue (an archived one may stay on a template that already has it)."""
    if not location_id:
        return None
    loc = await db.scalar(select(VenueLocation).where(VenueLocation.id == location_id))
    if loc is None or loc.venue_id != venue.id:
        raise HTTPException(status_code=400, detail="That location doesn't belong to this venue.")
    if loc.is_archived and location_id != keep_id:
        raise HTTPException(status_code=400, detail=f"“{loc.name}” is archived. Bring it back under Venue Settings → Locations first.")
    return loc


async def _check_name(db: AsyncSession, venue_id, name: str, exclude_id=None) -> str:
    clean = (name or "").strip()[:120]
    if not clean:
        raise HTTPException(status_code=400, detail="Give the template a name.")
    q = select(EventTemplate.id).where(EventTemplate.venue_id == venue_id, func.lower(EventTemplate.name) == clean.lower())
    if exclude_id is not None:
        q = q.where(EventTemplate.id != exclude_id)
    if await db.scalar(q):
        raise HTTPException(status_code=400, detail=f"You already have a template called “{clean}”.")
    return clean


def _apply(tpl: EventTemplate, data: EventTemplateInput, name: str, location: Optional[VenueLocation], mode: str) -> None:
    title = (data.title or "").strip()[:255]
    if not title:
        raise HTTPException(status_code=400, detail="Give the event a name.")
    start = _norm_time(data.start_local, "Start time")
    end = _norm_time(data.end_local, "End time")
    if start == end:
        raise HTTPException(status_code=400, detail="The end time can't be the same as the start time.")
    tpl.name = name
    tpl.title = title
    tpl.start_local = start
    tpl.end_local = end
    tpl.notes = _clean(data.notes)
    tpl.staff_notes = _clean(data.staff_notes)
    tpl.location_id = location.id if location is not None else None
    tpl.geofence_mode = mode
    tpl.location_staff_notes = _clean(data.location_staff_notes)
    tpl.positions = _position_dicts(data.positions)


async def to_responses(db: AsyncSession, templates: List[EventTemplate]) -> List[EventTemplateResponse]:
    loc_ids = [t.location_id for t in templates if t.location_id]
    locations: Dict = {
        l.id: l for l in (await db.execute(select(VenueLocation).where(VenueLocation.id.in_(loc_ids)))).scalars().all()
    } if loc_ids else {}
    counts = await usage_counts(db, list(locations.keys())) if locations else {}
    user_ids = {t.created_by_user_id for t in templates if t.created_by_user_id}
    users = {
        u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    } if user_ids else {}
    out = []
    for t in templates:
        loc = locations.get(t.location_id)
        out.append(EventTemplateResponse(
            id=t.id, venue_id=t.venue_id, name=t.name, title=t.title,
            start_local=t.start_local, end_local=t.end_local, overnight=t.end_local <= t.start_local,
            notes=t.notes, staff_notes=t.staff_notes,
            location=location_response(loc, counts) if loc is not None else None,
            geofence_mode=t.geofence_mode or "venue_default", location_staff_notes=t.location_staff_notes,
            positions=[EventTemplatePosition(**p) for p in (t.positions or [])],
            created_by_name=_name(users.get(t.created_by_user_id)),
            created_at=t.created_at, updated_at=t.updated_at,
        ))
    return out


async def list_templates(db: AsyncSession, venue_id) -> List[EventTemplateResponse]:
    rows = (await db.execute(
        select(EventTemplate).where(EventTemplate.venue_id == venue_id).order_by(func.lower(EventTemplate.name))
    )).scalars().all()
    return await to_responses(db, list(rows))


async def create_template(db: AsyncSession, venue: Venue, user: User, data: EventTemplateInput) -> EventTemplate:
    count = await db.scalar(select(func.count(EventTemplate.id)).where(EventTemplate.venue_id == venue.id)) or 0
    if count >= MAX_TEMPLATES_PER_VENUE:
        raise HTTPException(status_code=400, detail=f"A venue can have up to {MAX_TEMPLATES_PER_VENUE} templates. Delete one you no longer use.")
    name = await _check_name(db, venue.id, data.name)
    mode = validate_geofence_mode(data.geofence_mode)
    location = await _location_for(db, venue, data.location_id)
    check_geofence_possible(mode, venue, location)
    tpl = EventTemplate(venue_id=venue.id, created_by_user_id=user.id)
    _apply(tpl, data, name, location, mode)
    try:
        db.add(tpl)
        await db.commit()
        await db.refresh(tpl)
        return tpl
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save the template: {str(e)}")


async def update_template(db: AsyncSession, venue: Venue, tpl: EventTemplate, data: EventTemplateInput) -> EventTemplate:
    name = await _check_name(db, venue.id, data.name, exclude_id=tpl.id)
    mode = validate_geofence_mode(data.geofence_mode)
    location = await _location_for(db, venue, data.location_id, keep_id=tpl.location_id)
    check_geofence_possible(mode, venue, location)
    _apply(tpl, data, name, location, mode)
    try:
        await db.commit()
        await db.refresh(tpl)
        return tpl
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save the template: {str(e)}")


async def delete_template(db: AsyncSession, tpl: EventTemplate) -> None:
    try:
        await db.execute(delete(EventTemplate).where(EventTemplate.id == tpl.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete the template: {str(e)}")


async def template_from_event(db: AsyncSession, event: ShiftEvent, venue: Venue, user: User, name: str) -> EventTemplate:
    """Save an existing event's setup (times in venue time, where, notes, open positions) as a template."""
    shifts = (await db.execute(
        select(Shift)
        .where(Shift.event_id == event.id, func.upper(Shift.status) != "CANCELLED")
        .order_by(Shift.created_at.asc())
    )).scalars().all()
    if not shifts:
        raise HTTPException(status_code=400, detail="Nothing to save: every shift is cancelled.")
    tz = ZoneInfo(venue.timezone or "America/New_York")
    start = event.start_time if event.start_time.tzinfo else event.start_time.replace(tzinfo=timezone.utc)
    end = event.end_time if event.end_time.tzinfo else event.end_time.replace(tzinfo=timezone.utc)
    location = await db.scalar(select(VenueLocation).where(VenueLocation.id == event.location_id)) if event.location_id else None
    data = EventTemplateInput(
        name=name,
        title=event.title,
        start_local=start.astimezone(tz).strftime("%H:%M"),
        end_local=end.astimezone(tz).strftime("%H:%M"),
        notes=event.notes,
        staff_notes=event.staff_notes,
        location_id=location.id if location is not None and not location.is_archived else None,
        geofence_mode=event.geofence_mode or "venue_default",
        location_staff_notes=event.location_staff_notes,
        positions=[
            EventTemplatePosition(
                role_type=s.role_type, capacity=s.capacity or 1, hourly_rate=float(s.hourly_rate),
                hourly_rate_max=float(s.hourly_rate_max) if s.hourly_rate_max is not None else None,
                hide_rate=bool(s.hide_rate), tips_eligible=bool(s.tips_eligible), tip_pool=bool(s.tip_pool),
                role_notes=s.description, staff_notes=s.staff_notes, approval_mode=s.approval_mode or "venue_default",
            )
            for s in shifts
        ],
    )
    return await create_template(db, venue, user, data)
