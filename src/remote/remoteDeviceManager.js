export class RemoteDeviceManager {
  constructor({ remoteVideo, apiBase = 'https://payuu-remote-signaling.piyushgujral04.workers.dev' } = {}) {
    this.remoteVideo = remoteVideo;
    const runtime = window.PAYUU_CONFIG || {};
    this.apiBase = apiBase || runtime.apiBase || window.location.origin;
    this.authToken = localStorage.getItem('payuu_whip_token') || runtime.authToken || '';
    this.iceServers = this.loadIceServers();
    const q = new URLSearchParams(location.search);
    this.role = q.get('mode') === 'capture' ? 'capture' : 'control';
    this.sessionId = q.get('session') || '';
    this.code = (q.get('code') || '').toUpperCase();
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.remoteScreenStream = new MediaStream();
    this.remoteCameraStream = new MediaStream();
    this.remoteAudioStream = new MediaStream();
    this.remoteTrackEvents = [];
    this.remoteStreamTypes = new Map();
    this.captureDataChannel = null;
    this.pollTimer = null;
    this.running = false;
    this.onStatus = null;
    this.onRemoteStream = null;
    this.onRemoteCamera = null;
    this.onRemoteAudio = null;
    this.onError = null;
    this.onCode = null;
    this.onPairingExpired = null;
  }

  loadIceServers() {
    try {
      const raw = localStorage.getItem('payuu_ice_servers');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (_) {}
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }

  setIceServers(servers) {
    this.iceServers = Array.isArray(servers) && servers.length ? servers : [{ urls: 'stun:stun.l.google.com:19302' }];
    localStorage.setItem('payuu_ice_servers', JSON.stringify(this.iceServers));
  }

  getHeaders(extra = {}) {
    const headers = { ...extra };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    return headers;
  }

  async resolveCaptureSession() {
    if (this.role !== 'capture' || !this.sessionId || this.code) return;
    const r = await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}/info`, { headers: this.getHeaders(), cache: 'no-store' });
    if (!r.ok) throw new Error('Pairing session not found or expired.');
    const d = await r.json();
    if (!d.code) throw new Error('Pairing code could not be retrieved.');
    this.code = String(d.code).trim().toUpperCase();
    this.onCode?.(d);
  }

  async createControlSession() {
    const r = await fetch(`${this.apiBase}/api/remote/session`, { method: 'POST', headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Could not create pairing session (${r.status}).`);
    const d = await r.json();
    this.role = 'control';
    this.sessionId = d.sessionId;
    this.code = d.code;
    this.onCode?.(d);
    this.setStatus('WAITING_FOR_REMOTE_DEVICE');
    this.pollOffer();
    return d;
  }

  async joinCaptureSession(code = this.code, sessionId = this.sessionId) {
    this.role = 'capture';
    this.sessionId = sessionId || this.sessionId;
    this.code = String(code || '').trim().toUpperCase();
    if (!this.code && this.sessionId) await this.resolveCaptureSession();
    if (!this.code) throw new Error('Pairing code could not be retrieved.');

    if (!this.sessionId) {
      const r = await fetch(`${this.apiBase}/api/remote/session?code=${encodeURIComponent(this.code)}`, { headers: this.getHeaders() });
      if (!r.ok) throw new Error('Pairing code not found or expired.');
      this.sessionId = (await r.json()).sessionId;
    }

    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone capture are not available in this browser.');

    let screen = null;
    let cameraMic = null;

    // Screen is optional. iOS can reject getDisplayMedia while still allowing camera/mic.
    if (navigator.mediaDevices.getDisplayMedia) {
      try {
        screen = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true });
      } catch (e) {
        console.warn('[Payuu Remote] screen capture unavailable:', e?.name, e?.message || e);
      }
    }

    try {
      cameraMic = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      console.warn('[Payuu Remote] camera + microphone request failed:', e);
      try {
        cameraMic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (micErr) {
        console.warn('[Payuu Remote] microphone fallback failed:', micErr);
      }
    }

    if (!screen && !cameraMic) throw new Error('No camera, microphone or screen permission was granted.');

    this.localStream = new MediaStream();
    [...(screen?.getTracks() || []), ...(cameraMic?.getTracks() || [])].forEach(track => this.localStream.addTrack(track));
    [...(screen?.getTracks() || []), ...(cameraMic?.getTracks() || [])].forEach(track => track.addEventListener('ended', () => this.setStatus('CAPTURE_TRACK_ENDED')));

    await this.createPeer();

    // Preserve source identity. The control side uses this metadata instead of guessing
    // whether the first video track is screen or camera.
    const meta = {
      type: 'payuu-media-meta',
      screenStreamId: screen?.id || '',
      cameraStreamId: cameraMic?.id || '',
      hasScreen: !!screen?.getVideoTracks().length,
      hasCamera: !!cameraMic?.getVideoTracks().length,
      hasMicrophone: !!cameraMic?.getAudioTracks().length,
      hasScreenAudio: !!screen?.getAudioTracks().length
    };
    this.captureDataChannel = this.pc.createDataChannel('payuu-media-meta', { ordered: true });
    const sendMeta = () => {
      if (this.captureDataChannel?.readyState === 'open') this.captureDataChannel.send(JSON.stringify(meta));
    };
    this.captureDataChannel.onopen = sendMeta;

    screen?.getTracks().forEach(track => this.pc.addTrack(track, screen));
    cameraMic?.getTracks().forEach(track => this.pc.addTrack(track, cameraMic));

    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.waitForIce();
    sendMeta();

    const r = await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}/offer?code=${encodeURIComponent(this.code)}`, {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sdp: this.pc.localDescription.sdp })
    });
    if (!r.ok) throw new Error(`Could not send remote-device offer (${r.status}).`);

    this.setStatus('WAITING_FOR_CONTROL_DEVICE');
    this.pollAnswer();
    return {
      sessionId: this.sessionId,
      code: this.code,
      hasScreen: !!screen?.getVideoTracks().length,
      hasCamera: !!cameraMic?.getVideoTracks().length,
      hasAudio: !!cameraMic?.getAudioTracks().length || !!screen?.getAudioTracks().length
    };
  }

  async createPeer() {
    this.stopPeer(false);
    this.remoteScreenStream = new MediaStream();
    this.remoteCameraStream = new MediaStream();
    this.remoteAudioStream = new MediaStream();
    this.remoteTrackEvents = [];
    this.remoteStreamTypes = new Map();

    this.pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
    this.pc.onconnectionstatechange = () => {
      const state = String(this.pc?.connectionState || 'closed').toUpperCase();
      this.setStatus(`WEBRTC_${state}`);
      if (state === 'FAILED') this.onError?.(new Error('WebRTC connection failed. STUN could not establish a direct path; a TURN relay is required for some networks.'));
      if (['FAILED', 'CLOSED'].includes(state)) this.cleanupPoll();
    };
    this.pc.oniceconnectionstatechange = () => this.setStatus(`ICE_${String(this.pc?.iceConnectionState || 'closed').toUpperCase()}`);
    this.pc.ontrack = event => this.handleRemoteTrack(event);
    this.pc.ondatachannel = event => {
      if (event.channel.label !== 'payuu-media-meta') return;
      event.channel.onmessage = e => {
        try {
          const data = JSON.parse(e.data);
          if (data?.type === 'payuu-media-meta') this.applyRemoteMediaMetadata(data);
        } catch (_) {}
      };
    };
  }

  applyRemoteMediaMetadata(meta) {
    if (meta.screenStreamId) this.remoteStreamTypes.set(meta.screenStreamId, 'screen');
    if (meta.cameraStreamId) this.remoteStreamTypes.set(meta.cameraStreamId, 'camera');
    this.rebuildRemoteStreams();
    this.setStatus(`MEDIA CAMERA:${meta.hasCamera ? 'YES' : 'NO'} MIC:${meta.hasMicrophone ? 'YES' : 'NO'} SCREEN:${meta.hasScreen ? 'YES' : 'NO'}`);
  }

  handleRemoteTrack(event) {
    this.remoteTrackEvents.push(event);
    this.rebuildRemoteStreams();
  }

  rebuildRemoteStreams() {
    this.remoteScreenStream = new MediaStream();
    this.remoteCameraStream = new MediaStream();
    this.remoteAudioStream = new MediaStream();

    const videoEvents = this.remoteTrackEvents.filter(e => e.track.kind === 'video');
    const videoIds = [...new Set(videoEvents.flatMap(e => (e.streams || []).map(s => s.id)).filter(Boolean))];
    const fallback = new Map();
    if (videoIds.length === 1) fallback.set(videoIds[0], 'camera');
    if (videoIds.length >= 2) { fallback.set(videoIds[0], 'screen'); fallback.set(videoIds[1], 'camera'); }

    for (const event of this.remoteTrackEvents) {
      const track = event.track;
      const streamId = event.streams?.[0]?.id || '';
      if (track.kind === 'audio') {
        this.remoteAudioStream.addTrack(track);
        continue;
      }
      const type = this.remoteStreamTypes.get(streamId) || fallback.get(streamId) || 'camera';
      if (type === 'screen') this.remoteScreenStream.addTrack(track);
      else this.remoteCameraStream.addTrack(track);
    }
    this.publishRemoteStreams();
  }

  publishRemoteStreams() {
    const screenVideo = document.getElementById('rawScreenVideo');
    const cameraVideo = document.getElementById('rawCameraVideo');
    let remoteAudio = document.getElementById('remoteDeviceAudio');
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.id = 'remoteDeviceAudio';
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true;
      remoteAudio.style.position = 'fixed';
      remoteAudio.style.width = '1px';
      remoteAudio.style.height = '1px';
      remoteAudio.style.left = '-10px';
      remoteAudio.style.top = '-10px';
      remoteAudio.style.opacity = '0';
      document.body.appendChild(remoteAudio);
    }

    if (screenVideo && this.remoteScreenStream.getVideoTracks().length) {
      screenVideo.srcObject = this.remoteScreenStream;
      screenVideo.muted = true;
      screenVideo.playsInline = true;
      screenVideo.play().catch(() => {});
    }

    if (cameraVideo && this.remoteCameraStream.getVideoTracks().length) {
      cameraVideo.srcObject = this.remoteCameraStream;
      cameraVideo.muted = true;
      cameraVideo.playsInline = true;
      cameraVideo.play().catch(() => {});
      const studio = window.payuuStudio;
      if (studio?.compositor) {
        studio.compositor.isCameraActive = true;
        studio.cameraBtnText && (studio.cameraBtnText.textContent = 'Remote Camera');
        studio.btnToggleCamera?.classList.add('bg-indigo-900');
        studio.btnToggleCamera?.classList.remove('bg-gray-800');
        studio.sourceCardCamera?.classList.remove('hidden');
        studio.updatePlaceholderVisibility?.();
      }
      this.onRemoteCamera?.(this.remoteCameraStream);
    }

    if (this.remoteAudioStream.getAudioTracks().length) {
      remoteAudio.srcObject = this.remoteAudioStream;
      remoteAudio.muted = false;
      remoteAudio.volume = 1;
      remoteAudio.play().catch(() => this.setStatus('WEBRTC_AUDIO_CONNECTED'));
      const studio = window.payuuStudio;
      // Feed remote microphone/system audio into the existing studio mixer so
      // WHIP streaming receives it even when there is no remote screen stream.
      studio?.audioPipeline?.getAudioTrack(this.remoteAudioStream);
      this.onRemoteAudio?.(this.remoteAudioStream);
    }

    if (this.remoteScreenStream.getVideoTracks().length) {
      const remoteProgramStream = new MediaStream([
        ...this.remoteScreenStream.getVideoTracks(),
        ...this.remoteAudioStream.getAudioTracks()
      ]);
      if (this.remoteVideo) {
        this.remoteVideo.srcObject = remoteProgramStream;
        this.remoteVideo.muted = true;
        this.remoteVideo.playsInline = true;
        this.remoteVideo.play().catch(() => {});
      }
      this.onRemoteStream?.(remoteProgramStream);
    }
  }

  async pollOffer() {
    this.cleanupPoll();
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      try {
        const r = await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}/offer?code=${encodeURIComponent(this.code)}`, { headers: this.getHeaders(), cache: 'no-store' });
        if (r.status === 200) {
          const d = await r.json();
          if (d.sdp) {
            await this.createPeer();
            await this.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
            await this.pc.setLocalDescription(await this.pc.createAnswer());
            await this.waitForIce();
            const a = await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}/answer?code=${encodeURIComponent(this.code)}`, {
              method: 'POST',
              headers: this.getHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ sdp: this.pc.localDescription.sdp })
            });
            if (!a.ok) throw new Error(`Could not send control-device answer (${a.status}).`);
            this.setStatus('ANSWER_SENT');
            return;
          }
        }
      } catch (e) {
        this.onError?.(e);
      }
      this.pollTimer = setTimeout(loop, 1000);
    };
    loop();
  }

  async pollAnswer() {
    this.cleanupPoll();
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      try {
        const r = await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}/answer?code=${encodeURIComponent(this.code)}`, { headers: this.getHeaders(), cache: 'no-store' });
        if (r.status === 200) {
          const d = await r.json();
          if (d.sdp) {
            await this.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
            this.setStatus('ANSWER_RECEIVED');
            return;
          }
        }
      } catch (e) {
        this.onError?.(e);
      }
      this.pollTimer = setTimeout(loop, 1000);
    };
    loop();
  }

  async waitForIce() {
    if (!this.pc || this.pc.iceGatheringState === 'complete') return;
    await new Promise(resolve => {
      let done = false;
      const start = Date.now();
      const finish = () => {
        if (done) return;
        if (this.pc?.iceGatheringState === 'complete' || Date.now() - start > 5000) {
          done = true;
          this.pc?.removeEventListener('icegatheringstatechange', finish);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', finish);
      setTimeout(finish, 5100);
    });
  }

  cleanupPoll() {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  stopPeer(stopLocal = true) {
    this.cleanupPoll();
    this.pc?.close();
    this.pc = null;
    if (stopLocal && this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }

  async close() {
    try {
      if (this.sessionId && this.code) {
        await fetch(`${this.apiBase}/api/remote/session/${encodeURIComponent(this.sessionId)}?code=${encodeURIComponent(this.code)}`, { method: 'DELETE', headers: this.getHeaders() });
      }
    } catch (_) {}
    this.stopPeer(true);
    this.remoteStream?.getTracks().forEach(track => track.stop());
    this.remoteStream = null;
    this.remoteScreenStream?.getTracks().forEach(track => track.stop());
    this.remoteCameraStream?.getTracks().forEach(track => track.stop());
    this.remoteAudioStream?.getTracks().forEach(track => track.stop());
    this.remoteScreenStream = new MediaStream();
    this.remoteCameraStream = new MediaStream();
    this.remoteAudioStream = new MediaStream();
    this.remoteTrackEvents = [];
    this.remoteStreamTypes.clear();
    this.sessionId = '';
    this.code = '';
    this.setStatus('DISCONNECTED');
  }

  setStatus(status) {
    this.onStatus?.(status);
  }
}
