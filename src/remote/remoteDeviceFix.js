// Payuu remote capture compatibility layer.
// Uses the standard WebRTC addTrack(track, stream) path for reliable
// screen/camera separation across Chrome, Edge, Firefox, Safari, Android,
// iPhone/iPad and Windows.

export function installRemoteDeviceFix(studio) {
  const manager = studio?.remoteDeviceManager;
  if (!manager || manager.__payuuRemoteFixV2) return;
  manager.__payuuRemoteFixV2 = true;

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
        // iOS/iPadOS/Android are stricter about display-audio constraints.
        // Microphone is captured separately with getUserMedia().
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
      const name = String(e?.name || 'ERROR').toUpperCase();
      this.setStatus(`SCREEN_UNAVAILABLE_${name}`);
      return null;
    }
  };

  // Use the standard addTrack(stream) path. The old transceiver wrapper could
  // make the screen/camera m-lines fragile across Safari and Chromium.
  manager.createPeer = async function createPeerFixed() {
    this.stopPeer(false);
    this.remoteScreenStream = new MediaStream();
    this.remoteCameraStream = new MediaStream();
    this.remoteAudioStream = new MediaStream();
    this.remoteTrackEvents = [];
    this.remoteStreamTypes = new Map();
    this.remoteTrackTypes = new Map();

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
        this.onError?.(new Error('WebRTC connection failed. A reachable STUN/TURN server is required on restrictive networks.'));
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

  manager.rebuildRemoteStreams = function rebuildRemoteStreamsFixed() {
    const events = Array.isArray(this.remoteTrackEvents) ? this.remoteTrackEvents : [];
    const videos = events.filter(e => e?.track?.kind === 'video');
    const videoTransceivers = (this.pc?.getTransceivers?.() || [])
      .filter(t => t?.receiver?.track?.kind === 'video');

    this.remoteScreenStream = new MediaStream();
    this.remoteCameraStream = new MediaStream();
    this.remoteAudioStream = new MediaStream();

    const classify = (event, videoIndex) => {
      const track = event?.track;
      if (!track) return 'camera';

      for (const stream of event.streams || []) {
        const known = this.remoteStreamTypes?.get(stream.id);
        if (known) return known;
      }

      const knownTrack = this.remoteTrackTypes?.get(track.id);
      if (knownTrack) return knownTrack;

      const transceiverIndex = videoTransceivers.indexOf(event.transceiver);
      if (transceiverIndex === 0) return 'screen';
      if (transceiverIndex === 1) return 'camera';

      const label = String(track.label || '').toLowerCase();
      if (/screen|display|window|tab|monitor|projection/.test(label)) return 'screen';
      if (/camera|front|back|facetime/.test(label)) return 'camera';

      // Capture side always adds screen before camera.
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

    const playVideo = async (video, label) => {
      if (!video) return;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      try { await video.play(); } catch (_) {}
      const retry = () => video.play().catch(() => {});
      video.addEventListener('loadedmetadata', retry, { once: true });
      video.addEventListener('canplay', retry, { once: true });
      video.addEventListener('playing', () => this.setStatus(`REMOTE_${label}_PLAYING`), { once: true });
    };

    if (screenVideo && screenTracks.length) {
      // Dedicated stream: the compositor can never accidentally draw camera
      // frames as the fullscreen screen layer.
      screenVideo.srcObject = new MediaStream([screenTracks[0]]);
      playVideo(screenVideo, 'SCREEN');
      screenTracks[0].onunmute = () => playVideo(screenVideo, 'SCREEN');
      screenTracks[0].onended = () => this.setStatus('REMOTE_SCREEN_ENDED');

      const studio = window.payuuStudio;
      if (studio?.compositor) studio.compositor.isScreenActive = true;
      document.getElementById('sourceCardRemote')?.classList.remove('hidden');
      studio?.updatePlaceholderVisibility?.();
    }

    if (cameraVideo && cameraTracks.length) {
      cameraVideo.srcObject = new MediaStream([cameraTracks[0]]);
      playVideo(cameraVideo, 'CAMERA');
      cameraTracks[0].onunmute = () => playVideo(cameraVideo, 'CAMERA');

      const studio = window.payuuStudio;
      if (studio?.compositor) {
        studio.compositor.isCameraActive = true;
        studio.compositor.cameraTransform.visible = true;
        studio.cameraBtnText && (studio.cameraBtnText.textContent = 'Remote Camera');
        studio.sourceCardCamera?.classList.remove('hidden');
        studio.updatePlaceholderVisibility?.();
      }
      this.onRemoteCamera?.(new MediaStream([cameraTracks[0]]));
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
      audio.play().catch(() => {});
      this.onRemoteAudio?.(this.remoteAudioStream);
    }

    if (screenTracks.length) {
      const program = new MediaStream([screenTracks[0], ...audioTracks]);
      this.remoteStream = program;
      this.onRemoteStream?.(program);
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
