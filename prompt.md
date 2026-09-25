# Phase 26.3: "Hide pay from workers" must hide pay on every worker screen

## The bug
A position saved with **Hide pay from workers** ✓ (e.g. Bartender, $25/hr) still shows "$25/hr" and "≈ $175 for the shift" in the worker **Find Shifts** card and event popout.

**Cause:** the worker-facing code has a shortcut: *"if the viewer is a platform admin, or manages this venue, show the real pay."*
* `backend/src/services/listings.py` → `can_see_all_pay = managed is None or venue.id in managed`
* `backend/src/services/venue_public.py` → `manage or …` in two places, plus `show_rates = … or manage`
* `backend/src/services/shift_views.py::to_shift_responses` (used by worker endpoints) has the same admin/manager bypass

So an admin or manager who switches to the **Worker** view sees manager numbers, which makes it look like the setting doesn't work. The same bypass also let admins and managers see **staff-only notes** in the worker listing before being booked.

## The rule after this phase
* **Worker screens** show exactly what a worker would see, to *everyone*, admins and managers included: Find Shifts, event popout, Calendar, My Schedule, venue public pages, `/shifts/open`, `/shifts/my-shifts`, `/users/me/shifts`.
  * Hidden pay is shown **only** on a position the viewer is **booked** on.
  * Staff-only notes follow the same rule.
* **Manager screens** are unchanged and still show full pay: Posted Shifts, roster/Details, Edit, Time sheet, Payroll CSV. Those use `routers/venues.py::get_venue_events`, `routers/events.py` and `services/timesheets.py`, none of which are touched.

No database change. No new endpoints.

## 0. Rules
* Do **NOT** touch `auth.py`, `main.py`, `AuthContext.jsx`, `api/client.js`, or `vite.config.js`.
* Change **only** the lines shown. Do not refactor anything else in these files.
* Do not change `routers/venues.py`, `routers/events.py`, `services/timesheets.py`, or `services/worker_calendar.py`. The worker calendar already uses `show_pay = booked or not s.hide_rate`, which is correct.

---

## 1. `backend/src/services/shift_views.py` (EDIT)

Give `to_shift_responses` a `worker_view` flag. Find:
```python
    reveal_shift_ids: Optional[Set] = None,
) -> List[ShiftResponse]:
    shifts = list(shifts)
    reveal = reveal_shift_ids or set()
    managed = await viewer_managed_venue_ids(db, user)
```
Replace with:
```python
    reveal_shift_ids: Optional[Set] = None,
    worker_view: bool = False,
) -> List[ShiftResponse]:
    """
    worker_view=True (Phase 26.3): apply WORKER rules to everyone, admins and managers included,
    so worker-facing screens always show exactly what a worker would see. Hidden pay is then
    only revealed for shift ids in reveal_shift_ids (positions the viewer is booked on).
    """
    shifts = list(shifts)
    reveal = reveal_shift_ids or set()
    managed = set() if worker_view else await viewer_managed_venue_ids(db, user)
```
(Everything below stays the same. With `managed = set()`, `can_see` becomes true only for `s.id in reveal`.)

---

## 2. `backend/src/services/listings.py` (EDITS)

### 2a. Delete this import line
```python
from src.services.shift_views import viewer_managed_venue_ids
```

### 2b. Find and replace
```python
    managed = await viewer_managed_venue_ids(db, user)   # None = admin (sees all pay)
```
with
```python
    # Phase 26.3: listings are a WORKER screen. Everyone (admins and managers included) gets worker
    # rules: hidden pay and staff-only notes are shown only on a position the viewer is booked on.
```

### 2c. Delete this line (inside `for ev in events:`)
```python
        can_see_all_pay = managed is None or venue.id in managed
```

### 2d. Find
```python
            visible = (not s.hide_rate) or can_see_all_pay or (my_status in ASSIGNED_STATUSES)
```
Replace with
```python
            booked_here = my_status in ASSIGNED_STATUSES
            visible = (not s.hide_rate) or booked_here
```

### 2e. Find (inside `ListingPosition(...)`)
```python
                staff_notes=s.staff_notes if (can_see_all_pay or my_status in ASSIGNED_STATUSES) else None,
```
Replace with
```python
                staff_notes=s.staff_notes if booked_here else None,
```

### 2f. Find (inside `EventListing(...)`)
```python
            staff_notes=ev.staff_notes if (
                can_see_all_pay or (my_request is not None and my_request.status in ASSIGNED_STATUSES)
            ) else None,
```
Replace with
```python
            staff_notes=ev.staff_notes if (
                my_request is not None and my_request.status in ASSIGNED_STATUSES
            ) else None,
```

After this, `grep -n "can_see_all_pay\|managed" backend/src/services/listings.py` must return **nothing**.

`est_pay_min` / `est_pay_max`, `pay_min` / `pay_max` and the card headline need no other change: they are computed from `rate`, which is now `None` for hidden positions. The card and popout then show "Pay shared when booked", with no earnings estimate.

---

## 3. `backend/src/services/venue_public.py` (EDITS)

### 3a. In `build_profile`, find
```python
    show_rates = bool(venue.show_rates_publicly) or manage
```
Replace with
```python
    show_rates = bool(venue.show_rates_publicly)   # Phase 26.3: same for everyone, managers included
```

### 3b. In `build_profile`, `PublicPosition(...)`: find
```python
                default_rate=float(p.default_rate) if (show_rates and (manage or not p.hide_rate)) else None,
                default_rate_max=(
                    float(p.default_rate_max)
                    if (p.default_rate_max is not None and show_rates and (manage or not p.hide_rate))
                    else None
                ),
```
Replace with
```python
                # Phase 26.3: public page = what workers see, for everyone (no manager/admin bypass)
                default_rate=float(p.default_rate) if (show_rates and not p.hide_rate) else None,
                default_rate_max=(
                    float(p.default_rate_max)
                    if (p.default_rate_max is not None and show_rates and not p.hide_rate)
                    else None
                ),
```
(Leave `arrival_instructions=… if (manage or booked_here)` and `can_manage=manage` as they are.)

### 3c. In `build_public_events`, delete the now-unused line
```python
    manage = await can_manage_venue(db, user, venue.id)
```
(the one directly above `q = select(Shift).where(Shift.venue_id == venue.id)`), then find
```python
        can_see = (not s.hide_rate) or manage or (my in ASSIGNED_STATUSES)
```
Replace with
```python
        can_see = (not s.hide_rate) or (my in ASSIGNED_STATUSES)   # Phase 26.3: no manager/admin bypass
```

---

## 4. `backend/src/routers/shifts.py` (EDITS)

### 4a. `get_open_shifts` (`GET /api/shifts/open`): its last line
```python
    return await to_shift_responses(db, result.scalars().all(), current_user)
```
becomes
```python
    return await to_shift_responses(db, result.scalars().all(), current_user, worker_view=True)
```
Change **only** the line in `get_open_shifts`. The identical line in `get_shifts` (`GET /api/shifts`) stays as is.

### 4b. `request_shift`: in the `to_shift_responses(...)` call, add `worker_view=True,`
```python
        shown = await to_shift_responses(
            db, [req_obj.shift], current_user,
            reveal_shift_ids={req_obj.shift_id} if status_val == "approved" else set(),
            worker_view=True,
        )
```

### 4c. `get_my_shifts` (`GET /api/shifts/my-shifts`) currently returns raw rows, so hidden pay isn't masked. Replace the **body** (keep the decorator and signature) with:
```python
    """Retrieve all shift requests submitted by the logged-in worker (Phase 26.3: hidden pay masked)"""
    result = await db.execute(
        select(ShiftRequest)
        .options(
            selectinload(ShiftRequest.shift).selectinload(Shift.venue),
            selectinload(ShiftRequest.worker)
        )
        .where(ShiftRequest.worker_id == current_user.id)
        .order_by(ShiftRequest.created_at.desc())
    )
    reqs = result.scalars().all()
    booked = ("approved", "confirmed", "checked_in", "completed")
    shifts = [r.shift for r in reqs if r.shift is not None]
    reveal = {r.shift_id for r in reqs if (r.status or "").lower() in booked}
    shown = {
        sr.id: sr for sr in await to_shift_responses(
            db, shifts, current_user, reveal_shift_ids=reveal, worker_view=True,
        )
    }
    out = []
    for r in reqs:
        item = ShiftRequestResponse.model_validate(r)
        if r.shift_id in shown:
            item.shift = shown[r.shift_id]
        out.append(item)
    return out
```

---

## 5. `backend/src/routers/users.py` (EDIT)

In `get_my_shifts_alias` (`GET /api/users/me/shifts`), find
```python
    shown = {s.id: s for s in await to_shift_responses(db, shifts, current_user, reveal_shift_ids=reveal)}
```
Replace with
```python
    shown = {s.id: s for s in await to_shift_responses(db, shifts, current_user, reveal_shift_ids=reveal, worker_view=True)}
```

---

## 6. `frontend/src/pages/WorkerDashboard.jsx` (EDIT): "Worker preview" notice

When an admin or manager opens the Worker view, tell them it's a true preview. Find:
```jsx
        {/* Phase 26.2: don't let anyone miss updated shift info */}
```
Insert **directly above** it:
```jsx
        {/* Phase 26.3: admins / managers looking at the Worker view see exactly what workers see */}
        {!['worker'].includes(String(user?.role || '').toLowerCase()) && (
          <div className="mb-6 p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-300 flex-shrink-0 mt-0.5" />
            <span>
              <b>Worker preview.</b> You're seeing this page exactly as a worker would: hidden pay and
              staff-only notes stay hidden unless you're booked on that position. Your manager screens still show full pay.
            </span>
          </div>
        )}

```
(`user` comes from the existing `const { user } = useAuth();` and `Info` is already imported. This only **reads** `user.role` and does not modify AuthContext.)

---

## 7. Rebuild & Verify

No schema change:
```bash
docker compose up -d --build
```
If the page is blank or shows "Invalid hook call": `docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend`, then hard-refresh.

**Checklist**
1. As admin or manager, edit "Test Concert": Bartender has **Hide pay from workers** ✓ and AV Tech doesn't. Save.
2. Switch to **Worker** view (or log in as a worker). You see the indigo **Worker preview** notice (workers don't see it).
3. **Find Shifts card:**
   * the Bartender row shows **—** for pay
   * the headline shows **$32/hr**, from AV Tech only
   * there's no Bartender earnings estimate
4. **Event popout:**
   * Bartender shows **"Pay shared when booked"**, with no "≈ $175" line
   * AV Tech still shows **$32/hr** and **≈ $224**
5. Book a worker on Bartender (instant or approved). That worker now sees **$25/hr** on Bartender in the popout, Calendar and My Schedule.
6. As the manager, **Posted Shifts → Details** and **Time sheet** still show $25/hr, with the "hidden from workers" label.
7. **Venue profile** (`/venues/<id>`) as the manager: a hidden-rate position shows "Pay shared when booked". It no longer shows the real rate.
8. API spot-check as admin: `GET /api/listings/<event_id>` returns `hourly_rate: null`, `est_pay_min: null` and `staff_notes: null` for Bartender.