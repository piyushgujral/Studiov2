/**
 * Camera capture module using navigator.mediaDevices.getUserMedia()
 */
export class CameraCapture {
  constructor(videoElement) {
    this.videoElement = videoElement;
    this.stream = null;
    this.isActive = false;
    this.onStatusChange = null;
    this.onError = null;
  }

  async enable() {
    if (this.isActive) return this.stream;

    if (!window.isSecureContext) {
      const err = new Error('Camera access requires a Secure Context (http://localhost or https://). It cannot run from file://.');
      err.name = 'SecurityError';
      if (this.onError) this.onError(err);
      throw err;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error('navigator.mediaDevices.getUserMedia is not supported in this browser.');
      err.name = 'TypeError';
      if (this.onError) this.onError(err);
      throw err;
    }

    try {
      // Primary: request standard HD video
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          },
          audio: false
        });
      } catch (constraintErr) {
        // Fallback: minimal unconstrained video
        console.warn('Constrained camera request failed, attempting fallback to unconstrained video...', constraintErr);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      this.stream = stream;
      this.videoElement.srcObject = stream;

      // Explicit play promise handling
      try {
        await this.videoElement.play();
      } catch (playErr) {
        console.error('video.play() failed on camera stream:', playErr);
        // Retry muted inline play
        this.videoElement.muted = true;
        await this.videoElement.play();
      }

      this.isActive = true;
      if (this.onStatusChange) this.onStatusChange(true, stream);
      return stream;
    } catch (err) {
      this.disable();
      const parsedError = this.parseError(err);
      if (this.onError) this.onError(parsedError);
      throw parsedError;
    }
  }

  disable() {
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

    if (this.onStatusChange) this.onStatusChange(false, null);
  }

  parseError(err) {
    let message = '';
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        message = 'Camera permission was denied. Please allow camera access in your browser site settings.';
        break;
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        message = 'No camera device was found on this system.';
        break;
      case 'NotReadableError':
      case 'TrackStartError':
        message = 'The camera is already in use by another application (e.g. OBS, Zoom, Discord, or another browser tab).';
        break;
      case 'OverconstrainedError':
        message = 'The requested camera resolution is not supported by your hardware.';
        break;
      case 'SecurityError':
        message = 'Camera access is blocked by your browser security settings or insecure origin.';
        break;
      case 'TypeError':
        message = 'Camera capture is unavailable in this browser context.';
        break;
      default:
        message = `Camera error: ${err.name || 'Error'} — ${err.message || 'Unknown error'}`;
        break;
    }
    const errorObj = new Error(message);
    errorObj.name = err.name || 'CameraError';
    errorObj.originalError = err;
    return errorObj;
  }
}