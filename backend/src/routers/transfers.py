from uuid import UUID
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import Shift, ShiftRequest, Venue, VenueManager, User, RequestStatus, ShiftTransfer
from src.schemas import (
    ShiftTransferCreate, ShiftTransferResponse, UserBrief,
    ShiftTransferRespond, ShiftTransferManagerReview
)
from src.auth import get_current_user, require_manager_or_admin, normalize_role, verify_venue_access
from src.services.auto_confirm import check_double_booking
from src.services.booking import withdraw_other_pending_in_event
from src.services import notify_events
from src.services import activity
from src.services.team import get_transfer_candidates
from src.services.booking import require_certs, refuse_if_blocked   # Phase 32 / 32.1
from src.services import cover as cover_svc                          # Phase 34

router = APIRouter(prefix="/api/transfers", tags=["Shift Transfers"])

@router.post("/propose", response_model=ShiftTransferResponse, status_code=status.HTTP_201_CREATED)
async def propose_shift_transfer(
    transfer_in: ShiftTransferCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Worker-to-Worker Transfer Step 1:
    The current assigned worker (from_worker) proposes to transfer their shift to a peer (to_worker).
    Status becomes 'pending_worker_acceptance'.
    """
    if transfer_in.to_worker_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can't hand a shift to yourself."
        )

    # 1. Verify target worker exists
    to_worker = await db.scalar(select(User).where(User.id == transfer_in.to_worker_id))
    if not to_worker:
        raise HTTPException(status_code=404, detail="We couldn't find that teammate.")

    # 2. Verify shift exists
    shift = await db.scalar(
        select(Shift)
        .options(selectinload(Shift.venue))
        .where(Shift.id == transfer_in.shift_id)
    )
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")

    # 3. Verify from_worker actually owns an approved request for this shift
    ownership = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == transfer_in.shift_id,
            ShiftRequest.worker_id == current_user.id,
            func.lower(ShiftRequest.status).in_([
                "approved", "checked_in", "confirmed"
            ])
        )
    )
    if not ownership:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You do not hold a confirmed spot on this shift."
        )
    # Phase 34: one way out at a time: a live cover request blocks a direct hand-off
    if await db.scalar(select(cover_svc.CoverRequest.id).where(
            cover_svc.CoverRequest.request_id == ownership.id, cover_svc.CoverRequest.status.in_(cover_svc.LIVE))):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You've asked for cover on this shift. Cancel the cover request first to hand it to someone directly."
        )

    # Phase 32: the teammate needs the position's certificates
    await require_certs(db, to_worker, shift, you=False, who=f"{to_worker.first_name or 'They'}".strip())
    await refuse_if_blocked(db, to_worker, shift, who=f"{to_worker.first_name or 'They'}".strip())   # Phase 32.1

    # 4. Check if there's already an active transfer for this shift
    existing_active = await db.scalar(
        select(ShiftTransfer).where(
            ShiftTransfer.shift_id == transfer_in.shift_id,
            ShiftTransfer.from_worker_id == current_user.id,
            ShiftTransfer.status.in_(["pending_worker_acceptance", "pending_manager_approval"])
        )
    )
    if existing_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You've already sent a hand-off for this shift. Withdraw it first to pick someone else."
        )

    # 5. Check if target worker is already booked for this slot
    await check_double_booking(
        db=db,
        worker_id=to_worker.id,
        start_time=shift.start_time,
        end_time=shift.end_time,
        exclude_shift_id=shift.id
    )

    # 6. Phase 24: target must be on this venue's team and free
    candidates = await get_transfer_candidates(db, shift, exclude_user_id=current_user.id)
    if to_worker.id not in {c.id for c in candidates}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can only hand this shift to someone on this venue's team who is free at that time."
        )

    # Create transfer record
    transfer = ShiftTransfer(
        shift_id=transfer_in.shift_id,
        from_worker_id=current_user.id,
        to_worker_id=transfer_in.to_worker_id,
        notes=getattr(transfer_in, "notes", None),
        status="pending_worker_acceptance"
    )
    db.add(transfer)
    await db.commit()
    await db.refresh(transfer)
    await notify_events.transfer_changed(transfer.id)   # Phase 28: tell the person being offered the shift

    # Reload with relations
    res = await db.execute(
        select(ShiftTransfer)
        .options(
            selectinload(ShiftTransfer.shift).selectinload(Shift.venue),
            selectinload(ShiftTransfer.from_worker),
            selectinload(ShiftTransfer.to_worker)
        )
        .where(ShiftTransfer.id == transfer.id)
    )
    return res.scalar_one()

@router.post("/{transfer_id}/respond", response_model=ShiftTransferResponse)
async def respond_to_shift_transfer(
    transfer_id: UUID,
    body: ShiftTransferRespond,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 20: Worker response to transfer proposal ('accept' or 'decline').
    """
    res = await db.execute(
        select(ShiftTransfer)
        .options(
            selectinload(ShiftTransfer.shift).selectinload(Shift.venue),
            selectinload(ShiftTransfer.from_worker),
            selectinload(ShiftTransfer.to_worker)
        )
        .where(ShiftTransfer.id == transfer_id)
    )
    transfer = res.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="This hand-off is no longer available.")

    if transfer.to_worker_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This hand-off was sent to someone else."
        )

    action = body.action.lower().strip()
    if action == "accept":
        if transfer.status != "pending_worker_acceptance":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This hand-off is already settled."
            )
        shift = transfer.shift
        await check_double_booking(
            db=db,
            worker_id=current_user.id,
            start_time=shift.start_time,
            end_time=shift.end_time,
            exclude_shift_id=shift.id
        )
        transfer.status = "pending_manager_approval"
    elif action in ("decline", "reject"):
        transfer.status = "declined"
    else:
        raise HTTPException(status_code=400, detail="Something went wrong. Refresh the page and try again.")

    await db.commit()
    await db.refresh(transfer)
    await notify_events.transfer_changed(transfer.id)   # Phase 28 (after commit; never raises)
    return transfer

@router.post("/{id}/accept", response_model=ShiftTransferResponse)
async def accept_shift_transfer(
    id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Legacy route alias for accepting shift transfer"""
    return await respond_to_shift_transfer(
        transfer_id=id,
        body=ShiftTransferRespond(action="accept"),
        current_user=current_user,
        db=db
    )

@router.post("/{id}/reject", response_model=ShiftTransferResponse)
async def reject_shift_transfer(
    id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Reject/Cancel a transfer"""
    res = await db.execute(
        select(ShiftTransfer)
        .options(
            selectinload(ShiftTransfer.shift).selectinload(Shift.venue),
            selectinload(ShiftTransfer.from_worker),
            selectinload(ShiftTransfer.to_worker)
        )
        .where(ShiftTransfer.id == id)
    )
    transfer = res.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="This hand-off is no longer available.")

    user_role = normalize_role(current_user.role)
    is_manager = False
    if user_role in ("platform_admin", "super_admin"):
        is_manager = True
    elif user_role == "venue_manager":
        mgr = await db.scalar(
            select(VenueManager).where(
                VenueManager.venue_id == transfer.shift.venue_id,
                VenueManager.user_id == current_user.id
            )
        )
        is_manager = bool(mgr)

    # Phase 29.4: only a hand-off that's still waiting can be declined / withdrawn / denied
    if (transfer.status or "").lower() not in ("pending_worker_acceptance", "pending_manager_approval"):
        raise HTTPException(status_code=400, detail="This hand-off is already settled.")

    if current_user.id == transfer.to_worker_id:
        transfer.status = "declined"
    elif current_user.id == transfer.from_worker_id:
        transfer.status = "cancelled_by_sender"
    elif is_manager:
        transfer.status = "denied"
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can't change this hand-off."
        )
    await cover_svc.after_transfer_review(db, transfer)          # Phase 34: keep a cover post in step

    await db.commit()
    await db.refresh(transfer)
    await notify_events.transfer_changed(transfer.id)   # Phase 28 (after commit; never raises)
    return transfer

@router.post("/{transfer_id}/manager-review", response_model=ShiftTransferResponse)
async def manager_review_shift_transfer(
    transfer_id: UUID,
    body: ShiftTransferManagerReview,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 20: Venue Manager review of transfer ('approve' or 'deny').
    Uses verify_venue_access.
    """
    res = await db.execute(
        select(ShiftTransfer)
        .options(
            selectinload(ShiftTransfer.shift).selectinload(Shift.venue),
            selectinload(ShiftTransfer.from_worker),
            selectinload(ShiftTransfer.to_worker)
        )
        .where(ShiftTransfer.id == transfer_id)
    )
    transfer = res.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="This hand-off is no longer available.")

    # Uses verify_venue_access dependency logic
    await verify_venue_access(transfer.shift.venue_id, current_user, db)
    hand_names = (f"{transfer.from_worker.first_name if transfer.from_worker else 'Someone'} → "
                  f"{transfer.to_worker.first_name if transfer.to_worker else 'someone'}")   # Phase 29.1 (read before commit)

    action = body.action.lower().strip()
    # Phase 34: only a hand-off that's waiting for the manager can be approved or denied
    if (transfer.status or "").lower() != "pending_manager_approval":
        raise HTTPException(status_code=400, detail="This hand-off is already settled.")
    if action == "approve":
        shift = transfer.shift
        await cover_svc.check_before_approve(db, transfer)          # Phase 34: the original worker still holds it

        # Double check double-booking before proceeding
        await check_double_booking(
            db=db,
            worker_id=transfer.to_worker_id,
            start_time=shift.start_time,
            end_time=shift.end_time,
            exclude_shift_id=shift.id
        )

        # 1. Update transfer status
        transfer.status = "approved"

        # 2. Update original ShiftRequest for from_worker_id to status "transferred"
        orig_req = await db.scalar(
            select(ShiftRequest).where(
                ShiftRequest.shift_id == transfer.shift_id,
                ShiftRequest.worker_id == transfer.from_worker_id
            )
        )
        if orig_req:
            orig_req.status = "transferred"

        # 3. Create or update ShiftRequest for to_worker_id with status "approved", approval_source="transfer"
        to_req = await db.scalar(
            select(ShiftRequest).where(
                ShiftRequest.shift_id == transfer.shift_id,
                ShiftRequest.worker_id == transfer.to_worker_id
            )
        )
        if to_req:
            to_req.status = "approved"
            to_req.approval_source = "transfer"
            to_req.approved_by_user_id = current_user.id
            to_req.approved_at = datetime.now(timezone.utc)
        else:
            to_req = ShiftRequest(
                shift_id=transfer.shift_id,
                worker_id=transfer.to_worker_id,
                status="approved",
                approval_source="transfer",
                approved_by_user_id=current_user.id,
                approved_at=datetime.now(timezone.utc)
            )
            db.add(to_req)
        # Phase 26.1: the new holder's other waiting requests in this event are closed
        await withdraw_other_pending_in_event(
            db, transfer.to_worker_id, shift.event_id, shift.id,
            "Took over a handed-off shift for this event",
        )
    elif action in ("deny", "reject"):
        transfer.status = "denied"
    else:
        raise HTTPException(status_code=400, detail="Something went wrong. Refresh the page and try again.")
    await cover_svc.after_transfer_review(db, transfer)          # Phase 34: keep a cover post in step

    await db.commit()
    await db.refresh(transfer)
    await notify_events.transfer_changed(transfer.id)   # Phase 28 (after commit; never raises)
    # Phase 29.1: activity log
    await activity.for_shift(
        "transfer_approved" if transfer.status == "approved" else "transfer_denied", transfer.shift_id, current_user.id,
        ("Approved hand-off " if transfer.status == "approved" else "Denied hand-off ") + hand_names + " for {what}",
    )
    return transfer

@router.post("/{id}/approve", response_model=ShiftTransferResponse)
async def approve_shift_transfer(
    id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Legacy route alias for approving shift transfer"""
    return await manager_review_shift_transfer(
        transfer_id=id,
        body=ShiftTransferManagerReview(action="approve"),
        current_user=current_user,
        db=db
    )

@router.get("/my-incoming", response_model=List[ShiftTransferResponse])
async def get_my_incoming_transfers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Transfers proposed to the current worker that are pending acceptance"""
    res = await db.execute(
        select(ShiftTransfer)
        .options(
            selectinload(ShiftTransfer.shift).selectinload(Shift.venue),
            selectinload(ShiftTransfer.from_worker),
            selectinload(ShiftTransfer.to_worker)
        )
        .where(
            ShiftTransfer.to_worker_id == current_user.id,
            ShiftTransfer.status == "pending_worker_acceptance"
        )
        .order_by(ShiftTransfer.created_at.desc())
    )
    return res.scalars().all()

@router.get("/my-outgoing", response_model=List[ShiftTransferResponse])
async def get_my_outgoing_transfers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Transfers sent by the current worker"""
    res = await db.execute(
        select(ShiftTransfer)
        .options(
            selectinload(ShiftTransfer.shift).selectinload(Shift.venue),
            selectinload(ShiftTransfer.from_worker),
            selectinload(ShiftTransfer.to_worker)
        )
        .where(ShiftTransfer.from_worker_id == current_user.id)
        .order_by(ShiftTransfer.created_at.desc())
    )
    return res.scalars().all()

@router.get("/venue/{venue_id}/pending", response_model=List[ShiftTransferResponse])
async def get_venue_pending_transfers(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Transfers waiting for Venue Manager approval"""
    user_role = normalize_role(current_user.role)
    if user_role not in ("platform_admin", "super_admin"):
        mgr = await db.scalar(
            select(VenueManager).where(
                VenueManager.venue_id == venue_id,
                VenueManager.user_id == current_user.id
            )
        )
        if not mgr:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't manage this venue."
            )

    res = await db.execute(
        select(ShiftTransfer)
        .join(Shift, ShiftTransfer.shift_id == Shift.id)
        .options(
            selectinload(ShiftTransfer.shift).selectinload(Shift.venue),
            selectinload(ShiftTransfer.from_worker),
            selectinload(ShiftTransfer.to_worker)
        )
        .where(
            Shift.venue_id == venue_id,
            ShiftTransfer.status == "pending_manager_approval"
        )
        .order_by(ShiftTransfer.created_at.asc())
    )
    return res.scalars().all()

@router.get("/eligible-workers/{shift_id}", response_model=List[UserBrief])
async def get_eligible_transfer_workers(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 24: Venue team members who are free for this shift."""
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")
    return await get_transfer_candidates(db, shift, exclude_user_id=current_user.id)
