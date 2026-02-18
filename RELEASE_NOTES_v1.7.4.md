# Nightjar v1.7.4 Release Notes

**Release Date:** February 18, 2026

This release fixes the address reveal pipeline so producers can see shipping addresses, hardens encryption key scoping with least-privilege Curve25519 keys, and migrates all project identity references from the suspended GitHub account to the new one.

---

## 🔐 Security: Least-Privilege Encryption Keys

### Curve25519 Scoped Key for Inventory *(Security Hardening)*
- **Problem**: The inventory system previously received the full Ed25519 master signing key (64 bytes), which could sign P2P identity proofs, workspace invites, and kick requests — far more capability than address encryption needs.
- **Fix**: `AppNew.jsx` now pre-derives a **32-byte Curve25519 encryption-only key** (`curveSecretKey`) from the Ed25519 key using `ed2curve`. This scoped key can only perform `nacl.box` authenticated encryption/decryption — it **cannot** sign any messages.
- **Impact**: The full Ed25519 signing key never leaves the top-level `App` component. All inventory components (admin, producer, requestor) receive only the encryption-capable key.

### addressCrypto.js Dual-Key Support
- `encryptAddress()` and `decryptAddress()` now detect key length: **32-byte** keys are used directly as Curve25519; **64-byte** keys are auto-converted from Ed25519 (backward compatibility).
- Converted keys are securely wiped after use; caller-owned pre-derived keys are not wiped.
- All JSDoc updated to document the dual-key contract.

---

## 📦 Inventory: Address Reveal Pipeline Fix

### Root Cause
- `publicIdentity` (which intentionally strips all crypto keys) was being passed as `userIdentity` to the entire inventory subsystem. Every address crypto operation guarded on `userIdentity?.privateKey`, which was always `undefined` — causing ALL encryption/decryption to silently no-op.

### Fix
- Created `inventoryIdentity` in `AppNew.jsx` that extends `publicIdentity` with the pre-derived `curveSecretKey` and `publicKeyHex`.
- Updated all 12 consumer sites across 7 inventory components to use `curveSecretKey` instead of `privateKey`.

### Components Updated
- **Admin**: `AllRequests.jsx`, `ApprovalQueue.jsx`, `AdminDashboard.jsx` — `decryptPendingAddress` and `createAddressReveal` calls
- **Producer**: `AddressReveal.jsx`, `RequestDetail.jsx` — `decryptAddressReveal` calls
- **Requestor**: `SubmitRequest.jsx`, `MyRequests.jsx` — `encryptAddressForAdmins` calls

### Producer Address Display *(New)*
- `RequestDetail.jsx` now shows the decrypted shipping address inline for producers when a request is approved or in-progress.
- Label changed from "(admin only)" to "Full Address" for the admin address block.

---

## 🔄 GitHub Account Migration

### Identity Change: InyanRock → SaoneYanpa
The project has migrated from the suspended `InyanRock` GitHub account to the new `SaoneYanpa` account. All references updated:

| What | Old | New |
|------|-----|-----|
| **GitHub** | `github.com/InyanRock/Nightjar` | `github.com/SaoneYanpa/Nightjar` |
| **Email** | `Tokahe@proton.me` | `SaoneYanpa@proton.me` |
| **App ID** | `com.inyanrock.Nightjar` | `com.saoneyanpa.Nightjar` |

### Files Updated
- `package.json` — author email, build appId, cap:init script, version bump
- `capacitor.config.json` — appId
- `src/main.js` — Windows app user model ID
- `scripts/generate-release-notes.js` — repo URL constant
- `UserProfile.jsx`, `AppSettings.jsx` — GitHub links in UI
- `README.md` — download links, git clone URL
- `RELEASE_NOTES_v1.3.4.md` — historical commit links, contributor name
- `docs/FILE_STORAGE_SPEC.md` — author attribution
- `docs/MOBILE_BUILD.md` — config example appId
- `docs/RELAY_DEPLOYMENT.md` — clone URL
- `tests/settings-overhaul.test.js` — URL assertion

---

## ✅ Test Results

All test fixtures updated to use `curveSecretKey: new Uint8Array(32)` instead of `privateKey: new Uint8Array(64)` for inventory mock identities.

**8 test files updated:**
- `producer-shipping-workflow.test.jsx` (12 identity fixtures + 3 assertion sites)
- `admin.test.jsx`, `producer.test.jsx`
- `slide-panel-and-features.test.jsx`, `workflow-lifecycle.test.jsx`, `workflow-advanced.test.jsx`, `workflow-onboarding.test.jsx`
- `inventory-workflow-audit.test.js`
- `settings-overhaul.test.js` (URL assertion)

**Totals:** 124 test suites, 3,573 tests (0 failures)

---

## Summary of Changed Files

| Area | Files |
|------|-------|
| **Security** | `addressCrypto.js`, `AppNew.jsx` |
| **Inventory (Admin)** | `AllRequests.jsx`, `ApprovalQueue.jsx`, `AdminDashboard.jsx` |
| **Inventory (Producer)** | `AddressReveal.jsx`, `RequestDetail.jsx` |
| **Inventory (Requestor)** | `SubmitRequest.jsx`, `MyRequests.jsx` |
| **Config** | `package.json`, `capacitor.config.json`, `src/main.js` |
| **UI** | `UserProfile.jsx`, `AppSettings.jsx` |
| **Scripts** | `generate-release-notes.js` |
| **Docs** | `README.md`, `RELEASE_NOTES_v1.3.4.md`, `FILE_STORAGE_SPEC.md`, `MOBILE_BUILD.md`, `RELAY_DEPLOYMENT.md` |
| **Tests** | 9 test files updated |
