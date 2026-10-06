"""
Phase 35.2: Tips per event.

* Own tips: ShiftRequest.tip_amount, entered by a manager for people in positions that get tips (Shift.tips_eligible).
* Tip pool: EventTip.pool_amount, one per event, shared by everyone booked in the event's tip-pool positions
  (Shift.tip_pool). How it's shared (EventTip.split, defaulting to venues.tip_pool_split):
    hours  - by hours worked: ShiftUp clock-ins (closed entries) for people who clock in here, scheduled hours
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
