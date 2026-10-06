"""
Phase 36: the public event board (the home page for people who aren't signed in, when
PUBLIC_EVENT_BOARD is on).

It lists every published, upcoming, not-cancelled event of every venue that hasn't opted out
(venues.public_board), with the LEAST information that still lets someone decide to sign up:
event name, date and time, venue name, city, positions and open spots.
Never: pay, tips, the street address, map pin, location name, notes, requirements, logo, venue id,
or anyone's name. Those need a worker account.
"""
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, Venue, VenueLocation
from src.schemas import PublicBoard, PublicBoardEvent, PublicBoardPosition

MAX_DAYS = 90
DEFAULT_DAYS = 60
MAX_EVENTS = 300
CACHE_SECONDS = 15           # anyone on the internet can call this; don't hit the database every time

_STATE = re.compile(r"^(?P<city>.*?)[,\s]+(?P<state>[A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$")
_COUNTRY = ("usa", "us", "united states", "united states of america")
# words that mean "this is part of a street address, not a city" (allowed only as the first word: St. Louis)
_STREET_WORDS = {
    "st", "street", "ave", "avenue", "rd", "road", "blvd", "boulevard", "dr", "drive", "ln", "lane", "way",
    "hwy", "highway", "pkwy", "parkway", "plaza", "pl", "place", "ct", "court", "sq", "square", "pier",
    "suite", "ste", "unit", "floor", "fl", "bldg", "building", "apt", "room", "rm",
}
_cache = {}                  # days -> (expires_at, PublicBoard)


def clear_cache() -> None:
    _cache.clear()


def _clean_city(city: str, state: Optional[str] = None, typed: bool = False) -> Optional[str]:
    city = (city or "").strip(" ,")
    if not city or any(ch.isdigit() for ch in city) or len(city) > 60:
        return None                       # a number means it's (part of) a street address: show nothing
    if not typed:
        words = [w.strip(".").lower() for w in city.split()]
        if any(w in _STREET_WORDS for w in words[1:]) or (len(words) == 1 and words[0] in _STREET_WORDS):
            return None                   # 'Main St', 'One Harbor Plaza': not a city
    return f"{city}, {state.upper()}" if state else city


def city_from_address(address: Optional[str]) -> Optional[str]:
    """
    '123 Main St, Denver, CO 80202' -> 'Denver, CO'.  Works on US-style addresses with commas.
    Anything it can't read safely gives None: the board then shows no city at all, never the address.
    """
    parts = [p.strip() for p in (address or "").split(",") if p.strip()]
    if parts and parts[-1].lower() in _COUNTRY:
        parts = parts[:-1]
    if len(parts) < 2:
        return None
    last = parts[-1]
    # '..., Denver, CO 80202'
    m = re.match(r"^(?P<state>[A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$", last)
    if m:
        return _clean_city(parts[-2], m.group("state"))
    # '..., Denver CO 80202'
    m = _STATE.match(last)
    if m and m.group("city").strip():
        return _clean_city(m.group("city"), m.group("state"))
    return None


def venue_city(venue: Venue) -> Optional[str]:
    """The city the manager typed, else worked out from the address, else nothing."""
    typed = (venue.city or "").strip()
    if typed:
        return _clean_city(typed, typed=True)
    return city_from_address(venue.address)


async def build_public_board(db: AsyncSession, days: int = DEFAULT_DAYS) -> PublicBoard:
    days = max(1, min(int(days or DEFAULT_DAYS), MAX_DAYS))
    hit = _cache.get(days)
    if hit is not None and hit[0] > time.monotonic():
        return hit[1]

    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(ShiftEvent, Venue)
        .join(Venue, Venue.id == ShiftEvent.venue_id)
        .where(
            func.coalesce(ShiftEvent.status, "published") == "published",
            ShiftEvent.cancelled_at.is_(None),
            ShiftEvent.start_time > now,
            ShiftEvent.start_time <= now + timedelta(days=days),
            Venue.public_board == True,
        )
        .order_by(ShiftEvent.start_time.asc(), ShiftEvent.id.asc())
        .limit(MAX_EVENTS)
    )).all()

    out = []
    if rows:
        event_ids = [e.id for e, _v in rows]
        by_event = defaultdict(list)
        for s in (await db.execute(
            select(Shift)
            .where(Shift.event_id.in_(event_ids), func.upper(Shift.status) != "CANCELLED")
            .order_by(Shift.created_at.asc(), Shift.role_type.asc())
        )).scalars().all():
            by_event[s.event_id].append(s)
        loc_ids = {e.location_id for e, _v in rows if e.location_id}
        locations = {}
        if loc_ids:
            locations = {
                l.id: l for l in (await db.execute(select(VenueLocation).where(VenueLocation.id.in_(loc_ids)))).scalars().all()
            }
        for ev, venue in rows:
            spots = {}                    # position name -> open spots (same-named positions are added up)
            for s in by_event.get(ev.id, []):
                name = (s.role_type or "Worker").strip() or "Worker"
                left = max(0, int(s.capacity or 0) - int(s.spots_filled or 0))
                if (s.status or "").upper() != "OPEN":
                    left = 0
                spots[name] = spots.get(name, 0) + left
            if not spots:
                continue
            city = None
            loc = locations.get(ev.location_id) if ev.location_id else None
            if loc is not None:
                city = city_from_address(loc.address)     # an off-site event: that place's city, if it can be read
            city = city or venue_city(venue)
            total = sum(spots.values())
            out.append(PublicBoardEvent(
                event_id=ev.id,
                title=ev.title,
                start_time=ev.start_time,
                end_time=ev.end_time,
                timezone=venue.timezone or "America/New_York",
                venue_name=venue.name,
                city=city,
                positions=[PublicBoardPosition(name=n, open_spots=c) for n, c in spots.items()],
                open_spots=total,
                full=total == 0,
            ))

    board = PublicBoard(events=out, days=days, generated_at=now)
    _cache[days] = (time.monotonic() + CACHE_SECONDS, board)
    return board
