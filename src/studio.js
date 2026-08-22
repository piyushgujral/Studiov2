/**
 * Studio Controller: Orchestrates state, capture, multi-destinations, and real WHIP pipeline.
 */
import { CameraCapture } from './capture/camera.js';
import { ScreenCapture } from './capture/screen.js';
import { AudioPipeline } from './capture/audio.js';
import { SceneManager } from './scenes/sceneManager.js';
import { OverlayManager } from './overlays/overlayManager.js';
import { ChatManager } from './chat/chatManager.js';
import { SuperChatManager } from './superchat/superChatManager.js';
import { CanvasCompositor } from './compositor.js';
import { DestinationManager } from './streaming/destinationManager.js';
import { QualitySettingsManager } from './streaming/qualitySettings.js';
import { StreamingEngine } from './streaming/streamingEngine.js';
import { RemoteDeviceManager } from './remote/remoteDeviceManager.js';

export class PayuuStudio {
  constructor() {
    this.rawCameraVideo = document.getElementById('rawCameraVideo');
    this.rawScreenVideo = document.getElementById('rawScreenVideo');
    this.remoteDeviceVideo = document.getElementById('remoteDeviceVideo');
    this.canvas = document.getElementById('studioCanvas');

    // Subsystems
    this.cameraCapture = new CameraCapture(this.rawCameraVideo);
    this.screenCapture = new ScreenCapture(this.rawScreenVideo);
    this.audioPipeline = new AudioPipeline();
    this.sceneManager = new SceneManager();
    this.overlayManager = new OverlayManager();
    this.chatManager = new ChatManager();
    this.superChatManager = new SuperChatManager();
    this.destinationManager = new DestinationManager();
    this.qualitySettings = new QualitySettingsManager();

    this.compositor = new CanvasCompositor(
      this.canvas,
      this.rawCameraVideo,
      this.rawScreenVideo
    );

    this.remoteDeviceManager = new RemoteDeviceManager({ remoteVideo: this.remoteDeviceVideo });

    this.streamingEngine = new StreamingEngine(
      this.destinationManager,
      this.qualitySettings,
      this.compositor,
      this.audioPipeline,
      this.screenCapture
    );

    this.init();
  }

  init() {
    this.bindDomElements();
    this.checkEnvironmentDiagnostics();
    this.setupDeviceCapabilities();
    this.setupCompositorState();
    this.setupCaptureCallbacks();
    this.setupSceneUI();
    this.setupOverlayUI();
    this.setupChatUI();
    this.setupSuperChatUI();
    this.setupAudioUI();
    this.setupDestinationsUI();
    this.setupStreamingEngineUI();
    this.setupSettingsModal();
    this.setupResponsiveTabs();
    this.setupDevStatusModal();
    this.setupRemoteDeviceMode();
  }


  setupDeviceCapabilities() {
    const hint = document.getElementById('remoteCapabilityHint');
    if (!hint) return;
    const ua = navigator.userAgent || '';
    const isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const secure = window.isSecureContext;
    const screenAPI = !!navigator.mediaDevices?.getDisplayMedia;
    if (!secure) {
      hint.textContent = 'Use HTTPS (or localhost during development). Camera and screen capture are blocked in insecure contexts.';
      return;
    }
    if (isiOS) {
      hint.innerHTML = screenAPI
        ? '<b class="text-emerald-300">iOS browser screen capture API detected.</b> Device/game capture still depends on the installed iOS version/browser. For reliable background/full-device capture, use the native Payuu Capture app.'
        : '<b class="text-amber-300">iOS browser screen capture is unavailable here.</b> Do not treat this as a failed stream. Use the native Payuu Capture app for reliable iPhone/iPad full-device/game capture.';
    } else if (isAndroid) {
      hint.textContent = screenAPI ? 'Android browser screen capture is available. Keep the capture page active while streaming.' : 'This Android browser does not expose screen capture. Use a supported browser or the future native Payuu Capture app.';
    } else {
      hint.textContent = screenAPI ? 'Desktop screen capture is available in this browser.' : 'This browser does not expose screen capture.';
    }
  }
  checkEnvironmentDiagnostics() {
    const isFileProto = window.location.protocol === 'file:';
    const isSecure = window.isSecureContext;
    const hasMediaDevices = !!navigator.mediaDevices;
    const hasGetUserMedia = !!(hasMediaDevices && navigator.mediaDevices.getUserMedia);
    const hasGetDisplayMedia = !!(hasMediaDevices && navigator.mediaDevices.getDisplayMedia);

    if (isFileProto) {
      this.showToast(
        'Critical: Application opened via file://. Run through local HTTP server or Vite for media permissions.',
        'error',
        10000
      );
    }

    const diagProto = document.getElementById('diagProto');
    const diagHost = document.getElementById('diagHost');
    const diagSecure = document.getElementById('diagSecure');
    const diagCameraApi = document.getElementById('diagCameraApi');
    const diagScreenApi = document.getElementById('diagScreenApi');

    if (diagProto) diagProto.textContent = window.location.protocol;
    if (diagHost) diagHost.textContent = window.location.host || 'local file';
    if (diagSecure) diagSecure.textContent = isSecure ? 'YES' : 'NO (RESTRICTED)';
    if (diagCameraApi) diagCameraApi.textContent = hasGetUserMedia ? 'AVAILABLE' : 'UNAVAILABLE';
    if (diagScreenApi) diagScreenApi.textContent = hasGetDisplayMedia ? 'AVAILABLE' : 'UNAVAILABLE';
  }

  bindDomElements() {
    this.btnToggleCamera = document.getElementById('btnToggleCamera');
    this.btnToggleScreen = document.getElementById('btnToggleScreen');
    this.cameraBtnText = document.getElementById('cameraBtnText');
    this.screenBtnText = document.getElementById('screenBtnText');
    this.sourceCardCamera = document.getElementById('sourceCardCamera');
    this.sourceCardScreen = document.getElementById('sourceCardScreen');
    this.btnLockCamera = document.getElementById('btnLockCamera');
    this.btnHideCamera = document.getElementById('btnHideCamera');
    this.btnHideScreen = document.getElementById('btnHideScreen');
    this.camCoordsText = document.getElementById('camCoordsText');
    this.btnResetCamPos = document.getElementById('btnResetCamPos');
    this.toastNotification = document.getElementById('toastNotification');
    this.toastMessage = document.getElementById('toastMessage');
    this.toastAction = document.getElementById('toastAction');
    this.noSourceOverlay = document.getElementById('noSourceOverlay');

    // Camera Action
    this.btnToggleCamera.addEventListener('click', async () => {
      if (!this.cameraCapture.isActive) {
        try {
          this.cameraBtnText.textContent = 'Requesting...';
          await this.cameraCapture.enable();
        } catch (err) {
          console.error('Camera Enable Error:', err);
          this.showToast(err.message, 'error', 6000, () => {
            this.btnToggleCamera.click();
          });
        }
      } else {
        this.cameraCapture.disable();
      }
    });

    // Screen Share Action
    this.btnToggleScreen.addEventListener('click', async () => {
      if (!this.screenCapture.isActive) {
        try {
          this.screenBtnText.textContent = 'Selecting...';
          await this.screenCapture.start();
        } catch (err) {
          console.error('Screen Share Error:', err);
          this.showToast(err.message, 'error', 6000, () => {
            this.btnToggleScreen.click();
          });
        }
      } else {
        this.screenCapture.stop();
      }
    });

    // Camera Lock Toggle
    this.btnLockCamera.addEventListener('click', () => {
      const cam = this.compositor.cameraTransform;
      cam.locked = !cam.locked;
      this.btnLockCamera.innerHTML = cam.locked
        ? '<i class="fa-solid fa-lock text-amber-400"></i>'
        : '<i class="fa-solid fa-unlock"></i>';
    });

    // Camera Visibility Toggle
    this.btnHideCamera.addEventListener('click', () => {
      const cam = this.compositor.cameraTransform;
      cam.visible = !cam.visible;
      this.btnHideCamera.innerHTML = cam.visible
        ? '<i class="fa-solid fa-eye"></i>'
        : '<i class="fa-solid fa-eye-slash text-red-400"></i>';
    });

    // Screen Visibility Toggle
    this.btnHideScreen.addEventListener('click', () => {
      this.compositor.isScreenVisible = !this.compositor.isScreenVisible;
      this.btnHideScreen.innerHTML = this.compositor.isScreenVisible
        ? '<i class="fa-solid fa-eye"></i>'
        : '<i class="fa-solid fa-eye-slash text-red-400"></i>';
    });

    // Reset Camera PIP
    this.btnResetCamPos.addEventListener('click', () => {
      this.compositor.resetCameraPIP();
    });

    this.compositor.onTransformChange = (cam) => {
      this.camCoordsText.textContent = `${Math.round(cam.x)}, ${Math.round(cam.y)} (${Math.round(cam.width)}×${Math.round(cam.height)})`;
    };
  }

  setupRemoteDeviceMode() {
    const modal = document.getElementById('remoteDeviceModal');
    const openBtn = document.getElementById('btnRemoteDevice');
    const closeBtn = document.getElementById('btnCloseRemoteDevice');
    const createBtn = document.getElementById('btnCreateRemoteSession');
    const pairResult = document.getElementById('remotePairResult');
    const pairCode = document.getElementById('remotePairCode');
    const joinUrl = document.getElementById('remoteJoinUrl');
    const pairStatus = document.getElementById('remotePairStatus');
    const controlPanel = document.getElementById('remoteControlPanel');
    const capturePanel = document.getElementById('remoteCapturePanel');
    const startCaptureBtn = document.getElementById('btnStartRemoteCapture');
    const captureStatus = document.getElementById('remoteCaptureStatus');
    const captureBanner = document.getElementById('captureModeBanner');
    const captureBannerCode = document.getElementById('captureModeCode');
    const captureBannerStart = document.getElementById('btnCaptureModeStart');
    const captureBannerStatus = document.getElementById('captureModeStatus');

    const isCaptureMode = this.remoteDeviceManager.role === 'capture';
    if (isCaptureMode) {
      document.body.classList.add('payuu-capture-mode');
      captureBanner?.classList.remove('hidden');
      if (captureBannerCode) captureBannerCode.textContent = this.remoteDeviceManager.code || '------';
      controlPanel?.classList.add('hidden');
      capturePanel?.classList.remove('hidden');
      openBtn?.classList.add('hidden');
      const start = async () => {
        try {
          if (captureBannerStatus) captureBannerStatus.textContent = 'REQUESTING SCREEN + MICROPHONE…';
          if (captureStatus) captureStatus.textContent = 'REQUESTING PERMISSIONS…';
          const result = await this.remoteDeviceManager.joinCaptureSession();
          const msg = result.hasScreen ? `SCREEN + ${result.hasAudio ? 'AUDIO' : 'NO AUDIO'}` : 'SCREEN CAPTURE UNAVAILABLE';
          if (captureBannerStatus) captureBannerStatus.textContent = `${msg} • CONNECTING TO IPAD…`;
          if (captureStatus) captureStatus.textContent = `${msg} • CONNECTING…`;
        } catch (err) {
          if (captureBannerStatus) captureBannerStatus.textContent = err.message;
          if (captureStatus) captureStatus.textContent = err.message;
        }
      };
      captureBannerStart?.addEventListener('click', start);
      startCaptureBtn?.addEventListener('click', start);
      this.remoteDeviceManager.onStatus = (status) => {
        if (captureBannerStatus) captureBannerStatus.textContent = status;
        if (captureStatus) captureStatus.textContent = status;
      };
      return;
    }

    openBtn?.addEventListener('click', () => modal?.classList.remove('hidden'));
    closeBtn?.addEventListener('click', () => modal?.classList.add('hidden'));
    createBtn?.addEventListener('click', async () => {
      try {
        createBtn.disabled = true;
        createBtn.textContent = 'Creating…';
        const data = await this.remoteDeviceManager.createControlSession();
        pairResult?.classList.remove('hidden');
        if (pairCode) pairCode.textContent = data.code;
        if (joinUrl) joinUrl.value = `${location.origin}${location.pathname}?mode=capture&session=${encodeURIComponent(data.sessionId)}&code=${encodeURIComponent(data.code)}`;
        if (pairStatus) pairStatus.textContent = 'WAITING FOR IPHONE…';
      } catch (err) {
        this.showToast(err.message, 'error', 6000);
      } finally {
        createBtn.disabled = false;
        createBtn.innerHTML = '<i class="fa-solid fa-link mr-1"></i>Create iPhone Pairing Session';
      }
    });

    this.remoteDeviceManager.onCode = (data) => {
      pairResult?.classList.remove('hidden');
      if (pairCode) pairCode.textContent = data.code;
      if (joinUrl) joinUrl.value = `${location.origin}${location.pathname}?mode=capture&session=${encodeURIComponent(data.sessionId)}&code=${encodeURIComponent(data.code)}`;
    };

    this.remoteDeviceManager.onStatus = (status) => {
      if (pairStatus) pairStatus.textContent = status;
      const sourceStatus = document.getElementById('remoteSourceStatus');
      if (sourceStatus) sourceStatus.textContent = status;
    };

    this.remoteDeviceManager.onRemoteStream = (stream) => {
      this.screenCapture.attachRemoteStream(stream);
      const card = document.getElementById('sourceCardRemote');
      if (card) card.classList.remove('hidden');
      const screenBtnText = document.getElementById('screenBtnText');
      if (screenBtnText) screenBtnText.textContent = 'iPhone Connected';
      const sourceStatus = document.getElementById('remoteSourceStatus');
      if (sourceStatus) sourceStatus.textContent = stream.getAudioTracks().length ? 'SCREEN + AUDIO' : 'SCREEN';
    };

    this.remoteDeviceManager.onError = (err) => {
      console.warn('[Payuu Remote Device]', err);
      if (pairStatus && !isCaptureMode) pairStatus.textContent = err.message || 'SIGNALING ERROR';
    };
  }

  setupCompositorState() {
    this.compositor.activeScene = this.sceneManager.getActiveScene();
    this.compositor.activeOverlay = this.overlayManager.getActiveOverlay();
  }

  setupCaptureCallbacks() {
    const diagCamStatus = document.getElementById('diagCamStatus');
    const diagScreenStatus = document.getElementById('diagScreenStatus');

    this.cameraCapture.onStatusChange = (isActive) => {
      this.compositor.isCameraActive = isActive;
      this.cameraBtnText.textContent = isActive ? 'Disable Camera' : 'Enable Camera';
      this.btnToggleCamera.classList.toggle('bg-indigo-900', isActive);
      this.btnToggleCamera.classList.toggle('bg-gray-800', !isActive);
      this.sourceCardCamera.classList.toggle('hidden', !isActive);

      if (diagCamStatus) {
        diagCamStatus.textContent = isActive ? 'ACTIVE (STREAMING TO CANVAS)' : 'INACTIVE';
        diagCamStatus.className = isActive ? 'text-emerald-400 font-mono font-bold' : 'text-gray-400 font-mono';
      }
      this.updatePlaceholderVisibility();
    };

    this.screenCapture.onStatusChange = (isActive, stream, hasAudio, isRemote) => {
      this.compositor.isScreenActive = isActive;
      this.screenBtnText.textContent = isActive ? (isRemote ? 'iPhone Connected' : 'Stop Sharing') : 'Share Screen';
      this.btnToggleScreen.classList.toggle('bg-emerald-900', isActive);
      this.btnToggleScreen.classList.toggle('bg-gray-800', !isActive);
      this.sourceCardScreen.classList.toggle('hidden', !isActive || !!isRemote);
      const remoteCard = document.getElementById('sourceCardRemote');
      if (remoteCard) remoteCard.classList.toggle('hidden', !isActive || !isRemote);

      const sysAudioStatus = document.getElementById('sysAudioStatusText');
      if (isActive && hasAudio) {
        sysAudioStatus.textContent = isRemote ? 'Active (iPhone)' : 'Active (Display)';
        sysAudioStatus.classList.replace('text-gray-500', 'text-emerald-400');
      } else {
        sysAudioStatus.textContent = 'Not Available';
        sysAudioStatus.classList.replace('text-emerald-400', 'text-gray-500');
      }

      if (diagScreenStatus) {
        diagScreenStatus.textContent = isActive ? (isRemote ? 'ACTIVE (IPHONE REMOTE)' : 'ACTIVE (DISPLAY CAPTURE)') : 'INACTIVE';
        diagScreenStatus.className = isActive ? 'text-emerald-400 font-mono font-bold' : 'text-gray-400 font-mono';
      }
      this.updatePlaceholderVisibility();
    };
  }

  updatePlaceholderVisibility() {
    const scene = this.sceneManager.getActiveScene();
    const hasActiveSource =
      (scene.sources.showCamera && this.cameraCapture.isActive) ||
      (scene.sources.showScreen && this.screenCapture.isActive) ||
      scene.sources.showText;

    this.noSourceOverlay.classList.toggle('hidden', hasActiveSource);
  }

  setupDestinationsUI() {
    const footerDestList = document.getElementById('footerDestinationList');
    const settingsDestList = document.getElementById('settingsDestinationsList');

    const render = () => {
      const destinations = this.destinationManager.getDestinations();

      if (footerDestList) {
        footerDestList.innerHTML = '';
        destinations.forEach((dest) => {
          const row = document.createElement('div');
          row.className = 'flex justify-between items-center text-xs';

          let statusBadge = '<span class="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">OFF</span>';
          if (dest.enabled) {
            if (dest.status === 'ready') {
              statusBadge = '<span class="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1.5 py-0.5 rounded">READY</span>';
            } else if (dest.status === 'connecting') {
              statusBadge = '<span class="text-[10px] text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded animate-pulse">CONNECTING</span>';
            } else if (dest.status === 'live') {
              statusBadge = '<span class="text-[10px] text-white bg-red-600 font-bold px-1.5 py-0.5 rounded">LIVE</span>';
            } else if (dest.status === 'error') {
              statusBadge = '<span class="text-[10px] text-red-400 bg-red-950 px-1.5 py-0.5 rounded">ERROR</span>';
            } else {
              statusBadge = '<span class="text-[10px] text-amber-300 bg-amber-950/40 px-1.5 py-0.5 rounded">CONFIGURED</span>';
            }
          }

          row.innerHTML = `
            <span class="text-gray-300 flex items-center space-x-1.5">
              <span class="w-1.5 h-1.5 rounded-full ${dest.enabled ? 'bg-indigo-400' : 'bg-gray-600'}"></span>
              <span class="truncate max-w-[100px]">${dest.name}:</span>
            </span>
            ${statusBadge}
          `;
          footerDestList.appendChild(row);
        });
      }

      if (settingsDestList) {
        settingsDestList.innerHTML = '';
        destinations.forEach((dest) => {
          const card = document.createElement('div');
          card.className = 'p-3 bg-black/40 rounded border border-brand-border space-y-2';
          card.innerHTML = `
            <div class="flex justify-between items-center">
              <div class="flex items-center space-x-2">
                <input type="checkbox" id="enable_${dest.id}" ${dest.enabled ? 'checked' : ''} class="accent-indigo-500 rounded cursor-pointer" />
                <label for="enable_${dest.id}" class="text-xs font-bold text-white cursor-pointer">${dest.name}</label>
                <span class="text-[10px] px-1 rounded bg-gray-800 text-gray-400 uppercase font-mono">${dest.type}</span>
              </div>
              ${dest.isCustom ? `<button data-remove="${dest.id}" class="text-red-400 hover:text-red-300 text-xs"><i class="fa-solid fa-trash"></i></button>` : ''}
            </div>

            <div class="space-y-1.5 text-xs">
              <div>
                <label class="text-[10px] text-gray-400 uppercase tracking-wider block">Server URL</label>
                <input type="text" id="url_${dest.id}" value="${dest.serverUrl}" placeholder="rtmp://..." class="w-full bg-gray-900 border border-brand-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 font-mono" />
              </div>
              <div>
                <label class="text-[10px] text-gray-400 uppercase tracking-wider block">Stream Key</label>
                <div class="flex space-x-1">
                  <input type="password" id="key_${dest.id}" value="${dest.streamKey}" placeholder="Paste stream key here..." class="flex-1 bg-gray-900 border border-brand-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 font-mono" />
                  <button type="button" data-toggle-key="${dest.id}" class="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 text-xs"><i class="fa-solid fa-eye"></i></button>
                </div>
              </div>
            </div>
          `;

          const enableCheckbox = card.querySelector(`#enable_${dest.id}`);
          const urlInput = card.querySelector(`#url_${dest.id}`);
          const keyInput = card.querySelector(`#key_${dest.id}`);
          const toggleKeyBtn = card.querySelector(`[data-toggle-key="${dest.id}"]`);
          const removeBtn = card.querySelector(`[data-remove="${dest.id}"]`);

          enableCheckbox.addEventListener('change', (e) => {
            this.destinationManager.updateDestination(dest.id, { enabled: e.target.checked });
          });

          urlInput.addEventListener('change', (e) => {
            this.destinationManager.updateDestination(dest.id, { serverUrl: e.target.value });
          });

          keyInput.addEventListener('change', (e) => {
            this.destinationManager.updateDestination(dest.id, { streamKey: e.target.value });
          });

          toggleKeyBtn.addEventListener('click', () => {
            const isPass = keyInput.type === 'password';
            keyInput.type = isPass ? 'text' : 'password';
            toggleKeyBtn.innerHTML = isPass ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
          });

          if (removeBtn) {
            removeBtn.addEventListener('click', () => {
              this.destinationManager.removeDestination(dest.id);
            });
          }

          settingsDestList.appendChild(card);
        });
      }
    };

    this.destinationManager.onDestinationsChange = () => render();
    render();

    const btnAddCustom = document.getElementById('btnAddCustomDest');
    if (btnAddCustom) {
      btnAddCustom.addEventListener('click', () => {
        const name = prompt('Enter Destination Name (e.g. Trovo, Facebook Live):');
        if (!name) return;
        const serverUrl = prompt('Enter RTMP / RTMPS Server URL:');
        if (!serverUrl) return;
        const streamKey = prompt('Enter Stream Key:');
        this.destinationManager.addCustomDestination(name, serverUrl, streamKey || '');
      });
    }
  }

  setupStreamingEngineUI() {
    const btnToggleStream = document.getElementById('btnToggleStream');
    const streamLabel = document.getElementById('streamLabel');
    const streamIndicator = document.getElementById('streamIndicator');
    const streamStatusText = document.getElementById('streamStatusText');

    btnToggleStream.addEventListener('click', async () => {
      const currentStatus = this.streamingEngine.getStatus();

      if (currentStatus === 'PREVIEW' || currentStatus === 'ENDED' || currentStatus === 'ERROR') {
        try {
          await this.streamingEngine.startStream();
        } catch (err) {
          this.showToast(err.message, 'error', 7000);
        }
      } else {
        this.streamingEngine.stopStream();
      }
    });

    this.streamingEngine.onStatusChange = (status) => {
      if (status === 'STARTING') {
        streamIndicator.className = 'w-2 h-2 rounded-full bg-amber-500 animate-ping';
        streamStatusText.textContent = 'STARTING...';
        streamStatusText.className = 'font-semibold text-amber-400';
        streamLabel.textContent = 'Starting...';
      } else if (status === 'CONNECTING') {
        streamIndicator.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
        streamStatusText.textContent = 'CONNECTING TO WHIP...';
        streamStatusText.className = 'font-semibold text-amber-400';
        streamLabel.textContent = 'Connecting...';
      } else if (status === 'CONNECTED') {
        streamIndicator.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
        streamStatusText.textContent = 'PAYUU INGEST CONNECTED';
        streamStatusText.className = 'font-semibold text-emerald-400';
        streamLabel.textContent = 'Stop Stream';
        btnToggleStream.classList.replace('bg-indigo-600', 'bg-red-600');
      } else if (status === 'LIVE') {
        streamIndicator.className = 'w-2 h-2 rounded-full bg-red-500 animate-pulse';
        streamStatusText.textContent = 'LIVE — DESTINATION ACTIVE';
        streamStatusText.className = 'font-semibold text-red-400';
        streamLabel.textContent = 'Stop Stream';
        btnToggleStream.classList.replace('bg-indigo-600', 'bg-red-600');
      } else if (status === 'STOPPING') {
        streamIndicator.className = 'w-2 h-2 rounded-full bg-amber-500';
        streamStatusText.textContent = 'STOPPING...';
        streamStatusText.className = 'font-semibold text-amber-400';
        streamLabel.textContent = 'Stopping...';
      } else if (status === 'ERROR') {
        streamIndicator.className = 'w-2 h-2 rounded-full bg-red-500';
        streamStatusText.textContent = 'CONNECTION FAILED';
        streamStatusText.className = 'font-semibold text-red-400';
        streamLabel.textContent = 'Start Stream';
        btnToggleStream.classList.replace('bg-red-600', 'bg-indigo-600');
      } else {
        streamIndicator.className = 'w-2 h-2 rounded-full bg-amber-500';
        streamStatusText.textContent = 'LOCAL PREVIEW';
        streamStatusText.className = 'font-semibold text-amber-300';
        streamLabel.textContent = 'Start Stream';
        btnToggleStream.classList.replace('bg-red-600', 'bg-indigo-600');
      }
    };

    this.streamingEngine.onDiagnosticsUpdate = (info) => {
      const diagWhipEndpoint = document.getElementById('diagWhipEndpoint');
      const diagIceState = document.getElementById('diagIceState');
      const diagPeerState = document.getElementById('diagPeerState');
      const diagVideoTrack = document.getElementById('diagVideoTrack');
      const diagAudioTrack = document.getElementById('diagAudioTrack');
      const diagStreamState = document.getElementById('diagStreamState');

      if (diagWhipEndpoint) {
        diagWhipEndpoint.textContent = info.endpoint || 'NOT CONFIGURED';
        diagWhipEndpoint.className = info.endpoint ? 'text-indigo-300 font-mono truncate max-w-[280px]' : 'text-amber-400 font-mono';
      }
      if (diagIceState) diagIceState.textContent = info.iceState;
      if (diagPeerState) diagPeerState.textContent = info.peerState;
      if (diagVideoTrack) diagVideoTrack.textContent = info.videoTrackActive ? 'YES (Clean 1080p)' : 'NO';
      if (diagAudioTrack) diagAudioTrack.textContent = info.audioTrackActive ? 'YES (Opus)' : 'NO (Mic inactive)';
      if (diagStreamState) diagStreamState.textContent = info.status;
    };
  }

  setupSettingsModal() {
    const btnOpenSettings = document.getElementById('btnOpenSettings');
    const btnCloseSettings = document.getElementById('btnCloseSettings');
    const settingsModal = document.getElementById('settingsModal');

    if (btnOpenSettings && settingsModal) {
      btnOpenSettings.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
      });
    }

    if (btnCloseSettings && settingsModal) {
      btnCloseSettings.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
      });
    }

    // WHIP Endpoint Settings bindings
    const inputWhipEndpoint = document.getElementById('settingWhipEndpoint');
    const inputWhipToken = document.getElementById('settingWhipToken');

    if (inputWhipEndpoint && inputWhipToken) {
      inputWhipEndpoint.value = localStorage.getItem('payuu_whip_endpoint') || '';
      inputWhipToken.value = localStorage.getItem('payuu_whip_token') || '';

      const saveWhip = () => {
        this.streamingEngine.setWHIPEndpoint(inputWhipEndpoint.value, inputWhipToken.value);
      };

      inputWhipEndpoint.addEventListener('change', saveWhip);
      inputWhipToken.addEventListener('change', saveWhip);
    }

    const inputIceServers = document.getElementById('settingIceServers');
    if (inputIceServers) {
      inputIceServers.value = localStorage.getItem('payuu_ice_servers') || JSON.stringify([{ urls: 'stun:stun.l.google.com:19302' }], null, 2);
      inputIceServers.addEventListener('change', () => {
        try {
          const parsed = JSON.parse(inputIceServers.value);
          if (!Array.isArray(parsed) || !parsed.length) throw new Error('ICE server list must be a non-empty JSON array.');
          parsed.forEach(item => { if (!item || !item.urls) throw new Error('Each ICE server needs a urls property.'); });
          localStorage.setItem('payuu_ice_servers', JSON.stringify(parsed));
          this.whipClient.setIceServers(parsed);
          this.remoteDeviceManager.setIceServers(parsed);
          this.showToast('ICE/TURN configuration saved.', 'info', 3000);
        } catch (err) { this.showToast(`Invalid ICE server JSON: ${err.message}`, 'error', 5000); }
      });
    }

    // Quality Preset bindings
    const selResolution = document.getElementById('settingResolution');
    const selFps = document.getElementById('settingFps');
    const inputVideoBitrate = document.getElementById('settingVideoBitrate');
    const inputAudioBitrate = document.getElementById('settingAudioBitrate');

    if (selResolution && selFps && inputVideoBitrate && inputAudioBitrate) {
      selResolution.value = this.qualitySettings.settings.resolution;
      selFps.value = this.qualitySettings.settings.fps;
      inputVideoBitrate.value = this.qualitySettings.settings.videoBitrate;
      inputAudioBitrate.value = this.qualitySettings.settings.audioBitrate;

      const saveQuality = () => {
        this.qualitySettings.saveSettings({
          resolution: selResolution.value,
          fps: Number(selFps.value),
          videoBitrate: Number(inputVideoBitrate.value),
          audioBitrate: Number(inputAudioBitrate.value)
        });
      };

      selResolution.addEventListener('change', saveQuality);
      selFps.addEventListener('change', saveQuality);
      inputVideoBitrate.addEventListener('change', saveQuality);
      inputAudioBitrate.addEventListener('change', saveQuality);
    }
  }

  setupSceneUI() {
    const sceneList = document.getElementById('sceneList');

    const renderScenes = () => {
      sceneList.innerHTML = '';
      this.sceneManager.scenes.forEach((scene) => {
        const isActive = scene.id === this.sceneManager.activeSceneId;
        const item = document.createElement('div');
        item.className = `px-3 py-2 rounded text-xs font-medium flex justify-between items-center cursor-pointer transition ${
          isActive
            ? 'bg-indigo-950/60 border border-indigo-500/40 text-white'
            : 'hover:bg-gray-800/50 border border-transparent text-gray-400'
        }`;
        item.innerHTML = `
          <span class="flex items-center space-x-2">
            <i class="fa-solid ${scene.icon} ${isActive ? 'text-indigo-400' : 'text-gray-500'}"></i>
            <span>${scene.name}</span>
          </span>
          ${isActive ? '<span class="text-[10px] px-1.5 py-0.2 rounded bg-indigo-900 text-indigo-200">Active</span>' : ''}
        `;
        item.addEventListener('click', () => {
          this.sceneManager.setActiveScene(scene.id);
        });
        sceneList.appendChild(item);
      });
    };

    this.sceneManager.onSceneChange = (scene) => {
      this.compositor.activeScene = scene;
      renderScenes();
      this.updatePlaceholderVisibility();
    };

    renderScenes();
  }

  setupOverlayUI() {
    const overlayList = document.getElementById('overlayList');
    const modal = document.getElementById('overlayStudioModal');
    const templateGrid = document.getElementById('overlayTemplateGrid');
    const editor = document.getElementById('overlayEditor');
    const empty = document.getElementById('overlayEditorEmpty');
    const activeCard = document.getElementById('activeOverlayCard');
    let category = 'all';

    const renderOverlays = () => {
      overlayList.innerHTML = '';
      this.overlayManager.overlays.forEach((overlay) => {
        const isActive = overlay.id === this.overlayManager.activeOverlayId;
        const item = document.createElement('div');
        item.className = `px-2.5 py-2 rounded-lg text-xs flex items-center gap-2 cursor-pointer transition ${isActive ? 'bg-indigo-950/70 border border-indigo-500/40 text-white' : 'hover:bg-gray-800/50 border border-transparent text-gray-400'}`;
        item.innerHTML = `<span class="w-6 h-6 rounded bg-gray-900 border border-gray-700 flex items-center justify-center"><i class="fa-solid ${overlay.icon || 'fa-layer-group'} text-[10px]" style="color:${overlay.accent || '#818cf8'}"></i></span><span class="truncate flex-1">${overlay.name}</span><i class="fa-solid ${isActive ? 'fa-eye text-indigo-400' : 'fa-eye-slash text-gray-600'} text-[10px]"></i>`;
        item.addEventListener('click', () => this.overlayManager.setActiveOverlay(overlay.id));
        overlayList.appendChild(item);
      });
      renderEditor();
      renderActiveCard();
    };

    const renderTemplates = () => {
      templateGrid.innerHTML = '';
      this.overlayManager.getTemplates().filter(t => category === 'all' || t.category === category).forEach(t => {
        const b=document.createElement('button');
        b.className='w-full text-left p-2.5 rounded-xl bg-gray-900/70 hover:bg-gray-800 border border-gray-800 hover:border-indigo-500/40 transition';
        b.innerHTML=`<div class="flex items-center gap-2"><span class="w-8 h-8 rounded-lg bg-gray-950 flex items-center justify-center"><i class="fa-solid ${t.icon}" style="color:${t.accent}"></i></span><div class="min-w-0"><div class="text-xs font-semibold text-white truncate">${t.name}</div><div class="text-[9px] text-gray-500">${t.category}</div></div></div><div class="text-[9px] text-gray-500 mt-2 leading-snug">${t.description}</div>`;
        b.addEventListener('click',()=>this.overlayManager.addTemplate(t.id));
        templateGrid.appendChild(b);
      });
    };

    const renderEditor = () => {
      const o=this.overlayManager.getActiveOverlay();
      if(!o){ empty.classList.remove('hidden'); empty.classList.add('flex'); editor.innerHTML=''; return; }
      empty.classList.add('hidden'); empty.classList.remove('flex');
      editor.innerHTML='';
      o.elements.forEach((el,i)=>{
        const card=document.createElement('div'); card.className='p-3 rounded-xl bg-[#11161d] border border-[#30363d]';
        const type=el.type;
        let controls='';
        if(type==='text' || type==='badge' || type==='ticker') controls=`<label class="block text-[10px] text-gray-500 mb-1">Text</label><input data-field="content" value="${String(el.content||'').replace(/"/g,'&quot;')}" class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-white mb-2"><div class="grid grid-cols-2 gap-2"><div><label class="text-[10px] text-gray-500">Font size</label><input data-field="fontSize" type="number" value="${el.fontSize||18}" class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"></div><div><label class="text-[10px] text-gray-500">Color</label><input data-field="color" type="color" value="${/^#/.test(el.color||'')?el.color:'#ffffff'}" class="w-full h-8 bg-black/40 border border-gray-700 rounded"></div></div>`;
        if(type==='badge') controls+=`<div class="grid grid-cols-2 gap-2 mt-2"><div><label class="text-[10px] text-gray-500">Background</label><input data-field="bgColor" type="color" value="${/^#/.test(el.bgColor||'')?el.bgColor:'#6366f1'}" class="w-full h-8 bg-black/40 border border-gray-700 rounded"></div><div><label class="text-[10px] text-gray-500">Width</label><input data-field="width" type="number" value="${el.width||120}" class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"></div></div>`;
        if(type==='bar' || type==='frame') controls=`<div class="grid grid-cols-2 gap-2"><div><label class="text-[10px] text-gray-500">X</label><input data-field="x" type="number" value="${el.x||0}" class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"></div><div><label class="text-[10px] text-gray-500">Y</label><input data-field="y" type="number" value="${el.y||0}" class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"></div><div><label class="text-[10px] text-gray-500">Width</label><input data-field="width" type="number" value="${el.width||500}" class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"></div><div><label class="text-[10px] text-gray-500">Height</label><input data-field="height" type="number" value="${el.height||80}" class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"></div></div><div class="mt-2"><label class="text-[10px] text-gray-500">Color</label><input data-field="color" type="color" value="${/^#/.test(el.color||'')?el.color:'#6366f1'}" class="w-full h-8 bg-black/40 border border-gray-700 rounded"></div>`;
        if(type==='image') controls=`<label class="block text-[10px] text-gray-500 mb-1">Image URL</label><input data-field="src" value="${String(el.src||'').replace(/"/g,'&quot;')}" class="w-full bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-white mb-2"><div class="grid grid-cols-2 gap-2"><input data-field="width" type="number" value="${el.width||400}" class="bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"><input data-field="height" type="number" value="${el.height||200}" class="bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"></div>`;
        card.innerHTML=`<div class="flex justify-between items-center mb-2"><div class="text-[10px] uppercase tracking-wider text-indigo-300 font-bold"><i class="fa-solid ${type==='text'?'fa-font':type==='image'?'fa-image':type==='frame'?'fa-border-all':'fa-layer-group'} mr-1"></i>${type} source</div><span class="text-[9px] text-gray-600">Layer ${i+1}</span></div>${controls}`;
        card.querySelectorAll('[data-field]').forEach(input=>input.addEventListener('change',()=>{ let v=input.value; if(['x','y','width','height','fontSize'].includes(input.dataset.field)) v=Number(v); this.overlayManager.updateElement(i,{[input.dataset.field]:v}); }));
        editor.appendChild(card);
      });
    };

    const renderActiveCard=()=>{
      const o=this.overlayManager.getActiveOverlay();
      if(!o){activeCard.innerHTML='<div class="text-xs text-gray-500">No active overlay.</div>';return;}
      activeCard.innerHTML=`<div class="p-3 rounded-xl bg-indigo-950/20 border border-indigo-500/30"><div class="text-[9px] uppercase tracking-widest text-indigo-300">Active</div><input id="activeOverlayName" value="${o.name.replace(/"/g,'&quot;')}" class="mt-2 w-full bg-black/40 border border-gray-700 rounded px-2 py-2 text-sm text-white"><p class="text-[10px] text-gray-500 mt-2">${o.description||'Reusable overlay composition'}</p></div><div class="p-3 rounded-xl bg-gray-900/60 border border-gray-800"><div class="flex justify-between text-[10px] text-gray-500 mb-2"><span>LAYERS</span><span>${o.elements.length}</span></div><div class="space-y-1">${o.elements.map((e,i)=>`<div class="flex items-center gap-2 px-2 py-1.5 rounded bg-black/30 text-[10px]"><i class="fa-solid ${e.type==='text'?'fa-font':e.type==='image'?'fa-image':'fa-layer-group'} text-gray-500"></i><span class="flex-1 truncate">${e.content||e.type}</span><span class="text-gray-600">${i+1}</span></div>`).join('')}</div></div>`;
      activeCard.querySelector('#activeOverlayName')?.addEventListener('change',e=>this.overlayManager.renameActive(e.target.value));
    };

    this.overlayManager.onOverlayChange=()=>{ this.compositor.activeOverlay=this.overlayManager.getActiveOverlay(); renderOverlays(); };
    this.overlayManager.onLibraryChange=()=>{ renderOverlays(); };
    renderTemplates(); renderOverlays();

    document.getElementById('btnOpenOverlayStudio')?.addEventListener('click',()=>modal.classList.remove('hidden'));
    document.getElementById('btnCloseOverlayStudio')?.addEventListener('click',()=>modal.classList.add('hidden'));
    document.getElementById('btnCreateTextOverlay')?.addEventListener('click',()=>this.overlayManager.createTextOverlay('NEW TEXT'));
    document.getElementById('btnDuplicateOverlay')?.addEventListener('click',()=>this.overlayManager.duplicateActive());
    document.getElementById('btnDeleteOverlay')?.addEventListener('click',()=>this.overlayManager.deleteActive());
    document.getElementById('btnExportOverlay')?.addEventListener('click',()=>{ const data=this.overlayManager.exportActive(); if(!data)return; const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([data],{type:'application/json'})); a.download='payuu-overlay.json'; a.click(); URL.revokeObjectURL(a.href); });
    document.getElementById('overlayImportFile')?.addEventListener('change',async e=>{ const f=e.target.files?.[0]; if(!f)return; try{this.overlayManager.importOverlay(await f.text());}catch(err){this.showToast(err.message,'error',5000);} e.target.value=''; });
    document.querySelectorAll('.overlay-filter').forEach(btn=>btn.addEventListener('click',()=>{category=btn.dataset.cat;document.querySelectorAll('.overlay-filter').forEach(b=>b.className='overlay-filter px-2 py-1 text-[10px] rounded bg-gray-800 text-gray-400');btn.className='overlay-filter px-2 py-1 text-[10px] rounded bg-indigo-600 text-white';renderTemplates();}));
  }

  setupChatUI() {
    const chatFeed = document.getElementById('chatFeed');
    const chatTabs = document.getElementById('chatTabs');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');

    const renderMessages = (messages) => {
      chatFeed.innerHTML = '';
      messages.forEach((msg) => {
        const msgEl = document.createElement('div');
        msgEl.className = 'flex items-start space-x-2';

        let badgeBg = 'bg-gray-800 text-gray-300';
        let badgeLabel = 'MSG';

        if (msg.platform === 'youtube') {
          badgeBg = 'bg-red-950 text-red-400 border border-red-900/50';
          badgeLabel = 'YT';
        } else if (msg.platform === 'kick') {
          badgeBg = 'bg-emerald-950 text-emerald-400 border border-emerald-900/50';
          badgeLabel = 'KICK';
        } else if (msg.platform === 'twitch') {
          badgeBg = 'bg-purple-950 text-purple-400 border border-purple-900/50';
          badgeLabel = 'TW';
        } else if (msg.platform === 'superchat') {
          badgeBg = 'bg-amber-950 text-amber-400 border border-amber-900/50';
          badgeLabel = '★ SC';
        }

        msgEl.innerHTML = `
          <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${badgeBg}">${badgeLabel}</span>
          <div class="leading-tight">
            <span class="font-semibold text-gray-300">${msg.username}:</span>
            <span class="text-gray-400 ml-1">${msg.message}</span>
          </div>
        `;
        chatFeed.appendChild(msgEl);
      });
      chatFeed.scrollTop = chatFeed.scrollHeight;
    };

    chatTabs.querySelectorAll('.chat-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        chatTabs.querySelectorAll('.chat-tab-btn').forEach((b) => {
          b.classList.remove('text-indigo-400', 'border-b-2', 'border-indigo-500');
          b.classList.add('text-gray-400');
        });
        btn.classList.add('text-indigo-400', 'border-b-2', 'border-indigo-500');
        btn.classList.remove('text-gray-400');

        const filter = btn.getAttribute('data-filter');
        this.chatManager.setFilter(filter);
        renderMessages(this.chatManager.getFilteredMessages());
      });
    });

    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = chatInput.value.trim();
      if (!val) return;
      this.chatManager.addMessage({
        platform: 'youtube',
        username: 'You (Creator)',
        message: val
      });
      chatInput.value = '';
    });

    this.chatManager.onMessageAdded = (filtered) => {
      renderMessages(filtered);
    };

    renderMessages(this.chatManager.getFilteredMessages());
  }

  setupSuperChatUI() {
    const btnTriggerAlert = document.getElementById('btnTriggerAlert');
    const scSupporterName = document.getElementById('scSupporterName');
    const scAmount = document.getElementById('scAmount');
    const scMessage = document.getElementById('scMessage');

    const latest = this.superChatManager.getLatestEvent();
    scSupporterName.textContent = latest.supporterName;
    scAmount.textContent = `${latest.currency}${latest.amount}`;
    scMessage.textContent = latest.message;

    btnTriggerAlert.addEventListener('click', () => {
      this.superChatManager.triggerAlert(this.superChatManager.getLatestEvent(), 5000);
    });

    this.superChatManager.onAlertChange = (alert) => {
      this.compositor.activeAlert = alert;
    };
  }

  setupAudioUI() {
    const btnToggleMic = document.getElementById('btnToggleMicMeter');
    const micMeterBar = document.getElementById('micMeterBar');
    const micDbLevel = document.getElementById('micDbLevel');
    const diagMicStatus = document.getElementById('diagMicStatus');

    btnToggleMic.addEventListener('click', async () => {
      if (!this.audioPipeline.isActive) {
        try {
          await this.audioPipeline.startMicMeter();
          btnToggleMic.textContent = 'Disable Mic Meter';
          btnToggleMic.classList.replace('text-indigo-400', 'text-red-400');
          if (diagMicStatus) {
            diagMicStatus.textContent = 'ACTIVE (METERING)';
            diagMicStatus.className = 'text-emerald-400 font-mono font-bold';
          }
        } catch (err) {
          this.showToast(err.message, 'error');
        }
      } else {
        this.audioPipeline.stop();
        btnToggleMic.textContent = 'Enable Mic Meter';
        btnToggleMic.classList.replace('text-red-400', 'text-indigo-400');
        if (diagMicStatus) {
          diagMicStatus.textContent = 'INACTIVE';
          diagMicStatus.className = 'text-gray-400 font-mono';
        }
      }
    });

    this.audioPipeline.onLevelUpdate = (level) => {
      micMeterBar.style.width = `${level}%`;
      micDbLevel.textContent = level > 0 ? `-${Math.round((100 - level) * 0.4)} dB` : '-∞ dB';
    };
  }

  setupResponsiveTabs() {
    const tabToggleLeft = document.getElementById('tabToggleLeft');
    const tabToggleCenter = document.getElementById('tabToggleCenter');
    const tabToggleRight = document.getElementById('tabToggleRight');
    const leftPanel = document.getElementById('leftPanel');
    const centerPanel = document.getElementById('centerPanel');
    const rightPanel = document.getElementById('rightPanel');

    const setTab = (panel) => {
      if (window.innerWidth >= 1024) return;

      leftPanel.classList.toggle('hidden', panel !== 'left');
      centerPanel.classList.toggle('hidden', panel !== 'center');
      rightPanel.classList.toggle('hidden', panel !== 'right');

      tabToggleLeft.classList.toggle('bg-indigo-600', panel === 'left');
      tabToggleCenter.classList.toggle('bg-indigo-600', panel === 'center');
      tabToggleRight.classList.toggle('bg-indigo-600', panel === 'right');
    };

    tabToggleLeft.addEventListener('click', () => setTab('left'));
    tabToggleCenter.addEventListener('click', () => setTab('center'));
    tabToggleRight.addEventListener('click', () => setTab('right'));
  }

  setupDevStatusModal() {
    const btnDevStatus = document.getElementById('btnDevStatus');
    const btnCloseDevModal = document.getElementById('btnCloseDevModal');
    const devStatusModal = document.getElementById('devStatusModal');

    btnDevStatus.addEventListener('click', () => {
      devStatusModal.classList.remove('hidden');
    });

    btnCloseDevModal.addEventListener('click', () => {
      devStatusModal.classList.add('hidden');
    });

    devStatusModal.addEventListener('click', (e) => {
      if (e.target === devStatusModal) devStatusModal.classList.add('hidden');
    });
  }

  showToast(msg, type = 'info', duration = 5000, actionCallback = null) {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);

    this.toastMessage.textContent = msg;
    const toastIcon = document.getElementById('toastIcon');

    if (type === 'error') {
      this.toastNotification.className =
        'fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-red-950/95 border border-red-500/50 text-red-200 text-xs rounded-md shadow-2xl backdrop-blur flex items-center space-x-3 max-w-lg';
      toastIcon.className = 'fa-solid fa-triangle-exclamation text-red-400 text-base';
    } else {
      this.toastNotification.className =
        'fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-indigo-950/95 border border-indigo-500/50 text-indigo-200 text-xs rounded-md shadow-2xl backdrop-blur flex items-center space-x-3 max-w-lg';
      toastIcon.className = 'fa-solid fa-circle-info text-indigo-400 text-base';
    }

    if (actionCallback) {
      this.toastAction.classList.remove('hidden');
      this.toastAction.onclick = () => {
        this.toastNotification.classList.add('hidden');
        actionCallback();
      };
    } else {
      this.toastAction.classList.add('hidden');
    }

    this.toastNotification.classList.remove('hidden');
    this.toastTimeout = setTimeout(() => {
      this.toastNotification.classList.add('hidden');
    }, duration);
  }
}