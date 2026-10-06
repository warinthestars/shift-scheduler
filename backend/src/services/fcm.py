"""
Phase 33.0.1: Firebase Cloud Messaging (FCM) for phone / browser notifications.

Used when all of these are in place (otherwise ShiftUp keeps using its own Web Push, services/webpush.py):
  * the service-account key file   .secrets/firebase_service_account.json   (FIREBASE_CREDENTIALS_PATH)
  * FIREBASE_VAPID_KEY in the root .env  (Firebase console -> Project settings -> Cloud Messaging ->
    Web Push certificates -> the "Key pair" value)
  * messagingSenderId and appId in .secrets/firebase-web-config.js (already there when sign-in with Firebase works)

Messages are DATA-only, so ShiftUp's own service worker (public/sw.js) shows them exactly like Web Push ones.
Every function here returns results and never raises.
"""
import logging
import os
from typing import Dict, List, Optional, Tuple

from src.config import settings

logger = logging.getLogger("shiftboard.fcm")

APP_NAME = "shiftboard-messaging"
TTL_SECONDS = 24 * 3600
_state: Dict[str, object] = {"app": None, "error": None, "path": None}


def vapid_key() -> str:
    return (os.getenv("FIREBASE_VAPID_KEY") or "").strip()


def web_config() -> Optional[Dict[str, str]]:
    try:
        from src.services.firebase import load_firebase_web_config
        return load_firebase_web_config()
    except Exception:
        return None


def missing() -> List[str]:
    """What's still needed before Firebase can send (empty list = ready to try)."""
    out = []
    if not os.path.isfile(settings.FIREBASE_CREDENTIALS_PATH):
        out.append("service account key (.secrets/firebase_service_account.json)")
    if not vapid_key():
        out.append("FIREBASE_VAPID_KEY in .env")
    cfg = web_config() or {}
    if not cfg.get("messagingSenderId") or not cfg.get("appId"):
        out.append("messagingSenderId and appId in .secrets/firebase-web-config.js")
    return out


def _app():
    """The firebase_admin app used for messaging, or None (the reason is kept in _state['error'])."""
    path = settings.FIREBASE_CREDENTIALS_PATH
    if _state["app"] is not None and _state["path"] == path:
        return _state["app"]
    try:
        import firebase_admin
        from firebase_admin import credentials
        try:
            app = firebase_admin.get_app(APP_NAME)
        except ValueError:
            app = firebase_admin.initialize_app(credentials.Certificate(path), name=APP_NAME)
        _state.update(app=app, error=None, path=path)
        return app
    except Exception as e:
        _state.update(app=None, error=f"Firebase couldn't start: {e}", path=path)
        logger.warning(_state["error"])
        return None


def ready() -> bool:
    return not missing() and _app() is not None


def status() -> Dict[str, object]:
    """For Admin -> System."""
    need = missing()
    ok = not need and _app() is not None
    return {"ready": ok, "missing": need, "error": None if ok or need else _state["error"]}


def client_config() -> Optional[Dict[str, object]]:
    """What the browser needs to get a Firebase token: the web config and the Web Push certificate key."""
    if not ready():
        return None
    return {"config": web_config(), "vapid_key": vapid_key()}


def _is_gone(exc) -> bool:
    """The token will never work again (app uninstalled, notifications revoked, wrong project)."""
    try:
        from firebase_admin import messaging
        if isinstance(exc, (messaging.UnregisteredError, messaging.SenderIdMismatchError)):
            return True
    except Exception:
        pass
    code = str(getattr(exc, "code", "") or "").upper()
    return code in ("NOT_FOUND", "UNREGISTERED") or "registration-token-not-registered" in str(exc)


async def send(tokens: List[str], data: Dict[str, str], urgent: bool = False) -> List[Tuple[str, bool, bool, Optional[str]]]:
    """Sends one data message to each token. Returns [(token, ok, gone, error)]."""
    if not tokens:
        return []
    app = _app()
    if app is None or missing():
        err = "Firebase messaging isn't set up" + (f": {', '.join(missing())}" if missing() else "")
        return [(t, False, False, err) for t in tokens]
    try:
        from firebase_admin import messaging
        payload = {k: str(v) for k, v in data.items() if v is not None}     # FCM data values must be strings
        webpush = messaging.WebpushConfig(headers={"Urgency": "high" if urgent else "normal", "TTL": str(TTL_SECONDS)})
        messages = [messaging.Message(token=t, data=payload, webpush=webpush) for t in tokens]
        batch = await messaging.send_each_async(messages, app=app)
    except Exception as e:
        return [(t, False, False, f"Firebase: {e}") for t in tokens]
    out = []
    for token, resp in zip(tokens, batch.responses):
        if resp.success:
            out.append((token, True, False, None))
        else:
            out.append((token, False, _is_gone(resp.exception), f"Firebase: {resp.exception}"))
    return out
