"""Structured JSON logging with sensitive-data redaction.

Request/response bodies are never logged. Any log record field whose key looks sensitive
(tokens, passwords, payloads, health or drink values) is replaced with "[REDACTED]", and
email addresses / bearer tokens inside messages are masked.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import Any

SENSITIVE_KEYS = re.compile(
    r"(pass(word)?|secret|token|authorization|cookie|payload|email|abv|ethanol|standard_drinks|heart|hrv|sleep|symptom|"
    r"checkin|drink|consent_text|weight|height|notes?)",
    re.IGNORECASE,
)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
BEARER_RE = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+")
_STANDARD_ATTRS = set(vars(logging.LogRecord("", 0, "", 0, "", (), None)).keys()) | {"message", "asctime"}


def redact(value: Any, key: str | None = None) -> Any:
    if key is not None and SENSITIVE_KEYS.search(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {k: redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [redact(v) for v in value]
    if isinstance(value, str):
        return BEARER_RE.sub("Bearer [REDACTED]", EMAIL_RE.sub("[EMAIL]", value))
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": redact(record.getMessage()),
        }
        for k, v in vars(record).items():
            if k not in _STANDARD_ATTRS and not k.startswith("_"):
                entry[k] = redact(v, k)
        if record.exc_info:
            entry["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(entry, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for noisy in ("uvicorn.access",):
        logging.getLogger(noisy).handlers[:] = [handler]
