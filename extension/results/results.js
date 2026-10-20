import {
  JOB_PREFIX,
  LANGUAGES,
  LAST_ERROR_KEY,
  getSettings,
  hasBackendPermission,
  saveSettings
} from '../shared/settings.js';

const HAS_CHROME = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
const JOB_MAX_AGE = 20 * 60 * 1000;
const SOLVE_TIMEOUT_MS = 125_000;
const STAGE_INTERVAL_MS = 4300;

const STAGES = [
  'Reading the screenshot…',
  'Identifying the subject…',
  'Working through the solution…',
  'Checking the answer for mistakes…'
];

const SUBJECT_GLYPHS = [
  [/math|matemat|algebra|geometr/i, '∑'],
  [/czech|česk|cesk|slovak|sloven/i, 'Č'],
  [/english|language|jazyk|deutsch|french|spanish|italian|russian|anglič|anglic/i, 'Aa'],
  [/phys|fyz/i, '⚛'],
  [/chem/i, '⚗'],
  [/bio|přírod|prirod/i, '❋'],
  [/history|dějep|dejep|histor/i, '⌛'],
  [/geograph|zeměp|zemep|map/i, '◉'],
  [/literat|reading|čten|cten/i, '❝'],
  [/computer|informat|program|algorithm|code/i, '</>'],
  [/music|hudb/i, '♪'],
  [/art|výtv|vytv|draw/i, '◈'],
  [/general|knowledge|všeobec|vseobec/i, '✧']
];

const ERROR_COPY = {
  missing_job: {
    kicker: 'Capture missing',
    title: 'No screenshot was found',
    help: 'Close this window and press Alt+Q to snap a new exercise.'
  },
  expired_capture: {
    kicker: 'Capture expired',
    title: 'This capture is no longer available',
    help: 'Screenshots are kept only briefly in memory. Close this window and press Alt+Q to take a new one.'
  },
  permission_needed: {
    kicker: 'Settings needed',
    title: 'Chrome needs permission to reach your backend',
    help: 'Open Settings, check the backend URL, and click Save. Chrome will ask for access to that address.'
  },
  backend_unreachable: {
    kicker: 'Connection problem',
    title: 'The AI backend is unreachable',
    help: 'Start the NeostixSnap server and confirm that the backend URL in Settings is correct. The default local address is http://127.0.0.1:8787.'
  },
  timeout: {
    kicker: 'Request timed out',
    title: 'The answer took too long',
    help: 'Check the server connection and try again. A smaller selection or a faster vision model can also help.'
  },
  unauthorized: {
    kicker: 'Settings needed',
    title: 'The backend rejected the access token',
    help: 'Open Settings and make sure the access token matches EXTENSION_TOKEN in the server configuration.'
  },
  rate_limited: {
    kicker: 'Slow down',
    title: 'Too many requests',
    help: 'Wait a moment, then press Try again.'
  },
  ai_rate_limited: {
    kicker: 'AI provider busy',
    title: 'The AI provider is rate-limiting requests',
    help: 'Wait a little, then regenerate. If this happens often, raise the provider quota or switch AI_MODEL.'
  },
  ai_timeout: {
    kicker: 'AI provider timeout',
    title: 'The AI took too long to answer',
    help: 'Try again, select a smaller area, or increase AI_TIMEOUT_MS on the server.'
  },
  server_misconfigured: {
    kicker: 'Server setup',
    title: 'The AI backend is not configured yet',
    help: 'Set AI_PROVIDER, AI_MODEL, and AI_API_KEY in the server environment, then restart it.'
  },
  ai_auth_error: {
    kicker: 'Server setup',
    title: 'The AI provider rejected the server key',
    help: 'Check AI_API_KEY on the server and restart it. The key never leaves the backend.'
  },
  ai_unreachable: {
    kicker: 'AI provider offline',
    title: 'The backend could not reach the AI provider',
    help: 'Check the server’s internet connection, AI_BASE_URL, and provider settings.'
  },
  ai_unavailable: {
    kicker: 'AI provider offline',
    title: 'The AI provider is unavailable',
    help: 'Wait a moment and try again. If the problem continues, check the provider status page.'
  },
  ai_invalid_output: {
    kicker: 'Unreadable AI response',
    title: 'The AI response could not be read',
    help: 'Press Try again or Regenerate to request a fresh answer.'
  },
  ai_rejected: {
    kicker: 'AI request rejected',
    title: 'The AI provider rejected the request',
    help: 'Try a smaller, clearer capture. If you set a custom model, verify that it supports images.'
  },
  invalid_image: {
    kicker: 'Capture problem',
    title: 'The screenshot could not be read',
    help: 'Take a new capture and select a slightly larger area.'
  },
  payload_too_large: {
    kicker: 'Capture too large',
    title: 'The screenshot is too large',
    help: 'Select a smaller area, lower the browser zoom, or raise MAX_IMAGE_BYTES on the server.'
  },
  busy: {
    kicker: 'Solver busy',
    title: 'The backend is handling too many requests',
    help: 'Wait a moment and try again.'
  },
  origin_not_allowed: {
    kicker: 'Server setup',
    title: 'The backend blocked this extension',
    help: 'ALLOWED_ORIGINS is configured on the server. Add this extension’s origin, or leave ALLOWED_ORIGINS empty to accept extension origins.'
  },
  client_model_not_allowed: {
    kicker: 'Settings needed',
    title: 'The backend does not allow model overrides',
    help: 'Clear the model field in Settings, or set ALLOW_CLIENT_MODEL=true on the server.'
  },
  invalid_language: {
    kicker: 'Settings needed',
    title: 'That answer language is not supported',
    help: 'Choose a different language and regenerate.'
  },
  invalid_response: {
    kicker: 'Unexpected response',
    title: 'The backend returned an unexpected response',
    help: 'Make sure the backend URL points to NeostixSnap, not another service, and try again.'
  },
  capture_failed: {
    kicker: 'Capture problem',
    title: 'The screenshot could not be taken',
    help: 'Try again from a regular website tab. Chrome blocks screenshots on browser pages, the Web Store, and some protected content.'
  },
  restricted_page: {
    kicker: 'Page not supported',
    title: 'Chrome does not allow capturing this page',
    help: 'Open the exercise in a regular website or document tab, then press Alt+Q.'
  },
  page_not_accessible: {
    kicker: 'Page not supported',
    title: 'Chrome does not allow reading this page',
    help: 'Browser settings pages, the Web Store, and protected content are blocked by Chrome. Try a regular website tab.'
  },
  no_active_tab: {
    kicker: 'No page found',
    title: 'No active page was found',
    help: 'Open the exercise in a normal Chrome tab and press Alt+Q.'
  },
  selection_active: {
    kicker: 'Selection in progress',
    title: 'A selection is already active',
    help: 'Press Esc to cancel the current selection, then press Alt+Q again.'
  },
  capture_rate_limited: {
    kicker: 'Just a moment',
    title: 'Chrome is limiting screenshots',
    help: 'Wait a second and press Alt+Q again.'
  },
  tab_closed: {
    kicker: 'Page closed',
    title: 'The page was closed during capture',
    help: 'Open the exercise again and press Alt+Q.'
  },
  storage_full: {
    kicker: 'Capture too large',
    title: 'The selection could not be held in memory',
    help: 'Select a smaller area and try again.'
  },
  invalid_capture: {
    kicker: 'Capture problem',
    title: 'The selected area could not be prepared',
    help: 'Select a slightly larger area and try again.'
  },
  stale_capture: {
    kicker: 'Capture expired',
    title: 'That selection expired',
    help: 'Press Alt+Q to take a new screenshot.'
  },
  overlay_failed: {
    kicker: 'Capture problem',
    title: 'The selection overlay could not start',
    help: 'Try again. If Chrome blocks overlays on this page, open the exercise in a regular tab.'
  },
  selector_failed: {
    kicker: 'Capture problem',
    title: 'The selection window could not open',
    help: 'Try again from a regular website tab.'
  }
};

const params = new URLSearchParams(window.location.search);
const els = {
  main: document.getElementById('main'),
  loadingView: document.getElementById('loadingView'),
  resultView: document.getElementById('resultView'),
  errorView: document.getElementById('errorView'),
  previewCard: document.getElementById('previewCard'),
  previewImage: document.getElementById('previewImage'),
  loadingTitle: document.getElementById('loadingTitle'),
  loadingStage: document.getElementById('loadingStage'),
  subjectBadge: document.getElementById('subjectBadge'),
  subjectIcon: document.getElementById('subjectIcon'),
  subjectText: document.getElementById('subjectText'),
  confidenceBadge: document.getElementById('confidenceBadge'),
  questionText: document.getElementById('questionText'),
  expandQuestion: document.getElementById('expandQuestion'),
  warningBox: document.getElementById('warningBox'),
  warningText: document.getElementById('warningText'),
  answerCard: document.getElementById('answerCard'),
  answerText: document.getElementById('answerText'),
  answerMeta: document.getElementById('answerMeta'),
  itemsList: document.getElementById('itemsList'),
  stepsBox: document.getElementById('stepsBox'),
  stepsList: document.getElementById('stepsList'),
  stepCount: document.getElementById('stepCount'),
  clarifyBox: document.getElementById('clarifyBox'),
  clarifyTitle: document.getElementById('clarifyTitle'),
  clarifyText: document.getElementById('clarifyText'),
  clarifyTips: document.querySelector('.clarify-tips'),
  clarifySnap: document.getElementById('clarifySnap'),
  clarifyRetry: document.getElementById('clarifyRetry'),
  errorKicker: document.getElementById('errorKicker'),
  errorTitle: document.getElementById('errorTitle'),
  errorMessage: document.getElementById('errorMessage'),
  errorHelp: document.getElementById('errorHelp'),
  errorRetry: document.getElementById('errorRetry'),
  errorSnap: document.getElementById('errorSnap'),
  errorSettings: document.getElementById('errorSettings'),
  errorClose: document.getElementById('errorClose'),
  errorCodeRow: document.getElementById('errorCodeRow'),
  errorCode: document.getElementById('errorCode'),
  footer: document.getElementById('footer'),
  languageSelect: document.getElementById('languageSelect'),
  langHint: document.getElementById('langHint'),
  snapAnother: document.getElementById('snapAnother'),
  snapAnotherLabel: document.getElementById('snapAnotherLabel'),
  copyAnswer: document.getElementById('copyAnswer'),
  copyLabel: document.getElementById('copyLabel'),
  regenerate: document.getElementById('regenerate'),
  toast: document.getElementById('toast'),
  openSettings: document.getElementById('openSettings'),
  closeWindow: document.getElementById('closeWindow')
};

let settings = null;
let job = null;
let jobId = params.get('job');
let solvedLanguage = 'auto';
let lastResult = null;
let lastMeta = null;
let requestController = null;
let solveToken = 0;
let busy = false;
let startingCapture = false;
let stageTimer = null;
let stageIndex = 0;
let toastTimer = null;
let copyTimer = null;
let questionClampable = false;
let lastErrorInfo = null;

bindEvents();
populateLanguages();
void init();

function bindEvents() {
  els.openSettings.addEventListener('click', openOptions);
  els.closeWindow.addEventListener('click', closeWindow);
  els.copyAnswer.addEventListener('click', copyResult);
  els.regenerate.addEventListener('click', () => {
    if (job && !busy) void solve({ regenerate: true });
  });
  els.snapAnother.addEventListener('click', snapAnother);
  els.clarifySnap.addEventListener('click', snapAnother);
  els.clarifyRetry.addEventListener('click', () => {
    if (job && !busy) void solve({ regenerate: true });
  });
  els.errorRetry.addEventListener('click', () => {
    if (job && !busy) void solve({ regenerate: true });
  });
  els.errorSnap.addEventListener('click', snapAnother);
  els.errorSettings.addEventListener('click', openOptions);
  els.errorClose.addEventListener('click', closeWindow);
  els.expandQuestion.addEventListener('click', toggleQuestion);
  els.languageSelect.addEventListener('change', onLanguageChange);
  els.previewImage.addEventListener('error', () => {
    els.previewImage.hidden = true;
  });
  window.addEventListener('resize', () => {
    window.requestAnimationFrame(updateQuestionClamp);
  });
  window.addEventListener('beforeunload', () => {
    try {
      requestController?.abort();
    } catch {
      // The page is closing anyway.
    }
  });
  if (HAS_CHROME) {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  }
}

async function init() {
  try {
    settings = await getSettings();
  } catch {
    settings = null;
  }
  const preferred = settings?.language || 'auto';
  els.languageSelect.value = preferred;
  solvedLanguage = preferred;

  if (params.get('error') === '1') {
    await loadStartupError();
    return;
  }
  if (!jobId) {
    showError(
      {
        code: 'missing_job',
        message: 'The results window was opened without a screenshot reference.'
      },
      { canRetry: false }
    );
    return;
  }
  await loadJob(jobId);
}

function populateLanguages() {
  const fragment = document.createDocumentFragment();
  for (const language of LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = language.label;
    fragment.appendChild(option);
  }
  els.languageSelect.appendChild(fragment);
  els.languageSelect.value = 'auto';
}

async function loadJob(id) {
  cancelSolve();
  resetResultState();
  showLoading('Solving your question', STAGES[0]);
  jobId = id;

  let stored = null;
  try {
    if (HAS_CHROME) {
      const key = JOB_PREFIX + id;
      stored = await chrome.storage.session.get(key);
      job = stored?.[key] || null;
    }
  } catch {
    job = null;
  }

  if (!job || typeof job.imageDataUrl !== 'string' || job.imageDataUrl.length < 100) {
    job = null;
    showError(
      {
        code: 'expired_capture',
        message: 'This screenshot is no longer in memory. It may have expired or the window was reopened later.'
      },
      { canRetry: false }
    );
    return;
  }
  if (job.createdAt && Date.now() - job.createdAt > JOB_MAX_AGE) {
    job = null;
    showError(
      {
        code: 'expired_capture',
        message: 'This screenshot has expired.'
      },
      { canRetry: false }
    );
    return;
  }

  const language = isLanguage(job.language) ? job.language : settings?.language || 'auto';
  els.languageSelect.value = language;
  solvedLanguage = language;
  lastErrorInfo = null;

  showPreview(job.imageDataUrl);
  updateFooterState();
  await solve({ regenerate: false });
}

async function solve({ regenerate = false } = {}) {
  if (!job) return;
  if (busy) return;
  if (!settings) {
    settings = await getSettings();
  }

  const token = ++solveToken;
  busy = true;
  lastResult = null;
  lastMeta = null;
  updateFooterState();
  showLoading(
    regenerate ? 'Regenerating the answer' : 'Solving your question',
    STAGES[0]
  );
  startStages();

  const language = isLanguage(els.languageSelect.value)
    ? els.languageSelect.value
    : 'auto';

  const controller = new AbortController();
  requestController = controller;
  const timeout = window.setTimeout(() => {
    try {
      controller.abort();
    } catch {
      // Already aborted.
    }
  }, SOLVE_TIMEOUT_MS);

  try {
    if (HAS_CHROME && !(await hasBackendPermission(settings.backendUrl))) {
      throw appError(
        'permission_needed',
        `Chrome has not granted access to ${hostOf(settings.backendUrl)}.`
      );
    }
    if (token !== solveToken) return;

    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-neostix-client': 'extension'
    };
    if (settings.accessToken) {
      headers.authorization = `Bearer ${settings.accessToken}`;
    }
    const body = {
      image: job.imageDataUrl,
      language,
      regenerate: Boolean(regenerate)
    };
    if (settings.model) body.model = settings.model;

    let response;
    try {
      response = await fetch(`${settings.backendUrl}/api/solve`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal
      });
    } catch (error) {
      if (token !== solveToken) return;
      if (controller.signal.aborted) {
        throw appError(
          'timeout',
          'The backend did not answer in time. It may be starting up or the AI provider may be slow.'
        );
      }
      throw appError(
        'backend_unreachable',
        `NeostixSnap could not reach ${settings.backendUrl}.`
      );
    }

    const data = await readJson(response);
    if (token !== solveToken) return;

    if (!response.ok) {
      const serverError = data?.error || {};
      throw appError(
        serverError.code || `http_${response.status}`,
        serverError.message || `The backend returned HTTP ${response.status}.`,
        serverError.help || '',
        { retryAfter: serverError.retryAfter }
      );
    }
    if (!data || !data.result || typeof data.result !== 'object') {
      throw appError(
        'invalid_response',
        'The backend answered, but the response did not contain an answer.'
      );
    }

    lastResult = data.result;
    lastMeta = data.meta || null;
    solvedLanguage = language;
    renderResult(data.result, data.meta);
    showView('result');
    updateFooterState();
    window.requestAnimationFrame(updateQuestionClamp);
  } catch (error) {
    if (token !== solveToken) return;
    const described = describeError(error);
    if (described.retryAfter) {
      described.message = `${described.message} Try again in ${described.retryAfter} s.`.trim();
    }
    showError(described, { canRetry: Boolean(job) });
  } finally {
    window.clearTimeout(timeout);
    if (requestController === controller) requestController = null;
    if (token === solveToken) {
      stopStages();
      busy = false;
      updateFooterState();
    }
  }
}

function renderResult(result, meta) {
  const status = result.status || 'answered';
  const answer = typeof result.answer === 'string' ? result.answer.trim() : '';
  const question =
    typeof result.recognized_question === 'string'
      ? result.recognized_question.trim()
      : '';
  const steps = Array.isArray(result.steps)
    ? result.steps.filter((step) => typeof step === 'string' && step.trim())
    : [];
  const items = Array.isArray(result.items)
    ? result.items.filter(
        (item) =>
          item &&
          typeof item === 'object' &&
          (String(item.question || '').trim() || String(item.answer || '').trim())
      )
    : [];

  els.subjectText.textContent = result.subject || 'General';
  els.subjectIcon.textContent = subjectGlyph(result.subject);
  renderConfidence(result.confidence);
  renderQuestion(question);
  renderWarning(result.warning);
  renderAnswer({
    status,
    answer,
    steps,
    items,
    meta
  });
  renderItems(items);
  renderSteps(steps);
  renderClarification(result, status);
  updateFooterState();
}

function renderConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    els.confidenceBadge.hidden = true;
    els.confidenceBadge.textContent = '';
    return;
  }
  const percent = Math.round(confidence * 100);
  els.confidenceBadge.hidden = false;
  els.confidenceBadge.textContent = `${percent}% confidence`;
  els.confidenceBadge.className = `confidence-badge ${
    confidence >= 0.8 ? 'high' : confidence >= 0.55 ? 'medium' : 'low'
  }`;
  els.confidenceBadge.title =
    'The model’s self-reported confidence. It is not a guarantee — check important facts.';
}

function renderQuestion(question) {
  els.questionText.classList.remove('clamped', 'expanded');
  els.questionText.textContent =
    question || 'The exercise text was not clearly recognized in this capture.';
  els.expandQuestion.hidden = true;
  els.expandQuestion.textContent = 'Show full question';
  els.expandQuestion.setAttribute('aria-expanded', 'false');
  questionClampable = false;
}

function renderWarning(warning) {
  const text = typeof warning === 'string' ? warning.trim() : '';
  els.warningBox.hidden = !text;
  els.warningText.textContent = text;
}

function renderAnswer({ status, answer, steps, items, meta }) {
  const itemAnswers = items.filter(
    (item) => typeof item.answer === 'string' && item.answer.trim()
  );
  const hasAnswer = Boolean(answer) || itemAnswers.length > 0;

  els.answerCard.hidden = !answer;
  els.answerText.textContent = answer;
  els.answerCard.classList.toggle(
    'simple',
    Boolean(answer) && answer.length < 48 && steps.length === 0
  );

  const metaParts = ['AI-generated'];
  if (Number.isFinite(Number(meta?.durationMs))) {
    const duration = Number(meta.durationMs);
    metaParts.push(duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(1)} s`);
  }
  els.answerMeta.textContent = metaParts.join(' · ');
  const modelInfo = [meta?.provider, meta?.model].filter(Boolean).join(' · ');
  els.answerMeta.title = modelInfo || 'Answer produced by the configured AI vision model';

  if (status === 'needs_clarification' || status === 'unsupported') {
    els.answerCard.hidden = !answer;
  }
  if (!hasAnswer) els.answerCard.hidden = true;
}

function renderItems(items) {
  els.itemsList.textContent = '';
  if (!items.length) {
    els.itemsList.hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'card item-card';

    const head = document.createElement('div');
    head.className = 'item-head';
    const badge = document.createElement('span');
    badge.className = 'item-index';
    badge.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span');
    label.className = 'item-label';
    label.textContent = 'Exercise';
    head.append(badge, label);
    card.appendChild(head);

    const question = String(item.question || '').trim();
    if (question) {
      const questionNode = document.createElement('div');
      questionNode.className = 'item-question';
      questionNode.textContent = question;
      card.appendChild(questionNode);
    }

    const answer = String(item.answer || '').trim();
    if (answer) {
      const answerNode = document.createElement('div');
      answerNode.className = 'item-answer';
      answerNode.textContent = answer;
      card.appendChild(answerNode);
    }

    const steps = Array.isArray(item.steps)
      ? item.steps.filter((step) => typeof step === 'string' && step.trim())
      : [];
    if (steps.length) {
      const details = document.createElement('details');
      details.className = 'item-steps';
      const summary = document.createElement('summary');
      summary.textContent = `Show ${steps.length === 1 ? 'step' : `${steps.length} steps`}`;
      const list = document.createElement('ol');
      steps.forEach((step, stepIndex) => {
        const row = document.createElement('li');
        const number = document.createElement('b');
        number.textContent = String(stepIndex + 1).padStart(2, '0');
        const text = document.createElement('span');
        text.textContent = step.trim();
        row.append(number, text);
        list.appendChild(row);
      });
      details.append(summary, list);
      card.appendChild(details);
    }

    fragment.appendChild(card);
  });

  els.itemsList.appendChild(fragment);
  els.itemsList.hidden = false;
}

function renderSteps(steps) {
  els.stepsList.textContent = '';
  if (!steps.length) {
    els.stepsBox.hidden = true;
    els.stepsBox.open = false;
    return;
  }

  const fragment = document.createDocumentFragment();
  steps.forEach((step, index) => {
    const row = document.createElement('li');
    const indexNode = document.createElement('span');
    indexNode.className = 'step-index';
    indexNode.textContent = String(index + 1).padStart(2, '0');
    const body = document.createElement('div');
    body.className = 'step-body';
    body.textContent = step.trim();
    row.append(indexNode, body);
    fragment.appendChild(row);
  });
  els.stepsList.appendChild(fragment);
  els.stepCount.textContent = `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
  els.stepsBox.hidden = false;
  els.stepsBox.open = true;
}

function renderClarification(result, status) {
  const clarification =
    typeof result.clarification === 'string' ? result.clarification.trim() : '';
  const show = status === 'needs_clarification' || status === 'unsupported' || Boolean(clarification);

  els.clarifyBox.hidden = !show;
  if (!show) return;

  // Clarification is the primary next step. Keep it above the answer so its
  // capture actions stay visible without scrolling in the compact window.
  if (els.answerCard && els.clarifyBox.nextElementSibling !== els.answerCard) {
    els.answerCard.before(els.clarifyBox);
  }

  if (status === 'unsupported') {
    els.clarifyTitle.textContent = 'This capture is outside schoolwork';
    els.clarifyTips.hidden = true;
    els.clarifySnap.textContent = 'Capture a new exercise';
  } else {
    els.clarifyTitle.textContent = 'A clearer capture will help';
    els.clarifyTips.hidden = false;
    els.clarifySnap.textContent = 'Capture clearer image';
  }

  els.clarifyText.textContent =
    clarification ||
    (status === 'unsupported'
      ? 'The image does not appear to contain a school exercise NeostixSnap can solve.'
      : 'Part of the exercise could not be read clearly. Capture it again, closer and in focus.');
  els.clarifyRetry.hidden = !job;
}

function updateQuestionClamp() {
  if (els.resultView.hidden) return;
  const text = els.questionText;
  if (!text.textContent.trim()) {
    els.expandQuestion.hidden = true;
    return;
  }
  text.classList.remove('clamped', 'expanded');
  els.expandQuestion.hidden = true;
  const fullHeight = text.scrollHeight;
  questionClampable = fullHeight > 116;
  if (questionClampable) {
    text.classList.add('clamped');
    els.expandQuestion.hidden = false;
    els.expandQuestion.textContent = 'Show full question';
    els.expandQuestion.setAttribute('aria-expanded', 'false');
  }
}

function toggleQuestion() {
  if (!questionClampable) return;
  const expanded = !els.questionText.classList.contains('expanded');
  els.questionText.classList.toggle('clamped', !expanded);
  els.questionText.classList.toggle('expanded', expanded);
  els.expandQuestion.textContent = expanded ? 'Show less' : 'Show full question';
  els.expandQuestion.setAttribute('aria-expanded', String(expanded));
}

function showPreview(dataUrl) {
  els.previewImage.hidden = false;
  if (els.previewImage.src !== dataUrl) {
    els.previewImage.src = dataUrl;
  }
  els.previewCard.hidden = false;
}

function showLoading(title, stage) {
  stopStages();
  showView('loading');
  els.loadingTitle.textContent = title;
  els.loadingStage.textContent = stage;
  if (!job) els.previewCard.hidden = true;
}

function startStages() {
  stopStages();
  stageIndex = 0;
  stageTimer = window.setInterval(() => {
    stageIndex = (stageIndex + 1) % STAGES.length;
    els.loadingStage.textContent = STAGES[stageIndex];
  }, STAGE_INTERVAL_MS);
}

function stopStages() {
  if (stageTimer) {
    window.clearInterval(stageTimer);
    stageTimer = null;
  }
}

function showView(name) {
  els.loadingView.hidden = name !== 'loading';
  els.resultView.hidden = name !== 'result';
  els.errorView.hidden = name !== 'error';
  els.footer.hidden = name === 'error';
  els.main.scrollTop = 0;
}

function showError(error, { canRetry = false } = {}) {
  const described = describeError(error);
  lastErrorInfo = error && typeof error === 'object' ? error : null;
  showView('error');
  els.errorKicker.textContent = described.kicker;
  els.errorTitle.textContent = described.title;
  els.errorMessage.textContent = described.message;
  const help = described.help;
  els.errorHelp.hidden = !help;
  els.errorHelp.textContent = '';
  if (help) {
    const label = document.createElement('b');
    label.textContent = 'What to do';
    els.errorHelp.append(label, document.createTextNode(help));
  }
  els.errorRetry.hidden = !(canRetry && job);
  els.errorSnap.hidden = false;
  els.errorSettings.hidden = false;
  els.errorClose.hidden = false;
  els.errorCodeRow.hidden = !described.code;
  els.errorCode.textContent = described.code || '';
  updateFooterState();
}

async function loadStartupError() {
  cancelSolve();
  resetResultState();
  let stored = null;
  try {
    if (HAS_CHROME) {
      stored = (await chrome.storage.session.get(LAST_ERROR_KEY))[LAST_ERROR_KEY] || null;
    }
  } catch {
    stored = null;
  }

  const error = stored
    ? {
        code: stored.code,
        message: stored.message,
        help: stored.help,
        sourceTabId: stored.sourceTabId,
        sourceWindowId: stored.sourceWindowId
      }
    : {
        code: 'capture_failed',
        message: 'The screenshot could not be taken.'
      };

  lastErrorInfo = error;
  showError(error, { canRetry: false });
}

function updateFooterState() {
  const canCopy = Boolean(
    lastResult &&
      (String(lastResult.answer || '').trim() ||
        (Array.isArray(lastResult.items) &&
          lastResult.items.some((item) => String(item?.answer || '').trim())))
  );
  els.copyAnswer.disabled = !canCopy || busy;
  els.regenerate.disabled = !job || busy || !lastResult;
  els.regenerate.classList.toggle('loading', busy && Boolean(lastResult));
  els.snapAnother.disabled = startingCapture;
  els.clarifySnap.disabled = startingCapture;
  els.clarifyRetry.disabled = !job || busy;
  els.errorRetry.disabled = !job || busy;
  els.errorSnap.disabled = startingCapture;
  els.snapAnotherLabel.textContent = startingCapture ? 'Starting capture…' : 'Snap another';

  const dirty = els.languageSelect.value !== solvedLanguage;
  els.langHint.hidden = !dirty;
}

function onLanguageChange() {
  const language = isLanguage(els.languageSelect.value)
    ? els.languageSelect.value
    : 'auto';
  els.languageSelect.value = language;
  void saveSettings({ language }).catch(() => {});
  updateFooterState();
  if (lastResult && language !== solvedLanguage) {
    showToast('Press Regenerate to apply the new language.', 'info');
  }
}

async function copyResult() {
  if (!lastResult) return;
  const text = buildCopyText(lastResult);
  if (!text) {
    showToast('There is no answer to copy yet.', 'error');
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      legacyCopy(text);
    }
    els.copyAnswer.classList.add('copied');
    els.copyLabel.textContent = 'Copied';
    showToast('Answer copied to the clipboard.', 'success');
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      els.copyAnswer.classList.remove('copied');
      els.copyLabel.textContent = 'Copy';
    }, 1700);
  } catch {
    try {
      legacyCopy(text);
      els.copyLabel.textContent = 'Copied';
      showToast('Answer copied to the clipboard.', 'success');
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        els.copyLabel.textContent = 'Copy';
      }, 1700);
    } catch {
      showToast('Could not copy. Select the answer text manually.', 'error');
    }
  }
}

function buildCopyText(result) {
  const blocks = [];
  const question = String(result.recognized_question || '').trim();
  const answer = String(result.answer || '').trim();
  const steps = Array.isArray(result.steps)
    ? result.steps.filter((step) => typeof step === 'string' && step.trim())
    : [];
  const items = Array.isArray(result.items)
    ? result.items.filter(
        (item) => item && (String(item.question || '').trim() || String(item.answer || '').trim())
      )
    : [];
  const clarification = String(result.clarification || '').trim();

  if (question) blocks.push(`Question\n${question}`);
  if (answer) blocks.push(`Answer\n${answer}`);
  if (steps.length) {
    blocks.push(
      `Steps\n${steps.map((step, index) => `${index + 1}. ${step.trim()}`).join('\n')}`
    );
  }
  if (items.length) {
    const rendered = items.map((item, index) => {
      const lines = [`${index + 1}. ${String(item.question || '').trim() || 'Exercise'}`];
      const itemAnswer = String(item.answer || '').trim();
      if (itemAnswer) lines.push(`   ${itemAnswer}`);
      const itemSteps = Array.isArray(item.steps)
        ? item.steps.filter((step) => typeof step === 'string' && step.trim())
        : [];
      itemSteps.forEach((step, stepIndex) => {
        lines.push(`   ${stepIndex + 1}) ${step.trim()}`);
      });
      return lines.join('\n');
    });
    blocks.push(`Exercises\n${rendered.join('\n\n')}`);
  }
  if (clarification) blocks.push(`Note\n${clarification}`);
  if (!blocks.length) return '';
  blocks.push('— NeostixSnap');
  return blocks.join('\n\n');
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

async function snapAnother() {
  if (startingCapture) return;
  if (!HAS_CHROME || !chrome.runtime?.sendMessage) {
    showToast('Screenshots are available in the installed extension.', 'error');
    return;
  }

  const sourceTabId = job?.sourceTabId ?? lastErrorInfo?.sourceTabId ?? null;
  const sourceWindowId = job?.sourceWindowId ?? lastErrorInfo?.sourceWindowId ?? null;

  startingCapture = true;
  updateFooterState();
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'NEOSTIX_START_CAPTURE',
      sourceTabId,
      sourceWindowId
    });
    if (response?.ok) {
      closeWindow();
      return;
    }
    const message =
      response?.error?.help || response?.error?.message || 'The capture could not start.';
    showToast(message, 'error');
  } catch {
    showToast('NeostixSnap could not start the capture. Reload the extension and try again.', 'error');
  } finally {
    startingCapture = false;
    updateFooterState();
  }
}

async function openOptions() {
  if (HAS_CHROME && chrome.runtime?.openOptionsPage) {
    try {
      await chrome.runtime.openOptionsPage();
      return;
    } catch {
      // Fall back to opening the page directly.
    }
  }
  window.open('../options/options.html', '_blank', 'noopener');
}

function closeWindow() {
  cancelSolve();
  try {
    window.close();
  } catch {
    // Use the windows API below if window.close is unavailable.
  }
  if (!HAS_CHROME) return;
  window.setTimeout(async () => {
    try {
      const current = await chrome.windows.getCurrent();
      if (current?.id) await chrome.windows.remove(current.id);
    } catch {
      // The window is already closed.
    }
  }, 120);
}

function resetResultState() {
  job = null;
  lastResult = null;
  lastMeta = null;
  lastErrorInfo = null;
  solvedLanguage = settings?.language || 'auto';
  els.previewImage.removeAttribute('src');
  els.previewImage.hidden = false;
  els.previewCard.hidden = false;
  els.resultView.hidden = true;
  els.errorView.hidden = true;
  els.warningBox.hidden = true;
  els.clarifyBox.hidden = true;
  els.itemsList.textContent = '';
  els.itemsList.hidden = true;
  els.stepsList.textContent = '';
  els.stepsBox.hidden = true;
  els.answerText.textContent = '';
  els.questionText.textContent = '';
  els.confidenceBadge.hidden = true;
  els.subjectText.textContent = 'General';
  els.subjectIcon.textContent = '✧';
  updateFooterState();
}

function cancelSolve() {
  solveToken += 1;
  if (requestController) {
    try {
      requestController.abort();
    } catch {
      // Already finished.
    }
    requestController = null;
  }
  stopStages();
  busy = false;
}

function handleRuntimeMessage(message, _sender, sendResponse) {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'NEOSTIX_JOB_READY' && typeof message.jobId === 'string') {
    if (message.jobId === jobId && job) {
      sendResponse({ ok: true, duplicate: true });
      return false;
    }
    history.replaceState(null, '', `results.html?job=${encodeURIComponent(message.jobId)}`);
    sendResponse({ ok: true });
    void loadJob(message.jobId);
    return false;
  }
  if (message.type === 'NEOSTIX_ERROR_READY') {
    history.replaceState(null, '', 'results.html?error=1');
    cancelSolve();
    resetResultState();
    sendResponse({ ok: true });
    void loadStartupError();
    return false;
  }
  return false;
}

function describeError(error) {
  const code = String(error?.code || 'unknown_error').slice(0, 80);
  const copy = ERROR_COPY[code] || {};
  return {
    code,
    kicker: copy.kicker || 'Something went wrong',
    title: copy.title || 'The answer could not be loaded',
    message:
      String(error?.message || '').trim() ||
      copy.message ||
      'NeostixSnap could not complete the request.',
    help: String(error?.help || copy.help || '').trim(),
    retryAfter: error?.retryAfter
  };
}

function appError(code, message, help = '', extra = {}) {
  const error = new Error(message);
  error.name = 'NeostixError';
  error.code = code;
  if (help) error.help = help;
  Object.assign(error, extra);
  return error;
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

function subjectGlyph(subject) {
  const value = String(subject || '');
  for (const [pattern, glyph] of SUBJECT_GLYPHS) {
    if (pattern.test(value)) return glyph;
  }
  return '✧';
}

function isLanguage(code) {
  return LANGUAGES.some((language) => language.code === code);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
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
  }, 2700);
}
