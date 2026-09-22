# Phase 15: Shift Drop Endpoint Debugging & Transaction Fix

The `POST /api/shifts/{shift_id}/drop` endpoint is returning a 500 Internal Server Error. This indicates a failure in the datetime comparison logic or the database transaction block.

## 1. Datetime Offset Fix (`backend/src/routers/shifts.py`)
*   Locate the 24-hour time constraint check in the drop endpoint.
*   Ensure both the shift's `start_time` and the current time are fully timezone-aware before comparison. If the database returns naive datetimes, apply `.replace(tzinfo=timezone.utc)` to the shift's start time before comparing it to `datetime.now(timezone.utc)`.

## 2. Transaction Error Handling & Validation
*   Wrap the entire database modification block (updating the assignment status and incrementing the shift capacity) in a `try/except Exception as e:` block.
*   Inside the except block, explicitly execute `await db.rollback()`, print the error to the console using `print(f"Drop shift transaction error: {e}")`, and raise an `HTTPException(status_code=500, detail=str(e))`. 
*   Verify that the column names being updated exactly match the attributes defined in `backend/src/models.py`. Confirm the logic is updating the correct status column on the assignment model and incrementing the correct capacity column on the `Shift` model.

# Phase 16: Venue Manager Roster & Calendar Views

The Venue Manager requires a comprehensive scheduling overview to see exactly who is working which shift, featuring both a List View and a Calendar View, with the ability to drill down into a worker's contact and profile information. Execute the following implementation strictly.

## 1. Frontend Dependencies (`frontend/package.json`)
We need a robust calendar library and a date utility to handle the calendar rendering.
*   Run `npm install react-big-calendar date-fns` in the frontend directory.
*   Update `package.json` dependencies to reflect these additions.

## 2. Backend Roster Endpoint (`backend/src/routers/venues.py` & `schemas.py`)
Create a new endpoint that aggregates shift data with the specific details of approved workers. Do NOT expose `hashed_password` or sensitive user data.

**A. Create the Schema (`schemas.py`):**
*   Create a `WorkerContactSchema` inheriting from `BaseModel` containing: `id`, `first_name`, `last_name`, `email`, `phone`, `avatar_url`, and `aggregate_rating`.
*   Create a `ShiftRosterResponse` schema that extends your standard `ShiftResponse` but includes a new field: `assigned_workers: List[WorkerContactSchema]`.

**B. Create the Endpoint (`venues.py`):**
*   `GET /api/venues/{venue_id}/roster`
*   **Authorization:** Ensure `current_user` has the `venue_manager` role and is authorized for `venue_id`.
*   **SQLAlchemy Logic:** 
    1. Query all future and recent past `Shift` records for the `venue_id`.
    2. For each shift, query the `ShiftTransfer`, `ShiftAssignment`, or `ShiftRequest` table (depending on your final schema) to find all records tied to this `shift_id` where the status is strictly `"approved"` or `"confirmed"`.
    3. Join the `User` table to fetch the matching workers' contact details.
    4. Construct and return a list of `ShiftRosterResponse` objects.

## 3. Frontend UI Implementation (`frontend/src/pages/VenueManagerDashboard.jsx`)
Update the manager dashboard to consume the new roster endpoint and render the dual-view interface.

**A. Component State:**
*   `const [viewMode, setViewMode] = useState("calendar")` // Toggles between "list" and "calendar".
*   `const [roster, setRoster] = useState([])` // Holds the data from `/api/venues/{venue_id}/roster`.
*   `const [selectedShift, setSelectedShift] = useState(null)` // Triggers the drill-down modal.

**B. Data Transformation:**
*   Create a `useEffect` hook to fetch `/api/venues/{venue_id}/roster`.
*   Map the returned `roster` data into an array of event objects formatted for `react-big-calendar`. Example format: 
    `{ id: shift.id, title: shift.name, start: new Date(shift.start_time), end: new Date(shift.end_time), resource: shift }`.

**C. Render the Dual Views:**
*   **Toggle Control:** Render a button group at the top of the schedule section to toggle `viewMode` between "Calendar" and "List".
*   **Calendar View (`react-big-calendar`):** When `viewMode === "calendar"`, render the `Calendar` component. Map the `onSelectEvent` prop to `(event) => setSelectedShift(event.resource)`.
*   **List View:** When `viewMode === "list"`, render a Tailwind-styled table grouped by Date. Include columns for Shift Name, Time, Role Requirements, and a "View Staff" button. Map the "View Staff" button's `onClick` to `setSelectedShift(shift)`.

**D. Drill-Down Modal Component (`ShiftRosterModal.jsx`):**
*   Create a modal that renders conditionally when `selectedShift !== null`.
*   The modal header should display the Shift Name and Date.
*   The modal body must iterate over `selectedShift.assigned_workers`.
*   Render a contact card for each worker showing their `avatar_url` (or placeholder), `first_name` `last_name`, `email`, `phone` (with a `href="tel:..."` link), and their `aggregate_rating` represented by a star icon.
*   Include a "Close" button that sets `setSelectedShift(null)`.