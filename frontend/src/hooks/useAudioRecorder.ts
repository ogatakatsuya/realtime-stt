import { useCallback, useRef, useState } from 'react';

interface UseAudioRecorderOptions {
  onData: (chunk: ArrayBuffer) => void;
  targetSampleRate?: number;
}

interface DownsampleResult {
  downsampled: Float32Array;
  leftover: Float32Array;
}

const DEFAULT_TARGET_SAMPLE_RATE = 16_000;
const WORKLET_PATH = '/audio-processor.js';
const WORKLET_NAME = 'pcm-processor';

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function convertFloat32ToInt16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const s = clampSample(samples[i]);
    const intVal = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, intVal, true);
  }
  return buffer;
}

function downsample(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number,
  carry: Float32Array,
): DownsampleResult {
  if (targetSampleRate === inputSampleRate) {
    return {
      downsampled: input,
      leftover: new Float32Array(),
    };
  }

  if (targetSampleRate > inputSampleRate) {
    throw new Error('Target sample rate must be less than or equal to input sample rate.');
  }

  const buffer = new Float32Array(carry.length + input.length);
  buffer.set(carry, 0);
  buffer.set(input, carry.length);

  const sampleRateRatio = inputSampleRate / targetSampleRate;
  const newLength = Math.floor(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);

  let offset = 0;
  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * sampleRateRatio);
    const end = Math.floor((i + 1) * sampleRateRatio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < buffer.length; j += 1) {
      sum += buffer[j];
      count += 1;
    }
    result[i] = count > 0 ? sum / count : 0;
    offset = end;
  }

  const leftoverLength = buffer.length - offset;
  const leftover = leftoverLength > 0 ? buffer.slice(offset) : new Float32Array();

  return { downsampled: result, leftover };
}

interface UseAudioRecorderResult {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isRecording: boolean;
  error: string | null;
}

export function useAudioRecorder({
  onData,
  targetSampleRate = DEFAULT_TARGET_SAMPLE_RATE,
}: UseAudioRecorderOptions): UseAudioRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const carryBufferRef = useRef<Float32Array>(new Float32Array());

  const resetState = useCallback(() => {
    carryBufferRef.current = new Float32Array();
    setIsRecording(false);
  }, []);

  const stop = useCallback(async () => {
    workletNodeRef.current?.port.close();
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    silentGainRef.current?.disconnect();
    silentGainRef.current = null;

    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch (err) {
        console.error('[AudioRecorder] failed to close audio context', err);
      }
      audioContextRef.current = null;
    }

    resetState();
  }, [resetState]);

  const start = useCallback(async () => {
    if (isRecording) {
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Media devices API is not available in this browser.');
      throw new Error('Media devices API unavailable');
    }

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
        },
      });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      if (!audioContext.audioWorklet) {
        throw new Error('AudioWorklet is not supported in this environment.');
      }

      await audioContext.audioWorklet.addModule(WORKLET_PATH);

      const sourceNode = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, WORKLET_NAME);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;

      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        try {
          const chunk = event.data;
          const { downsampled, leftover } = downsample(
            chunk,
            audioContext.sampleRate,
            targetSampleRate,
            carryBufferRef.current,
          );
          carryBufferRef.current = leftover;

          if (downsampled.length > 0) {
            const pcmBuffer = convertFloat32ToInt16(downsampled);
            onData(pcmBuffer);
          }
        } catch (err) {
          console.error('[AudioRecorder] downsampling error', err);
          setError('Failed to process audio chunk.');
        }
      };

      sourceNode.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      workletNodeRef.current = workletNode;
      silentGainRef.current = silentGain;
      sourceNodeRef.current = sourceNode;
      setIsRecording(true);
    } catch (err) {
      console.error('[AudioRecorder] start failed', err);
      setError(err instanceof Error ? err.message : 'Failed to start audio recording.');
      await stop();
      throw err;
    }
  }, [isRecording, onData, stop, targetSampleRate]);

  return {
    start,
    stop,
    isRecording,
    error,
  };
}
