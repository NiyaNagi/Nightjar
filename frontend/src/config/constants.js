/**
 * Application Constants
 * 
 * Centralized constants file for the Nightjar application.
 * Eliminates magic numbers and provides a single source of truth.
 */

// =============================================================================
// Port Constants
// =============================================================================

/**
 * Get sidecar ports from Electron preload if available, otherwise use defaults
 * This allows tests to run with custom ports
 */
function getSidecarPorts() {
  if (typeof window !== 'undefined' && window.electronAPI?.sidecarPorts) {
    return window.electronAPI.sidecarPorts;
  }
  return { yjs: 8080, meta: 8081 };
}

// Cache the ports at module load time
const _cachedPorts = getSidecarPorts();

/**
 * WebSocket port for Yjs document sync (plain WS)
 * Can be overridden via Electron environment for testing
 */
export const YJS_WS_PORT = _cachedPorts.yjs;

/**
 * WebSocket port for Yjs document sync (secure WSS)
 */
export const YJS_WSS_PORT = 8443;

/**
 * WebSocket port for metadata/command sync
 * Can be overridden via Electron environment for testing
 */
export const META_WS_PORT = _cachedPorts.meta;

/**
 * Default port for web server
 */
export const WEB_SERVER_PORT = 3000;

/**
 * Default port for Tor control
 */
export const TOR_CONTROL_PORT = 9051;

/**
 * Default port for P2P libp2p
 */
export const P2P_PORT = 4001;

// =============================================================================
// Timeout Constants (in milliseconds)
// =============================================================================

/**
 * Short timeout for quick operations
 */
export const TIMEOUT_SHORT = 1000;

/**
 * Default timeout for most operations
 */
export const TIMEOUT_DEFAULT = 5000;

/**
 * Long timeout for slow operations
 */
export const TIMEOUT_LONG = 30000;

/**
 * Extended timeout for very slow operations
 */
export const TIMEOUT_EXTENDED = 60000;

/**
 * WebSocket reconnection base delay
 */
export const WS_RECONNECT_DELAY = 1000;

/**
 * WebSocket reconnection max delay
 */
export const WS_RECONNECT_MAX_DELAY = 30000;

/**
 * Debounce delay for editor changes
 */
export const EDITOR_DEBOUNCE_DELAY = 300;

/**
 * Autosave interval
 */
export const AUTOSAVE_INTERVAL = 5000;

// =============================================================================
// Size Constants
// =============================================================================

/**
 * Maximum message size for WebSocket (10MB)
 */
export const MAX_MESSAGE_SIZE = 10 * 1024 * 1024;

/**
 * Maximum content size for documents (50MB)
 */
export const MAX_CONTENT_SIZE = 50 * 1024 * 1024;

/**
 * Maximum ID length
 */
export const MAX_ID_LENGTH = 256;

/**
 * Maximum name length
 */
export const MAX_NAME_LENGTH = 1024;

// =============================================================================
// Rate Limiting Constants
// =============================================================================

/**
 * Rate limit window in milliseconds
 */
export const RATE_LIMIT_WINDOW_MS = 1000;

/**
 * Maximum requests per rate limit window
 */
export const RATE_LIMIT_MAX_REQUESTS = 100;

/**
 * Burst limit for rate limiting
 */
export const RATE_LIMIT_BURST = 150;

// =============================================================================
// Identity/Security Constants
// =============================================================================

/**
 * Maximum PIN attempts before lockout
 */
export const MAX_PIN_ATTEMPTS = 10;

/**
 * PIN length requirement
 */
export const PIN_LENGTH = 6;

/**
 * Session lock timeout in minutes
 */
export const DEFAULT_LOCK_TIMEOUT_MINUTES = 15;

/**
 * PIN attempt reset time in hours
 */
export const ATTEMPT_RESET_HOURS = 1;

// =============================================================================
// Default Export (for convenient importing)
// =============================================================================

export default {
  // Ports
  YJS_WS_PORT,
  YJS_WSS_PORT,
  META_WS_PORT,
  WEB_SERVER_PORT,
  TOR_CONTROL_PORT,
  P2P_PORT,
  
  // Timeouts
  TIMEOUT_SHORT,
  TIMEOUT_DEFAULT,
  TIMEOUT_LONG,
  TIMEOUT_EXTENDED,
  WS_RECONNECT_DELAY,
  WS_RECONNECT_MAX_DELAY,
  EDITOR_DEBOUNCE_DELAY,
  AUTOSAVE_INTERVAL,
  
  // Sizes
  MAX_MESSAGE_SIZE,
  MAX_CONTENT_SIZE,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_BURST,
  
  // Identity/Security
  MAX_PIN_ATTEMPTS,
  PIN_LENGTH,
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  ATTEMPT_RESET_HOURS,
};
