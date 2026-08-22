/**
 * Stream Quality Configuration & Video Parameter Presets
 */
export class QualitySettingsManager {
  constructor() {
    this.settings = {
      resolution: '1920x1080',
      fps: 60,
      videoBitrate: 6000, // in Kbps
      audioBitrate: 160,  // in Kbps
      keyframeInterval: 2, // in seconds
      encoderMode: 'auto'
    };

    this.presets = {
      '1080p60': {
        resolution: '1920x1080',
        fps: 60,
        videoBitrate: 6000,
        audioBitrate: 160,
        keyframeInterval: 2
      },
      '720p60': {
        resolution: '1280x720',
        fps: 60,
        videoBitrate: 4500,
        audioBitrate: 128,
        keyframeInterval: 2
      },
      '720p30': {
        resolution: '1280x720',
        fps: 30,
        videoBitrate: 3000,
        audioBitrate: 128,
        keyframeInterval: 2
      },
      '480p30': {
        resolution: '854x480',
        fps: 30,
        videoBitrate: 1500,
        audioBitrate: 96,
        keyframeInterval: 2
      }
    };

    this.loadSettings();
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem('payuu_stream_quality');
      if (saved) {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to load stream quality from localStorage:', e);
    }
  }

  saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    try {
      localStorage.setItem('payuu_stream_quality', JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Failed to persist stream quality settings:', e);
    }
  }

  getDimensions() {
    const [w, h] = this.settings.resolution.split('x').map(Number);
    return { width: w || 1920, height: h || 1080 };
  }
}