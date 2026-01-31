/**
 * UPnP Manager for Nightjar Electron App
 * 
 * Handles UPnP port mapping to make the local relay server
 * accessible from the internet. This enables peer-to-peer
 * connections without requiring manual port forwarding.
 * 
 * Features:
 * - Automatic port mapping via UPnP
 * - External IP discovery
 * - Graceful fallback with user guidance
 * - Periodic mapping renewal
 */

import natUpnp from 'nat-upnp';

// Default configuration
const DEFAULT_INTERNAL_PORT = 4445; // Local relay server port
const DEFAULT_EXTERNAL_PORT = 4445; // Requested external port
const MAPPING_TTL = 3600; // 1 hour TTL for port mapping
const RENEWAL_INTERVAL = 2700000; // Renew every 45 minutes (ms)

class UPnPManager {
  constructor(options = {}) {
    this.client = null;
    this.internalPort = options.internalPort || DEFAULT_INTERNAL_PORT;
    this.externalPort = options.externalPort || DEFAULT_EXTERNAL_PORT;
    this.description = options.description || 'Nightjar P2P Relay';
    
    // State
    this.isEnabled = false;
    this.isMapped = false;
    this.externalIp = null;
    this.externalAddress = null; // "ip:port" string for sharing
    this.renewalTimer = null;
    this.lastError = null;
    
    // Callbacks
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onError = options.onError || ((err) => console.error('[UPnP]', err));
  }

  /**
   * Initialize and attempt port mapping
   * @returns {Promise<{success: boolean, address: string|null, error: string|null}>}
   */
  async start() {
    if (this.isEnabled) {
      return { success: true, address: this.externalAddress };
    }

    console.log('[UPnP] Starting port mapping...');
    this.client = natUpnp.createClient();
    
    try {
      // First, discover external IP
      this.externalIp = await this._getExternalIp();
      console.log('[UPnP] External IP:', this.externalIp);
      
      // Create port mapping
      await this._createMapping();
      
      this.isMapped = true;
      this.isEnabled = true;
      this.externalAddress = `${this.externalIp}:${this.externalPort}`;
      this.lastError = null;
      
      // Set up periodic renewal
      this._startRenewal();
      
      this.onStatusChange({
        status: 'active',
        address: this.externalAddress,
        externalIp: this.externalIp,
        externalPort: this.externalPort,
      });
      
      console.log('[UPnP] Port mapping successful:', this.externalAddress);
      return { success: true, address: this.externalAddress };
      
    } catch (error) {
      this.lastError = error.message;
      this.isMapped = false;
      
      this.onStatusChange({
        status: 'failed',
        error: error.message,
        guide: this._getManualSetupGuide(),
      });
      
      this.onError(error);
      console.error('[UPnP] Port mapping failed:', error.message);
      return { success: false, address: null, error: error.message };
    }
  }

  /**
   * Stop port mapping and cleanup
   */
  async stop() {
    if (!this.isEnabled) return;
    
    console.log('[UPnP] Stopping port mapping...');
    
    // Stop renewal timer
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }
    
    // Remove port mapping
    if (this.isMapped && this.client) {
      try {
        await this._removeMapping();
        console.log('[UPnP] Port mapping removed');
      } catch (error) {
        console.warn('[UPnP] Failed to remove mapping:', error.message);
      }
    }
    
    // Close client
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    
    this.isEnabled = false;
    this.isMapped = false;
    this.externalAddress = null;
    
    this.onStatusChange({ status: 'stopped' });
  }

  /**
   * Get current status
   * @returns {Object}
   */
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      isMapped: this.isMapped,
      externalAddress: this.externalAddress,
      externalIp: this.externalIp,
      externalPort: this.externalPort,
      internalPort: this.internalPort,
      lastError: this.lastError,
    };
  }

  /**
   * Get the external address for sharing in invite links
   * @returns {string|null}
   */
  getExternalAddress() {
    return this.externalAddress;
  }

  // ==========================================================================
  // Private methods
  // ==========================================================================

  /**
   * Get external IP address via UPnP
   */
  _getExternalIp() {
    return new Promise((resolve, reject) => {
      this.client.externalIp((err, ip) => {
        if (err) {
          reject(new Error(`Failed to get external IP: ${err.message}`));
        } else {
          resolve(ip);
        }
      });
    });
  }

  /**
   * Create port mapping
   */
  _createMapping() {
    return new Promise((resolve, reject) => {
      this.client.portMapping({
        public: this.externalPort,
        private: this.internalPort,
        ttl: MAPPING_TTL,
        description: this.description,
        protocol: 'TCP',
      }, (err) => {
        if (err) {
          reject(new Error(`Failed to create port mapping: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Remove port mapping
   */
  _removeMapping() {
    return new Promise((resolve, reject) => {
      this.client.portUnmapping({
        public: this.externalPort,
        protocol: 'TCP',
      }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Start periodic renewal of port mapping
   */
  _startRenewal() {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
    }
    
    this.renewalTimer = setInterval(async () => {
      try {
        console.log('[UPnP] Renewing port mapping...');
        await this._createMapping();
        console.log('[UPnP] Port mapping renewed');
      } catch (error) {
        console.error('[UPnP] Failed to renew mapping:', error.message);
        this.lastError = error.message;
        this.onError(error);
      }
    }, RENEWAL_INTERVAL);
  }

  /**
   * Get manual setup guide for when UPnP fails
   */
  _getManualSetupGuide() {
    return {
      title: 'Manual Port Forwarding Required',
      steps: [
        `Open your router's admin page (usually 192.168.1.1 or 192.168.0.1)`,
        `Find "Port Forwarding" or "NAT" settings`,
        `Add a new port forward rule:`,
        `  - External Port: ${this.externalPort}`,
        `  - Internal Port: ${this.internalPort}`,
        `  - Protocol: TCP`,
        `  - Internal IP: Your computer's local IP address`,
        `Save and apply the settings`,
      ],
      note: 'After setting up port forwarding, restart Nightjar to enable relay mode.',
    };
  }
}

// Export singleton instance and class
let instance = null;

export function getUPnPManager(options) {
  if (!instance) {
    instance = new UPnPManager(options);
  }
  return instance;
}

export { UPnPManager };
export default UPnPManager;
