# Phase 13: Core Feature Expansion (Time Tracking, Transfers, and Boards)

This phase implements mission-critical scheduling logic and interactive features. You must adhere to the exact database schemas, API routes, and frontend state structures defined below. Do not modify the existing authentication configuration.

## 1. Double-Booking Prevention (Backend Logic)
Update the existing shift request and auto-approval logic to prevent schedule overlaps.
*   **Target Files:** `backend/src/services/auto_confirm.py` and `backend/src/routers/shifts.py`.
*   **Query Logic:** Before creating an approved `ShiftRequest` or assigning a worker to a `Shift`, execute a SQLAlchemy query checking for overlapping times. The logic must check if the worker has any approved shifts where `(existing_shift.start_time < new_shift.end_time) AND (existing_shift.end_time > new_shift.start_time)`.
*   **Error Handling:** If an overlap is found, abort the transaction and raise an `HTTPException(status_code=400, detail="Worker is already booked for this time slot.")`.

## 2. Hour Tracking & Payroll CSV Export
Implement precise time tracking and a CSV export utility for managers.
*   **Database Schema (`backend/src/models.py`):** 
    *   Create a `TimeEntry` class inheriting from `Base`.
    *   Columns: `id` (UUID, primary key), `worker_id` (UUID, ForeignKey to `users.id`), `shift_id` (UUID, ForeignKey to `shifts.id`), `clock_in_time` (DateTime, timezone=True), `clock_out_time` (DateTime, timezone=True, nullable).
*   **Backend Endpoints (`backend/src/routers/shifts.py` & `venues.py`):**
    *   `POST /api/shifts/{shift_id}/clock-in`: Verify the user is assigned to the shift. Create a new `TimeEntry` setting `clock_in_time` to `datetime.now(timezone.utc)`.
    *   `POST /api/shifts/{shift_id}/clock-out`: Find the active `TimeEntry` for this user and shift. Set `clock_out_time` to current UTC time.
    *   `GET /api/venues/{venue_id}/export-hours`: Query all `TimeEntry` records for the venue. Join with the `User` and `Shift` tables. Use the Python `csv` module and `io.StringIO` to format columns: `Worker Name`, `Shift Date`, `Role`, `Clock In`, `Clock Out`, `Total Hours`. Return a FastAPI `StreamingResponse` with `media_type="text/csv"` and a `Content-Disposition` header specifying the filename.
*   **Frontend UI (`frontend/src/pages/WorkerDashboard.jsx` & `VenueManagerDashboard.jsx`):**
    *   **Worker:** On the "My Schedule" tab, map over confirmed shifts. Render a "Clock In" button. Upon successful API response, swap the button to "Clock Out".
    *   **Manager:** Add a `handleExportCSV` function that fetches the export endpoint and uses `window.URL.createObjectURL(blob)` to trigger a browser file download.

## 3. Worker-to-Worker Shift Transfers
Implement a dual-approval state machine for shift swapping.
*   **Database Schema (`backend/src/models.py`):**
    *   Create a `ShiftTransfer` class.
    *   Columns: `id` (UUID, primary key), `shift_id` (UUID, ForeignKey), `from_worker_id` (UUID, ForeignKey), `to_worker_id` (UUID, ForeignKey), `status` (String, default `"pending_worker_acceptance"`).
*   **Backend Endpoints (`backend/src/routers/transfers.py`):**
    *   `POST /api/transfers/propose`: Accepts `shift_id` and `to_worker_id`. Verifies `from_worker_id` actually owns the shift. Creates the `ShiftTransfer` record.
    *   `POST /api/transfers/{id}/accept`: Updates status to `"pending_manager_approval"`.
    *   `POST /api/transfers/{id}/approve`: Validates the user has `venue_manager` role. Updates status to `"approved"`. Reassigns the `shift_id` to `to_worker_id` in the shifts table. Deletes or modifies the original `ShiftRequest`.
*   **Frontend UI:**
    *   Create a new component `TransferModal.jsx`. Allow a worker to select a confirmed shift and select a peer from a dropdown of eligible venue workers.
    *   Add a "Pending Transfers" section to the WorkerDashboard for accepting/rejecting incoming offers.
    *   Add a "Transfer Approvals" section to the VenueManagerDashboard mapping over transfers with the `pending_manager_approval` status.

## 4. Event-Specific Discussion Boards
Create an access-controlled forum for shift communication.
*   **Database Schema (`backend/src/models.py`):**
    *   Create a `ShiftBoardMessage` class.
    *   Columns: `id` (UUID, primary key), `shift_id` (UUID, ForeignKey), `author_id` (UUID, ForeignKey), `content` (Text), `created_at` (DateTime, default UTC now).
*   **Backend Endpoints (`backend/src/routers/shifts.py`):**
    *   `GET /api/shifts/{shift_id}/messages`: Returns a list of messages. **Authorization:** Query the DB to ensure `current_user.id` is assigned to the shift, OR `current_user.role == "venue_manager"` and they manage the parent venue. Return 403 Forbidden otherwise.
    *   `POST /api/shifts/{shift_id}/messages`: Accepts a `content` string. Enforces the same authorization check before saving.
    *   `DELETE /api/messages/{message_id}`: Allows Venue Managers to delete any message.
*   **Frontend UI (`frontend/src/components/ShiftBoard.jsx`):**
    *   Create a reusable component receiving `shiftId` as a prop.
    *   State: `messages` (array), `newMessage` (string).
    *   Use a `useEffect` hook to fetch messages on mount. 
    *   Render a chronological list of messages. If the decoded JWT role is `venue_manager`, conditionally render a "Delete" icon next to each message payload.