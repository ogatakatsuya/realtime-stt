import { useCallback, useEffect, useRef, useState } from 'react';

export interface STTResult {
  is_final: boolean;
  stability: number;
  alternatives: Array<{
    transcript: string;
    confidence: number;
  }>;
}

export interface UseWebSocketSTTReturn {
  connect: () => void;
  disconnect: () => void;
  sendAudio: (audioData: ArrayBuffer) => void;
  isConnected: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
}

export const useWebSocketSTT = (url: string): UseWebSocketSTTReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const result: STTResult = JSON.parse(event.data);

          if ('error' in result) {
            setError((result as any).error);
            return;
          }

          const text = result.alternatives[0]?.transcript || '';

          if (result.is_final) {
            setTranscript((prev) => prev + text);
            setInterimTranscript('');
          } else {
            setInterimTranscript(text);
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
          setError('Failed to parse message');
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('WebSocket connection error');
      };

      ws.onclose = () => {
        setIsConnected(false);
      };
    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
      setError('Failed to connect');
    }
  }, [url]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setIsConnected(false);
    }
  }, []);

  const sendAudio = useCallback((audioData: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(audioData);
    }
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connect,
    disconnect,
    sendAudio,
    isConnected,
    transcript,
    interimTranscript,
    error,
  };
};
