/**
 * Playwright Fixtures for E2E Testing
 */
const { test: base, expect } = require('@playwright/test');
const { env, PORTS } = require('../environment/orchestrator.js');
const { SidecarClient } = require('../helpers/sidecar-client.js');

const test = base.extend({
  unifiedServer1: [async ({}, use) => {
    console.log('[Fixture] Starting unified-1 server on port', PORTS.unified1);
    const server = await env.startUnifiedServer('unified-1', PORTS.unified1);
    console.log('[Fixture] unified-1 ready at', server.url);
    await use(server);
    console.log('[Fixture] unified-1 fixture teardown - stopping process');
    try {
      await server.process.stop();
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.log('[Fixture] unified-1 stop error:', e.message);
    }
  }, { scope: 'worker', timeout: 120000 }],

  unifiedServer2: [async ({}, use) => {
    const server = await env.startUnifiedServer('unified-2', PORTS.unified2);
    await use(server);
    console.log('[Fixture] unified-2 fixture teardown - stopping process');
    try {
      await server.process.stop();
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.log('[Fixture] unified-2 stop error:', e.message);
    }
  }, { scope: 'worker', timeout: 120000 }],

  electronSidecar1: [async ({}, use) => {
    console.log('[Fixture] Starting sidecar-1 on ports', JSON.stringify(PORTS.sidecar1));
    const startTime = Date.now();
    const sidecar = await env.startSidecar('sidecar-1', PORTS.sidecar1);
    console.log('[Fixture] sidecar-1 ready after', Date.now() - startTime, 'ms, metaUrl:', sidecar.metaUrl);
    await use(sidecar);
    console.log('[Fixture] sidecar-1 fixture teardown - stopping process');
    try {
      await sidecar.process.stop();
      // Give time for locks to release
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log('[Fixture] sidecar-1 stop error:', e.message);
    }
  }, { scope: 'worker', timeout: 120000 }],

  electronSidecar2: [async ({}, use) => {
    console.log('[Fixture] Starting sidecar-2 on ports', JSON.stringify(PORTS.sidecar2));
    const startTime = Date.now();
    const sidecar = await env.startSidecar('sidecar-2', PORTS.sidecar2);
    console.log('[Fixture] sidecar-2 ready after', Date.now() - startTime, 'ms, metaUrl:', sidecar.metaUrl);
    await use(sidecar);
    console.log('[Fixture] sidecar-2 fixture teardown - stopping process');
    try {
      await sidecar.process.stop();
      // Give time for locks to release
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log('[Fixture] sidecar-2 stop error:', e.message);
    }
  }, { scope: 'worker', timeout: 120000 }],

  sidecarClient1: async ({ electronSidecar1 }, use) => {
    console.log('[Fixture] Creating sidecarClient1 for', electronSidecar1.metaUrl);
    const client = new SidecarClient(electronSidecar1.metaUrl, 'client1');
    try {
      await client.connect();
      console.log('[Fixture] sidecarClient1 connected');
      await use(client);
    } finally {
      console.log('[Fixture] sidecarClient1 disconnecting');
      await client.disconnect();
    }
  },

  sidecarClient2: async ({ electronSidecar2 }, use) => {
    console.log('[Fixture] Creating sidecarClient2 for', electronSidecar2.metaUrl);
    // Add a delay before connecting to ensure the server is fully ready
    await new Promise(r => setTimeout(r, 5000));
    
    const client = new SidecarClient(electronSidecar2.metaUrl, 'client2');
    
    // Retry connection up to 3 times
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await client.connect();
        console.log('[Fixture] sidecarClient2 connected on attempt', attempt);
        break;
      } catch (err) {
        lastError = err;
        console.log(`[Fixture] sidecarClient2 connection attempt ${attempt} failed:`, err.message);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }
    
    if (!client.isConnected()) {
      throw lastError || new Error('sidecarClient2 failed to connect after 3 attempts');
    }
    
    try {
      await use(client);
    } finally {
      console.log('[Fixture] sidecarClient2 disconnecting');
      await client.disconnect();
    }
  },

  testLogs: async ({}, use) => {
    await use(env.logs);
  },

  webPage1: async ({ browser, unifiedServer1 }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(unifiedServer1.url);
    await use(page);
    await context.close();
  },

  webPage2: async ({ browser, unifiedServer2 }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(unifiedServer2.url);
    await use(page);
    await context.close();
  },

  collaboratorPages: async ({ browser, unifiedServer1 }, use) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    await page1.goto(unifiedServer1.url);
    await page2.goto(unifiedServer1.url);
    
    await use({ page1, page2, context1, context2 });
    
    await context1.close();
    await context2.close();
  },

  // 3-client fixture for mesh topology testing
  collaboratorPages3: async ({ browser, unifiedServer1 }, use) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const context3 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();
    
    await Promise.all([
      page1.goto(unifiedServer1.url),
      page2.goto(unifiedServer1.url),
      page3.goto(unifiedServer1.url)
    ]);
    
    await use({ 
      page1, page2, page3, 
      context1, context2, context3,
      pages: [page1, page2, page3],
      contexts: [context1, context2, context3]
    });
    
    await context1.close();
    await context2.close();
    await context3.close();
  },

  // Factory fixture for N clients
  collaboratorPagesFactory: async ({ browser, unifiedServer1 }, use) => {
    const contexts = [];
    const pages = [];
    
    const createClients = async (count) => {
      // Clean up any existing
      for (const ctx of contexts) {
        await ctx.close().catch(() => {});
      }
      contexts.length = 0;
      pages.length = 0;
      
      // Create new clients
      for (let i = 0; i < count; i++) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(unifiedServer1.url);
        contexts.push(context);
        pages.push(page);
      }
      
      return { pages, contexts };
    };
    
    await use({ createClients, pages, contexts });
    
    // Cleanup
    for (const ctx of contexts) {
      await ctx.close().catch(() => {});
    }
  }
});

async function globalSetup() {
  console.log('🚀 E2E Test Suite Starting...');
}

async function globalTeardown() {
  console.log('🧹 Cleaning up test environment...');
  await env.cleanup();
  console.log('✅ Cleanup complete');
}

module.exports = { test, expect, globalSetup, globalTeardown };
