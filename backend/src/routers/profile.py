"""
Phase 31 + 32: Profile, availability, time off and certificates.

Worker (signed in, their own data):
  GET    /api/me/profile                              everything on the Profile page
  PUT    /api/me/profile                              name, phone (required for workers), bio, positions, emergency contact
  POST   /api/me/avatar            (multipart file)    upload a profile photo (JPG/PNG/WebP, max 2 MB)
  DELETE /api/me/avatar
  PUT    /api/me/availability                         replace the weekly windows ([] = not set)
  POST   /api/me/time-off                             ask for days off (goes to the managers of their team venues)
  POST   /api/me/time-off/{id}/cancel                 withdraw a pending request / cancel approved time off
  POST   /api/me/files             (multipart file)    upload a certificate scan (JPG/PNG/WebP/PDF, max 5 MB)
  PUT    /api/me/certifications/{cert_type}           add or update a certificate (changes reset verification)
  DELETE /api/me/certifications/{cert_type}

Files:
  GET    /api/files/avatar/{file_id}                  profile photos (public, like any avatar)
  GET    /api/files/{file_id}                         certificate scans: the owner, managers of venues they're connected to, admins

Managers:
  GET    /api/venues/{venue_id}/time-off?scope=pending|upcoming   the venue team's requests (with clashes at this venue)
  POST   /api/time-off/{id}/decide?venue_id=          approve / deny (any manager of one of the worker's team venues)
  POST   /api/venues/{venue_id}/people/{worker_id}/certifications/{cert_id}/review   verify / reject
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Response, status
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import (
    User, Venue, WorkerAvailability, TimeOffRequest, WorkerCertification, UserFile,
)
from src.schemas import (
    MyProfile, MyProfileUpdate, AvailabilityUpdate, AvailabilityWindow, TimeOffCreate, TimeOffItem,
    TimeOffDecision, CertificationUpsert, CertificationItem, CertReview, FileUploadResult,
)
from src.auth import get_current_user, require_manager_or_admin, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.services.fit import CERT_TYPES, parse_hm, cert_label
from src.services.messaging import normalize_phone
from src.services.team import get_venue_team
from src.services.profile import (
    build_my_profile, time_off_items, cert_items, team_venue_ids, related_venue_ids, managed_venue_ids,
    may_view_worker, read_upload, avatar_url, today_utc, full_name,
    IMAGE_TYPES, CERT_FILE_TYPES, MAX_AVATAR_BYTES, MAX_CERT_BYTES, MAX_WINDOWS, MAX_TIME_OFF_DAYS,
)
from src.services import notify_events, activity

logger = logging.getLogger("shiftboard.profile")

router = APIRouter(tags=["Profile"])


def _clean(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


# ---------------------------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------------------------
@router.get("/api/me/profile", response_model=MyProfile)
async def get_my_profile(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await build_my_profile(db, current_user)


@router.put("/api/me/profile", response_model=MyProfile)
async def update_my_profile(
    body: MyProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump(exclude_unset=True)
    is_worker = normalize_role(current_user.role) == "worker"
    if "first_name" in data and not _clean(data["first_name"]):
        raise HTTPException(status_code=400, detail="First name can't be empty.")
    if "phone" in data:
        raw = _clean(data["phone"])
        if raw is None:
            if is_worker:
                raise HTTPException(status_code=400, detail="A mobile number is required so venues can reach you and texts can work.")
        elif normalize_phone(raw) is None:
            raise HTTPException(status_code=400, detail="That phone number doesn't look right. Use 10 digits, or +country code.")
    if _clean(data.get("emergency_contact_phone")) and normalize_phone(data["emergency_contact_phone"]) is None:
        raise HTTPException(status_code=400, detail="The emergency contact's phone number doesn't look right.")
    try:
        for key in ("first_name", "last_name", "phone", "bio", "emergency_contact_name", "emergency_contact_phone"):
            if key in data:
                setattr(current_user, key, _clean(data[key]) if key not in ("first_name", "last_name") else (_clean(data[key]) or ""))
        if "skills" in data and data["skills"] is not None:
            seen, skills = set(), []
            for s in data["skills"]:
                s = (s or "").strip()[:50]
                if s and s.lower() not in seen:
                    seen.add(s.lower())
                    skills.append(s)
            current_user.skills = skills[:12]
        await db.commit()
        await db.refresh(current_user)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your profile: {e}")
    return await build_my_profile(db, current_user)


@router.post("/api/me/avatar", response_model=MyProfile)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = await read_upload(file, IMAGE_TYPES, MAX_AVATAR_BYTES)
    try:
        old = (await db.execute(
            select(UserFile.id).where(UserFile.owner_id == current_user.id, UserFile.kind == "avatar")
        )).scalars().all()
        f = UserFile(owner_id=current_user.id, kind="avatar", filename=(file.filename or "photo")[:255],
                     content_type=file.content_type.lower(), size_bytes=len(data), data=data,
                     created_at=datetime.now(timezone.utc))
        db.add(f)
        await db.flush()
        if old:
            await db.execute(delete(UserFile).where(UserFile.id.in_(old)))
        current_user.avatar_url = avatar_url(f.id)
        await db.commit()
        await db.refresh(current_user)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your photo: {e}")
    return await build_my_profile(db, current_user)


@router.delete("/api/me/avatar", response_model=MyProfile)
async def remove_avatar(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(delete(UserFile).where(UserFile.owner_id == current_user.id, UserFile.kind == "avatar"))
        current_user.avatar_url = None
        await db.commit()
        await db.refresh(current_user)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove your photo: {e}")
    return await build_my_profile(db, current_user)


# ---------------------------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------------------------
@router.put("/api/me/availability", response_model=List[AvailabilityWindow])
async def set_availability(
    body: AvailabilityUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if len(body.windows) > MAX_WINDOWS:
        raise HTTPException(status_code=400, detail=f"Up to {MAX_WINDOWS} time ranges, please.")
    clean = []
    for w in body.windows:
        try:
            sh, sm = parse_hm(w.start_local)
            eh, em = parse_hm(w.end_local)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if (sh, sm) == (24, 0):
            raise HTTPException(status_code=400, detail="A range can't start at 24:00.")
        if (sh, sm) == (eh, em):
            raise HTTPException(status_code=400, detail="Start and end can't be the same. For the whole day use 00:00 to 24:00.")
        key = (w.weekday, w.start_local, w.end_local)
        if key not in clean:
            clean.append(key)
    try:
        await db.execute(delete(WorkerAvailability).where(WorkerAvailability.worker_id == current_user.id))
        for d, a, b in clean:
            db.add(WorkerAvailability(worker_id=current_user.id, weekday=d, start_local=a, end_local=b,
                                      created_at=datetime.now(timezone.utc)))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your availability: {e}")
    return [AvailabilityWindow(weekday=d, start_local=a, end_local=b) for d, a, b in sorted(clean)]


# ---------------------------------------------------------------------------------------------
# Time off (worker)
# ---------------------------------------------------------------------------------------------
@router.post("/api/me/time-off", response_model=TimeOffItem, status_code=status.HTTP_201_CREATED)
async def request_time_off(
    body: TimeOffCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="The last day can't be before the first day.")
    if body.start_date < today_utc() - timedelta(days=1):
        raise HTTPException(status_code=400, detail="Time off has to start today or later.")
    if (body.end_date - body.start_date).days + 1 > MAX_TIME_OFF_DAYS:
        raise HTTPException(status_code=400, detail=f"Ask for up to {MAX_TIME_OFF_DAYS} days at a time.")
    overlap = await db.scalar(
        select(TimeOffRequest.id).where(
            TimeOffRequest.worker_id == current_user.id,
            TimeOffRequest.status.in_(("pending", "approved")),
            TimeOffRequest.start_date <= body.end_date,
            TimeOffRequest.end_date >= body.start_date,
        ).limit(1)
    )
    if overlap:
        raise HTTPException(status_code=409, detail="You already asked for time off on some of these days.")
    try:
        now = datetime.now(timezone.utc)
        t = TimeOffRequest(worker_id=current_user.id, start_date=body.start_date, end_date=body.end_date,
                           reason=_clean(body.reason), status="pending", created_at=now, updated_at=now)
        db.add(t)
        await db.commit()
        await db.refresh(t)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not send your request: {e}")
    await notify_events.time_off_requested(t.id)
    await activity.for_time_off("time_off_requested", t.id, current_user.id)
    return (await time_off_items(db, [t]))[0]


@router.post("/api/me/time-off/{time_off_id}/cancel", response_model=TimeOffItem)
async def cancel_time_off(
    time_off_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    t = await db.scalar(select(TimeOffRequest).where(TimeOffRequest.id == time_off_id, TimeOffRequest.worker_id == current_user.id))
    if t is None:
        raise HTTPException(status_code=404, detail="Request not found.")
    if t.status not in ("pending", "approved"):
        raise HTTPException(status_code=400, detail="This request is already closed.")
    if t.end_date < today_utc():
        raise HTTPException(status_code=400, detail="That time off is already over.")
    was = t.status
    try:
        t.status = "cancelled"
        t.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(t)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not cancel: {e}")
    if was == "approved":
        await activity.for_time_off("time_off_cancelled", t.id, current_user.id)
    return (await time_off_items(db, [t]))[0]


# ---------------------------------------------------------------------------------------------
# Time off (managers)
# ---------------------------------------------------------------------------------------------
@router.get("/api/venues/{venue_id}/time-off", response_model=List[TimeOffItem])
async def venue_time_off(
    venue_id: UUID,
    scope: str = Query("pending", pattern="^(pending|upcoming)$"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    team_ids = [u.id for u in await get_venue_team(db, venue_id)]
    if not team_ids:
        return []
    q = select(TimeOffRequest).where(TimeOffRequest.worker_id.in_(team_ids), TimeOffRequest.end_date >= today_utc())
    q = q.where(TimeOffRequest.status == "pending") if scope == "pending" else q.where(TimeOffRequest.status.in_(("pending", "approved")))
    rows = (await db.execute(q.order_by(TimeOffRequest.start_date.asc()))).scalars().all()
    return await time_off_items(db, list(rows), venue_id=venue_id)


@router.post("/api/time-off/{time_off_id}/decide", response_model=TimeOffItem)
async def decide_time_off(
    time_off_id: UUID,
    body: TimeOffDecision,
    venue_id: Optional[UUID] = Query(None, description="The venue the manager is deciding for (shown to the worker)"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    t = await db.scalar(select(TimeOffRequest).where(TimeOffRequest.id == time_off_id))
    if t is None:
        raise HTTPException(status_code=404, detail="Request not found.")
    team_venues = await team_venue_ids(db, t.worker_id)
    mine = await managed_venue_ids(db, current_user)
    allowed = team_venues if mine is None else (team_venues & mine)
    if not allowed and mine is not None:
        raise HTTPException(status_code=403, detail="This person isn't on the team at a venue you manage.")
    if venue_id is not None and allowed and venue_id not in allowed:
        raise HTTPException(status_code=403, detail="This person isn't on that venue's team.")
    if t.status != "pending":
        raise HTTPException(status_code=400, detail=f"This request was already {t.status}.")
    note = _clean(body.note)
    if not body.approve and not note:
        raise HTTPException(status_code=400, detail="Add a short note so they know why.")
    try:
        now = datetime.now(timezone.utc)
        t.status = "approved" if body.approve else "denied"
        t.decided_by_user_id = current_user.id
        t.decided_venue_id = venue_id or (sorted(allowed, key=str)[0] if allowed else None)
        t.decision_note = note
        t.decided_at = now
        t.updated_at = now
        await db.commit()
        await db.refresh(t)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save the decision: {e}")
    await notify_events.time_off_decided(t.id)
    await activity.for_time_off("time_off_approved" if body.approve else "time_off_denied", t.id, current_user.id,
                                venue_id=t.decided_venue_id)
    return (await time_off_items(db, [t], venue_id=t.decided_venue_id))[0]


# ---------------------------------------------------------------------------------------------
# Certificates
# ---------------------------------------------------------------------------------------------
@router.post("/api/me/files", response_model=FileUploadResult, status_code=status.HTTP_201_CREATED)
async def upload_cert_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = await read_upload(file, CERT_FILE_TYPES, MAX_CERT_BYTES)
    try:
        f = UserFile(owner_id=current_user.id, kind="certificate", filename=(file.filename or "certificate")[:255],
                     content_type=file.content_type.lower(), size_bytes=len(data), data=data,
                     created_at=datetime.now(timezone.utc))
        db.add(f)
        await db.commit()
        await db.refresh(f)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not upload: {e}")
    return FileUploadResult(id=f.id, url=f"/api/files/{f.id}", content_type=f.content_type, size_bytes=f.size_bytes)


@router.put("/api/me/certifications/{cert_type}", response_model=CertificationItem)
async def upsert_certification(
    cert_type: str,
    body: CertificationUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    info = CERT_TYPES.get(cert_type)
    if info is None:
        raise HTTPException(status_code=400, detail="Unknown certificate type.")
    if info["expires"] and body.expires_on is None:
        raise HTTPException(status_code=400, detail=f"Add the expiry date on your {info['label'].lower()}.")
    if body.issued_on and body.expires_on and body.expires_on < body.issued_on:
        raise HTTPException(status_code=400, detail="The expiry date can't be before the issue date.")
    if body.file_id is not None:
        owned = await db.scalar(select(UserFile.id).where(
            UserFile.id == body.file_id, UserFile.owner_id == current_user.id, UserFile.kind == "certificate"))
        if owned is None:
            raise HTTPException(status_code=400, detail="That upload wasn't found. Try attaching it again.")
    try:
        c = await db.scalar(select(WorkerCertification).where(
            WorkerCertification.worker_id == current_user.id, WorkerCertification.cert_type == cert_type))
        now = datetime.now(timezone.utc)
        if c is None:
            c = WorkerCertification(worker_id=current_user.id, cert_type=cert_type, status="unverified", created_at=now)
            db.add(c)
        old_file = c.file_id
        new_file = None if body.remove_file else (body.file_id or c.file_id)
        changed = (
            c.number != _clean(body.number) or c.issued_on != body.issued_on or c.expires_on != body.expires_on
            or c.file_id != new_file
        )
        c.number = _clean(body.number)
        c.issued_on = body.issued_on if info["expires"] else None
        c.expires_on = body.expires_on if info["expires"] else None
        c.file_id = new_file
        if changed:                                      # a new card has to be checked again
            c.status = "unverified"
            c.verified_by_user_id = None
            c.verified_venue_id = None
            c.verified_at = None
            c.review_note = None
        c.updated_at = now
        await db.flush()
        if old_file and old_file != new_file:
            await db.execute(delete(UserFile).where(UserFile.id == old_file, UserFile.owner_id == current_user.id))
        await db.commit()
        await db.refresh(c)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")
    return (await cert_items(db, [c]))[0]


@router.delete("/api/me/certifications/{cert_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_certification(
    cert_type: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    c = await db.scalar(select(WorkerCertification).where(
        WorkerCertification.worker_id == current_user.id, WorkerCertification.cert_type == cert_type))
    if c is None:
        raise HTTPException(status_code=404, detail="Not found.")
    try:
        file_id = c.file_id
        await db.execute(delete(WorkerCertification).where(WorkerCertification.id == c.id))
        if file_id:
            await db.execute(delete(UserFile).where(UserFile.id == file_id, UserFile.owner_id == current_user.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not delete: {e}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/venues/{venue_id}/people/{worker_id}/certifications/{cert_id}/review", response_model=CertificationItem)
async def review_certification(
    venue_id: UUID,
    worker_id: UUID,
    cert_id: UUID,
    body: CertReview,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    if body.status not in ("verified", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be verified or rejected.")
    if venue_id not in await related_venue_ids(db, worker_id):
        raise HTTPException(status_code=404, detail="Person not found.")
    c = await db.scalar(select(WorkerCertification).where(
        WorkerCertification.id == cert_id, WorkerCertification.worker_id == worker_id))
    if c is None:
        raise HTTPException(status_code=404, detail="Certificate not found.")
    note = _clean(body.note)
    if body.status == "rejected" and not note:
        raise HTTPException(status_code=400, detail="Say what's wrong so they can fix it.")
    try:
        c.status = body.status
        c.verified_by_user_id = current_user.id
        c.verified_venue_id = venue_id
        c.verified_at = datetime.now(timezone.utc)
        c.review_note = note
        await db.commit()
        await db.refresh(c)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")
    await notify_events.cert_reviewed(c.id)
    safe_note = (note or "").replace("{", "{{").replace("}", "}}")
    verb = "Verified" if body.status == "verified" else "Didn't accept"
    await activity.for_worker("cert_verified" if body.status == "verified" else "cert_rejected", venue_id, worker_id,
                              current_user.id, f"{verb} {{name}}'s {cert_label(c.cert_type).lower()}" + (f" · {safe_note}" if note else ""))
    return (await cert_items(db, [c]))[0]


# ---------------------------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------------------------
@router.get("/api/files/avatar/{file_id}")
async def get_avatar(file_id: UUID, db: AsyncSession = Depends(get_db)):
    f = await db.scalar(select(UserFile).where(UserFile.id == file_id, UserFile.kind == "avatar"))
    if f is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return Response(content=f.data, media_type=f.content_type, headers={"Cache-Control": "public, max-age=86400"})


@router.get("/api/files/{file_id}")
async def get_file(file_id: UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    f = await db.scalar(select(UserFile).where(UserFile.id == file_id))
    if f is None or not await may_view_worker(db, current_user, f.owner_id):
        raise HTTPException(status_code=404, detail="Not found.")
    safe = (f.filename or "file").replace('"', "")
    return Response(content=f.data, media_type=f.content_type,
                    headers={"Content-Disposition": f'inline; filename="{safe}"', "Cache-Control": "private, no-store"})
