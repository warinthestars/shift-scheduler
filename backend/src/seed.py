import logging
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.config import settings
from src.auth import get_password_hash
from src.models import User, Venue, Shift, VenueManager, VenueWhitelist, UserRole

logger = logging.getLogger("shiftboard.seed")

async def seed_initial_data(db: AsyncSession):
    """
    Startup lifecycle database seeding:
    1. Super Admin checking & creation (platform_admin role) using get_password_hash.
    2. Demo venue manager & demo worker (all @shiftboard.com).
    3. Demo venues, shifts, and whitelists for testing Auto-Confirm Engine.
    """
    logger.info("Checking Super Admin account...")

    # 1. Super Admin Seeding
    admin_email = (settings.SUPER_ADMIN_USERNAME or "demo_admin@shiftboard.com").lower()
    if "@shiftboard.local" in admin_email:
        admin_email = admin_email.replace("@shiftboard.local", "@shiftboard.com")

    result = await db.execute(select(User).where(User.email == admin_email))
    admin_user = result.scalar_one_or_none()

    if not admin_user:
        logger.info(f"Seeding Super Admin user: {admin_email}")
        admin_user = User(
            email=admin_email,
            hashed_password=get_password_hash(settings.SUPER_ADMIN_PASSWORD),
            role="platform_admin",
            first_name="Platform",
            last_name="SuperAdmin",
            phone="555-0100",
            bio="ShiftBoard System Administrator",
            is_active=True,
            aggregate_rating=5.00,
            rating_count=0,
            total_shifts=0
        )
        db.add(admin_user)
        await db.commit()
        await db.refresh(admin_user)
        logger.info("Super Admin successfully created.")
    else:
        logger.info("Super Admin already exists.")

    # 2. Demo Venue Manager Seeding
    manager_email = "demo_manager@shiftboard.com"
    result = await db.execute(select(User).where(User.email == manager_email))
    manager_user = result.scalar_one_or_none()

    if not manager_user:
        logger.info(f"Seeding Demo Venue Manager: {manager_email}")
        manager_user = User(
            email=manager_email,
            hashed_password=get_password_hash("DemoManager123!"),
            role="venue_manager",
            first_name="Morgan",
            last_name="Vance",
            phone="555-0155",
            bio="General Manager with 10+ years hospitality leadership.",
            is_active=True,
            aggregate_rating=5.00,
            rating_count=0,
            total_shifts=0
        )
        db.add(manager_user)
        await db.commit()
        await db.refresh(manager_user)

    # 3. Demo Worker Seeding
    worker_email = "demo_worker@shiftboard.com"
    result = await db.execute(select(User).where(User.email == worker_email))
    worker_user = result.scalar_one_or_none()

    if not worker_user:
        logger.info(f"Seeding Demo Worker: {worker_email}")
        worker_user = User(
            email=worker_email,
            hashed_password=get_password_hash("DemoWorker123!"),
            role="worker",
            first_name="Jordan",
            last_name="Lee",
            phone="555-0144",
            bio="Experienced craft bartender and banquet captain with 6+ years in hospitality.",
            skills=["Bartender", "Server", "Barback"],
            aggregate_rating=4.85,
            rating_count=16,
            total_shifts=16,
            is_active=True
        )
        db.add(worker_user)
        await db.commit()
        await db.refresh(worker_user)

    # 4. Demo Venues & Shifts
    result = await db.execute(select(Venue))
    venues = result.scalars().all()

    if not venues:
        logger.info("Seeding demo venues, managers, whitelists, and shifts...")
        venue1 = Venue(
            name="The Copper & Oak Lounge",
            description="Upscale craft cocktail lounge and speakeasy in SoHo.",
            address="142 Grand St, New York, NY 10013",
            lat=40.7205,
            lng=-74.0011,
            geofence_radius_meters=150,
            auto_approve_rating_threshold=4.50,
            logo_url="https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=150&auto=format&fit=crop&q=80"
        )
        venue2 = Venue(
            name="Harborview Terrace & Grill",
            description="High-volume waterfront bistro and event space.",
            address="89 Ocean Ave, New York, NY 10004",
            lat=40.7025,
            lng=-74.0150,
            geofence_radius_meters=200,
            auto_approve_rating_threshold=4.90,
            logo_url="https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=150&auto=format&fit=crop&q=80"
        )
        db.add_all([venue1, venue2])
        await db.commit()
        await db.refresh(venue1)
        await db.refresh(venue2)

        # Assign Venue Managers
        db.add(VenueManager(venue_id=venue1.id, user_id=manager_user.id, is_primary=True))
        db.add(VenueManager(venue_id=venue1.id, user_id=admin_user.id, is_primary=False))

        # Add worker to Whitelist for venue2 (Tests Condition 2)
        db.add(VenueWhitelist(venue_id=venue2.id, worker_id=worker_user.id, notes="Trusted weekend server"))

        # Seed sample shifts
        now = datetime.utcnow()

        # Shift 1: is_shift_auto_confirm == True (Tests Condition 1)
        shift1 = Shift(
            venue_id=venue1.id,
            created_by_user_id=manager_user.id,
            title="Friday Prime Time Bartender",
            role_type="Bartender",
            start_time=now + timedelta(days=1, hours=2),
            end_time=now + timedelta(days=1, hours=8),
            hourly_rate=36.50,
            capacity=2,
            spots_filled=0,
            is_shift_auto_confirm=True,
            description="High volume cocktail service behind front bar. Uniform: All black.",
            status="OPEN"
        )

        # Shift 2: Rating Threshold Auto-Confirm (Tests Condition 3: venue threshold is 4.50, worker rating is 4.85)
        shift2 = Shift(
            venue_id=venue1.id,
            created_by_user_id=manager_user.id,
            title="Saturday Night VIP Lounge Server",
            role_type="Server",
            start_time=now + timedelta(days=2, hours=3),
            end_time=now + timedelta(days=2, hours=9),
            hourly_rate=32.00,
            capacity=3,
            spots_filled=0,
            is_shift_auto_confirm=False,
            description="VIP table bottle service and lounge hospitality.",
            status="OPEN"
        )

        # Shift 3: Whitelist Match on Venue 2 (Tests Condition 2)
        shift3 = Shift(
            venue_id=venue2.id,
            created_by_user_id=admin_user.id,
            title="Waterfront Terrace Dishwasher & Steward",
            role_type="Dishwasher",
            start_time=now + timedelta(days=3, hours=2),
            end_time=now + timedelta(days=3, hours=7),
            hourly_rate=26.00,
            capacity=2,
            spots_filled=0,
            is_shift_auto_confirm=False,
            description="Plateware and glassware sanitation support during sunset rush.",
            status="OPEN"
        )

        # Shift 4: Strict Venue 2 shift with non-whitelisted worker (Tests Condition 4: Fallback to PENDING)
        shift4 = Shift(
            venue_id=venue1.id,
            created_by_user_id=manager_user.id,
            title="Sunday Sunset Banquet Captain",
            role_type="Server",
            start_time=now + timedelta(days=4, hours=1),
            end_time=now + timedelta(days=4, hours=6),
            hourly_rate=42.00,
            capacity=1,
            spots_filled=0,
            is_shift_auto_confirm=False,
            description="Rooftop wedding banquet captain. Requires manual manager review.",
            status="OPEN"
        )

        db.add_all([shift1, shift2, shift3, shift4])
        await db.commit()
        logger.info("Demo venues and shifts seeded successfully.")
