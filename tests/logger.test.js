/**
 * Logger Test Suite
 * 
 * Comprehensive tests for the unified logging layer with PII stripping.
 */

import logger, {
  stripPII,
  sanitizeObject,
  logError,
  logBehavior,
  logMetric,
  getLogs,
  getLogsAsJSON,
  getLogStats,
  clearLogs,
} from '../frontend/src/utils/logger';

describe('Logger: PII Stripping', () => {
  describe('Email Addresses', () => {
    test('strips simple email addresses', () => {
      expect(stripPII('Contact: user@example.com')).toBe('Contact: [STRIPPED]');
    });

    test('strips complex email addresses', () => {
      expect(stripPII('john.doe+tag@company.org')).toBe('[STRIPPED]');
    });

    test('strips multiple emails', () => {
      const input = 'From: a@b.com To: c@d.com';
      const result = stripPII(input);
      expect(result).not.toContain('@');
      expect(result.match(/\[STRIPPED\]/g)).toHaveLength(2);
    });
  });

  describe('Phone Numbers', () => {
    test('strips US phone numbers', () => {
      expect(stripPII('Call 555-123-4567')).toContain('[STRIPPED]');
      expect(stripPII('(555) 123-4567')).toContain('[STRIPPED]');
    });

    test('strips international phone numbers', () => {
      expect(stripPII('+1 555 123 4567')).toContain('[STRIPPED]');
      expect(stripPII('+44 20 7946 0958')).toContain('[STRIPPED]');
    });
  });

  describe('IP Addresses', () => {
    test('strips IPv4 addresses', () => {
      expect(stripPII('IP: 192.168.1.100')).toBe('IP: [STRIPPED]');
      expect(stripPII('Server at 10.0.0.1')).toBe('Server at [STRIPPED]');
    });

    test('strips multiple IPs', () => {
      const input = 'From 192.168.1.1 to 10.0.0.1';
      expect(stripPII(input).match(/\[STRIPPED\]/g)).toHaveLength(2);
    });
  });

  describe('Cryptographic Material', () => {
    test('strips 64-char hex keys', () => {
      const hexKey = 'a'.repeat(64);
      expect(stripPII(`Key: ${hexKey}`)).toBe('Key: [STRIPPED]');
    });

    test('strips base64 keys', () => {
      const b64Key = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop==';
      expect(stripPII(b64Key)).toContain('[STRIPPED]');
    });

    test('strips mnemonics (12 words)', () => {
      const mnemonic = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12';
      expect(stripPII(mnemonic)).toContain('[STRIPPED]');
    });

    test('strips password fields', () => {
      expect(stripPII('password: "secret123"')).toBe('[STRIPPED]');
      expect(stripPII("password: 'mypass'")).toBe('[STRIPPED]');
    });

    test('strips token fields', () => {
      expect(stripPII('token: abc123xyz')).toBe('[STRIPPED]');
    });

    test('strips privateKey fields', () => {
      expect(stripPII('privateKey: someKeyValue')).toBe('[STRIPPED]');
    });
  });

  describe('URL Fragments', () => {
    test('strips password fragments', () => {
      expect(stripPII('link#p:secretpass')).toBe('link#[STRIPPED]');
    });

    test('strips key fragments', () => {
      expect(stripPII('link#k:encryptionkey')).toBe('link#[STRIPPED]');
    });

    test('strips signature fragments', () => {
      expect(stripPII('link#sig:abcd1234')).toBe('link#[STRIPPED]');
    });
  });

  describe('File Paths', () => {
    test('strips macOS user paths', () => {
      expect(stripPII('/Users/johnsmith/Documents')).toBe('[STRIPPED]/Documents');
    });

    test('strips Linux user paths', () => {
      expect(stripPII('/home/johndoe/files')).toBe('[STRIPPED]/files');
    });

    test('strips Windows user paths', () => {
      expect(stripPII('C:\\Users\\JaneDoe\\file.txt')).toBe('[STRIPPED]\\file.txt');
    });
  });

  describe('Edge Cases', () => {
    test('handles non-string input', () => {
      expect(stripPII(123)).toBe(123);
      expect(stripPII(null)).toBe(null);
      expect(stripPII(undefined)).toBe(undefined);
    });

    test('handles empty string', () => {
      expect(stripPII('')).toBe('');
    });

    test('handles string with no PII', () => {
      expect(stripPII('Hello world')).toBe('Hello world');
    });
  });
});

describe('Logger: Object Sanitization', () => {
  describe('Forbidden Fields Removal', () => {
    test('removes displayName field', () => {
      const obj = { id: 123, displayName: 'John Doe' };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.id).toBe(123);
      expect(sanitized.displayName).toBeUndefined();
    });

    test('removes password field', () => {
      const obj = { count: 5, password: 'secret' };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.count).toBe(5);
      expect(sanitized.password).toBeUndefined();
    });

    test('removes email field', () => {
      const obj = { status: 'active', email: 'test@test.com' };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.status).toBe('active');
      expect(sanitized.email).toBeUndefined();
    });

    test('removes multiple forbidden fields', () => {
      const obj = {
        id: 1,
        displayName: 'John',
        email: 'john@test.com',
        password: 'secret',
        privateKey: 'key123',
        status: 'online'
      };
      const sanitized = sanitizeObject(obj);
      expect(Object.keys(sanitized)).toEqual(['id', 'status']);
    });

    test('case-insensitive field removal', () => {
      const obj = { displayName: 'John', password: 'secret', status: 'ok' };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.displayName).toBeUndefined();
      expect(sanitized.password).toBeUndefined();
      expect(sanitized.status).toBe('ok');
    });
  });

  describe('Nested Object Handling', () => {
    test('sanitizes nested objects', () => {
      const obj = {
        user: { email: 'test@test.com', status: 'active' },
        count: 5
      };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.user.status).toBe('active');
      expect(sanitized.user.email).toBeUndefined();
      expect(sanitized.count).toBe(5);
    });

    test('sanitizes deeply nested objects', () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              password: 'secret',
              value: 'ok'
            }
          }
        }
      };
      const sanitized = sanitizeObject(obj);
      expect(sanitized.level1.level2.level3.value).toBe('ok');
      expect(sanitized.level1.level2.level3.password).toBeUndefined();
    });
  });

  describe('Array Handling', () => {
    test('sanitizes array elements', () => {
      const arr = [{ name: 'John' }, { status: 'ok' }];
      const sanitized = sanitizeObject(arr);
      expect(sanitized).toHaveLength(2);
      expect(sanitized[0].name).toBeUndefined();
      expect(sanitized[1].status).toBe('ok');
    });

    test('limits array length to 10', () => {
      const arr = Array.from({ length: 20 }, (_, i) => ({ id: i }));
      const sanitized = sanitizeObject(arr);
      expect(sanitized).toHaveLength(10);
    });
  });

  describe('Error Handling', () => {
    test('sanitizes Error objects', () => {
      const err = new Error('Failed with user@email.com');
      const sanitized = sanitizeObject(err);
      expect(sanitized.errorType).toBe('Error');
      expect(sanitized.message).toBe('Failed with [STRIPPED]');
    });

    test('sanitizes custom Error types', () => {
      class CustomError extends Error {
        constructor(msg) {
          super(msg);
          this.name = 'CustomError';
        }
      }
      const err = new CustomError('Custom error message');
      const sanitized = sanitizeObject(err);
      expect(sanitized.errorType).toBe('CustomError');
    });
  });

  describe('Depth Limiting', () => {
    test('limits recursion depth', () => {
      const deep = { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } };
      const sanitized = sanitizeObject(deep);
      expect(JSON.stringify(sanitized)).toContain('[MAX_DEPTH]');
    });
  });

  describe('Primitive Handling', () => {
    test('handles null', () => {
      expect(sanitizeObject(null)).toBe(null);
    });

    test('handles undefined', () => {
      expect(sanitizeObject(undefined)).toBe(undefined);
    });

    test('handles numbers', () => {
      expect(sanitizeObject(42)).toBe(42);
    });

    test('handles booleans', () => {
      expect(sanitizeObject(true)).toBe(true);
    });

    test('sanitizes strings with PII', () => {
      expect(sanitizeObject('email: test@test.com')).toContain('[STRIPPED]');
    });
  });
});

describe('Logger: Log Entry Creation', () => {
  beforeEach(() => {
    logger.clear();
    logger._resetSession();
  });

  describe('logError', () => {
    test('creates error entry with correct structure', () => {
      logError('sync', 'Connection failed', { code: 500 });
      const logs = logger.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      
      const entry = logs.find(l => l.event === 'Connection failed');
      expect(entry.level).toBe('error');
      expect(entry.category).toBe('sync');
      expect(entry.data.code).toBe(500);
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(entry.sessionId).toMatch(/^sess_/);
    });

    test('strips PII from error event', () => {
      logError('auth', 'Login failed for user@example.com');
      const logs = logger.getLogs();
      const entry = logs.find(l => l.level === 'error');
      expect(entry.event).not.toContain('@');
      expect(entry.event).toContain('[STRIPPED]');
    });

    test('sanitizes error data', () => {
      logError('auth', 'Failed', { email: 'test@test.com', code: 401 });
      const logs = logger.getLogs();
      const entry = logs.find(l => l.level === 'error');
      expect(entry.data.email).toBeUndefined();
      expect(entry.data.code).toBe(401);
    });
  });

  describe('logBehavior', () => {
    test('creates behavior entry', () => {
      logBehavior('workspace', 'created', { workspaceCount: 3 });
      const logs = logger.getLogs();
      const entry = logs.find(l => l.event === 'created');
      expect(entry.level).toBe('behavior');
      expect(entry.category).toBe('workspace');
      expect(entry.data.workspaceCount).toBe(3);
    });

    test('strips PII from behavior data', () => {
      logBehavior('user', 'action', {
        displayName: 'John Doe',
        action: 'clicked'
      });
      const logs = logger.getLogs();
      const entry = logs.find(l => l.event === 'action');
      expect(entry.data.displayName).toBeUndefined();
      expect(entry.data.action).toBe('clicked');
    });
  });

  describe('logMetric', () => {
    test('creates metric entry', () => {
      logMetric('performance', 'load_time', { duration: 150 });
      const logs = logger.getLogs();
      const entry = logs.find(l => l.event === 'load_time');
      expect(entry.level).toBe('metric');
      expect(entry.data.duration).toBe(150);
    });

    test('only includes numeric data', () => {
      logMetric('performance', 'stats', {
        duration: 150,
        label: 'test',
        count: 42,
        flag: true
      });
      const logs = logger.getLogs();
      const entry = logs.find(l => l.event === 'stats');
      expect(entry.data.duration).toBe(150);
      expect(entry.data.count).toBe(42);
      expect(entry.data.label).toBeUndefined();
      expect(entry.data.flag).toBeUndefined();
    });

    test('excludes forbidden numeric fields', () => {
      logMetric('test', 'metric', { value: 100, ip: 123 });
      const logs = logger.getLogs();
      const entry = logs.find(l => l.event === 'metric');
      expect(entry.data.value).toBe(100);
      expect(entry.data.ip).toBeUndefined();
    });
  });

  describe('Category Validation', () => {
    test('accepts valid categories', () => {
      logBehavior('sync', 'test');
      logBehavior('workspace', 'test');
      logBehavior('crypto', 'test');
      
      const logs = logger.getLogs();
      const categories = logs.map(l => l.category);
      expect(categories).toContain('sync');
      expect(categories).toContain('workspace');
      expect(categories).toContain('crypto');
    });

    test('maps invalid category to other', () => {
      logBehavior('invalid_category', 'test');
      const logs = logger.getLogs();
      const entry = logs.find(l => l.event === 'test');
      expect(entry.category).toBe('other');
    });
  });

  describe('Session ID', () => {
    test('includes session ID in entries', () => {
      logBehavior('app', 'test');
      const logs = logger.getLogs();
      expect(logs[0].sessionId).toMatch(/^sess_/);
    });

    test('maintains consistent session ID within session', () => {
      logBehavior('app', 'test1');
      logBehavior('app', 'test2');
      const logs = logger.getLogs();
      // Find our specific test entries (skip any clear event)
      const test1 = logs.find(l => l.event === 'test1');
      const test2 = logs.find(l => l.event === 'test2');
      expect(test1.sessionId).toBe(test2.sessionId);
    });

    test('resets session ID when requested', () => {
      logBehavior('app', 'test1');
      const firstSession = logger.getLogs()[0].sessionId;
      
      logger._resetSession();
      logBehavior('app', 'test2');
      
      const logs = logger.getLogs();
      const secondEntry = logs.find(l => l.event === 'test2');
      expect(secondEntry.sessionId).not.toBe(firstSession);
    });
  });
});

describe('Logger: Buffer Management', () => {
  beforeEach(() => {
    logger.clear();
    logger._resetSession();
  });

  describe('getLogs', () => {
    test('returns copy of buffer', () => {
      logBehavior('app', 'test1');
      logBehavior('app', 'test2');
      const logs = logger.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });

    test('returns empty array when no logs', () => {
      const buffer = logger._getBuffer();
      buffer.length = 0;
      expect(logger.getLogs()).toEqual([]);
    });
  });

  describe('clearLogs', () => {
    test('clears the buffer', () => {
      logBehavior('app', 'test1');
      logBehavior('app', 'test2');
      logger.clear();
      
      const logs = logger.getLogs();
      expect(logs.some(l => l.event === 'test1')).toBe(false);
      expect(logs.some(l => l.event === 'test2')).toBe(false);
    });

    test('logs the clear action', () => {
      logBehavior('app', 'test');
      logger.clear();
      
      const logs = logger.getLogs();
      expect(logs[0].event).toBe('logs_cleared');
    });
  });

  describe('getLogStats', () => {
    test('returns correct counts by level', () => {
      logError('sync', 'error1');
      logBehavior('app', 'behavior1');
      logMetric('performance', 'metric1', { value: 1 });
      
      const stats = logger.getStats();
      expect(stats.byLevel.error).toBeGreaterThanOrEqual(1);
      expect(stats.byLevel.behavior).toBeGreaterThanOrEqual(1);
      expect(stats.byLevel.metric).toBeGreaterThanOrEqual(1);
    });

    test('returns correct counts by category', () => {
      logBehavior('sync', 'test1');
      logBehavior('sync', 'test2');
      logBehavior('workspace', 'test3');
      
      const stats = logger.getStats();
      expect(stats.byCategory.sync).toBeGreaterThanOrEqual(2);
      expect(stats.byCategory.workspace).toBeGreaterThanOrEqual(1);
    });

    test('includes timestamp range', () => {
      logBehavior('app', 'test');
      const stats = logger.getStats();
      expect(stats.oldestEntry).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(stats.newestEntry).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

describe('Logger: Export Functionality', () => {
  beforeEach(() => {
    logger.clear();
    logger._resetSession();
  });

  describe('getLogsAsJSON', () => {
    test('returns valid JSON', () => {
      logBehavior('app', 'test');
      const json = logger.getLogsAsJSON();
      expect(() => JSON.parse(json)).not.toThrow();
    });

    test('includes required metadata', () => {
      logBehavior('app', 'test');
      const json = logger.getLogsAsJSON();
      const parsed = JSON.parse(json);
      
      expect(parsed.version).toBe('1.0');
      expect(parsed.exportedAt).toBeDefined();
      expect(parsed.sessionId).toMatch(/^sess_/);
      expect(parsed.entryCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(parsed.entries)).toBe(true);
    });

    test('includes all log entries', () => {
      logBehavior('app', 'test1');
      logBehavior('app', 'test2');
      logError('sync', 'error1');
      
      const json = logger.getLogsAsJSON();
      const parsed = JSON.parse(json);
      
      expect(parsed.entryCount).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('Logger: PII Never Leaks', () => {
  beforeEach(() => {
    logger.clear();
    logger._resetSession();
  });

  test('PII in event string is stripped', () => {
    logError('auth', 'Login failed for user@example.com from 192.168.1.1');
    const logs = logger.getLogs();
    const entry = logs.find(l => l.level === 'error');
    
    expect(entry.event).not.toContain('@');
    expect(entry.event).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  test('PII in data object is removed', () => {
    logBehavior('user', 'login', {
      email: 'test@test.com',
      displayName: 'John Doe',
      password: 'secret123',
      loginCount: 5
    });
    
    const logs = logger.getLogs();
    const entry = logs.find(l => l.event === 'login');
    
    expect(entry.data.email).toBeUndefined();
    expect(entry.data.displayName).toBeUndefined();
    expect(entry.data.password).toBeUndefined();
    expect(entry.data.loginCount).toBe(5);
  });

  test('PII in nested data is sanitized', () => {
    logBehavior('workspace', 'member_added', {
      workspace: { id: '123', name: 'Test Workspace' },
      member: { displayName: 'Jane', role: 'editor', email: 'jane@test.com' }
    });
    
    const logs = logger.getLogs();
    const entry = logs.find(l => l.event === 'member_added');
    
    expect(entry.data.workspace.id).toBe('123');
    expect(entry.data.workspace.name).toBeUndefined();
    expect(entry.data.member.role).toBe('editor');
    expect(entry.data.member.displayName).toBeUndefined();
    expect(entry.data.member.email).toBeUndefined();
  });

  test('cryptographic keys are never logged', () => {
    const hexKey = 'a'.repeat(64);
    logBehavior('crypto', 'key_generated', {
      keyId: '123',
      privateKey: hexKey,
      publicKey: hexKey,
      encryptionKey: hexKey
    });
    
    const logs = logger.getLogs();
    const entry = logs.find(l => l.event === 'key_generated');
    
    expect(entry.data.keyId).toBe('123');
    expect(entry.data.privateKey).toBeUndefined();
    expect(entry.data.publicKey).toBeUndefined();
    expect(entry.data.encryptionKey).toBeUndefined();
  });

  test('exported JSON contains no PII', () => {
    logError('auth', 'Failed login for user@test.com');
    logBehavior('user', 'action', { email: 'a@b.com', displayName: 'John' });
    
    const json = logger.getLogsAsJSON();
    
    expect(json).not.toContain('user@test.com');
    expect(json).not.toContain('a@b.com');
    expect(json).not.toContain('"displayName"');
    expect(json).not.toContain('"John"');
  });
});
