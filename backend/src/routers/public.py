"""
Phase 36: endpoints that need NO sign-in.
  GET /api/public/config                  what the web app needs before anyone signs in
  GET /api/public/board                   the public event board (404 unless PUBLIC_EVENT_BOARD is on)
  GET /api/public/calendar/{token}.ics    Phase 36.1: one person's private calendar link (404 unless CALENDAR_SYNC is on)

config and board may never return pay, addresses, notes, people's names or ids of anything but the event.
See services/public_board.py for exactly what is shown.

The calendar link is different: its long random token IS the sign-in, and it shows what its owner may see
(services/calendar_feeds.py decides, again each time a feed is built). It never returns pay either.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.models import CalendarFeed
from src.schemas import PublicBoard, PublicConfig
from src.services.calendar_feeds import FETCH_STAMP_EVERY, TOKEN_RE, etag_matches, feed_text
from src.services.public_board import DEFAULT_DAYS, MAX_DAYS, build_public_board

router = APIRouter(prefix="/api/public", tags=["Public"])


@router.get("/config", response_model=PublicConfig)
async def public_config():
    return PublicConfig(
        public_board=bool(settings.PUBLIC_EVENT_BOARD),
        self_registration=bool(settings.ALLOW_SELF_REGISTRATION),
    )


@router.get("/board", response_model=PublicBoard)
async def public_board(
    days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS, description="How far ahead to look"),
    db: AsyncSession = Depends(get_db),
):
    if not settings.PUBLIC_EVENT_BOARD:
        raise HTTPException(status_code=404, detail="The public board is turned off.")
    return await build_public_board(db, days)


@router.get("/calendar/{token}.ics", response_class=Response)
@router.head("/calendar/{token}.ics", include_in_schema=False)
async def calendar_feed(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Phase 36.1: the iCalendar feed behind a private calendar link. Calendar apps read this on their own."""
    missing = HTTPException(status_code=404, detail="This calendar link doesn't work any more.")
    if not settings.CALENDAR_SYNC or not TOKEN_RE.match(token or ""):
        raise missing
    feed = await db.scalar(select(CalendarFeed).where(CalendarFeed.token == token))
    if feed is None:
        raise missing
    feed_id, last = feed.id, feed.last_fetched_at
    body, etag = await feed_text(db, feed)

    now = datetime.now(timezone.utc)
    if last is None or now - (last if last.tzinfo else last.replace(tzinfo=timezone.utc)) > FETCH_STAMP_EVERY:
        try:
            # updated_at is set to itself so "last read" doesn't count as a change to the link.
            # Matching the token too means a link that was reset a moment ago isn't marked as read.
            await db.execute(update(CalendarFeed).where(CalendarFeed.id == feed_id, CalendarFeed.token == token)
                             .values(last_fetched_at=now, updated_at=CalendarFeed.updated_at))
            await db.commit()
        except Exception:
            await db.rollback()

    headers = {
        "ETag": etag,
        "Cache-Control": "private, no-cache",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Disposition": 'inline; filename="shiftup.ics"',
    }
    if etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    if request.method == "HEAD":
        headers["Content-Length"] = str(len(body.encode("utf-8")))     # what a GET would send
        return Response(content=b"", media_type="text/calendar; charset=utf-8", headers=headers)
    return Response(content=body, media_type="text/calendar; charset=utf-8", headers=headers)
