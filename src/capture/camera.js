/**
 * Cross-platform camera capture using getUserMedia().
 * Target: iOS/iPadOS, Android and Windows desktop browsers.
 */
import { assertMediaEnvironment, getCameraConstraints, prepareVideoElement, playVideo } from './platform.js';

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
    try {
      const info = assertMediaEnvironment();
      prepareVideoElement(this.videoElement, { muted: true });
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
      } catch (constraintErr) {
        console.warn('[Payuu Camera] preferred constraints failed; using basic camera:', constraintErr);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      this.stream = stream;
      this.videoElement.srcObject = stream;
      await playVideo(this.videoElement);
      this.isActive = true;
      this.onStatusChange?.(true, stream, info);
      return stream;
    } catch (err) {
      this.disable();
      const parsedError = this.parseError(err);
      this.onError?.(parsedError);
      throw parsedError;
    }
  }

  disable() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
    }
    this.isActive = false;
    this.onStatusChange?.(false, null);
  }

  parseError(err) {
    let message;
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError': message = 'Camera permission was denied. Allow camera access for Payuu Studio.'; break;
      case 'NotFoundError':
      case 'DevicesNotFoundError': message = 'No camera was found on this device.'; break;
      case 'NotReadableError':
      case 'TrackStartError': message = 'The camera is already being used by another app or browser tab.'; break;
      case 'OverconstrainedError': message = 'The requested camera mode is unavailable. Payuu will retry with basic camera settings.'; break;
      case 'SecurityError': message = 'Camera access requires HTTPS or localhost.'; break;
      default: message = `Camera error: ${err.name || 'Error'} — ${err.message || 'Unknown error'}`;
    }
    const errorObj = new Error(message);
    errorObj.name = err.name || 'CameraError';
    errorObj.originalError = err;
    return errorObj;
  }
}
