"""
Phase 36.1: Calendar sync by private link.

A person turns a calendar on in Profile -> Calendar sync and gets a private address (an iCalendar feed).
Google Calendar, Apple Calendar, Outlook and every other calendar app can subscribe to it. It is one-way:
the calendar app reads ShiftBoard; nothing a person does in their calendar app changes ShiftBoard.

Which calendars a person may have (scopes_for) follows their access:
  worker            "My shifts": their own shifts, tagged
                        [REQUESTED]  asked for, waiting on the venue
                        [Confirmed]  booked
                        [WAITLIST]   in line for a full position
                        [OFFERED]    offered to them, not answered yet
                    plus their own time off. Each of the last four can be switched off per link.
  shift lead        a venue calendar for each venue they lead (posted events only, never drafts)
  venue manager     "All my venues", one calendar per venue, one per organization they own
  platform admin    "Every venue", one calendar per venue, one per organization

Venue calendars have ONE entry per event ("Smith Wedding (6/8 filled)") with the positions and who is
booked in the details. Shifts that aren't part of an event are entries of their own.

Rules that must hold:
  * NO PAY, ever: no rate, tip, cost or earnings is written to a feed (a calendar entry gets copied to shared
    and work calendars). Staff-only notes are left out too; the entry links back to ShiftBoard.
  * The token in the address is the only credential. It is long and random, and "Reset link" replaces it.
  * Access is decided again every time a feed is built: a link for a venue the person no longer runs, or for an
    account that was turned off, gives an empty calendar. An unknown or replaced token gives 404 at once.
    A built feed is reused for up to CACHE_SECONDS, so losing access shows within a minute.
"""
import hashlib
import ipaddress
import re
import secrets
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote, urlsplit
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import normalize_role
from src.config import settings
from src.models import (
    CalendarFeed, CalendarKind, Organization, OrganizationMember, OrgRole, Shift, ShiftEvent, ShiftOffer, ShiftRequest,
    TimeOffBlock, User, Venue, VenueManager, VenueWhitelist, WaitlistEntry,
)
from src.schemas import CalendarLink
from src.services.booking import ASSIGNED_STATUSES, PENDING_STATUSES, as_utc
from src.services.locations import effective_place, load_locations
from src.services.messaging import absolute_link
from src.services.time_off import BlockSpec, applies_on, interval_on

TAG_REQUESTED = "[REQUESTED]"
TAG_CONFIRMED = "[Confirmed]"
TAG_WAITLIST = "[WAITLIST]"
TAG_OFFERED = "[OFFERED]"
TAG_DRAFT = "[DRAFT]"

PAST = timedelta(days=30)             # how far back a feed goes
FUTURE = timedelta(days=180)          # how far ahead
MAX_ENTRIES = 1500                    # shifts or events per feed (the admin calendar on a big site)
MAX_TIME_OFF = 400                    # time-off entries per feed, counted apart so they never push shifts out
CACHE_SECONDS = 60                    # a feed is built at most once a minute per link
CACHE_LINKS = 500                     # built feeds kept in memory
FETCH_STAMP_EVERY = timedelta(minutes=10)
DEFAULT_TZ = "America/New_York"

WORKER_OPTIONS = ["include_requested", "include_waitlist", "include_offers", "include_time_off"]
VENUE_OPTIONS = ["include_drafts"]
ALL_OPTIONS = WORKER_OPTIONS + VENUE_OPTIONS

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
_CACHE: Dict[str, Tuple[float, object, str, str]] = {}     # token -> (expires, link's updated_at, etag, body)


def clear_cache(token: Optional[str] = None) -> None:
    if token is None:
        _CACHE.clear()
    else:
        _CACHE.pop(token, None)


def new_token() -> str:
    return secrets.token_urlsafe(32)          # 43 URL-safe characters


# ------------------------------------------------------------------------------------------------
# Which calendars a person may have
# ------------------------------------------------------------------------------------------------
@dataclass
class Scope:
    kind: str
    scope_key: str
    name: str
    description: str
    venue_id: Optional[UUID] = None
    organization_id: Optional[UUID] = None
    shift_lead: bool = False
    venue_ids: Tuple = ()                # the venues a venue-type calendar covers

    @property
    def options(self) -> List[str]:
        if self.kind == CalendarKind.worker.value:
            return list(WORKER_OPTIONS)
        return [] if self.shift_lead else list(VENUE_OPTIONS)


def scope_key_for(kind: str, venue_id=None, organization_id=None) -> Optional[str]:
    if kind in (CalendarKind.worker.value, CalendarKind.manager.value, CalendarKind.admin.value):
        return kind
    if kind == CalendarKind.venue.value and venue_id:
        return f"venue:{venue_id}"
    if kind == CalendarKind.organization.value and organization_id:
        return f"organization:{organization_id}"
    return None


async def scopes_for(db: AsyncSession, user: User) -> List[Scope]:
    """Every calendar this person may have right now, in the order the settings page shows them."""
    if user is None or not user.is_active:
        return []
    role = normalize_role(user.role)
    out: List[Scope] = []

    if role == "worker":
        out.append(Scope(
            kind=CalendarKind.worker.value, scope_key="worker", name="My shifts",
            description="Your own shifts: confirmed, requested, waitlisted and offered, plus your time off.",
        ))
        lead_venues = (await db.execute(
            select(Venue).join(VenueWhitelist, VenueWhitelist.venue_id == Venue.id).where(
                VenueWhitelist.worker_id == user.id,
                VenueWhitelist.is_active == True,
                VenueWhitelist.is_lead == True,
            ).order_by(func.lower(Venue.name))
        )).scalars().all()
        for v in lead_venues:
            out.append(Scope(
                kind=CalendarKind.venue.value, scope_key=f"venue:{v.id}", name=v.name, venue_id=v.id, shift_lead=True,
                venue_ids=(v.id,), description="Every posted event at this venue, with who is booked. You're a shift lead here.",
            ))
        return out

    if role == "venue_manager":
        venues = (await db.execute(
            select(Venue).join(VenueManager, VenueManager.venue_id == Venue.id)
            .where(VenueManager.user_id == user.id).order_by(func.lower(Venue.name))
        )).scalars().all()
        orgs = (await db.execute(
            select(Organization).join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
            .where(OrganizationMember.user_id == user.id, OrganizationMember.role == OrgRole.owner.value)
            .order_by(func.lower(Organization.name))
        )).scalars().all()
        if venues:
            out.append(Scope(
                kind=CalendarKind.manager.value, scope_key="manager", name="All my venues",
                venue_ids=tuple(v.id for v in venues),
                description="Every event at every venue you manage, in one calendar.",
            ))
    elif role == "platform_admin":
        venues = (await db.execute(select(Venue).order_by(func.lower(Venue.name)))).scalars().all()
        orgs = (await db.execute(select(Organization).order_by(func.lower(Organization.name)))).scalars().all()
        out.append(Scope(
            kind=CalendarKind.admin.value, scope_key="admin", name="Every venue",
            venue_ids=tuple(v.id for v in venues),
            description="Every event at every venue on this site, in one calendar.",
        ))
    else:
        return out

    if orgs:
        org_venues = defaultdict(list)
        for vid, oid in (await db.execute(
            select(Venue.id, Venue.organization_id).where(Venue.organization_id.in_([o.id for o in orgs]))
        )).all():
            org_venues[oid].append(vid)
        for o in orgs:
            out.append(Scope(
                kind=CalendarKind.organization.value, scope_key=f"organization:{o.id}", name=o.name,
                organization_id=o.id, venue_ids=tuple(org_venues.get(o.id, [])),
                description="Every event at every venue in this organization, in one calendar.",
            ))
    for v in venues:
        out.append(Scope(
            kind=CalendarKind.venue.value, scope_key=f"venue:{v.id}", name=v.name, venue_id=v.id, venue_ids=(v.id,),
            description="Every event at this venue, with who is booked.",
        ))
    return out


# ------------------------------------------------------------------------------------------------
# Addresses
# ------------------------------------------------------------------------------------------------
def _host_is_public(host: Optional[str]) -> bool:
    host = (host or "").lower().strip("[]")
    if not host or host == "localhost" or host.endswith((".localhost", ".local", ".test", ".internal")):
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return "." in host                      # a name: needs a dot ("backend" is a Docker service, not a site)
    return ip.is_global


def address_ok(base: Optional[str]) -> bool:
    """Can Google / Outlook reach this site? (They read the feed from their own servers.)"""
    try:
        parts = urlsplit(base or "")
    except ValueError:
        return False
    return parts.scheme == "https" and _host_is_public(parts.hostname)


def app_link(path: str) -> str:
    """A link back into the web app for a calendar entry, or '' when APP_BASE_URL isn't a real address yet.
    (A feed is read by a calendar service, so there is no browser address to fall back on.)"""
    try:
        parts = urlsplit((settings.APP_BASE_URL or "").strip())
    except ValueError:
        return ""
    if parts.scheme not in ("http", "https") or not _host_is_public(parts.hostname):
        return ""
    return absolute_link(path)


def feed_urls(token: str, calendar_name: str, base: Optional[str]) -> Dict[str, str]:
    root = (base or settings.APP_BASE_URL or "").rstrip("/")
    url = f"{root}/api/public/calendar/{token}.ics"
    rest = url.split("://", 1)[1] if "://" in url else url.lstrip("/")
    webcal = f"webcal://{rest}"
    name = quote(f"ShiftBoard: {calendar_name}", safe="")
    return {
        "url": url,
        "webcal_url": webcal,
        "google_url": "https://calendar.google.com/calendar/render?cid=" + quote(webcal, safe=":/"),
        "outlook_url": f"https://outlook.live.com/calendar/0/addfromweb?url={quote(url, safe='')}&name={name}",
        "office_url": f"https://outlook.office.com/calendar/0/addfromweb?url={quote(url, safe='')}&name={name}",
    }


def to_link(scope: Scope, feed: Optional[CalendarFeed], base: Optional[str]) -> CalendarLink:
    item = CalendarLink(
        kind=scope.kind, scope_key=scope.scope_key, name=scope.name, description=scope.description,
        venue_id=scope.venue_id, organization_id=scope.organization_id, shift_lead=scope.shift_lead,
        options=scope.options,
    )
    if feed is None:
        return item
    urls = feed_urls(feed.token, scope.name, base)
    item.id = feed.id
    item.url, item.webcal_url = urls["url"], urls["webcal_url"]
    item.google_url, item.outlook_url, item.office_url = urls["google_url"], urls["outlook_url"], urls["office_url"]
    item.include_requested = bool(feed.include_requested)
    item.include_waitlist = bool(feed.include_waitlist)
    item.include_offers = bool(feed.include_offers)
    item.include_time_off = bool(feed.include_time_off)
    item.include_drafts = bool(feed.include_drafts) and not scope.shift_lead
    item.last_fetched_at = feed.last_fetched_at
    item.created_at = feed.created_at
    return item


async def lost_link(db: AsyncSession, feed: CalendarFeed) -> CalendarLink:
    """A link the person turned on for a calendar they can no longer have (they stopped managing or leading the
    venue, left the organization, or changed role). It shows an empty calendar; listing it lets them turn it off."""
    name = None
    if feed.venue_id is not None:
        name = await db.scalar(select(Venue.name).where(Venue.id == feed.venue_id))
    elif feed.organization_id is not None:
        name = await db.scalar(select(Organization.name).where(Organization.id == feed.organization_id))
    return CalendarLink(
        kind=feed.kind, scope_key=feed.scope_key, name=name or "A calendar you used to have", available=False,
        description="You no longer have access to this calendar, so its link shows an empty calendar. Turn it off, and remove it from your calendar app.",
        venue_id=feed.venue_id, organization_id=feed.organization_id, options=[], id=feed.id,
        include_drafts=False, last_fetched_at=feed.last_fetched_at, created_at=feed.created_at,
    )


# ------------------------------------------------------------------------------------------------
# iCalendar text (RFC 5545), written by hand: no new package
# ------------------------------------------------------------------------------------------------
@dataclass
class Entry:
    uid: str
    start: object                       # aware datetime, or a date when all_day
    end: object
    summary: str
    description: List[str] = field(default_factory=list)
    location: str = ""
    url: str = ""
    tentative: bool = False             # STATUS:TENTATIVE (not theirs yet)
    busy: bool = True                   # False = doesn't block the time (TRANSP:TRANSPARENT)
    modified: Optional[datetime] = None
    all_day: bool = False


# Control characters, and the Unicode line breaks some calendar apps treat as the end of a line
# (NEL, LINE SEPARATOR, PARAGRAPH SEPARATOR): a title must never be able to start a new property.
_CONTROL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]")


def ics_text(value) -> str:
    """Escape a text value: backslash, semicolon, comma, and line breaks."""
    s = _CONTROL.sub(" ", str(value or "").replace("\r\n", "\n").replace("\r", "\n"))
    s = s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    return s.replace("\n", "\\n")


def ics_fold(line: str) -> str:
    """Lines longer than 75 bytes continue on the next line after one space. Never splits a character."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, limit = [], 75
    while len(raw) > limit:
        cut = limit
        while cut > 0 and (raw[cut] & 0xC0) == 0x80:      # don't cut inside a multi-byte character
            cut -= 1
        parts.append(raw[:cut].decode("utf-8"))
        raw = raw[cut:]
        limit = 74                                        # the leading space counts on continuation lines
    parts.append(raw.decode("utf-8"))
    return "\r\n ".join(parts)


def ics_stamp(dt: datetime) -> str:
    return as_utc(dt).strftime("%Y%m%dT%H%M%SZ")


def render(calendar_name: str, description: str, entries: List[Entry]) -> str:
    epoch = datetime(2026, 1, 1, tzinfo=timezone.utc)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ShiftBoard//Calendar sync//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{ics_text(calendar_name)}",
        f"NAME:{ics_text(calendar_name)}",
        f"X-WR-CALDESC:{ics_text(description)}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for e in entries:
        stamp = ics_stamp(e.modified or epoch)
        lines += ["BEGIN:VEVENT", f"UID:{e.uid}", f"DTSTAMP:{stamp}", f"LAST-MODIFIED:{stamp}"]
        if e.all_day:
            lines += [f"DTSTART;VALUE=DATE:{e.start.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{e.end.strftime('%Y%m%d')}"]
        else:
            lines += [f"DTSTART:{ics_stamp(e.start)}", f"DTEND:{ics_stamp(e.end)}"]
        lines.append(f"SUMMARY:{ics_text(e.summary)}")
        if e.location:
            lines.append(f"LOCATION:{ics_text(e.location)}")
        body = "\n".join(x for x in e.description if x is not None)
        if body:
            lines.append(f"DESCRIPTION:{ics_text(body)}")
        if e.url:
            lines.append(f"URL:{e.url}")
        lines += [
            "STATUS:TENTATIVE" if e.tentative else "STATUS:CONFIRMED",
            "TRANSP:OPAQUE" if e.busy else "TRANSP:TRANSPARENT",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(ics_fold(x) for x in lines) + "\r\n"


# ------------------------------------------------------------------------------------------------
# Small helpers
# ------------------------------------------------------------------------------------------------
def _zone(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TZ)
    except Exception:
        return ZoneInfo(DEFAULT_TZ)


def _clock(dt: datetime) -> str:
    hour = dt.hour % 12 or 12
    return f"{hour}:{dt.minute:02d} {'AM' if dt.hour < 12 else 'PM'}"


def when_text(start: datetime, end: datetime, tz_name: Optional[str]) -> str:
    """'Sat, Oct 10, 4:00 PM to 11:00 PM EDT' in the venue's own time zone."""
    tz = _zone(tz_name)
    s, e = as_utc(start).astimezone(tz), as_utc(end).astimezone(tz)
    day = f"{s.strftime('%a')}, {s.strftime('%b')} {s.day}"
    tail = _clock(e) if e.date() == s.date() else f"{e.strftime('%a')} {_clock(e)}"
    return f"{day}, {_clock(s)} to {tail} {s.tzname() or ''}".strip()


def moment_text(at: Optional[datetime], tz_name: Optional[str]) -> str:
    """'Sat, Oct 10, 4:00 PM EDT' in the venue's own time zone ('' when there is no time)."""
    if at is None:
        return ""
    t = as_utc(at).astimezone(_zone(tz_name))
    return f"{t.strftime('%a')}, {t.strftime('%b')} {t.day}, {_clock(t)} {t.tzname() or ''}".strip()


def _person(u: Optional[User]) -> str:
    """A name for a roster line. Never an email address."""
    if u is None:
        return "Someone"
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or "Someone"


def _clean(text: Optional[str]) -> str:
    return (text or "").strip()


def _place(venue: Venue, location) -> str:
    p = effective_place(venue, location)
    name, address = _clean(p.get("name")), _clean(p.get("address"))
    if location is not None and name and venue.name and name != venue.name:
        name = f"{name} ({venue.name})"
    return ", ".join(x for x in (name, address) if x)


def _latest(*stamps) -> Optional[datetime]:
    real = [as_utc(s) for s in stamps if s is not None]
    return max(real) if real else None


def _shift_off(shift: Shift, event: Optional[ShiftEvent]) -> bool:
    """Cancelled, or part of an event that is cancelled or back in draft."""
    if (shift.status or "").upper() == "CANCELLED" or shift.cancelled_at is not None:
        return True
    if event is not None and (event.cancelled_at is not None or (event.status or "published").lower() == "draft"):
        return True
    return False


# ------------------------------------------------------------------------------------------------
# A worker's own calendar
# ------------------------------------------------------------------------------------------------
async def _home_zone(db: AsyncSession, user: User) -> ZoneInfo:
    """Time off is wall-clock time where the person works: the time zone most of their venues use."""
    rows = (await db.execute(
        select(Venue.timezone, func.count(Venue.id)).join(VenueWhitelist, VenueWhitelist.venue_id == Venue.id)
        .where(VenueWhitelist.worker_id == user.id, VenueWhitelist.is_active == True)
        .group_by(Venue.timezone)
    )).all()
    if not rows:
        rows = (await db.execute(
            select(Venue.timezone, func.count(ShiftRequest.id)).join(Shift, Shift.venue_id == Venue.id)
            .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
            .where(ShiftRequest.worker_id == user.id).group_by(Venue.timezone)
        )).all()
    best = sorted(rows, key=lambda r: (-int(r[1] or 0), r[0] or ""))
    return _zone(best[0][0] if best else None)


def _time_off_entries(blocks, tz: ZoneInfo, today: date) -> List[Entry]:
    first, last = today - PAST, today + FUTURE
    out: List[Entry] = []
    for row in blocks:
        b = BlockSpec.of(row)
        title = "Time off" + (f": {_clean(b.reason)}" if _clean(b.reason) else "")
        modified = _latest(row.updated_at, row.created_at)
        lo = max(first, b.start_date)
        if b.repeat == "none":
            hi = min(last, b.end_date or b.start_date)      # a one-off with no end date is that one day
        else:
            hi = min(last, b.end_date) if b.end_date is not None else last
        if hi < lo:
            continue
        if b.all_day and b.repeat == "none":
            # one entry for the whole run of days (the end date of an all-day entry is the day after)
            out.append(Entry(uid=f"timeoff-{row.id}@shiftboard", start=lo, end=hi + timedelta(days=1), summary=title,
                             description=["Time off you set in ShiftBoard."], all_day=True, modified=modified))
            continue
        d = lo
        while d <= hi:
            if applies_on(b, d):
                uid = f"timeoff-{row.id}-{d.strftime('%Y%m%d')}@shiftboard"
                if b.all_day:
                    out.append(Entry(uid=uid, start=d, end=d + timedelta(days=1), summary=title,
                                     description=["Time off you set in ShiftBoard."], all_day=True, modified=modified))
                else:
                    start, end = interval_on(b, d, tz)
                    if as_utc(end) > as_utc(start):         # the hour skipped when clocks go forward can leave nothing
                        out.append(Entry(uid=uid, start=start, end=end, summary=title,
                                         description=["Time off you set in ShiftBoard."], modified=modified))
            d += timedelta(days=1)
    # most useful first if there are too many: what's coming up, then the recent past
    out.sort(key=lambda e: (_day_of(e) < today, abs((_day_of(e) - today).days)))
    return out[:MAX_TIME_OFF]


def _day_of(e: "Entry") -> date:
    return e.start if e.all_day else as_utc(e.start).date()


async def worker_entries(db: AsyncSession, user: User, feed: CalendarFeed, now: datetime) -> List[Entry]:
    lo, hi = now - PAST, now + FUTURE
    statuses = ASSIGNED_STATUSES + (PENDING_STATUSES if feed.include_requested else ())
    req_rows = (await db.execute(
        select(ShiftRequest, Shift).join(Shift, ShiftRequest.shift_id == Shift.id).where(
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(statuses),
            Shift.start_time < hi, Shift.end_time > lo,
        ).order_by(Shift.start_time.asc()).limit(MAX_ENTRIES)
    )).all()
    wait_rows = []
    if feed.include_waitlist or feed.include_offers:
        wait_rows = (await db.execute(
            select(WaitlistEntry, Shift).join(Shift, Shift.id == WaitlistEntry.shift_id).where(
                WaitlistEntry.worker_id == user.id, WaitlistEntry.status.in_(("waiting", "offered")),
                Shift.start_time > now, Shift.start_time < hi,
            ).order_by(Shift.start_time.asc())
        )).all()
        # a spot that was held for them and has run out is no longer theirs (the waitlist engine closes it shortly)
        wait_rows = [(w, s) for w, s in wait_rows
                     if not (w.status == "offered" and w.offer_expires_at is not None and as_utc(w.offer_expires_at) <= now)]
    offer_rows = []
    if feed.include_offers:
        offer_rows = (await db.execute(
            select(ShiftOffer, Shift).join(Shift, Shift.id == ShiftOffer.shift_id).where(
                ShiftOffer.worker_id == user.id, ShiftOffer.status == "pending", ShiftOffer.expires_at > now,
                func.upper(Shift.status) == "OPEN", Shift.end_time > now, Shift.start_time < hi,
            ).order_by(Shift.start_time.asc())
        )).all()

    shifts = [s for _, s in req_rows] + [s for _, s in wait_rows] + [s for _, s in offer_rows]
    events, venues, locations = {}, {}, {}
    if shifts:
        event_ids = {s.event_id for s in shifts if s.event_id}
        if event_ids:
            events = {e.id: e for e in (await db.execute(
                select(ShiftEvent).where(ShiftEvent.id.in_(event_ids)))).scalars().all()}
        venues = {v.id: v for v in (await db.execute(
            select(Venue).where(Venue.id.in_({s.venue_id for s in shifts})))).scalars().all()}
        locations = await load_locations(db, [e.location_id for e in events.values()])

    out: List[Entry] = []
    taken = set()        # one entry per shift: a request wins over an offer, an offer over the waitlist

    def base(shift: Shift, tag: str, uid: str, lines: List[str], link: str, booked: bool, stamps) -> Optional[Entry]:
        venue = venues.get(shift.venue_id)
        event = events.get(shift.event_id) if shift.event_id else None
        if venue is None or _shift_off(shift, event) or shift.id in taken:
            return None
        taken.add(shift.id)
        location = locations.get(event.location_id) if event is not None and event.location_id else None
        role = _clean(shift.role_type) or "Shift"
        title = _clean(event.title if event is not None else shift.title) or role
        summary = f"{tag} {title}" + (f" ({role})" if role.lower() != title.lower() else "")
        body = list(lines)
        if event is not None:
            body.append(f"Event: {_clean(event.title)}")
        body += [f"Position: {role}", f"Venue: {venue.name}",
                 f"When: {when_text(shift.start_time, shift.end_time, venue.timezone)} (venue time)"]
        if _clean(venue.dress_code):
            body.append(f"Dress code: {_clean(venue.dress_code)}")
        if booked and _clean(venue.arrival_instructions):
            body.append(f"Arriving: {_clean(venue.arrival_instructions)}")
        for label, text in (("Event notes", event.notes if event is not None else None), ("Position notes", shift.description)):
            if _clean(text):
                body.append(f"{label}: {_clean(text)}")
        url = app_link(link)
        body.append("")
        if url:
            body.append(f"Open in ShiftBoard: {url}")
        body.append("Pay and staff-only notes are in ShiftBoard, not in this calendar.")
        return Entry(
            uid=uid, start=shift.start_time, end=shift.end_time, summary=summary, description=body,
            location=_place(venue, location), url=url, tentative=not booked, busy=booked,
            modified=_latest(shift.updated_at, venue.updated_at, event.updated_at if event is not None else None,
                             location.updated_at if location is not None else None, *stamps),
        )

    for req, s in req_rows:
        booked = (req.status or "").lower() in ASSIGNED_STATUSES
        entry = base(
            s, TAG_CONFIRMED if booked else TAG_REQUESTED, f"request-{req.id}@shiftboard",
            ["Confirmed: you're booked on this shift." if booked
             else "Requested: waiting for the venue to confirm. This isn't your shift yet."],
            f"/worker?tab=calendar&request={req.id}", booked, (req.updated_at,),
        )
        if entry:
            out.append(entry)

    def zone_of(shift: Shift) -> Optional[str]:
        venue = venues.get(shift.venue_id)
        return venue.timezone if venue is not None else None

    held = [(w, s) for w, s in wait_rows if w.status == "offered"]
    for w, s in held:
        if feed.include_offers:
            until = moment_text(w.offer_expires_at, zone_of(s))
            entry = base(s, TAG_OFFERED, f"waitlist-{w.id}@shiftboard",
                         ["Offered: a spot opened and it's being held for you" + (f" until {until}" if until else "")
                          + ". Answer in ShiftBoard. This isn't your shift yet."],
                         "/worker?tab=schedule", False, (w.updated_at,))
            if entry:
                out.append(entry)

    for o, s in offer_rows:
        if (s.spots_filled or 0) >= (s.capacity or 1):
            continue
        venue = venues.get(s.venue_id)
        entry = base(s, TAG_OFFERED, f"offer-{o.id}@shiftboard",
                     [f"Offered: {venue.name if venue is not None else 'The venue'} offered you this shift. "
                      f"Answer in ShiftBoard by {moment_text(o.expires_at, zone_of(s))}. This isn't your shift yet."],
                     "/worker?tab=find", False, (o.created_at,))
        if entry:
            out.append(entry)

    # still in line: waiting, or a held spot when offers are switched off for this link
    for w, s in wait_rows:
        if feed.include_waitlist:
            entry = base(s, TAG_WAITLIST, f"waitlist-{w.id}@shiftboard",
                         ["Waitlist: you're in line for this position. This isn't your shift yet."],
                         "/worker?tab=schedule", False, (w.updated_at,))
            if entry:
                out.append(entry)

    if feed.include_time_off:
        blocks = (await db.execute(
            select(TimeOffBlock).where(TimeOffBlock.worker_id == user.id).order_by(TimeOffBlock.start_date.asc())
        )).scalars().all()
        if blocks:
            tz = await _home_zone(db, user)
            out += _time_off_entries(blocks, tz, now.astimezone(tz).date())      # capped on its own (MAX_TIME_OFF)

    out.sort(key=lambda e: (e.start.isoformat() if e.all_day else as_utc(e.start).strftime("%Y-%m-%dT%H:%M:%S"), e.uid))
    return out


# ------------------------------------------------------------------------------------------------
# Venue calendars (one venue, a manager's venues, an organization, every venue)
# ------------------------------------------------------------------------------------------------
async def venue_entries(
    db: AsyncSession, venue_ids, *, show_venue: bool, drafts: bool, lead: bool, now: datetime,
) -> List[Entry]:
    ids = list(venue_ids or [])
    if not ids:
        return []
    lo, hi = now - PAST, now + FUTURE
    venues = {v.id: v for v in (await db.execute(select(Venue).where(Venue.id.in_(ids)))).scalars().all()}

    q = select(ShiftEvent).where(
        ShiftEvent.venue_id.in_(ids), ShiftEvent.cancelled_at.is_(None),
        ShiftEvent.start_time < hi, ShiftEvent.end_time > lo,
    )
    if not drafts or lead:
        q = q.where(func.lower(ShiftEvent.status) != "draft")
    events = (await db.execute(q.order_by(ShiftEvent.start_time.asc()).limit(MAX_ENTRIES))).scalars().all()
    event_ids = [e.id for e in events]

    live = (func.upper(Shift.status) != "CANCELLED", Shift.cancelled_at.is_(None))
    shifts = []
    if event_ids:
        shifts += (await db.execute(select(Shift).where(Shift.event_id.in_(event_ids), *live))).scalars().all()
    loose = (await db.execute(
        select(Shift).where(Shift.venue_id.in_(ids), Shift.event_id.is_(None), *live,
                            Shift.start_time < hi, Shift.end_time > lo)
        .order_by(Shift.start_time.asc()).limit(MAX_ENTRIES)
    )).scalars().all()
    shifts += loose

    booked = defaultdict(list)       # shift id -> [names]
    waiting = defaultdict(int)       # shift id -> requests not answered
    newest = {}                      # shift id -> latest change to its requests
    if shifts:
        for req, person in (await db.execute(
            select(ShiftRequest, User).join(User, User.id == ShiftRequest.worker_id).where(
                ShiftRequest.shift_id.in_([s.id for s in shifts]),
                func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES + PENDING_STATUSES),
            ).order_by(func.lower(User.first_name), func.lower(User.last_name))
        )).all():
            if (req.status or "").lower() in ASSIGNED_STATUSES:
                booked[req.shift_id].append(_person(person))
                newest[req.shift_id] = _latest(newest.get(req.shift_id), req.updated_at, person.updated_at)
            else:
                waiting[req.shift_id] += 1
                newest[req.shift_id] = _latest(newest.get(req.shift_id), req.updated_at)
    locations = await load_locations(db, [e.location_id for e in events])

    def staffing(group: List[Shift]) -> Tuple[int, int, int, List[str]]:
        by_role = {}
        for s in sorted(group, key=lambda x: (as_utc(x.start_time), (x.role_type or "").lower())):
            role = _clean(s.role_type) or "Shift"
            r = by_role.setdefault(role, {"cap": 0, "names": []})
            r["cap"] += s.capacity if s.capacity is not None else 1
            r["names"] += booked.get(s.id, [])
        cap = sum(r["cap"] for r in by_role.values())
        filled = sum(len(r["names"]) for r in by_role.values())
        asks = sum(waiting.get(s.id, 0) for s in group)
        lines = [f"{role} {len(r['names'])}/{r['cap']}" + (": " + ", ".join(r["names"]) if r["names"] else "")
                 for role, r in by_role.items()]
        return cap, filled, asks, lines

    def make(uid, title, start, end, venue, location, group, draft, link, notes, stamps) -> Entry:
        cap, filled, asks, role_lines = staffing(group)
        count = f"({filled}/{cap} filled)" if cap else "(no positions yet)"
        summary = " ".join(x for x in (TAG_DRAFT if draft else "", f"{venue.name}:" if show_venue else "", title, count) if x)
        body = [venue.name, f"{when_text(start, end, venue.timezone)} (venue time)"]
        if draft:
            body.append("Draft: not posted to staff yet.")
        if cap:
            open_spots = max(0, cap - filled)
            body.append(f"Staffing: {filled} of {cap} filled" + (f", {open_spots} open" if open_spots else ""))
            body += role_lines
        if asks:
            body.append(f"{asks} request{'s' if asks != 1 else ''} waiting for an answer")
        if _clean(notes):
            body.append(f"Notes: {_clean(notes)}")
        url = app_link(link)
        if url:
            body += ["", f"Open in ShiftBoard: {url}"]
        return Entry(
            uid=uid, start=start, end=end, summary=summary, description=body, location=_place(venue, location), url=url,
            tentative=draft, busy=False,
            modified=_latest(*stamps, venue.updated_at, location.updated_at if location is not None else None,
                             *(s.updated_at for s in group), *(newest.get(s.id) for s in group)),
        )

    by_event = defaultdict(list)
    for s in shifts:
        if s.event_id:
            by_event[s.event_id].append(s)

    out: List[Entry] = []
    for e in events:
        venue = venues.get(e.venue_id)
        if venue is None:
            continue
        link = "/lead" if lead else f"/venue?venue={e.venue_id}&event={e.id}"
        out.append(make(
            f"event-{e.id}@shiftboard", _clean(e.title) or "Event", e.start_time, e.end_time, venue,
            locations.get(e.location_id) if e.location_id else None, by_event.get(e.id, []),
            (e.status or "published").lower() == "draft", link, e.notes, (e.updated_at,),
        ))
    for s in loose:
        venue = venues.get(s.venue_id)
        if venue is None:
            continue
        role = _clean(s.role_type) or "Shift"
        title = _clean(s.title) or role
        link = "/lead" if lead else f"/venue?venue={s.venue_id}"
        out.append(make(f"shift-{s.id}@shiftboard", title, s.start_time, s.end_time, venue, None, [s], False, link,
                        s.description, ()))
    out.sort(key=lambda x: (as_utc(x.start), x.uid))
    return out[:MAX_ENTRIES]


# ------------------------------------------------------------------------------------------------
# One feed
# ------------------------------------------------------------------------------------------------
async def build_feed(db: AsyncSession, feed: CalendarFeed, now: Optional[datetime] = None) -> str:
    """The calendar text for one link. Access is worked out again here, every time."""
    now = now or datetime.now(timezone.utc)
    user = await db.get(User, feed.user_id)
    scope = None
    if user is not None and user.is_active:
        scope = next((s for s in await scopes_for(db, user) if s.scope_key == feed.scope_key), None)
    if scope is None:
        return render("ShiftBoard (no longer available)",
                      "This calendar isn't available to this account any more. Remove it from your calendar app.", [])
    if scope.kind == CalendarKind.worker.value:
        entries = await worker_entries(db, user, feed, now)
    else:
        entries = await venue_entries(
            db, scope.venue_ids, show_venue=scope.kind != CalendarKind.venue.value,
            drafts=bool(feed.include_drafts), lead=scope.shift_lead, now=now,
        )
    return render(f"ShiftBoard: {scope.name}", scope.description, entries)


async def feed_text(db: AsyncSession, feed: CalendarFeed) -> Tuple[str, str]:
    """(body, etag), built at most once a minute per link."""
    token, version = feed.token, feed.updated_at     # a saved change to the link (its switches) makes a new version
    hit = _CACHE.get(token)
    stamp = time.monotonic()
    if hit and hit[0] > stamp and hit[1] == version:
        return hit[3], hit[2]
    body = await build_feed(db, feed)
    etag = '"' + hashlib.sha256(body.encode("utf-8")).hexdigest()[:32] + '"'
    if len(_CACHE) >= CACHE_LINKS:
        for key in [k for k, v in _CACHE.items() if v[0] <= stamp]:
            _CACHE.pop(key, None)
        if len(_CACHE) >= CACHE_LINKS:
            _CACHE.clear()
    _CACHE[token] = (stamp + CACHE_SECONDS, version, etag, body)
    return body, etag


def etag_matches(header: Optional[str], etag: str) -> bool:
    """If-None-Match: a list of tags, weak or strong, or *."""
    wanted = etag.strip('"')
    for part in (header or "").split(","):
        tag = part.strip()
        if not tag:
            continue
        if tag == "*":
            return True
        if tag.startswith("W/"):
            tag = tag[2:]
        if tag.strip('"') == wanted:
            return True
    return False
