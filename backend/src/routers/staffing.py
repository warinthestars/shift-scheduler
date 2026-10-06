"""
Phase 29: Direct assign and offers.

Phase 36: the four manager endpoints also accept the venue's shift leads (services/access.py).
A lead only sees and picks people who are on the team, and can't assign or offer to themselves.
Nothing here returns pay.

Manager (venue's manager or platform admin) or shift lead:
  GET    /api/shifts/{shift_id}/candidates?q=     team (+ search) with availability
  POST   /api/shifts/{shift_id}/assign            book one person now
  POST   /api/shifts/{shift_id}/offers            offer to 1-5 people; first to accept is booked
  DELETE /api/offers/{offer_id}                   withdraw a waiting offer

Worker:
  GET    /api/me/offers                           offers waiting for me
  POST   /api/offers/{offer_id}/accept
  POST   /api/offers/{offer_id}/decline
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Shift, ShiftOffer, ShiftRequest
from src.schemas import (
    AssignCandidate, AssignRequest, AssignResult, OfferCreate, OfferCreateResult, WorkerOffer, OfferAcceptResult,
)
from src.auth import get_current_user, normalize_role
from src.services.access import floor_access, team_ids, LEAD      # Phase 36
from src.services import staffing
from src.services import notify_events
from src.services import activity

router = APIRouter(tags=["Staffing"])


async def _floor_shift(db: AsyncSession, shift_id: UUID, user: User):
    """Phase 36: the shift, and 'manager' or 'lead'. 403 for anyone else."""
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found.")
    return shift, await floor_access(db, user, shift.venue_id)


async def _lead_may_pick(db: AsyncSession, user: User, shift: Shift, worker_ids) -> None:
    """Phase 36: a shift lead fills spots from the team only, and never with themselves."""
    ids = list(dict.fromkeys(worker_ids or []))
    if user.id in ids:
        raise HTTPException(status_code=403, detail="You can't put yourself on a shift here. Request it from the ShiftBoard.")
    on_team = await team_ids(db, shift.venue_id, ids)
    if any(w not in on_team for w in ids):
        raise HTTPException(status_code=403, detail="Shift leads can only pick people on the team. Ask a manager to add them first.")


@router.get("/api/shifts/{shift_id}/candidates", response_model=List[AssignCandidate])
async def get_candidates(
    shift_id: UUID,
    q: Optional[str] = Query(None, max_length=100),
    current_user: User = Depends(get_current_user),           # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db),
):
    shift, access = await _floor_shift(db, shift_id, current_user)
    people = await staffing.list_candidates(db, shift, q=q)
    if access == LEAD:
        people = [p for p in people if p.on_team and p.worker_id != current_user.id]
    return people


@router.post("/api/shifts/{shift_id}/assign", response_model=AssignResult)
async def assign(
    shift_id: UUID,
    body: AssignRequest,
    current_user: User = Depends(get_current_user),           # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db),
):
    shift, access = await _floor_shift(db, shift_id, current_user)
    if access == LEAD:
        await _lead_may_pick(db, current_user, shift, [body.worker_id])
    request_id, message = await staffing.assign_worker(db, current_user, shift_id, body.worker_id, reason=body.reason)
    await notify_events.assigned(request_id)          # after commit; never raises
    # Phase 29.4: flag a rebook after a drop in the activity log
    req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
    extra = f"booked back after a drop · “{req.rebook_reason}”" if req is not None and req.previous_drop_at and req.rebook_reason else ""
    await activity.for_request("assigned", request_id, current_user.id, extra)   # Phase 29.1
    return AssignResult(request_id=request_id, message=message)


@router.post("/api/shifts/{shift_id}/offers", response_model=OfferCreateResult)
async def offer(
    shift_id: UUID,
    body: OfferCreate,
    current_user: User = Depends(get_current_user),           # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db),
):
    shift, access = await _floor_shift(db, shift_id, current_user)
    if access == LEAD:
        await _lead_may_pick(db, current_user, shift, body.worker_ids)
    result, offer_ids = await staffing.create_offers(db, current_user, shift_id, body.worker_ids, body.message)
    if offer_ids:
        await notify_events.offers_sent(offer_ids)    # after commit; never raises
        await activity.for_shift("offers_sent", shift_id, current_user.id,
                                 f"Offered {{what}} to {len(offer_ids)} {'person' if len(offer_ids) == 1 else 'people'}")   # Phase 29.1
    return result


@router.delete("/api/offers/{offer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def withdraw_offer(
    offer_id: UUID,
    current_user: User = Depends(get_current_user),           # Phase 36: managers and shift leads
    db: AsyncSession = Depends(get_db),
):
    o = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id))
    if o is None:
        raise HTTPException(status_code=404, detail="Offer not found.")
    await floor_access(db, current_user, o.venue_id)
    await staffing.cancel_offer(db, o)
    return None


@router.get("/api/me/offers", response_model=List[WorkerOffer])
async def my_offers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if normalize_role(current_user.role) != "worker":
        return []
    return await staffing.worker_offers(db, current_user)


@router.post("/api/offers/{offer_id}/accept", response_model=OfferAcceptResult)
async def accept(
    offer_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    request_id, o = await staffing.accept_offer(db, current_user, offer_id)
    await notify_events.offer_accepted(o.id, request_id)
    await activity.for_request("offer_accepted", request_id, current_user.id)   # Phase 29.1
    return OfferAcceptResult(request_id=request_id, message="You're booked. It's on your calendar now.")


@router.post("/api/offers/{offer_id}/decline")
async def decline(
    offer_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    o, nobody_left = await staffing.decline_offer(db, current_user, offer_id)
    if nobody_left:
        await notify_events.offer_nobody(o.id)
        await activity.for_shift("offer_nobody", o.shift_id, current_user.id, "No one accepted the offer for {what}")   # Phase 29.1
    return {"detail": "Declined. Thanks for letting them know."}
