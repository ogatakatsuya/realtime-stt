/**
 * AudioWorkletProcessor that forwards raw PCM frames to the main thread.
 */
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channelData = input[0];
      this.port.postMessage(channelData.slice());
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
