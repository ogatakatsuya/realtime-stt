import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionStatus, SttResultPayload } from '../types/conversation';

interface UseWebSocketSttOptions {
  url: string;
  onResult?: (payload: SttResultPayload) => void;
  onError?: (message: string) => void;
}

interface UseWebSocketSttResult {
  connect: () => Promise<void>;
  disconnect: () => void;
  sendAudioChunk: (chunk: ArrayBuffer) => boolean;
  status: ConnectionStatus;
  error: string | null;
}

export function useWebSocketStt({
  url,
  onResult,
  onError,
}: UseWebSocketSttOptions): UseWebSocketSttResult {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const pendingConnectResolveRef = useRef<(() => void) | null>(null);
  const pendingConnectRejectRef = useRef<((reason?: unknown) => void) | null>(null);

  const cleanupPendingPromise = useCallback(() => {
    pendingConnectResolveRef.current = null;
    pendingConnectRejectRef.current = null;
  }, []);

  const handleError = useCallback(
    (message: string, evt?: Event | CloseEvent | ErrorEvent) => {
      setStatus('error');
      setError(message);
      onError?.(message);
      pendingConnectRejectRef.current?.(message);
      cleanupPendingPromise();
      if (evt) {
        console.error('[STT WebSocket] event', evt);
      }
    },
    [cleanupPendingPromise, onError],
  );

  const connect = useCallback((): Promise<void> => {
    if (!url) {
      const message = 'STT WebSocket URL is not configured.';
      setStatus('error');
      setError(message);
      return Promise.reject(new Error(message));
    }

    if (wsRef.current) {
      const readyState = wsRef.current.readyState;
      if (readyState === WebSocket.OPEN) {
        return Promise.resolve();
      }
      if (readyState === WebSocket.CONNECTING) {
        return new Promise((resolve, reject) => {
          pendingConnectResolveRef.current = resolve;
          pendingConnectRejectRef.current = reject;
        });
      }
    }

    return new Promise((resolve, reject) => {
      try {
        setStatus('connecting');
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        wsRef.current = socket;
        pendingConnectResolveRef.current = resolve;
        pendingConnectRejectRef.current = reject;

        socket.onopen = () => {
          setStatus('connected');
          setError(null);
          pendingConnectResolveRef.current?.();
          cleanupPendingPromise();
        };

        socket.onmessage = (event: MessageEvent<string>) => {
          try {
            const payload: SttResultPayload = JSON.parse(event.data);
            onResult?.(payload);
          } catch (err) {
            handleError('Failed to parse STT payload.', event);
            console.error('[STT WebSocket] parse error', err);
          }
        };

        socket.onerror = (evt: Event) => {
          handleError('WebSocket error occurred.', evt);
        };

        socket.onclose = (evt: CloseEvent) => {
          if (evt.code !== 1000) {
            handleError(`WebSocket closed unexpectedly (${evt.code}).`, evt);
          } else {
            setStatus('disconnected');
            cleanupPendingPromise();
          }
          wsRef.current = null;
        };
      } catch (err) {
        console.error('[STT WebSocket] connection error', err);
        handleError('Failed to establish WebSocket connection.');
        reject(err);
      }
    });
  }, [cleanupPendingPromise, handleError, onResult, url]);

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) {
      return;
    }
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close(1000, 'Client closing connection');
    } catch (err) {
      console.error('[STT WebSocket] error while closing', err);
    }
    wsRef.current = null;
    setStatus('disconnected');
    cleanupPendingPromise();
  }, [cleanupPendingPromise]);

  const sendAudioChunk = useCallback((chunk: ArrayBuffer): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      ws.send(chunk);
      return true;
    } catch (err) {
      console.error('[STT WebSocket] failed to send chunk', err);
      handleError('Failed to send audio chunk.');
      return false;
    }
  }, [handleError]);

  useEffect(() => () => {
    disconnect();
  }, [disconnect]);

  return {
    connect,
    disconnect,
    sendAudioChunk,
    status,
    error,
  };
}
