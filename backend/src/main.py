import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.config import settings
from src.database import AsyncSessionLocal, engine, Base
from src.seed import seed_initial_data
from src.routers.auth import router as auth_router
from src.routers.users import router as users_router
from src.routers.venues import router as venues_router
from src.routers.shifts import router as shifts_router, requests_router, messages_router
from src.routers.transfers import router as transfers_router
from src.routers.admin import router as admin_router
from src.routers.events import router as events_router
from src.routers.timesheets import router as timesheets_router
from src.routers.listings import router as listings_router
from src.routers.me import router as me_router
from src.routers.locations import router as locations_router
from src.routers.notifications import router as notifications_router
from src.services.notification_worker import notification_worker_loop


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("shiftboard.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup & shutdown lifecycle: seeds database on startup"""
    logger.info("Initializing ShiftBoard Backend Application...")

    # Ensure tables and standard VARCHAR columns exist in database
    try:
        from sqlalchemy import text
        async with engine.begin() as conn:
            try:
                await conn.execute(text("ALTER TABLE shift_requests ALTER COLUMN status TYPE VARCHAR(50) USING status::text;"))
            except Exception:
                pass
            try:
                await conn.execute(text("ALTER TABLE shifts ALTER COLUMN status TYPE VARCHAR(50) USING status::text;"))
            except Exception:
                pass
            try:
                await conn.execute(text("ALTER TABLE shift_transfers ALTER COLUMN status TYPE VARCHAR(50) USING status::text;"))
            except Exception:
                pass
            try:
                await conn.execute(text("ALTER TABLE shift_transfers ADD COLUMN IF NOT EXISTS notes TEXT;"))
            except Exception:
                pass
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        logger.warning(f"Metadata create_all check: {e}")

    # Seed Super Admin and initial demo data
    try:
        async with AsyncSessionLocal() as session:
            await seed_initial_data(session)
    except Exception as e:
        logger.error(f"Error during startup data seeding: {e}", exc_info=True)

    # Phase 28: background notification worker (reminders, alerts, email/SMS delivery)
    worker_task = None
    if settings.NOTIFICATIONS_WORKER_ENABLED:
        import asyncio
        worker_task = asyncio.create_task(notification_worker_loop())

    yield

    if worker_task is not None:
        worker_task.cancel()
        try:
            await worker_task
        except BaseException:
            pass

    logger.info("Shutting down ShiftBoard Backend Application...")
    await engine.dispose()

app = FastAPI(
    title="ShiftBoard API",
    description="Shift scheduling and community call-board platform for the service industry",
    version="0.2.0",
    lifespan=lifespan
)

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:5173",
        "http://localhost:80",
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8000",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Routers
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(venues_router)
app.include_router(shifts_router)
app.include_router(requests_router)
app.include_router(transfers_router)
app.include_router(messages_router)
app.include_router(admin_router)
app.include_router(events_router)
app.include_router(timesheets_router)
app.include_router(listings_router)
app.include_router(me_router)
app.include_router(locations_router)
app.include_router(notifications_router)


@app.get("/healthz", tags=["System"])
async def health_check():
    return {
        "status": "healthy",
        "service": "shiftboard-backend",
        "mock_firebase": settings.USE_MOCK_FIREBASE,
        "env": settings.ENV
    }

@app.get("/", tags=["System"])
async def root():
    return {
        "message": "Welcome to ShiftBoard API",
        "docs_url": "/docs",
        "version": "0.2.0"
    }
