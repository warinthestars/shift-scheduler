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
