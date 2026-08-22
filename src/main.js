import { PayuuStudio } from './studio.js';

async function loadPayuuConfig() {
  const fallback = { apiBase: window.location.origin, whipEndpoint: '', authToken: '', iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  try {
    const response = await fetch('/payuu-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    return { ...fallback, ...config, apiBase: config.apiBase || fallback.apiBase };
  } catch (error) {
    console.warn('[Payuu] Runtime config unavailable; using same-origin defaults.', error);
    return fallback;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  window.PAYUU_CONFIG = await loadPayuuConfig();
  window.payuuStudio = new PayuuStudio();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('[Payuu] Service worker registration failed:', err));
  }
});
