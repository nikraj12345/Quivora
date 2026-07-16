import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import settings
from app.db import Base, engine
from app.db_migrate import ensure_schema


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_schema()

    # Start Telegram bot polling if token is configured
    tg_task = None
    if settings.telegram_bot_token:
        from app.services.telegram_bot import run_polling
        tg_task = asyncio.create_task(run_polling())

    yield

    if tg_task:
        tg_task.cancel()
        try:
            await tg_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Quivora", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "Authorization", "Accept"],
)

app.include_router(router)
