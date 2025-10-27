FROM python:3.12-slim

# uvをインストール
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# 作業ディレクトリを設定
WORKDIR /app

# 依存関係ファイルをコピー
COPY uv.lock pyproject.toml ./

# 依存関係をインストール
RUN uv sync --frozen --no-install-project --no-dev

# アプリケーションコードをコピー
COPY . .

# プロジェクトをインストール
RUN uv sync --frozen --no-dev

# 本番環境用にバイトコードをコンパイル
ENV UV_COMPILE_BYTECODE=1

# Pythonの出力をバッファリングしない
ENV PYTHONUNBUFFERED=1

# uvが作成した仮想環境のPythonを使用
ENV PATH="/app/.venv/bin:$PATH"

# ポート8080で起動（Cloud Runのデフォルト）
EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
