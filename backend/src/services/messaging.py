"""
Phase 28: Outbound email and SMS.

EMAIL_PROVIDER: console (log only, the default) | smtp | resend
SMS_PROVIDER:   off (default) | console (log only) | twilio
No extra packages: SMTP uses the standard library (run in a thread), Resend and Twilio use httpx.
Every function returns (ok: bool, error: Optional[str]) and never raises.
"""
import asyncio
import html
import logging
import re
import smtplib
import ssl
from email.message import EmailMessage
from typing import Optional, Tuple

import httpx

from src.config import settings

logger = logging.getLogger("shiftboard.messaging")


def email_available() -> bool:
    return (settings.EMAIL_PROVIDER or "console").lower() in ("smtp", "resend")


def sms_available() -> bool:
    return (settings.SMS_PROVIDER or "off").lower() in ("twilio", "console")


def absolute_link(link: Optional[str]) -> str:
    base = (settings.APP_BASE_URL or "").rstrip("/")
    if not link:
        return base or "/"
    if link.startswith("http://") or link.startswith("https://"):
        return link
    return f"{base}{link if link.startswith('/') else '/' + link}"


def normalize_phone(raw: Optional[str]) -> Optional[str]:
    """Best-effort E.164. US/Canada 10-digit numbers get +1. Returns None if it can't be used."""
    if not raw:
        return None
    s = raw.strip()
    digits = re.sub(r"\D", "", s)
    if s.startswith("+") and 8 <= len(digits) <= 15:
        return "+" + digits
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return None


def render_email(title: str, body: Optional[str], link: Optional[str], footer_link: Optional[str] = None) -> Tuple[str, str]:
    """Returns (plain_text, html) for a single notification."""
    url = absolute_link(link)
    settings_url = absolute_link(footer_link or "/?notifications=settings")
    text = f"{title}\n\n{body or ''}\n\nOpen ShiftBoard: {url}\n\nChange what we send you: {settings_url}\n"
    html_body = f"""<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px;color:#0f172a">
  <h2 style="margin:0 0 8px;font-size:18px">{html.escape(title)}</h2>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.5;white-space:pre-line">{html.escape(body or '')}</p>
  <a href="{html.escape(url)}" style="display:inline-block;background:#10b981;color:#0f172a;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:10px;font-size:14px">Open ShiftBoard</a>
  <p style="margin:24px 0 0;font-size:12px;color:#64748b">You're getting this because of your ShiftBoard notification settings.
  <a href="{html.escape(settings_url)}" style="color:#64748b">Change what we send you</a>.</p>
</div>"""
    return text, html_body


def render_digest(items, footer_link: Optional[str] = None) -> Tuple[str, str, str]:
    """items: list of (title, body, link). Returns (subject, plain_text, html)."""
    n = len(items)
    subject = f"{n} new shift{'s' if n != 1 else ''} posted" if n else "New shifts posted"
    settings_url = absolute_link(footer_link or "/?notifications=settings")
    lines = [f"- {t}\n  {b or ''}\n  {absolute_link(l)}" for t, b, l in items]
    text = f"{subject}\n\n" + "\n\n".join(lines) + f"\n\nChange what we send you: {settings_url}\n"
    rows = "".join(
        f'<li style="margin:0 0 12px"><a href="{html.escape(absolute_link(l))}" style="color:#047857;font-weight:700;text-decoration:none">{html.escape(t)}</a>'
        f'<div style="font-size:13px;color:#334155">{html.escape(b or "")}</div></li>'
        for t, b, l in items
    )
    html_body = f"""<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px;color:#0f172a">
  <h2 style="margin:0 0 12px;font-size:18px">{html.escape(subject)}</h2>
  <ul style="padding-left:18px;margin:0">{rows}</ul>
  <p style="margin:24px 0 0;font-size:12px;color:#64748b"><a href="{html.escape(settings_url)}" style="color:#64748b">Change what we send you</a>.</p>
</div>"""
    return subject, text, html_body


def _smtp_send_blocking(to: str, subject: str, text: str, html_body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.EMAIL_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    if settings.SMTP_SSL:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=ssl.create_default_context(), timeout=20) as s:
            if settings.SMTP_USERNAME:
                s.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            s.send_message(msg)
    else:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as s:
            if settings.SMTP_STARTTLS:
                s.starttls(context=ssl.create_default_context())
            if settings.SMTP_USERNAME:
                s.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            s.send_message(msg)


async def send_email(to: str, subject: str, text: str, html_body: str) -> Tuple[bool, Optional[str]]:
    provider = (settings.EMAIL_PROVIDER or "console").lower()
    try:
        if provider == "smtp":
            if not settings.SMTP_HOST:
                return False, "SMTP_HOST is not set"
            await asyncio.to_thread(_smtp_send_blocking, to, subject, text, html_body)
            return True, None
        if provider == "resend":
            if not settings.RESEND_API_KEY:
                return False, "RESEND_API_KEY is not set"
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                    json={"from": settings.EMAIL_FROM, "to": [to], "subject": subject, "text": text, "html": html_body},
                )
            if r.status_code >= 300:
                return False, f"Resend {r.status_code}: {r.text[:300]}"
            return True, None
        logger.info(f"[email:console] to={to} subject={subject!r}\n{text}")
        return True, None
    except Exception as e:
        logger.warning(f"Email to {to} failed: {e}")
        return False, str(e)[:500]


async def send_sms(to_raw: str, text: str) -> Tuple[bool, Optional[str]]:
    provider = (settings.SMS_PROVIDER or "off").lower()
    to = normalize_phone(to_raw)
    if not to:
        return False, "Phone number isn't usable for texts"
    body = text if len(text) <= 320 else text[:317] + "..."
    try:
        if provider == "twilio":
            if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_FROM_NUMBER):
                return False, "Twilio settings are incomplete"
            url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(
                    url,
                    auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
                    data={"From": settings.TWILIO_FROM_NUMBER, "To": to, "Body": body},
                )
            if r.status_code >= 300:
                return False, f"Twilio {r.status_code}: {r.text[:300]}"
            return True, None
        if provider == "console":
            logger.info(f"[sms:console] to={to}: {body}")
            return True, None
        return False, "SMS is off"
    except Exception as e:
        logger.warning(f"SMS to {to} failed: {e}")
        return False, str(e)[:500]
