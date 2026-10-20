import {
  ACTIVE_JOB_KEY,
  CAPTURE_SESSION_KEY,
  DEFAULT_SETTINGS,
  JOB_PREFIX,
  LAST_ERROR_KEY,
  MAX_SELECTION_DATA_URL,
  RESULTS_WINDOW_KEY,
  SELECTOR_PREFIX,
  SELECTOR_WINDOW_PREFIX,
  SETTINGS_KEY,
  getSettings
} from '../shared/settings.js';

const CAPTURE_SESSION_MAX_AGE = 5 * 60 * 1000;
const JOB_MAX_AGE = 20 * 60 * 1000;
const IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\r\n]+$/;
const RESTRICTED_URL_RE =
  /^(chrome|edge|brave|opera|vivaldi|about|view-source|devtools|chrome-extension|moz-extension|chrome-search|chrome-untrusted):/i;
const WEB_STORE_RE = /^https:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;
const EXTENSION_CAPTURE_PAGE_RE = new RegExp(
  `^chrome-extension://${chrome.runtime.id}/(?:results|selector)/`
);

let captureStarting = false;

class CaptureError extends Error {
  constructor(code, message, help = '') {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
    this.help = help;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tabIdOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function sessionGet(keys) {
  try {
    return await chrome.storage.session.get(keys);
  } catch {
    return {};
  }
}

async function sessionSet(values) {
  await chrome.storage.session.set(values);
}

async function sessionRemove(keys) {
  try {
    await chrome.storage.session.remove(keys);
  } catch {
    // Session storage may be gone after a browser restart.
  }
}

function isRestrictedUrl(url) {
  if (!url) return false;
  return RESTRICTED_URL_RE.test(url) || WEB_STORE_RE.test(url);
}

/**
 * Pressing Alt+Q while the results or fallback window is focused should snap
 * the page that produced that window, not the extension page itself.
 */
async function resolveCaptureTab(tab) {
  if (!tab?.id || !tab.url || !EXTENSION_CAPTURE_PAGE_RE.test(tab.url)) {
    return { tab, redirected: false };
  }
  const stored = await sessionGet([ACTIVE_JOB_KEY, LAST_ERROR_KEY]);
  let sourceTabId = null;

  const activeJobId = stored[ACTIVE_JOB_KEY];
  if (activeJobId) {
    const key = JOB_PREFIX + activeJobId;
    const job = (await sessionGet(key))[key];
    sourceTabId = tabIdOrNull(job?.sourceTabId);
  }
  if (!sourceTabId) {
    sourceTabId = tabIdOrNull(stored[LAST_ERROR_KEY]?.sourceTabId);
  }
  if (!sourceTabId) return { tab, redirected: false };

  const sourceTab = await chrome.tabs.get(sourceTabId).catch(() => null);
  return sourceTab?.id ? { tab: sourceTab, redirected: true } : { tab, redirected: false };
}

function toPublicError(error) {
  if (error instanceof CaptureError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.help ? { help: error.help } : {})
    };
  }
  return {
    code: 'capture_failed',
    message: 'NeostixSnap could not capture this page right now.',
    help: 'Try a regular website tab. Chrome blocks screenshots on browser-internal pages, the Web Store, and some protected content.'
  };
}

function errorFromChrome(error) {
  const message = String(error?.message || '');
  if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|captureVisibleTab/i.test(message)) {
    return new CaptureError(
      'capture_rate_limited',
      'Chrome is limiting screenshots. Wait a second and press Alt+Q again.'
    );
  }
  if (/cannot access|cannot be scripted|permission|extensions gallery/i.test(message)) {
    return new CaptureError(
      'page_not_accessible',
      'Chrome does not allow NeostixSnap to read this page.',
      'Open a regular website or document tab and try again. Browser settings pages, the Web Store, and protected DRM content are blocked by Chrome.'
    );
  }
  if (/No tab with id|tab was closed/i.test(message)) {
    return new CaptureError(
      'tab_closed',
      'The page was closed before the screenshot could be taken. Open it again and press Alt+Q.'
    );
  }
  return new CaptureError(
    'capture_failed',
    'The screenshot could not be taken. Try again from a regular website tab.'
  );
}

function validImageDataUrl(value) {
  return (
    typeof value === 'string' &&
    value.length > 100 &&
    value.length <= MAX_SELECTION_DATA_URL &&
    IMAGE_DATA_URL_RE.test(value)
  );
}

async function ensureDefaults() {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    if (!stored?.[SETTINGS_KEY]) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    }
  } catch {
    // Settings can be recreated by the options page.
  }
}

async function configureSessionStorage() {
  try {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    // Older Chrome versions default to trusted-only access.
  }
}

async function cleanupStaleState() {
  try {
    const all = await chrome.storage.session.get(null);
    const now = Date.now();
    const remove = [];
    for (const [key, value] of Object.entries(all || {})) {
      if (key.startsWith(JOB_PREFIX)) {
        if (!value?.createdAt || now - value.createdAt > JOB_MAX_AGE) remove.push(key);
      }
      if (key.startsWith(SELECTOR_PREFIX)) {
        if (!value?.createdAt || now - value.createdAt > JOB_MAX_AGE) remove.push(key);
      }
      if (key === CAPTURE_SESSION_KEY) {
        if (!value?.startedAt || now - value.startedAt > CAPTURE_SESSION_MAX_AGE) remove.push(key);
      }
      if (key === LAST_ERROR_KEY) {
        if (!value?.at || now - value.at > JOB_MAX_AGE) remove.push(key);
      }
    }
    if (remove.length) await sessionRemove(remove);
  } catch {
    // Session storage may be unavailable; no cleanup is necessary.
  }
}

async function prepareExtension() {
  await ensureDefaults();
  await configureSessionStorage();
  await cleanupStaleState();
}

void prepareExtension();

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await prepareExtension();
    if (details.reason === 'install') {
      try {
        await chrome.runtime.openOptionsPage();
      } catch {
        // The popup also provides a settings link.
      }
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void prepareExtension();
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'capture-snap') return;
  void startCapture({ notifyErrors: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || sender.id !== chrome.runtime.id) return false;

  switch (message.type) {
    case 'NEOSTIX_START_CAPTURE': {
      startCapture({
        sourceTabId: tabIdOrNull(message.sourceTabId),
        sourceWindowId: tabIdOrNull(message.sourceWindowId),
        notifyErrors: false
      }).then(sendResponse);
      return true;
    }
    case 'NEOSTIX_CAPTURE_RESULT': {
      handleOverlayResult(message, sender)
        .then(sendResponse)
        .catch(async (error) => {
          const safe = toPublicError(error);
          sendResponse({ ok: false, error: safe });
          await showErrorWindow(safe, {
            sourceTabId: sender.tab?.id,
            sourceWindowId: sender.tab?.windowId
          });
        });
      return true;
    }
    case 'NEOSTIX_CAPTURE_CANCELLED': {
      sessionRemove([CAPTURE_SESSION_KEY]).then(() => sendResponse({ ok: true }));
      return true;
    }
    case 'NEOSTIX_OVERLAY_ERROR': {
      const safe = {
        code: 'overlay_failed',
        message: 'The selection overlay could not start on this page.',
        help: 'Try again. If Chrome blocks overlays on this page, open the exercise in a regular tab.'
      };
      sessionRemove([CAPTURE_SESSION_KEY]).then(() =>
        showErrorWindow(safe, {
          sourceTabId: sender.tab?.id,
          sourceWindowId: sender.tab?.windowId
        })
      );
      sendResponse({ ok: true });
      return false;
    }
    case 'NEOSTIX_SELECTOR_RESULT': {
      handleSelectorResult(message, sender)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ ok: false, error: toPublicError(error) });
        });
      return true;
    }
    case 'NEOSTIX_SELECTOR_CANCELLED': {
      (async () => {
        if (sender.tab?.windowId) {
          await cleanupSelectorWindow(sender.tab.windowId);
        } else {
          await sessionRemove([CAPTURE_SESSION_KEY]);
        }
        sendResponse({ ok: true });
      })();
      return true;
    }
    default:
      return false;
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  void handleWindowRemoved(windowId);
});

async function startCapture({ sourceTabId = null, sourceWindowId = null, notifyErrors = false } = {}) {
  if (captureStarting) {
    return {
      ok: false,
      error: {
        code: 'busy',
        message: 'A NeostixSnap capture is already starting. Try again in a moment.'
      }
    };
  }

  const storedSession = (await sessionGet(CAPTURE_SESSION_KEY))[CAPTURE_SESSION_KEY];
  if (storedSession && Date.now() - storedSession.startedAt < CAPTURE_SESSION_MAX_AGE) {
    if (storedSession.tabId) {
      try {
        await chrome.tabs.sendMessage(storedSession.tabId, { type: 'NEOSTIX_FLASH' });
      } catch {
        // The overlay may belong to a closed tab.
      }
    }
    return {
      ok: false,
      error: {
        code: 'selection_active',
        message: 'Finish or cancel the current selection first.',
        help: 'Press Esc to cancel the active selection.'
      }
    };
  }
  if (storedSession) await sessionRemove(CAPTURE_SESSION_KEY);

  captureStarting = true;
  let sourceTab = null;
  try {
    let tab = sourceTabId ? await chrome.tabs.get(sourceTabId).catch(() => null) : null;
    if (!tab) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const resolved = await resolveCaptureTab(activeTab || null);
      tab = resolved.tab;
      if (resolved.redirected && tab?.windowId) {
        sourceWindowId = tab.windowId;
      }
    }
    sourceTab = tab;
    if (!tab?.id) {
      throw new CaptureError(
        'no_active_tab',
        'No active page was found. Open the exercise in a normal Chrome tab and press Alt+Q.'
      );
    }
    if (isRestrictedUrl(tab.url)) {
      throw new CaptureError(
        'restricted_page',
        'Chrome does not allow NeostixSnap to capture this page.',
        'Open a regular website or document tab. Browser pages (chrome://), the Chrome Web Store, and protected content are blocked by Chrome.'
      );
    }

    if (sourceWindowId) {
      await chrome.windows.update(sourceWindowId, { focused: true }).catch(() => {});
    }
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    await sleep(sourceWindowId ? 240 : 100);

    const settings = await getSettings();
    let screenshot;
    try {
      screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (error) {
      throw errorFromChrome(error);
    }

    await sessionSet({
      [CAPTURE_SESSION_KEY]: {
        tabId: tab.id,
        windowId: tab.windowId,
        startedAt: Date.now(),
        phase: 'selecting',
        language: settings.language
      }
    });

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/overlay.js']
      });
      const response = await chrome.tabs.sendMessage(
        tab.id,
        {
          type: 'NEOSTIX_SHOW_OVERLAY',
          screenshot,
          language: settings.language
        },
        { frameId: 0 }
      );
      if (response && response.ok === false) {
        if (response.error === 'already_active') {
          throw new CaptureError(
            'selection_active',
            'A selection is already active on this page.',
            'Press Esc to cancel it, then press Alt+Q again.'
          );
        }
        throw new Error(response.message || 'The overlay could not start.');
      }
      return { ok: true, mode: 'overlay' };
    } catch (overlayError) {
      if (overlayError instanceof CaptureError) {
        await sessionRemove(CAPTURE_SESSION_KEY);
        throw overlayError;
      }
      await openFallbackSelector({
        screenshot,
        tab,
        language: settings.language
      });
      return { ok: true, mode: 'selector' };
    }
  } catch (error) {
    await sessionRemove(CAPTURE_SESSION_KEY);
    const safe = toPublicError(error);
    if (notifyErrors) {
      await showErrorWindow(safe, {
        sourceTabId: sourceTab?.id ?? sourceTabId,
        sourceWindowId: sourceTab?.windowId ?? sourceWindowId
      });
    }
    return { ok: false, error: safe };
  } finally {
    captureStarting = false;
  }
}

async function handleOverlayResult(message, sender) {
  const session = (await sessionGet(CAPTURE_SESSION_KEY))[CAPTURE_SESSION_KEY];
  if (!session || !sender.tab || sender.tab.id !== session.tabId) {
    throw new CaptureError(
      'stale_capture',
      'That selection expired. Take a new screenshot with Alt+Q.'
    );
  }
  if (!validImageDataUrl(message.imageDataUrl)) {
    throw new CaptureError(
      'invalid_capture',
      'The selected area could not be prepared.',
      'Try selecting a slightly larger area or lowering the browser zoom.'
    );
  }

  try {
    await finalizeCapture({
      imageDataUrl: message.imageDataUrl,
      sourceTabId: session.tabId,
      sourceWindowId: session.windowId
    });
  } finally {
    await sessionRemove(CAPTURE_SESSION_KEY);
  }
  return { ok: true };
}

async function finalizeCapture({ imageDataUrl, sourceTabId, sourceWindowId }) {
  if (!validImageDataUrl(imageDataUrl)) {
    throw new CaptureError('invalid_capture', 'The selected screenshot is not valid.');
  }
  const settings = await getSettings();
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    imageDataUrl,
    language: settings.language,
    sourceTabId: sourceTabId ?? null,
    sourceWindowId: sourceWindowId ?? null,
    createdAt: Date.now()
  };

  await cleanupJobs({ force: true });
  try {
    await sessionSet({ [JOB_PREFIX + jobId]: job });
  } catch {
    await cleanupJobs({ force: true });
    try {
      await sessionSet({ [JOB_PREFIX + jobId]: job });
    } catch {
      throw new CaptureError(
        'storage_full',
        'The selection is too large to process.',
        'Select a smaller area and try again.'
      );
    }
  }

  await sessionSet({ [ACTIVE_JOB_KEY]: jobId });
  await presentResults(jobId);
}

async function presentResults(jobId) {
  const resultsUrl = chrome.runtime.getURL(
    `results/results.html?job=${encodeURIComponent(jobId)}`
  );
  const stored = await sessionGet(RESULTS_WINDOW_KEY);
  const windowId = stored[RESULTS_WINDOW_KEY];
  const existing = windowId ? await chrome.windows.get(windowId).catch(() => null) : null;

  if (existing?.id) {
    const delivered = await broadcast({ type: 'NEOSTIX_JOB_READY', jobId });
    if (!delivered) {
      try {
        const tabs = await chrome.tabs.query({ windowId: existing.id });
        if (tabs[0]?.id) await chrome.tabs.update(tabs[0].id, { url: resultsUrl });
      } catch {
        // If the window is not usable, a new one is opened below.
      }
    }
    await chrome.windows.update(existing.id, { focused: true, drawAttention: true }).catch(() => {});
    return;
  }

  const created = await chrome.windows.create({
    url: resultsUrl,
    type: 'popup',
    width: 500,
    height: 740,
    focused: true
  });
  if (created?.id) {
    await sessionSet({ [RESULTS_WINDOW_KEY]: created.id });
  }
}

async function showErrorWindow(publicError, { sourceTabId = null, sourceWindowId = null } = {}) {
  const safe = {
    code: String(publicError?.code || 'capture_failed').slice(0, 80),
    message: String(publicError?.message || 'The capture could not be completed.').slice(0, 600),
    ...(publicError?.help ? { help: String(publicError.help).slice(0, 600) } : {}),
    ...(tabIdOrNull(sourceTabId) ? { sourceTabId: tabIdOrNull(sourceTabId) } : {}),
    ...(tabIdOrNull(sourceWindowId) ? { sourceWindowId: tabIdOrNull(sourceWindowId) } : {})
  };
  await sessionSet({ [LAST_ERROR_KEY]: { ...safe, at: Date.now() } });

  const resultsUrl = chrome.runtime.getURL('results/results.html?error=1');
  const stored = await sessionGet(RESULTS_WINDOW_KEY);
  const existing = stored[RESULTS_WINDOW_KEY]
    ? await chrome.windows.get(stored[RESULTS_WINDOW_KEY]).catch(() => null)
    : null;

  if (existing?.id) {
    const delivered = await broadcast({ type: 'NEOSTIX_ERROR_READY', error: safe });
    if (!delivered) {
      try {
        const tabs = await chrome.tabs.query({ windowId: existing.id });
        if (tabs[0]?.id) await chrome.tabs.update(tabs[0].id, { url: resultsUrl });
      } catch {
        // Fall through and focus the existing window.
      }
    }
    await chrome.windows.update(existing.id, { focused: true, drawAttention: true }).catch(() => {});
    return;
  }

  const created = await chrome.windows.create({
    url: resultsUrl,
    type: 'popup',
    width: 500,
    height: 740,
    focused: true
  });
  if (created?.id) {
    await sessionSet({ [RESULTS_WINDOW_KEY]: created.id });
  }
}

async function openFallbackSelector({ screenshot, tab, language }) {
  const prepared = await prepareFallbackScreenshot(screenshot);
  const selectorId = crypto.randomUUID();
  await sessionSet({
    [SELECTOR_PREFIX + selectorId]: {
      imageDataUrl: prepared,
      sourceTabId: tab.id,
      sourceWindowId: tab.windowId,
      language,
      createdAt: Date.now()
    },
    [CAPTURE_SESSION_KEY]: {
      tabId: tab.id,
      windowId: tab.windowId,
      startedAt: Date.now(),
      phase: 'selector',
      language
    }
  });

  let created;
  try {
    created = await chrome.windows.create({
      url: chrome.runtime.getURL(`selector/selector.html?id=${encodeURIComponent(selectorId)}`),
      type: 'popup',
      width: 1120,
      height: 820,
      focused: true
    });
  } catch (error) {
    await sessionRemove([SELECTOR_PREFIX + selectorId, CAPTURE_SESSION_KEY]);
    throw new CaptureError(
      'selector_failed',
      'The selection window could not open.',
      'Try again from a regular website tab.'
    );
  }
  if (!created?.id) {
    await sessionRemove([SELECTOR_PREFIX + selectorId, CAPTURE_SESSION_KEY]);
    throw new CaptureError('selector_failed', 'The selection window could not open.');
  }
  await sessionSet({ [SELECTOR_WINDOW_PREFIX + created.id]: selectorId });
}

async function handleSelectorResult(message, sender) {
  const selectorId = String(message.selectorId || '');
  if (!/^[a-f0-9-]{36}$/i.test(selectorId)) {
    throw new CaptureError('invalid_selection', 'The selection could not be identified.');
  }
  const stored = (await sessionGet(SELECTOR_PREFIX + selectorId))[SELECTOR_PREFIX + selectorId];
  if (!stored) {
    throw new CaptureError(
      'expired_selection',
      'That selection expired. Take a new screenshot with Alt+Q.'
    );
  }
  if (!validImageDataUrl(message.imageDataUrl)) {
    throw new CaptureError(
      'invalid_capture',
      'The selected area could not be prepared. Try a slightly larger area.'
    );
  }

  await finalizeCapture({
    imageDataUrl: message.imageDataUrl,
    sourceTabId: stored.sourceTabId,
    sourceWindowId: stored.sourceWindowId
  });

  await sessionRemove([SELECTOR_PREFIX + selectorId, CAPTURE_SESSION_KEY]);
  if (sender.tab?.windowId) {
    await sessionRemove(SELECTOR_WINDOW_PREFIX + sender.tab.windowId);
  }
  return { ok: true };
}

async function cleanupSelectorWindow(windowId) {
  const key = SELECTOR_WINDOW_PREFIX + windowId;
  const stored = await sessionGet(key);
  const selectorId = stored?.[key];
  const keys = [key, CAPTURE_SESSION_KEY];
  if (selectorId) keys.push(SELECTOR_PREFIX + selectorId);
  await sessionRemove(keys);
}

async function handleWindowRemoved(windowId) {
  const stored = await sessionGet([
    RESULTS_WINDOW_KEY,
    ACTIVE_JOB_KEY,
    SELECTOR_WINDOW_PREFIX + windowId
  ]);

  if (stored[RESULTS_WINDOW_KEY] === windowId) {
    const keys = [RESULTS_WINDOW_KEY, ACTIVE_JOB_KEY];
    if (stored[ACTIVE_JOB_KEY]) keys.push(JOB_PREFIX + stored[ACTIVE_JOB_KEY]);
    await sessionRemove(keys);
  }

  const selectorKey = SELECTOR_WINDOW_PREFIX + windowId;
  const selectorId = stored[selectorKey];
  if (selectorId) {
    await sessionRemove([selectorKey, SELECTOR_PREFIX + selectorId]);
    const session = (await sessionGet(CAPTURE_SESSION_KEY))[CAPTURE_SESSION_KEY];
    if (session?.phase === 'selector') await sessionRemove(CAPTURE_SESSION_KEY);
  }
}

async function cleanupJobs({ force = false } = {}) {
  try {
    const all = await chrome.storage.session.get(null);
    const now = Date.now();
    const remove = [];
    for (const [key, value] of Object.entries(all || {})) {
      if (!key.startsWith(JOB_PREFIX)) continue;
      if (force || !value?.createdAt || now - value.createdAt > JOB_MAX_AGE) {
        remove.push(key);
      }
    }
    if (remove.length) await sessionRemove(remove);
  } catch {
    // Best-effort cleanup only.
  }
}

async function broadcast(message) {
  try {
    await chrome.runtime.sendMessage(message);
    return true;
  } catch {
    return false;
  }
}

async function prepareFallbackScreenshot(dataUrl) {
  if (dataUrl.length <= Math.floor(MAX_SELECTION_DATA_URL * 0.85)) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const maxSide = 2200;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const out = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = new Uint8Array(await out.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      binary += String.fromCharCode(...buffer.subarray(offset, offset + chunkSize));
    }
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    throw new CaptureError(
      'capture_too_large',
      'This screenshot is too large to process.',
      'Try a lower browser zoom or a smaller display area.'
    );
  }
}
