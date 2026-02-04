/**
 * UPnP Port Mapping
 * Automatically forwards ports through the router for external access
 */

// OPTIMIZATION: Lazy-load nat-api since it probes the network at load time (25+ seconds!)
let NatAPI = null;
let natAPI = null;

function ensureNatAPI() {
  if (natAPI) return natAPI;
  if (!NatAPI) {
    NatAPI = require('nat-api');
  }
  natAPI = new NatAPI({ ttl: 0 });
  return natAPI;
}

/**
 * Request port mapping via UPnP
 * @param {number} port - Port to map
 * @param {string} description - Description for the mapping
 * @returns {Promise<{success: boolean, externalPort: number|null, error: string|null}>}
 */
async function mapPort(port, description = 'Nightjar P2P') {
  return new Promise((resolve) => {
    ensureNatAPI();
    natAPI.map(port, port, (err) => {
      if (err) {
        console.warn(`[UPnP] ✗ Port ${port} mapping failed: ${err.message}`);
        resolve({
          success: false,
          externalPort: null,
          error: err.message
        });
      } else {
        console.log(`[UPnP] ✓ Port ${port} mapped successfully`);
        resolve({
          success: true,
          externalPort: port,
          error: null
        });
      }
    });
  });
}

/**
 * Remove port mapping
 * @param {number} port - Port to unmap
 * @returns {Promise<boolean>}
 */
async function unmapPort(port) {
  return new Promise((resolve) => {
    ensureNatAPI();
    natAPI.unmap(port, port, (err) => {
      if (err) {
        console.warn(`[UPnP] Failed to unmap port ${port}:`, err.message);
        resolve(false);
      } else {
        console.log(`[UPnP] Port ${port} unmapped`);
        resolve(true);
      }
    });
  });
}

/**
 * Get external IP via UPnP
 * @returns {Promise<string|null>}
 */
async function getExternalIP() {
  return new Promise((resolve) => {
    ensureNatAPI();
    natAPI.externalIp((err, ip) => {
      if (err) {
        console.warn('[UPnP] Failed to get external IP:', err.message);
        resolve(null);
      } else {
        console.log('[UPnP] External IP:', ip);
        resolve(ip);
      }
    });
  });
}

module.exports = {
  mapPort,
  unmapPort,
  getExternalIP
};
