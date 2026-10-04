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
        total_pay=data["total_pay"], total_tips=data["total_tips"], open_entries=data["open_entries"],
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
            total_tips=current.total_tips,                                               # Phase 35.2
            approved_by_user_id=current_user.id, approved_at=datetime.now(timezone.utc),
        ))
        await db.commit()
    except Exception as ex:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not approve the pay period: {ex}")
    await activity.for_venue("pay_period_approved", venue_id, current_user.id,
                             f"Approved and locked pay period {pp.period_label(s, e)} "
                             f"({current.total_hours:g} h, ${current.total_pay:,.2f}"
                             + (f" + ${current.total_tips:,.2f} tips" if current.total_tips else "") + ")")
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
