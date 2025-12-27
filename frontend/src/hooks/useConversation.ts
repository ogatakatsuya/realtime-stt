import { useCallback, useMemo, useRef, useState } from 'react';
import type {
	ConversationHistoryItem,
	ConversationMessage,
	MessagePart,
	Role,
} from '../types/conversation';

interface UseConversationOptions {
  apiBaseUrl?: string;
  onError?: (message: string) => void;
}

interface UseConversationResult {
  messages: ConversationMessage[];
  isGenerating: boolean;
  error: string | null;
  handleUserMessage: (text: string) => Promise<void>;
  reset: () => void;
}

const GENERATE_ENDPOINT = '/generate-speech';

function ensureMessagePart(text: string): MessagePart {
  return { text };
}

function toHistoryItem(message: ConversationMessage): ConversationHistoryItem | null {
  const normalizedParts = message.parts
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .map(ensureMessagePart);

  if (normalizedParts.length === 0) {
    return null;
  }

  return {
    role: message.role,
    parts: normalizedParts,
  };
}

function createMessage(role: Role, text: string, extra?: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    role,
    parts: [ensureMessagePart(text)],
    createdAt: Date.now(),
    ...extra,
  };
}

export function useConversation({
  apiBaseUrl,
  onError,
}: UseConversationOptions = {}): UseConversationResult {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const messagesRef = useRef<ConversationMessage[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationChainRef = useRef<Promise<void>>(Promise.resolve());

  const baseUrl = useMemo(() => {
    if (apiBaseUrl) {
      return apiBaseUrl;
    }
    if (typeof window !== 'undefined' && window.location) {
      return window.location.origin;
    }
    return '';
  }, [apiBaseUrl]);

  const getEndpointUrl = useCallback(() => {
    try {
      if (!baseUrl) {
        return GENERATE_ENDPOINT;
      }
      return new URL(GENERATE_ENDPOINT, baseUrl).toString();
    } catch (err) {
      console.error('[Conversation] invalid API base URL', err);
      return GENERATE_ENDPOINT;
    }
  }, [baseUrl]);

  const updateMessages = useCallback((next: ConversationMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const updateMessageById = useCallback(
    (id: string, updater: (message: ConversationMessage) => ConversationMessage) => {
      updateMessages(
        messagesRef.current.map((message) => (message.id === id ? updater(message) : message)),
      );
    },
    [updateMessages],
  );

  const processUserMessage = useCallback(
    async (text: string) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }

      const userMessage = createMessage('user', normalized);
      const historyBeforeAssistant = [...messagesRef.current, userMessage];
      updateMessages(historyBeforeAssistant);

      const historyPayload = historyBeforeAssistant
        .map(toHistoryItem)
        .filter((item): item is ConversationHistoryItem => item !== null);

      const assistantMessage = createMessage('model', '', { isStreaming: true });
      updateMessages([...historyBeforeAssistant, assistantMessage]);

      const endpointUrl = getEndpointUrl();
      const abortController = new AbortController();
      abortControllerRef.current?.abort();
      abortControllerRef.current = abortController;

      setIsGenerating(true);
      setError(null);

      try {
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            conversation_history: historyPayload,
          }),
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Failed to generate response (${response.status}).`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          accumulated += decoder.decode(value, { stream: true });
          updateMessageById(assistantMessage.id, (message) => ({
            ...message,
            parts: [ensureMessagePart(accumulated)],
            isStreaming: true,
          }));
        }

        accumulated += decoder.decode();

        updateMessageById(assistantMessage.id, (message) => ({
          ...message,
          parts: [ensureMessagePart(accumulated)],
          isStreaming: false,
        }));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          updateMessages(messagesRef.current.filter((message) => message.id !== assistantMessage.id));
          return;
        }

        const message = err instanceof Error ? err.message : 'Failed to generate assistant response.';
        console.error('[Conversation] generation error', err);
        setError(message);
        onError?.(message);

        updateMessageById(assistantMessage.id, (existing) => ({
          ...existing,
          parts: [ensureMessagePart(message)],
          isStreaming: false,
          error: message,
        }));
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        setIsGenerating(false);
      }
    },
    [getEndpointUrl, onError, updateMessageById, updateMessages],
  );

  const handleUserMessage = useCallback(
    (text: string) => {
      generationChainRef.current = generationChainRef.current.then(() => processUserMessage(text));
      return generationChainRef.current;
    },
    [processUserMessage],
  );

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    const initial: ConversationMessage[] = [];
    updateMessages(initial);
    setError(null);
    setIsGenerating(false);
    generationChainRef.current = Promise.resolve();
  }, [updateMessages]);

  return {
    messages,
    isGenerating,
    error,
    handleUserMessage,
    reset,
  };
}
