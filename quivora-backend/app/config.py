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

    class Config:
        env_prefix = "QUIVORA_"
        env_file = ".env"
        extra = "ignore"

    @property
    def cors_origin_list(self):
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
