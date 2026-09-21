import jwt
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.config import settings
from src.database import get_db
from src.models import User

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Bearer token extractor
bearer_scheme = HTTPBearer(auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

async def get_or_create_mock_firebase_user(
    db: AsyncSession,
    email: str = "demo_google_worker@shiftboard.local",
    first_name: str = "Alex",
    last_name: str = "Rivera"
) -> User:
    """Resolve mock Firebase credentials to a demo worker in PostgreSQL"""
    mock_uid = "mock-firebase-google-uid-123"
    result = await db.execute(select(User).where(User.firebase_uid == mock_uid))
    user = result.scalar_one_or_none()

    if not user:
        # Check by email
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            user.firebase_uid = mock_uid
            await db.commit()
            await db.refresh(user)
        else:
            user = User(
                email=email,
                firebase_uid=mock_uid,
                role="worker",
                first_name=first_name,
                last_name=last_name,
                phone="555-0199",
                rating_average=4.90,
                rating_count=8,
                total_shifts_completed=8,
                skills=["Bartender", "Server", "Barback"],
                bio="Experienced mixologist and high-volume banquet server.",
                is_active=True
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
    return user

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Unified Authentication Dependency:
    1. Validates Mock Firebase tokens if USE_MOCK_FIREBASE is true.
    2. Validates real Firebase tokens if configured.
    3. Validates Local Auth JWT tokens.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"}
        )

    token = credentials.credentials.strip()

    # --------------------------------------------------------------------------
    # 1. Mocked Firebase Token Evaluation
    # --------------------------------------------------------------------------
    if settings.USE_MOCK_FIREBASE and (token.startswith("mock-firebase-") or token == "mock-firebase-token-123"):
        user = await get_or_create_mock_firebase_user(db)
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Inactive user account")
        return user

    # --------------------------------------------------------------------------
    # 2. Local JWT Token Evaluation
    # --------------------------------------------------------------------------
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        user_id_str: str = payload.get("sub")
        if not user_id_str:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    except jwt.PyJWTError:
        # ----------------------------------------------------------------------
        # 3. Real Firebase Auth Fallback (when mock is disabled)
        # ----------------------------------------------------------------------
        if not settings.USE_MOCK_FIREBASE:
            try:
                import firebase_admin
                from firebase_admin import auth as fb_auth
                decoded_fb = fb_auth.verify_id_token(token)
                fb_uid = decoded_fb.get("uid")
                result = await db.execute(select(User).where(User.firebase_uid == fb_uid))
                user = result.scalar_one_or_none()
                if user:
                    return user
            except Exception:
                pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )

    import uuid
    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid user identifier in token")

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="User account not found")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Inactive user account")

    return user

def require_role(allowed_roles: List[str]):
    """Role-based access control dependency factory"""
    def role_checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access forbidden: requires one of {allowed_roles}"
            )
        return user
    return role_checker

require_admin = require_role(["platform_admin"])
require_manager_or_admin = require_role(["platform_admin", "venue_manager"])
require_worker = require_role(["worker", "platform_admin"])
