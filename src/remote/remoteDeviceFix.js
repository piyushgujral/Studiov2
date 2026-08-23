// Payuu remote capture compatibility layer.
// The important rule is that screen and camera are identified by the
// negotiated WebRTC transceiver MID, not by MediaStreamTrack IDs. Browsers
// are allowed to rewrite track IDs across a peer connection.

export function installRemoteDeviceFix(studio) {
  const manager = studio?.remoteDeviceManager;
  if (!manager || manager.__payuuRemoteFixV3) return;
  manager.__payuuRemoteFixV3 = true;

  const isIOS = () => {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };

  manager.requestScreenCapture = async function requestScreenCaptureFixed() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
      this.setStatus('SCREEN_UNAVAILABLE');
      return null;
    }
    try {
      this.setStatus('REQUESTING_SCREEN_CAPTURE');
      const mobile = isIOS() || /Android/i.test(navigator.userAgent || '');
      let screen;
      if (mobile) {
        // Mobile browsers are more reliable when display audio is not requested.
        // Microphone/audio is captured separately below.
        screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } else {
        try {
          screen = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30, max: 60 } },
            audio: true
          });
        } catch (e) {
          if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') throw e;
          screen = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30, max: 60 } },
            audio: false
          });
        }
      }
      const video = screen?.getVideoTracks?.()[0];
      if (!video) {
        screen?.getTracks?.().forEach(t => t.stop());
        this.setStatus('SCREEN_UNAVAILABLE');
        return null;
      }
      video.addEventListener('ended', () => this.setStatus('SCREEN_CAPTURE_ENDED'), { once: true });
      this.setStatus(`SCREEN_READY${screen.getAudioTracks().length ? '_WITH_AUDIO' : ''}`);
      return screen;
    } catch (e) {
      this.setStatus(`SCREEN_UNAVAILABLE_${String(e?.name || 'ERROR').toUpperCase()}`);
      return null;
    }
  };

  // Standard addTrack(track, stream) is intentionally used. It preserves the
  // originating MediaStream and lets the browser negotiate stable m-lines.
  manager.createPeer = async function createPeerFixed() {
    this.stopPeer(false);
    this.remoteScreenStream = new MediaStream();
    this.remoteCameraStream = new MediaStream();
    this.remoteAudioStream = new MediaStream();
    this.remoteTrackEvents = [];
    this.remoteStreamTypes = new Map();
    this.remoteTrackTypes = new Map();
    this.remoteMidTypes = new Map();

    const configured = Array.isArray(this.iceServers) && this.iceServers.length
      ? this.iceServers
      : [{ urls: 'stun:stun.l.google.com:19302' }];

    this.pc = new RTCPeerConnection({
      iceServers: configured,
      bundlePolicy: 'balanced',
      rtcpMuxPolicy: 'require'
    });

    this.pc.onconnectionstatechange = () => {
      const state = String(this.pc?.connectionState || 'closed').toUpperCase();
      this.setStatus(`WEBRTC_${state}`);
      if (state === 'FAILED') {
        this.onError?.(new Error('WebRTC connection failed. A TURN relay may be required on restrictive networks.'));
      }
      if (state === 'CLOSED' || state === 'FAILED') this.cleanupPoll();
    };

    this.pc.oniceconnectionstatechange = () => {
      this.setStatus(`ICE_${String(this.pc?.iceConnectionState || 'closed').toUpperCase()}`);
    };

    this.pc.ontrack = event => {
      this.remoteTrackEvents.push(event);
      this.rebuildRemoteStreams();
    };

    this.pc.ondatachannel = event => {
      if (event.channel.label !== 'payuu-media-meta') return;
      this.controlDataChannel = event.channel;
      event.channel.onmessage = e => {
        try {
          const data = JSON.parse(e.data);
          if (data?.type === 'payuu-media-meta') this.applyRemoteMediaMetadata(data);
        } catch (_) {}
      };
    };
  };

  // Augment the existing metadata sender with negotiated MIDs. This is called
  // after setLocalDescription() by the capture flow, so the sender transceivers
  // have their final MIDs available.
  const originalSendCaptureMetadata = manager.sendCaptureMetadata?.bind(manager);
  manager.sendCaptureMetadata = function sendCaptureMetadataFixed(meta) {
    const next = { ...(meta || {}) };
    const pc = this.pc;
    if (pc) {
      const transceivers = pc.getTransceivers?.() || [];
      const findMid = (trackIds, kind = 'video') => {
        for (const id of trackIds || []) {
          const sender = pc.getSenders?.().find(s => s.track?.id === id && s.track?.kind === kind);
          const t = transceivers.find(x => x.sender === sender);
          if (t?.mid != null) return t.mid;
        }
        return null;
      };
      next.screenMid = findMid(next.screenTrackIds, 'video');
      next.cameraMid = findMid(next.cameraTrackIds, 'video');
      next.audioMids = transceivers
        .filter(t => t.sender?.track?.kind === 'audio' && t.mid != null)
        .map(t => t.mid);
    }
    if (originalSendCaptureMetadata) return originalSendCaptureMetadata(next);
  };

  const originalApplyMetadata = manager.applyRemoteMediaMetadata?.bind(manager);
  manager.applyRemoteMediaMetadata = function applyRemoteMediaMetadataFixed(meta) {
    this.remoteMidTypes = this.remoteMidTypes || new Map();
    if (meta?.screenMid != null) this.remoteMidTypes.set(String(meta.screenMid), 'screen');
    if (meta?.cameraMid != null) this.remoteMidTypes.set(String(meta.cameraMid), 'camera');
    (meta?.screenTrackIds || []).forEach(id => this.remoteTrackTypes?.set(id, 'screen'));
    (meta?.cameraTrackIds || []).forEach(id => this.remoteTrackTypes?.set(id, 'camera'));
    if (originalApplyMetadata) {
      // Do not let the old metadata method make the classification decision;
      // rebuildRemoteStreams below uses the MID map first.
      try { originalApplyMetadata(meta); } catch (_) { this.rebuildRemoteStreams(); }
    } else {
      this.rebuildRemoteStreams();
    }
  };

  manager.rebuildRemoteStreams = function rebuildRemoteStreamsFixed() {
    const events = Array.isArray(this.remoteTrackEvents) ? this.remoteTrackEvents : [];
    const videos = events.filter(e => e?.track?.kind === 'video');
    const transceivers = this.pc?.getTransceivers?.() || [];

    this.remoteScreenStream = new MediaStream();
    this.remoteCameraStream = new MediaStream();
    this.remoteAudioStream = new MediaStream();

    const classify = (event, videoIndex) => {
      const track = event?.track;
      if (!track) return 'camera';

      const mid = event?.transceiver?.mid;
      if (mid != null) {
        const byMid = this.remoteMidTypes?.get(String(mid));
        if (byMid) return byMid;
      }

      for (const stream of event.streams || []) {
        const byStream = this.remoteStreamTypes?.get(stream.id);
        if (byStream) return byStream;
      }

      const byTrack = this.remoteTrackTypes?.get(track.id);
      if (byTrack) return byTrack;

      const index = transceivers.indexOf(event?.transceiver);
      const videoReceiverTransceivers = transceivers.filter(t => t.receiver?.track?.kind === 'video');
      const videoIndexByTransceiver = videoReceiverTransceivers.indexOf(event?.transceiver);
      if (videoIndexByTransceiver === 0 || index === 0) return 'screen';
      if (videoIndexByTransceiver === 1 || index === 1) return 'camera';

      const label = String(track.label || '').toLowerCase();
      if (/screen|display|window|tab|monitor|projection/.test(label)) return 'screen';
      if (/camera|front|back|facetime/.test(label)) return 'camera';

      // Final deterministic fallback: capture side adds screen video first.
      return videos.length >= 2 && videoIndex === 0 ? 'screen' : 'camera';
    };

    let videoIndex = 0;
    for (const event of events) {
      const track = event?.track;
      if (!track) continue;
      if (track.kind === 'audio') {
        this.remoteAudioStream.addTrack(track);
        continue;
      }
      const type = classify(event, videoIndex++);
      if (type === 'screen') this.remoteScreenStream.addTrack(track);
      else this.remoteCameraStream.addTrack(track);
    }
    this.publishRemoteStreams();
  };

  manager.publishRemoteStreams = function publishRemoteStreamsFixed() {
    const screenVideo = document.getElementById('rawScreenVideo');
    const cameraVideo = document.getElementById('rawCameraVideo');
    const screenTracks = this.remoteScreenStream?.getVideoTracks?.() || [];
    const cameraTracks = this.remoteCameraStream?.getVideoTracks?.() || [];
    const audioTracks = this.remoteAudioStream?.getAudioTracks?.() || [];

    const attachAndPlay = async (video, stream, label) => {
      if (!video || !stream?.getVideoTracks?.().length) return;
      video.pause?.();
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      const attempt = () => video.play().catch(() => {});
      attempt();
      video.addEventListener('loadedmetadata', attempt, { once: true });
      video.addEventListener('canplay', attempt, { once: true });
      video.addEventListener('playing', () => this.setStatus(`REMOTE_${label}_PLAYING`), { once: true });
    };

    if (screenTracks.length) {
      const screenStream = new MediaStream([screenTracks[0]]);
      attachAndPlay(screenVideo, screenStream, 'SCREEN');
      screenTracks[0].onunmute = () => attachAndPlay(screenVideo, screenStream, 'SCREEN');
      screenTracks[0].onended = () => this.setStatus('REMOTE_SCREEN_ENDED');
      const studio = window.payuuStudio;
      if (studio?.compositor) studio.compositor.isScreenActive = true;
      document.getElementById('sourceCardRemote')?.classList.remove('hidden');
      studio?.updatePlaceholderVisibility?.();

      // Keep the screen stream separate from camera. Audio is added only to the
      // program stream, never to the fullscreen video element.
      this.remoteStream = new MediaStream([screenTracks[0], ...audioTracks]);
      this.onRemoteStream?.(this.remoteStream);
    } else {
      this.setStatus('REMOTE_SCREEN_TRACK_MISSING');
    }

    if (cameraTracks.length) {
      const cameraStream = new MediaStream([cameraTracks[0]]);
      attachAndPlay(cameraVideo, cameraStream, 'CAMERA');
      cameraTracks[0].onunmute = () => attachAndPlay(cameraVideo, cameraStream, 'CAMERA');
      const studio = window.payuuStudio;
      if (studio?.compositor) {
        studio.compositor.isCameraActive = true;
        studio.compositor.cameraTransform.visible = true;
        studio.cameraBtnText && (studio.cameraBtnText.textContent = 'Remote Camera');
        studio.sourceCardCamera?.classList.remove('hidden');
        studio.updatePlaceholderVisibility?.();
      }
      this.onRemoteCamera?.(cameraStream);
    } else {
      this.setStatus('REMOTE_CAMERA_TRACK_MISSING');
    }

    if (audioTracks.length) {
      let audio = document.getElementById('remoteDeviceAudio');
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'remoteDeviceAudio';
        audio.autoplay = true;
        audio.playsInline = true;
        audio.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none;';
        document.body.appendChild(audio);
      }
      audio.srcObject = new MediaStream(audioTracks);
      audio.muted = false;
      audio.volume = 1;
      audio.play().catch(() => this.setStatus('REMOTE_AUDIO_PLAY_PENDING'));
      this.onRemoteAudio?.(this.remoteAudioStream);
    }

    const micButton = document.getElementById('btnRemoteMicToggle');
    if (micButton) {
      micButton.disabled = !audioTracks.length;
      micButton.classList.toggle('opacity-50', !audioTracks.length);
    }
  };

  manager.setRemoteMicrophoneEnabled = function setRemoteMicrophoneEnabledFixed(enabled) {
    const value = !!enabled;
    this.__remoteMicEnabled = value;
    this.remoteAudioStream?.getAudioTracks?.().forEach(track => { track.enabled = value; });
    if (this.controlDataChannel?.readyState === 'open') {
      this.controlDataChannel.send(JSON.stringify({
        type: 'payuu-capture-command',
        command: 'set-microphone',
        enabled: value
      }));
    }
    return value;
  };

  manager.isRemoteMicrophoneEnabled = function isRemoteMicrophoneEnabledFixed() {
    const tracks = this.remoteAudioStream?.getAudioTracks?.() || [];
    return tracks.length ? tracks.some(t => t.enabled) : this.__remoteMicEnabled !== false;
  };
}
