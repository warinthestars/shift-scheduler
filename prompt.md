# Phase 18: Complete Database ENUM Simplification

The backend is throwing `asyncpg.exceptions.InvalidTextRepresentationError` for the `request_status` ENUM during roster queries and manual approval operations. The PostgreSQL native ENUM constraints are conflicting with the Python string representations passed by `asyncpg`. We must convert all remaining native ENUM columns to standard `VARCHAR` columns to ensure database stability across all endpoints.

## 1. Modify Database Schema (`database/init.sql`)
*   Completely remove the following SQL statements:
    *   `CREATE TYPE request_status AS ENUM...`
    *   `CREATE TYPE shift_status AS ENUM...`
    *   `CREATE TYPE transfer_status AS ENUM...`
*   In the `shift_requests` table, change the `status` column to: `status VARCHAR(50) NOT NULL`.
*   In the `shifts` table, change the `status` column to: `status VARCHAR(50) NOT NULL`.
*   In the `shift_transfers` table, change the `status` column to: `status VARCHAR(50) NOT NULL`.

## 2. Update SQLAlchemy Models (`backend/src/models.py`)
*   Update the `ShiftRequest` model's `status` column to use `String(50)` instead of the SQLAlchemy `Enum` type. (e.g., `status = Column(String(50), nullable=False, default="pending")`).
*   Update the `Shift` model's `status` column to use `String(50)` instead of the SQLAlchemy `Enum` type.
*   Update the `ShiftTransfer` model's `status` column to use `String(50)` instead of the SQLAlchemy `Enum` type.
*   Ensure that Pydantic schemas in `backend/src/schemas.py` still utilize the Python `Enum` classes (e.g., `RequestStatus`, `ShiftStatus`) to validate incoming and outgoing data at the application layer.

## 3. Verify Query Logic (`backend/src/routers/venues.py` & `shifts.py`)
*   When querying by status (e.g., in `get_venue_pending_requests` or `get_venue_roster`), ensure you are passing the string `.value` of the enum if necessary, or ensure the query logic strictly checks against the lowercase string values (e.g., `"pending"`, `"approved"`) to match the database defaults.