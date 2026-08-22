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

function normalizeRemoteDeviceLabels() {
  const replacements = [
    ['iPhone Link', 'Remote Device'],
    ['iPhone Capture Link', 'Remote Device Capture'],
    ['iPad controls • iPhone captures screen, game audio and microphone', 'One device controls the Studio • another device can capture camera, screen and microphone'],
    ['Create iPhone Pairing Session', 'Create Remote Pairing Session'],
    ['WAITING FOR IPHONE…', 'WAITING FOR REMOTE DEVICE…'],
    ['WAITING FOR IPHONE', 'WAITING FOR REMOTE DEVICE'],
    ['CONNECTING TO IPHONE', 'CONNECTING TO REMOTE DEVICE'],
    ['iPhone Connected', 'Remote Device Connected'],
    ['iPhone Remote Screen', 'Remote Device Screen'],
    ['PAYUU iPHONE CAPTURE', 'PAYUU REMOTE CAPTURE'],
    ['Start iPhone Capture', 'Start Remote Capture'],
    ['iPhone sends its screen and available audio directly to the Payuu Studio running on your iPad.', 'This device can send its camera, screen and microphone directly to the Payuu Studio control device.'],
    ['Keep this page open. Screen/audio capabilities depend on your iOS/browser version.', 'Keep this page open while capturing. Screen, camera and microphone capabilities depend on the device and browser.']
  ];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  nodes.forEach(textNode => {
    let value = textNode.nodeValue;
    replacements.forEach(([from, to]) => { value = value.split(from).join(to); });
    textNode.nodeValue = value;
  });

  document.querySelectorAll('[title]').forEach(el => {
    replacements.forEach(([from, to]) => { el.title = el.title.split(from).join(to); });
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  window.PAYUU_CONFIG = await loadPayuuConfig();
  ensureCaptureVideoElements();
  window.payuuStudio = new PayuuStudio();
  normalizeRemoteDeviceLabels();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register('/sw.js')
      .catch(err => console.warn('[Payuu] Service worker registration failed:', err));
  }
});
