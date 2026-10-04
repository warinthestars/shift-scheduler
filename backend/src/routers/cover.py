"""
Phase 34: Cover requests ("I need cover") and waitlists for full positions.
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, CoverRequest, ShiftRequest
from src.schemas import (
    CoverPostBody, CoverPostResult, CoverListing, CoverMine, CoverTakeResult,
    WaitlistJoinBody, WaitlistMine, WaitlistActionResult,
)
from src.auth import get_current_user, require_worker
from src.services import cover as cover_svc
from src.services import waitlist
from src.services import notify_cover
from src.services import activity

router = APIRouter(prefix="/api", tags=["Cover & waitlists"])


# ------------------------------------------------------------------------------------------------
# Cover requests
# ------------------------------------------------------------------------------------------------
@router.post("/cover", response_model=CoverPostResult, status_code=status.HTTP_201_CREATED)
async def post_cover_request(
    body: CoverPostBody,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Ask your venue team (and optionally the public shift board) to take one of your booked shifts.
    You stay booked until someone takes it."""
    cover_id = await cover_svc.post_cover(db, current_user, body.request_id, body.audience, body.note)
    await notify_cover.cover_posted(cover_id)
    await activity.for_request("cover_requested", body.request_id, current_user.id,
                               "team + public board" if body.audience == "public" else "team only")
    return CoverPostResult(
        cover_id=cover_id,
        message="Cover request posted. You're still on this shift until someone takes it.",
    )


@router.post("/cover/{cover_id}/cancel", response_model=CoverPostResult)
async def cancel_cover_request(
    cover_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Take your cover request down (only while nobody has taken it)."""
    await cover_svc.cancel_cover(db, current_user, cover_id)
    return CoverPostResult(cover_id=cover_id, message="Cover request cancelled. You're keeping this shift.")


@router.get("/cover/open", response_model=List[CoverListing])
async def list_open_cover(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Shifts that need cover and that you can see: your teams' posts, plus public posts."""
    return await cover_svc.open_for(db, current_user)


@router.get("/cover/mine", response_model=List[CoverMine])
async def list_my_cover(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Your live cover requests (open, or taken and waiting for the manager)."""
    return await cover_svc.mine(db, current_user)


@router.post("/cover/{cover_id}/take", response_model=CoverTakeResult)
async def take_cover_request(
    cover_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Take a shift that needs cover. Same rules as a normal request at that venue:
    instant booking swaps it now; otherwise the manager approves it in their hand-off queue."""
    result, _transfer_id = await cover_svc.take_cover(db, current_user, cover_id)
    await notify_cover.cover_taken(cover_id)
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
    request_id = None
    if result == "covered":
        request_id = await db.scalar(select(ShiftRequest.id).where(
            ShiftRequest.shift_id == cover.shift_id, ShiftRequest.worker_id == current_user.id))
        await activity.for_request("cover_taken", request_id, current_user.id, "no approval needed")
        message = "You're booked! It's in My shifts."
    else:
        await activity.for_request("cover_pending", cover.request_id, current_user.id,
                                   f"{current_user.first_name or 'Someone'} wants to take it")
        message = "Sent. The manager has to approve it. Until then it's still theirs."
    return CoverTakeResult(status=result, message=message, request_id=request_id)


# ------------------------------------------------------------------------------------------------
# Waitlists
# ------------------------------------------------------------------------------------------------
@router.post("/waitlist", response_model=WaitlistActionResult, status_code=status.HTTP_201_CREATED)
async def join_waitlist(
    body: WaitlistJoinBody,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Join a full position's waitlist. auto_book=true: we ask for the spot for you as soon as one opens."""
    entry_id = await waitlist.join(db, current_user, body.shift_id, body.auto_book)
    return WaitlistActionResult(
        status="waiting", entry_id=entry_id,
        message=("You're on the waitlist. If a spot opens we'll ask for it for you right away."
                 if body.auto_book else
                 "You're on the waitlist. If a spot opens we'll offer it to you first."),
    )


@router.get("/waitlist/mine", response_model=List[WaitlistMine])
async def my_waitlists(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Your places in line (waiting, or offered a spot right now)."""
    return await waitlist.my_entries(db, current_user)


@router.post("/waitlist/{entry_id}/leave", response_model=WaitlistActionResult)
async def leave_waitlist(
    entry_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    shift_id = await waitlist.leave(db, current_user, entry_id)
    await waitlist.kick(shift_id)          # if they were holding an offer, the next person gets it
    return WaitlistActionResult(status="left", entry_id=entry_id, message="You left the waitlist.")


@router.post("/waitlist/{entry_id}/take", response_model=WaitlistActionResult)
async def take_waitlist_offer(
    entry_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Take the spot you were offered (the venue's usual rules apply)."""
    result, request_id = await waitlist.take_offer(db, current_user, entry_id)
    return WaitlistActionResult(
        status=result, entry_id=entry_id, request_id=request_id,
        message="You're booked! It's in My shifts." if result == "booked" else "Request sent. The manager will review it.",
    )


@router.post("/waitlist/{entry_id}/pass", response_model=WaitlistActionResult)
async def pass_waitlist_offer(
    entry_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Turn down the spot. It goes to the next person in line."""
    shift_id = await waitlist.pass_offer(db, current_user, entry_id)
    await waitlist.kick(shift_id)
    return WaitlistActionResult(status="passed", entry_id=entry_id, message="Passed. The spot goes to the next person.")
