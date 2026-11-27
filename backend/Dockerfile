# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv

FROM base AS deps
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

FROM base AS runtime
RUN useradd --system --uid 10001 --home /srv threshold
COPY --from=deps /usr/local /usr/local
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
USER threshold
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
# Migrations run as a separate release step (see DEPLOYMENT.md), never implicitly at boot.
# Proxy headers are trusted only from FORWARDED_ALLOW_IPS (uvicorn default 127.0.0.1); set it to the
# load balancer address in deployment, never "*", or clients could spoof their IP to evade rate limits.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
