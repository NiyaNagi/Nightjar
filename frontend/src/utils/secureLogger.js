/**
 * Secure Logger Utility
 * 
 * Provides logging functions that automatically redact sensitive data
 * to prevent accidental exposure of keys, passwords, and other secrets.
 * 
 * In production, logging can be disabled entirely.
 */

// Patterns to detect and redact sensitive data
const SENSITIVE_PATTERNS = [
  // Encryption keys (32 bytes = 64 hex chars, or base64/base62 encoded)
  { pattern: /\b[A-Fa-f0-9]{64}\b/g, replacement: '[REDACTED_KEY_HEX]' },
  { pattern: /\b[A-Za-z0-9+/=]{43,44}\b/g, replacement: '[REDACTED_KEY_B64]' },
  
  // Mnemonics (typically 12-24 words)
  { pattern: /\b([a-z]{2,8} ){11,23}[a-z]{2,8}\b/g, replacement: '[REDACTED_MNEMONIC]' },
  
  // Private keys in various formats
  { pattern: /privateKey['":\s]+['"A-Za-z0-9+/=]+/gi, replacement: 'privateKey: [REDACTED]' },
  { pattern: /encryptionKey['":\s]+['"A-Za-z0-9+/=]+/gi, replacement: 'encryptionKey: [REDACTED]' },
  { pattern: /sessionKey['":\s]+['"A-Za-z0-9+/=]+/gi, replacement: 'sessionKey: [REDACTED]' },
  
  // Password patterns
  { pattern: /password['":\s]+['"A-Za-z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?/~`]+/gi, replacement: 'password: [REDACTED]' },
  { pattern: /p:[^&\s]+/g, replacement: 'p:[REDACTED]' },  // URL fragment password
  { pattern: /k:[^&\s]+/g, replacement: 'k:[REDACTED]' },  // URL fragment key
  
  // Secret/token patterns
  { pattern: /secret['":\s]+['"A-Za-z0-9+/=]+/gi, replacement: 'secret: [REDACTED]' },
  { pattern: /token['":\s]+['"A-Za-z0-9+/=]+/gi, replacement: 'token: [REDACTED]' },
];

// Check if we're in production mode
const isProduction = () => {
  try {
    // Check for common production indicators
    // Note: import.meta.env is Vite-specific and may not work in all environments
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      return true;
    }
    // Check window-based env (set by build process)
    if (typeof window !== 'undefined' && window.__Nightjar_ENV__ === 'production') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

// Whether logging is enabled
let loggingEnabled = !isProduction();

/**
 * Enable or disable logging globally
 * @param {boolean} enabled 
 */
export function setLoggingEnabled(enabled) {
  loggingEnabled = enabled;
}

/**
 * Redact sensitive information from a string
 * @param {string} str - String to redact
 * @returns {string} Redacted string
 */
export function redactSensitive(str) {
  if (typeof str !== 'string') {
    try {
      str = JSON.stringify(str);
    } catch {
      str = String(str);
    }
  }
  
  let result = str;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Process arguments to redact sensitive data
 * @param {Array} args - Console arguments
 * @returns {Array} Redacted arguments
 */
function processArgs(args) {
  return args.map(arg => {
    if (typeof arg === 'string') {
      return redactSensitive(arg);
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        // Clone and redact object
        return JSON.parse(redactSensitive(JSON.stringify(arg)));
      } catch {
        return '[Object - could not redact]';
      }
    }
    return arg;
  });
}

/**
 * Secure console.log that redacts sensitive data
 */
export function secureLog(...args) {
  if (!loggingEnabled) return;
  console.log(...processArgs(args));
}

/**
 * Secure console.warn that redacts sensitive data
 */
export function secureWarn(...args) {
  if (!loggingEnabled) return;
  console.warn(...processArgs(args));
}

/**
 * Secure console.error that redacts sensitive data
 * Note: Errors are always logged even in production for debugging
 */
export function secureError(...args) {
  // Always log errors but redact sensitive data
  console.error(...processArgs(args));
}

/**
 * Secure console.debug that redacts sensitive data
 */
export function secureDebug(...args) {
  if (!loggingEnabled) return;
  console.debug(...processArgs(args));
}

/**
 * Secure console.info that redacts sensitive data
 */
export function secureInfo(...args) {
  if (!loggingEnabled) return;
  console.info(...processArgs(args));
}

// Default export with all functions
const secureLogger = {
  log: secureLog,
  warn: secureWarn,
  error: secureError,
  debug: secureDebug,
  info: secureInfo,
  setEnabled: setLoggingEnabled,
  redact: redactSensitive,
};

export default secureLogger;
