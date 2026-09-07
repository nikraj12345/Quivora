import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.routes import router
from app.api.auth_routes import router as auth_router
from app.config import settings
from app.db import Base, engine, SessionLocal
from app.db_migrate import ensure_schema
from app.services.bootstrap_auth import ensure_bootstrap_users, ensure_doctor_room_pins


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_schema()
    with SessionLocal() as db:
        ensure_doctor_room_pins(db)
        ensure_bootstrap_users(db)

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

app.add_middleware(GZipMiddleware, minimum_size=500)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "Authorization", "Accept"],
)

app.include_router(router)
app.include_router(auth_router)
