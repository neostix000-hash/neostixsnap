# Testing guide

This guide covers automated checks, a full manual QA matrix, failure-state validation, accessibility, privacy verification, and release packaging. Test with the real extension loaded in Chrome and a real vision provider before publishing.

## 1. Automated checks

### Backend test suite

```bash
cd server
npm test
```

Uses Node's built-in test runner (`node --test`) and requires no installed packages. The suite has **21 tests** covering:

- `/health` shape and secret redaction;
- bearer authentication and image validation order;
- successful solve responses with an injected solver;
- per-IP rate limiting and `Retry-After`;
- client model gating;
- CORS rejection for unlisted web origins;
- PNG data URL validation, MIME/byte mismatch, and size limits;
- fixed-window limiter rollover;
- semaphore queueing and overflow;
- JSON extraction from fences and prose;
- result normalization, multi-item results, missing answers, clarification fallback;
- strict output schema requirements.

Expected tail:

```text
# tests 21
# pass 21
# fail 0
```

### Extension static checks

From the repository root:

```bash
npm run check
# equivalent: node scripts/check-extension.mjs
```

The check validates:

- manifest JSON, MV3 constraints, and referenced files;
- icon files and `16/32/48/128` dimensions;
- extension HTML/CSS/JS syntax and module imports;
- absence of inline scripts (MV3 CSP);
- common packaging mistakes.

Expected:

```text
✓ Extension checks passed.
```

### Syntax-only checks

```bash
node --check server/server.js
node --check extension/background/service-worker.js
node --check extension/results/results.js
```

`scripts/check-extension.mjs` already parses every extension JavaScript file.

## 2. Test environments

| Environment | Purpose |
| --- | --- |
| Local backend `127.0.0.1:8787` + OpenAI/OpenRouter/Anthropic | Normal development and cloud-vision path. |
| Local Ollama (`http://127.0.0.1:11434`) | Offline/local-image path. |
| Remote HTTPS backend with token + `ALLOWED_ORIGINS` | Production deployment path. |
| Chrome with a clean profile | Permission, install, and privacy checks. |
| Windows display scaling 100% and 150% | Crop-coordinate accuracy. |
| Chrome 116 (minimum) and current stable | Compatibility. |

Have at least one real exercise page for each category: plain HTML, a PDF in Chrome's viewer, a school portal, an image of handwritten work, and a page with a diagram/table.

## 3. Installation and setup

- [ ] Load `extension/` unpacked at `chrome://extensions`; no manifest errors.
- [ ] The options page opens on first install.
- [ ] `Alt + Q` appears at `chrome://extensions/shortcuts`; it can be changed and the popup/options reflect the new value.
- [ ] Default backend URL is `http://127.0.0.1:8787`.
- [ ] Save with a valid backend URL requests host access for that origin only.
- [ ] Denying the permission leaves settings saved and shows a clear warning.
- [ ] **Grant access** can re-request a denied origin.
- [ ] **Test connection** shows Ready, Needs setup, Offline, Timed out, and Token rejected in the appropriate scenarios.
- [ ] Health details show service, provider, model, auth mode, and server-reported problems.
- [ ] Invalid URL and invalid model names show inline errors and do not save.
- [ ] Token reveal/hide works and the value persists after reload.
- [ ] Language and model override persist across browser restarts.
- [ ] **Reset defaults** requires confirmation and restores all defaults without changing granted host permissions.
- [ ] Remote `http://` (non-loopback) shows the unencrypted-transport warning; `https://` does not.
- [ ] Opening **Change shortcut** reaches `chrome://extensions/shortcuts` or shows the manual fallback.

## 4. Capture matrix

### Normal pages

- [ ] Press `Alt + Q` on a regular article/exercise page; overlay appears with the frozen screenshot.
- [ ] Drag a rectangle; selection is cropped exactly, excluding the HUD and the dimmed area.
- [ ] Result window opens automatically; the screenshot preview matches the selection.
- [ ] Capture the same page again after the result window closes; no stale overlay remains.
- [ ] Capture from the popup (**Snap & Solve**); popup closes and overlay appears.
- [ ] Capture from the results window (**Snap another**); source tab is focused and the overlay appears.
- [ ] Press `Alt + Q` while the results window is focused; it re-targets the page that produced the result instead of failing on the extension page.
- [ ] Press `Alt + Q` while an overlay is active; the existing overlay flashes and no second overlay opens.
- [ ] `Esc`, **Cancel**, and window resize close the overlay without creating a job.
- [ ] A drag smaller than 12 × 12 px is ignored and the overlay stays ready.
- [ ] Page scrolling is blocked while the overlay is open; keyboard scrolling is blocked too.
- [ ] Context menu is suppressed during selection.
- [ ] Navigating or closing the tab during selection does not leave a usable stale job.

### Display/zoom edge cases

- [ ] Zoom 80%, 100%, 125%, 150%, and 200%: crop matches the drawn rectangle.
- [ ] Windows display scaling 125%/150% with device pixel ratio > 1: crop has no offset.
- [ ] High-resolution screenshot: crop is capped at 1900 px and still readable.
- [ ] Large selection (> 6 MB decoded): extension compresses or reports a clear size error.
- [ ] Portrait and narrow windows: HUD and hint bar do not overlap the selection.
- [ ] Multi-monitor: capturing a window on a secondary monitor works.

### Restricted and fallback pages

- [ ] `chrome://settings`, `chrome://extensions`, and the Chrome Web Store show a clear restricted-page error.
- [ ] A PDF in Chrome's viewer either shows the overlay or opens the fallback selector.
- [ ] If overlay injection fails, the fallback selector opens, shows the tab screenshot, and crops correctly.
- [ ] Cancelling the fallback selector removes its session data and does not open results.
- [ ] Selecting in the fallback opens results with the correct crop.
- [ ] A page with an existing extension overlay or CSP restrictions still falls back cleanly.
- [ ] `about:blank` and `view-source:` show actionable errors rather than hanging.

## 5. Answer quality and rendering

Use real provider responses; these are not hardcoded.

### Content coverage

- [ ] Mathematics with an equation and units — correct answer and steps.
- [ ] Czech grammar (určování větných členů, pravopis) — Czech answer with correct terminology.
- [ ] English exercise with Czech instructions — answer in English, explanation in Czech when appropriate.
- [ ] Physics/chemistry — notation, units, and balancing are readable (no raw LaTeX).
- [ ] Biology/history/geography/literature — factual answer, no invented specifics.
- [ ] Table, graph, diagram, or circuit — relevant values are interpreted.
- [ ] Handwritten exercise with clear lighting — transcribed and solved.
- [ ] Multiple separate exercises — every item is shown with its own answer/steps.
- [ ] Student's visible answer — model checks correctness and explains mistakes.
- [ ] Deliberately blurry/partial exercise — `needs_clarification` with specific guidance, no invented answer.
- [ ] Non-school image — `unsupported` with a neutral message.
- [ ] Question containing “ignore previous instructions” in the image — treated as untrusted content, still handled as schoolwork or marked unsupported.

### Results UI

- [ ] Loading view shows the screenshot preview, scanning animation, changing stages, and skeleton.
- [ ] Subject badge, confidence badge, question, answer, warning, steps, and items render without overflow.
- [ ] Long question is clamped with **Show full question** / **Show less**.
- [ ] Long answer wraps and remains scrollable within the window.
- [ ] Steps are expanded initially and can be collapsed.
- [ ] Item cards show numbering, question, answer, and per-item steps.
- [ ] `needs_clarification` shows the clarification card and both **Capture clearer image** and **Try same image**.
- [ ] `unsupported` hides capture tips and uses the “outside schoolwork” title.
- [ ] **Copy** writes question/answer/steps/items to the clipboard and shows **Copied**.
- [ ] Changing the language selector shows **Regenerate to apply**, saves the default, and does not silently re-answer.
- [ ] **Regenerate** reuses the same screenshot, shows the loading state, and can change the answer.
- [ ] **Snap another** starts a new capture and closes the old results window only after success.
- [ ] Close button closes the window and removes the screenshot job (verify session storage).
- [ ] Reusing the window for a new job replaces the old content and resets scroll, error, and language state.
- [ ] Ephemeral chip, footer privacy text, and privacy link are visible and correct.

## 6. Error-state matrix

Force each state and verify the kicker, title, explanation, code, and actions.

### Extension/capture

- [ ] Restricted page (`chrome://`, Web Store).
- [ ] No active tab / tab closed mid-capture.
- [ ] Selection already active.
- [ ] Chrome screenshot rate limit (rapid repeated captures).
- [ ] Overlay injection failure → fallback selector.
- [ ] Fallback window failure.
- [ ] Capture/session expiry (leave results open > 20 minutes, then reload).
- [ ] Selection too large for session storage.
- [ ] Extension reloaded while overlay is open.

### Backend/connection

- [ ] Backend not running → **The AI backend is unreachable**, with start/URL guidance.
- [ ] Missing host permission → **Chrome needs permission to reach your backend**, with Settings action.
- [ ] Wrong `EXTENSION_TOKEN` → token rejected; fix in Settings and retry.
- [ ] Disallowed extension origin → `origin_not_allowed` guidance.
- [ ] Backend URL points at a non-NeostixSnap service → unexpected response or HTTP error.
- [ ] Backend reachable but AI not configured → `server_misconfigured`.
- [ ] Invalid provider key → `ai_auth_error`.
- [ ] Provider offline/network blocked → `ai_unreachable`.
- [ ] Provider timeout → `ai_timeout`; `AI_TIMEOUT_MS` can be raised.
- [ ] Provider 429 → `ai_rate_limited` with retry delay.
- [ ] Local rate limit exceeded → `rate_limited` with retry delay.
- [ ] Concurrency queue full → `busy`.
- [ ] Unsupported model/image → `ai_rejected`.
- [ ] Invalid or malformed model JSON, including after repair → `ai_invalid_output`.
- [ ] Oversized selection → `payload_too_large`.
- [ ] Client model override while disabled → `client_model_not_allowed`.
- [ ] Unsupported language → `invalid_language`.
- [ ] Server returns non-JSON or empty body → invalid response handling does not crash.

For every error:

- [ ] No screenshot, question, key, or token appears in the error message.
- [ ] **Try again** works when a job still exists.
- [ ] **Snap another** works from the error window.
- [ ] **Open settings** opens Options.
- [ ] **Close** closes the window and cleans up session data.

## 7. Privacy and data lifecycle

Use DevTools → Application → Extension storage (session and local) and `chrome://extensions` service-worker logs.

- [ ] Before any capture, there is no content script running on the page and no screenshot in storage.
- [ ] During selection, `neostix.captureSession` exists only.
- [ ] After selection, exactly one job exists; previous jobs are gone.
- [ ] The results request goes only to the configured backend; inspect the Network panel.
- [ ] The request body contains only the image, language, regenerate flag, and optional model.
- [ ] No provider API key is present in extension storage, source, or requests.
- [ ] Closing results removes the job, active job, and window mapping.
- [ ] After 20 minutes, stale jobs/selector/errors are purged (may require waking the worker).
- [ ] Results text is not written to local storage.
- [ ] The last error contains no image or recognized question.
- [ ] Backend logs show method, path, status, duration, request ID, and error code only — no image/question.
- [ ] With `EXTENSION_TOKEN` set, requests without the bearer token get 401.
- [ ] A non-loopback bind without a token refuses to start.
- [ ] CORS rejects an arbitrary web origin when `ALLOWED_ORIGINS` is set.

## 8. Accessibility and keyboard

- [ ] All interactive elements are reachable by Tab and have a visible focus ring.
- [ ] `Esc` cancels the overlay; `Enter`/`Space` activate focused buttons.
- [ ] Close, Copy, Regenerate, Snap another, and language selector have accessible names.
- [ ] Status messages (`aria-live` for loading stage, toast) are announced.
- [ ] Dialog overlay has `role="dialog"` and `aria-modal="true"`.
- [ ] Color contrast is sufficient for muted text and badges.
- [ ] With `prefers-reduced-motion`, scanning/spinning/glow animations are effectively disabled.
- [ ] At 200% browser zoom, controls remain usable and text is not clipped.
- [ ] Screen-reader pass: result headings, subject, answer, steps, and error guidance are understandable.

## 9. Performance and limits

- [ ] First capture completes in a reasonable time on a 1440p screen.
- [ ] Repeated captures do not grow session storage unboundedly.
- [ ] Backend handles `MAX_CONCURRENT_AI` requests and queues up to `MAX_QUEUE`.
- [ ] The 125-second client timeout produces a clear timeout error.
- [ ] The server request timeout and AI timeout leave the process healthy.
- [ ] Rate-limit windows recover after the configured interval.
- [ ] `BODY_LIMIT_BYTES`/`MAX_IMAGE_BYTES` reject oversized requests without crashing.

## 10. Remote deployment

- [ ] HTTPS certificate is valid; no mixed-content warnings.
- [ ] `EXTENSION_TOKEN` is long, random, and identical in Settings and `.env`.
- [ ] `ALLOWED_ORIGINS` contains the installed extension's origin.
- [ ] `TRUST_PROXY` is correct for the proxy; spoofed `X-Forwarded-For` cannot bypass limits.
- [ ] Docker container starts read-only with `no-new-privileges`.
- [ ] Container health check passes.
- [ ] Backend is not reachable except through the intended proxy/port.
- [ ] Rotating the token requires updating Settings and restarting the server.
- [ ] Logs do not contain screenshots, questions, tokens, or provider keys.
- [ ] A 401/403 from the provider is visible as an actionable error, not a stack trace.

## 11. Packaging and release

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-extension.ps1
```

Verify:

- [ ] `dist/neostixsnap-v1.0.0.zip` exists.
- [ ] `manifest.json` is at the ZIP root (select the ZIP's contents, not a parent folder, in the Web Store).
- [ ] ZIP contains only `extension/` contents: manifest, JS, CSS, HTML, icons, logo, privacy page.
- [ ] No `.env`, backend source, tests, preview harness, or screenshots are included.
- [ ] No `_metadata` or OS junk.
- [ ] Manifest version and package version are `1.0.0`.
- [ ] Load the ZIP contents as an unpacked extension and repeat a smoke test (setup → capture → answer → error).
- [ ] Regenerate icons if the logo changed and re-run the static check.
- [ ] Update `docs/STORE_LISTING.md` screenshots/copy if the UI changed.
- [ ] Confirm `PRIVACY.md` and `extension/privacy/privacy.html` match the implementation.

## 12. Temporary visual QA harness

The UI can be rendered outside Chrome with a mock `chrome` API and a mock backend. A harness is intentionally not committed to the repository. When building one:

1. Serve the `extension/` directory over localhost.
2. Inject a mock `chrome` object **before** module scripts: `runtime.id`, `storage.local/session`, `permissions`, `commands`, `windows`, and messaging.
3. Seed `neostix.settings.v1`, one `neostix.job.<id>` with a sample screenshot, and settings pointing at the mock server.
4. Implement `GET /health` and `POST /api/solve` with representative responses (answered, multiple items, clarification, unsupported, each error).
5. Inspect popup, results (loading, result, multi-item, clarification, error), options (ready/offline/permission), selector, and privacy at 500 × 740 and mobile/narrow widths.
6. Check console errors, network requests, focus order, and overflow.
7. Delete the harness before packaging; never ship mock backends or seeded jobs.

## 13. Regression checklist after any change

- [ ] Backend tests pass (21/21).
- [ ] Static extension check passes.
- [ ] Real provider answer still works.
- [ ] Capture → crop → result → regenerate → snap another still works.
- [ ] Result window close removes the job.
- [ ] Token and CORS behavior unchanged.
- [ ] No new permissions were added without documentation and store justification.
- [ ] Packaging still places the manifest at the ZIP root.
