import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.config import settings
from src.auth import get_password_hash
from src.models import (
    User, Venue, Shift, ShiftRequest, VenueManager, VenueWhitelist,
    UserRole, RequestStatus
)

logger = logging.getLogger("shiftboard.seed")

async def seed_initial_data(db: AsyncSession):
    """
    Startup lifecycle database seeding (Phase 17 Ecosystem):
    1. Super Admin checking & creation.
    2. Demo Venue ("The Hippodrome").
    3. Demo Venue Manager (demo_manager@shiftboard.com, assigned to Demo Venue).
    4. Workers (worker1@shiftboard.com, worker2@shiftboard.com, demo_worker@shiftboard.com).
    5. 3 future shifts tied to Demo Venue ("Saturday Night Bartending", "Sunday Brunch Serving", etc.).
    6. ShiftRequests:
       - worker1 on manual-approval shift with status="pending_manager_approval".
       - worker2 on shift with status="approved" and available_spots decremented by 1.
    All operations are wrapped in try/except blocks with explicit error logging.
    """
    logger.info("Initializing ShiftBoard database seed...")

    # --------------------------------------------------------------------------
    # 1. Super Admin Seeding
    # --------------------------------------------------------------------------
    admin_user = None
    try:
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
    except Exception as e:
        await db.rollback()
        print(f"Error seeding super admin: {e}")
        logger.error(f"Error seeding super admin: {e}", exc_info=True)

    # --------------------------------------------------------------------------
    # 2. Demo Venue Seeding ("The Hippodrome")
    # --------------------------------------------------------------------------
    demo_venue = None
    try:
        v_res = await db.execute(
            select(Venue).where(Venue.name.in_(["The Hippodrome", "Demo Venue"]))
        )
        demo_venue = v_res.scalar_one_or_none()

        if not demo_venue:
            logger.info("Seeding Demo Venue: The Hippodrome")
            demo_venue = Venue(
                name="The Hippodrome",
                description="Premier multi-level entertainment, restaurant, and cocktail venue in Midtown.",
                address="1120 Avenue of the Americas, New York, NY 10036",
                lat=40.7553,
                lng=-73.9829,
                geofence_radius_meters=150,
                auto_approve_rating_threshold=4.50,
                logo_url="https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=150&auto=format&fit=crop&q=80"
            )
            db.add(demo_venue)
            await db.commit()
            await db.refresh(demo_venue)
            logger.info(f"Demo Venue created with ID: {demo_venue.id}")
        else:
            logger.info(f"Demo Venue already exists: {demo_venue.name} ({demo_venue.id})")
    except Exception as e:
        await db.rollback()
        print(f"Error seeding demo venue: {e}")
        logger.error(f"Error seeding demo venue: {e}", exc_info=True)

    # --------------------------------------------------------------------------
    # 3. Demo Venue Manager Seeding (demo_manager@shiftboard.com)
    # --------------------------------------------------------------------------
    manager_user = None
    try:
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
            logger.info("Demo Venue Manager created.")
        else:
            logger.info("Demo Venue Manager already exists.")

        # Assign Manager to Demo Venue
        if demo_venue and manager_user:
            vm_check = await db.scalar(
                select(VenueManager).where(
                    VenueManager.venue_id == demo_venue.id,
                    VenueManager.user_id == manager_user.id
                )
            )
            if not vm_check:
                db.add(VenueManager(venue_id=demo_venue.id, user_id=manager_user.id, is_primary=True))
                await db.commit()
                logger.info(f"Assigned {manager_user.email} as primary manager for {demo_venue.name}")

        # Also assign Admin as secondary manager for convenience
        if demo_venue and admin_user:
            va_check = await db.scalar(
                select(VenueManager).where(
                    VenueManager.venue_id == demo_venue.id,
                    VenueManager.user_id == admin_user.id
                )
            )
            if not va_check:
                db.add(VenueManager(venue_id=demo_venue.id, user_id=admin_user.id, is_primary=False))
                await db.commit()
    except Exception as e:
        await db.rollback()
        print(f"Error seeding venue manager: {e}")
        logger.error(f"Error seeding venue manager: {e}", exc_info=True)

    # --------------------------------------------------------------------------
    # 4. Workers Seeding (worker1, worker2, demo_worker)
    # --------------------------------------------------------------------------
    w1, w2 = None, None
    try:
        # Worker 1
        w1 = await db.scalar(select(User).where(User.email == "worker1@shiftboard.com"))
        if not w1:
            logger.info("Seeding worker1@shiftboard.com")
            w1 = User(
                email="worker1@shiftboard.com",
                hashed_password=get_password_hash("Worker123!"),
                role="worker",
                first_name="Alex",
                last_name="Rivers",
                phone="555-0101",
                avatar_url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
                bio="Experienced high-volume banquet bartender and mixologist.",
                skills=["Bartender", "Barback"],
                aggregate_rating=4.85,
                rating_count=12,
                total_shifts=12,
                is_active=True
            )
            db.add(w1)
            await db.commit()
            await db.refresh(w1)

        # Worker 2
        w2 = await db.scalar(select(User).where(User.email == "worker2@shiftboard.com"))
        if not w2:
            logger.info("Seeding worker2@shiftboard.com")
            w2 = User(
                email="worker2@shiftboard.com",
                hashed_password=get_password_hash("Worker123!"),
                role="worker",
                first_name="Sam",
                last_name="Taylor",
                phone="555-0102",
                avatar_url="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
                bio="Senior fine dining server and team lead with sommelier background.",
                skills=["Server", "Host"],
                aggregate_rating=4.95,
                rating_count=24,
                total_shifts=24,
                is_active=True
            )
            db.add(w2)
            await db.commit()
            await db.refresh(w2)

        # Demo Worker
        dw = await db.scalar(select(User).where(User.email == "demo_worker@shiftboard.com"))
        if not dw:
            logger.info("Seeding demo_worker@shiftboard.com")
            dw = User(
                email="demo_worker@shiftboard.com",
                hashed_password=get_password_hash("DemoWorker123!"),
                role="worker",
                first_name="Jordan",
                last_name="Lee",
                phone="555-0144",
                avatar_url="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
                bio="Experienced craft bartender and banquet captain with 6+ years in hospitality.",
                skills=["Bartender", "Server", "Barback"],
                aggregate_rating=4.85,
                rating_count=16,
                total_shifts=16,
                is_active=True
            )
            db.add(dw)
            await db.commit()
            await db.refresh(dw)
    except Exception as e:
        await db.rollback()
        print(f"Error seeding workers: {e}")
        logger.error(f"Error seeding workers: {e}", exc_info=True)

    # --------------------------------------------------------------------------
    # 5. Future Shifts tied to Demo Venue
    # --------------------------------------------------------------------------
    shift1, shift2, shift3 = None, None, None
    try:
        if demo_venue:
            now_utc = datetime.now(timezone.utc)

            # Shift 1: "Saturday Night Bartending" (manual approval: is_shift_auto_confirm=False, available_spots=3)
            shift1 = await db.scalar(
                select(Shift).where(
                    Shift.venue_id == demo_venue.id,
                    Shift.title == "Saturday Night Bartending"
                )
            )
            if not shift1:
                logger.info("Seeding Shift 1: Saturday Night Bartending")
                shift1 = Shift(
                    venue_id=demo_venue.id,
                    created_by_user_id=manager_user.id if manager_user else None,
                    title="Saturday Night Bartending",
                    role_type="Bartender",
                    start_time=now_utc + timedelta(days=2, hours=4),
                    end_time=now_utc + timedelta(days=2, hours=10),
                    hourly_rate=38.00,
                    capacity=3,
                    spots_filled=0,
                    is_shift_auto_confirm=False,
                    description="High-volume cocktail service on the main bar. Requires manual manager approval.",
                    status="OPEN"
                )
                db.add(shift1)
                await db.commit()
                await db.refresh(shift1)

            # Shift 2: "Sunday Brunch Serving" (manual approval: is_shift_auto_confirm=False, capacity=3)
            shift2 = await db.scalar(
                select(Shift).where(
                    Shift.venue_id == demo_venue.id,
                    Shift.title == "Sunday Brunch Serving"
                )
            )
            if not shift2:
                logger.info("Seeding Shift 2: Sunday Brunch Serving")
                shift2 = Shift(
                    venue_id=demo_venue.id,
                    created_by_user_id=manager_user.id if manager_user else None,
                    title="Sunday Brunch Serving",
                    role_type="Server",
                    start_time=now_utc + timedelta(days=3, hours=2),
                    end_time=now_utc + timedelta(days=3, hours=8),
                    hourly_rate=32.00,
                    capacity=3,
                    spots_filled=0,
                    is_shift_auto_confirm=False,
                    description="VIP dining room and terrace brunch service.",
                    status="OPEN"
                )
                db.add(shift2)
                await db.commit()
                await db.refresh(shift2)

            # Shift 3: "Friday Evening Barback" (available_spots=2)
            shift3 = await db.scalar(
                select(Shift).where(
                    Shift.venue_id == demo_venue.id,
                    Shift.title == "Friday Evening Barback"
                )
            )
            if not shift3:
                logger.info("Seeding Shift 3: Friday Evening Barback")
                shift3 = Shift(
                    venue_id=demo_venue.id,
                    created_by_user_id=manager_user.id if manager_user else None,
                    title="Friday Evening Barback",
                    role_type="Barback",
                    start_time=now_utc + timedelta(days=1, hours=5),
                    end_time=now_utc + timedelta(days=1, hours=11),
                    hourly_rate=28.00,
                    capacity=2,
                    spots_filled=0,
                    is_shift_auto_confirm=True,
                    description="Fast-paced bar support, ice replenishment, and glassware sanitation.",
                    status="OPEN"
                )
                db.add(shift3)
                await db.commit()
                await db.refresh(shift3)
    except Exception as e:
        await db.rollback()
        print(f"Error seeding demo shifts: {e}")
        logger.error(f"Error seeding demo shifts: {e}", exc_info=True)

    # --------------------------------------------------------------------------
    # 6. Shift Requests (Crucial for UI Testing & Manager Views)
    # --------------------------------------------------------------------------
    try:
        # Request 1: worker1 on manual-approval shift with status="pending_manager_approval"
        if w1 and shift1:
            req1 = await db.scalar(
                select(ShiftRequest).where(
                    ShiftRequest.shift_id == shift1.id,
                    ShiftRequest.worker_id == w1.id
                )
            )
            if not req1:
                logger.info(f"Creating pending ShiftRequest for worker1 on {shift1.title}")
                req1 = ShiftRequest(
                    shift_id=shift1.id,
                    worker_id=w1.id,
                    status="pending_manager_approval",
                    approval_source="worker_application",
                    notes="Available for the full shift. 5 years high-volume craft bartending experience."
                )
                db.add(req1)
                await db.commit()
                logger.info("Worker1 pending request created successfully.")

        # Request 2: worker2 with status="approved". Decrement corresponding shift available_spots by 1.
        if w2 and shift2:
            req2 = await db.scalar(
                select(ShiftRequest).where(
                    ShiftRequest.shift_id == shift2.id,
                    ShiftRequest.worker_id == w2.id
                )
            )
            if not req2:
                logger.info(f"Creating approved ShiftRequest for worker2 on {shift2.title}")
                req2 = ShiftRequest(
                    shift_id=shift2.id,
                    worker_id=w2.id,
                    status="approved",
                    approval_source="manager_manual",
                    approved_by_user_id=manager_user.id if manager_user else None,
                    approved_at=datetime.now(timezone.utc),
                    notes="Approved server for Sunday Brunch."
                )
                db.add(req2)
                # Decrement corresponding shift available_spots by 1 (e.g. from 3 to 2)
                shift2.spots_filled = min(shift2.capacity, (shift2.spots_filled or 0) + 1)
                await db.commit()
                await db.refresh(shift2)
                logger.info(f"Worker2 approved request created. Shift spots filled: {shift2.spots_filled}/{shift2.capacity}")
    except Exception as e:
        await db.rollback()
        print(f"Error seeding shift requests: {e}")
        logger.error(f"Error seeding shift requests: {e}", exc_info=True)

    # --------------------------------------------------------------------------
    # 7. Additional Demo Venues & Shifts for Auto-Confirm Testing (if clean DB)
    # --------------------------------------------------------------------------
    try:
        v2 = await db.scalar(select(Venue).where(Venue.name == "The Copper & Oak Lounge"))
        if not v2 and manager_user:
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
            db.add(venue1)
            await db.commit()
            await db.refresh(venue1)
            db.add(VenueManager(venue_id=venue1.id, user_id=manager_user.id, is_primary=False))
            await db.commit()
    except Exception as e:
        await db.rollback()
        print(f"Error seeding additional venue: {e}")
        logger.warning(f"Error seeding additional venue: {e}")

    logger.info("ShiftBoard database initialization complete.")
