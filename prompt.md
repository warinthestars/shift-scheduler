Phase 2: Core Application Development & Authentication

Context:
You have previously set up the infrastructure, Docker compose network, and database schema for "ShiftBoard". We are now moving to the application layer. The goal of this phase is to deliver a fully functional Minimum Viable Product (MVP) running locally. We are currently mocking external services (like Firebase) to facilitate easy sharing and testing with collaborators.

Tech Stack Confirmation

Frontend: React (using Vite), styled with Tailwind CSS.

Backend: Python (FastAPI) OR Node.js (Express) - pick one and stick to it strictly.

Database Interface: Prisma (if Node) or SQLAlchemy (if Python) connecting to the local PostgreSQL container.

Task 1: Environment Variables & Super Admin

Update the previously created .env.template and .secrets/.secrets.env files (or instruct on how to update them) to include:

SUPER_ADMIN_USERNAME=demo_admin@shiftboard.local (in backend .env.template)

SUPER_ADMIN_PASSWORD=SuperSecretDemo123! (in .secrets/.secrets.env template)

USE_MOCK_FIREBASE=true (in backend .env.template)

JWT signing secrets for local auth.

Task 2: Backend Development & Authentication Strategy

Scaffold the backend service inside the /backend directory.

Database Connection: Connect to the local PostgreSQL database using the provided Docker credentials.

Authentication System:

Local Auth (Primary): Implement a standard email/password login returning a JWT.

Firebase Auth (Mocked): Create a middleware intended for Firebase JWT validation. If USE_MOCK_FIREBASE=true, this middleware should accept a dummy token (e.g., "mock-firebase-token-123") and automatically resolve it to a mock user in the database. This stubs out the functionality for future integration.

Super Admin Seeding: Create a startup script or lifecycle event in the backend. On startup, it must check the database for the user defined by SUPER_ADMIN_USERNAME. If it doesn't exist, create it with the SUPER_ADMIN_PASSWORD (hashed) and assign it the highest platform admin privileges.

Task 3: Frontend Development

Scaffold a React application inside the /frontend directory using Vite.

Routing & Auth State: Set up React Router. Create a global Authentication Context that handles local login and the mocked OAuth state.

Views to Build:

Login/Register Page: Support standard email/password inputs. Include a distinct "Sign in with Google (Demo)" button that passes the dummy token to the mocked Firebase backend endpoint.

Worker Dashboard: Convert the provided HTML/CSS mockup (Worker Dashboard Mockup) into React components (use Tailwind CSS). Ensure the shift counts and available statuses update dynamically based on API responses.

Super Admin Panel: A basic view restricted to the Super Admin role to create/manage Venues and assign Venue Managers.

API Integration: Create an Axios or Fetch interceptor that automatically attaches the correct auth token to every outbound request to the backend.

Task 4: Docker Execution

Ensure the frontend/Dockerfile and backend/Dockerfile are set up to run development servers (e.g., npm run dev or uvicorn --reload) so hot-reloading works while the containers are running via docker-compose up.

Phase 3: Comprehensive API Implementation & Venue Management

Context:
Now that authentication and basic routing are established, we need to build the full backend CRUD API and database relations to support the actual business logic of ShiftBoard. We need a robust account system that differentiates between standard Workers, Super Admins, and a new "Venue Account" structure.

Task 1: Database Schema Expansion

Expand the Prisma or SQLAlchemy schema to include the following entities and relations:

Users: Must include email, password_hash, role (enum: SUPER_ADMIN, VENUE_MANAGER, WORKER). For Workers, include profile data fields (e.g., aggregate_rating (float), total_shifts (int), avatar_url, bio).

Venues: The physical location. Must include name, address, lat, lng, geofence_radius_meters, and auto_approve_rating_threshold (e.g., 4.5).

VenueManagers (Relation): A mapping table linking a User (with VENUE_MANAGER role) to one or more Venue entities.

VenueWhitelist (Relation): A mapping table linking a Venue to specific trusted Users (Workers).

Shifts: Must include venue_id, title (e.g., "Saturday Night Concert"), role_type (e.g., "Bartender"), start_time, end_time, capacity (int), and is_shift_auto_confirm (boolean).

ShiftRequests: Links a User to a Shift. Must include status (enum: PENDING, APPROVED, REJECTED, CHECKED_IN, COMPLETED).

Task 2: Auth & Profile API Endpoints

Implement the following controllers/routers:

POST /api/auth/register: Allow creating both Worker and Venue Manager accounts.

POST /api/auth/login: Validate credentials and return a JWT containing the user's ID and Role.

GET /api/users/me: Return the logged-in user's profile and experience history.

PUT /api/users/me: Allow updating bio, avatar (placeholder for R2), and basic info.

Task 3: Venue Management API

POST /api/venues: Create a new Venue profile (Accessible by Super Admin, or by a newly registered Venue Manager).

GET /api/venues/{id}: Retrieve venue details.

PUT /api/venues/{id}/settings: Update the auto_approve_rating_threshold and geofence parameters.

POST /api/venues/{id}/whitelist: Add a worker's user ID to this venue's auto-approve whitelist.

Task 4: Shifts & Auto-Confirm Engine

POST /api/shifts: Allow Venue Managers to create shifts for their assigned venues.

GET /api/shifts: Allow Workers to fetch available shifts. Include query parameters to filter by role, date, and venue.

POST /api/shifts/{id}/request: CRITICAL LOGIC. When a worker requests a shift, execute the Auto-Confirm Engine:

Check if the specific shift has is_shift_auto_confirm == true. If so, approve.

Check if the requesting user is in the VenueWhitelist. If so, approve.

Check if the requesting user's aggregate_rating >= the Venue's auto_approve_rating_threshold. If so, approve.

If none of the above, set the ShiftRequest status to PENDING.

PUT /api/shifts/requests/{request_id}: Allow Venue Managers to manually update a pending request to APPROVED or REJECTED.

Output Requirements:
Provide the complete schema file (e.g., schema.prisma or models.py), the controller/router code for the API endpoints, and the specific service function that handles the Auto-Confirm Engine logic. Ensure all routes are protected by role-based authorization middleware based on the JWT.