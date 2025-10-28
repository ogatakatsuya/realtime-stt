from google.cloud import texttospeech
from typing import Generator, AsyncGenerator
import asyncio
import logging

logger = logging.getLogger(__name__)


def _tts_streaming_sync(text_stream: Generator[str, None, None]) -> Generator[bytes, None, None]:
    """
    テキストストリームを音声に変換してストリーミングで返す（同期版）

    Args:
        text_stream: テキストチャンクのジェネレータ

    Yields:
        bytes: 音声データのチャンク
    """
    client = texttospeech.TextToSpeechClient()

    # ストリーミング設定（Chirp 3 HD音声のみサポート）
    streaming_config = texttospeech.StreamingSynthesizeConfig(
        voice=texttospeech.VoiceSelectionParams(
            language_code="ja-JP",
            name="ja-JP-Chirp3-HD-Kore",  # 日本語Chirp 3 HD音声（女性）
        )
    )

    # リクエストジェネレータ
    def request_generator():
        # 最初のリクエストは設定のみ
        yield texttospeech.StreamingSynthesizeRequest(
            streaming_config=streaming_config
        )

        # 以降のリクエストはテキストチャンク
        for text_chunk in text_stream:
            if text_chunk:
                yield texttospeech.StreamingSynthesizeRequest(
                    input=texttospeech.StreamingSynthesisInput(text=text_chunk)
                )

    try:
        logger.info("ストリーミングTTS開始")

        # ストリーミング合成
        streaming_responses = client.streaming_synthesize(request_generator())

        for response in streaming_responses:
            if response.audio_content:
                logger.debug(f"音声チャンク受信: {len(response.audio_content)}バイト")
                yield response.audio_content

        logger.info("ストリーミングTTS完了")

    except Exception as e:
        logger.error(f"ストリーミングTTS処理でエラーが発生: {e}")
        raise


async def tts_streaming(text_stream: AsyncGenerator[str, None]) -> AsyncGenerator[bytes, None]:
    """
    テキストストリームを音声に変換してストリーミングで返す（非同期版）

    Args:
        text_stream: 非同期テキストチャンクジェネレータ

    Yields:
        bytes: 音声データのチャンク
    """
    # 非同期ジェネレータを同期ジェネレータに変換するためのキュー
    import queue
    import threading

    text_queue: queue.Queue = queue.Queue()
    done = threading.Event()

    # 非同期ストリームを同期キューに入れるタスク
    async def enqueue_text():
        try:
            async for text_chunk in text_stream:
                text_queue.put(text_chunk)
        finally:
            done.set()

    # タスクをバックグラウンドで開始
    task = asyncio.create_task(enqueue_text())

    # 同期ジェネレータを作成
    def sync_text_generator():
        while not done.is_set() or not text_queue.empty():
            try:
                yield text_queue.get(timeout=0.1)
            except queue.Empty:
                continue

    # TTS処理を別スレッドで実行
    audio_gen = _tts_streaming_sync(sync_text_generator())

    try:
        while True:
            chunk = await asyncio.to_thread(lambda: next(audio_gen, None))
            if chunk is None:
                break
            yield chunk
    finally:
        await task
