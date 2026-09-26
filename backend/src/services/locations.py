"""
Phase 27: Saved locations, "where is this event?", and geofence math.

* A venue keeps a list of saved locations (client sites, off-site rooms). Events point at one
  with shift_events.location_id; NULL means "at the venue's own address".
* New locations typed on the event form are saved to the list automatically.
* Edits are GLOBAL: every event using the location sees the change. Upcoming events get the
  26.2 "Updated" flag so booked workers have to tap "Got it".
* Geofence is opt-in: venue.geofence_enabled is the default, event.geofence_mode overrides.
"""
import math
from datetime import datetime, timezone
from typing import Optional, Dict, List

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import VenueLocation, ShiftEvent, Venue
from src.schemas import VenueLocationInput, VenueLocationUpdate, VenueLocationResponse, ListingLocation

GEOFENCE_MODES = ("venue_default", "on", "off")
RADIUS_MIN, RADIUS_MAX = 25, 5000


# ---------------------------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------------------------
def _clean(text: Optional[str]) -> Optional[str]:
    if text is None:
        return None
    text = str(text).strip()
    return text or None


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in meters."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def fmt_distance(meters: float) -> str:
    """US-friendly: '450 ft' under ~0.1 mi, otherwise '0.8 mi'."""
    if meters < 161:
        return f"{int(round(meters / 0.3048))} ft"
    return f"{meters / 1609.344:.1f} mi"


def validate_geofence_mode(mode: Optional[str]) -> str:
    m = (mode or "venue_default").lower()
    if m not in GEOFENCE_MODES:
        raise HTTPException(status_code=400, detail="Location check must be venue_default, on, or off.")
    return m


def geofence_on(event: Optional[ShiftEvent], venue: Venue) -> bool:
    mode = (getattr(event, "geofence_mode", None) or "venue_default").lower() if event is not None else "venue_default"
    if mode == "on":
        return True
    if mode == "off":
        return False
    return bool(venue.geofence_enabled)


def effective_place(venue: Venue, location: Optional[VenueLocation]) -> Dict:
    """Where the work happens: the saved location if set, otherwise the venue itself."""
    if location is not None:
        return {
            "name": location.name,
            "address": location.address,
            "lat": location.lat,
            "lng": location.lng,
            "radius": location.radius_meters or venue.geofence_radius_meters,
            "is_offsite": True,
        }
    return {
        "name": venue.name,
        "address": venue.address,
        "lat": venue.lat,
        "lng": venue.lng,
        "radius": venue.geofence_radius_meters,
        "is_offsite": False,
    }


def to_listing_location(location: Optional[VenueLocation]) -> Optional[ListingLocation]:
    if location is None:
        return None
    return ListingLocation(
        id=location.id,
        name=location.name,
        address=location.address,
        lat=location.lat,
        lng=location.lng,
        notes=location.notes,
    )


async def load_locations(db: AsyncSession, location_ids) -> Dict:
    ids = {i for i in location_ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(VenueLocation).where(VenueLocation.id.in_(ids)))).scalars().all()
    return {loc.id: loc for loc in rows}


def _validate_fields(name, address, lat, lng, radius) -> None:
    if name is not None and not name:
        raise HTTPException(status_code=400, detail="Give the location a name.")
    if address is not None and not address:
        raise HTTPException(status_code=400, detail="Add the location's address.")
    if (lat is None) != (lng is None):
        raise HTTPException(status_code=400, detail="Enter both latitude and longitude for the map pin, or neither.")
    if lat is not None and not (-90 <= float(lat) <= 90):
        raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90.")
    if lng is not None and not (-180 <= float(lng) <= 180):
        raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180.")
    if radius is not None and not (RADIUS_MIN <= int(radius) <= RADIUS_MAX):
        raise HTTPException(status_code=400, detail=f"Location radius must be between {RADIUS_MIN} and {RADIUS_MAX} meters.")


async def _name_taken(db: AsyncSession, venue_id, name: str, exclude_id=None) -> Optional[VenueLocation]:
    q = select(VenueLocation).where(
        VenueLocation.venue_id == venue_id,
        func.lower(VenueLocation.name) == name.lower(),
    )
    if exclude_id is not None:
        q = q.where(VenueLocation.id != exclude_id)
    return await db.scalar(q)


# ---------------------------------------------------------------------------------------------
# Create / update / archive (these do NOT commit; callers commit)
# ---------------------------------------------------------------------------------------------
async def create_location(db: AsyncSession, venue_id, data: VenueLocationInput) -> VenueLocation:
    name = _clean(data.name) or ""
    address = _clean(data.address) or ""
    _validate_fields(name, address, data.lat, data.lng, data.radius_meters)
    name = name[:255]
    existing = await _name_taken(db, venue_id, name)
    if existing is not None:
        hint = " (it's archived; bring it back under Venue Settings → Locations)" if existing.is_archived else ""
        raise HTTPException(
            status_code=400,
            detail=f"A saved location called “{existing.name}” already exists{hint}. Pick it from the list or use a different name.",
        )
    loc = VenueLocation(
        venue_id=venue_id,
        name=name,
        address=address,
        lat=float(data.lat) if data.lat is not None else None,
        lng=float(data.lng) if data.lng is not None else None,
        radius_meters=int(data.radius_meters) if data.radius_meters is not None else None,
        notes=_clean(data.notes),
        is_archived=False,
    )
    db.add(loc)
    await db.flush()
    return loc


async def update_location(db: AsyncSession, loc: VenueLocation, data: VenueLocationUpdate) -> List[str]:
    """Global edit. Returns the list of human-readable changes (empty = nothing changed)."""
    new_name = _clean(data.name) if data.name is not None else loc.name
    new_address = _clean(data.address) if data.address is not None else loc.address
    if data.clear_pin:
        new_lat, new_lng = None, None
    elif data.lat is not None or data.lng is not None:
        new_lat, new_lng = data.lat, data.lng
    else:
        new_lat, new_lng = loc.lat, loc.lng
    if data.clear_radius:
        new_radius = None
    elif data.radius_meters is not None:
        new_radius = data.radius_meters
    else:
        new_radius = loc.radius_meters
    new_notes = _clean(data.notes) if data.notes is not None else loc.notes

    _validate_fields(new_name or "", new_address or "", new_lat, new_lng, new_radius)
    if new_name != loc.name and await _name_taken(db, loc.venue_id, new_name, exclude_id=loc.id):
        raise HTTPException(status_code=400, detail=f"Another saved location is already called “{new_name}”.")

    changes = []
    if new_name != loc.name:
        changes.append(f"renamed to “{new_name}”")
    if new_address != loc.address:
        changes.append("address changed")
    if (new_lat, new_lng) != (loc.lat, loc.lng):
        changes.append("map pin moved" if new_lat is not None else "map pin removed")
    if new_radius != loc.radius_meters:
        changes.append("check-in radius changed")
    if new_notes != loc.notes:
        changes.append("location notes updated")

    loc.name = new_name[:255]
    loc.address = new_address
    loc.lat = float(new_lat) if new_lat is not None else None
    loc.lng = float(new_lng) if new_lng is not None else None
    loc.radius_meters = int(new_radius) if new_radius is not None else None
    loc.notes = new_notes

    if changes:
        await _flag_upcoming_events(db, loc.id, "Location updated: " + ", ".join(changes))
    return changes


async def _flag_upcoming_events(db: AsyncSession, location_id, change_text: str) -> int:
    """Upcoming, not-cancelled events at this location get the 26.2 'Updated' flag."""
    now = datetime.now(timezone.utc)
    events = (await db.execute(
        select(ShiftEvent).where(
            ShiftEvent.location_id == location_id,
            ShiftEvent.cancelled_at.is_(None),
            ShiftEvent.end_time > now,
        )
    )).scalars().all()
    for ev in events:
        ev.info_updated_at = now
        ev.info_change = change_text
    return len(events)


async def usage_counts(db: AsyncSession, location_ids) -> Dict:
    """{location_id: (event_count, upcoming_count)}"""
    ids = [i for i in location_ids if i]
    if not ids:
        return {}
    now = datetime.now(timezone.utc)
    out = {i: (0, 0) for i in ids}
    for lid, total in (await db.execute(
        select(ShiftEvent.location_id, func.count(ShiftEvent.id))
        .where(ShiftEvent.location_id.in_(ids))
        .group_by(ShiftEvent.location_id)
    )).all():
        out[lid] = (int(total), out[lid][1])
    for lid, upcoming in (await db.execute(
        select(ShiftEvent.location_id, func.count(ShiftEvent.id))
        .where(
            ShiftEvent.location_id.in_(ids),
            ShiftEvent.cancelled_at.is_(None),
            ShiftEvent.end_time > now,
        )
        .group_by(ShiftEvent.location_id)
    )).all():
        out[lid] = (out[lid][0], int(upcoming))
    return out


def to_response(loc: VenueLocation, counts: Dict) -> VenueLocationResponse:
    total, upcoming = counts.get(loc.id, (0, 0))
    return VenueLocationResponse(
        id=loc.id,
        venue_id=loc.venue_id,
        name=loc.name,
        address=loc.address,
        lat=loc.lat,
        lng=loc.lng,
        radius_meters=loc.radius_meters,
        notes=loc.notes,
        is_archived=bool(loc.is_archived),
        event_count=total,
        upcoming_count=upcoming,
    )


async def resolve_event_location(
    db: AsyncSession,
    venue: Venue,
    location_id,
    new_location: Optional[VenueLocationInput],
    current_location_id=None,
) -> Optional[VenueLocation]:
    """
    Turns the event form's "Where" into a VenueLocation (or None = venue address).
    new_location wins over location_id and is saved to the list. An archived location can only
    stay on an event that already uses it.
    """
    if new_location is not None:
        return await create_location(db, venue.id, new_location)
    if not location_id:
        return None
    loc = await db.scalar(select(VenueLocation).where(VenueLocation.id == location_id))
    if loc is None or loc.venue_id != venue.id:
        raise HTTPException(status_code=400, detail="That location doesn't belong to this venue.")
    if loc.is_archived and location_id != current_location_id:
        raise HTTPException(status_code=400, detail=f"“{loc.name}” is archived. Bring it back under Venue Settings → Locations first.")
    return loc


def check_geofence_possible(mode: str, venue: Venue, location: Optional[VenueLocation]) -> None:
    """If the location check will be on, the place needs a map pin."""
    on = mode == "on" or (mode == "venue_default" and venue.geofence_enabled)
    if on and location is not None and (location.lat is None or location.lng is None):
        raise HTTPException(
            status_code=400,
            detail=f"“{location.name}” has no map pin, so the clock-in location check can't work there. "
                   "Add a pin to the location, or turn the location check off for this event.",
        )
