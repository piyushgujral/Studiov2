import { PayuuStudio } from './studio.js';

async function loadPayuuConfig() {
  const fallback = {
    apiBase: window.location.origin,
    whipEndpoint: '',
    authToken: '',
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  try {
    const response = await fetch('/payuu-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    return {
      ...fallback,
      ...config,
      apiBase: config.apiBase || fallback.apiBase
    };
  } catch (error) {
    console.warn('[Payuu] Runtime config unavailable; using same-origin defaults.', error);
    return fallback;
  }
}

function ensureCaptureVideoElements() {
  const definitions = [
    { id: 'rawCameraVideo', label: 'camera' },
    { id: 'rawScreenVideo', label: 'screen' },
    { id: 'remoteDeviceVideo', label: 'remote device' }
  ];

  definitions.forEach(({ id, label }) => {
    let video = document.getElementById(id);

    if (video) return;

    video = document.createElement('video');
    video.id = id;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('title', `${label} capture source`);

    video.style.position = 'fixed';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.left = '-10px';
    video.style.top = '-10px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.zIndex = '-1';

    document.body.appendChild(video);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  window.PAYUU_CONFIG = await loadPayuuConfig();

  ensureCaptureVideoElements();

  window.payuuStudio = new PayuuStudio();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register('/sw.js')
      .catch(err =>
        console.warn('[Payuu] Service worker registration failed:', err)
      );
  }
});
