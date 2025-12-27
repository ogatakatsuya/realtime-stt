export type Role = 'user' | 'model';

export interface MessagePart {
  text: string;
}

export interface ConversationMessage {
  id: string;
  role: Role;
  parts: MessagePart[];
  createdAt: number;
  isStreaming?: boolean;
  error?: string;
}

export interface ConversationHistoryItem {
  role: Role;
  parts: MessagePart[];
}

export interface GenerateSpeechRequestPayload {
  conversation_history: ConversationHistoryItem[];
}

export interface SttAlternative {
  transcript: string;
  confidence?: number;
}

export interface SttResultPayload {
  is_final: boolean;
  stability: number;
  alternatives: SttAlternative[];
  error?: string;
}

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';
