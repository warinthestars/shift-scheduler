# Phase 19: Secrets Tracking & Core Feature End-to-End Implementation

Our foundation is stable. Do NOT modify, refactor, or reconfigure any existing authentication, JWT, or login logic during this phase. 

Your objective is to fix a Git tracking issue and fully implement the end-to-end functionality (Backend API + Frontend UI) for Hour Tracking/Payroll, Shift Transfers, and Event Discussion Boards. Follow these explicit, file-by-file instructions.

## 1. Fix Secrets Tracking (`.gitignore`)
The `.secrets` folder is currently ignored, meaning our `.secrets.env.template` is not being tracked in version control.
*   Open `.gitignore`.
*   Locate the rule ignoring the secrets directory (e.g., `.secrets/` or `*.secrets`).
*   Update it to explicitly allow the template file by adding this exact sequence:
    ```text
    .secrets/*
    !.secrets/*.template
    !.secrets/.secrets.env.template
    ```

## 2. Hour Tracking & Payroll CSV Export
Build the manager export utility to calculate hours worked.

**A. Backend Endpoint (`backend/src/routers/venues.py`):**
*   Create a `GET /api/venues/{venue_id}/payroll/export` endpoint.
*   **Authorization:** Ensure the user has the `venue_manager` or `platform_admin` role.
*   **Query Logic:** Join `TimeEntry`, `User` (Worker), and `Shift`. Filter by `Shift.venue_id == venue_id`. 
*   **Data Processing:** Iterate through the records. Calculate the duration: `hours = (clock_out_time - clock_in_time).total_seconds() / 3600`. If `clock_out_time` is null, output "Did not clock out" or `0`.
*   **Response:** Use Python's `csv` module and `io.StringIO()` to write columns: `Worker Name, Email, Shift Title, Date, Clock In, Clock Out, Total Hours`. Return a FastAPI `StreamingResponse` with `media_type="text/csv"` and headers `{"Content-Disposition": "attachment; filename=payroll.csv"}`.

**B. Frontend UI (`frontend/src/pages/VenueManagerDashboard.jsx`):**
*   Add a "Download Payroll CSV" button at the top of the dashboard.
*   Create an `exportPayroll` function that uses Axios to fetch the endpoint with `responseType: 'blob'`. 
*   Create a temporary `<a>` element using `window.URL.createObjectURL(new Blob([response.data]))`, set the `download` attribute to `payroll.csv`, and programmatically click it to trigger the browser download.

## 3. Worker-to-Worker Shift Transfers
Complete the UI and logic for the dual-approval transfer system.

**A. Backend Endpoints (`backend/src/routers/transfers.py`):**
*   Ensure `POST /api/transfers/propose` validates that `from_worker_id` owns the shift, and sets status to `"pending_worker_acceptance"`.
*   Ensure `POST /api/transfers/{id}/accept` verifies `current_user.id == to_worker_id` and updates status to `"pending_manager_approval"`.
*   Ensure `POST /api/transfers/{id}/approve` verifies the manager, updates status to `"approved"`, and safely updates the `worker_id` on the original `ShiftRequest` or `ShiftAssignment` row.

**B. Frontend UI - Worker (`frontend/src/pages/WorkerDashboard.jsx`):**
*   Create a `TransferModal.jsx` component. When a worker clicks "Transfer" on a confirmed shift, open this modal. Fetch a list of eligible workers for that venue (`GET /api/venues/{id}/workers`) and render a dropdown to select the target worker. Submit via the `/propose` endpoint.
*   Add an "Incoming Transfers" section to the dashboard UI. Fetch `/api/transfers/my-incoming` and render cards showing the shift details, who offered it, and green/red "Accept" and "Decline" buttons.

**C. Frontend UI - Manager (`frontend/src/pages/VenueManagerDashboard.jsx`):**
*   Add a "Pending Transfers" queue to the dashboard. Fetch transfers with `"pending_manager_approval"`.
*   Render cards showing "Worker A wants to transfer [Shift Name] to Worker B." Include "Approve" and "Deny" buttons.

## 4. Event-Specific Discussion Boards
Build the isolated forum for shift communication.

**A. Backend Endpoints (`backend/src/routers/shifts.py`):**
*   `GET /api/shifts/{shift_id}/messages`: Query `ShiftBoardMessage` joined with `User` (to get the author's name/avatar). Order by `created_at` ASC.
*   `POST /api/shifts/{shift_id}/messages`: Insert a new message.
*   **Strict Authorization:** For both routes, verify `current_user` is either assigned to the shift, OR is a manager of the shift's venue.

**B. Frontend UI (`frontend/src/components/ShiftBoard.jsx`):**
*   Build a reusable chat/forum component using Tailwind.
*   **Props:** `shiftId` and `currentUserRole`.
*   **Layout:** A scrollable `div` for the message history and a fixed input bar at the bottom with a "Post" button.
*   **Logic:** Fetch messages on mount. When posting, append the new message to the local state immediately upon a successful 200 OK response. 
*   **Moderation:** If `currentUserRole === 'venue_manager'`, render a small "Trash" icon next to every message to hit a `DELETE` endpoint. 
*   Embed this component inside a slide-out drawer or modal accessible from both the `WorkerDashboard` and `VenueManagerDashboard` when viewing shift details.