# Security policy

NeostixSnap is a Chrome extension plus a self-hosted Node.js proxy. The extension holds no AI provider key. The backend holds the provider key and exposes one authenticated solve endpoint.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| < 1.0 | No |

Security fixes are applied to the current release line.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability that could expose data, provider keys, or backend quota.**

Report privately to the repository maintainer through the security advisory or private-contact channel associated with the project. Include:

- affected version or commit;
- browser and operating system;
- a short description of the issue and its impact;
- reproduction steps or a proof of concept;
- whether the issue affects the extension, the backend, or both;
- any suggested fix or mitigation.

You should receive an acknowledgement within a reasonable time. Please allow time for a fix before public disclosure. Do not include real provider keys, access tokens, screenshots of private documents, or personal data in a report.

## Security model

### Trust boundaries

| Asset | Where it lives | Who can access it |
| --- | --- | --- |
| AI provider API key (`AI_API_KEY`) | Backend environment / secret store | Backend operator |
| Extension access token (`EXTENSION_TOKEN`) | Backend environment and `chrome.storage.local` | Backend operator and anyone with access to the Chrome profile |
| Screenshot of the selected exercise | `chrome.storage.session` and request memory | The user, the browser profile, the configured backend, and the configured AI provider |
| Recognized question and answer | Results window memory | The user and the browser profile |
| Settings | `chrome.storage.local` | Anyone with access to the Chrome profile |
| Server logs | Backend operator | Backend operator / hosting provider |

### What the extension can access

The extension requests only:

- `activeTab` — temporary access to the tab where the user invokes a capture;
- `scripting` — injects the selection overlay into that tab;
- `storage` — settings in local storage and ephemeral screenshots in session storage.

It has host access to the default loopback backend and requests optional host access only for the backend origin configured in Settings. It does not request `<all_urls>`, `tabs`, history, bookmarks, cookies, or clipboard-read access.

### What the backend trusts

- The screenshot is **untrusted content**. The model is instructed to ignore instructions embedded in the image, but prompt injection cannot be eliminated. The model must not be used for security decisions.
- The `Origin` header is used for CORS; it is not an authentication mechanism.
- `EXTENSION_TOKEN` is the authentication mechanism for `/api/solve`. Treat a leaked token as permission to spend provider quota.
- `X-Forwarded-For` is trusted only when `TRUST_PROXY=true` and the backend is behind a proxy that strips client-supplied values.

## Deployment hardening

1. **Use HTTPS for remote backends.** Plain HTTP exposes screenshots and the bearer token in transit.
2. **Set a long random `EXTENSION_TOKEN`.** Example: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. **Never expose a non-loopback bind without a token.** The server refuses to start unless `EXTENSION_TOKEN` is set or `ALLOW_INSECURE_BIND=true` is explicitly set. Leave the override off outside short-lived local tests.
4. **Restrict CORS.** Set `ALLOWED_ORIGINS=chrome-extension://<your-extension-id>` in production. Leaving it empty accepts any syntactically valid extension origin.
5. **Set `TRUST_PROXY=true` only behind a trusted proxy** that overwrites `X-Forwarded-For`. Otherwise rate limiting can be bypassed.
6. **Keep `ALLOW_CLIENT_MODEL=false`** unless users genuinely need per-request model selection.
7. **Protect the environment.** Put `AI_API_KEY` and `EXTENSION_TOKEN` in a secret manager or a permission-restricted `.env`. Never commit `.env`; it is ignored by Git and Docker.
8. **Terminate TLS and enforce a request-size limit at the proxy** as defense in depth, even though the Node server validates image size.
9. **Scale carefully.** Rate limits and the concurrency semaphore are in memory per process. Use one process or an external limiter when scaling horizontally.
10. **Rotate credentials** if a token or provider key is exposed. Restart the backend after changing environment values.
11. **Review provider retention.** The configured AI provider processes screenshots under its own policy. Use Ollama or another local provider when images must stay on your machine.
12. **Keep dependencies minimal.** The backend has zero runtime npm dependencies, which reduces supply-chain exposure. Re-audit the Docker base image and Node version regularly.

## Extension hardening notes

- The manifest uses Manifest V3, a module service worker, and the default extension content security policy. Inline scripts are not used.
- The selection overlay runs in an isolated content-script world and renders inside a closed-over shadow root. It is removed after capture, cancellation, or failure.
- Screenshots are stored in `chrome.storage.session`, which is memory-backed and configured for trusted extension contexts only. The extension removes the active job when the results window closes and purges stale entries after 20 minutes.
- The results page sends the screenshot directly to the configured backend. The service worker does not hold provider credentials.
- The backend validates the data URL, MIME type, image magic bytes, and decoded size before calling the provider.
- The backend returns allowlisted, user-safe error objects. Provider response bodies and stack traces are not returned to the client.
- AI output is parsed as strict JSON, normalized, and length-limited. Markdown/HTML from the model is rendered as text, not as HTML.

## Known limitations

- **AI prompt injection** through image content cannot be fully prevented. The backend never grants the model tools or access to user accounts.
- **Shared browser profiles** expose extension settings and the access token to anyone who can use that profile. Use a separate Chrome profile for sensitive deployments.
- **The fallback selector captures the full visible tab** before cropping. Avoid using it on sensitive pages.
- **Rate limits are per process.** Multiple backend replicas do not share counters.
- **AI answers can be wrong.** This is a correctness limitation, not a security boundary; always verify important facts.

## Privacy

See [PRIVACY.md](PRIVACY.md) for data flows and retention. In short: screenshots are held only in session memory, sent only to the configured backend, and are not persisted by the extension. The backend logs request metadata, not images or recognized questions.
