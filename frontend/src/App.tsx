import { useEffect, useState, useRef } from 'react';
import { useWebSocketSTT } from './hooks/useWebSocketSTT';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useGenerateSpeech } from './hooks/useGenerateSpeech';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import type { ChatMessage, Message } from './types/conversation';
import './App.css';

function App() {
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws/stt';
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080/generate-speech';

  // チャットメッセージ履歴
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);

  // 音声再生フック
  const { playAudioStream, isPlaying, error: playerError } = useAudioPlayer();

  // 音声生成フック
  const { generateSpeech, isGenerating, error: generateError } = useGenerateSpeech(apiUrl);

  // 録音制御のref（後で定義される関数を参照するため）
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const startRecordingRef = useRef<(() => Promise<void>) | null>(null);

  // チャットメッセージの最下部へのref（自動スクロール用）
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // WebSocketSTTフック（clearTranscriptを先に取得）
  const {
    connect,
    disconnect,
    sendAudio,
    clearTranscript,
    isConnected,
    transcript,
    interimTranscript,
    error: wsError,
  } = useWebSocketSTT({
    url: wsUrl,
    onFinal: (finalText: string) => {
      // is_finalフラグが立った時の処理
      console.log('Final transcript received:', finalText);

      // WebSocketを切断（録音も停止）
      disconnect();
      if (stopRecordingRef.current) {
        stopRecordingRef.current();
      }

      // ユーザーメッセージをチャットに追加
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: finalText,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // 非同期処理を実行
      (async () => {
        try {
          // 音声生成APIを呼び出し（会話履歴のみを渡す。現在のメッセージはcontentとして渡される）
          const { audioChunks } = await generateSpeech(finalText, conversationHistory);

          // AIの返答メッセージをチャットに追加（音声再生中の表示用）
          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: '音声で応答中...',
            timestamp: new Date(),
            isPlaying: true,
          };
          setMessages((prev) => [...prev, assistantMessage]);

          // 会話履歴にユーザーメッセージのみ追加（AI返答テキストは取得できないため）
          const userHistoryMessage: Message = {
            role: 'user',
            parts: [{ text: finalText }],
          };
          setConversationHistory((prev) => [...prev, userHistoryMessage]);

          // transcriptをクリア（次の会話に備える）
          clearTranscript();

          // 音声を再生（再生終了後に録音を再開）
          playAudioStream(audioChunks, 24000, async () => {
            // 音声再生終了後、録音とWebSocket接続を再開
            console.log('Audio playback ended, restarting recording...');
            connect();
            if (startRecordingRef.current) {
              await startRecordingRef.current();
            }
          });
        } catch (err) {
          console.error('Failed to generate or play speech:', err);
        }
      })();
    },
  });

  const {
    startRecording,
    stopRecording,
    isRecording,
    error: recError,
  } = useAudioRecorder({
    onAudioData: sendAudio,
    sampleRate: 16000,
  });

  // refに録音関数を設定
  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  useEffect(() => {
    if (isRecording && !isConnected) {
      connect();
    }
  }, [isRecording, isConnected, connect]);

  // メッセージが更新されたら自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, transcript, interimTranscript]);

  const handleStartRecording = async () => {
    connect();
    await startRecording();
  };

  const handleStopRecording = () => {
    stopRecording();
    disconnect();
  };

  const error = wsError || recError || playerError || generateError;

  return (
    <div className="app">
      <h1>リアルタイムチャットぼっと</h1>

      <div className="status">
        <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '接続中' : '未接続'}
        </div>
        <div className={`status-indicator ${isRecording ? 'recording' : 'stopped'}`}>
          {isRecording ? '録音中' : '停止中'}
        </div>
        {isGenerating && (
          <div className="status-indicator generating">
            返答生成中...
          </div>
        )}
        {isPlaying && (
          <div className="status-indicator playing">
            再生中...
          </div>
        )}
      </div>

      <div className="controls">
        {!isRecording ? (
          <button onClick={handleStartRecording} className="start-button">
            会話を開始する
          </button>
        ) : (
          <button onClick={handleStopRecording} className="stop-button">
            会話を終了する
          </button>
        )}
      </div>

      {error && (
        <div className="error">
          エラー: {error}
        </div>
      )}

      <div className="chat-container">
        <div className="chat-messages">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`message ${message.role === 'user' ? 'message-user' : 'message-assistant'}`}
            >
              <div className="message-header">
                <span className="message-role">
                  {message.role === 'user' ? 'あなた' : 'AI'}
                </span>
                <span className="message-time">
                  {message.timestamp.toLocaleTimeString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div className="message-content">{message.content}</div>
              {message.isPlaying && (
                <div className="message-status">再生中...</div>
              )}
            </div>
          ))}

          {/* 現在の文字起こし結果 */}
          {(transcript || interimTranscript) && (
            <div className="current-transcription">
              <div className="transcription-label">現在の文字起こし:</div>
              {transcript && <div className="final-text">{transcript}</div>}
              {interimTranscript && (
                <div className="interim-text">{interimTranscript}</div>
              )}
            </div>
          )}

          {/* 自動スクロール用の要素 */}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}

export default App;
