"""Field-level encryption for sensitive JSON payloads (Fernet: AES-128-CBC + HMAC-SHA256).

Database-level encryption at rest (managed PostgreSQL / disk encryption) is still required;
this adds defence in depth so a database dump alone does not reveal drink or symptom data.
"""

from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator

from app.config import get_settings

_PLAIN_PREFIX = "plain:"
_ENC_PREFIX = "fernet:"


def _fernet() -> Fernet | None:
    key = get_settings().field_encryption_key
    return Fernet(key.encode()) if key else None


def encrypt_json(value: Any) -> str:
    text = json.dumps(value, separators=(",", ":"), sort_keys=True)
    f = _fernet()
    return _ENC_PREFIX + f.encrypt(text.encode()).decode() if f else _PLAIN_PREFIX + text


def decrypt_json(stored: str) -> Any:
    if stored.startswith(_ENC_PREFIX):
        f = _fernet()
        if f is None:
            raise RuntimeError("Encrypted field found but THRESHOLD_FIELD_ENCRYPTION_KEY is not configured")
        try:
            return json.loads(f.decrypt(stored[len(_ENC_PREFIX) :].encode()))
        except InvalidToken as exc:
            raise RuntimeError("Field decryption failed (wrong key?)") from exc
    if stored.startswith(_PLAIN_PREFIX):
        return json.loads(stored[len(_PLAIN_PREFIX) :])
    return json.loads(stored)


class EncryptedJSON(TypeDecorator[Any]):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Dialect) -> str | None:
        return None if value is None else encrypt_json(value)

    def process_result_value(self, value: str | None, dialect: Dialect) -> Any:
        return None if value is None else decrypt_json(value)
