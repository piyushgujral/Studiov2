/**
 * Streaming Engine State Machine
 * Coordinates Clean Compositor stream, WHIP client, and destination status telemetry.
 */
import { WHIPClient } from './whipClient.js';

export class StreamingEngine {
  constructor(destinationManager, qualitySettings, compositor, audioPipeline, screenCapture = null) {
    this.destinationManager = destinationManager;
    this.qualitySettings = qualitySettings;
    this.compositor = compositor;
    this.audioPipeline = audioPipeline;
    this.screenCapture = screenCapture;

    this.whipClient = new WHIPClient();

    this.session = {
      id: null,
      startedAt: null,
      endedAt: null,
      status: 'PREVIEW', // 'PREVIEW' | 'STARTING' | 'CONNECTING' | 'CONNECTED' | 'LIVE' | 'STOPPING' | 'ENDED' | 'ERROR'
      endpoint: '',
      videoTrackActive: false,
      audioTrackActive: false,
      iceState: 'new',
      peerState: 'new',
      serverBitrateKbps: 0,
      packetsReceived: 0
    };

    this.onStatusChange = null;
    this.onDiagnosticsUpdate = null;

    this.loadConfiguration();
    this.setupWHIPCallbacks();
  }

  loadConfiguration() {
    const runtime = window.PAYUU_CONFIG || {};
    const savedEndpoint = localStorage.getItem('payuu_whip_endpoint') || runtime.whipEndpoint || '';
    const savedToken = localStorage.getItem('payuu_whip_token') || runtime.authToken || '';
    this.session.endpoint = savedEndpoint;
    this.whipClient.configure(savedEndpoint, savedToken, runtime.iceServers || null);
  }

  setWHIPEndpoint(endpointURL, token = '') {
    this.session.endpoint = endpointURL.trim();
    localStorage.setItem('payuu_whip_endpoint', this.session.endpoint);
    localStorage.setItem('payuu_whip_token', token.trim());
    this.whipClient.configure(this.session.endpoint, token.trim(), this.whipClient.iceServers);
    this.notifyDiagnostics();
  }

  getStatus() {
    return this.session.status;
  }

  setupWHIPCallbacks() {
    this.whipClient.onICEStateChange = (iceState) => {
      this.session.iceState = iceState;
      this.notifyDiagnostics();
    };

    this.whipClient.onConnectionStateChange = (peerState) => {
      this.session.peerState = peerState;
      this.notifyDiagnostics();

      if (peerState === 'connected') {
        this.session.startedAt = Date.now();
        this.updateStatus('CONNECTED');
      } else if (peerState === 'failed' || peerState === 'disconnected') {
        this.updateStatus('ERROR');
        this.whipClient.disconnect();
      } else if (peerState === 'closed') {
        if (this.session.status !== 'PREVIEW') {
          this.updateStatus('PREVIEW');
        }
      }
    };

    this.whipClient.onServerTelemetry = (stats) => {
      this.session.serverBitrateKbps = stats.bitrateKbps || 0;
      this.session.packetsReceived = stats.packetsReceived || 0;

      // Update true RTMP fanout status from server
      if (stats.destinations) {
        Object.entries(stats.destinations).forEach(([destId, destInfo]) => {
          this.destinationManager.setDestinationStatus(
            destId,
            destInfo.status || 'not_connected',
            destInfo.error || null
          );
        });
      }

      const destinationStates = this.destinationManager.getEnabledDestinations().map(d => d.status);
      const hasLiveDestination = destinationStates.includes('live');
      if (hasLiveDestination && (this.session.peerState === 'connected' || this.session.status === 'CONNECTED' || this.session.status === 'LIVE')) {
        this.updateStatus('LIVE');
      } else if (this.session.peerState === 'connected') {
        this.updateStatus('CONNECTED');
      }
      this.notifyDiagnostics();
    };

    this.whipClient.onError = (err) => {
      console.error('[WHIP Engine Error]', err);
      this.updateStatus('ERROR');
    };
  }

  async startStream() {
    if (this.session.status === 'STARTING' || this.session.status === 'CONNECTING' || this.session.status === 'CONNECTED' || this.session.status === 'LIVE') {
      return;
    }

    this.updateStatus('STARTING');

    if (!this.session.endpoint) {
      this.updateStatus('ERROR');
      throw new Error('WHIP endpoint not configured. Set a valid WHIP Ingest URL in Settings.');
    }

    const hasVideo = this.compositor.isCameraActive || this.compositor.isScreenActive;
    if (!hasVideo && !this.compositor.activeScene?.sources?.showText) {
      this.updateStatus('ERROR');
      throw new Error('No active video or scene content to stream. Enable Camera or Screen Share.');
    }

    const destinationValidation = this.destinationManager.validateEnabledDestinations();
    if (!destinationValidation.valid) {
      this.updateStatus('ERROR');
      throw new Error(destinationValidation.error);
    }

    const cleanStream = this.compositor.getCleanStream(this.qualitySettings.settings.fps);
    const combinedStream = new MediaStream();

    const videoTracks = cleanStream.getVideoTracks();
    if (videoTracks.length > 0) {
      combinedStream.addTrack(videoTracks[0]);
      this.session.videoTrackActive = true;
    } else {
      this.session.videoTrackActive = false;
    }

    const displayStream = this.screenCapture?.stream || null;
    const audioTrack = this.audioPipeline ? this.audioPipeline.getAudioTrack(displayStream) : null;
    if (audioTrack && audioTrack.readyState === 'live') {
      combinedStream.addTrack(audioTrack);
      this.session.audioTrackActive = true;
    } else {
      this.session.audioTrackActive = false;
    }

    this.notifyDiagnostics();
    this.updateStatus('CONNECTING');

    try {
      const enabledDestinations = this.destinationManager.getEnabledDestinations();
      const result = await this.whipClient.publish(combinedStream, enabledDestinations);
      this.session.id = result.sessionId || null;
    } catch (err) {
      this.updateStatus('ERROR');
      throw err;
    }
  }

  stopStream() {
    if (this.session.status === 'PREVIEW' || this.session.status === 'ENDED') {
      return;
    }

    this.updateStatus('STOPPING');
    this.whipClient.disconnect();

    this.session.endedAt = Date.now();
    this.session.videoTrackActive = false;
    this.session.audioTrackActive = false;

    const enabled = this.destinationManager.getEnabledDestinations();
    enabled.forEach((dest) => {
      this.destinationManager.setDestinationStatus(dest.id, 'ready');
    });

    this.updateStatus('ENDED');
    setTimeout(() => {
      this.updateStatus('PREVIEW');
    }, 500);
  }

  updateStatus(status) {
    this.session.status = status;
    if (this.onStatusChange) {
      this.onStatusChange(status, this.session);
    }
    this.notifyDiagnostics();
  }

  notifyDiagnostics() {
    if (this.onDiagnosticsUpdate) {
      this.onDiagnosticsUpdate({
        ...this.session,
        isConfigured: !!this.session.endpoint
      });
    }
  }
}