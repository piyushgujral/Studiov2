// Browser-source style overlay for live widgets, alerts and web overlays.
// Integrated into Overlay Studio so URL sources behave like a first-class overlay source.
const STORAGE_KEY = 'payuu_browser_overlay_v2';

function isValidHttpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

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
      if (value && typeof value === 'object') {
        return {
          url: typeof value.url === 'string' ? value.url : '',
          opacity: Number.isFinite(Number(value.opacity)) ? Math.max(0, Math.min(1, Number(value.opacity))) : 1,
          visible: Boolean(value.visible)
        };
      }
    } catch (_) {}
    return { url: '', opacity: 1, visible: false };
  }

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
  }

  buildUI() {
    this.injectOverlayStudioCard();
    this.buildModal();
  }

  injectOverlayStudioCard() {
    const grid = document.getElementById('overlayTemplateGrid');
    if (!grid || document.getElementById('payuuBrowserOverlayTemplate')) return;

    const card = document.createElement('button');
    card.id = 'payuuBrowserOverlayTemplate';
    card.type = 'button';
    card.className = 'w-full text-left p-3 rounded-lg border border-cyan-500/30 bg-cyan-950/20 hover:bg-cyan-950/40 transition group';
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0">
          <i class="fa-solid fa-globe text-cyan-300"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold text-white">Browser URL Source</div>
          <div class="text-[10px] text-gray-500 mt-0.5 truncate">Live URL / alert / widget overlay</div>
        </div>
        <i class="fa-solid fa-plus text-cyan-300 text-xs opacity-70 group-hover:opacity-100"></i>
      </div>`;

    card.addEventListener('click', () => this.openModal());
    grid.prepend(card);
  }

  buildModal() {
    if (document.getElementById('browserOverlayModal')) return;

    const modal = document.createElement('div');
    modal.id = 'browserOverlayModal';
    modal.className = 'hidden fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-[#161b22] border border-cyan-500/30 rounded-xl shadow-2xl w-full max-w-xl overflow-hidden">
        <div class="px-4 py-3 border-b border-[#30363d] flex items-center justify-between bg-[#11161d]">
          <div>
            <div class="flex items-center gap-2"><i class="fa-solid fa-globe text-cyan-300"></i><h3 class="text-sm font-bold text-white">Browser URL Overlay</h3></div>
            <p class="text-[10px] text-gray-500 mt-1">Add a live web overlay, alert widget, chat widget or custom HTTPS page.</p>
          </div>
          <button id="btnCloseBrowserOverlay" type="button" class="text-gray-400 hover:text-white text-lg">&times;</button>
        </div>
        <div class="p-4 space-y-4">
          <div>
            <label class="block text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Overlay URL</label>
            <input id="browserOverlayUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://example.com/overlay" class="w-full bg-[#0d1117] border border-[#30363d] focus:border-cyan-500/60 outline-none rounded-lg px-3 py-2.5 text-xs text-white font-mono" />
            <p class="text-[10px] text-gray-600 mt-1.5">HTTPS only. Examples: StreamElements overlay URL, Streamlabs widget URL, custom overlay page.</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="p-3 rounded-lg bg-[#0d1117] border border-[#30363d]">
              <label class="block text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Opacity</label>
              <div class="flex items-center gap-2"><input id="browserOverlayOpacity" type="range" min="0" max="100" value="100" class="w-full" /><span id="browserOverlayOpacityValue" class="text-xs text-cyan-300 font-mono w-10 text-right">100%</span></div>
            </div>
            <label class="p-3 rounded-lg bg-[#0d1117] border border-[#30363d] flex items-center gap-2 cursor-pointer">
              <input id="browserOverlayVisible" type="checkbox" class="accent-cyan-500 w-4 h-4" />
              <span><span class="block text-xs font-semibold text-white">Show overlay</span><span class="block text-[10px] text-gray-600 mt-0.5">Display it above the Studio canvas</span></span>
            </label>
          </div>
          <div class="p-3 rounded-lg bg-cyan-950/20 border border-cyan-500/20 text-[10px] text-gray-400 leading-relaxed">
            <div class="font-semibold text-cyan-300 mb-1"><i class="fa-solid fa-circle-info mr-1"></i>Browser-source behaviour</div>
            The page is rendered as a transparent iframe above the Studio preview. A website can prevent embedding with its own security policy (for example X-Frame-Options or CSP); Payuu cannot override that browser restriction.
          </div>
          <div class="flex items-center justify-between gap-3 pt-1">
            <div id="browserOverlayStatus" class="text-[10px] text-gray-500"></div>
            <div class="flex gap-2">
              <button id="btnRemoveBrowserOverlay" type="button" class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-300">Remove</button>
              <button id="btnApplyBrowserOverlay" type="button" class="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold">Add / Update URL</button>
            </div>
          </div>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const opacity = document.getElementById('browserOverlayOpacity');
    const opacityValue = document.getElementById('browserOverlayOpacityValue');
    opacity?.addEventListener('input', () => { opacityValue.textContent = `${opacity.value}%`; });
    document.getElementById('btnCloseBrowserOverlay')?.addEventListener('click', () => this.closeModal());
    modal.addEventListener('click', (event) => { if (event.target === modal) this.closeModal(); });
    document.getElementById('btnApplyBrowserOverlay')?.addEventListener('click', () => this.saveFromUI());
    document.getElementById('btnRemoveBrowserOverlay')?.addEventListener('click', () => this.remove());
    document.getElementById('browserOverlayUrl')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.saveFromUI();
      if (event.key === 'Escape') this.closeModal();
    });
  }

  openModal() {
    const modal = document.getElementById('browserOverlayModal');
    if (!modal) return;
    const url = document.getElementById('browserOverlayUrl');
    const opacity = document.getElementById('browserOverlayOpacity');
    const opacityValue = document.getElementById('browserOverlayOpacityValue');
    const visible = document.getElementById('browserOverlayVisible');
    const status = document.getElementById('browserOverlayStatus');
    if (url) url.value = this.config.url;
    if (opacity) opacity.value = String(Math.round(this.config.opacity * 100));
    if (opacityValue) opacityValue.textContent = `${Math.round(this.config.opacity * 100)}%`;
    if (visible) visible.checked = this.config.visible;
    if (status) status.textContent = this.config.url ? 'Existing browser overlay loaded.' : 'No URL configured.';
    modal.classList.remove('hidden');
    setTimeout(() => url?.focus(), 30);
  }

  closeModal() {
    document.getElementById('browserOverlayModal')?.classList.add('hidden');
  }

  saveFromUI() {
    const url = document.getElementById('browserOverlayUrl')?.value.trim() || '';
    const status = document.getElementById('browserOverlayStatus');
    if (url && !isValidHttpsUrl(url)) {
      if (status) status.textContent = 'Enter a valid HTTPS URL.';
      return;
    }
    const opacityValue = Number(document.getElementById('browserOverlayOpacity')?.value || 100);
    this.config.url = url;
    this.config.opacity = Math.max(0, Math.min(1, opacityValue / 100));
    this.config.visible = Boolean(document.getElementById('browserOverlayVisible')?.checked);
    this.save();
    this.apply();
    if (status) status.textContent = url ? 'Browser URL overlay added/updated.' : 'Overlay cleared.';
  }

  remove() {
    this.config = { url: '', opacity: 1, visible: false };
    this.save();
    this.apply();
    const status = document.getElementById('browserOverlayStatus');
    if (status) status.textContent = 'Browser URL overlay removed.';
    const url = document.getElementById('browserOverlayUrl');
    const visible = document.getElementById('browserOverlayVisible');
    if (url) url.value = '';
    if (visible) visible.checked = false;
  }

  ensureFrame() {
    if (this.iframe || !this.host) return;
    this.host.style.position = this.host.style.position || 'relative';
    this.iframe = document.createElement('iframe');
    this.iframe.id = 'payuuBrowserOverlayFrame';
    this.iframe.title = 'Payuu browser URL overlay';
    this.iframe.setAttribute('allowtransparency', 'true');
    this.iframe.setAttribute('scrolling', 'no');
    this.iframe.setAttribute('referrerpolicy', 'no-referrer');
    this.iframe.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;border:0;z-index:25;pointer-events:none;background:transparent;display:none;';
    this.host.appendChild(this.iframe);
  }

  apply() {
    this.ensureFrame();
    if (!this.iframe) return;
    const hasUrl = !!this.config.url;
    const enabled = hasUrl && this.config.visible;
    this.iframe.style.display = enabled ? 'block' : 'none';
    this.iframe.style.opacity = String(this.config.opacity);
    const nextSrc = hasUrl ? this.config.url : 'about:blank';
    if (this.iframe.src !== nextSrc) this.iframe.src = nextSrc;
  }
}
