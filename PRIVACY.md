# Sitr privacy policy

Effective date: October 5, 2026. Applies to the unpacked Sitr 0.4.2 extension.

## Processing and storage

Sitr analyzes supported media on your device using packaged inference code and
models. It sends no frames, face crops, appearance estimates, masks, or tracks to
an inference service. It contains no analytics, advertisements, telemetry, user
account, or remote model-update mechanism. It does not use age predictions or
face identity recognition.

Frames, derived masks, short-lived labels, and media-analysis caches exist in
memory. They are not written to extension storage. Settings, website exceptions,
and interface preferences are saved in `chrome.storage.local`, not Chrome sync.
Closing/reloading pages or stopping the local engine retires temporary analysis
state. Removing the extension removes its Chrome-managed local storage.

## Network requests

The websites you visit still make their normal requests. Sitr may fetch an
image's original HTTP(S) URL through extension host permissions when the page
cannot provide readable pixels. That request can include existing credentials
or cookies for that origin. The original website/CDN can observe the request
and your IP address. Sitr does not forward it to a separate service.

For unreadable HTTP(S) video, Sitr can perform an anonymous CORS range check and
reload the same source with anonymous CORS if allowed. This may briefly interrupt
playback. Browser or developer diagnostics can display media status and local
appearance estimates. Screenshots or reports you share are your own disclosure;
review them before posting.

Developer model-download commands retrieve weights from their named upstream
providers. Those setup commands are separate from installed-extension behavior.

## Permissions

| Permission | Purpose |
|---|---|
| `offscreen` | Keep local inference workers in an extension-owned offscreen document. |
| `storage` | Save coverage settings, site exceptions, and interface preferences locally. |
| HTTP(S) host access | Inject protection into page media and frames, read media URLs, and acquire images for local analysis. |

The extension uses no camera, microphone, browsing-history, or identity
permission. Its popup queries the active tab under the granted host access.
Pausing a site clears protection there; restricting Chrome's site-access grants
can prevent Sitr from operating on that site or its embedded frames.

## Reporting issues

Use the repository's Issues page for general questions. Use the private reporting
procedure in [SECURITY.md](SECURITY.md) for vulnerabilities. Do not include private
media, cookies, authentication tokens, or sensitive browsing URLs in public posts.
