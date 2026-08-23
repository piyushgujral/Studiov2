/**
 * Remote-device reliability enhancements.
 * Keeps the existing signaling/WebRTC implementation intact while making
 * remote video routing resilient when RTCTrackEvent.streams is empty or
 * sender track IDs are rewritten by the browser.
 */
export function setupRemoteDeviceEnhancements(studio) {
  const manager = studio?.remoteDeviceManager;
  if (!manager || manager.__payuuEnhanced) return;
  manager.__payuuEnhanced = true;

  // Mobile browsers are much stricter about getDisplayMedia constraints.
  // Request a plain video-only display capture on phones/tablets; camera and
  // microphone are captured separately through getUserMedia(). This also
  // avoids iOS/WebKit rejecting a display request that asks for system audio.
  const originalRequestScreenCapture = manager.requestScreenCapture.bind(manager);
  manager.requestScreenCapture = async function enhancedRequestScreenCapture() {
    const ua = navigator.userAgent || '';
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isMobile) return originalRequestScreenCapture();

    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.setStatus('SCREEN_UNAVAILABLE_MOBILE_BROWSER');
      return null;
    }

    try {
      this.setStatus('REQUESTING_MOBILE_SCREEN_CAPTURE');
      // Keep this call directly reachable from the user's tap/click path.
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (!screen?.getVideoTracks?.().length) {
        screen?.getTracks?.().forEach(track => track.stop());
        this.setStatus('SCREEN_UNAVAILABLE');
        return null;
      }
      const track = screen.getVideoTracks()[0];
      track.addEventListener('ended', () => this.setStatus('SCREEN_CAPTURE_ENDED'), { once: true });
      this.setStatus('SCREEN_READY_MOBILE');
      return screen;
    } catch (e) {
      const name = String(e?.name || 'ERROR').toUpperCase();
      this.setStatus(`SCREEN_UNAVAILABLE_MOBILE_${name}`);
      return null;
    }
  };

  // Capture-side fix: do NOT pre-create generic video transceivers and then
  // call addTrack(). Browsers are allowed to reuse compatible transceivers,
  // which made the screen/camera m-lines nondeterministic. Instead, whenever
  // the capture side adds a video track, create the transceiver with that
  // exact track and stream association. This guarantees:
  //   video m-line #1 = screen
  //   video m-line #2 = camera
  const originalCreatePeer = manager.createPeer.bind(manager);
  manager.createPeer = async function enhancedCreatePeer() {
    await originalCreatePeer();
    if (this.role !== 'capture' || !this.pc) return;

    const pc = this.pc;
    const nativeAddTrack = pc.addTrack.bind(pc);
    let videoTrackIndex = 0;

    pc.__payuuNativeAddTrack = nativeAddTrack;
    pc.__payuuCaptureVideoTransceivers = [];

    pc.addTrack = (track, ...streams) => {
      if (track?.kind !== 'video') return nativeAddTrack(track, ...streams);

      const transceiver = pc.addTransceiver(track, {
        direction: 'sendonly',
        streams
      });
      transceiver.__payuuVideoRole = videoTrackIndex++ === 0 ? 'screen' : 'camera';
      pc.__payuuCaptureVideoTransceivers.push(transceiver);
      return transceiver.sender;
    };
  };

  const originalRebuild = manager.rebuildRemoteStreams.bind(manager);
  manager.__payuuOriginalRebuild = originalRebuild;

  manager.rebuildRemoteStreams = function enhancedRebuildRemoteStreams() {
    const events = Array.isArray(this.remoteTrackEvents) ? this.remoteTrackEvents : [];
    const videos = events.filter(e => e?.track?.kind === 'video');

    // Prefer the explicit stream/track metadata. If the browser rewrites
    // track IDs, fall back to the receiving transceiver's video order rather
    // than the order in which packets happened to arrive.
    const videoTransceivers = (this.pc?.getTransceivers?.() || [])
      .filter(t => t?.receiver?.track?.kind === 'video');

    const classify = (event, eventVideoIndex) => {
      const track = event?.track;
      if (!track) return 'camera';
      const streamId = event.streams?.[0]?.id || '';
      const explicit = this.remoteTrackTypes?.get(track.id) || this.remoteStreamTypes?.get(streamId);
      if (explicit) return explicit;

      const label = String(track.label || '').toLowerCase();
      if (label.includes('screen') || label.includes('display') || label.includes('projection')) return 'screen';
      if (label.includes('camera') || label.includes('front') || label.includes('back')) return 'camera';

      const transceiverIndex = videoTransceivers.indexOf(event?.transceiver);
      if (transceiverIndex === 0) return 'screen';
      if (transceiverIndex === 1) return 'camera';

      // Last-resort fallback when the browser does not expose the transceiver
      // on the event. This is intentionally based on video order only.
      if (videos.length >= 2) return eventVideoIndex === 0 ? 'screen' : 'camera';
      return 'camera';
    };

    this.remoteScreenStream = new MediaStream();
    this.remoteCameraStream = new MediaStream();
    this.remoteAudioStream = new MediaStream();

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

  manager.setRemoteMicrophoneEnabled = function(enabled) {
    const value = !!enabled;
    const tracks = this.remoteAudioStream?.getAudioTracks?.() || [];
    tracks.forEach(track => { track.enabled = value; });
    this.__remoteMicEnabled = value;
    if (this.controlDataChannel?.readyState === 'open') {
      this.controlDataChannel.send(JSON.stringify({
        type: 'payuu-capture-command',
        command: 'set-microphone',
        enabled: value
      }));
    }
    return value;
  };

  manager.isRemoteMicrophoneEnabled = function() {
    const tracks = this.remoteAudioStream?.getAudioTracks?.() || [];
    return tracks.length ? tracks.some(track => track.enabled) : this.__remoteMicEnabled !== false;
  };

  const addMicControl = () => {
    if (document.getElementById('btnRemoteMicToggle')) return;
    const candidates = [...document.querySelectorAll('button')];
    const mixerHeading = candidates.find(el => el.textContent?.trim() === 'Enable Mic Meter');
    if (!mixerHeading) return;

    const button = document.createElement('button');
    button.id = 'btnRemoteMicToggle';
    button.type = 'button';
    button.className = 'ml-2 px-2 py-1 text-[10px] font-semibold rounded border border-brand-border bg-gray-800 text-emerald-300 hover:bg-gray-700 transition';
    button.innerHTML = '<i class="fa-solid fa-microphone mr-1"></i>Remote Mic ON';
    button.title = 'Mute/unmute the remote device microphone/audio';
    button.addEventListener('click', () => {
      const next = !manager.isRemoteMicrophoneEnabled();
      manager.setRemoteMicrophoneEnabled(next);
      button.innerHTML = next
        ? '<i class="fa-solid fa-microphone mr-1"></i>Remote Mic ON'
        : '<i class="fa-solid fa-microphone-slash mr-1"></i>Remote Mic OFF';
      button.classList.toggle('text-emerald-300', next);
      button.classList.toggle('text-red-300', !next);
    });
    mixerHeading.insertAdjacentElement('afterend', button);
  };

  addMicControl();
  setTimeout(addMicControl, 500);
  setTimeout(addMicControl, 1500);

  const originalPublish = manager.publishRemoteStreams.bind(manager);
  manager.publishRemoteStreams = function enhancedPublishRemoteStreams() {
    originalPublish();

    const hasScreen = !!this.remoteScreenStream?.getVideoTracks?.().length;
    const hasAudio = !!this.remoteAudioStream?.getAudioTracks?.().length;

    if (hasScreen) {
      const screenVideo = document.getElementById('rawScreenVideo');
      if (screenVideo) {
        screenVideo.muted = true;
        screenVideo.autoplay = true;
        screenVideo.playsInline = true;
        screenVideo.setAttribute('playsinline', '');

        const forcePlay = () => screenVideo.play().catch(() => {});
        screenVideo.addEventListener('loadedmetadata', forcePlay, { once: true });
        screenVideo.addEventListener('canplay', forcePlay, { once: true });

        this.remoteScreenStream.getVideoTracks().forEach(track => {
          track.onunmute = forcePlay;
          track.onended = () => this.setStatus('REMOTE_SCREEN_ENDED');
        });
      }

      if (studio.compositor) studio.compositor.isScreenActive = true;
      const screenCard = document.getElementById('sourceCardRemote');
      screenCard?.classList.remove('hidden');
      studio.updatePlaceholderVisibility?.();
    }

    const button = document.getElementById('btnRemoteMicToggle');
    if (button) {
      button.disabled = !hasAudio;
      button.classList.toggle('opacity-50', !hasAudio);
      button.title = hasAudio
        ? 'Mute/unmute remote microphone/audio'
        : 'No remote microphone/audio track connected';
    }
    addMicControl();
  };
}
