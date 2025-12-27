# ビルドステージ
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    WORKDIR=/app

WORKDIR $WORKDIR

COPY pyproject.toml uv.lock ./

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project

COPY . $WORKDIR

# 実行ステージ
FROM python:3.12-slim

ENV WORKDIR=/app
WORKDIR $WORKDIR

COPY --from=builder $WORKDIR $WORKDIR

ENV PATH="$WORKDIR/.venv/bin:$PATH"

# 非rootユーザーを作成して権限を設定
RUN adduser --disabled-password --gecos '' --home /home/appuser appuser && \
    chown -R appuser $WORKDIR

USER appuser

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
