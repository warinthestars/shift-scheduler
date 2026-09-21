# Phase 10: Database Credential Synchronization

The backend is throwing an `InvalidPasswordError` for `shiftboard_user` on startup. The `backend` and `database` containers are reading mismatched credentials. We need to synchronize how the database connection string is built and passed.

## 1. Synchronize `docker-compose.yml`
*   Ensure both the `database` and `backend` services pull their Postgres credentials from the same source. 
*   If using an `env_file` (like `.env`), ensure both services specify it.
*   The `database` service must explicitly map the environment variables to initialize the database:
    ```yaml
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-shiftboard_user}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB:-shiftboard}
    ```
*   The `backend` service must also have access to these exact same variables.

## 2. Unify Connection String (`backend/src/config.py`)
*   Verify that `config.py` builds the async PostgreSQL connection string using the exact environment variables defined in the docker-compose file.
*   Example:
    ```python
    DB_USER = os.getenv("POSTGRES_USER", "shiftboard_user")
    DB_PASSWORD = os.getenv("POSTGRES_PASSWORD")
    DB_HOST = os.getenv("POSTGRES_HOST", "database") # Must match docker-compose service name
    DB_NAME = os.getenv("POSTGRES_DB", "shiftboard")
    
    SQLALCHEMY_DATABASE_URI = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:5432/{DB_NAME}"
    ```
*   Ensure there are no hardcoded mismatched passwords in `config.py`.