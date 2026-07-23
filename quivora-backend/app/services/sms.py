"""
India SMS notifications via Fast2SMS Quick route (no DLT for demo/dev).

Providers:
  - fast2sms — real SMS to Indian mobiles (free signup credit at fast2sms.com)
  - log      — free local fallback: writes SMS to logs (no API key needed)
  - auto     — fast2sms if QUIVORA_FAST2SMS_API_KEY set, else log
  - off      — disabled

Phone numbers are normalized to 10-digit Indian mobiles.
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import httpx

from app.config import settings
from app.services.public_tokens import ticket_track_url

log = logging.getLogger("quivora.sms")

FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2"
_sms_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="sms-notify")


def normalize_mobile(phone: Optional[str]) -> Optional[str]:
    """Return 10-digit Indian mobile, or None if invalid."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("91") and len(digits) >= 12:
        digits = digits[-10:]
    elif len(digits) > 10:
        digits = digits[-10:]
    if len(digits) != 10 or digits[0] not in "6789":
        return None
    return digits


def effective_provider() -> Optional[str]:
    p = (settings.sms_provider or "auto").strip().lower()
    if p in ("off", "none", "disabled", "false", "0"):
        return None
    if p == "log":
        return "log"
    if p == "fast2sms":
        return "fast2sms" if settings.fast2sms_api_key.strip() else None
    # auto
    if settings.fast2sms_api_key.strip():
        return "fast2sms"
    return "log"


def sms_status() -> dict:
    provider = effective_provider()
    return {
        "sms_enabled": provider is not None,
        "sms_provider": provider,
    }


def _send_fast2sms(number: str, message: str) -> bool:
    try:
        r = httpx.post(
            FAST2SMS_URL,
            headers={
                "authorization": settings.fast2sms_api_key.strip(),
                "Content-Type": "application/json",
            },
            json={
                "route": "q",
                "message": message,
                "numbers": number,
                "flash": 0,
            },
            timeout=12,
        )
        data = r.json() if r.content else {}
        ok = r.status_code == 200 and bool(data.get("return", False))
        if not ok:
            log.warning("Fast2SMS failed (%s): %s", r.status_code, str(data)[:240])
            return False
        log.info("Fast2SMS sent → +91%s request_id=%s", number, data.get("request_id"))
        return True
    except Exception as e:
        log.warning("Fast2SMS send error: %s", e)
        return False


def _send_blocking(phone: str, message: str) -> bool:
    number = normalize_mobile(phone)
    if not number:
        log.warning("SMS skipped — invalid phone: %r", phone)
        return False
    provider = effective_provider()
    if not provider:
        return False
    if provider == "log":
        log.info("SMS[log] → +91%s | %s", number, message)
        return True
    if provider == "fast2sms":
        ok = _send_fast2sms(number, message)
        if not ok:
            # Fall back to log so demos still show what would have been sent
            log.warning("SMS[fallback-log] → +91%s | %s", number, message)
        return ok
    return False


def send_sms(phone: Optional[str], message: str, *, sync: bool = False) -> bool:
    """Send SMS. By default queues in background; sync=True waits for the HTTP call."""
    if not phone or not message or not effective_provider():
        return False
    if not normalize_mobile(phone):
        return False
    if sync:
        return _send_blocking(phone, message)
    try:
        _sms_pool.submit(_send_blocking, phone, message)
        return True
    except Exception as e:
        log.warning("SMS queue error: %s", e)
        return False


def phone_from_patient(patient) -> Optional[str]:
    if patient is None:
        return None
    return getattr(patient, "phone", None)


def _track_suffix(public_token: Optional[str] = None) -> str:
    url = ticket_track_url(public_token)
    if not url:
        return ""
    return f" Track live: {url}"


# ── Notification helpers (plain text, SMS-safe) ─────────────────────────────

def notify_booked(
    phone: Optional[str],
    patient_name: str,
    token: int,
    patients_ahead: int,
    service: str,
    *,
    current_token: Optional[int] = None,
    wait_seconds: Optional[int] = None,
    eta_time: Optional[str] = None,
    doctor_live: bool = False,
    sync: bool = False,
    public_token: Optional[str] = None,
):
    """Registration confirmation SMS with live queue context."""
    parts = [
        f"Quivora: Hi {patient_name}. Registered at {service}.",
        f"Your token #{token}.",
    ]
    if current_token is not None:
        parts.append(f"Now serving #{current_token}.")
    else:
        parts.append("No one being served yet.")
    parts.append(f"{patients_ahead} ahead of you.")
    if doctor_live and wait_seconds is not None:
        wait_min = max(1, round(wait_seconds / 60)) if wait_seconds > 0 else 0
        if wait_min > 0:
            parts.append(f"Est. wait ~{wait_min} min.")
        if eta_time:
            parts.append(f"Expected ~{eta_time}.")
    elif not doctor_live:
        parts.append("ETA starts when doctor goes live.")
    parts.append("We'll SMS again when you're next.")
    parts.append(_track_suffix(public_token).lstrip())
    return send_sms(phone, " ".join(p for p in parts if p), sync=sync)


def notify_almost_next(
    phone: Optional[str],
    patient_name: str,
    token: int,
    service: str,
    eta_time: Optional[str] = None,
    current_token: Optional[int] = None,
    wait_seconds: Optional[int] = None,
    public_token: Optional[str] = None,
):
    bits = [f"Quivora: {patient_name}, almost next! Your token #{token} at {service}."]
    if current_token is not None:
        bits.append(f"Now serving #{current_token}.")
    bits.append("1 ahead — stay nearby.")
    if wait_seconds is not None and wait_seconds > 0:
        bits.append(f"Est. wait ~{max(1, round(wait_seconds / 60))} min.")
    if eta_time:
        bits.append(f"Expected ~{eta_time}.")
    bits.append(_track_suffix(public_token).lstrip())
    send_sms(phone, " ".join(p for p in bits if p))


def notify_next(
    phone: Optional[str],
    patient_name: str,
    token: int,
    service: str,
    eta_time: Optional[str] = None,
    current_token: Optional[int] = None,
    wait_seconds: Optional[int] = None,
    public_token: Optional[str] = None,
):
    bits = [f"Quivora: {patient_name}, you're NEXT! Token #{token} at {service}. Please proceed."]
    if current_token is not None:
        bits.append(f"Now serving #{current_token}.")
    if eta_time:
        bits.append(f"Expected ~{eta_time}.")
    bits.append(_track_suffix(public_token).lstrip())
    send_sms(phone, " ".join(p for p in bits if p))


def notify_started(
    phone: Optional[str],
    patient_name: str,
    token: int,
    service: str,
    public_token: Optional[str] = None,
):
    msg = f"Quivora: {patient_name}, consultation started for token #{token} ({service}).{_track_suffix(public_token)}"
    send_sms(phone, msg)


def notify_ended(phone: Optional[str], patient_name: str, service: str, public_token: Optional[str] = None):
    msg = f"Quivora: {patient_name}, consultation complete at {service}. Thank you!{_track_suffix(public_token)}"
    send_sms(phone, msg)


def notify_no_show(phone: Optional[str], patient_name: str, token: int, public_token: Optional[str] = None):
    msg = f"Quivora: {patient_name}, token #{token} marked no-show. Visit reception if needed.{_track_suffix(public_token)}"
    send_sms(phone, msg)


def notify_doctor_live(
    phone: Optional[str],
    patient_name: str,
    token: int,
    service: str,
    eta_time: str,
    confidence_min: float,
    patients_ahead: int,
    public_token: Optional[str] = None,
):
    msg = (
        f"Quivora: {patient_name}, doctor is LIVE for {service}. "
        f"Token #{token}, {patients_ahead} ahead, ETA ~{eta_time}.{_track_suffix(public_token)}"
    )
    send_sms(phone, msg)


def notify_scan_live(
    phone: Optional[str],
    patient_name: str,
    token: int,
    service: str,
    eta_time: str,
    confidence_min: float,
    patients_ahead: int,
    public_token: Optional[str] = None,
):
    msg = (
        f"Quivora: {patient_name}, scan queue LIVE at {service}. "
        f"Token #{token}, {patients_ahead} ahead, ETA ~{eta_time}.{_track_suffix(public_token)}"
    )
    send_sms(phone, msg)


def notify_break_started(
    phone: Optional[str],
    patient_name: str,
    token: int,
    doctor_name: str,
    public_token: Optional[str] = None,
):
    msg = f"Quivora: {patient_name}, {doctor_name} is on a short break. Token #{token} — hang tight.{_track_suffix(public_token)}"
    send_sms(phone, msg)


def notify_break_ended(
    phone: Optional[str],
    patient_name: str,
    token: int,
    doctor_name: str,
    eta_time: Optional[str] = None,
    public_token: Optional[str] = None,
):
    eta = f" New ETA ~{eta_time}." if eta_time else ""
    msg = f"Quivora: {patient_name}, {doctor_name} is back. Token #{token}.{eta}{_track_suffix(public_token)}"
    send_sms(phone, msg)


def notify_running_late(
    phone: Optional[str],
    patient_name: str,
    token: int,
    doctor_name: str,
    minutes: int,
    eta_time: Optional[str] = None,
    public_token: Optional[str] = None,
):
    eta = f" New ETA ~{eta_time}." if eta_time else ""
    msg = (
        f"Quivora: {patient_name}, {doctor_name} running ~{minutes} min late. "
        f"Token #{token}.{eta}{_track_suffix(public_token)}"
    )
    send_sms(phone, msg)
