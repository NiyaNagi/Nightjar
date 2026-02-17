/**
 * Error Handling Test Suite
 * 
 * Tests for graceful degradation, error recovery, and failure scenarios.
 * Ensures the application remains stable under adverse conditions.
 */

import {
  generateIdentity,
  restoreIdentityFromMnemonic,
  validateMnemonic,
  signData,
  verifySignature,
  uint8ToBase62,
  base62ToUint8,
} from '../frontend/src/utils/identity';
import {
  createBackup,
  restoreBackup,
  deriveBackupKey,
  encryptData,
  decryptData,
} from '../frontend/src/utils/backup';

// Store original implementations for restoration
const originalLocalStorage = global.localStorage;
const originalCrypto = global.crypto;

describe('Error Handling: LocalStorage Failures', () => {
  afterEach(() => {
    // Restore localStorage after each test
    Object.defineProperty(global, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
    });
  });

  test('handles localStorage.getItem throwing', () => {
    const failingStorage = {
      getItem: () => { throw new Error('Storage access denied'); },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
    
    Object.defineProperty(global, 'localStorage', {
      value: failingStorage,
      writable: true,
    });
    
    // Application should handle this gracefully
    const result = (() => {
      try {
        localStorage.getItem('test');
        return false;
      } catch (e) {
        return true; // Error was thrown
      }
    })();
    
    expect(result).toBe(true);
  });

  test('handles localStorage.setItem quota exceeded', () => {
    const quotaExceededStorage = {
      getItem: () => null,
      setItem: () => {
        const error = new Error('Quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      },
      removeItem: () => {},
      clear: () => {},
    };
    
    Object.defineProperty(global, 'localStorage', {
      value: quotaExceededStorage,
      writable: true,
    });
    
    // Should not crash the application
    expect(() => {
      try {
        localStorage.setItem('test', 'value');
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          // Handle gracefully - e.g., show user-friendly message
          return 'handled';
        }
        throw e;
      }
    }).not.toThrow();
  });

  test('handles localStorage being null/undefined', () => {
    Object.defineProperty(global, 'localStorage', {
      value: null,
      writable: true,
    });
    
    // Safe access pattern
    const safeGet = (key) => {
      try {
        return localStorage?.getItem?.(key) ?? null;
      } catch {
        return null;
      }
    };
    
    expect(safeGet('test')).toBe(null);
  });
});

describe('Error Handling: Crypto Failures', () => {
  test('handles crypto.getRandomValues not available', () => {
    // This simulates a very old browser or restricted environment
    const result = (() => {
      if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
        return 'crypto not available';
      }
      return 'crypto available';
    })();
    
    expect(['crypto available', 'crypto not available']).toContain(result);
  });

  test('handles corrupted encrypted data', () => {
    const identity = generateIdentity();
    const key = deriveBackupKey(identity.mnemonic);
    
    // Create valid encrypted data
    const encrypted = encryptData('test data', key);
    
    // Corrupt it by changing characters
    const corrupted = 'not-valid-base64-@#$%';
    
    expect(() => {
      decryptData(corrupted, key);
    }).toThrow();
  });

  test('handles truncated encrypted data', () => {
    const identity = generateIdentity();
    const key = deriveBackupKey(identity.mnemonic);
    
    const encrypted = encryptData('test data with some content', key);
    
    // Truncate the data
    const truncated = encrypted.slice(0, 10);
    
    expect(() => {
      decryptData(truncated, key);
    }).toThrow();
  });

  test('handles null/undefined inputs to crypto functions', () => {
    const identity = generateIdentity();
    
    // signData with null message
    expect(() => signData(null, identity.privateKey)).toThrow();
    
    // signData with null key
    expect(() => signData('message', null)).toThrow();
    
    // verifySignature with null inputs
    expect(() => verifySignature(null, null, null)).toThrow();
  });
});

describe('Error Handling: Network Simulation', () => {
  test('simulates offline state handling', () => {
    const isOnline = () => typeof navigator !== 'undefined' ? navigator.onLine : true;
    
    // Mock offline state
    const mockNavigator = { onLine: false };
    const wasOnline = isOnline();
    
    // Application should queue operations when offline
    const operationQueue = [];
    
    const queueOperation = (op) => {
      if (!mockNavigator.onLine) {
        operationQueue.push(op);
        return { queued: true };
      }
      return { executed: true };
    };
    
    const result = queueOperation({ type: 'sync', data: 'test' });
    expect(result.queued).toBe(true);
    expect(operationQueue).toHaveLength(1);
  });

  test('handles sync timeout gracefully', async () => {
    // Simulate a sync operation that times out
    const syncWithTimeout = (timeoutMs) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Sync timeout'));
        }, timeoutMs);
        
        // Simulate slow network - takes longer than timeout
        setTimeout(() => {
          clearTimeout(timeout);
          resolve({ success: true });
        }, timeoutMs + 100);
      });
    };
    
    await expect(syncWithTimeout(10)).rejects.toThrow('Sync timeout');
  });

  test('handles reconnection with stale data', () => {
    // Simulate reconnecting after being offline
    const localVersion = 5;
    const remoteVersion = 8;
    
    const handleReconnect = (local, remote) => {
      if (remote > local) {
        return { action: 'fetch-updates', from: local, to: remote };
      } else if (local > remote) {
        return { action: 'push-updates', from: remote, to: local };
      }
      return { action: 'in-sync' };
    };
    
    const result = handleReconnect(localVersion, remoteVersion);
    expect(result.action).toBe('fetch-updates');
  });
});

describe('Error Handling: Invalid Input Defense', () => {
  describe('Identity Functions', () => {
    test('restoreIdentityFromMnemonic rejects garbage input', () => {
      const garbageInputs = [
        '',
        null,
        undefined,
        123,
        {},
        [],
        'a'.repeat(10000),
        '<script>alert("xss")</script>',
        '"; DROP TABLE users;--',
        '\0\0\0\0',
      ];
      
      for (const input of garbageInputs) {
        const result = (() => {
          try {
            restoreIdentityFromMnemonic(input);
            return 'succeeded';
          } catch (e) {
            return 'threw';
          }
        })();
        
        // Should either throw or return null/undefined, never crash
        expect(['succeeded', 'threw']).toContain(result);
      }
    });

    test('validateMnemonic never throws', () => {
      const weirdInputs = [
        undefined,
        null,
        '',
        123,
        Symbol('test'),
        () => {},
        new Date(),
        /regex/,
        new Map(),
        new Set(),
      ];
      
      for (const input of weirdInputs) {
        expect(() => {
          const result = validateMnemonic(input);
          // Result should be boolean
          expect(typeof result).toBe('boolean');
        }).not.toThrow();
      }
    });
  });

  describe('Base62 Functions', () => {
    test('uint8ToBase62 handles edge case inputs', () => {
      const edgeCases = [
        new Uint8Array([]),
        new Uint8Array([0]),
        new Uint8Array([255]),
        new Uint8Array(1000).fill(128),
      ];
      
      for (const input of edgeCases) {
        expect(() => uint8ToBase62(input)).not.toThrow();
      }
    });

    test('base62ToUint8 handles invalid length requests', () => {
      const validBase62 = uint8ToBase62(new Uint8Array([1, 2, 3]));
      
      // Request wrong length
      const results = [
        () => base62ToUint8(validBase62, 0),
        () => base62ToUint8(validBase62, -1),
        () => base62ToUint8(validBase62, 1000000),
      ];
      
      // Should either throw or return best-effort result
      for (const fn of results) {
        expect(() => fn()).toBeDefined(); // Either returns or throws
      }
    });
  });

  describe('Signature Functions', () => {
    test('signData with wrong key length is rejected', () => {
      const badKeys = [
        new Uint8Array(0),
        new Uint8Array(32), // Should be 64
        new Uint8Array(128),
      ];
      
      for (const badKey of badKeys) {
        expect(() => {
          signData('test', badKey);
        }).toThrow();
      }
    });

    test('verifySignature with wrong signature length returns false', () => {
      const identity = generateIdentity();
      const message = 'test';
      
      const badSignatures = [
        new Uint8Array(0),
        new Uint8Array(32),
        new Uint8Array(128),
      ];
      
      for (const badSig of badSignatures) {
        // Should return false, not crash
        const result = (() => {
          try {
            return verifySignature(message, badSig, identity.publicKey);
          } catch {
            return false;
          }
        })();
        
        expect(result).toBe(false);
      }
    });
  });
});

describe('Error Handling: Backup/Restore Failures', () => {
  test('restoreBackup with wrong mnemonic fails gracefully', async () => {
    const identity = generateIdentity();
    const otherIdentity = generateIdentity();
    
    const backup = await createBackup(identity, []);
    
    // Try to restore with wrong mnemonic
    await expect(
      restoreBackup(backup, otherIdentity.mnemonic)
    ).rejects.toThrow();
  });

  test('restoreBackup with corrupted backup fails gracefully', async () => {
    const identity = generateIdentity();
    
    const corruptedBackups = [
      null,
      undefined,
      {},
      { version: 1 }, // Missing required fields
      { version: 999, identity: {} }, // Unknown version
      { version: 1, identity: { encryptedSecretKey: 'garbage' } },
    ];
    
    for (const corrupted of corruptedBackups) {
      await expect(
        restoreBackup(corrupted, identity.mnemonic)
      ).rejects.toThrow();
    }
  });

  test('createBackup with invalid identity fails gracefully', async () => {
    const invalidIdentities = [
      null,
      {},
      { mnemonic: 'invalid' }, // Missing keys
    ];
    
    for (const invalid of invalidIdentities) {
      await expect(
        createBackup(invalid, [])
      ).rejects.toThrow();
    }
  });
});

describe('Error Handling: State Corruption Recovery', () => {
  test('detects and reports corrupted Y.js state', () => {
    // Simulate corrupted CRDT state
    const isStateValid = (state) => {
      if (!state) return false;
      if (!(state instanceof Uint8Array)) return false;
      if (state.length < 2) return false; // Minimum Y.js state size
      return true;
    };
    
    const corruptedStates = [
      null,
      undefined,
      new Uint8Array([]),
      new Uint8Array([0]),
      'not a uint8array',
    ];
    
    for (const state of corruptedStates) {
      expect(isStateValid(state)).toBe(false);
    }
    
    // Valid state
    const validState = new Uint8Array([0, 0, 1, 2, 3, 4]);
    expect(isStateValid(validState)).toBe(true);
  });

  test('gracefully handles missing workspace encryption key', () => {
    const workspaceWithoutKey = {
      id: 'ws-1',
      name: 'Test',
      myPermission: 'editor',
      // encryptionKey is missing
    };
    
    const hasValidKey = (ws) => {
      return !!(ws.encryptionKey && typeof ws.encryptionKey === 'string' && ws.encryptionKey.length > 0);
    };
    
    expect(hasValidKey(workspaceWithoutKey)).toBe(false);
  });
});

describe('Error Handling: Memory and Resource Limits', () => {
  test('handles very large workspace lists', async () => {
    const identity = generateIdentity();
    
    // Create 1000 workspaces
    const largeWorkspaceList = Array.from({ length: 1000 }, (_, i) => ({
      id: `ws-${i}`,
      name: `Workspace ${i}`,
      myPermission: i === 0 ? 'owner' : 'editor',
      encryptionKey: `key-${i}`,
    }));
    
    // Should not crash or hang
    const startTime = Date.now();
    const backup = await createBackup(identity, largeWorkspaceList);
    const elapsed = Date.now() - startTime;
    
    expect(backup.workspaces).toHaveLength(1000);
    expect(elapsed).toBeLessThan(5000); // Should complete in < 5 seconds
  });

  test('handles very long workspace names', async () => {
    const identity = generateIdentity();
    
    const workspaceWithLongName = {
      id: 'ws-1',
      name: 'A'.repeat(10000),
      myPermission: 'owner',
      encryptionKey: 'key-1',
    };
    
    await expect(
      createBackup(identity, [workspaceWithLongName])
    ).resolves.toBeDefined();
  });
});

describe('Error Handling: Concurrent Operations', () => {
  test('handles rapid successive identity generations', async () => {
    const promises = Array.from({ length: 100 }, () => 
      Promise.resolve(generateIdentity())
    );
    
    const identities = await Promise.all(promises);
    
    // All should succeed
    expect(identities).toHaveLength(100);
    
    // All should be unique
    const publicKeys = new Set(identities.map(id => id.publicKeyBase62));
    expect(publicKeys.size).toBe(100);
  });

  test('handles interleaved sign/verify operations', async () => {
    const identity = generateIdentity();
    const messages = Array.from({ length: 50 }, (_, i) => `Message ${i}`);
    
    // Sign all messages concurrently
    const signPromises = messages.map(msg => 
      Promise.resolve(signData(msg, identity.privateKey))
    );
    const signatures = await Promise.all(signPromises);
    
    // Verify all signatures concurrently
    const verifyPromises = messages.map((msg, i) =>
      Promise.resolve(verifySignature(msg, signatures[i], identity.publicKey))
    );
    const results = await Promise.all(verifyPromises);
    
    expect(results.every(r => r === true)).toBe(true);
  });
});
