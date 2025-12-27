from google import genai
from typing import AsyncGenerator
import logging

from env import env

logger = logging.getLogger(__name__)

# システムプロンプト
SYSTEM_PROMPT = """あなたは親切で知的なAIアシスタントです。

重要な制約：
1. Markdown記法（**太字**、# 見出し、リストなど）を使わないでください
2. 自然な話し言葉で返答してください

必ず日本語での返答を心がけてください。"""


async def generate_response_stream(
    conversation_history: list[dict[str, str]]
) -> AsyncGenerator[str, None]:
    """
    Gemini APIを使ってテキストから返答をストリーミング生成する

    Args:
        user_message: ユーザーの入力テキスト
        conversation_history: 会話履歴 [{"role": "user"/"model", "parts": ["text"]}]

    Yields:
        str: 生成されたテキストチャンク
    """
    try:
        client = genai.Client(api_key=env.GEMINI_API_KEY)

        # 会話履歴を構築
        contents = []

        # システムプロンプトを追加
        contents.append({
            "role": "user",
            "parts": [{"text": SYSTEM_PROMPT}]
        })
        contents.append({
            "role": "model",
            "parts": [{"text": "承知しました。音声で読み上げやすい、自然な日本語で返答いたします。"}]
        })

        # 過去の会話履歴を追加
        contents.extend(conversation_history)

        response = await client.aio.models.generate_content_stream(
            model='gemini-2.5-flash-lite',
            contents=contents
        )

        async for chunk in response:
            if chunk.text:
                yield chunk.text

    except Exception as e:
        logger.error(f"Gemini API呼び出しでエラーが発生: {e}")
        raise

