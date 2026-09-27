"""
Phase 30: The manager's "Tonight" board.

build_tonight() returns, for one venue:
  events : every published, not-cancelled event that touches TODAY (venue time), with each booked
           person's clock state:
             upcoming - clock-in isn't open yet
             due      - clock-in is open, not late yet (start + 10 min)
             late     - past start + 10 min, no clock-in, shift still running
             in       - clocked in (open entry)
             done     - clocked out
             missed   - shift ended, never clocked in, not marked no-show yet
             no_show  - marked no-show
  alerts : what needs the manager right now, most urgent first
  week   : today + the next 6 days at a glance (drafts included, flagged)
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, ShiftOffer, TimeEntry, User, Venue
from src.schemas import (
    TonightResponse, TonightEvent, TonightPosition, TonightPerson, TonightAlert, WeekDay, WeekEvent,
)
from src.services.clock import auto_close_open_entries, late_minutes, clock_in_opens_at, LATE_GRACE, as_utc
from src.services.locations import load_locations
from src.services.worker_calendar import has_any_notes, latest_info_update, needs_ack

BOARD_STATUSES = ("approved", "confirmed", "checked_in", "completed", "no_show")
BOOKED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
PENDING_STATUSES = ("pending", "pending_manager_approval")
WEEK_DAYS = 7
OPEN_SPOT_ALERT_WINDOW = timedelta(hours=12)   # open spots on shifts starting within 12 h are alerts
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def _tz(venue: Venue) -> ZoneInfo:
    try:
        return ZoneInfo(venue.timezone or "America/New_York")
    except Exception:
        return ZoneInfo("America/New_York")


def _hm(dt: datetime, tz: ZoneInfo) -> str:
    return as_utc(dt).astimezone(tz).strftime("%-I:%M %p")


def _name(u: User) -> str:
    n = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return n or (u.email or "Someone")


def _key(s: Shift) -> str:
    return str(s.event_id) if s.event_id else f"{s.title}|{as_utc(s.start_time).isoformat()}|{as_utc(s.end_time).isoformat()}"


def clock_state(req_status: str, entries: list, shift: Shift, venue: Venue, now: datetime):
    """Returns (state, late_minutes, first_in, last_out)."""
    if req_status == "no_show":
        return "no_show", 0, None, None
    start, end = as_utc(shift.start_time), as_utc(shift.end_time)
    if entries:
        first_in = min(as_utc(e.clock_in_time) for e in entries)
        open_entry = any(e.clock_out_time is None for e in entries)
        last_out = None if open_entry else max(as_utc(e.clock_out_time) for e in entries)
        return ("in" if open_entry else "done"), late_minutes(first_in, start), first_in, last_out
    if now >= end:
        return "missed", 0, None, None
    if now < clock_in_opens_at(shift, venue):
        return "upcoming", 0, None, None
    if now <= start + LATE_GRACE:
        return "due", 0, None, None
    return "late", int((now - start).total_seconds() // 60), None, None


async def build_tonight(db: AsyncSession, venue: Venue) -> TonightResponse:
    await auto_close_open_entries(db, venue_id=venue.id)
    tz = _tz(venue)
    now = datetime.now(timezone.utc)
    today_local = now.astimezone(tz).date()
    day_start = datetime(today_local.year, today_local.month, today_local.day, tzinfo=tz)
    today_end_utc = (day_start + timedelta(days=1)).astimezone(timezone.utc)
    day_start_utc = day_start.astimezone(timezone.utc)
    week_end_utc = (day_start + timedelta(days=WEEK_DAYS)).astimezone(timezone.utc)

    shifts = (await db.execute(
        select(Shift).where(
            Shift.venue_id == venue.id,
            Shift.start_time < week_end_utc,
            Shift.end_time > day_start_utc,
            func.upper(Shift.status) != "CANCELLED",
        ).order_by(Shift.start_time.asc(), Shift.role_type.asc())
    )).scalars().all()

    event_ids = {s.event_id for s in shifts if s.event_id}
    events = {e.id: e for e in (await db.execute(
        select(ShiftEvent).where(ShiftEvent.id.in_(event_ids))
    )).scalars().all()} if event_ids else {}
    shifts = [s for s in shifts if not (s.event_id in events and events[s.event_id].cancelled_at is not None)]
    locations = await load_locations(db, [e.location_id for e in events.values()])
    shift_ids = [s.id for s in shifts]

    reqs = defaultdict(list)          # shift_id -> [(req, user)]
    pending = defaultdict(int)
    offers = defaultdict(int)
    entries = defaultdict(list)       # (shift_id, worker_id) -> [TimeEntry]
    if shift_ids:
        for req, u in (await db.execute(
            select(ShiftRequest, User).join(User, User.id == ShiftRequest.worker_id)
            .where(ShiftRequest.shift_id.in_(shift_ids),
                   func.lower(ShiftRequest.status).in_(BOARD_STATUSES + PENDING_STATUSES))
            .order_by(User.first_name.asc(), User.last_name.asc())
        )).all():
            if (req.status or "").lower() in PENDING_STATUSES:
                pending[req.shift_id] += 1
            else:
                reqs[req.shift_id].append((req, u))
        for sid, n in (await db.execute(
            select(ShiftOffer.shift_id, func.count(ShiftOffer.id))
            .where(ShiftOffer.shift_id.in_(shift_ids), ShiftOffer.status == "pending")
            .group_by(ShiftOffer.shift_id)
        )).all():
            offers[sid] = int(n)
        for e in (await db.execute(select(TimeEntry).where(TimeEntry.shift_id.in_(shift_ids)))).scalars().all():
            entries[(e.shift_id, e.worker_id)].append(e)

    def info_seen(req, s):
        ev = events.get(s.event_id)
        loc = locations.get(ev.location_id) if ev is not None and ev.location_id else None
        notes = has_any_notes(venue, ev, s, loc)
        updated = latest_info_update(ev, s)
        if not notes and updated is None:
            return None
        return not needs_ack(booked=True, has_notes=notes, updated_at=updated,
                             seen_at=req.info_seen_at, booked_at=req.approved_at or req.created_at)

    # ---------------------------------------------------------------- today
    today = {}
    order = []
    alerts = []
    for s in shifts:
        if (s.status or "").upper() == "DRAFT":
            continue
        start, end = as_utc(s.start_time), as_utc(s.end_time)
        if not (start < today_end_utc and end > day_start_utc):
            continue
        k = _key(s)
        ev = events.get(s.event_id)
        if k not in today:
            loc = locations.get(ev.location_id) if ev is not None and ev.location_id else None
            today[k] = TonightEvent(
                event_key=k, event_id=s.event_id, title=(ev.title if ev else s.title) or "Shift",
                start_time=start, end_time=end, location_name=loc.name if loc else None,
                state="ended" if now >= end else ("live" if now >= start else "upcoming"),
                clock_in_opens_at=clock_in_opens_at(s, venue),
            )
            order.append(k)
        te = today[k]
        # an event's positions can differ in time; widen the event window
        te.start_time = min(te.start_time, start)
        te.end_time = max(te.end_time, end)
        te.state = "ended" if now >= te.end_time else ("live" if now >= te.start_time else "upcoming")

        people = []
        for req, u in reqs[s.id]:
            st = (req.status or "").lower()
            es = entries.get((s.id, u.id), [])
            state, late, first_in, last_out = clock_state(st, es, s, venue, now)
            seen = info_seen(req, s) if st in BOOKED_STATUSES else None
            first_entry = min(es, key=lambda e: as_utc(e.clock_in_time)) if es else None
            p = TonightPerson(
                request_id=req.id, worker_id=u.id, first_name=u.first_name or "", last_name=u.last_name or "",
                phone=u.phone, request_status=st, clock_state=state,
                clock_in_time=first_in, clock_out_time=last_out, late_minutes=late,
                geo_flag=any(e.clock_in_geo_status == "outside_geofence" for e in es),
                manager_clock=first_entry is not None and first_entry.clock_in_geo_status == "manager",
                info_seen=seen, previous_drop_at=req.previous_drop_at,
            )
            people.append(p)
            label = f"{s.role_type} · {te.title}"
            if state == "late":
                alerts.append(TonightAlert(
                    kind="late", severity="high",
                    text=f"{_name(u)} hasn't clocked in · {label} started {late} min ago",
                    event_id=s.event_id, event_key=k, shift_id=s.id, request_id=req.id, worker_id=u.id))
            elif state == "missed":
                alerts.append(TonightAlert(
                    kind="missed", severity="medium",
                    text=f"{_name(u)} never clocked in · {label} ended {_hm(end, tz)}. Mark a no-show or add their hours.",
                    event_id=s.event_id, event_key=k, shift_id=s.id, request_id=req.id, worker_id=u.id))
            elif p.geo_flag and state == "in":
                alerts.append(TonightAlert(
                    kind="geo", severity="low",
                    text=f"{_name(u)} clocked in away from the site · {label}",
                    event_id=s.event_id, event_key=k, shift_id=s.id, request_id=req.id, worker_id=u.id))

        cap = s.capacity if s.capacity is not None else 1
        open_spots = max(0, cap - (s.spots_filled or 0)) if now < end else 0
        te.positions.append(TonightPosition(
            shift_id=s.id, role_type=s.role_type or "Worker", capacity=cap, spots_filled=s.spots_filled or 0,
            open_spots=open_spots, pending_requests=pending[s.id], pending_offers=offers[s.id], people=people,
        ))
        if open_spots and start - now <= OPEN_SPOT_ALERT_WINDOW:
            extra = []
            if pending[s.id]:
                extra.append(f"{pending[s.id]} request{'s' if pending[s.id] != 1 else ''} waiting")
            if offers[s.id]:
                extra.append(f"{offers[s.id]} offer{'s' if offers[s.id] != 1 else ''} out")
            when = f"started {_hm(start, tz)}" if now >= start else f"starts {_hm(start, tz)}"
            alerts.append(TonightAlert(
                kind="open_spot", severity="high" if now >= start - timedelta(hours=2) else "medium",
                text=f"{open_spots} {s.role_type} spot{'s' if open_spots != 1 else ''} open · {te.title} {when}"
                     + (f" ({', '.join(extra)})" if extra else ""),
                event_id=s.event_id, event_key=k, shift_id=s.id))

    for k in order:
        te = today[k]
        ps = [p for pos in te.positions for p in pos.people]
        te.booked = sum(1 for p in ps if p.clock_state != "no_show")
        te.clocked_in = sum(1 for p in ps if p.clock_state == "in")
        te.done = sum(1 for p in ps if p.clock_state == "done")
        te.late = sum(1 for p in ps if p.clock_state == "late")
        te.missed = sum(1 for p in ps if p.clock_state == "missed")
        te.no_show = sum(1 for p in ps if p.clock_state == "no_show")
        te.unread = sum(1 for p in ps if p.info_seen is False and p.clock_state in ("upcoming", "due", "late"))
        te.open_spots = sum(pos.open_spots for pos in te.positions)
        if te.unread and te.state != "ended":
            alerts.append(TonightAlert(
                kind="unread", severity="low",
                text=f"{te.unread} {'person hasn' if te.unread == 1 else 'people haven'}'t read the latest info · {te.title}",
                event_id=te.event_id, event_key=k))

    alerts.sort(key=lambda a: SEVERITY_ORDER.get(a.severity, 3))
    today_events = [today[k] for k in order]
    counts = {
        "events": len(today_events),
        "booked": sum(e.booked for e in today_events),
        "clocked_in": sum(e.clocked_in for e in today_events),
        "done": sum(e.done for e in today_events),
        "late": sum(e.late for e in today_events),
        "missed": sum(e.missed for e in today_events),
        "no_show": sum(e.no_show for e in today_events),
        "unread": sum(e.unread for e in today_events),
        "open_spots": sum(e.open_spots for e in today_events),
        "alerts": len(alerts),
        "urgent": sum(1 for a in alerts if a.severity == "high"),
    }

    # ---------------------------------------------------------------- week
    days = []
    for i in range(WEEK_DAYS):
        d = today_local + timedelta(days=i)
        days.append(WeekDay(
            date=d.isoformat(),
            label="Today" if i == 0 else ("Tomorrow" if i == 1 else d.strftime("%a")),
        ))
    by_day = {d.date: d for d in days}
    week_events = {}
    for s in shifts:
        start = as_utc(s.start_time)
        local_date = start.astimezone(tz).date().isoformat()
        day = by_day.get(local_date)
        if day is None:          # started before today (overnight into today) -> shown under today
            day = days[0] if start < day_start_utc else None
        if day is None:
            continue
        k = _key(s)
        ev = events.get(s.event_id)
        we = week_events.get(k)
        if we is None:
            we = WeekEvent(
                event_key=k, event_id=s.event_id, title=(ev.title if ev else s.title) or "Shift",
                start_time=start, end_time=as_utc(s.end_time),
                status=(ev.status if ev is not None and ev.status else "published"),
            )
            week_events[k] = we
            day.events.append(we)
        cap = s.capacity if s.capacity is not None else 1
        booked = [r for r, _ in reqs[s.id] if (r.status or "").lower() in BOOKED_STATUSES]
        we.capacity += cap
        we.filled += len(booked)
        we.requested += pending[s.id]
        if as_utc(s.end_time) > now:
            we.open_spots += max(0, cap - (s.spots_filled or 0))
        we.unread += sum(1 for r in booked if (r.status or "").lower() in ("approved", "confirmed") and info_seen(r, s) is False)
        we.start_time = min(we.start_time, start)
        we.end_time = max(we.end_time, as_utc(s.end_time))
    for d in days:
        d.events.sort(key=lambda e: e.start_time)
        d.capacity = sum(e.capacity for e in d.events if e.status != "draft")
        d.filled = sum(e.filled for e in d.events if e.status != "draft")

    return TonightResponse(
        venue_id=venue.id, timezone=str(tz.key), now=now, date=today_local.isoformat(),
        events=today_events, alerts=alerts, counts=counts, week=days,
    )
