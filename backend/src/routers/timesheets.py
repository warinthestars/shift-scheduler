"""
Phase 26: Manager actions on a single person's booking and their time entries.
Every change is audited in time_entry_edits.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Shift, ShiftRequest, TimeEntry
from src.schemas import ReasonBody, TimeEntryInput, PayRateInput
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services import notify_events
from src.services import activity
from src.services.timesheets import (
    ASSIGNED_STATUSES, as_utc, fmt_range, validate_times, require_reason, audit,
)

router = APIRouter(prefix="/api", tags=["Time Sheets"])


async def _load_request(db: AsyncSession, request_id: UUID, user: User):
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    if not req:
        raise HTTPException(status_code=404, detail="Booking not found.")
    shift = await db.scalar(select(Shift).where(Shift.id == req.shift_id))
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")
    if not await can_manage_venue(db, user, shift.venue_id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return req, shift


async def _load_entry(db: AsyncSession, entry_id: UUID, user: User):
    entry = await db.scalar(select(TimeEntry).where(TimeEntry.id == entry_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Time entry not found.")
    req = await db.scalar(
        select(ShiftRequest).where(ShiftRequest.shift_id == entry.shift_id, ShiftRequest.worker_id == entry.worker_id)
    )
    shift = await db.scalar(select(Shift).where(Shift.id == entry.shift_id))
    if not req or not shift:
        raise HTTPException(status_code=404, detail="Booking not found for this entry.")
    if not await can_manage_venue(db, user, shift.venue_id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return entry, req, shift


@router.post("/requests/{request_id}/remove")
async def remove_person(
    request_id: UUID,
    body: ReasonBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Remove a confirmed person from a shift. Their spot reopens."""
    req, shift = await _load_request(db, request_id, current_user)
    reason = require_reason(body.reason)
    st = (req.status or "").lower()
    if st in ("pending", "pending_manager_approval"):
        raise HTTPException(status_code=400, detail="This request is still waiting. Use Deny instead.")
    if st in ("checked_in", "completed"):
        raise HTTPException(status_code=400, detail="They've already clocked in. Fix the time sheet instead.")
    if st not in ("approved", "confirmed"):
        raise HTTPException(status_code=400, detail="Only confirmed people can be removed.")
    try:
        req.status = "removed"
        req.status_reason = reason
        shift.spots_filled = max(0, (shift.spots_filled or 1) - 1)
        if (shift.status or "").upper() == "FILLED" and as_utc(shift.start_time) > datetime.now(timezone.utc):
            shift.status = "OPEN"
        audit(db, req.id, None, current_user.id, "remove", st, "removed", reason)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to remove: {str(e)}")
    await notify_events.removed(request_id)                  # Phase 28
    await activity.for_request("person_removed", request_id, current_user.id, f"Reason: {reason}")   # Phase 29.1
    return {"detail": "Removed from shift."}


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
        raise HTTPException(status_code=400, detail="Only confirmed people who haven't clocked in can be marked no-show.")
    has_entries = await db.scalar(
        select(func.count(TimeEntry.id)).where(TimeEntry.shift_id == req.shift_id, TimeEntry.worker_id == req.worker_id)
    )
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


@router.put("/requests/{request_id}/pay-rate")
@router.post("/requests/{request_id}/pay-rate")
async def set_pay_rate(
    request_id: UUID,
    body: PayRateInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    req, shift = await _load_request(db, request_id, current_user)
    if body.pay_rate is not None and body.pay_rate <= 0:
        raise HTTPException(status_code=400, detail="Pay must be more than $0.")
    try:
        old = f"{float(req.pay_rate):.2f}" if req.pay_rate is not None else f"default {float(shift.hourly_rate):.2f}"
        req.pay_rate = body.pay_rate
        new = f"{float(body.pay_rate):.2f}" if body.pay_rate is not None else f"default {float(shift.hourly_rate):.2f}"
        audit(db, req.id, None, current_user.id, "pay_rate", old, new, (body.reason or "").strip() or None)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to set pay: {str(e)}")
    return {"detail": "Pay updated.", "pay_rate": float(req.pay_rate) if req.pay_rate is not None else None}


@router.post("/requests/{request_id}/time-entries")
async def add_time_entry(
    request_id: UUID,
    body: TimeEntryInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    req, shift = await _load_request(db, request_id, current_user)
    reason = require_reason(body.reason)
    st = (req.status or "").lower()
    if st not in ASSIGNED_STATUSES + ("no_show",):
        raise HTTPException(status_code=400, detail="Time can only be added for people booked on this shift.")
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
    try:
        entry = TimeEntry(
            worker_id=req.worker_id, shift_id=req.shift_id, clock_in_time=cin, clock_out_time=cout,
            clock_in_geo_status="manager",                                   # Phase 27: manager override
            clock_out_geo_status="manager" if cout is not None else None,
        )
        db.add(entry)
        await db.flush()
        if cout is not None:
            req.status = "completed"
            req.check_out_time = req.check_out_time or cout
        elif st in ("approved", "confirmed", "no_show"):
            req.status = "checked_in"
        req.check_in_time = req.check_in_time or cin
        if st == "no_show":
            req.status_reason = None
        audit(db, req.id, entry.id, current_user.id, "add", None, fmt_range(cin, cout), reason)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add time: {str(e)}")
    return {"detail": "Time added.", "entry_id": str(entry.id)}


@router.patch("/time-entries/{entry_id}")
async def edit_time_entry(
    entry_id: UUID,
    body: TimeEntryInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    entry, req, shift = await _load_entry(db, entry_id, current_user)
    reason = require_reason(body.reason)
    cin, cout = validate_times(body.clock_in_time, body.clock_out_time)
    try:
        old = fmt_range(entry.clock_in_time, entry.clock_out_time)
        # Phase 27: a time the manager typed in is a manager override
        if as_utc(entry.clock_in_time) != cin:
            entry.clock_in_geo_status = "manager"
        if cout is not None and (entry.clock_out_time is None or as_utc(entry.clock_out_time) != cout):
            entry.clock_out_geo_status = "manager"
            entry.auto_closed = False
        entry.clock_in_time = cin
        entry.clock_out_time = cout
        if cout is not None and (req.status or "").lower() == "checked_in":
            req.status = "completed"
            req.check_out_time = req.check_out_time or cout
        audit(db, req.id, entry.id, current_user.id, "edit", old, fmt_range(cin, cout), reason)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update time: {str(e)}")
    return {"detail": "Time updated."}


@router.post("/time-entries/{entry_id}/delete")
async def delete_time_entry(
    entry_id: UUID,
    body: ReasonBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    entry, req, shift = await _load_entry(db, entry_id, current_user)
    reason = require_reason(body.reason)
    try:
        audit(db, req.id, entry.id, current_user.id, "delete", fmt_range(entry.clock_in_time, entry.clock_out_time), None, reason)
        await db.execute(delete(TimeEntry).where(TimeEntry.id == entry.id))
        await db.flush()
        remaining = await db.scalar(
            select(func.count(TimeEntry.id)).where(TimeEntry.shift_id == req.shift_id, TimeEntry.worker_id == req.worker_id)
        )
        if not remaining and (req.status or "").lower() in ("checked_in", "completed"):
            req.status = "approved"
            req.check_in_time = None
            req.check_out_time = None
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete time: {str(e)}")
    return {"detail": "Time entry deleted."}
