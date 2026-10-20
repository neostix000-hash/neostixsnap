# NeostixSnap privacy policy

**Version 1.0 · Effective 20 October 2026**

NeostixSnap is a self-hosted Chrome extension that turns a screenshot of a school exercise into an explained answer. This policy describes exactly what the extension and the bundled backend process, where data goes, and how long it is kept. The same policy is bundled in the extension at `extension/privacy/privacy.html`.

## Short version

- You choose what to capture. Nothing is captured until you press **Alt + Q** or click **Snap & Solve**.
- Selected screenshots are held in Chrome session memory only. They are sent to the backend you configure, and the extension drops them when the results window closes or after a 20-minute stale-state purge.
- The extension stores no browsing history, no analytics, and no permanent copies of screenshots or recognized questions.
- Provider API keys live on the backend, never in the extension.
- The configured AI provider processes the screenshot under its own terms and retention policy. Use a local model such as Ollama if images must not leave your machine.

## 1. What is processed

### Selected screenshot

When you start a capture, the extension captures the visible tab. You drag over the exercise, and the selected region is cropped and held in `chrome.storage.session` (memory-backed session storage). When the results window requests a solution, the image is sent to the backend URL from Settings.

If the in-page overlay cannot run, the extension can open a fallback selection window. The visible tab is captured first, held briefly in session storage, and cropped after you select an area. That capture is removed when the selection is completed or cancelled, when the selection window closes, or by the 20-minute stale-state purge.

### Recognized question, answer, and steps

The backend returns structured text: the transcribed exercise, a final answer, explanation steps, clarification, and a confidence value. The extension displays it in the results window and does not write it to persistent storage. It reaches your clipboard only when you press **Copy**.

### Settings

The backend URL, optional extension access token, default answer language, and optional model override are stored in `chrome.storage.local` in your Chrome profile. They stay on your device until you reset them, clear extension data, or uninstall the extension.

### Technical error information

The most recent capture error (error code and human-readable message) may be kept in session storage to display an error window. It contains no screenshot or recognized exercise text and is discarded when the browser session ends or by the stale-state purge.

## 2. What is never collected

- Browsing history, open-tab lists, page URLs you did not capture, or page content outside the selected region.
- Keystrokes, mouse activity, form data, passwords, or clipboard contents.
- Analytics, telemetry, advertising identifiers, or usage profiles.
- Names, email addresses, accounts, or payment information. The extension has no account system.
- Persistent copies of screenshots or recognized questions inside the extension.

The extension does not read page content until you invoke a capture. The overlay is injected only into the tab being captured and removes itself afterwards.

## 3. External AI processing

NeostixSnap is a client for an AI vision backend configured by you or your organization. The backend holds the provider API key. For each request it sends the selected screenshot and solving instructions to the configured provider, such as OpenAI, OpenRouter, Anthropic, a local Ollama server, or another OpenAI-compatible service.

> **Important:** The AI provider processes the screenshot under its own terms and retention policy. NeostixSnap cannot guarantee immediate deletion by a third-party provider. Review the policy of the provider your backend administrator configured.

The bundled backend does not write screenshots or recognized questions to its logs. It logs request metadata: HTTP method, path, status, duration, request ID, and error code. Hosting infrastructure outside the bundled code may record IP addresses, timestamps, or traffic metadata depending on deployment.

## 4. Storage and retention

| Data | Where | How long |
| --- | --- | --- |
| Selected screenshot | `chrome.storage.session` (memory-backed) | Removed when the results window closes; stale jobs purged after 20 minutes. |
| Fallback full-tab capture | `chrome.storage.session` | Removed after selection, cancellation, or window close; stale entries purged after 20 minutes. |
| Recognized question and answer | Results window memory | Until the window closes; never written to extension storage. |
| Last capture error | `chrome.storage.session` | Until overwritten, browser session end, or the 20-minute cleanup. |
| Settings and access token | `chrome.storage.local` | Until reset, extension data is cleared, or the extension is uninstalled. |
| Server logs | Backend operator's environment | Determined by the operator; bundled server logs request metadata only. |

## 5. Chrome permissions

- **`activeTab`** — temporary access to the tab where you invoke NeostixSnap, used to take a screenshot and show the selection overlay. It does not grant ongoing access to every site.
- **`scripting`** — injects the drag-selection overlay into the current tab for the duration of the capture.
- **`storage`** — stores settings locally and keeps screenshots briefly in session memory.
- **Host access** — the extension ships with access to the default local backend (`127.0.0.1:8787` and `localhost:8787`). For another backend, Settings requests access only to the origin you enter. The extension does not need host access to captured websites.

## 6. Sharing and sale of data

NeostixSnap does not sell, rent, or share data with advertisers or data brokers. The only external recipients are the backend you configure and, through that backend, the AI provider chosen by its operator. If a school or another organization operates the backend, that organization controls its retention and access policies.

## 7. Security measures

- Provider API keys stay server-side and are never included in the extension package.
- An optional shared `EXTENSION_TOKEN` can require a bearer token for solve requests.
- The server refuses to bind to a non-loopback address without a token unless explicitly overridden.
- Settings request host access only for the configured backend origin.
- HTTPS is strongly recommended for remote backends; the Settings page warns about plain HTTP.
- The overlay is injected only into the active tab and only when you start a capture.

No system is perfectly secure. Do not capture passwords, payment details, identity documents, or other sensitive personal information.

## 8. Your controls

- Reset the backend URL, token, model, and language in Settings.
- Clear extension data or uninstall NeostixSnap to remove local settings.
- Choose **Auto** or a fixed answer language at any time.
- Use a local Ollama backend if screenshots must not leave your device.
- Close the results window to trigger deletion of the active capture.
- Configure the backend to reject unknown origins or require an extension token.

## 9. Schools, students, and backend operators

NeostixSnap is self-hosted software. The person or organization providing your backend is responsible for the AI provider account, server logs, access control, and any consent or data-protection obligations that apply to student work. If NeostixSnap was installed by your school, contact its administrator with privacy questions.

The open-source project does not operate a central service and does not receive your screenshots. Questions about the project itself can be raised in the issue tracker of the repository from which you obtained it.

## 10. Changes to this policy

This policy is versioned with the extension. Material changes will be reflected in a new version and in the policy shipped with the extension. Because the extension does not collect contact details, it cannot notify you directly; check this page after an update.
