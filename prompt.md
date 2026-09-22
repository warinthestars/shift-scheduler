# Phase 21: Position-Based Pay & Tips, Reliability Scoring, Admin User Deletion, Super-Admin View Access

Four features in one phase:
1. **Super-Admin view access** — platform admins are currently blocked from `/worker` and `/venue` by frontend route guards (backend already allows them).
2. **Position-based pay & tips** — each role row in the "Create Shift" modal gets its own hourly rate, a "Tips eligible" checkbox, and (only when tips are eligible) a nested "Tip pool" checkbox. Example: Bartender @ $30 + tips (pooled), AV Tech @ $32 no tips — one submission, one `Shift` row per role (existing behavior).
3. **Reliability scoring** — computed on demand from existing `shift_requests` + `time_entries` data (platform-wide per worker), surfaced to Venue Managers as a badge.
4. **Admin user deletion** — `DELETE /api/admin/users/{user_id}` + UI with confirmation modal.

---

## 0. Guardrails (read before editing)
* DO NOT modify: `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/main.py`, `frontend/src/context/AuthContext.jsx`, `frontend/src/components/ProtectedRoute.jsx`.
* NO native PostgreSQL ENUMs. New columns are `BOOLEAN` / `TIMESTAMPTZ` only.
* All datetime comparisons use offset-aware UTC (`datetime.now(timezone.utc)`).
* NEVER call `await db.delete(<User ORM object>)` and NEVER call `UserResponse.model_validate(<User ORM object>)` — both trigger lazy loads → `MissingGreenlet`. Use Core `delete(User).where(...)` and the existing `_build_user_response` helper in `admin.py`.
* NEVER access an ORM relationship attribute (e.g. `user.managed_venues`, `shift.venue`, `req.shift`) unless it was loaded with `selectinload` in the same query.
* Schema changes go in BOTH `database/init.sql` AND `backend/src/models.py`. `init.sql` is what actually builds the tables.

---

## 1. Database Schema

### A. `database/init.sql`
In `CREATE TABLE shifts (...)`, add these two lines directly after `hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 25.00,`:
```sql
    tips_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    tip_pool BOOLEAN NOT NULL DEFAULT FALSE,
```
And add this constraint after `CONSTRAINT chk_spots CHECK (spots_filled <= capacity)` (add a comma to the preceding line):
```sql
    CONSTRAINT chk_tip_pool CHECK (tip_pool = FALSE OR tips_eligible = TRUE)
```

In `CREATE TABLE shift_requests (...)`, add directly after `notes TEXT,`:
```sql
    dropped_at TIMESTAMPTZ,
```

### B. `backend/src/models.py`
In `class Shift`, directly after the `hourly_rate = Column(...)` line:
```python
    tips_eligible = Column(Boolean, nullable=False, default=False)
    tip_pool = Column(Boolean, nullable=False, default=False)
```
In `class ShiftRequest`, directly after the `notes = Column(...)` line:
```python
    dropped_at = Column(DateTime(timezone=True), nullable=True)
```
Do not change any other model.

---

## 2. Pydantic Schemas (`backend/src/schemas.py`)

### A. Replace `class RoleRequirement` with:
```python
class RoleRequirement(BaseModel):
    role: str
    quantity: int = 1
    hourly_rate: Optional[float] = None
    tips_eligible: bool = False
    tip_pool: bool = False
```

### B. In `class ShiftCreate`, add after `hourly_rate`:
```python
    tips_eligible: Optional[bool] = False
    tip_pool: Optional[bool] = False
```

### C. In `class ShiftResponse`, add after `hourly_rate`:
```python
    tips_eligible: Optional[bool] = False
    tip_pool: Optional[bool] = False
```

### D. Add a new schema (place directly after `class ShiftRequestResponse`):
```python
class WorkerReliability(BaseModel):
    worker_id: UUID
    score: Optional[float] = None   # None = no commitments yet ("New")
    commitments: int = 0
    completed: int = 0
    on_time: int = 0
    late: int = 0
    no_show: int = 0
    late_drop: int = 0
```

---

## 3. Shift Creation & Drop (`backend/src/routers/shifts.py`)

### A. `create_shift` (`POST /api/shifts`)
Keep the existing venue lookup and manager-authorization block unchanged. Replace everything from `# Handle dynamic role requirements list if provided` down to (but not including) `# Reload with venue relation` with:
```python
    try:
        if shift_in.role_requirements and len(shift_in.role_requirements) > 0:
            first_shift = None
            for req in shift_in.role_requirements:
                rate = req.hourly_rate if req.hourly_rate is not None else (shift_in.hourly_rate or 25.0)
                if rate <= 0:
                    raise HTTPException(status_code=400, detail=f"Hourly rate for '{req.role}' must be greater than 0.")
                s = Shift(
                    venue_id=shift_in.venue_id,
                    created_by_user_id=current_user.id,
                    title=shift_in.title,
                    role_type=req.role,
                    start_time=shift_in.start_time,
                    end_time=shift_in.end_time,
                    capacity=max(1, req.quantity),
                    spots_filled=0,
                    is_shift_auto_confirm=shift_in.is_shift_auto_confirm or False,
                    hourly_rate=rate,
                    tips_eligible=bool(req.tips_eligible),
                    tip_pool=bool(req.tips_eligible and req.tip_pool),
                    description=shift_in.description,
                    status="OPEN"
                )
                db.add(s)
                if first_shift is None:
                    first_shift = s
            await db.commit()
            await db.refresh(first_shift)
            shift = first_shift
        else:
            rate = shift_in.hourly_rate or 25.0
            if rate <= 0:
                raise HTTPException(status_code=400, detail="Hourly rate must be greater than 0.")
            shift = Shift(
                venue_id=shift_in.venue_id,
                created_by_user_id=current_user.id,
                title=shift_in.title,
                role_type=shift_in.role_type or "Worker",
                start_time=shift_in.start_time,
                end_time=shift_in.end_time,
                capacity=shift_in.capacity or 1,
                spots_filled=0,
                is_shift_auto_confirm=shift_in.is_shift_auto_confirm or False,
                hourly_rate=rate,
                tips_eligible=bool(shift_in.tips_eligible),
                tip_pool=bool(shift_in.tips_eligible and shift_in.tip_pool),
                description=shift_in.description,
                status="OPEN"
            )
            db.add(shift)
            await db.commit()
            await db.refresh(shift)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create shift: {str(e)}")
```
Leave the `# Reload with venue relation` block after it unchanged.

### B. `drop_shift` (`POST /api/shifts/{shift_id}/drop`)
Inside the existing `try:` block, directly after `shift_req.status = "dropped"`, add:
```python
        shift_req.dropped_at = now_utc
```
(`now_utc` is already defined earlier in the function.) Change nothing else in this endpoint.

---

## 4. Reliability Service (`backend/src/services/reliability.py` — NEW FILE)

Create this file with exactly this content:
```python
from datetime import datetime, timezone, timedelta
from typing import Dict, List
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftRequest, TimeEntry

LATE_GRACE = timedelta(minutes=10)        # clock-in later than start + 10 min = late
LATE_DROP_WINDOW = timedelta(hours=72)    # dropped with < 72h notice = late drop
COMMITTED_STATUSES = ("approved", "confirmed", "checked_in", "completed")


def _aware(dt):
    if dt is None:
        return None
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def compute_reliability(db: AsyncSession, worker_ids: List[UUID]) -> Dict[UUID, dict]:
    """
    Platform-wide reliability per worker.
    score = 100 * (on_time + 0.5 * late) / (completed + no_show + late_drop)
    Returns score=None when the worker has zero commitments.
    Shifts that have not ended yet are ignored. Drops with >= 72h notice are excused.
    """
    if not worker_ids:
        return {}

    now = datetime.now(timezone.utc)
    stats = {
        wid: {"completed": 0, "on_time": 0, "late": 0, "no_show": 0, "late_drop": 0}
        for wid in worker_ids
    }

    rows = (await db.execute(
        select(
            ShiftRequest.worker_id,
            ShiftRequest.shift_id,
            ShiftRequest.status,
            ShiftRequest.dropped_at,
            ShiftRequest.check_in_time,
            Shift.start_time,
            Shift.end_time,
        )
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id.in_(worker_ids),
            func.lower(ShiftRequest.status).in_(COMMITTED_STATUSES + ("dropped",)),
        )
    )).all()

    te_rows = (await db.execute(
        select(TimeEntry.worker_id, TimeEntry.shift_id, func.min(TimeEntry.clock_in_time))
        .where(TimeEntry.worker_id.in_(worker_ids))
        .group_by(TimeEntry.worker_id, TimeEntry.shift_id)
    )).all()
    first_clock_in = {(w, s): _aware(t) for w, s, t in te_rows}

    for worker_id, shift_id, req_status, dropped_at, check_in_time, start_time, end_time in rows:
        st = stats.get(worker_id)
        if st is None:
            continue
        status_l = (req_status or "").lower()
        start = _aware(start_time)
        end = _aware(end_time)

        if status_l == "dropped":
            d = _aware(dropped_at)
            if d is not None and (start - d) < LATE_DROP_WINDOW:
                st["late_drop"] += 1
            continue

        if end is None or end >= now:
            continue  # shift not finished yet

        clock_in = first_clock_in.get((worker_id, shift_id)) or _aware(check_in_time)
        if clock_in is None:
            st["no_show"] += 1
        else:
            st["completed"] += 1
            if clock_in > start + LATE_GRACE:
                st["late"] += 1
            else:
                st["on_time"] += 1

    result = {}
    for wid, st in stats.items():
        commitments = st["completed"] + st["no_show"] + st["late_drop"]
        score = round(100.0 * (st["on_time"] + 0.5 * st["late"]) / commitments, 1) if commitments else None
        result[wid] = {**st, "commitments": commitments, "score": score}
    return result
```

---

## 5. Venue Endpoints (`backend/src/routers/venues.py`)

### A. Imports
* Change `from typing import List, Optional` → `from typing import List, Optional, Dict`
* Change `from sqlalchemy import select, delete, func` → `from sqlalchemy import select, delete, func, distinct`
* Add `WorkerReliability` to the existing `from src.schemas import (...)` block.
* Add: `from src.services.reliability import compute_reliability`

### B. New endpoint — add directly after `get_venue_pending_requests`:
```python
@router.get("/{venue_id}/reliability", response_model=Dict[str, WorkerReliability])
async def get_venue_reliability(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 21: Reliability scores for every worker who has requested a shift at this venue."""
    await verify_venue_manager_access(venue_id, current_user, db)
    worker_ids = (await db.execute(
        select(distinct(ShiftRequest.worker_id))
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(Shift.venue_id == venue_id)
    )).scalars().all()
    data = await compute_reliability(db, list(worker_ids))
    return {str(wid): WorkerReliability(worker_id=wid, **vals) for wid, vals in data.items()}
```
IMPORTANT: this route must be registered BEFORE any route that could shadow `/{venue_id}/reliability` (it will not conflict with `/{venue_id}` since the path has two segments).

### C. `get_venue_roster`
In the `ShiftRosterResponse(...)` constructor call, add after `hourly_rate=rate,`:
```python
                tips_eligible=bool(s.tips_eligible),
                tip_pool=bool(s.tip_pool),
```

### D. `export_venue_payroll_csv`
Replace the header row with:
```python
    writer.writerow(["Worker Name", "Email", "Shift Title", "Role", "Date", "Clock In", "Clock Out", "Total Hours", "Hourly Rate", "Gross Pay", "Tips Eligible", "Tip Pool"])
```
Inside the loop, replace the `total_hours` calculation block and the `writer.writerow(...)` call with:
```python
        rate = float(shift.hourly_rate) if shift.hourly_rate is not None else 0.0
        if entry.clock_in_time and entry.clock_out_time:
            hours = (entry.clock_out_time - entry.clock_in_time).total_seconds() / 3600.0
        else:
            hours = 0.0
        writer.writerow([
            worker_name, email, shift_title, shift.role_type or "", shift_date, clock_in, clock_out,
            f"{hours:.2f}", f"{rate:.2f}", f"{hours * rate:.2f}",
            "Yes" if shift.tips_eligible else "No",
            "Yes" if shift.tip_pool else "No",
        ])
```

---

## 6. Admin User Deletion (`backend/src/routers/admin.py`)

### A. Imports
* Add `from datetime import datetime, timezone`
* Add `TimeEntry` to the `from src.models import (...)` line.

### B. New endpoint — add directly after `update_admin_user`:
```python
@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_admin_user(
    user_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 21: Hard-delete a user. Blocked if the user has payroll history (time entries);
    in that case the admin should deactivate instead. DB-level ON DELETE CASCADE removes
    venue_managers, venue_whitelists, shift_requests, transfers, messages and ratings.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if normalize_role(user.role) == "platform_admin":
        admin_count = await db.scalar(
            select(func.count(User.id)).where(
                func.lower(User.role).in_(["platform_admin", "super_admin"]),
                User.is_active == True
            )
        )
        if (admin_count or 0) <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last active platform admin.")

    te_count = await db.scalar(select(func.count(TimeEntry.id)).where(TimeEntry.worker_id == user_id))
    if te_count and te_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"User has {te_count} time entries (payroll history). Deactivate this user instead of deleting."
        )

    try:
        now_utc = datetime.now(timezone.utc)
        # Free up spots on future shifts this worker was confirmed for
        future_shift_ids = (await db.execute(
            select(ShiftRequest.shift_id)
            .join(Shift, ShiftRequest.shift_id == Shift.id)
            .where(
                ShiftRequest.worker_id == user_id,
                func.lower(ShiftRequest.status).in_(["approved", "confirmed", "checked_in"]),
                Shift.start_time > now_utc
            )
        )).scalars().all()
        for sid in future_shift_ids:
            shift = await db.scalar(select(Shift).where(Shift.id == sid))
            if shift:
                shift.spots_filled = max(0, (shift.spots_filled or 1) - 1)
                if shift.status == "FILLED":
                    shift.status = "OPEN"

        # Core delete — do NOT use db.delete(user) (lazy-load → MissingGreenlet)
        await db.execute(delete(User).where(User.id == user_id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {str(e)}")
    return None
```

---

## 7. Frontend — Super-Admin View Access (`frontend/src/App.jsx`)
Change exactly two props:
* `/worker` route: `allowedRoles={['worker']}` → `allowedRoles={['worker', 'platform_admin']}`
* `/venue` route: `allowedRoles={['venue_manager']}` → `allowedRoles={['venue_manager', 'platform_admin']}`

Do not modify `ProtectedRoute.jsx`.

---

## 8. Frontend — Shared Badge Components (NEW FILES)

### A. `frontend/src/components/TipBadge.jsx`
```jsx
import React from 'react';

export default function TipBadge({ shift }) {
  if (!shift?.tips_eligible) return null;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">
      {shift.tip_pool ? '+ Tips (Pooled)' : '+ Tips'}
    </span>
  );
}
```

### B. `frontend/src/components/ReliabilityBadge.jsx`
```jsx
import React from 'react';

export default function ReliabilityBadge({ data }) {
  if (!data || data.score === null || data.score === undefined) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-700/40 text-slate-300 border border-slate-600/40">
        New
      </span>
    );
  }
  const score = Number(data.score);
  const tone =
    score >= 90
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : score >= 75
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  const tooltip = `${data.completed} completed · ${data.late} late · ${data.no_show} no-show · ${data.late_drop} late drop`;
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${tone}`}
    >
      {score.toFixed(0)}% reliable
    </span>
  );
}
```

---

## 9. Frontend — Venue Manager Dashboard (`frontend/src/pages/VenueManagerDashboard.jsx`)

### A. Imports
```jsx
import TipBadge from '../components/TipBadge';
import ReliabilityBadge from '../components/ReliabilityBadge';
```

### B. State changes
* DELETE the `hourlyRate` state: `const [hourlyRate, setHourlyRate] = useState('35.00');`
* Replace the `roleRequirements` initial state with:
```jsx
  const [roleRequirements, setRoleRequirements] = useState([
    { role: 'Bartender', quantity: 2, hourly_rate: '25.00', tips_eligible: false, tip_pool: false },
  ]);
```
* Add: `const [reliabilityMap, setReliabilityMap] = useState({});`

### C. `fetchVenueData`
Append one more request to the existing `Promise.all([...])` array (as the LAST element):
```jsx
        api.get(`/venues/${activeId}/reliability`).catch(() => ({ data: {} })),
```
Add a matching variable name (e.g. `reliabilityRes`) as the last item of the destructuring, and after the existing setters add:
```jsx
      setReliabilityMap(reliabilityRes.data || {});
```

### D. Role row handlers
* `handleAddRoleRow`: push `{ role: 'Server', quantity: 1, hourly_rate: '25.00', tips_eligible: false, tip_pool: false }`.
* Replace `handleRoleChange` entirely with:
```jsx
  const handleRoleChange = (index, field, value) => {
    const updated = roleRequirements.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row };
      if (field === 'quantity') {
        next.quantity = parseInt(value, 10) || 1;
      } else if (field === 'tips_eligible') {
        next.tips_eligible = Boolean(value);
        if (!value) next.tip_pool = false;
      } else if (field === 'tip_pool') {
        next.tip_pool = Boolean(value);
      } else {
        next[field] = value; // 'role' or 'hourly_rate' (kept as string while typing)
      }
      return next;
    });
    setRoleRequirements(updated);
  };
```

### E. `handleCreateShiftSubmit`
At the top of the `try` block (before date handling), add validation:
```jsx
      const payloadRoles = roleRequirements.map((r) => ({
        role: r.role,
        quantity: r.quantity,
        hourly_rate: parseFloat(r.hourly_rate),
        tips_eligible: r.tips_eligible,
        tip_pool: r.tips_eligible ? r.tip_pool : false,
      }));
      if (payloadRoles.some((r) => !r.hourly_rate || r.hourly_rate <= 0)) {
        setNotification({ type: 'error', message: 'Every role needs an hourly rate greater than $0.' });
        return;
      }
```
In the `api.post('/shifts', {...})` body: REMOVE `hourly_rate: parseFloat(hourlyRate),` and change `role_requirements: roleRequirements,` → `role_requirements: payloadRoles,`.
In the success reset, change to:
```jsx
      setRoleRequirements([{ role: 'Bartender', quantity: 2, hourly_rate: '25.00', tips_eligible: false, tip_pool: false }]);
```

### F. Create Shift modal JSX
* DELETE the entire "Hourly Rate ($)" `<div>` block (label + input bound to `hourlyRate`).
* Rename the label "Role Requirements (Dynamic List)" → "Positions".
* Replace the entire `{roleRequirements.map((row, idx) => ( ... ))}` block with:
```jsx
                  {roleRequirements.map((row, idx) => (
                    <div key={idx} className="p-3 bg-slate-800/50 border border-slate-700 rounded-xl space-y-2">
                      <div className="flex items-center space-x-2">
                        <select
                          value={row.role}
                          onChange={(e) => handleRoleChange(idx, 'role', e.target.value)}
                          className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                        >
                          <option value="Bartender">Bartender</option>
                          <option value="Server">Server</option>
                          <option value="Dishwasher">Dishwasher</option>
                          <option value="Barback">Barback</option>
                          <option value="AV Tech">AV Tech</option>
                        </select>
                        <input
                          type="number"
                          min="1"
                          value={row.quantity}
                          onChange={(e) => handleRoleChange(idx, 'quantity', e.target.value)}
                          className="w-16 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                          placeholder="Qty"
                          title="Quantity"
                        />
                        <div className="relative w-24">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            required
                            value={row.hourly_rate}
                            onChange={(e) => handleRoleChange(idx, 'hourly_rate', e.target.value)}
                            className="w-full pl-6 pr-2 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                            placeholder="Rate"
                            title="Hourly rate"
                          />
                        </div>
                        {roleRequirements.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRoleRow(idx)}
                            className="p-2 text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center space-x-4 pl-1">
                        <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.tips_eligible}
                            onChange={(e) => handleRoleChange(idx, 'tips_eligible', e.target.checked)}
                            className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-amber-500"
                          />
                          <span>Tips eligible</span>
                        </label>
                        {row.tips_eligible && (
                          <label className="flex items-center space-x-2 text-xs text-amber-300 cursor-pointer pl-4 border-l border-slate-700">
                            <input
                              type="checkbox"
                              checked={row.tip_pool}
                              onChange={(e) => handleRoleChange(idx, 'tip_pool', e.target.checked)}
                              className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-amber-500"
                            />
                            <span>Tip pool</span>
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
```

### G. Badges in existing lists
* Everywhere this file renders a shift's hourly rate (the `${shift?.hourly_rate}/hr` spans and the `${Number(shift.hourly_rate).toFixed(2)}/hr` span), render `<TipBadge shift={shift} />` immediately after that span, inside the same flex container. Wrap in a `<span className="inline-flex items-center gap-1.5">` if the parent is not a flex row.
* In the Pending Requests list (`pendingRequests.map((req) => { const worker = req.worker; ...`), directly after the span that renders `Number(worker?.aggregate_rating || 5.0).toFixed(1)`, add:
```jsx
<ReliabilityBadge data={reliabilityMap[worker?.id]} />
```
* Where `<ShiftRosterModal ... />` is rendered, add the prop `reliabilityMap={reliabilityMap}`.

---

## 10. Frontend — Roster Modal (`frontend/src/components/ShiftRosterModal.jsx`)
* Add imports: `import TipBadge from './TipBadge';` and `import ReliabilityBadge from './ReliabilityBadge';`
* Add `reliabilityMap = {}` to the component's destructured props.
* Directly after the element rendering `${Number(selectedShift.hourly_rate).toFixed(2)}/hr`, add `<TipBadge shift={selectedShift} />`.
* In the worker list, directly after the element rendering `{rating}`, add `<ReliabilityBadge data={reliabilityMap[worker.id]} />`.

---

## 11. Frontend — Worker Dashboard (`frontend/src/pages/WorkerDashboard.jsx`)
* Add `import TipBadge from '../components/TipBadge';`
* Everywhere this file renders a shift's hourly rate (open-shift cards `Number(shift.hourly_rate).toFixed(2)`, My Schedule `${shift?.hourly_rate}/hr` spans), render `<TipBadge shift={shift} />` immediately after it. Do NOT add it to the drop-confirmation modal text line.
* No other changes.

---

## 12. Frontend — Admin Panel User Deletion (`frontend/src/pages/AdminPanel.jsx`)

### A. Imports / state
* If not already imported, add `import { useAuth } from '../context/AuthContext';` and inside the component `const { user: currentUser } = useAuth();` (read-only consumption; do not modify AuthContext).
* Add `Trash2` to the existing `lucide-react` import if not present.
* Add state:
```jsx
  const [userToDelete, setUserToDelete] = useState(null);
  const [deletingUser, setDeletingUser] = useState(false);
```

### B. Handler (place after `handleToggleUserStatus`)
```jsx
  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setDeletingUser(true);
    try {
      await api.delete(`/admin/users/${userToDelete.id}`);
      setUsers((prev) => prev.filter((u) => u.id !== userToDelete.id));
      setNotification({ type: 'success', message: `Deleted ${userToDelete.email}.` });
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to delete user.',
      });
    } finally {
      setDeletingUser(false);
      setUserToDelete(null);
    }
  };
```

### C. Users table
* Add a header cell after `<th className="py-3 px-5">Registered</th>`:
```jsx
<th className="py-3 px-5 text-right">Actions</th>
```
* Add the matching last cell in each row of `filteredUsers.map((u) => ...)`:
```jsx
<td className="py-3 px-5 text-right">
  {currentUser?.id !== u.id && (
    <button
      type="button"
      onClick={() => setUserToDelete(u)}
      className="p-2 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10"
      title="Delete user"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )}
</td>
```

### D. Confirmation modal (render at the end of the component's root JSX, alongside the other modals)
```jsx
{userToDelete && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
      <h3 className="text-lg font-bold text-white">Delete user?</h3>
      <p className="text-sm text-slate-400">
        Permanently delete <span className="text-white font-semibold">{userToDelete.first_name} {userToDelete.last_name}</span> ({userToDelete.email})?
        Their venue assignments, shift requests, transfers and messages will be removed. Users with payroll history cannot be deleted — deactivate them instead.
      </p>
      <div className="flex justify-end space-x-3 pt-2">
        <button
          type="button"
          onClick={() => setUserToDelete(null)}
          disabled={deletingUser}
          className="px-4 py-2 text-sm rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDeleteUser}
          disabled={deletingUser}
          className="px-4 py-2 text-sm rounded-xl bg-rose-600 text-white font-semibold hover:bg-rose-500 disabled:opacity-50"
        >
          {deletingUser ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
)}
```
Do NOT use `window.confirm` or `alert`.

---

## 13. Rebuild & Verification

**Schema changed — destructive rebuild required:**
```bash
docker compose down -v
docker compose up -d --build
```

Verify:
1. Log in as platform admin → click "Worker View" and "Venue Manager View" in Navbar → both render (no "Access Denied").
2. As manager/admin, create a shift "Friday Gala" with two positions: Bartender ×2 @ $30, Tips eligible ✓, Tip pool ✓; AV Tech ×1 @ $32, Tips eligible ✗. Confirm the "Tip pool" checkbox only appears when "Tips eligible" is checked, and unchecking "Tips eligible" clears it.
3. `GET /api/venues/{venue_id}/shifts` → two shifts: Bartender `hourly_rate=30.0, tips_eligible=true, tip_pool=true`; AV Tech `hourly_rate=32.0, tips_eligible=false, tip_pool=false`.
4. Worker dashboard open-shift cards show "+ Tips (Pooled)" on Bartender and no badge on AV Tech.
5. `GET /api/venues/{venue_id}/reliability` → 200, JSON object keyed by worker UUID string; workers with no finished shifts have `"score": null` and render "New".
6. Payroll CSV contains the new columns Role, Hourly Rate, Gross Pay, Tips Eligible, Tip Pool.
7. Admin Panel → delete a user with no time entries → row disappears, 204. Delete a user with time entries → error notification with the 409 message; user remains.
8. Admin cannot see a delete button on their own row; `DELETE /api/admin/users/{own_id}` returns 400.
9. `grep -rn "CREATE TYPE" database/init.sql` → no results.