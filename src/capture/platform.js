/**
 * Cross-platform media helpers for iOS/iPadOS, Android and desktop browsers.
 * Keep feature detection capability-first; never assume an OS implies a browser feature.
 */

export function getPlatformInfo() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  const isiOS = /iPad|iPhone|iPod/.test(ua) ||
    (platform === 'MacIntel' && maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isWindows = /Windows/i.test(ua);
  const isMac = /Macintosh|Mac OS X/i.test(ua) && !isiOS;

  let browser = 'unknown';
  if (/Edg\//i.test(ua)) browser = 'edge';
  else if (/OPR\//i.test(ua)) browser = 'opera';
  else if (/CriOS\//i.test(ua) || /Chrome\//i.test(ua)) browser = 'chrome';
  else if (/FxiOS\//i.test(ua) || /Firefox\//i.test(ua)) browser = 'firefox';
  else if (/Safari\//i.test(ua)) browser = 'safari';

  return {
    isiOS,
    isAndroid,
    isWindows,
    isMac,
    isMobile: isiOS || isAndroid || /Mobile|Mobi/i.test(ua),
    browser,
    secure: !!window.isSecureContext,
    hasMediaDevices: !!navigator.mediaDevices,
    hasUserMedia: !!navigator.mediaDevices?.getUserMedia,
    hasDisplayMedia: !!navigator.mediaDevices?.getDisplayMedia,
    hasPeerConnection: typeof window.RTCPeerConnection === 'function'
  };
}

export function assertMediaEnvironment({ screen = false } = {}) {
  const info = getPlatformInfo();

  if (!info.secure) {
    throw new Error('Camera, microphone and screen capture require HTTPS (or localhost for development).');
  }
  if (!info.hasUserMedia) {
    throw new Error('This browser does not provide camera/microphone capture. Please use a current Safari, Chrome, Edge or Firefox browser.');
  }
  if (!info.hasPeerConnection) {
    throw new Error('This browser does not provide WebRTC. Please use a current Safari, Chrome, Edge or Firefox browser.');
  }
  if (screen && !info.hasDisplayMedia) {
    throw new Error('Screen capture is not available in this browser. Camera and microphone capture can still be used.');
  }

  return info;
}

export function getCameraConstraints() {
  const info = getPlatformInfo();

  // Keep constraints deliberately conservative. Safari/iOS is less tolerant of
  // desktop-only constraints, while Chrome/Edge/Firefox can satisfy these ideals.
  const video = {
    width: { ideal: info.isMobile ? 1280 : 1920 },
    height: { ideal: info.isMobile ? 720 : 1080 }
  };

  if (info.isMobile) video.facingMode = { ideal: 'user' };

  return {
    video,
    audio: false
  };
}

export function getMicrophoneConstraints() {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  };
}

export function getRemoteCaptureConstraints() {
  return {
    video: getCameraConstraints().video,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  };
}

export function getDisplayMediaConstraints() {
  // Do not send displaySurface/monitor constraints. They are optional hints and
  // are not equally implemented across Safari, Chrome, Edge and Android browsers.
  return {
    video: true,
    audio: true
  };
}

export function prepareVideoElement(video, { muted = true } = {}) {
  if (!video) return;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.muted = muted;
}

export async function playVideo(video) {
  if (!video) return false;
  try {
    await video.play();
    return true;
  } catch (firstError) {
    // Mobile Safari can require the element to be muted for autoplay.
    video.muted = true;
    try {
      await video.play();
      return true;
    } catch (_) {
      console.warn('[Payuu Media] video playback requires a user gesture:', firstError);
      return false;
    }
  }
}

export async function resumeAudioContext(audioContext) {
  if (!audioContext || audioContext.state !== 'suspended') return;
  try {
    await audioContext.resume();
  } catch (_) {
    // Safari may require resume() to occur inside a user gesture. The next
    // user interaction can call this helper again.
  }
}
