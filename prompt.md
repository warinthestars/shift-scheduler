# Phase 35: Venue Payroll, Staffing Companies, Overtime & Pay Periods

**Why:** at many venues most of the crew is on the venue's own payroll and clocks in on the venue's time clock, while overhire comes through staffing companies and should clock in with ShiftBoard. Each venue now decides who tracks time where, can tag people with the company they work through, gets overtime flags, and can approve and lock each pay period. Every rule is a per-venue setting. (**Tips per event come next, in Phase 35.1.**)

## What changes
* **Venue settings → new "Time & pay periods" tab** (saved with the same *Save changes* button as Details):
  * **How your team's time is tracked:** *Clock in with ShiftBoard* (default) or *Your venue's payroll tracks their time* → `venues.team_time_tracking`.
  * **Overtime flags:** over N hours in a work week (default on, 40), over N hours in a day (default off), and the day the work week starts (default Monday).
  * **Pay periods:** weekly (default), every two weeks (with an optional first day; blank = this work week), twice a month (1st–15th, 16th–end) or monthly, plus **Approve and lock each pay period** (default on).
* **Team → Edit** (the old "Positions & note" button): **How their time is tracked** (*Use the venue setting* / *Venue's payroll* / *Clock in with ShiftBoard*) and **Works through (staffing company)**, with suggestions from names already used. Rows show *Venue payroll* and company chips; the filter also searches the company.
* **Who tracks where** (`services/time_tracking.py`, first match wins):
  1. the person's own setting (only while they're on the team)
  2. they work through a company → ShiftBoard
  3. they're on the team and the venue uses payroll → payroll
  4. otherwise (including everyone booked from outside the team) → ShiftBoard
  * When a shift **starts**, the background worker writes the answer on the booking (`shift_requests.time_tracking`). Until then the live settings apply. Later settings changes never rewrite past hours.
* **Payroll-tracked people:**
  * no clock-in button (*"Clock in with the venue's system"*, then *"Worked · tracked by venue payroll"*), and the server refuses a clock-in with a plain message
  * no "not clocked in" alerts; a violet **Venue payroll** state on the Today board (a manager can still mark a no-show once the shift has started)
  * reliability counts the shift as worked and on time unless it's marked a no-show
  * their hours aren't in time sheets, the hours download or Hours & pay (which says how many payroll shifts there were); pay periods list them separately with scheduled hours
* **Overtime** is a flag and an hour count. Daily overtime is counted per local day; weekly overtime counts the rest of the hours past the weekly limit in each work week, with no double counting. It shows on time sheets (OT chip), pay periods and the hours download. **No premium is added to pay.**
* **Pay periods** (new header button on the manager dashboard): the current period and the 7 before it, each with people, hours, overtime and pay; a per-person table with company, open / edited / auto-closed / outside-the-area counts; a company filter; and a download.
  * States: *In progress*, *Ready to approve*, *Approved · locked*, *Ended* (approving turned off) and *No hours*.
  * **Approve and lock** needs the period to be over with no open clock-ins. It saves a snapshot of the totals. While a period is approved, adding, editing or deleting a time in it, or changing someone's pay rate for hours in it, is refused with **409** *"The pay period … is approved and locked. Reopen it on the Pay periods screen to change its times."*
  * **Reopen** needs a reason. Approvals and reopens go in the activity log.
* **Hours download** (and the payroll CSV): three new columns at the **end**: *Regular hours*, *Overtime hours*, *Works through*. Existing columns keep their positions. New optional `company=` filter.
* **API** (187 → **191** operations):
  * `GET /api/venues/{id}/pay-periods?count=6`
  * `GET /api/venues/{id}/pay-periods/{start}?company=`
  * `POST /api/venues/{id}/pay-periods/{start}/approve`
  * `POST /api/venues/{id}/pay-periods/{start}/reopen` with `{"reason": "..."}`
  * Managers of the venue and admins only.
* **Database:** 7 new `venues` columns, 2 new `venue_whitelists` columns, 1 new `shift_requests` column and a new `pay_period_approvals` table. All status-like columns are `VARCHAR`, **no ENUMs**.
* **Version 0.35.0.** `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG and README updates are included below. **This covers the standing directive for this phase, so don't bump again.**

## 0. Rules for this phase
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
  - In `backend/src/main.py`, **only** add the router import and `include_router` line in A11. Don't touch CORS or anything else.
* **Schema change:** see Part C (keep-your-data SQL, or `docker compose down -v` / `up -d --build`). No ENUMs.
* No new packages.
* **NEW FILES:** create them with exactly the content shown.
* **EDITS:** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* **Verification.** All 31 edited files were checked against your repo and match (34.6 is fully applied). They were verified:
  - **Backend:** imports cleanly. 191 API operations. The API reports **0.35.0**.
  - **Frontend:** bundles with no missing imports.
  - **A new 58-check suite passes.** It covers:
    - settings defaults and validation (bad tracking value, weekly OT 0, daily OT 30, week start 7, pay period "daily")
    - team rules: venue default, agency person, per-person override, bad value refused, activity log
    - the calendar mode, the clock-in refusal, freezing at the start, no late alert for payroll, the Today board, the roster
    - a started shift keeps its mode after the venue switches; an upcoming one follows the new setting
    - reliability (payroll = worked; a ShiftBoard no-show still counts) and Hours & pay
    - overtime: weekly 45 h → 5; daily 8 h + weekly → 5 (no double count); limit 42 → 3; off → 0; a Wednesday work week
    - export columns (old ones in place) and the company filter
    - pay periods: list, bad start date (400), an open entry blocks approval, approve, snapshot, can't approve twice or approve the current period, the lock on edit / delete / add / pay rate (409), reopen needs a reason, edit after reopening, approve again, activity log
    - managers and admins only (workers 403); payroll people listed separately
    - approval off, semimonthly, biweekly (start date set automatically) and monthly periods
  - **Every earlier suite still passes** (t1–t18), including the schema audit: model and `init.sql` match, no ENUMs.
  - **The keep-your-data SQL** was run twice on a copy of your current schema, and the result matches a fresh `init.sql` exactly.
  - In real Chromium: the Time & pay periods tab saves; Team → Edit saves tracking + company; the Today board shows *Venue payroll* with No-show; the time sheet shows the payroll note and company chip; Pay periods shows 81 h / 17 h OT for a test week, approves and locks it; a payroll worker's phone shows no Clock in button. No page errors.

  Don't "improve" them.

---

# PART A: Backend

## A1. `database/init.sql` (EDITS)
New columns in `venues`, `venue_whitelists` and `shift_requests`, and the new `pay_period_approvals` table at the end.

**Edit 1.** Find:
```sql
    auto_clock_out_hours INT NOT NULL DEFAULT 2,
    allow_public_cover BOOLEAN NOT NULL DEFAULT TRUE,        -- Phase 34: workers may also post cover on the public board
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```
Replace with:
```sql
    auto_clock_out_hours INT NOT NULL DEFAULT 2,
    allow_public_cover BOOLEAN NOT NULL DEFAULT TRUE,        -- Phase 34: workers may also post cover on the public board
    team_time_tracking VARCHAR(20) NOT NULL DEFAULT 'shiftboard', -- Phase 35: shiftboard | payroll (team members' default)
    ot_weekly_hours NUMERIC(5, 2) DEFAULT 40,                -- Phase 35: overtime after this many hours a work week (NULL = off)
    ot_daily_hours NUMERIC(5, 2),                            -- Phase 35: overtime after this many hours a day (NULL = off)
    work_week_start SMALLINT NOT NULL DEFAULT 0,             -- Phase 35: 0 = Monday ... 6 = Sunday
    pay_period VARCHAR(20) NOT NULL DEFAULT 'weekly',        -- Phase 35: weekly | biweekly | semimonthly | monthly
    pay_period_anchor DATE,                                  -- Phase 35: biweekly: the first day of any pay period
    pay_period_approval BOOLEAN NOT NULL DEFAULT TRUE,       -- Phase 35: managers approve and lock each pay period
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

**Edit 2.** Find:
```sql
    positions TEXT[] NOT NULL DEFAULT '{}',                -- Phase 29: positions this person works here
    source VARCHAR(20) NOT NULL DEFAULT 'manager',         -- Phase 29: manager | invite | import | admin
    added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```
Replace with:
```sql
    positions TEXT[] NOT NULL DEFAULT '{}',                -- Phase 29: positions this person works here
    source VARCHAR(20) NOT NULL DEFAULT 'manager',         -- Phase 29: manager | invite | import | admin
    time_tracking VARCHAR(20),                             -- Phase 35: payroll | shiftboard (NULL = the venue's setting)
    works_through VARCHAR(120),                            -- Phase 35: staffing company / agency they come through
    added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

**Edit 3.** Find:
```sql
    pay_rate NUMERIC(10, 2),
    info_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```
Replace with:
```sql
    pay_rate NUMERIC(10, 2),
    info_seen_at TIMESTAMPTZ,
    time_tracking VARCHAR(20),                                -- Phase 35: payroll | shiftboard, written when the shift starts
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

**Edit 4.** Find:
```sql
-- one live place per person per position
CREATE UNIQUE INDEX uq_waitlist_live ON waitlist_entries(shift_id, worker_id) WHERE status IN ('waiting', 'offered');
```
Replace with:
```sql
-- one live place per person per position
CREATE UNIQUE INDEX uq_waitlist_live ON waitlist_entries(shift_id, worker_id) WHERE status IN ('waiting', 'offered');

-- ==============================================================================
-- Phase 35: Pay periods (approved = locked)
-- ==============================================================================
CREATE TABLE pay_period_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,                                 -- venue-local dates, inclusive
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'approved',           -- approved (locked) | reopened
    people INT NOT NULL DEFAULT 0,                            -- totals when it was approved
    total_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
    overtime_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
    approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reopened_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reopened_at TIMESTAMPTZ,
    reopen_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_pay_period_approvals_venue ON pay_period_approvals(venue_id, start_date);
-- one live approval per venue and period
CREATE UNIQUE INDEX uq_pay_period_approved ON pay_period_approvals(venue_id, start_date) WHERE status = 'approved';
```

---

## A2. `backend/src/models.py` (EDITS)
`Index` import, the new columns, and the `PayPeriodApproval` model. (The partial unique index lives only in `init.sql`, on purpose.)

**Edit 1.** Find:
```python
    Column, String, Text, Boolean, Integer, Float, Numeric,
    DateTime, ForeignKey, ARRAY, CheckConstraint, UniqueConstraint,   # Phase 34.5: no SQLAlchemy Enum (no native PG ENUMs)
    Date, SmallInteger, LargeBinary,
)
from sqlalchemy.dialects.postgresql import UUID, DOUBLE_PRECISION, JSONB
```
Replace with:
```python
    Column, String, Text, Boolean, Integer, Float, Numeric,
    DateTime, ForeignKey, ARRAY, CheckConstraint, UniqueConstraint,   # Phase 34.5: no SQLAlchemy Enum (no native PG ENUMs)
    Date, SmallInteger, LargeBinary, Index,                           # Phase 35: Index
)
from sqlalchemy.dialects.postgresql import UUID, DOUBLE_PRECISION, JSONB
```

**Edit 2.** Find:
```python
    auto_clock_out_hours = Column(Integer, nullable=False, default=2)          # Phase 27
    allow_public_cover = Column(Boolean, nullable=False, default=True)         # Phase 34
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    auto_clock_out_hours = Column(Integer, nullable=False, default=2)          # Phase 27
    allow_public_cover = Column(Boolean, nullable=False, default=True)         # Phase 34
    team_time_tracking = Column(String(20), nullable=False, default="shiftboard")   # Phase 35: shiftboard | payroll
    ot_weekly_hours = Column(Numeric(5, 2), nullable=True, default=40)             # Phase 35: None = off
    ot_daily_hours = Column(Numeric(5, 2), nullable=True)                          # Phase 35: None = off
    work_week_start = Column(SmallInteger, nullable=False, default=0)              # Phase 35: 0 = Monday
    pay_period = Column(String(20), nullable=False, default="weekly")              # Phase 35
    pay_period_anchor = Column(Date, nullable=True)                                # Phase 35: biweekly
    pay_period_approval = Column(Boolean, nullable=False, default=True)            # Phase 35
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

**Edit 3.** Find:
```python
    positions = Column(ARRAY(String), nullable=False, default=list)          # Phase 29
    source = Column(String(20), nullable=False, default="manager")           # Phase 29: manager | invite | import | admin
    added_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```
Replace with:
```python
    positions = Column(ARRAY(String), nullable=False, default=list)          # Phase 29
    source = Column(String(20), nullable=False, default="manager")           # Phase 29: manager | invite | import | admin
    time_tracking = Column(String(20), nullable=True)                        # Phase 35: payroll | shiftboard | None = venue setting
    works_through = Column(String(120), nullable=True)                       # Phase 35: staffing company / agency
    added_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```

**Edit 4.** Find:
```python
    pay_rate = Column(Numeric(10, 2), nullable=True)
    info_seen_at = Column(DateTime(timezone=True), nullable=True)          # Phase 26.2: worker read the shift info
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    pay_rate = Column(Numeric(10, 2), nullable=True)
    info_seen_at = Column(DateTime(timezone=True), nullable=True)          # Phase 26.2: worker read the shift info
    time_tracking = Column(String(20), nullable=True)                       # Phase 35: written when the shift starts
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

**Edit 5.** Find:
```python
    request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="SET NULL"), nullable=True)
    closed_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="SET NULL"), nullable=True)
    closed_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class PayPeriodApproval(Base):
    """Phase 35: a pay period a manager approved. While status == 'approved' its times are locked."""
    __tablename__ = "pay_period_approvals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    status = Column(String(20), nullable=False, default="approved")           # approved | reopened
    people = Column(Integer, nullable=False, default=0)
    total_hours = Column(Numeric(10, 2), nullable=False, default=0)
    overtime_hours = Column(Numeric(10, 2), nullable=False, default=0)
    total_pay = Column(Numeric(12, 2), nullable=False, default=0)
    approved_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    reopened_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reopened_at = Column(DateTime(timezone=True), nullable=True)
    reopen_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (Index("idx_pay_period_approvals_venue", "venue_id", "start_date"),)
```

---

## A3. `backend/src/schemas.py` (EDITS)
Venue fields, roster / time sheet / calendar / team / earnings fields, and the pay-period models (just before the `model_rebuild()` lines).

**Edit 1.** Find:
```python
    auto_clock_out_hours: int = 2           # Phase 27
    allow_public_cover: bool = True         # Phase 34

class VenueCreate(BaseModel):
```
Replace with:
```python
    auto_clock_out_hours: int = 2           # Phase 27
    allow_public_cover: bool = True         # Phase 34
    team_time_tracking: str = "shiftboard"  # Phase 35: shiftboard | payroll (team members' default)
    ot_weekly_hours: Optional[float] = 40   # Phase 35: None = off
    ot_daily_hours: Optional[float] = None  # Phase 35: None = off
    work_week_start: int = 0                # Phase 35: 0 = Monday ... 6 = Sunday
    pay_period: str = "weekly"              # Phase 35: weekly | biweekly | semimonthly | monthly
    pay_period_anchor: Optional[date] = None  # Phase 35: biweekly only
    pay_period_approval: bool = True        # Phase 35: approve and lock each pay period

class VenueCreate(BaseModel):
```

**Edit 2.** Find:
```python
    auto_clock_out_hours: Optional[int] = None        # Phase 27
    allow_public_cover: Optional[bool] = None         # Phase 34

class VenueResponse(VenueBase):
```
Replace with:
```python
    auto_clock_out_hours: Optional[int] = None        # Phase 27
    allow_public_cover: Optional[bool] = None         # Phase 34
    team_time_tracking: Optional[str] = None          # Phase 35
    ot_weekly_hours: Optional[float] = None           # Phase 35: send null to turn it off
    ot_daily_hours: Optional[float] = None            # Phase 35: send null to turn it off
    work_week_start: Optional[int] = None             # Phase 35
    pay_period: Optional[str] = None                  # Phase 35
    pay_period_anchor: Optional[date] = None          # Phase 35
    pay_period_approval: Optional[bool] = None        # Phase 35

class VenueResponse(VenueBase):
```

**Edit 3.** Find:
```python
    outside_department: bool = False             # Phase 32.2: their request is outside their departments
    cover: Optional[str] = None                  # Phase 34: open | pending_approval (they asked for cover)


```
Replace with:
```python
    outside_department: bool = False             # Phase 32.2: their request is outside their departments
    cover: Optional[str] = None                  # Phase 34: open | pending_approval (they asked for cover)
    time_tracking: Optional[str] = None          # Phase 35: shiftboard | payroll (booked people)
    works_through: Optional[str] = None          # Phase 35: staffing company, from the team list


```

**Edit 4.** Find:
```python
    total_hours: float
    est_pay: float


```
Replace with:
```python
    total_hours: float
    est_pay: float
    time_tracking: str = "shiftboard"        # Phase 35: payroll = the venue's own system tracks their time
    works_through: Optional[str] = None      # Phase 35
    overtime_hours: float = 0                # Phase 35: part of total_hours that is overtime (venue rules)


```

**Edit 5.** Find:
```python
    cancelled: bool = False
    cancel_reason: Optional[str] = None


```
Replace with:
```python
    cancelled: bool = False
    cancel_reason: Optional[str] = None
    time_tracking: str = "shiftboard"             # Phase 35: payroll = clock in with the venue's own system


```

**Edit 6.** Find:
```python
    certs: List[str] = []                    # Phase 32: cert keys that are verified and in date
    cert_attention: int = 0                  # Phase 32: certificates waiting for a check (not verified yet)


class TeamMemberUpdate(BaseModel):
    status: Optional[str] = None             # active | removed | blocked
    positions: Optional[List[str]] = None
    notes: Optional[str] = None


```
Replace with:
```python
    certs: List[str] = []                    # Phase 32: cert keys that are verified and in date
    cert_attention: int = 0                  # Phase 32: certificates waiting for a check (not verified yet)
    time_tracking: Optional[str] = None      # Phase 35: this person's setting: payroll | shiftboard | None = venue setting
    effective_time_tracking: str = "shiftboard"   # Phase 35: what applies to their next booking
    works_through: Optional[str] = None      # Phase 35: staffing company / agency


class TeamMemberUpdate(BaseModel):
    status: Optional[str] = None             # active | removed | blocked
    positions: Optional[List[str]] = None
    notes: Optional[str] = None
    time_tracking: Optional[str] = None      # Phase 35: payroll | shiftboard | venue (or null) = use the venue setting
    works_through: Optional[str] = Field(None, max_length=120)   # Phase 35: "" clears it


```

**Edit 7.** Find:
```python
    phone: Optional[str] = None
    request_status: str                          # approved | confirmed | checked_in | completed | no_show
    clock_state: str                             # upcoming | due | late | in | done | missed | no_show
    clock_in_time: Optional[datetime] = None     # first clock-in
    clock_out_time: Optional[datetime] = None    # last clock-out (when done)
```
Replace with:
```python
    phone: Optional[str] = None
    request_status: str                          # approved | confirmed | checked_in | completed | no_show
    clock_state: str                             # upcoming | due | late | in | done | missed | no_show | payroll (Phase 35)
    clock_in_time: Optional[datetime] = None     # first clock-in
    clock_out_time: Optional[datetime] = None    # last clock-out (when done)
```

**Edit 8.** Find:
```python
    shifts: List[EarningsShift] = []         # newest first
    upcoming: EarningsUpcoming = EarningsUpcoming()


```
Replace with:
```python
    shifts: List[EarningsShift] = []         # newest first
    upcoming: EarningsUpcoming = EarningsUpcoming()
    payroll_shifts: int = 0                  # Phase 35: shifts in the period tracked by a venue's own payroll (not counted here)
    payroll_venues: List[str] = []           # Phase 35


```

**Edit 9.** Find:
```python


WorkerProfile.model_rebuild()
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
```
Replace with:
```python



# ------------------------------------------------------------------------------------------------
# Phase 35: Pay periods
# ------------------------------------------------------------------------------------------------
class PayPeriodPerson(BaseModel):
    worker_id: UUID
    name: str
    email: Optional[str] = None
    works_through: Optional[str] = None
    shifts: int = 0
    hours: float = 0
    regular_hours: float = 0
    overtime_hours: float = 0
    pay: float = 0                           # hours x rate (overtime premium not added; that's the payroll's job)
    open_entries: int = 0                    # still clocked in / never clocked out
    edited_entries: int = 0
    outside_area: int = 0
    auto_closed: int = 0


class PayPeriodPayrollPerson(BaseModel):
    worker_id: UUID
    name: str
    shifts: int = 0
    scheduled_hours: float = 0               # from the posted times (their real hours are in the venue's payroll)


class PayPeriodSummary(BaseModel):
    start_date: date
    end_date: date
    label: str
    state: str                               # current | ready | approved | not_required | empty (nobody worked)
    can_approve: bool = False
    blocked_reason: Optional[str] = None     # why it can't be approved yet
    people: int = 0
    total_hours: float = 0
    overtime_hours: float = 0
    total_pay: float = 0
    open_entries: int = 0
    payroll_people: int = 0
    payroll_shifts: int = 0
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    last_reopened_at: Optional[datetime] = None
    last_reopen_reason: Optional[str] = None


class PayPeriodDetail(PayPeriodSummary):
    rows: List[PayPeriodPerson] = []
    payroll_rows: List[PayPeriodPayrollPerson] = []


class PayPeriodList(BaseModel):
    pay_period: str
    approval_on: bool
    overtime_text: str                       # "Over 40 h a week" / "Off"
    timezone: str
    companies: List[str] = []                # for the company filter
    periods: List[PayPeriodSummary] = []


class PayPeriodReopenBody(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


WorkerProfile.model_rebuild()
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
```

---

## A4. NEW FILE `backend/src/services/time_tracking.py`
Who clocks in where, freezing the mode at the start, and company names.

```python
"""
Phase 35: Who clocks in with ShiftBoard, and who is on the venue's own payroll system.

  'shiftboard' : clock in / out in ShiftBoard; hours count in time sheets, exports, Hours & pay.
  'payroll'    : the venue's own payroll / time clock tracks their time. ShiftBoard shows no clock button,
                 sends no "not clocked in" alerts, and leaves them out of hours and pay. The shift counts as
                 worked unless a manager marks a no-show.

How it's decided for one person at one venue (first match wins):
  1. their team-member setting (venue_whitelists.time_tracking = 'payroll' | 'shiftboard')
  2. they work through another company (venue_whitelists.works_through set) -> 'shiftboard'  (overhire / agency)
  3. they're on the venue's team and the venue says team members use payroll
     (venues.team_time_tracking = 'payroll') -> 'payroll'
  4. otherwise -> 'shiftboard'  (people booked from outside the team always clock in here)

A booking follows the CURRENT settings until its shift starts. At the start, the background worker writes the
answer on the booking (shift_requests.time_tracking), so later settings changes never rewrite history.
"""
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftRequest, Venue, VenueWhitelist

SHIFTBOARD = "shiftboard"
PAYROLL = "payroll"
MODES = (SHIFTBOARD, PAYROLL)
FREEZE_STATUSES = ("approved", "confirmed", "checked_in", "completed", "no_show")
COMPANY_MAX = 120


def resolve(venue_team_mode: Optional[str], member: Optional[VenueWhitelist]) -> str:
    """The rule above, for one venue + (optional) team-list row."""
    on_team = member is not None and member.status == "active" and bool(member.is_active)
    if member is not None and on_team and member.time_tracking in MODES:
        return member.time_tracking
    if member is not None and on_team and (member.works_through or "").strip():
        return SHIFTBOARD
    if on_team and venue_team_mode == PAYROLL:
        return PAYROLL
    return SHIFTBOARD


async def live_modes(db: AsyncSession, pairs: Iterable[Tuple]) -> Dict[Tuple, str]:
    """{(venue_id, worker_id): mode} from the current settings."""
    pairs = list({(v, w) for v, w in pairs if v is not None and w is not None})
    if not pairs:
        return {}
    venue_ids = list({v for v, _ in pairs})
    worker_ids = list({w for _, w in pairs})
    venue_mode = dict((await db.execute(
        select(Venue.id, Venue.team_time_tracking).where(Venue.id.in_(venue_ids))
    )).all())
    members = {(m.venue_id, m.worker_id): m for m in (await db.execute(
        select(VenueWhitelist).where(VenueWhitelist.venue_id.in_(venue_ids), VenueWhitelist.worker_id.in_(worker_ids))
    )).scalars().all()}
    return {(v, w): resolve(venue_mode.get(v), members.get((v, w))) for v, w in pairs}


async def modes_for_requests(db: AsyncSession, rows: Iterable[Tuple[ShiftRequest, Shift]]) -> Dict:
    """{request_id: mode}: the value written on the booking when its shift started, else the live setting."""
    rows = list(rows)
    need = [(s.venue_id, r.worker_id) for r, s in rows if r.time_tracking not in MODES]
    live = await live_modes(db, need)
    out = {}
    for r, s in rows:
        out[r.id] = r.time_tracking if r.time_tracking in MODES else live.get((s.venue_id, r.worker_id), SHIFTBOARD)
    return out


async def mode_for(db: AsyncSession, req: ShiftRequest, shift: Shift) -> str:
    return (await modes_for_requests(db, [(req, shift)]))[req.id]


async def freeze_started(db: AsyncSession, now: datetime) -> int:
    """Background worker, every minute: write the tracking mode on bookings whose shift has started.
    Does NOT commit. Returns how many were written."""
    rows = (await db.execute(
        select(ShiftRequest, Shift).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.time_tracking.is_(None), Shift.start_time <= now,
               func.lower(ShiftRequest.status).in_(FREEZE_STATUSES))
        .limit(2000)
    )).all()
    if not rows:
        return 0
    modes = await modes_for_requests(db, rows)
    for r, _s in rows:
        r.time_tracking = modes[r.id]
    return len(rows)


def clean_company(value) -> Optional[str]:
    v = " ".join(str(value or "").split())[:COMPANY_MAX]
    return v or None


async def venue_companies(db: AsyncSession, venue_id) -> List[str]:
    """Companies named on this venue's team list (for filters)."""
    rows = (await db.execute(
        select(VenueWhitelist.works_through).where(
            VenueWhitelist.venue_id == venue_id, VenueWhitelist.works_through.isnot(None))
        .distinct()
    )).scalars().all()
    return sorted({r for r in rows if r}, key=str.lower)
```

---

## A5. NEW FILE `backend/src/services/pay_periods.py`
Pay period dates, overtime, locks and totals.

```python
"""
Phase 35: Pay periods, overtime and approving / locking a period.

Everything here is in the VENUE's time zone and works on ShiftBoard time entries (people whose time the venue's
own payroll tracks have no entries; they are listed separately so the manager can cross-check).

Pay periods (venues.pay_period):
  weekly       7 days starting on the venue's work-week start day (venues.work_week_start, 0 = Monday)
  biweekly     14 days counted from venues.pay_period_anchor (any first day of a pay period)
  semimonthly  the 1st to the 15th, and the 16th to the end of the month
  monthly      calendar months

Overtime (a flag and hour count; ShiftBoard does not change anyone's pay rate):
  * daily   (venues.ot_daily_hours, None = off): hours past the limit on one day (the day the entry started)
  * weekly  (venues.ot_weekly_hours, None = off): hours past the limit in one work week, not counting hours
            already counted as daily overtime
  A time entry that crosses the limit is split: its overtime part is what's past the limit.

Approving a period (venues.pay_period_approval): only after it has ended and nobody is still clocked in for it.
While approved, times and pay rates in that period can't change (409) until a manager reopens it with a reason.
"""
import calendar
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    PayPeriodApproval, Shift, ShiftRequest, TimeEntry, TimeEntryEdit, User, Venue, VenueWhitelist,
)
from src.services.fit import tz_of

PERIODS = ("weekly", "biweekly", "semimonthly", "monthly")
DEFAULT_ANCHOR = date(2026, 1, 5)          # a Monday; moved to the venue's week start when no anchor is set
BOOKED = ("approved", "confirmed", "checked_in", "completed")


def _utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def local_date(dt, tz) -> date:
    return _utc(dt).astimezone(tz).date()


def day_bounds(first: date, last: date, tz) -> Tuple[datetime, datetime]:
    lo = datetime.combine(first, time.min, tzinfo=tz).astimezone(timezone.utc)
    hi = datetime.combine(last + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    return lo, hi


# ------------------------------------------------------------------------------------------------
# Periods
# ------------------------------------------------------------------------------------------------
def week_start_for(venue: Venue, d: date) -> date:
    ws = int(venue.work_week_start or 0)
    return d - timedelta(days=(d.weekday() - ws) % 7)


def period_for(venue: Venue, d: date) -> Tuple[date, date]:
    kind = venue.pay_period if venue.pay_period in PERIODS else "weekly"
    if kind == "weekly":
        s = week_start_for(venue, d)
        return s, s + timedelta(days=6)
    if kind == "biweekly":
        anchor = venue.pay_period_anchor or week_start_for(venue, DEFAULT_ANCHOR)
        s = anchor + timedelta(days=((d - anchor).days // 14) * 14)
        return s, s + timedelta(days=13)
    if kind == "semimonthly":
        if d.day <= 15:
            return d.replace(day=1), d.replace(day=15)
        return d.replace(day=16), d.replace(day=calendar.monthrange(d.year, d.month)[1])
    return d.replace(day=1), d.replace(day=calendar.monthrange(d.year, d.month)[1])      # monthly


def recent_periods(venue: Venue, today: date, count: int) -> List[Tuple[date, date]]:
    """The current period first, then the ones before it."""
    out = []
    s, e = period_for(venue, today)
    for _ in range(max(1, count)):
        out.append((s, e))
        s, e = period_for(venue, s - timedelta(days=1))
    return out


def check_period_start(venue: Venue, start: date) -> Tuple[date, date]:
    s, e = period_for(venue, start)
    if s != start:
        raise HTTPException(status_code=400, detail="That date isn't the first day of a pay period at this venue.")
    return s, e


def period_label(start: date, end: date) -> str:
    if start.year != end.year:
        return f"{start:%b %-d, %Y} – {end:%b %-d, %Y}"
    if start.month == end.month:
        return f"{start:%b %-d} – {end:%-d}, {end:%Y}"
    return f"{start:%b %-d} – {end:%b %-d}, {end:%Y}"


# ------------------------------------------------------------------------------------------------
# Overtime
# ------------------------------------------------------------------------------------------------
def entry_hours(e: TimeEntry) -> float:
    if not e.clock_in_time or not e.clock_out_time:
        return 0.0
    return max(0.0, (_utc(e.clock_out_time) - _utc(e.clock_in_time)).total_seconds() / 3600.0)


def split_overtime(venue: Venue, entries: Iterable[TimeEntry]) -> Dict:
    """{entry_id: overtime hours} for ONE worker's closed entries at ONE venue (any order)."""
    tz = tz_of(venue.timezone)
    daily = float(venue.ot_daily_hours) if venue.ot_daily_hours is not None else None
    weekly = float(venue.ot_weekly_hours) if venue.ot_weekly_hours is not None else None
    day_tot, week_tot, out = defaultdict(float), defaultdict(float), {}
    for e in sorted([e for e in entries if e.clock_out_time], key=lambda x: _utc(x.clock_in_time)):
        h = entry_hours(e)
        d = local_date(e.clock_in_time, tz)
        daily_ot = 0.0
        if daily:
            before = day_tot[d]
            day_tot[d] = before + h
            daily_ot = max(0.0, day_tot[d] - daily) - max(0.0, before - daily)
        weekly_ot = 0.0
        if weekly:
            wk = week_start_for(venue, d)
            before = week_tot[wk]
            week_tot[wk] = before + (h - daily_ot)
            weekly_ot = max(0.0, week_tot[wk] - weekly) - max(0.0, before - weekly)
        out[e.id] = round(daily_ot + weekly_ot, 4)
    return out


async def overtime_for(db: AsyncSession, venue: Venue, worker_ids: Iterable, first: date, last: date) -> Dict:
    """{entry_id: overtime hours} for these workers' entries at this venue that START between first and last
    (venue dates). Whole work weeks are read so weekly overtime is right even when the range starts mid-week."""
    worker_ids = list(set(worker_ids))
    if not worker_ids or (venue.ot_daily_hours is None and venue.ot_weekly_hours is None):
        return {}
    tz = tz_of(venue.timezone)
    lo, hi = day_bounds(week_start_for(venue, first), last, tz)
    rows = (await db.execute(
        select(TimeEntry).join(Shift, Shift.id == TimeEntry.shift_id)
        .where(Shift.venue_id == venue.id, TimeEntry.worker_id.in_(worker_ids),
               TimeEntry.clock_in_time >= lo, TimeEntry.clock_in_time < hi)
    )).scalars().all()
    per = defaultdict(list)
    for e in rows:
        per[e.worker_id].append(e)
    out = {}
    for es in per.values():
        out.update(split_overtime(venue, es))
    return out


# ------------------------------------------------------------------------------------------------
# Locks
# ------------------------------------------------------------------------------------------------
async def approval_for(db: AsyncSession, venue_id, start: date) -> Optional[PayPeriodApproval]:
    return await db.scalar(select(PayPeriodApproval).where(
        PayPeriodApproval.venue_id == venue_id, PayPeriodApproval.start_date == start,
        PayPeriodApproval.status == "approved"))


async def lock_covering(db: AsyncSession, venue_id, day: date) -> Optional[PayPeriodApproval]:
    return await db.scalar(select(PayPeriodApproval).where(
        PayPeriodApproval.venue_id == venue_id, PayPeriodApproval.status == "approved",
        PayPeriodApproval.start_date <= day, PayPeriodApproval.end_date >= day).limit(1))


async def assert_unlocked(db: AsyncSession, venue: Venue, *moments) -> None:
    """409 if any of these times falls in an approved (locked) pay period at this venue."""
    tz = tz_of(venue.timezone)
    for m in moments:
        if m is None:
            continue
        lock = await lock_covering(db, venue.id, local_date(m, tz))
        if lock is not None:
            raise HTTPException(status_code=409, detail=(
                f"The pay period {period_label(lock.start_date, lock.end_date)} is approved and locked. "
                "Reopen it on the Pay periods screen to change its times."))


# ------------------------------------------------------------------------------------------------
# Summaries
# ------------------------------------------------------------------------------------------------
async def summarize(db: AsyncSession, venue: Venue, start: date, end: date, company: Optional[str] = None,
                    people: bool = True) -> dict:
    """Totals (and per-person rows when people=True) for one period. Plain dicts; the router builds schemas."""
    from src.services.time_tracking import modes_for_requests, PAYROLL
    tz = tz_of(venue.timezone)
    lo, hi = day_bounds(start, end, tz)
    rows = (await db.execute(
        select(TimeEntry, Shift, ShiftRequest, User)
        .join(Shift, Shift.id == TimeEntry.shift_id)
        .join(User, User.id == TimeEntry.worker_id)
        .outerjoin(ShiftRequest, (ShiftRequest.shift_id == TimeEntry.shift_id) & (ShiftRequest.worker_id == TimeEntry.worker_id))
        .where(Shift.venue_id == venue.id, TimeEntry.clock_in_time >= lo, TimeEntry.clock_in_time < hi)
    )).all()
    members = {m.worker_id: m for m in (await db.execute(
        select(VenueWhitelist).where(VenueWhitelist.venue_id == venue.id))).scalars().all()}

    def company_of(wid):
        m = members.get(wid)
        return (m.works_through or None) if m is not None else None

    if company:
        want = company.strip().lower()
        rows = [r for r in rows if (company_of(r[3].id) or "").lower() == want]
    ot = await overtime_for(db, venue, {r[3].id for r in rows}, start, end)
    edited = set()
    ids = [r[0].id for r in rows]
    if ids:
        edited = set((await db.execute(
            select(TimeEntryEdit.time_entry_id).where(TimeEntryEdit.time_entry_id.in_(ids),
                                                      TimeEntryEdit.action.in_(("edit", "add"))).distinct()
        )).scalars().all())

    per = {}
    for e, s, r, u in rows:
        p = per.setdefault(u.id, {
            "worker_id": u.id, "name": (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email),
            "email": u.email, "works_through": company_of(u.id), "shifts": set(), "hours": 0.0, "overtime_hours": 0.0,
            "pay": 0.0, "open_entries": 0, "edited_entries": 0, "outside_area": 0, "auto_closed": 0,
        })
        p["shifts"].add(s.id)
        if e.clock_out_time is None:
            p["open_entries"] += 1
            continue
        h = entry_hours(e)
        rate = float(r.pay_rate) if (r is not None and r.pay_rate is not None) else float(s.hourly_rate or 0)
        p["hours"] += h
        p["overtime_hours"] += ot.get(e.id, 0.0)
        p["pay"] += h * rate
        p["edited_entries"] += 1 if e.id in edited else 0
        p["outside_area"] += 1 if e.clock_in_geo_status == "outside_geofence" else 0
        p["auto_closed"] += 1 if e.auto_closed else 0

    # People the venue's payroll tracks: booked shifts in the period (no ShiftBoard hours)
    booked = (await db.execute(
        select(ShiftRequest, Shift, User)
        .join(Shift, Shift.id == ShiftRequest.shift_id).join(User, User.id == ShiftRequest.worker_id)
        .where(Shift.venue_id == venue.id, Shift.start_time >= lo, Shift.start_time < hi,
               func.lower(ShiftRequest.status).in_(BOOKED), func.upper(Shift.status) != "CANCELLED")
    )).all()
    modes = await modes_for_requests(db, [(r, s) for r, s, _u in booked])
    payroll = {}
    for r, s, u in booked:
        if modes.get(r.id) != PAYROLL:
            continue
        if company and (company_of(u.id) or "").lower() != company.strip().lower():
            continue
        q = payroll.setdefault(u.id, {"worker_id": u.id, "name": (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email),
                                      "shifts": 0, "scheduled_hours": 0.0})
        q["shifts"] += 1
        q["scheduled_hours"] += max(0.0, (_utc(s.end_time) - _utc(s.start_time)).total_seconds() / 3600.0)

    people_rows = []
    for p in per.values():
        people_rows.append({**p, "shifts": len(p["shifts"]), "hours": round(p["hours"], 2),
                            "overtime_hours": round(p["overtime_hours"], 2),
                            "regular_hours": round(p["hours"] - p["overtime_hours"], 2), "pay": round(p["pay"], 2)})
    people_rows.sort(key=lambda x: x["name"].lower())
    payroll_rows = sorted([{**q, "scheduled_hours": round(q["scheduled_hours"], 2)} for q in payroll.values()],
                          key=lambda x: x["name"].lower())
    out = {
        "people": len(people_rows),
        "total_hours": round(sum(p["hours"] for p in people_rows), 2),
        "overtime_hours": round(sum(p["overtime_hours"] for p in people_rows), 2),
        "total_pay": round(sum(p["pay"] for p in people_rows), 2),
        "open_entries": sum(p["open_entries"] for p in people_rows),
        "payroll_people": len(payroll_rows),
        "payroll_shifts": sum(q["shifts"] for q in payroll_rows),
    }
    if people:
        out["rows"] = people_rows
        out["payroll_rows"] = payroll_rows
    return out
```

---

## A6. `backend/src/services/venue_positions.py` (EDITS)
Validation for the new venue settings.

**Edit 1.** Find:
```python
    "geofence_enabled", "geofence_buffer_meters", "clock_in_early_minutes", "auto_clock_out_hours",   # Phase 27
    "allow_public_cover",                                                                            # Phase 34
)
TEXT_VENUE_FIELDS = (
    "name", "address", "phone", "arrival_instructions", "dress_code",
```
Replace with:
```python
    "geofence_enabled", "geofence_buffer_meters", "clock_in_early_minutes", "auto_clock_out_hours",   # Phase 27
    "allow_public_cover",                                                                            # Phase 34
    "team_time_tracking", "work_week_start", "pay_period", "pay_period_approval",                    # Phase 35
)
VALID_TIME_TRACKING = ("shiftboard", "payroll")                                                      # Phase 35
VALID_PAY_PERIODS = ("weekly", "biweekly", "semimonthly", "monthly")
TEXT_VENUE_FIELDS = (
    "name", "address", "phone", "arrival_instructions", "dress_code",
```

**Edit 2.** Find:
```python
    if "auto_clock_out_hours" in data and not (1 <= int(data["auto_clock_out_hours"]) <= 12):
        raise HTTPException(status_code=400, detail="Auto clock-out must be between 1 and 12 hours after the shift ends.")
    if data.get("auto_approve_rating_threshold") is not None:
        t = float(data["auto_approve_rating_threshold"])
```
Replace with:
```python
    if "auto_clock_out_hours" in data and not (1 <= int(data["auto_clock_out_hours"]) <= 12):
        raise HTTPException(status_code=400, detail="Auto clock-out must be between 1 and 12 hours after the shift ends.")
    # Phase 35: time tracking, overtime, pay periods
    if "team_time_tracking" in data and data["team_time_tracking"] not in VALID_TIME_TRACKING:
        raise HTTPException(status_code=400, detail="Choose how your team's time is tracked.")
    if data.get("ot_weekly_hours") is not None and not (1 <= float(data["ot_weekly_hours"]) <= 168):
        raise HTTPException(status_code=400, detail="Weekly overtime must start between 1 and 168 hours.")
    if data.get("ot_daily_hours") is not None and not (1 <= float(data["ot_daily_hours"]) <= 24):
        raise HTTPException(status_code=400, detail="Daily overtime must start between 1 and 24 hours.")
    if "work_week_start" in data and not (0 <= int(data["work_week_start"]) <= 6):
        raise HTTPException(status_code=400, detail="Pick the day your work week starts.")
    if "pay_period" in data and data["pay_period"] not in VALID_PAY_PERIODS:
        raise HTTPException(status_code=400, detail="Choose how often you pay: weekly, every two weeks, twice a month or monthly.")
    if data.get("auto_approve_rating_threshold") is not None:
        t = float(data["auto_approve_rating_threshold"])
```

---

## A7. `backend/src/routers/venues.py` (EDITS)
Settings update (sets the every-two-weeks start date when needed), roster fields, and the export (company filter + 3 trailing columns).

**Edit 1.** Find:
```python
        for field, value in data.items():
            setattr(venue, field, value)
        await db.commit()
        await db.refresh(venue)
```
Replace with:
```python
        for field, value in data.items():
            setattr(venue, field, value)
        # Phase 35: every-two-weeks pay with no start date yet -> a period starts this work week
        if venue.pay_period == "biweekly" and venue.pay_period_anchor is None:
            from src.services.pay_periods import week_start_for
            from src.services.fit import tz_of
            venue.pay_period_anchor = week_start_for(venue, datetime.now(timezone.utc).astimezone(tz_of(venue.timezone)).date())
        await db.commit()
        await db.refresh(venue)
```

**Edit 2.** Find:
```python
async def export_venue_payroll_csv(
    venue_id: UUID,
    start: Optional[date] = Query(None, description="Phase 33.1: first day (venue time), optional"),
    end: Optional[date] = Query(None, description="Phase 33.1: last day (venue time), optional"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
```
Replace with:
```python
async def export_venue_payroll_csv(
    venue_id: UUID,
    start: Optional[date] = Query(None, description="Phase 33.1: first day (venue time), optional"),
    end: Optional[date] = Query(None, description="Phase 33.1: last day (venue time), optional"),
    company: Optional[str] = Query(None, max_length=120, description="Phase 35: only people who work through this company"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
```

**Edit 3.** Find:
```python
    Calculates hours worked for workers at this venue.
    Phase 27: adds work location, clock-in/out location check, late minutes and auto-closed flags.
    """
    venue = await verify_venue_manager_access(venue_id, current_user, db)
```
Replace with:
```python
    Calculates hours worked for workers at this venue.
    Phase 27: adds work location, clock-in/out location check, late minutes and auto-closed flags.
    Phase 35: optional company filter; last three columns: Regular hours, Overtime hours, Works through.
    """
    venue = await verify_venue_manager_access(venue_id, current_user, db)
```

**Edit 4.** Find:
```python
        query = query.where(TimeEntry.clock_in_time < hi)
    records = (await db.execute(query)).all()

    entry_ids = [r[0].id for r in records]
```
Replace with:
```python
        query = query.where(TimeEntry.clock_in_time < hi)
    records = (await db.execute(query)).all()

    # Phase 35: staffing company (from the team list) and overtime under the venue's rules
    companies = dict((await db.execute(
        select(VenueWhitelist.worker_id, VenueWhitelist.works_through).where(
            VenueWhitelist.venue_id == venue_id, VenueWhitelist.works_through.isnot(None))
    )).all())
    if company:
        want = company.strip().lower()
        records = [r for r in records if (companies.get(r[1].id) or "").lower() == want]
    ot = {}
    if records:
        from src.services.pay_periods import overtime_for, local_date
        days = [local_date(r[0].clock_in_time, vtz) for r in records]
        ot = await overtime_for(db, venue, {r[1].id for r in records}, min(days), max(days))

    entry_ids = [r[0].id for r in records]
```

**Edit 5.** Find:
```python
        "Hourly rate", "Pay before tips", "Gets tips", "Tip pool", "Time changed by a manager",
        "Clock-in location", "Clock-out location", "Minutes late", "Clocked out automatically",
    ])

```
Replace with:
```python
        "Hourly rate", "Pay before tips", "Gets tips", "Tip pool", "Time changed by a manager",
        "Clock-in location", "Clock-out location", "Minutes late", "Clocked out automatically",
        "Regular hours", "Overtime hours", "Works through",                        # Phase 35 (added at the end)
    ])

```

**Edit 6.** Find:
```python
            clock_late_minutes(entry.clock_in_time, shift.start_time) or "",
            "Yes" if entry.auto_closed else "No",
        ])

```
Replace with:
```python
            clock_late_minutes(entry.clock_in_time, shift.start_time) or "",
            "Yes" if entry.auto_closed else "No",
            f"{max(0.0, hours - ot.get(entry.id, 0.0)):.2f}", f"{ot.get(entry.id, 0.0):.2f}",   # Phase 35
            companies.get(worker.id, ""),
        ])

```

**Edit 7.** Find:
```python
        for person in ps:
            person.cover = cover_by_request.get(person.request_id)
    waitlist_by_shift = defaultdict(list)
    for e, wu in (await db.execute(
```
Replace with:
```python
        for person in ps:
            person.cover = cover_by_request.get(person.request_id)
    # Phase 35: time tracking + staffing company on booked people
    from src.services.time_tracking import modes_for_requests
    shift_by_id = {s.id: s for s in shifts}
    tracking = await modes_for_requests(db, [(r, shift_by_id[r.shift_id]) for r, _u in req_rows if r.shift_id in shift_by_id])
    companies = dict((await db.execute(
        select(VenueWhitelist.worker_id, VenueWhitelist.works_through).where(
            VenueWhitelist.venue_id == venue_id, VenueWhitelist.works_through.isnot(None))
    )).all())
    for ps in list(assigned_by_shift.values()) + list(requested_by_shift.values()):
        for person in ps:
            person.time_tracking = tracking.get(person.request_id)
            person.works_through = companies.get(person.worker_id)
    waitlist_by_shift = defaultdict(list)
    for e, wu in (await db.execute(
```

---

## A8. `backend/src/routers/team.py` (EDITS)
Team list fields and saving time tracking / company (logged as `team_tracking`).

**Edit 1.** Find:
```python
                cert_wait[c.worker_id] = cert_wait.get(c.worker_id, 0) + 1

    out = []
    for wid, u in users.items():
```
Replace with:
```python
                cert_wait[c.worker_id] = cert_wait.get(c.worker_id, 0) + 1

    # Phase 35: time tracking (team members' venue default + this person's setting) and staffing company
    from src.services.time_tracking import resolve
    venue_mode = await db.scalar(select(Venue.team_time_tracking).where(Venue.id == venue_id))

    out = []
    for wid, u in users.items():
```

**Edit 2.** Find:
```python
            certs=sorted(cert_ok.get(wid, [])),
            cert_attention=cert_wait.get(wid, 0),
        ))
    out.sort(key=lambda m: ((m.first_name or "").lower(), (m.last_name or "").lower()))
```
Replace with:
```python
            certs=sorted(cert_ok.get(wid, [])),
            cert_attention=cert_wait.get(wid, 0),
            time_tracking=row.time_tracking if row is not None else None,              # Phase 35
            effective_time_tracking=resolve(venue_mode, row),
            works_through=row.works_through if row is not None else None,
        ))
    out.sort(key=lambda m: ((m.first_name or "").lower(), (m.last_name or "").lower()))
```

**Edit 3.** Find:
```python
        if "notes" in data:
            row.notes = (data["notes"] or "").strip()[:2000] or None

        if new_status == "blocked":
```
Replace with:
```python
        if "notes" in data:
            row.notes = (data["notes"] or "").strip()[:2000] or None
        # Phase 35: time tracking + staffing company (upcoming bookings follow; started ones keep what applied)
        if "time_tracking" in data:
            tt = (data["time_tracking"] or "venue").strip().lower()
            if tt not in ("venue", "payroll", "shiftboard"):
                raise HTTPException(status_code=400, detail="Choose how this person's time is tracked.")
            row.time_tracking = None if tt == "venue" else tt
        if "works_through" in data:
            from src.services.time_tracking import clean_company
            row.works_through = clean_company(data["works_through"])

        if new_status == "blocked":
```

**Edit 4.** Find:
```python
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")

    if new_status is not None:
        await activity.for_worker(
```
Replace with:
```python
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")

    if "time_tracking" in data or "works_through" in data:                          # Phase 35
        bits = []
        if "time_tracking" in data:
            bits.append({"payroll": "time tracked by the venue's payroll", "shiftboard": "clocks in with ShiftBoard"}
                        .get(row.time_tracking, "time tracking follows the venue setting"))
        if "works_through" in data:
            bits.append(f"works through {row.works_through}" if row.works_through else "no staffing company")
        await activity.for_worker("team_tracking", venue_id, worker_id, current_user.id,
                                  "{name}: " + ", ".join(bits).replace("{", "{{").replace("}", "}}"))
    if new_status is not None:
        await activity.for_worker(
```

---

## A9. `backend/src/routers/timesheets.py` (EDITS)
The pay-period lock on adding, editing and deleting times and on pay-rate changes.

**Edit 1.** Find:
```python
    ASSIGNED_STATUSES, as_utc, fmt_range, validate_times, require_reason, audit,
)

router = APIRouter(prefix="/api", tags=["Time Sheets"])
```
Replace with:
```python
    ASSIGNED_STATUSES, as_utc, fmt_range, validate_times, require_reason, audit,
)
from src.services.pay_periods import assert_unlocked          # Phase 35: approved pay periods are locked
from src.models import Venue

router = APIRouter(prefix="/api", tags=["Time Sheets"])
```

**Edit 2.** Find:
```python
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return entry, req, shift


```
Replace with:
```python
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return entry, req, shift


async def _locked_check(db: AsyncSession, shift: Shift, *moments) -> None:
    """Phase 35: refuse (409) when any of these times is inside an approved pay period at this venue."""
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    if venue is not None:
        await assert_unlocked(db, venue, *moments)


```

**Edit 3.** Find:
```python
    if body.pay_rate is not None and body.pay_rate <= 0:
        raise HTTPException(status_code=400, detail="Pay must be more than $0.")
    try:
        old = f"{float(req.pay_rate):.2f}" if req.pay_rate is not None else f"default {float(shift.hourly_rate):.2f}"
```
Replace with:
```python
    if body.pay_rate is not None and body.pay_rate <= 0:
        raise HTTPException(status_code=400, detail="Pay must be more than $0.")
    ins = (await db.execute(select(TimeEntry.clock_in_time).where(
        TimeEntry.shift_id == req.shift_id, TimeEntry.worker_id == req.worker_id))).scalars().all()
    await _locked_check(db, shift, *ins)                                  # Phase 35
    try:
        old = f"{float(req.pay_rate):.2f}" if req.pay_rate is not None else f"default {float(shift.hourly_rate):.2f}"
```

**Edit 4.** Find:
```python
        raise HTTPException(status_code=400, detail="Time can only be added for people booked on this shift.")
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
    reclaim = st == "no_show" and await _no_show_released_spot(db, req.id)   # Phase 30
    try:
```
Replace with:
```python
        raise HTTPException(status_code=400, detail="Time can only be added for people booked on this shift.")
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
    await _locked_check(db, shift, cin)                                   # Phase 35
    reclaim = st == "no_show" and await _no_show_released_spot(db, req.id)   # Phase 30
    try:
```

**Edit 5.** Find:
```python
    reason = require_reason(body.reason)
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
    try:
        old = fmt_range(entry.clock_in_time, entry.clock_out_time)
```
Replace with:
```python
    reason = require_reason(body.reason)
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
    await _locked_check(db, shift, entry.clock_in_time, cin)              # Phase 35: old and new day
    try:
        old = fmt_range(entry.clock_in_time, entry.clock_out_time)
```

**Edit 6.** Find:
```python
    entry, req, shift = await _load_entry(db, entry_id, current_user)
    reason = require_reason(body.reason)
    try:
        audit(db, req.id, entry.id, current_user.id, "delete", fmt_range(entry.clock_in_time, entry.clock_out_time), None, reason)
```
Replace with:
```python
    entry, req, shift = await _load_entry(db, entry_id, current_user)
    reason = require_reason(body.reason)
    await _locked_check(db, shift, entry.clock_in_time)                   # Phase 35
    try:
        audit(db, req.id, entry.id, current_user.id, "delete", fmt_range(entry.clock_in_time, entry.clock_out_time), None, reason)
```

---

## A10. NEW FILE `backend/src/routers/pay_periods.py`

```python
"""
Phase 35: Pay periods: totals per person, overtime, and approve / reopen (lock / unlock).
All dates are the venue's local dates.
"""
from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import PayPeriodApproval, TimeEntry, Shift, User
from src.schemas import (
    PayPeriodList, PayPeriodSummary, PayPeriodDetail, PayPeriodPerson, PayPeriodPayrollPerson, PayPeriodReopenBody,
)
from src.auth import require_manager_or_admin
from src.routers.venues import verify_venue_manager_access
from src.services import pay_periods as pp
from src.services.time_tracking import venue_companies
from src.services.clock import auto_close_open_entries
from src.services.fit import tz_of
from src.services import activity

router = APIRouter(prefix="/api/venues", tags=["Pay periods"])


def _ot_text(venue) -> str:
    parts = []
    if venue.ot_daily_hours is not None:
        parts.append(f"over {float(venue.ot_daily_hours):g} h a day")
    if venue.ot_weekly_hours is not None:
        parts.append(f"over {float(venue.ot_weekly_hours):g} h a week")
    return ("Overtime: " + " or ".join(parts)) if parts else "Overtime flags are off"


async def _summary(db: AsyncSession, venue, start: date, end: date, today: date, detail: bool = False,
                   company: Optional[str] = None):
    data = await pp.summarize(db, venue, start, end, company=company, people=detail)
    appr = await pp.approval_for(db, venue.id, start)
    last_reopen = await db.scalar(
        select(PayPeriodApproval).where(PayPeriodApproval.venue_id == venue.id, PayPeriodApproval.start_date == start,
                                        PayPeriodApproval.status == "reopened")
        .order_by(PayPeriodApproval.reopened_at.desc()).limit(1))
    approved_by = None
    if appr is not None and appr.approved_by_user_id:
        u = await db.scalar(select(User).where(User.id == appr.approved_by_user_id))
        approved_by = (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email) if u else None

    blocked = None
    if appr is not None:
        state = "approved"
    elif end >= today:
        state = "current"
        blocked = "This pay period hasn't ended yet."
    elif not venue.pay_period_approval:
        state = "not_required"
        blocked = "Approving pay periods is turned off in Venue settings."
    elif not data["people"] and not data["payroll_shifts"] and not data["open_entries"] and company is None:
        state = "empty"
        blocked = "Nobody worked in this pay period, so there's nothing to approve."
    else:
        state = "ready"
        if data["open_entries"]:
            n = data["open_entries"]
            blocked = f"{n} time entr{'y is' if n == 1 else 'ies are'} still open. Fix the clock-out time first."
    base = dict(
        start_date=start, end_date=end, label=pp.period_label(start, end), state=state,
        can_approve=state == "ready" and blocked is None, blocked_reason=blocked if state != "approved" else None,
        people=data["people"], total_hours=data["total_hours"], overtime_hours=data["overtime_hours"],
        total_pay=data["total_pay"], open_entries=data["open_entries"],
        payroll_people=data["payroll_people"], payroll_shifts=data["payroll_shifts"],
        approved_at=appr.approved_at if appr else None, approved_by=approved_by,
        last_reopened_at=last_reopen.reopened_at if last_reopen else None,
        last_reopen_reason=last_reopen.reopen_reason if last_reopen else None,
    )
    if not detail:
        return PayPeriodSummary(**base)
    return PayPeriodDetail(
        **base,
        rows=[PayPeriodPerson(**r) for r in data["rows"]],
        payroll_rows=[PayPeriodPayrollPerson(**r) for r in data["payroll_rows"]],
    )


def _today(venue) -> date:
    return datetime.now(timezone.utc).astimezone(tz_of(venue.timezone)).date()


@router.get("/{venue_id}/pay-periods", response_model=PayPeriodList)
async def list_pay_periods(
    venue_id: UUID,
    count: int = Query(6, ge=1, le=26),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """The current pay period and the ones before it, with totals and approval state."""
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    await auto_close_open_entries(db, venue_id=venue_id)
    today = _today(venue)
    periods = [await _summary(db, venue, s, e, today) for s, e in pp.recent_periods(venue, today, count)]
    return PayPeriodList(
        pay_period=venue.pay_period or "weekly", approval_on=bool(venue.pay_period_approval),
        overtime_text=_ot_text(venue), timezone=venue.timezone or "America/New_York",
        companies=await venue_companies(db, venue_id), periods=periods,
    )


@router.get("/{venue_id}/pay-periods/{start}", response_model=PayPeriodDetail)
async def get_pay_period(
    venue_id: UUID,
    start: date,
    company: Optional[str] = Query(None, max_length=120),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """One pay period: a row per person (hours, overtime, pay, flags), plus people the venue's payroll tracks."""
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    s, e = pp.check_period_start(venue, start)
    return await _summary(db, venue, s, e, _today(venue), detail=True, company=company)


@router.post("/{venue_id}/pay-periods/{start}/approve", response_model=PayPeriodDetail)
async def approve_pay_period(
    venue_id: UUID,
    start: date,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Approve and lock: after this, nobody can change times or pay rates in the period until it's reopened."""
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    s, e = pp.check_period_start(venue, start)
    await auto_close_open_entries(db, venue_id=venue_id)
    current = await _summary(db, venue, s, e, _today(venue))
    if current.state == "approved":
        raise HTTPException(status_code=400, detail="This pay period is already approved.")
    if not current.can_approve:
        raise HTTPException(status_code=400, detail=current.blocked_reason or "This pay period can't be approved yet.")
    try:
        db.add(PayPeriodApproval(
            venue_id=venue.id, start_date=s, end_date=e, status="approved", people=current.people,
            total_hours=current.total_hours, overtime_hours=current.overtime_hours, total_pay=current.total_pay,
            approved_by_user_id=current_user.id, approved_at=datetime.now(timezone.utc),
        ))
        await db.commit()
    except Exception as ex:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not approve the pay period: {ex}")
    await activity.for_venue("pay_period_approved", venue_id, current_user.id,
                             f"Approved and locked pay period {pp.period_label(s, e)} "
                             f"({current.total_hours:g} h, ${current.total_pay:,.2f})")
    return await _summary(db, venue, s, e, _today(venue), detail=True)


@router.post("/{venue_id}/pay-periods/{start}/reopen", response_model=PayPeriodDetail)
async def reopen_pay_period(
    venue_id: UUID,
    start: date,
    body: PayPeriodReopenBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Unlock an approved pay period (with a reason) so its times can be fixed. Approve it again afterwards."""
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    s, e = pp.check_period_start(venue, start)
    reason = (body.reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=400, detail="Say why you're reopening it.")
    appr = await pp.approval_for(db, venue.id, s)
    if appr is None:
        raise HTTPException(status_code=400, detail="This pay period isn't approved.")
    try:
        appr.status = "reopened"
        appr.reopened_by_user_id = current_user.id
        appr.reopened_at = datetime.now(timezone.utc)
        appr.reopen_reason = reason[:500]
        await db.commit()
    except Exception as ex:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not reopen the pay period: {ex}")
    await activity.for_venue("pay_period_reopened", venue_id, current_user.id,
                             f"Reopened pay period {pp.period_label(s, e)}: “{reason[:200]}”")
    return await _summary(db, venue, s, e, _today(venue), detail=True)
```

---

## A11. `backend/src/main.py` (EDITS)
**Only** the router import and registration. Nothing else in `main.py` changes.

**Edit 1.** Find:
```python
from src.routers.profile import router as profile_router   # Phase 31 + 32
from src.routers.cover import router as cover_router       # Phase 34
from src.services.notification_worker import notification_worker_loop
from src.version import APP_VERSION                          # Phase 34.5
```
Replace with:
```python
from src.routers.profile import router as profile_router   # Phase 31 + 32
from src.routers.cover import router as cover_router       # Phase 34
from src.routers.pay_periods import router as pay_periods_router   # Phase 35
from src.services.notification_worker import notification_worker_loop
from src.version import APP_VERSION                          # Phase 34.5
```

**Edit 2.** Find:
```python
app.include_router(profile_router)   # Phase 31 + 32
app.include_router(cover_router)     # Phase 34


```
Replace with:
```python
app.include_router(profile_router)   # Phase 31 + 32
app.include_router(cover_router)     # Phase 34
app.include_router(pay_periods_router)   # Phase 35


```

---

## A12. `backend/src/services/clock.py` (EDIT)
Clock-in is refused for payroll-tracked bookings.

**Edit 1.** Find:
```python
    if req is None:
        raise HTTPException(status_code=400, detail="You're not booked on this shift.")

    open_entry = await db.scalar(
```
Replace with:
```python
    if req is None:
        raise HTTPException(status_code=400, detail="You're not booked on this shift.")

    # Phase 35: the venue's own payroll system tracks this person's time
    from src.services.time_tracking import mode_for, PAYROLL
    if await mode_for(db, req, shift) == PAYROLL:
        raise HTTPException(
            status_code=400,
            detail=f"At {venue.name} your time is tracked by the venue's own payroll system, so you don't clock in "
                   "in ShiftBoard. Use the venue's time clock.",
        )

    open_entry = await db.scalar(
```

---

## A13. `backend/src/services/notification_worker.py` (EDITS)
New `scan_tracking` (first in each tick); the late scan skips payroll-tracked people.

**Edit 1.** Find:
```python
  5c. cover requests: close stale ones, warn 12 h / 3 h before start if nobody took it (Phase 34)
  5d. waitlists: give opened spots to the next person in line, expire old offers (Phase 34)
  6. send due email / SMS from the outbox

```
Replace with:
```python
  5c. cover requests: close stale ones, warn 12 h / 3 h before start if nobody took it (Phase 34)
  5d. waitlists: give opened spots to the next person in line, expire old offers (Phase 34)
  0.  Phase 35: bookings whose shift started get their time-tracking mode written (payroll | shiftboard),
      so late alerts, reliability and pay use what applied at the start even if settings change later
  6. send due email / SMS from the outbox

```

**Edit 2.** Find:
```python
    sent = 0
    rows = await _booked_rows(db, now - timedelta(hours=24), now - LATE_AFTER, BOOKED_NOT_STARTED)
    for r, s, ev, venue, loc in rows:
        if _as_utc(s.end_time) <= now:
            continue
        has_entry = await db.scalar(
            select(func.count(TimeEntry.id)).where(TimeEntry.shift_id == s.id, TimeEntry.worker_id == r.worker_id)
```
Replace with:
```python
    sent = 0
    rows = await _booked_rows(db, now - timedelta(hours=24), now - LATE_AFTER, BOOKED_NOT_STARTED)
    from src.services.time_tracking import modes_for_requests, PAYROLL      # Phase 35
    modes = await modes_for_requests(db, [(r, s) for r, s, *_ in rows])
    for r, s, ev, venue, loc in rows:
        if _as_utc(s.end_time) <= now:
            continue
        if modes.get(r.id) == PAYROLL:
            continue                           # Phase 35: the venue's own payroll tracks their time
        has_entry = await db.scalar(
            select(func.count(TimeEntry.id)).where(TimeEntry.shift_id == s.id, TimeEntry.worker_id == r.worker_id)
```

**Edit 3.** Find:
```python


async def scan_cover(db: AsyncSession, now: datetime) -> int:
    """Phase 34: close stale cover posts, then warn the worker + managers 12 h / 3 h before the start."""
```
Replace with:
```python


async def scan_tracking(db: AsyncSession, now: datetime) -> int:
    """Phase 35: write the time-tracking mode on bookings whose shift has started."""
    from src.services.time_tracking import freeze_started
    return await freeze_started(db, now)


async def scan_cover(db: AsyncSession, now: datetime) -> int:
    """Phase 34: close stale cover posts, then warn the worker + managers 12 h / 3 h before the start."""
```

**Edit 4.** Find:
```python
    async with AsyncSessionLocal() as db:
        await auto_close_open_entries(db)
    for label, fn in (("reminders", scan_reminders), ("late", scan_late), ("unread", scan_unread_updates),
                      ("unfilled", scan_unfilled), ("certs", scan_expiring_certs), ("cover", scan_cover)):
        try:
```
Replace with:
```python
    async with AsyncSessionLocal() as db:
        await auto_close_open_entries(db)
    for label, fn in (("tracking", scan_tracking), ("reminders", scan_reminders), ("late", scan_late), ("unread", scan_unread_updates),
                      ("unfilled", scan_unfilled), ("certs", scan_expiring_certs), ("cover", scan_cover)):
        try:
```

---

## A14. `backend/src/services/reliability.py` (EDITS)

**Edit 1.** Find:
```python
    Returns score=None when the worker has zero commitments.
    Shifts that have not ended yet are ignored. Drops with >= 72h notice are excused.
    """
    if not worker_ids:
```
Replace with:
```python
    Returns score=None when the worker has zero commitments.
    Shifts that have not ended yet are ignored. Drops with >= 72h notice are excused.
    Phase 35: a shift whose time the venue's own payroll tracks has no ShiftBoard clock-in; it counts as worked
    and on time unless a manager marked a no-show.
    """
    if not worker_ids:
```

**Edit 2.** Find:
```python
            Shift.start_time,
            Shift.end_time,
        )
        .join(Shift, ShiftRequest.shift_id == Shift.id)
```
Replace with:
```python
            Shift.start_time,
            Shift.end_time,
            ShiftRequest.time_tracking,          # Phase 35
            Shift.venue_id,
        )
        .join(Shift, ShiftRequest.shift_id == Shift.id)
```

**Edit 3.** Find:
```python
    first_clock_in = {(w, s): _aware(t) for w, s, t in te_rows}

    for worker_id, shift_id, req_status, dropped_at, check_in_time, start_time, end_time in rows:
        st = stats.get(worker_id)
        if st is None:
```
Replace with:
```python
    first_clock_in = {(w, s): _aware(t) for w, s, t in te_rows}

    # Phase 35: time-tracking mode for finished shifts with no clock-in (written at the start; else current settings)
    from src.services.time_tracking import live_modes, PAYROLL, MODES
    live = await live_modes(db, [(r[8], r[0]) for r in rows if r[7] not in MODES])

    for worker_id, shift_id, req_status, dropped_at, check_in_time, start_time, end_time, tracking, venue_id in rows:
        st = stats.get(worker_id)
        if st is None:
```

**Edit 4.** Find:
```python

        clock_in = first_clock_in.get((worker_id, shift_id)) or _aware(check_in_time)
        if clock_in is None:
            st["no_show"] += 1
        else:
```
Replace with:
```python

        clock_in = first_clock_in.get((worker_id, shift_id)) or _aware(check_in_time)
        mode = tracking if tracking in MODES else live.get((venue_id, worker_id))
        if clock_in is None and mode == PAYROLL:
            st["completed"] += 1                 # Phase 35: worked, tracked by the venue's payroll
            st["on_time"] += 1
        elif clock_in is None:
            st["no_show"] += 1
        else:
```

---

## A15. `backend/src/services/tonight.py` (EDITS)
The `payroll` clock state on the Today board.

**Edit 1.** Find:
```python
             missed   - shift ended, never clocked in, not marked no-show yet
             no_show  - marked no-show
  alerts : what needs the manager right now, most urgent first
  week   : today + the next 6 days at a glance (drafts included, flagged)
```
Replace with:
```python
             missed   - shift ended, never clocked in, not marked no-show yet
             no_show  - marked no-show
             payroll  - Phase 35: the venue's own payroll tracks their time (no ShiftBoard clock-in expected)
  alerts : what needs the manager right now, most urgent first
  week   : today + the next 6 days at a glance (drafts included, flagged)
```

**Edit 2.** Find:
```python


def clock_state(req_status: str, entries: list, shift: Shift, venue: Venue, now: datetime):
    """Returns (state, late_minutes, first_in, last_out)."""
    if req_status == "no_show":
        return "no_show", 0, None, None
    start, end = as_utc(shift.start_time), as_utc(shift.end_time)
    if entries:
```
Replace with:
```python


def clock_state(req_status: str, entries: list, shift: Shift, venue: Venue, now: datetime, payroll: bool = False):
    """Returns (state, late_minutes, first_in, last_out)."""
    if req_status == "no_show":
        return "no_show", 0, None, None
    if payroll and not entries:
        return "payroll", 0, None, None          # Phase 35
    start, end = as_utc(shift.start_time), as_utc(shift.end_time)
    if entries:
```

**Edit 3.** Find:
```python
            entries[(e.shift_id, e.worker_id)].append(e)

    def info_seen(req, s):
        ev = events.get(s.event_id)
```
Replace with:
```python
            entries[(e.shift_id, e.worker_id)].append(e)

    # Phase 35: who clocks in with the venue's own payroll system
    from src.services.time_tracking import modes_for_requests, PAYROLL
    by_shift = {s.id: s for s in shifts}
    tracking = await modes_for_requests(db, [(req, by_shift[sid]) for sid, lst in reqs.items() for req, _u in lst])

    def info_seen(req, s):
        ev = events.get(s.event_id)
```

**Edit 4.** Find:
```python
            st = (req.status or "").lower()
            es = entries.get((s.id, u.id), [])
            state, late, first_in, last_out = clock_state(st, es, s, venue, now)
            seen = info_seen(req, s) if st in BOOKED_STATUSES else None
            first_entry = min(es, key=lambda e: as_utc(e.clock_in_time)) if es else None
```
Replace with:
```python
            st = (req.status or "").lower()
            es = entries.get((s.id, u.id), [])
            state, late, first_in, last_out = clock_state(st, es, s, venue, now, tracking.get(req.id) == PAYROLL)
            seen = info_seen(req, s) if st in BOOKED_STATUSES else None
            first_entry = min(es, key=lambda e: as_utc(e.clock_in_time)) if es else None
```

**Edit 5.** Find:
```python
        te.missed = sum(1 for p in ps if p.clock_state == "missed")
        te.no_show = sum(1 for p in ps if p.clock_state == "no_show")
        te.unread = sum(1 for p in ps if p.info_seen is False and p.clock_state in ("upcoming", "due", "late"))
        te.open_spots = sum(pos.open_spots for pos in te.positions)
        if te.unread and te.state != "ended":
```
Replace with:
```python
        te.missed = sum(1 for p in ps if p.clock_state == "missed")
        te.no_show = sum(1 for p in ps if p.clock_state == "no_show")
        te.unread = sum(1 for p in ps if p.info_seen is False and (
            p.clock_state in ("upcoming", "due", "late") or (p.clock_state == "payroll" and te.state != "ended")))
        te.open_spots = sum(pos.open_spots for pos in te.positions)
        if te.unread and te.state != "ended":
```

---

## A16. `backend/src/services/worker_calendar.py` (EDITS)

**Edit 1.** Find:
```python
    if not rows:
        return WorkerCalendarResponse(range_start=range_start, range_end=range_end, unread_count=0, items=[])

    shifts = [s for _, s in rows]
```
Replace with:
```python
    if not rows:
        return WorkerCalendarResponse(range_start=range_start, range_end=range_end, unread_count=0, items=[])
    from src.services.time_tracking import modes_for_requests                     # Phase 35
    tracking = await modes_for_requests(db, rows)

    shifts = [s for _, s in rows]
```

**Edit 2.** Find:
```python
            geofence_on=geofence_on(event, venue),
            clock_in_opens_at=clock_in_opens_at(s, venue),
            time_entry_id=open_entries.get(s.id),
            hourly_rate=float(s.hourly_rate) if (show_pay and s.hourly_rate is not None) else None,
```
Replace with:
```python
            geofence_on=geofence_on(event, venue),
            clock_in_opens_at=clock_in_opens_at(s, venue),
            time_tracking=tracking.get(req.id, "shiftboard"),                    # Phase 35
            time_entry_id=open_entries.get(s.id),
            hourly_rate=float(s.hourly_rate) if (show_pay and s.hourly_rate is not None) else None,
```

---

## A17. `backend/src/services/earnings.py` (EDITS)

**Edit 1.** Find:
```python
            )
        )).all()
    up_hours = up_pay = 0.0
    for req, shift in upcoming_rows:
```
Replace with:
```python
            )
        )).all()
    # Phase 35: shifts a venue's own payroll tracks aren't ShiftBoard hours: leave them out, and say so
    from src.services.time_tracking import modes_for_requests, PAYROLL
    period_rows = (await db.execute(
        select(ShiftRequest, Shift, Venue)
        .join(Shift, Shift.id == ShiftRequest.shift_id).join(Venue, Venue.id == Shift.venue_id)
        .where(ShiftRequest.worker_id == user.id, func.lower(ShiftRequest.status).in_(BOOKED + ("completed",)),
               Shift.start_time >= lo, Shift.start_time < hi, func.upper(Shift.status) != "CANCELLED")
    )).all()
    modes = await modes_for_requests(db, [(r, s) for r, s, _v in period_rows])
    payroll_rows = [(r, s, v) for r, s, v in period_rows if modes.get(r.id) == PAYROLL]
    payroll_ids = {r.id for r, _s, _v in payroll_rows}
    upcoming_rows = [(r, s) for r, s in upcoming_rows if r.id not in payroll_ids]

    up_hours = up_pay = 0.0
    for req, shift in upcoming_rows:
```

**Edit 2.** Find:
```python
        shifts=list(reversed(shifts)),                # newest first
        upcoming=EarningsUpcoming(shifts=len(upcoming_rows), hours=round(up_hours, 2), est_pay=round(up_pay, 2)),
    )

```
Replace with:
```python
        shifts=list(reversed(shifts)),                # newest first
        upcoming=EarningsUpcoming(shifts=len(upcoming_rows), hours=round(up_hours, 2), est_pay=round(up_pay, 2)),
        payroll_shifts=len(payroll_rows),                                              # Phase 35
        payroll_venues=sorted({v.name for _r, _s, v in payroll_rows}),
    )

```

---

## A18. `backend/src/services/timesheets.py` (EDITS)

**Edit 1.** Find:
```python
            )).scalars().all())

    people = []
    for req, worker in rows:
```
Replace with:
```python
            )).scalars().all())

    # Phase 35: time tracking, company and overtime
    from src.services.time_tracking import modes_for_requests
    from src.services.pay_periods import overtime_for, local_date
    from src.services.fit import tz_of
    from src.models import VenueWhitelist
    tracking = await modes_for_requests(db, [(req, by_id[req.shift_id]) for req, _w in rows])
    companies = dict((await db.execute(
        select(VenueWhitelist.worker_id, VenueWhitelist.works_through).where(
            VenueWhitelist.venue_id == venue.id, VenueWhitelist.worker_id.in_([w.id for _r, w in rows] or [None]))
    )).all()) if rows else {}
    all_entries = [e for es in entries_map.values() for e in es]
    ot = {}
    if all_entries:
        vtz = tz_of(venue.timezone)
        days = [local_date(e.clock_in_time, vtz) for e in all_entries]
        ot = await overtime_for(db, venue, {e.worker_id for e in all_entries}, min(days), max(days))

    people = []
    for req, worker in rows:
```

**Edit 2.** Find:
```python
            total_hours=round(total, 2),
            est_pay=round(total * rate, 2),
        ))

```
Replace with:
```python
            total_hours=round(total, 2),
            est_pay=round(total * rate, 2),
            time_tracking=tracking.get(req.id, "shiftboard"),                      # Phase 35
            works_through=companies.get(worker.id),
            overtime_hours=round(sum(ot.get(e.id, 0.0) for e in es), 2),
        ))

```

---

## A19. `backend/src/services/activity.py` (EDITS)

**Edit 1.** Find:
```python
    "team_account": "team",
    "team_status": "team",
    "invites_sent": "team",
    "team_joined": "team",
```
Replace with:
```python
    "team_account": "team",
    "team_status": "team",
    "team_tracking": "team",             # Phase 35: time tracking / staffing company changed
    "invites_sent": "team",
    "team_joined": "team",
```

**Edit 2.** Find:
```python
    "template_deleted": "changes",
    "venue_settings": "changes",
    "not_clocked_in": "alerts",
    "no_show": "alerts",                # Phase 30
```
Replace with:
```python
    "template_deleted": "changes",
    "venue_settings": "changes",
    "pay_period_approved": "changes",    # Phase 35
    "pay_period_reopened": "changes",
    "not_clocked_in": "alerts",
    "no_show": "alerts",                # Phase 30
```

---

# PART B: Frontend

## B1. `frontend/src/components/VenueSettingsModal.jsx` (EDITS)
The Time & pay periods tab (a `TimePayTab` component at the end of the file), its form fields and the save payload.

**Edit 1.** Find:
```jsx
import React, { useState, useEffect } from 'react';
import { Building2, MapPin, Crosshair, ExternalLink, Plus, Trash2, Save, RotateCcw, Info, EyeOff, Clock } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```
Replace with:
```jsx
import React, { useState, useEffect } from 'react';
import { Building2, MapPin, Crosshair, ExternalLink, Plus, Trash2, Save, RotateCcw, Info, EyeOff, Clock, Timer, CalendarRange } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```

**Edit 2.** Find:
```jsx
];

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
```
Replace with:
```jsx
];

// Phase 35: time tracking, overtime and pay periods
const TRACKING = [
  { id: 'shiftboard', title: 'Clock in with ShiftBoard', body: 'Your team clocks in and out here. Their hours show on time sheets, exports and pay periods.' },
  { id: 'payroll', title: "Your venue's payroll tracks their time", body: "Team members use your own time clock or payroll system. ShiftBoard shows no clock-in button and sends no \"not clocked in\" alerts for them." },
];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];   // 0 = Monday
const PAY_PERIODS = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'biweekly', label: 'Every two weeks' },
  { id: 'semimonthly', label: 'Twice a month (1st and 16th)' },
  { id: 'monthly', label: 'Monthly' },
];

const fieldCls = 'px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';   // Phase 35: no width
const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
```

**Edit 3.** Find:
```jsx
    description: venue?.description || '',
    manager_email: '',
  };
}
```
Replace with:
```jsx
    description: venue?.description || '',
    manager_email: '',
    // Phase 35
    team_time_tracking: venue?.team_time_tracking || 'shiftboard',
    ot_weekly_on: venue ? venue.ot_weekly_hours != null : true,
    ot_weekly_hours: String(venue?.ot_weekly_hours ?? 40),
    ot_daily_on: venue?.ot_daily_hours != null,
    ot_daily_hours: String(venue?.ot_daily_hours ?? 8),
    work_week_start: String(venue?.work_week_start ?? 0),
    pay_period: venue?.pay_period || 'weekly',
    pay_period_anchor: venue?.pay_period_anchor || '',
    pay_period_approval: venue?.pay_period_approval ?? true,
  };
}
```

**Edit 4.** Find:
```jsx
      description: form.description,
    };
    if (lat !== null) {
      payload.lat = lat;
```
Replace with:
```jsx
      description: form.description,
    };
    // Phase 35: time & pay
    const otWeekly = parseFloat(form.ot_weekly_hours);
    const otDaily = parseFloat(form.ot_daily_hours);
    if (form.ot_weekly_on && (Number.isNaN(otWeekly) || otWeekly < 1 || otWeekly > 168)) {
      setTab('timepay');
      return setError('Weekly overtime must start between 1 and 168 hours.');
    }
    if (form.ot_daily_on && (Number.isNaN(otDaily) || otDaily < 1 || otDaily > 24)) {
      setTab('timepay');
      return setError('Daily overtime must start between 1 and 24 hours.');
    }
    payload.team_time_tracking = form.team_time_tracking;
    payload.ot_weekly_hours = form.ot_weekly_on ? otWeekly : null;
    payload.ot_daily_hours = form.ot_daily_on ? otDaily : null;
    payload.work_week_start = parseInt(form.work_week_start, 10) || 0;
    payload.pay_period = form.pay_period;
    if (form.pay_period === 'biweekly' && form.pay_period_anchor) payload.pay_period_anchor = form.pay_period_anchor;
    payload.pay_period_approval = !!form.pay_period_approval;
    if (lat !== null) {
      payload.lat = lat;
```

**Edit 5.** Find:
```jsx
      {[
        { id: 'details', label: 'Details' },
        { id: 'positions', label: 'Positions & pay' },
        { id: 'locations', label: 'Locations' },
```
Replace with:
```jsx
      {[
        { id: 'details', label: 'Details' },
        { id: 'timepay', label: 'Time & pay periods' },   // Phase 35
        { id: 'positions', label: 'Positions & pay' },
        { id: 'locations', label: 'Locations' },
```

**Edit 6.** Find:
```jsx
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
        {tab === 'details' ? 'Cancel' : 'Done'}
      </button>
      {tab === 'details' && (
        <button type="button" onClick={handleSave} disabled={saving}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50">
```
Replace with:
```jsx
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
        {tab === 'details' || tab === 'timepay' ? 'Cancel' : 'Done'}
      </button>
      {(tab === 'details' || tab === 'timepay') && (
        <button type="button" onClick={handleSave} disabled={saving}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50">
```

**Edit 7.** Find:
```jsx
          </div>
        </div>
      ) : tab === 'locations' ? (
        <VenueLocationsPanel venue={venue} onError={setError} />
```
Replace with:
```jsx
          </div>
        </div>
      ) : tab === 'timepay' ? (
        <TimePayTab form={form} setForm={setForm} set={set} />
      ) : tab === 'locations' ? (
        <VenueLocationsPanel venue={venue} onError={setError} />
```

**Edit 8.** Find:
```jsx
    </ModalShell>
  );
}
```
Replace with:
```jsx
    </ModalShell>
  );
}

// Phase 35: how time is tracked, overtime rules and pay periods. Saved with "Save changes" like Details.
function TimePayTab({ form, setForm, set }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="space-y-4">
        <div className={cardCls}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Timer className="w-4 h-4 text-emerald-400" /> How your team's time is tracked
          </div>
          <div className="grid gap-2">
            {TRACKING.map((t) => (
              <label key={t.id}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${form.team_time_tracking === t.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'}`}>
                <input type="radio" name="team_time_tracking" value={t.id} checked={form.team_time_tracking === t.id}
                  onChange={set('team_time_tracking')} className="mt-1 text-emerald-500" />
                <span>
                  <span className="block text-sm font-semibold text-white">{t.title}</span>
                  <span className="block text-xs text-slate-400">{t.body}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              This is for people on your team. People booked from outside your team, and team members who work through
              a staffing company, always clock in with ShiftBoard. You can change any one person under Team → Edit.
              A shift keeps the setting it had when it started, so changing this later doesn't rewrite past hours.
            </span>
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className={cardCls}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Clock className="w-4 h-4 text-emerald-400" /> Overtime flags
          </div>
          <p className="text-[11px] text-slate-500">
            ShiftBoard marks hours past these limits as overtime on time sheets, pay periods and the hours download.
            It doesn't change the pay it shows. Only hours clocked in ShiftBoard count.
          </p>
          <label className="flex items-center gap-3 flex-wrap">
            <input type="checkbox" checked={!!form.ot_weekly_on} onChange={(e) => setForm({ ...form, ot_weekly_on: e.target.checked })}
              className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
            <span className="text-sm text-white">Over</span>
            <input type="number" min="1" max="168" step="0.5" aria-label="Weekly overtime hours" disabled={!form.ot_weekly_on}
              value={form.ot_weekly_hours} onChange={set('ot_weekly_hours')} className={`${fieldCls} w-20 disabled:opacity-40`} />
            <span className="text-sm text-white">hours in a work week</span>
          </label>
          <label className="flex items-center gap-3 flex-wrap">
            <input type="checkbox" checked={!!form.ot_daily_on} onChange={(e) => setForm({ ...form, ot_daily_on: e.target.checked })}
              className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
            <span className="text-sm text-white">Over</span>
            <input type="number" min="1" max="24" step="0.5" aria-label="Daily overtime hours" disabled={!form.ot_daily_on}
              value={form.ot_daily_hours} onChange={set('ot_daily_hours')} className={`${fieldCls} w-20 disabled:opacity-40`} />
            <span className="text-sm text-white">hours in a day</span>
          </label>
          <div>
            <label className={labelCls} htmlFor="work-week-start">Work week starts on</label>
            <select id="work-week-start" value={form.work_week_start} onChange={set('work_week_start')} className={`${fieldCls} w-44`}>
              {WEEKDAYS.map((d, i) => <option key={d} value={String(i)}>{d}</option>)}
            </select>
          </div>
        </div>

        <div className={cardCls}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarRange className="w-4 h-4 text-emerald-400" /> Pay periods
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="pay-period">How often you pay</label>
              <select id="pay-period" value={form.pay_period} onChange={set('pay_period')} className={inputCls}>
                {PAY_PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            {form.pay_period === 'biweekly' && (
              <div>
                <label className={labelCls} htmlFor="pay-anchor">First day of any pay period</label>
                <input id="pay-anchor" type="date" value={form.pay_period_anchor} onChange={set('pay_period_anchor')} className={inputCls} />
                <p className="text-[11px] text-slate-500 mt-1">Blank = starts this work week.</p>
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-500">Weekly periods start on the work-week day above.</p>
          <label className="flex items-start gap-3 cursor-pointer pt-2 border-t border-slate-800">
            <input type="checkbox" checked={!!form.pay_period_approval}
              onChange={(e) => setForm({ ...form, pay_period_approval: e.target.checked })}
              className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
            <span>
              <span className="block text-sm font-semibold text-white">Approve and lock each pay period</span>
              <span className="block text-xs text-slate-400">
                After a period ends, a manager approves it on the Pay periods screen. Approved periods are locked: nobody can
                change their times or pay rates until a manager reopens them with a reason.
              </span>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
```

---

## B2. `frontend/src/components/TeamModal.jsx` (EDITS)
Time tracking + company in the member editor, chips on rows, company suggestions and search.

**Edit 1.** Find:
```jsx
  Users, UserPlus, Link2, Copy, Download, RefreshCw, Mail, Phone, Upload, ShieldCheck, Trash2, Ban,
  RotateCcw, Pencil, Search, Check, X, KeyRound, Send, UserCog, ChevronDown, ChevronRight, AlertTriangle, Plus, BadgeCheck,
} from 'lucide-react';
import api from '../api/client';
```
Replace with:
```jsx
  Users, UserPlus, Link2, Copy, Download, RefreshCw, Mail, Phone, Upload, ShieldCheck, Trash2, Ban,
  RotateCcw, Pencil, Search, Check, X, KeyRound, Send, UserCog, ChevronDown, ChevronRight, AlertTriangle, Plus, BadgeCheck,
  Building2, Timer,
} from 'lucide-react';
import api from '../api/client';
```

**Edit 2.** Find:
```jsx
  worked: 'Worked here',
};
const INVITE_CHIP = {
  pending: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
```
Replace with:
```jsx
  worked: 'Worked here',
};
// Phase 35: how this person's time is tracked at this venue
const TRACKING_OPTIONS = [
  ['venue', 'Use the venue setting'],
  ['payroll', "Venue's payroll (no clock-in here)"],
  ['shiftboard', 'Clock in with ShiftBoard'],
];

const INVITE_CHIP = {
  pending: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
```

**Edit 3.** Find:
```jsx
];

function MemberRow({ m, venueId, timeZone, positionOptions, open, onToggle, onUpdated, onMessage }) {
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState(m.positions || []);
  const [notes, setNotes] = useState(m.notes || '');
  const [confirm, setConfirm] = useState(null); // 'blocked' | 'removed'
  const [busy, setBusy] = useState(false);
```
Replace with:
```jsx
];

function MemberRow({ m, venueId, timeZone, positionOptions, companies = [], open, onToggle, onUpdated, onMessage }) {
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState(m.positions || []);
  const [notes, setNotes] = useState(m.notes || '');
  const [tracking, setTracking] = useState(m.time_tracking || 'venue');      // Phase 35
  const [company, setCompany] = useState(m.works_through || '');            // Phase 35
  const [confirm, setConfirm] = useState(null); // 'blocked' | 'removed'
  const [busy, setBusy] = useState(false);
```

**Edit 4.** Find:
```jsx
              </span>
            ))}
            {m.cert_attention > 0 && (
              <span className="text-[10px] text-sky-300" title="Open the row to check and verify">• {m.cert_attention} to verify</span>
```
Replace with:
```jsx
              </span>
            ))}
            {/* Phase 35: time tracking + staffing company */}
            {m.status === 'active' && m.effective_time_tracking === 'payroll' && (
              <span title="Their time is tracked by the venue's own payroll. They don't clock in here."
                className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/30 text-[9px] font-bold inline-flex items-center gap-0.5">
                <Timer className="w-2.5 h-2.5" /> Venue payroll
              </span>
            )}
            {m.works_through && (
              <span title="Works through this company" className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30 text-[9px] font-bold inline-flex items-center gap-0.5">
                <Building2 className="w-2.5 h-2.5" /> {m.works_through}
              </span>
            )}
            {m.cert_attention > 0 && (
              <span className="text-[10px] text-sky-300" title="Open the row to check and verify">• {m.cert_attention} to verify</span>
```

**Edit 5.** Find:
```jsx
            {!editing && (
              <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
                <Pencil className="w-3.5 h-3.5" /> Positions & note
              </button>
            )}
```
Replace with:
```jsx
            {!editing && (
              <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
```

**Edit 6.** Find:
```jsx
                  placeholder="e.g. Great with VIP tables. Prefers weekends." />
              </div>
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => patch({ positions, notes })}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className={btnGhost} onClick={() => { setEditing(false); setPositions(m.positions || []); setNotes(m.notes || ''); }}>
                  Cancel
                </button>
```
Replace with:
```jsx
                  placeholder="e.g. Great with VIP tables. Prefers weekends." />
              </div>
              {/* Phase 35: time tracking + staffing company */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor={`tt-${m.worker_id}`}>How their time is tracked</label>
                  <select id={`tt-${m.worker_id}`} value={tracking} onChange={(e) => setTracking(e.target.value)} className={inputCls}>
                    {TRACKING_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor={`wt-${m.worker_id}`}>Works through (staffing company)</label>
                  <input id={`wt-${m.worker_id}`} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120}
                    list={`companies-${venueId}`} className={inputCls} placeholder="Blank = your own staff" />
                  <datalist id={`companies-${venueId}`}>
                    {companies.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                "Use the venue setting" follows Venue settings → Time & pay periods. People who work through a staffing company
                clock in with ShiftBoard unless you pick otherwise here. Shifts that already started keep the setting they had.
              </p>
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} disabled={busy}
                  onClick={() => patch({ positions, notes, time_tracking: tracking, works_through: company.trim() })}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className={btnGhost} onClick={() => {
                  setEditing(false); setPositions(m.positions || []); setNotes(m.notes || '');
                  setTracking(m.time_tracking || 'venue'); setCompany(m.works_through || '');
                }}>
                  Cancel
                </button>
```

**Edit 7.** Find:
```jsx
    if (!term) return members;
    return members.filter((m) =>
      `${m.first_name} ${m.last_name} ${m.email || ''} ${m.phone || ''} ${(m.positions || []).join(' ')}`.toLowerCase().includes(term)
    );
  }, [members, q]);

  const updated = (member) => {
```
Replace with:
```jsx
    if (!term) return members;
    return members.filter((m) =>
      `${m.first_name} ${m.last_name} ${m.email || ''} ${m.phone || ''} ${(m.positions || []).join(' ')} ${m.works_through || ''}`.toLowerCase().includes(term)
    );
  }, [members, q]);
  // Phase 35: company names already used on this team (suggested when editing someone)
  const companies = useMemo(
    () => [...new Set(members.map((m) => m.works_through).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [members]
  );

  const updated = (member) => {
```

**Edit 8.** Find:
```jsx
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter your team by name, phone or position" className={`${inputCls} pl-9`} />
        </div>
        <div className="flex bg-slate-800 border border-slate-700 rounded-xl p-0.5 overflow-x-auto">
```
Replace with:
```jsx
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter your team by name, phone, position or company" className={`${inputCls} pl-9`} />
        </div>
        <div className="flex bg-slate-800 border border-slate-700 rounded-xl p-0.5 overflow-x-auto">
```

**Edit 9.** Find:
```jsx
              timeZone={timeZone}
              positionOptions={positionOptions}
              open={openId === m.worker_id}
              onToggle={() => setOpenId(openId === m.worker_id ? null : m.worker_id)}
```
Replace with:
```jsx
              timeZone={timeZone}
              positionOptions={positionOptions}
              companies={companies}
              open={openId === m.worker_id}
              onToggle={() => setOpenId(openId === m.worker_id ? null : m.worker_id)}
```

---

## B3. NEW FILE `frontend/src/components/manager/PayPeriodsModal.jsx`

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarRange, Lock, Unlock, Download, Check, AlertTriangle, Clock, Settings, ChevronRight, Timer, Building2,
} from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import { downloadFile } from '../../utils/download';
import { fmtShortDate, fmtTime } from '../../utils/venueTime';

/**
 * Phase 35: Pay periods. The current period and the ones before it, with hours, overtime and pay per person.
 * After a period ends a manager approves it, which locks its times and pay rates until someone reopens it (with a reason).
 * Props: venueId, venueName, onClose(), onOpenSettings() (Venue settings → Time & pay periods), onChanged()
 */
const STATE_CHIP = {
  current: ['In progress', 'bg-sky-500/10 text-sky-300 border-sky-500/30'],
  ready: ['Ready to approve', 'bg-amber-500/15 text-amber-200 border-amber-500/40'],
  approved: ['Approved · locked', 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'],
  not_required: ['Ended', 'bg-slate-800 text-slate-300 border-slate-700'],
  empty: ['No hours', 'bg-slate-900 text-slate-500 border-slate-800'],
};
const PERIOD_TEXT = {
  weekly: 'Weekly', biweekly: 'Every two weeks', semimonthly: 'Twice a month', monthly: 'Monthly',
};
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n) => `${Number(n || 0).toFixed(2)} h`;
const btnGhost = 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40';

function StateChip({ state }) {
  const [label, cls] = STATE_CHIP[state] || STATE_CHIP.not_required;
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${cls}`}>
      {state === 'approved' && <Lock className="w-3 h-3" />} {label}
    </span>
  );
}

export default function PayPeriodsModal({ venueId, venueName, onClose, onOpenSettings, onChanged }) {
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState(null);     // start_date
  const [company, setCompany] = useState('');
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const tz = list?.timezone;

  const loadList = useCallback(async (keepSelected) => {
    try {
      const res = await api.get(`/venues/${venueId}/pay-periods`, { params: { count: 8 } });
      setList(res.data);
      const periods = res.data.periods || [];
      if (!keepSelected) {
        // Open the most recent period that needs approving, else the last finished one, else the current one
        const pick = periods.find((p) => p.state === 'ready') || periods[1] || periods[0];
        setSelected(pick ? pick.start_date : null);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load pay periods.');
    }
  }, [venueId]);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    setLoadingDetail(true);
    try {
      const res = await api.get(`/venues/${venueId}/pay-periods/${selected}`, { params: company ? { company } : {} });
      setDetail(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load that pay period.');
    } finally {
      setLoadingDetail(false);
    }
  }, [venueId, selected, company]);

  useEffect(() => { loadList(false); }, [loadList]);
  useEffect(() => {
    setConfirmApprove(false);
    setReopening(false);
    setReason('');
    loadDetail();
  }, [loadDetail]);

  const act = async (fn, okText) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(okText);
      setConfirmApprove(false);
      setReopening(false);
      setReason('');
      await Promise.all([loadList(true), loadDetail()]);
      onChanged && onChanged();
    } catch (err) {
      setError(err.response?.data?.detail || 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const approve = () => act(() => api.post(`/venues/${venueId}/pay-periods/${selected}/approve`),
    'Approved and locked. Times and pay rates in this period can no longer be changed.');
  const reopen = () => {
    if (reason.trim().length < 3) return setError("Say why you're reopening it.");
    return act(() => api.post(`/venues/${venueId}/pay-periods/${selected}/reopen`, { reason: reason.trim() }),
      'Reopened. Fix the times, then approve it again.');
  };
  const download = async () => {
    if (!detail) return;
    try {
      const params = { start: detail.start_date, end: detail.end_date };
      if (company) params.company = company;
      const safe = company ? `-${company.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : '';
      await downloadFile(`/venues/${venueId}/payroll/export`, params, `hours-${detail.start_date}${safe}.csv`);
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't download the hours. Try again.");
    }
  };

  const periods = list?.periods || [];

  return (
    <ModalShell
      title="Pay periods"
      subtitle={list ? `${venueName || 'This venue'} · ${PERIOD_TEXT[list.pay_period] || list.pay_period} · ${list.overtime_text}` : venueName}
      icon={<CalendarRange className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-6xl"
      footer={(
        <>
          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 mr-auto inline-flex items-center gap-1.5">
              <Settings className="w-4 h-4" /> Pay period & overtime settings
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-slate-300">Done</button>
        </>
      )}
    >
      {error && <div className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}
      {notice && <div className="mb-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-200 text-sm">{notice}</div>}
      {!list ? (
        <p className="text-sm text-slate-500 text-center py-10">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4">
          {/* Periods */}
          <div className="space-y-2">
            {!list.approval_on && (
              <p className="text-[11px] text-slate-400 p-2 rounded-lg border border-slate-800 bg-slate-950">
                Approving pay periods is off. Turn it on in Settings → Time & pay periods to lock finished periods.
              </p>
            )}
            {periods.map((p) => (
              <button key={p.start_date} type="button" onClick={() => { setSelected(p.start_date); setNotice(''); setError(''); }}
                className={`w-full text-left p-3 rounded-xl border transition ${selected === p.start_date ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-white">{p.label}</span>
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StateChip state={p.state} />
                  {p.open_entries > 0 && p.state !== 'approved' && (
                    <span className="text-[10px] text-amber-300 inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> {p.open_entries} open</span>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {p.people} {p.people === 1 ? 'person' : 'people'} · {hrs(p.total_hours)}
                  {p.overtime_hours > 0 && <span className="text-orange-300"> · OT {hrs(p.overtime_hours)}</span>}
                  {' · '}{money(p.total_pay)}
                </div>
              </button>
            ))}
          </div>

          {/* One period */}
          <div className="min-w-0">
            {!detail ? (
              <p className="text-sm text-slate-500 text-center py-10">{loadingDetail ? 'Loading…' : 'Pick a pay period.'}</p>
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-white">{detail.label}</h3>
                      <StateChip state={detail.state} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {list.companies.length > 0 && (
                        <select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}
                          className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white">
                          <option value="">Everyone</option>
                          {list.companies.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                      <button type="button" onClick={download} className={btnGhost}><Download className="w-3.5 h-3.5" /> Download</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      ['People', detail.people],
                      ['Hours', hrs(detail.total_hours)],
                      ['Overtime', hrs(detail.overtime_hours)],
                      ['Pay before tips', money(detail.total_pay)],
                    ].map(([k, v]) => (
                      <div key={k} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{k}</div>
                        <div className={`text-base font-bold ${k === 'Overtime' && detail.overtime_hours > 0 ? 'text-orange-300' : 'text-white'}`}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {company && <p className="text-[11px] text-sky-300">Showing only people who work through {company}.</p>}

                  {/* Approve / reopen */}
                  {detail.state === 'approved' ? (
                    <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                      <p className="text-xs text-emerald-100 flex items-start gap-1.5">
                        <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>
                          Approved{detail.approved_by ? ` by ${detail.approved_by}` : ''}{detail.approved_at ? ` on ${fmtShortDate(detail.approved_at, tz)} at ${fmtTime(detail.approved_at, tz)}` : ''}.
                          Times and pay rates in this period are locked.
                        </span>
                      </p>
                      {!reopening ? (
                        <button type="button" onClick={() => setReopening(true)} className={btnGhost}><Unlock className="w-3.5 h-3.5" /> Reopen to fix something</button>
                      ) : (
                        <div className="space-y-2">
                          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus
                            placeholder="Why? e.g. Bo's Monday clock-out was wrong"
                            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white" />
                          <div className="flex gap-2">
                            <button type="button" onClick={reopen} disabled={busy}
                              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                              <Unlock className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Reopen'}
                            </button>
                            <button type="button" onClick={() => { setReopening(false); setReason(''); }} className={btnGhost}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : detail.state === 'ready' ? (
                    <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-2">
                      {detail.blocked_reason ? (
                        <p className="text-xs text-amber-100 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {detail.blocked_reason}</p>
                      ) : !confirmApprove ? (
                        <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={() => setConfirmApprove(true)}
                          className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5">
                          <Check className="w-4 h-4" /> Approve and lock
                        </button>
                        <span className="text-xs text-amber-100/80">Check the hours below first. After approving, times and pay rates in this period are locked.</span>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-amber-100 flex-1 min-w-[14rem]">
                            Lock {detail.label}? {hrs(detail.total_hours)} and {money(detail.total_pay)} are saved with the approval, and nobody can change
                            times or pay rates in it until it's reopened.
                          </span>
                          <button type="button" onClick={approve} disabled={busy}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold disabled:opacity-50">
                            {busy ? 'Saving…' : 'Approve and lock'}
                          </button>
                          <button type="button" onClick={() => setConfirmApprove(false)} className={btnGhost}>Cancel</button>
                        </div>
                      )}
                      {company && !detail.blocked_reason && <p className="text-[11px] text-slate-400">Approving locks the whole period for everyone, not just {company}.</p>}
                    </div>
                  ) : detail.blocked_reason ? (
                    <p className="text-xs text-slate-400 flex items-start gap-1.5"><Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {detail.blocked_reason}</p>
                  ) : null}
                  {detail.last_reopened_at && (
                    <p className="text-[11px] text-slate-500">
                      Last reopened {fmtShortDate(detail.last_reopened_at, tz)}: “{detail.last_reopen_reason}”
                    </p>
                  )}
                </div>

                {/* People */}
                <div className="rounded-xl border border-slate-800 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-950 text-slate-400">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2">Person</th>
                        <th className="text-right font-semibold px-2 py-2">Shifts</th>
                        <th className="text-right font-semibold px-2 py-2">Regular</th>
                        <th className="text-right font-semibold px-2 py-2">Overtime</th>
                        <th className="text-right font-semibold px-2 py-2">Total</th>
                        <th className="text-right font-semibold px-3 py-2">Pay</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {detail.rows.length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No ShiftBoard clock-ins in this period.</td></tr>
                      )}
                      {detail.rows.map((r) => (
                        <tr key={r.worker_id} className="bg-slate-900/40">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-white">{r.name}</div>
                            <div className="flex flex-wrap items-center gap-1 mt-0.5">
                              {r.works_through && (
                                <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30 text-[9px] font-bold inline-flex items-center gap-0.5">
                                  <Building2 className="w-2.5 h-2.5" /> {r.works_through}
                                </span>
                              )}
                              {r.open_entries > 0 && <span className="text-[10px] text-amber-300">{r.open_entries} still open</span>}
                              {r.edited_entries > 0 && <span className="text-[10px] text-amber-200/80">{r.edited_entries} edited</span>}
                              {r.auto_closed > 0 && <span className="text-[10px] text-rose-300">{r.auto_closed} auto-closed</span>}
                              {r.outside_area > 0 && <span className="text-[10px] text-amber-300">{r.outside_area} outside the area</span>}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right text-slate-300">{r.shifts}</td>
                          <td className="px-2 py-2 text-right text-slate-300">{r.regular_hours.toFixed(2)}</td>
                          <td className={`px-2 py-2 text-right ${r.overtime_hours > 0 ? 'text-orange-300 font-bold' : 'text-slate-500'}`}>{r.overtime_hours.toFixed(2)}</td>
                          <td className="px-2 py-2 text-right text-white font-semibold">{r.hours.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-emerald-400 font-semibold">{money(r.pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-500">
                  Pay is hours × each person's rate, before tips. Overtime is flagged, not paid extra here: your payroll adds any premium.
                </p>

                {detail.payroll_rows.length > 0 && (
                  <div className="p-3 rounded-xl border border-violet-500/30 bg-violet-500/5 space-y-2">
                    <div className="text-xs font-bold text-violet-200 inline-flex items-center gap-1.5">
                      <Timer className="w-3.5 h-3.5" /> Tracked by your venue's payroll ({detail.payroll_shifts} shift{detail.payroll_shifts === 1 ? '' : 's'})
                    </div>
                    <p className="text-[11px] text-violet-100/70">These people clock in with your own system, so their hours aren't counted above. Scheduled hours are shown to check against it.</p>
                    <div className="divide-y divide-violet-500/20">
                      {detail.payroll_rows.map((r) => (
                        <div key={r.worker_id} className="py-1.5 flex items-center justify-between text-xs">
                          <span className="text-white font-semibold">{r.name}</span>
                          <span className="text-violet-200">{r.shifts} shift{r.shifts === 1 ? '' : 's'} · {hrs(r.scheduled_hours)} scheduled</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
```

---

## B4. `frontend/src/pages/VenueManagerDashboard.jsx` (EDITS)
The **Pay periods** header button (after Download hours) and the modal. Its settings button opens Venue settings on the Time & pay periods tab.

**Edit 1.** Find:
```jsx
import api from '../api/client';
import {
  Plus, Check, Building2, AlertCircle, Download, Settings, UserPlus, Globe, X, LayoutTemplate,
} from 'lucide-react';
import PostedShiftsBoard from '../components/PostedShiftsBoard';
```
Replace with:
```jsx
import api from '../api/client';
import {
  Plus, Check, Building2, AlertCircle, Download, Settings, UserPlus, Globe, X, LayoutTemplate, CalendarRange,
} from 'lucide-react';
import PostedShiftsBoard from '../components/PostedShiftsBoard';
```

**Edit 2.** Find:
```jsx
import ReviewModal from '../components/ReviewModal';
import DownloadHoursModal from '../components/manager/DownloadHoursModal';   // Phase 33.1
import ActivityFeed from '../components/ActivityFeed';
import { ApprovalQueueCard, TransfersCard } from '../components/ManagerQueues';
```
Replace with:
```jsx
import ReviewModal from '../components/ReviewModal';
import DownloadHoursModal from '../components/manager/DownloadHoursModal';   // Phase 33.1
import PayPeriodsModal from '../components/manager/PayPeriodsModal';         // Phase 35
import ActivityFeed from '../components/ActivityFeed';
import { ApprovalQueueCard, TransfersCard } from '../components/ManagerQueues';
```

**Edit 3.** Find:
```jsx
  const [actionLoading, setActionLoading] = useState(null);
  const [showDownload, setShowDownload] = useState(false);   // Phase 33.1: Download hours (pick a date range)
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [notification, setNotification] = useState(null);
```
Replace with:
```jsx
  const [actionLoading, setActionLoading] = useState(null);
  const [showDownload, setShowDownload] = useState(false);   // Phase 33.1: Download hours (pick a date range)
  const [showPayPeriods, setShowPayPeriods] = useState(false);   // Phase 35: approve / lock pay periods
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [notification, setNotification] = useState(null);
```

**Edit 4.** Find:
```jsx
              <Download className="w-4 h-4 text-emerald-400" /> Download hours
            </button>
            {currentVenueId && (
              <Link to={`/venues/${currentVenueId}`} className={headerBtn}>
```
Replace with:
```jsx
              <Download className="w-4 h-4 text-emerald-400" /> Download hours
            </button>
            <button type="button" onClick={() => setShowPayPeriods(true)} disabled={!currentVenueId} className={headerBtn}>
              <CalendarRange className="w-4 h-4 text-violet-300" /> Pay periods
            </button>
            {currentVenueId && (
              <Link to={`/venues/${currentVenueId}`} className={headerBtn}>
```

**Edit 5.** Find:
```jsx
      )}

      {review && currentVenueId && (
        <ReviewModal
```
Replace with:
```jsx
      )}

      {showPayPeriods && currentVenueId && (
        <PayPeriodsModal
          venueId={currentVenueId}
          venueName={venueDetails?.name}
          onClose={() => setShowPayPeriods(false)}
          onOpenSettings={venueDetails ? () => { setShowPayPeriods(false); setSettingsTab('timepay'); setShowVenueSettings(true); } : null}
        />
      )}

      {review && currentVenueId && (
        <ReviewModal
```

---

## B5. `frontend/src/components/manager/DownloadHoursModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import React, { useState } from 'react';
import { Download, CalendarRange } from 'lucide-react';
import ModalShell from '../ModalShell';
import { downloadFile, rangePresets } from '../../utils/download';
```
Replace with:
```jsx
import React, { useEffect, useState } from 'react';
import { Download, CalendarRange } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import { downloadFile, rangePresets } from '../../utils/download';
```

**Edit 2.** Find:
```jsx
 * hours and pay before tips. Times and dates are in the venue's own time zone.
 * Props: venueId, venueName, onClose(), onDone(message), onError(message)
 */
export default function DownloadHoursModal({ venueId, venueName, onClose, onDone, onError }) {
  const presets = rangePresets();
  const [pick, setPick] = useState('last_week');
  const [custom, setCustom] = useState({ start: presets[1].start, end: presets[1].end });
  const [busy, setBusy] = useState(false);

  const range = pick === 'custom' ? custom : presets.find((p) => p.id === pick);
```
Replace with:
```jsx
 * hours and pay before tips. Times and dates are in the venue's own time zone.
 * Props: venueId, venueName, onClose(), onDone(message), onError(message)
 * Phase 35: optional staffing-company filter; the file also has Regular hours, Overtime hours and Works through.
 */
export default function DownloadHoursModal({ venueId, venueName, onClose, onDone, onError }) {
  const presets = rangePresets();
  const [pick, setPick] = useState('last_week');
  const [custom, setCustom] = useState({ start: presets[1].start, end: presets[1].end });
  const [busy, setBusy] = useState(false);
  const [companies, setCompanies] = useState([]);   // Phase 35
  const [company, setCompany] = useState('');

  useEffect(() => {
    let active = true;
    api.get(`/venues/${venueId}/pay-periods`, { params: { count: 1 } })
      .then((res) => active && setCompanies(res.data?.companies || []))
      .catch(() => active && setCompanies([]));
    return () => { active = false; };
  }, [venueId]);

  const range = pick === 'custom' ? custom : presets.find((p) => p.id === pick);
```

**Edit 3.** Find:
```jsx
      if (range.start) params.start = range.start;
      if (range.end) params.end = range.end;
      await downloadFile(`/venues/${venueId}/payroll/export`, params, 'hours-and-pay.csv');
      onDone('Hours downloaded. Open it in Excel, Numbers or Google Sheets.');
      onClose();
```
Replace with:
```jsx
      if (range.start) params.start = range.start;
      if (range.end) params.end = range.end;
      if (company) params.company = company;                                       // Phase 35
      const safe = company ? `-${company.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : '';
      await downloadFile(`/venues/${venueId}/payroll/export`, params, `hours-and-pay${safe}.csv`);
      onDone('Hours downloaded. Open it in Excel, Numbers or Google Sheets.');
      onClose();
```

**Edit 4.** Find:
```jsx
        )}
        {invalid && <p className="text-xs text-rose-300">Pick an end date on or after the start date.</p>}
        <p className="text-xs text-slate-400">
          {range.start ? `${dayText(range.start)} – ${dayText(range.end)}` : 'All clock-ins at this venue'}. Weeks start on Monday. Times are in
          the venue's time zone. Tips aren't included yet.
        </p>
      </div>
```
Replace with:
```jsx
        )}
        {invalid && <p className="text-xs text-rose-300">Pick an end date on or after the start date.</p>}
        {companies.length > 0 && (
          <label className="block text-xs font-semibold text-slate-300">Who
            <select value={company} onChange={(e) => setCompany(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white">
              <option value="">Everyone</option>
              {companies.map((c) => <option key={c} value={c}>Only people who work through {c}</option>)}
            </select>
          </label>
        )}
        <p className="text-xs text-slate-400">
          {range.start ? `${dayText(range.start)} – ${dayText(range.end)}` : 'All clock-ins at this venue'}. Weeks start on Monday. Times are in
          the venue's time zone. Overtime follows your Time & pay settings. People your venue's own payroll tracks don't clock in
          here, so they aren't in this file. Tips aren't included yet.
        </p>
      </div>
```

---

## B6. `frontend/src/components/manager/TodayEventCard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
  missed: { label: 'Never clocked in', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  no_show: { label: 'No-show', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30 line-through' },
};

```
Replace with:
```jsx
  missed: { label: 'Never clocked in', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  no_show: { label: 'No-show', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30 line-through' },
  payroll: { label: 'Venue payroll', cls: 'bg-violet-500/10 text-violet-300 border-violet-500/30' },   // Phase 35: no clock-in here
};

```

**Edit 2.** Find:
```jsx
                  if (p.clock_state === 'done') sub = `${fmtTime(p.clock_in_time, timeZone)} – ${fmtTime(p.clock_out_time, timeZone)}`;
                  if (p.clock_state === 'missed') sub = 'Shift ended with no clock-in';
                  const canClockIn = ['due', 'late'].includes(p.clock_state);
                  const canNoShow = ['late', 'missed'].includes(p.clock_state);
                  return (
                    <li key={p.request_id}
```
Replace with:
```jsx
                  if (p.clock_state === 'done') sub = `${fmtTime(p.clock_in_time, timeZone)} – ${fmtTime(p.clock_out_time, timeZone)}`;
                  if (p.clock_state === 'missed') sub = 'Shift ended with no clock-in';
                  if (p.clock_state === 'payroll') sub = "Clocks in with your venue's own system";   // Phase 35
                  const started = event.state === 'live' || event.state === 'ended';
                  const canClockIn = ['due', 'late'].includes(p.clock_state);
                  const canNoShow = ['late', 'missed'].includes(p.clock_state) || (p.clock_state === 'payroll' && started);
                  return (
                    <li key={p.request_id}
```

---

## B7. `frontend/src/components/TimesheetModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p.role_type}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
```
Replace with:
```jsx
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p.role_type}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${st.cls}`}>{st.label}</span>
                    {/* Phase 35 */}
                    {p.time_tracking === 'payroll' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-violet-500/10 text-violet-300 border-violet-500/30">Venue payroll</span>
                    )}
                    {p.works_through && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-sky-500/10 text-sky-300 border-sky-500/30">{p.works_through}</span>
                    )}
                    {p.overtime_hours > 0 && (
                      <span title="Hours past the venue's overtime limits (Venue settings → Time & pay periods)"
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-orange-500/10 text-orange-300 border-orange-500/40">
                        OT {p.overtime_hours.toFixed(2)} h
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
```

**Edit 2.** Find:
```jsx
                )}

                {!formHere && (
                  <div className="mt-2 flex flex-wrap gap-2">
```
Replace with:
```jsx
                )}

                {p.time_tracking === 'payroll' && p.entries.length === 0 && (
                  <p className="mt-2 text-[11px] text-violet-200/80">
                    Their hours are tracked in your venue's own payroll, so there's nothing to clock here. Times you add still count in ShiftBoard.
                  </p>
                )}
                {!formHere && (
                  <div className="mt-2 flex flex-wrap gap-2">
```

---

## B8. `frontend/src/components/EventRosterModal.jsx` (EDIT)

**Edit 1.** Find:
```jsx
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{p.phone}</a>}
```
Replace with:
```jsx
                                </div>
                              )}
                              {/* Phase 35: time tracking + staffing company */}
                              {(p.time_tracking === 'payroll' || p.works_through) && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {p.time_tracking === 'payroll' && (
                                    <span title="Their time is tracked by your venue's own payroll. They don't clock in here."
                                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/30">Venue payroll</span>
                                  )}
                                  {p.works_through && (
                                    <span title="Works through this company" className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30">{p.works_through}</span>
                                  )}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{p.phone}</a>}
```

---

## B9. `frontend/src/components/worker/MyShiftCard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
 *        onDetails, onClockIn, onClockOut, onBoard, onHandOff, onDrop, onWithdraw, onAddCalendar, onDirections, onAskBack
 * Phase 34: cover (my live cover request for this booking, from GET /api/cover/mine, or null), onAskCover, onCancelCover
 */
export default function MyShiftCard({
```
Replace with:
```jsx
 *        onDetails, onClockIn, onClockOut, onBoard, onHandOff, onDrop, onWithdraw, onAddCalendar, onDirections, onAskBack
 * Phase 34: cover (my live cover request for this booking, from GET /api/cover/mine, or null), onAskCover, onCancelCover
 * Phase 35: calItem.time_tracking === 'payroll' means the venue's own payroll tracks this shift: no clock-in button here.
 */
export default function MyShiftCard({
```

**Edit 2.** Find:
```jsx
  const canAskBack = isDropped && startMs > now && !shiftCancelled && onAskBack;
  const canCover = isBooked && !isCheckedIn && startMs > now;                         // Phase 34
  const { month, day, weekday } = dateParts(shift.start_time, tz);

```
Replace with:
```jsx
  const canAskBack = isDropped && startMs > now && !shiftCancelled && onAskBack;
  const canCover = isBooked && !isCheckedIn && startMs > now;                         // Phase 34
  const payroll = calItem?.time_tracking === 'payroll' && !isCheckedIn;             // Phase 35: the venue's own payroll tracks this shift
  const { month, day, weekday } = dateParts(shift.start_time, tz);

```

**Edit 3.** Find:
```jsx
        <Timer className="w-4 h-4" /> {busy === 'clock' ? 'Saving…' : 'Clock out'}
      </button>
    );
  } else if (isBooked && needsAck && (ended || tooEarly)) {
```
Replace with:
```jsx
        <Timer className="w-4 h-4" /> {busy === 'clock' ? 'Saving…' : 'Clock out'}
      </button>
    );
  } else if (isBooked && payroll && needsAck && !ended) {
    // Phase 35: no clock-in here, so reading the notes is the only action
    primary = (
      <button type="button" onClick={onDetails} className={`${btn} bg-amber-500 hover:bg-amber-400 text-slate-950`}>
        <AlertTriangle className="w-4 h-4" /> {calItem?.info_change ? 'Read the update' : 'Read the shift notes'}
      </button>
    );
  } else if (isBooked && payroll && !ended) {
    primary = (
      <span className={`${btn} bg-violet-500/10 text-violet-200 border border-violet-500/30 font-semibold`}
        title="This venue tracks your hours with its own time clock or payroll system. Clock in there, not in ShiftBoard.">
        <Timer className="w-4 h-4" /> Clock in with the venue's system
      </span>
    );
  } else if (isBooked && payroll && ended) {
    primary = (
      <span className="text-xs text-emerald-400 font-semibold inline-flex items-center gap-1">
        <Check className="w-4 h-4" /> Worked · tracked by venue payroll
      </span>
    );
  } else if (isBooked && needsAck && (ended || tooEarly)) {
```

**Edit 4.** Find:
```jsx
              </span>
            )}
            {(isBooked || isCheckedIn) && SOURCE_LABELS[req.approval_source] && (
              <span className="text-[10px] text-slate-500">{SOURCE_LABELS[req.approval_source]}</span>
```
Replace with:
```jsx
              </span>
            )}
            {payroll && (isBooked || isCompleted) && (
              <span title="Your hours here are tracked by the venue's own payroll, not ShiftBoard"
                className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-violet-500/10 text-violet-200 border-violet-500/30">
                Venue payroll
              </span>
            )}
            {(isBooked || isCheckedIn) && SOURCE_LABELS[req.approval_source] && (
              <span className="text-[10px] text-slate-500">{SOURCE_LABELS[req.approval_source]}</span>
```

---

## B10. `frontend/src/components/ShiftDetailsModal.jsx` (EDIT)

**Edit 1.** Find:
```jsx
            {item.booked && !off && (
              <div className="pl-6 text-[11px] text-slate-400 space-y-0.5">
                {item.clock_in_opens_at && <div>Clock-in opens at {fmtTime(item.clock_in_opens_at, tz)}.</div>}
                {item.geofence_on && <div>You'll need to be at this location with phone location on to clock in.</div>}
              </div>
            )}
```
Replace with:
```jsx
            {item.booked && !off && (
              <div className="pl-6 text-[11px] text-slate-400 space-y-0.5">
                {item.time_tracking === 'payroll' ? (
                  // Phase 35: the venue's own payroll tracks this shift
                  <div className="text-violet-200">{item.venue?.name || 'This venue'} tracks your hours with its own time clock or payroll. Clock in there, not in ShiftBoard.</div>
                ) : (
                  <>
                    {item.clock_in_opens_at && <div>Clock-in opens at {fmtTime(item.clock_in_opens_at, tz)}.</div>}
                    {item.geofence_on && <div>You'll need to be at this location with phone location on to clock in.</div>}
                  </>
                )}
              </div>
            )}
```

---

## B11. `frontend/src/pages/EarningsPage.jsx` (EDIT)

**Edit 1.** Find:
```jsx
            )}

            {data.venues.length > 1 && (
              <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
```
Replace with:
```jsx
            )}

            {/* Phase 35: shifts a venue's own payroll tracks aren't counted here */}
            {data.payroll_shifts > 0 && (
              <div className="p-3 rounded-xl border border-violet-500/30 bg-violet-500/5 text-violet-200 text-xs flex items-start gap-2">
                <Timer className="w-4 h-4 flex-shrink-0" />
                <span>
                  {data.payroll_shifts} shift{data.payroll_shifts === 1 ? '' : 's'} in this period {data.payroll_shifts === 1 ? 'is' : 'are'} tracked
                  by {data.payroll_venues.length ? data.payroll_venues.join(', ') : 'the venue'}'s own payroll, so {data.payroll_shifts === 1 ? "it isn't" : "they aren't"} counted here.
                  Check your pay stub from them.
                </span>
              </div>
            )}

            {data.venues.length > 1 && (
              <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
```

---

## B12. `frontend/src/components/worker/EarningsCard.jsx` (EDIT)

**Edit 1.** Find:
```jsx
            {data.in_progress > 0 ? 'Clocked in now · ' : ''}
            {up.shifts > 0 ? `${up.shifts} more booked (~${money(up.est_pay)})` : 'Before tips'}
          </div>
        </div>
```
Replace with:
```jsx
            {data.in_progress > 0 ? 'Clocked in now · ' : ''}
            {up.shifts > 0 ? `${up.shifts} more booked (~${money(up.est_pay)})` : 'Before tips'}
            {data.payroll_shifts > 0 ? ` · ${data.payroll_shifts} on venue payroll` : ''}
          </div>
        </div>
```

---

# PART V: Version, changelog & README (the standing directive, done for you)

## V1. `frontend/package.json` (EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.34.6",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.35.0",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.34.6"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.35.0"
```

---

## V3. `CHANGELOG.md` (EDIT)
The new section goes above `[0.34.6]`.

**Edit 1.** Find:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.34.6] - 2026-09-28 - Phase 34.6: Venue website
```
Replace with:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.0] - 2026-09-28 - Phase 35: Venue payroll, staffing companies, overtime and pay periods

### Added
- **Who clocks in where.** Venue settings → **Time & pay periods** → "How your team's time is tracked": team members either clock in with ShiftBoard or are tracked by the venue's own payroll / time clock (`venues.team_time_tracking`).
- **Per person** (Team → Edit): "Use the venue setting", "Venue's payroll" or "Clock in with ShiftBoard" (`venue_whitelists.time_tracking`), plus **Works through** a staffing company (`venue_whitelists.works_through`). Staffing-company people and anyone from outside the team clock in with ShiftBoard by default.
- Bookings record their tracking mode when the shift starts (`shift_requests.time_tracking`, written by the background worker), so settings changes never rewrite past hours.
- **Overtime flags**: weekly limit (default 40 h), optional daily limit, and the work-week start day. Shown on time sheets, pay periods and the hours download (new trailing columns **Regular hours**, **Overtime hours**, **Works through**; existing columns keep their order).
- **Pay periods**: weekly, every two weeks (with a start date), twice a month (1st and 16th) or monthly. A new **Pay periods** screen on the manager dashboard lists each period with people, hours, overtime and pay, a per-person breakdown, a company filter, and a download.
- **Approve and lock** (on by default, `venues.pay_period_approval`): a finished period with no open clock-ins can be approved, which saves a snapshot of its totals (`pay_period_approvals`). While it's approved, adding, editing or deleting times and changing pay rates in it is refused (409). Reopening needs a reason; both are in the activity log.
- API: `GET /api/venues/{id}/pay-periods`, `GET /api/venues/{id}/pay-periods/{start}?company=`, `POST .../{start}/approve`, `POST .../{start}/reopen`. The payroll export takes `company=`.
- Hours download: filter by staffing company.

### Changed
- Payroll-tracked people: no clock-in button ("Clock in with the venue's system"), clock-in is refused by the server with a plain message, no "not clocked in" alerts, a **Venue payroll** state on the Today board (a no-show can still be marked after the start), and a chip on the roster, time sheet and team list.
- Reliability counts a finished payroll-tracked shift as worked and on time unless it's marked a no-show.
- Hours & pay leaves payroll-tracked shifts out of the totals and says how many there were.

## [0.34.6] - 2026-09-28 - Phase 34.6: Venue website
```

---

## V4. `README.md` (EDITS)
For managers and the background worker (architecture and settings changed).

**Edit 1.** Find:
```markdown
  * remove someone, mark a no-show
* **Team**: members, positions, notes, blocking, invites (email / link / QR / CSV), ratings and reviews.
* **Time sheets**: fix clock-in / clock-out times (every edit is logged). Download hours and pay as CSV in the venue's time zone.
* **Reliability scoring** (`services/reliability.py`):
  * The score is `100 × (on-time + ½ × late) ÷ (worked + no-shows + late drops)`, across the whole platform.
  * Late means clocking in more than 10 minutes after the start.
  * Drops with 72 hours' notice or more are excused.
  * Managers see it as a badge next to each person.
* **Activity log** of every booking, change and approval. **Venue settings**:
  * address, clock-in area, clock-in rules
  * approval policy, public cover
  * positions & pay, locations, templates
```
Replace with:
```markdown
  * remove someone, mark a no-show
* **Team**: members, positions, notes, blocking, invites (email / link / QR / CSV), ratings and reviews.
* **Time sheets**: fix clock-in / clock-out times (every edit is logged). Download hours and pay as CSV in the venue's time zone, for everyone or one staffing company.
* **Time tracking: ShiftBoard or venue payroll** (Phase 35, `services/time_tracking.py`):
  * Each venue chooses how **team members'** time is tracked: they clock in with ShiftBoard, or the venue's own payroll / time clock tracks them.
  * Each team member can be set differently, and can be marked as working through a **staffing company** (overhire / agency). People from a staffing company, and anyone booked from outside the team, clock in with ShiftBoard unless a manager says otherwise.
  * First match wins: the person's own setting → works through a company (ShiftBoard) → on the team and the venue uses payroll (payroll) → ShiftBoard.
  * Payroll-tracked people get no clock-in button and no "not clocked in" alerts. The shift counts as worked for reliability unless a manager marks a no-show. Their hours aren't in time sheets, exports or Hours & pay; pay periods list them separately with scheduled hours.
  * When a shift starts, the background worker writes the mode on the booking (`shift_requests.time_tracking`), so later settings changes never rewrite past hours.
* **Overtime flags and pay periods** (Phase 35, `services/pay_periods.py`, `routers/pay_periods.py`):
  * Per venue: weekly overtime limit (default 40 h), optional daily limit, the day the work week starts, and the pay period (weekly, every two weeks, twice a month, monthly).
  * Overtime is flagged and counted (time sheets, pay periods, the hours download). ShiftBoard doesn't add an overtime premium to pay.
  * **Pay periods** screen: totals per person and per period. When approving is on, a finished period is **approved and locked**: nobody can add, edit or delete times or change pay rates in it until a manager reopens it with a reason. Approvals keep a snapshot of the totals and are logged.
* **Reliability scoring** (`services/reliability.py`):
  * The score is `100 × (on-time + ½ × late) ÷ (worked + no-shows + late drops)`, across the whole platform.
  * Late means clocking in more than 10 minutes after the start.
  * Drops with 72 hours' notice or more are excused.
  * Managers see it as a badge next to each person.
* **Activity log** of every booking, change and approval. **Venue settings**:
  * address, website, clock-in area, clock-in rules
  * time tracking, overtime and pay periods (Time & pay periods tab)
  * approval policy, public cover
  * positions & pay, locations, templates
```

**Edit 2.** Find:
```markdown
* Runs inside the backend container: `backend/src/main.py` starts `notification_worker_loop()` from the FastAPI lifespan with `asyncio.create_task()`.
* Every minute:
  * auto clock-out
  * 24 h / 2 h reminders
```
Replace with:
```markdown
* Runs inside the backend container: `backend/src/main.py` starts `notification_worker_loop()` from the FastAPI lifespan with `asyncio.create_task()`.
* Every minute:
  * record how each started shift's time is tracked (ShiftBoard or venue payroll)
  * auto clock-out
  * 24 h / 2 h reminders
```

---

# PART C: Rebuild & verification

**Schema change (new columns with defaults, a new column on bookings, and a new table).** Pick ONE:

**Option 1: fresh database (wipes all data):**
```bash
docker compose down -v
docker compose up -d --build
```

**Option 2: keep your data.** Run once, then rebuild without `-v`. It's safe to run twice. Existing venues get the defaults (team clocks in with ShiftBoard, overtime over 40 h a week, weekly pay periods starting Monday, approve-and-lock on), so nothing changes for anyone until a manager changes the settings.
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
BEGIN;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS team_time_tracking VARCHAR(20) NOT NULL DEFAULT 'shiftboard';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS ot_weekly_hours NUMERIC(5, 2) DEFAULT 40;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS ot_daily_hours NUMERIC(5, 2);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS work_week_start SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS pay_period VARCHAR(20) NOT NULL DEFAULT 'weekly';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS pay_period_anchor DATE;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS pay_period_approval BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE venue_whitelists ADD COLUMN IF NOT EXISTS time_tracking VARCHAR(20);
ALTER TABLE venue_whitelists ADD COLUMN IF NOT EXISTS works_through VARCHAR(120);
ALTER TABLE shift_requests ADD COLUMN IF NOT EXISTS time_tracking VARCHAR(20);
CREATE TABLE IF NOT EXISTS pay_period_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'approved',
    people INT NOT NULL DEFAULT 0,
    total_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
    overtime_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
    approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reopened_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reopened_at TIMESTAMPTZ,
    reopen_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pay_period_approvals_venue ON pay_period_approvals(venue_id, start_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_period_approved ON pay_period_approvals(venue_id, start_date) WHERE status = 'approved';
COMMIT;
SQL
docker compose up -d --build
```
(The database service is called `database` in `docker-compose.yml`. If your database user or name differ in `.env`, use those.)

Then `docker compose restart frontend` so Vite picks up version 0.35.0.

### Checklist
1. Admin → System → Version says *Web app 0.35.0 · Server 0.35.0*.
2. Manager → **Settings → Time & pay periods**: pick *Your venue's payroll tracks their time*, keep *Over 40 hours in a work week*, save. Reopen: it stuck.
3. **Team** → open someone → **Edit**: set *Works through* to a company and save. The row shows the company chip. Open a second person: they show **Venue payroll**.
4. Assign the payroll person and the company person to a shift that starts soon. On the payroll person's phone, **My shifts** shows *Clock in with the venue's system* and no Clock in button. The company person can clock in as usual.
5. After the start, the **Today** board shows the payroll person as **Venue payroll** (no "not clocked in" alert).
6. **Pay periods**: last week shows its hours and any overtime. Click **Approve and lock** and confirm. Then open that week's time sheet and try to edit a time: you get *"… is approved and locked. Reopen it on the Pay periods screen …"*. Reopen with a reason; the edit now works.
7. **Download hours**: the file ends with *Regular hours*, *Overtime hours*, *Works through*. Pick a company in *Who* to get only their people.

---

**"CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this."**

(For this phase, Part V already does all three for 0.35.0. Apply it as written and don't bump again.)