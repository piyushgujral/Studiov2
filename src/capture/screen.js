/**
 * Cross-platform screen/display capture.
 * Screen capture is capability-based; camera + microphone remain usable when display capture is unavailable.
 */
import { assertMediaEnvironment, getDisplayMediaConstraints, prepareVideoElement, playVideo } from './platform.js';

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
    try {
      assertMediaEnvironment({ screen: true });
      prepareVideoElement(this.videoElement, { muted: true });
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(getDisplayMediaConstraints());
      } catch (audioErr) {
        if (audioErr.name === 'NotAllowedError' || audioErr.name === 'AbortError') throw audioErr;
        console.warn('[Payuu Screen] display+audio capture failed; retrying video-only:', audioErr);
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      }
      this.stream = stream;
      this.videoElement.srcObject = stream;
      await playVideo(this.videoElement);
      this.isActive = true;
      this.isRemote = false;
      this.hasAudio = stream.getAudioTracks().length > 0;
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.onended = () => this.stop();
      this.onStatusChange?.(true, stream, this.hasAudio, false);
      return stream;
    } catch (err) {
      this.stop();
      const parsedError = this.parseError(err);
      this.onError?.(parsedError);
      throw parsedError;
    }
  }

  attachRemoteStream(stream) {
    if (!stream) return;

    // IMPORTANT: a remote MediaStream belongs to the WebRTC connection.
    // Do NOT call stop() on the old stream here: its tracks may be the same
    // WebRTC tracks that are being re-published after metadata/track events.
    // Stopping them makes the remote screen disappear while the camera may
    // continue to work.
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
    }

    this.stream = stream;
    this.videoElement.srcObject = stream;
    prepareVideoElement(this.videoElement, { muted: true });
    playVideo(this.videoElement);
    this.isActive = true;
    this.isRemote = true;
    this.hasAudio = stream.getAudioTracks().length > 0;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) videoTrack.onended = () => {
      // The WebRTC manager owns remote tracks; only clear the presentation.
      if (this.isRemote) {
        this.videoElement?.pause();
        if (this.videoElement) this.videoElement.srcObject = null;
        this.isActive = false;
        this.hasAudio = false;
        this.isRemote = false;
        this.onStatusChange?.(false, null, false, true);
      }
    };
    this.onStatusChange?.(true, stream, this.hasAudio, true);
  }

  stop() {
    // Local display-capture tracks are owned by ScreenCapture and can be
    // stopped here. Remote WebRTC tracks are owned by RemoteDeviceManager
    // and must never be stopped by this presentation layer.
    if (!this.isRemote) {
      this.stream?.getTracks().forEach(track => track.stop());
    }
    this.stream = null;
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
    }
    this.isActive = false;
    this.hasAudio = false;
    this.isRemote = false;
    this.onStatusChange?.(false, null, false);
  }

  parseError(err) {
    let message;
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'AbortError': message = 'Screen sharing was cancelled or permission was denied.'; break;
      case 'NotReadableError':
      case 'TrackStartError': message = 'The selected screen or window could not be captured.'; break;
      case 'SecurityError': message = 'Screen sharing requires HTTPS or is blocked by browser policy.'; break;
      case 'TypeError': message = 'Screen sharing is unavailable in this browser. Camera and microphone can still be used.'; break;
      default: message = `Screen share error: ${err.name || 'Error'} — ${err.message || 'Unknown error'}`;
    }
    const errorObj = new Error(message);
    errorObj.name = err.name || 'ScreenCaptureError';
    errorObj.originalError = err;
    return errorObj;
  }
}
