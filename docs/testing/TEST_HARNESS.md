# Test Harness Documentation

> Complete testing infrastructure for the Nightjar collaborative editor

## Overview

This document describes the comprehensive test suite for Nightjar, covering identity management, cryptographic operations, workspace collaboration, and UI components.

## AI Assistant Command: "start"

When you tell the AI assistant **"start"**, it will:

1. **Kill existing processes** - Terminate any running Electron, Node sidecar, and unified server processes
   ```powershell
   Get-Process -Name "electron", "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
   ```

2. **Start the sidecar** (in a new terminal) - Required for P2P and crypto operations
   ```bash
   node sidecar/index.js
   ```

3. **Build and start the unified server** (in a new terminal)
   ```bash
   cd server/unified && npm start
   ```

4. **Build and start the Electron app** (in a new terminal)
   ```bash
   npm run dev
   ```

This command provides a clean development environment by ensuring no stale processes are running before starting fresh instances.

## AI Assistant Command: "test all"

When you tell the AI assistant **"test all"**, it will execute the following automated bug-fixing loop:

1. **Run all tests** using Ralph Wiggum mode (`npm run test:ralph`)
2. **Analyze all output** for any test failures
3. **Fix bugs one by one** - identify root causes and implement fixes
4. **Re-run failing tests** after each fix to verify they pass
5. **Run full test suite again** once individual fixes are verified
6. **Repeat until 0 failures** - the goal is to achieve a completely green test suite

This is the primary command for ensuring code quality. The AI will continue the loop until all tests pass.

## Quick Start

```bash
# Run all tests once
npm test

# Run with coverage
npm run test:coverage

# Run Ralph Wiggum loop (ALL tests: unit + integration + cross-platform + E2E)
npm run test:ralph

# Run Ralph Wiggum quick mode (unit + integration, no E2E)
npm run test:ralph:quick

# Run specific test file
npm test -- tests/identity.test.js

# Run fuzz tests with specific seed (reproducible)
FUZZ_SEED=12345 npm test -- tests/fuzz.test.js
```

## Test Organization

### Directory Structure

```
tests/
├── setup.js                    # Global test setup and mocks
├── __mocks__/                  # Mock implementations
│   ├── fileMock.js             # Static asset mocks
│   └── uint8arrays.js          # P2P module mock
│
├── # Core Functionality Tests
├── identity.test.js            # BIP39, Ed25519, signing
├── backup.test.js              # Encrypted backup/restore
├── security.test.js            # Crypto hardening
├── keyDerivation.test.js       # Key derivation
├── logger.test.js              # PII-safe unified logging (67 tests)
├── sidecar.test.js             # Node.js sidecar crypto (43 tests)
│
├── # Workspace Tests
├── membership.test.js          # Y.Map membership operations
├── workspaceContext.test.js    # React context state
├── kick.test.js                # Cryptographic kick system
├── invites.test.js             # Signed time-limited invites
├── sharing.test.js             # Share link generation
│
├── # UI Component Tests
├── components.test.js          # Core components
├── additional-components.test.js
├── ui-components.test.js       # UI elements
├── contexts.test.js            # React contexts
├── hooks.test.js               # Custom hooks (45 tests)
│
├── # Feature Tests
├── breadcrumbs.test.js         # Navigation breadcrumbs
├── folderContext.test.js       # Folder state
├── entityTypes.test.js         # Document types
├── linkHandler.test.js         # Link parsing
├── sheet.test.js               # Spreadsheet features
├── deletion.test.js            # Delete operations
├── migration.test.js           # Data migration
│
├── # Advanced Testing
├── edge-cases.test.js          # Boundary conditions
├── fuzz.test.js                # Randomized testing
├── workflows.test.js           # End-to-end workflows
├── accessibility.test.js       # A11y compliance
├── error-handling.test.js      # Failure scenarios
│
├── # P2P and Sync Tests
├── p2p-sync.test.js            # P2P synchronization
├── p2p-services.test.js        # P2P protocol layer (72 tests)
├── collaboratorSync.test.js    # Multi-user sync
├── usePermission.test.js       # Permission hooks
│
├── # Utility Tests
├── utilities.test.js           # Platform, crypto utils (52 tests)
├── passwordGenerator.test.js   # Secure passwords
│
├── # E2E Tests (Playwright)
├── e2e/                        # End-to-end tests
└── integration/                # Integration tests
```

## Test Categories

### 1. Identity System Tests

**File:** `identity.test.js`

Tests the core identity system built on BIP39 mnemonics and Ed25519 cryptography.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| Mnemonic Generation | 5 | 12-word generation, validation, deterministic derivation |
| Keypair Generation | 3 | Public/private key formats, Base62 encoding |
| Signing and Verification | 6 | String/binary signing, tampering detection |
| Base62 Encoding | 4 | Round-trip encoding, character set validation |

**Key Functions Tested:**
- `generateIdentity()` - Creates new identity with mnemonic
- `restoreIdentityFromMnemonic()` - Restores from recovery phrase
- `signData()` / `verifySignature()` - Ed25519 signing
- `uint8ToBase62()` / `base62ToUint8()` - Compact encoding

### 2. Backup System Tests

**File:** `backup.test.js`

Tests encrypted backup creation and restoration using XSalsa20-Poly1305.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| Backup Key Derivation | 4 | Consistent derivation, key separation |
| Encryption/Decryption | 5 | Round-trip, wrong key rejection |
| Backup Creation | 5 | Version, timestamp, encrypted fields |
| Backup Restoration | 5 | Full restore, workspace preservation |

**Key Functions Tested:**
- `createBackup()` - Creates encrypted backup package
- `restoreBackup()` - Restores from backup with mnemonic
- `deriveBackupKey()` - Derives encryption key from mnemonic
- `encryptData()` / `decryptData()` - Symmetric encryption

### 3. Security Hardening Tests

**File:** `security.test.js`

Tests cryptographic utilities and security-critical code paths.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| timingSafeEqual | 5 | Constant-time comparison |
| isValidKey | 4 | Key validation, zero-key rejection |
| secureWipe | 3 | Memory zeroing |
| encryptUpdate/decryptUpdate | 5 | Y.js update encryption |
| Input Validation | 3 | Prototype pollution prevention |

### 4. Kick System Tests

**File:** `kick.test.js`

Tests the cryptographic workspace member removal system.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| Kick Signature Generation | 3 | Owner signature, workspace binding |
| Kick Verification | 3 | Forgery rejection, tampering detection |
| Kicked Map Structure | 2 | Data structure, signature encoding |
| Re-kick Prevention | 2 | Cryptographic blocking |

**Signature Format:**
```
kick:<workspaceId>:<targetPublicKeyBase62>:<timestamp>
```

### 5. Invite System Tests

**File:** `invites.test.js`

Tests time-limited, cryptographically signed workspace invitations.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| Invite Generation | 5 | Signature, expiry, permission embedding |
| Invite Validation | 5 | Expiry checking, signature verification |
| Invite Security | 4 | Forgery prevention, replay resistance |

**Invite Link Format:**
```
Nightjar://join/<workspaceId>/<encryptedKey>?perm=<permission>&exp=<timestamp>&sig=<signature>&by=<ownerKey>
```

### 6. Membership Tests

**File:** `membership.test.js`

Tests Y.js-based workspace membership management.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| Members Map Structure | 4 | CRDT operations, permissions |
| Permission Checks | 4 | Owner/editor/viewer enforcement |
| Kicked Map | 4 | Kick recording, verification |
| CRDT Conflict Resolution | 3 | Concurrent modifications |

### 7. Edge Case Tests

**File:** `edge-cases.test.js`

Tests boundary conditions and unusual inputs.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| Base62 Encoding Boundaries | 6 | Empty, single-byte, max values |
| Mnemonic Edge Cases | 5 | Whitespace, wrong word count |
| Signature Edge Cases | 5 | Empty/long/unicode messages |
| Backup Boundaries | 6 | Min/max sizes, special chars |
| Timing Edge Cases | 2 | Year 2038, negative timestamps |

### 8. Fuzz Tests ("Ralph Wiggum" Testing)

**File:** `fuzz.test.js`

Randomized testing with seeded reproducibility.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| Identity System | 4 | Random mnemonic validation |
| Base62 Encoding | 3 | Random byte round-trips |
| Signing | 4 | Random messages, tampering |
| Encryption | 4 | Random data, key mixing |
| Stress | 2 | Rapid generation, concurrency |

**Reproducibility:**
```bash
# Run with specific seed
FUZZ_SEED=12345 npm test -- tests/fuzz.test.js

# Increase iterations
FUZZ_ITERATIONS=200 npm test -- tests/fuzz.test.js
```

### 9. Integration Flow Tests

**File:** `workflows.test.js`

End-to-end workflow simulations.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| New User Onboarding | 1 | Generate → backup → restore |
| Workspace Collaboration | 1 | Create → invite → join → kick |
| Multi-Workspace | 1 | Permission management |
| Identity Recovery | 1 | Full recovery with mnemonic |
| Concurrent Changes | 1 | Y.js conflict resolution |

### 10. Cross-Platform Tests

**Files:** `integration/cross-platform-sharing.test.js`, `integration/cross-platform-sync.test.js`

Tests share link compatibility and document sync across all platform combinations.

**Platform Matrix:**
- Web Browser
- Electron Desktop
- iOS (Capacitor)
- Android (Capacitor)

| Test Suite | Tests | Description |
|------------|-------|-------------|
| Share Link Generation | 4 | All platforms generate valid links |
| Share Link Parsing (12 combos) | 12 | Web↔Electron, Web↔iOS, etc. |
| Permission Levels | 4 | viewer/editor/owner across platforms |
| Entity Types | 3 | workspace/folder/document |
| Link Recognition | 7 | Valid/invalid link detection |
| WebSocket URL Resolution | 4 | Platform-specific URL building |
| Signed Invites | 5 | Cross-platform signature validation |
| Document Sync | 4 | Text sync, concurrent edits |
| Three-Way Sync | 1 | Web + Electron + Mobile together |
| Four-Way Sync | 1 | All platforms editing same doc |

**Running Cross-Platform Tests:**
```bash
# Run all cross-platform tests
npm run test:cross-platform

# Run only sharing tests (no server needed)
npm run test:cross-platform:sharing

# Run sync tests (requires server)
npm run test:cross-platform:sync

# Run via Ralph Wiggum (includes ALL tests)
npm run test:ralph
npm run test:ralph:quick  # Skip E2E for faster runs
```

### 11. Accessibility Tests

**File:** `accessibility.test.js`

WCAG compliance and screen reader compatibility.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| ARIA Attributes | 5 | Roles, labels, states |
| Focus Management | 5 | Trap, escape, return focus |
| Keyboard Navigation | 4 | Tab order, activation |
| Form Inputs | 3 | Labels, errors, required |
| Color Independence | 2 | Non-color indicators |
| Live Regions | 3 | Announcements |

### 11. Error Handling Tests

**File:** `error-handling.test.js`

Graceful degradation and failure recovery.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| LocalStorage Failures | 3 | Quota, access denied |
| Crypto Failures | 4 | Corrupted data, null inputs |
| Network Simulation | 3 | Offline, timeout |
| Invalid Input Defense | 6 | Garbage input handling |
| Backup/Restore Failures | 3 | Wrong key, corruption |
| Resource Limits | 2 | Large data handling |
| Concurrent Operations | 2 | Race conditions |

## UI Component Tests

### Components Test Suite

**File:** `components.test.js`

| Component | Tests | Description |
|-----------|-------|-------------|
| UserProfile | 4 | Modal rendering, tabs, preferences |
| RecoveryCodeModal | 3 | Mnemonic display, copy/save |
| KickedModal | 3 | Alert display, accessibility |
| WorkspaceSettings | 4 | Settings panels, sharing |

### Hooks Tests

**File:** `hooks.test.js`

| Hook | Tests | Description |
|------|-------|-------------|
| useIdentity | 3 | Identity state, generation |
| useWorkspace | 4 | Workspace operations |
| usePermission | 3 | Permission checking |
| useFocusTrap | 2 | Modal focus management |

## Running Tests

### Basic Commands

```bash
# All tests
npm test

# Watch mode (re-run on changes)
npm run test:watch

# Coverage report
npm run test:coverage

# Specific file
npm test -- tests/identity.test.js

# Pattern matching
npm test -- --testNamePattern="Mnemonic"
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FUZZ_SEED` | `Date.now()` | Seed for fuzz RNG |
| `FUZZ_ITERATIONS` | `50` | Iterations per fuzz test |
| `CI` | - | Enables CI mode (no watch) |

### Ralph Wiggum Automation

The Ralph Wiggum script runs ALL tests in a loop until all pass:

```bash
# Run ALL tests (unit + integration + cross-platform + E2E)
npm run test:ralph

# Quick mode (skip E2E for faster iteration)
npm run test:ralph:quick

# With options
node scripts/ralph-wiggum.js --all --seed=12345 --max-iterations=5 --fix --verbose
```

**Options:**
- `--all` - Run ALL test suites (default for npm run test:ralph)
- `--seed=N` - Fuzz seed for reproducibility
- `--max-iterations=N` - Maximum retry attempts
- `--fix` - Run ESLint/Prettier auto-fix between iterations
- `--verbose` - Detailed output
- `--unit-only` - Run only Jest unit tests
- `--include-e2e` - Include E2E tests (Playwright)
- `--cross-platform` - Run only cross-platform tests
- `--no-integration` - Skip integration tests

**Output:**
- `test-results/jest-results.json` - Raw Jest output
- `test-results/failures-iteration-N.md` - Failure details per iteration
- `test-results/ralph-wiggum-summary.md` - Overall summary

## Test Configuration

### Jest Configuration

**File:** `jest.config.js`

```javascript
{
  testEnvironment: 'jsdom',
  transform: { '^.+\\.(js|jsx)$': 'babel-jest' },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  collectCoverageFrom: ['frontend/src/**/*.{js,jsx}'],
  testPathIgnorePatterns: ['node_modules', 'dist', 'integration'],
  transformIgnorePatterns: ['node_modules/(?!(yjs|lib0)/)'],
}
```

### Global Mocks

**File:** `tests/setup.js`

Provides mocks for:
- `window.crypto` - getRandomValues, subtle API
- `localStorage` - In-memory storage
- `TextEncoder/TextDecoder` - Encoding utilities
- `matchMedia` - Media query mocking

## Coverage Goals

| Category | Target | Current |
|----------|--------|---------|
| Statements | 80% | - |
| Branches | 75% | - |
| Functions | 80% | - |
| Lines | 80% | - |

Run coverage report:
```bash
npm run test:coverage
```

## Writing New Tests

### Test Template

```javascript
/**
 * Feature Tests
 * 
 * Tests for <feature description>.
 */

import { functionToTest } from '../frontend/src/utils/module';

describe('Feature Category', () => {
  let testData;
  
  beforeEach(() => {
    testData = setupTestData();
  });
  
  afterEach(() => {
    cleanup();
  });
  
  describe('Subfeature', () => {
    test('does expected behavior', () => {
      const result = functionToTest(testData);
      expect(result).toBe(expectedValue);
    });
    
    test('handles edge case', () => {
      expect(() => functionToTest(null)).toThrow();
    });
  });
});
```

### Best Practices

1. **Descriptive Names:** Use full sentences for test names
2. **Arrange-Act-Assert:** Structure each test clearly
3. **Isolation:** Each test should be independent
4. **Mocking:** Mock external dependencies
5. **Edge Cases:** Test boundaries and error conditions
6. **Determinism:** Use seeded random for fuzz tests

## Troubleshooting

### Common Issues

**"Cannot find module" errors:**
```bash
# Clear Jest cache
npm test -- --clearCache
```

**Timeout errors:**
```bash
# Increase timeout
npm test -- --testTimeout=30000
```

**Crypto not available:**
Check that `tests/setup.js` is loaded (setupFilesAfterEnv).

**Fuzz tests failing randomly:**
```bash
# Use a specific seed for reproducibility
FUZZ_SEED=12345 npm test -- tests/fuzz.test.js
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:coverage
      - run: npm run test:ralph -- --max-iterations=3  # Runs ALL tests
```

## Appendix: Test Count Summary

| Test File | Test Suites | Tests |
|-----------|-------------|-------|
| identity.test.js | 4 | 18 |
| backup.test.js | 4 | 19 |
| security.test.js | 5 | 20 |
| kick.test.js | 4 | 10 |
| invites.test.js | 3 | 14 |
| membership.test.js | 4 | 15 |
| edge-cases.test.js | 8 | 26 |
| fuzz.test.js | 6 | 17 |
| integration-flows.test.js | 6 | 8 |
| accessibility.test.js | 8 | 26 |
| error-handling.test.js | 8 | 27 |
| components.test.js | 4 | 14 |
| hooks.test.js | 6 | 45 |
| logger.test.js | 12 | 67 |
| p2p-services.test.js | 10 | 72 |
| sidecar.test.js | 8 | 43 |
| utilities.test.js | 8 | 52 |
| contexts.test.js | 6 | 30 |
| folderContext.test.js | 4 | 21 |
| workspaceContext.test.js | 5 | 24 |
| *...other tests* | - | - |
| **Total** | **~120** | **~750+** |

---

## New Test Suites (v2.0)

### 12. Logger Tests

**File:** `logger.test.js`

Tests the unified logging layer with PII protection.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| PII Stripping | 22 | Email, phone, IP, keys, paths |
| Object Sanitization | 10 | Forbidden fields, nested objects |
| Log Entry Creation | 11 | Error, behavior, metric levels |
| Buffer Management | 8 | GetLogs, clear, stats |
| Export Functionality | 5 | JSON export, metadata |
| PII Never Leaks | 5 | End-to-end PII protection |

**Key Functions Tested:**
- `stripPII()` - Removes PII patterns from strings
- `sanitizeObject()` - Removes PII fields from objects
- `logError()` / `logBehavior()` / `logMetric()` - Logging
- `exportLogs()` - Export logs to file

### 13. P2P Services Tests

**File:** `p2p-services.test.js`

Tests the P2P protocol, serialization, and transports.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| MessageTypes | 10 | Protocol constants |
| Message Factories | 13 | Message creation functions |
| Serialization | 11 | Encode/decode, base64 |
| ID Generation | 5 | Peer ID, topic generation |
| Encryption | 4 | AES-GCM encrypt/decrypt |
| EventEmitter | 15 | Custom event system |
| BaseTransport | 8 | Transport interface |
| Message Validation | 6 | Sync, identity validation |

**Key Functions Tested:**
- `createSyncMessage()`, `createIdentityMessage()` - Protocol
- `encodeMessage()`, `decodeMessage()` - Serialization
- `generatePeerId()`, `generateTopic()` - ID generation
- `encryptData()`, `decryptData()` - Encryption

### 14. Sidecar Tests

**File:** `sidecar.test.js`

Tests the Node.js sidecar crypto module.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| Key Validation | 10 | 32-byte key requirements |
| Timing-Safe Comparison | 5 | Constant-time comparison |
| Secure Wipe | 3 | Memory zeroing |
| Encryption | 10 | TweetNaCl encryption |
| Round-trip | 4 | Encrypt → decrypt |
| Padding | 1 | 4096-byte block padding |
| Buffer Compatibility | 2 | Node.js Buffer handling |
| Security Edge Cases | 3 | Nonce uniqueness |

**Key Functions Tested:**
- `encryptUpdate()` / `decryptUpdate()` - Y.js update encryption
- `generateKey()` - Key generation
- `timingSafeEqual()` - Constant-time comparison
- `secureWipe()` - Memory clearing

### 15. Utilities Tests

**File:** `utilities.test.js`

Tests frontend utility modules.

| Test Suite | Tests | Description |
|------------|-------|-------------|
| Timing-Safe | 11 | Byte/string comparison |
| Secure Wipe | 3 | Memory clearing |
| Hex Conversion | 3 | Hex ↔ bytes |
| Platform Detection | 15 | Electron/Capacitor/Web |
| NativeBridge | 5 | Cross-platform storage |
| WebSocket | 3 | URL utilities |
| Random Generation | 2 | Secure random bytes |

**Key Functions Tested:**
- `timingSafeEqual()`, `timingSafeStringEqual()` - Security
- `Platform.isElectron()`, `Platform.isCapacitor()` - Detection
- `NativeBridge.identity.*` - Cross-platform identity
- `getYjsWebSocketUrl()` - WebSocket configuration

---

## Unified Logging Layer

### Usage

```javascript
import logger from './utils/logger';

// Log errors (always output to console.error)
logger.error('sync', 'Connection failed', { code: 500 });

// Log behaviors (buffered only)
logger.behavior('workspace', 'created', { workspaceCount: 3 });

// Log metrics (numeric data only)
logger.metric('performance', 'load_time', { duration: 150 });

// Export logs
logger.export(); // Browser download
logger.exportToFile('/path/to/logs.json'); // Electron/Node
```

### PII Protection

The logger automatically strips:
- Email addresses
- Phone numbers
- IP addresses
- Cryptographic keys (64-char hex, base64)
- Mnemonics (12-24 words)
- File paths with usernames
- Forbidden fields (displayName, password, token, etc.)

### Categories

Valid categories: `app`, `sync`, `workspace`, `folder`, `document`, 
`crypto`, `identity`, `auth`, `permission`, `invite`, `backup`, 
`ui`, `navigation`, `storage`, `performance`, `other`

