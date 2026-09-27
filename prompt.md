# Phase 32.1: Time Off Becomes Blocks, Not Requests

**Why:** In 31/32, time off was a *request* a manager approved or declined. For service-industry workers that's backwards:
* People juggle several venues, classes, another job and family.
* They shouldn't have to ask permission to be unavailable.
* A request that's pending, ignored or declined still leaves them open to being booked over it.

From now on **the worker owns their time off**. They block it off and it takes effect immediately; there's nothing to approve. Venues can't book over it.

## What changes

### For workers (Profile → Time off)
1. **Add time off** opens an inline form:
   * **All day** or **Part of the day** (from / until, half-hour steps; an "until" earlier than "from" runs into the next day, and "Midnight" is allowed).
   * **Doesn't repeat** (first day → last day, up to 90 days), **Every week** or **Every other week**. Repeating blocks pick the weekdays and **Ends: Never / On a date**.
   * **Reason managers see** (optional, 200 characters), e.g. "Class", "Other job".
   * **Private note, only you see it** (optional, 500 characters). It never appears on any manager screen, notification or activity line.
2. Each block shows as a plain sentence:
   * "Every Tue & Thu, 9:00 AM – 2:00 PM until Dec 16"
   * "Fri Oct 2, 8:00 PM – midnight"
   * "Every other Sat & Sun, all day from Oct 7"

   It also shows the reason and private note, with **Edit** and 🗑. Ended blocks drop into an "Ended" list.
3. If a block overlaps shifts they're **already booked on**, those stay booked and are listed ("Still booked: Fri Oct 2 · Server · Friday Gala…"), so the worker can drop or hand them off.
4. Find Shifts:
   * Cards say **"During your time off"**, and the event popup explains it.
   * "Fits my availability" hides those shifts.
   * The worker **can still request a shift inside their own block**: it's their choice.

### For managers
1. **They can't book over a block:**
   * In Assign / Offer, the person is greyed out with **"Blocked off this time (Class)."** and a red "Time off: Class" chip.
   * **Assign** is refused by the API (409), **offers skip them**, and **hand-offs to them are refused**.
   * The one exception: approving a request the worker made themselves for that position.
2. **Heads-up when a block hits an existing booking:**
   * Each affected venue's managers get a notification: "Jordan Lee blocked off time they're booked for · Fri Oct 2 · Server · Friday Gala · Their time off: … · “reason”".
   * It's urgent, so it can go by SMS, and it's sent again if the block is edited.
   * The activity log (Alerts) gets a line, and the roster shows **"Has time off during this shift · “reason”"** on that person.
3. **This week** lists who's off each day, e.g. "Alex Rivers" / "Sam Taylor (5:00 PM – 9:00 PM)".
4. The worker's profile (Team page / activity log) lists their blocks with reasons, **never private notes**.
5. **Removed:**
   * the Time-off requests card
   * the "time-off request" chip in the Needs-you strip
   * the approve / decline endpoints and notifications

⚠️ **Schema change:**
* `time_off_requests` is replaced by `time_off_blocks`.
* The keep-data SQL in §E converts waiting and approved requests that haven't ended into all-day blocks.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `main.py` (unchanged this phase)
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
* No new npm or Python packages.
* No native PostgreSQL ENUMs: `repeat` is `VARCHAR` (`none | weekly | biweekly`), and weekdays are a `SMALLINT[]` (0 = Monday).
* Aware UTC datetimes only. A block is wall-clock time where they work, so it's checked in each **shift's venue time zone**, like availability.
* Notification and activity hooks run after the commit and never raise.
* **The private note must never leave the worker's own screens.** Only `GET /api/me/profile` and the worker's own create/edit responses include it (`owner=True`); every manager view builds items with `owner=False`.
* **DELETE `frontend/src/components/manager/TimeOffCard.jsx`** (step D7). Nothing imports it after this phase.
* **NEW FILE / FULL FILE REPLACEMENT**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from your **current** files: every 31/32 file in your repo was checked and matched. They were verified:
  - the backend imports cleanly: 170 API operations (removed `…/cancel`, `GET /venues/{id}/time-off` and `…/decide`; added PUT and DELETE for a block)
  - the frontend bundles with no missing imports
  - **107 checks** in the 31/32 suite pass (the time-off part rewritten for blocks: one-off, partial, overnight, weekly, every-other-week, end dates, privacy, assign/offer/hand-off refusals, notifications, week view), and all earlier suites pass
  - the keep-data migration was tested on a 31/32 database holding requests
  - the new screens were rendered with the real Tailwind build, on desktop and phone

  Don't "improve" them.

---

# PART A: Database, models, schemas

## A1. `database/init.sql` (EDIT)
Replaces the `time_off_requests` table with `time_off_blocks`.

**Edit 1.** Find:
```sql
CREATE INDEX idx_worker_availability_worker ON worker_availability(worker_id);

CREATE TABLE time_off_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,                                   -- inclusive
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',            -- pending | approved | denied | cancelled
    decided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
    decision_note TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_time_off_range CHECK (end_date >= start_date)
);
CREATE INDEX idx_time_off_worker ON time_off_requests(worker_id);
CREATE INDEX idx_time_off_status ON time_off_requests(status);

-- ------------------------------------------------------------------------------
```
Replace with:
```sql
CREATE INDEX idx_worker_availability_worker ON worker_availability(worker_id);

-- Phase 32.1: time off is a block the worker sets (no approval). Managers can't book over it.
CREATE TABLE time_off_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    all_day BOOLEAN NOT NULL DEFAULT TRUE,
    start_date DATE NOT NULL,
    end_date DATE,                                            -- inclusive; NULL = repeats with no end
    start_local VARCHAR(5),                                   -- 'HH:MM' when not all day
    end_local VARCHAR(5),                                     -- 'HH:MM' or '24:00'; at/before start = runs past midnight
    repeat VARCHAR(20) NOT NULL DEFAULT 'none',               -- none | weekly | biweekly
    weekdays SMALLINT[] NOT NULL DEFAULT '{}',                -- 0 = Monday ... 6 = Sunday (repeating blocks)
    reason VARCHAR(200),                                      -- managers see this
    private_note TEXT,                                        -- only the worker sees this
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_time_off_block_range CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX idx_time_off_blocks_worker ON time_off_blocks(worker_id);

-- ------------------------------------------------------------------------------
```

---

## A2. `backend/src/models.py` (EDITS)
`TimeOffRequest` → `TimeOffBlock`.

**Edit 1.** Find:
```python

# ------------------------------------------------------------------------------
# Phase 31: Availability & time off
# ------------------------------------------------------------------------------
class WorkerAvailability(Base):
```
Replace with:
```python

# ------------------------------------------------------------------------------
# Phase 31: Availability  /  Phase 32.1: time off blocks
# ------------------------------------------------------------------------------
class WorkerAvailability(Base):
```

**Edit 2.** Find:
```python


class TimeOffRequest(Base):
    __tablename__ = "time_off_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)                 # inclusive
    reason = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="pending", index=True)   # pending | approved | denied | cancelled
    decided_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="SET NULL"), nullable=True)
    decision_note = Column(Text, nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (CheckConstraint("end_date >= start_date", name="chk_time_off_range"),)


```
Replace with:
```python


class TimeOffBlock(Base):
    """Phase 32.1: time the worker has blocked off. No approval; managers can't book over it."""
    __tablename__ = "time_off_blocks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    all_day = Column(Boolean, nullable=False, default=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)                  # inclusive; None = repeats with no end
    start_local = Column(String(5), nullable=True)          # 'HH:MM' when not all day
    end_local = Column(String(5), nullable=True)            # 'HH:MM' or '24:00'
    repeat = Column(String(20), nullable=False, default="none")          # none | weekly | biweekly
    weekdays = Column(ARRAY(SmallInteger), nullable=False, default=list)  # 0 = Monday ... 6 = Sunday
    reason = Column(String(200), nullable=True)             # managers see this
    private_note = Column(Text, nullable=True)              # only the worker sees this
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (CheckConstraint("end_date IS NULL OR end_date >= start_date", name="chk_time_off_block_range"),)


```

---

## A3. `backend/src/schemas.py` (EDITS)
* `TimeOffCreate` / `TimeOffItem` / `TimeOffDecision` → `TimeOffBlockInput` / `TimeOffBlockItem`
* `time_off` is now `'blocked'`, with `time_off_reason` on `RosterPerson` and `AssignCandidate`
* `MyProfile.time_off` and `WorkerProfile.time_off` hold blocks

**Edit 1.** Find:
```python
    rebook_reason: Optional[str] = None          # Phase 29.4
    cert_issues: List[str] = []                  # Phase 32: e.g. "Alcohol server card (expired)", "Food handler card not verified"
    time_off: Optional[str] = None               # Phase 31: approved | pending time off on this shift's day(s)


```
Replace with:
```python
    rebook_reason: Optional[str] = None          # Phase 29.4
    cert_issues: List[str] = []                  # Phase 32: e.g. "Alcohol server card (expired)", "Food handler card not verified"
    time_off: Optional[str] = None               # Phase 32.1: 'blocked' when a time-off block overlaps this shift
    time_off_reason: Optional[str] = None        # Phase 32.1: the block's reason (managers see it)


```

**Edit 2.** Find:
```python
    dropped_here: Optional[datetime] = None           # Phase 29.4: viewer dropped a position in this event -> asking back needs a reason + approval
    availability: str = "not_set"                     # Phase 31: fits | outside | not_set (the viewer's weekly availability)
    time_off: Optional[str] = None                    # Phase 31: approved | pending time off that day


```
Replace with:
```python
    dropped_here: Optional[datetime] = None           # Phase 29.4: viewer dropped a position in this event -> asking back needs a reason + approval
    availability: str = "not_set"                     # Phase 31: fits | outside | not_set (the viewer's weekly availability)
    time_off: Optional[str] = None                    # Phase 32.1: 'blocked' = overlaps one of the viewer's time-off blocks


```

**Edit 3.** Find:
```python
    drop_reason: Optional[str] = None
    availability: str = "not_set"            # Phase 31: fits | outside | not_set
    time_off: Optional[str] = None           # Phase 31: approved | pending
    missing_certs: List[str] = []            # Phase 32: labels (offers skip them; Assign asks first)
    unverified_certs: List[str] = []         # Phase 32: on file but no manager has checked them
```
Replace with:
```python
    drop_reason: Optional[str] = None
    availability: str = "not_set"            # Phase 31: fits | outside | not_set
    time_off: Optional[str] = None           # Phase 32.1: 'blocked' (can't be assigned / offered)
    time_off_reason: Optional[str] = None    # Phase 32.1: the block's reason
    missing_certs: List[str] = []            # Phase 32: labels (offers skip them; Assign asks first)
    unverified_certs: List[str] = []         # Phase 32: on file but no manager has checked them
```

**Edit 4.** Find:
```python
    certifications: List["CertificationItem"] = []
    availability: List["AvailabilityWindow"] = []                 # Phase 31
    time_off: List["TimeOffItem"] = []                            # upcoming pending / approved


```
Replace with:
```python
    certifications: List["CertificationItem"] = []
    availability: List["AvailabilityWindow"] = []                 # Phase 31
    time_off: List["TimeOffBlockItem"] = []                       # Phase 32.1: upcoming blocks (no private notes)


```

**Edit 5.** Find:
```python
    capacity: int = 0
    filled: int = 0
    time_off: List[str] = []                     # Phase 31: team members with approved time off that day


```
Replace with:
```python
    capacity: int = 0
    filled: int = 0
    time_off: List[str] = []                     # Phase 32.1: team members with time off that day ("Sam Taylor (5:00 PM – 11:00 PM)")


```

**Edit 6.** Find:
```python


class TimeOffCreate(BaseModel):
    start_date: date
    end_date: date
    reason: Optional[str] = Field(None, max_length=500)


class TimeOffItem(BaseModel):
    id: UUID
    worker_id: UUID
    worker_name: Optional[str] = None
    start_date: date
    end_date: date
    reason: Optional[str] = None
    status: str                                      # pending | approved | denied | cancelled
    decision_note: Optional[str] = None
    decided_at: Optional[datetime] = None
    decided_by_name: Optional[str] = None
    decided_venue_name: Optional[str] = None
    created_at: datetime
    conflicts: List[str] = []                        # booked shifts in the range ("Sat Oct 3 · Bartender · Gala")


class TimeOffDecision(BaseModel):
    approve: bool
    note: Optional[str] = Field(None, max_length=500)


```
Replace with:
```python


class TimeOffBlockInput(BaseModel):
    """Phase 32.1: a block of time off the worker sets. No approval."""
    all_day: bool = True
    start_date: date
    end_date: Optional[date] = None              # one-off: last day (default = start_date). Repeating: until (None = no end)
    start_local: Optional[str] = None            # 'HH:MM' when all_day is False
    end_local: Optional[str] = None              # 'HH:MM' or '24:00'; at/before start = runs past midnight
    repeat: str = "none"                         # none | weekly | biweekly
    weekdays: List[int] = []                     # repeating: 0 = Monday ... 6 = Sunday (default: start_date's weekday)
    reason: Optional[str] = Field(None, max_length=200)          # managers see this
    private_note: Optional[str] = Field(None, max_length=500)    # only the worker sees this


class TimeOffBlockItem(BaseModel):
    id: UUID
    worker_id: UUID
    worker_name: Optional[str] = None
    all_day: bool = True
    start_date: date
    end_date: Optional[date] = None
    start_local: Optional[str] = None
    end_local: Optional[str] = None
    repeat: str = "none"
    weekdays: List[int] = []
    reason: Optional[str] = None
    private_note: Optional[str] = None           # only in the worker's own views
    summary: str = ""                            # "Every Tue & Thu, 5:00 PM – 11:00 PM"
    active: bool = True                          # False once it's over
    conflicts: List[str] = []                    # booked shifts inside the block (next 90 days)
    created_at: datetime


```

**Edit 7.** Find:
```python
    discoverable: str = "private"
    availability: List[AvailabilityWindow] = []
    time_off: List[TimeOffItem] = []
    certifications: List[CertificationItem] = []
    cert_types: List[CertTypeInfo] = []
```
Replace with:
```python
    discoverable: str = "private"
    availability: List[AvailabilityWindow] = []
    time_off: List[TimeOffBlockItem] = []        # Phase 32.1
    certifications: List[CertificationItem] = []
    cert_types: List[CertTypeInfo] = []
```

---

# PART B: Backend

## B1. NEW FILE `backend/src/services/time_off.py`
The block rules: which days a block applies to, its hours (including overnight), overlap with a shift, the plain-sentence summary, and validation.

```python
"""
Phase 32.1: Time off is a BLOCK the worker sets, not a request a manager approves.

A block is:
  all_day   True  -> the whole day(s)
            False -> start_local..end_local on each day ('HH:MM'; an end at or before the start runs past midnight;
                     '24:00' = midnight)
  repeat    'none'     -> every day from start_date to end_date (inclusive)
            'weekly'   -> on `weekdays` (0 = Monday ... 6 = Sunday) from start_date, until end_date (None = no end)
            'biweekly' -> same, every other week, counting from the week start_date falls in
  reason    shown to managers ("Class", "Custody weekend")
  private_note  only the worker ever sees it

Times are wall-clock where they work, so a block is judged in the shift's VENUE time zone (like availability).
Nobody approves a block. Managers can't assign or offer shifts that overlap one, and hand-offs to someone
blocked off are refused. The worker can still pick up a shift in their own block (the screens warn first).
"""
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

REPEATS = ("none", "weekly", "biweekly")
WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MAX_ONE_OFF_DAYS = 90
MAX_BLOCKS = 50


@dataclass
class BlockSpec:
    id: object = None
    all_day: bool = True
    start_date: date = None
    end_date: Optional[date] = None
    start_local: Optional[str] = None
    end_local: Optional[str] = None
    repeat: str = "none"
    weekdays: List[int] = field(default_factory=list)
    reason: Optional[str] = None

    @classmethod
    def of(cls, row) -> "BlockSpec":
        return cls(
            id=row.id, all_day=bool(row.all_day), start_date=row.start_date, end_date=row.end_date,
            start_local=row.start_local, end_local=row.end_local, repeat=row.repeat or "none",
            weekdays=sorted(int(d) for d in (row.weekdays or [])), reason=row.reason,
        )


def _hm(value: str) -> Tuple[int, int]:
    h, m = int(value[:2]), int(value[3:5])
    return h, m


def _as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def applies_on(b: BlockSpec, d: date) -> bool:
    """Does an occurrence of the block START on local day d?"""
    if d < b.start_date:
        return False
    if b.end_date is not None and d > b.end_date:
        return False
    if b.repeat == "none":
        return True
    if d.weekday() not in b.weekdays:
        return False
    if b.repeat == "biweekly":
        anchor = b.start_date - timedelta(days=b.start_date.weekday())
        return ((d - anchor).days // 7) % 2 == 0
    return True


def interval_on(b: BlockSpec, d: date, tz: ZoneInfo) -> Tuple[datetime, datetime]:
    if b.all_day:
        return datetime.combine(d, time(0, 0), tzinfo=tz), datetime.combine(d + timedelta(days=1), time(0, 0), tzinfo=tz)
    sh, sm = _hm(b.start_local)
    eh, em = _hm(b.end_local)
    start = datetime.combine(d, time(sh % 24, sm), tzinfo=tz)
    runs_over = (eh, em) == (24, 0) or (eh, em) <= (sh, sm)
    end = datetime.combine(d + timedelta(days=1) if runs_over else d, time(eh % 24, em), tzinfo=tz)
    return start, end


def overlapping_block(blocks: Iterable[BlockSpec], start: datetime, end: datetime, tz: ZoneInfo) -> Optional[BlockSpec]:
    """The first block with an occurrence overlapping [start, end)."""
    s, e = _as_utc(start), _as_utc(end)
    s_loc, e_loc = s.astimezone(tz), e.astimezone(tz)
    days = []
    d = s_loc.date() - timedelta(days=1)            # yesterday's overnight block can reach into today
    while d <= e_loc.date():
        days.append(d)
        d += timedelta(days=1)
    for b in blocks:
        for d in days:
            if applies_on(b, d):
                a, z = interval_on(b, d, tz)
                if a < e and z > s:
                    return b
    return None


def occurs_on_day(b: BlockSpec, d: date) -> bool:
    """For calendars: does this block cover any part of local day d (counting yesterday's overnight part)?"""
    if applies_on(b, d):
        return True
    if not b.all_day and applies_on(b, d - timedelta(days=1)):
        sh, sm = _hm(b.start_local)
        eh, em = _hm(b.end_local)
        return (eh, em) != (24, 0) and (eh, em) < (sh, sm) and (eh, em) != (0, 0)
    return False


def fmt_hm(value: str) -> str:
    h, m = _hm(value)
    if (h, m) in ((24, 0), (0, 0)):
        return "midnight"
    hh = h % 24
    return f"{hh % 12 or 12}:{m:02d} {'AM' if hh < 12 else 'PM'}"


def _day(d: date) -> str:
    return d.strftime("%a %b %-d")


def summary(b: BlockSpec, today: Optional[date] = None) -> str:
    """'Fri Oct 2 – Sun Oct 4, all day' · 'Every Tue & Thu, 5:00 PM – 11:00 PM until Dec 20'"""
    hours = "all day" if b.all_day else f"{fmt_hm(b.start_local)} – {fmt_hm(b.end_local)}"
    if b.repeat == "none":
        if b.end_date is None or b.end_date == b.start_date:
            return f"{_day(b.start_date)}, {hours}"
        return f"{_day(b.start_date)} – {_day(b.end_date)}, {hours}{'' if b.all_day else ' each day'}"
    names = [WEEKDAY_SHORT[d] for d in b.weekdays]
    days = names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" & {names[-1]}"
    if len(names) == 7:
        days = "day"
    text = f"{'Every other' if b.repeat == 'biweekly' else 'Every'} {days}, {hours}"
    today = today or datetime.now(timezone.utc).date()
    if b.start_date > today:
        text += f" from {b.start_date.strftime('%b %-d')}"
    if b.end_date is not None:
        text += f" until {b.end_date.strftime('%b %-d')}"
    return text


def day_label(b: BlockSpec) -> str:
    """Short text for a calendar cell: '' for all day, else '5:00 PM – 11:00 PM'."""
    return "" if b.all_day else f"{fmt_hm(b.start_local)} – {fmt_hm(b.end_local)}"


def is_over(b: BlockSpec, today: date) -> bool:
    return b.end_date is not None and b.end_date < today


def validate(
    *, all_day: bool, start_date: date, end_date: Optional[date], start_local: Optional[str], end_local: Optional[str],
    repeat: str, weekdays: List[int], today: date, is_new: bool,
) -> Tuple[Optional[date], Optional[str], Optional[str], List[int]]:
    """Returns cleaned (end_date, start_local, end_local, weekdays). Raises ValueError with a friendly message."""
    if repeat not in REPEATS:
        raise ValueError("Repeat must be none, weekly or biweekly.")
    if is_new and start_date < today - timedelta(days=1):
        raise ValueError("Time off has to start today or later.")
    if all_day:
        start_local = end_local = None
    else:
        for v in (start_local, end_local):
            if not v or len(v) != 5 or v[2] != ":" or not (v[:2].isdigit() and v[3:].isdigit()):
                raise ValueError("Pick a start and end time.")
            h, m = _hm(v)
            if not (0 <= h <= 24 and 0 <= m <= 59) or (h == 24 and m != 0):
                raise ValueError(f"'{v}' isn't a valid time.")
        if start_local == "24:00":
            raise ValueError("A block can't start at midnight at the end of the day. Use 00:00.")
        if start_local == end_local:
            raise ValueError("Start and end can't be the same. For the whole day, choose All day.")
    if repeat == "none":
        end_date = end_date or start_date
        if end_date < start_date:
            raise ValueError("The last day can't be before the first day.")
        if (end_date - start_date).days + 1 > MAX_ONE_OFF_DAYS:
            raise ValueError(f"Block up to {MAX_ONE_OFF_DAYS} days at a time. For something regular, use Repeats.")
        weekdays = []
    else:
        weekdays = sorted({int(d) for d in (weekdays or [start_date.weekday()])})
        if any(d < 0 or d > 6 for d in weekdays):
            raise ValueError("Weekdays go from 0 (Monday) to 6 (Sunday).")
        if end_date is not None and end_date < start_date:
            raise ValueError("The end date can't be before the start date.")
    return end_date, start_local, end_local, weekdays
```

---

## B2. `backend/src/services/fit.py` (EDITS)
`WorkerFit.time_off` now holds blocks; `off()` returns `'blocked'` and `off_block()` returns the block (for its reason).

**Edit 1.** Find:
```python
                  time zone. A shift fits when it sits entirely inside one window. Windows may run past
                  midnight (end earlier than start, or '24:00'). No windows at all = 'not_set' (never warns).
  time off      - 'approved' | 'pending' | None
                  A request covers whole local days (start_date..end_date inclusive). A shift overlaps when
                  any local day it touches is covered (a shift ending exactly at midnight doesn't touch the next day).
  certificates  - labels of what's missing for a position, e.g. ["Alcohol server card"]
                  A certificate counts when it isn't rejected and hasn't expired by the shift's local date.
```
Replace with:
```python
                  time zone. A shift fits when it sits entirely inside one window. Windows may run past
                  midnight (end earlier than start, or '24:00'). No windows at all = 'not_set' (never warns).
  time off      - 'blocked' | None   (Phase 32.1)
                  The worker's time-off blocks (services/time_off.py): full or partial days, one-off or repeating.
                  A shift is 'blocked' when it overlaps any occurrence. Nobody approves blocks.
  certificates  - labels of what's missing for a position, e.g. ["Alcohol server card"]
                  A certificate counts when it isn't rejected and hasn't expired by the shift's local date.
```

**Edit 2.** Find:
```python
from zoneinfo import ZoneInfo

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import WorkerAvailability, TimeOffRequest, WorkerCertification, VenuePosition

ACTIVE_TIME_OFF = ("pending", "approved")

# The certificate catalogue. Keys are stored in VARCHAR columns (no DB enum).
```
Replace with:
```python
from zoneinfo import ZoneInfo

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import WorkerAvailability, TimeOffBlock, WorkerCertification, VenuePosition
from src.services.time_off import BlockSpec, overlapping_block

# The certificate catalogue. Keys are stored in VARCHAR columns (no DB enum).
```

**Edit 3.** Find:
```python


def time_off_hit(requests: List[Tuple[date, date, str]], start: datetime, end: datetime, tz: ZoneInfo) -> Optional[str]:
    first, last = shift_local_days(start, end, tz)
    hit = None
    for d0, d1, st in requests:
        if d0 <= last and d1 >= first:
            if st == "approved":
                return "approved"
            hit = "pending"
    return hit


def missing_certs(required: Iterable[str], held: Dict[str, Tuple[str, Optional[date]]], on_day: date) -> List[str]:
    """required: cert keys. held: key -> (status, expires_on). Returns labels of what's missing / expired / rejected."""
```
Replace with:
```python


def missing_certs(required: Iterable[str], held: Dict[str, Tuple[str, Optional[date]]], on_day: date) -> List[str]:
    """required: cert keys. held: key -> (status, expires_on). Returns labels of what's missing / expired / rejected."""
```

**Edit 4.** Find:
```python
class WorkerFit:
    windows: List[Tuple[int, str, str]] = field(default_factory=list)
    time_off: List[Tuple[date, date, str]] = field(default_factory=list)
    certs: Dict[str, Tuple[str, Optional[date]]] = field(default_factory=dict)

    def availability(self, start, end, tz) -> str:
        return availability_fit(self.windows, start, end, tz)

    def off(self, start, end, tz) -> Optional[str]:
        return time_off_hit(self.time_off, start, end, tz)

    def missing(self, required, start, end, tz) -> List[str]:
```
Replace with:
```python
class WorkerFit:
    windows: List[Tuple[int, str, str]] = field(default_factory=list)
    time_off: List[BlockSpec] = field(default_factory=list)          # Phase 32.1: time-off blocks
    certs: Dict[str, Tuple[str, Optional[date]]] = field(default_factory=dict)

    def availability(self, start, end, tz) -> str:
        return availability_fit(self.windows, start, end, tz)

    def off_block(self, start, end, tz) -> Optional[BlockSpec]:
        return overlapping_block(self.time_off, start, end, tz)

    def off(self, start, end, tz) -> Optional[str]:
        return "blocked" if self.off_block(start, end, tz) is not None else None

    def missing(self, required, start, end, tz) -> List[str]:
```

**Edit 5.** Find:
```python
    today = datetime.now(timezone.utc).date() - timedelta(days=1)
    for t in (await db.execute(
        select(TimeOffRequest).where(
            TimeOffRequest.worker_id.in_(ids), TimeOffRequest.status.in_(ACTIVE_TIME_OFF), TimeOffRequest.end_date >= today,
        )
    )).scalars().all():
        out[t.worker_id].time_off.append((t.start_date, t.end_date, t.status))
    for c in (await db.execute(select(WorkerCertification).where(WorkerCertification.worker_id.in_(ids)))).scalars().all():
        out[c.worker_id].certs[c.cert_type] = (c.status, c.expires_on)
```
Replace with:
```python
    today = datetime.now(timezone.utc).date() - timedelta(days=1)
    for t in (await db.execute(
        select(TimeOffBlock).where(
            TimeOffBlock.worker_id.in_(ids), or_(TimeOffBlock.end_date.is_(None), TimeOffBlock.end_date >= today),
        )
    )).scalars().all():
        out[t.worker_id].time_off.append(BlockSpec.of(t))
    for c in (await db.execute(select(WorkerCertification).where(WorkerCertification.worker_id.in_(ids)))).scalars().all():
        out[c.worker_id].certs[c.cert_type] = (c.status, c.expires_on)
```

---

## B3. `backend/src/services/profile.py` (FULL FILE REPLACEMENT)
`time_off_items` / `upcoming_time_off` are replaced by `block_items` / `upcoming_blocks` / `block_conflicts` / `conflict_label`. Everything else is unchanged.

```python
"""
Phase 31 + 32: A worker's own profile (photo, contact, emergency contact, positions, bio),
weekly availability, time off and certificates, plus the builders managers' screens reuse.
"""
from collections import defaultdict
from datetime import datetime, date, timezone, timedelta
from typing import Dict, Iterable, List, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    User, Venue, VenueManager, VenueWhitelist, Shift, ShiftEvent, ShiftRequest,
    WorkerAvailability, TimeOffBlock, WorkerCertification, UserFile,
)
from src.schemas import (
    MyProfile, AvailabilityWindow, TimeOffBlockItem, CertificationItem, CertTypeInfo,
)
from src.services.fit import CERT_TYPES, cert_label, tz_of, as_utc
from src.services.time_off import BlockSpec, overlapping_block, summary as block_summary, is_over
from src.services.team import WORKED_STATUSES, EXCLUDED_STATUSES
from src.auth import normalize_role

BOOKED_STATUSES = ("approved", "confirmed", "checked_in")
EXPIRING_DAYS = 30
MAX_AVATAR_BYTES = 2 * 1024 * 1024
MAX_CERT_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")
CERT_FILE_TYPES = IMAGE_TYPES + ("application/pdf",)
MAX_WINDOWS = 21


def full_name(u: Optional[User]) -> str:
    if u is None:
        return ""
    n = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return n or (u.email or "")


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


# ---------------------------------------------------------------------------------------------
# Relationships
# ---------------------------------------------------------------------------------------------
async def team_venue_ids(db: AsyncSession, worker_id) -> set:
    """Venues where this worker is on the team: an active team-list row, or they've worked there
    (and weren't removed / blocked). Their managers see and decide the worker's time off."""
    rows = (await db.execute(
        select(VenueWhitelist.venue_id, VenueWhitelist.is_active, VenueWhitelist.status)
        .where(VenueWhitelist.worker_id == worker_id)
    )).all()
    listed = {v for v, active, st in rows if active and (st or "active") not in EXCLUDED_STATUSES}
    excluded = {v for v, _, st in rows if (st or "") in EXCLUDED_STATUSES}
    worked = set((await db.execute(
        select(Shift.venue_id).join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(ShiftRequest.worker_id == worker_id, func.lower(ShiftRequest.status).in_(WORKED_STATUSES))
        .distinct()
    )).scalars().all())
    return listed | (worked - excluded)


async def related_venue_ids(db: AsyncSession, worker_id) -> set:
    """Any venue the worker has a connection to (team list in any state, or any request there)."""
    wl = set((await db.execute(select(VenueWhitelist.venue_id).where(VenueWhitelist.worker_id == worker_id))).scalars().all())
    req = set((await db.execute(
        select(Shift.venue_id).join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(ShiftRequest.worker_id == worker_id).distinct()
    )).scalars().all())
    return wl | req


async def managed_venue_ids(db: AsyncSession, user: User) -> Optional[set]:
    """None = platform admin (every venue)."""
    if normalize_role(user.role) in ("platform_admin", "super_admin"):
        return None
    return set((await db.execute(select(VenueManager.venue_id).where(VenueManager.user_id == user.id))).scalars().all())


async def may_view_worker(db: AsyncSession, viewer: User, worker_id) -> bool:
    if viewer.id == worker_id:
        return True
    mine = await managed_venue_ids(db, viewer)
    if mine is None:
        return True
    return bool(mine & await related_venue_ids(db, worker_id))


# ---------------------------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------------------------
async def _names(db: AsyncSession, user_ids: Iterable, venue_ids: Iterable):
    uids = {u for u in user_ids if u}
    vids = {v for v in venue_ids if v}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(uids)))).scalars().all()} if uids else {}
    venues = {v.id: v.name for v in (await db.execute(select(Venue).where(Venue.id.in_(vids)))).scalars().all()} if vids else {}
    return users, venues


async def cert_items(db: AsyncSession, certs: List[WorkerCertification]) -> List[CertificationItem]:
    users, venues = await _names(db, [c.verified_by_user_id for c in certs], [c.verified_venue_id for c in certs])
    today = today_utc()
    out = []
    for c in sorted(certs, key=lambda c: list(CERT_TYPES).index(c.cert_type) if c.cert_type in CERT_TYPES else 99):
        expired = c.expires_on is not None and c.expires_on < today
        out.append(CertificationItem(
            id=c.id, cert_type=c.cert_type, label=cert_label(c.cert_type), number=c.number,
            issued_on=c.issued_on, expires_on=c.expires_on, file_id=c.file_id, status=c.status or "unverified",
            verified_at=c.verified_at, verified_by_name=full_name(users.get(c.verified_by_user_id)) or None,
            verified_venue_name=venues.get(c.verified_venue_id), review_note=c.review_note,
            expired=expired,
            expiring_soon=(not expired and c.expires_on is not None and c.expires_on <= today + timedelta(days=EXPIRING_DAYS)),
        ))
    return out


CONFLICT_DAYS = 90


async def block_conflicts(db: AsyncSession, worker_id, specs: List[BlockSpec], venue_id=None):
    """Booked shifts in the next 90 days that overlap any of these blocks -> {block_id: [(ShiftRequest, Shift, Venue)]}.
    Each shift is judged in its venue's time zone. Only this venue's shifts when venue_id is given."""
    out = defaultdict(list)
    if not specs:
        return out
    now = datetime.now(timezone.utc)
    q = (
        select(ShiftRequest, Shift, Venue)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .join(Venue, Venue.id == Shift.venue_id)
        .where(
            ShiftRequest.worker_id == worker_id,
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            Shift.end_time > now,
            Shift.start_time < now + timedelta(days=CONFLICT_DAYS),
        )
        .order_by(Shift.start_time.asc())
    )
    if venue_id is not None:
        q = q.where(Shift.venue_id == venue_id)
    for req, shift, venue in (await db.execute(q)).all():
        tz = tz_of(venue.timezone)
        for b in specs:
            if overlapping_block([b], shift.start_time, shift.end_time, tz) is not None:
                out[b.id].append((req, shift, venue))
    return out


def conflict_label(shift: Shift, venue: Venue, with_venue: bool = True) -> str:
    local = as_utc(shift.start_time).astimezone(tz_of(venue.timezone))
    label = f"{local.strftime('%a %b %-d')} · {shift.role_type} · {shift.title}"
    return f"{label} ({venue.name})" if with_venue else label


async def block_items(
    db: AsyncSession, rows: List[TimeOffBlock], *, owner: bool, venue_id=None, with_conflicts: bool = True,
) -> List[TimeOffBlockItem]:
    """owner=False hides the private note (managers' views). venue_id limits conflicts to that venue."""
    if not rows:
        return []
    users, _ = await _names(db, [r.worker_id for r in rows], [])
    today = today_utc()
    specs = {r.id: BlockSpec.of(r) for r in rows}
    conflicts = defaultdict(list)
    if with_conflicts:
        by_worker = defaultdict(list)
        for r in rows:
            by_worker[r.worker_id].append(specs[r.id])
        for wid, sp in by_worker.items():
            for bid, items in (await block_conflicts(db, wid, sp, venue_id=venue_id)).items():
                conflicts[bid] = [conflict_label(sh, v, with_venue=venue_id is None) for _, sh, v in items]
    return [
        TimeOffBlockItem(
            id=r.id, worker_id=r.worker_id, worker_name=full_name(users.get(r.worker_id)) or None,
            all_day=bool(r.all_day), start_date=r.start_date, end_date=r.end_date,
            start_local=r.start_local, end_local=r.end_local, repeat=r.repeat or "none",
            weekdays=sorted(int(d) for d in (r.weekdays or [])), reason=r.reason,
            private_note=r.private_note if owner else None,
            summary=block_summary(specs[r.id], today), active=not is_over(specs[r.id], today),
            conflicts=conflicts.get(r.id, []), created_at=r.created_at,
        )
        for r in rows
    ]


async def availability_of(db: AsyncSession, worker_id) -> List[AvailabilityWindow]:
    return [
        AvailabilityWindow(weekday=a.weekday, start_local=a.start_local, end_local=a.end_local)
        for a in (await db.execute(
            select(WorkerAvailability).where(WorkerAvailability.worker_id == worker_id)
            .order_by(WorkerAvailability.weekday, WorkerAvailability.start_local)
        )).scalars().all()
    ]


async def upcoming_blocks(db: AsyncSession, worker_id, include_past_days: int = 0) -> List[TimeOffBlock]:
    """Blocks that haven't ended (repeating blocks with no end always count), soonest first."""
    since = today_utc() - timedelta(days=include_past_days)
    return (await db.execute(
        select(TimeOffBlock).where(
            TimeOffBlock.worker_id == worker_id,
            or_(TimeOffBlock.end_date.is_(None), TimeOffBlock.end_date >= since),
        ).order_by(TimeOffBlock.start_date.asc(), TimeOffBlock.created_at.asc())
    )).scalars().all()


def profile_missing(user: User, has_availability: bool) -> List[str]:
    missing = []
    if not (user.phone or "").strip():
        missing.append("phone")
    if not user.avatar_url:
        missing.append("photo")
    if not (user.emergency_contact_name and user.emergency_contact_phone):
        missing.append("emergency_contact")
    if not has_availability:
        missing.append("availability")
    return missing


async def build_my_profile(db: AsyncSession, user: User) -> MyProfile:
    avail = await availability_of(db, user.id)
    time_off = await block_items(db, list(await upcoming_blocks(db, user.id, include_past_days=14)), owner=True)
    certs = await cert_items(db, list((await db.execute(
        select(WorkerCertification).where(WorkerCertification.worker_id == user.id)
    )).scalars().all()))
    is_worker = normalize_role(user.role) == "worker"
    return MyProfile(
        id=user.id, email=user.email, role=normalize_role(user.role),
        first_name=user.first_name or "", last_name=user.last_name or "", phone=user.phone,
        avatar_url=user.avatar_url, bio=user.bio, skills=list(user.skills or []),
        emergency_contact_name=user.emergency_contact_name, emergency_contact_phone=user.emergency_contact_phone,
        discoverable=user.discoverable or "private",
        availability=avail, time_off=time_off, certifications=certs,
        cert_types=[CertTypeInfo(key=k, **v) for k, v in CERT_TYPES.items()],
        missing=profile_missing(user, bool(avail)) if is_worker else [m for m in profile_missing(user, True) if m == "phone"],
    )


# ---------------------------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------------------------
async def read_upload(upload: UploadFile, allowed, max_bytes: int) -> bytes:
    ctype = (upload.content_type or "").lower()
    if ctype not in allowed:
        nice = "a JPG, PNG or WebP image" if "application/pdf" not in allowed else "a JPG, PNG, WebP or PDF file"
        raise HTTPException(status_code=400, detail=f"Please upload {nice}.")
    data = await upload.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status_code=400, detail=f"That file is too big (max {max_bytes // (1024 * 1024)} MB).")
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty.")
    return data


def avatar_url(file_id) -> str:
    return f"/api/files/avatar/{file_id}"
```

---

## B4. `backend/src/routers/profile.py` (FULL FILE REPLACEMENT)
Time off is `POST` / `PUT` / `DELETE /api/me/time-off[/{id}]`. The cancel, venue-list and decide endpoints are gone. The rest is unchanged.

```python
"""
Phase 31 + 32: Profile, availability, time off and certificates.
Phase 32.1: time off is a BLOCK the worker sets (full / partial day, one-off / weekly / every other week).
No approval. Managers can't assign or offer shifts that overlap it.

Worker (signed in, their own data):
  GET    /api/me/profile                              everything on the Profile page
  PUT    /api/me/profile                              name, phone (required for workers), bio, positions, emergency contact
  POST   /api/me/avatar            (multipart file)    upload a profile photo (JPG/PNG/WebP, max 2 MB)
  DELETE /api/me/avatar
  PUT    /api/me/availability                         replace the weekly windows ([] = not set)
  POST   /api/me/time-off                             add a time-off block (returns it with any booked shifts it overlaps)
  PUT    /api/me/time-off/{id}                        change a block
  DELETE /api/me/time-off/{id}                        remove a block
  POST   /api/me/files             (multipart file)    upload a certificate scan (JPG/PNG/WebP/PDF, max 5 MB)
  PUT    /api/me/certifications/{cert_type}           add or update a certificate (changes reset verification)
  DELETE /api/me/certifications/{cert_type}

Files:
  GET    /api/files/avatar/{file_id}                  profile photos (public, like any avatar)
  GET    /api/files/{file_id}                         certificate scans: the owner, managers of venues they're connected to, admins

Managers:
  POST   /api/venues/{venue_id}/people/{worker_id}/certifications/{cert_id}/review   verify / reject
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Response, status
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import (
    User, Venue, WorkerAvailability, TimeOffBlock, WorkerCertification, UserFile,
)
from src.schemas import (
    MyProfile, MyProfileUpdate, AvailabilityUpdate, AvailabilityWindow, TimeOffBlockInput, TimeOffBlockItem,
    CertificationUpsert, CertificationItem, CertReview, FileUploadResult,
)
from src.auth import get_current_user, require_manager_or_admin, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.services.fit import CERT_TYPES, parse_hm, cert_label
from src.services.messaging import normalize_phone
from src.services import time_off as blocks
from src.services.profile import (
    build_my_profile, block_items, cert_items, related_venue_ids,
    may_view_worker, read_upload, avatar_url, today_utc,
    IMAGE_TYPES, CERT_FILE_TYPES, MAX_AVATAR_BYTES, MAX_CERT_BYTES, MAX_WINDOWS,
)
from src.services import notify_events, activity

logger = logging.getLogger("shiftboard.profile")

router = APIRouter(tags=["Profile"])


def _clean(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


# ---------------------------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------------------------
@router.get("/api/me/profile", response_model=MyProfile)
async def get_my_profile(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await build_my_profile(db, current_user)


@router.put("/api/me/profile", response_model=MyProfile)
async def update_my_profile(
    body: MyProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump(exclude_unset=True)
    is_worker = normalize_role(current_user.role) == "worker"
    if "first_name" in data and not _clean(data["first_name"]):
        raise HTTPException(status_code=400, detail="First name can't be empty.")
    if "phone" in data:
        raw = _clean(data["phone"])
        if raw is None:
            if is_worker:
                raise HTTPException(status_code=400, detail="A mobile number is required so venues can reach you and texts can work.")
        elif normalize_phone(raw) is None:
            raise HTTPException(status_code=400, detail="That phone number doesn't look right. Use 10 digits, or +country code.")
    if _clean(data.get("emergency_contact_phone")) and normalize_phone(data["emergency_contact_phone"]) is None:
        raise HTTPException(status_code=400, detail="The emergency contact's phone number doesn't look right.")
    try:
        for key in ("first_name", "last_name", "phone", "bio", "emergency_contact_name", "emergency_contact_phone"):
            if key in data:
                setattr(current_user, key, _clean(data[key]) if key not in ("first_name", "last_name") else (_clean(data[key]) or ""))
        if "skills" in data and data["skills"] is not None:
            seen, skills = set(), []
            for s in data["skills"]:
                s = (s or "").strip()[:50]
                if s and s.lower() not in seen:
                    seen.add(s.lower())
                    skills.append(s)
            current_user.skills = skills[:12]
        await db.commit()
        await db.refresh(current_user)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your profile: {e}")
    return await build_my_profile(db, current_user)


@router.post("/api/me/avatar", response_model=MyProfile)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = await read_upload(file, IMAGE_TYPES, MAX_AVATAR_BYTES)
    try:
        old = (await db.execute(
            select(UserFile.id).where(UserFile.owner_id == current_user.id, UserFile.kind == "avatar")
        )).scalars().all()
        f = UserFile(owner_id=current_user.id, kind="avatar", filename=(file.filename or "photo")[:255],
                     content_type=file.content_type.lower(), size_bytes=len(data), data=data,
                     created_at=datetime.now(timezone.utc))
        db.add(f)
        await db.flush()
        if old:
            await db.execute(delete(UserFile).where(UserFile.id.in_(old)))
        current_user.avatar_url = avatar_url(f.id)
        await db.commit()
        await db.refresh(current_user)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your photo: {e}")
    return await build_my_profile(db, current_user)


@router.delete("/api/me/avatar", response_model=MyProfile)
async def remove_avatar(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(delete(UserFile).where(UserFile.owner_id == current_user.id, UserFile.kind == "avatar"))
        current_user.avatar_url = None
        await db.commit()
        await db.refresh(current_user)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove your photo: {e}")
    return await build_my_profile(db, current_user)


# ---------------------------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------------------------
@router.put("/api/me/availability", response_model=List[AvailabilityWindow])
async def set_availability(
    body: AvailabilityUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if len(body.windows) > MAX_WINDOWS:
        raise HTTPException(status_code=400, detail=f"Up to {MAX_WINDOWS} time ranges, please.")
    clean = []
    for w in body.windows:
        try:
            sh, sm = parse_hm(w.start_local)
            eh, em = parse_hm(w.end_local)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if (sh, sm) == (24, 0):
            raise HTTPException(status_code=400, detail="A range can't start at 24:00.")
        if (sh, sm) == (eh, em):
            raise HTTPException(status_code=400, detail="Start and end can't be the same. For the whole day use 00:00 to 24:00.")
        key = (w.weekday, w.start_local, w.end_local)
        if key not in clean:
            clean.append(key)
    try:
        await db.execute(delete(WorkerAvailability).where(WorkerAvailability.worker_id == current_user.id))
        for d, a, b in clean:
            db.add(WorkerAvailability(worker_id=current_user.id, weekday=d, start_local=a, end_local=b,
                                      created_at=datetime.now(timezone.utc)))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your availability: {e}")
    return [AvailabilityWindow(weekday=d, start_local=a, end_local=b) for d, a, b in sorted(clean)]


# ---------------------------------------------------------------------------------------------
# Time off blocks (Phase 32.1)
# ---------------------------------------------------------------------------------------------
async def _save_block(db: AsyncSession, user: User, body: TimeOffBlockInput, row: Optional[TimeOffBlock]) -> TimeOffBlock:
    try:
        end_date, start_local, end_local, weekdays = blocks.validate(
            all_day=body.all_day, start_date=body.start_date, end_date=body.end_date,
            start_local=body.start_local, end_local=body.end_local, repeat=body.repeat, weekdays=body.weekdays,
            today=today_utc(), is_new=row is None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if row is None:
        count = await db.scalar(select(func.count(TimeOffBlock.id)).where(TimeOffBlock.worker_id == user.id))
        if (count or 0) >= blocks.MAX_BLOCKS:
            raise HTTPException(status_code=400, detail=f"You can have up to {blocks.MAX_BLOCKS} time-off blocks. Remove some old ones first.")
    try:
        now = datetime.now(timezone.utc)
        if row is None:
            row = TimeOffBlock(worker_id=user.id, created_at=now)
            db.add(row)
        row.all_day = bool(body.all_day)
        row.start_date = body.start_date
        row.end_date = end_date
        row.start_local = start_local
        row.end_local = end_local
        row.repeat = body.repeat
        row.weekdays = weekdays
        row.reason = _clean(body.reason)
        row.private_note = _clean(body.private_note)
        row.updated_at = now
        await db.commit()
        await db.refresh(row)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your time off: {e}")
    return row


@router.post("/api/me/time-off", response_model=TimeOffBlockItem, status_code=status.HTTP_201_CREATED)
async def add_time_off(
    body: TimeOffBlockInput,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await _save_block(db, current_user, body, None)
    await notify_events.time_off_conflicts(row.id)          # managers of venues where it overlaps a booked shift
    return (await block_items(db, [row], owner=True))[0]


@router.put("/api/me/time-off/{block_id}", response_model=TimeOffBlockItem)
async def update_time_off(
    block_id: UUID,
    body: TimeOffBlockInput,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.scalar(select(TimeOffBlock).where(TimeOffBlock.id == block_id, TimeOffBlock.worker_id == current_user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="Time off not found.")
    row = await _save_block(db, current_user, body, row)
    await notify_events.time_off_conflicts(row.id)
    return (await block_items(db, [row], owner=True))[0]


@router.delete("/api/me/time-off/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_time_off(
    block_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.scalar(select(TimeOffBlock).where(TimeOffBlock.id == block_id, TimeOffBlock.worker_id == current_user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="Time off not found.")
    try:
        await db.execute(delete(TimeOffBlock).where(TimeOffBlock.id == row.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove it: {e}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------------------------
# Certificates
# ---------------------------------------------------------------------------------------------
@router.post("/api/me/files", response_model=FileUploadResult, status_code=status.HTTP_201_CREATED)
async def upload_cert_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = await read_upload(file, CERT_FILE_TYPES, MAX_CERT_BYTES)
    try:
        f = UserFile(owner_id=current_user.id, kind="certificate", filename=(file.filename or "certificate")[:255],
                     content_type=file.content_type.lower(), size_bytes=len(data), data=data,
                     created_at=datetime.now(timezone.utc))
        db.add(f)
        await db.commit()
        await db.refresh(f)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not upload: {e}")
    return FileUploadResult(id=f.id, url=f"/api/files/{f.id}", content_type=f.content_type, size_bytes=f.size_bytes)


@router.put("/api/me/certifications/{cert_type}", response_model=CertificationItem)
async def upsert_certification(
    cert_type: str,
    body: CertificationUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    info = CERT_TYPES.get(cert_type)
    if info is None:
        raise HTTPException(status_code=400, detail="Unknown certificate type.")
    if info["expires"] and body.expires_on is None:
        raise HTTPException(status_code=400, detail=f"Add the expiry date on your {info['label'].lower()}.")
    if body.issued_on and body.expires_on and body.expires_on < body.issued_on:
        raise HTTPException(status_code=400, detail="The expiry date can't be before the issue date.")
    if body.file_id is not None:
        owned = await db.scalar(select(UserFile.id).where(
            UserFile.id == body.file_id, UserFile.owner_id == current_user.id, UserFile.kind == "certificate"))
        if owned is None:
            raise HTTPException(status_code=400, detail="That upload wasn't found. Try attaching it again.")
    try:
        c = await db.scalar(select(WorkerCertification).where(
            WorkerCertification.worker_id == current_user.id, WorkerCertification.cert_type == cert_type))
        now = datetime.now(timezone.utc)
        if c is None:
            c = WorkerCertification(worker_id=current_user.id, cert_type=cert_type, status="unverified", created_at=now)
            db.add(c)
        old_file = c.file_id
        new_file = None if body.remove_file else (body.file_id or c.file_id)
        changed = (
            c.number != _clean(body.number) or c.issued_on != body.issued_on or c.expires_on != body.expires_on
            or c.file_id != new_file
        )
        c.number = _clean(body.number)
        c.issued_on = body.issued_on if info["expires"] else None
        c.expires_on = body.expires_on if info["expires"] else None
        c.file_id = new_file
        if changed:                                      # a new card has to be checked again
            c.status = "unverified"
            c.verified_by_user_id = None
            c.verified_venue_id = None
            c.verified_at = None
            c.review_note = None
        c.updated_at = now
        await db.flush()
        if old_file and old_file != new_file:
            await db.execute(delete(UserFile).where(UserFile.id == old_file, UserFile.owner_id == current_user.id))
        await db.commit()
        await db.refresh(c)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")
    return (await cert_items(db, [c]))[0]


@router.delete("/api/me/certifications/{cert_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_certification(
    cert_type: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    c = await db.scalar(select(WorkerCertification).where(
        WorkerCertification.worker_id == current_user.id, WorkerCertification.cert_type == cert_type))
    if c is None:
        raise HTTPException(status_code=404, detail="Not found.")
    try:
        file_id = c.file_id
        await db.execute(delete(WorkerCertification).where(WorkerCertification.id == c.id))
        if file_id:
            await db.execute(delete(UserFile).where(UserFile.id == file_id, UserFile.owner_id == current_user.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not delete: {e}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/venues/{venue_id}/people/{worker_id}/certifications/{cert_id}/review", response_model=CertificationItem)
async def review_certification(
    venue_id: UUID,
    worker_id: UUID,
    cert_id: UUID,
    body: CertReview,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    if body.status not in ("verified", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be verified or rejected.")
    if venue_id not in await related_venue_ids(db, worker_id):
        raise HTTPException(status_code=404, detail="Person not found.")
    c = await db.scalar(select(WorkerCertification).where(
        WorkerCertification.id == cert_id, WorkerCertification.worker_id == worker_id))
    if c is None:
        raise HTTPException(status_code=404, detail="Certificate not found.")
    note = _clean(body.note)
    if body.status == "rejected" and not note:
        raise HTTPException(status_code=400, detail="Say what's wrong so they can fix it.")
    try:
        c.status = body.status
        c.verified_by_user_id = current_user.id
        c.verified_venue_id = venue_id
        c.verified_at = datetime.now(timezone.utc)
        c.review_note = note
        await db.commit()
        await db.refresh(c)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")
    await notify_events.cert_reviewed(c.id)
    safe_note = (note or "").replace("{", "{{").replace("}", "}}")
    verb = "Verified" if body.status == "verified" else "Didn't accept"
    await activity.for_worker("cert_verified" if body.status == "verified" else "cert_rejected", venue_id, worker_id,
                              current_user.id, f"{verb} {{name}}'s {cert_label(c.cert_type).lower()}" + (f" · {safe_note}" if note else ""))
    return (await cert_items(db, [c]))[0]


# ---------------------------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------------------------
@router.get("/api/files/avatar/{file_id}")
async def get_avatar(file_id: UUID, db: AsyncSession = Depends(get_db)):
    f = await db.scalar(select(UserFile).where(UserFile.id == file_id, UserFile.kind == "avatar"))
    if f is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return Response(content=f.data, media_type=f.content_type, headers={"Cache-Control": "public, max-age=86400"})


@router.get("/api/files/{file_id}")
async def get_file(file_id: UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    f = await db.scalar(select(UserFile).where(UserFile.id == file_id))
    if f is None or not await may_view_worker(db, current_user, f.owner_id):
        raise HTTPException(status_code=404, detail="Not found.")
    safe = (f.filename or "file").replace('"', "")
    return Response(content=f.data, media_type=f.content_type,
                    headers={"Content-Disposition": f'inline; filename="{safe}"', "Cache-Control": "private, no-store"})
```

---

## B5. `backend/src/services/booking.py` (EDIT)
New `refuse_if_blocked()` (409), used by manager assign and hand-offs.

**Edit 1.** Find:
```python
                                                        "Add it on your Profile page, then try again.")
        raise HTTPException(status_code=400, detail=f"{who or 'They'} can't take this: {shift.role_type}{where} needs {', '.join(missing)}.")


```
Replace with:
```python
                                                        "Add it on your Profile page, then try again.")
        raise HTTPException(status_code=400, detail=f"{who or 'They'} can't take this: {shift.role_type}{where} needs {', '.join(missing)}.")


async def refuse_if_blocked(db: AsyncSession, worker: User, shift: Shift, who: str = "") -> None:
    """Phase 32.1: nobody else can book a worker into their own time-off block (manager assign, hand-offs).
    A waiting request the worker made themselves for this position is their choice, so approving it is allowed."""
    own_request = await db.scalar(
        select(ShiftRequest.id).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == worker.id,
            func.lower(ShiftRequest.status).in_(PENDING_STATUSES),
        )
    )
    if own_request is not None:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    block = (await load_fit(db, [worker.id]))[worker.id].off_block(
        shift.start_time, shift.end_time, tz_of(venue.timezone if venue is not None else None))
    if block is not None:
        why = f" ({block.reason})" if block.reason else ""
        raise HTTPException(status_code=409, detail=f"{who or 'They'} blocked off this time{why}. Ask them to change their time off first.")


```

---

## B6. `backend/src/services/staffing.py` (EDITS)
A blocked candidate is unavailable with the reason, so offers skip them through the existing "not available" rule, and assign is refused.

**Edit 1.** Find:
```python
from src.services.booking import (
    _load_shift_locked, as_utc, PENDING_STATUSES, BOOKED_STATUSES, ACTIVE_STATUSES,
    prior_drop_in_event, REBOOK_REASON_MIN, require_certs,
)
from src.services.team import get_venue_team, is_blocked, EXCLUDED_STATUSES
```
Replace with:
```python
from src.services.booking import (
    _load_shift_locked, as_utc, PENDING_STATUSES, BOOKED_STATUSES, ACTIVE_STATUSES,
    prior_drop_in_event, REBOOK_REASON_MIN, require_certs, refuse_if_blocked,
)
from src.services.team import get_venue_team, is_blocked, EXCLUDED_STATUSES
```

**Edit 2.** Find:
```python
            raise HTTPException(status_code=404, detail="Person not found.")
        name = full_name(worker)
        req = await _book_locked(db, shift, worker, source="manager_assign", approved_by=manager.id, who=name,
                                 rebook_reason=reason)
```
Replace with:
```python
            raise HTTPException(status_code=404, detail="Person not found.")
        name = full_name(worker)
        await refuse_if_blocked(db, worker, shift, who=name)                           # Phase 32.1
        req = await _book_locked(db, shift, worker, source="manager_assign", approved_by=manager.id, who=name,
                                 rebook_reason=reason)
```

**Edit 3.** Find:
```python
            if c.missing_certs:                                                         # Phase 32
                skipped.append(OfferSkip(worker_id=wid, name=name, reason=f"Needs {', '.join(c.missing_certs)} on their profile."))
                continue
            if c.time_off == "approved":                                                # Phase 31
                skipped.append(OfferSkip(worker_id=wid, name=name, reason="Has approved time off that day."))
                continue
            o = ShiftOffer(
```
Replace with:
```python
            if c.missing_certs:                                                         # Phase 32
                skipped.append(OfferSkip(worker_id=wid, name=name, reason=f"Needs {', '.join(c.missing_certs)} on their profile."))
                continue
            o = ShiftOffer(
```

**Edit 4.** Find:
```python
        if reason is None and wid in overlaps:
            reason = f"Booked at that time ({overlaps[wid]})."
        out.append(AssignCandidate(
            worker_id=wid,
```
Replace with:
```python
        if reason is None and wid in overlaps:
            reason = f"Booked at that time ({overlaps[wid]})."
        block = fits[wid].off_block(shift.start_time, shift.end_time, tz)              # Phase 32.1
        if reason is None and block is not None and not requested_this:
            reason = f"Blocked off this time{f' ({block.reason})' if block.reason else ''}."
        out.append(AssignCandidate(
            worker_id=wid,
```

**Edit 5.** Find:
```python
            drop_reason=dropped[wid][1] if wid in dropped else None,
            availability=fits[wid].availability(shift.start_time, shift.end_time, tz),
            time_off=fits[wid].off(shift.start_time, shift.end_time, tz),
            missing_certs=fits[wid].missing(required, shift.start_time, shift.end_time, tz),
            unverified_certs=unverified_certs(required, fits[wid].certs),
```
Replace with:
```python
            drop_reason=dropped[wid][1] if wid in dropped else None,
            availability=fits[wid].availability(shift.start_time, shift.end_time, tz),
            time_off="blocked" if block is not None else None,
            time_off_reason=block.reason if block is not None else None,
            missing_certs=fits[wid].missing(required, shift.start_time, shift.end_time, tz),
            unverified_certs=unverified_certs(required, fits[wid].certs),
```

---

## B7. `backend/src/routers/transfers.py` (EDITS)

**Edit 1.** Find:
```python
from src.services import activity
from src.services.team import get_transfer_candidates
from src.services.booking import require_certs   # Phase 32

router = APIRouter(prefix="/api/transfers", tags=["Shift Transfers"])
```
Replace with:
```python
from src.services import activity
from src.services.team import get_transfer_candidates
from src.services.booking import require_certs, refuse_if_blocked   # Phase 32 / 32.1

router = APIRouter(prefix="/api/transfers", tags=["Shift Transfers"])
```

**Edit 2.** Find:
```python
    # Phase 32: the teammate needs the position's certificates
    await require_certs(db, to_worker, shift, you=False, who=f"{to_worker.first_name or 'They'}".strip())

    # 4. Check if there's already an active transfer for this shift
```
Replace with:
```python
    # Phase 32: the teammate needs the position's certificates
    await require_certs(db, to_worker, shift, you=False, who=f"{to_worker.first_name or 'They'}".strip())
    await refuse_if_blocked(db, to_worker, shift, who=f"{to_worker.first_name or 'They'}".strip())   # Phase 32.1

    # 4. Check if there's already an active transfer for this shift
```

---

## B8. `backend/src/routers/venues.py` (EDIT)
Roster: `time_off = 'blocked'` plus `time_off_reason` for booked people.

**Edit 1.** Find:
```python
                f"{label} not verified" for label in unverified_certs(needed, f.certs)
            ]
            if person.status in ("approved", "confirmed"):
                person.time_off = f.off(s.start_time, s.end_time, vtz)

    # Phase 26.2: has each booked person read the latest info?
```
Replace with:
```python
                f"{label} not verified" for label in unverified_certs(needed, f.certs)
            ]
            if person.status in ("approved", "confirmed"):                          # Phase 32.1
                block = f.off_block(s.start_time, s.end_time, vtz)
                if block is not None:
                    person.time_off = "blocked"
                    person.time_off_reason = block.reason

    # Phase 26.2: has each booked person read the latest info?
```

---

## B9. `backend/src/routers/team.py` (EDIT)
The worker profile lists blocks (`owner=False`, so no private note), with clashes at this venue.

**Edit 1.** Find:
```python
    # people connected to this venue (not a stranger found through search).
    from src.models import WorkerCertification
    from src.services.profile import cert_items, time_off_items, availability_of, upcoming_time_off
    connected = member.status != "none"
    certs = await cert_items(db, list((await db.execute(
        select(WorkerCertification).where(WorkerCertification.worker_id == worker_id)
    )).scalars().all()))
    time_off = [t for t in await time_off_items(db, list(await upcoming_time_off(db, worker_id)), venue_id=venue_id)
                if t.status in ("pending", "approved")]
    return WorkerProfile(
        member=member, history=history, pending_here=pending_here, other_venues=other_venues,
```
Replace with:
```python
    # people connected to this venue (not a stranger found through search).
    from src.models import WorkerCertification
    from src.services.profile import cert_items, block_items, availability_of, upcoming_blocks
    connected = member.status != "none"
    certs = await cert_items(db, list((await db.execute(
        select(WorkerCertification).where(WorkerCertification.worker_id == worker_id)
    )).scalars().all()))
    # Phase 32.1: their time-off blocks (reason only; the private note never leaves the worker's own screens)
    time_off = await block_items(db, list(await upcoming_blocks(db, worker_id)), owner=False, venue_id=venue_id)
    return WorkerProfile(
        member=member, history=history, pending_here=pending_here, other_venues=other_venues,
```

---

## B10. `backend/src/services/tonight.py` (EDITS)
This week: "Name" for all-day blocks, "Name (5:00 PM – 9:00 PM)" for partial ones.

**Edit 1.** Find:
```python
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, ShiftOffer, TimeEntry, User, Venue, TimeOffRequest
from src.services.team import get_venue_team
from src.schemas import (
```
Replace with:
```python
"""
from collections import defaultdict
from datetime import date, datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, ShiftOffer, TimeEntry, User, Venue, TimeOffBlock
from src.services.time_off import BlockSpec, occurs_on_day, day_label
from src.services.team import get_venue_team
from src.schemas import (
```

**Edit 2.** Find:
```python
        we.start_time = min(we.start_time, start)
        we.end_time = max(we.end_time, as_utc(s.end_time))
    # Phase 31: who on the team has approved time off each day
    team = {u.id: u for u in await get_venue_team(db, venue.id)}
    if team:
        last_day = today_local + timedelta(days=WEEK_DAYS - 1)
        for t in (await db.execute(
            select(TimeOffRequest).where(
                TimeOffRequest.worker_id.in_(list(team)), TimeOffRequest.status == "approved",
                TimeOffRequest.start_date <= last_day, TimeOffRequest.end_date >= today_local,
            )
        )).scalars().all():
            for d in days:
                if t.start_date.isoformat() <= d.date <= t.end_date.isoformat():
                    d.time_off.append(_name(team[t.worker_id]))
    for d in days:
        d.time_off.sort()
```
Replace with:
```python
        we.start_time = min(we.start_time, start)
        we.end_time = max(we.end_time, as_utc(s.end_time))
    # Phase 32.1: who on the team has time off each day ("Sam Taylor" all day, "Sam Taylor (5:00 PM – 11:00 PM)" partial)
    team = {u.id: u for u in await get_venue_team(db, venue.id)}
    if team:
        last_day = today_local + timedelta(days=WEEK_DAYS - 1)
        for t in (await db.execute(
            select(TimeOffBlock).where(
                TimeOffBlock.worker_id.in_(list(team)), TimeOffBlock.start_date <= last_day,
                or_(TimeOffBlock.end_date.is_(None), TimeOffBlock.end_date >= today_local - timedelta(days=1)),
            )
        )).scalars().all():
            spec = BlockSpec.of(t)
            for d in days:
                if occurs_on_day(spec, date.fromisoformat(d.date)):
                    label = day_label(spec)
                    name = _name(team[t.worker_id])
                    entry = f"{name} ({label})" if label else name
                    if entry not in d.time_off:
                        d.time_off.append(entry)
    for d in days:
        d.time_off.sort()
```

---

## B11. `backend/src/services/notify_events.py` (EDIT)
`time_off_requested` / `time_off_decided` → `time_off_conflicts(block_id)`.

**Edit 1.** Find:
```python

# ---------------------------------------------------------------------------------------------
# Phase 31: time off   /   Phase 32: certificates
# ---------------------------------------------------------------------------------------------
def _days_text(t) -> str:
    a = t.start_date.strftime("%a %b %-d")
    return a if t.end_date == t.start_date else f"{a} – {t.end_date.strftime('%a %b %-d')}"


async def _time_off_requested(db: AsyncSession, time_off_id) -> None:
    from src.models import TimeOffRequest
    from src.services.profile import team_venue_ids, time_off_items
    t = await db.scalar(select(TimeOffRequest).where(TimeOffRequest.id == time_off_id))
    if t is None:
        return
    worker = await db.scalar(select(User).where(User.id == t.worker_id))
    for venue_id in sorted(await team_venue_ids(db, t.worker_id), key=str):
        item = (await time_off_items(db, [t], venue_id=venue_id))[0]
        body = f"{_days_text(t)}." + (f" “{t.reason}”" if t.reason else "")
        if item.conflicts:
            body += f"\nBooked here then: {'; '.join(item.conflicts[:3])}"
        await notify_in(
            db, await manager_ids(db, venue_id), "time_off_request",
            f"{person(worker)} asked for time off", body,
            manager_link(venue_id), venue_id=venue_id, dedupe_key=f"timeoff:{t.id}",
        )


async def time_off_requested(time_off_id) -> None:
    await _run("time_off_requested", _time_off_requested, time_off_id)


async def _time_off_decided(db: AsyncSession, time_off_id) -> None:
    from src.models import TimeOffRequest
    t = await db.scalar(select(TimeOffRequest).where(TimeOffRequest.id == time_off_id))
    if t is None or t.status not in ("approved", "denied"):
        return
    venue = await db.scalar(select(Venue).where(Venue.id == t.decided_venue_id)) if t.decided_venue_id else None
    approved = t.status == "approved"
    body = f"{_days_text(t)}" + (f" · {venue.name}" if venue else "") + "."
    if t.decision_note:
        body += f"\n“{t.decision_note}”"
    await notify_in(
        db, [t.worker_id], "time_off_decided",
        "Time off approved" if approved else "Time off not approved", body,
        "/profile?tab=time-off", venue_id=t.decided_venue_id, dedupe_key=f"timeoff-d:{t.id}",
    )


async def time_off_decided(time_off_id) -> None:
    await _run("time_off_decided", _time_off_decided, time_off_id)


```
Replace with:
```python

# ---------------------------------------------------------------------------------------------
# Phase 32.1: time-off blocks   /   Phase 32: certificates
# ---------------------------------------------------------------------------------------------
def _days_text(t) -> str:
    a = t.start_date.strftime("%a %b %-d")
    return a if t.end_date == t.start_date else f"{a} – {t.end_date.strftime('%a %b %-d')}"


async def _time_off_conflicts(db: AsyncSession, block_id) -> None:
    """Phase 32.1: a worker blocked off time that overlaps shifts they're booked on.
    Tells each venue's managers (once per block version per shift) and logs it; the booking itself is untouched."""
    from src.models import TimeOffBlock
    from src.services.time_off import BlockSpec, summary
    from src.services.profile import block_conflicts, conflict_label
    from src.services.activity import record_in
    b = await db.scalar(select(TimeOffBlock).where(TimeOffBlock.id == block_id))
    if b is None:
        return
    spec = BlockSpec.of(b)
    worker = await db.scalar(select(User).where(User.id == b.worker_id))
    stamp = int(_as_utc(b.updated_at).timestamp() * 1000) if b.updated_at else 0
    for req, shift, venue in (await block_conflicts(db, b.worker_id, [spec])).get(b.id, []):
        what = conflict_label(shift, venue, with_venue=False)
        why = f" · “{b.reason}”" if b.reason else ""
        sent = await notify_in(
            db, await manager_ids(db, venue.id), "time_off_conflict",
            f"{person(worker)} blocked off time they're booked for",
            f"{what}\nTheir time off: {summary(spec)}{why}\nThey're still booked. Talk to them, or find cover.",
            manager_link(venue.id, shift.event_id), venue_id=venue.id, event_id=shift.event_id, request_id=req.id,
            dedupe_key=f"tob:{b.id}:{shift.id}:{stamp}",
        )
        if sent:
            await record_in(db, venue.id, "time_off_conflict",
                            f"{person(worker)} blocked off time during their shift: {what}{why}",
                            event_id=shift.event_id, request_id=req.id, worker_id=b.worker_id)


async def time_off_conflicts(block_id) -> None:
    await _run("time_off_conflicts", _time_off_conflicts, block_id)


```

---

## B12. `backend/src/services/notify.py` (EDIT)

**Edit 1.** Find:
```python
    "no_show": ("booking", True),            # Phase 30: a manager marked you a no-show
    "unfilled_soon": ("manager", True),      # Phase 30: spots still open 3 h before start
    "time_off_request": ("manager", False),  # Phase 31: a team member asked for time off
    "time_off_decided": ("booking", False),  # Phase 31: your time off was approved / declined
    "cert_review": ("booking", False),       # Phase 32: a manager verified / didn't accept a certificate
    "cert_expiring": ("reminder", False),    # Phase 32: a certificate expires in 30 / 7 days, or today
```
Replace with:
```python
    "no_show": ("booking", True),            # Phase 30: a manager marked you a no-show
    "unfilled_soon": ("manager", True),      # Phase 30: spots still open 3 h before start
    "time_off_conflict": ("manager", True),  # Phase 32.1: a worker blocked off time they're booked for
    "cert_review": ("booking", False),       # Phase 32: a manager verified / didn't accept a certificate
    "cert_expiring": ("reminder", False),    # Phase 32: a certificate expires in 30 / 7 days, or today
```

---

## B13. `backend/src/services/activity.py` (EDITS)
Only `time_off_conflict` (Alerts) remains; `for_time_off` is removed.

**Edit 1.** Find:
```python

from src.database import AsyncSessionLocal
from src.models import VenueActivity, Shift, ShiftEvent, ShiftRequest, User, Venue, TimeOffRequest

logger = logging.getLogger("shiftboard.activity")
```
Replace with:
```python

from src.database import AsyncSessionLocal
from src.models import VenueActivity, Shift, ShiftEvent, ShiftRequest, User, Venue

logger = logging.getLogger("shiftboard.activity")
```

**Edit 2.** Find:
```python
    "manager_clock_in": "alerts",
    "unfilled_soon": "alerts",
    "time_off_requested": "team",       # Phase 31
    "time_off_approved": "team",
    "time_off_denied": "team",
    "time_off_cancelled": "team",
    "cert_verified": "team",            # Phase 32
    "cert_rejected": "team",
```
Replace with:
```python
    "manager_clock_in": "alerts",
    "unfilled_soon": "alerts",
    "time_off_conflict": "alerts",      # Phase 32.1: a worker blocked off time they're booked for
    "cert_verified": "team",            # Phase 32
    "cert_rejected": "team",
```

**Edit 3.** Find:
```python
async def for_venue(kind: str, venue_id, actor_id=None, text: str = "") -> None:
    await _run(kind, _for_venue, kind, venue_id, actor_id, text)


# ---------------------------------------------------------------------------------------------
# Phase 31: time off (logged at every team venue, or the deciding venue for decisions)
# ---------------------------------------------------------------------------------------------
def _range_text(t: TimeOffRequest) -> str:
    a = t.start_date.strftime("%a %b %-d")
    return a if t.end_date == t.start_date else f"{a} – {t.end_date.strftime('%a %b %-d')}"


async def _for_time_off(db: AsyncSession, kind: str, time_off_id, actor_id, venue_id) -> None:
    from src.services.profile import team_venue_ids      # local import: profile imports this module's siblings
    t = await db.scalar(select(TimeOffRequest).where(TimeOffRequest.id == time_off_id))
    if t is None:
        return
    worker = await db.scalar(select(User).where(User.id == t.worker_id))
    name = person(worker)
    when = _range_text(t)
    text = {
        "time_off_requested": f"{name} asked for time off: {when}",
        "time_off_approved": f"Approved {name}'s time off: {when}",
        "time_off_denied": f"Declined {name}'s time off: {when}",
        "time_off_cancelled": f"{name} cancelled their time off: {when}",
    }.get(kind, f"{name}: {when}")
    if kind == "time_off_requested" and t.reason:
        text += f" · {t.reason}"
    if kind in ("time_off_approved", "time_off_denied") and t.decision_note:
        text += f" · {t.decision_note}"
    venues = [venue_id] if venue_id else sorted(await team_venue_ids(db, t.worker_id), key=str)
    for v in venues:
        await record_in(db, v, kind, text, actor_id=actor_id, worker_id=t.worker_id)


async def for_time_off(kind: str, time_off_id, actor_id=None, venue_id=None) -> None:
    await _run(kind, _for_time_off, kind, time_off_id, actor_id, venue_id)
```
Replace with:
```python
async def for_venue(kind: str, venue_id, actor_id=None, text: str = "") -> None:
    await _run(kind, _for_venue, kind, venue_id, actor_id, text)
```

---

# PART C: Frontend, worker

## C1. `frontend/src/components/profile/TimeOffPanel.jsx` (FULL FILE REPLACEMENT)
The block list and the add / edit form. Same props as before.

```jsx
import React, { useState } from 'react';
import { CalendarOff, Plus, Pencil, Trash2, Lock, Eye, AlertTriangle, Repeat, Save, Info } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import { WEEKDAYS, fmtHm, todayIso } from '../../utils/availability';

const inputCls = 'mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const selCls = 'mt-1 px-2 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const END_TIMES = [...HALF_HOURS.slice(1), '24:00'];
const REPEATS = [
  { id: 'none', label: "Doesn't repeat" },
  { id: 'weekly', label: 'Every week' },
  { id: 'biweekly', label: 'Every other week' },
];

function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;   // 0 = Monday
}

function emptyForm() {
  const today = todayIso();
  return {
    all_day: true, start_date: today, end_date: today, start_local: '17:00', end_local: '24:00',
    repeat: 'none', weekdays: [weekdayOf(today)], has_until: false, until: '', reason: '', private_note: '',
  };
}

function toForm(b) {
  return {
    all_day: b.all_day,
    start_date: b.start_date,
    end_date: b.repeat === 'none' ? (b.end_date || b.start_date) : b.start_date,
    start_local: b.start_local || '17:00',
    end_local: b.end_local || '24:00',
    repeat: b.repeat,
    weekdays: b.weekdays?.length ? b.weekdays : [weekdayOf(b.start_date)],
    has_until: b.repeat !== 'none' && !!b.end_date,
    until: b.repeat !== 'none' ? (b.end_date || '') : '',
    reason: b.reason || '',
    private_note: b.private_note || '',
  };
}

/**
 * Phase 32.1: Time off is a block you set. Nobody approves it.
 * Full or part of a day, one-off or repeating (every week / every other week), with a reason managers see
 * and a private note only you see. Managers can't assign or offer you shifts inside a block.
 * Shifts you're already booked on stay booked and are listed so you can drop or hand them off.
 * Props: items (TimeOffBlockItem[]), onChanged(message), onError(message)
 */
export default function TimeOffPanel({ items = [], onChanged, onError }) {
  const [editing, setEditing] = useState(null);   // null | 'new' | block id
  const [confirm, setConfirm] = useState(null);
  const active = items.filter((b) => b.active);
  const ended = items.filter((b) => !b.active);

  const askDelete = (b) => setConfirm({
    title: 'Remove this time off?',
    message: `${b.summary}. Managers will be able to book you then again.`,
    confirmLabel: 'Remove',
    danger: true,
    onConfirm: async () => {
      await api.delete(`/me/time-off/${b.id}`);
      onChanged('Time off removed.');
    },
  });

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex gap-2">
        <Info className="w-4 h-4 flex-shrink-0 text-slate-500" />
        <span>
          Block off time you can't work. <b className="text-slate-200">Nobody has to approve it</b>: managers can't assign
          or offer you shifts inside it, and they see your reason but never your private note. You can still pick up a
          shift in your own time off if your plans change. Shifts you're already booked on stay booked, so they're listed
          here for you to drop or hand off.
        </span>
      </p>

      {editing === 'new' ? (
        <BlockForm onCancel={() => setEditing(null)} onError={onError}
          onSaved={(saved) => { setEditing(null); onChanged(savedMessage(saved)); }} />
      ) : (
        <button type="button" onClick={() => setEditing('new')}
          className="w-full p-3 rounded-2xl border border-dashed border-slate-600 text-sm font-bold text-emerald-300 hover:bg-slate-900 inline-flex items-center justify-center gap-1.5">
          <Plus className="w-4 h-4" /> Add time off
        </button>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-white">Your time off</h3>
        {active.length === 0 && <p className="text-xs text-slate-500">Nothing blocked off.</p>}
        {active.map((b) => (editing === b.id ? (
          <BlockForm key={b.id} block={b} onCancel={() => setEditing(null)} onError={onError}
            onSaved={(saved) => { setEditing(null); onChanged(savedMessage(saved)); }} />
        ) : (
          <BlockRow key={b.id} b={b} onEdit={() => setEditing(b.id)} onDelete={() => askDelete(b)} />
        )))}
      </section>

      {ended.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-slate-400">Ended</h3>
          {ended.map((b) => <BlockRow key={b.id} b={b} onDelete={() => askDelete(b)} />)}
        </section>
      )}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function savedMessage(saved) {
  return saved.conflicts?.length
    ? `Saved. You're still booked on ${saved.conflicts.length} shift${saved.conflicts.length === 1 ? '' : 's'} in that time. Those managers have been told; drop or hand them off if you can't work them.`
    : 'Saved. Managers can’t book you in that time.';
}

function BlockRow({ b, onEdit, onDelete }) {
  return (
    <div className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-start gap-2 ${b.active ? 'bg-slate-900 border-slate-800' : 'bg-slate-950 border-slate-900 opacity-70'}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-semibold text-white flex items-center gap-1.5">
          {b.repeat !== 'none' ? <Repeat className="w-3.5 h-3.5 text-indigo-300" /> : <CalendarOff className="w-3.5 h-3.5 text-amber-300" />}
          {b.summary}
        </p>
        {b.reason && (
          <p className="text-[11px] text-slate-300 inline-flex items-center gap-1 mr-3">
            <Eye className="w-3 h-3 text-slate-500" /> Managers see: {b.reason}
          </p>
        )}
        {b.private_note && (
          <p className="text-[11px] text-slate-400 inline-flex items-center gap-1">
            <Lock className="w-3 h-3 text-slate-500" /> Only you: {b.private_note}
          </p>
        )}
        {b.conflicts?.length > 0 && (
          <p className="text-[11px] text-amber-300 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Still booked: {b.conflicts.join('; ')}. Drop or hand these off from My shifts if you can't work them.</span>
          </p>
        )}
      </div>
      <div className="flex gap-2 self-start">
        {onEdit && (
          <button type="button" onClick={onEdit}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        )}
        <button type="button" onClick={onDelete} aria-label="Remove"
          className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300 hover:border-rose-500/40">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function BlockForm({ block = null, onCancel, onSaved, onError }) {
  const [f, setF] = useState(() => (block ? toForm(block) : emptyForm()));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const repeating = f.repeat !== 'none';
  const overnight = !f.all_day && f.end_local !== '24:00' && f.end_local <= f.start_local;

  const setStart = (v) => setF((p) => ({
    ...p,
    start_date: v,
    end_date: p.end_date < v ? v : p.end_date,
    weekdays: p.repeat === 'none' || !p.weekdays.length ? [weekdayOf(v)] : p.weekdays,
  }));
  const toggleDay = (d) => setF((p) => {
    const has = p.weekdays.includes(d);
    const next = has ? p.weekdays.filter((x) => x !== d) : [...p.weekdays, d];
    return { ...p, weekdays: next.length ? next.sort() : p.weekdays };
  });

  const save = async () => {
    setBusy(true);
    const body = {
      all_day: f.all_day,
      start_date: f.start_date,
      end_date: repeating ? (f.has_until && f.until ? f.until : null) : f.end_date,
      start_local: f.all_day ? null : f.start_local,
      end_local: f.all_day ? null : f.end_local,
      repeat: f.repeat,
      weekdays: repeating ? f.weekdays : [],
      reason: f.reason.trim() || null,
      private_note: f.private_note.trim() || null,
    };
    try {
      const res = block ? await api.put(`/me/time-off/${block.id}`, body) : await api.post('/me/time-off', body);
      onSaved(res.data);
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save your time off.');
    } finally {
      setBusy(false);
    }
  };

  const seg = (on) => `px-3 py-1.5 rounded-lg text-xs font-bold transition ${on ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`;

  return (
    <section className="p-4 rounded-2xl bg-slate-900 border border-emerald-500/30 space-y-4">
      <p className="text-sm font-semibold text-white inline-flex items-center gap-1.5">
        <CalendarOff className="w-4 h-4 text-amber-300" /> {block ? 'Edit time off' : 'Add time off'}
      </p>

      <div className="flex flex-wrap gap-3">
        <div className="p-1 bg-slate-950 border border-slate-800 rounded-xl flex gap-1" role="radiogroup" aria-label="How long">
          <button type="button" role="radio" aria-checked={f.all_day} onClick={() => set('all_day', true)} className={seg(f.all_day)}>All day</button>
          <button type="button" role="radio" aria-checked={!f.all_day} onClick={() => set('all_day', false)} className={seg(!f.all_day)}>Part of the day</button>
        </div>
        <div className="p-1 bg-slate-950 border border-slate-800 rounded-xl flex flex-wrap gap-1" role="radiogroup" aria-label="Repeats">
          {REPEATS.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={f.repeat === r.id}
              onClick={() => setF((p) => ({ ...p, repeat: r.id, weekdays: p.weekdays.length ? p.weekdays : [weekdayOf(p.start_date)] }))}
              className={seg(f.repeat === r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs font-semibold text-slate-300">{repeating ? 'Starting' : 'First day'}
          <input type="date" value={f.start_date} min={block ? undefined : todayIso()} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        </label>
        {!repeating ? (
          <label className="block text-xs font-semibold text-slate-300">Last day
            <input type="date" value={f.end_date} min={f.start_date} onChange={(e) => set('end_date', e.target.value)} className={inputCls} />
          </label>
        ) : (
          <div className="text-xs font-semibold text-slate-300">
            Ends
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-slate-300 font-normal">
                <input type="radio" checked={!f.has_until} onChange={() => set('has_until', false)} className="text-emerald-500" /> Never
              </label>
              <label className="inline-flex items-center gap-1.5 text-slate-300 font-normal">
                <input type="radio" checked={f.has_until} onChange={() => set('has_until', true)} className="text-emerald-500" /> On
              </label>
              <input type="date" value={f.until} min={f.start_date} disabled={!f.has_until}
                onChange={(e) => { set('until', e.target.value); set('has_until', true); }}
                className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white disabled:opacity-40" />
            </div>
          </div>
        )}
      </div>

      {repeating && (
        <div>
          <p className="text-xs font-semibold text-slate-300">On</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((name, d) => {
              const on = f.weekdays.includes(d);
              return (
                <button key={name} type="button" aria-pressed={on} onClick={() => toggleDay(d)}
                  className={`w-12 py-1.5 rounded-lg text-xs font-bold border transition ${on ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40' : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-white'}`}>
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!f.all_day && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs font-semibold text-slate-300">From
            <select value={f.start_local} onChange={(e) => set('start_local', e.target.value)} className={`${selCls} block`}>
              {HALF_HOURS.map((t) => <option key={t} value={t}>{fmtHm(t)}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-300">Until
            <select value={f.end_local} onChange={(e) => set('end_local', e.target.value)} className={`${selCls} block`}>
              {END_TIMES.map((t) => <option key={t} value={t}>{t === '24:00' ? 'Midnight' : fmtHm(t)}</option>)}
            </select>
          </label>
          {overnight && <span className="text-[11px] text-indigo-300 pb-2.5">runs into the next day</span>}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs font-semibold text-slate-300">
          <span className="inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Reason managers see (optional)</span>
          <input value={f.reason} onChange={(e) => set('reason', e.target.value.slice(0, 200))} placeholder="e.g. Class, Other job, Family" className={inputCls} />
        </label>
        <label className="block text-xs font-semibold text-slate-300">
          <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Private note, only you see it (optional)</span>
          <input value={f.private_note} onChange={(e) => set('private_note', e.target.value.slice(0, 500))} placeholder="e.g. Dentist at 3, pick up Maya" className={inputCls} />
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700">Cancel</button>
        <button type="button" onClick={save} disabled={busy || (repeating && !f.weekdays.length)}
          className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save time off'}
        </button>
      </div>
    </section>
  );
}
```

---

## C2. `frontend/src/pages/ProfilePage.jsx` (EDIT)
Removes the "pending" badge.

**Edit 1.** Find:
```jsx
    { id: 'about', label: 'About me', icon: UserRound },
    isWorker && { id: 'availability', label: 'Availability', icon: CalendarDays },
    isWorker && { id: 'time-off', label: 'Time off', icon: CalendarOff, badge: (profile?.time_off || []).filter((t) => t.status === 'pending').length },
    isWorker && { id: 'certificates', label: 'Certificates', icon: Award, badge: (profile?.certifications || []).filter((c) => c.expired || c.status === 'rejected').length },
    { id: 'notifications', label: 'Notifications', icon: Bell },
```
Replace with:
```jsx
    { id: 'about', label: 'About me', icon: UserRound },
    isWorker && { id: 'availability', label: 'Availability', icon: CalendarDays },
    isWorker && { id: 'time-off', label: 'Time off', icon: CalendarOff },   // Phase 32.1: blocks, nothing to wait for
    isWorker && { id: 'certificates', label: 'Certificates', icon: Award, badge: (profile?.certifications || []).filter((c) => c.expired || c.status === 'rejected').length },
    { id: 'notifications', label: 'Notifications', icon: Bell },
```

---

## C3. `frontend/src/components/EventListingCard.jsx` (EDIT)

**Edit 1.** Find:
```jsx
      </div>

      {/* Phase 31: the viewer's own availability / time off */}
      {listing.time_off && (
        <p className={`mt-2 text-[11px] flex items-center gap-1 ${listing.time_off === 'approved' ? 'text-rose-300' : 'text-amber-300'}`}>
          <CalendarOff className="w-3.5 h-3.5 flex-shrink-0" />
          {listing.time_off === 'approved' ? 'You have time off that day' : 'You asked for time off that day'}
        </p>
      )}
```
Replace with:
```jsx
      </div>

      {/* Phase 31 / 32.1: the viewer's own availability / time-off blocks */}
      {listing.time_off && (
        <p className="mt-2 text-[11px] flex items-center gap-1 text-amber-300">
          <CalendarOff className="w-3.5 h-3.5 flex-shrink-0" /> During your time off
        </p>
      )}
```

---

## C4. `frontend/src/components/EventListingModal.jsx` (EDIT)

**Edit 1.** Find:
```jsx

      {listing.time_off && !isBooked && (
        <div className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2 ${
          listing.time_off === 'approved' ? 'border-rose-700/60 bg-rose-950/40 text-rose-200' : 'border-amber-700/60 bg-amber-950/40 text-amber-200'}`}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            {listing.time_off === 'approved'
              ? 'You have approved time off that day. Request it only if your plans changed.'
              : 'You asked for time off that day. Request it only if your plans changed.'}
          </span>
        </div>
```
Replace with:
```jsx

      {listing.time_off && !isBooked && (
        <div className="mb-4 p-3 rounded-xl border text-xs flex items-start gap-2 border-amber-700/60 bg-amber-950/40 text-amber-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            This is during time you blocked off. You can still request it if your plans changed; managers can’t book you
            into it themselves.{' '}
            <Link to="/profile?tab=time-off" onClick={onClose} className="font-bold underline hover:text-amber-100">Your time off</Link>
          </span>
        </div>
```

---

## C5. `frontend/src/pages/WorkerDashboard.jsx` (EDIT)

**Edit 1.** Find:
```jsx
      if (instantOnly && !l.any_instant) return false;
      if (hideRequested && l.my_request) return false;
      if (fitsOnly && (l.availability === 'outside' || l.time_off === 'approved')) return false;   // Phase 31
      return true;
    });
```
Replace with:
```jsx
      if (instantOnly && !l.any_instant) return false;
      if (hideRequested && l.my_request) return false;
      if (fitsOnly && (l.availability === 'outside' || l.time_off === 'blocked')) return false;   // Phase 31 / 32.1
      return true;
    });
```

---

# PART D: Frontend, manager

## D1. `frontend/src/components/StaffPositionModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx

  const selectable = (c) => (c.available || c.requested_this) && !c.offered && !(c.dropped_at && !c.requested_this)   // Phase 29.4
    && !(c.missing_certs || []).length && c.time_off !== 'approved';                                               // Phase 31 + 32
  const toggle = (c) => {
    if (!selectable(c)) return;
```
Replace with:
```jsx

  const selectable = (c) => (c.available || c.requested_this) && !c.offered && !(c.dropped_at && !c.requested_this)   // Phase 29.4
    && !(c.missing_certs || []).length && c.time_off !== 'blocked';                                                // Phase 32 / 32.1
  const toggle = (c) => {
    if (!selectable(c)) return;
```

**Edit 2.** Find:
```jsx
  const out = [];
  if ((c.missing_certs || []).length) out.push(`Missing ${c.missing_certs.join(', ')}`);
  if (c.time_off === 'approved') out.push('Has approved time off that day');
  if (c.time_off === 'pending') out.push('Asked for time off that day');
  if (c.availability === 'outside') out.push('Outside their availability');
  return out;
```
Replace with:
```jsx
  const out = [];
  if ((c.missing_certs || []).length) out.push(`Missing ${c.missing_certs.join(', ')}`);
  if (c.availability === 'outside') out.push('Outside their availability');
  return out;
```

**Edit 3.** Find:
```jsx
    <span key={`u-${m}`} className={`${chip} bg-sky-500/10 text-sky-300 border-sky-500/30`}><BadgeCheck className="w-3 h-3" /> {m} not verified</span>,
  ));
  if (c.time_off) items.push(
    <span key="off" className={`${chip} ${c.time_off === 'approved' ? 'bg-rose-500/10 text-rose-300 border-rose-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
      <CalendarOff className="w-3 h-3" /> {c.time_off === 'approved' ? 'Time off' : 'Asked for time off'}
    </span>,
  );
```
Replace with:
```jsx
    <span key={`u-${m}`} className={`${chip} bg-sky-500/10 text-sky-300 border-sky-500/30`}><BadgeCheck className="w-3 h-3" /> {m} not verified</span>,
  ));
  if (c.time_off === 'blocked') items.push(   // Phase 32.1: their time-off block (can't be assigned or offered)
    <span key="off" className={`${chip} bg-rose-500/10 text-rose-300 border-rose-500/30`}>
      <CalendarOff className="w-3 h-3" /> Time off{c.time_off_reason ? `: ${c.time_off_reason}` : ''}
    </span>,
  );
```

---

## D2. `frontend/src/components/EventRosterModal.jsx` (EDIT)

**Edit 1.** Find:
```jsx
                              ))}
                              {p.time_off && (
                                <div className={`text-[10px] inline-flex items-center gap-1 ${p.time_off === 'approved' ? 'text-rose-300' : 'text-amber-300'}`}>
                                  <AlertTriangle className="w-3 h-3" /> {p.time_off === 'approved' ? 'Has approved time off that day' : 'Asked for time off that day'}
                                </div>
                              )}
```
Replace with:
```jsx
                              ))}
                              {p.time_off && (
                                <div className="text-[10px] inline-flex items-center gap-1 text-rose-300">
                                  <AlertTriangle className="w-3 h-3" /> Has time off during this shift{p.time_off_reason ? ` · “${p.time_off_reason}”` : ''}
                                </div>
                              )}
```

---

## D3. `frontend/src/components/WorkerProfilePanel.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import ModalShell from './ModalShell';
import ConfirmDialog from './ConfirmDialog';
import { availabilitySummary, fmtDay, fmtDayRange } from '../utils/availability';
import { openProtectedFile } from '../utils/files';
import RatingBadge from './RatingBadge';
```
Replace with:
```jsx
import ModalShell from './ModalShell';
import ConfirmDialog from './ConfirmDialog';
import { availabilitySummary, fmtDay } from '../utils/availability';
import { openProtectedFile } from '../utils/files';
import RatingBadge from './RatingBadge';
```

**Edit 2.** Find:
```jsx
            <ul className="text-xs space-y-0.5">
              {data.time_off.map((t) => (
                <li key={t.id} className={t.status === 'approved' ? 'text-rose-200' : 'text-amber-200'}>
                  {fmtDayRange(t.start_date, t.end_date)} · {t.status === 'approved' ? 'approved' : 'waiting for a decision'}
                </li>
              ))}
```
Replace with:
```jsx
            <ul className="text-xs space-y-0.5">
              {data.time_off.map((t) => (
                <li key={t.id} className="text-slate-200">
                  {t.summary}
                  {t.reason && <span className="text-slate-400"> · {t.reason}</span>}
                  {t.conflicts?.length > 0 && <span className="block text-amber-300">Booked here then: {t.conflicts.join('; ')}</span>}
                </li>
              ))}
```

---

## D4. `frontend/src/pages/VenueManagerDashboard.jsx` (EDITS)
Removes the time-off queue (import, state, fetch, strip prop, card).

**Edit 1.** Find:
```jsx
import TonightBoard from '../components/manager/TonightBoard';
import NeedsYouStrip from '../components/manager/NeedsYouStrip';
import TimeOffCard from '../components/manager/TimeOffCard';

/**
```
Replace with:
```jsx
import TonightBoard from '../components/manager/TonightBoard';
import NeedsYouStrip from '../components/manager/NeedsYouStrip';

/**
```

**Edit 2.** Find:
```jsx
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [pendingTimeOff, setPendingTimeOff] = useState([]);   // Phase 31
  const [currentVenueId, setCurrentVenueId] = useState(initialVenue);
  const [venueDetails, setVenueDetails] = useState(null);
```
Replace with:
```jsx
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [currentVenueId, setCurrentVenueId] = useState(initialVenue);
  const [venueDetails, setVenueDetails] = useState(null);
```

**Edit 3.** Find:
```jsx
      }

      const [requestsRes, venueRes, transfersRes, reliabilityRes, timeOffRes] = await Promise.all([
        api.get(`/venues/${activeId}/requests/pending`),
        api.get(`/venues/${activeId}`),
        api.get(`/transfers/venue/${activeId}/pending`).catch(() => ({ data: [] })),
        api.get(`/venues/${activeId}/reliability`).catch(() => ({ data: {} })),
        api.get(`/venues/${activeId}/time-off`).catch(() => ({ data: [] })),          // Phase 31
      ]);
      setPendingTimeOff(timeOffRes.data || []);

      setPendingRequests(requestsRes.data || []);
```
Replace with:
```jsx
      }

      const [requestsRes, venueRes, transfersRes, reliabilityRes] = await Promise.all([
        api.get(`/venues/${activeId}/requests/pending`),
        api.get(`/venues/${activeId}`),
        api.get(`/transfers/venue/${activeId}/pending`).catch(() => ({ data: [] })),
        api.get(`/venues/${activeId}/reliability`).catch(() => ({ data: {} })),
      ]);

      setPendingRequests(requestsRes.data || []);
```

**Edit 4.** Find:
```jsx
          requests={pendingRequests.length}
          transfers={pendingTransfers.length}
          timeOff={pendingTimeOff.length}
          late={tonightSummary.late}
          openSpots={tonightSummary.openSpots}
```
Replace with:
```jsx
          requests={pendingRequests.length}
          transfers={pendingTransfers.length}
          late={tonightSummary.late}
          openSpots={tonightSummary.openSpots}
```

**Edit 5.** Find:
```jsx
              />
            )}
            <TimeOffCard
              venueId={currentVenueId}
              items={pendingTimeOff}
              onOpenWorker={setProfileWorkerId}
              onDone={(message, type = 'success') => {
                setNotification({ type, message });
                fetchVenueData(currentVenueId);
              }}
            />
            <ActivityFeed
              venueId={currentVenueId}
```
Replace with:
```jsx
              />
            )}
            <ActivityFeed
              venueId={currentVenueId}
```

---

## D5. `frontend/src/components/manager/NeedsYouStrip.jsx` (EDITS)
Back to the Phase 30 version (no time-off chip).

**Edit 1.** Find:
```jsx
import React from 'react';
import { CheckCircle2, Users, ArrowRightLeft, AlarmClock, UserPlus, BellRing, CalendarOff } from 'lucide-react';

/**
 * Phase 30: One slim strip at the top of the manager dashboard.
 * Everything waiting on the manager, with a tap to jump to it. When nothing is waiting it shrinks
 * to a single "all caught up" line (the request / hand-off cards are hidden while they're empty).
 * Props: requests (number), transfers (number), late (number: late + missed), openSpots (number: open-spot alerts),
 *        timeOff (number: Phase 31 time-off requests waiting),
 *        onJump(targetId)  -> 'approval-queue' | 'pending-transfers' | 'tonight-board' | 'time-off-queue'
 */
export default function NeedsYouStrip({ requests = 0, transfers = 0, late = 0, openSpots = 0, timeOff = 0, onJump }) {
  const total = requests + transfers + late + openSpots + timeOff;

  if (total === 0) {
```
Replace with:
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
```

**Edit 2.** Find:
```jsx
    transfers > 0 && { id: 'pending-transfers', n: transfers, label: transfers === 1 ? 'hand-off' : 'hand-offs', icon: ArrowRightLeft,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
    timeOff > 0 && { id: 'time-off-queue', n: timeOff, label: timeOff === 1 ? 'time-off request' : 'time-off requests', icon: CalendarOff,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
  ].filter(Boolean);

```
Replace with:
```jsx
    transfers > 0 && { id: 'pending-transfers', n: transfers, label: transfers === 1 ? 'hand-off' : 'hand-offs', icon: ArrowRightLeft,
      cls: 'bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25' },
  ].filter(Boolean);

```

---

## D6. `frontend/src/components/manager/WeekAtGlance.jsx` (EDIT)
One name per line (up to 4, then "+N more").

**Edit 1.** Find:
```jsx
            )}
            {d.time_off?.length > 0 && (
              <p className="mt-1.5 text-[10px] text-amber-200/90 flex items-start gap-1" title={`Approved time off: ${d.time_off.join(', ')}`}>
                <CalendarOff className="w-3 h-3 flex-shrink-0 mt-px" />
                <span className="line-clamp-2">Off: {d.time_off.join(', ')}</span>
              </p>
            )}
            <ul className="mt-2 space-y-1.5">
```
Replace with:
```jsx
            )}
            {d.time_off?.length > 0 && (
              <div className="mt-1.5 text-[10px] text-amber-200/90 flex items-start gap-1" title={`Time off: ${d.time_off.join(', ')}`}>
                <CalendarOff className="w-3 h-3 flex-shrink-0 mt-px" />
                <ul className="min-w-0">
                  {d.time_off.slice(0, 4).map((n) => <li key={n}>{n}</li>)}
                  {d.time_off.length > 4 && <li className="text-amber-200/60">+{d.time_off.length - 4} more</li>}
                </ul>
              </div>
            )}
            <ul className="mt-2 space-y-1.5">
```

---

## D7. DELETE `frontend/src/components/manager/TimeOffCard.jsx`
Delete the file. After D4 nothing imports it.

---

## E. Rebuild & verification

**Schema changed.** Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data.** This creates `time_off_blocks`, turns waiting and approved requests that haven't ended into all-day blocks (keeping the reason), and drops `time_off_requests`:
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
CREATE TABLE IF NOT EXISTS time_off_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    all_day BOOLEAN NOT NULL DEFAULT TRUE,
    start_date DATE NOT NULL,
    end_date DATE,
    start_local VARCHAR(5),
    end_local VARCHAR(5),
    repeat VARCHAR(20) NOT NULL DEFAULT 'none',
    weekdays SMALLINT[] NOT NULL DEFAULT '{}',
    reason VARCHAR(200),
    private_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_time_off_block_range CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_time_off_blocks_worker ON time_off_blocks(worker_id);
-- carry over requests that were waiting or approved and haven't ended, as all-day blocks
INSERT INTO time_off_blocks (worker_id, all_day, start_date, end_date, repeat, reason, created_at, updated_at)
SELECT worker_id, TRUE, start_date, end_date, 'none', LEFT(reason, 200), created_at, CURRENT_TIMESTAMP
FROM time_off_requests
WHERE status IN ('pending', 'approved') AND end_date >= CURRENT_DATE;
DROP TABLE IF EXISTS time_off_requests;
SQL
docker compose up -d --build
```
(Use the database service name, user and DB from `docker-compose.yml` if they differ.)

If the page is blank or shows "Invalid hook call" after the rebuild:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh.

### Checklist
**As a worker** (Profile → Time off):
1. The page explains that nobody approves time off. There's no "waiting for a manager" anywhere.
2. **Add time off → Part of the day, Doesn't repeat**, e.g. tonight 8:00 PM – Midnight, with a reason and a private note, then save.
   * It shows "…, 8:00 PM – midnight", "Managers see: …" and "Only you: …".
   * If you're booked on a shift then, it's listed as **Still booked**.
3. **Every week**:
   * Pick Tue and Thu, 9 AM – 2 PM, and set an end date. It reads "Every Tue & Thu, 9:00 AM – 2:00 PM until …".
   * **Every other week** on Sat and Sun reads "Every other Sat & Sun…".
4. **Edit** changes a block in place, and 🗑 removes it.
5. Find Shifts: a shift inside a block says **During your time off**. You can still request it.

**As the manager:**

6. **Assign / Offer** on a shift inside someone's block:
   * They're greyed out with "Blocked off this time (reason)." and a red chip.
   * **Assign** isn't possible, and offers skip them.
7. When a worker blocks off time they're already booked for:
   * You get "…blocked off time they're booked for" in the bell. It shows the reason and **never the private note**.
   * The roster shows "Has time off during this shift", and there's an Alerts line in the activity log.
8. **This week** lists who's off, with hours for partial days.
9. The worker profile (Team page) lists their time off with reasons only.
10. The dashboard no longer has a "Time off requests" card, and the Needs-you strip has no time-off chip.