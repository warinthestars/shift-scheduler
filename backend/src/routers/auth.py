from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import User, UserRole, VenueManager
from src.schemas import LoginRequest, RegisterRequest, UserCreate, TokenResponse, FirebaseLoginRequest, UserResponse
from src.auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    get_current_user,
    get_or_create_mock_firebase_user,
    normalize_role
)
from src.config import settings
import src.services.firebase as firebase_service
from src.services.firebase import (
    load_firebase_web_config,
    verify_firebase_id_token,
    get_enabled_providers
)

_ORIGINAL_LOAD_CONFIG = load_firebase_web_config
_ORIGINAL_VERIFY = verify_firebase_id_token
_ORIGINAL_GET_PROVIDERS = get_enabled_providers


def _get_load_config():
    if load_firebase_web_config != _ORIGINAL_LOAD_CONFIG:
        return load_firebase_web_config
    return firebase_service.load_firebase_web_config


def _get_verify_token():
    if verify_firebase_id_token != _ORIGINAL_VERIFY:
        return verify_firebase_id_token
    return firebase_service.verify_firebase_id_token


def _get_enabled_providers():
    if get_enabled_providers != _ORIGINAL_GET_PROVIDERS:
        return get_enabled_providers
    return firebase_service.get_enabled_providers


router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def _firebase_user_response(user: User, venue_id_str) -> UserResponse:
    """Column-only serializer for the Firebase path. Never touches ORM relationships."""
    resp = UserResponse(
        id=user.id,
        email=user.email,
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        role=normalize_role(user.role),
        phone=user.phone,
        avatar_url=user.avatar_url,
        bio=user.bio,
        skills=user.skills or [],
        venue_id=venue_id_str,
        venue_ids=[venue_id_str] if venue_id_str else [],
        venue_names=[],
        aggregate_rating=float(user.aggregate_rating or 0.0),
        rating_count=int(user.rating_count or 0),
        total_shifts=int(user.total_shifts or 0),
        is_active=bool(user.is_active),
        created_at=user.created_at,
    )
    if venue_id_str:
        resp.venue_ids = [venue_id_str]
    return resp


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(request: UserCreate, db: AsyncSession = Depends(get_db)):
    """
    Phase 22.1: Local self-service registration.
    - ALWAYS creates a 'worker' (request.role is ignored).
    - Only available when real Firebase is NOT configured; otherwise sign-up goes through Firebase.
    """
    if not settings.ALLOW_SELF_REGISTRATION:
        raise HTTPException(status_code=403, detail="Self-registration is disabled. Ask an administrator to create your account.")
    if _get_load_config()() is not None and not settings.USE_MOCK_FIREBASE:
        raise HTTPException(status_code=409, detail="Use the sign-up options on the login page.")

    email = request.email.lower().strip()
    if len(request.password or "") < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    existing = await db.scalar(select(User).where(func.lower(User.email) == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with this email already exists")

    try:
        user = User(
            email=email,
            hashed_password=get_password_hash(request.password),
            role="worker",
            first_name=(request.first_name or "").strip()[:100],
            last_name=(request.last_name or "").strip()[:100],
            phone=request.phone.strip() if request.phone else None,
            skills=request.skills or [],
            bio=request.bio,
            aggregate_rating=5.00,
            rating_count=0,
            total_shifts=0,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create account: {str(e)}")

    try:
        token = create_access_token(data={"sub": str(user.id), "role": "worker", "venue_id": None})
    except Exception as e:
        print(f"JWT Generation Error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server configuration error.")

    return TokenResponse(access_token=token, token_type="bearer", user=_firebase_user_response(user, None))

@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Validate credentials with verify_password against hashed_password.
    Returns JWT containing sub (ID), role (platform_admin, venue_manager, worker), and venue_id.
    """
    result = await db.execute(
        select(User)
        .options(selectinload(User.managed_venues))
        .where(User.email == request.email.lower())
    )
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"}
        )

    if not verify_password(request.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"}
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    user_role_str = normalize_role(user.role)
    venue_id_str = str(user.managed_venues[0].venue_id) if user.managed_venues and len(user.managed_venues) > 0 else None

    token_payload = {
        "sub": str(user.id),
        "role": user_role_str,
        "venue_id": venue_id_str
    }
    try:
        token = create_access_token(data=token_payload)
    except Exception as e:
        print(f"JWT Generation Error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server configuration error."
        )

    user_resp = UserResponse.model_validate(user)
    user_resp.venue_id = venue_id_str

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=user_resp
    )

@router.get("/firebase-config")
async def firebase_config(request: Request):
    """
    Phase 22.1: Public Firebase web config + the sign-in providers currently enabled in Firebase.
    These values are public client identifiers by design (not secrets).
    """
    cfg = _get_load_config()()
    providers, source = [], "none"
    if cfg is not None and not settings.USE_MOCK_FIREBASE:
        discovered = await _get_enabled_providers()(cfg, referer=request.headers.get("referer"))
        providers, source = discovered["providers"], discovered["source"]
    return {
        "enabled": cfg is not None,
        "mock": bool(settings.USE_MOCK_FIREBASE),
        "config": cfg,
        "providers": providers,
        "providers_source": source,
        "self_registration": bool(settings.ALLOW_SELF_REGISTRATION),
    }


@router.post("/firebase-login", response_model=TokenResponse)
async def firebase_login(request: FirebaseLoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Phase 22 & 22.1: Exchange a Firebase ID token for a ShiftBoard JWT.
    JIT provisioning rules:
      1. Match on users.firebase_uid  -> sign in.
      2. Else match on email (case-insensitive) -> link firebase_uid ONLY if the
         Firebase email is verified, and the account is not linked to another uid.
      3. Else create a new user with role 'worker' (no venue access until a
         manager whitelists them). Requires email_verified and ALLOW_SELF_REGISTRATION.
    """
    token = (request.firebase_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Missing Firebase token.")

    if settings.USE_MOCK_FIREBASE and token.startswith("mock-firebase-"):
        user = await get_or_create_mock_firebase_user(
            db,
            email=request.email or "demo_google_worker@shiftboard.com",
            first_name=request.first_name or "Alex",
            last_name=request.last_name or "Rivera"
        )
    else:
        web_cfg = _get_load_config()()
        if not web_cfg:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Firebase sign-in is not configured on this server."
            )

        try:
            claims = await _get_verify_token()(token, web_cfg["projectId"])
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Firebase token verification failed: {str(e)}"
            )

        firebase_uid = claims["sub"]
        email = (claims.get("email") or "").lower().strip()
        email_verified = bool(claims.get("email_verified"))
        if not email:
            raise HTTPException(status_code=400, detail="Your sign-in account has no email address.")

        try:
            user = await db.scalar(select(User).where(User.firebase_uid == firebase_uid))

            if not user:
                existing = await db.scalar(select(User).where(func.lower(User.email) == email))
                if existing:
                    if not email_verified:
                        raise HTTPException(
                            status_code=409,
                            detail="An account with this email already exists. Verify your email with your sign-in provider to link it."
                        )
                    if existing.firebase_uid and existing.firebase_uid != firebase_uid:
                        raise HTTPException(
                            status_code=409,
                            detail="This email is already linked to a different sign-in account."
                        )
                    existing.firebase_uid = firebase_uid
                    if not existing.avatar_url and claims.get("picture"):
                        existing.avatar_url = claims.get("picture")
                    user = existing
                else:
                    if not settings.ALLOW_SELF_REGISTRATION:
                        raise HTTPException(
                            status_code=403,
                            detail="Self-registration is disabled. Ask an administrator to create your account."
                        )
                    if not email_verified:
                        raise HTTPException(
                            status_code=403,
                            detail="Please verify your email address first. Check your inbox for the verification link."
                        )

                    if request.first_name and request.first_name.strip():
                        first_name = request.first_name.strip()[:100]
                        last_name = (request.last_name or "").strip()[:100]
                    else:
                        full_name = (claims.get("name") or "").strip()
                        parts = full_name.split(" ") if full_name else []
                        first_name = (parts[0] if parts else email.split("@")[0])[:100]
                        last_name = (" ".join(parts[1:]) if len(parts) > 1 else "")[:100]

                    user = User(
                        firebase_uid=firebase_uid,
                        email=email,
                        hashed_password=None,
                        first_name=first_name,
                        last_name=last_name,
                        phone=request.phone.strip() if request.phone else None,
                        role="worker",
                        avatar_url=claims.get("picture"),
                        skills=[],
                        aggregate_rating=5.0,
                        rating_count=0,
                        total_shifts=0,
                        is_active=True,
                    )
                    db.add(user)

                await db.commit()
                await db.refresh(user)
        except HTTPException:
            await db.rollback()
            raise
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to provision user: {str(e)}")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    venue_id = await db.scalar(
        select(VenueManager.venue_id).where(VenueManager.user_id == user.id).limit(1)
    )
    venue_id_str = str(venue_id) if venue_id else None

    try:
        jwt_token = create_access_token(data={
            "sub": str(user.id),
            "role": normalize_role(user.role),
            "venue_id": venue_id_str
        })
    except Exception as e:
        print(f"JWT Generation Error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server configuration error."
        )

    return TokenResponse(
        access_token=jwt_token,
        token_type="bearer",
        user=_firebase_user_response(user, venue_id_str)
    )

@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(user: User = Depends(get_current_user)):
    """Retrieve profile of authenticated user"""
    return user
