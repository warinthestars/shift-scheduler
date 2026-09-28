# Phase 33.1: Hours & Pay, and a Plain-Language Pass

**Why:**
* Workers can't see what they've earned. The only record is the manager's payroll CSV, and that CSV printed times in **UTC**: a 9 PM shift in New York showed as 01:00 the next day.
* Error messages still leak developer text: "status: pending_manager_approval", Python exception text, "Firebase token verification failed", and screens that could crash on form errors.
* The same things have different names on different screens ("Confirmed" vs "Booked", "My Schedule" vs "My shifts", "transfer" vs "hand-off").

**Decisions (yours):**
* Weeks start **Monday**.
* Workers get a **card on My shifts plus a full Hours & pay page**.
* **Wording-only** edits are allowed in `backend/src/auth.py` and `backend/src/routers/auth.py`. Only `detail="…"` strings change there, and that was verified line by line.

## Part 1: Hours & pay
**Worker: `/earnings` ("Hours & pay")**, linked from a card at the top of My shifts, the desktop nav, and the phone tab bar pages.
* Chips: **This week · Last week · This month · Last month**. Weeks run Mon–Sun, in the worker's own time zone (Notification settings).
* Tiles:
  - **Hours** (and shifts worked)
  - **Pay** (before tips and taxes)
  - **Still coming**: booked shifts not yet started in that period, with estimated pay
* **By venue**, when more than one venue.
* Every clock-in grouped by day, in the venue's time: times, hours × rate = pay.
* Tags: *Gets tips*, *Your rate for this shift*, *Time changed by a manager*, *Clocked out automatically*.
* An open clock-in shows as "now" and counts once they clock out.
* **Download (spreadsheet)**: their own hours as a CSV for their records. Venue-local times, labeled columns, and a total row.
* The rate is the manager's per-person rate if they set one, otherwise the posted rate. That's the same rule as the time sheet and payroll. Hidden pay isn't an issue here: they worked the shift.

**Manager: "Payroll CSV" becomes "Download hours".**
* A small dialog: This week · Last week · This month · Last month · Everything · Pick dates.
* The export now:
  - uses the **venue's time zone** (headers say e.g. "Clock in (EDT)")
  - takes an optional **date range**
  - has plain column names ("Pay before tips", "Clock-in location: Outside the area (180 m)")
  - has a file name like `hours-and-pay-the-hippodrome.csv`
* The older `/export-hours` CSV gets the same time-zone fix.

**API** (175 → **177** operations):
* `GET /api/me/earnings?period=week|last_week|month|last_month|custom&start=&end=` → `EarningsResponse`
  - 400 for a bad custom range
  - 422 for an unknown period
* `GET /api/me/earnings.csv` (same parameters)
* `GET /api/venues/{id}/payroll/export` and `/export-hours` gain optional `start` / `end` (YYYY-MM-DD, venue time).

## Part 2: Plain-language pass
1. **All errors are plain, from one place.** New `frontend/src/utils/apiErrors.js` adds a **second** response handler to the shared API client. `client.js` itself is untouched. It runs from `main.jsx` and:
   * **500-level:** removes the server's technical text, so each screen's own friendly fallback shows. The original stays in `raw_detail` and the console.
   * **422:** turns the list of field problems into one sentence ("The note is too long (up to 500 characters)."). This also fixes screens that would **crash** rendering that list.
   * **No connection:** "Can't reach ShiftBoard right now. Check your connection and try again."
2. **One name per thing:**
   * **Booked** (not "Confirmed"). **Waiting for approval**. "You dropped this" (not "Released").
   * **My shifts** (not "My Schedule"). **Shift chat** (not "Shift Discussion Board").
   * **Hand-off** everywhere: the last nine "transfer" errors are reworded. The notification now says "You're booked: …".
   * Unknown statuses now read "Updated", never a raw code.
3. **No raw codes or jargon:**
   * "status: {st}" and "must be venue_default, auto, or manual" are gone.
   * Manager screens:
     - "Venue default" → **Use venue setting**
     - "Instant booking" → **Book instantly**
     - "Radius (m)" → **Clock-in area (meters)**
     - "geofence" → **the area**
     - "Payroll CSV" → **Download hours**
   * Roles read **Worker / Manager / Admin**. The nav says **My shifts · Hours & pay** for workers and **My venue** for managers.
   * The login tagline and demo labels are plain. Sign-in errors say "Please sign in again" or "This account is turned off…".
4. **Sentence case:** Posted shifts, Post a shift, "This page isn't for your account", Go to my page.
5. **Cleanup:** delete the unused `ShiftRosterModal.jsx`, and delete `manager/TimeOffCard.jsx` (still in the repo since 32.1).

**No schema change. No package changes.**

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`, `main.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`, `frontend/public/`
* **In `backend/src/auth.py` and `backend/src/routers/auth.py`, change ONLY the `detail="…"` strings shown in B1/B2.** Nothing else in those files. This was verified: with the `detail=` lines removed, both files are identical to before.
* No new packages. No database changes, so no `docker compose down -v` is needed.
* Aware UTC datetimes only. Dates for periods are converted from the worker's or venue's time zone to UTC before querying.
* **NEW FILE / FULL FILE REPLACEMENT**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from your **current** files: all 43 files touched here were checked against your repo and match (33.0.1 is fully applied). They were verified:
  - **Backend:** imports cleanly; **177** API operations (175 + 2).
  - **Frontend:** bundles with no missing imports.
  - **A new 24-check Hours & pay suite** passes. It covers:
    - Monday weeks in the worker's own time zone
    - 4 h × $30 = $120; a manager rate of $25 used for last week
    - an open clock-in listed but not counted; per-venue counts that agree
    - "still coming" from booked shifts
    - custom and backwards ranges; only your own hours
    - the worker CSV in venue time with a total row
    - the manager CSV: **5 PM shows as 5 PM (not 9 PM UTC)**, the date range limits rows, "Outside the area (180 m)" and no "geofence"
  - **All earlier suites pass** with the reworded messages (28, 20, 97, 36, 64, 67, 39, 49, 107, 32, 17, and 24 for Firebase/push).
  - In real Chromium, on phone and desktop:
    - the My shifts card, the Hours & pay page and the manager's Download hours dialog
    - **both downloads produce real files** (`shiftboard-hours-…csv`, `hours-and-pay-the-hippodrome.csv` with "Clock in (EDT)")
    - a faked 500 with asyncpg text shows "Couldn't load your hours…"
    - a faked 422 shows "The note is too long (up to 500 characters)."
    - a dropped connection shows the connection message
    - no page errors

  Don't "improve" them.

---

# PART A: Hours & pay, backend

## A1. `backend/src/schemas.py` (EDIT)
Adds `EarningsShift`, `EarningsVenue`, `EarningsUpcoming`, `EarningsResponse` just before `WorkerProfile.model_rebuild()`.

**Edit 1.** Find:
```python


WorkerProfile.model_rebuild()
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
```
Replace with:
```python



# ------------------------------------------------------------------------------
# Phase 33.1: a worker's own hours & pay
# ------------------------------------------------------------------------------
class EarningsShift(BaseModel):
    entry_id: UUID
    shift_id: UUID
    request_id: Optional[UUID] = None
    event_title: str
    venue_id: UUID
    venue_name: str
    venue_timezone: str = "America/New_York"
    role_type: str
    clock_in_time: datetime
    clock_out_time: Optional[datetime] = None
    in_progress: bool = False                # still clocked in (counts 0 h until clock-out)
    hours: float = 0
    rate: float = 0
    rate_custom: bool = False                # the manager set this person's rate for the shift
    pay: float = 0                           # hours x rate, before tips and taxes
    tips_eligible: bool = False
    auto_closed: bool = False                # clocked out automatically
    edited: bool = False                     # a manager changed the times


class EarningsVenue(BaseModel):
    venue_id: UUID
    name: str
    hours: float = 0
    pay: float = 0
    shifts: int = 0


class EarningsUpcoming(BaseModel):
    shifts: int = 0                          # booked, not started, inside the period
    hours: float = 0
    est_pay: float = 0


class EarningsResponse(BaseModel):
    period: str                              # week | last_week | month | last_month | custom
    label: str                               # "This week"
    start_date: date
    end_date: date
    timezone: str
    total_hours: float = 0
    total_pay: float = 0
    shifts_worked: int = 0
    in_progress: int = 0
    any_tips: bool = False
    venues: List[EarningsVenue] = []
    shifts: List[EarningsShift] = []         # newest first
    upcoming: EarningsUpcoming = EarningsUpcoming()


WorkerProfile.model_rebuild()
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
```

---

## A2. NEW FILE `backend/src/services/earnings.py`

```python
"""
Phase 33.1: A worker's own hours & pay.

* Hours come from time entries (clock-in -> clock-out); an entry that's still open counts as "in progress", 0 h.
* Rate = the manager's per-person rate for that shift if set (time sheet), else the posted rate. Same rule as payroll.
* Pay is before tips and taxes. Tips aren't tracked yet (Phase 35); shifts that get tips are marked.
* Periods use the worker's own time zone (Notification settings), weeks run Monday -> Sunday.
* Workers see the real rate of shifts they worked, even when the venue hides pay on listings (they were booked).
"""
import csv
import io
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, TimeEntry, TimeEntryEdit, User, Venue
from src.schemas import EarningsResponse, EarningsShift, EarningsVenue, EarningsUpcoming
from src.services.notify import load_prefs
from src.services.fit import tz_of

PERIODS = ("week", "last_week", "month", "last_month", "custom")
BOOKED = ("approved", "confirmed")
MAX_CUSTOM_DAYS = 400


def _utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def period_range(period: str, today: date, start: Optional[date] = None, end: Optional[date] = None) -> Tuple[date, date, str]:
    """(first day, last day, label). Weeks start on Monday. Raises ValueError for a bad custom range."""
    monday = today - timedelta(days=today.weekday())
    if period == "week":
        return monday, monday + timedelta(days=6), "This week"
    if period == "last_week":
        return monday - timedelta(days=7), monday - timedelta(days=1), "Last week"
    if period == "month":
        first = today.replace(day=1)
        nxt = (first + timedelta(days=32)).replace(day=1)
        return first, nxt - timedelta(days=1), "This month"
    if period == "last_month":
        last = today.replace(day=1) - timedelta(days=1)
        return last.replace(day=1), last, "Last month"
    if period == "custom":
        if start is None or end is None:
            raise ValueError("Pick a start and an end date.")
        if end < start:
            raise ValueError("Pick an end date on or after the start date.")
        if (end - start).days > MAX_CUSTOM_DAYS:
            raise ValueError("Pick a range of about a year or less.")
        return start, end, f"{start.strftime('%b %-d')} – {end.strftime('%b %-d, %Y')}"
    raise ValueError("Unknown period.")


async def worker_tz(db: AsyncSession, user: User) -> ZoneInfo:
    prefs = (await load_prefs(db, [user.id]))[user.id]
    return tz_of(getattr(prefs, "timezone", None))


async def _rows(db: AsyncSession, user_id, lo: datetime, hi: datetime):
    """Time entries that started in [lo, hi) with their shift, event, venue and request."""
    return (await db.execute(
        select(TimeEntry, Shift, ShiftEvent, Venue, ShiftRequest)
        .join(Shift, Shift.id == TimeEntry.shift_id)
        .join(Venue, Venue.id == Shift.venue_id)
        .outerjoin(ShiftEvent, ShiftEvent.id == Shift.event_id)
        .outerjoin(ShiftRequest, (ShiftRequest.shift_id == TimeEntry.shift_id) & (ShiftRequest.worker_id == TimeEntry.worker_id))
        .where(TimeEntry.worker_id == user_id, TimeEntry.clock_in_time >= lo, TimeEntry.clock_in_time < hi)
        .order_by(TimeEntry.clock_in_time.asc())
    )).all()


def _rate(shift: Shift, req: Optional[ShiftRequest]) -> Tuple[float, bool]:
    if req is not None and req.pay_rate is not None:
        return float(req.pay_rate), True
    return float(shift.hourly_rate or 0), False


async def build_earnings(db: AsyncSession, user: User, period: str = "week",
                         start: Optional[date] = None, end: Optional[date] = None) -> EarningsResponse:
    tz = await worker_tz(db, user)
    now = datetime.now(timezone.utc)
    first, last, label = period_range(period, now.astimezone(tz).date(), start, end)
    lo = datetime.combine(first, time.min, tzinfo=tz).astimezone(timezone.utc)
    hi = datetime.combine(last + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)

    rows = await _rows(db, user.id, lo, hi)
    entry_ids = [r[0].id for r in rows]
    edited = set()
    if entry_ids:
        edited = set((await db.execute(
            select(TimeEntryEdit.time_entry_id)
            .where(TimeEntryEdit.time_entry_id.in_(entry_ids), TimeEntryEdit.action.in_(("edit", "add")))
            .distinct()
        )).scalars().all())

    shifts: List[EarningsShift] = []
    by_venue = defaultdict(lambda: {"hours": 0.0, "pay": 0.0, "shifts": set(), "name": ""})
    for entry, shift, event, venue, req in rows:
        cin, cout = _utc(entry.clock_in_time), _utc(entry.clock_out_time)
        hours = max(0.0, (cout - cin).total_seconds() / 3600.0) if cout else 0.0
        rate, custom = _rate(shift, req)
        pay = round(hours * rate, 2)
        shifts.append(EarningsShift(
            entry_id=entry.id, shift_id=shift.id, request_id=req.id if req is not None else None,
            event_title=(event.title if event is not None else None) or shift.title or shift.role_type or "Shift",
            venue_id=venue.id, venue_name=venue.name, venue_timezone=venue.timezone or "America/New_York",
            role_type=shift.role_type or "Shift",
            clock_in_time=cin, clock_out_time=cout, in_progress=cout is None,
            hours=round(hours, 2), rate=rate, rate_custom=custom, pay=pay,
            tips_eligible=bool(shift.tips_eligible), auto_closed=bool(entry.auto_closed), edited=entry.id in edited,
        ))
        if cout is None:
            continue                                  # still clocked in: listed, not counted
        v = by_venue[venue.id]
        v["name"] = venue.name
        v["hours"] += hours
        v["pay"] += pay
        v["shifts"].add(shift.id)

    # Booked, not started yet, inside the period: what's still coming
    upcoming_rows = []
    if hi > now:
        upcoming_rows = (await db.execute(
            select(ShiftRequest, Shift)
            .join(Shift, Shift.id == ShiftRequest.shift_id)
            .where(
                ShiftRequest.worker_id == user.id,
                func.lower(ShiftRequest.status).in_(BOOKED),
                Shift.start_time > now, Shift.start_time >= lo, Shift.start_time < hi,
                func.upper(Shift.status) != "CANCELLED",
            )
        )).all()
    up_hours = up_pay = 0.0
    for req, shift in upcoming_rows:
        h = max(0.0, (_utc(shift.end_time) - _utc(shift.start_time)).total_seconds() / 3600.0)
        up_hours += h
        up_pay += h * _rate(shift, req)[0]

    worked = [s for s in shifts if not s.in_progress]
    return EarningsResponse(
        period=period, label=label, start_date=first, end_date=last, timezone=str(tz.key),
        total_hours=round(sum(s.hours for s in worked), 2),
        total_pay=round(sum(s.pay for s in worked), 2),
        shifts_worked=len({s.shift_id for s in worked}),
        in_progress=len(shifts) - len(worked),
        any_tips=any(s.tips_eligible for s in shifts),
        venues=sorted(
            [EarningsVenue(venue_id=k, name=v["name"], hours=round(v["hours"], 2), pay=round(v["pay"], 2), shifts=len(v["shifts"]))
             for k, v in by_venue.items()],
            key=lambda x: -x.pay,
        ),
        shifts=list(reversed(shifts)),                # newest first
        upcoming=EarningsUpcoming(shifts=len(upcoming_rows), hours=round(up_hours, 2), est_pay=round(up_pay, 2)),
    )


def _local(dt: Optional[datetime], tz_name: str) -> str:
    if dt is None:
        return ""
    return _utc(dt).astimezone(tz_of(tz_name)).strftime("%Y-%m-%d %I:%M %p")


async def earnings_csv(db: AsyncSession, user: User, period: str = "month",
                       start: Optional[date] = None, end: Optional[date] = None) -> Tuple[str, str]:
    """(filename, csv text) of the worker's own entries. Times are in each venue's local time."""
    data = await build_earnings(db, user, period, start, end)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Date", "Venue", "Event", "Position", "Clock in (venue time)", "Clock out (venue time)",
                "Hours", "Hourly rate", "Pay before tips", "Gets tips", "Notes"])
    for s in reversed(data.shifts):                  # oldest first in the file
        notes = []
        if s.in_progress:
            notes.append("Still clocked in")
        if s.auto_closed:
            notes.append("Clocked out automatically")
        if s.edited:
            notes.append("Time changed by a manager")
        if s.rate_custom:
            notes.append("Your rate for this shift")
        w.writerow([
            _utc(s.clock_in_time).astimezone(tz_of(s.venue_timezone)).strftime("%Y-%m-%d"),
            s.venue_name, s.event_title, s.role_type,
            _local(s.clock_in_time, s.venue_timezone), _local(s.clock_out_time, s.venue_timezone) or "",
            f"{s.hours:.2f}", f"{s.rate:.2f}", f"{s.pay:.2f}", "Yes" if s.tips_eligible else "No", "; ".join(notes),
        ])
    w.writerow([])
    w.writerow(["Total", "", "", "", "", "", f"{data.total_hours:.2f}", "", f"{data.total_pay:.2f}", "", ""])
    name = f"shiftboard-hours-{data.start_date.isoformat()}-to-{data.end_date.isoformat()}.csv"
    return name, out.getvalue()
```

---

## A3. `backend/src/routers/me.py` (EDITS)
`GET /api/me/earnings` and `GET /api/me/earnings.csv`.

**Edit 1.** Find:
```python
Phase 26.2: The signed-in worker's own calendar and "I've read this" acknowledgements.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User
from src.schemas import WorkerCalendarResponse, InfoAckResponse
from src.auth import get_current_user
from src.services.worker_calendar import build_worker_calendar, acknowledge_info

router = APIRouter(prefix="/api/me", tags=["My Schedule"])
```
Replace with:
```python
Phase 26.2: The signed-in worker's own calendar and "I've read this" acknowledgements.
"""
from datetime import date, datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User
from src.schemas import WorkerCalendarResponse, InfoAckResponse, EarningsResponse
from src.auth import get_current_user
from src.services.worker_calendar import build_worker_calendar, acknowledge_info
from src.services.earnings import build_earnings, earnings_csv, PERIODS   # Phase 33.1

router = APIRouter(prefix="/api/me", tags=["My Schedule"])
```

**Edit 2.** Find:
```python
    stamp = await acknowledge_info(db, current_user, request_id)
    return InfoAckResponse(request_id=request_id, info_seen_at=stamp)
```
Replace with:
```python
    stamp = await acknowledge_info(db, current_user, request_id)
    return InfoAckResponse(request_id=request_id, info_seen_at=stamp)


# ------------------------------------------------------------------------------
# Phase 33.1: Hours & pay
# ------------------------------------------------------------------------------
PERIOD_PATTERN = "^(" + "|".join(PERIODS) + ")$"


@router.get("/earnings", response_model=EarningsResponse)
async def my_earnings(
    period: str = Query("week", pattern=PERIOD_PATTERN, description="week | last_week | month | last_month | custom"),
    start: Optional[date] = Query(None, description="custom: first day (YYYY-MM-DD)"),
    end: Optional[date] = Query(None, description="custom: last day (YYYY-MM-DD)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Your hours and pay (before tips and taxes) for a period, from your clock-ins. Weeks start on Monday."""
    try:
        return await build_earnings(db, current_user, period, start, end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/earnings.csv")
async def my_earnings_csv(
    period: str = Query("month", pattern=PERIOD_PATTERN),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The same as a spreadsheet, for your own records. Times are in each venue's local time."""
    try:
        filename, text = await earnings_csv(db, current_user, period, start, end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return Response(content=text, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
```

---

## A4. `backend/src/routers/venues.py` (EDITS)
Both CSV exports: venue-local times with a time-zone label, optional `start` / `end`, plain column names, a venue-named payroll file. Also "Person not found."

**Edit 1.** Find:
```python
from uuid import UUID
from typing import List, Optional, Dict
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, status, Query
```
Replace with:
```python
from uuid import UUID
from typing import List, Optional, Dict
from datetime import date, datetime, timezone, timedelta
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, status, Query
```

**Edit 2.** Find:
```python
    worker = w_res.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker user not found")

    existing = await db.scalar(
```
Replace with:
```python
    worker = w_res.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=404, detail="Person not found.")

    existing = await db.scalar(
```

**Edit 3.** Find:
```python
                             target_type="venue", target_id=venue_id)

@router.get("/{venue_id}/export-hours")
async def export_venue_hours_csv(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
```
Replace with:
```python
                             target_type="venue", target_id=venue_id)

# Phase 33.1: CSV exports use the venue's local time (not UTC) and can be limited to a date range.
def _local_str(dt, tz, fmt: str = "%Y-%m-%d %I:%M %p") -> str:
    if dt is None:
        return ""
    dt = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    return dt.astimezone(tz).strftime(fmt)


def _tz_label(tz) -> str:
    return datetime.now(timezone.utc).astimezone(tz).strftime("%Z") or "venue time"


def _slug(name) -> str:
    import re
    return (re.sub(r"[^a-z0-9]+", "-", (name or "venue").lower()).strip("-") or "venue")[:40]


def _csv_range(start, end, tz):
    if start is not None and end is not None and end < start:
        raise HTTPException(status_code=400, detail="Pick an end date on or after the start date.")
    lo = datetime.combine(start, datetime.min.time(), tzinfo=tz).astimezone(timezone.utc) if start else None
    hi = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=tz).astimezone(timezone.utc) if end else None
    return lo, hi


@router.get("/{venue_id}/export-hours")
async def export_venue_hours_csv(
    venue_id: UUID,
    start: Optional[date] = Query(None, description="Phase 33.1: first day (venue time), optional"),
    end: Optional[date] = Query(None, description="Phase 33.1: last day (venue time), optional"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
```

**Edit 4.** Find:
```python
    Return a FastAPI StreamingResponse with media_type="text/csv" and a Content-Disposition header.
    """
    await verify_venue_manager_access(venue_id, current_user, db)

    query = (
```
Replace with:
```python
    Return a FastAPI StreamingResponse with media_type="text/csv" and a Content-Disposition header.
    """
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    vtz = tz_of(venue.timezone)                                             # Phase 33.1: venue-local times
    lo, hi = _csv_range(start, end, vtz)

    query = (
```

**Edit 5.** Find:
```python
        .order_by(TimeEntry.clock_in_time.desc())
    )
    result = await db.execute(query)
    records = result.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Worker Name", "Shift Date", "Role", "Clock In", "Clock Out", "Total Hours"])

    for entry, worker, shift in records:
        worker_name = f"{worker.first_name} {worker.last_name}".strip() or worker.email
        shift_date = shift.start_time.strftime("%Y-%m-%d") if shift.start_time else ""
        role = shift.role_type or ""
        clock_in = entry.clock_in_time.strftime("%Y-%m-%d %H:%M:%S") if entry.clock_in_time else ""
        clock_out = entry.clock_out_time.strftime("%Y-%m-%d %H:%M:%S") if entry.clock_out_time else "In Progress"

        if entry.clock_in_time and entry.clock_out_time:
```
Replace with:
```python
        .order_by(TimeEntry.clock_in_time.desc())
    )
    if lo is not None:
        query = query.where(TimeEntry.clock_in_time >= lo)
    if hi is not None:
        query = query.where(TimeEntry.clock_in_time < hi)
    result = await db.execute(query)
    records = result.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "Shift date", "Position", f"Clock in ({_tz_label(vtz)})", f"Clock out ({_tz_label(vtz)})", "Hours"])

    for entry, worker, shift in records:
        worker_name = f"{worker.first_name} {worker.last_name}".strip() or worker.email
        shift_date = _local_str(shift.start_time, vtz, "%Y-%m-%d")
        role = shift.role_type or ""
        clock_in = _local_str(entry.clock_in_time, vtz)
        clock_out = _local_str(entry.clock_out_time, vtz) if entry.clock_out_time else "Still clocked in"

        if entry.clock_in_time and entry.clock_out_time:
```

**Edit 6.** Find:
```python
async def export_venue_payroll_csv(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
```
Replace with:
```python
async def export_venue_payroll_csv(
    venue_id: UUID,
    start: Optional[date] = Query(None, description="Phase 33.1: first day (venue time), optional"),
    end: Optional[date] = Query(None, description="Phase 33.1: last day (venue time), optional"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
```

**Edit 7.** Find:
```python
    Phase 27: adds work location, clock-in/out location check, late minutes and auto-closed flags.
    """
    await verify_venue_manager_access(venue_id, current_user, db)
    await auto_close_open_entries(db, venue_id=venue_id)

    query = (
```
Replace with:
```python
    Phase 27: adds work location, clock-in/out location check, late minutes and auto-closed flags.
    """
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    await auto_close_open_entries(db, venue_id=venue_id)
    vtz = tz_of(venue.timezone)                                             # Phase 33.1: venue-local times
    lo, hi = _csv_range(start, end, vtz)

    query = (
```

**Edit 8.** Find:
```python
        .order_by(TimeEntry.clock_in_time.desc())
    )
    records = (await db.execute(query)).all()

    entry_ids = [r[0].id for r in records]
    edited_ids = set()
    if entry_ids:
        edited_ids = set((await db.execute(
            select(distinct(TimeEntryEdit.time_entry_id))
            .where(TimeEntryEdit.time_entry_id.in_(entry_ids), TimeEntryEdit.action.in_(("edit", "add")))
        )).scalars().all())

```
Replace with:
```python
        .order_by(TimeEntry.clock_in_time.desc())
    )
    if lo is not None:
        query = query.where(TimeEntry.clock_in_time >= lo)
    if hi is not None:
        query = query.where(TimeEntry.clock_in_time < hi)
    records = (await db.execute(query)).all()

    entry_ids = [r[0].id for r in records]
    edited_ids = set()
    if entry_ids:
        edited_ids = set((await db.execute(
            select(TimeEntryEdit.time_entry_id)
            .where(TimeEntryEdit.time_entry_id.in_(entry_ids), TimeEntryEdit.action.in_(("edit", "add")))
            .distinct()
        )).scalars().all())

```

**Edit 9.** Find:
```python
    locations = await load_locations(db, ev_loc.values())
    geo_label = {
        "on_site": "On site", "outside_geofence": "Outside geofence", "not_checked": "Not checked",
        "manager": "Manager entry", "auto": "Auto-closed",
    }

```
Replace with:
```python
    locations = await load_locations(db, ev_loc.values())
    geo_label = {
        "on_site": "On site", "outside_geofence": "Outside the area", "not_checked": "Not checked",
        "manager": "Entered by a manager", "auto": "Clocked out automatically",
    }

```

**Edit 10.** Find:
```python
    writer = csv.writer(output)
    writer.writerow([
        "Worker Name", "Email", "Shift Title", "Role", "Date", "Work Location", "Clock In", "Clock Out", "Total Hours",
        "Hourly Rate", "Gross Pay", "Tips Eligible", "Tip Pool", "Edited",
        "Clock-In Location Check", "Clock-Out Location Check", "Late (min)", "Auto-Closed",
    ])

    for entry, worker, shift, req in records:
        worker_name = f"{worker.first_name} {worker.last_name}".strip() or worker.email
        shift_date = shift.start_time.strftime("%Y-%m-%d") if shift.start_time else ""
        clock_in = entry.clock_in_time.strftime("%Y-%m-%d %H:%M:%S") if entry.clock_in_time else ""
        clock_out = entry.clock_out_time.strftime("%Y-%m-%d %H:%M:%S") if entry.clock_out_time else "Did not clock out"
        if req is not None and req.pay_rate is not None:
            rate = float(req.pay_rate)
```
Replace with:
```python
    writer = csv.writer(output)
    writer.writerow([
        "Name", "Email", "Shift", "Position", "Date", "Work location",
        f"Clock in ({_tz_label(vtz)})", f"Clock out ({_tz_label(vtz)})", "Hours",
        "Hourly rate", "Pay before tips", "Gets tips", "Tip pool", "Time changed by a manager",
        "Clock-in location", "Clock-out location", "Minutes late", "Clocked out automatically",
    ])

    for entry, worker, shift, req in records:
        worker_name = f"{worker.first_name} {worker.last_name}".strip() or worker.email
        shift_date = _local_str(shift.start_time, vtz, "%Y-%m-%d")
        clock_in = _local_str(entry.clock_in_time, vtz)
        clock_out = _local_str(entry.clock_out_time, vtz) if entry.clock_out_time else "Did not clock out"
        if req is not None and req.pay_rate is not None:
            rate = float(req.pay_rate)
```

**Edit 11.** Find:
```python
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=payroll.csv"}
    )

```
Replace with:
```python
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="hours-and-pay-{_slug(venue.name)}.csv"'}
    )

```

---

# PART B: Plain language, backend

## B1. `backend/src/auth.py` (EDITS: `detail` strings ONLY)

**Edit 1.** Find:
```python
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"}
        )
```
Replace with:
```python
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"}
        )
```

**Edit 2.** Find:
```python
        user = await get_or_create_mock_firebase_user(db)
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Inactive user account")
        return user

```
Replace with:
```python
        user = await get_or_create_mock_firebase_user(db)
        if not user.is_active:
            raise HTTPException(status_code=403, detail="This account is turned off. Contact your venue or ShiftBoard to turn it back on.")
        return user

```

**Edit 3.** Find:
```python
        user_id_str: str = payload.get("sub")
        if not user_id_str:
            raise HTTPException(status_code=401, detail="Invalid token payload: missing sub")
    except JWTError:
        # Fallback to real firebase auth if mock is disabled
```
Replace with:
```python
        user_id_str: str = payload.get("sub")
        if not user_id_str:
            raise HTTPException(status_code=401, detail="Please sign in again.")
    except JWTError:
        # Fallback to real firebase auth if mock is disabled
```

**Edit 4.** Find:
```python
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )

    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid user identifier in token")

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="User account not found")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Inactive user account")

    return user
```
Replace with:
```python
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your sign-in has expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=401, detail="Please sign in again.")

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="Please sign in again.")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="This account is turned off. Contact your venue or ShiftBoard to turn it back on.")

    return user
```

**Edit 5.** Find:
```python
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access forbidden: requires one of {allowed_roles}"
            )
        return user
```
Replace with:
```python
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this."
            )
        return user
```

**Edit 6.** Find:
```python
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Not authorized to manage this venue."
    )

```
Replace with:
```python
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You don't manage this venue."
    )

```

---

## B2. `backend/src/routers/auth.py` (EDITS: `detail` strings ONLY)

**Edit 1.** Find:
```python
    """
    if not settings.ALLOW_SELF_REGISTRATION:
        raise HTTPException(status_code=403, detail="Self-registration is disabled. Ask an administrator to create your account.")
    if _get_load_config()() is not None and not settings.USE_MOCK_FIREBASE:
        raise HTTPException(status_code=409, detail="Use the sign-up options on the login page.")
```
Replace with:
```python
    """
    if not settings.ALLOW_SELF_REGISTRATION:
        raise HTTPException(status_code=403, detail="New sign-ups are closed right now. Ask your venue for an invite link.")
    if _get_load_config()() is not None and not settings.USE_MOCK_FIREBASE:
        raise HTTPException(status_code=409, detail="Use the sign-up options on the login page.")
```

**Edit 2.** Find:
```python
    existing = await db.scalar(select(User).where(func.lower(User.email) == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with this email already exists")

    try:
```
Replace with:
```python
    existing = await db.scalar(select(User).where(func.lower(User.email) == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="There's already an account with this email. Sign in instead.")

    try:
```

**Edit 3.** Find:
```python
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create account: {str(e)}")

    try:
        token = create_access_token(data={"sub": str(user.id), "role": "worker", "venue_id": None})
    except Exception as e:
        print(f"JWT Generation Error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server configuration error.")

    return TokenResponse(access_token=token, token_type="bearer", user=_firebase_user_response(user, None))
```
Replace with:
```python
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Couldn't create your account. Please try again.")

    try:
        token = create_access_token(data={"sub": str(user.id), "role": "worker", "venue_id": None})
    except Exception as e:
        print(f"JWT Generation Error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Sign-in is temporarily unavailable. Please try again soon.")

    return TokenResponse(access_token=token, token_type="bearer", user=_firebase_user_response(user, None))
```

**Edit 4.** Find:
```python

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    user_role_str = normalize_role(user.role)
```
Replace with:
```python

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is turned off. Contact your venue or ShiftBoard to turn it back on.")

    user_role_str = normalize_role(user.role)
```

**Edit 5.** Find:
```python
        print(f"JWT Generation Error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server configuration error."
        )

    user_resp = UserResponse.model_validate(user)
```
Replace with:
```python
        print(f"JWT Generation Error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Sign-in is temporarily unavailable. Please try again soon."
        )

    user_resp = UserResponse.model_validate(user)
```

**Edit 6.** Find:
```python
    token = (request.firebase_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Missing Firebase token.")

    if settings.USE_MOCK_FIREBASE and token.startswith("mock-firebase-"):
```
Replace with:
```python
    token = (request.firebase_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Sign-in didn't finish. Please try again.")

    if settings.USE_MOCK_FIREBASE and token.startswith("mock-firebase-"):
```

**Edit 7.** Find:
```python
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Firebase sign-in is not configured on this server."
            )

```
Replace with:
```python
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="This sign-in option isn't available right now."
            )

```

**Edit 8.** Find:
```python
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Firebase token verification failed: {str(e)}"
            )

```
Replace with:
```python
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sign-in didn't work. Please try again."
            )

```

**Edit 9.** Find:
```python
                        raise HTTPException(
                            status_code=403,
                            detail="Self-registration is disabled. Ask an administrator to create your account."
                        )
                    if not email_verified:
```
Replace with:
```python
                        raise HTTPException(
                            status_code=403,
                            detail="New sign-ups are closed right now. Ask your venue for an invite link."
                        )
                    if not email_verified:
```

**Edit 10.** Find:
```python
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to provision user: {str(e)}")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    venue_id = await db.scalar(
```
Replace with:
```python
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail="Couldn't finish setting up your account. Please try again.")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is turned off. Contact your venue or ShiftBoard to turn it back on.")

    venue_id = await db.scalar(
```

**Edit 11.** Find:
```python
        print(f"JWT Generation Error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server configuration error."
        )

    return TokenResponse(
```
Replace with:
```python
        print(f"JWT Generation Error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Sign-in is temporarily unavailable. Please try again soon."
        )

    return TokenResponse(
```

---

## B3. `backend/src/routers/transfers.py` (EDITS)
Hand-off wording; no raw status in errors.

**Edit 1.** Find:
```python
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot transfer a shift to yourself."
        )

    # 1. Verify target worker exists
    to_worker = await db.scalar(select(User).where(User.id == transfer_in.to_worker_id))
    if not to_worker:
        raise HTTPException(status_code=404, detail="Target worker not found.")

    # 2. Verify shift exists
```
Replace with:
```python
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can't hand a shift to yourself."
        )

    # 1. Verify target worker exists
    to_worker = await db.scalar(select(User).where(User.id == transfer_in.to_worker_id))
    if not to_worker:
        raise HTTPException(status_code=404, detail="We couldn't find that teammate.")

    # 2. Verify shift exists
```

**Edit 2.** Find:
```python
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A transfer request for this shift is already in progress."
        )

```
Replace with:
```python
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You've already sent a hand-off for this shift. Withdraw it first to pick someone else."
        )

```

**Edit 3.** Find:
```python
    transfer = res.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer offer not found.")

    if transfer.to_worker_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the target worker can respond to this transfer offer."
        )

```
Replace with:
```python
    transfer = res.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="This hand-off is no longer available.")

    if transfer.to_worker_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This hand-off was sent to someone else."
        )

```

**Edit 4.** Find:
```python
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot accept transfer in '{transfer.status}' status."
            )
        shift = transfer.shift
```
Replace with:
```python
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This hand-off is already settled."
            )
        shift = transfer.shift
```

**Edit 5.** Find:
```python
        transfer.status = "declined"
    else:
        raise HTTPException(status_code=400, detail="Action must be 'accept' or 'decline'.")

    await db.commit()
```
Replace with:
```python
        transfer.status = "declined"
    else:
        raise HTTPException(status_code=400, detail="Something went wrong. Refresh the page and try again.")

    await db.commit()
```

**Edit 6.** Find:
```python
    transfer = res.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found.")

    user_role = normalize_role(current_user.role)
```
Replace with:
```python
    transfer = res.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="This hand-off is no longer available.")

    user_role = normalize_role(current_user.role)
```

**Edit 7.** Find:
```python
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to reject this transfer."
        )

```
Replace with:
```python
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can't change this hand-off."
        )

```

**Edit 8.** Find:
```python
    transfer = res.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found.")

    # Uses verify_venue_access dependency logic
```
Replace with:
```python
    transfer = res.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="This hand-off is no longer available.")

    # Uses verify_venue_access dependency logic
```

**Edit 9.** Find:
```python
        transfer.status = "denied"
    else:
        raise HTTPException(status_code=400, detail="Action must be 'approve' or 'deny'.")

    await db.commit()
```
Replace with:
```python
        transfer.status = "denied"
    else:
        raise HTTPException(status_code=400, detail="Something went wrong. Refresh the page and try again.")

    await db.commit()
```

**Edit 10.** Find:
```python
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized for this venue."
            )

```
Replace with:
```python
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't manage this venue."
            )

```

---

## B4. `backend/src/routers/shifts.py` (EDITS)

**Edit 1.** Find:
```python
    target_status = status_update.status.upper()
    if target_status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="Status must be APPROVED or REJECTED")

    query = await db.execute(
```
Replace with:
```python
    target_status = status_update.status.upper()
    if target_status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="Choose Approve or Deny.")

    query = await db.execute(
```

**Edit 2.** Find:
```python
        )
        if shift.spots_filled >= shift.capacity:
            raise HTTPException(status_code=400, detail="Cannot approve: shift capacity is reached")
        shift.spots_filled += 1
        if shift.spots_filled >= shift.capacity:
```
Replace with:
```python
        )
        if shift.spots_filled >= shift.capacity:
            raise HTTPException(status_code=400, detail="This position is already full.")
        shift.spots_filled += 1
        if shift.spots_filled >= shift.capacity:
```

**Edit 3.** Find:
```python
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shift assignment not found or not in approved status."
        )

```
Replace with:
```python
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You're not booked on this shift."
        )

```

**Edit 4.** Find:
```python
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot drop shift within 24 hours of start time."
        )

```
Replace with:
```python
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="It starts in less than 24 hours, so it can't be dropped. Hand it off to a teammate or message your manager."
        )

```

**Edit 5.** Find:
```python
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only assigned workers and venue managers may access this shift discussion board."
        )

```
Replace with:
```python
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only people working this shift (and its managers) can see its chat."
        )

```

---

## B5. `backend/src/routers/listings.py` (EDIT)

**Edit 1.** Find:
```python
        status=req_status,
        instant=instant,
        message="You're booked! It's on your schedule." if instant else "Request sent. The manager will review it.",
        listing=rows[0] if rows else None,
    )
```
Replace with:
```python
        status=req_status,
        instant=instant,
        message="You're booked! It's in My shifts." if instant else "Request sent. The manager will review it.",
        listing=rows[0] if rows else None,
    )
```

---

## B6. `backend/src/routers/notifications.py` (EDITS)
Friendly subscribe errors, and `_friendly_push_error()` for the "Send a test" result. The technical reason stays on the device row for admins.

**Edit 1.** Find:
```python
            ZoneInfo(data["timezone"])
        except Exception:
            raise HTTPException(status_code=400, detail=f"Unknown timezone '{data['timezone']}'.")
    phone = data.pop("phone", None)
    clear_quiet = data.pop("clear_quiet_hours", False)
```
Replace with:
```python
            ZoneInfo(data["timezone"])
        except Exception:
            raise HTTPException(status_code=400, detail="Pick a time zone from the list.")
    phone = data.pop("phone", None)
    clear_quiet = data.pop("clear_quiet_hours", False)
```

**Edit 2.** Find:
```python
        token = (body.token or "").strip()
        if not fcm.ready():
            raise HTTPException(status_code=400, detail="Firebase messaging isn't set up on this server.")
        if len(token) < 20 or any(c.isspace() for c in token):
            raise HTTPException(status_code=400, detail="That device token isn't valid.")
        return dict(endpoint=token, p256dh=None, auth=None, provider="fcm")
    if body.provider != "webpush":
        raise HTTPException(status_code=400, detail="Unknown push provider.")
    if not body.endpoint or not body.endpoint.startswith("https://") or body.keys is None:
        raise HTTPException(status_code=400, detail="That push address isn't valid.")
    try:
        key = webpush.b64u_decode(body.keys.p256dh)
        secret = webpush.b64u_decode(body.keys.auth)
    except Exception:
        raise HTTPException(status_code=400, detail="That device's keys aren't valid.")
    if len(key) != 65 or key[0] != 4 or len(secret) != 16:
        raise HTTPException(status_code=400, detail="That device's keys aren't valid.")
    return dict(endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth, provider="webpush")

```
Replace with:
```python
        token = (body.token or "").strip()
        if not fcm.ready():
            raise HTTPException(status_code=400, detail="Phone notifications aren't available right now.")
        if len(token) < 20 or any(c.isspace() for c in token):
            raise HTTPException(status_code=400, detail="Couldn't set up this device. Turn notifications off and on again.")
        return dict(endpoint=token, p256dh=None, auth=None, provider="fcm")
    if body.provider != "webpush":
        raise HTTPException(status_code=400, detail="Couldn't set up this device. Turn notifications off and on again.")
    if not body.endpoint or not body.endpoint.startswith("https://") or body.keys is None:
        raise HTTPException(status_code=400, detail="Couldn't set up this device. Turn notifications off and on again.")
    try:
        key = webpush.b64u_decode(body.keys.p256dh)
        secret = webpush.b64u_decode(body.keys.auth)
    except Exception:
        raise HTTPException(status_code=400, detail="Couldn't set up this device. Turn notifications off and on again.")
    if len(key) != 65 or key[0] != 4 or len(secret) != 16:
        raise HTTPException(status_code=400, detail="Couldn't set up this device. Turn notifications off and on again.")
    return dict(endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth, provider="webpush")

```

**Edit 3.** Find:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not send a test: {e}")
    return PushTestResult(reached=reached, error=None if reached else err)
```
Replace with:
```python
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not send a test: {e}")
    return PushTestResult(reached=reached, error=None if reached else _friendly_push_error(err))


def _friendly_push_error(err: Optional[str]) -> str:
    """Phase 33.1: what the person sees. The technical reason stays on the device row for admins."""
    if not err or err == "No devices turned on":
        return "No devices have notifications turned on."
    if "isn't set up" in err:
        return "Phone notifications aren't available right now."
    return "This device didn't accept the test. Turn notifications off and on again here."
```

---

## B7. `backend/src/services/booking.py` (EDITS)

**Edit 1.** Find:
```python
                raise HTTPException(status_code=400, detail=BLOCKED_MESSAGES[st])
            if st not in REREQUESTABLE_STATUSES:
                raise HTTPException(status_code=400, detail=f"You already have this position (status: {st}).")

        # --- Capacity (checked under the lock) -------------------------------------------
```
Replace with:
```python
                raise HTTPException(status_code=400, detail=BLOCKED_MESSAGES[st])
            if st not in REREQUESTABLE_STATUSES:
                raise HTTPException(status_code=400, detail="You're already on this position.")

        # --- Capacity (checked under the lock) -------------------------------------------
```

**Edit 2.** Find:
```python
            raise HTTPException(
                status_code=400,
                detail="Only requests that are still waiting for approval can be withdrawn. Booked shifts can be dropped or handed off from My Schedule.",
            )
        req.status = "withdrawn"
```
Replace with:
```python
            raise HTTPException(
                status_code=400,
                detail="Only requests that are still waiting for approval can be withdrawn. Booked shifts can be dropped or handed off from My shifts.",
            )
        req.status = "withdrawn"
```

---

## B8. `backend/src/services/staffing.py` (EDIT)

**Edit 1.** Find:
```python
                )
            if st not in REASSIGNABLE_STATUSES and st not in PENDING_STATUSES:
                raise HTTPException(status_code=400, detail=f"Already on this position (status: {st}).")

    # Phase 29.4: booking back someone who dropped this event needs the manager's reason
```
Replace with:
```python
                )
            if st not in REASSIGNABLE_STATUSES and st not in PENDING_STATUSES:
                raise HTTPException(status_code=400, detail="They're already on this position.")

    # Phase 29.4: booking back someone who dropped this event needs the manager's reason
```

---

## B9. `backend/src/services/shift_events.py` (EDIT)

**Edit 1.** Find:
```python
    mode = (p.approval_mode or "venue_default").lower()
    if mode not in VALID_APPROVAL_MODES:
        raise HTTPException(status_code=400, detail=f"{name}: approval must be venue_default, auto, or manual.")


```
Replace with:
```python
    mode = (p.approval_mode or "venue_default").lower()
    if mode not in VALID_APPROVAL_MODES:
        raise HTTPException(status_code=400, detail=f"{name}: choose how requests are approved.")


```

---

## B10. `backend/src/services/venue_positions.py` (EDITS)

**Edit 1.** Find:
```python
            ZoneInfo(data["timezone"])
        except Exception:
            raise HTTPException(status_code=400, detail=f"Unknown timezone '{data['timezone']}'.")

    if "approval_policy" in data and data["approval_policy"] not in VALID_APPROVAL_POLICIES:
        raise HTTPException(status_code=400, detail="Approval policy must be manual, team_auto, or everyone_auto.")

    if "lat" in data and not (-90 <= float(data["lat"]) <= 90):
```
Replace with:
```python
            ZoneInfo(data["timezone"])
        except Exception:
            raise HTTPException(status_code=400, detail="Pick a time zone from the list.")

    if "approval_policy" in data and data["approval_policy"] not in VALID_APPROVAL_POLICIES:
        raise HTTPException(status_code=400, detail="Choose how shift requests are approved.")

    if "lat" in data and not (-90 <= float(data["lat"]) <= 90):
```

**Edit 2.** Find:
```python
    # Phase 27: clock-in settings
    if "geofence_buffer_meters" in data and not (0 <= int(data["geofence_buffer_meters"]) <= 2000):
        raise HTTPException(status_code=400, detail="Geofence buffer must be between 0 and 2000 meters.")
    if "clock_in_early_minutes" in data and not (0 <= int(data["clock_in_early_minutes"]) <= 240):
        raise HTTPException(status_code=400, detail="Early clock-in must be between 0 and 240 minutes.")
```
Replace with:
```python
    # Phase 27: clock-in settings
    if "geofence_buffer_meters" in data and not (0 <= int(data["geofence_buffer_meters"]) <= 2000):
        raise HTTPException(status_code=400, detail="Extra distance allowed must be between 0 and 2000 meters.")
    if "clock_in_early_minutes" in data and not (0 <= int(data["clock_in_early_minutes"]) <= 240):
        raise HTTPException(status_code=400, detail="Early clock-in must be between 0 and 240 minutes.")
```

---

## B11. `backend/src/services/locations.py` (EDITS)

**Edit 1.** Find:
```python
    m = (mode or "venue_default").lower()
    if m not in GEOFENCE_MODES:
        raise HTTPException(status_code=400, detail="Location check must be venue_default, on, or off.")
    return m

```
Replace with:
```python
    m = (mode or "venue_default").lower()
    if m not in GEOFENCE_MODES:
        raise HTTPException(status_code=400, detail="Choose whether to check location at clock-in.")
    return m

```

**Edit 2.** Find:
```python
        changes.append("map pin moved" if new_lat is not None else "map pin removed")
    if new_radius != loc.radius_meters:
        changes.append("check-in radius changed")
    if new_notes != loc.notes:
        changes.append("location notes updated")
```
Replace with:
```python
        changes.append("map pin moved" if new_lat is not None else "map pin removed")
    if new_radius != loc.radius_meters:
        changes.append("clock-in area changed")
    if new_notes != loc.notes:
        changes.append("location notes updated")
```

---

## B12. `backend/src/services/worker_calendar.py` (EDIT)

**Edit 1.** Find:
```python
    range_end = as_utc(end) if end else now + DEFAULT_FUTURE
    if range_end <= range_start:
        raise HTTPException(status_code=400, detail="end must be after start.")
    if range_end - range_start > MAX_SPAN:
        raise HTTPException(status_code=400, detail="Pick a range of 400 days or less.")
```
Replace with:
```python
    range_end = as_utc(end) if end else now + DEFAULT_FUTURE
    if range_end <= range_start:
        raise HTTPException(status_code=400, detail="Pick an end date after the start date.")
    if range_end - range_start > MAX_SPAN:
        raise HTTPException(status_code=400, detail="Pick a range of 400 days or less.")
```

---

## B13. `backend/src/services/auto_confirm.py` (EDITS)

**Edit 1.** Find:
```python

    Raises:
        HTTPException(status_code=400, detail="Worker is already booked for this time slot.")
    """
    query = (
```
Replace with:
```python

    Raises:
        HTTPException(status_code=400, detail="That time overlaps another shift that's already booked.")
    """
    query = (
```

**Edit 2.** Find:
```python
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Worker is already booked for this time slot."
        )

```
Replace with:
```python
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That time overlaps another shift that's already booked."
        )

```

---

## B14. `backend/src/services/activity.py` (EDIT)

**Edit 1.** Find:
```python
    text = {
        "request_created": f"{name} requested {what}",
        "instant_booked": f"{name} booked {what} (instant)",
        "request_approved": f"Approved {name} for {what}",
        "request_denied": f"Declined {name} for {what}",
```
Replace with:
```python
    text = {
        "request_created": f"{name} requested {what}",
        "instant_booked": f"{name} booked {what} (no approval needed)",
        "request_approved": f"Approved {name} for {what}",
        "request_denied": f"Declined {name} for {what}",
```

---

## B15. `backend/src/services/notify_events.py` (EDITS)
"You're confirmed" → "You're booked".

**Edit 1.** Find:
```python
        await notify_in(
            db, [req.worker_id], "request_approved",
            f"You're confirmed: {shift.role_type} · {name}",
            f"{when_text(shift.start_time, venue)} at {place_text(venue, location)}. "
            "Open the shift for arrival info and notes.",
```
Replace with:
```python
        await notify_in(
            db, [req.worker_id], "request_approved",
            f"You're booked: {shift.role_type} · {name}",
            f"{when_text(shift.start_time, venue)} at {place_text(venue, location)}. "
            "Open the shift for arrival info and notes.",
```

**Edit 2.** Find:
```python
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == t.to_worker_id))
        await notify_in(db, [t.to_worker_id], "request_approved",
                        f"You're confirmed: {shift.role_type} · {event.title if event else shift.title}",
                        f"{when_text(shift.start_time, venue)} at {place_text(venue, location)} "
                        f"(handed off from {person(frm)}). Open the shift for arrival info and notes.",
```
Replace with:
```python
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == t.to_worker_id))
        await notify_in(db, [t.to_worker_id], "request_approved",
                        f"You're booked: {shift.role_type} · {event.title if event else shift.title}",
                        f"{when_text(shift.start_time, venue)} at {place_text(venue, location)} "
                        f"(handed off from {person(frm)}). Open the shift for arrival info and notes.",
```

---

# PART C: Frontend, shared

## C1. NEW FILE `frontend/src/utils/apiErrors.js`
Plain-language errors from one place: a second response handler added to the existing client (client.js unchanged).

```js
import api from '../api/client';

/**
 * Phase 33.1: plain-language errors everywhere, from ONE place.
 * Adds a second response handler to the shared API client (client.js itself is unchanged) that rewrites
 * what screens read (`err.response.data.detail` and `err.message`) before any screen sees it:
 *   * 500-level errors: the server's technical text is removed, so each screen's own friendly
 *     fallback ("Could not save your profile.") shows instead. The original stays in `raw_detail`.
 *   * 422 (form checks): the list of field problems becomes one readable sentence.
 *   * No response (offline / server unreachable): a clear "check your connection" message.
 * Installed once from main.jsx.
 */
const FIELD_NAMES = {
  email: 'email address',
  phone: 'mobile number',
  first_name: 'first name',
  last_name: 'last name',
  password: 'password',
  content: 'message',
  note: 'note',
  reason: 'reason',
  name: 'name',
  title: 'title',
  start_time: 'start time',
  end_time: 'end time',
  hourly_rate: 'pay rate',
  capacity: 'number of spots',
};

function fieldName(loc) {
  const key = Array.isArray(loc) ? [...loc].reverse().find((p) => typeof p === 'string' && p !== 'body' && p !== 'query') : null;
  return key ? (FIELD_NAMES[key] || key.replace(/_/g, ' ')) : null;
}

export function friendly422(detail) {
  const first = Array.isArray(detail) ? detail[0] : null;
  if (!first) return 'Please check what you entered and try again.';
  const field = fieldName(first.loc);
  const type = String(first.type || '');
  const limit = first.ctx && (first.ctx.max_length ?? first.ctx.le ?? first.ctx.lt);
  if (type === 'missing') return field ? `Please fill in the ${field}.` : 'Please fill in every required field.';
  if (field === 'email address' || type.includes('email')) return 'Please enter a valid email address.';
  if (type.includes('too_long')) return field ? `The ${field} is too long${limit ? ` (up to ${limit} characters)` : ''}.` : "That's too long.";
  if (type.includes('too_short')) return field ? `The ${field} is too short.` : "That's too short.";
  if (type.includes('greater_than') || type.includes('less_than')) return field ? `Please check the ${field}.` : 'Please check the numbers you entered.';
  if (type.includes('date') || type.includes('datetime')) return field ? `Please enter a valid ${field}.` : 'Please enter a valid date.';
  return field ? `Please check the ${field}.` : 'Please check what you entered and try again.';
}

let installed = false;

export function installFriendlyErrors() {
  if (installed) return;
  installed = true;
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      try {
        const res = error && error.response;
        if (!res) {
          if (error && error.code !== 'ERR_CANCELED') {
            error.message = typeof navigator !== 'undefined' && navigator.onLine === false
              ? "You're offline. Check your connection and try again."
              : "Can't reach ShiftBoard right now. Check your connection and try again.";
          }
        } else if (res.status >= 500) {
          if (res.data && typeof res.data === 'object' && !(res.data instanceof Blob)) {
            res.data.raw_detail = res.data.detail;
            delete res.data.detail;
          }
          error.message = 'Something went wrong on our end. Please try again in a moment.';
          console.warn('Server error', res.status, res.data && res.data.raw_detail);
        } else if (res.status === 422 && res.data && Array.isArray(res.data.detail)) {
          res.data.raw_detail = res.data.detail;
          res.data.detail = friendly422(res.data.detail);
          error.message = res.data.detail;
        } else if (res.data && typeof res.data.detail === 'string') {
          error.message = res.data.detail;
        }
      } catch (e) {
        /* never let error handling throw */
      }
      return Promise.reject(error);
    },
  );
}
```

---

## C2. `frontend/src/main.jsx` (FULL FILE REPLACEMENT)
Adds `installFriendlyErrors()`.

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerServiceWorker } from './utils/push'   // Phase 33: installable app + push notifications
import { installFriendlyErrors } from './utils/apiErrors'   // Phase 33.1: plain-language errors

registerServiceWorker()
installFriendlyErrors()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

---

## C3. NEW FILE `frontend/src/utils/download.js`
Saves a file from the API with the sign-in token; date-range presets (Monday weeks).

```js
import api from '../api/client';

/**
 * Phase 33.1: download a file from the API (with the sign-in token) and save it.
 * Uses the server's file name from Content-Disposition when there is one.
 */
export async function downloadFile(url, params = {}, fallbackName = 'download.csv') {
  const res = await api.get(url, { params, responseType: 'blob' });
  const header = res.headers?.['content-disposition'] || '';
  const match = /filename="?([^";]+)"?/i.exec(header);
  const name = match ? match[1] : fallbackName;
  const blob = new Blob([res.data], { type: res.headers?.['content-type'] || 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.setAttribute('download', name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(link.href);
  return name;
}

/** Phase 33.1: "YYYY-MM-DD" for a local date. */
export const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Phase 33.1: date ranges for downloads (weeks start on Monday, like Hours & pay). */
export function rangePresets(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const addDays = (x, n) => { const y = new Date(x); y.setDate(x.getDate() + n); return y; };
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const lastMonthEnd = addDays(firstOfMonth, -1);
  return [
    { id: 'week', label: 'This week', start: isoDay(monday), end: isoDay(addDays(monday, 6)) },
    { id: 'last_week', label: 'Last week', start: isoDay(addDays(monday, -7)), end: isoDay(addDays(monday, -1)) },
    { id: 'month', label: 'This month', start: isoDay(firstOfMonth), end: isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)) },
    { id: 'last_month', label: 'Last month', start: isoDay(new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1)), end: isoDay(lastMonthEnd) },
    { id: 'all', label: 'Everything', start: null, end: null },
  ];
}
```

---

## C4. NEW FILE `frontend/src/utils/earnings.js`

```js
/** Phase 33.1: formatting for Hours & pay. */
export const money = (n) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 0 -> "0 h", 1.5 -> "1.5 h", 12.25 -> "12.25 h" */
export const hoursText = (h) => {
  const v = Math.round(Number(h || 0) * 100) / 100;
  return `${v} h`;
};

/** "2026-09-28" -> "Mon, Sep 28" (a plain date; noon avoids any time-zone shift) */
export const dayText = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

export const PERIODS = [
  { id: 'week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
];
```

---

## C5. `frontend/src/utils/listingFormat.js` (EDITS)
"Booked", `statusLabel()` (never a raw code), "Outside the area".

**Edit 1.** Find:
```js
  pending: 'Waiting for approval',
  pending_manager_approval: 'Waiting for approval',
  approved: 'Confirmed',
  confirmed: 'Confirmed',
  checked_in: 'Clocked in',
  completed: 'Completed',
```
Replace with:
```js
  pending: 'Waiting for approval',
  pending_manager_approval: 'Waiting for approval',
  approved: 'Booked',                         // Phase 33.1: "Booked" everywhere (was "Confirmed")
  confirmed: 'Booked',
  checked_in: 'Clocked in',
  completed: 'Completed',
```

**Edit 2.** Find:
```js
  withdrawn: 'Withdrawn',
};

const money = (n) => {
```
Replace with:
```js
  withdrawn: 'Withdrawn',
};

/** Phase 33.1: a status in plain words. Never shows a raw code: anything unknown reads "Updated". */
export const statusLabel = (status) => STATUS_LABELS[String(status || '').toLowerCase()] || 'Updated';

const money = (n) => {
```

**Edit 3.** Find:
```js
export const GEO_LABELS = {
  on_site: 'On site',
  outside_geofence: 'Outside geofence',
  not_checked: 'No location check',
  manager: 'Manager entry',
```
Replace with:
```js
export const GEO_LABELS = {
  on_site: 'On site',
  outside_geofence: 'Outside the area',
  not_checked: 'No location check',
  manager: 'Manager entry',
```

---

# PART D: Frontend, Hours & pay

## D1. NEW FILE `frontend/src/pages/EarningsPage.jsx`

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, Clock, CalendarCheck, Download, Info, Coins, AlertTriangle, Pencil, Timer, ChevronLeft, Building2,
} from 'lucide-react';
import api from '../api/client';
import { money, hoursText, dayText, PERIODS } from '../utils/earnings';
import { downloadFile } from '../utils/download';
import { fmtDate, fmtTime } from '../utils/venueTime';

function Tile({ icon: Icon, label, value, sub }) {
  return (
    <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        <Icon className="w-3.5 h-3.5 text-emerald-400" /> {label}
      </div>
      <div className="mt-1 text-2xl font-black text-white">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/**
 * Phase 33.1: a worker's own hours & pay. GET /api/me/earnings?period=…  (weeks start on Monday)
 * Pay = hours from clock-in to clock-out × the rate for that shift, before tips and taxes.
 */
export default function EarningsPage() {
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.get('/me/earnings', { params: { period } })
      .then((res) => { if (alive) setData(res.data); })
      .catch((err) => {
        if (!alive) return;
        setData(null);          // never show another period's numbers under this period's name
        setError(err.response?.data?.detail || "Couldn't load your hours. Check your connection and try again.");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  // group shifts by day (in each venue's time)
  const days = useMemo(() => {
    const groups = [];
    for (const s of data?.shifts || []) {
      const label = fmtDate(s.clock_in_time, s.venue_timezone);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(s);
      else groups.push({ label, items: [s] });
    }
    return groups;
  }, [data]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile('/me/earnings.csv', { period }, 'my-hours.csv');
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't download your hours. Try again.");
    } finally {
      setDownloading(false);
    }
  };

  const up = data?.upcoming || {};
  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="bg-slate-900 border-b border-slate-800 py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto w-full">
          <Link to="/worker" className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1 mb-2">
            <ChevronLeft className="w-3.5 h-3.5" /> My shifts
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Wallet className="w-6 h-6 text-emerald-400" /> Hours & pay</h1>
            <button type="button" onClick={download} disabled={downloading || !data}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50">
              <Download className="w-4 h-4 text-emerald-400" /> {downloading ? 'Downloading…' : 'Download (spreadsheet)'}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {PERIODS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  period === p.id ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-600'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6 space-y-5">
        {error && <div className="p-3 rounded-xl border border-rose-700 bg-rose-950/70 text-rose-200 text-sm">{error}</div>}
        {loading && !data && <p className="py-16 text-center text-sm text-slate-500">Loading your hours…</p>}

        {data && (
          <>
            <p className="text-xs text-slate-400">
              {data.label}: {dayText(data.start_date)} – {dayText(data.end_date)}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Tile icon={Clock} label="Hours" value={hoursText(data.total_hours)} sub={`${data.shifts_worked} shift${data.shifts_worked === 1 ? '' : 's'} worked`} />
              <Tile icon={Coins} label="Pay" value={money(data.total_pay)} sub="Before tips and taxes" />
              <Tile icon={CalendarCheck} label="Still coming" value={up.shifts ? money(up.est_pay) : '—'}
                sub={up.shifts ? `${up.shifts} booked shift${up.shifts === 1 ? '' : 's'} · about ${hoursText(up.hours)}` : 'Nothing else booked in this period'} />
            </div>

            {data.in_progress > 0 && (
              <div className="p-3 rounded-xl border border-emerald-700/60 bg-emerald-950/40 text-emerald-200 text-xs flex items-start gap-2">
                <Timer className="w-4 h-4 flex-shrink-0" /> You're clocked in now. That shift counts once you clock out.
              </div>
            )}

            {data.venues.length > 1 && (
              <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">By venue</h2>
                <div className="divide-y divide-slate-800">
                  {data.venues.map((v) => (
                    <div key={v.venue_id} className="py-2 flex items-center gap-3 text-sm">
                      <Building2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-white">{v.name}</span>
                      <span className="text-slate-400">{hoursText(v.hours)}</span>
                      <span className="w-24 text-right font-bold text-emerald-400">{money(v.pay)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-4">
              {days.length === 0 && (
                <div className="py-12 text-center rounded-2xl border border-slate-800 bg-slate-900/40">
                  <Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-300">No clock-ins in this period</p>
                  <p className="text-xs text-slate-500 mt-1">Hours show up here after you clock in and out of a shift.</p>
                </div>
              )}
              {days.map((d) => (
                <div key={d.label}>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{d.label}</h3>
                  <div className="space-y-2">
                    {d.items.map((s) => (
                      <div key={s.entry_id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-white truncate">{s.event_title}</div>
                          <div className="text-xs text-slate-400 truncate">{s.role_type} · {s.venue_name}</div>
                          <div className="text-xs text-slate-300 mt-1">
                            {fmtTime(s.clock_in_time, s.venue_timezone)} – {s.in_progress ? 'now' : fmtTime(s.clock_out_time, s.venue_timezone)}
                            {!s.in_progress && <span className="text-slate-500"> · {hoursText(s.hours)} × {money(s.rate)}/hr</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {s.tips_eligible && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-semibold">Gets tips</span>}
                            {s.rate_custom && <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-[10px] font-semibold">Your rate for this shift</span>}
                            {s.edited && <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-semibold inline-flex items-center gap-0.5"><Pencil className="w-2.5 h-2.5" /> Time changed by a manager</span>}
                            {s.auto_closed && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-semibold inline-flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" /> Clocked out automatically</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-base font-black text-emerald-400">{s.in_progress ? '—' : money(s.pay)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                Worked out from your clock-in and clock-out times × your pay rate, before tips and taxes
                {data.any_tips ? ' (tips aren’t tracked here yet)' : ''}. Your venue’s payroll is the final word. If a time looks wrong, ask the
                manager to fix it on their time sheet. Weeks start on Monday.
              </span>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
```

---

## D2. NEW FILE `frontend/src/components/worker/EarningsCard.jsx`

```jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ChevronRight } from 'lucide-react';
import api from '../../api/client';
import { money, hoursText } from '../../utils/earnings';

/**
 * Phase 33.1: "This week" hours & pay at the top of My shifts. Taps through to /earnings.
 * Props: refreshKey (changes after clock-in / clock-out so it reloads)
 */
export default function EarningsCard({ refreshKey = 0 }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/me/earnings', { params: { period: 'week' } })
      .then((res) => { if (alive) setData(res.data); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [refreshKey]);

  if (!data) return null;
  const up = data.upcoming || {};
  return (
    <Link to="/earnings" className="block p-4 rounded-2xl border border-slate-800 bg-slate-900 hover:border-slate-600 transition">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
          <Wallet className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">This week</div>
          <div className="text-base font-black text-white">
            {hoursText(data.total_hours)} · <span className="text-emerald-400">{money(data.total_pay)}</span>
          </div>
          <div className="text-[11px] text-slate-400 truncate">
            {data.in_progress > 0 ? 'Clocked in now · ' : ''}
            {up.shifts > 0 ? `${up.shifts} more booked (~${money(up.est_pay)})` : 'Before tips'}
          </div>
        </div>
        <span className="text-xs font-semibold text-emerald-400 inline-flex items-center gap-0.5 flex-shrink-0">
          Hours & pay <ChevronRight className="w-4 h-4" />
        </span>
      </div>
    </Link>
  );
}
```

---

## D3. NEW FILE `frontend/src/components/manager/DownloadHoursModal.jsx`

```jsx
import React, { useState } from 'react';
import { Download, CalendarRange } from 'lucide-react';
import ModalShell from '../ModalShell';
import { downloadFile, rangePresets } from '../../utils/download';
import { dayText } from '../../utils/earnings';

/**
 * Phase 33.1: "Download hours" for managers. Pick a range, get a spreadsheet (.csv) of every clock-in with
 * hours and pay before tips. Times and dates are in the venue's own time zone.
 * Props: venueId, venueName, onClose(), onDone(message), onError(message)
 */
export default function DownloadHoursModal({ venueId, venueName, onClose, onDone, onError }) {
  const presets = rangePresets();
  const [pick, setPick] = useState('last_week');
  const [custom, setCustom] = useState({ start: presets[1].start, end: presets[1].end });
  const [busy, setBusy] = useState(false);

  const range = pick === 'custom' ? custom : presets.find((p) => p.id === pick);
  const invalid = pick === 'custom' && (!custom.start || !custom.end || custom.end < custom.start);

  const download = async () => {
    setBusy(true);
    try {
      const params = {};
      if (range.start) params.start = range.start;
      if (range.end) params.end = range.end;
      await downloadFile(`/venues/${venueId}/payroll/export`, params, 'hours-and-pay.csv');
      onDone('Hours downloaded. Open it in Excel, Numbers or Google Sheets.');
      onClose();
    } catch (err) {
      onError(err.response?.data?.detail || "Couldn't download the hours. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const chip = (on) => `px-3 py-2 rounded-xl text-xs font-bold border transition ${
    on ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-500'}`;

  return (
    <ModalShell
      title="Download hours"
      subtitle={`${venueName || 'This venue'}: every clock-in with hours and pay before tips, as a spreadsheet.`}
      icon={<Download className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 mr-auto">Close</button>
          <button type="button" onClick={download} disabled={busy || invalid}
            className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download className="w-4 h-4" /> {busy ? 'Downloading…' : 'Download'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p.id} type="button" onClick={() => setPick(p.id)} className={chip(pick === p.id)}>{p.label}</button>
          ))}
          <button type="button" onClick={() => setPick('custom')} className={chip(pick === 'custom')}>
            <span className="inline-flex items-center gap-1"><CalendarRange className="w-3.5 h-3.5" /> Pick dates</span>
          </button>
        </div>
        {pick === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-300">From
              <input type="date" value={custom.start} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white" />
            </label>
            <label className="block text-xs font-semibold text-slate-300">To
              <input type="date" value={custom.end} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white" />
            </label>
          </div>
        )}
        {invalid && <p className="text-xs text-rose-300">Pick an end date on or after the start date.</p>}
        <p className="text-xs text-slate-400">
          {range.start ? `${dayText(range.start)} – ${dayText(range.end)}` : 'All clock-ins at this venue'}. Weeks start on Monday. Times are in
          the venue's time zone. Tips aren't included yet.
        </p>
      </div>
    </ModalShell>
  );
}
```

---

## D4. `frontend/src/App.jsx` (EDITS)
The `/earnings` route (worker + admin), with the phone tab bar.

**Edit 1.** Find:
```jsx
import JoinPage from './pages/JoinPage';
import ProfilePage from './pages/ProfilePage';

function HomeRedirect() {
```
Replace with:
```jsx
import JoinPage from './pages/JoinPage';
import ProfilePage from './pages/ProfilePage';
import EarningsPage from './pages/EarningsPage';   // Phase 33.1

function HomeRedirect() {
```

**Edit 2.** Find:
```jsx
            />

            {/* Phase 31 + 32: everyone's own profile */}
            <Route
```
Replace with:
```jsx
            />

            {/* Phase 33.1: a worker's own hours & pay */}
            <Route
              path="/earnings"
              element={
                <ProtectedRoute allowedRoles={['worker', 'platform_admin']}>
                  <Navbar />
                  <EarningsPage />
                  <WorkerTabBar />
                </ProtectedRoute>
              }
            />

            {/* Phase 31 + 32: everyone's own profile */}
            <Route
```

---

## D5. `frontend/src/pages/WorkerDashboard.jsx` (EDITS)
The card on My shifts, reloaded after clock-in / clock-out.

**Edit 1.** Find:
```jsx
import ProfileNudge from '../components/worker/ProfileNudge';
import AppNudge from '../components/AppNudge';   // Phase 33
import { PENDING_INVITE_KEY } from './JoinPage';
import {
```
Replace with:
```jsx
import ProfileNudge from '../components/worker/ProfileNudge';
import AppNudge from '../components/AppNudge';   // Phase 33
import EarningsCard from '../components/worker/EarningsCard';   // Phase 33.1
import { PENDING_INVITE_KEY } from './JoinPage';
import {
```

**Edit 2.** Find:
```jsx
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [shiftToDrop, setShiftToDrop] = useState(null);
  const [clockOutAsk, setClockOutAsk] = useState(null);   // Phase 32.3: { shiftId, item, title } waiting for "Clock out?" confirm
  const [offers, setOffers] = useState([]);
```
Replace with:
```jsx
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [shiftToDrop, setShiftToDrop] = useState(null);
  const [earningsKey, setEarningsKey] = useState(0);   // Phase 33.1: reload the hours card after clock-in / out
  const [clockOutAsk, setClockOutAsk] = useState(null);   // Phase 32.3: { shiftId, item, title } waiting for "Clock out?" confirm
  const [offers, setOffers] = useState([]);
```

**Edit 3.** Find:
```jsx
      flash(res.data?.geo_status === 'outside_geofence' ? 'info' : 'success', res.data?.message || 'Clocked in.');
      fetchWorkerData(false);
    } catch (err) {
      flash('error', err.response?.data?.detail || err.message || 'Could not clock in.');
```
Replace with:
```jsx
      flash(res.data?.geo_status === 'outside_geofence' ? 'info' : 'success', res.data?.message || 'Clocked in.');
      fetchWorkerData(false);
      setEarningsKey((k) => k + 1);
    } catch (err) {
      flash('error', err.response?.data?.detail || err.message || 'Could not clock in.');
```

**Edit 4.** Find:
```jsx
      flash(res.data?.status === 'undone' ? 'info' : 'success', res.data?.message || 'Clocked out.');
      fetchWorkerData(false);
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not clock out.');
```
Replace with:
```jsx
      flash(res.data?.status === 'undone' ? 'info' : 'success', res.data?.message || 'Clocked out.');
      fetchWorkerData(false);
      setEarningsKey((k) => k + 1);
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not clock out.');
```

**Edit 5.** Find:
```jsx
        {activeTab === 'schedule' && (
          <div className="mt-2 space-y-6">
            <WorkerOffers offers={offers} busyId={offerBusy} onAccept={(o) => handleOffer(o, 'accept')} onDecline={(o) => handleOffer(o, 'decline')} />
            <section className="space-y-3">
```
Replace with:
```jsx
        {activeTab === 'schedule' && (
          <div className="mt-2 space-y-6">
            <EarningsCard refreshKey={earningsKey} />
            <WorkerOffers offers={offers} busyId={offerBusy} onAccept={(o) => handleOffer(o, 'accept')} onDecline={(o) => handleOffer(o, 'decline')} />
            <section className="space-y-3">
```

---

## D6. `frontend/src/pages/VenueManagerDashboard.jsx` (EDITS)
**Download hours** replaces the Payroll CSV button (the old `exportPayroll` function and `exportingCSV` state are removed), plus plain wording.

**Edit 1.** Find:
```jsx
import TeamModal from '../components/TeamModal';
import ReviewModal from '../components/ReviewModal';
import ActivityFeed from '../components/ActivityFeed';
import { ApprovalQueueCard, TransfersCard } from '../components/ManagerQueues';
```
Replace with:
```jsx
import TeamModal from '../components/TeamModal';
import ReviewModal from '../components/ReviewModal';
import DownloadHoursModal from '../components/manager/DownloadHoursModal';   // Phase 33.1
import ActivityFeed from '../components/ActivityFeed';
import { ApprovalQueueCard, TransfersCard } from '../components/ManagerQueues';
```

**Edit 2.** Find:
```jsx
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [notification, setNotification] = useState(null);
```
Replace with:
```jsx
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [showDownload, setShowDownload] = useState(false);   // Phase 33.1: Download hours (pick a date range)
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [notification, setNotification] = useState(null);
```

**Edit 3.** Find:
```jsx
      setNotification({
        type: 'error',
        message: 'Could not load venue shifts, approval queue, or transfers from backend.',
      });
    } finally {
```
Replace with:
```jsx
      setNotification({
        type: 'error',
        message: "Couldn't load your shifts and requests. Check your connection and refresh.",
      });
    } finally {
```

**Edit 4.** Find:
```jsx
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to approve request.' });
    } finally {
      setActionLoading(null);
```
Replace with:
```jsx
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || "Couldn't approve the request. Try again." });
    } finally {
      setActionLoading(null);
```

**Edit 5.** Find:
```jsx
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to deny request.' });
    } finally {
      setActionLoading(null);
```
Replace with:
```jsx
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || "Couldn't deny the request. Try again." });
    } finally {
      setActionLoading(null);
```

**Edit 6.** Find:
```jsx
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to approve the hand-off.' });
    } finally {
      setActionLoading(null);
```
Replace with:
```jsx
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || "Couldn't approve the hand-off. Try again." });
    } finally {
      setActionLoading(null);
```

**Edit 7.** Find:
```jsx
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to deny the hand-off.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Phase 19: Hour Tracking & Payroll CSV Export
  const exportPayroll = async () => {
    if (!currentVenueId) return;
    try {
      setExportingCSV(true);
      const response = await api.get(`/venues/${currentVenueId}/payroll/export`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'payroll.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setNotification({ type: 'success', message: 'Payroll CSV downloaded.' });
    } catch (err) {
      console.error('Error exporting payroll CSV:', err);
      setNotification({ type: 'error', message: 'Failed to download payroll CSV.' });
    } finally {
      setExportingCSV(false);
    }
  };

  const handleManagerVenueChange = (e) => {
```
Replace with:
```jsx
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || "Couldn't deny the hand-off. Try again." });
    } finally {
      setActionLoading(null);
    }
  };



  const handleManagerVenueChange = (e) => {
```

**Edit 8.** Find:
```jsx
          <h1 className="text-lg font-bold text-white mb-1">No venue assigned yet</h1>
          <p className="text-sm text-slate-400">
            Your account is a Venue Manager but isn't linked to a venue. Ask a platform admin to assign you one in the Admin Panel.
          </p>
        </div>
```
Replace with:
```jsx
          <h1 className="text-lg font-bold text-white mb-1">No venue assigned yet</h1>
          <p className="text-sm text-slate-400">
            You're a manager, but you haven't been added to a venue yet. Ask a ShiftBoard admin to add you.
          </p>
        </div>
```

**Edit 9.** Find:
```jsx
                <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{venueDetails?.name || 'Venue'}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {isPlatformAdmin ? 'Platform admin' : 'Venue manager'}
                </span>
              </div>
```
Replace with:
```jsx
                <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{venueDetails?.name || 'Venue'}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {isPlatformAdmin ? 'Admin' : 'Manager'}
                </span>
              </div>
```

**Edit 10.** Find:
```jsx
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition inline-flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" /> Post a Shift
            </button>
            <button type="button" onClick={openTemplates} disabled={!venueDetails} className={headerBtn}>
```
Replace with:
```jsx
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition inline-flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" /> Post a shift
            </button>
            <button type="button" onClick={openTemplates} disabled={!venueDetails} className={headerBtn}>
```

**Edit 11.** Find:
```jsx
              <Settings className="w-4 h-4 text-amber-400" /> Settings
            </button>
            <button type="button" onClick={exportPayroll} disabled={exportingCSV || !currentVenueId} className={headerBtn}>
              <Download className="w-4 h-4 text-emerald-400" /> {exportingCSV ? 'Downloading…' : 'Payroll CSV'}
            </button>
            {currentVenueId && (
```
Replace with:
```jsx
              <Settings className="w-4 h-4 text-amber-400" /> Settings
            </button>
            <button type="button" onClick={() => setShowDownload(true)} disabled={!currentVenueId} className={headerBtn}>
              <Download className="w-4 h-4 text-emerald-400" /> Download hours
            </button>
            {currentVenueId && (
```

**Edit 12.** Find:
```jsx
      )}

      {review && currentVenueId && (
        <ReviewModal
```
Replace with:
```jsx
      )}

      {showDownload && currentVenueId && (
        <DownloadHoursModal
          venueId={currentVenueId}
          venueName={venueDetails?.name}
          onClose={() => setShowDownload(false)}
          onDone={(message) => setNotification({ type: 'success', message })}
          onError={(message) => setNotification({ type: 'error', message })}
        />
      )}

      {review && currentVenueId && (
        <ReviewModal
```

---

## D7. `frontend/src/components/Navbar.jsx` (EDITS)
"My shifts" / "Hours & pay" / "My venue"; role names Worker / Manager / Admin.

**Edit 1.** Find:
```jsx
import api from '../api/client';
import NotificationBell from './NotificationBell';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin, UserRound } from 'lucide-react';
import { Avatar } from './WorkerProfilePanel';
import { syncPush, disablePush } from '../utils/push';   // Phase 33

export default function Navbar() {
```
Replace with:
```jsx
import api from '../api/client';
import NotificationBell from './NotificationBell';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin, UserRound, Wallet } from 'lucide-react';
import { Avatar } from './WorkerProfilePanel';
import { syncPush, disablePush } from '../utils/push';   // Phase 33

// Phase 33.1: role names people read
const ROLE_TEXT = { worker: 'Worker', venue_manager: 'Manager', platform_admin: 'Admin' };

export default function Navbar() {
```

**Edit 2.** Find:
```jsx
    (isWorker || isPlatformAdmin) && {
      to: '/worker',
      label: 'Worker',
      icon: Briefcase,
      active: 'bg-slate-800 text-emerald-400',
    },
    (isManagerRole || isPlatformAdmin) && {
      to: '/venue',
      label: 'Venue Manager',
      icon: Building2,
      active: 'bg-slate-800 text-teal-400',
```
Replace with:
```jsx
    (isWorker || isPlatformAdmin) && {
      to: '/worker',
      label: isPlatformAdmin ? 'Worker view' : 'My shifts',
      icon: Briefcase,
      active: 'bg-slate-800 text-emerald-400',
    },
    isWorker && {                                   // Phase 33.1
      to: '/earnings',
      label: 'Hours & pay',
      icon: Wallet,
      active: 'bg-slate-800 text-emerald-400',
    },
    (isManagerRole || isPlatformAdmin) && {
      to: '/venue',
      label: isPlatformAdmin ? 'Manager view' : 'My venue',
      icon: Building2,
      active: 'bg-slate-800 text-teal-400',
```

**Edit 3.** Find:
```jsx
                  <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                    <span>{userRole.replace('_', ' ')}</span>
                  </div>
                </div>
```
Replace with:
```jsx
                  <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                    <span>{ROLE_TEXT[userRole] || 'Worker'}</span>
                  </div>
                </div>
```

**Edit 4.** Find:
```jsx
              <div className="text-xs text-slate-400 capitalize flex items-center space-x-1">
                <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                <span>{userRole.replace('_', ' ')}</span>
              </div>
            </div>
```
Replace with:
```jsx
              <div className="text-xs text-slate-400 capitalize flex items-center space-x-1">
                <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                <span>{ROLE_TEXT[userRole] || 'Worker'}</span>
              </div>
            </div>
```

---

# PART E: Frontend, plain language

## E1. `frontend/src/components/worker/MyShiftCard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import TipBadge from '../TipBadge';
import { fmtTime, fmtTimeRange, fmtShortDate } from '../../utils/venueTime';
import { STATUS_LABELS, PENDING_STATUSES } from '../../utils/listingFormat';

const SOURCE_LABELS = {
  manager_assign: 'Assigned by your manager',
  manager_manual: 'Approved by your manager',
  offer: 'You accepted an offer',
  transfer: 'Handed to you by a teammate',
  venue_whitelist: 'Booked instantly (team)',
  venue_everyone_auto: 'Booked instantly',
  shift_auto_confirm: 'Booked instantly',
  rating_threshold: 'Booked instantly (your rating)',
};

```
Replace with:
```jsx
import TipBadge from '../TipBadge';
import { fmtTime, fmtTimeRange, fmtShortDate } from '../../utils/venueTime';
import { statusLabel, PENDING_STATUSES } from '../../utils/listingFormat';

const SOURCE_LABELS = {
  manager_assign: 'Assigned by your manager',
  manager_manual: 'Approved by your manager',
  offer: 'You accepted an offer',
  transfer: 'Handed to you by a teammate',
  venue_whitelist: "Booked right away (you're on their team)",
  venue_everyone_auto: 'Booked right away',
  shift_auto_confirm: 'Booked right away',
  rating_threshold: 'Booked right away (thanks to your rating)',
};

```

**Edit 2.** Find:
```jsx
    ? ['Clocked in', 'bg-sky-500/15 text-sky-300 border-sky-500/40']
    : isBooked
      ? ['Confirmed', 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30']
      : isPending
        ? ['Waiting for the manager', 'bg-amber-500/15 text-amber-300 border-amber-500/30']
        : isCompleted
          ? ['Worked', 'bg-slate-800 text-slate-300 border-slate-700']
          : isDropped
            ? ['You dropped this', 'bg-rose-500/10 text-rose-300 border-rose-500/30']
            : [STATUS_LABELS[st] || st, 'bg-slate-800 text-slate-400 border-slate-700'];

  // The one main action
```
Replace with:
```jsx
    ? ['Clocked in', 'bg-sky-500/15 text-sky-300 border-sky-500/40']
    : isBooked
      ? ['Booked', 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30']
      : isPending
        ? ['Waiting for approval', 'bg-amber-500/15 text-amber-300 border-amber-500/30']
        : isCompleted
          ? ['Worked', 'bg-slate-800 text-slate-300 border-slate-700']
          : isDropped
            ? ['You dropped this', 'bg-rose-500/10 text-rose-300 border-rose-500/30']
            : [statusLabel(st), 'bg-slate-800 text-slate-400 border-slate-700'];

  // The one main action
```

---

## E2. `frontend/src/components/EventListingCard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import { fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, listingPayText, estPayText, STATUS_LABELS, PENDING_STATUSES, BOOKED_STATUSES, whereOf,
} from '../utils/listingFormat';

```
Replace with:
```jsx
import { fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, listingPayText, estPayText, statusLabel, PENDING_STATUSES, BOOKED_STATUSES, whereOf,
} from '../utils/listingFormat';

```

**Edit 2.** Find:
```jsx
    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
    : 'bg-slate-800 text-slate-400 border-slate-700';
  const text = booked ? `Booked · ${role}` : waiting ? `Requested · ${role}` : STATUS_LABELS[s] || s;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${cls}`}>
```
Replace with:
```jsx
    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
    : 'bg-slate-800 text-slate-400 border-slate-700';
  const text = booked ? `Booked · ${role}` : waiting ? `Waiting · ${role}` : statusLabel(s);
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${cls}`}>
```

---

## E3. `frontend/src/components/EventListingModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import { fmtLongDate, fmtTimeRange, fmtDate } from '../utils/venueTime';
import {
  hoursText, estPayText, mapsUrl, downloadIcs, STATUS_LABELS, PENDING_STATUSES, whereOf,
} from '../utils/listingFormat';

```
Replace with:
```jsx
import { fmtLongDate, fmtTimeRange, fmtDate } from '../utils/venueTime';
import {
  hoursText, estPayText, mapsUrl, downloadIcs, statusLabel, PENDING_STATUSES, whereOf,
} from '../utils/listingFormat';

```

**Edit 2.** Find:
```jsx
 *   onClose()       close the modal
 *   onChanged(res)  called after a successful request / switch / withdraw (parent refreshes lists)
 *   onGoToSchedule() optional; shows a "Go to My Schedule" button when the worker is booked
 */
export default function EventListingModal({ eventId, initial = null, onClose, onChanged, onGoToSchedule }) {
```
Replace with:
```jsx
 *   onClose()       close the modal
 *   onChanged(res)  called after a successful request / switch / withdraw (parent refreshes lists)
 *   onGoToSchedule() optional; shows a "Go to My shifts" button when the worker is booked
 */
export default function EventListingModal({ eventId, initial = null, onClose, onChanged, onGoToSchedule }) {
```

**Edit 3.** Find:
```jsx
      primary = (
        <button type="button" onClick={onGoToSchedule} className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold">
          Go to My Schedule
        </button>
      );
```
Replace with:
```jsx
      primary = (
        <button type="button" onClick={onGoToSchedule} className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold">
          Go to My shifts
        </button>
      );
```

**Edit 4.** Find:
```jsx
          </div>
          <p className="text-xs text-emerald-300/80 mt-1">
            To change position, drop or hand off this shift from My Schedule first.
            {bookedPosition && bookedPosition.hourly_rate !== null && (
              <> Pay: <PayLabel rate={bookedPosition.hourly_rate} rateMax={bookedPosition.hourly_rate_max} className="font-semibold" /></>
```
Replace with:
```jsx
          </div>
          <p className="text-xs text-emerald-300/80 mt-1">
            To change position, drop or hand off this shift from My shifts first.
            {bookedPosition && bookedPosition.hourly_rate !== null && (
              <> Pay: <PayLabel rate={bookedPosition.hourly_rate} rateMax={bookedPosition.hourly_rate_max} className="font-semibold" /></>
```

**Edit 5.** Find:
```jsx
                      {ps && (
                        <p className={`text-[11px] mt-1.5 font-semibold ${isMine ? 'text-amber-300' : 'text-slate-400'}`}>
                          {ps === 'dropped' ? 'You dropped this' : `You: ${STATUS_LABELS[ps] || ps}`}
                          {p.my_status_reason ? ` — ${p.my_status_reason}` : ''}
                        </p>
```
Replace with:
```jsx
                      {ps && (
                        <p className={`text-[11px] mt-1.5 font-semibold ${isMine ? 'text-amber-300' : 'text-slate-400'}`}>
                          {ps === 'dropped' ? 'You dropped this' : `You: ${statusLabel(ps)}`}
                          {p.my_status_reason ? ` — ${p.my_status_reason}` : ''}
                        </p>
```

---

## E4. `frontend/src/pages/VenueProfile.jsx` (EDIT)

**Edit 1.** Find:
```jsx

const MY_STATUS = {
  pending: { label: 'Requested', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  pending_manager_approval: { label: 'Requested', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  approved: { label: "You're booked", cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  confirmed: { label: "You're booked", cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  checked_in: { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  completed: { label: 'Worked', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' },
  rejected: { label: 'Not selected', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  dropped: { label: 'Released', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  transferred: { label: 'Handed off', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
```
Replace with:
```jsx

const MY_STATUS = {
  pending: { label: 'Waiting for approval', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  pending_manager_approval: { label: 'Waiting for approval', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  approved: { label: 'Booked', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  confirmed: { label: 'Booked', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  checked_in: { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  completed: { label: 'Worked', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' },
  rejected: { label: 'Not selected', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  dropped: { label: 'You dropped this', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  no_show: { label: 'Marked no-show', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },        // Phase 33.1
  removed: { label: 'Removed by manager', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  cancelled: { label: 'Cancelled by venue', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  transferred: { label: 'Handed off', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
```

---

## E5. `frontend/src/components/ShiftBoard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
    } catch (err) {
      console.error('Error fetching shift board messages:', err);
      setError(err.response?.data?.detail || 'Failed to load discussion messages.');
    } finally {
      setLoading(false);
```
Replace with:
```jsx
    } catch (err) {
      console.error('Error fetching shift board messages:', err);
      setError(err.response?.data?.detail || "Couldn't load the chat. Check your connection and try again.");
    } finally {
      setLoading(false);
```

**Edit 2.** Find:
```jsx
    } catch (err) {
      console.error('Error sending message:', err);
      setError(err.response?.data?.detail || 'Failed to send message.');
    } finally {
      setSending(false);
```
Replace with:
```jsx
    } catch (err) {
      console.error('Error sending message:', err);
      setError(err.response?.data?.detail || "Couldn't send your message. Try again.");
    } finally {
      setSending(false);
```

**Edit 3.** Find:
```jsx
    } catch (err) {
      console.error('Error deleting message:', err);
      setError(err.response?.data?.detail || 'Failed to delete message.');
    }
  };
```
Replace with:
```jsx
    } catch (err) {
      console.error('Error deleting message:', err);
      setError(err.response?.data?.detail || "Couldn't delete that message. Try again.");
    }
  };
```

**Edit 4.** Find:
```jsx
          <div>
            <h3 className="text-sm font-bold text-white leading-none">
              Shift Discussion Board
            </h3>
            {shiftTitle && (
```
Replace with:
```jsx
          <div>
            <h3 className="text-sm font-bold text-white leading-none">
              Shift chat
            </h3>
            {shiftTitle && (
```

**Edit 5.** Find:
```jsx
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            Loading discussion...
          </div>
        ) : messages.length === 0 ? (
```
Replace with:
```jsx
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            Loading chat…
          </div>
        ) : messages.length === 0 ? (
```

---

## E6. `frontend/src/pages/JoinPage.jsx` (EDITS)

**Edit 1.** Find:
```jsx
          <Check className="w-5 h-5 flex-shrink-0" />
          {joined?.already_member ? `You're already on the ${joined.venue_name} team.` : `You're on the ${joined?.venue_name} team.`}
          {' '}You'll see their shifts in Find Shifts and get alerts when they post new ones.
        </div>
        <button type="button" onClick={() => navigate('/worker', { replace: true })}
```
Replace with:
```jsx
          <Check className="w-5 h-5 flex-shrink-0" />
          {joined?.already_member ? `You're already on the ${joined.venue_name} team.` : `You're on the ${joined?.venue_name} team.`}
          {' '}You'll see their shifts in Find shifts and get alerts when they post new ones.
        </div>
        <button type="button" onClick={() => navigate('/worker', { replace: true })}
```

---

## E7. `frontend/src/components/PushDeviceCard.jsx` (EDIT)

**Edit 1.** Find:
```jsx
              <Smartphone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {d.device_label || 'Device'} <span className="text-slate-500">· added {fmtDay(d.created_at)}{d.provider === 'fcm' ? ' · via Firebase' : ''}</span>
                {d.last_error && <span className="text-amber-300"> · last try failed</span>}
              </span>
```
Replace with:
```jsx
              <Smartphone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {d.device_label || 'Device'} <span className="text-slate-500">· added {fmtDay(d.created_at)}</span>
                {d.last_error && <span className="text-amber-300"> · last try failed</span>}
              </span>
```

---

## E8. `frontend/src/components/NotificationSettingsModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
              {!prefs.email_available && (
                <p className="text-[11px] text-amber-300 flex items-start gap-1">
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> Email sending isn't set up on this server yet, so emails are only logged.
                </p>
              )}
```
Replace with:
```jsx
              {!prefs.email_available && (
                <p className="text-[11px] text-amber-300 flex items-start gap-1">
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> Email isn't available yet. You'll still see everything in the bell.
                </p>
              )}
```

**Edit 2.** Find:
```jsx
              />
              {!prefs.sms_available && (
                <p className="text-[11px] text-slate-500">Texts aren't set up on this server yet.</p>
              )}
            </div>
```
Replace with:
```jsx
              />
              {!prefs.sms_available && (
                <p className="text-[11px] text-slate-500">Texts aren't available yet.</p>
              )}
            </div>
```

---

## E9. `frontend/src/utils/push.js` (EDITS)

**Edit 1.** Find:
```js
    serviceWorkerRegistration: reg,
  });
  if (!token) throw new Error("Firebase didn't return a token for this device.");
  const old = storedToken();
  if (old && old !== token) await api.post('/notifications/push/unsubscribe', { endpoint: old }).catch(() => {});
```
Replace with:
```js
    serviceWorkerRegistration: reg,
  });
  if (!token) throw new Error("Couldn't turn on notifications on this device. Try again.");
  const old = storedToken();
  if (old && old !== token) await api.post('/notifications/push/unsubscribe', { endpoint: old }).catch(() => {});
```

**Edit 2.** Find:
```js
  }
  const reg = await swRegistration();
  if (!reg) throw new Error("Notifications need the secure (https) address of ShiftBoard.");
  const { data } = await api.get('/notifications/push');
  if (data.provider === 'fcm') return subscribeFcm(reg, data);          // Phase 33.0.1
```
Replace with:
```js
  }
  const reg = await swRegistration();
  if (!reg) throw new Error('Open ShiftBoard from its usual web address (https://…) to turn on notifications.');
  const { data } = await api.get('/notifications/push');
  if (data.provider === 'fcm') return subscribeFcm(reg, data);          // Phase 33.0.1
```

---

## E10. `frontend/src/pages/LoginPage.jsx` (EDITS)

**Edit 1.** Find:
```jsx
      return 'Enter a valid email address.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is turned off in Firebase.';
    case 'auth/account-exists-with-different-credential':
      return 'You already signed up with a different method for this email. Use that method instead.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase. Add it under Authentication → Settings → Authorized domains.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
```
Replace with:
```jsx
      return 'Enter a valid email address.';
    case 'auth/operation-not-allowed':
      return "This sign-in option isn't available right now. Try another one.";
    case 'auth/account-exists-with-different-credential':
      return 'You already signed up with a different method for this email. Use that method instead.';
    case 'auth/unauthorized-domain':
      return "Sign-in with this option isn't set up for this web address yet. (Admins: add it in Firebase → Authentication → Settings → Authorized domains.)";
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
```

**Edit 2.** Find:
```jsx
      navigateToRoleRoute(userSession);
    } catch (err) {
      setError(err.response?.data?.detail || 'Google Mock Auth failed.');
    } finally {
      setSubmitting(false);
```
Replace with:
```jsx
      navigateToRoleRoute(userSession);
    } catch (err) {
      setError(err.response?.data?.detail || "Google sign-in didn't work. Try again.");
    } finally {
      setSubmitting(false);
```

**Edit 3.** Find:
```jsx
          Shift<span className="text-emerald-400">Board</span>
        </h2>
        <p className="mt-2 text-sm text-slate-400">Hospitality Call-Board & Shift Scheduling Platform</p>
      </div>

```
Replace with:
```jsx
          Shift<span className="text-emerald-400">Board</span>
        </h2>
        <p className="mt-2 text-sm text-slate-400">Pick up shifts. Fill your staff.</p>
      </div>

```

**Edit 4.** Find:
```jsx
          {mode === 'signin' && fbStatus.show_demo_logins && (
            <div className="mb-6 p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 text-xs">
              <div className="font-semibold text-slate-300 mb-2">⚡ Quick Demo Credentials:</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => fillCredentials('demo_admin@shiftboard.com', 'SuperSecretDemo123!')}
                  className="px-2 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-300 font-medium transition text-left flex items-center space-x-1"
                  title="Super Admin (platform_admin)"
                >
                  <Shield className="w-3.5 h-3.5 flex-shrink-0" />
```
Replace with:
```jsx
          {mode === 'signin' && fbStatus.show_demo_logins && (
            <div className="mb-6 p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 text-xs">
              <div className="font-semibold text-slate-300 mb-2">⚡ Demo accounts:</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => fillCredentials('demo_admin@shiftboard.com', 'SuperSecretDemo123!')}
                  className="px-2 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-300 font-medium transition text-left flex items-center space-x-1"
                  title="Demo admin"
                >
                  <Shield className="w-3.5 h-3.5 flex-shrink-0" />
```

**Edit 5.** Find:
```jsx
                  onClick={() => fillCredentials('demo_manager@shiftboard.com', 'DemoManager123!')}
                  className="px-2 py-1.5 rounded-lg bg-teal-950/80 hover:bg-teal-900 border border-teal-700/50 text-teal-300 font-medium transition text-left flex items-center space-x-1"
                  title="Venue Manager (venue_manager)"
                >
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
```
Replace with:
```jsx
                  onClick={() => fillCredentials('demo_manager@shiftboard.com', 'DemoManager123!')}
                  className="px-2 py-1.5 rounded-lg bg-teal-950/80 hover:bg-teal-900 border border-teal-700/50 text-teal-300 font-medium transition text-left flex items-center space-x-1"
                  title="Demo manager"
                >
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
```

**Edit 6.** Find:
```jsx
                  onClick={() => fillCredentials('demo_worker@shiftboard.com', 'DemoWorker123!')}
                  className="px-2 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/50 text-emerald-300 font-medium transition text-left flex items-center space-x-1"
                  title="Demo Worker (worker)"
                >
                  <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />
```
Replace with:
```jsx
                  onClick={() => fillCredentials('demo_worker@shiftboard.com', 'DemoWorker123!')}
                  className="px-2 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/50 text-emerald-300 font-medium transition text-left flex items-center space-x-1"
                  title="Demo worker"
                >
                  <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />
```

**Edit 7.** Find:
```jsx
            <div className="mb-4 p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl text-slate-300 text-xs flex items-start space-x-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
              <span>New accounts start as Workers. Venue manager and admin accounts are set up by an administrator.</span>
            </div>
          )}
```
Replace with:
```jsx
            <div className="mb-4 p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl text-slate-300 text-xs flex items-start space-x-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
              <span>New accounts are for workers. Manager accounts are set up for you by ShiftBoard or your venue.</span>
            </div>
          )}
```

---

## E11. `frontend/src/components/ProtectedRoute.jsx` (EDITS)

**Edit 1.** Find:
```jsx
            <ShieldAlert className="w-12 h-12" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-sm text-slate-400 max-w-md text-center mb-6">
            Your account role (<span className="text-emerald-400 font-semibold">{user?.role}</span>) does not have permission to view this view. Required role: {allowedRoles.join(' or ')}.
          </p>
          <Link
```
Replace with:
```jsx
            <ShieldAlert className="w-12 h-12" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">This page isn't for your account</h1>
          <p className="text-sm text-slate-400 max-w-md text-center mb-6">
            {allowedRoles.map((r) => String(r).toLowerCase()).includes('venue_manager') && !allowedRoles.map((r) => String(r).toLowerCase()).includes('worker')
              ? 'This page is for venue managers.'
              : allowedRoles.map((r) => String(r).toLowerCase()).every((r) => r === 'platform_admin')
              ? 'This page is for ShiftBoard admins.'
              : 'Your account can’t open this page.'} Head back to your own page instead.
          </p>
          <Link
```

**Edit 2.** Find:
```jsx
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go to My Dashboard</span>
          </Link>
        </div>
```
Replace with:
```jsx
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go to my page</span>
          </Link>
        </div>
```

---

## E12. `frontend/src/components/PostedShiftsBoard.jsx` (EDIT)

**Edit 1.** Find:
```jsx
          <CalendarIcon className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white">Posted Shifts ({events.length})</h2>
            <p className="text-xs text-slate-400">
              Every event with its positions, staff and requests.
```
Replace with:
```jsx
          <CalendarIcon className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white">Posted shifts ({events.length})</h2>
            <p className="text-xs text-slate-400">
              Every event with its positions, staff and requests.
```

---

## E13. `frontend/src/components/ShiftEventFormModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx

const APPROVAL_OPTIONS = [
  { value: 'venue_default', label: 'Venue default' },
  { value: 'auto', label: 'Instant booking' },
  { value: 'manual', label: 'Needs my approval' },
];
```
Replace with:
```jsx

const APPROVAL_OPTIONS = [
  { value: 'venue_default', label: 'Use venue setting' },
  { value: 'auto', label: 'Book instantly' },
  { value: 'manual', label: 'Needs my approval' },
];
```

**Edit 2.** Find:
```jsx
                <label className={labelCls}>Clock-in location check</label>
                <select value={geofenceMode} onChange={(e) => setGeofenceMode(e.target.value)} className={inputCls}>
                  <option value="venue_default">Venue default ({venueGeoOn ? 'on' : 'off'})</option>
                  <option value="on">On for this event</option>
                  <option value="off">Off for this event</option>
```
Replace with:
```jsx
                <label className={labelCls}>Clock-in location check</label>
                <select value={geofenceMode} onChange={(e) => setGeofenceMode(e.target.value)} className={inputCls}>
                  <option value="venue_default">Use venue setting ({venueGeoOn ? 'on' : 'off'})</option>
                  <option value="on">On for this event</option>
                  <option value="off">Off for this event</option>
```

**Edit 3.** Find:
```jsx
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Venue default means {POLICY_TEXT[venue?.approval_policy] || POLICY_TEXT.team_auto}. You can also set each position on the right.
                </span>
              </p>
```
Replace with:
```jsx
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  “Use venue setting” means {POLICY_TEXT[venue?.approval_policy] || POLICY_TEXT.team_auto}. You can also set each position on the right.
                </span>
              </p>
```

**Edit 4.** Find:
```jsx
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>
                        Venue default: {payText(pos.default_rate, pos.default_rate_max)}
                        {tipsText(pos) ? ` · ${tipsText(pos)}` : ''}
                        {pos.hide_rate ? ' · pay hidden' : ''}
```
Replace with:
```jsx
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>
                        Usual pay: {payText(pos.default_rate, pos.default_rate_max)}
                        {tipsText(pos) ? ` · ${tipsText(pos)}` : ''}
                        {pos.hide_rate ? ' · pay hidden' : ''}
```

---

## E14. `frontend/src/components/EventRosterModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import { fmtDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';

const APPROVAL_LABEL = { venue_default: 'Venue default', auto: 'Instant booking', manual: 'Needs approval' };
const SOURCE_LABEL = { manager_assign: 'Assigned by manager', offer: 'Accepted an offer' };   // Phase 29
const OFFER_CHIP = {
```
Replace with:
```jsx
import { fmtDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';

const APPROVAL_LABEL = { venue_default: 'Venue setting', auto: 'Book instantly', manual: 'Needs approval' };
const SOURCE_LABEL = { manager_assign: 'Assigned by manager', offer: 'Accepted an offer' };   // Phase 29
const OFFER_CHIP = {
```

**Edit 2.** Find:
```jsx
                  <TipBadge shift={pos} />
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                    {APPROVAL_LABEL[pos.approval_mode] || 'Venue default'}
                  </span>
                  <span className={`text-xs font-semibold ${isFull ? 'text-emerald-400' : 'text-slate-300'}`}>{pos.assigned.length} / {pos.capacity} filled</span>
```
Replace with:
```jsx
                  <TipBadge shift={pos} />
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                    {APPROVAL_LABEL[pos.approval_mode] || 'Venue setting'}
                  </span>
                  <span className={`text-xs font-semibold ${isFull ? 'text-emerald-400' : 'text-slate-300'}`}>{pos.assigned.length} / {pos.capacity} filled</span>
```

---

## E15. `frontend/src/components/VenueSettingsModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
                </div>
                <div>
                  <label className={labelCls}>Radius (m)</label>
                  <input type="number" min="25" max="5000" value={form.geofence_radius_meters} onChange={set('geofence_radius_meters')} className={inputCls} />
                </div>
```
Replace with:
```jsx
                </div>
                <div>
                  <label className={labelCls}>Clock-in area (meters)</label>
                  <input type="number" min="25" max="5000" value={form.geofence_radius_meters} onChange={set('geofence_radius_meters')} className={inputCls} />
                </div>
```

**Edit 2.** Find:
```jsx
              {form.geofence_enabled && (
                <div>
                  <label className={labelCls}>Buffer outside the radius (m)</label>
                  <input type="number" min="0" max="2000" value={form.geofence_buffer_meters} onChange={set('geofence_buffer_meters')} className={`${inputCls} w-32`} />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Inside the radius: clocked in. Within the buffer: clocked in but flagged “Outside geofence” for you.
                    Farther out: clock-in is blocked.
                  </p>
```
Replace with:
```jsx
              {form.geofence_enabled && (
                <div>
                  <label className={labelCls}>Extra distance allowed (meters)</label>
                  <input type="number" min="0" max="2000" value={form.geofence_buffer_meters} onChange={set('geofence_buffer_meters')} className={`${inputCls} w-32`} />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Inside the area: clocked in. A little outside it (within the extra distance): clocked in, but flagged “Outside the area” for you.
                    Farther out: clock-in is blocked.
                  </p>
```

---

## E16. `frontend/src/components/LocationFields.jsx` (EDIT)

**Edit 1.** Find:
```jsx
          </div>
          <div>
            <label className={labelCls}>Radius (m)</label>
            <input
              type="number"
```
Replace with:
```jsx
          </div>
          <div>
            <label className={labelCls}>Clock-in area (meters)</label>
            <input
              type="number"
```

---

## E17. `frontend/src/components/TeamModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
          <p className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg p-2 flex gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            This link points at localhost, so it won't open on anyone's phone. Set APP_BASE_URL in the server's secrets file to your site address.
          </p>
        )}
```
Replace with:
```jsx
          <p className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg p-2 flex gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            This link won't open on other people's phones yet. Ask your ShiftBoard admin to set the site's public address.
          </p>
        )}
```

**Edit 2.** Find:
```jsx
      <p className="text-sm text-white">
        <strong>{result.invited}</strong> invited, <strong>{result.skipped}</strong> skipped.
        {result.emailed > 0 && ` ${result.emailed} emailed${result.email_available ? '' : ' (email isn’t set up on this server, so they were only logged; copy the links instead)'}.`}
        {result.texted > 0 && ` ${result.texted} texted.`}
      </p>
```
Replace with:
```jsx
      <p className="text-sm text-white">
        <strong>{result.invited}</strong> invited, <strong>{result.skipped}</strong> skipped.
        {result.emailed > 0 && ` ${result.emailed} emailed${result.email_available ? '' : ' (email isn’t available yet, so copy the links instead)'}.`}
        {result.texted > 0 && ` ${result.texted} texted.`}
      </p>
```

**Edit 3.** Find:
```jsx

      <div className={`${cardCls} space-y-3`}>
        <div className="text-sm font-bold text-white flex items-center gap-2"><Upload className="w-4 h-4 text-emerald-400" /> Import a list (CSV)</div>
        <p className="text-xs text-slate-400">
          First row = column names: <code className="text-slate-200">name</code> (or <code className="text-slate-200">first_name</code>, <code className="text-slate-200">last_name</code>),{' '}
```
Replace with:
```jsx

      <div className={`${cardCls} space-y-3`}>
        <div className="text-sm font-bold text-white flex items-center gap-2"><Upload className="w-4 h-4 text-emerald-400" /> Import a spreadsheet (.csv)</div>
        <p className="text-xs text-slate-400">
          First row = column names: <code className="text-slate-200">name</code> (or <code className="text-slate-200">first_name</code>, <code className="text-slate-200">last_name</code>),{' '}
```

**Edit 4.** Find:
```jsx
        <div className="text-sm font-bold text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-400" /> Managers of this venue</div>
        {managers.length === 0 && (
          <p className="text-xs text-slate-500">No managers yet. Only platform admins can run this venue until you add one below.</p>
        )}
        <div className="divide-y divide-slate-800">
```
Replace with:
```jsx
        <div className="text-sm font-bold text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-400" /> Managers of this venue</div>
        {managers.length === 0 && (
          <p className="text-xs text-slate-500">No managers yet. Only ShiftBoard admins can run this venue until you add one below.</p>
        )}
        <div className="divide-y divide-slate-800">
```

**Edit 5.** Find:
```jsx
          <p className="text-[11px] text-slate-500">
            If they already have a manager account, they're added to this venue. Otherwise a manager account is created with a temporary password.
            Worker accounts can't be made managers here (ask a platform admin).
          </p>
          <button type="submit" className={btnPrimary} disabled={busy}>
```
Replace with:
```jsx
          <p className="text-[11px] text-slate-500">
            If they already have a manager account, they're added to this venue. Otherwise a manager account is created with a temporary password.
            Worker accounts can't be made managers here (ask a ShiftBoard admin).
          </p>
          <button type="submit" className={btnPrimary} disabled={busy}>
```

---

# PART F0: Cleanup
## F0-1. DELETE `frontend/src/components/ShiftRosterModal.jsx`
Nothing imports it (check with a search for `ShiftRosterModal`: the only hit should be the file itself).

## F0-2. DELETE `frontend/src/components/manager/TimeOffCard.jsx`
Left over from 32.1. Nothing imports it.

Use `git rm <path>` or your file tools. **If your tools can't delete files, stop and tell Andrew** so he can delete both himself. Don't empty them or leave stubs.

---

## F. Rebuild & verification

**No schema change, no new packages.** A normal rebuild is enough (no `down -v`):
```bash
docker compose up -d --build
```
If the page is blank or shows "Invalid hook call":
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

### Checklist
**Hours & pay (worker)**
1. My shifts shows a **This week** card with hours and pay (and "N more booked"). Tap it to open **Hours & pay**.
2. Clock in and out of a shift (or have a manager add a time on the time sheet): it appears under today with hours × rate. The week total updates.
3. Switch Last week / This month / Last month. **Download (spreadsheet)** saves a CSV whose times match what you saw (not 4–5 hours off).
4. On desktop, the nav shows **My shifts · Hours & pay**. On a phone, the page sits above the bottom tab bar.

**Download hours (manager)**

5. The header button now says **Download hours**. Pick *Last week* and download.
   * The file is named after the venue.
   * The "Clock in (EDT)" column shows local times.
   * Only last week's rows are included.

**Plain language**

6. Worker screens say **Booked** / **Waiting for approval** (never "Confirmed" or a raw status). The event popup's button says **Go to My shifts**, and the shift chat is titled **Shift chat**.
7. Send a hand-off to yourself or twice: the messages talk about **hand-offs**, not transfers.
8. Stop the backend (`docker compose stop backend`) and click around: you see "Can't reach ShiftBoard…" or each screen's friendly message, never "Network Error" or "Request failed with status code 502". Start it again.
9. Manager: Post / edit a shift shows **Use venue setting**, **Book instantly**, **Clock-in area (meters)**. The role badge says **Manager**.
10. Login page: the tagline reads "Pick up shifts. Fill your staff." The demo buttons say Demo admin / manager / worker.
11. `ShiftRosterModal.jsx` and `manager/TimeOffCard.jsx` are gone.