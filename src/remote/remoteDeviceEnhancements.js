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

  const originalRebuild = manager.rebuildRemoteStreams.bind(manager);
  manager.__payuuOriginalRebuild = originalRebuild;

  manager.rebuildRemoteStreams = function enhancedRebuildRemoteStreams() {
    const events = Array.isArray(this.remoteTrackEvents) ? this.remoteTrackEvents : [];
    const videos = events.filter(e => e?.track?.kind === 'video');
    const classify = (event, index) => {
      const track = event.track;
      const streamId = event.streams?.[0]?.id || '';
      const explicit = this.remoteTrackTypes?.get(track.id) || this.remoteStreamTypes?.get(streamId);
      if (explicit) return explicit;
      const label = String(track.label || '').toLowerCase();
      if (label.includes('screen') || label.includes('display') || label.includes('projection')) return 'screen';
      if (label.includes('camera') || label.includes('front') || label.includes('back')) return 'camera';
      if (videos.length >= 2) return index === 0 ? 'screen' : 'camera';
      return 'screen';
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
      this.controlDataChannel.send(JSON.stringify({ type: 'payuu-capture-command', command: 'set-microphone', enabled: value }));
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
      button.innerHTML = next ? '<i class="fa-solid fa-microphone mr-1"></i>Remote Mic ON' : '<i class="fa-solid fa-microphone-slash mr-1"></i>Remote Mic OFF';
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
      button.title = hasAudio ? 'Mute/unmute remote microphone/audio' : 'No remote microphone/audio track connected';
    }
    addMicControl();
  };
}
