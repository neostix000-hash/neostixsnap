# NeostixSnap

**Snap any school exercise with `Alt + Q` and get an explained AI answer — without leaving the page.**

NeostixSnap is a Manifest V3 Chrome extension plus a small self-hosted Node.js backend. You drag a box around an exercise, the extension sends only that region to your backend, a vision-capable AI model reads it, and a compact floating window shows the recognized question, the final answer, and step-by-step reasoning.

It supports every school subject: mathematics, Czech language and literature, English and other languages, physics, chemistry, biology, history, geography, civics, computer science, and general knowledge. The AI detects the subject and the exercise language automatically.

> **No hardcoded answers.** NeostixSnap is a real client for a real AI vision model. It does nothing useful until you configure a backend and an AI provider. Answers are generated externally; the extension and repository contain no answer database.

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configure the AI provider](#configure-the-ai-provider)
- [Install the extension](#install-the-extension)
- [Use it](#use-it)
- [Settings](#settings)
- [Backend API](#backend-api)
- [Configuration reference](#configuration-reference)
- [Security and deployment](#security-and-deployment)
- [Docker](#docker)
- [Privacy](#privacy)
- [Testing](#testing)
- [Packaging](#packaging)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [License](#license)

---

## Features

### Capture and solve

- **`Alt + Q` on any page** (shortcut can be changed in Chrome).
- Full-screen overlay with the frozen page screenshot; drag to select only the exercise.
- Automatic solving; no manual crop, upload, download, or paste step.
- **Fallback selection window** for pages where the in-page overlay cannot be injected (for example some PDF viewers or protected pages).
- Reuses one results window and removes screenshots as soon as that window closes.

### Answers built for schoolwork

- Auto-detects subject and language.
- Answers Czech exercises in Czech; follows a fixed language if you choose one.
- Handles multiple separate exercises with per-item answers and steps.
- Reads tables, diagrams, charts, circuits, chemical notation, and legible handwriting.
- Uses Unicode math notation (`×`, `÷`, `√`, `π`, `²`, `≤`, `→`) rather than LaTeX.
- Shows recognized question, final answer, expandable steps, warnings, and clarification prompts.
- Regenerate, copy, change answer language, and snap another exercise without leaving the result.

### Privacy-conscious design

- No analytics, telemetry, accounts, or advertising.
- Provider API key lives **only on the backend**, never in the extension package or browser storage.
- Screenshots live in `chrome.storage.session` (memory-backed) and are dropped when the results window closes; stale state is purged after 20 minutes.
- No browsing history or page content is collected.
- Custom backend origins are requested individually through Chrome's optional host permissions.

### Premium dark UI

Black and deep-navy surfaces, electric cyan/blue/violet accents, glowing capture overlay, scanning animations, glass-like cards, and a distinctive viewfinder-bolt logo. All animations respect `prefers-reduced-motion`.

---

## How it works

```text
Alt + Q / popup
      │
      ▼
background service worker ── captureVisibleTab ──► frozen tab screenshot
      │
      ├── inject content/overlay.js ──► drag selection → cropped PNG/JPEG
      │                                      │
      │                                      ▼
      └── fallback selector window ──► chrome.storage.session job (ephemeral)
                                             │
                                             ▼
                                    results/results.html
                                             │  POST /api/solve
                                             ▼
                                    your Node backend
                                             │  provider adapter
                                             ▼
                               OpenAI / OpenRouter / Anthropic / Ollama
                                             │
                                             ▼
                            strict JSON answer → normalized result
                                             │
                                             ▼
                     floating answer window (question, answer, steps)
```

The results page performs the backend request itself. This means an idle MV3 service worker cannot interrupt an answer in progress. The backend validates the image, applies authentication and rate limits, calls the vision model, repairs unreadable JSON once, normalizes the output, and returns a compact result.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for message types, storage keys, schemas, and failure handling.

---

## Requirements

| Requirement | Notes |
| --- | --- |
| Google Chrome / Chromium **116+** | Manifest V3, `chrome.storage.session`. |
| **Node.js 20+** | Backend has zero npm runtime dependencies. |
| A vision-capable AI model | OpenAI, OpenRouter, Anthropic, local Ollama, or any OpenAI-compatible vision endpoint. |
| Provider API key or local model | Required for the configured provider. OpenAI, OpenRouter, and Anthropic need a key. Ollama does not. |

No build step is required for the extension or backend.

---

## Quick start

### 1. Start the backend

```bash
cd server
cp .env.example .env       # Windows PowerShell: Copy-Item .env.example .env
```

Open `server/.env` and set at minimum:

```dotenv
AI_PROVIDER=openai
AI_MODEL=gpt-4.1-mini
AI_API_KEY=your-provider-key
EXTENSION_TOKEN=generate-a-long-random-token
```

Generate a strong token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Start the server:

```bash
npm start
# or: node server.js
```

You should see:

```text
NeostixSnap backend v1.0.0
Listening: http://127.0.0.1:8787
Provider:  openai / gpt-4.1-mini
Auth:      extension token required
AI status: configured
```

Check it:

```bash
curl http://127.0.0.1:8787/health
```

### 2. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder (not the repository root).
4. The settings page opens automatically. If it does not, open the extension menu → **Options**.

### 3. Connect

1. Set **Backend URL** to `http://127.0.0.1:8787`.
2. Paste the same value as `EXTENSION_TOKEN` into **Extension access token**.
3. Click **Save settings**.
4. Grant Chrome access when asked, then click **Test connection**.
5. Confirm the health panel says **Ready**.

### 4. Snap something

Open any exercise page, press **`Alt + Q`**, and drag over the whole task. The answer window opens automatically.

---

## Configure the AI provider

The backend adapts the provider request format. Choose a **multimodal / vision** model; a text-only model cannot read the screenshot.

| Provider | `.env` values | Notes |
| --- | --- | --- |
| **OpenAI** | `AI_PROVIDER=openai`<br>`AI_MODEL=gpt-4.1-mini`<br>`AI_API_KEY=...` | Uses `/v1/chat/completions` with JSON schema output when available. |
| **OpenRouter** | `AI_PROVIDER=openrouter`<br>`AI_MODEL=google/gemini-2.5-flash`<br>`AI_API_KEY=...` | Uses an OpenAI-compatible endpoint and JSON object output. |
| **Anthropic** | `AI_PROVIDER=anthropic`<br>`AI_MODEL=claude-sonnet-4-5`<br>`AI_API_KEY=...` | Uses `/v1/messages` with base64 image input. |
| **Ollama** | `AI_PROVIDER=ollama`<br>`AI_MODEL=llava:7b`<br>`AI_API_KEY=` (empty) | Default base URL `http://127.0.0.1:11434/v1`. Images stay local. Use any installed vision model. |
| **Custom OpenAI-compatible** | `AI_PROVIDER=openai-compatible`<br>`AI_MODEL=...`<br>`AI_BASE_URL=https://...`<br>`AI_API_KEY=...` | For Azure gateways, proxies, LM Studio, vLLM, or other compatible services. |

Default model names in documentation and presets are examples. Model availability changes; set `AI_MODEL` to a model your provider currently offers. The backend also supports `AI_RESPONSE_FORMAT` and `AI_TOKEN_PARAM` overrides for providers with non-standard parameter support.

### Provider request shape

- **OpenAI-compatible:** `POST {AI_BASE_URL}/chat/completions` (or `/v1/chat/completions` when the base has no `/v1`), image as a `data:` URL, `detail: high`.
- **Anthropic:** `POST {AI_BASE_URL}/v1/messages`, base64 image source, `anthropic-version: 2023-06-01`.
- The model must return one JSON object. The backend extracts fenced or prose-wrapped JSON, validates it, and attempts one repair call if needed.

---

## Install the extension

### Unpacked (development)

1. `chrome://extensions`
2. **Developer mode** → **Load unpacked**
3. Select `neostixsnap/extension`
4. Pin the extension and open **Options**.

### Shortcut

The default is **`Alt + Q`**. To change it:

1. Open `chrome://extensions/shortcuts`.
2. Find **NeostixSnap — Snap a question and solve it**.
3. Assign a shortcut Chrome accepts. Some combinations are reserved by Chrome or other extensions.

The popup and Settings show the currently assigned shortcut.

---

## Use it

1. Open an exercise — a website, school portal, PDF rendered in Chrome, or a photo opened in a tab.
2. Press **`Alt + Q`** or click **Snap & Solve** in the popup.
3. Drag a box around the entire task, including instructions and answer choices.
4. Wait for the floating answer window:
   - **Recognized question** — what the AI read.
   - **Answer** — concise final answer.
   - **Step-by-step explanation** — expand or collapse.
   - **Exercises** — separate cards when several tasks are detected.
   - **Warning** — assumptions or uncertain parts.
   - **Clarification** — what to recapture if the image is unclear.
5. Use **Copy**, **Regenerate**, the **language selector**, or **Snap another**.

### Tips for good captures

- Include the whole question, not just the equation.
- Keep diagrams, tables, units, and answer choices inside the box.
- Avoid glare, blur, and extreme perspective.
- Prefer a closer capture over a full page.
- For handwriting, use good lighting and a steady angle.
- Select a smaller area if the backend reports that the image is too large.

### Protected pages

Chrome itself blocks screenshots of `chrome://` pages, the Chrome Web Store, and some DRM-protected content. If the in-page overlay cannot run, NeostixSnap opens a fallback selector window. If both fail, the results window explains the restriction.

---

## Settings

Open the extension's **Options** page.

| Setting | Purpose |
| --- | --- |
| **Backend URL** | Your NeostixSnap server. Default `http://127.0.0.1:8787`. |
| **Extension access token** | Optional shared secret; must equal `EXTENSION_TOKEN` on the server. Stored locally. |
| **Model override** | Optional per-request model. Server must set `ALLOW_CLIENT_MODEL=true`. |
| **Default answer language** | `Auto` matches the exercise language; a fixed language forces answers and explanations in that language. |

The page also provides:

- Chrome host-permission status and **Grant access**.
- **Test connection** with service, provider, model, auth mode, and readiness.
- Current shortcut and a link to Chrome's shortcut settings.
- Reset to defaults.
- Inline warning when a remote backend uses plain HTTP.

### Chrome permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Temporary access to the tab where you invoke NeostixSnap, so it can capture the visible tab and inject the selection overlay. |
| `scripting` | Injects `content/overlay.js` into that tab. |
| `storage` | Stores settings locally and screenshots briefly in session storage. |
| Host permission for `127.0.0.1:8787` / `localhost:8787` | Calls the default local backend. |
| Optional host permissions | Requests access only to the custom backend origin you enter in Settings. |

The extension does **not** request `<all_urls>` page access, the `tabs` permission, history, bookmarks, cookies, or clipboard-read access. Copy uses the write-only Clipboard API on a user click.

---

## Backend API

### `GET /health`

Public. Returns provider readiness and non-secret configuration.

```json
{
  "ok": true,
  "service": "neostixsnap",
  "version": "1.0.0",
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "ready": true,
  "authRequired": true,
  "problems": [],
  "timestamp": "2026-10-20T10:00:00.000Z"
}
```

`problems` lists missing or invalid configuration without exposing secrets.

### `POST /api/solve`

Requires `Content-Type: application/json`. If `EXTENSION_TOKEN` is set, requires `Authorization: Bearer <token>`.

```json
{
  "image": "data:image/png;base64,...",
  "language": "auto",
  "regenerate": false,
  "model": "optional-model-name"
}
```

- `image`: base64 PNG, JPEG, or WebP data URL. Validated by MIME, magic bytes, and size.
- `language`: `auto` or one of the supported codes.
- `regenerate`: asks the model to re-read and verify from scratch.
- `model`: only accepted with `ALLOW_CLIENT_MODEL=true`.

Success:

```json
{
  "requestId": "uuid",
  "result": {
    "status": "answered",
    "subject": "Mathematics",
    "language": "cs",
    "recognized_question": "Vypočítej: 3x + 5 = 20",
    "answer": "x = 5",
    "steps": ["Odečteme 5 od obou stran: 3x = 15.", "Vydělíme 3: x = 5."],
    "items": [],
    "clarification": null,
    "warning": null,
    "confidence": 0.98
  },
  "meta": {
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "durationMs": 2410,
    "repaired": false,
    "imageBytes": 48213,
    "usage": { "inputTokens": 812, "outputTokens": 305, "totalTokens": 1117 },
    "requestId": "uuid"
  }
}
```

`status` is one of `answered`, `needs_clarification`, or `unsupported`. The server never invents answers; if the model cannot read the task, it returns a clarification request.

Error shape:

```json
{
  "requestId": "uuid",
  "error": {
    "code": "ai_timeout",
    "message": "The AI took too long to answer. Try again, or select a smaller area.",
    "help": "optional additional guidance",
    "retryAfter": 15
  }
}
```

Common codes: `unauthorized`, `rate_limited`, `server_misconfigured`, `invalid_image`, `payload_too_large`, `ai_timeout`, `ai_rate_limited`, `ai_auth_error`, `ai_unreachable`, `ai_invalid_output`, `ai_rejected`, `origin_not_allowed`, `client_model_not_allowed`, `busy`.

### CORS

- With `ALLOWED_ORIGINS` empty, any `chrome-extension://<32 chars>` origin is accepted.
- Set `ALLOWED_ORIGINS=chrome-extension://<your-extension-id>` in production.
- Multiple origins are comma-separated.
- `*` is supported but not recommended with credentials.

Find the extension ID at `chrome://extensions`; it stays stable for a Web Store install and can change for an unpacked copy moved to another path.

---

## Configuration reference

All variables are read from the environment or `server/.env`. Existing process environment variables win over `.env`.

| Variable | Default | Description |
| --- | --- | --- |
| `AI_PROVIDER` | `openai` | `openai`, `openrouter`, `anthropic`, `ollama`, `openai-compatible`. |
| `AI_MODEL` | preset | Vision-capable model name. Required in practice. |
| `AI_API_KEY` | empty | Provider key. Required for OpenAI, OpenRouter, Anthropic. |
| `AI_BASE_URL` | preset | Provider base URL. Required for `openai-compatible`. |
| `EXTENSION_TOKEN` | empty | Shared bearer secret for `/api/solve`. Strongly recommended. |
| `HOST` | `127.0.0.1` | Bind address. Non-loopback requires a token or explicit override. |
| `PORT` | `8787` | HTTP port. |
| `ALLOWED_ORIGINS` | empty | Comma-separated CORS origins. Empty accepts extension origins. |
| `ALLOW_INSECURE_BIND` | `false` | Allow a non-loopback bind without a token. Local testing only. |
| `TRUST_PROXY` | `false` | Use the first `X-Forwarded-For` value for rate limiting behind a trusted proxy. |
| `AI_TIMEOUT_MS` | `60000` | Provider request timeout (5–180 s). |
| `REQUEST_TIMEOUT_MS` | `90000` | HTTP server request timeout (10–240 s). |
| `AI_MAX_OUTPUT_TOKENS` | `2500` | Maximum response tokens. |
| `AI_TEMPERATURE` | `0.2` | Base sampling temperature; regeneration adds 0.12 (capped at 0.7). |
| `AI_RESPONSE_FORMAT` | `auto` | `auto`, `json_schema`, `json_object`, or `none`. |
| `AI_TOKEN_PARAM` | auto | `max_tokens` or `max_completion_tokens`. OpenAI defaults to the latter. |
| `MAX_IMAGE_BYTES` | `6291456` | Decoded image size limit (100 KiB–20 MiB). |
| `BODY_LIMIT_BYTES` | derived | HTTP body limit; defaults to ~1.45× the image limit plus overhead. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Solve rate-limit window. |
| `RATE_LIMIT_MAX` | `20` | Solve requests per IP per window. |
| `HEALTH_RATE_LIMIT_MAX` | `120` | Health requests per IP per window. |
| `MAX_CONCURRENT_AI` | `3` | Parallel provider calls. |
| `MAX_QUEUE` | `8` | Additional requests allowed to wait; beyond that returns `busy`. |
| `ALLOW_CLIENT_MODEL` | `false` | Allow the extension's optional model override. |

The server fails fast on invalid provider names and unsafe bind configurations.

---

## Security and deployment

### Secrets

- `AI_API_KEY` belongs in `server/.env` or the deployment platform's secret store. Never put it in the extension, source control, or chat.
- `EXTENSION_TOKEN` is a shared secret between the backend and the extension settings. It is not a provider key and cannot be used to call the AI provider directly.
- `.env` is ignored by Git and Docker (`server/.dockerignore`).
- The extension stores the token in `chrome.storage.local` in the browser profile; anyone with access to that Chrome profile can read extension storage.

### Remote deployment checklist

1. Use **HTTPS** (reverse proxy with a valid certificate). Plain HTTP exposes screenshots and the token.
2. Set a long random `EXTENSION_TOKEN`.
3. Set `HOST=0.0.0.0` only inside the container/host, with a token configured. The server refuses an unsafe bind otherwise.
4. Set `ALLOWED_ORIGINS=chrome-extension://<your-extension-id>`.
5. Set `TRUST_PROXY=true` only behind a trusted proxy that strips client-supplied `X-Forwarded-For` values.
6. Keep `ALLOW_INSECURE_BIND=false`.
7. Put a request body limit and TLS termination at the proxy as defense in depth.
8. Monitor logs, provider quotas, and error rates. Rate limits are in-memory per process; use one process or external limiting if you horizontally scale.
9. Set `ALLOW_CLIENT_MODEL=false` unless users must choose models.
10. Review the AI provider's data-retention and school-data policies.

### Threat model notes

- The backend is an authenticated proxy to a paid AI provider. Treat a leaked `EXTENSION_TOKEN` as authorization to spend provider quota.
- The screenshot is untrusted content. The system prompt instructs the model to ignore embedded instructions, but prompt injection is not fully solvable; do not rely on the model for security decisions.
- AI answers can be wrong. NeostixSnap is a study aid, not an authoritative source.
- The fallback selector captures the full visible tab before you crop. It is held briefly in session storage; avoid using it on sensitive pages.

See [`SECURITY.md`](SECURITY.md) for reporting and more detail.

---

## Docker

```bash
cd server
cp .env.example .env
# edit .env: provider key, EXTENSION_TOKEN, ALLOWED_ORIGINS
docker compose up --build
```

`docker-compose.yml`:

- maps `8787:8787`
- loads `server/.env`
- sets `HOST=0.0.0.0`
- runs read-only with `no-new-privileges`
- requires a token because Compose binds to a non-loopback address

The health check calls `/health` from inside the container. For a remote deployment, put HTTPS in front of it and use the public HTTPS URL in extension Settings. The extension's optional host permission must be granted for that origin.

---

## Privacy

- No analytics, telemetry, accounts, ads, or browsing-history collection.
- Screenshots are held in memory-backed session storage, sent only to the configured backend, and removed when the results window closes or after the 20-minute stale purge.
- Recognized questions and answers are displayed in the results window and are not persisted by the extension.
- The last capture error (code/message only) may be kept in session storage for the error window.
- The bundled backend logs request metadata (method, path, status, duration, request ID, error code) but not images or recognized questions.
- The configured AI provider processes the image under its own policy. Use Ollama/local inference if images must stay local.

Full policy: [`PRIVACY.md`](PRIVACY.md) and the in-extension page `extension/privacy/privacy.html`.

---

## Testing

### Backend tests

```bash
cd server
npm test
```

The suite uses Node's built-in test runner and covers:

- image validation and size limits
- rate limiting and concurrency
- result parsing, normalization, and invalid-output repair
- HTTP routing, CORS, authentication, health, solve success, and error mapping

### Extension static checks

From the repository root:

```bash
node scripts/check-extension.mjs
```

This validates the manifest, referenced files, icon dimensions, HTML/MV3 CSP rules, JavaScript syntax, and common packaging mistakes.

### Manual checklist

See [`docs/TESTING.md`](docs/TESTING.md) for a full matrix: overlay on normal pages, fallback selector, all error states, keyboard accessibility, language switching, multi-question results, rate limits, and remote HTTPS deployment.

---

## Packaging

Build a clean zip with the manifest at the zip root:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-extension.ps1
```

Output: `dist/neostixsnap-v1.0.0.zip`.

For the Chrome Web Store, also prepare:

- store listing copy and permission justifications: [`docs/STORE_LISTING.md`](docs/STORE_LISTING.md)
- privacy policy URL (host `PRIVACY.md` or the bundled policy page)
- screenshots of the popup, overlay, and results window
- a ZIP containing only `extension/` contents

Regenerate icons if you change the logo:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
```

---

## Project structure

```text
neostixsnap/
├── extension/                     # Load this folder unpacked
│   ├── manifest.json
│   ├── background/service-worker.js
│   ├── content/overlay.js
│   ├── selector/                  # fallback full-tab crop window
│   ├── results/                   # floating answer window
│   ├── popup/                     # toolbar popup
│   ├── options/                   # backend settings and health check
│   ├── privacy/                   # bundled privacy policy
│   ├── shared/                    # settings, languages, base CSS
│   ├── assets/logo.svg
│   └── icons/icon16|32|48|128.png
├── server/                        # zero-dependency Node 20+ backend
│   ├── server.js
│   ├── src/
│   │   ├── app.js                 # HTTP routes, CORS, auth, limits
│   │   ├── config.js              # env parsing and provider presets
│   │   ├── providers.js           # OpenAI-compatible + Anthropic adapters
│   │   ├── solve.js               # prompt → provider → repair → normalize
│   │   ├── prompt.js              # tutor prompt and output contract
│   │   ├── result.js              # JSON extraction, schema, normalization
│   │   ├── image.js               # data URL and magic-byte validation
│   │   ├── auth.js                # constant-time bearer comparison
│   │   ├── rate-limit.js          # fixed-window limiter and semaphore
│   │   └── errors.js
│   ├── test/
│   ├── .env.example
│   ├── Dockerfile
│   └── docker-compose.yml
├── scripts/
│   ├── check-extension.mjs
│   ├── generate-icons.ps1
│   └── package-extension.ps1
├── docs/
│   ├── ARCHITECTURE.md
│   ├── STORE_LISTING.md
│   └── TESTING.md
├── PRIVACY.md
├── SECURITY.md
├── LICENSE
└── README.md
```

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| **Backend offline / unreachable** | Start `node server.js` in `server/`. Check the backend URL and port. Test `curl http://127.0.0.1:8787/health`. |
| **Backend permission needed** | Open Settings, save the URL, and click **Grant access**. Chrome must allow requests to that origin. |
| **Access token rejected** | The token in Settings must exactly equal `EXTENSION_TOKEN` on the server. Restart the server after changing `.env`. |
| **AI key not configured** | `/health` is reachable but the provider settings are incomplete. Set `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY`, then restart. |
| **Origin not allowed** | Set `ALLOWED_ORIGINS` to your extension origin (or clear it to accept extension origins). |
| **Model rejected / AI request rejected** | Confirm the model is multimodal and the provider supports image input. Try the provider's documented vision model. |
| **Client model not allowed** | Clear the model override in Settings or set `ALLOW_CLIENT_MODEL=true`. |
| **Screenshot too large** | Select a smaller area, reduce browser zoom, or raise `MAX_IMAGE_BYTES`. |
| **Chrome blocks capture** | `chrome://` pages, the Chrome Web Store, and DRM content are blocked. Use a regular tab. |
| **A selection is already active** | Press `Esc` to cancel the overlay, then press `Alt + Q` again. |
| **No overlay on a PDF** | The fallback selector window should open. If it does not, open the PDF in a regular tab or capture the visible area with the popup. |
| **Shortcut does nothing** | Open `chrome://extensions/shortcuts` and assign a different combination. |
| **Answers are slow** | Vision models can take several seconds. Try a faster model or smaller capture; check `AI_TIMEOUT_MS`. |
| **Answers are wrong** | AI can make mistakes. Regenerate, capture more clearly, or use a stronger model. Always verify important facts. |

### Debugging

- Service worker logs: `chrome://extensions` → NeostixSnap → **Inspect views: service worker**.
- Results page logs: right-click the results window → **Inspect**.
- Backend logs: request ID, method, path, status, duration, and error code.
- `GET /health` never exposes API keys.

---

## Limitations

- **Requires external AI.** There is no local OCR or offline answer engine. Without a configured provider, the extension cannot solve anything.
- **AI answers can be incorrect.** The prompt demands verification and clarification over guessing, but models still hallucinate.
- **Screenshot coverage.** Chrome blocks browser-internal pages, the Web Store, and some protected video/DRM surfaces.
- **Fallback captures the full tab.** The fallback selector stores the visible tab briefly before cropping. Avoid sensitive pages.
- **In-memory rate limits and queue.** Run a single backend process or add shared limiting when scaling horizontally.
- **One displayed answer window.** A new capture reuses the existing results window.
- **No persistent history.** This is intentional. Copy an answer if you need to keep it.
- **Model support varies.** JSON schema and parameter support differ by provider; the backend has fallbacks and environment overrides.

---

## License

MIT. See [`LICENSE`](LICENSE).

NeostixSnap is an independent project. Provider names are trademarks of their respective owners.
