import { useEffect } from 'react';
import { useWebSocketSTT } from './hooks/useWebSocketSTT';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import './App.css';

function App() {
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws/stt';

  const {
    connect,
    disconnect,
    sendAudio,
    isConnected,
    transcript,
    interimTranscript,
    error: wsError,
  } = useWebSocketSTT(wsUrl);

  const {
    startRecording,
    stopRecording,
    isRecording,
    error: recError,
  } = useAudioRecorder({
    onAudioData: sendAudio,
    sampleRate: 16000,
  });

  useEffect(() => {
    if (isRecording && !isConnected) {
      connect();
    }
  }, [isRecording, isConnected, connect]);

  const handleStartRecording = async () => {
    connect();
    await startRecording();
  };

  const handleStopRecording = () => {
    stopRecording();
    disconnect();
  };

  const error = wsError || recError;

  return (
    <div className="app">
      <h1>リアルタイム音声文字起こし</h1>

      <div className="status">
        <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '接続中' : '未接続'}
        </div>
        <div className={`status-indicator ${isRecording ? 'recording' : 'stopped'}`}>
          {isRecording ? '録音中' : '停止中'}
        </div>
      </div>

      <div className="controls">
        {!isRecording ? (
          <button onClick={handleStartRecording} className="start-button">
            録音開始
          </button>
        ) : (
          <button onClick={handleStopRecording} className="stop-button">
            録音停止
          </button>
        )}
      </div>

      {error && (
        <div className="error">
          エラー: {error}
        </div>
      )}

      <div className="transcript-container">
        <h2>文字起こし結果</h2>
        <div className="transcript">
          <p className="final-transcript">{transcript}</p>
          {interimTranscript && (
            <p className="interim-transcript">{interimTranscript}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
