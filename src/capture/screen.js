/**
 * Screen share capture module using navigator.mediaDevices.getDisplayMedia()
 */
export class ScreenCapture {
  constructor(videoElement) {
    this.videoElement = videoElement;
    this.stream = null;
    this.isActive = false;
    this.hasAudio = false;
    this.onStatusChange = null;
    this.onError = null;
    this.isRemote = false;
  }

  async start() {
    if (this.isActive) return this.stream;

    if (!window.isSecureContext) {
      const err = new Error('Screen sharing requires a Secure Context (http://localhost or https://). It cannot run from file://.');
      err.name = 'SecurityError';
      if (this.onError) this.onError(err);
      throw err;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      const err = new Error('navigator.mediaDevices.getDisplayMedia is not supported in this browser.');
      err.name = 'TypeError';
      if (this.onError) this.onError(err);
      throw err;
    }

    try {
      let stream;
      try {
        // Primary request: Screen with optional system audio
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: 'always',
            displaySurface: 'monitor'
          },
          audio: true
        });
      } catch (optErr) {
        // Fallback: If audio track negotiation caused rejection, try video-only
        if (optErr.name !== 'NotAllowedError' && optErr.name !== 'AbortError') {
          console.warn('Audio-enabled getDisplayMedia failed, falling back to video-only display media...', optErr);
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: false
          });
        } else {
          throw optErr;
        }
      }

      this.stream = stream;
      this.videoElement.srcObject = stream;

      try {
        await this.videoElement.play();
      } catch (playErr) {
        console.error('video.play() failed on screen stream:', playErr);
        this.videoElement.muted = true;
        await this.videoElement.play();
      }

      this.isActive = true;

      const audioTracks = stream.getAudioTracks();
      this.hasAudio = audioTracks.length > 0;

      // Handle user stopping screen share via native browser bar
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          this.stop();
        };
      }

      if (this.onStatusChange) this.onStatusChange(true, stream, this.hasAudio);
      return stream;
    } catch (err) {
      this.stop();
      const parsedError = this.parseError(err);
      if (this.onError) this.onError(parsedError);
      throw parsedError;
    }
  }


  attachRemoteStream(stream) {
    this.stop();
    if (!stream) return;
    this.stream = stream;
    this.videoElement.srcObject = stream;
    this.videoElement.play().catch(() => {});
    this.isActive = true;
    this.isRemote = true;
    this.hasAudio = stream.getAudioTracks().length > 0;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) videoTrack.onended = () => this.stop();
    if (this.onStatusChange) this.onStatusChange(true, stream, this.hasAudio, true);
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.stop();
      });
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
    }
    this.isActive = false;
    this.hasAudio = false;
    this.isRemote = false;

    if (this.onStatusChange) this.onStatusChange(false, null, false);
  }

  parseError(err) {
    let message = '';
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'AbortError':
        message = 'Screen sharing was cancelled or permission was denied.';
        break;
      case 'NotReadableError':
      case 'TrackStartError':
        message = 'The selected screen or window could not be captured. It may be protected or minimized.';
        break;
      case 'SecurityError':
        message = 'Screen sharing is blocked in this context or by browser policy.';
        break;
      case 'TypeError':
        message = 'Screen sharing is unavailable in this browser/context.';
        break;
      default:
        message = `Screen share error: ${err.name || 'Error'} — ${err.message || 'Unknown error'}`;
        break;
    }
    const errorObj = new Error(message);
    errorObj.name = err.name || 'ScreenCaptureError';
    errorObj.originalError = err;
    return errorObj;
  }
}