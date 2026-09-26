"""
Phase 29: Team invites.

Manager (venue's manager or platform admin):
  GET    /api/venues/{venue_id}/invites/link              the team link + QR code (created on first use)
  POST   /api/venues/{venue_id}/invites/link/regenerate   new link; the old one stops working
  GET    /api/venues/{venue_id}/invites                   personal invites
  POST   /api/venues/{venue_id}/invites                   invite people (form or CSV rows), optionally email/text now
  POST   /api/venues/{venue_id}/invites/{invite_id}/resend
  DELETE /api/venues/{venue_id}/invites/{invite_id}       revoke

Anyone with the link:
  GET    /api/invites/{token}                             public preview (no sign-in)
  POST   /api/invites/{token}/accept                      signed-in worker joins the team
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Venue, VenueInvite, VenueWhitelist
from src.schemas import (
    InviteLinkResponse, InviteBatchCreate, InviteBatchResult, InviteRowResult, PersonalInvite,
    PublicInvite, InviteAcceptResult,
)
from src.auth import require_manager_or_admin, get_current_user, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.services.invites import (
    get_or_create_link, regenerate_link, invite_url, qr_svg, invite_status, valid_email, new_token,
    send_invite, PERSONAL_DAYS, as_utc, public_base,
)
from src.services import activity
from src.services.messaging import email_available, normalize_phone
from src.services.team import set_membership
from src.services import notify_events

logger = logging.getLogger("shiftboard.invites")

router = APIRouter(tags=["Invites"])

MAX_ROWS = 200


def _person(u: User) -> str:
    name = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return name or u.email


def _clean_positions(values) -> List[str]:
    out = []
    for v in values or []:
        v = (v or "").strip()[:100]
        if v and v.lower() not in [o.lower() for o in out]:
            out.append(v)
    return out


def _link_response(inv: VenueInvite, base=None) -> InviteLinkResponse:
    url = invite_url(inv.token, base)
    return InviteLinkResponse(id=inv.id, token=inv.token, url=url, expires_at=inv.expires_at, uses=inv.uses or 0, qr_svg=qr_svg(url))


def _personal_response(inv: VenueInvite, accepted_name=None, base=None) -> PersonalInvite:
    return PersonalInvite(
        id=inv.id, first_name=inv.first_name, last_name=inv.last_name, email=inv.email, phone=inv.phone,
        positions=list(inv.positions or []), status=invite_status(inv), url=invite_url(inv.token, base),
        created_at=inv.created_at, expires_at=inv.expires_at, last_sent_at=inv.last_sent_at,
        accepted_at=inv.accepted_at, accepted_by_name=accepted_name,
    )


# ---------------------------------------------------------------------------------------------
# Manager: team link / QR
# ---------------------------------------------------------------------------------------------
@router.get("/api/venues/{venue_id}/invites/link", response_model=InviteLinkResponse)
async def get_team_link(
    request: Request,
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    try:
        inv = await get_or_create_link(db, venue_id, current_user.id)
        resp = _link_response(inv, public_base(request))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not load the team link: {e}")
    return resp


@router.post("/api/venues/{venue_id}/invites/link/regenerate", response_model=InviteLinkResponse)
async def regenerate_team_link(
    request: Request,
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    try:
        inv = await regenerate_link(db, venue_id, current_user.id)
        resp = _link_response(inv, public_base(request))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not make a new link: {e}")
    return resp


# ---------------------------------------------------------------------------------------------
# Manager: personal invites (form + CSV import)
# ---------------------------------------------------------------------------------------------
@router.get("/api/venues/{venue_id}/invites", response_model=List[PersonalInvite])
async def list_invites(
    request: Request,
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    rows = (await db.execute(
        select(VenueInvite)
        .where(VenueInvite.venue_id == venue_id, VenueInvite.kind == "personal")
        .order_by(VenueInvite.created_at.desc())
        .limit(500)
    )).scalars().all()
    acc_ids = {r.accepted_by_user_id for r in rows if r.accepted_by_user_id}
    names = {u.id: _person(u) for u in (await db.execute(select(User).where(User.id.in_(acc_ids)))).scalars().all()} if acc_ids else {}
    base = public_base(request)
    return [_personal_response(r, names.get(r.accepted_by_user_id), base) for r in rows]


@router.post("/api/venues/{venue_id}/invites", response_model=InviteBatchResult)
async def create_invites(
    request: Request,
    venue_id: UUID,
    body: InviteBatchCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    if not body.rows:
        raise HTTPException(status_code=400, detail="Add at least one person.")
    if len(body.rows) > MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"Up to {MAX_ROWS} people per upload.")
    now = datetime.now(timezone.utc)
    base = public_base(request)                     # Phase 29.1
    results: List[InviteRowResult] = []
    to_send: List[VenueInvite] = []
    seen = set()
    try:
        # Existing members and open invites, by email (lower-case)
        member_emails = set((await db.execute(
            select(func.lower(User.email))
            .join(VenueWhitelist, VenueWhitelist.worker_id == User.id)
            .where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.status == "active")
        )).scalars().all())
        open_invites = {}
        for inv in (await db.execute(
            select(VenueInvite).where(
                VenueInvite.venue_id == venue_id, VenueInvite.kind == "personal",
                VenueInvite.revoked_at.is_(None), VenueInvite.accepted_at.is_(None),
            )
        )).scalars().all():
            if inv.email and as_utc(inv.expires_at) > now:
                open_invites[inv.email.lower()] = inv

        for i, row in enumerate(body.rows, start=1):
            first = (row.first_name or "").strip()[:100]
            last = (row.last_name or "").strip()[:100]
            email = (row.email or "").strip().lower() or None
            phone = (row.phone or "").strip()[:30] or None
            name = f"{first} {last}".strip()
            if not email and not phone:
                results.append(InviteRowResult(row=i, name=name, result="invalid", message="Needs an email or a mobile number."))
                continue
            if email and not valid_email(email):
                results.append(InviteRowResult(row=i, name=name, email=email, result="invalid", message="Email doesn't look right."))
                continue
            if phone and not normalize_phone(phone):
                results.append(InviteRowResult(row=i, name=name, email=email, result="invalid", message="Mobile number doesn't look right."))
                continue
            key = email or phone
            if key in seen:
                results.append(InviteRowResult(row=i, name=name, email=email, result="invalid", message="Listed twice in this upload."))
                continue
            seen.add(key)
            if email and email in member_emails:
                results.append(InviteRowResult(row=i, name=name, email=email, result="already_member", message="Already on your team."))
                continue
            if email and email in open_invites:
                inv = open_invites[email]
                results.append(InviteRowResult(
                    row=i, name=name, email=email, result="already_invited",
                    message="Already invited; use Resend if they lost it.", invite_id=inv.id, url=invite_url(inv.token, base),
                ))
                continue
            inv = VenueInvite(
                venue_id=venue_id, token=new_token(), kind="personal", email=email, phone=phone,
                first_name=first or None, last_name=last or None, positions=_clean_positions(row.positions),
                created_by_user_id=current_user.id, expires_at=now + timedelta(days=PERSONAL_DAYS), created_at=now,
                last_sent_at=now if body.send else None,
            )
            db.add(inv)
            await db.flush()
            results.append(InviteRowResult(
                row=i, name=name, email=email, result="invited", message="Invited.", invite_id=inv.id, url=invite_url(inv.token, base),
            ))
            if body.send:
                to_send.append(inv)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("create_invites failed")
        raise HTTPException(status_code=500, detail=f"Could not create the invites: {e}")

    emailed = texted = 0
    if to_send:
        inviter = _person(current_user)
        sem = asyncio.Semaphore(5)

        async def _one(inv):
            async with sem:
                return await send_invite(inv, venue, inviter, base)
        for e_ok, t_ok in await asyncio.gather(*[_one(inv) for inv in to_send]):
            emailed += int(e_ok)
            texted += int(t_ok)

    invited = sum(1 for r in results if r.result == "invited")
    if invited:
        await activity.for_venue("invites_sent", venue_id, current_user.id,
                                 f"Invited {invited} {'person' if invited == 1 else 'people'}"
                                 + (" from a CSV file" if body.source == "import" else ""))   # Phase 29.1
    return InviteBatchResult(
        results=results, invited=invited, skipped=len(results) - invited,
        emailed=emailed, texted=texted, email_available=email_available(),
    )


async def _manager_invite(db: AsyncSession, venue_id: UUID, invite_id: UUID) -> VenueInvite:
    inv = await db.scalar(select(VenueInvite).where(VenueInvite.id == invite_id, VenueInvite.venue_id == venue_id))
    if inv is None or inv.kind != "personal":
        raise HTTPException(status_code=404, detail="Invite not found.")
    return inv


@router.post("/api/venues/{venue_id}/invites/{invite_id}/resend", response_model=PersonalInvite)
async def resend_invite(
    request: Request,
    venue_id: UUID,
    invite_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    inv = await _manager_invite(db, venue_id, invite_id)
    st = invite_status(inv)
    if st in ("accepted", "revoked"):
        raise HTTPException(status_code=400, detail=f"This invite was {st}.")
    now = datetime.now(timezone.utc)
    try:
        inv.expires_at = now + timedelta(days=PERSONAL_DAYS)
        inv.last_sent_at = now
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not resend: {e}")
    base = public_base(request)
    await send_invite(inv, venue, _person(current_user), base)
    return _personal_response(inv, None, base)


@router.delete("/api/venues/{venue_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    venue_id: UUID,
    invite_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    inv = await _manager_invite(db, venue_id, invite_id)
    try:
        if inv.revoked_at is None:
            inv.revoked_at = datetime.now(timezone.utc)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not revoke: {e}")
    return None


# ---------------------------------------------------------------------------------------------
# Public: preview + accept
# ---------------------------------------------------------------------------------------------
def _why_invalid(inv: VenueInvite) -> str:
    st = invite_status(inv)
    return {
        "revoked": "This invite link was turned off by the venue. Ask them for a new one.",
        "accepted": "This invite was already used.",
        "expired": "This invite has expired. Ask the venue for a new one.",
    }.get(st, "")


@router.get("/api/invites/{token}", response_model=PublicInvite)
async def preview_invite(token: str, db: AsyncSession = Depends(get_db)):
    inv = await db.scalar(select(VenueInvite).where(VenueInvite.token == token))
    if inv is None:
        return PublicInvite(valid=False, reason="This invite link isn't valid. Check you copied all of it.")
    venue = await db.scalar(select(Venue).where(Venue.id == inv.venue_id))
    if venue is None:
        return PublicInvite(valid=False, reason="This venue no longer exists.")
    reason = _why_invalid(inv)
    return PublicInvite(
        valid=not reason, reason=reason or None,
        venue_id=venue.id, venue_name=venue.name, venue_address=venue.address, logo_url=venue.logo_url,
        kind=inv.kind, first_name=inv.first_name if inv.kind == "personal" else None,
        email=inv.email if inv.kind == "personal" else None,
        positions=list(inv.positions or []), expires_at=inv.expires_at,
    )


@router.post("/api/invites/{token}/accept", response_model=InviteAcceptResult)
async def accept_invite(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if normalize_role(current_user.role) != "worker":
        raise HTTPException(status_code=400, detail="Invites are for worker accounts. Sign out and sign in (or sign up) as the worker.")
    inv = await db.scalar(select(VenueInvite).where(VenueInvite.token == token))
    if inv is None:
        raise HTTPException(status_code=404, detail="This invite link isn't valid.")
    venue = await db.scalar(select(Venue).where(Venue.id == inv.venue_id))
    if venue is None:
        raise HTTPException(status_code=404, detail="This venue no longer exists.")
    venue_id, venue_name = venue.id, venue.name

    row = await db.scalar(
        select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id == current_user.id)
    )
    if row is not None and row.status == "blocked":
        raise HTTPException(status_code=403, detail="You can't join this venue's team. Contact the venue if you think this is a mistake.")
    already = row is not None and row.status == "active"
    if already:
        return InviteAcceptResult(venue_id=venue_id, venue_name=venue_name, already_member=True)

    reason = _why_invalid(inv)
    if reason:
        raise HTTPException(status_code=400, detail=reason)
    now = datetime.now(timezone.utc)
    try:
        await set_membership(
            db, venue_id, current_user.id, status="active",
            source="invite", positions=list(inv.positions or []), added_by=inv.created_by_user_id,
        )
        inv.uses = (inv.uses or 0) + 1
        if inv.kind == "personal":
            inv.accepted_at = now
            inv.accepted_by_user_id = current_user.id
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not join the team: {e}")
    await notify_events.team_joined(venue_id, current_user.id)
    await activity.for_worker("team_joined", venue_id, current_user.id, current_user.id,
                              "{name} joined the team with " + ("a personal invite" if inv.kind == "personal" else "the team link"))   # Phase 29.1
    return InviteAcceptResult(venue_id=venue_id, venue_name=venue_name, already_member=False)
