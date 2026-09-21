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

Core API Endpoints:

GET/PUT /api/users/profile (Worker profile, experience, rating).

CRUD /api/venues (Manage venues, accessible by Admin/Venue Managers).

CRUD /api/shifts (Post and view shifts).

POST /api/shifts/{id}/request (Request a shift).

The Auto-Confirm Engine: Implement the logic in the shift request endpoint:

Check if shift is auto-confirm -> assign.

Check if user is on venue whitelist -> assign.

Check if user rating >= venue auto-approve threshold -> assign.

Else -> set status to pending.

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

Output Requirements:
Provide the complete code for the backend auth implementation (including the mock Firebase middleware), the database seeding logic, the React auth context, and the converted React components for the Worker Dashboard. Ensure instructions are clear on how to start the stack and log in as the demo admin.