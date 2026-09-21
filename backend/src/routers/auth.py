from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models import User, UserRole
from src.schemas import LoginRequest, RegisterRequest, TokenResponse, FirebaseLoginRequest, UserResponse
from src.auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    get_current_user,
    get_or_create_mock_firebase_user,
    normalize_role
)
from src.config import settings

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(request: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    Task 2: Register a new user account.
    Supports creating both WORKER and VENUE_MANAGER accounts.
    """
    result = await db.execute(select(User).where(User.email == request.email.lower()))
    existing_user = result.scalar_one_or_none()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists"
        )

    # Determine role (WORKER or VENUE_MANAGER)
    role_str = (request.role or "WORKER").upper()
    assigned_role = UserRole.VENUE_MANAGER if "MANAGER" in role_str else UserRole.WORKER

    user = User(
        email=request.email.lower(),
        password_hash=get_password_hash(request.password),
        role=assigned_role,
        first_name=request.first_name or "",
        last_name=request.last_name or "",
        phone=request.phone,
        skills=request.skills or [],
        bio=request.bio,
        aggregate_rating=5.00,
        rating_count=0,
        total_shifts=0
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Return JWT containing User ID and Role
    token = create_access_token(data={"sub": str(user.id), "role": str(user.role.value)})
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )

@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Task 2: Validate credentials and return a JWT containing user ID and Role.
    """
    result = await db.execute(select(User).where(User.email == request.email.lower()))
    user = result.scalar_one_or_none()

    if not user or not user.password_hash or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"}
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    # JWT containing User ID and Role
    user_role_str = user.role.value if hasattr(user.role, "value") else str(user.role)
    token = create_access_token(data={"sub": str(user.id), "role": user_role_str})
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )

@router.post("/firebase-login", response_model=TokenResponse)
async def firebase_login(request: FirebaseLoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Firebase login / Mock OAuth endpoint.
    Returns JWT containing User ID and Role.
    """
    token = request.firebase_token.strip()

    if settings.USE_MOCK_FIREBASE:
        user = await get_or_create_mock_firebase_user(
            db,
            email=request.email or "demo_google_worker@shiftboard.local",
            first_name=request.first_name or "Alex",
            last_name=request.last_name or "Rivera"
        )
    else:
        try:
            from firebase_admin import auth as fb_auth
            decoded_token = fb_auth.verify_id_token(token)
            firebase_uid = decoded_token.get("uid")
            email = (decoded_token.get("email") or request.email).lower()
            name = decoded_token.get("name", "")
            first_name = name.split(" ")[0] if name else (request.first_name or "Worker")
            last_name = name.split(" ")[-1] if (name and " " in name) else (request.last_name or "User")

            result = await db.execute(select(User).where(User.firebase_uid == firebase_uid))
            user = result.scalar_one_or_none()

            if not user:
                result = await db.execute(select(User).where(User.email == email))
                user = result.scalar_one_or_none()
                if user:
                    user.firebase_uid = firebase_uid
                else:
                    user = User(
                        firebase_uid=firebase_uid,
                        email=email,
                        first_name=first_name,
                        last_name=last_name,
                        role=UserRole.WORKER
                    )
                    db.add(user)
                await db.commit()
                await db.refresh(user)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Firebase token verification failed: {str(e)}"
            )

    user_role_str = user.role.value if hasattr(user.role, "value") else str(user.role)
    jwt_token = create_access_token(data={"sub": str(user.id), "role": user_role_str})
    return TokenResponse(
        access_token=jwt_token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )

@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(user: User = Depends(get_current_user)):
    """Retrieve profile of authenticated user"""
    return user
