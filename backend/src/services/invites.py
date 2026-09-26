"""
Phase 29: Team invites.

* One shareable link per venue (kind 'link'): printed as a QR code, posted in the staff group chat.
  Anyone with it can join the team. Valid 30 days; "New link" revokes the old one.
* Personal invites (kind 'personal'): one per person, from the Invite form or a CSV import.
  Emailed (and texted when SMS is set up). Valid 14 days; can be used once.

Joining = a team-list row with status 'active' (services/team.set_membership).
A person the venue BLOCKED can't join through any invite.
"""
import io
import logging
import re
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

import segno
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models import Venue, VenueInvite
from src.services.messaging import (
    absolute_link, email_available, sms_available, send_email, send_sms, render_email, normalize_phone,
)

logger = logging.getLogger("shiftboard.invites")

LINK_DAYS = 30
PERSONAL_DAYS = 14
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def new_token() -> str:
    return secrets.token_urlsafe(18)          # 24 URL-safe characters


def invite_url(token: str, base: Optional[str] = None) -> str:
    """Phase 29.1: `base` = the site the manager is using (see public_base), else APP_BASE_URL."""
    if base:
        return f"{base.rstrip('/')}/join/{token}"
    return absolute_link(f"/join/{token}")


def public_base(request) -> Optional[str]:
    """
    Phase 29.1: the public address for invite links.
    APP_BASE_URL wins when it's set to a real address. If it's unset or still points at localhost,
    use the address the manager's browser is on (Origin / Referer header), so links and QR codes
    work before APP_BASE_URL is configured.
    """
    cfg = (settings.APP_BASE_URL or "").rstrip("/")
    if cfg and "localhost" not in cfg and "127.0.0.1" not in cfg:
        return cfg
    origin = (request.headers.get("origin") or "").rstrip("/")
    if not origin:
        ref = request.headers.get("referer") or ""
        m = re.match(r"^(https?://[^/]+)", ref)
        origin = m.group(1) if m else ""
    if origin.startswith("http://") or origin.startswith("https://"):
        return origin
    return cfg or None


def qr_svg(url: str) -> str:
    """SVG markup (no XML declaration) for the QR code of `url`."""
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=6, border=2, dark="#0f172a", light="#ffffff", xmldecl=False)
    return buf.getvalue().decode("utf-8")


def as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def invite_status(inv: VenueInvite, now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    if inv.revoked_at is not None:
        return "revoked"
    if inv.kind == "personal" and inv.accepted_at is not None:
        return "accepted"
    if as_utc(inv.expires_at) <= now:
        return "expired"
    return "pending"


def valid_email(value: Optional[str]) -> bool:
    return bool(value and EMAIL_RE.match(value.strip()))


async def get_or_create_link(db: AsyncSession, venue_id, created_by) -> VenueInvite:
    """The venue's current shareable link (creates one if there's none usable). Does NOT commit."""
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(VenueInvite)
        .where(VenueInvite.venue_id == venue_id, VenueInvite.kind == "link", VenueInvite.revoked_at.is_(None))
        .order_by(VenueInvite.created_at.desc())
    )).scalars().all()
    for inv in rows:
        if as_utc(inv.expires_at) > now:
            return inv
    inv = VenueInvite(
        venue_id=venue_id, token=new_token(), kind="link", created_by_user_id=created_by,
        expires_at=now + timedelta(days=LINK_DAYS), positions=[], created_at=now,
    )
    db.add(inv)
    await db.flush()
    return inv


async def regenerate_link(db: AsyncSession, venue_id, created_by) -> VenueInvite:
    """Revokes every current link and makes a new one. Does NOT commit."""
    now = datetime.now(timezone.utc)
    for inv in (await db.execute(
        select(VenueInvite).where(
            VenueInvite.venue_id == venue_id, VenueInvite.kind == "link", VenueInvite.revoked_at.is_(None)
        )
    )).scalars().all():
        inv.revoked_at = now
    await db.flush()
    return await get_or_create_link(db, venue_id, created_by)


async def send_invite(inv: VenueInvite, venue: Venue, inviter_name: str, base: Optional[str] = None) -> Tuple[bool, bool]:
    """Emails / texts one personal invite. Never raises. Returns (emailed, texted)."""
    url = invite_url(inv.token, base)
    first = (inv.first_name or "").strip()
    hello = f"Hi {first}, " if first else ""
    title = f"Join {venue.name} on ShiftBoard"
    body = (f"{hello}{inviter_name} invited you to join the {venue.name} team on ShiftBoard. "
            "You'll see their open shifts, can book them and get reminders.\n\n"
            "Tap the button to create your account (or sign in) and join. The link works for 14 days.")
    emailed = texted = False
    if inv.email and valid_email(inv.email):
        try:
            text, html_body = render_email(title, body, url, footer_link="/")
            ok, err = await send_email(inv.email, title, text, html_body)
            emailed = bool(ok)
            if not ok:
                logger.warning(f"Invite email to {inv.email} failed: {err}")
        except Exception:
            logger.exception("invite email failed")
    if inv.phone and sms_available() and normalize_phone(inv.phone):
        try:
            ok, err = await send_sms(inv.phone, f"{inviter_name} invited you to join {venue.name} on ShiftBoard: {url}")
            texted = bool(ok)
        except Exception:
            logger.exception("invite sms failed")
    return emailed, texted
