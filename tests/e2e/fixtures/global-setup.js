/**
 * Global Setup for E2E Tests
 */
const { env } = require('../environment/orchestrator.js');

module.exports = async function globalSetup() {
  console.log('🚀 E2E Test Suite - Global Setup');
  // Environment is initialized lazily when fixtures are used
};
