# Project Context: "ShiftBoard" Scheduling Platform

You are an expert full-stack developer and DevOps engineer. Your task is to build a shift-scheduling and community call-board application designed for the service industry (bartenders, servers, dishwashers, AV techs, etc.). 

The immediate goal is a Progressive Web App (PWA) to replace paper calendars, with the architecture decoupled to support native iOS/Android apps in the future.

## Tech Stack & Infrastructure
*   **Frontend:** React, served by the Vite dev server (hot reload) behind the Cloudflare tunnel. Must be PWA ready. It reads NO `VITE_` variables (see Configuration rules below).
*   **Backend:** Python (FastAPI) or Node.js (Express/NestJS) - modular and RESTful.
*   **Database:** PostgreSQL (local container) for relational data (users, shifts, venues, ratings).
*   **Cache/Queue:** Redis for session management and background task queuing (notifications, calendar syncing).
*   **Authentication:** Firebase Auth (JWT validation on the backend).
*   **Storage/CDN:** Cloudflare R2 (S3-compatible API) for profile pictures, venue logos, and document uploads.
*   **Network:** Cloudflared tunnel container to expose the frontend without opening inbound host ports.
*   **Deployment:** Docker Compose.

## Directory Structure & Version Control Requirements
You must structure the project as follows. **CRITICAL:** Create a `.env.template` file for *every* directory/service that requires environment variables. Ensure `.gitignore` is configured to ignore all actual `.env` and `.secrets` files.

```text
/shift-scheduler
├── .gitignore               # MUST ignore .env, .env.*, .secrets/* (NOT ".secrets/"), node_modules, etc.
├── docker-compose.yaml      # reads .env + .secrets/stack.env + .secrets/integrations.env. No container names, no fixed ports (Phase 35.4)
├── docker-compose.demo.yaml # optional separate demo copy of the stack (Phase 35.3)
├── docs/DEPLOYMENT.md       # deploying with or without demo data
├── deploy_test_data.sh      # runs the demo data loader's Docker commands (LF line endings)
├── deploy_test_data.ps1     # the same for Windows PowerShell; keep the two in step
├── .env                     # ordinary settings, NO secrets. Ignored by git.
├── .env.template            # documents every ordinary setting
├── .secrets/
│   ├── stack.env                       # ignored; stack secrets (database, redis, cloudflared, backend)
│   ├── integrations.env                # ignored; outside-service keys (backend only)
│   ├── *.template                      # tracked; document the two files above
│   ├── firebase-web-config.js          # ignored; mounted read-only into the backend
│   └── firebase_service_account.json   # ignored; mounted read-only into the backend
├── scripts/
│   └── consolidate_env.py   # one-time sort of older settings files into the three files
├── cloudflared/
│   └── config.yml
├── frontend/
│   ├── .env.template        # explains that the frontend needs no settings
│   ├── Dockerfile
│   └── src/ 
├── backend/
│   ├── .env.template
│   ├── Dockerfile
│   └── src/
├── database/
│   └── init.sql             # DB Schema definitions
└── redis/
    └── redis.conf
```

## Core Features & Business Logic

### 1. User Roles
*   **Platform Admin:** Manages system, adds new venues.
*   **Venue Manager:** Posts shifts, manages venue profile, reviews applicants, rates workers, manages whitelist.
*   **Worker:** Subscribes to shift types/locations, applies for shifts, checks in/out (geolocation), manages personal profile.
*   **Owner (Phase 36):** a manager account that owns an organization (a group of venues). Manages every venue in it. Not a `users.role` value: a row in `organization_members`.
*   **Shift lead (Phase 36):** a worker marked shift lead on a venue's team (`venue_whitelists.is_lead`). Runs the floor (clock-ins, no-shows, clock times, shift chat, open spots). Never sees pay. Not a `users.role` value.

### 2. Worker Profiles & Ratings
*   Workers have profiles showcasing their total shifts worked, past venues, and an aggregate 5-star rating.
*   After a shift, Venue Managers rate the worker. This rating affects their platform-wide aggregate.

### 3. Shift Approval Hierarchy (The Auto-Confirm Engine)
When a Worker requests an open shift, the system must evaluate the following conditions in order:
1.  **Shift-Level Auto-Confirm:** Did the venue set this specific shift to "Auto-Confirm anyone"? If yes -> **APPROVED**.
2.  **Venue Whitelist:** Is the Worker on this specific Venue's customized whitelist (trusted workers)? If yes -> **APPROVED**.
3.  **Rating Threshold:** Does the Worker meet the Venue's global auto-approval minimum rating (e.g., Venue auto-approves all >= 4.5 star workers)? If yes -> **APPROVED**.
4.  **Fallback:** If none of the above are true -> **PENDING** (Requires manual Venue Manager approval).

### 4. Shift Swaps & Tracking
*   **Swaps:** Workers can request shift swaps. Venue managers must approve these unless a specific bypass rule is configured.
*   **Check-in/out:** UI must include a check-in/out button. The frontend will capture GPS coordinates, and the backend will validate it against the Venue's geofence radius.

## Initial Tasks for AGY:
1.  Generate the `docker-compose.yml` defining all services, networking, and secret handling.
2.  Create the `.gitignore` and all `.env.template` files with placeholder variables (including Firebase, Cloudflare R2 S3 endpoints/keys, Postgres credentials).
3.  Generate the `init.sql` schema to support the Users, Venues, Shifts, ShiftRequests, Whitelists, and Ratings tables.
---

## Standing rules (added in Phase 34.5, apply to every phase)

**CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this.**

How to follow it:
1. **Which number:** while pre-1.0 the version follows the phase: Phase N → `0.N.0`, Phase N.x → `0.N.x`; a third level (N.x.y) takes the next patch number. If the phase prompt names the version, use exactly that one.
2. **Both places, same number:** `frontend/package.json` → `"version"` AND `backend/src/version.py` → `APP_VERSION`. Admin → System warns when they differ.
3. **CHANGELOG.md:** add the new section at the TOP (under the intro), as `## [x.y.z] - YYYY-MM-DD - Phase N: title`, with bullets under Added / Changed / Fixed / Removed. Never edit older sections.
4. **README.md:** update it when the architecture, roles, rules, configuration or setup changed. Otherwise leave it.
5. Do this only after the phase's own changes are complete and verified, and include these files in your summary of changed files. The frontend container must be restarted to show a new version (Vite reads package.json at start).

The project rules that always apply are in README.md → "Working on the code" (no native PostgreSQL ENUMs, locked sign-in files, timezone-aware UTC, schema changes in models.py AND database/init.sql, Event → Shift → Position wording).

## Configuration rules (added in Phase 35.1, updated in 35.1.1; apply to every phase)
1. **Three settings files:** `.env` (ordinary settings, NO secrets), `.secrets/stack.env` (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SECRET_KEY`, `SUPER_ADMIN_PASSWORD`, `TUNNEL_TOKEN`), `.secrets/integrations.env` (keys for outside services). `database`, `redis` and `cloudflared` read ONLY `stack.env`; the backend reads all three; the frontend reads none. Never add other `env_file` entries.
2. **Never put a secret in `${...}` in `docker-compose.yaml`** (Compose reads `${...}` only from `.env`). Containers get secrets through `env_file`; if a command needs one, use the container's shell with `$$VAR`.
3. **A new setting** goes in `backend/src/config.py` AND in the right template: `.env.template` if it isn't secret, `.secrets/stack.env.template` if the stack needs it, `.secrets/integrations.env.template` for an outside service's key. Update the README Configuration table.
4. **Never read, print or commit real `.env` / `.secrets` contents.** Only templates hold example values.
5. **The frontend has no settings.** Don't add `VITE_` variables or Docker build args unless a phase explicitly asks; the Firebase web config comes from the backend (`GET /api/auth/firebase-config`).
6. **Don't touch `.secrets/*` in `.gitignore`** (ignoring `.secrets/` itself untracks the templates).
7. Changing settings needs `docker compose up -d --force-recreate`, NOT `down -v` (that deletes the database).
8. **Demo data (Phase 35.3):** `backend/src/demo_data.py` builds the full demo data set with the models. When a phase adds a table or a required column, update it in the same phase so `python -m src.demo_data load` still works. Demo accounts always end in `@demo.example.com`; never give them real addresses. `deploy_test_data.sh` (bash) and `deploy_test_data.ps1` (PowerShell) run the loader and must behave the same: a change to one goes into the other in the same phase.
9. **Several stacks on one computer (Phase 35.4):** dev and prod run side by side from two folders, kept apart by the stack name (`COMPOSE_PROJECT_NAME` in each folder's `.env`; not set = the folder's name) and by their own ports.
   * Never add `container_name:` to a service, and never add a top-level `name:` or a `name:` under a network or volume in a compose file.
   * Never write a fixed number on the left side of a `ports:` line. A new published port is a `${NAME:-default}` setting, documented in `.env.template`.
   * Never rename a service, the network or a volume: the database volume is found by `<stack name>_postgres_data`.
   * Refer to a container as `docker compose exec <service>`, never by a container name.
   * Never run `docker compose` yourself on this computer: a command in the wrong folder acts on the wrong stack.
10. **Roles and access (Phase 36):** `users.role` has exactly three values: `platform_admin`, `venue_manager`, `worker`. Never add a fourth. Owner and shift lead are memberships, not roles.
   * **Owners:** `organization_members` (role `owner`). An owner manages every venue in the organization through ordinary `venue_managers` rows with `via_org = TRUE`. Only `services/organizations.sync_managers()` creates or deletes those rows. Call it, before the commit, whenever an owner or a venue is added to or removed from an organization, an organization is deleted, or a user's role changes. Never write `via_org` rows by hand anywhere else (the demo loader is the one exception, and its rows must match what the sync would make).
   * **Shift leads:** `venue_whitelists.is_lead`. Use `services/access.floor_access()` for "manager or shift lead"; use the existing manager checks for everything else. A new endpoint is manager-only unless the phase says leads may use it.
   * **Shift leads never see pay.** Nothing a lead can call may return a pay rate, tip, cost or earnings. What a lead reads lives in `routers/lead.py`, with response models that have no pay fields. Never return a manager schema (`EventTimesheet`, `EventDetail`, `ShiftRosterResponse`, ...) from an endpoint a lead can call, and never open a manager read endpoint to leads.
   * There is no venue sign-up: only platform admins create organizations and put venues in them.
11. **The public board (Phase 36):** `PUBLIC_EVENT_BOARD=true` makes the home page a public board for people who aren't signed in. `routers/public.py` is the ONLY place for endpoints that need no sign-in (besides sign-in itself, invites and avatars).
   * `GET /api/public/board` returns only: event id, title, start and end, time zone, venue name, city, and positions with open spots. Never add pay, addresses, coordinates, notes, location names, requirements, logos, venue ids or anyone's name to it.
   * Every other endpoint must depend on `get_current_user` (directly or through a `require_...` dependency). A new endpoint with no sign-in needs the user's explicit OK.
   * The frontend learns the setting from `GET /api/public/config` (`utils/publicConfig.js`). No `VITE_` variable.