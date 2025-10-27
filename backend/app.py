from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import asyncio
from concurrent.futures import ThreadPoolExecutor
from queue import Queue, Empty
from stt import stt

app = FastAPI()


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
                except Exception:
                    break

        # 両方のタスクを並行実行
        await asyncio.gather(
            receive_audio(),
            send_results(),
            return_exceptions=True
        )

    except Exception:
        pass
    finally:
        # クリーンアップ
        audio_queue.put(None)
        stt_task.result(timeout=5)
        executor.shutdown(wait=False)

        # WebSocketが既に閉じられている可能性があるのでチェック
        if websocket.client_state.name != "DISCONNECTED":
            try:
                await websocket.close()
            except:
                pass
