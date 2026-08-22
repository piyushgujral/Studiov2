/**
 * Generic Multi-Destination Stream Manager
 * Manages target destinations (YouTube, KICK, Twitch, Custom RTMP),
 * stream key security, validation, and individual connection statuses.
 */
export class DestinationManager {
  constructor() {
    this.destinations = [
      {
        id: 'youtube-main',
        name: 'YouTube',
        type: 'rtmp',
        enabled: false,
        serverUrl: 'rtmp://a.rtmp.youtube.com/live2',
        streamKey: '',
        status: 'not_connected',
        errorMessage: null,
        isCustom: false
      },
      {
        id: 'kick-main',
        name: 'KICK',
        type: 'rtmps',
        enabled: false,
        serverUrl: 'rtmps://stream.kick.com/app',
        streamKey: '',
        status: 'not_connected',
        errorMessage: null,
        isCustom: false
      },
      {
        id: 'twitch-main',
        name: 'Twitch',
        type: 'rtmps',
        enabled: false,
        serverUrl: 'rtmps://live.twitch.tv/app',
        streamKey: '',
        status: 'not_connected',
        errorMessage: null,
        isCustom: false
      }
    ];

    this.onDestinationsChange = null;
    this.loadFromStorage();
  }

  loadFromStorage() {
    try {
      const stored = localStorage.getItem('payuu_destinations');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Merge stored settings with default presets to avoid schema mismatches
          this.destinations = parsed.map(d => ({
            ...d,
            status: 'not_connected',
            errorMessage: null
          }));
        }
      }
    } catch (e) {
      console.warn('Could not load destinations from local storage:', e);
    }
  }

  saveToStorage() {
    try {
      // Save state to local storage (Excluding active transient error states)
      const dataToSave = this.destinations.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        enabled: d.enabled,
        serverUrl: d.serverUrl,
        streamKey: d.streamKey,
        isCustom: d.isCustom
      }));
      localStorage.setItem('payuu_destinations', JSON.stringify(dataToSave));
    } catch (e) {
      console.warn('Could not persist destinations to local storage:', e);
    }
    if (this.onDestinationsChange) {
      this.onDestinationsChange(this.destinations);
    }
  }

  getDestinations() {
    return this.destinations;
  }

  getEnabledDestinations() {
    return this.destinations.filter(d => d.enabled);
  }

  getDestination(id) {
    return this.destinations.find(d => d.id === id);
  }

  updateDestination(id, updates) {
    const dest = this.getDestination(id);
    if (!dest) return;

    Object.assign(dest, updates);

    // Auto-update status to ready if enabled and parameters exist
    if (dest.enabled && dest.serverUrl && dest.streamKey) {
      if (dest.status === 'not_connected') dest.status = 'ready';
    } else if (!dest.enabled) {
      dest.status = 'not_connected';
    }

    this.saveToStorage();
  }

  addCustomDestination(name, serverUrl, streamKey) {
    const id = 'custom-' + Date.now();
    const newDest = {
      id,
      name: name.trim() || 'Custom RTMP',
      type: serverUrl.toLowerCase().startsWith('rtmps') ? 'rtmps' : 'rtmp',
      enabled: true,
      serverUrl: serverUrl.trim(),
      streamKey: streamKey.trim(),
      status: (serverUrl.trim() && streamKey.trim()) ? 'ready' : 'not_connected',
      errorMessage: null,
      isCustom: true
    };
    this.destinations.push(newDest);
    this.saveToStorage();
    return newDest;
  }

  removeDestination(id) {
    const dest = this.getDestination(id);
    if (dest && dest.isCustom) {
      this.destinations = this.destinations.filter(d => d.id !== id);
      this.saveToStorage();
    }
  }

  setDestinationStatus(id, status, errorMessage = null) {
    const dest = this.getDestination(id);
    if (!dest) return;

    const normalized = String(status || '').toLowerCase();
    const aliases = {
      connecting: 'connecting',
      live: 'live',
      error: 'error',
      reconnecting: 'connecting',
      ended: 'ready',
      disconnected: 'ready',
      not_configured: 'not_connected',
      not_connected: 'not_connected',
      ready: 'ready'
    };

    dest.status = aliases[normalized] || 'not_connected';
    dest.errorMessage = errorMessage;
    if (this.onDestinationsChange) {
      this.onDestinationsChange(this.destinations);
    }
  }

  validateEnabledDestinations() {
    const enabled = this.getEnabledDestinations();
    if (enabled.length === 0) {
      return { valid: false, error: 'No streaming destinations are enabled. Please enable at least one platform in Settings.' };
    }

    for (const dest of enabled) {
      if (!dest.serverUrl || !dest.serverUrl.trim()) {
        return { valid: false, error: `Missing Server URL for ${dest.name}.` };
      }
      if (!dest.serverUrl.startsWith('rtmp://') && !dest.serverUrl.startsWith('rtmps://')) {
        return { valid: false, error: `Invalid Server URL for ${dest.name}. Must start with rtmp:// or rtmps://` };
      }
      if (!dest.streamKey || !dest.streamKey.trim()) {
        return { valid: false, error: `Missing Stream Key for ${dest.name}.` };
      }
    }

    return { valid: true, error: null };
  }
}