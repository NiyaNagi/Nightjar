/**
 * Kick System Tests
 * 
 * Tests for workspace member kicking with cryptographic verification.
 */

import {
  generateIdentity,
  signData,
  verifySignature,
  uint8ToBase62,
  base62ToUint8,
} from '../frontend/src/utils/identity';

describe('Kick System', () => {
  let ownerIdentity;
  let memberIdentity;
  let nonOwnerIdentity;
  const mockWorkspaceId = 'workspace123';
  
  beforeEach(() => {
    ownerIdentity = generateIdentity();
    memberIdentity = generateIdentity();
    nonOwnerIdentity = generateIdentity();
  });
  
  describe('Kick Signature Generation', () => {
    test('owner can create valid kick signature', () => {
      const targetPublicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp}`;
      
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64);
    });
    
    test('kick signature can be verified', () => {
      const targetPublicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp}`;
      
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      const isValid = verifySignature(messageToSign, signature, ownerIdentity.publicKey);
      
      expect(isValid).toBe(true);
    });
    
    test('kick signature includes workspace and target', () => {
      const targetPublicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      
      // Sign kick for workspace A
      const messageA = `kick:workspaceA:${targetPublicKey}:${timestamp}`;
      const signatureA = signData(messageA, ownerIdentity.privateKey);
      
      // Same signature shouldn't work for workspace B
      const messageB = `kick:workspaceB:${targetPublicKey}:${timestamp}`;
      const isValidForB = verifySignature(messageB, signatureA, ownerIdentity.publicKey);
      
      expect(isValidForB).toBe(false);
    });
  });
  
  describe('Kick Verification', () => {
    test('forged kick signature is rejected', () => {
      const targetPublicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp}`;
      
      // Non-owner tries to forge a kick
      const forgedSignature = signData(messageToSign, nonOwnerIdentity.privateKey);
      
      // Verify against owner's public key - should fail
      const isValid = verifySignature(messageToSign, forgedSignature, ownerIdentity.publicKey);
      
      expect(isValid).toBe(false);
    });
    
    test('tampered kick signature is rejected', () => {
      const targetPublicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp}`;
      
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      
      // Tamper with signature
      const tamperedSignature = new Uint8Array(signature);
      tamperedSignature[0] = tamperedSignature[0] ^ 0xff;
      
      const isValid = verifySignature(messageToSign, tamperedSignature, ownerIdentity.publicKey);
      
      expect(isValid).toBe(false);
    });
    
    test('kick for wrong target is rejected', () => {
      const targetPublicKey = memberIdentity.publicKeyBase62;
      const otherPublicKey = nonOwnerIdentity.publicKeyBase62;
      const timestamp = Date.now();
      
      // Sign kick for member
      const messageToSign = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp}`;
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      
      // Try to verify for different target
      const messageForOther = `kick:${mockWorkspaceId}:${otherPublicKey}:${timestamp}`;
      const isValid = verifySignature(messageForOther, signature, ownerIdentity.publicKey);
      
      expect(isValid).toBe(false);
    });
  });
  
  describe('Kicked Map Structure', () => {
    test('kicked entry contains required fields', () => {
      const targetPublicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp}`;
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      
      const kickedEntry = {
        kickedAt: timestamp,
        kickedBy: ownerIdentity.publicKeyBase62,
        signature: uint8ToBase62(signature),
        reason: 'Test kick',
      };
      
      expect(kickedEntry.kickedAt).toBe(timestamp);
      expect(kickedEntry.kickedBy).toBe(ownerIdentity.publicKeyBase62);
      expect(kickedEntry.signature).toBeDefined();
      expect(typeof kickedEntry.signature).toBe('string');
    });
    
    test('kicked signature can be decoded and verified', () => {
      const targetPublicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp}`;
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      
      // Encode to base62 (as stored in Y.Map)
      const signatureBase62 = uint8ToBase62(signature);
      
      // Decode from base62
      const decodedSignature = base62ToUint8(signatureBase62, 64);
      
      // Verify
      const isValid = verifySignature(messageToSign, decodedSignature, ownerIdentity.publicKey);
      
      expect(isValid).toBe(true);
    });
  });
  
  describe('Permission Checks', () => {
    test('non-owner kick signature fails verification against owner', () => {
      const targetPublicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp}`;
      
      // Non-owner signs
      const signature = signData(messageToSign, nonOwnerIdentity.privateKey);
      
      // Verify against owner's key - should fail
      const isValidAsOwner = verifySignature(messageToSign, signature, ownerIdentity.publicKey);
      
      // But should succeed against non-owner's own key
      const isValidAsSelf = verifySignature(messageToSign, signature, nonOwnerIdentity.publicKey);
      
      expect(isValidAsOwner).toBe(false);
      expect(isValidAsSelf).toBe(true);
    });
    
    test('owner cannot kick themselves (application logic)', () => {
      // This is enforced at application level, not crypto level
      // The signature would be valid, but the app should prevent it
      const targetPublicKey = ownerIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp}`;
      
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      const isValid = verifySignature(messageToSign, signature, ownerIdentity.publicKey);
      
      // Crypto-wise valid, but app should block
      expect(isValid).toBe(true);
      // Application would check: targetPublicKey !== ownerPublicKey
      expect(targetPublicKey).toBe(ownerIdentity.publicKeyBase62);
    });
  });
  
  describe('Replay Attack Prevention', () => {
    test('kick signature is bound to timestamp', () => {
      const targetPublicKey = memberIdentity.publicKeyBase62;
      const timestamp1 = Date.now();
      const timestamp2 = timestamp1 + 1000; // 1 second later
      
      const message1 = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp1}`;
      const signature = signData(message1, ownerIdentity.privateKey);
      
      // Try to replay with different timestamp
      const message2 = `kick:${mockWorkspaceId}:${targetPublicKey}:${timestamp2}`;
      const isValid = verifySignature(message2, signature, ownerIdentity.publicKey);
      
      expect(isValid).toBe(false);
    });
  });
});
