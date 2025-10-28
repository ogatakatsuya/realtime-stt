import { useCallback, useRef, useState } from 'react';

export interface UseAudioPlayerReturn {
  playAudioStream: (audioChunks: Uint8Array[], sampleRate: number, onEnded?: () => void) => void;
  isPlaying: boolean;
  error: string | null;
}

export const useAudioPlayer = (): UseAudioPlayerReturn => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playAudioStream = useCallback(async (
    audioChunks: Uint8Array[],
    sampleRate: number,
    onEnded?: () => void
  ) => {
    try {
      setError(null);
      setIsPlaying(true);

      // AudioContextを作成
      const audioContext = new AudioContext({ sampleRate });
      audioContextRef.current = audioContext;

      // すべてのチャンクを結合
      const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combinedData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of audioChunks) {
        combinedData.set(chunk, offset);
        offset += chunk.length;
      }

      // Uint8Array (バイト列) を Int16Array (LINEAR16) に変換
      const int16Data = new Int16Array(combinedData.buffer);

      // Int16をFloat32に変換してAudioBufferを作成
      const audioBuffer = audioContext.createBuffer(1, int16Data.length, sampleRate);
      const channelData = audioBuffer.getChannelData(0);

      for (let i = 0; i < int16Data.length; i++) {
        // -32768 ~ 32767 を -1.0 ~ 1.0 に変換
        channelData[i] = int16Data[i] / (int16Data[i] < 0 ? 0x8000 : 0x7fff);
      }

      // AudioBufferSourceNodeで再生
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);

      source.onended = () => {
        setIsPlaying(false);
        audioContext.close();
        // 再生終了時のコールバックを実行
        if (onEnded) {
          onEnded();
        }
      };

      source.start(0);
    } catch (err) {
      console.error('Failed to play audio:', err);
      setError(err instanceof Error ? err.message : 'Failed to play audio');
      setIsPlaying(false);
    }
  }, []);

  return {
    playAudioStream,
    isPlaying,
    error,
  };
};
