/**
 * Global Teardown for E2E Tests
 */
const { env } = require('../environment/orchestrator.js');

module.exports = async function globalTeardown() {
  console.log('🧹 E2E Test Suite - Global Teardown');
  await env.cleanup();
  console.log('✅ Cleanup complete');
};
