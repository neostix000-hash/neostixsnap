import {
  formatShortcut,
  getSettings,
  hasBackendPermission
} from '../shared/settings.js';

const statusPill = document.getElementById('statusPill');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const snapBtn = document.getElementById('snapBtn');
const snapLabel = document.getElementById('snapLabel');
const shortcut = document.getElementById('shortcut');
const openSettings = document.getElementById('openSettings');
const errorBox = document.getElementById('errorBox');
const errorText = document.getElementById('errorText');
const errorAction = document.getElementById('errorAction');

let healthState = 'checking';
let healthDetail = '';

openSettings.addEventListener('click', openOptions);
statusPill.addEventListener('click', openOptions);
snapBtn.addEventListener('click', startCapture);
errorAction.addEventListener('click', openOptions);

void init();

async function init() {
  await loadShortcut();
  await refreshHealth();
  snapBtn.focus({ preventScroll: true });
}

async function loadShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((item) => item.name === 'capture-snap');
    shortcut.textContent = command?.shortcut ? formatShortcut(command.shortcut) : 'Not assigned';
  } catch {
    shortcut.textContent = 'Alt + Q';
  }
}

async function refreshHealth() {
  setStatus('checking', 'Checking backend…', 'Checking the configured AI backend');
  const settings = await getSettings();
  let parsed;
  try {
    parsed = new URL(settings.backendUrl);
  } catch {
    setStatus('offline', 'Backend URL invalid', 'Open settings to fix the backend URL');
    healthState = 'offline';
    return;
  }

  if (!(await hasBackendPermission(settings.backendUrl))) {
    setStatus(
      'warn',
      'Backend permission needed',
      `Grant Chrome access to ${parsed.host} in settings`
    );
    healthState = 'permission';
    healthDetail = settings.backendUrl;
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2400);
  try {
    const headers = { accept: 'application/json' };
    if (settings.accessToken) headers.authorization = `Bearer ${settings.accessToken}`;
    const response = await fetch(`${settings.backendUrl}/health`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    healthDetail = [settings.backendUrl, data.provider, data.model].filter(Boolean).join(' · ');
    if (data.ready) {
      healthState = 'online';
      setStatus('online', 'AI backend ready', healthDetail);
    } else {
      healthState = 'warn';
      setStatus('warn', 'AI key not configured', healthDetail);
    }
  } catch {
    healthState = 'offline';
    healthDetail = settings.backendUrl;
    setStatus('offline', 'Backend offline · Set up', healthDetail);
  } finally {
    clearTimeout(timeout);
  }
}

function setStatus(kind, text, title) {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = text;
  statusPill.title = title ? `${title}\nClick to open settings` : 'Click to open settings';
}

async function startCapture() {
  hideError();
  const settings = await getSettings();
  if (!(await hasBackendPermission(settings.backendUrl))) {
    showError(
      'Chrome needs permission to call your backend. Open Settings and save the backend URL once.',
      true
    );
    return;
  }

  snapBtn.disabled = true;
  snapBtn.classList.add('loading');
  snapLabel.textContent = 'Starting capture…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'NEOSTIX_START_CAPTURE' });
    if (!response?.ok) {
      const message =
        response?.error?.help || response?.error?.message || 'The capture could not start.';
      showError(message, isSettingsError(response?.error?.code), response?.error?.message);
      return;
    }
    window.close();
  } catch {
    showError('NeostixSnap could not start the capture. Reload the extension and try again.');
  } finally {
    snapBtn.disabled = false;
    snapBtn.classList.remove('loading');
    snapLabel.textContent = 'Snap & Solve';
  }
}

function isSettingsError(code) {
  return ['permission_denied', 'backend_unreachable', 'unauthorized'].includes(code);
}

function showError(message, withAction = false, title = '') {
  errorText.textContent = message;
  errorBox.title = title || '';
  errorAction.hidden = !withAction;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
  errorAction.hidden = true;
  errorText.textContent = '';
}

async function openOptions() {
  try {
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch {
    showError('Chrome could not open the settings page.');
  }
}
