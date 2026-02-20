# Release Notes — v1.7.10

**Release Date:** February 19, 2026

Nightjar v1.7.10 is a **targeted regression fix release** addressing three functional
regressions introduced during the v1.7.9 security audit, plus a React hooks compliance
fix. All fixes are verified with the full test suite: **132 suites, 3,879 tests
(0 failures)**.

---

## 🔴 Critical Fix

### Bug Report Modal — GitHub API Submission Restored
The v1.7.9 audit inadvertently removed the `createGitHubIssue()` function and replaced
the entire bug submission flow with clipboard-only copy. This release restores the
**API-first submission strategy**:

- **Restored `createGitHubIssue()`** — exported async function that POSTs to the
  GitHub REST API (`/repos/niyanagi/nightjar/issues`) using the configured PAT
- **API-first, clipboard-fallback** — `handleSubmit` now attempts GitHub API submission
  first; if no PAT is configured or the API call fails, it gracefully degrades to
  clipboard copy (and then to file download as a last resort)
- **Dynamic success screen** — heading, body text, and action button update based on
  whether the issue was submitted via API ("Bug report submitted!" / "View Issue on
  GitHub") or clipboard fallback ("Bug report copied!" / "Open GitHub Issues")
- **Updated UI text** — submit button now reads "🐛 Submit Bug Report" (was
  "📋 Copy Bug Report"), info text explains the API-first approach, submitting state
  shows "Submitting…" (was "Preparing…")
- **Jest-compatible PAT access** — uses `process.env.VITE_GITHUB_PAT` (injected by
  Vite's `define` config) instead of `import.meta.env` which breaks Babel/Jest transform

**Files changed:**
- `frontend/src/components/BugReportModal.jsx` — +37 lines (new function), refactored
  `handleSubmit`, new `submittedViaApi` state, dynamic UI
- `tests/bug-report-modal.test.jsx` — 22 text references updated for new button/heading labels
- `tests/bugfix-v1.8.0.test.jsx` — 1 text reference updated

---

## 🟡 UI Fixes

### Changelog Timeline Slider Labels Swapped
The v1.7.9 audit introduced swapped "Oldest" / "Newest" labels on the changelog
timeline slider. The data loads with `newestFirst: true` (index 0 = newest), but the
left label said "Oldest" — the exact opposite of reality.

- **Fix**: Left label now correctly reads **"Newest"** (index 0), right label reads
  **"Oldest"** (max index)
- Affects `frontend/src/components/Changelog.jsx` (2-line swap)

### Rename Double-Fire in Sidebar Tree
Pressing Enter to confirm a rename in the workspace/folder/document tree caused the
rename handler to fire twice — once from the `onKeyDown` handler calling
`onRenameSubmit?.()` directly, and again from the subsequent `onBlur` event which
also calls `onRenameSubmit?.()`.

- **Fix**: Enter key handler now calls `e.target.blur()` instead of `onRenameSubmit?.()`,
  so only the blur handler fires the submit — single invocation, no double-fire
- Affects `frontend/src/components/HierarchicalSidebar.jsx` (1-line change)

---

## 🟢 React Compliance Fix

### IdentitySelector — Hooks Order Compliance
A `useEffect` hook was placed after an early `return` statement (the loading spinner),
violating React's Rules of Hooks which require hooks to be called in the same order
every render. This could cause React to throw in development mode or produce
unpredictable behavior.

- **Fix**: Moved the `useEffect` hook above the early `if (loading)` return so it
  executes on every render path
- Affects `frontend/src/components/IdentitySelector.jsx` (moved 5 lines)

---

## 📊 Test Results

| Metric        | Value                     |
|---------------|---------------------------|
| Test suites   | 132 passed, 0 failed      |
| Tests         | 3,873 passed, 6 skipped   |
| Total         | 3,879                     |
| Duration      | ~55s                      |

---

## 📁 Files Modified (6 total)

### Frontend Components (4 files)
| File | Lines Changed | Change |
|------|--------------|--------|
| `BugReportModal.jsx` | +67 / -18 | Restored GitHub API submission, dynamic success screen |
| `Changelog.jsx` | +2 / -2 | Swapped slider labels to match data order |
| `HierarchicalSidebar.jsx` | +1 / -1 | Fixed rename double-fire via blur delegation |
| `IdentitySelector.jsx` | +7 / -5 | Moved useEffect above early return |

### Tests (2 files)
| File | Lines Changed | Change |
|------|--------------|--------|
| `bug-report-modal.test.jsx` | +24 / -24 | Updated text references for new UI labels |
| `bugfix-v1.8.0.test.jsx` | +1 / -1 | Updated submit button text reference |

---

## ⬆️ Upgrade Notes

- **No breaking changes** — this is a drop-in replacement for v1.7.9
- **PAT configuration** — if you want bug reports to auto-submit to GitHub, set
  `VITE_GITHUB_PAT` in your `.env` file. Without it, the modal gracefully falls
  back to clipboard copy (same behavior as v1.7.9)
- **No data migration required** — no schema, key, or storage changes
