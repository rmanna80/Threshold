"""Authentication: Argon2id password hashing, short-lived JWT access tokens and rotating,
hashed refresh tokens with reuse detection."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import RefreshToken, User

_hasher = PasswordHasher()  # Argon2id with library defaults (RFC 9106 recommendations)
_bearer = HTTPBearer(auto_error=False)
# A fixed dummy hash so login timing does not reveal whether an account exists.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user: User) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    claims = {
        "sub": str(user.id),
        "tv": user.token_version,
        "iss": s.jwt_issuer,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=s.access_token_ttl_seconds)).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(claims, s.jwt_secret, algorithm="HS256")


def issue_refresh_token(db: Session, user: User, device_id: str | None) -> str:
    s = get_settings()
    token = secrets.token_urlsafe(48)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=_hash_token(token),
            device_id=device_id,
            expires_at=datetime.now(UTC) + timedelta(seconds=s.refresh_token_ttl_seconds),
        )
    )
    return token


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def rotate_refresh_token(db: Session, token: str, device_id: str | None) -> tuple[User, str]:
    """Exchange a refresh token for a new one. Presenting a revoked token revokes every session."""
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(token)))
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if row is None:
        raise unauthorized
    user = db.get(User, row.user_id)
    if user is None:
        raise unauthorized
    now = datetime.now(UTC)
    if row.revoked_at is not None:
        # Reuse of a rotated token indicates theft: revoke all tokens for this user.
        user.token_version += 1
        db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).values(revoked_at=now))
        db.commit()
        raise unauthorized
    if _aware(row.expires_at) <= now:
        raise unauthorized
    row.revoked_at = now
    new_token = issue_refresh_token(db, user, device_id or row.device_id)
    return user, new_token


def revoke_all(db: Session, user: User) -> None:
    user.token_version += 1
    db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))


def current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    if creds is None or creds.scheme.lower() != "bearer":
        raise unauthorized
    s = get_settings()
    try:
        claims = jwt.decode(creds.credentials, s.jwt_secret, algorithms=["HS256"], issuer=s.jwt_issuer, options={"require": ["exp", "sub", "iss"]})
        user_id = uuid.UUID(str(claims["sub"]))
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise unauthorized from exc
    user = db.get(User, user_id)
    if user is None or claims.get("tv") != user.token_version:
        raise unauthorized
    return user


CurrentUser = Annotated[User, Depends(current_user)]
DbSession = Annotated[Session, Depends(get_db)]
