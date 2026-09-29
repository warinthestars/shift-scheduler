# Phase 35.2: Tips per Event (v0.35.3)

**Why:** the last piece of the Phase 35 pay work. Managers record each event's tips in ShiftBoard: a **tip pool** shared by the people in tip-pool positions, and **own tips** per person. Every rule is a venue setting. Tips then flow into pay periods (and their lock), the hours download and each worker's Hours & pay.

## What changes
* **Venue settings → Time & pay periods → new "Tips" card:**
  * **Track tips in ShiftBoard**: `venues.tips_enabled`, default on.
  * **Share tip pools**: *By hours worked* (default) or *Equally* → `venues.tip_pool_split`. This is the default; each event can switch.
  * **People on your venue's payroll share tip pools**: `venues.tip_pool_payroll`, default on. Their scheduled hours are used for an hours split.
  * **Workers see their tips in Hours & pay**: `venues.tips_shown_to_workers`, default on.
* **Time sheet → new Tips panel** (top of the event's time sheet; shown when the event has tip positions or a pool):
  * tip pool ($), *Share it* (by hours / equally), note
  * one row per person: role, *pool · 5.00 h* (scheduled hours for venue-payroll people), an **own tips** box (only for positions with Tips), pool share, total
  * **Save tips** / **Undo**, plus a running total
  * read-only with the reason when the event hasn't started, was cancelled, is in a locked pay period, or tips are off
* **The rules** (`backend/src/services/tips.py`):
  * The pool is shared by everyone booked (approved / confirmed / checked in / completed) in the event's **Tip pool** positions. No-shows, drops and removed people get nothing.
  * **Hours split:** ShiftBoard clock-ins (closed entries). Venue-payroll people use their scheduled hours, and are in the pool only when `tip_pool_payroll` is on. People with 0 hours get no share; if **nobody** has hours yet, it's shared equally and the panel says so.
  * Shares are rounded to the cent, and the leftover cents go to the largest remainders, so they **always add up to the pool** (e.g. $1.00 three ways = 0.33 / 0.33 / 0.34).
  * **Own tips** only for positions marked **Tips**.
  * Tips belong to the **day the shift starts** (venue time).
  * Tips off → nothing is counted anywhere, but what was entered is kept.
* **Locks:** an approved pay period also locks its tips: 409 *"The pay period … is approved and locked. Reopen it on the Pay periods screen to change its tips."* `assert_unlocked()` gets an optional `what="times"` argument for that wording; the time-edit messages don't change.
* **Pay periods:**
  * a **Tips** tile and a **Tips** column
  * tips on venue-payroll people's rows
  * `total_tips` on each period and in the **approval snapshot** (`pay_period_approvals.total_tips`)
  * people with tips but no clock-ins still get a row
  * the company filter applies
* **Hours download:** three new columns **at the end**, *Own tips*, *Tip pool share* and *Tips total*, on each booking's first clock-in row. A **"Tips only (no ShiftBoard clock-in)"** row covers people with tips but no clock-ins (e.g. venue payroll). Every earlier column keeps its position.
* **Worker Hours & pay:**
  * a **Tips** tile and a **Tips** list (own + pool share per shift)
  * "+ $x tips" under each shift's pay
  * tips on the My shifts card
  * a new last column **Tips** in the spreadsheet, with "Tips only" rows
  * Venues that hide tips from workers aren't included.
* **API** (191 → **193** operations), managers of the venue and admins only:
  * `GET /api/events/{event_id}/tips` → `EventTips`
  * `PUT /api/events/{event_id}/tips`, body `{"pool_amount": 240, "split": "hours", "note": "...", "individual": [{"request_id": "...", "amount": 62.5}]}`
    * Every field is optional: `null` = leave it; an `amount` of `null` or `0` clears that person's own tips.
    * 400: not started / cancelled / tips off / amount outside $0–$100,000 / not on the event / a position without Tips.
    * 409: locked. Activity log kind `tips_updated`.
* **Database:**
  * 4 new `venues` columns
  * `shift_requests.tip_amount NUMERIC(10,2)`
  * `pay_period_approvals.total_tips NUMERIC(12,2)`
  * a new table `event_tips` (one row per event, `event_id` UNIQUE)
  * `VARCHAR` for the split, **no ENUMs**
* **Version 0.35.3.** `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG and README updates are included below. **This covers the standing directive for this phase, so don't bump again.**

## 0. Rules for this phase
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/config.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`, `docker-compose.yml`
  - Any real settings file (`.env`, anything in `.secrets/`).
  - `agy_system_instructions.md`: it's correct as it is.
  - In `backend/src/main.py`, **only** the router import and `include_router` line (A10).
* **Schema change:** see Part C (keep-your-data SQL, or `docker compose down -v` / `up -d --build`). No ENUMs.
* No new packages.
* **NEW FILES:** create them with exactly the content shown.
* **EDITS:** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* **Verification.** All 20 edited files were checked against your repo, and the edits were built on your exact current copies (0.35.2 is fully applied). They were verified:
  - **Backend:** imports cleanly. 193 API operations. The API reports **0.35.3**.
  - **Frontend:** bundles with no missing imports.
  - **A new 37-check suite passes.** It covers:
    - the cent-exact split (5/3/1 h; $1.00 three ways)
    - settings defaults and a bad split value refused
    - before the start: read-only and refused; workers get 403
    - a pool of $120 by hours 5 / 3 / 4 (the 4 is a payroll person's scheduled hours) = 50 / 30 / 40; own tips $45.50; total $165.50
    - own tips refused for a no-tips position; negative amounts and people not on the event refused
    - equal split; payroll people excluded when the setting is off
    - the activity log
    - pay-period totals per person (including the payroll list) and with the company filter
    - the export's three new columns (earlier ones unchanged), tips on the clock-in row, and a "tips only" row for the payroll person
    - worker Hours & pay and its spreadsheet; tips hidden from workers but still shown to managers
    - a no-show dropped from the pool, with the pool re-split
    - approve (snapshot includes tips) → tips locked (409) → reopen → editable
    - tips off: refused and not counted; back on: kept
    - nobody with hours → equal to the cent ($50.01 → 25.01 / 25.00); a pool with no pool positions flagged
  - **Every earlier suite still passes** (t1–t19), including the schema audit (32 tables, no drift, no ENUMs).
  - **The keep-your-data SQL** was run twice on a copy of your current schema, and the result matches a fresh `init.sql` exactly.
  - In real Chromium:
    - the Tips card saves ("Equally" stuck)
    - the time sheet's Tips panel: typing $240 and $62.50 and saving gives 92.31 / 55.38 / 92.31, which adds up to $240.00
    - Pay periods shows the Tips tile, column and payroll-row tips
    - a worker's phone shows the Tips tile, list and "+$92.31 tips"
    - no page errors

  Don't "improve" them.

---

# PART A: Backend

## A1. `database/init.sql` (EDITS)
Four `venues` columns, `shift_requests.tip_amount`, `pay_period_approvals.total_tips`, and the new `event_tips` table at the end.

**Edit 1.** Find:
```sql
    pay_period_anchor DATE,                                  -- Phase 35: biweekly: the first day of any pay period
    pay_period_approval BOOLEAN NOT NULL DEFAULT TRUE,       -- Phase 35: managers approve and lock each pay period
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```
Replace with:
```sql
    pay_period_anchor DATE,                                  -- Phase 35: biweekly: the first day of any pay period
    pay_period_approval BOOLEAN NOT NULL DEFAULT TRUE,       -- Phase 35: managers approve and lock each pay period
    tips_enabled BOOLEAN NOT NULL DEFAULT TRUE,              -- Phase 35.2: managers enter tips per event
    tip_pool_split VARCHAR(20) NOT NULL DEFAULT 'hours',     -- Phase 35.2: hours | equal (default for new tip pools)
    tip_pool_payroll BOOLEAN NOT NULL DEFAULT TRUE,          -- Phase 35.2: venue-payroll people share pools (scheduled hours)
    tips_shown_to_workers BOOLEAN NOT NULL DEFAULT TRUE,     -- Phase 35.2: workers see their tips in Hours & pay
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

**Edit 2.** Find:
```sql
    info_seen_at TIMESTAMPTZ,
    time_tracking VARCHAR(20),                                -- Phase 35: payroll | shiftboard, written when the shift starts
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```
Replace with:
```sql
    info_seen_at TIMESTAMPTZ,
    time_tracking VARCHAR(20),                                -- Phase 35: payroll | shiftboard, written when the shift starts
    tip_amount NUMERIC(10, 2),                                -- Phase 35.2: this person's own tips for the shift (NULL = none)
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

**Edit 3.** Find:
```sql
    overtime_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
    approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```
Replace with:
```sql
    overtime_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_tips NUMERIC(12, 2) NOT NULL DEFAULT 0,             -- Phase 35.2
    approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

**Edit 4.** Find:
```sql
-- one live approval per venue and period
CREATE UNIQUE INDEX uq_pay_period_approved ON pay_period_approvals(venue_id, start_date) WHERE status = 'approved';
```
Replace with:
```sql
-- one live approval per venue and period
CREATE UNIQUE INDEX uq_pay_period_approved ON pay_period_approvals(venue_id, start_date) WHERE status = 'approved';

-- ==============================================================================
-- Phase 35.2: Tips per event (one tip pool per event; own tips live on shift_requests.tip_amount)
-- ==============================================================================
CREATE TABLE event_tips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL UNIQUE REFERENCES shift_events(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    pool_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,            -- shared by everyone booked in tip-pool positions
    split VARCHAR(20) NOT NULL DEFAULT 'hours',               -- hours | equal
    note TEXT,
    updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_event_tips_venue ON event_tips(venue_id);
```

---

## A2. `backend/src/models.py` (EDITS)
The new columns and the `EventTip` model at the end of the file.

**Edit 1.** Find:
```python
    pay_period_anchor = Column(Date, nullable=True)                                # Phase 35: biweekly
    pay_period_approval = Column(Boolean, nullable=False, default=True)            # Phase 35
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    pay_period_anchor = Column(Date, nullable=True)                                # Phase 35: biweekly
    pay_period_approval = Column(Boolean, nullable=False, default=True)            # Phase 35
    tips_enabled = Column(Boolean, nullable=False, default=True)                   # Phase 35.2
    tip_pool_split = Column(String(20), nullable=False, default="hours")           # Phase 35.2: hours | equal
    tip_pool_payroll = Column(Boolean, nullable=False, default=True)               # Phase 35.2
    tips_shown_to_workers = Column(Boolean, nullable=False, default=True)          # Phase 35.2
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

**Edit 2.** Find:
```python
    info_seen_at = Column(DateTime(timezone=True), nullable=True)          # Phase 26.2: worker read the shift info
    time_tracking = Column(String(20), nullable=True)                       # Phase 35: written when the shift starts
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```
Replace with:
```python
    info_seen_at = Column(DateTime(timezone=True), nullable=True)          # Phase 26.2: worker read the shift info
    time_tracking = Column(String(20), nullable=True)                       # Phase 35: written when the shift starts
    tip_amount = Column(Numeric(10, 2), nullable=True)                      # Phase 35.2: own tips (NULL = none)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

**Edit 3.** Find:
```python
    overtime_hours = Column(Numeric(10, 2), nullable=False, default=0)
    total_pay = Column(Numeric(12, 2), nullable=False, default=0)
    approved_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```
Replace with:
```python
    overtime_hours = Column(Numeric(10, 2), nullable=False, default=0)
    total_pay = Column(Numeric(12, 2), nullable=False, default=0)
    total_tips = Column(Numeric(12, 2), nullable=False, default=0)             # Phase 35.2
    approved_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
```

**Edit 4.** Find:
```python

    __table_args__ = (Index("idx_pay_period_approvals_venue", "venue_id", "start_date"),)
```
Replace with:
```python

    __table_args__ = (Index("idx_pay_period_approvals_venue", "venue_id", "start_date"),)


class EventTip(Base):
    """Phase 35.2: an event's tip pool (own tips are on ShiftRequest.tip_amount)."""
    __tablename__ = "event_tips"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("shift_events.id", ondelete="CASCADE"), nullable=False, unique=True)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    pool_amount = Column(Numeric(10, 2), nullable=False, default=0)
    split = Column(String(20), nullable=False, default="hours")                  # hours | equal
    note = Column(Text, nullable=True)
    updated_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (Index("idx_event_tips_venue", "venue_id"),)
```

---

## A3. `backend/src/schemas.py` (EDITS)
Venue fields, pay-period tips, earnings tips, and the tip models (just before the `model_rebuild()` lines).

**Edit 1.** Find:
```python
    pay_period_anchor: Optional[date] = None  # Phase 35: biweekly only
    pay_period_approval: bool = True        # Phase 35: approve and lock each pay period

class VenueCreate(BaseModel):
```
Replace with:
```python
    pay_period_anchor: Optional[date] = None  # Phase 35: biweekly only
    pay_period_approval: bool = True        # Phase 35: approve and lock each pay period
    tips_enabled: bool = True               # Phase 35.2: managers enter tips per event
    tip_pool_split: str = "hours"           # Phase 35.2: hours | equal
    tip_pool_payroll: bool = True           # Phase 35.2: venue-payroll people share tip pools (scheduled hours)
    tips_shown_to_workers: bool = True      # Phase 35.2: workers see their tips in Hours & pay

class VenueCreate(BaseModel):
```

**Edit 2.** Find:
```python
    pay_period_anchor: Optional[date] = None          # Phase 35
    pay_period_approval: Optional[bool] = None        # Phase 35

class VenueResponse(VenueBase):
```
Replace with:
```python
    pay_period_anchor: Optional[date] = None          # Phase 35
    pay_period_approval: Optional[bool] = None        # Phase 35
    tips_enabled: Optional[bool] = None               # Phase 35.2
    tip_pool_split: Optional[str] = None              # Phase 35.2: hours | equal
    tip_pool_payroll: Optional[bool] = None           # Phase 35.2
    tips_shown_to_workers: Optional[bool] = None      # Phase 35.2

class VenueResponse(VenueBase):
```

**Edit 3.** Find:
```python
    auto_closed: bool = False                # clocked out automatically
    edited: bool = False                     # a manager changed the times


```
Replace with:
```python
    auto_closed: bool = False                # clocked out automatically
    edited: bool = False                     # a manager changed the times
    tips: float = 0                          # Phase 35.2: this shift's tips (on its first clock-in)


```

**Edit 4.** Find:
```python
    pay: float = 0
    shifts: int = 0


```
Replace with:
```python
    pay: float = 0
    shifts: int = 0
    tips: float = 0                          # Phase 35.2


class EarningsTip(BaseModel):
    """Phase 35.2: tips for one of my shifts (own tips + my share of the tip pool)."""
    request_id: UUID
    event_title: str
    venue_name: str
    venue_timezone: str = "America/New_York"
    role_type: str
    start_time: datetime
    own: float = 0
    pool_share: float = 0
    total: float = 0


```

**Edit 5.** Find:
```python
    payroll_shifts: int = 0                  # Phase 35: shifts in the period tracked by a venue's own payroll (not counted here)
    payroll_venues: List[str] = []           # Phase 35


```
Replace with:
```python
    payroll_shifts: int = 0                  # Phase 35: shifts in the period tracked by a venue's own payroll (not counted here)
    payroll_venues: List[str] = []           # Phase 35
    total_tips: float = 0                    # Phase 35.2: tips for shifts starting in the period (venues that show them)
    tips: List[EarningsTip] = []             # Phase 35.2


```

**Edit 6.** Find:
```python
    outside_area: int = 0
    auto_closed: int = 0


```
Replace with:
```python
    outside_area: int = 0
    auto_closed: int = 0
    tips: float = 0                          # Phase 35.2: own tips + pool shares for shifts starting in the period


```

**Edit 7.** Find:
```python
    shifts: int = 0
    scheduled_hours: float = 0               # from the posted times (their real hours are in the venue's payroll)


```
Replace with:
```python
    shifts: int = 0
    scheduled_hours: float = 0               # from the posted times (their real hours are in the venue's payroll)
    tips: float = 0                          # Phase 35.2


```

**Edit 8.** Find:
```python
    overtime_hours: float = 0
    total_pay: float = 0
    open_entries: int = 0
    payroll_people: int = 0
```
Replace with:
```python
    overtime_hours: float = 0
    total_pay: float = 0
    total_tips: float = 0                    # Phase 35.2
    open_entries: int = 0
    payroll_people: int = 0
```

**Edit 9.** Find:
```python


WorkerProfile.model_rebuild()
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
```
Replace with:
```python


# ------------------------------------------------------------------------------------------------
# Phase 35.2: Tips per event
# ------------------------------------------------------------------------------------------------
class TipPerson(BaseModel):
    request_id: UUID
    worker_id: UUID
    name: str
    role_type: str
    tips_eligible: bool = False              # the position gets tips (own tips can be entered)
    in_pool: bool = False                    # shares the event's tip pool
    time_tracking: str = "shiftboard"        # payroll = hours below are the scheduled hours
    basis_hours: float = 0                   # hours used for an hours split
    individual: float = 0                    # own tips
    pool_share: float = 0
    total: float = 0


class EventTips(BaseModel):
    event_id: UUID
    title: str
    start_time: datetime
    timezone: str
    enabled: bool = True                     # venues.tips_enabled
    can_edit: bool = False
    blocked_reason: Optional[str] = None     # why it can't be edited (not started / cancelled / locked / tips off)
    locked: bool = False                     # in an approved pay period
    split: str = "hours"                     # this event's pool split: hours | equal
    venue_split: str = "hours"               # the venue default
    pool_payroll: bool = True                # venue-payroll people share the pool
    pool_amount: float = 0
    note: Optional[str] = None
    fell_back_equal: bool = False            # hours split, but nobody in the pool has hours yet -> shared equally
    pool_unshared: bool = False              # a pool is set but nobody is in a tip-pool position
    total_individual: float = 0
    total_tips: float = 0
    people: List[TipPerson] = []
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None


class TipAmountIn(BaseModel):
    request_id: UUID
    amount: Optional[float] = None           # None or 0 = no own tips


class EventTipsUpdate(BaseModel):
    pool_amount: Optional[float] = None      # None = leave as it is
    split: Optional[str] = None              # hours | equal; None = leave as it is
    note: Optional[str] = Field(None, max_length=300)
    individual: List[TipAmountIn] = []       # only the people listed change


WorkerProfile.model_rebuild()
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
```

---

## A4. NEW FILE `backend/src/services/tips.py`
The rules: who is in the pool, the hours / equal split, and cent-exact shares.

```python
"""
Phase 35.2: Tips per event.

* Own tips: ShiftRequest.tip_amount, entered by a manager for people in positions that get tips (Shift.tips_eligible).
* Tip pool: EventTip.pool_amount, one per event, shared by everyone booked in the event's tip-pool positions
  (Shift.tip_pool). How it's shared (EventTip.split, defaulting to venues.tip_pool_split):
    hours  - by hours worked: ShiftBoard clock-ins (closed entries) for people who clock in here, scheduled hours
             for people the venue's own payroll tracks. If nobody in the pool has hours yet, it's shared equally.
    equal  - the same share each.
  People on venue payroll are in the pool only when venues.tip_pool_payroll is on.
  Shares are rounded to cents and always add up to the pool exactly (leftover cents go to the largest remainders).
* No-shows, drops and removed people get no tips. Tips belong to the day the shift starts (venue time) for pay
  periods, the hours download and the pay-period lock.
* venues.tips_enabled off: tips aren't tracked (nothing is counted anywhere; stored amounts are kept).
"""
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Tuple

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import EventTip, Shift, ShiftEvent, ShiftRequest, TimeEntry, User, Venue

TIP_STATUSES = ("approved", "confirmed", "checked_in", "completed")
SPLITS = ("hours", "equal")
MAX_AMOUNT = 100000.0


def _utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _hours(start, end) -> float:
    if not start or not end:
        return 0.0
    return max(0.0, (_utc(end) - _utc(start)).total_seconds() / 3600.0)


def split_cents(total_cents: int, basis: Dict) -> Dict:
    """{key: cents} proportional to basis (all > 0), adding up to total_cents exactly."""
    if not basis or total_cents <= 0:
        return {k: 0 for k in basis}
    tot = float(sum(basis.values()))
    raw = {k: total_cents * v / tot for k, v in basis.items()}
    out = {k: int(r) for k, r in raw.items()}
    left = total_cents - sum(out.values())
    for k in sorted(raw, key=lambda k: (-(raw[k] - int(raw[k])), str(k)))[:left]:
        out[k] += 1
    return out


async def event_tip_lines(db: AsyncSession, event_ids: Iterable) -> Dict:
    """{event_id: {"venue", "tip" (EventTip or None), "split", "pool", "fell_back_equal", "lines": [...]}}.
    Each line: request, shift, worker (User), mode, tips_eligible, in_pool, basis_hours, individual, share."""
    from src.services.time_tracking import modes_for_requests, PAYROLL
    event_ids = list({e for e in event_ids if e is not None})
    if not event_ids:
        return {}
    events = {e.id: e for e in (await db.execute(select(ShiftEvent).where(ShiftEvent.id.in_(event_ids)))).scalars().all()}
    venues = {v.id: v for v in (await db.execute(
        select(Venue).where(Venue.id.in_({e.venue_id for e in events.values()})))).scalars().all()}
    tips = {t.event_id: t for t in (await db.execute(select(EventTip).where(EventTip.event_id.in_(event_ids)))).scalars().all()}
    rows = (await db.execute(
        select(ShiftRequest, Shift, User)
        .join(Shift, Shift.id == ShiftRequest.shift_id).join(User, User.id == ShiftRequest.worker_id)
        .where(Shift.event_id.in_(event_ids), func.lower(ShiftRequest.status).in_(TIP_STATUSES),
               func.upper(Shift.status) != "CANCELLED")
        .order_by(User.first_name.asc(), User.last_name.asc())
    )).all()
    shift_ids = list({s.id for _r, s, _u in rows})
    worked = defaultdict(float)
    if shift_ids:
        for e in (await db.execute(select(TimeEntry).where(TimeEntry.shift_id.in_(shift_ids)))).scalars().all():
            worked[(e.shift_id, e.worker_id)] += _hours(e.clock_in_time, e.clock_out_time)
    modes = await modes_for_requests(db, [(r, s) for r, s, _u in rows])

    out = {}
    for eid, ev in events.items():
        venue = venues.get(ev.venue_id)
        tip = tips.get(eid)
        split = tip.split if (tip is not None and tip.split in SPLITS) else (venue.tip_pool_split if venue and venue.tip_pool_split in SPLITS else "hours")
        pool = float(tip.pool_amount or 0) if tip is not None else 0.0
        lines = []
        for r, s, u in rows:
            if s.event_id != eid:
                continue
            mode = modes.get(r.id, "shiftboard")
            in_pool = bool(s.tip_pool) and (mode != PAYROLL or bool(venue.tip_pool_payroll if venue else True))
            basis = _hours(s.start_time, s.end_time) if mode == PAYROLL else worked.get((s.id, r.worker_id), 0.0)
            lines.append({
                "request": r, "shift": s, "worker": u, "mode": mode, "tips_eligible": bool(s.tips_eligible),
                "in_pool": in_pool, "basis_hours": round(basis, 2),
                "individual": float(r.tip_amount) if r.tip_amount is not None else 0.0, "share": 0.0,
            })
        members = [ln for ln in lines if ln["in_pool"]]
        fell_back = False
        if members and pool > 0:
            if split == "hours" and sum(ln["basis_hours"] for ln in members) > 0:
                basis = {i: ln["basis_hours"] for i, ln in enumerate(members) if ln["basis_hours"] > 0}
            else:
                fell_back = split == "hours"
                basis = {i: 1.0 for i in range(len(members))}
            cents = split_cents(int(round(pool * 100)), basis)
            for i, ln in enumerate(members):
                ln["share"] = cents.get(i, 0) / 100.0
        out[eid] = {"event": ev, "venue": venue, "tip": tip, "split": split, "pool": pool,
                    "fell_back_equal": fell_back, "lines": lines}
    return out


async def tips_by_request(db: AsyncSession, event_ids: Iterable, for_workers: bool = False) -> Dict:
    """{request_id: (own tips, pool share)} for these events. Venues with tips turned off count nothing;
    for_workers=True also leaves out venues that don't show tips to workers."""
    out = {}
    for data in (await event_tip_lines(db, event_ids)).values():
        v = data["venue"]
        if v is None or not v.tips_enabled or (for_workers and not v.tips_shown_to_workers):
            continue
        for ln in data["lines"]:
            if ln["individual"] or ln["share"]:
                out[ln["request"].id] = (round(ln["individual"], 2), round(ln["share"], 2))
    return out


async def event_ids_starting(db: AsyncSession, venue_ids, lo: datetime, hi: datetime) -> List:
    """Events with a shift starting in [lo, hi) at these venues (tips belong to the day the shift starts)."""
    venue_ids = list(venue_ids) if not isinstance(venue_ids, (list, tuple, set)) else list(venue_ids)
    return list((await db.execute(
        select(Shift.event_id).where(Shift.venue_id.in_(venue_ids), Shift.event_id.isnot(None),
                                     Shift.start_time >= lo, Shift.start_time < hi).distinct()
    )).scalars().all())
```

---

## A5. NEW FILE `backend/src/routers/tips.py`

```python
"""
Phase 35.2: Tips per event: an event's tip pool and each person's own tips.
Managers of the venue and admins only. The rules are in services/tips.py.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import EventTip, Shift, ShiftEvent, User, Venue
from src.schemas import EventTips, EventTipsUpdate, TipPerson
from src.auth import require_manager_or_admin
from src.routers.events import _load_managed_event, _venue_for
from src.services import activity
from src.services.pay_periods import assert_unlocked, lock_covering, local_date, period_label
from src.services.fit import tz_of
from src.services.tips import event_tip_lines, SPLITS, MAX_AMOUNT, TIP_STATUSES

router = APIRouter(prefix="/api/events", tags=["Tips"])


def _utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _money(value, label: str) -> float:
    try:
        v = round(float(value), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{label} must be an amount in dollars.")
    if v < 0 or v > MAX_AMOUNT:
        raise HTTPException(status_code=400, detail=f"{label} must be between $0 and ${MAX_AMOUNT:,.0f}.")
    return v


async def _shift_starts(db: AsyncSession, event: ShiftEvent):
    starts = list((await db.execute(select(Shift.start_time).where(Shift.event_id == event.id))).scalars().all())
    return starts or [event.start_time]


async def build_event_tips(db: AsyncSession, event: ShiftEvent, venue: Venue) -> EventTips:
    data = (await event_tip_lines(db, [event.id]))[event.id]
    tip = data["tip"]
    tz = tz_of(venue.timezone)
    lock = None
    for st in await _shift_starts(db, event):
        lock = await lock_covering(db, venue.id, local_date(st, tz))
        if lock is not None:
            break
    blocked = None
    if not venue.tips_enabled:
        blocked = "Tips are turned off for this venue (Venue settings → Time & pay periods)."
    elif event.cancelled_at is not None:
        blocked = "This event was cancelled."
    elif _utc(event.start_time) > datetime.now(timezone.utc):
        blocked = "You can add tips once the event has started."
    elif lock is not None:
        blocked = (f"The pay period {period_label(lock.start_date, lock.end_date)} is approved and locked. "
                   "Reopen it on the Pay periods screen to change its tips.")
    updated_by = None
    if tip is not None and tip.updated_by_user_id:
        u = await db.scalar(select(User).where(User.id == tip.updated_by_user_id))
        updated_by = (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email) if u else None
    people = [TipPerson(
        request_id=ln["request"].id, worker_id=ln["worker"].id,
        name=(f"{ln['worker'].first_name or ''} {ln['worker'].last_name or ''}".strip() or ln["worker"].email),
        role_type=ln["shift"].role_type or "Shift", tips_eligible=ln["tips_eligible"], in_pool=ln["in_pool"],
        time_tracking=ln["mode"], basis_hours=ln["basis_hours"], individual=round(ln["individual"], 2),
        pool_share=round(ln["share"], 2), total=round(ln["individual"] + ln["share"], 2),
    ) for ln in data["lines"]]
    pool = round(data["pool"], 2)
    return EventTips(
        event_id=event.id, title=event.title, start_time=event.start_time, timezone=venue.timezone or "America/New_York",
        enabled=bool(venue.tips_enabled), can_edit=blocked is None, blocked_reason=blocked, locked=lock is not None,
        split=data["split"], venue_split=venue.tip_pool_split or "hours", pool_payroll=bool(venue.tip_pool_payroll),
        pool_amount=pool, note=tip.note if tip is not None else None, fell_back_equal=data["fell_back_equal"],
        pool_unshared=pool > 0 and not any(p.in_pool for p in people),
        total_individual=round(sum(p.individual for p in people), 2),
        total_tips=round(sum(p.total for p in people), 2), people=people,
        updated_at=tip.updated_at if tip is not None else None, updated_by=updated_by,
    )


@router.get("/{event_id}/tips", response_model=EventTips)
async def get_event_tips(
    event_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """The event's tip pool and everyone's tips (own + pool share)."""
    event = await _load_managed_event(db, event_id, current_user)
    venue = await _venue_for(db, event.venue_id)
    return await build_event_tips(db, event, venue)


@router.put("/{event_id}/tips", response_model=EventTips)
async def update_event_tips(
    event_id: UUID,
    body: EventTipsUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Set the tip pool (amount, split, note) and/or own tips for the people listed."""
    event = await _load_managed_event(db, event_id, current_user)
    venue = await _venue_for(db, event.venue_id)
    if not venue.tips_enabled:
        raise HTTPException(status_code=400, detail="Tips are turned off for this venue. Turn them on in Venue settings → Time & pay periods.")
    if event.cancelled_at is not None:
        raise HTTPException(status_code=400, detail="This event was cancelled.")
    if _utc(event.start_time) > datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="You can add tips once the event has started.")
    await assert_unlocked(db, venue, *(await _shift_starts(db, event)), what="tips")
    if body.split is not None and body.split not in SPLITS:
        raise HTTPException(status_code=400, detail="Choose how the pool is shared: by hours worked or equally.")
    pool = _money(body.pool_amount, "The tip pool") if body.pool_amount is not None else None

    data = (await event_tip_lines(db, [event.id]))[event.id]
    by_req = {ln["request"].id: ln for ln in data["lines"]}
    changes = []
    for item in body.individual:
        ln = by_req.get(item.request_id)
        if ln is None:
            raise HTTPException(status_code=400, detail="One of those people isn't booked on this event (or was a no-show).")
        amount = _money(item.amount, f"Tips for {ln['worker'].first_name or 'this person'}") if item.amount else 0.0
        if amount and not ln["tips_eligible"]:
            raise HTTPException(status_code=400, detail=(
                f"{ln['shift'].role_type} doesn't get tips on this event. Turn on Tips for that shift first."))
        changes.append((ln["request"], amount or None))

    try:
        tip = data["tip"]
        if tip is None and (pool is not None or body.split is not None or body.note is not None):
            tip = EventTip(event_id=event.id, venue_id=venue.id, pool_amount=0, split=data["split"])
            db.add(tip)
        if tip is not None:
            if pool is not None:
                tip.pool_amount = pool
            if body.split is not None:
                tip.split = body.split
            if body.note is not None:
                tip.note = body.note.strip() or None
            tip.updated_by_user_id = current_user.id
            tip.updated_at = datetime.now(timezone.utc)
        for req, amount in changes:
            req.tip_amount = amount
        await db.commit()
    except Exception as ex:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save the tips: {ex}")

    result = await build_event_tips(db, event, venue)
    await activity.for_event("tips_updated", event.id, current_user.id,
                             f"pool ${result.pool_amount:,.2f} ({'by hours' if result.split == 'hours' else 'equal shares'}), "
                             f"own tips ${result.total_individual:,.2f}")
    return result
```

---

## A6. `backend/src/services/venue_positions.py` (EDITS)

**Edit 1.** Find:
```python
    "allow_public_cover",                                                                            # Phase 34
    "team_time_tracking", "work_week_start", "pay_period", "pay_period_approval",                    # Phase 35
)
VALID_TIME_TRACKING = ("shiftboard", "payroll")                                                      # Phase 35
VALID_PAY_PERIODS = ("weekly", "biweekly", "semimonthly", "monthly")
```
Replace with:
```python
    "allow_public_cover",                                                                            # Phase 34
    "team_time_tracking", "work_week_start", "pay_period", "pay_period_approval",                    # Phase 35
    "tips_enabled", "tip_pool_split", "tip_pool_payroll", "tips_shown_to_workers",                   # Phase 35.2
)
VALID_TIP_SPLITS = ("hours", "equal")                                                                 # Phase 35.2
VALID_TIME_TRACKING = ("shiftboard", "payroll")                                                      # Phase 35
VALID_PAY_PERIODS = ("weekly", "biweekly", "semimonthly", "monthly")
```

**Edit 2.** Find:
```python
    if "pay_period" in data and data["pay_period"] not in VALID_PAY_PERIODS:
        raise HTTPException(status_code=400, detail="Choose how often you pay: weekly, every two weeks, twice a month or monthly.")
    if data.get("auto_approve_rating_threshold") is not None:
        t = float(data["auto_approve_rating_threshold"])
```
Replace with:
```python
    if "pay_period" in data and data["pay_period"] not in VALID_PAY_PERIODS:
        raise HTTPException(status_code=400, detail="Choose how often you pay: weekly, every two weeks, twice a month or monthly.")
    if "tip_pool_split" in data and data["tip_pool_split"] not in VALID_TIP_SPLITS:
        raise HTTPException(status_code=400, detail="Choose how tip pools are shared: by hours worked or equally.")
    if data.get("auto_approve_rating_threshold") is not None:
        t = float(data["auto_approve_rating_threshold"])
```

---

## A7. `backend/src/services/activity.py` (EDITS)

**Edit 1.** Find:
```python
    "pay_period_approved": "changes",    # Phase 35
    "pay_period_reopened": "changes",
    "not_clocked_in": "alerts",
    "no_show": "alerts",                # Phase 30
```
Replace with:
```python
    "pay_period_approved": "changes",    # Phase 35
    "pay_period_reopened": "changes",
    "tips_updated": "changes",           # Phase 35.2
    "not_clocked_in": "alerts",
    "no_show": "alerts",                # Phase 30
```

**Edit 2.** Find:
```python
        "event_published": f"Published {what}",
        "event_unpublished": f"Moved {what} back to drafts",
    }.get(kind, what)
    if extra:
```
Replace with:
```python
        "event_published": f"Published {what}",
        "event_unpublished": f"Moved {what} back to drafts",
        "tips_updated": f"Tips for {what}",                           # Phase 35.2
    }.get(kind, what)
    if extra:
```

---

## A8. `backend/src/services/pay_periods.py` (EDITS)
`assert_unlocked(..., what=)`, and tips in `summarize()`.

**Edit 1.** Find:
```python


async def assert_unlocked(db: AsyncSession, venue: Venue, *moments) -> None:
    """409 if any of these times falls in an approved (locked) pay period at this venue."""
    tz = tz_of(venue.timezone)
    for m in moments:
```
Replace with:
```python


async def assert_unlocked(db: AsyncSession, venue: Venue, *moments, what: str = "times") -> None:
    """409 if any of these times falls in an approved (locked) pay period at this venue.
    Phase 35.2: `what` names what can't change ("times" or "tips")."""
    tz = tz_of(venue.timezone)
    for m in moments:
```

**Edit 2.** Find:
```python
            raise HTTPException(status_code=409, detail=(
                f"The pay period {period_label(lock.start_date, lock.end_date)} is approved and locked. "
                "Reopen it on the Pay periods screen to change its times."))


```
Replace with:
```python
            raise HTTPException(status_code=409, detail=(
                f"The pay period {period_label(lock.start_date, lock.end_date)} is approved and locked. "
                f"Reopen it on the Pay periods screen to change its {what}."))


```

**Edit 3.** Find:
```python
            "worker_id": u.id, "name": (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email),
            "email": u.email, "works_through": company_of(u.id), "shifts": set(), "hours": 0.0, "overtime_hours": 0.0,
            "pay": 0.0, "open_entries": 0, "edited_entries": 0, "outside_area": 0, "auto_closed": 0,
        })
        p["shifts"].add(s.id)
```
Replace with:
```python
            "worker_id": u.id, "name": (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email),
            "email": u.email, "works_through": company_of(u.id), "shifts": set(), "hours": 0.0, "overtime_hours": 0.0,
            "pay": 0.0, "open_entries": 0, "edited_entries": 0, "outside_area": 0, "auto_closed": 0, "tips": 0.0,
        })
        p["shifts"].add(s.id)
```

**Edit 4.** Find:
```python
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
```
Replace with:
```python
            continue
        q = payroll.setdefault(u.id, {"worker_id": u.id, "name": (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email),
                                      "shifts": 0, "scheduled_hours": 0.0, "tips": 0.0})
        q["shifts"] += 1
        q["scheduled_hours"] += max(0.0, (_utc(s.end_time) - _utc(s.start_time)).total_seconds() / 3600.0)

    # Phase 35.2: tips, on the day the shift starts. People with tips but no clock-ins still get a row.
    if venue.tips_enabled:
        from src.services.tips import tips_by_request, event_ids_starting
        tip_map = await tips_by_request(db, await event_ids_starting(db, [venue.id], lo, hi))
        if tip_map:
            tip_rows = (await db.execute(
                select(ShiftRequest, Shift, User).join(Shift, Shift.id == ShiftRequest.shift_id)
                .join(User, User.id == ShiftRequest.worker_id)
                .where(ShiftRequest.id.in_(list(tip_map.keys())), Shift.start_time >= lo, Shift.start_time < hi)
            )).all()
            tip_modes = await modes_for_requests(db, [(r, s) for r, s, _u in tip_rows])
            for r, s, u in tip_rows:
                if company and (company_of(u.id) or "").lower() != company.strip().lower():
                    continue
                amount = sum(tip_map[r.id])
                name = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email
                if u.id in per:
                    per[u.id]["tips"] += amount
                elif tip_modes.get(r.id) == PAYROLL:
                    payroll.setdefault(u.id, {"worker_id": u.id, "name": name, "shifts": 0, "scheduled_hours": 0.0,
                                              "tips": 0.0})["tips"] += amount
                else:
                    per[u.id] = {"worker_id": u.id, "name": name, "email": u.email, "works_through": company_of(u.id),
                                 "shifts": {s.id}, "hours": 0.0, "overtime_hours": 0.0, "pay": 0.0, "open_entries": 0,
                                 "edited_entries": 0, "outside_area": 0, "auto_closed": 0, "tips": amount}

    people_rows = []
    for p in per.values():
        people_rows.append({**p, "shifts": len(p["shifts"]), "hours": round(p["hours"], 2),
                            "overtime_hours": round(p["overtime_hours"], 2),
                            "regular_hours": round(p["hours"] - p["overtime_hours"], 2), "pay": round(p["pay"], 2),
                            "tips": round(p["tips"], 2)})
    people_rows.sort(key=lambda x: x["name"].lower())
    payroll_rows = sorted([{**q, "scheduled_hours": round(q["scheduled_hours"], 2), "tips": round(q["tips"], 2)}
                           for q in payroll.values()],
                          key=lambda x: x["name"].lower())
    out = {
```

**Edit 5.** Find:
```python
        "payroll_people": len(payroll_rows),
        "payroll_shifts": sum(q["shifts"] for q in payroll_rows),
    }
    if people:
```
Replace with:
```python
        "payroll_people": len(payroll_rows),
        "payroll_shifts": sum(q["shifts"] for q in payroll_rows),
        "total_tips": round(sum(p["tips"] for p in people_rows) + sum(q["tips"] for q in payroll_rows), 2),   # Phase 35.2
    }
    if people:
```

---

## A9. `backend/src/routers/pay_periods.py` (EDITS)

**Edit 1.** Find:
```python
        can_approve=state == "ready" and blocked is None, blocked_reason=blocked if state != "approved" else None,
        people=data["people"], total_hours=data["total_hours"], overtime_hours=data["overtime_hours"],
        total_pay=data["total_pay"], open_entries=data["open_entries"],
        payroll_people=data["payroll_people"], payroll_shifts=data["payroll_shifts"],
        approved_at=appr.approved_at if appr else None, approved_by=approved_by,
```
Replace with:
```python
        can_approve=state == "ready" and blocked is None, blocked_reason=blocked if state != "approved" else None,
        people=data["people"], total_hours=data["total_hours"], overtime_hours=data["overtime_hours"],
        total_pay=data["total_pay"], total_tips=data["total_tips"], open_entries=data["open_entries"],
        payroll_people=data["payroll_people"], payroll_shifts=data["payroll_shifts"],
        approved_at=appr.approved_at if appr else None, approved_by=approved_by,
```

**Edit 2.** Find:
```python
            venue_id=venue.id, start_date=s, end_date=e, status="approved", people=current.people,
            total_hours=current.total_hours, overtime_hours=current.overtime_hours, total_pay=current.total_pay,
            approved_by_user_id=current_user.id, approved_at=datetime.now(timezone.utc),
        ))
```
Replace with:
```python
            venue_id=venue.id, start_date=s, end_date=e, status="approved", people=current.people,
            total_hours=current.total_hours, overtime_hours=current.overtime_hours, total_pay=current.total_pay,
            total_tips=current.total_tips,                                               # Phase 35.2
            approved_by_user_id=current_user.id, approved_at=datetime.now(timezone.utc),
        ))
```

**Edit 3.** Find:
```python
    await activity.for_venue("pay_period_approved", venue_id, current_user.id,
                             f"Approved and locked pay period {pp.period_label(s, e)} "
                             f"({current.total_hours:g} h, ${current.total_pay:,.2f})")
    return await _summary(db, venue, s, e, _today(venue), detail=True)

```
Replace with:
```python
    await activity.for_venue("pay_period_approved", venue_id, current_user.id,
                             f"Approved and locked pay period {pp.period_label(s, e)} "
                             f"({current.total_hours:g} h, ${current.total_pay:,.2f}"
                             + (f" + ${current.total_tips:,.2f} tips" if current.total_tips else "") + ")")
    return await _summary(db, venue, s, e, _today(venue), detail=True)

```

---

## A10. `backend/src/main.py` (EDITS)
**Only** the router import and registration.

**Edit 1.** Find:
```python
from src.routers.cover import router as cover_router       # Phase 34
from src.routers.pay_periods import router as pay_periods_router   # Phase 35
from src.services.notification_worker import notification_worker_loop
from src.version import APP_VERSION                          # Phase 34.5
```
Replace with:
```python
from src.routers.cover import router as cover_router       # Phase 34
from src.routers.pay_periods import router as pay_periods_router   # Phase 35
from src.routers.tips import router as tips_router                 # Phase 35.2
from src.services.notification_worker import notification_worker_loop
from src.version import APP_VERSION                          # Phase 34.5
```

**Edit 2.** Find:
```python
app.include_router(cover_router)     # Phase 34
app.include_router(pay_periods_router)   # Phase 35


```
Replace with:
```python
app.include_router(cover_router)     # Phase 34
app.include_router(pay_periods_router)   # Phase 35
app.include_router(tips_router)          # Phase 35.2


```

---

## A11. `backend/src/routers/venues.py` (EDITS)
The hours download: the tip columns and "tips only" rows.

**Edit 1.** Find:
```python
    Phase 27: adds work location, clock-in/out location check, late minutes and auto-closed flags.
    Phase 35: optional company filter; last three columns: Regular hours, Overtime hours, Works through.
    """
    venue = await verify_venue_manager_access(venue_id, current_user, db)
```
Replace with:
```python
    Phase 27: adds work location, clock-in/out location check, late minutes and auto-closed flags.
    Phase 35: optional company filter; last three columns: Regular hours, Overtime hours, Works through.
    Phase 35.2: then Own tips, Tip pool share, Tips total: on each booking's first clock-in row, plus a
    "tips only" row for people with tips but no clock-ins in the file (e.g. on venue payroll). Tips count on
    the day the shift starts.
    """
    venue = await verify_venue_manager_access(venue_id, current_user, db)
```

**Edit 2.** Find:
```python
        "Clock-in location", "Clock-out location", "Minutes late", "Clocked out automatically",
        "Regular hours", "Overtime hours", "Works through",                        # Phase 35 (added at the end)
    ])

    for entry, worker, shift, req in records:
```
Replace with:
```python
        "Clock-in location", "Clock-out location", "Minutes late", "Clocked out automatically",
        "Regular hours", "Overtime hours", "Works through",                        # Phase 35 (added at the end)
        "Own tips", "Tip pool share", "Tips total",                               # Phase 35.2 (added at the end)
    ])

    # Phase 35.2: tips per booking; they go on the booking's first clock-in row in this file
    tip_map = {}
    if venue.tips_enabled:
        from src.services.tips import tips_by_request, event_ids_starting
        if lo is not None or hi is not None:
            t_lo = lo or datetime(1970, 1, 1, tzinfo=timezone.utc)
            t_hi = hi or datetime(9999, 1, 1, tzinfo=timezone.utc)
            eids = await event_ids_starting(db, [venue_id], t_lo, t_hi)
        else:
            eids = list((await db.execute(select(Shift.event_id).where(
                Shift.venue_id == venue_id, Shift.event_id.isnot(None)).distinct())).scalars().all())
        tip_map = await tips_by_request(db, eids)
    first_row = {}
    for entry, _w, _s, req in sorted(records, key=lambda r: r[0].clock_in_time):
        if req is not None and req.id not in first_row:
            first_row[req.id] = entry.id

    def tip_cells(req, entry_id):
        if req is None or first_row.get(req.id) != entry_id or req.id not in tip_map:
            return ["", "", ""]
        own, share = tip_map[req.id]
        return [f"{own:.2f}", f"{share:.2f}", f"{own + share:.2f}"]

    for entry, worker, shift, req in records:
```

**Edit 3.** Find:
```python
            f"{max(0.0, hours - ot.get(entry.id, 0.0)):.2f}", f"{ot.get(entry.id, 0.0):.2f}",   # Phase 35
            companies.get(worker.id, ""),
        ])

    output.seek(0)
```
Replace with:
```python
            f"{max(0.0, hours - ot.get(entry.id, 0.0)):.2f}", f"{ot.get(entry.id, 0.0):.2f}",   # Phase 35
            companies.get(worker.id, ""),
            *tip_cells(req, entry.id),                                                          # Phase 35.2
        ])

    # Phase 35.2: tips for bookings with no clock-in rows in this file (venue payroll, or never clocked in)
    missing = [rid for rid in tip_map if rid not in first_row]
    if missing:
        q = (select(ShiftRequest, Shift, User).join(Shift, Shift.id == ShiftRequest.shift_id)
             .join(User, User.id == ShiftRequest.worker_id).where(ShiftRequest.id.in_(missing)))
        if lo is not None:
            q = q.where(Shift.start_time >= lo)
        if hi is not None:
            q = q.where(Shift.start_time < hi)
        tip_only = sorted((await db.execute(q)).all(), key=lambda r: r[1].start_time)
        more = {s.event_id for _r, s, _w in tip_only if s.event_id and s.event_id not in ev_loc}
        if more:
            ev_loc.update(dict((await db.execute(
                select(ShiftEvent.id, ShiftEvent.location_id).where(ShiftEvent.id.in_(more)))).all()))
            locations = await load_locations(db, ev_loc.values())
        for req, shift, worker in tip_only:
            if company and (companies.get(worker.id) or "").lower() != company.strip().lower():
                continue
            own, share = tip_map[req.id]
            loc = locations.get(ev_loc.get(shift.event_id)) if shift.event_id else None
            writer.writerow([
                f"{worker.first_name} {worker.last_name}".strip() or worker.email, worker.email or "",
                shift.title or "", shift.role_type or "", _local_str(shift.start_time, vtz, "%Y-%m-%d"),
                loc.name if loc is not None else "Venue",
                "Tips only (no ShiftBoard clock-in)", "", "0.00", "", "0.00",
                "Yes" if shift.tips_eligible else "No", "Yes" if shift.tip_pool else "No",
                "", "", "", "", "", "0.00", "0.00", companies.get(worker.id, ""),
                f"{own:.2f}", f"{share:.2f}", f"{own + share:.2f}",
            ])

    output.seek(0)
```

---

## A12. `backend/src/services/earnings.py` (EDITS)

**Edit 1.** Find:
```python
* Hours come from time entries (clock-in -> clock-out); an entry that's still open counts as "in progress", 0 h.
* Rate = the manager's per-person rate for that shift if set (time sheet), else the posted rate. Same rule as payroll.
* Pay is before tips and taxes. Tips aren't tracked yet (Phase 35); shifts that get tips are marked.
* Periods use the worker's own time zone (Notification settings), weeks run Monday -> Sunday.
* Workers see the real rate of shifts they worked, even when the venue hides pay on listings (they were booked).
```
Replace with:
```python
* Hours come from time entries (clock-in -> clock-out); an entry that's still open counts as "in progress", 0 h.
* Rate = the manager's per-person rate for that shift if set (time sheet), else the posted rate. Same rule as payroll.
* Pay is before tips and taxes. Phase 35.2: tips are listed separately (own tips + pool shares entered by the
  manager), for shifts that start in the period, at venues that show tips to workers.
* Periods use the worker's own time zone (Notification settings), weeks run Monday -> Sunday.
* Workers see the real rate of shifts they worked, even when the venue hides pay on listings (they were booked).
```

**Edit 2.** Find:
```python

from src.models import Shift, ShiftEvent, ShiftRequest, TimeEntry, TimeEntryEdit, User, Venue
from src.schemas import EarningsResponse, EarningsShift, EarningsVenue, EarningsUpcoming
from src.services.notify import load_prefs
from src.services.fit import tz_of
```
Replace with:
```python

from src.models import Shift, ShiftEvent, ShiftRequest, TimeEntry, TimeEntryEdit, User, Venue
from src.schemas import EarningsResponse, EarningsShift, EarningsVenue, EarningsUpcoming, EarningsTip
from src.services.notify import load_prefs
from src.services.fit import tz_of
```

**Edit 3.** Find:
```python
        up_pay += h * _rate(shift, req)[0]

    worked = [s for s in shifts if not s.in_progress]
    return EarningsResponse(
```
Replace with:
```python
        up_pay += h * _rate(shift, req)[0]

    # Phase 35.2: tips for my shifts that start in the period (venues that show tips to workers)
    from src.services.tips import tips_by_request
    my_rows = (await db.execute(
        select(ShiftRequest, Shift, Venue, ShiftEvent)
        .join(Shift, Shift.id == ShiftRequest.shift_id).join(Venue, Venue.id == Shift.venue_id)
        .outerjoin(ShiftEvent, ShiftEvent.id == Shift.event_id)
        .where(ShiftRequest.worker_id == user.id, Shift.start_time >= lo, Shift.start_time < hi,
               Shift.event_id.isnot(None))
    )).all()
    tip_map = await tips_by_request(db, {s.event_id for _r, s, _v, _e in my_rows}, for_workers=True)
    tip_items = []
    for r, s, v, ev in sorted(my_rows, key=lambda x: _utc(x[1].start_time)):
        if r.id not in tip_map:
            continue
        own, share = tip_map[r.id]
        tip_items.append(EarningsTip(
            request_id=r.id, event_title=(ev.title if ev is not None else None) or s.title or s.role_type or "Shift",
            venue_name=v.name, venue_timezone=v.timezone or "America/New_York", role_type=s.role_type or "Shift",
            start_time=_utc(s.start_time), own=own, pool_share=share, total=round(own + share, 2),
        ))
        by_venue[v.id]["name"] = v.name
        by_venue[v.id]["tips"] = by_venue[v.id].get("tips", 0.0) + own + share
    placed = set()
    for sh in sorted(shifts, key=lambda x: x.clock_in_time):
        if sh.request_id in tip_map and sh.request_id not in placed:
            sh.tips = round(sum(tip_map[sh.request_id]), 2)
            placed.add(sh.request_id)

    worked = [s for s in shifts if not s.in_progress]
    return EarningsResponse(
```

**Edit 4.** Find:
```python
        any_tips=any(s.tips_eligible for s in shifts),
        venues=sorted(
            [EarningsVenue(venue_id=k, name=v["name"], hours=round(v["hours"], 2), pay=round(v["pay"], 2), shifts=len(v["shifts"]))
             for k, v in by_venue.items()],
            key=lambda x: -x.pay,
```
Replace with:
```python
        any_tips=any(s.tips_eligible for s in shifts),
        venues=sorted(
            [EarningsVenue(venue_id=k, name=v["name"], hours=round(v["hours"], 2), pay=round(v["pay"], 2), shifts=len(v["shifts"]),
                           tips=round(v.get("tips", 0.0), 2))
             for k, v in by_venue.items()],
            key=lambda x: -x.pay,
```

**Edit 5.** Find:
```python
        payroll_shifts=len(payroll_rows),                                              # Phase 35
        payroll_venues=sorted({v.name for _r, _s, v in payroll_rows}),
    )

```
Replace with:
```python
        payroll_shifts=len(payroll_rows),                                              # Phase 35
        payroll_venues=sorted({v.name for _r, _s, v in payroll_rows}),
        total_tips=round(sum(t.total for t in tip_items), 2),                         # Phase 35.2
        tips=tip_items,
    )

```

**Edit 6.** Find:
```python
    w = csv.writer(out)
    w.writerow(["Date", "Venue", "Event", "Position", "Clock in (venue time)", "Clock out (venue time)",
                "Hours", "Hourly rate", "Pay before tips", "Gets tips", "Notes"])
    for s in reversed(data.shifts):                  # oldest first in the file
        notes = []
```
Replace with:
```python
    w = csv.writer(out)
    w.writerow(["Date", "Venue", "Event", "Position", "Clock in (venue time)", "Clock out (venue time)",
                "Hours", "Hourly rate", "Pay before tips", "Gets tips", "Notes", "Tips"])   # Phase 35.2: Tips at the end
    for s in reversed(data.shifts):                  # oldest first in the file
        notes = []
```

**Edit 7.** Find:
```python
            _local(s.clock_in_time, s.venue_timezone), _local(s.clock_out_time, s.venue_timezone) or "",
            f"{s.hours:.2f}", f"{s.rate:.2f}", f"{s.pay:.2f}", "Yes" if s.tips_eligible else "No", "; ".join(notes),
        ])
    w.writerow([])
    w.writerow(["Total", "", "", "", "", "", f"{data.total_hours:.2f}", "", f"{data.total_pay:.2f}", "", ""])
    name = f"shiftboard-hours-{data.start_date.isoformat()}-to-{data.end_date.isoformat()}.csv"
    return name, out.getvalue()
```
Replace with:
```python
            _local(s.clock_in_time, s.venue_timezone), _local(s.clock_out_time, s.venue_timezone) or "",
            f"{s.hours:.2f}", f"{s.rate:.2f}", f"{s.pay:.2f}", "Yes" if s.tips_eligible else "No", "; ".join(notes),
            f"{s.tips:.2f}" if s.tips else "",
        ])
    # Phase 35.2: tips for shifts with no clock-in of mine in the period (e.g. tracked by the venue's payroll)
    placed = {s.request_id for s in data.shifts if s.tips}
    for t in data.tips:
        if t.request_id in placed:
            continue
        w.writerow([
            _utc(t.start_time).astimezone(tz_of(t.venue_timezone)).strftime("%Y-%m-%d"), t.venue_name, t.event_title,
            t.role_type, "Tips only", "", "0.00", "", "0.00", "Yes", "", f"{t.total:.2f}",
        ])
    w.writerow([])
    w.writerow(["Total", "", "", "", "", "", f"{data.total_hours:.2f}", "", f"{data.total_pay:.2f}", "", "",
                f"{data.total_tips:.2f}"])
    name = f"shiftboard-hours-{data.start_date.isoformat()}-to-{data.end_date.isoformat()}.csv"
    return name, out.getvalue()
```

---

# PART B: Frontend

## B1. `frontend/src/components/VenueSettingsModal.jsx` (EDITS)
The Tips card (in the Time & pay periods tab, under "How your team's time is tracked"), form fields and save payload.

**Edit 1.** Find:
```jsx
import React, { useState, useEffect } from 'react';
import { Building2, MapPin, Crosshair, ExternalLink, Plus, Trash2, Save, RotateCcw, Info, EyeOff, Clock, Timer, CalendarRange } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```
Replace with:
```jsx
import React, { useState, useEffect } from 'react';
import { Building2, MapPin, Crosshair, ExternalLink, Plus, Trash2, Save, RotateCcw, Info, EyeOff, Clock, Timer, CalendarRange, Coins } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```

**Edit 2.** Find:
```jsx
    pay_period_anchor: venue?.pay_period_anchor || '',
    pay_period_approval: venue?.pay_period_approval ?? true,
  };
}
```
Replace with:
```jsx
    pay_period_anchor: venue?.pay_period_anchor || '',
    pay_period_approval: venue?.pay_period_approval ?? true,
    // Phase 35.2: tips
    tips_enabled: venue?.tips_enabled ?? true,
    tip_pool_split: venue?.tip_pool_split || 'hours',
    tip_pool_payroll: venue?.tip_pool_payroll ?? true,
    tips_shown_to_workers: venue?.tips_shown_to_workers ?? true,
  };
}
```

**Edit 3.** Find:
```jsx
    if (form.pay_period === 'biweekly' && form.pay_period_anchor) payload.pay_period_anchor = form.pay_period_anchor;
    payload.pay_period_approval = !!form.pay_period_approval;
    if (lat !== null) {
      payload.lat = lat;
```
Replace with:
```jsx
    if (form.pay_period === 'biweekly' && form.pay_period_anchor) payload.pay_period_anchor = form.pay_period_anchor;
    payload.pay_period_approval = !!form.pay_period_approval;
    payload.tips_enabled = !!form.tips_enabled;                                   // Phase 35.2
    payload.tip_pool_split = form.tip_pool_split;
    payload.tip_pool_payroll = !!form.tip_pool_payroll;
    payload.tips_shown_to_workers = !!form.tips_shown_to_workers;
    if (lat !== null) {
      payload.lat = lat;
```

**Edit 4.** Find:
```jsx
          </p>
        </div>
      </div>

```
Replace with:
```jsx
          </p>
        </div>

        {/* Phase 35.2: tips */}
        <div className={cardCls}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Coins className="w-4 h-4 text-amber-400" /> Tips
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={!!form.tips_enabled} onChange={(e) => setForm({ ...form, tips_enabled: e.target.checked })}
              className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500" />
            <span>
              <span className="block text-sm font-semibold text-white">Track tips in ShiftBoard</span>
              <span className="block text-xs text-slate-400">
                After an event, enter its tip pool and anyone's own tips on the event's time sheet. Positions marked
                "Tips" can get their own tips; positions marked "Tip pool" share the pool.
              </span>
            </span>
          </label>
          {form.tips_enabled && (
            <>
              <div>
                <span className={labelCls}>Share tip pools</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[['hours', 'By hours worked', 'More hours, bigger share.'], ['equal', 'Equally', 'Everyone in the pool gets the same.']].map(([id, title, body]) => (
                    <label key={id}
                      className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition ${form.tip_pool_split === id ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'}`}>
                      <input type="radio" name="tip_pool_split" value={id} checked={form.tip_pool_split === id} onChange={set('tip_pool_split')} className="mt-1 text-amber-500" />
                      <span>
                        <span className="block text-sm font-semibold text-white">{title}</span>
                        <span className="block text-[11px] text-slate-400">{body}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">This is the default; each event's time sheet can switch it.</p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={!!form.tip_pool_payroll} onChange={(e) => setForm({ ...form, tip_pool_payroll: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500" />
                <span>
                  <span className="block text-sm font-semibold text-white">People on your venue's payroll share tip pools</span>
                  <span className="block text-xs text-slate-400">They don't clock in here, so their scheduled hours are used for an hours split.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={!!form.tips_shown_to_workers} onChange={(e) => setForm({ ...form, tips_shown_to_workers: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500" />
                <span>
                  <span className="block text-sm font-semibold text-white">Workers see their tips in Hours & pay</span>
                  <span className="block text-xs text-slate-400">Off: only managers see tips (time sheets, pay periods, the hours download).</span>
                </span>
              </label>
            </>
          )}
        </div>
      </div>

```

---

## B2. `frontend/src/components/TimesheetModal.jsx` (EDITS)
A `TipsPanel` component (just above `export default function TimesheetModal`), shown at the top of the time sheet.

**Edit 1.** Find:
```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Check, X, Clock, DollarSign, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```
Replace with:
```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Check, X, Clock, DollarSign, AlertTriangle, Coins, Lock } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
```

**Edit 2.** Find:
```jsx
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const inputCls = 'px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white';

export default function TimesheetModal({ eventId, timeZone, onClose, onChanged }) {
```
Replace with:
```jsx
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const inputCls = 'px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white';

// Phase 35.2: the event's tips: a tip pool shared by tip-pool positions, and own tips per person
const toStr = (n) => (n ? String(Number(n).toFixed(2)) : '');

function TipsPanel({ eventId, refreshKey, onSaved }) {
  const [tips, setTips] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reset = (t) => {
    setTips(t);
    setDraft({
      pool: toStr(t.pool_amount), split: t.split, note: t.note || '',
      own: Object.fromEntries(t.people.map((p) => [p.request_id, toStr(p.individual)])),
    });
  };

  useEffect(() => {
    let alive = true;
    api.get(`/events/${eventId}/tips`)
      .then((res) => { if (alive) reset(res.data); })
      .catch(() => { if (alive) setTips(null); });
    return () => { alive = false; };
  }, [eventId, refreshKey]);

  if (!tips || !draft || !tips.enabled) return null;
  if (!tips.people.some((p) => p.tips_eligible || p.in_pool) && !tips.pool_amount) return null;

  const numOr0 = (v) => (v === '' ? 0 : parseFloat(v));
  const changedOwn = tips.people.filter((p) => numOr0(draft.own[p.request_id] ?? '') !== p.individual);
  const dirty = numOr0(draft.pool) !== tips.pool_amount || draft.split !== tips.split
    || (draft.note || '') !== (tips.note || '') || changedOwn.length > 0;

  const save = async () => {
    const bad = [draft.pool, ...Object.values(draft.own)].some((v) => v !== '' && (Number.isNaN(parseFloat(v)) || parseFloat(v) < 0));
    if (bad) return setError('Tips must be amounts of $0 or more.');
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await api.put(`/events/${eventId}/tips`, {
        pool_amount: numOr0(draft.pool),
        split: draft.split,
        note: draft.note,
        individual: changedOwn.map((p) => ({ request_id: p.request_id, amount: numOr0(draft.own[p.request_id] ?? '') || null })),
      });
      reset(res.data);
      setNotice('Tips saved.');
      onSaved && onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || 'The tips did not save.');
    } finally {
      setSaving(false);
    }
  };

  const ro = !tips.can_edit;
  const inCls = 'px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white disabled:opacity-50';
  return (
    <div className="mb-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-amber-100 inline-flex items-center gap-1.5">
          <Coins className="w-4 h-4 text-amber-400" /> Tips
          {tips.locked && <span className="text-[10px] font-semibold text-emerald-300 inline-flex items-center gap-0.5"><Lock className="w-3 h-3" /> locked</span>}
        </div>
        <span className="text-xs text-amber-100">Total <strong>{money(tips.total_tips)}</strong></span>
      </div>
      {ro && <p className="text-[11px] text-amber-100/80">{tips.blocked_reason}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-300">Tip pool ($)
          <input type="number" min="0" step="0.01" inputMode="decimal" aria-label="Tip pool" disabled={ro} value={draft.pool}
            onChange={(e) => setDraft({ ...draft, pool: e.target.value })} className={`${inCls} block mt-0.5 w-28`} placeholder="0.00" />
        </label>
        <label className="text-[11px] text-slate-300">Share it
          <select aria-label="Tip pool split" disabled={ro} value={draft.split} onChange={(e) => setDraft({ ...draft, split: e.target.value })} className={`${inCls} block mt-0.5`}>
            <option value="hours">By hours worked</option>
            <option value="equal">Equally</option>
          </select>
        </label>
        <label className="text-[11px] text-slate-300 flex-1 min-w-[10rem]">Note
          <input disabled={ro} value={draft.note} maxLength={300} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            className={`${inCls} block mt-0.5 w-full`} placeholder="e.g. card tips from the bar" />
        </label>
      </div>
      {tips.fell_back_equal && <p className="text-[11px] text-amber-200">Nobody in the pool has hours yet, so it's shared equally for now.</p>}
      {tips.pool_unshared && <p className="text-[11px] text-rose-300">Nobody on this event is in a tip-pool position, so the pool isn't shared with anyone.</p>}
      <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/60">
        {tips.people.map((p) => (
          <div key={p.request_id} className="px-2.5 py-1.5 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-white font-semibold min-w-[7rem]">{p.name}</span>
            <span className="text-[10px] text-slate-400 uppercase font-bold">{p.role_type}</span>
            {p.in_pool && (
              <span className="text-[10px] text-amber-300">
                pool{draft.split === 'hours' ? ` · ${p.basis_hours.toFixed(2)} h${p.time_tracking === 'payroll' ? ' scheduled' : ''}` : ''}
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              {p.tips_eligible ? (
                <input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Own tips for ${p.name}`} disabled={ro}
                  value={draft.own[p.request_id] ?? ''} placeholder="own tips"
                  onChange={(e) => setDraft({ ...draft, own: { ...draft.own, [p.request_id]: e.target.value } })} className={`${inCls} w-24`} />
              ) : <span className="text-[11px] text-slate-600 w-24 text-center">no tips</span>}
              <span className="text-slate-400 w-20 text-right" title="Share of the tip pool">{p.in_pool ? money(p.pool_share) : '—'}</span>
              <span className="text-amber-200 font-semibold w-20 text-right">{money(p.total)}</span>
            </span>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {notice && !dirty && <p className="text-xs text-emerald-300">{notice}</p>}
      {!ro && dirty && (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => reset(tips)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300">Undo</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
            <Check className="w-3 h-3" /> {saving ? 'Saving…' : 'Save tips'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function TimesheetModal({ eventId, timeZone, onClose, onChanged }) {
```

**Edit 3.** Find:
```jsx
      ) : data ? (
        <div className="space-y-3">
          {data.people.map((p) => {
            const st = STATUS[p.status] || { label: p.status, cls: 'bg-slate-800 text-slate-300 border-slate-700' };
```
Replace with:
```jsx
      ) : data ? (
        <div className="space-y-3">
          <TipsPanel eventId={eventId} refreshKey={data} onSaved={onChanged} />
          {data.people.map((p) => {
            const st = STATUS[p.status] || { label: p.status, cls: 'bg-slate-800 text-slate-300 border-slate-700' };
```

---

## B3. `frontend/src/components/manager/PayPeriodsModal.jsx` (EDITS)

**Edit 1.** Find:
```jsx
                  {p.overtime_hours > 0 && <span className="text-orange-300"> · OT {hrs(p.overtime_hours)}</span>}
                  {' · '}{money(p.total_pay)}
                </div>
              </button>
```
Replace with:
```jsx
                  {p.overtime_hours > 0 && <span className="text-orange-300"> · OT {hrs(p.overtime_hours)}</span>}
                  {' · '}{money(p.total_pay)}
                  {p.total_tips > 0 && <span className="text-amber-300"> · tips {money(p.total_tips)}</span>}
                </div>
              </button>
```

**Edit 2.** Find:
```jsx
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
```
Replace with:
```jsx
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {[
                      ['People', detail.people],
                      ['Hours', hrs(detail.total_hours)],
                      ['Overtime', hrs(detail.overtime_hours)],
                      ['Pay before tips', money(detail.total_pay)],
                      ['Tips', money(detail.total_tips)],                                // Phase 35.2
                    ].map(([k, v]) => (
                      <div key={k} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
```

**Edit 3.** Find:
```jsx
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
```
Replace with:
```jsx
                        <th className="text-right font-semibold px-2 py-2">Overtime</th>
                        <th className="text-right font-semibold px-2 py-2">Total</th>
                        <th className="text-right font-semibold px-2 py-2">Pay</th>
                        <th className="text-right font-semibold px-3 py-2">Tips</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {detail.rows.length === 0 && (
                        <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No ShiftBoard clock-ins in this period.</td></tr>
                      )}
                      {detail.rows.map((r) => (
```

**Edit 4.** Find:
```jsx
                          <td className={`px-2 py-2 text-right ${r.overtime_hours > 0 ? 'text-orange-300 font-bold' : 'text-slate-500'}`}>{r.overtime_hours.toFixed(2)}</td>
                          <td className="px-2 py-2 text-right text-white font-semibold">{r.hours.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-emerald-400 font-semibold">{money(r.pay)}</td>
                        </tr>
                      ))}
```
Replace with:
```jsx
                          <td className={`px-2 py-2 text-right ${r.overtime_hours > 0 ? 'text-orange-300 font-bold' : 'text-slate-500'}`}>{r.overtime_hours.toFixed(2)}</td>
                          <td className="px-2 py-2 text-right text-white font-semibold">{r.hours.toFixed(2)}</td>
                          <td className="px-2 py-2 text-right text-emerald-400 font-semibold">{money(r.pay)}</td>
                          <td className={`px-3 py-2 text-right ${r.tips > 0 ? 'text-amber-300 font-semibold' : 'text-slate-600'}`}>{r.tips > 0 ? money(r.tips) : '—'}</td>
                        </tr>
                      ))}
```

**Edit 5.** Find:
```jsx
                <p className="text-[11px] text-slate-500">
                  Pay is hours × each person's rate, before tips. Overtime is flagged, not paid extra here: your payroll adds any premium.
                </p>

```
Replace with:
```jsx
                <p className="text-[11px] text-slate-500">
                  Pay is hours × each person's rate, before tips. Overtime is flagged, not paid extra here: your payroll adds any premium.
                  Tips (own tips + tip-pool shares, entered on each event's time sheet) count on the day the shift starts.
                </p>

```

**Edit 6.** Find:
```jsx
                        <div key={r.worker_id} className="py-1.5 flex items-center justify-between text-xs">
                          <span className="text-white font-semibold">{r.name}</span>
                          <span className="text-violet-200">{r.shifts} shift{r.shifts === 1 ? '' : 's'} · {hrs(r.scheduled_hours)} scheduled</span>
                        </div>
                      ))}
```
Replace with:
```jsx
                        <div key={r.worker_id} className="py-1.5 flex items-center justify-between text-xs">
                          <span className="text-white font-semibold">{r.name}</span>
                          <span className="text-violet-200">
                            {r.shifts} shift{r.shifts === 1 ? '' : 's'} · {hrs(r.scheduled_hours)} scheduled
                            {r.tips > 0 && <span className="text-amber-300"> · tips {money(r.tips)}</span>}
                          </span>
                        </div>
                      ))}
```

---

## B4. `frontend/src/components/manager/DownloadHoursModal.jsx` (EDIT)

**Edit 1.** Find:
```jsx
        <p className="text-xs text-slate-400">
          {range.start ? `${dayText(range.start)} – ${dayText(range.end)}` : 'All clock-ins at this venue'}. Weeks start on Monday. Times are in
          the venue's time zone. Overtime follows your Time & pay settings. People your venue's own payroll tracks don't clock in
          here, so they aren't in this file. Tips aren't included yet.
        </p>
      </div>
```
Replace with:
```jsx
        <p className="text-xs text-slate-400">
          {range.start ? `${dayText(range.start)} – ${dayText(range.end)}` : 'All clock-ins at this venue'}. Weeks start on Monday. Times are in
          the venue's time zone. Overtime follows your Time & pay settings. Tips are in the last three columns (on each shift's
          first clock-in). People your venue's own payroll tracks don't clock in here, so they only appear on a "tips only"
          row when they got tips.
        </p>
      </div>
```

---

## B5. `frontend/src/pages/EarningsPage.jsx` (EDITS)

**Edit 1.** Find:
```jsx
              {data.label}: {dayText(data.start_date)} – {dayText(data.end_date)}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Tile icon={Clock} label="Hours" value={hoursText(data.total_hours)} sub={`${data.shifts_worked} shift${data.shifts_worked === 1 ? '' : 's'} worked`} />
              <Tile icon={Coins} label="Pay" value={money(data.total_pay)} sub="Before tips and taxes" />
              <Tile icon={CalendarCheck} label="Still coming" value={up.shifts ? money(up.est_pay) : '—'}
                sub={up.shifts ? `${up.shifts} booked shift${up.shifts === 1 ? '' : 's'} · about ${hoursText(up.hours)}` : 'Nothing else booked in this period'} />
```
Replace with:
```jsx
              {data.label}: {dayText(data.start_date)} – {dayText(data.end_date)}
            </p>
            <div className={`grid grid-cols-1 gap-3 ${data.total_tips > 0 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
              <Tile icon={Clock} label="Hours" value={hoursText(data.total_hours)} sub={`${data.shifts_worked} shift${data.shifts_worked === 1 ? '' : 's'} worked`} />
              <Tile icon={Coins} label="Pay" value={money(data.total_pay)} sub="Before tips and taxes" />
              {data.total_tips > 0 && (                                                  // Phase 35.2
                <Tile icon={Coins} label="Tips" value={money(data.total_tips)}
                  sub={`${data.tips.length} shift${data.tips.length === 1 ? '' : 's'} · entered by the venue`} />
              )}
              <Tile icon={CalendarCheck} label="Still coming" value={up.shifts ? money(up.est_pay) : '—'}
                sub={up.shifts ? `${up.shifts} booked shift${up.shifts === 1 ? '' : 's'} · about ${hoursText(up.hours)}` : 'Nothing else booked in this period'} />
```

**Edit 2.** Find:
```jsx
            )}

            {data.venues.length > 1 && (
              <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
```
Replace with:
```jsx
            )}

            {/* Phase 35.2: tips per shift (own tips + my share of the tip pool) */}
            {data.tips.length > 0 && (
              <section className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/30">
                <h2 className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-2">Tips</h2>
                <div className="divide-y divide-amber-500/10">
                  {data.tips.map((t) => (
                    <div key={t.request_id} className="py-2 flex items-center gap-3 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-semibold truncate">{t.event_title}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {fmtDate(t.start_time, t.venue_timezone)} · {t.role_type} · {t.venue_name}
                          {t.own > 0 && t.pool_share > 0 && ` · your tips ${money(t.own)} + pool ${money(t.pool_share)}`}
                          {t.own === 0 && t.pool_share > 0 && ' · tip pool share'}
                        </div>
                      </div>
                      <span className="w-24 text-right font-bold text-amber-300">{money(t.total)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data.venues.length > 1 && (
              <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
```

**Edit 3.** Find:
```jsx
                      <span className="text-slate-400">{hoursText(v.hours)}</span>
                      <span className="w-24 text-right font-bold text-emerald-400">{money(v.pay)}</span>
                    </div>
                  ))}
```
Replace with:
```jsx
                      <span className="text-slate-400">{hoursText(v.hours)}</span>
                      <span className="w-24 text-right font-bold text-emerald-400">{money(v.pay)}</span>
                      {data.total_tips > 0 && <span className="w-20 text-right text-amber-300">{v.tips > 0 ? `+${money(v.tips)}` : ''}</span>}
                    </div>
                  ))}
```

**Edit 4.** Find:
```jsx
                        <div className="text-right flex-shrink-0">
                          <div className="text-base font-black text-emerald-400">{s.in_progress ? '—' : money(s.pay)}</div>
                        </div>
                      </div>
```
Replace with:
```jsx
                        <div className="text-right flex-shrink-0">
                          <div className="text-base font-black text-emerald-400">{s.in_progress ? '—' : money(s.pay)}</div>
                          {s.tips > 0 && <div className="text-xs font-bold text-amber-300">+{money(s.tips)} tips</div>}
                        </div>
                      </div>
```

**Edit 5.** Find:
```jsx
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                Worked out from your clock-in and clock-out times × your pay rate, before tips and taxes
                {data.any_tips ? ' (tips aren’t tracked here yet)' : ''}. Your venue’s payroll is the final word. If a time looks wrong, ask the
                manager to fix it on their time sheet. Weeks start on Monday.
              </span>
```
Replace with:
```jsx
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                Worked out from your clock-in and clock-out times × your pay rate, before tips and taxes. Tips are what
                the venue entered for each shift (your own tips plus your share of any tip pool), counted on the day the
                shift starts; not every venue enters them here. Your venue’s payroll is the final word. If a time looks wrong, ask the
                manager to fix it on their time sheet. Weeks start on Monday.
              </span>
```

---

## B6. `frontend/src/components/worker/EarningsCard.jsx` (EDIT)

**Edit 1.** Find:
```jsx
          <div className="text-base font-black text-white">
            {hoursText(data.total_hours)} · <span className="text-emerald-400">{money(data.total_pay)}</span>
          </div>
          <div className="text-[11px] text-slate-400 truncate">
```
Replace with:
```jsx
          <div className="text-base font-black text-white">
            {hoursText(data.total_hours)} · <span className="text-emerald-400">{money(data.total_pay)}</span>
            {data.total_tips > 0 && <span className="text-amber-300"> + {money(data.total_tips)} tips</span>}
          </div>
          <div className="text-[11px] text-slate-400 truncate">
```

---

# PART V: Version, changelog & README (the standing directive, done for you)

## V1. `frontend/package.json` (EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.35.2",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.35.3",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.35.2"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.35.3"
```

---

## V3. `CHANGELOG.md` (EDIT)
The new section goes above `[0.35.2]`.

**Edit 1.** Find:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.2] - 2026-09-28 - Phase 35.1.1: Secrets out of .env
```
Replace with:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.3] - 2026-09-29 - Phase 35.2: Tips per event

### Added
- **Tips panel on each event's time sheet** (once the event has started):
  - the tip pool amount, how it's shared (by hours worked or equally) and a note
  - own tips per person (positions marked Tips)
  - each person's pool share and total, live
- **The pool is shared by everyone booked in Tip-pool positions:**
  - By hours: ShiftBoard clock-ins, or scheduled hours for people on the venue's payroll.
  - If nobody has hours yet, it's shared equally.
  - Shares are rounded to the cent and always add up to the pool.
  - No-shows get nothing.
- **Venue settings → Time & pay periods → Tips:**
  - track tips on / off (`venues.tips_enabled`)
  - default split (`tip_pool_split`: hours | equal)
  - whether venue-payroll people share pools (`tip_pool_payroll`)
  - whether workers see their tips (`tips_shown_to_workers`)
- **New table `event_tips`** (one pool per event), plus `shift_requests.tip_amount` and `pay_period_approvals.total_tips`.
- **API:** `GET /api/events/{id}/tips` and `PUT /api/events/{id}/tips`. Managers of the venue and admins only. Changes go in the activity log.
- **Pay periods:** a Tips total, tips per person (including people on venue payroll), and tips in the approval snapshot.
- **Hours download:** three new columns at the end, *Own tips*, *Tip pool share* and *Tips total*, on each shift's first clock-in row. There's a "tips only" row for people with tips but no clock-ins. Earlier columns keep their positions.
- **Worker Hours & pay:** a Tips tile, a Tips list, "+ $x tips" on each shift, and tips in the spreadsheet (a new last column).

### Changed
- An approved (locked) pay period also locks its tips (409 *"… Reopen it on the Pay periods screen to change its tips."*).

## [0.35.2] - 2026-09-28 - Phase 35.1.1: Secrets out of .env
```

---

## V4. `README.md` (EDITS)

**Edit 1.** Find:
```markdown
  * Overtime is flagged and counted (time sheets, pay periods, the hours download). ShiftBoard doesn't add an overtime premium to pay.
  * **Pay periods** screen: totals per person and per period. When approving is on, a finished period is **approved and locked**: nobody can add, edit or delete times or change pay rates in it until a manager reopens it with a reason. Approvals keep a snapshot of the totals and are logged.
* **Reliability scoring** (`services/reliability.py`):
  * The score is `100 × (on-time + ½ × late) ÷ (worked + no-shows + late drops)`, across the whole platform.
```
Replace with:
```markdown
  * Overtime is flagged and counted (time sheets, pay periods, the hours download). ShiftBoard doesn't add an overtime premium to pay.
  * **Pay periods** screen: totals per person and per period. When approving is on, a finished period is **approved and locked**: nobody can add, edit or delete times or change pay rates in it until a manager reopens it with a reason. Approvals keep a snapshot of the totals and are logged.
* **Tips per event** (Phase 35.2, `services/tips.py`, `routers/tips.py`):
  * After an event starts, a manager enters its **tip pool** and anyone's **own tips** in the Tips panel of the event's time sheet.
  * Positions marked **Tips** can get own tips; positions marked **Tip pool** share the pool.
  * The pool is split **by hours worked** or **equally** (a venue default; each event can switch). Hours are ShiftBoard clock-ins, or scheduled hours for people on the venue's payroll, who are in pools only when the venue allows it. Nobody with hours yet → equal. Shares are rounded to the cent and always add up to the pool.
  * No-shows get nothing. Tips count on the day the shift starts. They show in pay periods (per person and in the approval snapshot), the hours download (three columns at the end, plus "tips only" rows), and workers' Hours & pay (unless the venue hides them).
  * An approved pay period locks its tips too (409 until it's reopened). Turning tips off stops counting them; what was entered is kept.
* **Reliability scoring** (`services/reliability.py`):
  * The score is `100 × (on-time + ½ × late) ÷ (worked + no-shows + late drops)`, across the whole platform.
```

**Edit 2.** Find:
```markdown
* **Activity log** of every booking, change and approval. **Venue settings**:
  * address, website, clock-in area, clock-in rules
  * time tracking, overtime and pay periods (Time & pay periods tab)
  * approval policy, public cover
  * positions & pay, locations, templates
```
Replace with:
```markdown
* **Activity log** of every booking, change and approval. **Venue settings**:
  * address, website, clock-in area, clock-in rules
  * time tracking, overtime, pay periods and tips (Time & pay periods tab)
  * approval policy, public cover
  * positions & pay, locations, templates
```

---

# PART C: Rebuild & verification

**Schema change (new columns with defaults and a new empty table).** Pick ONE:

**Option 1: fresh database (wipes all data):**
```bash
docker compose down -v
docker compose up -d --build
```

**Option 2: keep your data (recommended).** Run once, then rebuild without `-v`. It's safe to run twice. Existing venues get the defaults: tips on, pools shared by hours, payroll people included, workers see their tips.
```bash
docker compose exec -T database sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS tips_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS tip_pool_split VARCHAR(20) NOT NULL DEFAULT 'hours';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS tip_pool_payroll BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS tips_shown_to_workers BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE shift_requests ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(10, 2);
ALTER TABLE pay_period_approvals ADD COLUMN IF NOT EXISTS total_tips NUMERIC(12, 2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS event_tips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL UNIQUE REFERENCES shift_events(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    pool_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    split VARCHAR(20) NOT NULL DEFAULT 'hours',
    note TEXT,
    updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_event_tips_venue ON event_tips(venue_id);
COMMIT;
SQL
docker compose up -d --build --force-recreate
```
(`POSTGRES_USER` / `POSTGRES_DB` are the database container's own settings, so this works whatever you named them.)

**AGY:** apply Parts A–V only. Don't run the SQL or any `docker compose` command; Andrew does that.

### Checklist
1. Admin → System: *Web app 0.35.3 · Server 0.35.3*.
2. Manager → **Settings → Time & pay periods**: the **Tips** card is there. Leave *By hours worked* on and save.
3. Post an event with a **Bartender** shift (Tips + Tip pool) and a **Server** shift (Tips only), book people, and let it start. Open its **Time sheet**: the **Tips** panel is at the top.
4. Enter a tip pool and a server's own tips, then **Save tips**. The bartenders' shares follow their hours and add up to the pool exactly.
5. **Pay periods**: the current period shows the **Tips** total and a per-person column.
6. **Download hours**: the last three columns are *Own tips*, *Tip pool share*, *Tips total*.
7. Sign in as one of those workers → **Hours & pay**: a **Tips** tile and list.
8. After approving a period, try changing that event's tips: you get *"… Reopen it on the Pay periods screen to change its tips."*

---

**"CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this."**

(For this phase, Part V already does all three for 0.35.3. Apply it as written and don't bump again.)