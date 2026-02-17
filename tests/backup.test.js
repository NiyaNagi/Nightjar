/**
 * Backup & Recovery Tests
 * 
 * Tests for encrypted backup creation and restoration.
 */

import {
  createBackup,
  restoreBackup,
  deriveBackupKey,
  encryptData,
  decryptData,
} from '../frontend/src/utils/backup';
import {
  generateIdentity,
} from '../frontend/src/utils/identity';

describe('Backup System', () => {
  let testIdentity;
  let testWorkspaces;
  
  beforeEach(() => {
    testIdentity = generateIdentity();
    testWorkspaces = [
      {
        id: 'workspace1',
        name: 'Test Workspace 1',
        myPermission: 'owner',
        encryptionKey: 'base64encodedkey1',
      },
      {
        id: 'workspace2',
        name: 'Test Workspace 2',
        myPermission: 'editor',
        encryptionKey: 'base64encodedkey2',
      },
    ];
  });
  
  describe('Backup Key Derivation', () => {
    test('derives consistent key from mnemonic', () => {
      const key1 = deriveBackupKey(testIdentity.mnemonic);
      const key2 = deriveBackupKey(testIdentity.mnemonic);
      
      expect(key1).toEqual(key2);
    });
    
    test('derives 32-byte key', () => {
      const key = deriveBackupKey(testIdentity.mnemonic);
      
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });
    
    test('different mnemonics produce different keys', () => {
      const identity2 = generateIdentity();
      const key1 = deriveBackupKey(testIdentity.mnemonic);
      const key2 = deriveBackupKey(identity2.mnemonic);
      
      expect(key1).not.toEqual(key2);
    });
    
    test('backup key is different from identity key', () => {
      // Backup uses bytes 32-63 of seed, identity uses 0-31
      const backupKey = deriveBackupKey(testIdentity.mnemonic);
      const identityKey = testIdentity.privateKey.slice(0, 32); // First 32 bytes
      
      expect(backupKey).not.toEqual(identityKey);
    });
  });
  
  describe('Encryption/Decryption', () => {
    test('encrypts and decrypts string data', () => {
      const key = deriveBackupKey(testIdentity.mnemonic);
      const original = 'test secret data';
      
      const encrypted = encryptData(original, key);
      const decrypted = decryptData(encrypted, key);
      
      expect(decrypted).toBe(original);
    });
    
    test('encrypts and decrypts object data', () => {
      const key = deriveBackupKey(testIdentity.mnemonic);
      const original = { foo: 'bar', num: 42, nested: { a: 1 } };
      
      const encrypted = encryptData(original, key);
      const decrypted = decryptData(encrypted, key);
      
      expect(decrypted).toEqual(original);
    });
    
    test('decryption fails with wrong key', () => {
      const key1 = deriveBackupKey(testIdentity.mnemonic);
      const identity2 = generateIdentity();
      const key2 = deriveBackupKey(identity2.mnemonic);
      const data = 'secret data';
      
      const encrypted = encryptData(data, key1);
      
      expect(() => {
        decryptData(encrypted, key2);
      }).toThrow();
    });
    
    test('encrypted data is base64 encoded', () => {
      const key = deriveBackupKey(testIdentity.mnemonic);
      const data = 'test data';
      
      const encrypted = encryptData(data, key);
      
      expect(typeof encrypted).toBe('string');
      // Should be valid base64
      expect(() => atob(encrypted)).not.toThrow();
    });
  });
  
  describe('Backup Creation', () => {
    test('creates backup with correct version', async () => {
      const backup = await createBackup(testIdentity, testWorkspaces);
      
      expect(backup.version).toBe(1);
    });
    
    test('creates backup with timestamp', async () => {
      const before = Date.now();
      const backup = await createBackup(testIdentity, testWorkspaces);
      const after = Date.now();
      
      const createdAt = new Date(backup.createdAt).getTime();
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(after);
    });
    
    test('includes encrypted identity', async () => {
      const backup = await createBackup(testIdentity, testWorkspaces);
      
      expect(backup.identity).toBeDefined();
      expect(backup.identity.publicKey).toBe(testIdentity.publicKeyBase62);
      expect(backup.identity.encryptedSecretKey).toBeDefined();
    });
    
    test('includes encrypted workspaces', async () => {
      const backup = await createBackup(testIdentity, testWorkspaces);
      
      expect(backup.workspaces).toHaveLength(2);
      expect(backup.workspaces[0].id).toBe('workspace1');
      expect(backup.workspaces[0].name).toBe('Test Workspace 1');
      expect(backup.workspaces[0].isOwner).toBe(true);
      expect(backup.workspaces[0].encryptedKey).toBeDefined();
    });
    
    test('requires identity with mnemonic', async () => {
      const identityWithoutMnemonic = { publicKeyBase62: 'abc' };
      
      await expect(
        createBackup(identityWithoutMnemonic, testWorkspaces)
      ).rejects.toThrow();
    });
    
    test('supports optional passphrase', async () => {
      const backupWithPassphrase = await createBackup(testIdentity, testWorkspaces, 'mypassphrase');
      const backupWithoutPassphrase = await createBackup(testIdentity, testWorkspaces);
      
      expect(backupWithPassphrase.hasPassphrase).toBe(true);
      expect(backupWithoutPassphrase.hasPassphrase).toBe(false);
    });
  });
  
  describe('Backup Restoration', () => {
    test('restores identity from backup', async () => {
      const backup = await createBackup(testIdentity, testWorkspaces);
      const restored = await restoreBackup(backup, testIdentity.mnemonic);
      
      expect(restored.identity.publicKeyBase62).toBe(testIdentity.publicKeyBase62);
    });
    
    test('restores workspaces from backup', async () => {
      const backup = await createBackup(testIdentity, testWorkspaces);
      const restored = await restoreBackup(backup, testIdentity.mnemonic);
      
      expect(restored.workspaces).toHaveLength(2);
      expect(restored.workspaces[0].id).toBe('workspace1');
      expect(restored.workspaces[0].encryptionKey).toBe('base64encodedkey1');
    });
    
    test('fails with invalid mnemonic', async () => {
      const backup = await createBackup(testIdentity, testWorkspaces);
      
      await expect(
        restoreBackup(backup, 'invalid mnemonic words here')
      ).rejects.toThrow('Invalid recovery phrase');
    });
    
    test('fails with wrong mnemonic', async () => {
      const backup = await createBackup(testIdentity, testWorkspaces);
      const differentIdentity = generateIdentity();
      
      await expect(
        restoreBackup(backup, differentIdentity.mnemonic)
      ).rejects.toThrow();
    });
    
    test('requires passphrase if backup has one', async () => {
      const backup = await createBackup(testIdentity, testWorkspaces, 'mypassphrase');
      
      await expect(
        restoreBackup(backup, testIdentity.mnemonic)
      ).rejects.toThrow('requires a passphrase');
    });
    
    test('restores with correct passphrase', async () => {
      const passphrase = 'mySecretPassphrase';
      const backup = await createBackup(testIdentity, testWorkspaces, passphrase);
      const restored = await restoreBackup(backup, testIdentity.mnemonic, passphrase);
      
      expect(restored.identity.publicKeyBase62).toBe(testIdentity.publicKeyBase62);
    });
    
    test('fails with wrong passphrase', async () => {
      const backup = await createBackup(testIdentity, testWorkspaces, 'correctpassphrase');
      
      await expect(
        restoreBackup(backup, testIdentity.mnemonic, 'wrongpassphrase')
      ).rejects.toThrow();
    });
  });
  
  describe('Backup Version Handling', () => {
    test('rejects unsupported backup version', async () => {
      const backup = await createBackup(testIdentity, testWorkspaces);
      backup.version = 999;
      
      await expect(
        restoreBackup(backup, testIdentity.mnemonic)
      ).rejects.toThrow('unsupported backup version');
    });
    
    test('rejects null backup', async () => {
      await expect(
        restoreBackup(null, testIdentity.mnemonic)
      ).rejects.toThrow();
    });
  });
});
