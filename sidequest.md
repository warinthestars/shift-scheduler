# Phase 28.1: Always-Admin Email Allowlist (`ALWAYS_ADMIN_EMAILS`)

Add a secrets-file setting that lists email addresses which must **always** hold the `platform_admin` role. The goal is persistence across destructive database resets (`docker compose down -v`): after a reset, the listed person signs in with Firebase and is JIT-provisioned directly as a Platform Admin instead of a Worker.

**Scope is backend + secrets template only. No frontend changes. No database schema changes.**

### Hard rules for this phase
* Do **NOT** modify `backend/src/auth.py`, `backend/src/main.py`, or the `/login` and `/register` handlers in `backend/src/routers/auth.py`. The only handler you touch in `routers/auth.py` is `firebase_login`.
* Do **NOT** add any column, table, or native PostgreSQL ENUM. Roles remain plain `VARCHAR(50)` strings: `"platform_admin"`, `"venue_manager"`, `"worker"`.
* Promotion via the allowlist must **only** happen when Firebase reports `email_verified == True`. Firebase email/password accounts can be created with any address unverified; promoting an unverified email would let anyone become an admin. This check is mandatory.
* Email comparison is always case-insensitive: `.strip().lower()` on both sides.
* Helper functions in the new service file never call `db.commit()`. The caller commits (or rolls back).

---

## 1. Secrets Template (`.secrets/.secrets.env.template`)

Insert the following block **immediately after** the `ALLOW_SELF_REGISTRATION=true` line (and its two comment lines above it), before the `# Sign-in buttons are discovered automatically...` comment:

```dotenv

# Always-admin accounts. Comma-separated email addresses that are ALWAYS Platform Admins.
# Survives database resets: when a listed person signs in with Firebase (verified email),
# their account is created or upgraded as a Platform Admin, even if self-registration is off.
# Existing accounts with a listed email are also upgraded every time the backend starts.
# These accounts cannot be demoted, deactivated or deleted from the Admin panel.
# Example: ALWAYS_ADMIN_EMAILS=you@example.com,cofounder@example.com
ALWAYS_ADMIN_EMAILS=
```

Do **not** edit `.secrets/.secrets.env` (it is git-ignored and belongs to the user). Do **not** edit `.gitignore`.

---

## 2. Config (`backend/src/config.py`)

Inside `class Settings(BaseSettings)`, directly below the line
`SHOW_DEMO_LOGINS: bool = os.getenv("SHOW_DEMO_LOGINS", "false").lower() in ("true", "1", "yes")`
add:

```python
    # Phase 28.1: emails that are always platform admins (comma-separated)
    ALWAYS_ADMIN_EMAILS: str = os.getenv("ALWAYS_ADMIN_EMAILS", "")
```

No other change to `config.py`. (`docker-compose.yml` already loads `./.secrets/.secrets.env` into the backend via `env_file`, so no compose change is needed.)

---

## 3. New Service (`backend/src/services/always_admin.py`)

Create this file with exactly this content:

```python
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
```

---

## 4. Firebase JIT Provisioning (`backend/src/routers/auth.py` → `firebase_login` only)

### 4a. Import
Below the existing `from src.serializers import build_user_response` line, add:

```python
from src.services.always_admin import is_always_admin_email, promote_always_admin
```

### 4b. Replace the provisioning `try/except` block
In `firebase_login`, locate the block that starts at
`        try:\n            user = await db.scalar(select(User).where(User.firebase_uid == firebase_uid))`
and ends at the matching
`            raise HTTPException(status_code=500, detail=f"Failed to provision user: {str(e)}")`.

Replace that **entire** block (and nothing outside it) with:

```python
        # Phase 28.1: verified emails in ALWAYS_ADMIN_EMAILS are always platform admins
        always_admin = email_verified and is_always_admin_email(email)

        try:
            user = await db.scalar(select(User).where(User.firebase_uid == firebase_uid))
            dirty = False

            if not user:
                existing = await db.scalar(select(User).where(func.lower(User.email) == email))
                if existing:
                    if not email_verified:
                        raise HTTPException(
                            status_code=409,
                            detail="An account with this email already exists. Verify your email with your sign-in provider to link it."
                        )
                    if existing.firebase_uid and existing.firebase_uid != firebase_uid:
                        raise HTTPException(
                            status_code=409,
                            detail="This email is already linked to a different sign-in account."
                        )
                    existing.firebase_uid = firebase_uid
                    if not existing.avatar_url and claims.get("picture"):
                        existing.avatar_url = claims.get("picture")
                    user = existing
                else:
                    if not settings.ALLOW_SELF_REGISTRATION and not always_admin:
                        raise HTTPException(
                            status_code=403,
                            detail="Self-registration is disabled. Ask an administrator to create your account."
                        )
                    if not email_verified:
                        raise HTTPException(
                            status_code=403,
                            detail="Please verify your email address first. Check your inbox for the verification link."
                        )

                    if request.first_name and request.first_name.strip():
                        first_name = request.first_name.strip()[:100]
                        last_name = (request.last_name or "").strip()[:100]
                    else:
                        full_name = (claims.get("name") or "").strip()
                        parts = full_name.split(" ") if full_name else []
                        first_name = (parts[0] if parts else email.split("@")[0])[:100]
                        last_name = (" ".join(parts[1:]) if len(parts) > 1 else "")[:100]

                    user = User(
                        firebase_uid=firebase_uid,
                        email=email,
                        hashed_password=None,
                        first_name=first_name,
                        last_name=last_name,
                        phone=request.phone.strip() if request.phone else None,
                        role="platform_admin" if always_admin else "worker",
                        avatar_url=claims.get("picture"),
                        skills=[],
                        aggregate_rating=5.0,
                        rating_count=0,
                        total_shifts=0,
                        is_active=True,
                    )
                    db.add(user)
                dirty = True

            # Existing (already persisted) users: upgrade if listed. New users already got the role above.
            if always_admin and user.id is not None:
                if await promote_always_admin(db, user):
                    dirty = True

            if dirty:
                await db.commit()
                await db.refresh(user)
        except HTTPException:
            await db.rollback()
            raise
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to provision user: {str(e)}")
```

Notes for this step:
* The existing-email branch, the 409 messages, the name parsing and every other field are **unchanged**; only `dirty`, `always_admin`, the self-registration condition, the `role=` expression and the post-branch promotion/commit were added.
* Previously `db.commit()` ran only inside `if not user:`. It now runs whenever `dirty` is True, so a user matched by `firebase_uid` who is on the list gets promoted and saved.
* Leave the mock-Firebase branch (`settings.USE_MOCK_FIREBASE and token.startswith("mock-firebase-")`) untouched.
* Leave everything after the block untouched: the `is_active` check, the `VenueManager` lookup, and JWT creation with `normalize_role(user.role)` already produce `"role": "platform_admin"` and `venue_id: None` for promoted users.

---

## 5. Startup Sync (`backend/src/seed.py`)

### 5a. Import
Add below `from src.services.shift_events import backfill_missing_events`:

```python
from src.services.always_admin import sync_always_admins
```

### 5b. Sync block
In `seed_initial_data`, directly **after** the Super Admin `try/except` block (the one ending with `logger.error(f"Error seeding super admin: {e}", exc_info=True)`) and **before** the `# 2. Demo Venue Seeding` comment banner, insert:

```python
    # --------------------------------------------------------------------------
    # 1b. Phase 28.1: ALWAYS_ADMIN_EMAILS sync (upgrade existing listed users)
    # --------------------------------------------------------------------------
    try:
        promoted = await sync_always_admins(db)
        if promoted:
            logger.info(f"ALWAYS_ADMIN_EMAILS: upgraded {promoted} existing user(s) to platform_admin")
    except Exception as e:
        logger.error(f"Error syncing ALWAYS_ADMIN_EMAILS: {e}", exc_info=True)
```

(`sync_always_admins` already rolls back on failure.) Do **not** create users here — listed people who have never signed in are created on their first Firebase sign-in (Section 4).

---

## 6. Admin Panel Guards (`backend/src/routers/admin.py`)

Listed accounts would silently revert on their next sign-in, so the Admin panel must refuse to demote, deactivate, or delete them.

### 6a. Import
Below `from src.serializers import auth_source_for`, add:

```python
from src.services.always_admin import is_always_admin_email
```

### 6b. `update_admin_user` (`PATCH /api/admin/users/{user_id}`)
Inside the `try:`, directly **after** these existing lines:

```python
        if is_self and user_update.is_active is False:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")
```

insert:

```python
        if is_always_admin_email(user.email) and (new_role != "platform_admin" or user_update.is_active is False):
            raise HTTPException(
                status_code=400,
                detail="This account is listed in ALWAYS_ADMIN_EMAILS and must stay an active Platform Admin. Remove it from the secrets file first."
            )
```

(This sits inside the existing `try`, so the existing `except HTTPException: await db.rollback(); raise` handles it. Do not add another try/except.)

### 6c. `delete_admin_user` (`DELETE /api/admin/users/{user_id}`)
Directly **after**:

```python
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
```

insert:

```python
    if is_always_admin_email(user.email):
        raise HTTPException(
            status_code=400,
            detail="This account is listed in ALWAYS_ADMIN_EMAILS and cannot be deleted. Remove it from the secrets file first."
        )
```

No other changes in `admin.py`.

---

## 7. Files touched (complete list — touch nothing else)
1. `.secrets/.secrets.env.template` — new `ALWAYS_ADMIN_EMAILS=` block.
2. `backend/src/config.py` — one new setting.
3. `backend/src/services/always_admin.py` — **new file**.
4. `backend/src/routers/auth.py` — one import + `firebase_login` provisioning block.
5. `backend/src/seed.py` — one import + sync block.
6. `backend/src/routers/admin.py` — one import + two guards.

---

## 8. Verification (run after the rebuild in Section 9)
1. `docker compose exec backend python -c "from src.services.always_admin import get_always_admin_emails; print(sorted(get_always_admin_emails()))"` → prints the lowercased list from `.secrets/.secrets.env`.
2. `docker compose logs backend | grep ALWAYS_ADMIN` → no errors on startup.
3. Fresh DB: sign in with Google (or a verified email/password account) using a listed email → response `user.role == "platform_admin"`; the Admin panel and global venue dropdown are visible.
4. Same, with a listed email typed in UPPER/mixed case in the secrets file → still promoted.
5. Sign in with an unlisted email → still provisioned as `"worker"` (unchanged behaviour).
6. Set `ALLOW_SELF_REGISTRATION=false`: listed verified email can still sign in and is created as admin; unlisted new email still gets the 403.
7. Admin panel: try to change a listed user to Worker, deactivate them, or delete them → 400 with the ALWAYS_ADMIN_EMAILS message.
8. Existing worker whose email is then added to the list → after `docker compose up -d --force-recreate backend`, log shows `upgraded 1 existing user(s)`; that user signs out and back in and lands on the admin view.

---

## 9. Deployment reminder for the user
* **No schema change** in this phase, so `docker compose down -v` is **not** required for this change.
* Add the real value to your own `.secrets/.secrets.env` (not the template), e.g. `ALWAYS_ADMIN_EMAILS=you@example.com`.
* `env_file` values are read only when a container is created, so a plain `restart` will not pick up the new variable. Run:
  `docker compose up -d --build --force-recreate backend`
* When you *do* run a destructive reset later (`docker compose down -v` then `docker compose up -d --build`), simply sign in with Firebase using the listed email — the account is recreated as a Platform Admin.
* A user who is promoted while already signed in keeps their old role in the JWT until they sign out and back in (the backend reads the role from the DB on each request, but the frontend routes by the token).