# Phase 24: Hardening — Approval Bypass, Profile Endpoint, Venue Creation, Mobile Nav, Demo Logins, Swap Targets

Seven fixes found in the post-Phase-23 code review. **No database schema change and no `down -v`** (one column DEFAULT changes in `init.sql`, which only affects future fresh databases).

| # | Fix | Files |
|---|---|---|
| F1 | Every worker is silently auto-approved (default rating 5.0 ≥ default threshold 4.5, and no ratings exist). The rating rule must only apply to workers who have real ratings. | `services/auto_confirm.py`, `models.py`, `schemas.py`, `init.sql`, `AdminPanel.jsx` |
| F2 | `GET/PUT /api/users/me` and `GET /api/auth/me` crash with `MissingGreenlet` (they serialize the ORM `User`, whose `venue_id` property lazy-loads). | new `serializers.py`, `routers/users.py`, `routers/auth.py` |
| F3 | Creating a venue with an unknown manager email silently creates an account with password `Manager123!`, and demotes admins. | `routers/venues.py` |
| F4 | No navigation on phones (links are `hidden md:flex`, no mobile menu). | `Navbar.jsx` (full replacement) |
| F5 | Demo credentials (including the admin password) are shown on the login page to everyone. | `config.py`, `routers/auth.py`, `firebase.js`, `LoginPage.jsx` |
| F6 | `GET /api/users?role=` never matches (compares to `role.upper()`), and any logged-in user can list every user's email. | `routers/users.py` |
| F7 | A shift can be "transferred" to any worker on the platform. Limit it to the venue's team (whitelisted, or has worked there before) who are free at that time, and enforce it server-side. | new `services/team.py`, `routers/transfers.py`, `routers/venues.py`, `TransferModal.jsx` |

> `.secrets/.secrets.env.template` has ALREADY been updated by the architect with `SHOW_DEMO_LOGINS=false`. Do not touch anything in `.secrets/` or `.gitignore`.

---

## 0. Guardrails (read before editing)
* DO NOT modify: `.gitignore`, anything in `.secrets/`, `docker-compose.yml`, `backend/src/auth.py`, `backend/src/main.py`, `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/src/components/ProtectedRoute.jsx`, `frontend/src/App.jsx`.
* In `backend/src/routers/auth.py`: change ONLY `get_current_user_profile` and ONE line in `firebase_config` (§5B). Nothing else.
* NEVER call `UserResponse.model_validate(<User ORM>)` or return a `User` ORM object from an endpoint whose `response_model` is `UserResponse`. Use `build_user_response()` from §2.
* NEVER call `await db.delete(<ORM obj>)` or read relationship attributes that weren't loaded with `selectinload` in the same query.
* All datetime comparisons use `datetime.now(timezone.utc)`.
* New files are created with the EXACT content given. `Navbar.jsx` is replaced IN FULL with the exact content given.

---

## 1. F1 — Stop the silent auto-approval

### A. `backend/src/services/auto_confirm.py`
In `evaluate_shift_request`, replace the ENTIRE "Condition 3: Rating Threshold" block (from the `# Condition 3` comment banner through the end of its `else:` logging branch) with:
```python
    # --------------------------------------------------------------------------
    # Condition 3: Rating Threshold (only for workers who have real ratings)
    # --------------------------------------------------------------------------
    if venue.auto_approve_rating_threshold is not None:
        rating_count = int(worker.rating_count or 0)
        worker_rating = float(worker.aggregate_rating or 0.0)
        threshold = float(venue.auto_approve_rating_threshold)
        if rating_count > 0 and worker_rating >= threshold:
            logger.info(
                f"[Auto-Confirm Engine] Condition 3 MET: Worker rating {worker_rating:.2f} "
                f"({rating_count} ratings) >= Venue threshold {threshold:.2f}."
            )
            await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
            return RequestStatus.APPROVED, "rating_threshold"
        logger.info(
            f"[Auto-Confirm Engine] Condition 3 NOT MET: rating {worker_rating:.2f}, "
            f"{rating_count} ratings, threshold {threshold:.2f}."
        )
```
Also update the docstring line for Condition 3 to: `3. Condition 3: Rating Threshold: worker has >= 1 rating AND aggregate_rating >= venue threshold.`

### B. Default threshold for NEW venues = none (manual review)
* `backend/src/models.py`, `class Venue`: change
  `auto_approve_rating_threshold = Column(Float, nullable=True, default=4.5)` → `auto_approve_rating_threshold = Column(Float, nullable=True, default=None)`
* `database/init.sql`, `CREATE TABLE venues`: change
  `auto_approve_rating_threshold DOUBLE PRECISION DEFAULT 4.5,` → `auto_approve_rating_threshold DOUBLE PRECISION,`
* `backend/src/schemas.py`: in BOTH `class VenueBase` and `class VenueCreate`, change `auto_approve_rating_threshold: Optional[float] = 4.5` → `auto_approve_rating_threshold: Optional[float] = None`
* Do NOT change `seed.py`.

### C. `frontend/src/pages/AdminPanel.jsx`
1. Change `const [autoApproveRating, setAutoApproveRating] = useState('4.5');` → `useState('')`.
2. In the Create Venue modal, change the label text `Auto-Approve Min Rating (★)` → `Auto-approve workers rated at least (★)`, add `placeholder="Blank = review every request"` to that `<input>`, and directly after the `<input ... />` add:
```jsx
                  <p className="text-[10px] text-slate-500 mt-1">Only applies to workers who have been rated. Leave blank to approve requests yourself.</p>
```
3. In the venues table, replace the expression
`≥ {venue.auto_approve_rating_threshold || venue.global_auto_approve_min_rating || '4.5'}★`
with:
```jsx
{venue.auto_approve_rating_threshold ? `≥ ${venue.auto_approve_rating_threshold}★ (rated workers)` : 'Manual review'}
```
(keep the surrounding element and classes unchanged).

---

## 2. F2 — Safe user serializer

### A. NEW FILE `backend/src/serializers.py`
```python
"""
Phase 24: Single safe way to turn a User ORM object into a UserResponse.
Uses explicit queries only - never touches lazy relationships (MissingGreenlet-safe).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import User, Venue, VenueManager, VenueWhitelist
from src.schemas import UserResponse
from src.auth import normalize_role


async def get_user_affiliations(db: AsyncSession, user: User):
    """Returns (venue_ids, venue_names) for managers (managed venues) or workers (team/whitelist)."""
    role = normalize_role(user.role)
    if role == "venue_manager":
        rows = (await db.execute(
            select(VenueManager.venue_id, Venue.name)
            .join(Venue, VenueManager.venue_id == Venue.id)
            .where(VenueManager.user_id == user.id)
            .order_by(VenueManager.is_primary.desc(), Venue.name.asc())
        )).all()
    elif role == "worker":
        rows = (await db.execute(
            select(VenueWhitelist.venue_id, Venue.name)
            .join(Venue, VenueWhitelist.venue_id == Venue.id)
            .where(VenueWhitelist.worker_id == user.id, VenueWhitelist.is_active == True)
            .order_by(Venue.name.asc())
        )).all()
    else:
        rows = []
    return [r[0] for r in rows], [r[1] for r in rows]


async def build_user_response(db: AsyncSession, user: User) -> UserResponse:
    role = normalize_role(user.role)
    venue_ids, venue_names = await get_user_affiliations(db, user)
    return UserResponse(
        id=user.id,
        email=user.email,
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        role=role,
        phone=user.phone,
        avatar_url=user.avatar_url,
        bio=user.bio,
        skills=user.skills or [],
        venue_id=str(venue_ids[0]) if (role == "venue_manager" and venue_ids) else None,
        venue_ids=venue_ids,
        venue_names=venue_names,
        aggregate_rating=float(user.aggregate_rating or 0.0),
        rating_count=int(user.rating_count or 0),
        total_shifts=int(user.total_shifts or 0),
        is_active=bool(user.is_active),
        created_at=user.created_at,
    )
```

### B. `backend/src/routers/users.py`
1. Imports: change `from sqlalchemy import select` → `from sqlalchemy import select, func`; change `from src.auth import get_current_user` → `from src.auth import get_current_user, require_manager_or_admin`; add `from src.serializers import build_user_response`.
2. In `get_my_profile_and_experience`, replace
   `user_data = UserResponse.model_validate(current_user).model_dump()`
   with
   `user_data = (await build_user_response(db, current_user)).model_dump(mode="json")`
3. Replace the ENTIRE `update_my_profile` function with:
```python
@router.put("/me", response_model=UserResponse)
async def update_my_profile(
    profile_update: UserUpdateMe,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 24: Update own basic profile fields. Role/email/active status are NOT editable here."""
    update_data = profile_update.model_dump(exclude_unset=True)
    try:
        for field, value in update_data.items():
            if field in ("role", "email", "is_active", "hashed_password", "firebase_uid"):
                continue
            if isinstance(value, str):
                value = value.strip()
            setattr(current_user, field, value)
        await db.commit()
        await db.refresh(current_user)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update profile: {str(e)}")
    return await build_user_response(db, current_user)
```
4. Replace the two alias endpoints with:
```python
@router.get("/profile", response_model=UserResponse)
async def get_profile_alias(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    return await build_user_response(db, current_user)

@router.put("/profile", response_model=UserResponse)
async def update_profile_alias(
    profile_update: UserUpdateMe,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    return await update_my_profile(profile_update, current_user, db)
```

### C. `backend/src/routers/auth.py` — `/me` only
1. Add import: `from src.serializers import build_user_response`
2. Replace the ENTIRE `get_current_user_profile` function with:
```python
@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve profile of authenticated user (Phase 24: MissingGreenlet-safe)."""
    return await build_user_response(db, user)
```

---

## 3. F3 — Venue creation without default passwords (`backend/src/routers/venues.py`)
Replace the ENTIRE `create_venue` function with:
```python
@router.post("", response_model=VenueResponse, status_code=status.HTTP_201_CREATED)
async def create_venue(
    venue_in: VenueCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 24: Create a venue.
    - If a manager email is given, that user MUST already exist (no auto-created accounts).
      A 'worker' is promoted to 'venue_manager'; admins/managers keep their role.
    - If no email is given and the creator is a venue_manager, the creator manages it.
      Platform admins are omnipresent and are NOT added as managers.
    """
    mgr_email = (venue_in.manager_email or venue_in.initial_manager_email or "").lower().strip()
    mgr_user = None
    if mgr_email:
        mgr_user = await db.scalar(select(User).where(func.lower(User.email) == mgr_email))
        if not mgr_user:
            raise HTTPException(
                status_code=400,
                detail=f"No account exists for {mgr_email}. Create the user first (Admin Panel → Users) "
                       f"or have them sign up, then assign them as manager."
            )
        if not mgr_user.is_active:
            raise HTTPException(status_code=400, detail=f"{mgr_email} is deactivated. Reactivate them first.")

    try:
        venue_dict = venue_in.model_dump(exclude={"manager_email", "initial_manager_email"})
        venue = Venue(**venue_dict)
        db.add(venue)
        await db.flush()

        manager_id = None
        if mgr_user:
            if normalize_role(mgr_user.role) == "worker":
                mgr_user.role = "venue_manager"
            manager_id = mgr_user.id
        elif normalize_role(current_user.role) == "venue_manager":
            manager_id = current_user.id

        if manager_id:
            db.add(VenueManager(venue_id=venue.id, user_id=manager_id, is_primary=True))

        await db.commit()
        await db.refresh(venue)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create venue: {str(e)}")

    return venue
```
(`func`, `normalize_role`, `VenueManager` are already imported in this file — confirm; add to the existing import lines if any is missing.)

In `frontend/src/pages/AdminPanel.jsx` Create Venue modal, find the manager email `<input>` bound to `managerEmail` and directly after it add:
```jsx
                  <p className="text-[10px] text-slate-500 mt-1">Must be an existing account. Leave blank and assign a manager later from Users → Edit.</p>
```

---

## 4. F4 — Mobile navigation: REPLACE FILE `frontend/src/components/Navbar.jsx`
```jsx
import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X } from 'lucide-react';

export default function Navbar() {
  const { user, logout, isAdmin, isWorker } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [adminVenues, setAdminVenues] = useState([]);
  const [selectedVenueId, setSelectedVenueId] = useState(
    localStorage.getItem('shiftboard_admin_venue_id') || ''
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const userRole = (user?.role || '').toLowerCase();
  const isPlatformAdmin = userRole === 'platform_admin' || isAdmin;
  const isManagerRole = userRole === 'venue_manager';

  const handleLogout = () => {
    setMobileOpen(false);
    logout();
    navigate('/login');
  };

  // Close the mobile menu whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Super Admin venue switcher data
  useEffect(() => {
    if (isPlatformAdmin) {
      api
        .get('/admin/venues')
        .then((res) => {
          const list = res.data || [];
          setAdminVenues(list);
          const saved = localStorage.getItem('shiftboard_admin_venue_id');
          if (saved && list.some((v) => v.id === saved)) {
            setSelectedVenueId(saved);
          } else if (list.length > 0) {
            setSelectedVenueId(list[0].id);
            localStorage.setItem('shiftboard_admin_venue_id', list[0].id);
          }
        })
        .catch((err) => console.error('Failed to load admin venues for switcher:', err));
    }
  }, [isPlatformAdmin]);

  const handleVenueChange = (e) => {
    const newId = e.target.value;
    setSelectedVenueId(newId);
    localStorage.setItem('shiftboard_admin_venue_id', newId);
    window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: newId }));
    setMobileOpen(false);
    if (location.pathname !== '/venue') {
      navigate('/venue');
    }
  };

  const links = [
    (isWorker || isPlatformAdmin) && {
      to: '/worker',
      label: isPlatformAdmin ? 'Worker View' : 'My Shifts',
      icon: Briefcase,
      active: 'bg-slate-800 text-emerald-400',
    },
    (isManagerRole || isPlatformAdmin) && {
      to: '/venue',
      label: isPlatformAdmin ? 'Venue Manager View' : 'My Venue',
      icon: Building2,
      active: 'bg-slate-800 text-teal-400',
    },
    isPlatformAdmin && {
      to: '/admin',
      label: 'Platform Admin',
      icon: Shield,
      active: 'bg-indigo-950 text-indigo-300 border border-indigo-700/50',
    },
  ].filter(Boolean);

  const venueSwitcher = (idSuffix) =>
    isPlatformAdmin && adminVenues.length > 0 ? (
      <div className="flex items-center space-x-2 bg-slate-950/70 border border-indigo-500/30 px-3 py-1.5 rounded-xl shadow-inner">
        <Building2 className="w-4 h-4 text-indigo-400 flex-shrink-0" />
        <label htmlFor={`admin-venue-switcher-${idSuffix}`} className="text-xs text-indigo-300 font-semibold whitespace-nowrap">
          Viewing Venue:
        </label>
        <select
          id={`admin-venue-switcher-${idSuffix}`}
          value={selectedVenueId}
          onChange={handleVenueChange}
          className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded-lg px-2.5 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
        >
          <option value="" disabled>Select Venue</option>
          {adminVenues.map((v) => (
            <option key={v.id} value={v.id} className="bg-slate-900 text-white">
              {v.name}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  const roleDot =
    userRole === 'platform_admin' ? 'bg-indigo-400' : userRole === 'venue_manager' ? 'bg-teal-400' : 'bg-emerald-400';

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Brand + desktop links */}
          <div className="flex items-center space-x-3">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Calendar className="w-5 h-5 text-slate-950 font-bold" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white">
                Shift<span className="text-emerald-400">Board</span>
              </span>
            </Link>

            <nav className="hidden lg:flex ml-6 space-x-2">
              {links.map(({ to, label, icon: Icon, active }) => (
                <Link
                  key={to}
                  to={to}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center space-x-1.5 ${
                    location.pathname === to ? active : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
          </div>

          {/* Desktop venue switcher */}
          <div className="hidden lg:block">{venueSwitcher('desktop')}</div>

          {/* Right side */}
          <div className="flex items-center space-x-2">
            {user && userRole === 'worker' && (
              <div className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>{Number(user.rating_average || user.aggregate_rating || 5.0).toFixed(1)}</span>
                <span className="text-amber-500/70">({user.rating_count || 0})</span>
              </div>
            )}

            {user && (
              <div className="text-right hidden lg:block">
                <div className="text-sm font-semibold text-slate-200">{user.first_name} {user.last_name}</div>
                <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                  <span>{userRole.replace('_', ' ')}</span>
                </div>
              </div>
            )}

            {user && (
              <button
                onClick={handleLogout}
                title="Log out"
                className="hidden lg:inline-flex p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition"
              >
                <LogOut className="w-5 h-5" />
              </button>
            )}

            {user && (
              <button
                type="button"
                onClick={() => setMobileOpen((o) => !o)}
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileOpen}
                className="lg:hidden p-2.5 rounded-xl text-slate-200 bg-slate-800 border border-slate-700 hover:bg-slate-700 transition"
              >
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile menu panel */}
      {user && mobileOpen && (
        <div className="lg:hidden border-t border-slate-800 bg-slate-900 px-4 pb-4 pt-3 space-y-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">{user.first_name} {user.last_name}</div>
              <div className="text-xs text-slate-400 capitalize flex items-center space-x-1">
                <span className={`w-1.5 h-1.5 rounded-full ${roleDot}`}></span>
                <span>{userRole.replace('_', ' ')}</span>
              </div>
            </div>
            {userRole === 'worker' && (
              <div className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>{Number(user.rating_average || user.aggregate_rating || 5.0).toFixed(1)}</span>
              </div>
            )}
          </div>

          <nav className="grid gap-2">
            {links.map(({ to, label, icon: Icon, active }) => (
              <Link
                key={to}
                to={to}
                className={`px-4 py-3 rounded-xl text-base font-semibold transition flex items-center space-x-3 ${
                  location.pathname === to ? active : 'text-slate-200 bg-slate-800/60 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

          {venueSwitcher('mobile')}

          <button
            type="button"
            onClick={handleLogout}
            className="w-full px-4 py-3 rounded-xl text-base font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 transition flex items-center justify-center space-x-2"
          >
            <LogOut className="w-5 h-5" />
            <span>Log out</span>
          </button>
        </div>
      )}
    </header>
  );
}
```

---

## 5. F5 — Hide demo credentials unless enabled

### A. `backend/src/config.py`
Directly below the `ALLOW_SELF_REGISTRATION` line, add:
```python
    SHOW_DEMO_LOGINS: bool = os.getenv("SHOW_DEMO_LOGINS", "false").lower() in ("true", "1", "yes")
```

### B. `backend/src/routers/auth.py` — `firebase_config` only
In the returned dict, add this key directly after `"self_registration": ...,`:
```python
        "show_demo_logins": bool(settings.SHOW_DEMO_LOGINS),
```

### C. `frontend/src/firebase.js`
In `EMPTY_STATUS`, add `show_demo_logins: false,` after `self_registration: false,`.

### D. `frontend/src/pages/LoginPage.jsx`
1. In the `fbStatus` initial `useState({...})`, add `show_demo_logins: false,` after `self_registration: false,`.
2. Find the Quick Demo Credentials block, which opens with:
```jsx
          {mode === 'signin' && (
            <div className="mb-6 p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 text-xs">
```
and change ONLY its opening condition to:
```jsx
          {mode === 'signin' && fbStatus.show_demo_logins && (
```
Change nothing else in this file.

---

## 6. F6 — User listing (`backend/src/routers/users.py`)
Replace the ENTIRE `list_users` function with:
```python
@router.get("", response_model=List[UserBrief])
async def list_users(
    role: Optional[str] = Query(None, description="Filter users by role"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 24: Managers/admins only. Role filter is case-insensitive."""
    query = select(User).where(User.is_active == True)
    if role:
        query = query.where(func.lower(User.role) == role.lower().strip())
    query = query.order_by(User.first_name, User.last_name)
    result = await db.execute(query)
    return result.scalars().all()
```

---

## 7. F7 — Swap targets limited to the venue team

### A. NEW FILE `backend/src/services/team.py`
```python
"""
Phase 24: Who counts as a venue's "team", and who can take over a given shift.
Team = active workers who are on the venue whitelist OR have worked/been booked there before.
All subqueries use an aliased Shift table so correlation is unambiguous.
"""
from typing import List
from uuid import UUID

from sqlalchemy import select, func, or_, exists
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import User, Shift, ShiftRequest, VenueWhitelist

WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")
ACTIVE_BOOKING_STATUSES = ("approved", "confirmed", "checked_in")
ACTIVE_REQUEST_STATUSES = ("pending", "pending_manager_approval", "approved", "confirmed", "checked_in")


def _team_filter(venue_id: UUID):
    S = aliased(Shift)
    on_whitelist = (
        select(VenueWhitelist.id)
        .where(
            VenueWhitelist.venue_id == venue_id,
            VenueWhitelist.worker_id == User.id,
            VenueWhitelist.is_active == True,
        )
        .exists()
    )
    worked_there = (
        select(ShiftRequest.id)
        .join(S, ShiftRequest.shift_id == S.id)
        .where(
            ShiftRequest.worker_id == User.id,
            S.venue_id == venue_id,
            func.lower(ShiftRequest.status).in_(WORKED_STATUSES),
        )
        .exists()
    )
    return or_(on_whitelist, worked_there)


async def get_venue_team(db: AsyncSession, venue_id: UUID, exclude_user_id: UUID = None) -> List[User]:
    q = select(User).where(
        func.lower(User.role) == "worker",
        User.is_active == True,
        _team_filter(venue_id),
    )
    if exclude_user_id:
        q = q.where(User.id != exclude_user_id)
    q = q.order_by(User.first_name.asc(), User.last_name.asc())
    return list((await db.execute(q)).scalars().all())


async def get_transfer_candidates(db: AsyncSession, shift: Shift, exclude_user_id: UUID) -> List[User]:
    """Venue team members who are free during the shift and not already on/requesting it."""
    S2 = aliased(Shift)
    overlapping_booking = (
        select(ShiftRequest.id)
        .join(S2, ShiftRequest.shift_id == S2.id)
        .where(
            ShiftRequest.worker_id == User.id,
            func.lower(ShiftRequest.status).in_(ACTIVE_BOOKING_STATUSES),
            S2.start_time < shift.end_time,
            S2.end_time > shift.start_time,
        )
        .exists()
    )
    already_on_this_shift = (
        select(ShiftRequest.id)
        .where(
            ShiftRequest.worker_id == User.id,
            ShiftRequest.shift_id == shift.id,
            func.lower(ShiftRequest.status).in_(ACTIVE_REQUEST_STATUSES),
        )
        .exists()
    )
    q = (
        select(User)
        .where(
            func.lower(User.role) == "worker",
            User.is_active == True,
            User.id != exclude_user_id,
            _team_filter(shift.venue_id),
            ~overlapping_booking,
            ~already_on_this_shift,
        )
        .order_by(User.first_name.asc(), User.last_name.asc())
    )
    return list((await db.execute(q)).scalars().all())
```

### B. `backend/src/routers/transfers.py`
1. Add import: `from src.services.team import get_transfer_candidates`
2. Replace the ENTIRE `get_eligible_transfer_workers` function with:
```python
@router.get("/eligible-workers/{shift_id}", response_model=List[UserBrief])
async def get_eligible_transfer_workers(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 24: Venue team members who are free for this shift."""
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")
    return await get_transfer_candidates(db, shift, exclude_user_id=current_user.id)
```
3. In `propose_shift_transfer`, directly AFTER step `# 5. Check if target worker is already booked for this slot` (the `await check_double_booking(...)` call) and BEFORE `# Create transfer record`, add:
```python
    # 6. Phase 24: target must be on this venue's team and free
    candidates = await get_transfer_candidates(db, shift, exclude_user_id=current_user.id)
    if to_worker.id not in {c.id for c in candidates}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can only hand this shift to someone on this venue's team who is free at that time."
        )
```

### C. `backend/src/routers/venues.py` — `get_venue_workers`
1. Add import: `from src.services.team import get_venue_team`
2. Replace the body's `result = await db.execute(select(User)...)` query and `return result.scalars().all()` with:
```python
    return await get_venue_team(db, venue_id, exclude_user_id=current_user.id)
```
(keep the venue-exists 404 check above it). Update the docstring to `"""Phase 24: Active workers on this venue's team (whitelisted or worked here before)."""`

### D. `frontend/src/components/TransferModal.jsx`
1. Inside `fetchWorkers`, replace the entire block from `let res;` through the closing `}` of the `if (venueId) { ... } else { ... }` statement with:
```jsx
        const res = await api.get(`/transfers/eligible-workers/${selectedShiftId}`);
```
(Remove the now-unused `currentShift` / `venueId` lines above it only if your linter complains; leaving them is fine.)
2. Replace the empty-state text `No other workers found available for transfer.` with:
```
No one on this venue's team is free for this shift. Ask your manager to add teammates, or release the shift instead.
```

---

## 8. Rebuild & Verification

No schema change:
```bash
docker compose up -d --build backend frontend
```

Verify:
1. **F1:** As a brand-new worker (0 ratings), request a normal (non-auto-confirm) shift at a venue where you are NOT on the team → it shows **Pending** and appears in the manager's Approval Queue. Backend log shows `Condition 3 NOT MET ... 0 ratings`.
2. **F1:** Admin → Create Venue → the auto-approve field is blank by default; venues table shows **Manual review** for venues without a threshold.
3. **F2:** `curl -H "Authorization: Bearer <token>" https://dev-scheduler.jaccollective.com/api/users/me` → 200 with `role`, `venue_ids`, `experience_history`. Same for `/api/auth/me`. Promote a user to Venue Manager in Admin → that user refreshes their browser → the navbar shows **My Venue** and `/venue` loads their venue (no re-login).
4. **F3:** Admin → Create Venue with manager email `nobody@example.com` → error "No account exists for nobody@example.com…", and NO venue is created. With an existing worker's email → venue created, that user is now a Venue Manager. With your own admin email → venue created, you stay Platform Admin.
5. **F4:** On a phone (or browser dev tools at 375px width): hamburger button top-right → menu shows name/role, view links, (admin) venue switcher, and Log out; tapping a link navigates and closes the menu. Desktop (≥1024px) looks the same as before.
6. **F5:** Login page shows NO "Quick Demo Credentials" box. Add `SHOW_DEMO_LOGINS=true` to `.secrets/.secrets.env`, run `docker compose up -d backend`, hard-refresh → box appears.
7. **F6:** As a worker, `GET /api/users` → 403. As a manager, `GET /api/users?role=worker` → list of active workers.
8. **F7:** As a worker holding a confirmed shift, open **Transfer** → only workers who are on that venue's team (whitelisted or have worked there) AND free at that time are listed. `POST /api/transfers/propose` targeting a random worker from another venue → 400 "You can only hand this shift to someone on this venue's team…".
9. Approval Queue, Posted Shifts board, clock in/out, drop, and existing transfers still work.