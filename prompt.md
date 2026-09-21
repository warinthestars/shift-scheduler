# Phase 5: Dependency Fix & Documentation

## 1. Fix Missing Frontend Dependency
The frontend is failing to compile because `jwt-decode` is imported in `frontend/src/context/AuthContext.jsx` but is missing from the package dependencies.
*   Update `frontend/package.json` to include `"jwt-decode": "^4.0.0"` (or the latest stable version) in the `dependencies` object.
*   Ensure that the `frontend/Dockerfile` runs `npm install` so that rebuilding the container will properly install this new dependency.

## 2. Project Documentation (`README.md`)
Create a comprehensive `README.md` at the root of the repository (`/shift-scheduler/README.md`) to document the purpose, architecture, and setup instructions for this application. Structure the README with the following sections:

### A. Project Overview
*   Describe the app: A service-industry shift scheduling platform connecting workers with venues, functioning similarly to a community call board.
*   Mention the eventual goal of transitioning from a Progressive Web App (PWA) to native mobile applications (App Store/Play Store).

### B. Tech Stack & Architecture
*   **Frontend:** React (Vite), Tailwind CSS, Nginx PWA.
*   **Backend:** Python, FastAPI, SQLAlchemy (PostgreSQL).
*   **Authentication:** Dual-system supporting local email/password (with bcrypt hashing) and a mock Firebase setup for development. 
*   **Infrastructure:** Docker Compose (bare-metal host), Redis (caching/queues), Cloudflare Tunnels (secure external access), and Cloudflare R2 (CDN/Storage).

### C. Role & Permission Matrix
Briefly define the three core roles and their capabilities:
1.  **Platform Admin:** Global oversight and Venue provisioning.
2.  **Venue Manager:** Shift creation, roster management, manual request approvals, and worker whitelisting.
3.  **Worker:** Shift filtering/requesting, GPS-based check-in/out, and shift swapping.

### D. Local Development Setup
Provide clear, step-by-step instructions for a new developer to spin up the project locally:
1.  Copying `.env.template` and `.secrets/.secrets.env.template` to their actual `.env` and `.secrets.env` counterparts.
2.  Running `docker compose up --build` to start the application.
3.  Logging in with the default seeded super-admin and worker credentials.

Make the README highly professional, using Markdown tables for the Role Matrix and code blocks for the terminal commands.