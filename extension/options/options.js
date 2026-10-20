import {
  DEFAULT_SETTINGS,
  LANGUAGES,
  formatShortcut,
  getSettings,
  hasBackendPermission,
  normalizeBackendUrl,
  parseBackendUrl,
  requestBackendPermission,
  saveSettings
} from '../shared/settings.js';

const HAS_CHROME = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
const HEALTH_TIMEOUT_MS = 4800;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;

const els = {
  form: document.getElementById('settingsForm'),
  backendUrl: document.getElementById('backendUrl'),
  backendUrlError: document.getElementById('backendUrlError'),
  transportWarning: document.getElementById('transportWarning'),
  accessToken: document.getElementById('accessToken'),
  toggleToken: document.getElementById('toggleToken'),
  model: document.getElementById('model'),
  modelError: document.getElementById('modelError'),
  language: document.getElementById('language'),
  permissionCard: document.getElementById('permissionCard'),
  permissionTitle: document.getElementById('permissionTitle'),
  permissionText: document.getElementById('permissionText'),
  permissionBtn: document.getElementById('permissionBtn'),
  saveBtn: document.getElementById('saveBtn'),
  saveLabel: document.getElementById('saveLabel'),
  testBtn: document.getElementById('testBtn'),
  testLabel: document.getElementById('testLabel'),
  resetBtn: document.getElementById('resetBtn'),
  formStatus: document.getElementById('formStatus'),
  healthBadge: document.getElementById('healthBadge'),
  healthEmpty: document.getElementById('healthEmpty'),
  healthDetails: document.getElementById('healthDetails'),
  healthService: document.getElementById('healthService'),
  healthProvider: document.getElementById('healthProvider'),
  healthModel: document.getElementById('healthModel'),
  healthAuth: document.getElementById('healthAuth'),
  healthProblems: document.getElementById('healthProblems'),
  healthProblemsList: document.getElementById('healthProblemsList'),
  healthNote: document.getElementById('healthNote'),
  shortcutKeys: document.getElementById('shortcutKeys'),
  shortcutNote: document.getElementById('shortcutNote'),
  openShortcuts: document.getElementById('openShortcuts'),
  versionLabel: document.getElementById('versionLabel'),
  footerVersion: document.getElementById('footerVersion'),
  profileChip: document.getElementById('profileChip'),
  toast: document.getElementById('toast')
};

const healthEmptyText = els.healthEmpty.querySelector('p');

let currentSettings = { ...DEFAULT_SETTINGS };
let saving = false;
let testing = false;
let permissionTimer = null;
let healthController = null;
let toastTimer = null;

bindEvents();
populateLanguages();
renderVersions();
void init();

async function init() {
  await loadSettingsIntoForm();
  await Promise.allSettled([loadShortcut(), refreshPermission()]);
}

function bindEvents() {
  els.form.addEventListener('submit', onSubmit);
  els.testBtn.addEventListener('click', onTestClick);
  els.resetBtn.addEventListener('click', onReset);
  els.permissionBtn.addEventListener('click', onGrantAccess);
  els.toggleToken.addEventListener('click', toggleToken);
  els.openShortcuts.addEventListener('click', openShortcutSettings);
  els.backendUrl.addEventListener('input', () => {
    clearFieldError(els.backendUrl, els.backendUrlError);
    updateTransportWarning();
    window.clearTimeout(permissionTimer);
    permissionTimer = window.setTimeout(() => {
      void refreshPermission();
    }, 420);
  });
  els.backendUrl.addEventListener('blur', () => {
    void refreshPermission();
  });
  document.addEventListener('click', onDocumentClick);
}

function populateLanguages() {
  const fragment = document.createDocumentFragment();
  for (const language of LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = language.label;
    fragment.appendChild(option);
  }
  els.language.appendChild(fragment);
}

function renderVersions() {
  let version = '1.0.0';
  try {
    version = chrome?.runtime?.getManifest?.()?.version || version;
  } catch {
    // Previewing the page without the extension.
  }
  els.versionLabel.textContent = `v${version}`;
  els.footerVersion.textContent = version;
}

async function loadSettingsIntoForm() {
  currentSettings = await getSettings();
  els.backendUrl.value = currentSettings.backendUrl;
  els.accessToken.value = currentSettings.accessToken;
  els.model.value = currentSettings.model;
  els.language.value = currentSettings.language;
  updateTransportWarning();
}

async function onSubmit(event) {
  event.preventDefault();
  if (saving) return;
  const values = validateForm();
  if (!values) return;

  // Request permissions directly from the user gesture before any await.
  const permissionPromise = requestBackendPermissionFor(values.backendUrl);

  saving = true;
  setSavingUi(true);
  setFormStatus('Saving settings…', 'info');
  try {
    currentSettings = await saveSettings(values);
    fillFromSettings(currentSettings);
    const granted = await permissionPromise;
    await refreshPermission();

    if (!granted) {
      setFormStatus(
        `Settings saved, but Chrome has not granted access to ${hostOf(values.backendUrl)}. Click “Grant access” to allow the connection.`,
        'warn'
      );
      setHealthBadge('warn', 'Permission needed');
      showHealthEmpty('Chrome needs permission before it can contact the backend.');
      return;
    }

    setFormStatus('Settings saved. Checking the backend…', 'success');
    await runHealthCheck(values.backendUrl, values.accessToken);
    if (!els.formStatus.classList.contains('error') && !els.formStatus.classList.contains('warn')) {
      setFormStatus('Settings saved.', 'success');
    }
  } catch {
    setFormStatus('The settings could not be saved. Reload the page and try again.', 'error');
  } finally {
    saving = false;
    setSavingUi(false);
  }
}

async function onTestClick() {
  if (testing) return;
  const values = validateForm();
  if (!values) return;

  // Keep the permission request inside the click gesture.
  const permissionPromise = requestBackendPermissionFor(values.backendUrl);
  testing = true;
  els.testBtn.disabled = true;
  els.testLabel.textContent = 'Testing…';
  try {
    await runHealthCheck(values.backendUrl, values.accessToken, permissionPromise);
  } finally {
    testing = false;
    els.testBtn.disabled = false;
    els.testLabel.textContent = 'Test connection';
  }
}

async function onGrantAccess() {
  const parsed = parseBackendUrl(els.backendUrl.value);
  if (!parsed) {
    setFieldError(
      els.backendUrl,
      els.backendUrlError,
      'Enter a valid http:// or https:// backend address first.'
    );
    refreshPermission();
    return;
  }
  const backendUrl = normalizeBackendUrl(parsed.href);
  els.permissionBtn.disabled = true;
  els.permissionBtn.textContent = 'Requesting…';
  try {
    const granted = await requestBackendPermissionFor(backendUrl);
    await refreshPermission();
    if (granted) {
      showToast(`Chrome access granted for ${hostOf(backendUrl)}.`, 'success');
      setFormStatus('Chrome access granted. Run a connection test to verify the backend.', 'success');
    } else {
      setFormStatus(
        'Chrome did not grant access. Check the prompt or the extension’s site access settings.',
        'warn'
      );
    }
  } finally {
    els.permissionBtn.disabled = false;
    els.permissionBtn.textContent = 'Grant access';
  }
}

async function onReset() {
  if (saving || testing) return;
  const confirmed = window.confirm(
    'Reset the backend URL, access token, model override, and answer language to their defaults?'
  );
  if (!confirmed) return;

  saving = true;
  setSavingUi(true);
  try {
    currentSettings = await saveSettings({ ...DEFAULT_SETTINGS });
    fillFromSettings(currentSettings);
    await refreshPermission();
    resetHealth('Not tested');
    setFormStatus('Defaults restored. The backend URL points to the local server.', 'info');
    showToast('Settings reset to defaults.', 'success');
  } catch {
    setFormStatus('The settings could not be reset.', 'error');
  } finally {
    saving = false;
    setSavingUi(false);
  }
}

function validateForm() {
  clearFieldError(els.backendUrl, els.backendUrlError);
  clearFieldError(els.model, els.modelError);

  const parsed = parseBackendUrl(els.backendUrl.value);
  if (!parsed) {
    setFieldError(
      els.backendUrl,
      els.backendUrlError,
      'Enter a valid http:// or https:// backend address, for example http://127.0.0.1:8787.'
    );
    els.backendUrl.focus();
    return null;
  }

  const accessToken = els.accessToken.value.trim().slice(0, 512);
  const model = els.model.value.trim().slice(0, 120);
  if (model && !MODEL_RE.test(model)) {
    setFieldError(
      els.model,
      els.modelError,
      'Use only letters, numbers, and . _ : / - in the model name.'
    );
    els.model.focus();
    return null;
  }

  const language = LANGUAGES.some((item) => item.code === els.language.value)
    ? els.language.value
    : 'auto';

  return {
    backendUrl: normalizeBackendUrl(parsed.href),
    accessToken,
    model,
    language
  };
}

function fillFromSettings(settings) {
  els.backendUrl.value = settings.backendUrl;
  els.accessToken.value = settings.accessToken;
  els.model.value = settings.model;
  els.language.value = settings.language;
  updateTransportWarning();
}

function setFieldError(input, target, message) {
  input.setAttribute('aria-invalid', 'true');
  target.textContent = message;
  target.hidden = false;
}

function clearFieldError(input, target) {
  input.removeAttribute('aria-invalid');
  target.textContent = '';
  target.hidden = true;
}

function updateTransportWarning() {
  const parsed = parseBackendUrl(els.backendUrl.value);
  if (!parsed) {
    els.transportWarning.hidden = true;
    els.profileChip.textContent = 'No backend';
    els.profileChip.classList.remove('remote');
    return;
  }
  const loopback = isLoopbackHost(parsed.hostname);
  const insecure = parsed.protocol === 'http:' && !loopback;
  els.transportWarning.hidden = !insecure;
  if (insecure) {
    const span = els.transportWarning.querySelector('span');
    if (span) {
      span.textContent = `This remote address (${parsed.host}) is not HTTPS. Screenshots and the access token would travel unencrypted.`;
    }
  }
  els.profileChip.textContent = loopback ? 'Local profile' : 'Remote backend';
  els.profileChip.classList.toggle('remote', !loopback);
}

async function refreshPermission() {
  const parsed = parseBackendUrl(els.backendUrl.value);
  if (!parsed) {
    setPermissionState(
      'error',
      'Backend address needed',
      'Enter a valid backend URL to check Chrome access.',
      false
    );
    return;
  }
  const backendUrl = normalizeBackendUrl(parsed.href);
  const granted = await hasBackendPermission(backendUrl);
  if (granted) {
    setPermissionState(
      'ok',
      'Chrome access granted',
      `NeostixSnap can send screenshots to ${parsed.host}.`,
      false
    );
  } else {
    setPermissionState(
      'warn',
      'Chrome access needed',
      `Grant Chrome access to ${parsed.host} before capturing. The default local server is already allowed.`,
      true
    );
  }
}

function setPermissionState(kind, title, text, showButton) {
  els.permissionCard.className = `access-card ${kind}`;
  els.permissionTitle.textContent = title;
  els.permissionText.textContent = text;
  els.permissionBtn.hidden = !showButton;
}

function requestBackendPermissionFor(backendUrl) {
  try {
    if (!HAS_CHROME) return Promise.resolve(false);
    return requestBackendPermission(backendUrl);
  } catch {
    return Promise.resolve(false);
  }
}

async function runHealthCheck(backendUrl, accessToken, permissionPromise = null) {
  if (healthController) {
    try {
      healthController.abort();
    } catch {
      // Already finished.
    }
  }
  const controller = new AbortController();
  healthController = controller;
  const timeout = window.setTimeout(() => {
    try {
      controller.abort();
    } catch {
      // Already aborted.
    }
  }, HEALTH_TIMEOUT_MS);

  resetHealth('Checking');
  showHealthEmpty('Contacting the backend…');

  try {
    if (permissionPromise) {
      const granted = await permissionPromise;
      if (!granted) {
        setHealthBadge('warn', 'Permission needed');
        showHealthEmpty(
          'Chrome has not granted access to this backend address. Click “Grant access”, then test again.'
        );
        setFormStatus(
          'Chrome needs permission to contact the backend. Use “Grant access” and try again.',
          'warn'
        );
        return;
      }
    }
    if (HAS_CHROME && !(await hasBackendPermission(backendUrl))) {
      setHealthBadge('warn', 'Permission needed');
      showHealthEmpty(
        'Chrome has not granted access to this backend address. Click “Grant access”, then test again.'
      );
      return;
    }

    const headers = { accept: 'application/json' };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;

    let response;
    try {
      response = await fetch(`${backendUrl}/health`, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: controller.signal
      });
    } catch {
      if (controller.signal.aborted) {
        setHealthBadge('error', 'Timed out');
        showHealthEmpty('The backend did not respond within 5 seconds. Check that it is running.');
        setFormStatus('The backend did not answer in time. Check the server and try again.', 'error');
      } else {
        setHealthBadge('error', 'Offline');
        showHealthEmpty(
          `Could not reach ${hostOf(backendUrl)}. Start the server, check the URL, and confirm Chrome access.`
        );
        setFormStatus(
          `Could not reach ${hostOf(backendUrl)}. Start the backend or correct the URL.`,
          'error'
        );
      }
      return;
    }

    const data = await readJson(response);
    if (response.status === 401) {
      setHealthBadge('warn', 'Token rejected');
      showHealthEmpty(
        'The backend is reachable, but it rejected the access token. Make the token match EXTENSION_TOKEN on the server.'
      );
      setFormStatus(
        'The backend rejected the access token. Update it to match EXTENSION_TOKEN.',
        'warn'
      );
      return;
    }
    if (!response.ok || !data) {
      setHealthBadge('error', `HTTP ${response.status}`);
      showHealthEmpty(
        `The backend answered with HTTP ${response.status}. Confirm that the URL points to NeostixSnap.`
      );
      setFormStatus(
        `The backend returned HTTP ${response.status}. Check the URL and server logs.`,
        'error'
      );
      return;
    }

    showHealthDetails(data);
    if (data.ready) {
      setHealthBadge('ok', 'Ready');
      setFormStatus(
        `Connected to ${data.service || 'NeostixSnap'}${
          data.provider ? ` using ${data.provider}` : ''
        }.`,
        'success'
      );
    } else {
      setHealthBadge('warn', 'Needs setup');
      setFormStatus(
        'The backend is reachable but the AI provider is not configured. Check the server environment.',
        'warn'
      );
    }
  } finally {
    window.clearTimeout(timeout);
    if (healthController === controller) healthController = null;
  }
}

function showHealthDetails(data) {
  els.healthEmpty.hidden = true;
  els.healthDetails.hidden = false;
  els.healthService.textContent = [data.service || 'neostixsnap', data.version ? `v${data.version}` : '']
    .filter(Boolean)
    .join(' ');
  els.healthProvider.textContent = data.provider || '—';
  els.healthModel.textContent = data.model || '—';
  els.healthAuth.textContent = data.authRequired ? 'Token required' : 'No token required';

  const problems = Array.isArray(data.problems) ? data.problems.filter(Boolean) : [];
  els.healthProblems.hidden = problems.length === 0;
  els.healthProblemsList.textContent = '';
  for (const problem of problems) {
    const item = document.createElement('li');
    item.textContent = String(problem);
    els.healthProblemsList.appendChild(item);
  }

  if (data.authRequired) {
    els.healthNote.hidden = false;
    els.healthNote.textContent =
      'Health checks are public. The access token is verified when the first screenshot is solved.';
  } else if (!data.ready && problems.length) {
    els.healthNote.hidden = false;
    els.healthNote.textContent = 'Fix these values in the server environment, then restart the backend.';
  } else {
    els.healthNote.hidden = true;
    els.healthNote.textContent = '';
  }
}

function resetHealth(label) {
  setHealthBadge('idle', label);
  els.healthDetails.hidden = true;
  els.healthProblems.hidden = true;
  els.healthProblemsList.textContent = '';
  els.healthEmpty.hidden = false;
  if (healthEmptyText) healthEmptyText.textContent = 'Run a connection test to see the backend status.';
}

function showHealthEmpty(message) {
  els.healthEmpty.hidden = false;
  els.healthDetails.hidden = true;
  els.healthProblems.hidden = true;
  if (healthEmptyText) healthEmptyText.textContent = message;
}

function setHealthBadge(kind, label) {
  els.healthBadge.className = `health-badge ${kind}`;
  els.healthBadge.textContent = label;
}

function setFormStatus(message, kind = 'info') {
  els.formStatus.className = `form-status ${kind}`;
  els.formStatus.textContent = message;
  els.formStatus.hidden = !message;
}

function setSavingUi(active) {
  els.saveBtn.disabled = active;
  els.saveLabel.textContent = active ? 'Saving…' : 'Save settings';
  els.resetBtn.disabled = active;
  els.testBtn.disabled = active || testing;
}

function toggleToken() {
  const show = els.accessToken.type === 'password';
  els.accessToken.type = show ? 'text' : 'password';
  els.toggleToken.setAttribute('aria-pressed', String(show));
  els.toggleToken.setAttribute('aria-label', show ? 'Hide access token' : 'Show access token');
  const eyeShow = els.toggleToken.querySelector('.eye-show');
  const eyeHide = els.toggleToken.querySelector('.eye-hide');
  if (eyeShow) eyeShow.hidden = show;
  if (eyeHide) eyeHide.hidden = !show;
}

async function loadShortcut() {
  if (!HAS_CHROME || !chrome.commands?.getAll) return;
  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((item) => item.name === 'capture-snap');
    if (command?.shortcut) {
      els.shortcutKeys.textContent = formatShortcut(command.shortcut);
      els.shortcutNote.textContent =
        'The shortcut opens the selection overlay directly on the current page.';
    } else {
      els.shortcutKeys.textContent = 'Not assigned';
      els.shortcutNote.textContent =
        'Chrome has not assigned a shortcut. Open Chrome’s shortcut settings and set one.';
    }
  } catch {
    // Keep the suggested Alt+Q label.
  }
}

async function openShortcutSettings() {
  const url = 'chrome://extensions/shortcuts';
  if (HAS_CHROME && chrome.tabs?.create) {
    try {
      await chrome.tabs.create({ url });
      return;
    } catch {
      // Some Chrome builds block opening this page programmatically.
    }
  }
  try {
    await copyText(url);
    showToast(`Chrome blocked the shortcut page. Open ${url} manually in a new tab.`, 'info');
  } catch {
    showToast(`Open ${url} in a new tab to change the shortcut.`, 'info');
  }
}

function onDocumentClick(event) {
  const button = event.target.closest?.('[data-copy]');
  if (!button) return;
  const value = button.getAttribute('data-copy');
  if (!value) return;
  void (async () => {
    try {
      await copyText(value);
      const previous = button.textContent;
      button.textContent = 'Copied';
      showToast('Command copied to the clipboard.', 'success');
      window.setTimeout(() => {
        button.textContent = previous;
      }, 1500);
    } catch {
      showToast('Could not copy the command. Select it manually.', 'error');
    }
  })();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  legacyCopy(text);
}

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Copy command failed');
}

async function readJson(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function showToast(message, kind = 'info') {
  window.clearTimeout(toastTimer);
  els.toast.className = `toast ${kind}`;
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.requestAnimationFrame(() => {
    els.toast.classList.add('show');
  });
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove('show');
    toastTimer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 180);
  }, 2800);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1' ||
    host.endsWith('.localhost')
  );
}
