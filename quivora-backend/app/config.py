from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg2://quivora:quivora@localhost:5434/quivora"
    redis_url: str = "redis://localhost:6379/0"
    api_key: str = "quivora-dev-key"
    train_total_seconds: float = 120.0
    train_fast: bool = False
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    frontend_base_url: str = "http://127.0.0.1:3000"
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    # When set, every new appointment is auto-linked to this chat (for testing).
    # Use @username or a numeric chat_id. Patient still gets the bot link too.
    telegram_test_recipient: str = ""
    # India SMS: auto | fast2sms | log | off
    # auto → Fast2SMS when API key set, else free local log fallback
    sms_provider: str = "auto"
    # Free signup credit at https://www.fast2sms.com — Quick route (no DLT)
    fast2sms_api_key: str = ""
    # development | staging | production
    env: str = "development"
    jwt_secret: str = "quivora-dev-jwt-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: float = 12.0
    doctor_room_token_hours: float = 8.0
    patient_token_hours: float = 24.0
    bootstrap_platform_email: str = "admin@quivora.local"
    bootstrap_platform_password: str = "Quivora@123"

    class Config:
        env_prefix = "QUIVORA_"
        env_file = ".env"
        extra = "ignore"

    @property
    def cors_origin_list(self):
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.env.strip().lower() == "production"


settings = Settings()
