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
    this.buildUI();
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

  buildUI() {
    if (document.getElementById('payuuBrowserOverlayUI')) return;
    const ui = document.createElement('div');
    ui.id = 'payuuBrowserOverlayUI';
    ui.innerHTML = `
      <button id="btnBrowserOverlay" type="button" title="Browser Overlay / URL Source" style="position:fixed;right:280px;top:8px;z-index:70;padding:7px 10px;border:1px solid #30363d;border-radius:6px;background:#161b22;color:#a5b4fc;font-size:12px;font-weight:700;cursor:pointer"><i class="fa-solid fa-globe"></i> Browser Overlay</button>
      <div id="browserOverlayModal" style="display:none;position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.82);align-items:center;justify-content:center;padding:20px;font-family:system-ui">
        <div style="width:min(620px,96vw);background:#161b22;border:1px solid #30363d;border-radius:12px;padding:18px;color:#e6edf3;box-shadow:0 20px 60px rgba(0,0,0,.5)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div><b style="font-size:16px">Browser Overlay / URL Source</b><div style="font-size:11px;color:#8b949e;margin-top:3px">Live-style browser source for alerts, widgets and custom overlays.</div></div><button id="btnCloseBrowserOverlay" style="background:none;border:0;color:#8b949e;font-size:20px;cursor:pointer">×</button></div>
          <label style="display:block;font-size:11px;color:#8b949e;margin-bottom:5px">OVERLAY URL</label>
          <input id="browserOverlayUrl" placeholder="https://example.com/overlay" style="width:100%;box-sizing:border-box;background:#0d1117;color:#fff;border:1px solid #30363d;border-radius:6px;padding:10px;font-size:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px"><label style="font-size:11px;color:#8b949e">OPACITY %<input id="browserOverlayOpacity" type="number" min="0" max="100" value="100" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;background:#0d1117;color:#fff;border:1px solid #30363d;border-radius:6px;padding:8px"></label><label style="font-size:11px;color:#8b949e;display:flex;align-items:end;gap:8px;padding-bottom:9px"><input id="browserOverlayVisible" type="checkbox"> SHOW OVERLAY</label></div>
          <div style="margin-top:12px;padding:10px;border-radius:7px;background:#0d1117;border:1px solid #30363d;font-size:11px;color:#8b949e;line-height:1.5"><b style="color:#c9d1d9">Note:</b> this is a Browser Source preview. External pages cannot be directly painted into the clean Canvas stream because of browser security. Image/video sources and same-origin renderers can be composited into the stream separately.</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px"><span id="browserOverlayStatus" style="font-size:11px;color:#8b949e"></span><button id="btnApplyBrowserOverlay" style="background:#6366f1;color:#fff;border:0;border-radius:6px;padding:9px 14px;font-weight:700;cursor:pointer">Apply Overlay</button></div>
        </div>
      </div>`;
    document.body.appendChild(ui);

    const modal = document.getElementById('browserOverlayModal');
    document.getElementById('btnBrowserOverlay')?.addEventListener('click', () => {
      document.getElementById('browserOverlayUrl').value = this.config.url;
      document.getElementById('browserOverlayOpacity').value = Math.round(this.config.opacity * 100);
      document.getElementById('browserOverlayVisible').checked = this.config.visible;
      modal.style.display = 'flex';
    });
    document.getElementById('btnCloseBrowserOverlay')?.addEventListener('click', () => { modal.style.display = 'none'; });
    document.getElementById('btnApplyBrowserOverlay')?.addEventListener('click', () => {
      const value = document.getElementById('browserOverlayUrl').value.trim();
      if (value && !/^https:\/\//i.test(value)) { document.getElementById('browserOverlayStatus').textContent = 'Use an HTTPS overlay URL.'; return; }
      this.config.url = value;
      this.config.opacity = Math.max(0, Math.min(1, Number(document.getElementById('browserOverlayOpacity').value || 100) / 100));
      this.config.visible = document.getElementById('browserOverlayVisible').checked;
      this.save();
      this.apply();
      document.getElementById('browserOverlayStatus').textContent = value ? 'Overlay applied.' : 'Overlay cleared.';
    });
  }

  ensureFrame() {
    if (this.iframe || !this.host) return;
    this.host.style.position = this.host.style.position || 'relative';
    this.iframe = document.createElement('iframe');
    this.iframe.id = 'payuuBrowserOverlayFrame';
    this.iframe.title = 'Payuu browser overlay';
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
