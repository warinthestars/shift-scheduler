"""
Phase 25.1: Worker-facing venue directory, profile, and shift history.
Never returns other users' names, emails, phones, or IDs.
"""
from datetime import datetime, timezone, timedelta
from typing import List

from sqlalchemy import select, func, and_, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Venue, Shift, ShiftRequest, VenuePosition, VenueManager, User, ShiftEvent
from src.auth import normalize_role
from src.schemas import (
    VenueDirectoryItem, PublicPosition, VenueProfileResponse,
    PublicEventPosition, PublicVenueEvent,
)

ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
PAST_WINDOW_DAYS = 90
MAX_SHIFTS = 300


async def can_manage_venue(db: AsyncSession, user: User, venue_id) -> bool:
    if normalize_role(user.role) in ("platform_admin", "super_admin"):
        return True
    row = await db.scalar(
        select(VenueManager.user_id).where(
            VenueManager.venue_id == venue_id,
            VenueManager.user_id == user.id,
        )
    )
    return row is not None


async def build_directory(db: AsyncSession) -> List[VenueDirectoryItem]:
    now = datetime.now(timezone.utc)
    venues = (await db.execute(select(Venue).order_by(Venue.name))).scalars().all()

    stats_rows = (await db.execute(
        select(
            Shift.venue_id.label("venue_id"),
            func.count(Shift.id).label("total"),
            func.count(Shift.id).filter(Shift.end_time >= now).label("upcoming"),
            func.coalesce(
                func.sum(Shift.capacity - Shift.spots_filled).filter(
                    and_(Shift.start_time >= now, Shift.status == "OPEN")
                ),
                0,
            ).label("open_spots"),
            func.min(Shift.start_time).filter(Shift.start_time >= now).label("next_start"),
        ).group_by(Shift.venue_id)
    )).all()
    stats = {r.venue_id: r for r in stats_rows}

    rate_rows = (await db.execute(
        select(
            VenuePosition.venue_id,
            func.min(VenuePosition.default_rate),
            func.max(func.coalesce(VenuePosition.default_rate_max, VenuePosition.default_rate)),
        )
        .where(VenuePosition.is_active == True, VenuePosition.hide_rate == False)
        .group_by(VenuePosition.venue_id)
    )).all()
    rates = {vid: (mn, mx) for vid, mn, mx in rate_rows}

    items = []
    for v in venues:
        s = stats.get(v.id)
        show = bool(v.show_rates_publicly)
        mn, mx = rates.get(v.id, (None, None))
        items.append(VenueDirectoryItem(
            id=v.id,
            name=v.name,
            address=v.address,
            description=v.description,
            logo_url=v.logo_url,
            timezone=v.timezone or "America/New_York",
            lat=float(v.lat),
            lng=float(v.lng),
            open_spots=max(0, int(s.open_spots or 0)) if s else 0,
            upcoming_shift_count=int(s.upcoming or 0) if s else 0,
            total_shifts_posted=int(s.total or 0) if s else 0,
            next_shift_start=s.next_start if s else None,
            show_rates_publicly=show,
            rate_min=float(mn) if (show and mn is not None) else None,
            rate_max=float(mx) if (show and mx is not None) else None,
        ))
    items.sort(key=lambda i: (-i.open_spots, -i.upcoming_shift_count, i.name.lower()))
    return items


async def build_profile(db: AsyncSession, venue: Venue, user: User) -> VenueProfileResponse:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=PAST_WINDOW_DAYS)
    manage = await can_manage_venue(db, user, venue.id)

    booked_here = await db.scalar(
        select(ShiftRequest.id)
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(
            Shift.venue_id == venue.id,
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES),
        )
        .limit(1)
    )

    positions = (await db.execute(
        select(VenuePosition)
        .where(VenuePosition.venue_id == venue.id, VenuePosition.is_active == True)
        .order_by(VenuePosition.sort_order.asc(), VenuePosition.name.asc())
    )).scalars().all()
    show_rates = bool(venue.show_rates_publicly)   # Phase 26.3: same for everyone, managers included

    events_count, spots_posted = (await db.execute(
        select(
            func.count(distinct(func.concat(Shift.title, "|", Shift.start_time, "|", Shift.end_time))),
            func.coalesce(func.sum(Shift.capacity), 0),
        ).where(Shift.venue_id == venue.id, Shift.start_time >= since, Shift.start_time < now)
    )).one()

    spots_filled = await db.scalar(
        select(func.count(ShiftRequest.id))
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(
            Shift.venue_id == venue.id,
            Shift.start_time >= since,
            Shift.start_time < now,
            func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES),
        )
    ) or 0

    workers_booked = await db.scalar(
        select(func.count(distinct(ShiftRequest.worker_id)))
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(Shift.venue_id == venue.id, func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES))
    ) or 0

    return VenueProfileResponse(
        id=venue.id,
        name=venue.name,
        address=venue.address,
        description=venue.description,
        logo_url=venue.logo_url,
        phone=venue.phone,
        timezone=venue.timezone or "America/New_York",
        lat=float(venue.lat),
        lng=float(venue.lng),
        dress_code=venue.dress_code,
        arrival_instructions=venue.arrival_instructions if (manage or booked_here) else None,
        show_rates_publicly=bool(venue.show_rates_publicly),
        positions=[
            PublicPosition(
                name=p.name,
                # Phase 26.3: public page = what workers see, for everyone (no manager/admin bypass)
                default_rate=float(p.default_rate) if (show_rates and not p.hide_rate) else None,
                default_rate_max=(
                    float(p.default_rate_max)
                    if (p.default_rate_max is not None and show_rates and not p.hide_rate)
                    else None
                ),
                tips_eligible=bool(p.tips_eligible),
                tip_pool=bool(p.tip_pool),
            )
            for p in positions
        ],
        events_last_90_days=int(events_count or 0),
        spots_posted_last_90_days=int(spots_posted or 0),
        spots_filled_last_90_days=int(spots_filled),
        workers_booked_all_time=int(workers_booked),
        can_manage=manage,
    )


async def build_public_events(db: AsyncSession, venue: Venue, user: User, scope: str) -> List[PublicVenueEvent]:
    now = datetime.now(timezone.utc)
    q = select(Shift).where(Shift.venue_id == venue.id)
    if scope == "past":
        q = q.where(
            Shift.end_time < now,
            Shift.start_time >= now - timedelta(days=PAST_WINDOW_DAYS),
        ).order_by(Shift.start_time.desc(), Shift.role_type.asc())
    else:
        q = q.where(Shift.end_time >= now).order_by(Shift.start_time.asc(), Shift.role_type.asc())
    shifts = (await db.execute(q.limit(MAX_SHIFTS))).scalars().all()
    if not shifts:
        return []

    ids = [s.id for s in shifts]
    filled_rows = (await db.execute(
        select(ShiftRequest.shift_id, func.count(ShiftRequest.id))
        .where(ShiftRequest.shift_id.in_(ids), func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES))
        .group_by(ShiftRequest.shift_id)
    )).all()
    filled = {sid: int(n) for sid, n in filled_rows}

    mine_rows = (await db.execute(
        select(ShiftRequest.shift_id, ShiftRequest.status)
        .where(ShiftRequest.shift_id.in_(ids), ShiftRequest.worker_id == user.id)
    )).all()
    mine = {sid: (st or "").lower() for sid, st in mine_rows}

    event_ids = {s.event_id for s in shifts if s.event_id}
    event_notes = {}
    if event_ids:
        event_notes = dict((await db.execute(
            select(ShiftEvent.id, ShiftEvent.notes).where(ShiftEvent.id.in_(event_ids))
        )).all())

    events, order = {}, []
    for s in shifts:
        key = str(s.event_id) if s.event_id else f"{s.title}|{s.start_time.isoformat()}|{s.end_time.isoformat()}"
        if key not in events:
            events[key] = {
                "event_key": key,
                "event_id": s.event_id,
                "title": s.title or "Shift",
                "start_time": s.start_time,
                "end_time": s.end_time,
                "description": event_notes.get(s.event_id) if s.event_id else None,
                "positions": [],
            }
            order.append(key)
        cap = s.capacity if s.capacity is not None else 1
        f = filled.get(s.id, 0)
        my = mine.get(s.id)
        can_see = (not s.hide_rate) or (my in ASSIGNED_STATUSES)   # Phase 26.3: no manager/admin bypass
        events[key]["positions"].append(PublicEventPosition(
            shift_id=s.id,
            role_type=s.role_type or "Worker",
            hourly_rate=float(s.hourly_rate) if (can_see and s.hourly_rate is not None) else None,
            hourly_rate_max=float(s.hourly_rate_max) if (can_see and s.hourly_rate_max is not None) else None,
            hide_rate=bool(s.hide_rate),
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            role_notes=s.description,
            capacity=cap,
            filled=f,
            spots_left=max(0, cap - f),
            status=s.status or "OPEN",
            my_status=my,
        ))

    result = []
    for key in order:
        ev = events[key]
        result.append(PublicVenueEvent(
            **ev,
            total_capacity=sum(p.capacity for p in ev["positions"]),
            total_filled=sum(p.filled for p in ev["positions"]),
        ))
    return result
