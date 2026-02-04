/**
 * Tests for UPnP Port Mapping
 * Note: These tests mock the nat-api module since actual UPnP tests require router hardware
 */

const { mapPort, unmapPort, getExternalIP } = require('../sidecar/upnp-mapper');

// Mock nat-api module
jest.mock('nat-api', () => ({
  map: jest.fn(),
  unmap: jest.fn(),
  externalIp: jest.fn()
}));

const natAPI = require('nat-api');

describe('UPnP Port Mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('mapPort', () => {
    test('successfully maps port when UPnP is available', async () => {
      natAPI.map.mockResolvedValue(8080);
      
      const result = await mapPort(8080, 'Test Service');
      
      expect(result.success).toBe(true);
      expect(result.externalPort).toBe(8080);
      expect(result.error).toBeNull();
      expect(natAPI.map).toHaveBeenCalledWith({
        publicPort: 8080,
        privatePort: 8080,
        ttl: 0,
        description: 'Test Service'
      });
    });
    
    test('returns failure when UPnP is not available', async () => {
      natAPI.map.mockRejectedValue(new Error('UPnP not supported'));
      
      const result = await mapPort(8080);
      
      expect(result.success).toBe(false);
      expect(result.externalPort).toBeNull();
      expect(result.error).toBe('UPnP not supported');
    });
    
    test('uses default description if not provided', async () => {
      natAPI.map.mockResolvedValue(9000);
      
      await mapPort(9000);
      
      expect(natAPI.map).toHaveBeenCalledWith(expect.objectContaining({
        description: 'Nightjar P2P'
      }));
    });
  });
  
  describe('unmapPort', () => {
    test('successfully unmaps port', async () => {
      natAPI.unmap.mockResolvedValue(true);
      
      const result = await unmapPort(8080);
      
      expect(result).toBe(true);
      expect(natAPI.unmap).toHaveBeenCalledWith({
        publicPort: 8080,
        privatePort: 8080
      });
    });
    
    test('returns false on unmap failure', async () => {
      natAPI.unmap.mockRejectedValue(new Error('Failed to unmap'));
      
      const result = await unmapPort(8080);
      
      expect(result).toBe(false);
    });
  });
  
  describe('getExternalIP', () => {
    test('returns external IP when UPnP is available', async () => {
      natAPI.externalIp.mockResolvedValue('203.0.113.42');
      
      const ip = await getExternalIP();
      
      expect(ip).toBe('203.0.113.42');
      expect(natAPI.externalIp).toHaveBeenCalled();
    });
    
    test('returns null when external IP cannot be determined', async () => {
      natAPI.externalIp.mockRejectedValue(new Error('No UPnP gateway'));
      
      const ip = await getExternalIP();
      
      expect(ip).toBeNull();
    });
  });
  
  describe('Integration scenarios', () => {
    test('typical startup sequence - map both WS and WSS ports', async () => {
      natAPI.map.mockResolvedValue(8080).mockResolvedValueOnce(8443);
      natAPI.externalIp.mockResolvedValue('198.51.100.10');
      
      const externalIP = await getExternalIP();
      const wsResult = await mapPort(8080, 'Nightjar WS');
      const wssResult = await mapPort(8443, 'Nightjar WSS');
      
      expect(externalIP).toBe('198.51.100.10');
      expect(wsResult.success).toBe(true);
      expect(wssResult.success).toBe(true);
    });
    
    test('graceful degradation when UPnP unavailable', async () => {
      natAPI.externalIp.mockRejectedValue(new Error('No UPnP'));
      natAPI.map.mockRejectedValue(new Error('No UPnP'));
      
      const externalIP = await getExternalIP();
      const wsResult = await mapPort(8080);
      
      expect(externalIP).toBeNull();
      expect(wsResult.success).toBe(false);
      // Application should continue without UPnP
    });
  });
});
