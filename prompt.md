Hotfix 1: Backend Crash - Missing Dependencies

Context:
The frontend is receiving net::ERR_EMPTY_RESPONSE when trying to log in. I checked the Docker logs for the backend container and found the following crash loop on startup:

ModuleNotFoundError: No module named 'email_validator'
ImportError: email-validator is not installed, run `pip install 'pydantic[email]'`


Task:

You used Pydantic's EmailStr in /app/src/schemas.py, but failed to include the required email validation package in the backend dependencies.

Please update the backend/requirements.txt (or equivalent dependency file) to include email-validator (or pydantic[email]).

Review the current dependencies and ensure no other standard FastAPI/SQLAlchemy/JWT packages were missed (e.g., pyjwt, passlib, bcrypt, psycopg2-binary).

Provide the exact terminal command I need to run to rebuild the backend container so the new dependencies are installed via Docker Compose.