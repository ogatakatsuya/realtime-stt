from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from queue import Queue, Empty
from gemini.stt import stt
from gemini.llm import generate_response_stream
from gemini.tts import tts_streaming
from settings import set_cors_middleware

app = FastAPI()
set_cors_middleware(app)

# ログ設定
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# リクエストボディの定義
class Message(BaseModel):
    role: str  # "user" or "model"
    parts: list[dict[str, str]]  # [{"text": "..."}]


class GenerateSpeechRequest(BaseModel):
    content: str
    conversation_history: Optional[list[Message]] = None


@app.websocket("/ws/stt")
async def websocket_stt(websocket: WebSocket):
    """
    WebSocketで音声を受け取り、リアルタイムでSTT結果を返す

    クライアント → サーバー: バイナリ音声データ
    サーバー → クライアント: JSON形式の文字起こし結果
    """
    await websocket.accept()

    # 同期的なキューを使用（スレッド間通信用）
    audio_queue: Queue[bytes | None] = Queue()
    result_queue: Queue[dict | None] = Queue()

    def audio_generator():
        """キューから音声を取り出してSTT関数に渡すジェネレータ"""
        while True:
            try:
                chunk = audio_queue.get(timeout=10)
                if chunk is None:
                    break
                yield chunk
            except Empty:
                break

    def stt_worker():
        """別スレッドでSTT処理を実行し、結果をキューに入れる"""
        try:
            stream = audio_generator()
            for response in stt(stream):
                for result in response.results:
                    result_dict = {
                        "is_final": result.is_final,
                        "stability": result.stability,
                        "alternatives": [
                            {
                                "transcript": alt.transcript,
                                "confidence": alt.confidence,
                            }
                            for alt in result.alternatives
                        ],
                    }
                    result_queue.put(result_dict)
        except Exception as e:
            logger.error(f"STT処理でエラーが発生: {e}")
            result_queue.put({"error": str(e)})
        finally:
            result_queue.put(None)

    # STTワーカースレッドを開始
    executor = ThreadPoolExecutor(max_workers=1)
    stt_task = executor.submit(stt_worker)

    try:
        # 同時に音声受信と結果送信を処理
        async def receive_audio():
            try:
                while True:
                    data = await websocket.receive_bytes()
                    audio_queue.put(data)
            except WebSocketDisconnect:
                logger.info("WebSocket接続が切断されました")
                audio_queue.put(None)
            except Exception as e:
                logger.error(f"音声受信でエラー: {e}")
                audio_queue.put(None)

        async def send_results():
            while True:
                try:
                    result = await asyncio.get_event_loop().run_in_executor(
                        None, result_queue.get, True, 0.1
                    )
                    if result is None:
                        break
                    await websocket.send_json(result)
                except Empty:
                    continue
                except Exception as e:
                    logger.error(f"結果送信でエラー: {e}")
                    break

        # 両方のタスクを並行実行
        await asyncio.gather(
            receive_audio(),
            send_results(),
            return_exceptions=True
        )

    except Exception as e:
        logger.error(f"WebSocket処理でエラーが発生: {e}")
    finally:
        # クリーンアップ
        audio_queue.put(None)
        stt_task.result(timeout=5)
        executor.shutdown(wait=False)

        # WebSocketが既に閉じられている可能性があるのでチェック
        if websocket.client_state.name != "DISCONNECTED":
            try:
                await websocket.close()
            except Exception as e:
                logger.error(f"WebSocket終了時にエラーが発生: {e}")


@app.post("/generate-speech")
async def generate_speech(request: GenerateSpeechRequest):
    """
    テキストからGemini APIで返答を生成し、その返答をTTSで音声化してストリーミング返却

    Args:
        request: content フィールドを含むリクエストボディ

    Returns:
        StreamingResponse: 音声データのストリーム（audio/wav）
    """
    try:
        logger.info(f"音声生成リクエスト受信: {request.content[:50]}...")

        # 会話履歴をdictのリストに変換
        history = None
        if request.conversation_history:
            history = [msg.model_dump() for msg in request.conversation_history]

        # Gemini → TTS → クライアントのストリーミングチェーン
        async def streaming_audio_generator():
            # Geminiからテキストストリームを取得してTTSにストリーミング
            text_stream = generate_response_stream(
                user_message=request.content,
                conversation_history=history
            )

            # TTSストリーミング（Geminiのテキストストリームを直接渡す）
            async for audio_chunk in tts_streaming(text_stream):
                yield audio_chunk

        return StreamingResponse(
            streaming_audio_generator(),
            media_type="audio/l16",
            headers={
                "Content-Disposition": "inline",
            }
        )

    except Exception as e:
        logger.error(f"音声生成エンドポイントでエラーが発生: {e}")
        raise
