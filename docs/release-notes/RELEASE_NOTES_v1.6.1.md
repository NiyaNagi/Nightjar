# Release Notes — Nightjar v1.6.1

**Release Date:** 2025-07-14

## Summary

Patch release fixing critical bugs in the inventory import pipeline and analytics views, along with expanded test coverage.

---

## Bug Fixes

### 🗓️ Date Parsing — Imported Dates Showing "Just Now"
- **Root Cause:** SheetJS converts CSV date strings (e.g., `1/22/2026`) to Excel serial numbers (e.g., `46044`). The `parseDate` function then passed the stringified serial `"46044"` to `Date.parse()`, which interpreted it as year 46044 — a valid future timestamp. `formatRelativeDate` saw the future date and returned "just now" for all imported requests.
- **Fix (inventoryValidation.js):**
  - `parseDate` now handles numeric values (Excel serial dates) **first**, before attempting string parsing
  - Pure numeric strings are detected and routed to the serial date handler instead of `Date.parse`
  - Year sanity check (1900–2100) rejects implausible `Date.parse` results
  - Corrected Excel serial-to-date formula (removed incorrect Lotus 1-2-3 off-by-one adjustment)
- **Fix (importParser.js):**
  - `parseFile` now preserves numeric types from SheetJS instead of coercing all values to strings
  - `validateRow` hardened with `String()` safety wrappers for `.trim()` and `.length` calls
- **Fix (inventoryValidation.js):**
  - `formatRelativeDate` now shows an absolute date for future timestamps instead of falling through to "just now"

### 📊 Analytics Views Not Showing Imported Data
- **Root Cause:** Seven analytics components used legacy field names (`createdAt`, `requesterState`, `urgency === 'urgent'`, `itemId`) that don't exist on request objects. The canonical field names are `requestedAt`, `state`, `urgent` (boolean), and `catalogItemId`.
- **Fixed Components:**
  - `SummaryMetrics.jsx` — date, urgency, and fulfillment field names
  - `USHeatmap.jsx` — state, date, and fulfillment field names
  - `InOutflowChart.jsx` — bucketize date field
  - `FulfillmentHistogram.jsx` — date filtering and days calculation
  - `PipelineFunnel.jsx` — date filtering
  - `ProducerLeaderboard.jsx` — date, item filtering, fulfillment calc, sparkline
  - `BlockedAging.jsx` — age calculation field

### ⚠️ React Duplicate Key Warning
- Removed duplicate `pendingApprovalCount` key in `InventoryNavRail.jsx` badge rendering

---

## Testing

- **3 new workflow test suites** (72+ tests):
  - `workflow-import-export.test.jsx` — Import wizard flow, file upload, column mapping, export functions
  - `workflow-lifecycle.test.jsx` — Request lifecycle: submit → claim → approve → ship, rejection, unclaim, cancellation
  - `workflow-onboarding.test.jsx` — Onboarding wizard, catalog CRUD, settings, navigation & role-gating
- **7 new unit test suites:**
  - `InventoryContext.test.jsx`, `ToastContext.test.jsx`, `useInventorySync.test.js`
  - `inventory-export.test.js`, `inventory-notifications.test.js`, `inventory-validation.test.js`
  - `shipping-providers.test.js`, `tracking-links.test.js`
- **Test helper library:** `inventory-test-utils.js` with mock Yjs factories and test data builders
- **All existing test suites updated** for centralized `useInventorySync` hook pattern
- **Final count:** 75 suites, 2102 tests, 0 failures

---

## Other Changes

- Reverted `vite.config.js` sourcemap from `true` back to `false` for production builds
- Various minor fixes from comprehensive system audit (shipping providers, tracking links, notifications, import mapper, assignment algorithm)

---

## Files Changed

### Modified (51 files)
- `package.json` — Version bump to 1.6.1
- `vite.config.js` — Sourcemap reverted to false
- `frontend/src/utils/inventoryValidation.js` — parseDate, formatRelativeDate fixes
- `frontend/src/utils/importParser.js` — Numeric type preservation, validateRow hardening
- `frontend/src/components/inventory/InventoryNavRail.jsx` — Duplicate key fix
- `frontend/src/components/inventory/analytics/*.jsx` — Field name fixes (7 files)
- 40+ additional component, context, hook, and utility files

### Added (20+ files)
- 10 new test files
- `tests/helpers/inventory-test-utils.js`
- `frontend/src/utils/shippingProviders.js`
- `frontend/src/utils/trackingLinks.js`
- `frontend/src/utils/inventoryNotifications.js`
- Additional components and utilities
