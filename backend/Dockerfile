# ============================================================
# Stage 1: Python dependencies
# ============================================================

FROM python:3.12-slim-bookworm AS python-deps

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential gcc g++ \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv "${VIRTUAL_ENV}"

COPY requirements.txt .

RUN python -m pip install --upgrade \
        pip setuptools wheel \
    && python -m pip install --prefer-binary \
        -r requirements.txt \
    && python -c "import packaging; print('Packaging:', packaging.__version__)"


# ============================================================
# Stage 2: Runtime
# ============================================================

FROM python:3.12-slim-bookworm AS runtime

ENV VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:${PATH}" \
    PYTHONPATH=/app/backend \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/app \
    CHROME_BIN=/usr/bin/google-chrome \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app


# ============================================================
# System packages + Google Chrome
# ============================================================

RUN set -eux; \
    test "$(dpkg --print-architecture)" = "amd64"; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg libgomp1; \
    install -d -m 0755 /usr/share/keyrings; \
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
        | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg; \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends google-chrome-stable; \
    rm -rf /var/lib/apt/lists/*


# ============================================================
# Copy Python virtual environment
# ============================================================

COPY --from=python-deps /opt/venv /opt/venv


# ============================================================
# Playwright Chromium
# ============================================================

RUN mkdir -p /ms-playwright \
    && python -m playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*


# ============================================================
# SeleniumBase ChromeDriver (Heavy installation - ab code se pehle hai!)
# ============================================================

RUN seleniumbase get chromedriver --path


# ============================================================
# Celery / Kombu Redis compatibility
# ============================================================

RUN python -m pip install --no-deps --force-reinstall \
        "celery==5.5.3" \
        "kombu==5.5.4" \
    && python -c "import celery, kombu, redis; print('Celery:', celery.__version__, '| Kombu:', kombu.__version__, '| Redis:', redis.__version__)"


# ============================================================
# Application source (YAHAN COPY KAREIN - SAB SE AAKHIR ME)
# ============================================================

COPY . /app/backend/


# ============================================================
# Non-root user + SeleniumBase writable directories
# ============================================================

RUN set -eux; \
    groupadd --system --gid 10001 app; \
    useradd --system --uid 10001 --gid app \
        --home-dir /home/app --no-create-home app; \
    SB_DRIVERS_DIR="$(python -c 'import pathlib, seleniumbase; print(pathlib.Path(seleniumbase.__file__).resolve().parent / "drivers")')"; \
    mkdir -p \
        /home/app \
        /app/data \
        /app/embeddings_Store \
        /app/backend/uploaded_docs \
        /app/downloaded_files \
        /app/backend/downloaded_files \
        "$SB_DRIVERS_DIR"; \
    chown -R app:app \
        /home/app \
        /app/downloaded_files \
        /app/backend/downloaded_files \
        "$SB_DRIVERS_DIR"; \
    chown app:app \
        /app/data \
        /app/embeddings_Store \
        /app/backend/uploaded_docs; \
    chmod -R u+rwX "$SB_DRIVERS_DIR"; \
    chmod 775 \
        /app/downloaded_files \
        /app/backend/downloaded_files


# ============================================================
# Security: Non-root execution
# ============================================================

USER app

EXPOSE 8800

ENTRYPOINT []

CMD ["uvicorn", "main:fastapi_app", "--host", "0.0.0.0", "--port", "8800"]
