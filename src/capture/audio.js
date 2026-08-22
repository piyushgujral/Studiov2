/**
 * Local audio pipeline and level metering foundation.
 * Exposes clean audio MediaStreamTrack for WHIP publishing.
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

  async startMicMeter() {
    if (this.isActive) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Audio recording not supported in this browser.');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.micStream = stream;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.micSource = source;
      this.mixDestination = this.audioCtx.createMediaStreamDestination();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;

      source.connect(this.analyser);
      source.connect(this.mixDestination);

      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
      this.isActive = true;

      this.monitor();
      return stream;
    } catch (err) {
      this.stop();
      throw new Error('Microphone access denied or unavailable.');
    }
  }

  getAudioTrack(displayStream = null) {
    // Return one mixed audio track for WHIP: microphone + system/display audio.
    // System audio is only mixed when the browser actually supplied an audio track.
    const hasDisplayAudio = displayStream?.getAudioTracks?.().length > 0;
    if (!this.audioCtx && hasDisplayAudio) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
        this.mixDestination = this.audioCtx.createMediaStreamDestination();
      }
    }

    if (!this.audioCtx || !this.mixDestination) {
      return this.micStream?.getAudioTracks()?.[0] || null;
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    if (hasDisplayAudio) {
      try {
        const tracks = displayStream.getAudioTracks();
        tracks.forEach((track) => {
          if (this.displaySources.some((entry) => entry.trackId === track.id)) return;
          const source = this.audioCtx.createMediaStreamSource(new MediaStream([track]));
          source.connect(this.mixDestination);
          this.displaySources.push({ trackId: track.id, source });
        });
      } catch (err) {
        console.warn('[AudioPipeline] Could not mix display/remote audio:', err);
      }
    }

    return this.mixDestination.stream.getAudioTracks()[0] || null;
  }

  monitor() {
    if (!this.isActive) return;

    this.analyser.getByteFrequencyData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    const average = sum / this.dataArray.length;
    const normalizedLevel = Math.min(100, Math.round((average / 128) * 100));

    if (this.onLevelUpdate) {
      this.onLevelUpdate(normalizedLevel);
    }

    this.rafId = requestAnimationFrame(() => this.monitor());
  }

  stop() {
    this.isActive = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    this.displaySources = [];
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.onLevelUpdate) {
      this.onLevelUpdate(0);
    }
  }
}