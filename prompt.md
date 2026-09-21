# Hotfix: Missing Schema Import in venues.py

The backend is crashing on startup with a `NameError: name 'ShiftResponse' is not defined` in `backend/src/routers/venues.py`. 

* Open `backend/src/routers/venues.py`.
* Locate the import statement for `src.schemas`.
* Add `ShiftResponse` to the list of imported schemas so that the `/{venue_id}/shifts` endpoint can successfully reference it.