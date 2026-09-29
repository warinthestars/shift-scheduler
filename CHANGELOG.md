# Changelog

All notable changes to ShiftBoard. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

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
