from __future__ import annotations

import secrets
import uuid
from typing import Optional

from app.config import settings


def generate_public_token() -> str:
    """Unguessable ticket URL segment — UUID + extra entropy."""
    return f"{uuid.uuid4().hex}{secrets.token_urlsafe(16)}"


def ticket_track_url(public_token: Optional[str]) -> Optional[str]:
    if not public_token:
        return None
    base = settings.frontend_base_url.rstrip("/")
    return f"{base}/my-ticket/{public_token}"
