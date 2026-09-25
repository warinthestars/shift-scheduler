"""
Phase 26.1: Worker-facing event listings. One listing = one event with its positions.

* Never exposes other workers (only counts).
* Hidden pay stays hidden unless the viewer is booked on that position, manages the venue,
  or is an admin.
* `booking` tells THIS viewer whether a position books instantly or needs approval
  (same decision function the request endpoint uses).
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ShiftEvent, Shift, ShiftRequest, Venue, VenueWhitelist, User, RequestStatus
from src.schemas import EventListing, ListingPosition, ListingVenue, ListingMyRequest
from src.services.auto_confirm import decide_approval
from src.services.shift_views import viewer_managed_venue_ids
from src.services.booking import (
    as_utc, ACTIVE_STATUSES, ASSIGNED_STATUSES, BOOKED_STATUSES, PENDING_STATUSES,
)

MAX_EVENTS = 200
WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")


def _f(v) -> Optional[float]:
    return float(v) if v is not None else None


async def build_listings(
    db: AsyncSession,
    user: User,
    *,
    venue_id: Optional[UUID] = None,
    days: int = 60,
    event_id: Optional[UUID] = None,
) -> List[EventListing]:
    """
    List mode (event_id None): upcoming, not-cancelled events in the next `days` days that have
    at least one open spot OR where the viewer has an active request.
    Single mode (event_id given): that event, whatever its state (used by the details modal).
    """
    now = datetime.now(timezone.utc)

    q = select(ShiftEvent)
    if event_id is not None:
        q = q.where(ShiftEvent.id == event_id)
    else:
        q = q.where(
            ShiftEvent.cancelled_at.is_(None),
            ShiftEvent.start_time > now,
            ShiftEvent.start_time <= now + timedelta(days=days),
        )
        if venue_id is not None:
            q = q.where(ShiftEvent.venue_id == venue_id)
        q = q.order_by(ShiftEvent.start_time.asc()).limit(MAX_EVENTS)
    events = (await db.execute(q)).scalars().all()
    if not events:
        return []

    event_ids = [e.id for e in events]
    venue_ids = {e.venue_id for e in events}

    shifts = (await db.execute(
        select(Shift)
        .where(Shift.event_id.in_(event_ids), func.upper(Shift.status) != "CANCELLED")
        .order_by(Shift.created_at.asc(), Shift.role_type.asc())
    )).scalars().all()
    shifts_by_event = defaultdict(list)
    for s in shifts:
        shifts_by_event[s.event_id].append(s)

    venues = {
        v.id: v for v in (await db.execute(select(Venue).where(Venue.id.in_(venue_ids)))).scalars().all()
    }

    # The viewer's own requests on these positions
    mine = {}
    if shifts:
        for r in (await db.execute(
            select(ShiftRequest).where(
                ShiftRequest.worker_id == user.id,
                ShiftRequest.shift_id.in_([s.id for s in shifts]),
            )
        )).scalars().all():
            mine[r.shift_id] = r

    whitelisted = set((await db.execute(
        select(VenueWhitelist.venue_id).where(
            VenueWhitelist.worker_id == user.id,
            VenueWhitelist.is_active == True,
            VenueWhitelist.venue_id.in_(venue_ids),
        )
    )).scalars().all())
    worked = set((await db.execute(
        select(Shift.venue_id)
        .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id == user.id,
            Shift.venue_id.in_(venue_ids),
            func.lower(ShiftRequest.status).in_(WORKED_STATUSES),
        )
        .distinct()
    )).scalars().all())

    managed = await viewer_managed_venue_ids(db, user)   # None = admin (sees all pay)

    # The viewer's booked shifts, for "overlaps your shift" warnings
    bookings = (await db.execute(
        select(Shift.event_id, Shift.title, Shift.start_time, Shift.end_time, Venue.name)
        .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .join(Venue, Venue.id == Shift.venue_id)
        .where(
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            Shift.end_time > now,
        )
    )).all()

    out: List[EventListing] = []
    for ev in events:
        venue = venues.get(ev.venue_id)
        if venue is None:
            continue
        ev_shifts = shifts_by_event.get(ev.id, [])
        start, end = as_utc(ev.start_time), as_utc(ev.end_time)
        hours = round(max(0.0, (end - start).total_seconds() / 3600.0), 2)
        can_see_all_pay = managed is None or venue.id in managed

        positions: List[ListingPosition] = []
        my_request: Optional[ListingMyRequest] = None
        for s in ev_shifts:
            r = mine.get(s.id)
            my_status = (r.status or "").lower() if r is not None else None
            if r is not None and my_status in ACTIVE_STATUSES:
                my_request = ListingMyRequest(
                    request_id=r.id, shift_id=s.id, role_type=s.role_type,
                    status=my_status, note=r.notes,
                )
            visible = (not s.hide_rate) or can_see_all_pay or (my_status in ASSIGNED_STATUSES)
            rate = _f(s.hourly_rate) if visible else None
            rate_max = _f(s.hourly_rate_max) if visible else None
            cap = s.capacity if s.capacity is not None else 1
            left = max(0, cap - (s.spots_filled or 0))
            is_open = (s.status or "").upper() == "OPEN" and left > 0
            decision, _src = decide_approval(s, venue, user, venue.id in whitelisted)
            positions.append(ListingPosition(
                shift_id=s.id,
                role_type=s.role_type or "Worker",
                role_notes=s.description,
                hourly_rate=rate,
                hourly_rate_max=rate_max,
                hide_rate=bool(s.hide_rate),
                tips_eligible=bool(s.tips_eligible),
                tip_pool=bool(s.tip_pool),
                capacity=cap,
                spots_left=left,
                status="OPEN" if is_open else "FILLED",
                booking="instant" if decision == RequestStatus.APPROVED else "approval",
                est_pay_min=round(rate * hours, 2) if rate is not None else None,
                est_pay_max=round((rate_max or rate) * hours, 2) if rate is not None else None,
                my_status=my_status,
                my_status_reason=r.status_reason if r is not None else None,
            ))

        open_positions = [p for p in positions if p.status == "OPEN"]
        if event_id is None and not open_positions and my_request is None:
            continue   # list mode: nothing to request and nothing of mine here

        conflict = None
        if my_request is None or my_request.status not in ASSIGNED_STATUSES:
            for b_event_id, b_title, b_start, b_end, b_venue in bookings:
                if b_event_id == ev.id:
                    continue
                if as_utc(b_start) < end and as_utc(b_end) > start:
                    conflict = f"{b_venue} · {b_title}"
                    break

        priced = [p for p in positions if p.hourly_rate is not None]
        started = start <= now
        cancelled = ev.cancelled_at is not None
        can_request = (
            not cancelled
            and not started
            and bool(open_positions)
            and conflict is None
            and (my_request is None or my_request.status in PENDING_STATUSES)
        )

        out.append(EventListing(
            event_id=ev.id,
            title=ev.title,
            notes=ev.notes,
            start_time=ev.start_time,
            end_time=ev.end_time,
            hours=hours,
            venue=ListingVenue(
                id=venue.id,
                name=venue.name,
                address=venue.address,
                timezone=venue.timezone or "America/New_York",
                logo_url=venue.logo_url,
                phone=venue.phone,
                lat=_f(venue.lat),
                lng=_f(venue.lng),
                dress_code=venue.dress_code,
                arrival_instructions=venue.arrival_instructions,
                default_shift_notes=venue.default_shift_notes,
            ),
            positions=positions,
            total_capacity=sum(p.capacity for p in positions),
            total_spots_left=sum(p.spots_left for p in open_positions),
            open_positions=len(open_positions),
            pay_min=min((p.hourly_rate for p in priced), default=None),
            pay_max=max(((p.hourly_rate_max or p.hourly_rate) for p in priced), default=None),
            any_tips=any(p.tips_eligible for p in positions),
            any_instant=any(p.booking == "instant" for p in open_positions),
            on_team=(venue.id in whitelisted) or (venue.id in worked),
            my_request=my_request,
            conflict=conflict,
            cancelled=cancelled,
            cancel_reason=ev.cancel_reason,
            started=started,
            can_request=can_request,
        ))
    return out
