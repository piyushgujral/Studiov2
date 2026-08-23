// Browser-source style overlay for live widgets, alerts and web overlays.
// Arbitrary web pages cannot be drawn into Canvas 2D; this renders the source
// above the studio preview like a Browser Source in streaming applications.
const STORAGE_KEY = 'payuu_browser_overlay_v1';

export class BrowserOverlayManager {
  constructor() {
    this.canvas = document.getElementById('studioCanvas');
    this.host = this.canvas?.parentElement || null;
    this.iframe = null;
    this.config = this.load();
    this.bindUI();
    this.apply();
  }

  load() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (value && typeof value.url === 'string') return value;
    } catch (_) {}
    return { url: '', opacity: 1, visible: false };
  }

  save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config)); }

  bindUI() {
    const modal = document.getElementById('browserOverlayModal');
    const open = document.getElementById('btnBrowserOverlay');
    const close = document.getElementById('btnCloseBrowserOverlay');
    const apply = document.getElementById('btnApplyBrowserOverlay');
    const url = document.getElementById('browserOverlayUrl');
    const opacity = document.getElementById('browserOverlayOpacity');
    const status = document.getElementById('browserOverlayStatus');
    const visible = document.getElementById('browserOverlayVisible');

    if (!modal) return;
    open?.addEventListener('click', () => {
      if (url) url.value = this.config.url;
      if (opacity) opacity.value = String(Math.round(this.config.opacity * 100));
      if (visible) visible.checked = this.config.visible;
      modal.classList.remove('hidden');
    });
    close?.addEventListener('click', () => modal.classList.add('hidden'));
    apply?.addEventListener('click', () => {
      const value = String(url?.value || '').trim();
      if (value && !/^https:\/\//i.test(value)) {
        if (status) status.textContent = 'Use an HTTPS overlay URL.';
        return;
      }
      this.config.url = value;
      this.config.opacity = Math.max(0, Math.min(1, Number(opacity?.value || 100) / 100));
      this.config.visible = !!visible?.checked;
      this.save();
      this.apply();
      if (status) status.textContent = value ? 'Browser overlay applied.' : 'Browser overlay cleared.';
    });
  }

  ensureFrame() {
    if (this.iframe || !this.host) return;
    this.host.style.position = this.host.style.position || 'relative';
    this.iframe = document.createElement('iframe');
    this.iframe.id = 'payuuBrowserOverlayFrame';
    this.iframe.setAttribute('title', 'Payuu browser overlay');
    this.iframe.setAttribute('allowtransparency', 'true');
    this.iframe.setAttribute('scrolling', 'no');
    this.iframe.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;border:0;z-index:25;pointer-events:none;background:transparent;display:none;';
    this.host.appendChild(this.iframe);
  }

  apply() {
    this.ensureFrame();
    if (!this.iframe) return;
    const hasUrl = !!this.config.url;
    this.iframe.style.display = hasUrl && this.config.visible ? 'block' : 'none';
    this.iframe.style.opacity = String(this.config.opacity);
    this.iframe.src = hasUrl ? this.config.url : 'about:blank';
  }
}
