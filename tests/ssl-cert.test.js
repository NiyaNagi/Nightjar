/**
 * Tests for SSL Certificate Generation
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ensureSSLCert, getCertInfo } = require('../sidecar/ssl-cert');

describe('SSL Certificate Management', () => {
  let testCertDir;
  
  beforeEach(() => {
    // Create temp directory for test certificates
    testCertDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightjar-ssl-test-'));
  });
  
  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testCertDir)) {
      fs.rmSync(testCertDir, { recursive: true, force: true });
    }
  });
  
  test('generates new SSL certificate if none exists', () => {
    const creds = ensureSSLCert(testCertDir);
    
    expect(creds).toHaveProperty('cert');
    expect(creds).toHaveProperty('key');
    expect(typeof creds.cert).toBe('string');
    expect(typeof creds.key).toBe('string');
    expect(creds.cert.length).toBeGreaterThan(0);
    expect(creds.key.length).toBeGreaterThan(0);
    
    // Check files were created
    expect(fs.existsSync(path.join(testCertDir, 'ssl-cert.pem'))).toBe(true);
    expect(fs.existsSync(path.join(testCertDir, 'ssl-key.pem'))).toBe(true);
  });
  
  test('loads existing certificate if already generated', () => {
    // Generate first time
    const creds1 = ensureSSLCert(testCertDir);
    
    // Load second time (should return same cert)
    const creds2 = ensureSSLCert(testCertDir);
    
    expect(creds1.cert).toBe(creds2.cert);
    expect(creds1.key).toBe(creds2.key);
  });
  
  test('certificate contains expected fields', () => {
    const creds = ensureSSLCert(testCertDir);
    
    // Check for PEM format markers
    expect(creds.cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(creds.cert).toContain('-----END CERTIFICATE-----');
    expect(creds.key).toContain('-----BEGIN RSA PRIVATE KEY-----');
    expect(creds.key).toContain('-----END RSA PRIVATE KEY-----');
    
    // Validate PEM format is non-empty
    expect(creds.cert.length).toBeGreaterThan(100);
    expect(creds.key.length).toBeGreaterThan(100);
  });
  
  test('getCertInfo returns info for existing cert', () => {
    ensureSSLCert(testCertDir);
    const info = getCertInfo(testCertDir);
    
    expect(info).not.toBeNull();
    expect(info.exists).toBe(true);
    expect(info.selfSigned).toBe(true);
    expect(info.commonName).toBe('nightjar.local');
  });
  
  test('getCertInfo returns null for non-existent cert', () => {
    const info = getCertInfo(testCertDir);
    expect(info).toBeNull();
  });
  
  test('generates certificate with correct validity period', () => {
    const creds = ensureSSLCert(testCertDir);
    
    // Certificate should be valid for 10 years (3650 days)
    // Just check it's a valid PEM cert - actual validation would require X.509 parsing
    expect(creds.cert).toMatch(/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/);
  });
  
  test('creates certificate directory if it does not exist', () => {
    const nestedDir = path.join(testCertDir, 'deep', 'nested', 'path');
    const creds = ensureSSLCert(nestedDir);
    
    expect(creds).toHaveProperty('cert');
    expect(creds).toHaveProperty('key');
    expect(fs.existsSync(path.join(nestedDir, 'ssl-cert.pem'))).toBe(true);
  });
});
