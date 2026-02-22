# Nightjar v1.7.18 — Consistent Appearance Picker

**Release Date**: February 20, 2026

---

## 🎯 Summary

Standardizes the appearance (emoji + color) picker across every dialog in the app. The "Create New Item" modal was the only place using an inline compact mode that rendered the full emoji grid and color palette directly inside the modal body. It now uses the same popout-trigger pattern as all other dialogs — a small colored bubble that opens a floating popover on click.

---

## 🐛 Bug Fixes

### Appearance Picker Inconsistency in Create Document Dialog
- **Problem**: When creating a new document, spreadsheet, kanban board, inventory, or file storage item, the appearance selector rendered the full emoji grid + color palette inline inside the modal body, consuming significant vertical space and looking different from every other appearance picker in the app
- **Root Cause**: `CreateDocument.jsx` was passing `compact={true}` to `UnifiedPicker`, which triggered an inline rendering mode that bypassed the portal-based popover
- **Fix**: Replaced `compact` with `size="medium"` to use the standard bubble-trigger → floating popover pattern, matching `EditDocumentModal`, `FolderSettingsModal`, and all 11 other picker instances
- **Files Changed**: `frontend/src/components/CreateDocument.jsx`

---

## 🧹 Code Cleanup

### Removed Dead `compact` Prop from UnifiedPicker
With `CreateDocument.jsx` being the sole consumer of the `compact` prop, the entire inline rendering path is now dead code. Removed:

| Component | Removed |
|---|---|
| `UnifiedPicker.jsx` | `compact` prop, conditional trigger rendering (`!compact &&`), inline vs portal ternary, `--inline` popover class, compact guard in positioning effect |
| `UnifiedPicker.css` | `.unified-picker--compact` rule, `.unified-picker__popover--inline` rule |
| **Net reduction** | ~30 lines JS, ~20 lines CSS |

The popover now always renders via `createPortal` with a close button, matching the standard UX pattern throughout the app.

---

## 🧪 Test Updates

Updated 8 tests across 2 test files:

| Test File | Changes |
|---|---|
| `tests/components/common/UnifiedPicker.test.js` | Removed compact rendering test; mode prop tests now open popover before asserting; color sync test uses popover; updated header comment |
| `tests/ui-components.test.js` | Removed compact inline popover test; mode prop tests converted to async with popover open |

**Test Results**: 4537 passing, 6 skipped, 10 pre-existing failures in unrelated suites (relay infrastructure, mobile optimizations, public site content, bugfix-v1.8.0)

---

## 📁 Files Changed

| File | Change |
|---|---|
| `frontend/src/components/CreateDocument.jsx` | `compact` → `size="medium"` |
| `frontend/src/components/common/UnifiedPicker.jsx` | Remove compact prop + inline rendering path |
| `frontend/src/components/common/UnifiedPicker.css` | Remove compact + inline CSS rules |
| `tests/components/common/UnifiedPicker.test.js` | Update tests to use popover pattern |
| `tests/ui-components.test.js` | Update tests to use popover pattern |
| `README.md` | Add v1.7.18 changelog entry |
| `frontend/public-site/index.html` | Bump version to 1.7.18 |
| `package.json` | Bump version to 1.7.18 |

---

## ⬆️ Upgrade Notes

- **No breaking changes** — the `compact` prop was only used internally
- **No migration needed** — the picker behavior is now consistent everywhere
- Rebuild Docker image and restart containers to deploy
