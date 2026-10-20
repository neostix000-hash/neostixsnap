# Chrome Web Store listing kit

Copy for the store listing, permission justifications, privacy disclosures, and the review checklist. Replace bracketed placeholders before submission.

> **Important:** NeostixSnap is not usable without a backend. The store listing must say so. Reviewers need a reachable test backend or clear instructions to run one with their own provider key. Do not submit an extension that silently fails for reviewers.

## Listing basics

| Field | Value |
| --- | --- |
| **Name** | NeostixSnap — Snap & Solve |
| **Short name** | NeostixSnap |
| **Category** | Education (alternative: Productivity) |
| **Language** | English |
| **Version** | 1.0.0 |
| **Minimum Chrome** | 116 |
| **Homepage** | `[your public project URL]` |
| **Support URL** | `[your support page or repository issues URL]` |
| **Privacy policy URL** | `[public HTTPS URL hosting PRIVACY.md or the bundled policy page]` |
| **Developer** | `[your developer or organization name]` |
| **Contact email** | `[your support email]` |

### Short description (132 characters max)

> Snap any school exercise with Alt+Q and get an AI answer with clear steps — every subject.

Length: 100 characters. Alternative:

> Alt+Q turns a screenshot of any school task into an explained AI answer. Math, languages, science and more.

Length: 104 characters.

### Single purpose

> NeostixSnap lets a user capture one school exercise with a keyboard shortcut and receive an AI-generated answer with explanation steps in a floating window.

## Full description

```text
NeostixSnap turns a screenshot of a school exercise into an explained answer — without leaving the page.

Press Alt + Q, drag a box around the task, and a compact floating window opens with the recognized question, the final answer, and step-by-step reasoning. It works with printed text, diagrams, tables, and legible handwriting.

BUILT FOR SCHOOLWORK
• Mathematics, Czech language and literature, English and other languages, physics, chemistry, biology, history, geography, civics, computer science, and general knowledge
• Detects the subject and the exercise language automatically
• Answers Czech exercises in Czech; you can also force a language
• Handles multiple separate exercises with per-item answers
• Uses readable Unicode notation instead of LaTeX
• Flags uncertain readings instead of guessing

ONE-SHOT FLOW
• Alt + Q on any supported page
• Drag over the whole task
• Read the answer, expand the steps, copy, regenerate, or snap another

PRIVATE BY DESIGN
• No analytics, accounts, ads, or browsing-history collection
• Screenshots are held only in Chrome session memory
• A screenshot is sent only when you finish a selection, and only to the backend you configure
• The provider API key lives on the backend, never in the extension
• Screenshots and recognized questions are not saved as history

WHAT YOU NEED
NeostixSnap is a client for a self-hosted AI vision backend. You (or your school) must run the included Node.js server and connect a vision-capable AI provider such as OpenAI, OpenRouter, Anthropic, or a local Ollama model. The extension does nothing without a configured backend. Setup instructions and the server source are included with the project.

The configured AI provider processes the selected screenshot under its own terms and retention policy. If images must stay on your machine, use a local provider such as Ollama.

AI can make mistakes. NeostixSnap is a study aid; always double-check important facts.

NeostixSnap is an independent project. Provider names are trademarks of their respective owners.
```

## Screenshots and promotional assets

Prepare these before submitting. Use a clean Chrome profile with no personal data, a real exercise, and realistic answers from a live provider.

| Asset | Size | Suggested scene |
| --- | --- | --- |
| Screenshot 1 | 1280 × 800 | Popup open over a school exercise page, “From screen to solved.” |
| Screenshot 2 | 1280 × 800 | Selection overlay with a clear math exercise framed and the HUD visible. |
| Screenshot 3 | 1280 × 800 | Results window with recognized question, answer, and expanded steps. |
| Screenshot 4 | 1280 × 800 | Multi-exercise result with two item cards. |
| Screenshot 5 | 1280 × 800 | Settings page showing a Ready backend and permission status. |
| Small promo tile | 440 × 280 | Logo, product name, “Alt + Q → explained answer.” |
| Marquee (optional) | 1400 × 560 | Overlay/answer composition with the subject range. |
| Store icon | 128 × 128 | `extension/icons/icon128.png`. |

Guidelines:

- Show the actual UI, not a mockup that differs from the product.
- Do not include personal names, school portals with private data, provider keys, or tokens.
- Do not claim “homework answers for every test” or guaranteed correctness.
- Keep text large enough to read at store thumbnail size.
- Use the same dark navy/cyan/violet branding as the extension.

## Permission justifications

### `activeTab`

> NeostixSnap needs temporary access to the tab where the user explicitly invokes a capture (Alt+Q, popup button, or Snap another) so it can take a screenshot of the visible page and inject the drag-selection overlay. The permission is not used for background browsing, and the extension does not request ongoing access to all sites.

### `scripting`

> Used only after a user starts a capture, to inject the temporary selection overlay into the current tab. The overlay lets the user choose the exercise region, then removes itself. No persistent content script is registered.

### `storage`

> Stores the backend URL, optional extension access token, model/language preferences, and a screenshot briefly in memory-backed session storage while the answer window is open. Screenshots are removed when the window closes or after a 20-minute stale-state purge.

### Host permission: `http://127.0.0.1:8787/*`, `http://localhost:8787/*`

> Required to contact the default local NeostixSnap backend that the user runs on their own computer.

### Optional host permissions: `http://*/*`, `https://*/*`

> Used to request access only to the specific backend origin the user enters in Settings (for example, a school server or a personal HTTPS deployment). Chrome shows the origin in the permission prompt. The extension does not request access to captured websites, and it does not use these patterns to read arbitrary pages.

### Why no `tabs`, `<all_urls>`, history, cookies, or clipboard-read?

- The capture flow uses `activeTab` and `scripting`; it does not need the broad `tabs` permission.
- Backend requests are covered by host permissions for the configured origin.
- Copy uses the write-only Clipboard API on a user click.
- The extension does not read history, cookies, bookmarks, or clipboard contents.

## Privacy practices form

Answer the Chrome Web Store privacy questionnaire consistently with the implementation. A conservative, accurate mapping:

| Question | Answer |
| --- | --- |
| Does the extension collect personally identifiable information? | No account data, names, or emails are collected by the extension. A user-selected screenshot may incidentally contain personal information. |
| Does it collect health information? | No. |
| Does it collect financial/payment information? | No. |
| Does it collect authentication information? | The optional backend access token is stored locally and sent only to the configured backend as a bearer credential. No account passwords are collected. |
| Does it collect personal communications? | No intentional collection; a screenshot may contain user-selected content. |
| Does it collect location? | No. |
| Does it collect web history? | No. |
| Does it collect user activity? | No analytics, telemetry, or click tracking. |
| Does it collect website content? | Only the region the user explicitly selects, and only when the user completes a capture. It is sent to the user-configured backend for the sole purpose of generating an answer. |
| Is data sold to third parties? | No. |
| Is data used for purposes unrelated to the single purpose? | No. |
| Is data used for creditworthiness/lending? | No. |
| Is data transferred to third parties? | The selected screenshot is sent to the backend configured by the user and, through that backend, to the AI provider chosen by the backend operator. |

Suggested certification text:

> I certify that NeostixSnap does not sell or transfer user data to third parties for purposes unrelated to its single purpose, does not use or transfer user data for determining creditworthiness or lending purposes, and does not use or transfer user data for purposes unrelated to its single purpose.

Also state in the privacy policy:

- screenshots are session-only in the extension;
- the backend logs request metadata, not images or questions;
- the AI provider's own retention policy applies;
- users can run a local model to keep images on their machine.

## Remote code declaration

> NeostixSnap does not load or execute remote code. All extension JavaScript is packaged in the ZIP. The backend sends screenshots and prompts to an AI provider and receives data, not executable code.

The extension does not use `eval`, `new Function`, remote `<script>` tags, or remotely hosted WASM.

## Review instructions

Provide a short reviewer note in the submission form:

```text
NeostixSnap requires a backend and a vision-capable AI provider; it is not a standalone answer database.

Option A — reviewer backend:
1. Backend URL: [https://review.example.com]
2. Access token: [review token, rotate after review]
3. Install the extension, open Options, enter the URL and token, save, grant host access.
4. Open any page with a school exercise, press Alt+Q, drag over the task.
5. A result window should show the question, answer, and steps.

Option B — local:
1. The server source is in the submitted project under server/.
2. Copy server/.env.example to server/.env and set AI_PROVIDER, AI_MODEL, AI_API_KEY.
3. Run `node server.js` with Node 20+.
4. Set the extension backend URL to http://127.0.0.1:8787 and test the connection.

No account is required. No hardcoded or sample answers are included.
```

If you provide a reviewer backend, monitor its usage, restrict it to the review period, and never reuse a production token.

## Data retention summary for the listing

| Data | Retention |
| --- | --- |
| Selected screenshot | Chrome session memory; removed when the results window closes or after 20 minutes. Sent to the configured backend only on capture completion. |
| Fallback full-tab capture | Session memory; removed after crop/cancel/window close or after 20 minutes. |
| Question/answer | Results window memory only; not persisted by the extension. |
| Settings/token | `chrome.storage.local` until reset, data cleared, or uninstall. |
| Backend logs | Request metadata only; retention set by the backend operator. |
| AI provider | Per the provider's policy; local Ollama keeps images local. |

## Submission checklist

- [ ] ZIP contains `manifest.json` at the root and only extension files.
- [ ] Version in `manifest.json`, `package.json`, and listing match.
- [ ] Name, short description, full description, category, language set.
- [ ] At least one 1280 × 800 screenshot; 440 × 280 tile prepared.
- [ ] 128 × 128 store icon uploaded.
- [ ] Privacy policy hosted at a public HTTPS URL and linked in the listing and extension.
- [ ] Privacy practices questionnaire matches the table above.
- [ ] Permission justifications entered for `activeTab`, `scripting`, `storage`, and host permissions.
- [ ] Single purpose statement entered.
- [ ] Remote code declaration: no.
- [ ] Reviewer instructions and (if used) a temporary backend/token provided.
- [ ] Support URL and contact email monitored.
- [ ] Test install from the exact submitted ZIP in a clean profile.
- [ ] Rotate any token shared with reviewers after the review.
- [ ] No personal data, keys, or backend `.env` in screenshots or the ZIP.
