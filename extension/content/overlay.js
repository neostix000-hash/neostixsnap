(() => {
  const GLOBAL_KEY = '__neostixsnapOverlayInstalled';
  if (window[GLOBAL_KEY]) return;
  window[GLOBAL_KEY] = true;

  const MAX_DATA_URL = 6_200_000;
  const MAX_SIDE = 1900;
  let state = null;
  let loadingOverlay = false;

  const STYLES = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .wrap {
      position: fixed; inset: 0; z-index: 2147483647; overflow: hidden;
      font-family: "Inter", "Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, sans-serif;
      color: #f8faff; cursor: crosshair; user-select: none; touch-action: none;
      background: #05070d; opacity: 0; transition: opacity .16s ease;
    }
    .wrap.visible { opacity: 1; }
    .shot {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: fill; pointer-events: none; -webkit-user-drag: none;
    }
    .shade {
      position: absolute; inset: 0; z-index: 1; background: rgba(3, 6, 14, .62);
      transition: opacity .12s ease;
    }
    .selection {
      position: absolute; z-index: 2; left: 0; top: 0; display: none;
      border: 1.5px solid #60a5fa; border-radius: 3px;
      box-shadow: 0 0 0 100vmax rgba(3, 6, 14, .64), 0 0 34px rgba(59,130,246,.32);
      pointer-events: none;
    }
    .selection.active { display: block; }
    .corner {
      position: absolute; width: 14px; height: 14px; border: 2px solid #a5f3fc;
      filter: drop-shadow(0 0 5px rgba(34,211,238,.8));
    }
    .corner.tl { left: -2px; top: -2px; border-right: 0; border-bottom: 0; border-top-left-radius: 5px; }
    .corner.tr { right: -2px; top: -2px; border-left: 0; border-bottom: 0; border-top-right-radius: 5px; }
    .corner.bl { left: -2px; bottom: -2px; border-right: 0; border-top: 0; border-bottom-left-radius: 5px; }
    .corner.br { right: -2px; bottom: -2px; border-left: 0; border-top: 0; border-bottom-right-radius: 5px; }
    .hud {
      position: absolute; z-index: 10; top: 16px; left: 50%; transform: translateX(-50%);
      width: min(760px, calc(100vw - 32px)); min-height: 52px; padding: 8px 9px 8px 15px;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      border: 1px solid rgba(148, 163, 184, .18); border-radius: 16px;
      background: rgba(7, 11, 22, .88); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
      box-shadow: 0 18px 50px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.05);
      cursor: default;
    }
    .brandline { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .mark {
      width: 28px; height: 28px; flex: 0 0 auto; display: grid; place-items: center;
      border: 1px solid rgba(96,165,250,.45); border-radius: 9px;
      background: linear-gradient(145deg, rgba(34,211,238,.16), rgba(139,92,246,.18));
      box-shadow: 0 0 20px rgba(59,130,246,.18);
    }
    .mark svg { width: 16px; height: 16px; display: block; }
    .brand { font-size: 12px; font-weight: 650; letter-spacing: .01em; white-space: nowrap; }
    .divider { width: 1px; height: 18px; background: rgba(148,163,184,.2); flex: 0 0 auto; }
    .status {
      font-size: 12.5px; color: #cbd5e1; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis;
    }
    .controls { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .size {
      font-size: 11px; font-variant-numeric: tabular-nums; color: #93c5fd;
      padding: 4px 8px; border-radius: 7px; background: rgba(59,130,246,.1);
      border: 1px solid rgba(59,130,246,.18);
    }
    kbd {
      font: inherit; font-size: 10.5px; color: #cbd5e1; padding: 4px 7px;
      border: 1px solid rgba(148,163,184,.22); border-bottom-color: rgba(148,163,184,.34);
      border-radius: 6px; background: rgba(148,163,184,.08);
    }
    .cancel {
      all: unset; cursor: pointer; font-size: 11.5px; font-weight: 600; color: #e2e8f0;
      padding: 7px 12px; border-radius: 9px; border: 1px solid rgba(148,163,184,.22);
      background: rgba(255,255,255,.04); transition: background .15s ease, border-color .15s ease;
    }
    .cancel:hover { background: rgba(255,255,255,.09); border-color: rgba(148,163,184,.4); }
    .cancel:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
    .cancel:disabled { opacity: .5; cursor: default; }
    .hintbar {
      position: absolute; z-index: 10; left: 50%; bottom: 22px; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px; padding: 9px 15px;
      border: 1px solid rgba(148,163,184,.13); border-radius: 999px;
      background: rgba(7,11,22,.78); backdrop-filter: blur(14px);
      color: #93a0b5; font-size: 11px; white-space: nowrap; cursor: default;
      box-shadow: 0 10px 32px rgba(0,0,0,.25);
    }
    .hintbar .dot { width: 3px; height: 3px; border-radius: 50%; background: #475569; }
    .hintbar b { color: #cbd5e1; font-weight: 600; }
    .toast {
      position: absolute; z-index: 22; left: 50%; bottom: 76px; transform: translateX(-50%);
      max-width: min(520px, calc(100vw - 40px)); padding: 10px 14px;
      border: 1px solid rgba(248,113,113,.25); border-radius: 11px;
      background: rgba(35, 11, 18, .94); color: #fecaca; font-size: 12px;
      box-shadow: 0 16px 44px rgba(0,0,0,.4); text-align: center;
    }
    .processing {
      position: absolute; inset: 0; z-index: 20; display: grid; place-items: center;
      background: rgba(3,6,14,.28); pointer-events: none;
    }
    .processing[hidden] { display: none; }
    .proc-card {
      display: flex; align-items: center; gap: 14px; padding: 16px 20px;
      border: 1px solid rgba(96,165,250,.24); border-radius: 16px;
      background: rgba(7,11,22,.94); backdrop-filter: blur(18px);
      box-shadow: 0 24px 70px rgba(0,0,0,.5), 0 0 40px rgba(59,130,246,.12);
    }
    .orb { position: relative; width: 34px; height: 34px; flex: 0 0 auto; }
    .orb::before, .orb::after {
      content: ""; position: absolute; inset: 0; border-radius: 50%;
      border: 1.5px solid transparent; border-top-color: #38bdf8; border-right-color: #8b5cf6;
      animation: ns-spin 1.05s linear infinite;
    }
    .orb::after { inset: 6px; border-top-color: #a78bfa; border-right-color: #22d3ee; animation-duration: .7s; animation-direction: reverse; }
    .proc-copy { display: flex; flex-direction: column; gap: 3px; }
    .proc-copy strong { font-size: 12.5px; font-weight: 650; color: #f1f5ff; }
    .proc-copy span { font-size: 11px; color: #94a3b8; }
    @keyframes ns-spin { to { transform: rotate(360deg); } }
    @media (max-width: 620px) {
      .brand, .divider, .hintbar span.extra { display: none; }
      .hud { top: 10px; width: calc(100vw - 20px); padding-left: 12px; }
      .status { font-size: 11.5px; }
      .hintbar { bottom: 12px; font-size: 10px; gap: 8px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .wrap, .shade, .orb::before, .orb::after { transition: none !important; animation: none !important; }
    }
  `;

  const HTML = `
    <div class="wrap" role="dialog" aria-modal="true" aria-label="Select an area of the screen to solve">
      <img class="shot" alt="" draggable="false" />
      <div class="shade" style="opacity:1"></div>
      <div class="selection" aria-hidden="true">
        <span class="corner tl"></span><span class="corner tr"></span>
        <span class="corner bl"></span><span class="corner br"></span>
      </div>
      <div class="hud no-drag" style="pointer-events:auto">
        <div class="brandline">
          <span class="mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M13.8 2.4 5.5 13.8h5.7L10.1 21.6l8.4-12h-5.8l1.1-7.2Z" fill="url(#ns-bolt)"/><defs><linearGradient id="ns-bolt" x1="6" y1="2" x2="18" y2="22" gradientUnits="userSpaceOnUse"><stop stop-color="#a5f3fc"/><stop offset=".5" stop-color="#60a5fa"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs></svg>
          </span>
          <span class="brand">NeostixSnap</span>
          <span class="divider"></span>
          <span class="status" id="ns-status">Drag to select your question</span>
        </div>
        <div class="controls">
          <span class="size" id="ns-size" hidden></span>
          <kbd>Esc</kbd>
          <button class="cancel" id="ns-cancel" type="button">Cancel</button>
        </div>
      </div>
      <div class="hintbar no-drag">
        <span>Include the <b>whole question</b></span><span class="dot"></span>
        <span class="extra">Photos, diagrams & handwriting</span><span class="dot"></span>
        <span>Esc to cancel</span>
      </div>
      <div class="toast" id="ns-toast" hidden role="status"></div>
      <div class="processing" id="ns-processing" hidden>
        <div class="proc-card">
          <div class="orb" aria-hidden="true"></div>
          <div class="proc-copy"><strong>Analyzing your selection</strong><span>Reading the text and working through it…</span></div>
        </div>
      </div>
    </div>
  `;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;
    if (message.type === 'NEOSTIX_SHOW_OVERLAY') {
      showOverlay(message)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error?.code || 'overlay_failed',
            message: error?.message || 'The selection overlay could not start.'
          });
        });
      return true;
    }
    if (message.type === 'NEOSTIX_FLASH') {
      if (state) showToast('A selection is already active. Drag to select, or press Esc.', false);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = src;
      const done = () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve(image);
        else reject(new Error('The screenshot could not be loaded.'));
      };
      if (image.complete) {
        done();
        return;
      }
      image.onload = done;
      image.onerror = () => reject(new Error('The screenshot could not be loaded.'));
      setTimeout(() => {
        if (image.naturalWidth > 0) resolve(image);
        else reject(new Error('The screenshot took too long to load.'));
      }, 5000);
    });
  }

  async function showOverlay(message) {
    if (state || loadingOverlay) {
      const error = new Error('A selection is already active.');
      error.code = 'already_active';
      throw error;
    }
    if (typeof message.screenshot !== 'string' || !message.screenshot.startsWith('data:image/')) {
      throw new Error('The screenshot data is invalid.');
    }

    loadingOverlay = true;
    try {
      const image = await loadImage(message.screenshot);

      const host = document.createElement('div');
      host.id = 'neostixsnap-root';
      host.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;width:100%;height:100%;display:block;';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLES;
      shadow.appendChild(style);
      const template = document.createElement('template');
      template.innerHTML = HTML;
      shadow.appendChild(template.content.cloneNode(true));

      const wrap = shadow.querySelector('.wrap');
      const shot = shadow.querySelector('.shot');
      shot.src = message.screenshot;
      const shade = shadow.querySelector('.shade');
      const selection = shadow.querySelector('.selection');
      const status = shadow.querySelector('#ns-status');
      const sizeLabel = shadow.querySelector('#ns-size');
      const cancelButton = shadow.querySelector('#ns-cancel');
      const toast = shadow.querySelector('#ns-toast');
      const processing = shadow.querySelector('#ns-processing');

      const mount = document.fullscreenElement || document.documentElement;
      mount.appendChild(host);

      state = {
        host,
        shadow,
        wrap,
        image,
        selection,
        shade,
        status,
        sizeLabel,
        cancelButton,
        toast,
        processing,
        pointerId: null,
        start: null,
        rect: null,
        busy: false,
        toastTimer: null,
        cleanupTimer: null
      };

      wrap.addEventListener('pointerdown', onPointerDown);
      wrap.addEventListener('pointermove', onPointerMove);
      wrap.addEventListener('pointerup', onPointerUp);
      wrap.addEventListener('pointercancel', onPointerCancel);
      cancelButton.addEventListener('click', () => cancelOverlay(false));
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('wheel', onWheel, { passive: false, capture: true });
      window.addEventListener('touchmove', onWheel, { passive: false, capture: true });
      window.addEventListener('resize', onResize);
      window.addEventListener('contextmenu', preventDefault, true);

      requestAnimationFrame(() => wrap.classList.add('visible'));
      try {
        cancelButton.focus({ preventScroll: true });
      } catch {
        // Focus is optional.
      }
      return { ok: true };
    } finally {
      loadingOverlay = false;
    }
  }

  function preventDefault(event) {
    event.preventDefault();
  }

  function onWheel(event) {
    event.preventDefault();
  }

  function onKeyDown(event) {
    if (!state) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!state.busy) cancelOverlay(false);
      return;
    }
    const scrollKeys = new Set([
      ' ',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageUp',
      'PageDown',
      'Home',
      'End'
    ]);
    if (scrollKeys.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onResize() {
    if (!state || state.busy) return;
    cancelOverlay(true, 'Window resized — press Alt+Q to capture again.');
  }

  function onPointerDown(event) {
    if (!state || state.busy) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('.hud, .hintbar, .toast, .processing')) return;
    event.preventDefault();

    const x = clamp(event.clientX, 0, window.innerWidth);
    const y = clamp(event.clientY, 0, window.innerHeight);
    state.start = { x, y };
    state.rect = { x, y, width: 0, height: 0 };
    state.pointerId = event.pointerId;
    try {
      state.wrap.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a progressive enhancement.
    }
    state.shade.style.opacity = '0';
    state.selection.classList.add('active');
    state.status.textContent = 'Drag to frame the whole question';
    state.sizeLabel.hidden = false;
    updateSelection();
  }

  function onPointerMove(event) {
    if (!state?.start) return;
    event.preventDefault();
    const point = {
      x: clamp(event.clientX, 0, window.innerWidth),
      y: clamp(event.clientY, 0, window.innerHeight)
    };
    state.rect = {
      x: Math.min(state.start.x, point.x),
      y: Math.min(state.start.y, point.y),
      width: Math.abs(point.x - state.start.x),
      height: Math.abs(point.y - state.start.y)
    };
    updateSelection();
  }

  async function onPointerUp(event) {
    if (!state?.start) return;
    event.preventDefault();
    try {
      state.wrap.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore.
    }
    state.pointerId = null;
    const rect = state.rect;
    state.start = null;

    if (!rect || rect.width < 12 || rect.height < 12) {
      resetSelection();
      return;
    }
    await processSelection(rect);
  }

  function onPointerCancel(event) {
    if (!state) return;
    state.start = null;
    state.pointerId = null;
    resetSelection();
  }

  function updateSelection() {
    if (!state?.rect) return;
    const { x, y, width, height } = state.rect;
    state.selection.style.left = `${x}px`;
    state.selection.style.top = `${y}px`;
    state.selection.style.width = `${width}px`;
    state.selection.style.height = `${height}px`;
    state.sizeLabel.textContent = `${Math.round(width)} × ${Math.round(height)}`;
  }

  function resetSelection() {
    if (!state) return;
    state.rect = null;
    state.selection.classList.remove('active');
    state.shade.style.opacity = '1';
    state.status.textContent = 'Drag to select your question';
    state.sizeLabel.hidden = true;
  }

  async function processSelection(rect) {
    if (!state || state.busy) return;
    state.busy = true;
    state.cancelButton.disabled = true;
    state.processing.hidden = false;
    state.status.textContent = 'Capturing selection…';
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      const cropped = cropSelection(rect);
      state.status.textContent = 'Sending to NeostixSnap…';
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          type: 'NEOSTIX_CAPTURE_RESULT',
          imageDataUrl: cropped
        });
      } catch {
        throw Object.assign(new Error('The extension was reloaded. Close this overlay and press Alt+Q again.'), {
          code: 'extension_unavailable'
        });
      }
      if (!response?.ok) {
        const error = new Error(
          response?.error?.message || 'The screenshot could not be processed.'
        );
        error.code = response?.error?.code || 'capture_failed';
        throw error;
      }
      teardown();
    } catch (error) {
      state.processing.hidden = true;
      state.cancelButton.disabled = false;
      state.busy = false;
      state.status.textContent = 'Selection not sent';
      const unrecoverable = ['stale_capture', 'expired_selection', 'extension_unavailable'].includes(
        error.code
      );
      showToast(error.message || 'The selection could not be sent. Try again.', false);
      if (unrecoverable) {
        state.cleanupTimer = setTimeout(() => teardown(), 2600);
      } else {
        resetSelection();
      }
    }
  }

  function cropSelection(rect) {
    if (!state) throw new Error('No screenshot available.');
    const image = state.image;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scaleX = image.naturalWidth / viewportWidth;
    const scaleY = image.naturalHeight / viewportHeight;
    const padding = 2;
    const left = clamp(rect.x - padding, 0, viewportWidth);
    const top = clamp(rect.y - padding, 0, viewportHeight);
    const right = clamp(rect.x + rect.width + padding, 0, viewportWidth);
    const bottom = clamp(rect.y + rect.height + padding, 0, viewportHeight);

    const sourceX = Math.max(0, left * scaleX);
    const sourceY = Math.max(0, top * scaleY);
    const sourceWidth = Math.min(image.naturalWidth - sourceX, (right - left) * scaleX);
    const sourceHeight = Math.min(image.naturalHeight - sourceY, (bottom - top) * scaleY);
    if (sourceWidth < 2 || sourceHeight < 2) throw new Error('Select a larger area.');

    const scale = Math.min(1, MAX_SIDE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('This page does not allow image processing.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);

    let dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > MAX_DATA_URL * 0.88) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    }
    if (dataUrl.length > MAX_DATA_URL) {
      const smaller = document.createElement('canvas');
      smaller.width = Math.max(1, Math.round(width * 0.75));
      smaller.height = Math.max(1, Math.round(height * 0.75));
      const ctx = smaller.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, smaller.width, smaller.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      dataUrl = smaller.toDataURL('image/jpeg', 0.9);
    }
    if (!dataUrl.startsWith('data:image/') || dataUrl.length < 100) {
      throw new Error('The selection could not be converted to an image.');
    }
    return dataUrl;
  }

  function showToast(text, isSuccess = false) {
    if (!state) return;
    clearTimeout(state.toastTimer);
    state.toast.textContent = text;
    state.toast.style.borderColor = isSuccess
      ? 'rgba(74,222,128,.28)'
      : 'rgba(248,113,113,.25)';
    state.toast.style.color = isSuccess ? '#bbf7d0' : '#fecaca';
    state.toast.hidden = false;
    state.toastTimer = setTimeout(() => {
      if (state) state.toast.hidden = true;
    }, 4500);
  }

  function cancelOverlay(silent, notice = '') {
    if (!state) return;
    if (state.busy && silent) return;
    if (notice) showToast(notice, false);
    const finish = () => {
      teardown();
      safeSend({ type: 'NEOSTIX_CAPTURE_CANCELLED' });
    };
    if (notice) {
      state.cleanupTimer = setTimeout(finish, 1600);
    } else {
      finish();
    }
  }

  function teardown() {
    if (!state) return;
    const current = state;
    state = null;
    clearTimeout(current.toastTimer);
    clearTimeout(current.cleanupTimer);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('touchmove', onWheel, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('contextmenu', preventDefault, true);
    try {
      current.host.remove();
    } catch {
      // The page may have replaced the DOM.
    }
  }

  function safeSend(message) {
    try {
      const promise = chrome.runtime.sendMessage(message);
      if (promise?.catch) promise.catch(() => {});
    } catch {
      // Extension context invalidated.
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
