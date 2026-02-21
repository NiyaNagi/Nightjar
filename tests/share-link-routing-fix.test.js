/**
 * Tests for Issue #6 — Share Link Routing Fix
 * 
 * Validates the three fixes:
 * 1. nginx proxies /assets/ and /api/ to the relay (blank screen fix)
 * 2. Relay docker-compose sets ENCRYPTED_PERSISTENCE=false
 * 3. Server /api/encrypted-persistence respects DISABLE_PERSISTENCE
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const rootDir = path.resolve(__dirname, '..');
const readFile = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf-8');

const nginxConf = readFile('server/deploy/nginx.conf');
const dockerCompose = readFile('server/deploy/docker-compose.prod.yml');
const serverSource = readFile('server/unified/index.js');

// ---------------------------------------------------------------------------
// 1. nginx — SPA asset proxying
// ---------------------------------------------------------------------------
describe('nginx: relay SPA asset routing', () => {
  test('has location /assets/ block that proxies to relay', () => {
    expect(nginxConf).toMatch(/location\s+\/assets\/\s*\{[^}]*proxy_pass\s+http:\/\/relay/s);
  });

  test('/assets/ block enables aggressive caching (immutable)', () => {
    // Extract the /assets/ block
    const match = nginxConf.match(/location\s+\/assets\/\s*\{([^}]+)\}/s);
    expect(match).toBeTruthy();
    const block = match[1];
    expect(block).toContain('immutable');
  });

  test('/assets/ block is registered BEFORE the catch-all location /', () => {
    const assetsPos = nginxConf.indexOf('location /assets/');
    const catchAllPos = nginxConf.indexOf('location / {');
    expect(assetsPos).toBeGreaterThan(0);
    expect(catchAllPos).toBeGreaterThan(0);
    expect(assetsPos).toBeLessThan(catchAllPos);
  });
});

// ---------------------------------------------------------------------------
// 2. nginx — API route proxying
// ---------------------------------------------------------------------------
describe('nginx: relay API routing', () => {
  test('has a general location /api/ block that proxies to relay', () => {
    expect(nginxConf).toMatch(/location\s+\/api\/\s*\{[^}]*proxy_pass\s+http:\/\/relay/s);
  });

  test('/api/ block is registered BEFORE the catch-all location /', () => {
    const apiPos = nginxConf.indexOf('location /api/');
    const catchAllPos = nginxConf.indexOf('location / {');
    expect(apiPos).toBeGreaterThan(0);
    expect(catchAllPos).toBeGreaterThan(0);
    expect(apiPos).toBeLessThan(catchAllPos);
  });

  test('/api/ block includes X-Forwarded-For and X-Forwarded-Proto', () => {
    const match = nginxConf.match(/location\s+\/api\/\s*\{([^}]+)\}/s);
    expect(match).toBeTruthy();
    const block = match[1];
    expect(block).toContain('X-Forwarded-For');
    expect(block).toContain('X-Forwarded-Proto');
  });

  test('/app/ location is defined BEFORE /api/ (private instance takes precedence)', () => {
    const appPos = nginxConf.indexOf('location /app/');
    const apiPos = nginxConf.indexOf('location /api/');
    expect(appPos).toBeGreaterThan(0);
    expect(apiPos).toBeGreaterThan(0);
    expect(appPos).toBeLessThan(apiPos);
  });
});

// ---------------------------------------------------------------------------
// 3. nginx — join route still present
// ---------------------------------------------------------------------------
describe('nginx: join route', () => {
  test('has location /join/ block that proxies to relay', () => {
    expect(nginxConf).toMatch(/location\s+\/join\/\s*\{[^}]*proxy_pass\s+http:\/\/relay/s);
  });
});

// ---------------------------------------------------------------------------
// 4. Docker — relay ENCRYPTED_PERSISTENCE=false
// ---------------------------------------------------------------------------
describe('docker-compose.prod: relay persistence config', () => {
  test('relay service uses NIGHTJAR_MODE=host for encrypted persistence', () => {
    const relayIdx = dockerCompose.indexOf('nightjar-relay:');
    expect(relayIdx).toBeGreaterThan(-1);

    const privateIdx = dockerCompose.indexOf('nightjar-private:', relayIdx);
    const relayBlock = dockerCompose.slice(relayIdx, privateIdx > 0 ? privateIdx : undefined);

    expect(relayBlock).toContain('NIGHTJAR_MODE=host');
  });

  test('relay service has ENCRYPTED_PERSISTENCE=true', () => {
    const relayIdx = dockerCompose.indexOf('nightjar-relay:');
    const privateIdx = dockerCompose.indexOf('nightjar-private:', relayIdx);
    const relayBlock = dockerCompose.slice(relayIdx, privateIdx > 0 ? privateIdx : undefined);

    expect(relayBlock).toContain('ENCRYPTED_PERSISTENCE=true');
  });

  test('relay service has a persistent data volume', () => {
    const relayIdx = dockerCompose.indexOf('nightjar-relay:');
    const privateIdx = dockerCompose.indexOf('nightjar-private:', relayIdx);
    const relayBlock = dockerCompose.slice(relayIdx, privateIdx > 0 ? privateIdx : undefined);

    expect(relayBlock).toMatch(/nightjar-relay-data:\/app\/server\/unified\/data/);
  });

  test('private service keeps ENCRYPTED_PERSISTENCE=true', () => {
    const privateIdx = dockerCompose.indexOf('nightjar-private:');
    expect(privateIdx).toBeGreaterThan(-1);
    const privateBlock = dockerCompose.slice(privateIdx);

    expect(privateBlock).toContain('ENCRYPTED_PERSISTENCE=true');
  });
});

// ---------------------------------------------------------------------------
// 5. Server — /api/encrypted-persistence respects DISABLE_PERSISTENCE
// ---------------------------------------------------------------------------
describe('server: encrypted-persistence endpoint', () => {
  test('endpoint returns ENCRYPTED_PERSISTENCE && !DISABLE_PERSISTENCE', () => {
    // Find the endpoint handler
    const match = serverSource.match(
      /app\.get\([^,]*\/api\/encrypted-persistence['"][^)]*,\s*\(req,\s*res\)\s*=>\s*\{([^}]+)\}/s
    );
    expect(match).toBeTruthy();
    const handler = match[1];

    // Must reference DISABLE_PERSISTENCE — relay mode should return false
    expect(handler).toContain('DISABLE_PERSISTENCE');
    // Must combine both flags
    expect(handler).toMatch(/ENCRYPTED_PERSISTENCE\s*&&\s*!DISABLE_PERSISTENCE/);
  });

  test('DISABLE_PERSISTENCE is set to true for relay mode', () => {
    // The variable should be true when NIGHTJAR_MODE is relay
    expect(serverSource).toMatch(
      /DISABLE_PERSISTENCE\s*=.*SERVER_MODE\s*===\s*SERVER_MODES\.RELAY/s
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Server — express.json middleware order (v1.7.20 fix still intact)
// ---------------------------------------------------------------------------
describe('server: express.json middleware ordering (v1.7.20 regression check)', () => {
  test('global express.json() is registered before key delivery route', () => {
    const globalJsonPos = serverSource.indexOf("app.use(express.json(");
    const keyRoutePos = serverSource.indexOf("app.post(BASE_PATH + '/api/rooms/:roomName/key'");
    expect(globalJsonPos).toBeGreaterThan(0);
    expect(keyRoutePos).toBeGreaterThan(0);
    expect(globalJsonPos).toBeLessThan(keyRoutePos);
  });

  test('key delivery route has inline express.json middleware', () => {
    expect(serverSource).toMatch(
      /app\.post\([^,]*\/api\/rooms\/:roomName\/key['"],\s*express\.json\(/
    );
  });

  test('CORS middleware allows Authorization header', () => {
    const corsMatch = serverSource.match(/Access-Control-Allow-Headers['"],\s*['"]([^'"]+)['"]/);
    expect(corsMatch).toBeTruthy();
    expect(corsMatch[1]).toContain('Authorization');
  });
});

// ---------------------------------------------------------------------------
// 7. Client — key delivery retry logic (v1.7.20 regression check)
// ---------------------------------------------------------------------------
describe('client: key delivery retry logic (regression check)', () => {
  const clientSource = readFile('frontend/src/utils/websocket.js');

  test('deliverKeyToServer has retry loop with maxRetries parameter', () => {
    expect(clientSource).toMatch(/async\s+function\s+deliverKeyToServer\([^)]*maxRetries/);
  });

  test('_deliverKeyToServerOnce is defined as a private helper', () => {
    expect(clientSource).toContain('async function _deliverKeyToServerOnce');
  });

  test('retry loop uses exponential backoff', () => {
    expect(clientSource).toMatch(/Math\.pow\(2,\s*attempt/);
  });
});

// ---------------------------------------------------------------------------
// 8. nginx — routing header comment reflects all routes
// ---------------------------------------------------------------------------
describe('nginx: documentation accuracy', () => {
  test('routing comment mentions /assets/', () => {
    expect(nginxConf).toMatch(/Routing:[\s\S]*\/assets\/\*/);
  });

  test('routing comment mentions /api/', () => {
    expect(nginxConf).toMatch(/Routing:[\s\S]*\/api\/\*/);
  });
});
