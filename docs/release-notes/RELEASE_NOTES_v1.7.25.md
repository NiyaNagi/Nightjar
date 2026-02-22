# Release Notes — v1.7.25

**Release Date:** 2025-06-23
**Focus:** Share link reliability — fixes silent failures, Electron deep link handling, and session race condition

---

## Bug Fixes

### 1. Silent parse errors on manual paste (CreateWorkspace.jsx) — Critical
When users pasted a share link into the join dialog and parsing failed (e.g., malformed link, checksum mismatch), the error was **silently swallowed** — the Join button stayed disabled with no explanation. Users had no idea why their link wasn't working.

**Fix:** The catch block in `handleLinkChange` now displays the error message to the user via the `joinError` state, and logs the error to the console for debugging.

### 2. Electron deep link handler was dead code (AppNew.jsx) — Critical
The `registerLinkHandler()` function in `linkHandler.js` was **never called** by any component. When a user clicked a `nightjar://` link while the Electron app was running, the main process sent the link via IPC (`protocol-link` event), but the renderer had no listener registered. The app would focus but the join dialog never opened.

**Fix:** Added an `onProtocolLink` IPC listener directly in AppNew.jsx's share link useEffect. When a protocol link arrives via IPC, it's stored in sessionStorage and the join dialog opens automatically.

### 3. Pending share link cleared by race condition (AppNew.jsx) — Medium
The share link detection useEffect had a fallback path that cleared `pendingShareLink` from sessionStorage when the URL had no fragment. If the useEffect re-fired (due to React re-renders or strict mode), this could wipe a valid pending link before the CreateWorkspace dialog consumed it — the share link would silently disappear.

**Fix:** The clearing logic now checks the link's expiry timestamp. Fresh links (not yet expired) are preserved for the dialog to consume. Only actually-expired or origin-unknown links are cleared.

### 4. HTTPS join URLs rejected by Electron main process (main.js) — Medium
The `handleProtocolLink` function in the Electron main process only accepted URLs starting with `nightjar://`. HTTPS share links (e.g., `https://night-jar.co/join/w/...`) passed as command-line arguments were silently dropped.

**Fix:** `handleProtocolLink` now also accepts HTTPS URLs containing `/join/` and automatically converts them to `nightjar://` format before forwarding to the renderer. The `second-instance` and startup handlers also detect HTTPS join URLs.

---

## Files Changed

- `frontend/src/components/CreateWorkspace.jsx` — Error feedback in share link parsing
- `frontend/src/AppNew.jsx` — Electron IPC listener, pendingShareLink race guard
- `src/main.js` — HTTPS join URL handling in protocol link handler

## Issue References

- Closes #10 — "Sharing still doesn't work"
