# Changelog

All notable changes to ShiftBoard. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.6] - 2026-10-04 - Phase 35.4: Dev and prod stacks on one computer

### Changed
- **`docker-compose.yaml` no longer gives containers fixed names.** Compose names them `<stack name>-<service>-1` and puts the stack name in front of the network and the volumes, so several stacks can run on one computer.
  - The stack name is `COMPOSE_PROJECT_NAME` in `.env`. Not set = the folder's name, as before, so an existing stack keeps its database volume.
  - After updating, `docker compose up -d` re-creates the containers under their new names. The data is kept.
  - Commands that used a container name (`docker exec shiftboard-backend ...`) become `docker compose exec backend ...`.
- The web app's second port on your computer (5173) is now a setting, `PORT_FRONTEND_VITE`, so no port is fixed any more.
- The frontend keeps `shiftboard-frontend` as a name on its own stack's network, so a Cloudflare tunnel that points at that name keeps working.

### Added
- `COMPOSE_PROJECT_NAME` (commented out) and `PORT_FRONTEND_VITE` in `.env.template`.
- `docs/DEPLOYMENT.md`, section E: running two stacks (for example dev and prod) on one computer.

### Fixed
- `docker-compose.demo.yaml` was described in 0.35.4 but missing from the repository, so `--demo-copy` stopped with "docker-compose.demo.yaml is missing". The file is added.

## [0.35.5] - 2026-10-02 - Phase 35.3.1: Demo data script for PowerShell

### Added
- **`deploy_test_data.ps1`** in the repository root: the PowerShell twin of `deploy_test_data.sh`, for deploying from Windows (`.\deploy_test_data.ps1 [load | reset | clear | status]`).
  - Same commands, options, checks and messages as the bash script: `--start`, `--demo-copy`, `-y`, and every loader option passed through.
  - Works in Windows PowerShell 5.1 and PowerShell 7, and puts you back in the folder you started in.

### Fixed
- `deploy_test_data.sh` ended with a stray code-fence line, which made bash report a syntax error after a successful load. The line is removed.

### Changed
- `docs/DEPLOYMENT.md`, README and `agy_system_instructions.md` describe both scripts.

## [0.35.4] - 2026-10-02 - Phase 35.3: Demo data and deployment guide

### Added
- **Full demo data loader**, `backend/src/demo_data.py`. Run it in the backend container: `python -m src.demo_data load | reset | clear | status`.
  - It builds five venues set up five different ways, about 115 people, weeks of finished events (clock-ins, late arrivals, no-shows, drops, edited times, tips, ratings, overtime, approved and reopened pay periods), events happening today, and upcoming events with requests, offers, waitlists, cover requests, hand-offs, drafts and templates.
  - Everything is dated from the moment it's loaded; `reset` refreshes it.
  - Demo accounts all end in `@demo.example.com`, share one password (`--password`), and have email and texts off. Loading sends nothing.
  - `clear` removes exactly the demo venues and demo accounts. Nothing else in the database is touched.
  - Options: `--weeks-back`, `--weeks-ahead`, `--seed`, `--password`, `--manager-email` (make an existing manager or admin a manager of every demo venue).
- **`deploy_test_data.sh`** in the repository root: runs the loader's Docker commands for you from any folder (`bash deploy_test_data.sh [load | reset | clear | status]`).
  - It checks Docker and the backend, waits for the database, and asks before `reset` or `clear`.
  - `--start` starts the stack first; `--demo-copy` uses the separate demo copy.
  - `.gitattributes` keeps `*.sh` files on LF line endings so bash can run them on Windows checkouts.
- **`SEED_DEMO_ACCOUNTS`** setting (default `true`). `false` gives a clean install: startup creates only the first admin, with no demo venue, manager or workers.
- **`docker-compose.demo.yaml`**: a separate copy of the stack for demo data, with its own database, on other ports (web app on 5183), no tunnel, and email and texts never sent.
- **`docs/DEPLOYMENT.md`**: deploying clean, with starter accounts, with the full demo data, or with the demo data in a separate copy; snapshots; going from demo to real.

### Changed
- README, `agy_system_instructions.md` and `scripts/consolidate_env.py` refer to `docker-compose.yaml` (the compose file's current name).

## [0.35.3] - 2026-09-29 - Phase 35.2: Tips per event

### Added
- **Tips panel on each event's time sheet** (once the event has started):
  - the tip pool amount, how it's shared (by hours worked or equally) and a note
  - own tips per person (positions marked Tips)
  - each person's pool share and total, live
- **The pool is shared by everyone booked in Tip-pool positions:**
  - By hours: ShiftBoard clock-ins, or scheduled hours for people on the venue's payroll.
  - If nobody has hours yet, it's shared equally.
  - Shares are rounded to the cent and always add up to the pool.
  - No-shows get nothing.
- **Venue settings → Time & pay periods → Tips:**
  - track tips on / off (`venues.tips_enabled`)
  - default split (`tip_pool_split`: hours | equal)
  - whether venue-payroll people share pools (`tip_pool_payroll`)
  - whether workers see their tips (`tips_shown_to_workers`)
- **New table `event_tips`** (one pool per event), plus `shift_requests.tip_amount` and `pay_period_approvals.total_tips`.
- **API:** `GET /api/events/{id}/tips` and `PUT /api/events/{id}/tips`. Managers of the venue and admins only. Changes go in the activity log.
- **Pay periods:** a Tips total, tips per person (including people on venue payroll), and tips in the approval snapshot.
- **Hours download:** three new columns at the end, *Own tips*, *Tip pool share* and *Tips total*, on each shift's first clock-in row. There's a "tips only" row for people with tips but no clock-ins. Earlier columns keep their positions.
- **Worker Hours & pay:** a Tips tile, a Tips list, "+ $x tips" on each shift, and tips in the spreadsheet (a new last column).

### Changed
- An approved (locked) pay period also locks its tips (409 *"… Reopen it on the Pay periods screen to change its tips."*).

## [0.35.2] - 2026-09-28 - Phase 35.1.1: Secrets out of .env

### Changed
- **Settings are split into three files:**
  - `.env`: ordinary settings, no secrets
  - `.secrets/stack.env`: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SECRET_KEY`, `SUPER_ADMIN_PASSWORD`, `TUNNEL_TOKEN`
  - `.secrets/integrations.env`: SMTP / Resend, Twilio, `VAPID_PRIVATE_KEY`, R2 keys
- **Who reads what:** `database`, `redis` and `cloudflared` read only `stack.env`, so they never see integration keys. The backend reads all three; the frontend reads nothing.
- **No secret goes through `${...}` in `docker-compose.yml` any more**, which is what forced secrets into `.env` in 0.35.1:
  - Postgres reads `POSTGRES_PASSWORD` from its env file.
  - Redis gets its password in its own start command, and refuses to start without one.
  - cloudflared reads `TUNNEL_TOKEN` by itself (renamed from `CLOUDFLARE_TUNNEL_TOKEN`).
- The backend builds `REDIS_URL` from `REDIS_PASSWORD` (URL-encoded) unless `REDIS_URL` is set (`backend/src/config.py`). It already built the database address from `POSTGRES_*`. Compose no longer passes `DATABASE_URL` / `REDIS_URL` / `SUPER_ADMIN_*`.
- `scripts/consolidate_env.py` now sorts settings into the three files, from either the 0.35.0 or the 0.35.1 layout. Unknown settings that look secret go to `integrations.env`. Backups are named `*.pre-0.35.2.bak`, and `--undo` restores them.
- Templates: `.env.template` has no secrets; new `.secrets/stack.env.template` and `.secrets/integrations.env.template`.
- `.gitignore`: also ignores `*.bak`.

### Removed
- `.secrets/.secrets.env.template` (replaced by the two new templates).

## [0.35.1] - 2026-09-28 - Phase 35.1: One settings file

### Changed
- **All settings now live in the root `.env`.** `docker-compose.yml` reads only that file: the backend gets all of it (`env_file`, required); `database`, `redis` and `cloudflared` get only the values they need through `${...}`. `backend/.env`, `frontend/.env` and `.secrets/.secrets.env` are no longer read by Docker.
- The backend always reaches PostgreSQL on port 5432 inside the Docker network. `POSTGRES_PORT` is now only the port published on your computer (before, changing it also broke the backend's connection).
- The frontend service no longer gets any environment variables (it never used them).
- Rebuilt every template as accurate documentation of what the app actually reads:
  - `.env.template`: every setting, grouped and explained. `SECRET_KEY` is documented as the login signing key.
  - `backend/.env.template`: only for running the API outside Docker.
  - `frontend/.env.template`: explains that the web app needs no settings.
  - `.secrets/.secrets.env.template`: a secrets-only example for bare-metal servers.
- `.gitignore`: also ignores `.env.local` and `.env.*` (including the `*.pre-0.35.1.bak` backups) in any folder. Templates stay tracked.
- README: the Configuration and Running sections describe the one-file setup.

### Added
- `scripts/consolidate_env.py`: merges the old settings files into the new `.env` once, keeping the values the app was really using, and prints setting names only (never values). Dry run by default; `--apply` writes `.env` and renames the old files to `*.pre-0.35.1.bak`; `--undo` restores them. It warns when `SECRET_KEY` isn't set.

### Removed
- `frontend/nginx.conf` (unused: the frontend runs the Vite dev server).
- The obsolete `version:` line in `docker-compose.yml`.

## [0.35.0] - 2026-09-28 - Phase 35: Venue payroll, staffing companies, overtime and pay periods

### Added
- **Who clocks in where.** Venue settings → **Time & pay periods** → "How your team's time is tracked": team members either clock in with ShiftBoard or are tracked by the venue's own payroll / time clock (`venues.team_time_tracking`).
- **Per person** (Team → Edit): "Use the venue setting", "Venue's payroll" or "Clock in with ShiftBoard" (`venue_whitelists.time_tracking`), plus **Works through** a staffing company (`venue_whitelists.works_through`). Staffing-company people and anyone from outside the team clock in with ShiftBoard by default.
- Bookings record their tracking mode when the shift starts (`shift_requests.time_tracking`, written by the background worker), so settings changes never rewrite past hours.
- **Overtime flags**: weekly limit (default 40 h), optional daily limit, and the work-week start day. Shown on time sheets, pay periods and the hours download (new trailing columns **Regular hours**, **Overtime hours**, **Works through**; existing columns keep their order).
- **Pay periods**: weekly, every two weeks (with a start date), twice a month (1st and 16th) or monthly. A new **Pay periods** screen on the manager dashboard lists each period with people, hours, overtime and pay, a per-person breakdown, a company filter, and a download.
- **Approve and lock** (on by default, `venues.pay_period_approval`): a finished period with no open clock-ins can be approved, which saves a snapshot of its totals (`pay_period_approvals`). While it's approved, adding, editing or deleting times and changing pay rates in it is refused (409). Reopening needs a reason; both are in the activity log.
- API: `GET /api/venues/{id}/pay-periods`, `GET /api/venues/{id}/pay-periods/{start}?company=`, `POST .../{start}/approve`, `POST .../{start}/reopen`. The payroll export takes `company=`.
- Hours download: filter by staffing company.

### Changed
- Payroll-tracked people: no clock-in button ("Clock in with the venue's system"), clock-in is refused by the server with a plain message, no "not clocked in" alerts, a **Venue payroll** state on the Today board (a no-show can still be marked after the start), and a chip on the roster, time sheet and team list.
- Reliability counts a finished payroll-tracked shift as worked and on time unless it's marked a no-show.
- Hours & pay leaves payroll-tracked shifts out of the totals and says how many there were.

## [0.34.6] - 2026-09-28 - Phase 34.6: Venue website

### Added
- Venues have a **Website** (`venues.website_url`, up to 500 characters). Managers set it in Venue settings → Details, under the street address.
- The public venue page shows it next to the address and phone, as a link that opens in a new tab.
- The server tidies what's typed (`hippodrome.com` → `https://hippodrome.com`) and only keeps real `http(s)` web addresses. Anything else is refused with a plain message: `javascript:`, `mailto:`, local or IP-only addresses, or addresses with a user name / password. An empty field clears it.
- `website_url` is included in the venue API responses (`VenueResponse`, `VenueProfileResponse`) and accepted when creating or updating a venue.

## [0.34.0] - Phase 34 Feature Freeze

The first versioned release. It captures the platform as of Phase 34, plus the Phase 34.5 stabilization sprint.

### Platform at the freeze
- **Roles:** Platform Admin, Venue Manager and Worker, with server-side role checks.
- **Sign-in:**
  - email / password (bcrypt + JWT)
  - Google / Firebase sign-in with just-in-time worker accounts
  - always-admin emails
  - invites by email, link, QR code or CSV
- **Events and shifts:**
  - one event holds several shifts, each with its own pay (or a pay range), tips, notes, staff-only notes and approval setting
  - drafts, templates, copies to other dates (series)
  - saved off-site locations
- **Booking:** the auto-confirm engine (the shift's setting, then the venue policy: team, everyone or manual, plus a rating threshold). It also checks:
  - one request per event
  - double-booking
  - certificates, with expiry dates
  - departments
  - availability and time off
- **Workers:**
  - Find shifts, My shifts, Calendar, Hand-offs, Hours & pay
  - clock in / out with an optional server-side location check
  - drop (24 h rule; late drop under 72 h) and ask to come back
  - hand-offs, **cover requests** (team or public board), **waitlists** (auto-book or timed offers)
  - profile: availability, time off, certificates, departments
- **Managers:**
  - Today / This week board
  - requests and hand-off queues
  - assign, offer (first to accept), book back, remove, no-show
  - team management, ratings and reviews, **reliability scores**
  - time sheets with an edit log, hours / payroll CSV in venue time
  - activity log and venue settings
- **Admins:** Overview, Venues, Users, Activity and System tabs, plus a worker view and switching into any venue.
- **Notifications:** in-app, email (console / SMTP / Resend), text (Twilio) and phone / browser push (Firebase Cloud Messaging, or Web Push via VAPID). Quiet hours and digests. PWA install and an offline page.
- **Background worker** (inside the backend, started by the FastAPI lifespan):
  - reminders and alerts
  - auto clock-out
  - cover warnings and the waitlist line
  - delivery with retries
  - a Redis lock and heartbeat

### Added (Phase 34.5 stabilization)
- Semantic versioning.
  - `frontend/package.json` version `0.34.0`, injected into the app by `vite.config.js` as `__APP_VERSION__` (read through `src/utils/version.js`).
  - `backend/src/version.py` holds the server version, also used by the API docs.
  - Admin → System shows both and warns if they differ. Admins see the version next to "Platform admin".
- This changelog.
- Database indexes on `notification_deliveries(notification_id)` and `shifts(status)`, matching the models.

### Changed (Phase 34.5 stabilization)
- `README.md` rewritten for the current system: words we use, roles, features, architecture, the no-ENUM rule, setup, configuration, and the release process.
- UI and messages use one set of words:
  - **Event** is the parent ("Post an event", "Posted events").
  - **Shift** is one role and time block in it ("Add a shift", "Cancel shift", "This shift just filled up").
  - **Position** stays the job type in Venue settings → Positions & pay.
- `notification_preferences.quiet_start` / `quiet_end` are `SmallInteger` in the model, matching the `SMALLINT` columns in `init.sql`.
- `database/init.sql` header states the no-ENUM rule. `docker-compose.yml` documents where the background worker runs.

### Fixed (Phase 34.5 stabilization)
- Clock-in / clock-out with `NaN`, `Infinity` or out-of-range coordinates crashed the server's distance check (500). They're now refused with a clear message (422).

### Removed (Phase 34.5 stabilization)
- `frontend/src/components/ShiftRosterModal.jsx` and `frontend/src/components/manager/TimeOffCard.jsx`: unused (nothing imported them). The manager roster is `EventRosterModal.jsx`.
- The unused SQLAlchemy `Enum` import in `models.py`, so no native ENUM column can be added by accident.
