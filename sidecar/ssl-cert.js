/**
 * SSL Certificate Management
 * Auto-generates self-signed certificates for WSS (secure WebSocket) support
 * 
 * TODO: Add Let's Encrypt support for production deployments
 */

const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

/**
 * Ensure SSL certificate exists, generate if needed
 * @param {string} certDir - Directory to store certificates
 * @returns {Object} { cert: string, key: string }
 */
function ensureSSLCert(certDir) {
  const certPath = path.join(certDir, 'ssl-cert.pem');
  const keyPath = path.join(certDir, 'ssl-key.pem');
  
  // Check if certificates already exist
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    console.log('[SSL] Loading existing certificate');
    try {
      return {
        cert: fs.readFileSync(certPath, 'utf8'),
        key: fs.readFileSync(keyPath, 'utf8')
      };
    } catch (err) {
      console.warn('[SSL] Failed to read existing certificate, regenerating:', err.message);
    }
  }
  
  // Generate new self-signed certificate
  console.log('[SSL] Generating self-signed SSL certificate...');
  console.log('[SSL] TODO: Replace with Let\'s Encrypt for production');
  
  try {
    // Generate RSA key pair
    const keys = forge.pki.rsa.generateKeyPair(2048);
    
    // Create certificate
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10); // 10 years
    
    // Subject attributes
    const attrs = [
      { name: 'commonName', value: 'nightjar.local' },
      { name: 'countryName', value: 'US' },
      { shortName: 'ST', value: 'Internet' },
      { name: 'localityName', value: 'Mesh' },
      { name: 'organizationName', value: 'Nightjar P2P' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs); // Self-signed
    
    // Add subjectAltName extension
    cert.setExtensions([
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 2, value: '*.local' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: '::1' }
        ]
      },
      {
        name: 'basicConstraints',
        cA: false
      }
    ]);
    
    // Self-sign certificate
    cert.sign(keys.privateKey, forge.md.sha256.create());
    
    // Convert to PEM format
    const pemCert = forge.pki.certificateToPem(cert);
    const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
    
    // Ensure directory exists
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true });
    }
    
    // Save to disk
    fs.writeFileSync(certPath, pemCert, 'utf8');
    fs.writeFileSync(keyPath, pemKey, 'utf8');
    
    console.log('[SSL] ✓ Self-signed certificate generated');
    console.log('[SSL] Certificate path:', certPath);
    console.log('[SSL] Note: Browsers will show security warning for self-signed certificates');
    
    return {
      cert: pemCert,
      key: pemKey
    };
  } catch (err) {
    console.error('[SSL] Failed to generate certificate:', err);
    throw err;
  }
}

/**
 * Get certificate info (for debugging/UI display)
 * @param {string} certDir - Directory containing certificates
 * @returns {Object|null} Certificate info or null if not found
 */
function getCertInfo(certDir) {
  const certPath = path.join(certDir, 'ssl-cert.pem');
  
  if (!fs.existsSync(certPath)) {
    return null;
  }
  
  try {
    const certPem = fs.readFileSync(certPath, 'utf8');
    // PEM is base64-encoded DER, so plain-text regex for CN= can never match.
    // Use node-forge to parse the certificate properly.
    let commonName = 'nightjar.local';
    try {
      const certObj = forge.pki.certificateFromPem(certPem);
      const cnField = certObj.subject.getField('CN');
      if (cnField && cnField.value) {
        commonName = cnField.value;
      }
    } catch (parseErr) {
      // Fall back to default if parsing fails
    }
    
    return {
      exists: true,
      path: certPath,
      commonName,
      selfSigned: true
    };
  } catch (err) {
    console.warn('[SSL] Failed to read certificate info:', err.message);
    return { exists: true, error: err.message };
  }
}

module.exports = {
  ensureSSLCert,
  getCertInfo
};
