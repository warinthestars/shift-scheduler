"""
Phase 34.5: refuse JSON request bodies that contain NaN / Infinity / -Infinity.

They aren't valid JSON, but Python's json module (which FastAPI uses) accepts them, and then:
  * a float field with limits (e.g. latitude between -90 and 90) fails validation, and FastAPI's own 422
    handler crashes trying to echo NaN back as JSON  -> a 500 instead of a clear error;
  * a float field without limits (e.g. a pay rate) quietly saves NaN in the database.
This ASGI middleware checks POST / PUT / PATCH bodies sent as application/json once, before any route runs,
and answers 422 in the same shape FastAPI uses (the frontend's friendly-error handler turns it into a sentence).
Everything else passes through untouched (the body is replayed to the app exactly as received).
"""
import json

from starlette.responses import JSONResponse

_BAD = ("NaN", "Infinity", "-Infinity")
_METHODS = ("POST", "PUT", "PATCH")


class _NonFinite(ValueError):
    pass


def _refuse(token: str):
    raise _NonFinite(token)


class RejectNonFiniteJSON:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in _METHODS:
            return await self.app(scope, receive, send)
        ctype = ""
        for k, v in scope.get("headers") or []:
            if k == b"content-type":
                ctype = v.decode("latin-1").lower()
                break
        if "json" not in ctype:
            return await self.app(scope, receive, send)

        # Read the whole body once
        body = b""
        first_other = None
        while True:
            message = await receive()
            if message["type"] != "http.request":
                first_other = message          # e.g. http.disconnect: hand it on unchanged
                break
            body += message.get("body", b"")
            if not message.get("more_body", False):
                break

        if body and first_other is None:
            try:
                json.loads(body, parse_constant=_refuse)
            except _NonFinite as e:
                response = JSONResponse(status_code=422, content={"detail": [{
                    "type": "finite_number",
                    "loc": ["body"],
                    "msg": f"Numbers must be real numbers ({e} isn't allowed).",
                    "input": None,
                }]})
                return await response(scope, receive, send)
            except ValueError:
                pass                                   # other bad JSON: FastAPI reports it as usual

        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                if first_other is not None:
                    return first_other
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
