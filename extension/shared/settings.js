export const SETTINGS_KEY = 'neostix.settings.v1';
export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787';

export const JOB_PREFIX = 'neostix.job.';
export const SELECTOR_PREFIX = 'neostix.selector.';
export const SELECTOR_WINDOW_PREFIX = 'neostix.selectorWindow.';
export const ACTIVE_JOB_KEY = 'neostix.activeJob';
export const LAST_ERROR_KEY = 'neostix.lastError';
export const RESULTS_WINDOW_KEY = 'neostix.resultsWindow';
export const CAPTURE_SESSION_KEY = 'neostix.captureSession';

export const MAX_SELECTION_DATA_URL = 6_500_000;

export const LANGUAGES = Object.freeze([
  { code: 'auto', label: 'Auto · match the question' },
  { code: 'cs', label: 'Čeština' },
  { code: 'sk', label: 'Slovenčina' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'pl', label: 'Polski' },
  { code: 'ru', label: 'Русский' },
  { code: 'uk', label: 'Українська' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' }
]);

export const DEFAULT_SETTINGS = Object.freeze({
  backendUrl: DEFAULT_BACKEND_URL,
  accessToken: '',
  language: 'auto',
  model: ''
});

function isLanguage(code) {
  return LANGUAGES.some((language) => language.code === code);
}

export function normalizeBackendUrl(value) {
  const parsed = parseBackendUrl(value);
  if (!parsed) return DEFAULT_BACKEND_URL;
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
}

export function parseBackendUrl(value) {
  if (typeof value !== 'string') return null;
  let candidate = value.trim();
  if (!candidate) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    url.hash = '';
    url.search = '';
    const pathname = url.pathname.replace(/\/+$/, '');
    return new URL(`${url.origin}${pathname}`);
  } catch {
    return null;
  }
}

export function sanitizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    backendUrl: normalizeBackendUrl(source.backendUrl),
    accessToken:
      typeof source.accessToken === 'string' ? source.accessToken.trim().slice(0, 512) : '',
    language: isLanguage(source.language) ? source.language : 'auto',
    model: typeof source.model === 'string' ? source.model.trim().slice(0, 120) : ''
  };
}

export async function getSettings() {
  try {
    if (!globalThis.chrome?.storage?.local) return { ...DEFAULT_SETTINGS };
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return sanitizeSettings(stored?.[SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = sanitizeSettings({ ...current, ...patch });
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  }
  return next;
}

export function backendOriginPattern(backendUrl) {
  const parsed = parseBackendUrl(backendUrl);
  return parsed ? `${parsed.origin}/*` : null;
}

export async function hasBackendPermission(backendUrl) {
  const pattern = backendOriginPattern(backendUrl);
  if (!pattern) return false;
  try {
    if (!globalThis.chrome?.permissions) return false;
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

export async function requestBackendPermission(backendUrl) {
  const pattern = backendOriginPattern(backendUrl);
  if (!pattern) return false;
  try {
    if (!globalThis.chrome?.permissions) return false;
    // Call request() directly from the user gesture. An intervening await can
    // invalidate the gesture in Chrome and make the permission prompt fail.
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

export function languageLabel(code) {
  return LANGUAGES.find((language) => language.code === code)?.label ?? LANGUAGES[0].label;
}

export function formatShortcut(shortcut) {
  if (!shortcut) return 'Not assigned';
  return shortcut
    .split('+')
    .map((part) => {
      if (part === 'Alt') return 'Alt';
      if (part === 'Ctrl') return 'Ctrl';
      if (part === 'Command') return '⌘';
      if (part === 'MacCtrl') return '⌃';
      if (part === 'Shift') return 'Shift';
      return part;
    })
    .join(' + ');
}
