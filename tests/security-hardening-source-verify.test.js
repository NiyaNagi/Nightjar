/**
 * Test Suite: Security Hardening — Server Integration Tests
 * 
 * Verifies the actual server source code has the expected changes.
 * These are "code structure" tests that grep the server source to confirm:
 * - Fix 1: Oracle endpoint is removed
 * - Fix 2: Security headers middleware is present
 * - Fix 3: Signature verification logic exists
 * - Backward compatibility: unsigned requests are still accepted
 */

import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read the server source once for all tests
const serverDir = join(process.cwd(), 'server', 'unified');
let serverSource;
try {
  serverSource = readFileSync(join(serverDir, 'index.js'), 'utf-8');
} catch {
  serverSource = '';
}

describe('Server Source Code Verification', () => {
  
  test('server source file can be read', () => {
    expect(serverSource.length).toBeGreaterThan(1000);
  });

  // ======== Fix 1: Oracle Removal ========
  describe('Fix 1: Workspace Oracle Removed', () => {
    test('no /api/workspace/:id/persisted route exists', () => {
      expect(serverSource).not.toContain("/api/workspace/:id/persisted");
    });

    test('/api/encrypted-persistence endpoint still exists', () => {
      expect(serverSource).toContain("/api/encrypted-persistence");
    });

    test('health endpoint still exists', () => {
      expect(serverSource).toContain("/health");
    });
  });

  // ======== Fix 2: Security Headers ========
  describe('Fix 2: Security Headers Middleware', () => {
    test('X-Content-Type-Options: nosniff is set', () => {
      expect(serverSource).toContain("X-Content-Type-Options");
      expect(serverSource).toContain("nosniff");
    });

    test('X-Frame-Options: SAMEORIGIN is set', () => {
      expect(serverSource).toContain("X-Frame-Options");
      expect(serverSource).toContain("SAMEORIGIN");
    });

    test('Referrer-Policy is set', () => {
      expect(serverSource).toContain("Referrer-Policy");
      expect(serverSource).toContain("strict-origin-when-cross-origin");
    });

    test('Content-Security-Policy is set', () => {
      expect(serverSource).toContain("Content-Security-Policy");
      expect(serverSource).toContain("default-src 'self'");
    });

    test('CSP allows WebSocket connections', () => {
      expect(serverSource).toContain("connect-src 'self' ws: wss: http: https:");
    });

    test('CSP allows blob workers (needed for Yjs)', () => {
      expect(serverSource).toContain("worker-src 'self' blob:");
    });

    test('CSP frame-ancestors prevents clickjacking', () => {
      expect(serverSource).toContain("frame-ancestors 'self'");
    });

    test('X-XSS-Protection is disabled (modern best practice)', () => {
      expect(serverSource).toContain("X-XSS-Protection");
      // Modern best practice: set to '0' since CSP supersedes it
      expect(serverSource).toMatch(/X-XSS-Protection.*0/);
    });
  });

  // ======== Fix 3: Authenticated Key Delivery ========
  describe('Fix 3: Authenticated Key Delivery', () => {
    test('verifyEd25519Signature function exists', () => {
      expect(serverSource).toContain("function verifyEd25519Signature");
    });

    test('roomKeyOwners Map exists', () => {
      expect(serverSource).toContain("roomKeyOwners");
      expect(serverSource).toContain("new Map()");
    });

    test('key delivery endpoint accepts publicKey and signature fields', () => {
      expect(serverSource).toContain("publicKey: pubKeyBase64");
      expect(serverSource).toContain("signature: sigBase64");
      expect(serverSource).toContain("timestamp");
    });

    test('signature verification calls nacl.sign.detached.verify', () => {
      expect(serverSource).toContain("nacl.sign.detached.verify");
    });

    test('replay protection checks timestamp within 5 minute window', () => {
      expect(serverSource).toContain("REPLAY_WINDOW");
      expect(serverSource).toContain("5 * 60 * 1000");
    });

    test('room ownership prevents different identity from overwriting key', () => {
      expect(serverSource).toContain("Room key already registered by a different identity");
    });

    test('backward compatibility: unsigned requests are still accepted', () => {
      // The signature verification block is guarded by:
      // if (pubKeyBase64 && sigBase64 && timestamp)
      // This means if those fields are absent, the request is accepted unsigned
      expect(serverSource).toContain("pubKeyBase64 && sigBase64 && timestamp");
    });

    test('signed message format matches client convention', () => {
      expect(serverSource).toContain("key-delivery:${roomName}:${keyBase64}:${timestamp}");
    });
  });

  // ======== CORS: Still Permissive ========
  describe('CORS Configuration', () => {
    test('CORS allows all origins (permissive for dev/Electron/mobile)', () => {
      expect(serverSource).toContain("Access-Control-Allow-Origin");
      expect(serverSource).toContain("'*'");
    });
  });
});

// =============================================================================
// Client Source Code Verification
// =============================================================================

let websocketSource;
try {
  websocketSource = readFileSync(join(process.cwd(), 'frontend', 'src', 'utils', 'websocket.js'), 'utf-8');
} catch {
  websocketSource = '';
}

let workspaceContextSource;
try {
  workspaceContextSource = readFileSync(join(process.cwd(), 'frontend', 'src', 'contexts', 'WorkspaceContext.jsx'), 'utf-8');
} catch {
  workspaceContextSource = '';
}

let workspaceSecretsSource;
try {
  workspaceSecretsSource = readFileSync(join(process.cwd(), 'frontend', 'src', 'utils', 'workspaceSecrets.js'), 'utf-8');
} catch {
  workspaceSecretsSource = '';
}

describe('Client Source Code Verification', () => {

  describe('Fix 3: Client-Side Signing (websocket.js)', () => {
    test('imports nacl for signing', () => {
      expect(websocketSource).toContain("import nacl from 'tweetnacl'");
    });

    test('imports getUnlockedIdentity for keypair access', () => {
      expect(websocketSource).toContain("getUnlockedIdentity");
    });

    test('constructs key-delivery signed message', () => {
      expect(websocketSource).toContain("key-delivery:${roomName}:${keyBase64}:${timestamp}");
    });

    test('calls nacl.sign.detached for Ed25519 signing', () => {
      expect(websocketSource).toContain("nacl.sign.detached(");
    });

    test('sends publicKey and signature in request body', () => {
      expect(websocketSource).toContain("body.publicKey");
      expect(websocketSource).toContain("body.signature");
    });

    test('gracefully falls back if identity is not unlocked', () => {
      expect(websocketSource).toContain("Could not sign key delivery");
    });
  });

  describe('Fix 5: WorkspaceContext Uses Encrypted Secrets', () => {
    test('imports workspace secrets utilities', () => {
      expect(workspaceContextSource).toContain("encryptAllWorkspaceSecrets");
      expect(workspaceContextSource).toContain("decryptAllWorkspaceSecrets");
      expect(workspaceContextSource).toContain("removeWorkspaceSecrets");
    });

    test('persist path encrypts secrets before localStorage write', () => {
      expect(workspaceContextSource).toContain("encryptAllWorkspaceSecrets(workspaces)");
    });

    test('load path decrypts secrets after localStorage read', () => {
      expect(workspaceContextSource).toContain("decryptAllWorkspaceSecrets(rawWorkspaces)");
    });

    test('delete path cleans up workspace secrets', () => {
      expect(workspaceContextSource).toContain("removeWorkspaceSecrets(workspaceId)");
    });
  });

  describe('Fix 5: workspaceSecrets.js Module', () => {
    test('module exists and has expected structure', () => {
      expect(workspaceSecretsSource.length).toBeGreaterThan(100);
    });

    test('defines SENSITIVE_FIELDS constant', () => {
      expect(workspaceSecretsSource).toContain("SENSITIVE_FIELDS");
      expect(workspaceSecretsSource).toContain("'password'");
      expect(workspaceSecretsSource).toContain("'encryptionKey'");
    });

    test('uses __encrypted__ marker for sanitized fields', () => {
      expect(workspaceSecretsSource).toContain("'__encrypted__'");
    });

    test('imports secureSet and secureGet from secureStorage', () => {
      expect(workspaceSecretsSource).toContain("secureSet");
      expect(workspaceSecretsSource).toContain("secureGet");
    });

    test('handles legacy migration (plaintext → encrypted)', () => {
      expect(workspaceSecretsSource).toContain("Legacy workspace");
    });

    test('exports all required functions', () => {
      expect(workspaceSecretsSource).toContain("export function encryptWorkspaceSecrets");
      expect(workspaceSecretsSource).toContain("export function decryptWorkspaceSecrets");
      expect(workspaceSecretsSource).toContain("export function encryptAllWorkspaceSecrets");
      expect(workspaceSecretsSource).toContain("export function decryptAllWorkspaceSecrets");
      expect(workspaceSecretsSource).toContain("export function removeWorkspaceSecrets");
    });
  });
});
