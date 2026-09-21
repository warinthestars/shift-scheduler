import logging
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.config import settings
from src.auth import get_password_hash
from src.models import User, Venue, Shift, VenueManager, VenueWhitelist

logger = logging.getLogger("shiftboard.seed")

async def seed_initial_data(db: AsyncSession):
    """
    Startup lifecycle database seeding:
    1. Super Admin checking & creation using SUPER_ADMIN_USERNAME & SUPER_ADMIN_PASSWORD.
    2. Demo venue, shifts, and workers to allow instant testing of the Auto-Confirm Engine.
    """
    logger.info("Checking Super Admin status...")

    # 1. Super Admin Seeding
    result = await db.execute(select(User).where(User.email == settings.SUPER_ADMIN_USERNAME))
    admin_user = result.scalar_one_or_none()

    if not admin_user:
        logger.info(f"Seeding Super Admin user: {settings.SUPER_ADMIN_USERNAME}")
        admin_user = User(
            email=settings.SUPER_ADMIN_USERNAME,
            password_hash=get_password_hash(settings.SUPER_ADMIN_PASSWORD),
            role="platform_admin",
            first_name="Platform",
            last_name="SuperAdmin",
            phone="555-0100",
            bio="System administrator for ShiftBoard Platform.",
            is_active=True,
            rating_average=5.00,
            rating_count=0,
            total_shifts_completed=0
        )
        db.add(admin_user)
        await db.commit()
        await db.refresh(admin_user)
        logger.info("Super Admin successfully created.")
    else:
        logger.info("Super Admin already exists.")

    # 2. Demo Worker Seeding (for local password login testing)
    worker_email = "demo_worker@shiftboard.local"
    result = await db.execute(select(User).where(User.email == worker_email))
    worker_user = result.scalar_one_or_none()

    if not worker_user:
        logger.info(f"Seeding Demo Worker: {worker_email}")
        worker_user = User(
            email=worker_email,
            password_hash=get_password_hash("DemoWorker123!"),
            role="worker",
            first_name="Jordan",
            last_name="Lee",
            phone="555-0144",
            bio="Craft cocktail bartender and high-energy server with 6+ years in hospitality.",
            skills=["Bartender", "Mixologist", "Server", "Barback"],
            rating_average=4.85,
            rating_count=16,
            total_shifts_completed=16,
            is_active=True
        )
        db.add(worker_user)
        await db.commit()
        await db.refresh(worker_user)

    # 3. Demo Venue Seeding
    result = await db.execute(select(Venue))
    venues = result.scalars().all()

    if not venues:
        logger.info("Seeding demo venues and sample shifts for call-board testing...")
        venue1 = Venue(
            name="The Copper & Oak Lounge",
            description="Upscale craft cocktail lounge and historic speakeasy in downtown.",
            address="142 Grand St, New York, NY 10013",
            latitude=40.7205,
            longitude=-74.0011,
            geofence_radius_meters=150,
            global_auto_approve_min_rating=4.50,
            logo_url="https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=150&auto=format&fit=crop&q=80"
        )
        venue2 = Venue(
            name="Harborview Grill & Terrace",
            description="Busy waterfront seafood grill and high-volume banquet venue.",
            address="89 Ocean Ave, New York, NY 10004",
            latitude=40.7025,
            longitude=-74.0150,
            geofence_radius_meters=200,
            global_auto_approve_min_rating=4.75,
            logo_url="https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=150&auto=format&fit=crop&q=80"
        )
        db.add_all([venue1, venue2])
        await db.commit()
        await db.refresh(venue1)
        await db.refresh(venue2)

        # Assign Super Admin as manager for venue1
        db.add(VenueManager(venue_id=venue1.id, user_id=admin_user.id, is_primary=True))

        # Add worker to whitelist for venue2 (tests Condition 2 of hierarchy)
        db.add(VenueWhitelist(venue_id=venue2.id, worker_id=worker_user.id, notes="Trusted weekend server"))

        # Seed sample shifts
        now = datetime.utcnow()
        # Shift 1: Auto-Confirm Anyone (Condition 1)
        shift1 = Shift(
            venue_id=venue1.id,
            created_by_user_id=admin_user.id,
            title="Friday Evening Cocktail Bartender",
            role_required="Bartender",
            start_time=now + timedelta(days=1, hours=2),
            end_time=now + timedelta(days=1, hours=8),
            hourly_rate=36.50,
            spots_needed=2,
            spots_filled=0,
            auto_confirm_anyone=True,
            description="High volume cocktail service behind main front bar. Uniform: All black.",
            dress_code="All black button-up and apron.",
            status="open"
        )

        # Shift 2: Rating Threshold Auto-Confirm (Condition 3: Venue requires >= 4.5, worker has 4.85)
        shift2 = Shift(
            venue_id=venue1.id,
            created_by_user_id=admin_user.id,
            title="Saturday Night VIP Lounge Server",
            role_required="Server",
            start_time=now + timedelta(days=2, hours=3),
            end_time=now + timedelta(days=2, hours=9),
            hourly_rate=32.00,
            spots_needed=3,
            spots_filled=0,
            auto_confirm_anyone=False,
            min_rating_override=None,
            description="Bottle service and VIP lounge table maintenance.",
            dress_code="Black dress pants, company provided vest.",
            status="open"
        )

        # Shift 3: Fallback (Condition 4: Higher threshold 4.95 -> Pending review)
        shift3 = Shift(
            venue_id=venue1.id,
            created_by_user_id=admin_user.id,
            title="Sunday Brunch Lead Captain",
            role_required="Server",
            start_time=now + timedelta(days=3, hours=1),
            end_time=now + timedelta(days=3, hours=6),
            hourly_rate=42.00,
            spots_needed=1,
            spots_filled=0,
            auto_confirm_anyone=False,
            min_rating_override=4.95,
            description="Coordination of private rooftop brunch event. Requires manager review.",
            dress_code="Formal bistro attire.",
            status="open"
        )

        # Shift 4: Venue 2 Whitelist (Condition 2)
        shift4 = Shift(
            venue_id=venue2.id,
            created_by_user_id=admin_user.id,
            title="Waterfront Terrace Dishwasher & Steward",
            role_required="Dishwasher",
            start_time=now + timedelta(days=4, hours=2),
            end_time=now + timedelta(days=4, hours=7),
            hourly_rate=26.00,
            spots_needed=2,
            spots_filled=0,
            auto_confirm_anyone=False,
            description="Support dish pit and plateware restock during sunset rush.",
            dress_code="Slip-resistant shoes required.",
            status="open"
        )

        db.add_all([shift1, shift2, shift3, shift4])
        await db.commit()
        logger.info("Demo venues and shifts seeded successfully.")
