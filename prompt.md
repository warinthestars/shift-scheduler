# Phase 29.4: Worker View Overhaul, and Coming Back After a Drop

**Why:** The worker page grew one feature at a time: offers, hand-offs, the calendar, read-receipts, clock-in windows and location checks. An audit of it, both on the live site and on a local copy loaded with a realistic worker (a shift today, an updated shift, a pending request, a drop, a hand-off offer, a manager's offer and history), found these problems:

* **Too many buttons:** each shift card showed up to 7 of them (Details, Directions, Calendar, Board, Transfer, Drop, Clock In). The one that matters right now (Clock in, Read the update) was last in the row, and on phones it wrapped under everything else.
* **Tabs cut off on phones:** "My Schedule" was cut in half and "Pending Transfers" was off-screen, with no hint to scroll.
* **Opening tab:** the page always opened on Find Shifts, even when the worker has a shift in an hour.
* **Hand-offs:**
  - The worker screens say "Transfer" while managers see "Hand-off".
  - A worker couldn't see or withdraw a hand-off they had sent. `GET /transfers/my-outgoing` existed but nothing used it.
  - The incoming hand-off card didn't show the teammate's note.
  - On the server, a sender could "cancel" a hand-off even after the manager had approved it.
* **Drop button and dialog:**
  - The Drop button used light-theme colours (`text-red-600`, `hover:bg-red-50`, a white flash on the dark page).
  - The drop dialog was hand-built, so Esc didn't close it.
  - It gave no way to say why, and no warning that dropping within 72 h counts as a late drop.
* **Raw data on cards:** labels like "Via: manager assign", "1 transfers" and "7 open" were shown as-is.
* **Dropped shifts in Find Shifts:** they said "you" and offered **Book instantly**, and the server then refused with "You dropped this shift earlier…". The status label read "Released".
* **Managers couldn't undo a drop:** they couldn't book back someone who dropped (the Assign button refused), even when the worker could make it after all. That's the second half of this phase.
* **Timestamps:** approving a request stored a naive `datetime.utcnow()`, which breaks the aware-UTC rule.

## What this phase adds

### A. Coming back after a drop (flagged, always approved by a manager)
1. **Worker asks back:**
   * A dropped shift appears on My shifts under **"Dropped · you can still ask to come back"**. The same applies to the event in Find shifts, where the CTA reads "Ask to come back".
   * The request form requires **"Why you can make it now"** (5+ characters).
   * The request **always waits for a manager**, even when the venue books the team instantly. This covers any position in that event, not only the one they dropped.
   * **Withdrawing and asking again still needs a reason**, so there's no loophole.
   * After a denial, that position stays closed to them (same as any denial today).
2. **Managers see the flag everywhere:**
   * Queue card: "Dropped this event on Sat, Sep 26 and is asking back. Needs your OK."
   * Review modal: a red box, and the note is headed "Why they can make it now".
   * The event roster.
   * The bell: "… dropped this earlier and is asking back · Server".
   * The activity log: "… requested … · asking back after dropping · "reason"".
3. **Manager books someone back:**
   * The roster shows a new **Dropped** list under each position, with who dropped, when and their reason, and a **Book back…** button that asks for a reason.
   * In **Assign / Offer**, people who dropped this event show "Dropped this event on … · "reason"". **Assign** asks for a reason inline before booking. **Offers skip them** ("Use Assign with a reason").
   * The API refuses to assign without a reason (400).
   * The roster marks the person "Back after dropping on … · "reason"".
   * The activity log reads "Assigned … · booked back after a drop · "reason"".
4. **Drop reason:** Drop now takes an optional reason (`POST /api/shifts/{id}/drop {reason}`). It's saved in `status_reason`, shown to managers in the drop notification and the activity log, and shown back to the worker. Old clients that send no body still work.
5. **Reliability stays honest:**
   * The row keeps `dropped_at`.
   * A drop still counts while they're asking back, after they withdraw, or after a denial.
   * It stops counting only if they actually work the shift.
   * Two new columns on `shift_requests`: `previous_drop_at` and `rebook_reason`.

### B. Worker page overhaul
1. **Tabs:**
   * Renamed and reordered to **My shifts · Find shifts · Calendar · Hand-offs**, with counts and badges.
   * On phones they sit in a **2×2 grid**, so none are hidden.
   * The page **opens on My shifts** when you have something coming up or an offer to answer; otherwise it opens on Find shifts.
   * The tab ids are unchanged (`schedule`, `find`, `calendar`, `transfers`), so every notification link keeps working.
2. **Header:**
   * Profile photo with an initials fallback.
   * Clickable chips: rating, "N coming up", "N waiting for your answer" (offers plus hand-offs), "N open to pick up".
   * A "Worker preview" badge appears only for admins and managers, instead of "Worker" for everyone.
3. **My shifts cards** (new `MyShiftCard`):
   * A date tile and a plain status: Confirmed · Waiting for the manager · Worked · You dropped this · Clocked in.
   * Where the booking came from, in words: "Assigned by your manager", "Booked instantly (team)", "You accepted an offer"…
   * **One main button:**
     - Clock in / Clock out
     - "Clock-in opens 8:01 PM"
     - Read the update. When clock-in is open, it shows next to Clock in and **never hides it**.
     - Withdraw request
     - Ask to come back
   * **Everything else is in a ⋯ menu:** Details & notes, Directions, Add to my calendar, Shift chat, Hand off to a teammate, Drop shift. Drop is disabled inside 24 h, with the reason.
   * Offers are answered at the top of My shifts. Other tabs show a slim "N shifts offered to you" link.
4. **Drop dialog** (new `DropShiftDialog`):
   * Uses the standard modal, so Esc works.
   * Optional reason.
   * Late-drop warning inside 72 h.
   * Explains the spot opens right away and that coming back needs approval.
5. **Hand-offs tab** (new `HandoffsPanel`):
   * **Offered to you**: shows the teammate's note, plus Accept / Decline.
   * **Sent by you** (last 14 days): shows each hand-off's status in words, with **Withdraw** while it's still waiting.
   * The hand-off modal (`TransferModal`) uses the standard modal and "hand off" wording, and says clearly **you keep the shift until the manager approves**.
6. **Banners:** messages are plain ("Shift dropped. Your manager has been told…"). They're dismissed with ✕.
7. **Server fixes:**
   * Declining or withdrawing a hand-off only works while it's still waiting. Before this, a sender could "cancel" an already approved hand-off.
   * Approvals store an aware UTC time.
   * The "shift dropped" alert is no longer swallowed by the dedupe key when someone drops the same shift a second time.

⚠️ **Schema change:** two new columns on `shift_requests`. See §E.

## 0. Rules for this phase (read first)
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `main.py` (unchanged this phase)
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
* No new npm or Python packages.
* No native PostgreSQL ENUMs. Statuses are unchanged; "asking back" is an ordinary `pending` request with `previous_drop_at` set.
* Aware UTC datetimes only.
* Notification and activity hooks run after the commit, as before.
* **Keep `dropped_at` on the request row** when someone asks back or is booked back. Reliability depends on it. Do not add `req.dropped_at = None` back into `booking.py` or `staffing.py`.
* **NEW FILE / FULL FILE REPLACEMENT**: write exactly the content shown. **EDITS**: each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* These blocks were generated from the real current (Phase 29.3) files and checked:
  - after applying them, the backend imports cleanly (155 API operations; no new routes)
  - the frontend bundles with no missing imports
  - 39 new integration checks pass against PostgreSQL 16, and the Phase 29, 29.1, 29.2 and 29.3 suites still pass
  - the new worker page (desktop and phone), the ⋯ menu, the drop dialog, ask-to-come-back, the Hand-offs tab, and the manager's roster / Book back / Assign-with-reason were rendered with the real Tailwind build

  Don't "improve" them.

---

# PART A: Database, models, schemas

## A1. `database/init.sql` (EDIT)

**Edit 1.** Find:
```sql
    dropped_at TIMESTAMPTZ,
    status_reason TEXT,
    pay_rate NUMERIC(10, 2),
    info_seen_at TIMESTAMPTZ,
```
Replace with:
```sql
    dropped_at TIMESTAMPTZ,
    status_reason TEXT,
    previous_drop_at TIMESTAMPTZ,                             -- Phase 29.4: coming back after dropping this event
    rebook_reason TEXT,                                       -- Phase 29.4: why (worker's request note or the manager's reason)
    pay_rate NUMERIC(10, 2),
    info_seen_at TIMESTAMPTZ,
```

---

## A2. `backend/src/models.py` (EDIT)

**Edit 1.** Find:
```python
    dropped_at = Column(DateTime(timezone=True), nullable=True)
    status_reason = Column(Text, nullable=True)
    pay_rate = Column(Numeric(10, 2), nullable=True)
    info_seen_at = Column(DateTime(timezone=True), nullable=True)          # Phase 26.2: worker read the shift info
```
Replace with:
```python
    dropped_at = Column(DateTime(timezone=True), nullable=True)
    status_reason = Column(Text, nullable=True)
    previous_drop_at = Column(DateTime(timezone=True), nullable=True)   # Phase 29.4: rebooked / asking back after a drop
    rebook_reason = Column(Text, nullable=True)                         # Phase 29.4
    pay_rate = Column(Numeric(10, 2), nullable=True)
    info_seen_at = Column(DateTime(timezone=True), nullable=True)          # Phase 26.2: worker read the shift info
```

---

## A3. `backend/src/schemas.py` (EDITS)
* `ShiftRequestResponse`: `dropped_at`, `previous_drop_at`, `rebook_reason`
* `RosterPerson`: drop and rebook fields
* `EventPosition.dropped`
* `ListingPosition.my_dropped_at`, `EventListing.dropped_here`
* `AssignCandidate.dropped_at` / `drop_reason`
* `AssignRequest.reason`
* the new `DropShiftBody`

**Edit 1.** Find:
```python
    pay_rate: Optional[float] = None
    notes: Optional[str] = None         # Phase 26.1: the worker's note with the request
    shift: Optional[ShiftResponse] = None
    worker: Optional[UserBrief] = None
```
Replace with:
```python
    pay_rate: Optional[float] = None
    notes: Optional[str] = None         # Phase 26.1: the worker's note with the request
    dropped_at: Optional[datetime] = None            # Phase 29.4
    previous_drop_at: Optional[datetime] = None      # Phase 29.4: asking back / rebooked after dropping this event
    rebook_reason: Optional[str] = None              # Phase 29.4
    shift: Optional[ShiftResponse] = None
    worker: Optional[UserBrief] = None
```

**Edit 2.** Find:
```python
    rating_review: Optional[str] = None
    approval_source: Optional[str] = None   # Phase 29: e.g. manager_assign, offer


```
Replace with:
```python
    rating_review: Optional[str] = None
    approval_source: Optional[str] = None   # Phase 29: e.g. manager_assign, offer
    dropped_at: Optional[datetime] = None        # Phase 29.4: when they dropped (dropped list)
    drop_reason: Optional[str] = None            # Phase 29.4: what they said when dropping
    previous_drop_at: Optional[datetime] = None  # Phase 29.4: came back / asking back after a drop
    rebook_reason: Optional[str] = None          # Phase 29.4


```

**Edit 3.** Find:
```python
    requested: List[RosterPerson] = []
    offers: List[PositionOffer] = []         # Phase 29: pending + recently answered offers


```
Replace with:
```python
    requested: List[RosterPerson] = []
    offers: List[PositionOffer] = []         # Phase 29: pending + recently answered offers
    dropped: List[RosterPerson] = []         # Phase 29.4: people who dropped this position (can be booked back)


```

**Edit 4.** Find:
```python
    my_status: Optional[str] = None            # viewer's request status on this position
    my_status_reason: Optional[str] = None
    staff_notes: Optional[str] = None          # Phase 26.2: only when the viewer is booked here (or manages)

```
Replace with:
```python
    my_status: Optional[str] = None            # viewer's request status on this position
    my_status_reason: Optional[str] = None
    my_dropped_at: Optional[datetime] = None   # Phase 29.4: the viewer dropped this position
    staff_notes: Optional[str] = None          # Phase 26.2: only when the viewer is booked here (or manages)

```

**Edit 5.** Find:
```python
    started: bool = False
    can_request: bool = True


```
Replace with:
```python
    started: bool = False
    can_request: bool = True
    dropped_here: Optional[datetime] = None           # Phase 29.4: viewer dropped a position in this event -> asking back needs a reason + approval


```

**Edit 6.** Find:
```python
    offered: bool = False                    # has a pending offer for this position
    venue_shifts: int = 0


class AssignRequest(BaseModel):
    worker_id: UUID


```
Replace with:
```python
    offered: bool = False                    # has a pending offer for this position
    venue_shifts: int = 0
    dropped_at: Optional[datetime] = None    # Phase 29.4: dropped this event; Assign needs a reason, offers are skipped
    drop_reason: Optional[str] = None


class AssignRequest(BaseModel):
    worker_id: UUID
    reason: Optional[str] = Field(None, max_length=500)   # Phase 29.4: required to book back someone who dropped this event


```

**Edit 7.** Find:
```python
class SaveAsTemplateRequest(BaseModel):
    name: str
```
Replace with:
```python
class SaveAsTemplateRequest(BaseModel):
    name: str


# ------------------------------------------------------------------------------
# Phase 29.4: Drops
# ------------------------------------------------------------------------------
class DropShiftBody(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)   # optional; managers see it
```

---

# PART B: Backend

## B1. `backend/src/services/booking.py` (EDITS)
Ask-back rules: reason required, always pending, and `dropped_at` kept. Also adds the `prior_drop_in_event()` helper that staffing uses.

**Edit 1.** Find:
```python
* A position can be requested again only after the worker WITHDREW it. Drops, rejections,
  removals, no-shows and hand-offs stay on record (they feed reliability).
"""
import logging
```
Replace with:
```python
* A position can be requested again only after the worker WITHDREW it. Drops, rejections,
  removals, no-shows and hand-offs stay on record (they feed reliability).
* Phase 29.4: a worker who DROPPED a position in this event can ask to come back (same or another
  position). They must say why, it always waits for a manager, and the request carries
  previous_drop_at + rebook_reason. dropped_at is kept on the row so the drop still counts for
  reliability unless they end up working the shift.
"""
import logging
```

**Edit 2.** Find:
```python
ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
ACTIVE_STATUSES = PENDING_STATUSES + ASSIGNED_STATUSES
REREQUESTABLE_STATUSES = ("withdrawn",)
BLOCKED_MESSAGES = {
    "rejected": "The venue already passed on your request for this position. You can request a different position.",
    "removed": "The venue removed you from this shift.",
    "no_show": "You were marked as a no-show for this shift.",
    "cancelled": "This position was cancelled.",
    "dropped": "You dropped this shift earlier, so it can't be picked back up here. Message the manager if they still need you.",
    "transferred": "You handed this shift off earlier.",
}
NOTE_MAX = 500


```
Replace with:
```python
ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
ACTIVE_STATUSES = PENDING_STATUSES + ASSIGNED_STATUSES
REREQUESTABLE_STATUSES = ("withdrawn", "dropped")      # Phase 29.4: dropped = ask to come back
BLOCKED_MESSAGES = {
    "rejected": "The venue already passed on your request for this position. You can request a different position.",
    "removed": "The venue removed you from this shift.",
    "no_show": "You were marked as a no-show for this shift.",
    "cancelled": "This position was cancelled.",
    "transferred": "You handed this shift off earlier.",
}
NOTE_MAX = 500


REBOOK_REASON_MIN = 5


async def prior_drop_in_event(db: AsyncSession, worker_id, shift: Shift) -> Optional[datetime]:
    """Phase 29.4: the latest time this worker dropped a position in this event (or this shift), if ever."""
    q = (
        select(func.max(ShiftRequest.dropped_at))
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.worker_id == worker_id, ShiftRequest.dropped_at.isnot(None))
    )
    q = q.where(Shift.event_id == shift.event_id) if shift.event_id else q.where(Shift.id == shift.id)
    return await db.scalar(q)


```

**Edit 3.** Find:
```python
                )

        # --- Earlier history on this exact position ---------------------------------------
        existing = await db.scalar(
```
Replace with:
```python
                )

        # --- Phase 29.4: coming back after a drop needs a reason and a manager ---------------
        prior_drop = await prior_drop_in_event(db, worker.id, shift)
        clean_note = _clean_note(note)
        if prior_drop is not None and (not clean_note or len(clean_note) < REBOOK_REASON_MIN):
            raise HTTPException(
                status_code=400,
                detail="You dropped a shift at this event earlier. Tell the manager why you can make it now. "
                       "They have to approve it.",
            )

        # --- Earlier history on this exact position ---------------------------------------
        existing = await db.scalar(
```

**Edit 4.** Find:
```python
        decision, source = await evaluate_shift_request(db=db, worker=worker, shift=shift, venue=shift.venue)
        status_val = (decision.value if hasattr(decision, "value") else str(decision)).lower()
        now = datetime.now(timezone.utc)

```
Replace with:
```python
        decision, source = await evaluate_shift_request(db=db, worker=worker, shift=shift, venue=shift.venue)
        status_val = (decision.value if hasattr(decision, "value") else str(decision)).lower()
        if prior_drop is not None:                     # Phase 29.4: never instant after a drop
            status_val, source = "pending", None
        now = datetime.now(timezone.utc)

```

**Edit 5.** Find:
```python
            req.check_out_time = None
            req.check_out_verified = False
            req.dropped_at = None
            req.status_reason = None
            req.pay_rate = None
            req.notes = _clean_note(note)
            req.created_at = now
        else:
```
Replace with:
```python
            req.check_out_time = None
            req.check_out_verified = False
            # Phase 29.4: dropped_at is kept (the drop still counts unless they work the shift)
            req.status_reason = None
            req.pay_rate = None
            req.notes = _clean_note(note)
            req.previous_drop_at = prior_drop
            req.rebook_reason = clean_note if prior_drop is not None else None
            req.created_at = now
        else:
```

**Edit 6.** Find:
```python
                approved_at=now if status_val == "approved" else None,
                notes=_clean_note(note),
            )
            db.add(req)
```
Replace with:
```python
                approved_at=now if status_val == "approved" else None,
                notes=_clean_note(note),
                previous_drop_at=prior_drop,                                    # Phase 29.4
                rebook_reason=clean_note if prior_drop is not None else None,
            )
            db.add(req)
```

**Edit 7.** Find:
```python
    if status_val != "approved":
        await notify_events.request_pending(req_id)
    await activity.for_request("instant_booked" if status_val == "approved" else "request_created", req_id, worker.id)   # Phase 29.1
    return req_id

```
Replace with:
```python
    if status_val != "approved":
        await notify_events.request_pending(req_id)
    await activity.for_request("instant_booked" if status_val == "approved" else "request_created", req_id, worker.id,
                               f"asking back after dropping · “{clean_note}”" if prior_drop is not None else "")   # Phase 29.1 / 29.4
    return req_id

```

---

## B2. `backend/src/services/staffing.py` (EDITS)
Assign with a reason books back someone who dropped. Candidates carry the drop, and offers skip them.

**Edit 1.** Find:
```python
from src.services.booking import (
    _load_shift_locked, as_utc, PENDING_STATUSES, BOOKED_STATUSES, ACTIVE_STATUSES,
)
from src.services.team import get_venue_team, is_blocked, EXCLUDED_STATUSES
```
Replace with:
```python
from src.services.booking import (
    _load_shift_locked, as_utc, PENDING_STATUSES, BOOKED_STATUSES, ACTIVE_STATUSES,
    prior_drop_in_event, REBOOK_REASON_MIN,
)
from src.services.team import get_venue_team, is_blocked, EXCLUDED_STATUSES
```

**Edit 2.** Find:
```python

MAX_OFFER_PEOPLE = 5
REASSIGNABLE_STATUSES = ("withdrawn", "rejected", "cancelled", "removed")
HISTORY_MESSAGES = {
    "dropped": "dropped this shift earlier",
    "no_show": "was marked a no-show on this shift",
    "transferred": "handed this shift off earlier",
```
Replace with:
```python

MAX_OFFER_PEOPLE = 5
REASSIGNABLE_STATUSES = ("withdrawn", "rejected", "cancelled", "removed", "dropped")   # Phase 29.4: dropped = with a reason
HISTORY_MESSAGES = {
    "no_show": "was marked a no-show on this shift",
    "transferred": "handed this shift off earlier",
```

**Edit 3.** Find:
```python
    approved_by: Optional[UUID],
    who: str,
) -> ShiftRequest:
    """
```
Replace with:
```python
    approved_by: Optional[UUID],
    who: str,
    rebook_reason: Optional[str] = None,
) -> ShiftRequest:
    """
```

**Edit 4.** Find:
```python
                raise HTTPException(status_code=400, detail=f"Already on this position (status: {st}).")

    # Overlapping booking elsewhere
    overlap = await db.scalar(
```
Replace with:
```python
                raise HTTPException(status_code=400, detail=f"Already on this position (status: {st}).")

    # Phase 29.4: booking back someone who dropped this event needs the manager's reason
    # (approving their own "ask to come back" request is fine: they already gave one)
    prior_drop = await prior_drop_in_event(db, worker.id, shift)
    asked_back = target is not None and (target.status or "").lower() in PENDING_STATUSES and target.previous_drop_at is not None
    reason = (rebook_reason or "").strip()[:500]
    if prior_drop is not None and not asked_back:
        if you:
            raise HTTPException(status_code=400, detail="You dropped a shift at this event earlier. Ask the manager to book you back.")
        if len(reason) < REBOOK_REASON_MIN:
            when = as_utc(prior_drop).strftime("%b %-d")
            raise HTTPException(
                status_code=400,
                detail=f"{who} dropped this event on {when}. Add a short reason to book them back.",
            )

    # Overlapping booking elsewhere
    overlap = await db.scalar(
```

**Edit 5.** Find:
```python
    target.check_out_time = None
    target.check_out_verified = False
    target.dropped_at = None
    target.status_reason = None
    target.pay_rate = None
    await db.flush()

```
Replace with:
```python
    target.check_out_time = None
    target.check_out_verified = False
    # Phase 29.4: dropped_at is kept on purpose (history + reliability if this booking doesn't happen)
    target.status_reason = None
    target.pay_rate = None
    if prior_drop is not None:
        target.previous_drop_at = prior_drop
        if not asked_back:
            target.rebook_reason = reason
    await db.flush()

```

**Edit 6.** Find:
```python


async def assign_worker(db: AsyncSession, manager: User, shift_id: UUID, worker_id: UUID) -> Tuple[UUID, str]:
    """Manager books a specific person. Commits. Returns (request_id, message)."""
    try:
        shift = await _load_shift_locked(db, shift_id)
        worker = await db.scalar(select(User).where(User.id == worker_id))
        if worker is None:
            raise HTTPException(status_code=404, detail="Person not found.")
        name = full_name(worker)
        req = await _book_locked(db, shift, worker, source="manager_assign", approved_by=manager.id, who=name)
        req_id = req.id
        role = shift.role_type
```
Replace with:
```python


async def assign_worker(
    db: AsyncSession, manager: User, shift_id: UUID, worker_id: UUID, reason: Optional[str] = None,
) -> Tuple[UUID, str]:
    """Manager books a specific person. Commits. Returns (request_id, message).
    Phase 29.4: `reason` is required when the person dropped this event earlier."""
    try:
        shift = await _load_shift_locked(db, shift_id)
        worker = await db.scalar(select(User).where(User.id == worker_id))
        if worker is None:
            raise HTTPException(status_code=404, detail="Person not found.")
        name = full_name(worker)
        req = await _book_locked(db, shift, worker, source="manager_assign", approved_by=manager.id, who=name,
                                 rebook_reason=reason)
        req_id = req.id
        role = shift.role_type
```

**Edit 7.** Find:
```python
            if c.offered:
                skipped.append(OfferSkip(worker_id=wid, name=name, reason="Already has an offer for this position."))
                continue
            if not c.available and not c.requested_this:
```
Replace with:
```python
            if c.offered:
                skipped.append(OfferSkip(worker_id=wid, name=name, reason="Already has an offer for this position."))
                continue
            if c.dropped_at is not None and not c.requested_this:                     # Phase 29.4
                skipped.append(OfferSkip(worker_id=wid, name=name, reason="Dropped this event earlier. Use Assign with a reason."))
                continue
            if not c.available and not c.requested_this:
```

**Edit 8.** Find:
```python
        in_event[wid].append((sid, (st or "").lower(), role))

    history = {wid: (st or "").lower() for wid, st in (await db.execute(
        select(ShiftRequest.worker_id, ShiftRequest.status).where(
```
Replace with:
```python
        in_event[wid].append((sid, (st or "").lower(), role))

    # Phase 29.4: who dropped this event (Assign needs a reason; offers skip them)
    drop_q = (
        select(ShiftRequest.worker_id, ShiftRequest.dropped_at, ShiftRequest.status, ShiftRequest.status_reason)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.worker_id.in_(ids), ShiftRequest.dropped_at.isnot(None),
               func.lower(ShiftRequest.status).notin_(ACTIVE_STATUSES))
    )
    drop_q = drop_q.where(Shift.event_id == shift.event_id) if shift.event_id else drop_q.where(Shift.id == shift.id)
    dropped = {}
    for wid, dat, st, why in (await db.execute(drop_q)).all():
        if wid not in dropped or dat > dropped[wid][0]:
            dropped[wid] = (dat, why if (st or "").lower() == "dropped" else None)

    history = {wid: (st or "").lower() for wid, st in (await db.execute(
        select(ShiftRequest.worker_id, ShiftRequest.status).where(
```

**Edit 9.** Find:
```python
            offered=wid in offered,
            venue_shifts=int(worked.get(wid, 0)),
        ))
    out.sort(key=lambda c: (
```
Replace with:
```python
            offered=wid in offered,
            venue_shifts=int(worked.get(wid, 0)),
            dropped_at=dropped[wid][0] if wid in dropped else None,
            drop_reason=dropped[wid][1] if wid in dropped else None,
        ))
    out.sort(key=lambda c: (
```

---

## B3. `backend/src/routers/staffing.py` (EDITS)
`POST /api/shifts/{shift_id}/assign` body is now `{worker_id, reason?}`. `reason` is required (5+ characters) when the person dropped this event and didn't ask back themselves; otherwise the response is 400.

**Edit 1.** Find:
```python

from src.database import get_db
from src.models import User, Shift, ShiftOffer
from src.schemas import (
    AssignCandidate, AssignRequest, AssignResult, OfferCreate, OfferCreateResult, WorkerOffer, OfferAcceptResult,
```
Replace with:
```python

from src.database import get_db
from src.models import User, Shift, ShiftOffer, ShiftRequest
from src.schemas import (
    AssignCandidate, AssignRequest, AssignResult, OfferCreate, OfferCreateResult, WorkerOffer, OfferAcceptResult,
```

**Edit 2.** Find:
```python
):
    await _managed_shift(db, shift_id, current_user)
    request_id, message = await staffing.assign_worker(db, current_user, shift_id, body.worker_id)
    await notify_events.assigned(request_id)          # after commit; never raises
    await activity.for_request("assigned", request_id, current_user.id)   # Phase 29.1
    return AssignResult(request_id=request_id, message=message)

```
Replace with:
```python
):
    await _managed_shift(db, shift_id, current_user)
    request_id, message = await staffing.assign_worker(db, current_user, shift_id, body.worker_id, reason=body.reason)
    await notify_events.assigned(request_id)          # after commit; never raises
    # Phase 29.4: flag a rebook after a drop in the activity log
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    extra = f"booked back after a drop · “{req.rebook_reason}”" if req is not None and req.previous_drop_at and req.rebook_reason else ""
    await activity.for_request("assigned", request_id, current_user.id, extra)   # Phase 29.1
    return AssignResult(request_id=request_id, message=message)

```

---

## B4. `backend/src/routers/shifts.py` (EDITS)
`POST /api/shifts/{shift_id}/drop` accepts an optional `{reason}` body. Approve stores an aware UTC time.

**Edit 1.** Find:
```python
)
from src.schemas import (
    ShiftCreate, ShiftResponse, ShiftRequestResponse, ShiftRequestStatusUpdate,
    CheckInRequest, CheckOutRequest, TimeEntryResponse,
```
Replace with:
```python
)
from src.schemas import (
    DropShiftBody,                                            # Phase 29.4
    ShiftCreate, ShiftResponse, ShiftRequestResponse, ShiftRequestStatusUpdate,
    CheckInRequest, CheckOutRequest, TimeEntryResponse,
```

**Edit 2.** Find:
```python
        shift_req.approval_source = "manager_manual"
        shift_req.approved_by_user_id = current_user.id
        shift_req.approved_at = datetime.utcnow()
        # Phase 26.1: booked on this position -> close their other waiting requests in the event
        await withdraw_other_pending_in_event(
```
Replace with:
```python
        shift_req.approval_source = "manager_manual"
        shift_req.approved_by_user_id = current_user.id
        shift_req.approved_at = datetime.now(timezone.utc)      # Phase 29.4: was a naive utcnow()
        # Phase 26.1: booked on this position -> close their other waiting requests in the event
        await withdraw_other_pending_in_event(
```

**Edit 3.** Find:
```python
async def drop_shift(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
```
Replace with:
```python
async def drop_shift(
    shift_id: UUID,
    body: Optional[DropShiftBody] = None,                     # Phase 29.4: optional reason for the manager
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
```

**Edit 4.** Find:
```python
        shift_req.status = "dropped"
        shift_req.dropped_at = now_utc

        # Step 2: Decrement spots_filled
```
Replace with:
```python
        shift_req.status = "dropped"
        shift_req.dropped_at = now_utc
        shift_req.status_reason = ((body.reason or "").strip()[:500] or None) if body else None   # Phase 29.4

        # Step 2: Decrement spots_filled
```

**Edit 5.** Find:
```python
    # Phase 29.1: managers hear about drops right away (after commit; never raises)
    await notify_events.shift_dropped(shift_req.id)
    await activity.for_request("shift_dropped", shift_req.id, current_user.id)

    return {
```
Replace with:
```python
    # Phase 29.1: managers hear about drops right away (after commit; never raises)
    await notify_events.shift_dropped(shift_req.id)
    await activity.for_request("shift_dropped", shift_req.id, current_user.id,
                               f"“{shift_req.status_reason}”" if shift_req.status_reason else "")   # Phase 29.4: with their reason

    return {
```

---

## B5. `backend/src/services/listings.py` (EDITS)

**Edit 1.** Find:
```python
        positions: List[ListingPosition] = []
        my_request: Optional[ListingMyRequest] = None
        for s in ev_shifts:
            r = mine.get(s.id)
```
Replace with:
```python
        positions: List[ListingPosition] = []
        my_request: Optional[ListingMyRequest] = None
        # Phase 29.4: did the viewer drop a position here? Then asking back needs a reason + approval.
        drops = [as_utc(mine[s.id].dropped_at) for s in ev_shifts if s.id in mine and mine[s.id].dropped_at is not None]
        dropped_here = max(drops) if drops else None
        for s in ev_shifts:
            r = mine.get(s.id)
```

**Edit 2.** Find:
```python
                spots_left=left,
                status="OPEN" if is_open else "FILLED",
                booking="instant" if decision == RequestStatus.APPROVED else "approval",
                est_pay_min=round(rate * hours, 2) if rate is not None else None,
                est_pay_max=round((rate_max or rate) * hours, 2) if rate is not None else None,
                my_status=my_status,
                my_status_reason=r.status_reason if r is not None else None,
                staff_notes=s.staff_notes if booked_here else None,
            ))
```
Replace with:
```python
                spots_left=left,
                status="OPEN" if is_open else "FILLED",
                booking="instant" if decision == RequestStatus.APPROVED and dropped_here is None else "approval",
                est_pay_min=round(rate * hours, 2) if rate is not None else None,
                est_pay_max=round((rate_max or rate) * hours, 2) if rate is not None else None,
                my_status=my_status,
                my_status_reason=r.status_reason if r is not None else None,
                my_dropped_at=r.dropped_at if r is not None and my_status == "dropped" else None,   # Phase 29.4
                staff_notes=s.staff_notes if booked_here else None,
            ))
```

**Edit 3.** Find:
```python
            started=started,
            can_request=can_request,
            staff_notes=ev.staff_notes if (
                my_request is not None and my_request.status in ASSIGNED_STATUSES
```
Replace with:
```python
            started=started,
            can_request=can_request,
            dropped_here=dropped_here if (my_request is None or my_request.status in PENDING_STATUSES) else None,   # Phase 29.4
            staff_notes=ev.staff_notes if (
                my_request is not None and my_request.status in ASSIGNED_STATUSES
```

---

## B6. `backend/src/routers/venues.py` (EDITS)
The manager board returns a `dropped` list per position and rebook flags on each person.

**Edit 1.** Find:
```python
            rating_review=ratings_by_req[req.id].review if req.id in ratings_by_req else None,
            approval_source=req.approval_source,
        )
        if person.status in ASSIGNED_STATUSES:
            assigned_by_shift[req.shift_id].append(person)
        else:
            requested_by_shift[req.shift_id].append(person)

    event_ids = {s.event_id for s in shifts if s.event_id}
```
Replace with:
```python
            rating_review=ratings_by_req[req.id].review if req.id in ratings_by_req else None,
            approval_source=req.approval_source,
            previous_drop_at=req.previous_drop_at,       # Phase 29.4
            rebook_reason=req.rebook_reason,
        )
        if person.status in ASSIGNED_STATUSES:
            assigned_by_shift[req.shift_id].append(person)
        else:
            requested_by_shift[req.shift_id].append(person)

    # Phase 29.4: people who dropped a position (the manager can book them back with a reason)
    dropped_by_shift = defaultdict(list)
    for req, worker in (await db.execute(
        select(ShiftRequest, User)
        .join(User, ShiftRequest.worker_id == User.id)
        .where(ShiftRequest.shift_id.in_(shift_ids), func.lower(ShiftRequest.status) == "dropped")
        .order_by(ShiftRequest.dropped_at.desc())
    )).all():
        dropped_by_shift[req.shift_id].append(RosterPerson(
            request_id=req.id, worker_id=worker.id, first_name=worker.first_name or "", last_name=worker.last_name or "",
            email=worker.email, phone=worker.phone,
            aggregate_rating=float(worker.aggregate_rating) if worker.aggregate_rating is not None else 5.0,
            rating_count=int(worker.rating_count or 0), status="dropped", requested_at=req.created_at,
            dropped_at=req.dropped_at, drop_reason=req.status_reason,
        ))

    event_ids = {s.event_id for s in shifts if s.event_id}
```

**Edit 2.** Find:
```python
            requested=requested_by_shift[s.id],
            offers=offers_by_shift[s.id],
        ))

```
Replace with:
```python
            requested=requested_by_shift[s.id],
            offers=offers_by_shift[s.id],
            dropped=dropped_by_shift[s.id],            # Phase 29.4
        ))

```

---

## B7. `backend/src/services/reliability.py` (EDITS)

**Edit 1.** Find:
```python
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

```
Replace with:
```python
from uuid import UUID

from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

```

**Edit 2.** Find:
```python
        .where(
            ShiftRequest.worker_id.in_(worker_ids),
            func.lower(ShiftRequest.status).in_(COMMITTED_STATUSES + ("dropped", "no_show")),
        )
    )).all()
```
Replace with:
```python
        .where(
            ShiftRequest.worker_id.in_(worker_ids),
            or_(
                func.lower(ShiftRequest.status).in_(COMMITTED_STATUSES + ("dropped", "no_show")),
                # Phase 29.4: dropped, then asked back / was booked back but it didn't happen -> still a drop
                and_(ShiftRequest.dropped_at.isnot(None), func.lower(ShiftRequest.status) != "transferred"),
            ),
        )
    )).all()
```

**Edit 3.** Find:
```python
            continue

        if status_l == "dropped":
            d = _aware(dropped_at)
            if d is not None and (start - d) < LATE_DROP_WINDOW:
```
Replace with:
```python
            continue

        if status_l == "dropped" or (dropped_at is not None and status_l not in COMMITTED_STATUSES + ("no_show",)):
            d = _aware(dropped_at)
            if d is not None and (start - d) < LATE_DROP_WINDOW:
```

---

## B8. `backend/src/services/notify_events.py` (EDITS)

**Edit 1.** Find:
```python
    title = f"{person(worker)} requested {shift.role_type}"
    body = f"{event.title if event else shift.title} · {when_text(shift.start_time, venue)}"
    if req.notes:
        body += f"\n“{req.notes}”"
```
Replace with:
```python
    title = f"{person(worker)} requested {shift.role_type}"
    body = f"{event.title if event else shift.title} · {when_text(shift.start_time, venue)}"
    if req.previous_drop_at is not None:                      # Phase 29.4: asking back after a drop
        title = f"{person(worker)} dropped this earlier and is asking back · {shift.role_type}"
        body += "\nThey dropped this event earlier. It needs your approval."
    if req.notes:
        body += f"\n“{req.notes}”"
```

**Edit 2.** Find:
```python
        db, await manager_ids(db, shift.venue_id), "shift_dropped",
        f"{person(worker)} dropped {shift.role_type} · {event.title if event else shift.title}",
        f"{when_text(shift.start_time, venue)}. The spot is open again. Assign or offer it to someone from the event.",
        manager_link(shift.venue_id, shift.event_id), venue_id=shift.venue_id, event_id=shift.event_id,
        request_id=req.id, urgent=is_soon(shift.start_time), dedupe_key=f"dropped:{req.id}",
    )

```
Replace with:
```python
        db, await manager_ids(db, shift.venue_id), "shift_dropped",
        f"{person(worker)} dropped {shift.role_type} · {event.title if event else shift.title}",
        f"{when_text(shift.start_time, venue)}. The spot is open again. Assign or offer it to someone from the event."
        + (f"\nTheir reason: “{req.status_reason}”" if req.status_reason else ""),          # Phase 29.4
        manager_link(shift.venue_id, shift.event_id), venue_id=shift.venue_id, event_id=shift.event_id,
        request_id=req.id, urgent=is_soon(shift.start_time),
        dedupe_key=f"dropped:{req.id}:{int(_as_utc(req.dropped_at).timestamp()) if req.dropped_at else 0}",
    )

```

---

## B9. `backend/src/routers/transfers.py` (EDIT)
Declining or withdrawing a hand-off only works while it's still waiting.

**Edit 1.** Find:
```python
        is_manager = bool(mgr)

    if current_user.id == transfer.to_worker_id:
        transfer.status = "declined"
```
Replace with:
```python
        is_manager = bool(mgr)

    # Phase 29.4: only a hand-off that's still waiting can be declined / withdrawn / denied
    if (transfer.status or "").lower() not in ("pending_worker_acceptance", "pending_manager_approval"):
        raise HTTPException(status_code=400, detail="This hand-off is already settled.")

    if current_user.id == transfer.to_worker_id:
        transfer.status = "declined"
```

---

# PART C: Frontend, worker

New folder: `frontend/src/components/worker/`.

## C1. `frontend/src/pages/WorkerDashboard.jsx` (FULL FILE REPLACEMENT)
Same data calls as before plus `GET /transfers/my-outgoing`. Note `w-full` on the page root, the header container and `<main>`.

```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Calendar, AlertCircle, Briefcase, Check, Search, Filter, ArrowRightLeft, Zap, Info, CalendarDays, AlertTriangle,
  ListChecks, Send, ChevronRight, RotateCcw, X,
} from 'lucide-react';
import TransferModal from '../components/TransferModal';
import ShiftBoardModal from '../components/ShiftBoardModal';
import EventListingCard from '../components/EventListingCard';
import EventListingModal from '../components/EventListingModal';
import WorkerCalendar from '../components/WorkerCalendar';
import ShiftDetailsModal from '../components/ShiftDetailsModal';
import WorkerOffers from '../components/WorkerOffers';
import RatingBadge from '../components/RatingBadge';
import { Avatar } from '../components/WorkerProfilePanel';
import MyShiftCard from '../components/worker/MyShiftCard';
import DropShiftDialog from '../components/worker/DropShiftDialog';
import HandoffsPanel from '../components/worker/HandoffsPanel';
import { PENDING_INVITE_KEY } from './JoinPage';
import {
  dayGroupLabel, isOnDay, downloadIcs, mapsUrl, whereOf,
} from '../utils/listingFormat';
import { getCurrentPosition } from '../utils/geo';

const UPCOMING_STATUSES = ['pending', 'pending_manager_approval', 'approved', 'confirmed', 'checked_in'];
const TAB_IDS = ['schedule', 'find', 'calendar', 'transfers'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

/**
 * Worker home. Phase 29.4 layout:
 *   Tabs: My shifts (default when you have something coming up) · Find shifts · Calendar · Hand-offs.
 *   Each shift card has ONE main button (clock in/out, read the update, withdraw, ask to come back)
 *   and a ⋯ menu for the rest (details, directions, calendar, chat, hand off, drop).
 *   Tab ids stay 'schedule' | 'find' | 'calendar' | 'transfers' so notification links keep working.
 */
export default function WorkerDashboard() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(TAB_IDS.includes(urlTab) ? urlTab : null);
  const [listings, setListings] = useState([]);
  const [calendar, setCalendar] = useState({ items: [], unread_count: 0 });
  const [detailRequestId, setDetailRequestId] = useState(null);
  const [myShifts, setMyShifts] = useState([]);
  const [incomingTransfers, setIncomingTransfers] = useState([]);
  const [outgoingTransfers, setOutgoingTransfers] = useState([]);   // Phase 29.4
  const [activeClockIns, setActiveClockIns] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [clockActionLoading, setClockActionLoading] = useState(null);
  const [handoffBusy, setHandoffBusy] = useState(null);
  const [withdrawingId, setWithdrawingId] = useState(null);
  const [notification, setNotification] = useState(null);

  // Find Shifts filters
  const [search, setSearch] = useState('');
  const [whenFilter, setWhenFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [venueFilter, setVenueFilter] = useState('ALL');
  const [instantOnly, setInstantOnly] = useState(false);
  const [hideRequested, setHideRequested] = useState(false);

  const [openListing, setOpenListing] = useState(null); // { eventId, initial }
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferShiftId, setTransferShiftId] = useState(null);
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [shiftToDrop, setShiftToDrop] = useState(null);
  const [offers, setOffers] = useState([]);
  const [offerBusy, setOfferBusy] = useState(null);
  const navigate = useNavigate();

  const flash = (type, message) => setNotification({ type, message });

  const fetchWorkerData = async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const [listingsRes, myRes, transfersRes, outRes, activeClocksRes, calendarRes, offersRes] = await Promise.all([
        api.get('/listings'),
        api.get('/users/me/shifts'),
        api.get('/transfers/my-incoming'),
        api.get('/transfers/my-outgoing').catch(() => ({ data: [] })),
        api.get('/shifts/time-entries/active').catch(() => ({ data: [] })),
        api.get('/me/calendar').catch(() => ({ data: { items: [], unread_count: 0 } })),
        api.get('/me/offers').catch(() => ({ data: [] })),
      ]);
      setListings(listingsRes.data || []);
      setOffers(offersRes.data || []);
      setCalendar({ items: calendarRes.data?.items || [], unread_count: calendarRes.data?.unread_count || 0 });
      setMyShifts(myRes.data || []);
      setIncomingTransfers(transfersRes.data || []);
      setOutgoingTransfers(outRes.data || []);
      setActiveClockIns(new Set((activeClocksRes.data || []).map((te) => te.shift_id)));
      // First load: open My shifts when there's something coming up, otherwise Find shifts
      setActiveTab((prev) => {
        if (prev) return prev;
        const upcoming = (myRes.data || []).some((r) => {
          const st = String(r.status || '').toLowerCase();
          return UPCOMING_STATUSES.includes(st) && new Date(r.shift?.end_time).getTime() >= Date.now();
        });
        return upcoming || (offersRes.data || []).length ? 'schedule' : 'find';
      });
    } catch (err) {
      flash('error', "Couldn't load your shifts. Check your connection and refresh.");
      setActiveTab((prev) => prev || 'find');
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    let pendingInvite = null;
    try {
      pendingInvite = localStorage.getItem(PENDING_INVITE_KEY);
    } catch (e) {
      pendingInvite = null;
    }
    if (pendingInvite) {
      navigate(`/join/${pendingInvite}`, { replace: true });
      return;
    }
    fetchWorkerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Actions ---------------------------------------------------------------------------
  const handleOffer = async (offer, action) => {
    setOfferBusy(offer.offer_id);
    try {
      const res = await api.post(`/offers/${offer.offer_id}/${action}`);
      flash(action === 'accept' ? 'success' : 'info', action === 'accept' ? res.data.message : 'Offer declined.');
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not update the offer.');
    } finally {
      setOfferBusy(null);
      fetchWorkerData(false);
    }
  };

  const handleWithdraw = async (req) => {
    try {
      setWithdrawingId(req.id);
      await api.post(`/listings/requests/${req.id}/withdraw`);
      flash('info', 'Request withdrawn.');
      fetchWorkerData(false);
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not withdraw the request.');
    } finally {
      setWithdrawingId(null);
    }
  };

  const handleClockIn = async (shiftId, item) => {
    try {
      setClockActionLoading(shiftId);
      let body = {};
      if (item?.geofence_on) {
        flash('info', 'Checking your location…');
        body = await getCurrentPosition();
      }
      const res = await api.post(`/shifts/${shiftId}/clock-in`, body);
      setActiveClockIns((prev) => new Set([...prev, shiftId]));
      flash(res.data?.geo_status === 'outside_geofence' ? 'info' : 'success', res.data?.message || 'Clocked in.');
      fetchWorkerData(false);
    } catch (err) {
      flash('error', err.response?.data?.detail || err.message || 'Could not clock in.');
    } finally {
      setClockActionLoading(null);
    }
  };

  const handleClockOut = async (shiftId, item) => {
    try {
      setClockActionLoading(shiftId);
      const body = item?.geofence_on ? await getCurrentPosition({ timeoutMs: 8000 }).catch(() => ({})) : {};
      const res = await api.post(`/shifts/${shiftId}/clock-out`, body);
      setActiveClockIns((prev) => {
        const next = new Set(prev);
        next.delete(shiftId);
        return next;
      });
      flash(res.data?.status === 'undone' ? 'info' : 'success', res.data?.message || 'Clocked out.');
      fetchWorkerData(false);
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not clock out.');
    } finally {
      setClockActionLoading(null);
    }
  };

  const handoffAction = async (t, action) => {
    setHandoffBusy(t.id);
    try {
      await api.post(`/transfers/${t.id}/${action === 'accept' ? 'accept' : 'reject'}`);
      flash(
        action === 'accept' ? 'success' : 'info',
        action === 'accept'
          ? 'Accepted. Your manager still has to approve it before the shift is yours.'
          : action === 'withdraw'
            ? 'Hand-off withdrawn. You still have the shift.'
            : 'Declined. They keep the shift.',
      );
      fetchWorkerData(false);
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not update the hand-off.');
    } finally {
      setHandoffBusy(null);
    }
  };

  // ---- Derived data ----------------------------------------------------------------------
  const confirmedShifts = myShifts.filter((s) => ['approved', 'checked_in', 'confirmed'].includes(String(s.status || '').toLowerCase()));

  const calendarByRequest = useMemo(() => {
    const m = new Map();
    calendar.items.forEach((i) => m.set(i.request_id, i));
    return m;
  }, [calendar.items]);
  const detailItem = detailRequestId ? calendarByRequest.get(detailRequestId) || null : null;
  const firstUnread = calendar.items.find((i) => i.needs_ack && new Date(i.end_time).getTime() > Date.now()) || null;

  const handleAcknowledged = (requestId, seenAt) => {
    setCalendar((prev) => {
      const items = prev.items.map((i) =>
        i.request_id === requestId ? { ...i, needs_ack: false, info_change: null, info_seen_at: seenAt || new Date().toISOString() } : i
      );
      const unread = items.filter((i) => i.needs_ack && new Date(i.end_time).getTime() > Date.now()).length;
      return { items, unread_count: unread };
    });
  };

  const openDetailsForRequest = (req) => {
    if (calendarByRequest.has(req.id)) setDetailRequestId(req.id);
    else if (req.shift?.event_id) setOpenListing({ eventId: req.shift.event_id, initial: null });
  };

  // Deep links from notifications (?tab=, ?request=, ?event=)
  const [pendingDeepLink, setPendingDeepLink] = useState(null);
  useEffect(() => {
    const tab = searchParams.get('tab');
    const request = searchParams.get('request');
    const event = searchParams.get('event');
    if (!tab && !request && !event) return;
    if (tab && TAB_IDS.includes(tab)) setActiveTab(tab);
    if (event) setOpenListing({ eventId: event, initial: null });
    if (request) {
      setPendingDeepLink(request);
      fetchWorkerData(false);
    }
    const next = new URLSearchParams(searchParams);
    ['tab', 'request', 'event'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (pendingDeepLink && calendarByRequest.has(pendingDeepLink)) {
      setDetailRequestId(pendingDeepLink);
      setPendingDeepLink(null);
    }
  }, [pendingDeepLink, calendarByRequest]);

  // Find Shifts
  const openListingCount = listings.filter((l) => l.total_spots_left > 0 && !l.my_request).length;
  const roleOptions = useMemo(
    () => Array.from(new Set(listings.flatMap((l) => l.positions.filter((p) => p.status === 'OPEN').map((p) => p.role_type)))).sort(),
    [listings]
  );
  const venueOptions = useMemo(() => {
    const m = new Map();
    listings.forEach((l) => l.venue && m.set(l.venue.id, l.venue.name));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [listings]);
  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const weekEnd = Date.now() + 7 * 86400000;
    return listings.filter((l) => {
      const tz = l.venue?.timezone;
      if (q) {
        const hay = [l.title, l.venue?.name, l.venue?.address, l.location?.name, l.location?.address, ...l.positions.map((p) => p.role_type)]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (whenFilter === 'today' && !isOnDay(l.start_time, tz, 0)) return false;
      if (whenFilter === 'tomorrow' && !isOnDay(l.start_time, tz, 1)) return false;
      if (whenFilter === 'week' && new Date(l.start_time).getTime() > weekEnd) return false;
      if (roleFilter !== 'ALL' && !l.positions.some((p) => p.role_type === roleFilter && (p.status === 'OPEN' || p.my_status))) return false;
      if (venueFilter !== 'ALL' && l.venue?.id !== venueFilter) return false;
      if (instantOnly && !l.any_instant) return false;
      if (hideRequested && l.my_request) return false;
      return true;
    });
  }, [listings, search, whenFilter, roleFilter, venueFilter, instantOnly, hideRequested]);
  const listingGroups = useMemo(() => {
    const groups = [];
    filteredListings.forEach((l) => {
      const label = dayGroupLabel(l.start_time, l.venue?.timezone);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(l);
      else groups.push({ label, items: [l] });
    });
    return groups;
  }, [filteredListings]);
  const filtersActive = search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || hideRequested;
  const clearFilters = () => {
    setSearch('');
    setWhenFilter('all');
    setRoleFilter('ALL');
    setVenueFilter('ALL');
    setInstantOnly(false);
    setHideRequested(false);
  };

  // My shifts: coming up / dropped (can still ask back) / history
  const nowMs = Date.now();
  const isUpcomingReq = (req) => {
    const st = String(req.status || '').toLowerCase();
    if (!UPCOMING_STATUSES.includes(st)) return false;
    if (st === 'checked_in') return true;
    const end = new Date(req.shift?.end_time).getTime();
    return Number.isNaN(end) ? true : end >= nowMs;
  };
  const canAskBack = (req) =>
    String(req.status || '').toLowerCase() === 'dropped'
    && new Date(req.shift?.start_time).getTime() > nowMs
    && String(req.shift?.status || '').toUpperCase() !== 'CANCELLED';
  const upcomingRequests = myShifts.filter(isUpcomingReq).sort((a, b) => new Date(a.shift?.start_time) - new Date(b.shift?.start_time));
  const droppedRequests = myShifts.filter(canAskBack).sort((a, b) => new Date(a.shift?.start_time) - new Date(b.shift?.start_time));
  const historyRequests = myShifts
    .filter((r) => !isUpcomingReq(r) && !canAskBack(r))
    .sort((a, b) => new Date(b.shift?.start_time) - new Date(a.shift?.start_time));
  const needsAnswer = offers.length + incomingTransfers.length;

  const addShiftToCalendar = (req) => {
    const shift = req.shift;
    if (!shift) return;
    downloadIcs({
      uid: `${req.id}@shiftboard`,
      title: `${shift.title} — ${shift.role_type || 'Shift'} (${shift.venue?.name || ''})`,
      start: shift.start_time,
      end: shift.end_time,
      location: calendarByRequest.get(req.id) ? whereOf(calendarByRequest.get(req.id)).address : shift.venue?.address,
      description: [shift.event_notes, shift.description, shift.venue?.arrival_instructions].filter(Boolean).join('\n\n'),
    });
  };

  const renderCard = (req) => {
    const shiftId = req.shift_id || req.shift?.id;
    const calItem = calendarByRequest.get(req.id);
    const place = calItem ? whereOf(calItem) : req.shift?.venue;
    return (
      <MyShiftCard
        key={req.id}
        req={req}
        calItem={calItem}
        clockedIn={activeClockIns.has(shiftId)}
        busy={clockActionLoading === shiftId ? 'clock' : withdrawingId === req.id ? 'withdraw' : null}
        onDetails={(calItem || req.shift?.event_id) ? () => openDetailsForRequest(req) : null}
        onClockIn={() => handleClockIn(shiftId, calItem)}
        onClockOut={() => handleClockOut(shiftId, calItem)}
        onBoard={() => setActiveDiscussionShift(req.shift)}
        onHandOff={() => {
          setTransferShiftId(shiftId);
          setTransferModalOpen(true);
        }}
        onDrop={() => setShiftToDrop(req)}
        onWithdraw={() => handleWithdraw(req)}
        onAddCalendar={() => addShiftToCalendar(req)}
        onDirections={place ? () => window.open(mapsUrl(place), '_blank', 'noopener') : null}
        onAskBack={req.shift?.event_id ? () => setOpenListing({ eventId: req.shift.event_id, initial: null }) : null}
      />
    );
  };

  const tabs = [
    { id: 'schedule', label: 'My shifts', icon: ListChecks, count: upcomingRequests.length },
    { id: 'find', label: 'Find shifts', icon: Search, count: openListingCount },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, badge: calendar.unread_count },
    { id: 'transfers', label: 'Hand-offs', icon: ArrowRightLeft, badge: incomingTransfers.length },
  ];
  const isWorker = String(user?.role || '').toLowerCase() === 'worker';
  const chipBtn = 'px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-600 text-xs text-slate-300 inline-flex items-center gap-1.5';

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Header */}
      <section className="bg-slate-900 border-b border-slate-800 py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto w-full flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar person={user} size="w-12 h-12 text-base" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{`${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Your shifts'}</h1>
                {!isWorker && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">Worker preview</span>
                )}
              </div>
              {user?.bio && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{user.bio}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={chipBtn.replace('hover:border-slate-600', '')}>
              <RatingBadge rating={user?.aggregate_rating ?? user?.rating_average} count={user?.rating_count} />
            </span>
            <button type="button" onClick={() => setActiveTab('schedule')} className={chipBtn}>
              <b className="text-white">{upcomingRequests.length}</b> coming up
            </button>
            {needsAnswer > 0 && (
              <button type="button" onClick={() => setActiveTab(offers.length ? 'schedule' : 'transfers')}
                className={`${chipBtn} border-amber-500/50 text-amber-200`}>
                <b className="text-amber-100">{needsAnswer}</b> waiting for your answer
              </button>
            )}
            <button type="button" onClick={() => setActiveTab('find')} className={chipBtn}>
              <b className="text-white">{openListingCount}</b> open to pick up
            </button>
          </div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6">
        {notification && (
          <div className={`mb-5 p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
            notification.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
              : notification.type === 'error'
                ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                : 'bg-indigo-950/80 border-indigo-700 text-indigo-200'
          }`}>
            <div className="flex items-start gap-2">
              {notification.type === 'success' ? <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
              <span className="text-sm font-medium">{notification.message}</span>
            </div>
            <button type="button" onClick={() => setNotification(null)} aria-label="Dismiss" className="p-1 rounded-lg hover:bg-white/10">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {!isWorker && (
          <div className="mb-5 p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-300 flex-shrink-0 mt-0.5" />
            <span>
              <b>Worker preview.</b> You're seeing this page exactly as a worker would: hidden pay and staff-only notes stay
              hidden unless you're booked on that position. Your manager screens still show full pay.
            </span>
          </div>
        )}

        {calendar.unread_count > 0 && firstUnread && (
          <div className="mb-5 p-4 rounded-xl border-2 border-amber-500 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-black text-amber-100">
                  {calendar.unread_count === 1 ? "1 of your shifts has info you haven't read" : `${calendar.unread_count} of your shifts have info you haven't read`}
                </div>
                <div className="text-xs text-amber-200/80">Notes or times can change after you book. Open the shift and tap “Got it”.</div>
              </div>
            </div>
            <button type="button" onClick={() => setDetailRequestId(firstUnread.request_id)}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black whitespace-nowrap">
              Review now
            </button>
          </div>
        )}

        {/* Tabs: 2×2 on phones so none are hidden */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 border-b border-slate-800 pb-4">
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = activeTab === t.id;
            return (
              <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition inline-flex items-center justify-center gap-1.5 ${
                  on ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20' : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'}`}>
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
                {t.count !== undefined && <span className={on ? 'text-slate-900' : 'text-slate-500'}>{t.count}</span>}
                {t.badge > 0 && (
                  <span className="min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black inline-flex items-center justify-center">{t.badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Offers get answered on My shifts; elsewhere a slim reminder */}
        {offers.length > 0 && activeTab !== 'schedule' && (
          <button type="button" onClick={() => setActiveTab('schedule')}
            className="mt-4 w-full p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/5 text-left text-sm text-indigo-100 flex items-center gap-2 hover:bg-indigo-500/10">
            <Send className="w-4 h-4 text-indigo-300" />
            <span className="flex-1">{plural(offers.length, 'shift')} offered to you. Answer on My shifts.</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {activeTab === null && <div className="py-20 text-center text-slate-500 text-xs">Loading your shifts…</div>}

        {/* My shifts */}
        {activeTab === 'schedule' && (
          <div className="mt-2 space-y-6">
            <WorkerOffers offers={offers} busyId={offerBusy} onAccept={(o) => handleOffer(o, 'accept')} onDecline={(o) => handleOffer(o, 'decline')} />
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-4">Coming up</h2>
              {loading ? (
                <div className="py-12 text-center text-slate-500 text-xs">Loading…</div>
              ) : upcomingRequests.length === 0 ? (
                <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-slate-800">
                  <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <h3 className="text-sm font-semibold text-slate-300">Nothing coming up</h3>
                  <button type="button" onClick={() => setActiveTab('find')} className="mt-2 text-xs text-emerald-400 hover:text-emerald-300 font-semibold">
                    Find a shift →
                  </button>
                </div>
              ) : (
                upcomingRequests.map(renderCard)
              )}
            </section>

            {droppedRequests.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" /> Dropped · you can still ask to come back
                </h2>
                <p className="text-[11px] text-slate-500 -mt-1">Your manager has to approve it, and they'll see why you can make it now.</p>
                {droppedRequests.map(renderCard)}
              </section>
            )}

            {historyRequests.length > 0 && (
              <details className="group pt-1">
                <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white">
                  Past & closed ({historyRequests.length})
                </summary>
                <div className="mt-4 space-y-3 opacity-80">{historyRequests.map(renderCard)}</div>
              </details>
            )}
          </div>
        )}

        {/* Find shifts */}
        {activeTab === 'find' && (
          <div className="mt-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events, venues, positions"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-emerald-500" />
                </div>
                <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 overflow-x-auto">
                  {[{ id: 'all', label: 'All dates' }, { id: 'today', label: 'Today' }, { id: 'tomorrow', label: 'Tomorrow' }, { id: 'week', label: 'Next 7 days' }].map((w) => (
                    <button key={w.id} type="button" onClick={() => setWhenFilter(w.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${whenFilter === w.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500">
                  <option value="ALL">All positions</option>
                  {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={venueFilter} onChange={(e) => setVenueFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500">
                  <option value="ALL">All venues</option>
                  {venueOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <button type="button" onClick={() => setInstantOnly((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition ${
                    instantOnly ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'}`}>
                  <Zap className="w-3.5 h-3.5" /> Instant book
                </button>
                <button type="button" onClick={() => setHideRequested((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    hideRequested ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'}`}>
                  Hide ones I've requested
                </button>
                {filtersActive && (
                  <button type="button" onClick={clearFilters} className="text-xs text-slate-400 underline hover:text-white ml-auto">Clear filters</button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center text-slate-500 text-xs">Loading open shifts…</div>
            ) : filteredListings.length === 0 ? (
              <div className="mt-6 text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Briefcase className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">{listings.length === 0 ? 'No shifts open right now' : 'Nothing matches these filters'}</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {listings.length === 0 ? "Check back soon. You'll get a notification when a venue you work with posts a shift." : 'Try clearing a filter or two.'}
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-8">
                {listingGroups.map((g) => (
                  <section key={g.label}>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                      {g.label}
                      <span className="text-slate-600 font-semibold normal-case tracking-normal">· {plural(g.items.length, 'event')}</span>
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                      {g.items.map((l) => (
                        <EventListingCard key={l.event_id} listing={l} onOpen={(item) => setOpenListing({ eventId: item.event_id, initial: item })} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Calendar */}
        {activeTab === 'calendar' && (
          <div className="mt-6">
            {loading ? (
              <div className="py-20 text-center text-slate-500 text-xs">Loading your calendar…</div>
            ) : (
              <WorkerCalendar
                items={calendar.items}
                openListings={listings}
                onSelectItem={(item) => setDetailRequestId(item.request_id)}
                onSelectListing={(l) => setOpenListing({ eventId: l.event_id, initial: l })}
              />
            )}
          </div>
        )}

        {/* Hand-offs */}
        {activeTab === 'transfers' && (
          <div className="mt-6">
            <HandoffsPanel
              incoming={incomingTransfers}
              outgoing={outgoingTransfers}
              busyId={handoffBusy}
              onAccept={(t) => handoffAction(t, 'accept')}
              onDecline={(t) => handoffAction(t, 'decline')}
              onWithdraw={(t) => handoffAction(t, 'withdraw')}
            />
          </div>
        )}
      </main>

      {detailItem && (
        <ShiftDetailsModal
          key={detailItem.request_id}
          item={detailItem}
          onClose={() => setDetailRequestId(null)}
          onAcknowledged={handleAcknowledged}
          onOpenBoard={(shiftLike) => setActiveDiscussionShift(shiftLike)}
        />
      )}

      {openListing && (
        <EventListingModal
          eventId={openListing.eventId}
          initial={openListing.initial}
          onClose={() => setOpenListing(null)}
          onChanged={() => fetchWorkerData(false)}
          onGoToSchedule={() => {
            setOpenListing(null);
            setActiveTab('schedule');
          }}
        />
      )}

      {transferModalOpen && (
        <TransferModal
          isOpen={transferModalOpen}
          onClose={() => setTransferModalOpen(false)}
          myConfirmedShifts={confirmedShifts}
          preselectedShiftId={transferShiftId}
          onTransferSuccess={() => {
            flash('success', "Hand-off sent. Once they accept and your manager approves, it's theirs. Until then it's still yours.");
            fetchWorkerData(false);
          }}
        />
      )}

      {activeDiscussionShift && (
        <ShiftBoardModal
          shiftId={activeDiscussionShift.id}
          shiftTitle={`${activeDiscussionShift.title} (${activeDiscussionShift.venue?.name || ''})`}
          currentUserRole={user?.role}
          onClose={() => setActiveDiscussionShift(null)}
        />
      )}

      {shiftToDrop && (
        <DropShiftDialog
          req={shiftToDrop}
          onClose={() => setShiftToDrop(null)}
          onDropped={(message) => {
            flash('success', message);
            fetchWorkerData(false);
          }}
        />
      )}
    </div>
  );
}
```

---

## C2. NEW FILE `frontend/src/components/worker/MyShiftCard.jsx`

```jsx
import React, { useEffect, useRef, useState } from 'react';
import {
  Timer, Info, Navigation, CalendarPlus, MessageSquare, ArrowRightLeft, LogOut, MoreHorizontal, AlertTriangle,
  Clock, Undo2, Check, RotateCcw,
} from 'lucide-react';
import PayLabel from '../PayLabel';
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

function dateParts(value, tz) {
  const d = new Date(value);
  const make = (opts) => {
    try {
      return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || undefined }).format(d);
    } catch (e) {
      return new Intl.DateTimeFormat('en-US', opts).format(d);
    }
  };
  return { month: make({ month: 'short' }).toUpperCase(), day: make({ day: 'numeric' }), weekday: make({ weekday: 'short' }) };
}

function Menu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="More actions" aria-expanded={open}
        className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-60 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1">
          {shown.map((it) => (
            <button key={it.label} type="button" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}
              className={`w-full text-left px-3 py-2 text-xs inline-flex items-start gap-2 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent ${it.danger ? 'text-rose-300' : 'text-slate-200'}`}>
              <it.icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                {it.label}
                {it.hint && <span className="block text-[10px] text-slate-500">{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const btn = 'px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50';

/**
 * Phase 29.4: One of my shifts (My shifts tab). The one thing to do now is the big button;
 * everything else lives in the ⋯ menu.
 * Props: req, calItem (calendar item for booked shifts), clockedIn, busy ('clock' | 'withdraw' | null),
 *        onDetails, onClockIn, onClockOut, onBoard, onHandOff, onDrop, onWithdraw, onAddCalendar, onDirections, onAskBack
 */
export default function MyShiftCard({
  req, calItem, clockedIn = false, busy = null, onDetails, onClockIn, onClockOut, onBoard, onHandOff, onDrop, onWithdraw,
  onAddCalendar, onDirections, onAskBack,
}) {
  const shift = req.shift || {};
  const tz = shift.venue?.timezone;
  const st = String(req.status || '').toLowerCase();
  const isBooked = ['approved', 'confirmed'].includes(st);
  const isCheckedIn = st === 'checked_in' || clockedIn;
  const isPending = PENDING_STATUSES.includes(st);
  const isCompleted = st === 'completed';
  const isDropped = st === 'dropped';
  const now = Date.now();
  const startMs = new Date(shift.start_time).getTime();
  const endMs = new Date(shift.end_time).getTime();
  const ended = now >= endMs;
  const hoursLeft = (startMs - now) / 3600000;
  const canDrop = isBooked && !isCheckedIn && hoursLeft >= 24;
  const opensAt = calItem?.clock_in_opens_at ? new Date(calItem.clock_in_opens_at) : null;
  const tooEarly = !!opensAt && now < opensAt.getTime();
  const needsAck = !!calItem?.needs_ack;
  const shiftCancelled = String(shift.status || '').toUpperCase() === 'CANCELLED';
  const canAskBack = isDropped && startMs > now && !shiftCancelled && onAskBack;
  const { month, day, weekday } = dateParts(shift.start_time, tz);

  const chip = isCheckedIn
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
  let primary = null;
  if (isCheckedIn) {
    primary = (
      <button type="button" onClick={onClockOut} disabled={busy === 'clock'} className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`}>
        <Timer className="w-4 h-4" /> {busy === 'clock' ? 'Saving…' : 'Clock out'}
      </button>
    );
  } else if (isBooked && needsAck && (ended || tooEarly)) {
    primary = (
      <button type="button" onClick={onDetails} className={`${btn} bg-amber-500 hover:bg-amber-400 text-slate-950`}>
        <AlertTriangle className="w-4 h-4" /> {calItem?.info_change ? 'Read the update' : 'Read the shift notes'}
      </button>
    );
  } else if (isBooked && needsAck) {
    // Clock-in is open: never hide it behind "read the notes"
    primary = (
      <>
        <button type="button" onClick={onDetails} className={`${btn} bg-amber-500/15 hover:bg-amber-500 text-amber-200 hover:text-slate-950 border border-amber-500/40`}>
          <AlertTriangle className="w-4 h-4" /> {calItem?.info_change ? 'Read the update' : 'Read the notes'}
        </button>
        <button type="button" onClick={onClockIn} disabled={busy === 'clock'} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}>
          <Timer className="w-4 h-4" /> {busy === 'clock' ? 'Saving…' : calItem?.geofence_on ? 'Clock in (uses location)' : 'Clock in'}
        </button>
      </>
    );
  } else if (isBooked && !ended && !tooEarly) {
    primary = (
      <button type="button" onClick={onClockIn} disabled={busy === 'clock'} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}>
        <Timer className="w-4 h-4" /> {busy === 'clock' ? 'Saving…' : calItem?.geofence_on ? 'Clock in (uses location)' : 'Clock in'}
      </button>
    );
  } else if (isBooked && tooEarly) {
    primary = (
      <span className={`${btn} bg-slate-800 text-slate-400 border border-slate-700 font-semibold`} title="Clock-in opens shortly before your shift starts">
        <Clock className="w-4 h-4" /> Clock-in opens {fmtShortDate(opensAt, tz) !== fmtShortDate(new Date(), tz) ? `${fmtShortDate(opensAt, tz)}, ` : ''}{fmtTime(opensAt, tz)}
      </span>
    );
  } else if (isBooked && ended) {
    primary = <span className="text-[11px] text-slate-500 italic">Shift over. Ask your manager to add your hours.</span>;
  } else if (isPending) {
    primary = (
      <button type="button" onClick={onWithdraw} disabled={busy === 'withdraw'}
        className={`${btn} border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 font-semibold`}>
        <Undo2 className="w-4 h-4" /> {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw request'}
      </button>
    );
  } else if (canAskBack) {
    primary = (
      <button type="button" onClick={onAskBack} className={`${btn} bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/40`}>
        <RotateCcw className="w-4 h-4" /> Ask to come back
      </button>
    );
  } else if (isCompleted) {
    primary = <span className="text-xs text-emerald-400 font-semibold inline-flex items-center gap-1"><Check className="w-4 h-4" /> Worked</span>;
  }

  const menu = [
    onDetails && { label: 'Details & notes', icon: Info, onClick: onDetails },
    (isBooked || isCheckedIn) && onDirections && { label: 'Directions', icon: Navigation, onClick: onDirections },
    isBooked && !ended && { label: 'Add to my calendar', icon: CalendarPlus, onClick: onAddCalendar },
    (isBooked || isCheckedIn || isCompleted) && { label: 'Shift chat', icon: MessageSquare, onClick: onBoard },
    isBooked && !isCheckedIn && !ended && { label: 'Hand off to a teammate', icon: ArrowRightLeft, onClick: onHandOff },
    isBooked && !isCheckedIn && !ended && {
      label: 'Drop shift', icon: LogOut, onClick: onDrop, danger: true, disabled: !canDrop,
      hint: canDrop ? null : 'Not within 24 hours of the start. Hand it off or message your manager.',
    },
  ];

  const reasonLine = req.status_reason && ['cancelled', 'removed', 'no_show', 'withdrawn', 'dropped', 'rejected'].includes(st);

  return (
    <div className={`bg-slate-900 border rounded-2xl p-4 shadow-lg flex gap-4 ${
      isCheckedIn ? 'border-sky-500/50' : needsAck && isBooked ? 'border-amber-500/50' : 'border-slate-800'}`}>
      <div className="flex-shrink-0 w-14 h-fit rounded-xl bg-slate-950 border border-slate-800 text-center py-1.5">
        <div className="text-[10px] font-bold text-emerald-400 tracking-wider">{month}</div>
        <div className="text-xl font-black text-white leading-none">{day}</div>
        <div className="text-[10px] text-slate-400 mt-0.5">{weekday}</div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${chip[1]}`}>{chip[0]}</span>
            {req.previous_drop_at && (isBooked || isPending) && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-800 text-slate-300 border-slate-600">After a drop</span>
            )}
            {(isBooked || isCheckedIn) && SOURCE_LABELS[req.approval_source] && (
              <span className="text-[10px] text-slate-500">{SOURCE_LABELS[req.approval_source]}</span>
            )}
          </div>
          <h3 className="text-base font-bold text-white leading-snug">{shift.title}</h3>
          <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-slate-200">{shift.role_type}</span>
            <span>·</span>
            <span>{shift.venue?.name}</span>
            <span>·</span>
            <PayLabel rate={shift.hourly_rate} rateMax={shift.hourly_rate_max} className="text-emerald-400 font-semibold" />
            <TipBadge shift={shift} />
          </p>
          <p className="text-xs text-slate-300 inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-emerald-400" /> {fmtTimeRange(shift.start_time, shift.end_time, tz)}
          </p>
          {isPending && req.notes && <p className="text-[11px] text-slate-400">Your note: <span className="text-slate-300">{req.notes}</span></p>}
          {reasonLine && <p className="text-[11px] text-rose-300">Reason: {req.status_reason}</p>}
        </div>
        <div className="flex items-center gap-2 md:justify-end flex-wrap">
          {primary}
          <Menu items={menu} />
        </div>
      </div>
    </div>
  );
}
```

---

## C3. NEW FILE `frontend/src/components/worker/DropShiftDialog.jsx`

```jsx
import React, { useState } from 'react';
import { AlertTriangle, LogOut } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import PayLabel from '../PayLabel';
import { fmtDateTime } from '../../utils/venueTime';

const LATE_DROP_HOURS = 72;   // matches backend reliability (dropped with < 72h notice = late drop)

/**
 * Phase 29.4: Drop a booked shift (replaces the old hand-built confirm box).
 * Optional reason goes to the managers. Explains the late-drop rule and that coming back needs approval.
 * Props: req (ShiftRequestResponse), onClose, onDropped(message)
 */
export default function DropShiftDialog({ req, onClose, onDropped }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shift = req.shift || {};
  const hoursLeft = (new Date(shift.start_time).getTime() - Date.now()) / 3600000;
  const late = hoursLeft < LATE_DROP_HOURS;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/shifts/${req.shift_id || shift.id}/drop`, { reason: reason.trim() || null });
      onDropped('Shift dropped. Your manager has been told and the spot is open again.');
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not drop this shift.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Drop this shift?"
      icon={<LogOut className="w-5 h-5 text-rose-400" />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
            Keep it
          </button>
          <button type="button" onClick={submit} disabled={busy}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold disabled:opacity-50">
            {busy ? 'Dropping…' : 'Drop shift'}
          </button>
        </>
      )}
    >
      <div className="space-y-3">
        {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{error}</div>}
        <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
          <p className="font-bold text-white">{shift.title}</p>
          <p className="text-slate-400">
            {shift.venue?.name} · {shift.role_type} · <PayLabel rate={shift.hourly_rate} rateMax={shift.hourly_rate_max} />
          </p>
          <p className="text-slate-500">{fmtDateTime(shift.start_time, shift.venue?.timezone)}</p>
        </div>
        {late && (
          <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>It starts in less than {LATE_DROP_HOURS} hours, so this counts as a late drop on your reliability score.</span>
          </p>
        )}
        <label className="block text-xs font-semibold text-slate-300">
          Tell your manager why (optional)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="e.g. My car broke down"
            className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
          />
        </label>
        <p className="text-[11px] text-slate-500">
          The spot opens for other workers straight away. If you can make it after all, you can ask to come back from
          My shifts. Your manager has to approve it.
        </p>
      </div>
    </ModalShell>
  );
}
```

---

## C4. NEW FILE `frontend/src/components/worker/HandoffsPanel.jsx`

```jsx
import React from 'react';
import { ArrowRightLeft, Check, X, Inbox, Send, MessageSquareQuote } from 'lucide-react';
import PayLabel from '../PayLabel';
import TipBadge from '../TipBadge';
import { fmtDateTime } from '../../utils/venueTime';

const OUT_STATUS = {
  pending_worker_acceptance: ['Waiting for them', 'text-amber-300'],
  pending_manager_approval: ['They accepted · waiting for the manager', 'text-amber-300'],
  approved: ['Done · they have the shift', 'text-emerald-300'],
  declined: ['They said no · you still have the shift', 'text-slate-400'],
  denied: ['Manager said no · you still have the shift', 'text-slate-400'],
  cancelled_by_sender: ['You withdrew it', 'text-slate-500'],
};
const WAITING = ['pending_worker_acceptance', 'pending_manager_approval'];
const RECENT_DAYS = 14;

function ShiftLine({ shift }) {
  return (
    <>
      <h3 className="text-sm font-bold text-white mt-1">{shift?.title}</h3>
      <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
        <span className="font-semibold text-slate-200">{shift?.role_type}</span>
        <span>·</span>
        <span>{shift?.venue?.name}</span>
        <span>·</span>
        <PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} className="text-emerald-400 font-semibold" />
        <TipBadge shift={shift} />
      </p>
      <p className="text-xs text-slate-500 mt-0.5">{fmtDateTime(shift?.start_time, shift?.venue?.timezone)}</p>
    </>
  );
}

/**
 * Phase 29.4: Hand-offs tab. Incoming (accept / decline) and the ones I sent (withdraw while waiting).
 * Props: incoming[], outgoing[] (ShiftTransferResponse), busyId, onAccept(t), onDecline(t), onWithdraw(t)
 */
export default function HandoffsPanel({ incoming = [], outgoing = [], busyId, onAccept, onDecline, onWithdraw }) {
  const cutoff = Date.now() - RECENT_DAYS * 86400000;
  const sent = outgoing.filter((t) => WAITING.includes(t.status) || new Date(t.updated_at).getTime() >= cutoff);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Inbox className="w-4 h-4 text-amber-400" /> Offered to you by teammates ({incoming.length})
        </h2>
        {incoming.length === 0 ? (
          <p className="text-xs text-slate-500 bg-slate-900/40 border border-slate-800 rounded-2xl p-6 text-center">
            When a teammate wants to hand you one of their shifts, it shows up here.
          </p>
        ) : incoming.map((t) => (
          <div key={t.id} className="p-4 bg-slate-900 border border-amber-500/30 rounded-2xl flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-400">
                <strong className="text-white">{t.from_worker?.first_name} {t.from_worker?.last_name}</strong> wants to hand you this shift
              </p>
              <ShiftLine shift={t.shift} />
              {t.notes && (
                <p className="mt-2 text-[11px] text-amber-100 bg-amber-500/5 border border-amber-500/30 rounded-lg px-2 py-1 inline-flex gap-1">
                  <MessageSquareQuote className="w-3 h-3 text-amber-300 flex-shrink-0 mt-0.5" /> “{t.notes}”
                </p>
              )}
              <p className="text-[10px] text-slate-500 mt-1">If you accept, your manager still has to approve it.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => onDecline(t)} disabled={busyId === t.id}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                <X className="w-3.5 h-3.5" /> Decline
              </button>
              <button type="button" onClick={() => onAccept(t)} disabled={busyId === t.id}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                <Check className="w-3.5 h-3.5" /> {busyId === t.id ? 'Working…' : 'Accept'}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Send className="w-4 h-4 text-slate-400" /> Sent by you
          <span className="text-[11px] font-normal text-slate-500">(last {RECENT_DAYS} days)</span>
        </h2>
        {sent.length === 0 ? (
          <p className="text-xs text-slate-500 bg-slate-900/40 border border-slate-800 rounded-2xl p-6 text-center flex flex-col items-center gap-1">
            <ArrowRightLeft className="w-5 h-5 text-slate-600" />
            To hand off a shift, open it in My shifts and choose “Hand off to a teammate” from its ⋯ menu.
          </p>
        ) : sent.map((t) => {
          const [label, tone] = OUT_STATUS[t.status] || [t.status, 'text-slate-400'];
          const waiting = WAITING.includes(t.status);
          return (
            <div key={t.id} className={`p-4 bg-slate-900 border rounded-2xl flex flex-col md:flex-row md:items-center gap-3 ${waiting ? 'border-slate-700' : 'border-slate-800 opacity-80'}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400">
                  To <strong className="text-white">{t.to_worker?.first_name} {t.to_worker?.last_name}</strong>
                  <span className={`ml-2 font-semibold ${tone}`}>{label}</span>
                </p>
                <ShiftLine shift={t.shift} />
              </div>
              {waiting && (
                <button type="button" onClick={() => onWithdraw(t)} disabled={busyId === t.id}
                  className="px-3.5 py-2 rounded-xl border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold disabled:opacity-50 self-start md:self-auto">
                  {busyId === t.id ? 'Withdrawing…' : 'Withdraw'}
                </button>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
```

---

## C5. `frontend/src/components/TransferModal.jsx` (FULL FILE REPLACEMENT)
Same props as before.

```jsx
import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { ArrowRightLeft, AlertCircle, Info } from 'lucide-react';
import ModalShell from './ModalShell';
import { fmtShortDate, fmtDateTime } from '../utils/venueTime';
import PayLabel from './PayLabel';

/**
 * Hand off one of my booked shifts to a teammate (they accept, then the manager approves).
 * Phase 29.4: ModalShell (Esc closes it) and "hand off" wording everywhere.
 * Props: isOpen, onClose, myConfirmedShifts (ShiftRequestResponse[]), preselectedShiftId, onTransferSuccess()
 */
export default function TransferModal({ isOpen, onClose, myConfirmedShifts = [], preselectedShiftId = null, onTransferSuccess }) {
  const [selectedShiftId, setSelectedShiftId] = useState(preselectedShiftId || '');
  const [eligibleWorkers, setEligibleWorkers] = useState([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (preselectedShiftId) {
      setSelectedShiftId(preselectedShiftId);
    } else if (myConfirmedShifts.length > 0 && !selectedShiftId) {
      setSelectedShiftId(myConfirmedShifts[0].shift_id || myConfirmedShifts[0].shift?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedShiftId, myConfirmedShifts]);

  useEffect(() => {
    if (!isOpen || !selectedShiftId) return undefined;
    let active = true;
    setLoadingWorkers(true);
    setError(null);
    api
      .get(`/transfers/eligible-workers/${selectedShiftId}`)
      .then((res) => {
        if (!active) return;
        const list = res.data || [];
        setEligibleWorkers(list);
        setSelectedWorkerId(list.length ? list[0].id : '');
      })
      .catch(() => active && setError('Could not load teammates for this shift.'))
      .finally(() => active && setLoadingWorkers(false));
    return () => {
      active = false;
    };
  }, [isOpen, selectedShiftId]);

  if (!isOpen) return null;

  const currentShiftObj = myConfirmedShifts.find((item) => (item.shift_id || item.shift?.id) === selectedShiftId)?.shift;

  const handleSubmit = async () => {
    if (!selectedShiftId || !selectedWorkerId || submitting) return;
    try {
      setSubmitting(true);
      setError(null);
      await api.post('/transfers/propose', {
        shift_id: selectedShiftId,
        to_worker_id: selectedWorkerId,
        notes: notes.trim() || undefined,
      });
      if (onTransferSuccess) onTransferSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not send the hand-off.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectCls = 'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500';

  return (
    <ModalShell
      title="Hand off a shift"
      icon={<ArrowRightLeft className="w-5 h-5 text-amber-400" />}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedShiftId || !selectedWorkerId || submitting || eligibleWorkers.length === 0}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-40"
          >
            {submitting ? 'Sending…' : 'Send hand-off'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <label className="block text-xs font-semibold text-slate-300">
          Shift
          <select value={selectedShiftId} onChange={(e) => setSelectedShiftId(e.target.value)} className={`${selectCls} mt-1`}>
            {myConfirmedShifts.map((req) => {
              const s = req.shift;
              const id = req.shift_id || s?.id;
              return (
                <option key={id} value={id}>
                  {s?.title} ({s?.role_type}) · {fmtShortDate(s?.start_time, s?.venue?.timezone)}
                </option>
              );
            })}
          </select>
        </label>

        {currentShiftObj && (
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1 text-slate-300">
            <p className="font-bold text-white">{currentShiftObj.title}</p>
            <p className="text-slate-400">
              {currentShiftObj.venue?.name} · {currentShiftObj.role_type} ·{' '}
              <PayLabel rate={currentShiftObj.hourly_rate} rateMax={currentShiftObj.hourly_rate_max} />
            </p>
            <p className="text-slate-500 text-[11px]">{fmtDateTime(currentShiftObj.start_time, currentShiftObj.venue?.timezone)}</p>
          </div>
        )}

        <label className="block text-xs font-semibold text-slate-300">
          Hand it to
          {loadingWorkers ? (
            <div className="text-xs text-slate-500 py-2 font-normal">Finding teammates who are free…</div>
          ) : eligibleWorkers.length === 0 ? (
            <div className="text-xs text-slate-400 bg-slate-950 p-3 rounded-xl border border-slate-800 mt-1 font-normal">
              Nobody on this venue's team is free for this shift. You can still drop it (more than 24 hours before it starts), or message your manager.
            </div>
          ) : (
            <select value={selectedWorkerId} onChange={(e) => setSelectedWorkerId(e.target.value)} className={`${selectCls} mt-1`}>
              {eligibleWorkers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.first_name} {w.last_name} · {w.rating_count ? `★ ${Number(w.aggregate_rating || 0).toFixed(1)}` : 'New'}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="block text-xs font-semibold text-slate-300">
          Note for them and your manager (optional)
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            placeholder="e.g. Family thing came up. Thanks for covering!"
            rows={2}
            className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
          />
        </label>

        <p className="text-[11px] text-slate-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl flex gap-2">
          <Info className="w-3.5 h-3.5 text-amber-300 flex-shrink-0 mt-0.5" />
          <span>
            They accept first, then your manager approves. <b className="text-slate-200">You stay on the shift until the manager approves.</b>{' '}
            You can withdraw it from the Hand-offs tab while it's waiting.
          </span>
        </p>
      </div>
    </ModalShell>
  );
}
```

---

## C6. `frontend/src/components/EventListingModal.jsx` (EDITS)
Ask to come back: reason required, the button label, and a banner.

**Edit 1.** Find:
```jsx

// Statuses on a position that the server will refuse to re-open.
const LOCKED_POSITION_STATUSES = ['rejected', 'removed', 'no_show', 'dropped', 'transferred', 'cancelled'];

function pickDefault(listing, prev) {
```
Replace with:
```jsx

// Statuses on a position that the server will refuse to re-open.
const LOCKED_POSITION_STATUSES = ['rejected', 'removed', 'no_show', 'transferred', 'cancelled'];   // Phase 29.4: 'dropped' can ask back
const ASK_BACK_MIN = 5;

function pickDefault(listing, prev) {
```

**Edit 2.** Find:
```jsx
  const selectedIsMine = selected && mine && selected.shift_id === mine.shift_id;
  const bookedPosition = isBooked ? listing.positions.find((p) => p.shift_id === mine.shift_id) : null;

  const addToCalendar = () =>
```
Replace with:
```jsx
  const selectedIsMine = selected && mine && selected.shift_id === mine.shift_id;
  const bookedPosition = isBooked ? listing.positions.find((p) => p.shift_id === mine.shift_id) : null;
  // Phase 29.4: they dropped a position in this event -> asking back needs a reason and the manager's OK
  const askingBack = !!listing.dropped_here && !isBooked;
  const noteOk = !askingBack || note.trim().length >= ASK_BACK_MIN;

  const addToCalendar = () =>
```

**Edit 3.** Find:
```jsx
      const label = isWaiting
        ? `Switch to ${selected.role_type}`
        : selected.booking === 'instant'
        ? 'Book instantly'
```
Replace with:
```jsx
      const label = isWaiting
        ? `Switch to ${selected.role_type}`
        : askingBack
        ? 'Ask to come back'
        : selected.booking === 'instant'
        ? 'Book instantly'
```

**Edit 4.** Find:
```jsx
          type="button"
          onClick={() => sendRequest(isWaiting)}
          disabled={submitting || !listing.can_request || selected.status !== 'OPEN'}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
```
Replace with:
```jsx
          type="button"
          onClick={() => sendRequest(isWaiting)}
          disabled={submitting || !listing.can_request || selected.status !== 'OPEN' || !noteOk}
          title={noteOk ? undefined : 'Tell the manager why you can make it now'}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
```

**Edit 5.** Find:
```jsx
          {result.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}
```
Replace with:
```jsx
          {result.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      {askingBack && !listing.cancelled && !listing.started && (
        <div className="mb-4 p-3 rounded-xl border border-slate-600 bg-slate-800/60 text-slate-200 text-xs flex items-start gap-2">
          <Info className="w-4 h-4 flex-shrink-0 text-slate-300" />
          <span>
            You dropped a shift at this event. You can ask to come back: tell the manager why you can make it now.
            It always needs their approval, and until they say yes the drop still counts on your reliability.
          </span>
        </div>
      )}
```

**Edit 6.** Find:
```jsx
                      {ps && (
                        <p className={`text-[11px] mt-1.5 font-semibold ${isMine ? 'text-amber-300' : 'text-slate-400'}`}>
                          You: {STATUS_LABELS[ps] || ps}
                          {p.my_status_reason ? ` — ${p.my_status_reason}` : ''}
                        </p>
```
Replace with:
```jsx
                      {ps && (
                        <p className={`text-[11px] mt-1.5 font-semibold ${isMine ? 'text-amber-300' : 'text-slate-400'}`}>
                          {ps === 'dropped' ? 'You dropped this' : `You: ${STATUS_LABELS[ps] || ps}`}
                          {p.my_status_reason ? ` — ${p.my_status_reason}` : ''}
                        </p>
```

**Edit 7.** Find:
```jsx
          {showNoteBox && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Note for the manager (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={2}
                placeholder="e.g. 3 years behind the bar, can stay late"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
```
Replace with:
```jsx
          {showNoteBox && (
            <div>
              <label className={`block text-[11px] font-semibold mb-1 ${askingBack ? 'text-amber-200' : 'text-slate-400'}`}>
                {askingBack ? 'Why you can make it now (required)' : 'Note for the manager (optional)'}
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={2}
                placeholder={askingBack ? 'e.g. My appointment moved, I can do the full shift' : 'e.g. 3 years behind the bar, can stay late'}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
```

---

## C7. `frontend/src/components/EventListingCard.jsx` (EDITS)

**Edit 1.** Find:
```jsx
                )}
                <span className="text-xs font-bold text-slate-100 truncate">{p.role_type}</span>
                {p.my_status && <span className="text-[10px] text-amber-300">• you</span>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-[11px]">
```
Replace with:
```jsx
                )}
                <span className="text-xs font-bold text-slate-100 truncate">{p.role_type}</span>
                {p.my_status && (
                  <span className={`text-[10px] whitespace-nowrap ${p.my_status === 'dropped' ? 'text-rose-300' : 'text-amber-300'}`}>
                    • {p.my_status === 'dropped' ? 'you dropped' : 'you'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-[11px]">
```

**Edit 2.** Find:
```jsx
        </span>
        <span className="text-xs font-bold text-emerald-400 inline-flex items-center gap-0.5 group-hover:gap-1.5 transition-all">
          {mine ? 'View details' : 'View & request'}
          <ChevronRight className="w-4 h-4" />
        </span>
```
Replace with:
```jsx
        </span>
        <span className="text-xs font-bold text-emerald-400 inline-flex items-center gap-0.5 group-hover:gap-1.5 transition-all">
          {mine ? 'View details' : listing.dropped_here ? 'Ask to come back' : 'View & request'}
          <ChevronRight className="w-4 h-4" />
        </span>
```

---

## C8. `frontend/src/utils/listingFormat.js` (EDIT)

**Edit 1.** Find:
```js
  completed: 'Completed',
  rejected: 'Not selected',
  dropped: 'Released',
  transferred: 'Handed off',
  cancelled: 'Cancelled by venue',
```
Replace with:
```js
  completed: 'Completed',
  rejected: 'Not selected',
  dropped: 'You dropped this',
  transferred: 'Handed off',
  cancelled: 'Cancelled by venue',
```

---

# PART D: Frontend, manager

## D1. `frontend/src/components/ManagerQueues.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import React from 'react';
import { Users, ArrowRightLeft, Check, X, Eye, MessageSquareQuote, ArrowRight } from 'lucide-react';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
```
Replace with:
```jsx
import React from 'react';
import { Users, ArrowRightLeft, Check, X, Eye, MessageSquareQuote, ArrowRight, RotateCcw } from 'lucide-react';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
```

**Edit 2.** Find:
```jsx
                  </button>
                </div>
                {req.notes && (
                  <div className="text-[11px] text-amber-100 bg-amber-500/5 border border-amber-500/30 rounded-lg px-2 py-1 flex gap-1">
```
Replace with:
```jsx
                  </button>
                </div>
                {req.previous_drop_at && (
                  <div className="text-[11px] text-rose-100 bg-rose-500/10 border border-rose-500/40 rounded-lg px-2 py-1 flex gap-1">
                    <RotateCcw className="w-3 h-3 text-rose-300 flex-shrink-0 mt-0.5" />
                    <span>Dropped this event on {fmtDate(req.previous_drop_at, timeZone)} and is asking back. Needs your OK.</span>
                  </div>
                )}
                {req.notes && (
                  <div className="text-[11px] text-amber-100 bg-amber-500/5 border border-amber-500/30 rounded-lg px-2 py-1 flex gap-1">
```

---

## D2. `frontend/src/components/ReviewModal.jsx` (EDIT)

**Edit 1.** Find:
```jsx
            </div>
          )}
          <div className={`p-3 rounded-xl border text-sm ${note ? 'bg-amber-500/5 border-amber-500/40 text-amber-50' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1 inline-flex items-center gap-1 text-amber-300">
              <MessageSquareQuote className="w-3.5 h-3.5" /> {isTransfer ? 'Their note' : 'Note with the request'}
            </div>
            <div className="whitespace-pre-line">{note ? `“${note}”` : 'No note.'}</div>
```
Replace with:
```jsx
            </div>
          )}
          {!isTransfer && d.previous_drop_at && (
            <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-sm text-rose-100">
              <div className="font-bold text-rose-200">Dropped this event on {fmtDateTime(d.previous_drop_at, timeZone)}</div>
              <div className="text-xs mt-0.5">They're asking to come back. Their reason is below. Approving books them. If they work the shift, the earlier drop stops counting against their reliability.</div>
            </div>
          )}
          <div className={`p-3 rounded-xl border text-sm ${note ? 'bg-amber-500/5 border-amber-500/40 text-amber-50' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1 inline-flex items-center gap-1 text-amber-300">
              <MessageSquareQuote className="w-3.5 h-3.5" /> {isTransfer ? 'Their note' : d.previous_drop_at ? 'Why they can make it now' : 'Note with the request'}
            </div>
            <div className="whitespace-pre-line">{note ? `“${note}”` : 'No note.'}</div>
```

---

## D3. `frontend/src/components/EventRosterModal.jsx` (EDITS)
The Dropped list, **Book back…** (uses the Phase 29.3 `ConfirmDialog`), and the flags.

**Edit 1.** Find:
```jsx
import React, { useState } from 'react';
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText, UserMinus, Ban, Lock, BookOpenCheck, AlertTriangle, MapPin, Send, Clock } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import RateWorker from './RateWorker';
import StaffPositionModal from './StaffPositionModal';
import TipBadge from './TipBadge';
import ReliabilityBadge from './ReliabilityBadge';
```
Replace with:
```jsx
import React, { useState } from 'react';
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText, UserMinus, Ban, Lock, BookOpenCheck, AlertTriangle, MapPin, Send, Clock, RotateCcw, LogOut } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import RateWorker from './RateWorker';
import StaffPositionModal from './StaffPositionModal';
import ConfirmDialog from './ConfirmDialog';
import TipBadge from './TipBadge';
import ReliabilityBadge from './ReliabilityBadge';
```

**Edit 2.** Find:
```jsx
  const [flash, setFlash] = useState(null);           // Phase 29: { type, text }
  const [withdrawing, setWithdrawing] = useState(null);
  if (!event) return null;
  const ended = new Date(event.end_time).getTime() < Date.now();
```
Replace with:
```jsx
  const [flash, setFlash] = useState(null);           // Phase 29: { type, text }
  const [withdrawing, setWithdrawing] = useState(null);
  const [bookBack, setBookBack] = useState(null);     // Phase 29.4: { person, pos }
  if (!event) return null;
  const ended = new Date(event.end_time).getTime() < Date.now();
```

**Edit 3.** Find:
```jsx
                                <div className="text-[10px] text-slate-500">{SOURCE_LABEL[p.approval_source]}</div>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{p.phone}</a>}
```
Replace with:
```jsx
                                <div className="text-[10px] text-slate-500">{SOURCE_LABEL[p.approval_source]}</div>
                              )}
                              {p.previous_drop_at && (
                                <div className="text-[10px] text-rose-300 inline-flex items-center gap-1" title={p.rebook_reason || ''}>
                                  <RotateCcw className="w-3 h-3" /> Back after dropping on {fmtDate(p.previous_drop_at, timeZone)}
                                  {p.rebook_reason ? ` · “${p.rebook_reason}”` : ''}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{p.phone}</a>}
```

**Edit 4.** Find:
```jsx
                              <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                              <div className="text-[11px] text-slate-400 mt-0.5">Requested {p.requested_at ? fmtDateTime(p.requested_at, timeZone) : ''}</div>
                              {p.note && (
                                <div className="text-[11px] text-slate-300 mt-1 italic whitespace-pre-line">“{p.note}”</div>
```
Replace with:
```jsx
                              <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                              <div className="text-[11px] text-slate-400 mt-0.5">Requested {p.requested_at ? fmtDateTime(p.requested_at, timeZone) : ''}</div>
                              {p.previous_drop_at && (
                                <div className="text-[11px] text-rose-300 mt-0.5 inline-flex items-center gap-1">
                                  <RotateCcw className="w-3 h-3" /> Dropped this event on {fmtDate(p.previous_drop_at, timeZone)}, asking back
                                </div>
                              )}
                              {p.note && (
                                <div className="text-[11px] text-slate-300 mt-1 italic whitespace-pre-line">“{p.note}”</div>
```

**Edit 5.** Find:
```jsx
                  )}
                </div>

                {pos.offers && pos.offers.length > 0 && (
```
Replace with:
```jsx
                  )}
                </div>

                {pos.dropped && pos.dropped.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <LogOut className="w-3.5 h-3.5 text-rose-400" /> Dropped ({pos.dropped.length})
                    </div>
                    <div className="space-y-2">
                      {pos.dropped.map((p) => (
                        <div key={p.request_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                          <div>
                            <div className="text-sm font-semibold text-slate-200">{p.first_name} {p.last_name}</div>
                            <div className="text-[11px] text-slate-500">
                              Dropped {p.dropped_at ? fmtDateTime(p.dropped_at, timeZone) : ''}
                              {p.drop_reason ? ` · “${p.drop_reason}”` : ''}
                            </div>
                          </div>
                          {venueId && !event.cancelled && !ended && pos.status !== 'CANCELLED' && event.status !== 'draft' && (
                            <button type="button" onClick={() => setBookBack({ person: p, pos })}
                              disabled={pos.assigned.length >= pos.capacity}
                              title={pos.assigned.length >= pos.capacity ? 'Position is full' : 'Book them back on this position'}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-slate-700 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40">
                              <RotateCcw className="w-3 h-3" /> Book back…
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pos.offers && pos.offers.length > 0 && (
```

**Edit 6.** Find:
```jsx
        })}
      </div>
      {staffPos && (
        <StaffPositionModal
```
Replace with:
```jsx
        })}
      </div>
      {bookBack && (
        <ConfirmDialog
          title={`Book ${bookBack.person.first_name} back?`}
          message={`${bookBack.person.first_name} dropped ${bookBack.pos.role_type} on this event. Booking them back is logged with your reason, and they're told they're booked.`}
          confirmLabel="Book back"
          input={{ label: 'Reason (required)', placeholder: 'e.g. They sorted out their conflict', required: true }}
          onConfirm={async (reason) => {
            if (reason.length < 5) throw new Error('Add a slightly longer reason.');
            const res = await api.post(`/shifts/${bookBack.pos.shift_id}/assign`, { worker_id: bookBack.person.worker_id, reason });
            setFlash({ type: 'success', text: res.data.message });
            if (onChanged) onChanged();
          }}
          onClose={() => setBookBack(null)}
        />
      )}
      {staffPos && (
        <StaffPositionModal
```

---

## D4. `frontend/src/components/StaffPositionModal.jsx` (EDITS)
An inline reason when assigning someone who dropped. They can't be ticked for offers.

**Edit 1.** Find:
```jsx
  }, [position.shift_id, debouncedQ]);

  const selectable = (c) => (c.available || c.requested_this) && !c.offered;
  const toggle = (c) => {
    if (!selectable(c)) return;
```
Replace with:
```jsx
  }, [position.shift_id, debouncedQ]);

  const selectable = (c) => (c.available || c.requested_this) && !c.offered && !(c.dropped_at && !c.requested_this);   // Phase 29.4
  const toggle = (c) => {
    if (!selectable(c)) return;
```

**Edit 2.** Find:
```jsx
  };

  const assign = async (c) => {
    setBusy(`assign-${c.worker_id}`);
    setError('');
    try {
      const res = await api.post(`/shifts/${position.shift_id}/assign`, { worker_id: c.worker_id });
      onDone(res.data.message);
    } catch (err) {
```
Replace with:
```jsx
  };

  const [reasonFor, setReasonFor] = useState(null);   // Phase 29.4: candidate who dropped this event
  const [reason, setReason] = useState('');

  const assign = async (c, why = null) => {
    // Phase 29.4: someone who dropped this event needs a reason (unless they asked back themselves)
    if (c.dropped_at && !c.requested_this && why === null) {
      setReasonFor(c.worker_id);
      setReason('');
      return;
    }
    setBusy(`assign-${c.worker_id}`);
    setError('');
    try {
      const res = await api.post(`/shifts/${position.shift_id}/assign`, { worker_id: c.worker_id, reason: why || undefined });
      onDone(res.data.message);
    } catch (err) {
```

**Edit 3.** Find:
```jsx
                      </div>
                    )}
                  </div>
                  <button
```
Replace with:
```jsx
                      </div>
                    )}
                    {c.dropped_at && (
                      <div className="text-[11px] text-rose-300 mt-0.5">
                        Dropped this event on {new Date(c.dropped_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        {c.drop_reason ? ` · “${c.drop_reason}”` : ''}. {c.requested_this ? 'They asked to come back.' : 'Assign needs a reason; offers skip them.'}
                      </div>
                    )}
                    {reasonFor === c.worker_id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 w-full">
                        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))}
                          onKeyDown={(e) => e.key === 'Enter' && reason.trim().length >= 5 && assign(c, reason.trim())}
                          placeholder="Why are you booking them back?"
                          className="flex-1 min-w-[12rem] px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500" />
                        <button type="button" onClick={() => assign(c, reason.trim())} disabled={reason.trim().length < 5 || busy !== null}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-40">Book back</button>
                        <button type="button" onClick={() => setReasonFor(null)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
                      </div>
                    )}
                  </div>
                  <button
```

---

## E. Rebuild & verification

**Schema changed.** Choose ONE:

* **Standard (wipes data):**
```bash
docker compose down -v
docker compose up -d --build
```
* **Keep current data:**
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
ALTER TABLE shift_requests ADD COLUMN IF NOT EXISTS previous_drop_at TIMESTAMPTZ;
ALTER TABLE shift_requests ADD COLUMN IF NOT EXISTS rebook_reason TEXT;
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
**As a worker** with an upcoming booking:
1. **Landing and tabs:**
   * `/worker` opens on **My shifts**.
   * The tabs read My shifts · Find shifts · Calendar · Hand-offs.
   * On a phone all four are visible in a 2×2 grid.
2. **Cards:**
   * Each shift shows a date tile, status, role · venue · pay, the times, **one** main button and a ⋯ menu.
   * A shift starting within the clock-in window shows **Clock in**. If it has unread notes, **Read the notes** sits next to it and doesn't replace it.
3. **⋯ menu:**
   * It lists Details & notes, Directions, Add to my calendar, Shift chat, Hand off to a teammate and Drop shift.
   * Inside 24 h, Drop is greyed out with the reason.
4. **Drop:**
   * Drop a shift 3+ days out with a reason. The dialog closes with Esc and warns about late drops inside 72 h.
   * The manager's bell shows the drop **with the reason**.
5. **Ask back:**
   * The dropped shift shows under "Dropped · you can still ask to come back". **Ask to come back** opens the event.
   * The reason box is required, and the button stays disabled until you type 5+ characters.
   * Send it: it shows "Waiting for the manager" and "After a drop", **even at a team venue that normally books instantly**.
6. **Find shifts:** the dropped event's card shows "• you dropped" and "Ask to come back". No position in it shows Instant book.
7. **Hand-offs:**
   * Propose a hand-off from ⋯. Under **Hand-offs → Sent by you** it shows "Waiting for them", and **Withdraw** works.
   * An incoming hand-off shows the teammate's note.

**As the manager:**

8. **Queue and review:** the ask-back request shows a red "Dropped this event on … and is asking back". **Review** shows the flag and "Why they can make it now".
9. **Roster:**
   * The event's **Dropped** list shows who dropped, when and why.
   * **Book back…** asks for a reason, then books them. The roster shows "Back after dropping on … · "reason"", and the activity log says "booked back after a drop".
10. **Assign / Offer:**
    * Search someone who dropped the event. They show "Dropped this event on…".
    * **Assign** asks for a reason inline.
    * Ticking them for an offer isn't possible, and the API skips them anyway.
11. **Reliability:** someone who drops inside 72 h and then asks back still shows the late drop until they actually work the shift.