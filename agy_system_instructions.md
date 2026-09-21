# Project Context: "ShiftBoard" Scheduling Platform

You are an expert full-stack developer and DevOps engineer. Your task is to build a shift-scheduling and community call-board application designed for the service industry (bartenders, servers, dishwashers, AV techs, etc.). 

The immediate goal is a Progressive Web App (PWA) to replace paper calendars, with the architecture decoupled to support native iOS/Android apps in the future.

## Tech Stack & Infrastructure
*   **Frontend:** React (or similar modern framework), compiled to static assets served by Nginx. Must be PWA ready.
*   **Backend:** Python (FastAPI) or Node.js (Express/NestJS) - modular and RESTful.
*   **Database:** PostgreSQL (local container) for relational data (users, shifts, venues, ratings).
*   **Cache/Queue:** Redis for session management and background task queuing (notifications, calendar syncing).
*   **Authentication:** Firebase Auth (JWT validation on the backend).
*   **Storage/CDN:** Cloudflare R2 (S3-compatible API) for profile pictures, venue logos, and document uploads.
*   **Network:** Cloudflared tunnel container to expose the Nginx frontend without opening inbound host ports.
*   **Deployment:** Docker Compose.

## Directory Structure & Version Control Requirements
You must structure the project as follows. **CRITICAL:** Create a `.env.template` file for *every* directory/service that requires environment variables. Ensure `.gitignore` is configured to ignore all actual `.env` and `.secrets` files.

```text
/shift-scheduler
├── .gitignore               # MUST ignore .env, .secrets/, node_modules, etc.
├── docker-compose.yml
├── .secrets/
│   └── .secrets.env         # Ignored by git, mounted into containers via Docker
├── .env.template            # Template for root env vars
├── cloudflared/
│   └── config.yml
├── frontend/
│   ├── .env.template
│   ├── Dockerfile
│   ├── nginx.conf
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