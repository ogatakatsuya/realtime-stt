import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useConversation } from './hooks/useConversation';
import { useWebSocketStt } from './hooks/useWebSocketSTT';
import type { ConnectionStatus, ConversationMessage, SttResultPayload } from './types/conversation';

const DEFAULT_HTTP_BASE = 'http://localhost:8080';
const DEFAULT_WS_PATH = '/ws/stt';
const DEFAULT_WS_BASE = DEFAULT_HTTP_BASE.replace(/^http/, 'ws');
const DEFAULT_WS_URL = `${DEFAULT_WS_BASE}${DEFAULT_WS_PATH}`;

function normalizeWebSocketUrl(rawUrl: string | undefined): string {
	if (!rawUrl || rawUrl.length === 0) {
		return DEFAULT_WS_URL;
	}

	if (rawUrl.startsWith('ws://') || rawUrl.startsWith('wss://')) {
		return rawUrl;
	}

	if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
		return rawUrl.replace(/^http/, 'ws');
	}

	if (rawUrl.startsWith('/')) {
		return `${DEFAULT_WS_BASE}${rawUrl}`;
	}

	return rawUrl;
}

function normalizeApiBaseUrl(rawUrl: string | undefined): string {
	if (!rawUrl || rawUrl.length === 0) {
		return DEFAULT_HTTP_BASE;
	}

	if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
		return rawUrl;
	}

	if (rawUrl.startsWith('//')) {
		return `http:${rawUrl}`;
	}

	if (rawUrl.startsWith('/')) {
		return `${DEFAULT_HTTP_BASE}${rawUrl}`;
	}

	return rawUrl;
}

function roleLabel(role: ConversationMessage['role']): string {
	return role === 'user' ? 'You' : 'Assistant';
}

function statusClass(status: ConnectionStatus): string {
	switch (status) {
		case 'connected':
			return 'status-indicator connected';
		case 'connecting':
			return 'status-indicator recording';
		case 'error':
			return 'status-indicator disconnected';
		case 'disconnected':
			return 'status-indicator disconnected';
		default:
			return 'status-indicator';
	}
}

function App() {
	const wsUrl = useMemo(
		() => normalizeWebSocketUrl(import.meta.env.VITE_WS_URL as string | undefined),
		[],
	);
	const apiBaseUrl = useMemo(
		() => normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL as string | undefined),
		[],
	);

	const [interimTranscript, setInterimTranscript] = useState('');
	const [runtimeError, setRuntimeError] = useState<string | null>(null);

	const lastFinalTranscriptRef = useRef('');
	const messagesEndRef = useRef<HTMLDivElement | null>(null);

	const { messages, isGenerating, error: conversationError, handleUserMessage, reset } =
		useConversation({
			apiBaseUrl,
			onError: (message) => setRuntimeError(message),
		});

	const handleSttResult = useCallback(
		(payload: SttResultPayload) => {
			if (payload.error) {
				setRuntimeError(payload.error);
				return;
			}

			const transcript = payload.alternatives[0]?.transcript ?? '';
			if (!transcript) {
				if (payload.is_final) {
					setInterimTranscript('');
				}
				return;
			}

			if (payload.is_final) {
				const normalized = transcript.trim();
				if (normalized.length === 0) {
					setInterimTranscript('');
					return;
				}

				if (normalized !== lastFinalTranscriptRef.current) {
					lastFinalTranscriptRef.current = normalized;
					setInterimTranscript('');
					handleUserMessage(normalized).catch((err) => {
						console.error('[App] failed to handle user transcript', err);
						setRuntimeError('Failed to handle final transcript.');
					});
				}
			} else {
				setInterimTranscript(transcript);
			}
		},
		[handleUserMessage],
	);

	const {
		connect,
		disconnect,
		sendAudioChunk,
		status: connectionStatus,
		error: sttError,
	} = useWebSocketStt({
		url: wsUrl,
		onResult: handleSttResult,
		onError: (message) => setRuntimeError(message),
	});

	const {
		start: startRecorder,
		stop: stopRecorder,
		isRecording,
		error: audioError,
	} = useAudioRecorder({
		onData: (chunk) => {
			const success = sendAudioChunk(chunk);
			if (!success) {
				setRuntimeError('Failed to stream audio chunk to backend.');
			}
		},
	});

	useEffect(() => {
		if (sttError) {
			setRuntimeError(sttError);
		}
	}, [sttError]);

	useEffect(() => {
		if (audioError) {
			setRuntimeError(audioError);
		}
	}, [audioError]);

	useEffect(() => {
		if (messagesEndRef.current) {
			messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
		}
	}, [messages, interimTranscript]);

	useEffect(() => () => {
		void stopRecorder();
		disconnect();
	}, [disconnect, stopRecorder]);

	const handleStart = useCallback(async () => {
		setRuntimeError(null);
		try {
			await connect();
			await startRecorder();
		} catch (err) {
			console.error('[App] failed to start session', err);
			setRuntimeError('Failed to start recording session.');
		}
	}, [connect, startRecorder]);

	const handleStop = useCallback(async () => {
		try {
			await stopRecorder();
		} catch (err) {
			console.error('[App] failed to stop recorder', err);
		}
		disconnect();
		setInterimTranscript('');
	}, [disconnect, stopRecorder]);

	const handleReset = useCallback(() => {
		reset();
		setInterimTranscript('');
		setRuntimeError(null);
		lastFinalTranscriptRef.current = '';
	}, [reset]);

	const aggregatedError = runtimeError ?? conversationError ?? null;

	const recordingIndicatorClass = isRecording ? 'status-indicator recording' : 'status-indicator stopped';
	const generationIndicatorClass = isGenerating ? 'status-indicator generating' : 'status-indicator';

	return (
		<div className="app">
			<h1>Realtime Speech Chat</h1>

			<div className="status">
				<span className={statusClass(connectionStatus)}>STT {connectionStatus}</span>
				<span className={recordingIndicatorClass}>{isRecording ? 'Recording' : 'Stopped'}</span>
				<span className={generationIndicatorClass}>{isGenerating ? 'Generating' : 'Idle'}</span>
			</div>

			<div className="controls">
				<button
					type="button"
					className="start-button"
					onClick={() => void handleStart()}
					disabled={isRecording || connectionStatus === 'connecting'}
				>
					Start Session
				</button>
				<button
					type="button"
					className="stop-button"
					onClick={() => void handleStop()}
					disabled={!isRecording && connectionStatus !== 'connected'}
				>
					Stop Session
				</button>
				<button type="button" onClick={handleReset} disabled={messages.length === 0 && !interimTranscript}>
					Reset Chat
				</button>
			</div>

			{aggregatedError ? <div className="error">{aggregatedError}</div> : null}

			<div className="chat-container">
				<div className="chat-messages">
					{messages.map((message) => (
						<div
							key={message.id}
							className={`message ${message.role === 'user' ? 'message-user' : 'message-assistant'}`}
						>
							<div className="message-header">
								<span className="message-role">{roleLabel(message.role)}</span>
								<span className="message-time">{new Date(message.createdAt).toLocaleTimeString()}</span>
							</div>
							<div className="message-content">
								{message.parts.map((part) => part.text).join('\n') || '(empty)'}
							</div>
							{message.isStreaming ? <div className="message-status">Streaming...</div> : null}
							{message.error ? <div className="message-status">{message.error}</div> : null}
						</div>
					))}
				</div>

				<div ref={messagesEndRef} />
				{interimTranscript ? (
					<div className="current-transcription">
						<div className="transcription-label">Listening...</div>
						<div className="interim-text">{interimTranscript}</div>
					</div>
				) : null}
			</div>
		</div>
	);
}

export default App;
