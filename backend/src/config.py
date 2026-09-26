import os
from pydantic_settings import BaseSettings
from typing import List

# Database connection parameters resolved dynamically from environment
DB_USER = os.getenv("POSTGRES_USER", "shiftboard_user")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")
DB_HOST = os.getenv("POSTGRES_HOST", "database")  # Must match docker-compose service name
DB_PORT = os.getenv("POSTGRES_PORT", "5432")
DB_NAME = os.getenv("POSTGRES_DB", "shiftboard")

if DB_PASSWORD:
    SQLALCHEMY_DATABASE_URI = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
else:
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        f"postgresql+asyncpg://{DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )

class Settings(BaseSettings):
    ENV: str = os.getenv("ENV", "development")
    DEBUG: bool = os.getenv("DEBUG", "True").lower() in ("true", "1", "yes")
    PORT: int = int(os.getenv("PORT", "8000"))

    # Database
    POSTGRES_USER: str = DB_USER
    POSTGRES_PASSWORD: str = DB_PASSWORD
    POSTGRES_HOST: str = DB_HOST
    POSTGRES_PORT: int = int(DB_PORT)
    POSTGRES_DB: str = DB_NAME
    SQLALCHEMY_DATABASE_URI: str = SQLALCHEMY_DATABASE_URI
    DATABASE_URL: str = SQLALCHEMY_DATABASE_URI
    DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "20"))
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "10"))

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://:shiftboard_redis_pass@redis:6379/0")

    # JWT Authentication
    SECRET_KEY: str = os.getenv("SECRET_KEY", "fallback_secret_key_for_local_dev_only")
    JWT_SECRET_KEY: str = os.getenv(
        "JWT_SECRET_KEY",
        os.getenv("SECRET_KEY", "fallback_secret_key_for_local_dev_only")
    )
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

    # Super Admin Seeding
    SUPER_ADMIN_USERNAME: str = os.getenv("SUPER_ADMIN_USERNAME", "demo_admin@shiftboard.com")
    SUPER_ADMIN_PASSWORD: str = os.getenv("SUPER_ADMIN_PASSWORD", "SuperSecretDemo123!")

    # Firebase Mocking
    USE_MOCK_FIREBASE: bool = os.getenv("USE_MOCK_FIREBASE", "false").lower() in ("true", "1", "yes")
    FIREBASE_PROJECT_ID: str = os.getenv("FIREBASE_PROJECT_ID", "shiftboard-firebase-project")
    FIREBASE_CREDENTIALS_PATH: str = os.getenv("FIREBASE_CREDENTIALS_PATH", "/app/secrets/firebase_service_account.json")
    FIREBASE_WEB_CONFIG_PATH: str = os.getenv("FIREBASE_WEB_CONFIG_PATH", "/app/secrets/firebase-web-config.js")
    FIREBASE_AUTH_PROVIDERS: str = os.getenv("FIREBASE_AUTH_PROVIDERS", "")
    ALLOW_SELF_REGISTRATION: bool = os.getenv("ALLOW_SELF_REGISTRATION", "true").lower() in ("true", "1", "yes")
    SHOW_DEMO_LOGINS: bool = os.getenv("SHOW_DEMO_LOGINS", "false").lower() in ("true", "1", "yes")

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

    # Phase 28: Notifications
    APP_BASE_URL: str = os.getenv("APP_BASE_URL", "http://localhost:5173")   # used for links in emails / texts
    NOTIFICATIONS_WORKER_ENABLED: bool = os.getenv("NOTIFICATIONS_WORKER_ENABLED", "true").lower() in ("true", "1", "yes")
    NOTIFICATIONS_DIGEST_HOUR: int = int(os.getenv("NOTIFICATIONS_DIGEST_HOUR") or "9")   # local hour for daily new-shift emails
    EMAIL_PROVIDER: str = os.getenv("EMAIL_PROVIDER", "console")   # console | smtp | resend
    EMAIL_FROM: str = os.getenv("EMAIL_FROM", "ShiftBoard <no-reply@example.com>")
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT") or "587")
    SMTP_USERNAME: str = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_STARTTLS: bool = os.getenv("SMTP_STARTTLS", "true").lower() in ("true", "1", "yes")
    SMTP_SSL: bool = os.getenv("SMTP_SSL", "false").lower() in ("true", "1", "yes")
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
    SMS_PROVIDER: str = os.getenv("SMS_PROVIDER", "off")           # off | console | twilio
    TWILIO_ACCOUNT_SID: str = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_FROM_NUMBER: str = os.getenv("TWILIO_FROM_NUMBER", "")

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
