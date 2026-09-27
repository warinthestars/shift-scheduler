# Phase 30: Manager "Today" Board & Live Alerts

**Why:** The manager dashboard answers "what's posted?" well, but not "what's happening right now?" A manager checking their phone at 7:05 PM should see straight away:

* who is in
* who is late
* who hasn't read the update
* which spots are still open

and fix each one with a single tap. Today that means opening each event's roster, then its time sheet, then the bell. Two things are also wasted space: the request and hand-off cards are empty most of the time, and Posted Shifts (a long list of every future event) sits above everything.

## What this phase adds

### A. The "Today / This week" board (new, at the top of the dashboard)
1. **Today tab:** every published, not-cancelled event that touches today (venue time). That includes overnight shifts that started yesterday and ones that already ended. Live events come first, then upcoming, then ended (collapsed unless someone never clocked in).
   * Each event shows:
     - a LIVE badge, times, and "Starts in 1 h 30 min" or "Live now · ends in 4 h"
     - counts: booked, clocked in, late, never clocked in, no-show, open, haven't read the update
   * Each booked person shows a **clock state**:

     | State | Meaning |
     |---|---|
     | **Not open yet** | clock-in opens at … |
     | **Not in yet** | clock-in is open, not late yet |
     | **Late** (pulsing) | 10+ min past the start, no clock-in, "35 min past the start" |
     | **In** | since 6:52 PM · 12 min late · "clocked in by a manager" · "away from site" |
     | **Done** | 6:52 PM – 11:05 PM |
     | **Never clocked in** | shift ended, not marked |
     | **No-show** | marked |

     Plus "hasn't read the update", and their reliability badge.
   * **One-tap actions per person:**
     - 📞 **Call**: a `tel:` link; greyed out when there's no phone on file
     - **Clock in** (for Not in yet / Late): asks for a reason and records a manager clock-in at now
     - **No-show** (for Late / Never clocked in): optional note that they'll see
   * **Per position:** "Message this shift" opens the existing shift board. Open spots show **Find cover**, which opens the existing Assign/Offer modal. It also shows "2 asked · 1 offered".
   * Event buttons: **Roster** (opens the existing roster) and **Time sheet**.
2. **Alerts at the top of the Today tab**, most urgent first:

   | Alert | Severity | Actions |
   |---|---|---|
   | Late | high | Call / Clock in / No-show |
   | Open spot within 12 h | high when starting within 2 h or already started | Find cover |
   | Never clocked in | medium | No-show / Add hours |
   | Haven't read the update | low | Message |
   | Clocked in away from site | low | Time sheet |

   4 alerts are shown, with "Show all N".
3. **This week tab:** today plus 6 days. Each day shows a fill bar ("7/11 spots filled"), and each event is a chip:
   * green = full
   * amber = partly filled
   * red = nobody yet
   * dashed = draft

   Chips also show "N asked" and unread counts. Tapping one opens the roster.
4. **Live:** the board reloads every 60 s while the tab is visible, whenever the tab becomes visible again, and after any change on the page. The header shows "Live · updated just now".
5. The board opens on **Today** when there's something today; otherwise it opens on **This week**. With nothing on today it shows "Nothing on today. Next up: …".

### B. "Needs you (N)" strip
* It sits above the board and adds up requests, hand-offs, people late or not clocked in, and open spots soon. Each chip jumps to the right place.
* When nothing is waiting it shrinks to one line: "Nothing needs you right now."
* The **request and hand-off cards now only render while they have items**, so the right column is just the activity log most of the time.
* **Posted Shifts moves below the board.** It is unchanged otherwise.

### C. No-shows now free the spot
* `POST /api/requests/{id}/no-show` now:
  - lowers `spots_filled` and reopens a FILLED position while the shift is still running, so **Find cover → Assign** works straight away
  - notifies the worker ("Marked as a no-show … If you were there, message your manager"), which is urgent so it can go by SMS
  - logs `no_show` in the activity log
  - returns `{detail, spot_reopened}`
* **Undo (adding their time) takes the spot back** if there's still room. The time sheet's "Mark no-show" behaves the same.
* No-shows from before this phase are recognised by their audit row and are never double-counted.
* A manager clock-in (a time entry with no clock-out) now logs `manager_clock_in` ("Clocked Alex Rivers in for …, Reason: phone died").

### D. New live alert: spots still open 3 h before start
The background worker sends **one** alert per position (urgent, so it can go by SMS) to the venue's managers when a published position still has open spots 3 hours before it starts: "2 Runner spots still open: Soon Unfilled". It also adds an `unfilled_soon` line to the activity log. Drafts and cancelled events are skipped.

✅ **No schema change.** A plain rebuild is enough (§E).

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `main.py`: unchanged. The new endpoint lives in the existing `routers/activity.py`, which is already mounted at `/api/venues`.
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
* No new npm or Python packages. The icons used all exist in lucide-react 0.359.
* No native PostgreSQL ENUMs. The new states (`upcoming`, `due`, `late`, `in`, `done`, `missed`, `no_show`) are **computed**, not stored.
* Aware UTC datetimes only. "Today" is worked out in the venue's time zone (`ZoneInfo(venue.timezone)`).
* Notification and activity hooks run after the commit and never raise, as before.
* **`spots_filled` can never exceed `capacity`:** the database has a check constraint, `chk_spots`. The undo path only takes the spot back when there's room. Keep that guard.
* **NEW FILE**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from the real current (Phase 29.4) files, and your repo was checked to match them before writing this. They were verified:
  - the backend imports cleanly: 156 API operations, one new route, `GET /api/venues/{venue_id}/tonight`
  - the frontend bundles with no missing imports
  - 49 new integration checks pass against PostgreSQL 16, and the earlier suites give the same results as on Phase 29.4
  - the board was rendered with the real Tailwind build, on desktop and phone, with a live event, late people, no-show → Find cover, and the week view

  Don't "improve" them.

---

# PART A: Schemas

## A1. `backend/src/schemas.py` (EDIT: append at the end)
Adds `TonightPerson`, `TonightPosition`, `TonightEvent`, `TonightAlert`, `WeekEvent`, `WeekDay`, `TonightResponse` and `NoShowResult`. Nothing existing changes.

**Edit 1.** Find:
```python
class DropShiftBody(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)   # optional; managers see it
```
Replace with:
```python
class DropShiftBody(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)   # optional; managers see it


# ------------------------------------------------------------------------------
# Phase 30: Manager "Tonight" board
# ------------------------------------------------------------------------------
class TonightPerson(BaseModel):
    request_id: UUID
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    phone: Optional[str] = None
    request_status: str                          # approved | confirmed | checked_in | completed | no_show
    clock_state: str                             # upcoming | due | late | in | done | missed | no_show
    clock_in_time: Optional[datetime] = None     # first clock-in
    clock_out_time: Optional[datetime] = None    # last clock-out (when done)
    late_minutes: int = 0                        # late: minutes past start right now; in/done: recorded lateness
    geo_flag: bool = False                       # clocked in outside the geofence
    manager_clock: bool = False                  # a manager entered the clock-in
    info_seen: Optional[bool] = None             # None = nothing to read
    previous_drop_at: Optional[datetime] = None  # Phase 29.4 re-booked after a drop


class TonightPosition(BaseModel):
    shift_id: UUID
    role_type: str
    capacity: int
    spots_filled: int
    open_spots: int
    pending_requests: int = 0
    pending_offers: int = 0
    people: List[TonightPerson] = []


class TonightEvent(BaseModel):
    event_key: str
    event_id: Optional[UUID] = None
    title: str
    start_time: datetime
    end_time: datetime
    location_name: Optional[str] = None
    state: str                                   # upcoming | live | ended
    clock_in_opens_at: datetime
    positions: List[TonightPosition] = []
    booked: int = 0
    clocked_in: int = 0
    done: int = 0
    late: int = 0
    missed: int = 0
    no_show: int = 0
    unread: int = 0
    open_spots: int = 0


class TonightAlert(BaseModel):
    kind: str                                    # late | missed | open_spot | unread | geo
    severity: str                                # high | medium | low
    text: str
    event_id: Optional[UUID] = None
    event_key: Optional[str] = None
    shift_id: Optional[UUID] = None
    request_id: Optional[UUID] = None
    worker_id: Optional[UUID] = None


class WeekEvent(BaseModel):
    event_key: str
    event_id: Optional[UUID] = None
    title: str
    start_time: datetime
    end_time: datetime
    status: str = "published"                    # draft | published
    capacity: int = 0
    filled: int = 0
    requested: int = 0
    open_spots: int = 0
    unread: int = 0


class WeekDay(BaseModel):
    date: str                                    # YYYY-MM-DD in the venue's time zone
    label: str                                   # Today | Tomorrow | Wed
    events: List[WeekEvent] = []
    capacity: int = 0
    filled: int = 0


class TonightResponse(BaseModel):
    venue_id: UUID
    timezone: str
    now: datetime
    date: str                                    # today's YYYY-MM-DD (venue time)
    events: List[TonightEvent] = []
    alerts: List[TonightAlert] = []
    counts: dict = {}
    week: List[WeekDay] = []


class NoShowResult(BaseModel):
    detail: str
    spot_reopened: bool = False
```

---

# PART B: Backend

## B1. NEW FILE `backend/src/services/tonight.py`
Builds the board in one pass. It uses a fixed number of queries, whatever the number of shifts.

```python
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
```

---

## B2. `backend/src/routers/activity.py` (EDITS)
Adds `GET /api/venues/{venue_id}/tonight` (managers of the venue plus platform admins; uses `verify_venue_manager_access`).

**Edit 1.** Find:
```python

  GET /api/venues/{venue_id}/activity?category=&limit=30&before=<iso>
"""
from datetime import datetime
```
Replace with:
```python

  GET /api/venues/{venue_id}/activity?category=&limit=30&before=<iso>
Phase 30:
  GET /api/venues/{venue_id}/tonight   (the manager's Today / This week board)
"""
from datetime import datetime
```

**Edit 2.** Find:
```python
from src.database import get_db
from src.models import User, VenueActivity
from src.schemas import ActivityItem
from src.auth import require_manager_or_admin
from src.routers.venues import verify_venue_manager_access
from src.services.activity import CATEGORIES, person

router = APIRouter(prefix="/api/venues", tags=["Activity"])
```
Replace with:
```python
from src.database import get_db
from src.models import User, VenueActivity
from src.schemas import ActivityItem, TonightResponse
from src.auth import require_manager_or_admin
from src.routers.venues import verify_venue_manager_access
from src.services.activity import CATEGORIES, person
from src.services.tonight import build_tonight

router = APIRouter(prefix="/api/venues", tags=["Activity"])
```

**Edit 3.** Find:
```python
        for r in rows
    ]
```
Replace with:
```python
        for r in rows
    ]


@router.get("/{venue_id}/tonight", response_model=TonightResponse)
async def venue_tonight(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Phase 30: today's shifts with live clock status, alerts, and the week at a glance."""
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    return await build_tonight(db, venue)
```

---

## B3. `backend/src/routers/timesheets.py` (EDITS)
A no-show frees the spot and is audited with the `no_show:spot_released` marker. Adding time for a no-show takes the spot back when there's room. A manager clock-in logs activity.

**Edit 1.** Find:
```python

from src.database import get_db
from src.models import User, Shift, ShiftRequest, TimeEntry
from src.schemas import ReasonBody, TimeEntryInput, PayRateInput
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
```
Replace with:
```python

from src.database import get_db
from src.models import User, Shift, ShiftRequest, TimeEntry, TimeEntryEdit
from src.schemas import ReasonBody, TimeEntryInput, PayRateInput, NoShowResult
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
```

**Edit 2.** Find:
```python

router = APIRouter(prefix="/api", tags=["Time Sheets"])


```
Replace with:
```python

router = APIRouter(prefix="/api", tags=["Time Sheets"])

NO_SHOW_RELEASED = "no_show:spot_released"   # Phase 30: audit marker - this no-show freed the spot


async def _no_show_released_spot(db: AsyncSession, request_id) -> bool:
    """True when the latest no-show on this booking freed the spot (Phase 30 and later)."""
    last = await db.scalar(
        select(TimeEntryEdit).where(TimeEntryEdit.shift_request_id == request_id, TimeEntryEdit.action == "no_show")
        .order_by(TimeEntryEdit.created_at.desc()).limit(1)
    )
    return last is not None and last.new_value == NO_SHOW_RELEASED


```

**Edit 3.** Find:
```python


@router.post("/requests/{request_id}/no-show")
async def mark_no_show(
    request_id: UUID,
    body: ReasonBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    req, shift = await _load_request(db, request_id, current_user)
    st = (req.status or "").lower()
    if as_utc(shift.start_time) > datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="You can only mark a no-show after the shift starts.")
    if st not in ("approved", "confirmed"):
```
Replace with:
```python


@router.post("/requests/{request_id}/no-show", response_model=NoShowResult)
async def mark_no_show(
    request_id: UUID,
    body: ReasonBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 30: a no-show also frees their spot (spots_filled - 1, FILLED -> OPEN while the shift is
    still running) so the manager can find cover straight away. The audit row's new_value is
    NO_SHOW_RELEASED so undoing it (adding time) gives the spot back.
    """
    req, shift = await _load_request(db, request_id, current_user)
    st = (req.status or "").lower()
    now = datetime.now(timezone.utc)
    if as_utc(shift.start_time) > now:
        raise HTTPException(status_code=400, detail="You can only mark a no-show after the shift starts.")
    if st not in ("approved", "confirmed"):
```

**Edit 4.** Find:
```python
    if has_entries:
        raise HTTPException(status_code=400, detail="They have clock-in records. Delete those first if they really didn't show.")
    try:
        req.status = "no_show"
        req.status_reason = (body.reason or "").strip() or None
        audit(db, req.id, None, current_user.id, "no_show", st, "no_show", req.status_reason)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to mark no-show: {str(e)}")
    return {"detail": "Marked as no-show."}


```
Replace with:
```python
    if has_entries:
        raise HTTPException(status_code=400, detail="They have clock-in records. Delete those first if they really didn't show.")
    reopened = False
    try:
        req.status = "no_show"
        req.status_reason = (body.reason or "").strip() or None
        shift.spots_filled = max(0, (shift.spots_filled or 1) - 1)
        if (shift.status or "").upper() == "FILLED" and as_utc(shift.end_time) > now:
            shift.status = "OPEN"
        reopened = as_utc(shift.end_time) > now and (shift.status or "").upper() == "OPEN"
        audit(db, req.id, None, current_user.id, "no_show", st, NO_SHOW_RELEASED, req.status_reason)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to mark no-show: {str(e)}")
    await notify_events.no_show_marked(request_id)                                            # Phase 30
    await activity.for_request("no_show", request_id, current_user.id,
                               f"Reason: {req.status_reason}" if req.status_reason else "")
    return NoShowResult(
        detail="Marked as no-show. Their spot is open again." if reopened else "Marked as no-show.",
        spot_reopened=reopened,
    )


```

**Edit 5.** Find:
```python
        raise HTTPException(status_code=400, detail="Time can only be added for people booked on this shift.")
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
    try:
        entry = TimeEntry(
```
Replace with:
```python
        raise HTTPException(status_code=400, detail="Time can only be added for people booked on this shift.")
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
    reclaim = st == "no_show" and await _no_show_released_spot(db, req.id)   # Phase 30
    try:
        entry = TimeEntry(
```

**Edit 6.** Find:
```python
        if st == "no_show":
            req.status_reason = None
        audit(db, req.id, entry.id, current_user.id, "add", None, fmt_range(cin, cout), reason)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add time: {str(e)}")
    return {"detail": "Time added.", "entry_id": str(entry.id)}

```
Replace with:
```python
        if st == "no_show":
            req.status_reason = None
        # Phase 30: the no-show had freed their spot and they worked after all -> take it back.
        # If someone already covered it and the position is full, leave the count alone (capacity is a hard limit).
        if reclaim and (shift.spots_filled or 0) < (shift.capacity or 1):
            shift.spots_filled = (shift.spots_filled or 0) + 1
            if shift.spots_filled >= (shift.capacity or 1) and (shift.status or "").upper() == "OPEN":
                shift.status = "FILLED"
        audit(db, req.id, entry.id, current_user.id, "add", None, fmt_range(cin, cout), reason)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add time: {str(e)}")
    if cout is None:   # Phase 30: "Clock in for them" from the Tonight board (or the time sheet)
        await activity.for_request("manager_clock_in", request_id, current_user.id, f"Reason: {reason}")
    return {"detail": "Time added.", "entry_id": str(entry.id)}

```

---

## B4. `backend/src/services/notify_events.py` (EDIT)
New `no_show_marked(request_id)` hook.

**Edit 1.** Find:
```python


# ---------------------------------------------------------------------------------------------
# Hand-offs (transfers)
```
Replace with:
```python


async def _no_show_marked(db: AsyncSession, request_id) -> None:
    """Phase 30: tell the worker they were marked a no-show (so they can speak up if it's wrong)."""
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if req is None:
        return
    shift, venue, event, _ = await _shift_bundle(db, req.shift_id)
    if shift is None:
        return
    reason = f"\nNote from your manager: {req.status_reason}" if req.status_reason else ""
    await notify_in(
        db, [req.worker_id], "no_show",
        f"Marked as a no-show: {shift.role_type} · {event.title if event else shift.title}",
        f"{when_text(shift.start_time, venue)}. If you were there, message your manager so they can fix your hours.{reason}",
        worker_shift_link(req.id), venue_id=shift.venue_id, event_id=shift.event_id, request_id=req.id, urgent=True,
        dedupe_key=f"noshow:{req.id}",
    )


async def no_show_marked(request_id) -> None:
    await _run("no_show_marked", _no_show_marked, request_id)


# ---------------------------------------------------------------------------------------------
# Hand-offs (transfers)
```

---

## B5. `backend/src/services/notify.py` (EDIT)
Registers the two new notification kinds so email/SMS preferences apply.

**Edit 1.** Find:
```python
    "team_added": ("booking", False),        # Phase 29.1: a manager added you to their team
    "shift_dropped": ("manager", True),      # Phase 29.1: a worker dropped a booked shift
    "test": ("test", True),
}
```
Replace with:
```python
    "team_added": ("booking", False),        # Phase 29.1: a manager added you to their team
    "shift_dropped": ("manager", True),      # Phase 29.1: a worker dropped a booked shift
    "no_show": ("booking", True),            # Phase 30: a manager marked you a no-show
    "unfilled_soon": ("manager", True),      # Phase 30: spots still open 3 h before start
    "test": ("test", True),
}
```

---

## B6. `backend/src/services/activity.py` (EDITS)
New kinds: `no_show`, `manager_clock_in` and `unfilled_soon`, all in the **Alerts** filter.

**Edit 1.** Find:
```python
  team      - team changes, invites, joins, co-managers
  changes   - events posted / edited / cancelled / copied, venue settings
  alerts    - not clocked in
"""
import logging
```
Replace with:
```python
  team      - team changes, invites, joins, co-managers
  changes   - events posted / edited / cancelled / copied, venue settings
  alerts    - not clocked in, no-shows, manager clock-ins, spots still open close to start (Phase 30)
"""
import logging
```

**Edit 2.** Find:
```python
    "venue_settings": "changes",
    "not_clocked_in": "alerts",
}
CATEGORIES = ("bookings", "staffing", "team", "changes", "alerts")
```
Replace with:
```python
    "venue_settings": "changes",
    "not_clocked_in": "alerts",
    "no_show": "alerts",                # Phase 30
    "manager_clock_in": "alerts",
    "unfilled_soon": "alerts",
}
CATEGORIES = ("bookings", "staffing", "team", "changes", "alerts")
```

**Edit 3.** Find:
```python
        "assigned": f"Assigned {name} to {what}",
        "offer_accepted": f"{name} accepted the offer for {what}",
    }.get(kind, f"{name}: {what}")
    if extra:
```
Replace with:
```python
        "assigned": f"Assigned {name} to {what}",
        "offer_accepted": f"{name} accepted the offer for {what}",
        "no_show": f"Marked {name} as a no-show for {what}",               # Phase 30
        "manager_clock_in": f"Clocked {name} in for {what}",
    }.get(kind, f"{name}: {what}")
    if extra:
```

---

## B7. `backend/src/services/notification_worker.py` (EDITS)
New `scan_unfilled` step. It runs once a minute with the other scans; the dedupe key makes it fire once per position.

**Edit 1.** Find:
```python
  3. "not clocked in" 10 minutes after start -> the worker (urgent) and the venue's managers
  4. managers: people who haven't read an UPDATE to a shift starting within 24h (once per update)
  5. send due email / SMS from the outbox

Only one process runs a tick at a time (Redis lock). If Redis is unreachable the tick still runs;
```
Replace with:
```python
  3. "not clocked in" 10 minutes after start -> the worker (urgent) and the venue's managers
  4. managers: people who haven't read an UPDATE to a shift starting within 24h (once per update)
  5. managers: a position still has open spots 3 hours before it starts (once per position; Phase 30)
  6. send due email / SMS from the outbox

Only one process runs a tick at a time (Redis lock). If Redis is unreachable the tick still runs;
```

**Edit 2.** Find:
```python


async def run_tick() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        await auto_close_open_entries(db)
    for label, fn in (("reminders", scan_reminders), ("late", scan_late), ("unread", scan_unread_updates)):
        try:
            async with AsyncSessionLocal() as db:
```
Replace with:
```python


UNFILLED_WINDOW = timedelta(hours=3)


async def scan_unfilled(db: AsyncSession, now: datetime) -> int:
    """Phase 30: one alert per position that still has open spots when it's 3 h (or less) from starting."""
    rows = (await db.execute(
        select(Shift).where(
            func.upper(Shift.status) == "OPEN",
            Shift.start_time > now,
            Shift.start_time <= now + UNFILLED_WINDOW,
            Shift.spots_filled < Shift.capacity,
        )
    )).scalars().all()
    sent = 0
    for s in rows:
        ev = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == s.event_id)) if s.event_id else None
        if ev is not None and (ev.cancelled_at is not None or (ev.status or "published") != "published"):
            continue
        venue = await db.scalar(select(Venue).where(Venue.id == s.venue_id))
        open_n = (s.capacity or 1) - (s.spots_filled or 0)
        name = ev.title if ev else s.title
        n = await notify_in(
            db, await manager_ids(db, s.venue_id), "unfilled_soon",
            f"{open_n} {s.role_type} spot{'s' if open_n != 1 else ''} still open: {name}",
            f"Starts {when_text(s.start_time, venue)}. Offer it or assign someone from the Today board.",
            manager_link(s.venue_id, s.event_id), venue_id=s.venue_id, event_id=s.event_id,
            urgent=True, dedupe_key=f"unfilled3h:{s.id}",
        )
        if n:
            sent += n
            await record_in(db, s.venue_id, "unfilled_soon",
                            f"{open_n} {s.role_type} spot{'s' if open_n != 1 else ''} still open 3 h before {name}",
                            event_id=s.event_id)
    return sent


async def run_tick() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        await auto_close_open_entries(db)
    for label, fn in (("reminders", scan_reminders), ("late", scan_late), ("unread", scan_unread_updates),
                      ("unfilled", scan_unfilled)):
        try:
            async with AsyncSessionLocal() as db:
```

---

# PART C: Frontend

New folder: `frontend/src/components/manager/`.

## C1. NEW FILE `frontend/src/components/manager/TonightBoard.jsx`
Fetches `/venues/{id}/tonight`, polls every 60 s while visible, and owns the Clock in / No-show dialogs (existing `ConfirmDialog`) and Find cover (existing `StaffPositionModal`).

```jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sun, CalendarDays, RefreshCw, AlarmClock, UserX, UserPlus, EyeOff, MapPinOff, Phone, LogIn, ClipboardList, MessageSquare, CheckCircle2,
} from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import StaffPositionModal from '../StaffPositionModal';
import TodayEventCard from './TodayEventCard';
import WeekAtGlance from './WeekAtGlance';
import { fmtDate, fmtTime } from '../../utils/venueTime';

const POLL_MS = 60000;          // live refresh while the tab is visible
const ALERTS_SHOWN = 4;
const ALERT_ICON = {
  late: [AlarmClock, 'text-rose-400'],
  missed: [UserX, 'text-rose-300'],
  open_spot: [UserPlus, 'text-amber-300'],
  unread: [EyeOff, 'text-amber-200'],
  geo: [MapPinOff, 'text-amber-300'],
};

function agoText(ms) {
  const s = Math.round(ms / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  return `${m} min ago`;
}

/**
 * Phase 30: The manager's "Today / This week" board (top of the dashboard).
 * Today: every event touching today with live clock status and one-tap actions, plus alerts.
 * This week: today + 6 days at a glance.
 * Refreshes every minute while visible, when the tab comes back, and when refreshKey changes.
 * Props: venueId, timeZone, refreshKey, reliabilityMap,
 *        onOpenBoard({ id, title, role_type }), onOpenEvent(eventId), onTimesheet(eventId), onOpenWorker(workerId),
 *        onChanged(message)   -> parent reloads everything and shows the message
 *        onSummary({ late, openSpots })
 */
export default function TonightBoard({
  venueId, timeZone, refreshKey = 0, reliabilityMap = {},
  onOpenBoard, onOpenEvent, onTimesheet, onOpenWorker, onChanged, onSummary,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(null);                 // 'today' | 'week' (picked after the first load)
  const [loadedAt, setLoadedAt] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [confirm, setConfirm] = useState(null);         // ConfirmDialog props
  const [cover, setCover] = useState(null);             // { event, position } for StaffPositionModal
  const [highlight, setHighlight] = useState(null);     // request id flashed after tapping an alert
  const venueRef = useRef(venueId);
  venueRef.current = venueId;

  const load = useCallback(async (quiet = false) => {
    if (!venueId) return;
    if (!quiet) setLoading(true);
    try {
      const res = await api.get(`/venues/${venueId}/tonight`);
      if (venueRef.current !== venueId) return;
      setData(res.data);
      setError('');
      setLoadedAt(Date.now());
      setTab((t) => t || ((res.data.events || []).length ? 'today' : 'week'));
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load today’s board.');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    setData(null);
    setTab(null);
    load();
  }, [venueId, load]);

  useEffect(() => {
    if (refreshKey) load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // live: poll while visible, reload when the tab comes back, tick the clock for "starts in" text
  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, POLL_MS);
    const tick = setInterval(() => setNowMs(Date.now()), 15000);
    const onVis = () => document.visibilityState === 'visible' && load(true);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  useEffect(() => {
    if (!data || !onSummary) return;
    onSummary({
      late: (data.counts?.late || 0) + (data.counts?.missed || 0),
      openSpots: (data.alerts || []).filter((a) => a.kind === 'open_spot').length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const lookup = useMemo(() => {
    const people = {};
    const positions = {};
    const events = {};
    (data?.events || []).forEach((ev) => {
      events[ev.event_key] = ev;
      ev.positions.forEach((pos) => {
        positions[pos.shift_id] = { pos, ev };
        pos.people.forEach((p) => { people[p.request_id] = { p, pos, ev }; });
      });
    });
    return { people, positions, events };
  }, [data]);

  const done = (message) => {
    load(true);
    onChanged?.(message);
  };

  // ---- actions ----
  const openBoard = (pos, ev) => onOpenBoard?.({ id: pos.shift_id, title: ev.title, role_type: pos.role_type });

  const askClockIn = (p) => setConfirm({
    title: `Clock ${p.first_name} in now?`,
    message: `Records ${p.first_name} as clocked in at ${fmtTime(new Date(), timeZone)}. They clock out as usual, or you can fix the times on the time sheet.`,
    confirmLabel: 'Clock in',
    input: { label: 'Reason (saved on the time sheet)', placeholder: 'e.g. Phone died, signed in at the door', required: true },
    onConfirm: async (reason) => {
      await api.post(`/requests/${p.request_id}/time-entries`, { clock_in_time: new Date().toISOString(), clock_out_time: null, reason });
      done(`${p.first_name} is clocked in.`);
    },
  });

  const askNoShow = (p, ev) => setConfirm({
    title: `Mark ${p.first_name} as a no-show?`,
    message: ev.state === 'ended'
      ? 'This counts against their reliability, and they’ll be told. If they did work, add their hours on the time sheet instead.'
      : 'This counts against their reliability, and they’ll be told. Their spot opens up so you can find cover.',
    confirmLabel: 'Mark no-show',
    danger: true,
    input: { label: 'Note (optional, they’ll see it)', placeholder: 'e.g. No answer on the phone' },
    onConfirm: async (reason) => {
      const res = await api.post(`/requests/${p.request_id}/no-show`, { reason: reason || null });
      done(res.data?.spot_reopened
        ? `${p.first_name} marked as a no-show. Their spot is open: tap “Find cover”.`
        : `${p.first_name} marked as a no-show.`);
    },
  });

  const findCover = (pos, ev) => setCover({
    event: { title: ev.title, start_time: ev.start_time },
    position: {
      shift_id: pos.shift_id, role_type: pos.role_type, capacity: pos.capacity,
      assigned: pos.people.filter((p) => p.clock_state !== 'no_show'),
    },
  });

  const alertActions = (a) => {
    const person = a.request_id ? lookup.people[a.request_id] : null;
    const position = a.shift_id ? lookup.positions[a.shift_id] : null;
    const ev = lookup.events[a.event_key];
    const btn = 'px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 border transition';
    const out = [];
    if (a.kind === 'late' && person) {
      if (person.p.phone) {
        out.push(<a key="call" href={`tel:${person.p.phone}`} className={`${btn} border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`}><Phone className="w-3 h-3" /> Call</a>);
      }
      out.push(<button key="in" type="button" onClick={() => askClockIn(person.p)} className={`${btn} border-emerald-500/40 bg-emerald-600/20 text-emerald-200`}><LogIn className="w-3 h-3" /> Clock in</button>);
      out.push(<button key="ns" type="button" onClick={() => askNoShow(person.p, person.ev)} className={`${btn} border-rose-500/40 bg-rose-600/15 text-rose-200`}><UserX className="w-3 h-3" /> No-show</button>);
    }
    if (a.kind === 'missed' && person) {
      out.push(<button key="ns" type="button" onClick={() => askNoShow(person.p, person.ev)} className={`${btn} border-rose-500/40 bg-rose-600/15 text-rose-200`}><UserX className="w-3 h-3" /> No-show</button>);
      if (a.event_id) out.push(<button key="ts" type="button" onClick={() => onTimesheet?.(a.event_id)} className={`${btn} border-slate-700 bg-slate-800 text-slate-200`}><ClipboardList className="w-3 h-3" /> Add hours</button>);
    }
    if (a.kind === 'open_spot' && position) {
      out.push(<button key="cover" type="button" onClick={() => findCover(position.pos, position.ev)} className={`${btn} border-amber-500 bg-amber-500 text-slate-950`}><UserPlus className="w-3 h-3" /> Find cover</button>);
    }
    if (a.kind === 'unread' && ev && ev.positions[0]) {
      out.push(<button key="board" type="button" onClick={() => openBoard(ev.positions[0], ev)} className={`${btn} border-slate-700 bg-slate-800 text-slate-200`}><MessageSquare className="w-3 h-3" /> Message</button>);
    }
    if (a.kind === 'geo' && a.event_id) {
      out.push(<button key="ts" type="button" onClick={() => onTimesheet?.(a.event_id)} className={`${btn} border-slate-700 bg-slate-800 text-slate-200`}><ClipboardList className="w-3 h-3" /> Time sheet</button>);
    }
    return out;
  };

  const events = data?.events || [];
  const alerts = data?.alerts || [];
  const shownAlerts = showAllAlerts ? alerts : alerts.slice(0, ALERTS_SHOWN);
  const nextUp = (data?.week || []).slice(1).flatMap((d) => d.events.map((e) => ({ ...e, day: d.label }))).find((e) => e.status !== 'draft');
  const c = data?.counts || {};
  const tabBtn = (id) => `px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition ${
    tab === id ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
  }`;
  // live events first, then upcoming, then ended
  const ordered = [...events].sort((a, b) => {
    const rank = { live: 0, upcoming: 1, ended: 2 };
    return (rank[a.state] - rank[b.state]) || (new Date(a.start_time) - new Date(b.start_time));
  });

  return (
    <section id="tonight-board" className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 space-y-4 scroll-mt-4">
      <header className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-white">
            {tab === 'week' ? 'This week' : 'Today'}
            {data && <span className="ml-2 text-sm font-normal text-slate-400">{fmtDate(data.now, timeZone)}</span>}
          </h2>
          {data && (
            <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live · updated {agoText(nowMs - loadedAt)}
              </span>
              {c.events > 0 && (
                <span>
                  {c.events} event{c.events === 1 ? '' : 's'} · {c.booked} booked · {c.clocked_in} in now
                  {c.late > 0 && <strong className="text-rose-300"> · {c.late} late</strong>}
                  {c.open_spots > 0 && <strong className="text-amber-300"> · {c.open_spots} open</strong>}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="p-1 bg-slate-900 border border-slate-800 rounded-xl flex gap-1" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'today'} onClick={() => setTab('today')} className={tabBtn('today')}>
              <Sun className="w-3.5 h-3.5" /> Today
            </button>
            <button type="button" role="tab" aria-selected={tab === 'week'} onClick={() => setTab('week')} className={tabBtn('week')}>
              <CalendarDays className="w-3.5 h-3.5" /> This week
            </button>
          </div>
          <button type="button" onClick={() => load()} disabled={loading} aria-label="Refresh"
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{error}</div>}
      {!data && !error && <div className="h-24 rounded-xl bg-slate-900 animate-pulse" />}

      {data && tab === 'today' && (
        <>
          {alerts.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 divide-y divide-slate-800/70">
              {shownAlerts.map((a, i) => {
                const [Icon, tone] = ALERT_ICON[a.kind] || [AlarmClock, 'text-slate-400'];
                return (
                  <div key={`${a.kind}-${a.request_id || a.shift_id || a.event_key}-${i}`}
                    className={`p-2.5 flex flex-col sm:flex-row sm:items-center gap-2 ${a.severity === 'high' ? 'bg-rose-500/5' : ''}`}>
                    <button type="button" onClick={() => setHighlight(a.request_id)} className="flex-1 min-w-0 flex items-start gap-2 text-left">
                      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${tone}`} />
                      <span className={`text-xs ${a.severity === 'high' ? 'text-white font-semibold' : 'text-slate-300'}`}>{a.text}</span>
                    </button>
                    <div className="flex flex-wrap gap-1.5 pl-6 sm:pl-0">{alertActions(a)}</div>
                  </div>
                );
              })}
              {alerts.length > ALERTS_SHOWN && (
                <button type="button" onClick={() => setShowAllAlerts((s) => !s)} className="w-full p-2 text-[11px] text-slate-400 hover:text-white">
                  {showAllAlerts ? 'Show fewer' : `Show all ${alerts.length} alerts`}
                </button>
              )}
            </div>
          )}

          {events.length === 0 ? (
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 text-center">
              <CheckCircle2 className="w-6 h-6 text-slate-600 mx-auto mb-1" />
              <p className="text-sm text-slate-300 font-semibold">Nothing on today.</p>
              {nextUp && (
                <p className="text-xs text-slate-500 mt-1">
                  Next up: <strong className="text-slate-300">{nextUp.title}</strong> · {nextUp.day} {fmtTime(nextUp.start_time, timeZone)}
                </p>
              )}
              <button type="button" onClick={() => setTab('week')} className="mt-3 text-xs font-bold text-amber-300 hover:text-amber-200">See the week →</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
              {ordered.map((ev) => (
                <TodayEventCard
                  key={ev.event_key}
                  event={ev}
                  timeZone={timeZone}
                  nowMs={nowMs}
                  reliabilityMap={reliabilityMap}
                  highlightRequestId={highlight}
                  onBoard={(pos) => openBoard(pos, ev)}
                  onClockIn={(p) => askClockIn(p)}
                  onNoShow={(p) => askNoShow(p, ev)}
                  onFindCover={(pos) => findCover(pos, ev)}
                  onOpenEvent={onOpenEvent}
                  onTimesheet={onTimesheet}
                  onOpenWorker={onOpenWorker}
                />
              ))}
            </div>
          )}
        </>
      )}

      {data && tab === 'week' && <WeekAtGlance week={data.week} timeZone={timeZone} onOpenEvent={onOpenEvent} />}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
      {cover && (
        <StaffPositionModal
          event={cover.event}
          position={cover.position}
          onClose={() => setCover(null)}
          onDone={(message) => {
            setCover(null);
            done(message);
          }}
        />
      )}
    </section>
  );
}
```

---

## C2. NEW FILE `frontend/src/components/manager/TodayEventCard.jsx`

```jsx
import React, { useState } from 'react';
import {
  Phone, MessageSquare, LogIn, UserX, UserPlus, ClipboardList, Users, MapPin, MapPinOff, EyeOff, ChevronDown, ChevronUp, Radio,
} from 'lucide-react';
import ReliabilityBadge from '../ReliabilityBadge';
import { fmtTime, fmtTimeRange } from '../../utils/venueTime';

const STATE = {
  upcoming: { label: 'Not open yet', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  due: { label: 'Not in yet', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  late: { label: 'Late', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40 animate-pulse' },
  in: { label: 'In', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  done: { label: 'Done', cls: 'bg-slate-800 text-slate-300 border-slate-700' },
  missed: { label: 'Never clocked in', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  no_show: { label: 'No-show', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30 line-through' },
};

function minutesText(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

function startsText(event, nowMs) {
  const start = new Date(event.start_time).getTime();
  const end = new Date(event.end_time).getTime();
  if (event.state === 'ended') return 'Ended';
  if (event.state === 'live') {
    const left = Math.max(0, Math.round((end - nowMs) / 60000));
    return `Live now · ends in ${minutesText(left)}`;
  }
  const until = Math.max(0, Math.round((start - nowMs) / 60000));
  return until <= 0 ? 'Starting now' : `Starts in ${minutesText(until)}`;
}

/**
 * Phase 30: One event on the manager's Today board: each position, who is booked and whether
 * they're in, plus one-tap actions (call, message the shift board, clock them in, no-show, find cover).
 * Props: event (TonightEvent), timeZone, nowMs, reliabilityMap, highlightRequestId,
 *        onBoard(position), onClockIn(person, position), onNoShow(person, position), onFindCover(position),
 *        onOpenEvent(eventId), onTimesheet(eventId), onOpenWorker(workerId)
 */
export default function TodayEventCard({
  event, timeZone, nowMs, reliabilityMap = {}, highlightRequestId,
  onBoard, onClockIn, onNoShow, onFindCover, onOpenEvent, onTimesheet, onOpenWorker,
}) {
  const ended = event.state === 'ended';
  const [open, setOpen] = useState(!ended || event.missed > 0);
  const tone = event.late > 0
    ? 'border-rose-500/50'
    : event.state === 'live' ? 'border-emerald-500/40' : ended ? 'border-slate-800' : 'border-slate-700';
  const iconBtn = 'p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition';
  const actBtn = 'px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 transition disabled:opacity-50';

  return (
    <article className={`bg-slate-900 border rounded-2xl ${tone} ${ended ? 'opacity-80' : ''}`}>
      <header className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {event.state === 'live' && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                <Radio className="w-3 h-3" /> LIVE
              </span>
            )}
            <h3 className="text-base font-bold text-white truncate">{event.title}</h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-slate-200">{fmtTimeRange(event.start_time, event.end_time, timeZone)}</span>
            <span>·</span>
            <span>{startsText(event, nowMs)}</span>
            {event.location_name && (
              <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {event.location_name}</span>
            )}
          </p>
          <p className="text-[11px] mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-400">
            <span><strong className="text-white">{event.booked}</strong> booked</span>
            {(event.state !== 'upcoming' || event.clocked_in > 0) && (
              <span><strong className="text-emerald-300">{event.clocked_in + event.done}</strong> clocked in</span>
            )}
            {event.late > 0 && <span className="text-rose-300 font-bold">{event.late} late</span>}
            {event.missed > 0 && <span className="text-rose-300">{event.missed} never clocked in</span>}
            {event.no_show > 0 && <span className="text-rose-400">{event.no_show} no-show</span>}
            {event.open_spots > 0 && <span className="text-amber-300 font-bold">{event.open_spots} open</span>}
            {event.unread > 0 && <span className="text-amber-200">{event.unread} haven't read the update</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {event.event_id && !ended && (
            <button type="button" onClick={() => onOpenEvent?.(event.event_id)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> Roster
            </button>
          )}
          {event.event_id && event.state !== 'upcoming' && (
            <button type="button" onClick={() => onTimesheet?.(event.event_id)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1">
              <ClipboardList className="w-3.5 h-3.5" /> Time sheet
            </button>
          )}
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Hide people' : 'Show people'} className={iconBtn}>
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {open && (
        <div className="border-t border-slate-800 divide-y divide-slate-800/70">
          {event.positions.map((pos) => (
            <section key={pos.shift_id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-300">{pos.role_type}</h4>
                <span className="text-[11px] text-slate-500">
                  {pos.people.filter((p) => p.clock_state !== 'no_show').length}/{pos.capacity} booked
                </span>
                <button type="button" onClick={() => onBoard?.(pos)} className="ml-auto text-[11px] text-slate-400 hover:text-white inline-flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" /> Message this shift
                </button>
              </div>

              {pos.people.length === 0 && pos.open_spots === 0 && (
                <p className="text-xs text-slate-500">Nobody booked.</p>
              )}

              <ul className="space-y-1.5">
                {pos.people.map((p) => {
                  const st = STATE[p.clock_state] || STATE.upcoming;
                  let sub = '';
                  if (p.clock_state === 'upcoming') sub = `Clock-in opens ${fmtTime(event.clock_in_opens_at, timeZone)}`;
                  if (p.clock_state === 'due') sub = 'Clock-in is open';
                  if (p.clock_state === 'late') sub = `${minutesText(p.late_minutes)} past the start`;
                  if (p.clock_state === 'in') sub = `Since ${fmtTime(p.clock_in_time, timeZone)}${p.late_minutes ? ` · ${p.late_minutes} min late` : ''}`;
                  if (p.clock_state === 'done') sub = `${fmtTime(p.clock_in_time, timeZone)} – ${fmtTime(p.clock_out_time, timeZone)}`;
                  if (p.clock_state === 'missed') sub = 'Shift ended with no clock-in';
                  const canClockIn = ['due', 'late'].includes(p.clock_state);
                  const canNoShow = ['late', 'missed'].includes(p.clock_state);
                  return (
                    <li key={p.request_id}
                      className={`flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded-xl ${
                        String(highlightRequestId) === String(p.request_id) ? 'bg-amber-500/10 ring-1 ring-amber-500/40' : 'bg-slate-950/40'
                      }`}>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${st.cls}`}>{st.label}</span>
                        <div className="min-w-0">
                          <button type="button" onClick={() => onOpenWorker?.(p.worker_id)} className="text-sm font-semibold text-white hover:underline truncate text-left">
                            {p.first_name} {p.last_name}
                          </button>
                          <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                            {sub && <span className={p.clock_state === 'late' ? 'text-rose-300 font-semibold' : ''}>{sub}</span>}
                            {p.manager_clock && <span className="text-indigo-300">clocked in by a manager</span>}
                            {p.geo_flag && <span className="text-amber-300 inline-flex items-center gap-0.5"><MapPinOff className="w-3 h-3" /> away from site</span>}
                            {p.info_seen === false && ['upcoming', 'due', 'late'].includes(p.clock_state) && (
                              <span className="text-amber-200 inline-flex items-center gap-0.5"><EyeOff className="w-3 h-3" /> hasn't read the update</span>
                            )}
                            <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                        {p.phone ? (
                          <a href={`tel:${p.phone}`} className={iconBtn} aria-label={`Call ${p.first_name}`} title={`Call ${p.phone}`}>
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className={`${iconBtn} opacity-30 cursor-not-allowed`} title="No phone number on file"><Phone className="w-3.5 h-3.5" /></span>
                        )}
                        {canClockIn && (
                          <button type="button" onClick={() => onClockIn?.(p, pos)}
                            className={`${actBtn} bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-600/30`}>
                            <LogIn className="w-3.5 h-3.5" /> Clock in
                          </button>
                        )}
                        {canNoShow && (
                          <button type="button" onClick={() => onNoShow?.(p, pos)}
                            className={`${actBtn} bg-rose-600/15 border border-rose-500/40 text-rose-200 hover:bg-rose-600/25`}>
                            <UserX className="w-3.5 h-3.5" /> No-show
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {pos.open_spots > 0 && (
                <div className="mt-2 p-2 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-amber-200">
                    {pos.open_spots} open spot{pos.open_spots === 1 ? '' : 's'}
                  </span>
                  {(pos.pending_requests > 0 || pos.pending_offers > 0) && (
                    <span className="text-[11px] text-amber-100/70">
                      {[pos.pending_requests && `${pos.pending_requests} asked`, pos.pending_offers && `${pos.pending_offers} offered`].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <button type="button" onClick={() => onFindCover?.(pos)}
                    className={`${actBtn} ml-auto bg-amber-500 hover:bg-amber-400 text-slate-950`}>
                    <UserPlus className="w-3.5 h-3.5" /> Find cover
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
```

---

## C3. NEW FILE `frontend/src/components/manager/WeekAtGlance.jsx`

```jsx
import React from 'react';
import { FilePen, EyeOff, Users } from 'lucide-react';
import { fmtTime } from '../../utils/venueTime';

function fillTone(e) {
  if (e.status === 'draft') return 'border-slate-600 border-dashed text-slate-300';
  if (e.capacity > 0 && e.filled >= e.capacity) return 'border-emerald-500/40 text-emerald-100';
  if (e.filled === 0) return 'border-rose-500/40 text-rose-100';
  return 'border-amber-500/40 text-amber-100';
}

/** "2026-09-30" -> "Sep 30" without timezone drift (it's already a venue-local date) */
function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Phase 30: Today + the next 6 days. Each day shows how full it is; each event is a chip
 * (green = full, amber = partly filled, red = nobody yet, dashed = draft). Tap to open the roster.
 * Props: week (WeekDay[]), timeZone, onOpenEvent(eventId)
 */
export default function WeekAtGlance({ week = [], timeZone, onOpenEvent }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
      {week.map((d, i) => {
        const pct = d.capacity ? Math.round((100 * Math.min(d.filled, d.capacity)) / d.capacity) : 0;
        return (
          <section key={d.date} className={`rounded-xl border p-2.5 min-w-0 ${i === 0 ? 'bg-slate-900 border-amber-500/30' : 'bg-slate-900/60 border-slate-800'}`}>
            <header className="flex items-baseline justify-between gap-2">
              <h4 className={`text-xs font-bold ${i === 0 ? 'text-amber-300' : 'text-white'}`}>{d.label}</h4>
              <span className="text-[10px] text-slate-500">{shortDate(d.date)}</span>
            </header>
            {d.capacity > 0 ? (
              <div className="mt-1.5">
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">{d.filled}/{d.capacity} spots filled</p>
              </div>
            ) : (
              <p className="text-[10px] text-slate-600 mt-1.5">{d.events.length ? 'Drafts only' : 'Nothing posted'}</p>
            )}
            <ul className="mt-2 space-y-1.5">
              {d.events.map((e) => (
                <li key={e.event_key}>
                  <button type="button" disabled={!e.event_id} onClick={() => e.event_id && onOpenEvent?.(e.event_id)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg border bg-slate-950/50 hover:bg-slate-800/80 transition ${fillTone(e)}`}>
                    <p className="text-[10px] text-slate-400">{fmtTime(e.start_time, timeZone)}</p>
                    <p className="text-xs font-semibold truncate">{e.title}</p>
                    <p className="text-[10px] flex flex-wrap items-center gap-x-1.5 mt-0.5">
                      {e.status === 'draft' ? (
                        <span className="inline-flex items-center gap-0.5 text-slate-400"><FilePen className="w-3 h-3" /> Draft</span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5"><Users className="w-3 h-3" /> {e.filled}/{e.capacity}</span>
                      )}
                      {e.requested > 0 && <span className="text-amber-300">{e.requested} asked</span>}
                      {e.unread > 0 && <span className="text-amber-200 inline-flex items-center gap-0.5"><EyeOff className="w-3 h-3" />{e.unread}</span>}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
```

---

## C4. NEW FILE `frontend/src/components/manager/NeedsYouStrip.jsx`

```jsx
import React from 'react';
import { CheckCircle2, Users, ArrowRightLeft, AlarmClock, UserPlus, BellRing } from 'lucide-react';

/**
 * Phase 30: One slim strip at the top of the manager dashboard.
 * Everything waiting on the manager, with a tap to jump to it. When nothing is waiting it shrinks
 * to a single "all caught up" line (the request / hand-off cards are hidden while they're empty).
 * Props: requests (number), transfers (number), late (number: late + missed), openSpots (number: open-spot alerts),
 *        onJump(targetId)  -> 'approval-queue' | 'pending-transfers' | 'tonight-board'
 */
export default function NeedsYouStrip({ requests = 0, transfers = 0, late = 0, openSpots = 0, onJump }) {
  const total = requests + transfers + late + openSpots;

  if (total === 0) {
    return (
      <div className="px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 inline-flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span><strong className="text-slate-200">Nothing needs you right now.</strong> New requests, hand-offs and late arrivals show up here.</span>
      </div>
    );
  }

  const chip = 'px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition';
  const items = [
    late > 0 && { id: 'tonight-board', n: late, label: 'late or not clocked in', icon: AlarmClock,
      cls: 'bg-rose-500/15 border border-rose-500/40 text-rose-200 hover:bg-rose-500/25' },
    openSpots > 0 && { id: 'tonight-board', n: openSpots, label: openSpots === 1 ? 'open spot soon' : 'open spots soon', icon: UserPlus,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
    requests > 0 && { id: 'approval-queue', n: requests, label: requests === 1 ? 'request' : 'requests', icon: Users,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
    transfers > 0 && { id: 'pending-transfers', n: transfers, label: transfers === 1 ? 'hand-off' : 'hand-offs', icon: ArrowRightLeft,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
  ].filter(Boolean);

  return (
    <div className="p-2.5 rounded-2xl bg-slate-900 border border-amber-500/30 flex flex-wrap items-center gap-2" role="status">
      <span className="px-2 text-sm font-bold text-white inline-flex items-center gap-2">
        <BellRing className="w-4 h-4 text-amber-400" /> Needs you ({total})
      </span>
      {items.map((it) => (
        <button key={it.label} type="button" onClick={() => onJump?.(it.id)} className={`${chip} ${it.cls}`}>
          <it.icon className="w-3.5 h-3.5" /> {it.n} {it.label}
        </button>
      ))}
    </div>
  );
}
```

---

## C5. `frontend/src/pages/VenueManagerDashboard.jsx` (EDITS)
New layout: strip → board → Posted Shifts + side column. The queue cards render only while they have items. The old phone-only "jump to queues" strip is replaced by `NeedsYouStrip`, which shows on all sizes.

**Edit 1.** Find:
```jsx
import api from '../api/client';
import {
  Plus, Check, Building2, AlertCircle, Download, Settings, UserPlus, Globe, Users, ArrowRightLeft, X, LayoutTemplate,
} from 'lucide-react';
import PostedShiftsBoard from '../components/PostedShiftsBoard';
```
Replace with:
```jsx
import api from '../api/client';
import {
  Plus, Check, Building2, AlertCircle, Download, Settings, UserPlus, Globe, X, LayoutTemplate,
} from 'lucide-react';
import PostedShiftsBoard from '../components/PostedShiftsBoard';
```

**Edit 2.** Find:
```jsx
import { ApprovalQueueCard, TransfersCard } from '../components/ManagerQueues';
import { WorkerProfileModal } from '../components/WorkerProfilePanel';

/**
 * Venue manager dashboard.
 * Phase 29.1 layout: Posted Shifts on the left (2/3), and on the right the things that need you
 * (requests, hand-offs) plus the venue's activity log. On phones a "Needs attention" strip at the
 * top jumps to the queues. The old Phase 16 roster/calendar code (never shown) was removed.
 */
export default function VenueManagerDashboard() {
```
Replace with:
```jsx
import { ApprovalQueueCard, TransfersCard } from '../components/ManagerQueues';
import { WorkerProfileModal } from '../components/WorkerProfilePanel';
import TonightBoard from '../components/manager/TonightBoard';
import NeedsYouStrip from '../components/manager/NeedsYouStrip';

/**
 * Venue manager dashboard.
 * Phase 30 layout, top to bottom:
 *   1. "Needs you (N)" strip: requests, hand-offs, late people, open spots soon (tap to jump)
 *   2. Today / This week board: live clock status and one-tap actions (TonightBoard)
 *   3. Posted Shifts (2/3) + right column: request / hand-off cards (only while they have items) and the activity log
 */
export default function VenueManagerDashboard() {
```

**Edit 3.** Find:
```jsx
  const [review, setReview] = useState(null);         // Phase 29.1: { type: 'request' | 'transfer', data }
  const [profileWorkerId, setProfileWorkerId] = useState(null); // Phase 29.1: from the activity log
  const noticeTimer = useRef(null);

```
Replace with:
```jsx
  const [review, setReview] = useState(null);         // Phase 29.1: { type: 'request' | 'transfer', data }
  const [profileWorkerId, setProfileWorkerId] = useState(null); // Phase 29.1: from the activity log
  const [tonightSummary, setTonightSummary] = useState({ late: 0, openSpots: 0 }); // Phase 30: from TonightBoard
  const noticeTimer = useRef(null);

```

**Edit 4.** Find:
```jsx

  const tz = venueDetails?.timezone;
  const attention = pendingRequests.length + pendingTransfers.length;
  const headerBtn =
    'px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50';
```
Replace with:
```jsx

  const tz = venueDetails?.timezone;
  const headerBtn =
    'px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50';
```

**Edit 5.** Find:
```jsx
        )}

        {/* Phones / tablets: jump to the queues that sit below the shifts */}
        {attention > 0 && (
          <div className="lg:hidden flex flex-wrap gap-2">
            {pendingRequests.length > 0 && (
              <button type="button" onClick={() => scrollTo('approval-queue')}
                className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-bold inline-flex items-center gap-1.5">
                <Users className="w-4 h-4" /> {pendingRequests.length} request{pendingRequests.length === 1 ? '' : 's'} to review
              </button>
            )}
            {pendingTransfers.length > 0 && (
              <button type="button" onClick={() => scrollTo('pending-transfers')}
                className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-bold inline-flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4" /> {pendingTransfers.length} hand-off{pendingTransfers.length === 1 ? '' : 's'} to approve
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left: posted shifts */}
          <div className="lg:col-span-2 min-w-0">
            <PostedShiftsBoard
```
Replace with:
```jsx
        )}

        {/* Phase 30: everything waiting on you, then today's board */}
        <NeedsYouStrip
          requests={pendingRequests.length}
          transfers={pendingTransfers.length}
          late={tonightSummary.late}
          openSpots={tonightSummary.openSpots}
          onJump={scrollTo}
        />

        <TonightBoard
          venueId={currentVenueId}
          timeZone={tz}
          refreshKey={boardRefreshKey}
          reliabilityMap={reliabilityMap}
          onOpenBoard={setActiveDiscussionShift}
          onOpenEvent={openEvent}
          onTimesheet={(eventId) => setTimesheetEventId(eventId)}
          onOpenWorker={setProfileWorkerId}
          onChanged={afterChange}
          onSummary={setTonightSummary}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left: posted shifts (Phase 30: now below the Today board) */}
          <div className="lg:col-span-2 min-w-0">
            <PostedShiftsBoard
```

**Edit 6.** Find:
```jsx
          </div>

          {/* Right: what needs you + activity */}
          <aside className="space-y-6 min-w-0">
            <ApprovalQueueCard
              requests={pendingRequests}
              reliabilityMap={reliabilityMap}
              timeZone={tz}
              actionLoading={actionLoading}
              onReview={(req) => setReview({ type: 'request', data: req })}
              onApprove={handleApprove}
              onDeny={handleDeny}
            />
            <TransfersCard
              transfers={pendingTransfers}
              timeZone={tz}
              actionLoading={actionLoading}
              onReview={(t) => setReview({ type: 'transfer', data: t })}
              onApprove={handleApproveTransfer}
              onDeny={handleDenyTransfer}
            />
            <ActivityFeed
              venueId={currentVenueId}
```
Replace with:
```jsx
          </div>

          {/* Right: requests / hand-offs (only while something is waiting) + activity */}
          <aside className="space-y-6 min-w-0">
            {pendingRequests.length > 0 && (
              <ApprovalQueueCard
                requests={pendingRequests}
                reliabilityMap={reliabilityMap}
                timeZone={tz}
                actionLoading={actionLoading}
                onReview={(req) => setReview({ type: 'request', data: req })}
                onApprove={handleApprove}
                onDeny={handleDeny}
              />
            )}
            {pendingTransfers.length > 0 && (
              <TransfersCard
                transfers={pendingTransfers}
                timeZone={tz}
                actionLoading={actionLoading}
                onReview={(t) => setReview({ type: 'transfer', data: t })}
                onApprove={handleApproveTransfer}
                onDeny={handleDenyTransfer}
              />
            )}
            <ActivityFeed
              venueId={currentVenueId}
```

---

## C6. `frontend/src/components/TimesheetModal.jsx` (EDIT)
Copy only: the no-show confirmation now says the worker is told and the spot reopens.

**Edit 1.** Find:
```jsx
        )}
        {f.kind === 'delete' && <p className="text-xs text-rose-300">Delete this time entry?</p>}
        {f.kind === 'noshow' && <p className="text-xs text-rose-300">Mark as a no-show? This counts against their reliability.</p>}
        <input
          value={f.reason}
```
Replace with:
```jsx
        )}
        {f.kind === 'delete' && <p className="text-xs text-rose-300">Delete this time entry?</p>}
        {f.kind === 'noshow' && <p className="text-xs text-rose-300">Mark as a no-show? This counts against their reliability, they’re told, and their spot opens again.</p>}
        <input
          value={f.reason}
```

---

## E. Rebuild & verification

**No schema change.** Just rebuild:
```bash
docker compose up -d --build
```
(`docker compose down -v` is **not** needed. The standard `docker compose down -v && docker compose up -d --build` also works if you want a clean database.)

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

**Quick API check** (manager token):
```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost/api/venues/<venue_id>/tonight | head -c 600
```
It returns `events`, `alerts`, `counts` and `week` (7 days). A worker token returns 403.

### Checklist
**Set-up:** post an event starting ~15 minutes from now with 2–3 positions. Assign three people and leave one spot open. Have one person clock in from their phone.

1. **Layout:** `/venue` shows, top to bottom:
   * the "Needs you" strip
   * **Today** (with a Today / This week toggle)
   * Posted Shifts on the left, with the activity log on the right

   With no pending requests or hand-offs, those two cards aren't shown at all.
2. **Before the start:**
   * People show **Not open yet** until the clock-in window opens, then **Not in yet**.
   * The open position shows **1 open spot → Find cover**, and an alert "1 Server spot open · … starts 7:00 PM" appears at the top.
3. **After start + 10 min:**
   * Anyone not in shows a pulsing **Late · 12 min past the start**.
   * An alert appears with **Call / Clock in / No-show**.
   * The strip shows "N late or not clocked in".
   * The board updates on its own within a minute; no refresh is needed.
4. **Clock in for them:**
   * **Clock in** asks for a reason. Afterwards they show **In · clocked in by a manager**.
   * The activity log (Alerts filter) shows "Clocked … in for …".
   * The time sheet shows the entry with the manager marker.
5. **No-show:**
   * On a late person, **No-show** asks for an optional note. Afterwards they show **No-show** and the position shows **1 open spot**.
   * **Find cover → Assign** books someone else (offers are disabled after the start, as before).
   * The worker gets "Marked as a no-show…", and the activity log shows it.
6. **Undo:** on the time sheet, add time for the no-show person. They become checked in, and the spot count goes back up if there's room.
7. **Message:** "Message this shift" opens the shift board for that position.
8. **Call:** 📞 dials on a phone. It's greyed out for someone with no phone number.
9. **This week:**
   * Seven day columns (stacked on phones), each with a fill bar and chips.
   * Drafts are dashed; full events are green, partly filled amber, empty red.
   * Tapping a chip opens its roster.
10. **Unfilled alert:** a published position with open spots starting in under 3 h gets **one** bell alert, "N … spots still open: …", and an `unfilled_soon` line in the activity log. It isn't repeated on the next minute's tick.
11. **Phone width:**
    * The strip chips wrap.
    * Alert actions sit under the alert text.
    * Person rows stack name/state above their action buttons.
    * Nothing scrolls sideways.