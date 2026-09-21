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
from src.routers.shifts import router as shifts_router, requests_router
from src.routers.admin import router as admin_router

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

    # Ensure tables exist in database (fallback if init.sql wasn't pre-run)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        logger.warning(f"Metadata create_all check: {e}")

    # Seed Super Admin and initial demo data
    try:
        async with AsyncSessionLocal() as session:
            await seed_initial_data(session)
    except Exception as e:
        logger.error(f"Error during startup data seeding: {e}", exc_info=True)

    yield

    logger.info("Shutting down ShiftBoard Backend Application...")
    await engine.dispose()

app = FastAPI(
    title="ShiftBoard API",
    description="Shift scheduling and community call-board platform for the service industry",
    version="0.2.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list or ["*"],
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
app.include_router(admin_router)

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
