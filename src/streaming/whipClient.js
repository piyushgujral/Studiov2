/**
 * Standards-Compliant WebRTC / WHIP (RFC 9335) Ingest Client
 * Connects clean MediaStream to the Payuu Relay and streams destinations via X-Payuu-Destinations.
 */
export class WHIPClient {
  constructor() {
    this.peerConnection = null;
    this.resourceURL = null;
    this.endpointURL = '';
    this.authToken = '';
    this.iceServers = (window.PAYUU_CONFIG?.iceServers?.length ? window.PAYUU_CONFIG.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }]);
    this.eventSource = null;
    this.telemetryAbort = null;
    this.sessionId = null;

    this.onConnectionStateChange = null;
    this.onICEStateChange = null;
    this.onError = null;
    this.onServerTelemetry = null;
  }

  configure(endpointURL, authToken = '', iceServers = null) {
    this.endpointURL = (endpointURL || '').trim();
    this.authToken = (authToken || '').trim();
    if (Array.isArray(iceServers) && iceServers.length) this.iceServers = iceServers;
  }

  setIceServers(iceServers) {
    if (!Array.isArray(iceServers) || !iceServers.length) throw new Error('At least one ICE server is required.');
    this.iceServers = iceServers;
  }

  async publish(mediaStream, destinations = []) {
    if (!this.endpointURL) {
      const err = new Error('WHIP endpoint URL is not configured. Set the WHIP endpoint in Settings.');
      err.name = 'ConfigurationError';
      if (this.onError) this.onError(err);
      throw err;
    }

    if (!mediaStream || mediaStream.getTracks().length === 0) {
      const err = new Error('No active audio or video tracks available to stream.');
      err.name = 'NoMediaError';
      if (this.onError) this.onError(err);
      throw err;
    }

    this.disconnect();

    const rtcConfig = {
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle'
    };

    this.peerConnection = new RTCPeerConnection(rtcConfig);

    mediaStream.getTracks().forEach((track) => {
      this.peerConnection.addTransceiver(track, {
        direction: 'sendonly',
        streams: [mediaStream]
      });
    });

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection ? this.peerConnection.iceConnectionState : 'closed';
      if (this.onICEStateChange) this.onICEStateChange(state);
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (!this.peerConnection) return;
      const state = this.peerConnection.connectionState;
      if (this.onConnectionStateChange) this.onConnectionStateChange(state);
    };

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      await this.waitForICEGatheringComplete();

      const headers = {
        'Content-Type': 'application/sdp',
        'X-Payuu-Destinations': JSON.stringify(destinations)
      };
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const response = await fetch(this.endpointURL, {
        method: 'POST',
        headers: headers,
        body: this.peerConnection.localDescription.sdp
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`WHIP Relay returned HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      const locationHeader = response.headers.get('Location');
      if (locationHeader) {
        this.resourceURL = new URL(locationHeader, this.endpointURL).href;
        const sessionId = locationHeader.split('/').pop();
        this.sessionId = sessionId;
        this.connectTelemetryStream(sessionId);
      }

      const answerSDP = await response.text();
      if (!answerSDP || !answerSDP.includes('v=0')) {
        throw new Error('Payuu Media Relay returned an invalid SDP answer.');
      }

      const answer = new RTCSessionDescription({
        type: 'answer',
        sdp: answerSDP
      });

      await this.peerConnection.setRemoteDescription(answer);

      return {
        success: true,
        endpoint: this.endpointURL,
        resourceURL: this.resourceURL,
        sessionId: this.sessionId
      };
    } catch (err) {
      this.disconnect();
      const parsed = this.parseError(err);
      if (this.onError) this.onError(parsed);
      throw parsed;
    }
  }

  async connectTelemetryStream(sessionId) {
    if (!sessionId) return;
    try {
      const url = new URL(this.endpointURL);
      const telemetryUrl = `${url.protocol}//${url.host}/api/telemetry?sessionId=${encodeURIComponent(sessionId)}`;
      if (this.telemetryAbort) this.telemetryAbort.abort();
      const controller = new AbortController();
      this.telemetryAbort = controller;
      const headers = this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {};
      const response = await fetch(telemetryUrl, { headers, signal: controller.signal, cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error(`Telemetry unavailable (${response.status})`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          try {
            const stats = JSON.parse(line.slice(5).trim());
            this.onServerTelemetry?.(stats);
          } catch (_) {}
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('[Payuu] Telemetry stream closed:', err.message);
    }
  }

  waitForICEGatheringComplete() {
    return new Promise((resolve) => {
      if (this.peerConnection.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (this.peerConnection && this.peerConnection.iceGatheringState === 'complete') {
            this.peerConnection.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        this.peerConnection.addEventListener('icegatheringstatechange', checkState);
        setTimeout(() => {
          if (this.peerConnection) {
            this.peerConnection.removeEventListener('icegatheringstatechange', checkState);
          }
          resolve();
        }, 2000);
      }
    });
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.telemetryAbort) {
      this.telemetryAbort.abort();
      this.telemetryAbort = null;
    }

    if (this.resourceURL) {
      fetch(this.resourceURL, {
        method: 'DELETE',
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}
      }).catch(() => {});
      this.resourceURL = null;
    }
    this.sessionId = null;

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.onConnectionStateChange) this.onConnectionStateChange('closed');
    if (this.onICEStateChange) this.onICEStateChange('closed');
  }

  parseError(err) {
    let msg = err.message || 'WHIP WebRTC connection failed.';
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      msg = `Payuu Media Relay unreachable at ${this.endpointURL}. Server is offline or blocked by CORS.`;
    }
    const errorObj = new Error(msg);
    errorObj.name = err.name || 'WHIPError';
    errorObj.originalError = err;
    return errorObj;
  }
}