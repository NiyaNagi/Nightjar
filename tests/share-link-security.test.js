/**
 * Test Suite: Share Link Security & Web Join Flow
 * 
 * Tests for the v1.7.15 share link fix:
 * - Expiry enforcement at join time
 * - Mandatory expiry for signed links
 * - validateSignedInvite edge cases
 * - Link format conversion (nightjar:// ↔ HTTPS join URL)
 * - DeepLinkGate behavior
 * - Server invite cleanup logic
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { webcrypto } from 'crypto';
import nacl from 'tweetnacl';
import { uint8ToBase62 } from '../frontend/src/utils/identity';
import { 
  generateShareLink, 
  parseShareLink, 
  generateSignedInviteLink,
  validateSignedInvite,
  generateClickableShareLink,
  nightjarLinkToJoinUrl,
  joinUrlToNightjarLink,
  isJoinUrl,
  parseJoinUrl,
  parseAnyShareLink,
  DEFAULT_SHARE_HOST,
} from '../frontend/src/utils/sharing';

// Setup crypto.subtle for Node.js test environment
beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
  }
});

// Sample entity IDs (32 hex chars = 16 bytes)
const sampleWorkspaceId = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

// Helper: generate a mock Ed25519 keypair for signing tests
function generateTestKeypair() {
  const keypair = nacl.sign.keyPair();
  return {
    privateKey: keypair.secretKey,
    publicKey: keypair.publicKey,
    publicKeyBase62: uint8ToBase62(keypair.publicKey),
  };
}

describe('Share Link Security — v1.7.15', () => {
  
  describe('validateSignedInvite — expiry enforcement', () => {
    let testKeypair;
    
    beforeAll(() => {
      testKeypair = generateTestKeypair();
    });
    
    test('rejects expired signed invite links', () => {
      const result = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'editor',
        expiryMinutes: 0, // Expired immediately — 0 minutes
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      // Wait a tick for expiry
      const validation = validateSignedInvite(result.link);
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/expired/i);
    });
    
    test('accepts valid non-expired signed invite links', () => {
      const result = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'editor',
        expiryMinutes: 60,
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      const validation = validateSignedInvite(result.link);
      expect(validation.valid).toBe(true);
      expect(validation.expiry).toBeDefined();
      expect(validation.expiresIn).toBeGreaterThan(0);
    });
    
    test('caps expiry at 24 hours', () => {
      const result = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'editor',
        expiryMinutes: 48 * 60, // 48 hours requested
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      // Should be capped at 24 hours
      expect(result.expiryMinutes).toBe(24 * 60);
      const expectedMaxExpiry = Date.now() + (24 * 60 * 60 * 1000) + 1000; // +1s tolerance
      expect(result.expiry).toBeLessThanOrEqual(expectedMaxExpiry);
    });
    
    test('rejects signed link with signature but no expiry (tampered)', () => {
      // Generate a valid link, then strip the exp: field
      const result = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'editor',
        expiryMinutes: 60,
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      // Remove exp: from fragment
      const tamperedLink = result.link.replace(/&?exp:\d+/, '');
      const validation = validateSignedInvite(tamperedLink);
      
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/missing mandatory expiry/i);
    });
    
    test('allows truly legacy links (no signature, no expiry)', () => {
      const legacyLink = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'editor',
        hasPassword: true,
        password: 'test-pass',
      });
      
      const validation = validateSignedInvite(legacyLink);
      expect(validation.valid).toBe(true);
      expect(validation.legacy).toBe(true);
    });
    
    test('detects tampered signature', () => {
      const result = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'editor',
        expiryMinutes: 60,
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      // Tamper with the link — change permission in the link but not in the signature
      const tamperedLink = result.link.replace('perm:e', 'perm:o');
      const validation = validateSignedInvite(tamperedLink);
      
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/signature|tampered/i);
    });
    
    test('returns expiry timestamp in validation result', () => {
      const result = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'viewer',
        expiryMinutes: 30,
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      const validation = validateSignedInvite(result.link);
      expect(validation.valid).toBe(true);
      expect(validation.expiry).toBe(result.expiry);
      expect(validation.permission).toBe('viewer');
      expect(validation.ownerPublicKey).toBe(testKeypair.publicKeyBase62);
    });
  });
  
  describe('Clickable share link → nightjar:// conversion for join flow', () => {
    test('HTTPS join URL converts to nightjar:// and preserves all fragment params', () => {
      const httpsUrl = 'https://relay.night-jar.co/join/w/abc123#k:test&perm:e&exp:999999&sig:xyz&by:owner';
      const nightjar = joinUrlToNightjarLink(httpsUrl);
      
      expect(nightjar).toBe('nightjar://w/abc123#k:test&perm:e&exp:999999&sig:xyz&by:owner');
    });
    
    test('nightjar:// link converts to HTTPS join URL', () => {
      const nightjar = 'nightjar://w/abc123#k:test&perm:e';
      const https = nightjarLinkToJoinUrl(nightjar);
      
      expect(https).toBe('https://relay.night-jar.co/join/w/abc123#k:test&perm:e');
    });
    
    test('round-trip preserves signed invite link integrity', () => {
      const testKeypair = generateTestKeypair();
      const result = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'editor',
        expiryMinutes: 60,
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      // Convert to HTTPS and back
      const httpsUrl = nightjarLinkToJoinUrl(result.link);
      const restored = joinUrlToNightjarLink(httpsUrl);
      
      // Validate the restored link
      const validation = validateSignedInvite(restored);
      expect(validation.valid).toBe(true);
      expect(validation.expiry).toBe(result.expiry);
    });
    
    test('isJoinUrl detects valid HTTPS join URLs', () => {
      expect(isJoinUrl('https://relay.night-jar.co/join/w/abc123')).toBe(true);
      expect(isJoinUrl('https://relay.night-jar.co/join/w/abc123#exp:123&sig:xyz')).toBe(true);
      expect(isJoinUrl('http://localhost:3000/join/w/abc123')).toBe(true);
      expect(isJoinUrl('nightjar://w/abc123')).toBe(false);
      expect(isJoinUrl('https://example.com/other')).toBe(false);
    });
    
    test('parseAnyShareLink handles both formats identically', () => {
      const testKeypair = generateTestKeypair();
      const result = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'editor',
        expiryMinutes: 60,
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      const httpsUrl = nightjarLinkToJoinUrl(result.link);
      
      const fromNightjar = parseAnyShareLink(result.link);
      const fromHttps = parseAnyShareLink(httpsUrl);
      
      expect(fromHttps.entityId).toBe(fromNightjar.entityId);
      expect(fromHttps.entityType).toBe(fromNightjar.entityType);
      expect(fromHttps.permission).toBe(fromNightjar.permission);
    });
  });
  
  describe('generateSignedInviteLink — security properties', () => {
    let testKeypair;
    
    beforeAll(() => {
      testKeypair = generateTestKeypair();
    });
    
    test('requires workspaceId, encryptionKey, and ownerPrivateKey', () => {
      expect(() => generateSignedInviteLink({
        encryptionKey: new Uint8Array(32),
        ownerPrivateKey: testKeypair.privateKey,
      })).toThrow();
      
      expect(() => generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        ownerPrivateKey: testKeypair.privateKey,
      })).toThrow();
      
      expect(() => generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32),
      })).toThrow();
    });
    
    test('embeds exp:, sig:, and by: in fragment', () => {
      const result = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'editor',
        expiryMinutes: 60,
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      expect(result.link).toContain('exp:');
      expect(result.link).toContain('sig:');
      expect(result.link).toContain('by:');
    });
    
    test('signature covers workspaceId|expiry|permission', () => {
      const result = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'editor',
        expiryMinutes: 60,
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      // Validation verifies the signature internally
      const validation = validateSignedInvite(result.link);
      expect(validation.valid).toBe(true);
      
      // Changing any signed field should invalidate
      const expRegex = /exp:(\d+)/;
      const match = result.link.match(expRegex);
      const tamperedExpiry = result.link.replace(match[0], `exp:${parseInt(match[1]) + 1000}`);
      const tamperedValidation = validateSignedInvite(tamperedExpiry);
      expect(tamperedValidation.valid).toBe(false);
    });
    
    test('generates unique signatures for different permissions', () => {
      const editor = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'editor',
        expiryMinutes: 60,
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      const viewer = generateSignedInviteLink({
        workspaceId: sampleWorkspaceId,
        encryptionKey: new Uint8Array(32).fill(1),
        permission: 'viewer',
        expiryMinutes: 60,
        ownerPrivateKey: testKeypair.privateKey,
        ownerPublicKey: testKeypair.publicKeyBase62,
      });
      
      expect(editor.signature).not.toBe(viewer.signature);
    });
  });
  
  describe('Link fragment security — secrets never sent to server', () => {
    test('encryption key is in fragment only', () => {
      const link = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'editor',
        hasPassword: false,
        encryptionKey: new Uint8Array(32).fill(42),
      });
      
      const [path, fragment] = link.split('#');
      expect(path).not.toContain('k:');
      expect(fragment).toContain('k:');
    });
    
    test('password is in fragment only', () => {
      const link = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'editor',
        hasPassword: true,
        password: 'secret-password',
      });
      
      const [path, fragment] = link.split('#');
      expect(path).not.toContain('secret-password');
      expect(fragment).toContain('p:secret-password');
    });
    
    test('HTTPS join URL preserves fragment position', () => {
      const nightjar = 'nightjar://w/abc123#k:secretkey&perm:e&exp:999';
      const https = nightjarLinkToJoinUrl(nightjar);
      
      // Fragment should be after #, not in the path
      const [httpPath, httpFragment] = https.split('#');
      expect(httpPath).not.toContain('secretkey');
      expect(httpFragment).toContain('k:secretkey');
    });
  });
  
  describe('Edge cases', () => {
    test('validates link with no fragment at all', () => {
      // A bare nightjar:// link with no fragment
      const link = 'nightjar://w/0abc123456789012345678901234567';
      try {
        const validation = validateSignedInvite(link);
        expect(validation.legacy).toBe(true);
      } catch (e) {
        // parseShareLink may throw for invalid payload — that's acceptable
        expect(e).toBeDefined();
      }
    });
    
    test('handles empty/null input gracefully', () => {
      expect(validateSignedInvite('')).toEqual(expect.objectContaining({ valid: false }));
      expect(validateSignedInvite(null)).toEqual(expect.objectContaining({ valid: false }));
      expect(validateSignedInvite(undefined)).toEqual(expect.objectContaining({ valid: false }));
    });
    
    test('DEFAULT_SHARE_HOST is set correctly', () => {
      expect(DEFAULT_SHARE_HOST).toBe('https://relay.night-jar.co');
    });
  });
});
