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
import { setupRemoteDeviceEnhancements } from './remote/remoteDeviceEnhancements.js';

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

    // Install remote-media routing before any remote session is started.
    // This prevents a single camera track from ever being promoted into the
    // fullscreen screen layer.
    setupRemoteDeviceEnhancements(this);

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
      // Remote screen is the only stream that should enter the fullscreen
      // screen-capture pipeline. Camera is attached separately as PIP.
      this.screenCapture.attachRemoteStream(stream);
      const card = document.getElementById('sourceCardRemote');
      if (card) card.classList.remove('hidden');
      const screenBtnText = document.getElementById('screenBtnText');
      if (screenBtnText) screenBtnText.textContent = 'iPhone Connected';
      const sourceStatus = document.getElementById('remoteSourceStatus');
      if (sourceStatus) sourceStatus.textContent = stream.getAudioTracks().length ? 'SCREEN + AUDIO' : 'SCREEN';
    };

    this.remoteDeviceManager.onRemoteCamera = (stream) => {
      // Keep remote camera strictly in the camera/PIP layer.
      this.compositor.isCameraActive = !!stream?.getVideoTracks?.().length;
      this.compositor.cameraTransform.visible = true;
      this.compositor.cameraVideo.srcObject = stream;
      this.compositor.cameraVideo.muted = true;
      this.compositor.cameraVideo.autoplay = true;
      this.compositor.cameraVideo.playsInline = true;
      this.compositor.cameraVideo.play().catch(() => {});
      this.sourceCardCamera?.classList.toggle('hidden', !this.compositor.isCameraActive);
      this.updatePlaceholderVisibility();
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

    this.noSourceOverlay.classList.toggle('hidden', !hasActiveSource);
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
      if (diagVideoTrack) diagVideoTrack.textContent = info.videoTrack;
      if (diagAudioTrack) diagAudioTrack.textContent = info.audioTrack;
      if (diagStreamState) diagStreamState.textContent = info.streamState;
    };
  }
