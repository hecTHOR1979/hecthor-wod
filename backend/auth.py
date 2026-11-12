import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException, Request

from .database import get_db

TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 días


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return f"pbkdf2${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, salt_hex, digest_hex = stored_hash.split("$", 2)
        if scheme != "pbkdf2":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _get_setting(key: str) -> Optional[str]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else None


def _set_setting(key: str, value: str) -> None:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()
    conn.close()


def get_secret_key() -> bytes:
    env_key = os.environ.get("CROSSFIT_SECRET_KEY") or os.environ.get("APP_SECRET_KEY")
    if env_key:
        return env_key.encode("utf-8")
    stored = _get_setting("secret_key")
    if not stored:
        stored = secrets.token_hex(32)
        _set_setting("secret_key", stored)
    return stored.encode("utf-8")


def is_coach_configured() -> bool:
    if os.environ.get("COACH_PASSWORD"):
        return True
    return bool(_get_setting("coach_password_hash"))


def get_coach_username() -> str:
    return (os.environ.get("COACH_USERNAME") or _get_setting("coach_username") or "coach").strip().lower()


def verify_coach_credentials(username: str, password: str) -> bool:
    expected_user = get_coach_username()
    if username and username.strip().lower() != expected_user:
        return False
    env_pw = os.environ.get("COACH_PASSWORD")
    if env_pw:
        return hmac.compare_digest(password.encode("utf-8"), env_pw.encode("utf-8"))
    stored_hash = _get_setting("coach_password_hash")
    if not stored_hash:
        return False
    return verify_password(password, stored_hash)


def set_coach_credentials(username: str, password: str) -> None:
    clean_user = (username or "coach").strip().lower() or "coach"
    _set_setting("coach_username", clean_user)
    _set_setting("coach_password_hash", hash_password(password))


def get_coach_token_version() -> str:
    env_pw = os.environ.get("COACH_PASSWORD")
    raw = env_pw or (_get_setting("coach_password_hash") or "")
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def create_token(payload: Dict[str, Any]) -> str:
    body = {
        **payload,
        "iat": int(time.time()),
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    raw = json.dumps(body, separators=(",", ":"), sort_keys=True).encode("utf-8")
    b64 = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    sig = hmac.new(get_secret_key(), b64.encode("ascii"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")
    return f"{b64}.{sig_b64}"


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        b64, sig_b64 = token.split(".", 1)
        expected_sig = hmac.new(get_secret_key(), b64.encode("ascii"), hashlib.sha256).digest()
        padded_sig = sig_b64 + "=" * (-len(sig_b64) % 4)
        actual_sig = base64.urlsafe_b64decode(padded_sig.encode("ascii"))
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        padded_body = b64 + "=" * (-len(b64) % 4)
        body = json.loads(base64.urlsafe_b64decode(padded_body.encode("ascii")).decode("utf-8"))
        if int(body.get("exp", 0)) < int(time.time()):
            return None
        return body
    except Exception:
        return None


def _extract_bearer_token(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    cookie_tok = request.cookies.get("cf_session")
    if cookie_tok:
        return cookie_tok.strip()
    return None


def get_current_actor(request: Request) -> Optional[Dict[str, Any]]:
    token = _extract_bearer_token(request)
    if not token:
        return None
    claims = decode_token(token)
    if not claims:
        return None

    role = claims.get("role")
    if role == "coach":
        if not is_coach_configured():
            return None
        if claims.get("ver") != get_coach_token_version():
            return None
        return {"role": "coach", "username": get_coach_username()}

    if role == "student":
        student_id = claims.get("student_id")
        if not student_id:
            return None
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, full_name, email, phone, status, assigned_microcycle_id FROM students WHERE id = ?",
            (student_id,),
        )
        row = cursor.fetchone()
        conn.close()
        if not row or row["status"] != "approved":
            return None
        return {
            "role": "student",
            "id": row["id"],
            "full_name": row["full_name"],
            "email": row["email"],
            "phone": row["phone"],
            "assigned_microcycle_id": row["assigned_microcycle_id"],
        }
    return None


def require_coach(request: Request) -> Dict[str, Any]:
    actor = get_current_actor(request)
    if not actor or actor.get("role") != "coach":
        raise HTTPException(status_code=401, detail="Acceso privado del entrenador. Inicia sesión.")
    return actor


def require_student_or_coach(request: Request) -> Dict[str, Any]:
    actor = get_current_actor(request)
    if not actor:
        raise HTTPException(status_code=401, detail="Sesión requerida. Inicia sesión para ver tus entrenamientos.")
    return actor
