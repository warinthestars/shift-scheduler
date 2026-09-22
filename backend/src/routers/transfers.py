from uuid import UUID
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import Shift, ShiftRequest, Venue, VenueManager, User, RequestStatus, ShiftTransfer
from src.schemas import (
    ShiftTransferCreate, ShiftTransferResponse, UserBrief
)
from src.auth import get_current_user, require_manager_or_admin, normalize_role
from src.services.auto_confirm import check_double_booking

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
            detail="You cannot transfer a shift to yourself."
        )

    # 1. Verify target worker exists
    to_worker = await db.scalar(select(User).where(User.id == transfer_in.to_worker_id))
    if not to_worker:
        raise HTTPException(status_code=404, detail="Target worker not found.")

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
            ShiftRequest.status.in_([
                RequestStatus.APPROVED, RequestStatus.CHECKED_IN,
                "APPROVED", "CHECKED_IN"
            ])
        )
    )
    if not ownership:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You do not hold a confirmed spot on this shift."
        )

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
            detail="A transfer request for this shift is already in progress."
        )

    # 5. Check if target worker is already booked for this slot
    await check_double_booking(
        db=db,
        worker_id=to_worker.id,
        start_time=shift.start_time,
        end_time=shift.end_time,
        exclude_shift_id=shift.id
    )

    # Create transfer record
    transfer = ShiftTransfer(
        shift_id=transfer_in.shift_id,
        from_worker_id=current_user.id,
        to_worker_id=transfer_in.to_worker_id,
        status="pending_worker_acceptance"
    )
    db.add(transfer)
    await db.commit()
    await db.refresh(transfer)

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

@router.post("/{id}/accept", response_model=ShiftTransferResponse)
async def accept_shift_transfer(
    id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Worker-to-Worker Transfer Step 2:
    The recipient worker accepts the proposed transfer.
    Status transitions from 'pending_worker_acceptance' to 'pending_manager_approval'.
    """
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
        raise HTTPException(status_code=404, detail="Transfer offer not found.")

    if transfer.to_worker_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the target worker can accept this transfer offer."
        )

    if transfer.status != "pending_worker_acceptance":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot accept transfer in '{transfer.status}' status."
        )

    # Double check double-booking before proceeding
    shift = transfer.shift
    await check_double_booking(
        db=db,
        worker_id=current_user.id,
        start_time=shift.start_time,
        end_time=shift.end_time,
        exclude_shift_id=shift.id
    )

    transfer.status = "pending_manager_approval"
    await db.commit()
    await db.refresh(transfer)
    return transfer

@router.post("/{id}/reject", response_model=ShiftTransferResponse)
async def reject_shift_transfer(
    id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Reject/Cancel a transfer: Can be rejected by the recipient worker, from_worker, or a venue manager.
    """
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
        raise HTTPException(status_code=404, detail="Transfer not found.")

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

    if current_user.id == transfer.to_worker_id:
        transfer.status = "rejected_by_worker"
    elif current_user.id == transfer.from_worker_id:
        transfer.status = "cancelled_by_sender"
    elif is_manager:
        transfer.status = "rejected_by_manager"
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to reject this transfer."
        )

    await db.commit()
    await db.refresh(transfer)
    return transfer

@router.post("/{id}/approve", response_model=ShiftTransferResponse)
async def approve_shift_transfer(
    id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Worker-to-Worker Transfer Step 3:
    Venue Manager gives final approval for the swap.
    Status transitions to 'approved'.
    Reassigns shift spot from from_worker to to_worker.
    """
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
        raise HTTPException(status_code=404, detail="Transfer not found.")

    if transfer.status != "pending_manager_approval":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transfer must be in 'pending_manager_approval' status (currently '{transfer.status}')."
        )

    # Verify current user manages this venue
    user_role = normalize_role(current_user.role)
    if user_role not in ("platform_admin", "super_admin"):
        mgr = await db.scalar(
            select(VenueManager).where(
                VenueManager.venue_id == transfer.shift.venue_id,
                VenueManager.user_id == current_user.id
            )
        )
        if not mgr:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not manage the venue for this shift."
            )

    shift = transfer.shift

    # Final double-booking check for recipient
    await check_double_booking(
        db=db,
        worker_id=transfer.to_worker_id,
        start_time=shift.start_time,
        end_time=shift.end_time,
        exclude_shift_id=shift.id
    )

    # 1. Update transfer status
    transfer.status = "approved"

    # 2. Modify original ShiftRequest from from_worker: mark REJECTED / delete
    orig_req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == transfer.shift_id,
            ShiftRequest.worker_id == transfer.from_worker_id
        )
    )
    if orig_req:
        await db.delete(orig_req)

    # 3. Create or update ShiftRequest for to_worker as APPROVED
    to_req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == transfer.shift_id,
            ShiftRequest.worker_id == transfer.to_worker_id
        )
    )
    if to_req:
        to_req.status = RequestStatus.APPROVED
        to_req.approval_source = "shift_transfer"
        to_req.approved_by_user_id = current_user.id
        to_req.approved_at = datetime.now(timezone.utc)
    else:
        new_req = ShiftRequest(
            shift_id=transfer.shift_id,
            worker_id=transfer.to_worker_id,
            status=RequestStatus.APPROVED,
            approval_source="shift_transfer",
            approved_by_user_id=current_user.id,
            approved_at=datetime.now(timezone.utc)
        )
        db.add(new_req)

    await db.commit()
    await db.refresh(transfer)
    return transfer

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
                detail="You are not authorized for this venue."
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
    """Get active workers eligible to receive a shift transfer"""
    res = await db.execute(
        select(User)
        .where(
            User.id != current_user.id,
            User.role == "worker",
            User.is_active == True
        )
        .order_by(User.first_name.asc())
    )
    return res.scalars().all()
