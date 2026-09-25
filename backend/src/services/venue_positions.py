"""Phase 25: Default positions and venue field validation."""
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import VenuePosition

# (name, default_rate, tips_eligible, tip_pool)
DEFAULT_POSITIONS = [
    ("Bartender", 30.00, True, True),
    ("Server", 25.00, True, False),
    ("Barback", 22.00, True, True),
    ("Dishwasher", 20.00, False, False),
    ("AV Tech", 32.00, False, False),
]

VALID_APPROVAL_POLICIES = ("manual", "team_auto", "everyone_auto")
NOT_NULL_VENUE_FIELDS = ("name", "address", "lat", "lng", "geofence_radius_meters", "timezone", "approval_policy")
TEXT_VENUE_FIELDS = (
    "name", "address", "phone", "arrival_instructions", "dress_code",
    "default_shift_notes", "description", "logo_url", "timezone", "approval_policy",
)


async def ensure_default_positions(db: AsyncSession, venue_id) -> None:
    """Adds the starter positions if the venue has none. Caller commits."""
    existing = await db.scalar(select(func.count(VenuePosition.id)).where(VenuePosition.venue_id == venue_id))
    if existing:
        return
    for idx, (name, rate, tips, pool) in enumerate(DEFAULT_POSITIONS):
        db.add(VenuePosition(
            venue_id=venue_id, name=name, default_rate=rate,
            tips_eligible=tips, tip_pool=(tips and pool), sort_order=idx, is_active=True,
        ))


def clean_venue_payload(data: dict) -> dict:
    """Normalizes and validates venue fields in-place. Raises HTTPException(400) on bad input."""
    for key in NOT_NULL_VENUE_FIELDS:
        if key in data and data[key] is None:
            data.pop(key)

    for key in TEXT_VENUE_FIELDS:
        if key in data and isinstance(data[key], str):
            data[key] = data[key].strip()
            if data[key] == "" and key not in ("name", "address", "timezone", "approval_policy"):
                data[key] = None

    if "name" in data and not data["name"]:
        raise HTTPException(status_code=400, detail="Venue name can't be empty.")
    if "address" in data and not data["address"]:
        raise HTTPException(status_code=400, detail="Venue address can't be empty.")

    if "timezone" in data:
        try:
            ZoneInfo(data["timezone"])
        except Exception:
            raise HTTPException(status_code=400, detail=f"Unknown timezone '{data['timezone']}'.")

    if "approval_policy" in data and data["approval_policy"] not in VALID_APPROVAL_POLICIES:
        raise HTTPException(status_code=400, detail="Approval policy must be manual, team_auto, or everyone_auto.")

    if "lat" in data and not (-90 <= float(data["lat"]) <= 90):
        raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90.")
    if "lng" in data and not (-180 <= float(data["lng"]) <= 180):
        raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180.")
    if "geofence_radius_meters" in data and not (25 <= int(data["geofence_radius_meters"]) <= 5000):
        raise HTTPException(status_code=400, detail="Clock-in radius must be between 25 and 5000 meters.")
    if data.get("auto_approve_rating_threshold") is not None:
        t = float(data["auto_approve_rating_threshold"])
        if not (1.0 <= t <= 5.0):
            raise HTTPException(status_code=400, detail="Auto-approve rating must be between 1 and 5.")
    return data
