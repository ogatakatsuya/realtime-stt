import { useCallback, useState } from 'react';
import type { Message } from '../types/conversation';

export interface GenerateSpeechResult {
  audioChunks: Uint8Array[];
  responseText: string;
}

export interface UseGenerateSpeechReturn {
  generateSpeech: (content: string, conversationHistory?: Message[]) => Promise<GenerateSpeechResult>;
  isGenerating: boolean;
  error: string | null;
}

export const useGenerateSpeech = (apiUrl: string): UseGenerateSpeechReturn => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSpeech = useCallback(async (
    content: string,
    conversationHistory?: Message[]
  ): Promise<GenerateSpeechResult> => {
    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content,
          conversation_history: conversationHistory || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // ストリーミングレスポンスの場合、テキストは取得できない
      const responseText = '';

      // ストリーミングレスポンスをチャンクで読み込む
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const audioChunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          audioChunks.push(value);
        }
      }

      setIsGenerating(false);

      return {
        audioChunks,
        responseText,
      };
    } catch (err) {
      console.error('Failed to generate speech:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate speech';
      setError(errorMessage);
      setIsGenerating(false);
      throw err;
    }
  }, [apiUrl]);

  return {
    generateSpeech,
    isGenerating,
    error,
  };
};
