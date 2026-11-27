from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.routes import router
from app.config import get_settings
from app.logging_config import configure_logging
from app.security.middleware import Limiter, MemoryLimiter, RedisLimiter, SecurityMiddleware


def create_app(limiter: Limiter | None = None) -> FastAPI:
    settings = get_settings()
    configure_logging("DEBUG" if settings.env == "development" else "INFO")
    app = FastAPI(
        title="Threshold API",
        version=__version__,
        description="Optional sync, account and research API for Threshold. The mobile app works fully offline without it.",
        docs_url="/docs" if settings.env != "production" else None,
        redoc_url=None,
    )
    if limiter is None:
        limiter = RedisLimiter(settings.redis_url) if settings.redis_url else MemoryLimiter()
    app.add_middleware(
        SecurityMiddleware,
        limiter=limiter,
        per_minute=settings.rate_limit_per_minute,
        auth_per_minute=settings.auth_rate_limit_per_minute,
    )
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Authorization", "Content-Type"],
        )
    app.include_router(router)
    logging.getLogger("threshold").info("api started", extra={"env": settings.env, "version": __version__})
    return app


app = create_app()
