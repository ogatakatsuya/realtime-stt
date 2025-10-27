import re

from fastapi import FastAPI
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware


def set_operation_id(app: FastAPI):
    for route in app.routes:
        if isinstance(route, APIRoute):
            route.operation_id = route.name


def custom_cors_origin_validator(origin: str) -> bool:
    # ワイルドカードパターンに基づいた正規表現
    preview_pattern = r"https://.*\.d2nx4l1gz5toyj\.amplifyapp\.com"
    imaker_pattern = r"https://.*\.i-maker\.org"
    return bool(re.match(preview_pattern, origin)) or bool(
        re.match(imaker_pattern, origin)
    )


class CustomCORSMiddleware(StarletteCORSMiddleware):
    def is_allowed_origin(self, origin: str) -> bool:
        # カスタムバリデータでチェック
        if custom_cors_origin_validator(origin):
            return True
        # 他の許可されたオリジンも考慮
        return super().is_allowed_origin(origin)


def set_cors_middleware(app: FastAPI):
    app.add_middleware(
        CustomCORSMiddleware,
        allow_credentials=True,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
