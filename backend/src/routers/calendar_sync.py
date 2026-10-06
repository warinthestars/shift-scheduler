"""
Phase 36.1: Calendar sync settings (Profile -> Calendar sync). Every account type.

  GET    /api/me/calendar-links               the calendars this person may connect, and the ones that are on
  POST   /api/me/calendar-links               turn one on (makes its private link)
  PUT    /api/me/calendar-links/{id}          what it includes
  POST   /api/me/calendar-links/{id}/reset    a new link; the old one stops working
  DELETE /api/me/calendar-links/{id}          turn it off

The feed itself (no sign-in, the token is the credential) is GET /api/public/calendar/{token}.ics in
routers/public.py. services/calendar_feeds.py decides who may have which calendar and what goes in it.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import get_current_user
from src.config import settings
from src.database import get_db
from src.models import CalendarFeed, CalendarKind, User
from src.schemas import CalendarLink, CalendarLinkCreate, CalendarLinks, CalendarLinkUpdate
from src.services.calendar_feeds import (
    ALL_OPTIONS, address_ok, clear_cache, lost_link, new_token, scope_key_for, scopes_for, to_link,
)
from src.services.invites import public_base

router = APIRouter(prefix="/api/me/calendar-links", tags=["Calendar sync"])

OFF = "Calendar sync is turned off on this site."
KINDS = tuple(k.value for k in CalendarKind)


def _require_on() -> None:
    if not settings.CALENDAR_SYNC:
        raise HTTPException(status_code=404, detail=OFF)


async def _own_feed(db: AsyncSession, user: User, feed_id: UUID) -> CalendarFeed:
    feed = await db.get(CalendarFeed, feed_id)
    if feed is None or feed.user_id != user.id:
        raise HTTPException(status_code=404, detail="That calendar link doesn't exist any more.")
    return feed


async def _scope_of(db: AsyncSession, user: User, scope_key: str):
    scope = next((s for s in await scopes_for(db, user) if s.scope_key == scope_key), None)
    if scope is None:
        raise HTTPException(status_code=403, detail="That calendar isn't available to your account.")
    return scope


@router.get("", response_model=CalendarLinks)
async def my_calendar_links(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.CALENDAR_SYNC:
        return CalendarLinks(enabled=False, public_address_ok=True, calendars=[])
    base = public_base(request)
    feeds = {f.scope_key: f for f in (await db.execute(
        select(CalendarFeed).where(CalendarFeed.user_id == current_user.id)
    )).scalars().all()}
    scopes = await scopes_for(db, current_user)
    calendars = [to_link(s, feeds.get(s.scope_key), base) for s in scopes]
    # links for calendars they can no longer have: still listed, so they can be turned off
    have = {s.scope_key for s in scopes}
    for key in sorted(k for k in feeds if k not in have):
        calendars.append(await lost_link(db, feeds[key]))
    return CalendarLinks(enabled=True, public_address_ok=address_ok(base), calendars=calendars)


@router.post("", response_model=CalendarLink, status_code=status.HTTP_201_CREATED)
async def turn_on_calendar_link(
    body: CalendarLinkCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_on()
    kind = (body.kind or "").strip().lower()
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail="Pick one of the calendars on the list.")
    key = scope_key_for(kind, body.venue_id, body.organization_id)
    if key is None:
        raise HTTPException(status_code=400, detail="Pick which venue or organization the calendar is for.")
    scope = await _scope_of(db, current_user, key)
    user_id = current_user.id

    existing = await db.scalar(select(CalendarFeed).where(CalendarFeed.user_id == user_id, CalendarFeed.scope_key == key))
    if existing is not None:
        return to_link(scope, existing, public_base(request))
    try:
        feed = CalendarFeed(
            user_id=user_id, kind=scope.kind, scope_key=scope.scope_key, venue_id=scope.venue_id,
            organization_id=scope.organization_id, token=new_token(),
        )
        db.add(feed)
        await db.commit()
        await db.refresh(feed)
    except IntegrityError:
        # two taps at once: the other one made it
        await db.rollback()
        feed = await db.scalar(select(CalendarFeed).where(CalendarFeed.user_id == user_id, CalendarFeed.scope_key == key))
        if feed is None:
            raise HTTPException(status_code=409, detail="Couldn't turn that calendar on. Try again.")
    except Exception:
        await db.rollback()
        raise
    return to_link(scope, feed, public_base(request))


@router.put("/{feed_id}", response_model=CalendarLink)
async def update_calendar_link(
    feed_id: UUID,
    body: CalendarLinkUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_on()
    feed = await _own_feed(db, current_user, feed_id)
    scope = await _scope_of(db, current_user, feed.scope_key)
    changes = body.model_dump(exclude_unset=True)
    try:
        for name in ALL_OPTIONS:
            if name in changes and changes[name] is not None and name in scope.options:
                setattr(feed, name, bool(changes[name]))
        feed.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(feed)
    except Exception:
        await db.rollback()
        raise
    clear_cache(feed.token)
    return to_link(scope, feed, public_base(request))


@router.post("/{feed_id}/reset", response_model=CalendarLink)
async def reset_calendar_link(
    feed_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A new private address. The old one stops working at once, wherever it was added."""
    _require_on()
    feed = await _own_feed(db, current_user, feed_id)
    scope = await _scope_of(db, current_user, feed.scope_key)
    old = feed.token
    try:
        feed.token = new_token()
        feed.last_fetched_at = None
        feed.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(feed)
    except Exception:
        await db.rollback()
        raise
    clear_cache(old)
    return to_link(scope, feed, public_base(request))


@router.delete("/{feed_id}", status_code=status.HTTP_204_NO_CONTENT)
async def turn_off_calendar_link(
    feed_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Works even when CALENDAR_SYNC is off, and for a calendar the person can no longer have."""
    feed = await _own_feed(db, current_user, feed_id)
    token = feed.token
    try:
        await db.delete(feed)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    clear_cache(token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
