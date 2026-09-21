import os
from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    ENV: str = os.getenv("ENV", "development")
    DEBUG: bool = os.getenv("DEBUG", "True").lower() in ("true", "1", "yes")
    PORT: int = int(os.getenv("PORT", "8000"))

    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://shiftboard_user:shiftboard_secret_password@database:5432/shiftboard"
    )
    DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "20"))
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "10"))

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://:shiftboard_redis_pass@redis:6379/0")

    # JWT Authentication
    JWT_SECRET_KEY: str = os.getenv(
        "JWT_SECRET_KEY",
        "shiftboard_local_jwt_secret_key_please_change_in_production_32chars"
    )
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

    # Super Admin Seeding
    SUPER_ADMIN_USERNAME: str = os.getenv("SUPER_ADMIN_USERNAME", "demo_admin@shiftboard.local")
    SUPER_ADMIN_PASSWORD: str = os.getenv("SUPER_ADMIN_PASSWORD", "SuperSecretDemo123!")

    # Firebase Mocking
    USE_MOCK_FIREBASE: bool = os.getenv("USE_MOCK_FIREBASE", "true").lower() in ("true", "1", "yes")
    FIREBASE_PROJECT_ID: str = os.getenv("FIREBASE_PROJECT_ID", "shiftboard-firebase-project")
    FIREBASE_CREDENTIALS_PATH: str = os.getenv("FIREBASE_CREDENTIALS_PATH", "/app/secrets/firebase_service_account.json")

    # CORS
    CORS_ORIGINS: str = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://localhost:3000,http://localhost:80,http://localhost,http://127.0.0.1:5173"
    )

    # Cloudflare R2
    R2_ACCOUNT_ID: str = os.getenv("R2_ACCOUNT_ID", "")
    R2_ACCESS_KEY_ID: str = os.getenv("R2_ACCESS_KEY_ID", "")
    R2_SECRET_ACCESS_KEY: str = os.getenv("R2_SECRET_ACCESS_KEY", "")
    R2_BUCKET_NAME: str = os.getenv("R2_BUCKET_NAME", "shiftboard-media")
    R2_S3_ENDPOINT_URL: str = os.getenv("R2_S3_ENDPOINT_URL", "")
    R2_PUBLIC_URL_PREFIX: str = os.getenv("R2_PUBLIC_URL_PREFIX", "")

    # Geofence
    DEFAULT_GEOFENCE_RADIUS_METERS: int = int(os.getenv("DEFAULT_GEOFENCE_RADIUS_METERS", "100"))

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
