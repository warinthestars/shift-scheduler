"""
Phase 29.2: Platform admin audit log.

record() opens its own session, commits and NEVER raises: call it AFTER the admin action committed.
Actions: user_created, user_updated, user_role, user_status, user_password, user_deleted,
         venue_created, venue_deleted, delivery_retry, test_email
"""
import logging
from typing import Optional

from src.database import AsyncSessionLocal
from src.models import AdminAudit

logger = logging.getLogger("shiftboard.admin_audit")


async def record(actor_id, action: str, summary: str, *, target_type: str = "system", target_id=None) -> None:
    try:
        async with AsyncSessionLocal() as db:
            db.add(AdminAudit(
                actor_user_id=actor_id, action=action, target_type=target_type,
                target_id=target_id, summary=(summary or "")[:400],
            ))
            await db.commit()
    except Exception:
        logger.exception(f"admin audit '{action}' failed")


def person(u) -> str:
    if u is None:
        return "someone"
    name = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return f"{name} ({u.email})" if name else (u.email or "someone")
