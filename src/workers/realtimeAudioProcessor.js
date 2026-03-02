class RealtimeAudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) {
      return true;
    }

    // Copy frame data before posting, as underlying buffers are reused by the engine.
    this.port.postMessage(new Float32Array(input[0]));
    return true;
  }
}

registerProcessor("realtime-audio-processor", RealtimeAudioProcessor);
