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
from src.services.locations import load_locations, to_listing_location, geofence_on
from src.services.team import blocked_venue_ids
from src.services.fit import load_fit, load_requirements, required_for, tz_of, cert_label   # Phase 31 + 32
from src.services.departments import load_dept_context   # Phase 32.2
from src.services import waitlist as waitlist_svc          # Phase 34
from src.services.booking import (
    as_utc, ACTIVE_STATUSES, ASSIGNED_STATUSES, BOOKED_STATUSES, PENDING_STATUSES,
)

MAX_EVENTS = 200
SERIES_DAYS = 120        # Phase 32.3: how far ahead the "more dates in this series" list looks
SERIES_MAX = 12
WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")


def _event_match(positions) -> str:
    """Phase 32.2: match if any (open) position fits the viewer; not_set if they have no departments."""
    kinds = {p.department_match for p in positions}
    if "match" in kinds:
        return "match"
    if "not_set" in kinds or not kinds:
        return "not_set"
    return "outside"


def _f(v) -> Optional[float]:
    return float(v) if v is not None else None


async def build_listings(
    db: AsyncSession,
    user: User,
    *,
    venue_id: Optional[UUID] = None,
    days: int = 60,
    event_id: Optional[UUID] = None,
    series_id: Optional[UUID] = None,
    exclude_event_id: Optional[UUID] = None,
) -> List[EventListing]:
    """
    List mode (event_id None): upcoming, not-cancelled events in the next `days` days that have
    at least one open spot OR where the viewer has an active request.
    Phase 34: full events are listed too (full=True) so people can join a waitlist.
    Single mode (event_id given): that event, whatever its state (used by the details modal).
    Phase 32.3: in single mode, `series` holds the series' other upcoming dates (list-mode rules);
    series_id / exclude_event_id narrow list mode to one series.
    """
    now = datetime.now(timezone.utc)

    q = select(ShiftEvent).where(ShiftEvent.status != "draft")   # Phase 29.3: drafts are manager-only
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
        if series_id is not None:                                     # Phase 32.3
            q = q.where(ShiftEvent.series_id == series_id)
        if exclude_event_id is not None:
            q = q.where(ShiftEvent.id != exclude_event_id)
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

    # Phase 26.3: listings are a WORKER screen. Everyone (admins and managers included) gets worker
    # rules: hidden pay and staff-only notes are shown only on a position the viewer is booked on.

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

    locations = await load_locations(db, [e.location_id for e in events])   # Phase 27
    blocked = await blocked_venue_ids(db, user.id)                        # Phase 29
    my_fit = (await load_fit(db, [user.id]))[user.id]                     # Phase 31 + 32
    requirements = await load_requirements(db, venue_ids)
    depts = await load_dept_context(db, [user.id], venue_ids)            # Phase 32.2
    wl = await waitlist_svc.listing_info(db, [s.id for s in shifts], user.id)   # Phase 34
    removed_here = {s.id for s in shifts if s.id in mine and (mine[s.id].status or "").lower() in ("removed", "no_show")}

    out: List[EventListing] = []
    for ev in events:
        venue = venues.get(ev.venue_id)
        if venue is None:
            continue
        if event_id is None and venue.id in blocked:
            continue          # Phase 29: a venue that blocked you doesn't show up in Find Shifts
        ev_shifts = shifts_by_event.get(ev.id, [])
        start, end = as_utc(ev.start_time), as_utc(ev.end_time)
        hours = round(max(0.0, (end - start).total_seconds() / 3600.0), 2)

        positions: List[ListingPosition] = []
        my_request: Optional[ListingMyRequest] = None
        # Phase 29.4: did the viewer drop a position here? Then asking back needs a reason + approval.
        drops = [as_utc(mine[s.id].dropped_at) for s in ev_shifts if s.id in mine and mine[s.id].dropped_at is not None]
        dropped_here = max(drops) if drops else None
        vtz = tz_of(venue.timezone)
        # Phase 37.2: is the viewer already booked in this event? (then nothing here "overlaps" for them)
        booked_in_event = any(
            s.id in mine and (mine[s.id].status or "").lower() in ASSIGNED_STATUSES for s in ev_shifts
        )
        for s in ev_shifts:
            # Phase 37.2: each shift has its own start (call) time; pay estimates and overlap checks use it
            s_start = as_utc(s.start_time)
            s_hours = round(max(0.0, (end - s_start).total_seconds() / 3600.0), 2)
            s_conflict = None
            if not booked_in_event:
                for b_event_id, b_title, b_start, b_end, b_venue in bookings:
                    if b_event_id == ev.id:
                        continue
                    if as_utc(b_start) < end and as_utc(b_end) > s_start:
                        s_conflict = f"{b_venue} · {b_title}"
                        break
            r = mine.get(s.id)
            my_status = (r.status or "").lower() if r is not None else None
            if r is not None and my_status in ACTIVE_STATUSES:
                my_request = ListingMyRequest(
                    request_id=r.id, shift_id=s.id, role_type=s.role_type,
                    status=my_status, note=r.notes,
                )
            booked_here = my_status in ASSIGNED_STATUSES
            visible = (not s.hide_rate) or booked_here
            rate = _f(s.hourly_rate) if visible else None
            rate_max = _f(s.hourly_rate_max) if visible else None
            cap = s.capacity if s.capacity is not None else 1
            left = max(0, cap - (s.spots_filled or 0) - wl.held.get(s.id, 0))   # Phase 34: offered spots are held
            is_open = (s.status or "").upper() == "OPEN" and left > 0
            decision, _src = decide_approval(s, venue, user, venue.id in whitelisted)
            dmatch = depts.match(user.id, s)                                      # Phase 32.2
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
                booking="instant" if decision == RequestStatus.APPROVED and dropped_here is None and dmatch != "outside" else "approval",
                est_pay_min=round(rate * s_hours, 2) if rate is not None else None,
                est_pay_max=round((rate_max or rate) * s_hours, 2) if rate is not None else None,
                my_status=my_status,
                my_status_reason=r.status_reason if r is not None else None,
                my_dropped_at=r.dropped_at if r is not None and my_status == "dropped" else None,   # Phase 29.4
                staff_notes=s.staff_notes if booked_here else None,
                required_certs=[cert_label(k) for k in required_for(requirements, s)],                # Phase 32
                missing_certs=my_fit.missing(required_for(requirements, s), s.start_time, s.end_time, vtz),
                department=depts.dept_of(s.venue_id, s.role_type),
                department_match=dmatch,
                waitlist_count=wl.count(s.id),                                        # Phase 34
                my_waitlist=wl.mine(s.id),
                start_time=s.start_time,                                              # Phase 37.2
                own_start=s_start != start,
                hours=s_hours,
                started=s_start <= now,
                conflict=s_conflict,
            ))

        first = min([start] + [as_utc(s.start_time) for s in ev_shifts])           # Phase 37.2
        open_positions = [p for p in positions if p.status == "OPEN"]
        # Phase 32: no missing certificates. Phase 37.2: its own start hasn't passed and it doesn't overlap a booking.
        requestable = [p for p in open_positions if not p.missing_certs and not p.started and not p.conflict]
        full = bool(positions) and not open_positions                          # Phase 34
        if event_id is None and not positions:
            continue   # list mode: nothing here at all

        # Phase 37.2: the event "overlaps your shift" only when every shift in it does (their starts can differ).
        conflict = None
        if positions and all(p.conflict for p in positions):
            conflict = positions[0].conflict

        priced = [p for p in positions if p.hourly_rate is not None]
        # Phase 37.2: "started" for the viewer = every shift in it has started (a shift can start after the event does)
        started = all(p.started for p in positions) if positions else start <= now
        cancelled = ev.cancelled_at is not None
        # Phase 34: who can join a full position's waitlist (one place per event)
        in_line = any(p.my_waitlist is not None for p in positions)
        for p in positions:
            p.can_waitlist = (
                p.status == "FILLED" and not cancelled and not started and not p.started and not in_line
                and my_request is None and p.conflict is None and dropped_here is None
                and not p.missing_certs and p.shift_id not in removed_here
                and (ev.status or "published") == "published"
            )
        can_request = (
            not cancelled
            and not started
            and bool(requestable)
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
                # Phase 27: arrival instructions are for booked staff only (as Venue Settings promises)
                arrival_instructions=venue.arrival_instructions if (
                    my_request is not None and my_request.status in ASSIGNED_STATUSES
                ) else None,
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
            dropped_here=dropped_here if (my_request is None or my_request.status in PENDING_STATUSES) else None,   # Phase 29.4
            staff_notes=ev.staff_notes if (
                my_request is not None and my_request.status in ASSIGNED_STATUSES
            ) else None,
            location=to_listing_location(locations.get(ev.location_id)) if ev.location_id else None,   # Phase 27
            location_staff_notes=ev.location_staff_notes if (
                my_request is not None and my_request.status in ASSIGNED_STATUSES
            ) else None,
            geofence_on=geofence_on(ev, venue),
            # Phase 31. Phase 37.2: judged from the first shift's start, which can be before the event's
            availability=my_fit.availability(first, ev.end_time, vtz),
            time_off=my_fit.off(first, ev.end_time, vtz),
            department_match=_event_match(open_positions or positions),                 # Phase 32.2
            series_id=ev.series_id,                                                     # Phase 32.3
            full=full,                                                                  # Phase 34
        ))

    # Phase 32.3: list view: each card says how many other dates of its series are listed
    if event_id is None:
        per_series = defaultdict(int)
        for row in out:
            if row.series_id is not None:
                per_series[row.series_id] += 1
        for row in out:
            if row.series_id is not None:
                row.series_more = per_series[row.series_id] - 1

    # Phase 32.3: the details modal lists the series' other upcoming dates so the worker can request several at once
    if event_id is not None and out and out[0].series_id is not None:
        out[0].series = (await build_listings(
            db, user, series_id=out[0].series_id, exclude_event_id=event_id, days=SERIES_DAYS,
        ))[:SERIES_MAX]
    return out
