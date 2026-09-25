# ShiftBoard — Product Review & Roadmap (after Phase 23)

Written from the point of view of the three people who actually use this: a **bartender or AV tech on their phone** between shifts, a **venue manager** trying to staff Friday night, and **you as the platform admin**. Each item points at the code that prompted it.

---

## 1. What to fix first (bugs and trust issues found in the code)

These are small, but several quietly break things you think are working.

| # | Problem | Where | Why it matters |
|---|---|---|---|
| F1 | **Every worker is auto-approved.** New users start at `aggregate_rating = 5.0` and venues default to `auto_approve_rating_threshold = 4.5`, and nothing in the app ever creates a rating. So rule 3 of the auto-confirm engine approves everyone, and the manager approval queue never fills. | `models.py:58`, `models.py:113`, `services/auto_confirm.py` | Managers think they're vetting people; they aren't. |
| F2 | **`GET /api/users/me` almost certainly returns 500.** It calls `UserResponse.model_validate(current_user)`, the same MissingGreenlet bug from Phase 20.1. The frontend swallows the error, so a promoted user's role never refreshes and profile data never loads. `PUT /api/users/me` has the same problem. | `routers/users.py:58` | Phase 23's "they'll see it on refresh" depends on this. |
| F3 | **Creating a venue with a new manager email creates an account with the password `Manager123!`**, which nobody is told about and anyone can guess. | `routers/venues.py:105` | Security hole. |
| F4 | **No navigation on phones.** The nav links are `hidden md:flex` and the admin venue switcher is `hidden lg:flex`; there's no mobile menu. On a phone a manager can't get between views. | `Navbar.jsx:73,120` | Most of your users are on phones. |
| F5 | **Demo credentials (including the admin password) show on the login page** for everyone. | `LoginPage.jsx:301` | Anyone can log in as admin on the dev site. |
| F6 | `GET /api/users?role=` filters on `role.upper()`, but roles are stored lowercase, so it always returns nothing. | `routers/users.py:119` | Latent; breaks any future "pick a worker" UI. |
| F7 | A shift swap can be offered to **any worker on the platform**, not people who work at that venue or do that role. | `routers/transfers.py:404` | A server could hand an AV shift to a stranger. |
| F8 | Clock-in is allowed any time (days early), and `/check-in` claims GPS validation but ignores the coordinates. | `routers/shifts.py:381,545` | Payroll and reliability data can't be trusted. |

**Recommendation:** ship F1–F7 as one small **Phase 24 "Hardening"** before adding features. No schema change except F1's defaults. F8 folds into the geofence phase.

---

## 2. What the audience needs (and what's missing today)

### Workers (phone-first, busy, not tech people)
- **"Where am I going and when?"** There's no "next shift" card, no map link, no parking, entrance or dress-code instructions, and times show in the phone's timezone, not the venue's.
- **Plain language.** Labels like "Auto-Confirm Engine Eligible", "Transfer" and "Whitelist" mean nothing to a bartender. Use "Instant booking", "Needs manager OK", "Give away / Swap", "Your team".
- **Profile.** No page exists to set phone, positions they work, or certifications (TIPS, ServSafe, food handler, with expiry dates).
- **Money.** Hours worked and estimated earnings per week (rate × hours, with a tips-eligible note).
- **Getting told things.** Nothing notifies a worker when they're approved, a shift changes, or it's cancelled.

### Venue managers
- **Can't edit or cancel a posted shift.** A typo in the rate or a cancelled event means deleting nothing and emailing people. There's no edit, cancel or remove-worker action anywhere in `shifts.py`.
- **Retyping every event.** No "duplicate last Friday" and no weekly repeat.
- **Position list is hard-coded** (Bartender, Server, Dishwasher, Barback, AV Tech) in 4 files. Each venue needs its own positions with default rates and tips settings, so "Bartender = $30 + pooled tips" is filled in automatically.
- **Can't fix time sheets.** Someone forgets to clock out, and payroll shows "Did not clock out" with no way to correct it or mark a no-show.
- **No "my team".** The whitelist backend exists, but there's no screen for it, and no way to invite a worker by link or QR code, rate someone after a shift, or block a bad actor.
- **Can't edit their own venue** (address, instructions, approval policy). The backend has `PUT /venues/{id}/settings`, but there's no UI.

### Platform admin (you)
- **Venues aren't editable in the Admin Panel** (create and delete only), and there's no map pin. Every venue defaults to NYC coordinates (`VenueCreate` lat/lng), so geofencing can't work.
- No overview of what needs attention: unfilled shifts in the next 48h, pending requests older than X hours, workers with low reliability.

---

## 3. Proposed phases (in order)

Each phase is sized for one AGY prompt. ⚠️ means a schema change (`docker compose down -v`).

### Phase 24 — Hardening (no schema wipe)
F1–F7 above.
- Change the auto-approve default to **off** (`NULL`) and make new-worker ratings start unset, so the rating rule only applies once ratings exist.
- Remove the default manager password: use an invite / "set your password" flow, or require an existing user.
- Add a mobile hamburger menu.
- Show demo credentials only when `SHOW_DEMO_LOGINS=true` (a new setting in `.secrets`).
- Limit swap targets to workers on the venue team, or who have worked there before, and who aren't double-booked.

### Phase 25 — Venue profiles & positions ⚠️
**Venue becomes fully editable** by admins (Admin Panel → Venues → Edit) and by its managers (a Venue Settings tab on the dashboard).
- **New venue fields:**
  - `timezone` (e.g. `America/New_York`)
  - `phone`
  - `arrival_instructions` (parking, which door)
  - `dress_code`
  - `default_notes`
  - `approval_policy` (VARCHAR: `manual` | `team_auto` | `everyone_auto`), which replaces the confusing rating threshold for most venues
- **Location:** a "Use my current location" button sets lat/lng while the manager is on site (no geocoding API needed), plus manual lat/lng fields.
- **New `venue_positions` table:** `venue_id`, `name`, `default_rate`, `tips_eligible`, `tip_pool`, `is_active`. The Create Shift modal's role dropdown reads from it and pre-fills rate and tips. Seed the current 5 roles for existing venues.
- All shift times display in the **venue's timezone**.

### Phase 26 — Shift lifecycle for managers ⚠️ (small: `shifts.cancelled_at`, `cancel_reason`, `event_id`)
- **Edit event:** title, times, notes. **Edit position:** rate, capacity, tips. You can't lower capacity below the number already assigned.
- **Cancel** a whole event or one position with a reason. Assigned workers see it on their schedule; notifications arrive in Phase 29.
- **Remove a worker** from a shift, with a reason, which frees the spot.
- **Duplicate event** (pick a new date) and **repeat weekly for N weeks**.
- Add a real `event_id` UUID so events stop being grouped by title and times.
- **Time sheet fixes:** managers can edit clock-in/out times, add a missed entry, or mark a no-show. Every edit is audit-logged (`time_entry_edits`: who, when, old/new values).

### Phase 27 — Team, invites & ratings ⚠️ (`venue_invites`, `ratings` already exists)
- **"Your Team" tab** on the venue dashboard: the whitelist, with add/remove, notes, and a block list.
- **Invite link + QR code** per venue (expiring token). A worker scans it, signs up or signs in, and joins that venue's team automatically. It's the easiest onboarding for service staff.
- **Rate after shift:** 1–5 stars plus "would book again", prompted on the roster once a shift ends. This finally feeds `aggregate_rating` and makes the rating rule meaningful.
- Team members are booked instantly when the venue's policy is `team_auto`.

### Phase 28 — Worker experience, mobile-first
- **Bottom tab bar on phones:** Shifts · My Schedule · Swaps · Profile.
- **"Next shift" hero card:** countdown, venue, a map link (`https://maps.google.com/?q=lat,lng`), arrival instructions, dress code, and a big Clock In button.
- **Find Shifts:** group positions by event, filter by venue, date and position, and sort by soonest.
- **Profile page:** name, phone, positions I work, certifications with expiry dates, and a photo (R2 is already configured).
- **Hours & earnings:** this week, last week and pay period, from time entries × rate.
- **Plain-language pass:** rename labels across the Worker and Manager dashboards.
- **Clock-in window:** from 30 minutes before start (a venue setting) until the shift ends.

### Phase 29 — Notifications
- An **in-app notification bell** (`notifications` table ⚠️), plus **email** via SMTP/Resend. SMS or Web Push can come later.
- **Triggers:**
  - request approved or denied
  - shift edited or cancelled
  - removed from a shift
  - swap offered or accepted
  - reminder 24h and 2h before a shift
  - manager: new request pending, no-show at start + 15 min
- A per-user setting for each channel.

### Phase 30 — Waitlist & auto-promotion ⚠️ (existing roadmap)
- "Join waitlist" on full positions. When someone drops or is removed, the next person is offered the spot, with an N-minute hold for manual policies, or booked automatically.

### Phase 31 — Geofenced clock-in (existing roadmap)
- The browser sends coordinates; the backend checks the Haversine distance against `geofence_radius_meters`.
- Needs Phase 25 so venues have real coordinates.
- Managers can override with a reason; the override shows on payroll.

### Later / nice to have
- Admin "needs attention" dashboard: unfilled shifts within 48h, stale requests, low-reliability workers.
- Tip pool entry: the manager enters the total pool per event, and it's split by hours on the payroll CSV.
- Breaks on time entries.
- Payroll export presets (Gusto / ADP column layouts).
- Availability calendar for workers, so managers can see who's free before posting.

---

## 4. Suggested order and why

1. **24 Hardening:** stops silent auto-approval and the security holes before real users arrive.
2. **25 Venue profiles & positions:** unlocks timezones, arrival info, per-venue positions and real coordinates, which Phases 26, 28 and 31 depend on.
3. **26 Shift lifecycle:** the biggest daily pain for managers (edit, cancel, duplicate).
4. **28 Worker mobile experience:** the biggest pain for workers. Can run in parallel with 27.
5. **27 Team, invites & ratings:** makes onboarding easy and gives ratings real meaning.
6. **29 Notifications:** most valuable once edits and cancellations exist.
7. **30 Waitlist**, then **31 Geofence**.

Phases 25–27 each wipe the database. If you'd rather wipe once, 25, 26 and 27's schema changes can be combined into one "schema phase" and built on over later prompts.
