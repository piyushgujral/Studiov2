/**
 * Cross-platform audio pipeline.
 * Mixes local microphone and remote/display audio into one WebRTC-ready track.
 */
export class AudioPipeline {
  constructor() {
    this.audioCtx = null;
    this.micStream = null;
    this.analyser = null;
    this.dataArray = null;
    this.mixDestination = null;
    this.micSource = null;
    this.displaySources = [];
    this.isActive = false;
    this.onLevelUpdate = null;
    this.rafId = null;
  }

  getAudioContext() {
    if (this.audioCtx) return this.audioCtx;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    this.audioCtx = new AudioContextClass();
    this.mixDestination = this.audioCtx.createMediaStreamDestination();
    return this.audioCtx;
  }

  async resume() {
    try {
      if (this.audioCtx?.state === 'suspended') await this.audioCtx.resume();
    } catch (_) {}
  }

  async startMicMeter() {
    if (this.isActive) return this.micStream;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is not supported in this browser.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      this.micStream = stream;
      const ctx = this.getAudioContext();
      if (!ctx) {
        this.isActive = true;
        return stream;
      }
      const source = ctx.createMediaStreamSource(stream);
      this.micSource = source;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);
      source.connect(this.mixDestination);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.isActive = true;
      this.monitor();
      await this.resume();
      return stream;
    } catch (err) {
      this.stop();
      throw new Error(`Microphone access failed: ${err.message || err.name || 'Unknown error'}`);
    }
  }

  addAudioStream(stream) {
    if (!stream?.getAudioTracks?.().length) return;
    const ctx = this.getAudioContext();
    if (!ctx || !this.mixDestination) return;
    for (const track of stream.getAudioTracks()) {
      if (this.displaySources.some(entry => entry.trackId === track.id)) continue;
      try {
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        source.connect(this.mixDestination);
        this.displaySources.push({ trackId: track.id, source });
      } catch (err) {
        console.warn('[Payuu Audio] Could not mix remote/display audio:', err);
      }
    }
    this.resume();
  }

  getAudioTrack(displayStream = null) {
    if (displayStream?.getAudioTracks?.().length) this.addAudioStream(displayStream);
    if (this.micStream?.getAudioTracks?.().length) {
      this.getAudioContext();
      if (this.audioCtx && !this.micSource) {
        try {
          this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
          this.micSource.connect(this.mixDestination);
        } catch (_) {}
      }
    }
    return this.mixDestination?.stream?.getAudioTracks?.()[0] || this.micStream?.getAudioTracks?.()[0] || null;
  }

  monitor() {
    if (!this.isActive || !this.analyser) return;
    this.analyser.getByteFrequencyData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
    const average = this.dataArray.length ? sum / this.dataArray.length : 0;
    this.onLevelUpdate?.(Math.min(100, Math.round((average / 128) * 100)));
    this.rafId = requestAnimationFrame(() => this.monitor());
  }

  stop() {
    this.isActive = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.micStream?.getTracks().forEach(track => track.stop());
    this.micStream = null;
    this.displaySources = [];
    if (this.audioCtx && this.audioCtx.state !== 'closed') this.audioCtx.close();
    this.audioCtx = null;
    this.mixDestination = null;
    this.micSource = null;
    this.onLevelUpdate?.(0);
  }
}
