"""
Telegram bot service — polling-based, no webhook required.

Flow:
  1. Patient gets token at reception.
  2. Registration page shows link: https://t.me/<BOT>?start=<public_token>
  3. Patient taps link → Telegram opens bot → sends /start <public_token>
  4. Bot looks up appointment, stores chat_id on it.
  5. Notifications sent automatically on queue events (with live status link).
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import httpx

from app.config import settings
from app.services.public_tokens import ticket_track_url

log = logging.getLogger("quivora.telegram")

TELEGRAM_API = "https://api.telegram.org/bot{token}/{method}"

_tg_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="tg-notify")


def _url(method: str) -> str:
    return TELEGRAM_API.format(token=settings.telegram_bot_token, method=method)


def _track_link(public_token: Optional[str]) -> str:
    url = ticket_track_url(public_token)
    if not url:
        return ""
    return f'\n\n🔗 <a href="{url}">Track live queue status</a>'


async def send_message(chat_id: str, text: str) -> bool:
    """Send a Telegram message. Returns True on success."""
    if not settings.telegram_bot_token:
        return False
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(_url("sendMessage"), json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
            })
            if r.status_code != 200:
                log.warning("Telegram sendMessage failed: %s", r.text[:200])
                return False
            return True
    except Exception as e:
        log.warning("Telegram send error: %s", e)
        return False


def _send_message_blocking(chat_id: str, text: str) -> bool:
    """Actual HTTP send — runs on the background thread pool."""
    if not settings.telegram_bot_token:
        return False
    try:
        r = httpx.post(_url("sendMessage"), json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
        }, timeout=8)
        if r.status_code != 200:
            log.warning("Telegram sendMessage failed: %s", r.text[:200])
            return False
        return True
    except Exception as e:
        log.warning("Telegram send error: %s", e)
        return False


def send_message_sync(chat_id: str, text: str) -> bool:
    """Queue a Telegram message in the background — returns immediately."""
    if not settings.telegram_bot_token or not chat_id:
        return False
    try:
        _tg_pool.submit(_send_message_blocking, chat_id, text)
        return True
    except Exception as e:
        log.warning("Telegram queue error: %s", e)
        return False


# ── Notification helpers ────────────────────────────────────────────────────

def notify_booked(
    chat_id: str,
    patient_name: str,
    token: int,
    patients_ahead: int,
    service: str,
    public_token: Optional[str] = None,
):
    msg = (
        f"👋 <b>Hi {patient_name}!</b>\n\n"
        f"You're registered at <b>{service}</b>.\n"
        f"🎫 <b>Token #{token}</b>\n"
        f"👥 <b>{patients_ahead}</b> patient{'s' if patients_ahead != 1 else ''} ahead of you.\n\n"
        f"I'll notify you when it's almost your turn!"
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def notify_almost_next(
    chat_id: str,
    patient_name: str,
    token: int,
    service: str,
    eta_time: Optional[str] = None,
    public_token: Optional[str] = None,
):
    eta_line = f"\n🕐 Approx time: <b>{eta_time}</b>" if eta_time else ""
    msg = (
        f"⏳ <b>{patient_name}, you're almost next!</b>\n\n"
        f"Token <b>#{token}</b> — 1 patient ahead of you at <b>{service}</b>.\n"
        f"Please stay nearby / start moving toward the room.{eta_line}"
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def notify_next(
    chat_id: str,
    patient_name: str,
    token: int,
    service: str,
    eta_time: Optional[str] = None,
    public_token: Optional[str] = None,
):
    eta_line = f"\n🕐 Approx time: <b>{eta_time}</b>" if eta_time else ""
    msg = (
        f"🔔 <b>{patient_name}, you're NEXT!</b>\n\n"
        f"Token <b>#{token}</b> — please proceed to <b>{service}</b> now.{eta_line}"
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def notify_started(
    chat_id: str,
    patient_name: str,
    token: int,
    service: str,
    public_token: Optional[str] = None,
):
    msg = (
        f"🩺 <b>Consultation started</b>\n\n"
        f"Hi {patient_name}, your session with <b>{service}</b> has begun.\n"
        f"Token #{token}"
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def notify_ended(chat_id: str, patient_name: str, service: str, public_token: Optional[str] = None):
    msg = (
        f"✅ <b>Consultation complete</b>\n\n"
        f"Hi {patient_name}, your visit with <b>{service}</b> is done.\n"
        f"Thank you for using Quivora. Stay healthy! 💚"
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def notify_no_show(chat_id: str, patient_name: str, token: int, public_token: Optional[str] = None):
    msg = (
        f"⚠️ <b>Marked as no-show</b>\n\n"
        f"Hi {patient_name}, token #{token} was marked as no-show.\n"
        f"Please visit the reception desk if you need to reschedule."
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def notify_doctor_live(
    chat_id: str,
    patient_name: str,
    token: int,
    doctor_name: str,
    eta_time: str,
    confidence_min: float,
    patients_ahead: int,
    public_token: Optional[str] = None,
):
    ahead_str = (
        "You are <b>next in line</b>" if patients_ahead == 0
        else f"<b>{patients_ahead}</b> patient{'s' if patients_ahead != 1 else ''} ahead of you"
    )
    msg = (
        f"🟢 <b>Dr. {doctor_name.replace('Dr. ', '')} is now live!</b>\n\n"
        f"Hi {patient_name} — your queue is now active.\n"
        f"🎫 Token <b>#{token}</b>\n"
        f"👥 {ahead_str}\n"
        f"🕐 Estimated time: <b>{eta_time}</b> (±{round(confidence_min)} min)"
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def notify_scan_live(
    chat_id: str,
    patient_name: str,
    token: int,
    machine_name: str,
    eta_time: str,
    confidence_min: float,
    patients_ahead: int,
    public_token: Optional[str] = None,
):
    ahead_str = (
        "You are <b>next in line</b>" if patients_ahead == 0
        else f"<b>{patients_ahead}</b> patient{'s' if patients_ahead != 1 else ''} ahead of you"
    )
    msg = (
        f"🟢 <b>{machine_name} is now live!</b>\n\n"
        f"Hi {patient_name} — your scan queue is active.\n"
        f"🎫 Token <b>#{token}</b>\n"
        f"👥 {ahead_str}\n"
        f"🕐 Estimated scan time: <b>{eta_time}</b> (±{round(confidence_min)} min)"
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def notify_break_started(
    chat_id: str,
    patient_name: str,
    token: int,
    doctor_name: str,
    public_token: Optional[str] = None,
):
    msg = (
        f"☕ <b>Short break</b>\n\n"
        f"Hi {patient_name}, <b>{doctor_name}</b> stepped away briefly.\n"
        f"Token <b>#{token}</b> — your wait time will update automatically when they're back."
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def notify_break_ended(
    chat_id: str,
    patient_name: str,
    token: int,
    doctor_name: str,
    eta_time: Optional[str] = None,
    public_token: Optional[str] = None,
):
    eta_line = f"\n🕐 Updated ETA: <b>{eta_time}</b>" if eta_time else ""
    msg = (
        f"🟢 <b>Back from break</b>\n\n"
        f"Hi {patient_name}, <b>{doctor_name}</b> has resumed consultations.{eta_line}\n"
        f"Token <b>#{token}</b>"
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def notify_running_late(
    chat_id: str,
    patient_name: str,
    token: int,
    doctor_name: str,
    minutes: int,
    eta_time: Optional[str] = None,
    public_token: Optional[str] = None,
):
    eta_line = f"\n🕐 New estimated time: <b>{eta_time}</b>" if eta_time else ""
    msg = (
        f"⏱ <b>Schedule update</b>\n\n"
        f"Hi {patient_name}, <b>{doctor_name}</b> is running about <b>{minutes} min late</b>."
        f"{eta_line}\n"
        f"Token <b>#{token}</b> — thanks for your patience."
        f"{_track_link(public_token)}"
    )
    send_message_sync(chat_id, msg)


def _resolve_appointment(db, payload: str):
    from app.models import Appointment, ScanAppointment

    if not payload:
        return None, None

    if payload.isdigit():
        appt = db.get(Appointment, int(payload))
        if appt:
            return appt, None
        scan_appt = db.get(ScanAppointment, int(payload))
        return None, scan_appt

    from sqlalchemy import select
    appt = db.execute(
        select(Appointment).where(Appointment.public_token == payload)
    ).scalar_one_or_none()
    if appt:
        return appt, None
    scan_appt = db.execute(
        select(ScanAppointment).where(ScanAppointment.public_token == payload)
    ).scalar_one_or_none()
    return None, scan_appt


# ── Bot polling loop ────────────────────────────────────────────────────────

async def _process_update(update: dict) -> None:
    """Handle a single Telegram update."""
    from app.db import SessionLocal
    from app.models import Appointment, ScanAppointment, AppointmentStatus, ScanStatus
    from sqlalchemy import func, select

    msg = update.get("message") or update.get("channel_post")
    if not msg:
        return

    chat_id = str(msg["chat"]["id"])
    text = (msg.get("text") or "").strip()

    if not text.startswith("/start"):
        await send_message(chat_id,
            "👋 Hello! To link your queue token, tap the link you received at registration.\n\n"
            "Format: <code>/start &lt;your-ticket-code&gt;</code>"
        )
        return

    parts = text.split(maxsplit=1)
    payload = parts[1].strip() if len(parts) > 1 else ""

    if not payload:
        await send_message(chat_id,
            "⚠️ Couldn't find your appointment. Please use the link from the registration desk."
        )
        return

    with SessionLocal() as db:
        appt, scan_appt = _resolve_appointment(db, payload)

        if appt:
            appt.telegram_chat_id = chat_id
            db.commit()
            ahead = db.execute(
                select(func.count()).where(
                    Appointment.doctor_id == appt.doctor_id,
                    Appointment.status.in_([AppointmentStatus.scheduled, AppointmentStatus.checked_in]),
                    Appointment.token < appt.token,
                )
            ).scalar() or 0
            doctor = appt.doctor
            notify_booked(
                chat_id,
                appt.patient.name,
                appt.token,
                ahead,
                doctor.name,
                appt.public_token,
            )
            return

        if scan_appt:
            scan_appt.telegram_chat_id = chat_id
            db.commit()
            ahead = db.execute(
                select(func.count()).where(
                    ScanAppointment.machine_id == scan_appt.machine_id,
                    ScanAppointment.status.in_([ScanStatus.scheduled, ScanStatus.arrived]),
                    ScanAppointment.token < scan_appt.token,
                )
            ).scalar() or 0
            machine = scan_appt.machine
            notify_booked(
                chat_id,
                scan_appt.patient.name,
                scan_appt.token,
                ahead,
                machine.name,
                scan_appt.public_token,
            )
            return

    await send_message(chat_id,
        "⚠️ Appointment not found. Please check with the reception desk."
    )


async def run_polling():
    """Long-poll Telegram for updates. Runs forever as an asyncio task."""
    if not settings.telegram_bot_token:
        log.info("Telegram bot token not set — polling disabled.")
        return

    log.info("Telegram bot polling started (@%s)", settings.telegram_bot_username or "?")
    offset = 0

    async with httpx.AsyncClient(timeout=35) as client:
        while True:
            try:
                r = await client.get(_url("getUpdates"), params={
                    "offset": offset,
                    "timeout": 30,
                    "allowed_updates": ["message"],
                })
                if r.status_code != 200:
                    log.warning("getUpdates error %d: %s", r.status_code, r.text[:100])
                    await asyncio.sleep(5)
                    continue

                updates = r.json().get("result", [])
                for upd in updates:
                    offset = upd["update_id"] + 1
                    try:
                        await _process_update(upd)
                    except Exception as e:
                        log.warning("Error processing update: %s", e)

            except asyncio.CancelledError:
                log.info("Telegram polling cancelled.")
                return
            except Exception as e:
                log.warning("Polling error: %s — retrying in 5s", e)
                await asyncio.sleep(5)
