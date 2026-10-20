# Architecture

This document describes how NeostixSnap moves a screenshot from Chrome to a vision model and back, which components own which data, and how failures are handled.

## Components

```text
┌──────────────────────────────── Chrome (Manifest V3) ────────────────────────────────┐
│                                                                                      │
│  popup/popup.html ──► background/service-worker.js ◄── chrome.commands (Alt + Q)     │
│                              │                                                       │
│                              ├─ chrome.tabs.captureVisibleTab                         │
│                              ├─ chrome.scripting.executeScript(content/overlay.js)     │
│                              │        │                                              │
│                              │        └─ drag selection → cropped data URL            │
│                              ├─ selector/ (fallback crop window)                      │
│                              └─ chrome.storage.session job                            │
│                                       │                                               │
│                                       ▼                                               │
│                              results/results.html                                     │
│                                       │ POST /api/solve + bearer token                │
│                                       ▼                                               │
│                              options/ (settings, health, permissions)                 │
└───────────────────────────────────────┼──────────────────────────────────────────────┘
                                        │ HTTPS (or loopback HTTP)
                                        ▼
┌──────────────────────────── Node 20+ backend ──────────────────────────────┐
│  server.js → src/app.js                                                    │
│      auth → rate limit → JSON/image validation → semaphore                 │
│      → src/solve.js → src/providers.js → provider API                      │
│      → src/result.js (parse, normalize) → JSON response                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### Extension

| Path | Role |
| --- | --- |
| `popup/` | Toolbar entry point: backend status, shortcut display, **Snap & Solve**, settings link. |
| `background/service-worker.js` | Capture orchestrator: tab lookup, screenshot, overlay injection, fallback window, job storage, result/error window lifecycle, cleanup. |
| `content/overlay.js` | In-page selection overlay. Displays the frozen screenshot, crops the selected region, sends it to the worker. Runs once per tab and listens for later captures. |
| `selector/` | Standalone fallback crop window for pages where the overlay cannot be injected. |
| `results/` | Floating answer window. Loads the job, performs the backend request, renders results and errors, supports copy/regenerate/language change/snap another. |
| `options/` | Backend URL, access token, model override, default language, host-permission flow, connection test, shortcut link, reset. |
| `privacy/` | Bundled privacy policy. |
| `shared/settings.js` | Settings schema, language catalog, URL normalization, permission helpers, storage keys. |
| `shared/base.css` | Shared design tokens, buttons, focus styles, reduced-motion handling. |

### Backend

| Path | Role |
| --- | --- |
| `server.js` | Entry point, `.env` loading, configuration validation, HTTP server, graceful shutdown. |
| `src/app.js` | Routes, CORS, security headers, authentication, rate limits, body limits, concurrency gate, error responses, request logs. |
| `src/config.js` | Environment parsing, provider presets, bounds, readiness checks, safe-bind assertion. |
| `src/auth.js` | Bearer token parsing and constant-time comparison. |
| `src/rate-limit.js` | Fixed-window IP limiter and FIFO semaphore with bounded queue. |
| `src/image.js` | Data URL parsing, MIME normalization, magic-byte verification, decoded-size limit. |
| `src/prompt.js` | Tutor system prompt, language instructions, regeneration and repair prompts. |
| `src/providers.js` | OpenAI-compatible and Anthropic adapters, timeouts, parameter fallback, usage normalization. |
| `src/solve.js` | Orchestration, error mapping, one repair attempt, result metadata. |
| `src/result.js` | Fenced/balanced JSON extraction, schema, normalization, limits. |
| `src/errors.js` | `AppError`, `ProviderError`, public-safe serialization. |

## Capture flow

### 1. Invocation

The user presses **Alt + Q**, clicks **Snap & Solve** in the popup, or clicks **Snap another** in the results window. The service worker receives `NEOSTIX_START_CAPTURE` (popup/results) or a `chrome.commands.onCommand` event.

The worker:

1. Rejects the request if another capture is starting, or if a capture session is still active (it flashes the existing overlay if possible).
2. Resolves the source tab. Explicit tab/window IDs from the results page take priority. If the active tab is the extension's own results/selector window, the worker redirects to the tab that produced the current job or error.
3. Rejects restricted URLs: `chrome://`, `edge://`, the Chrome Web Store, extension pages, and similar.
4. Focuses the source window and tab, waits briefly for compositing, and calls `chrome.tabs.captureVisibleTab(windowId, { format: "png" })`.
5. Reads settings and stores a `CAPTURE_SESSION_KEY` record (`tabId`, `windowId`, `startedAt`, `phase`, `language`).
6. Injects `content/overlay.js` with `chrome.scripting.executeScript` and sends `NEOSTIX_SHOW_OVERLAY` with the screenshot data URL.

`activeTab` covers the capture and injection. No persistent content script is registered, so pages are not touched until a capture begins.

### 2. In-page overlay

`overlay.js` installs a single message listener per tab, then creates a fixed, full-viewport host with a shadow root. It displays the screenshot as the background and dims it. The user drags a rectangle.

On pointer-up:

- selections smaller than 12 × 12 CSS pixels are discarded;
- the region is mapped from CSS pixels to screenshot pixels using the image's natural size and the viewport;
- the crop is capped at 1900 px on the longest side, re-encoded as PNG, then JPEG if the data URL is too large, then downscaled once more if necessary;
- the result is sent as `NEOSTIX_CAPTURE_RESULT`.

The overlay is removed after a successful handoff, on cancellation (`Esc`, **Cancel**, window resize), or after an unrecoverable error. It never persists in the page.

### 3. Fallback selector

If overlay injection or the overlay handshake fails, the worker opens `selector/selector.html` in a popup window:

- if the full-tab screenshot is very large, it is downscaled once with `OffscreenCanvas` before storage;
- the screenshot record is stored under `SELECTOR_PREFIX + selectorId`;
- the selector window loads the image, lets the user drag a crop, and sends `NEOSTIX_SELECTOR_RESULT`;
- successful or cancelled selections remove the selector record, capture session, and window mapping.

The fallback captures the full visible tab before cropping. That capture is held in session storage only briefly.

### 4. Job handoff

On a valid crop, the worker:

1. Removes older jobs (`cleanupJobs({ force: true })`) so at most one screenshot is retained.
2. Writes `JOB_PREFIX + jobId` with the image, language, source tab/window IDs, and `createdAt`.
3. Writes `ACTIVE_JOB_KEY`.
4. Reuses the existing results window if it is still open, otherwise creates a 500 × 740 popup.
5. Sends `NEOSTIX_JOB_READY` to the results page. If no listener responds, the worker navigates the existing window to the new `?job=` URL.

The results page reads the job from session storage and performs the backend request itself. This is deliberate: MV3 service workers can be suspended while idle, and a request living in the worker could be interrupted. The results page stays alive as long as its window is open.

### 5. Response and cleanup

The results page validates the response shape, renders the result, and keeps the image in memory for regenerate and language changes. It does not write the image, question, or answer to persistent storage.

When the results window closes, `chrome.windows.onRemoved` removes:

- `RESULTS_WINDOW_KEY`;
- `ACTIVE_JOB_KEY`;
- the active job record (and therefore the screenshot).

Stale jobs, selector captures, capture sessions, and the last error are also purged after 20 minutes (capture sessions after 5 minutes). Session storage is memory-backed and is cleared when the browser session ends.

## Extension message API

| Message | Direction | Purpose |
| --- | --- | --- |
| `NEOSTIX_START_CAPTURE` | popup/results → worker | Start a capture. Optional `sourceTabId`, `sourceWindowId`. Responds `{ ok, mode? , error? }`. |
| `NEOSTIX_SHOW_OVERLAY` | worker → content script | Deliver the screenshot and language to the overlay. Responds `{ ok, error?, message? }`. |
| `NEOSTIX_FLASH` | worker → content script | Notify an already-active overlay instead of starting another. |
| `NEOSTIX_CAPTURE_RESULT` | content script → worker | Deliver the cropped data URL. Responds `{ ok }` or `{ ok: false, error }`. |
| `NEOSTIX_CAPTURE_CANCELLED` | content script → worker | Remove the capture session. |
| `NEOSTIX_OVERLAY_ERROR` | content script → worker | Surface an overlay failure in the results/error window. |
| `NEOSTIX_SELECTOR_RESULT` | selector → worker | Deliver the fallback crop plus `selectorId`. |
| `NEOSTIX_SELECTOR_CANCELLED` | selector → worker | Clean up the selector window and capture session. |
| `NEOSTIX_JOB_READY` | worker → results | A new job is ready; payload `{ jobId }`. |
| `NEOSTIX_ERROR_READY` | worker → results | A capture error is ready; payload `{ error }`. |
| `NEOSTIX_SELECTOR_*` | internal | Selector lifecycle messages. |

All worker message handlers verify `sender.id === chrome.runtime.id` before acting.

## Session storage keys

| Key | Shape | Lifetime |
| --- | --- | --- |
| `neostix.settings.v1` (local storage) | `{ backendUrl, accessToken, language, model }` | Until reset/uninstall. |
| `neostix.captureSession` | `{ tabId, windowId, startedAt, phase, language }` | Selection in progress; deleted on completion/cancel; purged after 5 min. |
| `neostix.job.<uuid>` | `{ id, imageDataUrl, language, sourceTabId, sourceWindowId, createdAt }` | Until results window closes or 20 min stale purge. |
| `neostix.activeJob` | job ID string | With the active job. |
| `neostix.resultsWindow` | Chrome window ID number | Until the results window closes. |
| `neostix.selector.<uuid>` | `{ imageDataUrl, sourceTabId, sourceWindowId, language, createdAt }` | Until selection/cancel/window close or 20 min purge. |
| `neostix.selectorWindow.<windowId>` | selector ID string | With the selector window. |
| `neostix.lastError` | `{ code, message, help?, sourceTabId?, sourceWindowId?, at }` | Until overwritten, session end, or 20 min purge. |

Session storage is set to `TRUSTED_CONTEXTS` where supported, so content scripts cannot read screenshots.

## Result schema

```json
{
  "status": "answered | needs_clarification | unsupported",
  "subject": "Mathematics",
  "language": "cs",
  "recognized_question": "Faithful transcription of the exercise",
  "answer": "Final answer",
  "steps": ["Step 1", "Step 2"],
  "items": [
    {
      "question": "Second exercise",
      "answer": "Its answer",
      "steps": ["..."]
    }
  ],
  "clarification": null,
  "warning": null,
  "confidence": 0.95
}
```

Normalization rules in `src/result.js`:

- strings are trimmed, null bytes removed, and length-limited;
- `steps` is capped at 20 entries and 2,200 characters each;
- `items` is capped at 12 entries; empty items are dropped;
- `status` is normalized; an unknown status becomes `answered` when an answer exists, otherwise `needs_clarification`;
- an `answered` result with no answer and no item answers is rejected as invalid AI output;
- missing clarification for `needs_clarification` or `unsupported` is replaced with a safe default;
- `confidence` is clamped to 0–1;
- a missing subject becomes `General`.

## Backend request flow

```text
OPTIONS *          → CORS preflight (204)
GET /health        → public readiness metadata (rate-limited)
POST /api/solve    → solve (rate-limited, authenticated)
other              → 404 / 405
```

For `POST /api/solve`:

1. **CORS** — reject disallowed origins before doing work.
2. **Rate limit** — per IP, fixed window (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`).
3. **Authentication** — if `EXTENSION_TOKEN` is set, constant-time compare the bearer token.
4. **Body** — require `application/json`; enforce `BODY_LIMIT_BYTES`; parse JSON.
5. **Language** — default `auto`; must be a supported code.
6. **Model** — only accepted when `ALLOW_CLIENT_MODEL=true`; validated against a conservative model-name pattern.
7. **Image** — data URL prefix, base64, MIME (PNG/JPEG/WebP), magic bytes, decoded size (`MAX_IMAGE_BYTES`).
8. **Concurrency** — acquire one of `MAX_CONCURRENT_AI` slots; wait up to `MAX_QUEUE`; otherwise return `busy`.
9. **Solve** — call the provider. If the first output cannot be parsed as the result schema, make one repair call with the previous output and validation reason.
10. **Normalize** — validate/clamp the result, attach request metadata, return JSON.

The server never returns provider response bodies, API keys, or stack traces. Errors use stable codes that the results page maps to actionable UI copy.

## Provider adapters

| Provider | Endpoint | Image format | Output control |
| --- | --- | --- | --- |
| `openai` | `POST {base}/chat/completions` | `image_url` data URL, `detail: high` | `json_schema` by default |
| `openrouter` | `POST {base}/chat/completions` | `image_url` data URL | `json_object` by default |
| `anthropic` | `POST {base}/v1/messages` | base64 image block | system prompt only |
| `ollama` | OpenAI-compatible local endpoint | `image_url` data URL | none |
| `openai-compatible` | `POST {base}/v1/chat/completions` (or `/chat/completions` when base ends in `/v1`) | `image_url` data URL | configurable |

`AI_RESPONSE_FORMAT` overrides the default: `auto`, `json_schema`, `json_object`, or `none`. `AI_TOKEN_PARAM` selects `max_tokens` or `max_completion_tokens`. On an OpenAI-compatible HTTP 400 that mentions an unsupported JSON/parameter field, the adapter retries once without the optional parameters.

All provider calls have a hard timeout (`AI_TIMEOUT_MS`). Network errors, 401/403, 429, 400/413/422, invalid output, and generic failures map to distinct public error codes.

## Error handling

### Capture/extension errors

| Code | Meaning |
| --- | --- |
| `restricted_page`, `page_not_accessible` | Chrome blocks capture/injection on this page. |
| `no_active_tab`, `tab_closed` | No usable source tab. |
| `selection_active` | A selection overlay is already open. |
| `capture_rate_limited` | Chrome's screenshot rate limit. |
| `storage_full`, `capture_too_large` | Screenshot/tab capture is too large for session storage. |
| `invalid_capture`, `stale_capture`, `expired_selection` | The crop or capture session is missing/expired. |
| `overlay_failed`, `selector_failed` | Overlay/fallback window could not start. |
| `extension_unavailable` | Extension context was reloaded during a capture. |

### Backend/AI errors

| Code | HTTP | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | Missing/invalid extension token. |
| `origin_not_allowed` | 403 | CORS origin rejected. |
| `rate_limited` | 429 | Local per-IP limit. |
| `busy` | 503 | Concurrency queue full. |
| `invalid_image` | 400 | Missing/malformed/invalid image data. |
| `payload_too_large` | 413 | Body or decoded image exceeds configured limit. |
| `invalid_language` | 400 | Unsupported language code. |
| `client_model_not_allowed` | 400 | Model override sent while disabled. |
| `server_misconfigured` | 503 | Provider/model/key incomplete. |
| `ai_timeout` | 504 | Provider timed out. |
| `ai_unreachable` | 502 | Provider network failure. |
| `ai_auth_error` | 502 | Provider rejected the server key. |
| `ai_rate_limited` | 503 | Provider rate limit (with `retryAfter`). |
| `ai_rejected` | 502 | Provider rejected the model/image request. |
| `ai_invalid_output` | 502 | Output could not be parsed or validated, including after repair. |
| `ai_unavailable` | 502 | Other provider failure. |
| `internal_error` | 500 | Unexpected server failure, details hidden. |

The results page maps codes to titles, messages, and “what to do” guidance. Unknown codes fall back to a generic actionable error.

## Security and privacy decisions

- **No client-side provider key.** The extension is a client for an authenticated proxy; the key lives only on the backend.
- **No `<all_urls>`.** `activeTab` + `scripting` limit access to explicit captures. Custom backend origins are optional host permissions acquired one origin at a time.
- **Session-only screenshots.** Images are held in `chrome.storage.session` and removed on window close/stale purge. No persistent screenshot or answer history exists.
- **No HTML rendering of AI output.** All model text is assigned with `textContent`, avoiding HTML/markdown injection.
- **Untrusted image instructions.** The system prompt treats the screenshot as data, not instructions. This reduces but cannot eliminate prompt injection.
- **Bounded work.** Body size, image size, rate limits, timeouts, concurrency, output tokens, and result string lengths are all bounded.
- **Fail-closed remote binding.** A non-loopback bind without `EXTENSION_TOKEN` is refused unless explicitly overridden.

## Design trade-offs

- **Results page performs the fetch.** Keeps long requests alive and simplifies cancellation, at the cost of the screenshot living in a visible extension page.
- **One results window, one retained job.** Prevents unbounded memory growth and accidental history. The trade-off is that only the most recent screenshot can be regenerated.
- **Full-tab fallback.** Works on pages that block content-script injection, but briefly stores the entire visible tab rather than only the selection.
- **Zero backend dependencies.** Minimizes supply chain and installation friction; limits built-in observability and shared rate limiting.
- **Strict JSON output.** Makes normalization predictable; uncooperative models trigger a repair call and then a clear error instead of fabricated fallback data.
