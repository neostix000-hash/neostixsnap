import { SELECTOR_PREFIX } from '../shared/settings.js';

const stage = document.getElementById('stage');
const shot = document.getElementById('shot');
const shade = document.getElementById('shade');
const selection = document.getElementById('selection');
const loader = document.getElementById('loader');
const errorState = document.getElementById('errorState');
const errorTitle = document.getElementById('errorTitle');
const errorText = document.getElementById('errorText');
const errorClose = document.getElementById('errorClose');
const processing = document.getElementById('processing');
const stageHint = document.getElementById('stageHint');
const stageStatus = document.getElementById('stageStatus');
const selectionSize = document.getElementById('selectionSize');
const cancelTop = document.getElementById('cancelTop');
const cancelBottom = document.getElementById('cancelBottom');

const MAX_SIDE = 1900;
const MAX_DATA_URL = 6_200_000;
const selectorId = new URLSearchParams(location.search).get('id');

let job = null;
let imageRect = null;
let start = null;
let rect = null;
let busy = false;
let pointerId = null;
let closing = false;

cancelTop.addEventListener('click', cancel);
cancelBottom.addEventListener('click', cancel);
errorClose.onclick = () => closeWindow();

stage.addEventListener('pointerdown', onPointerDown);
stage.addEventListener('pointermove', onPointerMove);
stage.addEventListener('pointerup', onPointerUp);
stage.addEventListener('pointercancel', onPointerCancel);
stage.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('keydown', onKeyDown, true);
window.addEventListener('resize', onResize);

void init();

async function init() {
  if (!selectorId) {
    showFatal('Selection unavailable', 'The screenshot reference is missing. Take a new capture with Alt+Q.');
    return;
  }
  try {
    const key = SELECTOR_PREFIX + selectorId;
    const stored = await chrome.storage.session.get(key);
    job = stored?.[key];
    if (!job?.imageDataUrl) {
      showFatal(
        'Capture expired',
        'This screenshot is no longer available. Close this window and take a new capture with Alt+Q.',
        true
      );
      return;
    }
    shot.src = job.imageDataUrl;
    await waitForImage(shot);
    if (window.innerWidth > 0) {
      shot.classList.add('loaded');
      loader.hidden = true;
      updateImageRect();
    }
  } catch {
    showFatal(
      'Screenshot unavailable',
      'NeostixSnap could not load the captured page. Take a new capture with Alt+Q.'
    );
  }
}

function waitForImage(image) {
  return new Promise((resolve, reject) => {
    if (image.complete) {
      if (image.naturalWidth > 0) resolve();
      else reject(new Error('Image failed to load'));
      return;
    }
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', () => reject(new Error('Image failed to load')), {
      once: true
    });
  });
}

function updateImageRect() {
  const stageBox = stage.getBoundingClientRect();
  const imageBox = shot.getBoundingClientRect();
  imageRect = {
    x: imageBox.left - stageBox.left,
    y: imageBox.top - stageBox.top,
    width: imageBox.width,
    height: imageBox.height
  };
}

function onPointerDown(event) {
  if (busy || closing || !job || !imageRect) return;
  if (event.button !== undefined && event.button !== 0) return;
  const point = localPoint(event);
  if (
    point.x < imageRect.x ||
    point.y < imageRect.y ||
    point.x > imageRect.x + imageRect.width ||
    point.y > imageRect.y + imageRect.height
  ) {
    return;
  }
  event.preventDefault();
  start = clampPoint(point);
  rect = { x: start.x, y: start.y, width: 0, height: 0 };
  pointerId = event.pointerId;
  try {
    stage.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is optional.
  }
  shade.style.opacity = '0';
  selection.classList.add('active');
  stageHint.style.opacity = '0';
  updateSelection();
}

function onPointerMove(event) {
  if (!start) return;
  event.preventDefault();
  const point = clampPoint(localPoint(event));
  rect = normalizeRect(start, point);
  updateSelection();
}

function onPointerUp(event) {
  if (!start) return;
  event.preventDefault();
  try {
    stage.releasePointerCapture(event.pointerId);
  } catch {
    // Ignore.
  }
  pointerId = null;
  const current = rect;
  start = null;
  if (!current || current.width < 12 || current.height < 12) {
    resetSelection();
    return;
  }
  void processSelection(current);
}

function onPointerCancel() {
  start = null;
  pointerId = null;
  resetSelection();
}

function updateSelection() {
  if (!rect) return;
  selection.style.left = `${rect.x}px`;
  selection.style.top = `${rect.y}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;
  const label = `${Math.round(rect.width)} × ${Math.round(rect.height)} px`;
  stageStatus.textContent = label;
  stageStatus.hidden = false;
  selectionSize.textContent = label;
}

function resetSelection() {
  rect = null;
  selection.classList.remove('active');
  shade.style.opacity = '1';
  stageHint.style.opacity = '1';
  stageStatus.hidden = true;
  selectionSize.textContent = 'No area selected';
}

async function processSelection(selected) {
  if (busy) return;
  busy = true;
  processing.hidden = false;
  stageHint.style.opacity = '0';
  try {
    const dataUrl = cropSelection(selected);
    const response = await chrome.runtime.sendMessage({
      type: 'NEOSTIX_SELECTOR_RESULT',
      selectorId,
      imageDataUrl: dataUrl
    });
    if (!response?.ok) {
      const error = new Error(
        response?.error?.message || 'The selection could not be processed.'
      );
      error.code = response?.error?.code;
      throw error;
    }
    closing = true;
    closeWindow();
  } catch (error) {
    busy = false;
    processing.hidden = true;
    resetSelection();
    showRetryError(
      'Selection not sent',
      error?.message || 'NeostixSnap could not process this area. Try selecting it again.'
    );
  }
}

function cropSelection(selected) {
  const naturalWidth = shot.naturalWidth;
  const naturalHeight = shot.naturalHeight;
  if (!naturalWidth || !naturalHeight || !imageRect) {
    throw new Error('The screenshot is not ready.');
  }
  const scaleX = naturalWidth / imageRect.width;
  const scaleY = naturalHeight / imageRect.height;
  const left = Math.max(imageRect.x, selected.x);
  const top = Math.max(imageRect.y, selected.y);
  const right = Math.min(imageRect.x + imageRect.width, selected.x + selected.width);
  const bottom = Math.min(imageRect.y + imageRect.height, selected.y + selected.height);

  let sx = Math.max(0, (left - imageRect.x) * scaleX);
  let sy = Math.max(0, (top - imageRect.y) * scaleY);
  let sw = Math.min(naturalWidth - sx, (right - left) * scaleX);
  let sh = Math.min(naturalHeight - sy, (bottom - top) * scaleY);
  if (sw < 2 || sh < 2) throw new Error('Select a slightly larger area.');

  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(shot, sx, sy, sw, sh, 0, 0, width, height);

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

function localPoint(event) {
  const box = stage.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

function clampPoint(point) {
  return {
    x: Math.min(imageRect.x + imageRect.width, Math.max(imageRect.x, point.x)),
    y: Math.min(imageRect.y + imageRect.height, Math.max(imageRect.y, point.y))
  };
}

function normalizeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  };
}

function showFatal(title, text, allowClose = false) {
  loader.hidden = true;
  processing.hidden = true;
  errorTitle.textContent = title;
  errorText.textContent = text;
  errorClose.textContent = allowClose ? 'Close window' : 'Close window';
  errorState.hidden = false;
  busy = true;
  stage.style.cursor = 'default';
}

function showRetryError(title, text) {
  errorTitle.textContent = title;
  errorText.textContent = text;
  errorClose.textContent = 'Select again';
  errorState.hidden = false;
  errorClose.onclick = () => {
    errorState.hidden = true;
    errorClose.onclick = () => closeWindow();
    busy = false;
    stageHint.style.opacity = '1';
  };
}

function cancel() {
  if (closing) return;
  if (busy && !errorState.hidden) {
    closeWindow();
    return;
  }
  if (busy) return;
  closing = true;
  try {
    const promise = chrome.runtime.sendMessage({
      type: 'NEOSTIX_SELECTOR_CANCELLED',
      selectorId
    });
    promise?.catch(() => {});
  } catch {
    // Extension context may have been invalidated.
  }
  closeWindow();
}

function closeWindow() {
  try {
    window.close();
  } catch {
    // Fall back to the windows API below.
  }
  setTimeout(async () => {
    try {
      const current = await chrome.windows.getCurrent();
      if (current?.id) await chrome.windows.remove(current.id);
    } catch {
      // The window is already gone.
    }
  }, 150);
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
}

function onResize() {
  if (busy || !job) return;
  resetSelection();
  updateImageRect();
}
