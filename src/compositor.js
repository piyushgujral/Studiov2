/**
 * 1920x1080 60 FPS HTML5 Canvas Compositor Engine
 * Architecture:
 * - Clean Canvas: Stream output containing ONLY Scene + Video + Overlays + Alerts.
 * - Editor Layer: Rendered ONLY on the interactive preview (Selection handles, borders).
 */
export class CanvasCompositor {
  constructor(canvasElement, cameraVideo, screenVideo) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.cameraVideo = cameraVideo;
    this.screenVideo = screenVideo;

    // Create an offscreen canvas for the clean stream output (1080p master)
    this.cleanCanvas = document.createElement('canvas');
    this.cleanCanvas.width = 1920;
    this.cleanCanvas.height = 1080;
    this.cleanCtx = this.cleanCanvas.getContext('2d');

    // Movable Camera Transform State
    this.cameraTransform = {
      x: 1440,
      y: 792,
      width: 440,
      height: 247.5,
      rotation: 0,
      visible: true,
      locked: false,
      isSelected: false,
      isDragging: false,
      isResizing: false
    };

    // Layer Visibilities
    this.isScreenVisible = true;

    // Pipeline bindings
    this.activeScene = null;
    this.activeOverlay = null;
    this.activeAlert = null;
    this.isCameraActive = false;
    this.isScreenActive = false;

    this.initInteractions();
    this.startLoop();
  }

  getCleanStream(fps = 60) {
    return this.cleanCanvas.captureStream(fps);
  }

  startLoop() {
    const render = () => {
      this.renderMasterFrame();
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  renderMasterFrame() {
    // 1. Render Clean Composition (Master Stream Canvas)
    this.renderCleanComposition(this.cleanCtx, this.cleanCanvas.width, this.cleanCanvas.height);

    // 2. Draw Clean Composition to Preview Canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.cleanCanvas, 0, 0, this.canvas.width, this.canvas.height);

    // 3. Render Editor UI Controls ON TOP of preview ONLY (Never in clean canvas)
    this.renderEditorControls(this.ctx);
  }

  renderCleanComposition(ctx, width, height) {
    // A. Master Background
    ctx.fillStyle = '#06080c';
    ctx.fillRect(0, 0, width, height);

    if (!this.activeScene) return;

    // B. Screen Capture Layer
    if (
      this.activeScene.sources.showScreen &&
      this.isScreenActive &&
      this.isScreenVisible &&
      this.screenVideo.readyState >= 2
    ) {
      ctx.drawImage(this.screenVideo, 0, 0, width, height);
    }

    // C. Camera Layer (Clean - No selection borders)
    if (
      this.activeScene.sources.showCamera &&
      this.isCameraActive &&
      this.cameraTransform.visible &&
      this.cameraVideo.readyState >= 2
    ) {
      const cam = this.cameraTransform;
      ctx.save();
      ctx.drawImage(this.cameraVideo, cam.x, cam.y, cam.width, cam.height);
      ctx.restore();
    }

    // D. Scene Text Placeholders (e.g. Starting Soon, BRB)
    if (this.activeScene.sources.showText && this.activeScene.sources.textMessage) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 64px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.activeScene.sources.textMessage, width / 2, height / 2);

      ctx.font = '20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#818cf8';
      ctx.fillText('PAYUU STUDIO LIVE STREAM', width / 2, height / 2 + 60);
      ctx.restore();
    }

    // E. Overlays
    if (this.activeScene.sources.showOverlay && this.activeOverlay) {
      this.renderOverlay(ctx, this.activeOverlay);
    }

    // F. SuperChat Alert Banner
    if (this.activeAlert) {
      this.renderAlert(ctx, this.activeAlert);
    }
  }

  renderEditorControls(ctx) {
    // Draw interaction handles ONLY when camera is active, visible, and selected
    if (
      this.activeScene?.sources?.showCamera &&
      this.isCameraActive &&
      this.cameraTransform.visible
    ) {
      const cam = this.cameraTransform;
      ctx.save();

      // Border indicator
      ctx.strokeStyle = cam.locked ? '#484f58' : (cam.isSelected ? '#818cf8' : 'rgba(99, 102, 241, 0.6)');
      ctx.lineWidth = 3;
      ctx.setLineDash(cam.locked ? [6, 6] : []);
      ctx.strokeRect(cam.x, cam.y, cam.width, cam.height);

      // Resize Handle indicator (Bottom-Right)
      if (!cam.locked && cam.isSelected) {
        ctx.setLineDash([]);
        ctx.fillStyle = '#6366f1';
        ctx.fillRect(cam.x + cam.width - 16, cam.y + cam.height - 16, 16, 16);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(cam.x + cam.width - 16, cam.y + cam.height - 16, 16, 16);
      }

      ctx.restore();
    }
  }

  renderOverlay(ctx, overlay) {
    overlay.elements.forEach((el) => {
      if (el.type === 'text') {
        ctx.save();
        ctx.fillStyle = el.color || '#ffffff';
        ctx.font = `${el.fontWeight || 700} ${el.fontSize || 20}px sans-serif`;
        ctx.textAlign = el.align || 'left';
        ctx.fillText(el.content, el.x, el.y);
        ctx.restore();
      } else if (el.type === 'badge') {
        ctx.save();
        ctx.fillStyle = el.bgColor;
        ctx.fillRect(el.x, el.y, el.width, el.height);
        ctx.fillStyle = el.textColor;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(el.content, el.x + el.width / 2, el.y + el.height / 2 + 4);
        ctx.restore();
      } else if (el.type === 'bar') {
        ctx.save();
        ctx.fillStyle = el.color || 'rgba(0,0,0,.7)';
        const r = Number(el.radius || 0);
        if (r > 0 && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(el.x, el.y, el.width, el.height, r); ctx.fill(); }
        else ctx.fillRect(el.x, el.y, el.width, el.height);
        ctx.restore();
      } else if (el.type === 'frame') {
        ctx.save();
        ctx.strokeStyle = el.color || '#6366f1';
        ctx.globalAlpha = el.alpha ?? 1;
        ctx.lineWidth = el.lineWidth || 4;
        const r = Number(el.radius || 0);
        if (r > 0 && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(el.x, el.y, el.width, el.height, r); ctx.stroke(); }
        else ctx.strokeRect(el.x, el.y, el.width, el.height);
        ctx.restore();
      } else if (el.type === 'image' && el.src) {
        try {
          if (!el._img) { el._img = new Image(); el._img.crossOrigin = 'anonymous'; el._img.src = el.src; }
          if (el._img.complete && el._img.naturalWidth) ctx.drawImage(el._img, el.x, el.y, el.width, el.height);
        } catch (_) {}
      } else if (el.type === 'ticker') {
        ctx.save();
        ctx.fillStyle = el.bgColor || 'rgba(2,6,23,.92)';
        ctx.fillRect(el.x || 0, el.y || 0, el.width || width, el.height || 54);
        ctx.fillStyle = el.color || '#fff';
        ctx.font = `bold ${el.fontSize || 20}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(el.content || '', (el.x || 0) + 18, (el.y || 0) + (el.height || 54)/2);
        ctx.restore();
      }
    });
  }

  renderAlert(ctx, alert) {
    const alertW = 620;
    const alertH = 120;
    const alertX = (this.cleanCanvas.width - alertW) / 2;
    const alertY = 60;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(alertX, alertY, alertW, alertH, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`★ NEW SUPERCHAT: ${alert.currency}${alert.amount}`, alertX + 24, alertY + 45);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '18px sans-serif';
    ctx.fillText(`${alert.supporterName}: "${alert.message}"`, alertX + 24, alertY + 85);
    ctx.restore();
  }

  initInteractions() {
    let dragStartX = 0;
    let dragStartY = 0;
    let initialCamX = 0;
    let initialCamY = 0;
    let initialWidth = 0;

    const getCanvasCoordinates = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    const isInsideResizeHandle = (pt, cam) => {
      return (
        pt.x >= cam.x + cam.width - 32 &&
        pt.x <= cam.x + cam.width + 10 &&
        pt.y >= cam.y + cam.height - 32 &&
        pt.y <= cam.y + cam.height + 10
      );
    };

    const isInsideCamera = (pt, cam) => {
      return (
        pt.x >= cam.x &&
        pt.x <= cam.x + cam.width &&
        pt.y >= cam.y &&
        pt.y <= cam.y + cam.height
      );
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      const pt = getCanvasCoordinates(e);
      const cam = this.cameraTransform;

      if (!this.isCameraActive || !cam.visible) {
        cam.isSelected = false;
        return;
      }

      if (isInsideResizeHandle(pt, cam) && !cam.locked) {
        cam.isResizing = true;
        cam.isSelected = true;
        dragStartX = pt.x;
        initialWidth = cam.width;
        this.canvas.setPointerCapture(e.pointerId);
      } else if (isInsideCamera(pt, cam)) {
        cam.isSelected = true;
        if (!cam.locked) {
          cam.isDragging = true;
          dragStartX = pt.x;
          dragStartY = pt.y;
          initialCamX = cam.x;
          initialCamY = cam.y;
          this.canvas.setPointerCapture(e.pointerId);
        }
      } else {
        cam.isSelected = false;
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const cam = this.cameraTransform;
      const pt = getCanvasCoordinates(e);

      if (cam.isDragging) {
        const dx = pt.x - dragStartX;
        const dy = pt.y - dragStartY;
        cam.x = Math.max(0, Math.min(this.canvas.width - cam.width, initialCamX + dx));
        cam.y = Math.max(0, Math.min(this.canvas.height - cam.height, initialCamY + dy));
        if (this.onTransformChange) this.onTransformChange(cam);
      } else if (cam.isResizing) {
        const dx = pt.x - dragStartX;
        const newW = Math.max(200, Math.min(this.canvas.width - cam.x, initialWidth + dx));
        cam.width = newW;
        cam.height = newW * (9 / 16);
        if (cam.y + cam.height > this.canvas.height) {
          cam.y = this.canvas.height - cam.height;
        }
        if (this.onTransformChange) this.onTransformChange(cam);
      }
    });

    const endInteraction = (e) => {
      this.cameraTransform.isDragging = false;
      this.cameraTransform.isResizing = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    };

    this.canvas.addEventListener('pointerup', endInteraction);
    this.canvas.addEventListener('pointercancel', endInteraction);
  }

  resetCameraPIP() {
    this.cameraTransform.x = 1440;
    this.cameraTransform.y = 792;
    this.cameraTransform.width = 440;
    this.cameraTransform.height = 247.5;
    if (this.onTransformChange) this.onTransformChange(this.cameraTransform);
  }
}