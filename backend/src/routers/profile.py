"""
Phase 31 + 32: Profile, availability, time off and certificates.
Phase 32.1: time off is a BLOCK the worker sets (full / partial day, one-off / weekly / every other week).
No approval. Managers can't assign or offer shifts that overlap it.

Worker (signed in, their own data):
  GET    /api/me/profile                              everything on the Profile page
  PUT    /api/me/profile                              name, phone (required for workers), bio, positions, emergency contact
  POST   /api/me/avatar            (multipart file)    upload a profile photo (JPG/PNG/WebP, max 2 MB)
  DELETE /api/me/avatar
  PUT    /api/me/availability                         replace the weekly windows ([] = not set)
  POST   /api/me/time-off                             add a time-off block (returns it with any booked shifts it overlaps)
  PUT    /api/me/time-off/{id}                        change a block
  DELETE /api/me/time-off/{id}                        remove a block
  POST   /api/me/files             (multipart file)    upload a certificate scan (JPG/PNG/WebP/PDF, max 5 MB)
  PUT    /api/me/certifications/{cert_type}           add or update a certificate (changes reset verification)
  DELETE /api/me/certifications/{cert_type}

Files:
  GET    /api/files/avatar/{file_id}                  profile photos (public, like any avatar)
  GET    /api/files/{file_id}                         certificate scans: the owner, managers of venues they're connected to, admins

Managers:
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
    User, Venue, WorkerAvailability, TimeOffBlock, WorkerCertification, UserFile,
)
from src.schemas import (
    MyProfile, MyProfileUpdate, AvailabilityUpdate, AvailabilityWindow, TimeOffBlockInput, TimeOffBlockItem,
    CertificationUpsert, CertificationItem, CertReview, FileUploadResult,
)
from src.auth import get_current_user, require_manager_or_admin, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.services.fit import CERT_TYPES, parse_hm, cert_label
from src.services.messaging import normalize_phone
from src.services import time_off as blocks
from src.services.profile import (
    build_my_profile, block_items, cert_items, related_venue_ids,
    may_view_worker, read_upload, avatar_url, today_utc,
    IMAGE_TYPES, CERT_FILE_TYPES, MAX_AVATAR_BYTES, MAX_CERT_BYTES, MAX_WINDOWS,
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
# Time off blocks (Phase 32.1)
# ---------------------------------------------------------------------------------------------
async def _save_block(db: AsyncSession, user: User, body: TimeOffBlockInput, row: Optional[TimeOffBlock]) -> TimeOffBlock:
    try:
        end_date, start_local, end_local, weekdays = blocks.validate(
            all_day=body.all_day, start_date=body.start_date, end_date=body.end_date,
            start_local=body.start_local, end_local=body.end_local, repeat=body.repeat, weekdays=body.weekdays,
            today=today_utc(), is_new=row is None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if row is None:
        count = await db.scalar(select(func.count(TimeOffBlock.id)).where(TimeOffBlock.worker_id == user.id))
        if (count or 0) >= blocks.MAX_BLOCKS:
            raise HTTPException(status_code=400, detail=f"You can have up to {blocks.MAX_BLOCKS} time-off blocks. Remove some old ones first.")
    try:
        now = datetime.now(timezone.utc)
        if row is None:
            row = TimeOffBlock(worker_id=user.id, created_at=now)
            db.add(row)
        row.all_day = bool(body.all_day)
        row.start_date = body.start_date
        row.end_date = end_date
        row.start_local = start_local
        row.end_local = end_local
        row.repeat = body.repeat
        row.weekdays = weekdays
        row.reason = _clean(body.reason)
        row.private_note = _clean(body.private_note)
        row.updated_at = now
        await db.commit()
        await db.refresh(row)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save your time off: {e}")
    return row


@router.post("/api/me/time-off", response_model=TimeOffBlockItem, status_code=status.HTTP_201_CREATED)
async def add_time_off(
    body: TimeOffBlockInput,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await _save_block(db, current_user, body, None)
    await notify_events.time_off_conflicts(row.id)          # managers of venues where it overlaps a booked shift
    return (await block_items(db, [row], owner=True))[0]


@router.put("/api/me/time-off/{block_id}", response_model=TimeOffBlockItem)
async def update_time_off(
    block_id: UUID,
    body: TimeOffBlockInput,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.scalar(select(TimeOffBlock).where(TimeOffBlock.id == block_id, TimeOffBlock.worker_id == current_user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="Time off not found.")
    row = await _save_block(db, current_user, body, row)
    await notify_events.time_off_conflicts(row.id)
    return (await block_items(db, [row], owner=True))[0]


@router.delete("/api/me/time-off/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_time_off(
    block_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.scalar(select(TimeOffBlock).where(TimeOffBlock.id == block_id, TimeOffBlock.worker_id == current_user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="Time off not found.")
    try:
        await db.execute(delete(TimeOffBlock).where(TimeOffBlock.id == row.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove it: {e}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
