# Phase 6: Networking, Proxying, and Docker Build Stabilization

The backend is dropping requests, resulting in an "empty response." This is likely due to the backend container crashing when attempting to utilize the newly added cryptography libraries, or CORS/networking mismatches. We need to stabilize the Docker configuration and implement a proper API reverse proxy.

## 1. Backend Dockerfile & Dependencies
The addition of `passlib[bcrypt]` and `python-jose[cryptography]` often causes crashes if the underlying OS lacks build tools.
*   Update `backend/Dockerfile` to use a standard slim image (e.g., `FROM python:3.11-slim`).
*   Add a step to install essential build dependencies before running `pip install`. Add: `RUN apt-get update && apt-get install -y gcc libffi-dev build-essential`
*   Ensure the `CMD` or `ENTRYPOINT` starts Uvicorn correctly on `0.0.0.0:8000`.

## 2. API Routing & Nginx Reverse Proxy
The frontend must not hardcode `http://localhost:8000`. It should use relative paths and rely on a proxy.
*   **Vite Dev Server (`frontend/vite.config.js`):** Configure the Vite development server to proxy all requests starting with `/api` to `http://backend:8000`.
*   **Nginx Production Server (`frontend/nginx.conf`):** Update the Nginx configuration to include a `location /api/ { proxy_pass http://backend:8000/api/; }` block. Ensure standard proxy headers (`X-Real-IP`, `X-Forwarded-For`) are passed.
*   **Frontend API Client (`frontend/src/api/client.js`):** Change the `baseURL` from `http://localhost:8000` to an empty string `""` or simply use relative paths like `/api/auth/login` in your axios instances.

## 3. CORS Configuration (`backend/src/main.py`)
*   Ensure the FastAPI CORS middleware in `main.py` is configured to allow `origins=["*"]` (or explicitly `"http://localhost"`, `"http://localhost:5173"`) with `allow_credentials=True`, `allow_methods=["*"]`, and `allow_headers=["*"]`.

Rebuild the containers using the new Dockerfile specifications and verify that the frontend routes API calls through the proxy successfully.