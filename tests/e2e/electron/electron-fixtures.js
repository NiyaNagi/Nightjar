/**
 * Electron E2E Test Fixtures for Playwright
 * 
 * Provides fixtures for launching isolated Electron instances
 * with various network configurations.
 */
const { test: base } = require('@playwright/test');
const { launchElectron, launchTestRelay, closeAll, NETWORK_MODE } = require('./electron-launcher.js');
const { StateInspector, injectStateHooks } = require('./state-inspector.js');
const { SidecarClient } = require('../helpers/sidecar-client.js');

/**
 * Extended test with Electron fixtures
 */
const test = base.extend({
  /**
   * Test relay server - shared across worker
   * All Electron instances can connect through this relay
   */
  testRelay: [async ({}, use) => {
    console.log('[Fixture] Starting test relay server...');
    const relay = await launchTestRelay({ port: 3100 });
    console.log('[Fixture] Test relay ready at', relay.relayUrl);
    
    await use(relay);
    
    console.log('[Fixture] Stopping test relay...');
    try {
      await relay.process.stop();
    } catch (e) {
      console.warn('[Fixture] Error stopping relay:', e.message);
    }
  }, { scope: 'worker', timeout: 120000 }],
  
  /**
   * Second test relay - for cross-relay testing
   */
  testRelay2: [async ({}, use) => {
    console.log('[Fixture] Starting second test relay server...');
    const relay = await launchTestRelay({ port: 3101, name: 'test-relay-2' });
    console.log('[Fixture] Test relay 2 ready at', relay.relayUrl);
    
    await use(relay);
    
    console.log('[Fixture] Stopping test relay 2...');
    try {
      await relay.process.stop();
    } catch (e) {
      console.warn('[Fixture] Error stopping relay 2:', e.message);
    }
  }, { scope: 'worker', timeout: 120000 }],
  
  /**
   * First Electron instance - uses relay mode by default
   */
  electronApp1: [async ({ testRelay }, use) => {
    console.log('[Fixture] Launching Electron instance 1...');
    const electron = await launchElectron({
      name: 'electron-1',
      networkMode: NETWORK_MODE.RELAY,
      relayUrl: testRelay.relayUrl,
    });
    console.log('[Fixture] Electron 1 ready');
    
    await use(electron);
    
    console.log('[Fixture] Closing Electron 1...');
    await electron.close();
  }, { scope: 'test', timeout: 180000 }],
  
  /**
   * Second Electron instance - uses same relay
   */
  electronApp2: [async ({ testRelay }, use) => {
    console.log('[Fixture] Launching Electron instance 2...');
    const electron = await launchElectron({
      name: 'electron-2',
      networkMode: NETWORK_MODE.RELAY,
      relayUrl: testRelay.relayUrl,
    });
    console.log('[Fixture] Electron 2 ready');
    
    await use(electron);
    
    console.log('[Fixture] Closing Electron 2...');
    await electron.close();
  }, { scope: 'test', timeout: 180000 }],
  
  /**
   * Electron instance with DHT enabled - for real network testing
   */
  electronAppDHT1: [async ({}, use) => {
    console.log('[Fixture] Launching Electron with DHT 1...');
    const electron = await launchElectron({
      name: 'electron-dht-1',
      networkMode: NETWORK_MODE.DHT,
      meshEnabled: true,
    });
    console.log('[Fixture] Electron DHT 1 ready');
    
    await use(electron);
    
    console.log('[Fixture] Closing Electron DHT 1...');
    await electron.close();
  }, { scope: 'test', timeout: 180000 }],
  
  /**
   * Second Electron with DHT
   */
  electronAppDHT2: [async ({}, use) => {
    console.log('[Fixture] Launching Electron with DHT 2...');
    const electron = await launchElectron({
      name: 'electron-dht-2',
      networkMode: NETWORK_MODE.DHT,
      meshEnabled: true,
    });
    console.log('[Fixture] Electron DHT 2 ready');
    
    await use(electron);
    
    console.log('[Fixture] Closing Electron DHT 2...');
    await electron.close();
  }, { scope: 'test', timeout: 180000 }],
  
  /**
   * Sidecar client connected to Electron 1
   */
  sidecar1: async ({ electronApp1 }, use) => {
    console.log('[Fixture] Connecting sidecar client to Electron 1...');
    const client = new SidecarClient(electronApp1.metaUrl, 'electron-1');
    await client.connect();
    console.log('[Fixture] Sidecar 1 connected');
    
    await use(client);
    
    console.log('[Fixture] Disconnecting sidecar 1...');
    await client.disconnect();
  },
  
  /**
   * Sidecar client connected to Electron 2
   */
  sidecar2: async ({ electronApp2 }, use) => {
    console.log('[Fixture] Connecting sidecar client to Electron 2...');
    const client = new SidecarClient(electronApp2.metaUrl, 'electron-2');
    await client.connect();
    console.log('[Fixture] Sidecar 2 connected');
    
    await use(client);
    
    console.log('[Fixture] Disconnecting sidecar 2...');
    await client.disconnect();
  },
  
  /**
   * State inspector for tracking and comparing client state
   */
  stateInspector: async ({}, use) => {
    const inspector = new StateInspector();
    await use(inspector);
    
    // Export state on teardown for debugging
    const state = inspector.exportState();
    if (state.timeline.some(e => e.category === 'error')) {
      console.log('[StateInspector] Errors detected, dumping state...');
      console.log(JSON.stringify(state, null, 2));
    }
  },
});

/**
 * Extended expect with custom matchers
 */
const { expect } = require('@playwright/test');

module.exports = {
  test,
  expect,
  NETWORK_MODE,
};
