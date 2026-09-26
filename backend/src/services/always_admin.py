"""
Phase 28.1: Always-admin email allowlist.

Emails listed in settings.ALWAYS_ADMIN_EMAILS are always platform admins.
- is_always_admin_email(): case-insensitive membership check.
- promote_always_admin(): upgrades ONE persisted user in the current session (no commit).
- sync_always_admins(): startup pass that upgrades every existing listed user (commits).
"""
import logging
from typing import FrozenSet, Optional

from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models import User, VenueManager, VenueWhitelist

logger = logging.getLogger("shiftboard.always_admin")


def get_always_admin_emails() -> FrozenSet[str]:
    raw = settings.ALWAYS_ADMIN_EMAILS or ""
    return frozenset(
        part.strip().lower()
        for part in raw.split(",")
        if part.strip() and "@" in part
    )


def is_always_admin_email(email: Optional[str]) -> bool:
    if not email:
        return False
    return email.strip().lower() in get_always_admin_emails()


async def promote_always_admin(db: AsyncSession, user: User) -> bool:
    """
    Make an already-persisted user an active platform_admin.
    Mirrors the Admin PATCH behaviour: when the role changes, venue manager
    assignments and worker whitelists are removed.
    Does NOT commit. Returns True if anything changed.
    """
    if user.id is None:
        return False

    changed = False
    if (user.role or "").lower() != "platform_admin":
        await db.execute(delete(VenueManager).where(VenueManager.user_id == user.id))
        await db.execute(delete(VenueWhitelist).where(VenueWhitelist.worker_id == user.id))
        user.role = "platform_admin"
        changed = True
    if not user.is_active:
        user.is_active = True
        changed = True

    if changed:
        logger.info(f"ALWAYS_ADMIN_EMAILS: promoted {user.email} to platform_admin")
    return changed


async def sync_always_admins(db: AsyncSession) -> int:
    """Upgrade every existing user whose email is listed. Commits. Returns the number changed."""
    emails = get_always_admin_emails()
    if not emails:
        return 0

    try:
        result = await db.execute(
            select(User).where(func.lower(User.email).in_(list(emails)))
        )
        changed = 0
        for user in result.scalars().all():
            if await promote_always_admin(db, user):
                changed += 1
        if changed:
            await db.commit()
        return changed
    except Exception:
        await db.rollback()
        raise
