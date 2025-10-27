from typing import Generator

from google.cloud import speech

def stt(stream: Generator[bytes, None, None]) -> Generator[speech.StreamingRecognizeResponse, None, None]:
    client = speech.SpeechClient()

    config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=16000,
        language_code="ja-JP",
    )

    streaming_config = speech.StreamingRecognitionConfig(
        config=config,
        interim_results=True,  # 中間結果を返す
    )

    def request_generator():
        # 以降のリクエストは音声データのみ
        for chunk in stream:
            yield speech.StreamingRecognizeRequest(audio_content=chunk)

    requests = request_generator()

    # streaming_recognizeはジェネレータを返す
    responses = client.streaming_recognize(config=streaming_config, requests=requests)
    for response in responses:
        yield response
