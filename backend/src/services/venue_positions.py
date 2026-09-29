"""Phase 25: Default positions and venue field validation."""
import re
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import VenuePosition
from src.services.departments import guess_department   # Phase 32.2

# (name, default_rate, tips_eligible, tip_pool)
DEFAULT_POSITIONS = [
    ("Bartender", 30.00, True, True),
    ("Server", 25.00, True, False),
    ("Barback", 22.00, True, True),
    ("Dishwasher", 20.00, False, False),
    ("AV Tech", 32.00, False, False),
]

VALID_APPROVAL_POLICIES = ("manual", "team_auto", "everyone_auto")
NOT_NULL_VENUE_FIELDS = (
    "name", "address", "lat", "lng", "geofence_radius_meters", "timezone", "approval_policy",
    "geofence_enabled", "geofence_buffer_meters", "clock_in_early_minutes", "auto_clock_out_hours",   # Phase 27
    "allow_public_cover",                                                                            # Phase 34
    "team_time_tracking", "work_week_start", "pay_period", "pay_period_approval",                    # Phase 35
    "tips_enabled", "tip_pool_split", "tip_pool_payroll", "tips_shown_to_workers",                   # Phase 35.2
)
VALID_TIP_SPLITS = ("hours", "equal")                                                                 # Phase 35.2
VALID_TIME_TRACKING = ("shiftboard", "payroll")                                                      # Phase 35
VALID_PAY_PERIODS = ("weekly", "biweekly", "semimonthly", "monthly")
TEXT_VENUE_FIELDS = (
    "name", "address", "phone", "arrival_instructions", "dress_code",
    "default_shift_notes", "description", "logo_url", "timezone", "approval_policy",
    "website_url",                                                                                   # Phase 34.6
)
WEBSITE_ERROR = "Enter the venue's web address, like www.yourvenue.com."
_HOST = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$", re.IGNORECASE)


def clean_website(value):
    """Phase 34.6: 'hippodrome.com' -> 'https://hippodrome.com'. Only http(s) links to a real-looking
    domain are kept (no javascript:, mailto:, IP-only or local addresses). None / '' -> None."""
    if value is None:
        return None
    url = str(value).strip()
    if not url:
        return None
    if any(ch.isspace() for ch in url):
        raise HTTPException(status_code=400, detail=WEBSITE_ERROR)
    if "://" not in url:
        if ":" in url.split("/")[0].split("?")[0] and not re.match(r"^[^:/]+:\d+", url):
            raise HTTPException(status_code=400, detail=WEBSITE_ERROR)      # e.g. javascript:alert(1), mailto:x
        url = "https://" + url
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").rstrip(".")
    except ValueError:
        raise HTTPException(status_code=400, detail=WEBSITE_ERROR)
    if parts.scheme.lower() not in ("http", "https") or not _HOST.match(host) or parts.username or parts.password:
        raise HTTPException(status_code=400, detail=WEBSITE_ERROR)
    if len(url) > 500:
        raise HTTPException(status_code=400, detail="That web address is too long (up to 500 characters).")
    return url


async def ensure_default_positions(db: AsyncSession, venue_id) -> None:
    """Adds the starter positions if the venue has none. Caller commits."""
    existing = await db.scalar(select(func.count(VenuePosition.id)).where(VenuePosition.venue_id == venue_id))
    if existing:
        return
    for idx, (name, rate, tips, pool) in enumerate(DEFAULT_POSITIONS):
        db.add(VenuePosition(
            venue_id=venue_id, name=name, default_rate=rate,
            tips_eligible=tips, tip_pool=(tips and pool), sort_order=idx, is_active=True,
            department=guess_department(name),
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
            raise HTTPException(status_code=400, detail="Pick a time zone from the list.")

    if "website_url" in data:                                                # Phase 34.6
        data["website_url"] = clean_website(data["website_url"])

    if "approval_policy" in data and data["approval_policy"] not in VALID_APPROVAL_POLICIES:
        raise HTTPException(status_code=400, detail="Choose how shift requests are approved.")

    if "lat" in data and not (-90 <= float(data["lat"]) <= 90):
        raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90.")
    if "lng" in data and not (-180 <= float(data["lng"]) <= 180):
        raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180.")
    if "geofence_radius_meters" in data and not (25 <= int(data["geofence_radius_meters"]) <= 5000):
        raise HTTPException(status_code=400, detail="Clock-in radius must be between 25 and 5000 meters.")
    # Phase 27: clock-in settings
    if "geofence_buffer_meters" in data and not (0 <= int(data["geofence_buffer_meters"]) <= 2000):
        raise HTTPException(status_code=400, detail="Extra distance allowed must be between 0 and 2000 meters.")
    if "clock_in_early_minutes" in data and not (0 <= int(data["clock_in_early_minutes"]) <= 240):
        raise HTTPException(status_code=400, detail="Early clock-in must be between 0 and 240 minutes.")
    if "auto_clock_out_hours" in data and not (1 <= int(data["auto_clock_out_hours"]) <= 12):
        raise HTTPException(status_code=400, detail="Auto clock-out must be between 1 and 12 hours after the shift ends.")
    # Phase 35: time tracking, overtime, pay periods
    if "team_time_tracking" in data and data["team_time_tracking"] not in VALID_TIME_TRACKING:
        raise HTTPException(status_code=400, detail="Choose how your team's time is tracked.")
    if data.get("ot_weekly_hours") is not None and not (1 <= float(data["ot_weekly_hours"]) <= 168):
        raise HTTPException(status_code=400, detail="Weekly overtime must start between 1 and 168 hours.")
    if data.get("ot_daily_hours") is not None and not (1 <= float(data["ot_daily_hours"]) <= 24):
        raise HTTPException(status_code=400, detail="Daily overtime must start between 1 and 24 hours.")
    if "work_week_start" in data and not (0 <= int(data["work_week_start"]) <= 6):
        raise HTTPException(status_code=400, detail="Pick the day your work week starts.")
    if "pay_period" in data and data["pay_period"] not in VALID_PAY_PERIODS:
        raise HTTPException(status_code=400, detail="Choose how often you pay: weekly, every two weeks, twice a month or monthly.")
    if "tip_pool_split" in data and data["tip_pool_split"] not in VALID_TIP_SPLITS:
        raise HTTPException(status_code=400, detail="Choose how tip pools are shared: by hours worked or equally.")
    if data.get("auto_approve_rating_threshold") is not None:
        t = float(data["auto_approve_rating_threshold"])
        if not (1.0 <= t <= 5.0):
            raise HTTPException(status_code=400, detail="Auto-approve rating must be between 1 and 5.")
    return data
