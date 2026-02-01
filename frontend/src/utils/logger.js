/**
 * Unified Logging Layer
 * 
 * A comprehensive logging system that:
 * - Never logs PII (Personally Identifiable Information)
 * - Only logs errors and application behaviors
 * - Maintains an in-memory buffer for export
 * - Provides structured log entries with timestamps and categories
 * - Supports export to file for analysis
 * 
 * Usage:
 *   import logger from './logger';
 *   logger.error('sync', 'Failed to connect', { retryCount: 3 });
 *   logger.behavior('workspace', 'created');
 *   logger.export(); // Downloads log file
 */

// ============================================================
// PII Detection and Stripping
// ============================================================

/**
 * Patterns that indicate PII - these will be completely stripped
 */
const PII_PATTERNS = [
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
  
  // Phone numbers (various formats)
  /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  /\+\d{1,3}([-.\s]?\d{1,4}){2,5}/g,
  
  // IP addresses
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  
  // Names (common patterns in user fields)
  /displayName['":\s]+['"][^'"]+['"]/gi,
  /userName['":\s]+['"][^'"]+['"]/gi,
  /fullName['":\s]+['"][^'"]+['"]/gi,
  /firstName['":\s]+['"][^'"]+['"]/gi,
  /lastName['":\s]+['"][^'"]+['"]/gi,
  /handle['":\s]+['"][^'"]+['"]/gi,
  
  // Cryptographic material (keys, secrets, tokens)
  /\b[A-Fa-f0-9]{64}\b/g, // 32-byte hex keys
  /\b[A-Za-z0-9+/]{40,}[=]{0,2}\b/g, // Base64 keys (40+ chars with optional padding)
  /\b[A-Za-z0-9]{43,44}\b/g, // Base62 keys
  /(\w+ ){11,23}\w+/g, // Mnemonics (12-24 words)
  /privateKey['":\s]+[^,}\s]+/gi,
  /encryptionKey['":\s]+[^,}\s]+/gi,
  /sessionKey['":\s]+[^,}\s]+/gi,
  /secretKey['":\s]+[^,}\s]+/gi,
  /password['":\s]+[^,}\s]+/gi,
  /secret['":\s]+[^,}\s]+/gi,
  /token['":\s]+[^,}\s]+/gi,
  /mnemonic['":\s]+[^,}\s]+/gi,
  
  // URL fragments with sensitive data
  /p:[^&\s]+/g,
  /k:[^&\s]+/g,
  /sig:[^&\s]+/g,
  /by:[^&\s]+/g,
  
  // Public keys (still sensitive for privacy)
  /publicKey['":\s]+[^,}\s]+/gi,
  /publicKeyBase62['":\s]+[^,}\s]+/gi,
  
  // File paths that might contain usernames
  /\/Users\/[^/\s]+/g,
  /\/home\/[^/\s]+/g,
  /C:\\Users\\[^\\]+/gi,
];

/**
 * Fields to completely remove from objects (not just redact)
 */
const FORBIDDEN_FIELDS = new Set([
  'displayName', 'userName', 'fullName', 'firstName', 'lastName',
  'email', 'phone', 'address', 'handle', 'name',
  'privateKey', 'publicKey', 'publicKeyBase62', 'encryptionKey',
  'sessionKey', 'secretKey', 'mnemonic', 'password', 'secret',
  'token', 'signature', 'sig', 'apiKey', 'accessToken', 'refreshToken',
  'userAgent', 'ip', 'ipAddress', 'location', 'coordinates',
]);

/**
 * Strip all PII from a string
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string with PII removed
 */
export function stripPII(str) {
  if (typeof str !== 'string') return str;
  
  let result = str;
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern, '[STRIPPED]');
  }
  return result;
}

/**
 * Recursively sanitize an object, removing PII fields entirely
 * @param {any} obj - Object to sanitize
 * @param {number} depth - Current recursion depth
 * @returns {any} Sanitized object
 */
export function sanitizeObject(obj, depth = 0) {
  if (depth > 5) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    return stripPII(obj);
  }
  
  if (typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.slice(0, 10).map(item => sanitizeObject(item, depth + 1));
  }
  
  if (obj instanceof Error) {
    return {
      errorType: obj.constructor.name,
      message: stripPII(obj.message),
    };
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_FIELDS.has(key) || FORBIDDEN_FIELDS.has(lowerKey)) {
      continue;
    }
    sanitized[key] = sanitizeObject(value, depth + 1);
  }
  
  return sanitized;
}

// ============================================================
// Log Buffer
// ============================================================

const MAX_BUFFER_SIZE = 5000;
const logBuffer = [];
let sessionId = null;

/**
 * Generate an anonymous session ID (not linked to user identity)
 */
function getSessionId() {
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 15);
  }
  return sessionId;
}

/**
 * Add entry to log buffer
 * @param {Object} entry
 */
function addToBuffer(entry) {
  logBuffer.push(entry);
  
  if (logBuffer.length > MAX_BUFFER_SIZE) {
    logBuffer.splice(0, logBuffer.length - MAX_BUFFER_SIZE);
  }
}

// ============================================================
// Valid Categories (whitelist approach)
// ============================================================

const VALID_CATEGORIES = new Set([
  'app', 'init', 'startup', 'shutdown',
  'workspace', 'folder', 'document', 'entity',
  'sync', 'p2p', 'connection', 'peer', 'transport', 'websocket',
  'crypto', 'encryption', 'decryption', 'signing', 'verification',
  'identity', 'auth', 'permission', 'invite', 'kick', 'membership',
  'backup', 'restore', 'recovery',
  'ui', 'navigation', 'modal', 'editor',
  'storage', 'yjs', 'crdt', 'migration',
  'performance', 'metric', 'timing',
  'other',
]);

function validateCategory(category) {
  if (VALID_CATEGORIES.has(category)) {
    return category;
  }
  return 'other';
}

// ============================================================
// Logger Functions
// ============================================================

/**
 * Log an error (always recorded)
 * @param {string} category - Error category
 * @param {string} event - Error description
 * @param {Object} [data] - Additional context (will be sanitized)
 */
export function logError(category, event, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    category: validateCategory(category),
    event: stripPII(String(event)),
    data: sanitizeObject(data),
    sessionId: getSessionId(),
  };
  
  addToBuffer(entry);
  console.error(`[${entry.category}] ${entry.event}`, entry.data);
}

/**
 * Log a behavior/action (recorded for analysis)
 * @param {string} category - Behavior category
 * @param {string} event - Behavior description
 * @param {Object} [data] - Additional context (will be sanitized)
 */
export function logBehavior(category, event, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'behavior',
    category: validateCategory(category),
    event: stripPII(String(event)),
    data: sanitizeObject(data),
    sessionId: getSessionId(),
  };
  
  addToBuffer(entry);
}

/**
 * Log a metric/measurement
 * @param {string} category - Metric category
 * @param {string} event - Metric name
 * @param {Object} data - Metric data (numbers only, will be sanitized)
 */
export function logMetric(category, event, data = {}) {
  const numericData = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number' && !FORBIDDEN_FIELDS.has(key)) {
      numericData[key] = value;
    }
  }
  
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'metric',
    category: validateCategory(category),
    event: stripPII(String(event)),
    data: numericData,
    sessionId: getSessionId(),
  };
  
  addToBuffer(entry);
}

// ============================================================
// Export Functions
// ============================================================

/**
 * Get all logs as a JSON string
 * @returns {string} JSON string of all log entries
 */
export function getLogsAsJSON() {
  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    sessionId: getSessionId(),
    entryCount: logBuffer.length,
    entries: logBuffer,
  };
  
  return JSON.stringify(exportData, null, 2);
}

/**
 * Get logs as an array
 * @returns {Array} Array of log entries
 */
export function getLogs() {
  return [...logBuffer];
}

/**
 * Export logs to a downloadable file
 * @param {string} [filename] - Optional custom filename
 */
export function exportLogs(filename) {
  const json = getLogsAsJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const defaultFilename = `nightjar-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const downloadName = filename || defaultFilename;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  logBehavior('app', 'logs_exported', { entryCount: logBuffer.length });
}

/**
 * Export logs to a file (Node.js environment)
 * @param {string} filepath - Path to save the file
 */
export async function exportLogsToFile(filepath) {
  if (typeof require !== 'undefined') {
    const fs = require('fs').promises;
    const json = getLogsAsJSON();
    await fs.writeFile(filepath, json, 'utf-8');
    logBehavior('app', 'logs_exported_to_file', { entryCount: logBuffer.length });
  } else if (typeof window !== 'undefined' && window.__electron_fs__) {
    await window.__electron_fs__.writeFile(filepath, getLogsAsJSON());
    logBehavior('app', 'logs_exported_to_file', { entryCount: logBuffer.length });
  } else {
    throw new Error('exportLogsToFile is only available in Node.js or Electron environment');
  }
}

/**
 * Clear the log buffer
 */
export function clearLogs() {
  const count = logBuffer.length;
  logBuffer.length = 0;
  logBehavior('app', 'logs_cleared', { previousCount: count });
}

/**
 * Get log statistics
 * @returns {Object} Statistics about logged entries
 */
export function getLogStats() {
  const stats = {
    totalEntries: logBuffer.length,
    byLevel: { error: 0, behavior: 0, metric: 0 },
    byCategory: {},
    oldestEntry: logBuffer[0]?.timestamp || null,
    newestEntry: logBuffer[logBuffer.length - 1]?.timestamp || null,
  };
  
  for (const entry of logBuffer) {
    stats.byLevel[entry.level] = (stats.byLevel[entry.level] || 0) + 1;
    stats.byCategory[entry.category] = (stats.byCategory[entry.category] || 0) + 1;
  }
  
  return stats;
}

// ============================================================
// Default Export
// ============================================================

const logger = {
  error: logError,
  behavior: logBehavior,
  metric: logMetric,
  export: exportLogs,
  exportToFile: exportLogsToFile,
  getLogs,
  getLogsAsJSON,
  getStats: getLogStats,
  clear: clearLogs,
  sanitize: sanitizeObject,
  stripPII,
  _getBuffer: () => logBuffer,
  _resetSession: () => { sessionId = null; },
};

export default logger;
