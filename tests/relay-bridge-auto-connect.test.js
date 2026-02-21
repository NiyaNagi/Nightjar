/**
 * Tests for v1.7.22 — Relay Bridge Auto-Connect & Cross-Platform Sharing
 *
 * Validates:
 * 1. Relay bridge defaults to ON (opt-out, not opt-in)
 * 2. Relay bridge preference persists to/from LevelDB
 * 3. Proactive workspace-meta doc creation in autoRejoinWorkspaces
 * 4. connectAllDocsToRelay() helper function
 * 5. Frontend startup sync (WorkspaceContext sends relay-bridge:enable)
 * 6. AppSettings relay bridge toggle defaults to ON
 * 7. Electron share links include srv: parameter (wss://night-jar.co)
 * 8. Docker-compose relay stays in relay mode (no persistence, no data volume)
 * 9. nginx /assets/ and /api/ proxying (regression check from v1.7.21)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const rootDir = path.resolve(__dirname, '..');
const readFile = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf-8');

const sidecarSource = readFile('sidecar/index.js');
const workspaceContextSource = readFile('frontend/src/contexts/WorkspaceContext.jsx');
const appSettingsSource = readFile('frontend/src/components/common/AppSettings.jsx');
const workspaceSettingsSource = readFile('frontend/src/components/WorkspaceSettings.jsx');
const dockerCompose = readFile('server/deploy/docker-compose.prod.yml');
const nginxConf = readFile('server/deploy/nginx.conf');
const serverSource = readFile('server/unified/index.js');
const relayBridgeSource = readFile('sidecar/relay-bridge.js');

// ---------------------------------------------------------------------------
// 1. Sidecar — Relay bridge defaults to ON
// ---------------------------------------------------------------------------
describe('sidecar: relay bridge default ON', () => {
  test('relayBridgeEnabled uses !== "false" (default ON)', () => {
    expect(sidecarSource).toMatch(
      /let\s+relayBridgeEnabled\s*=\s*process\.env\.NIGHTJAR_RELAY_BRIDGE\s*!==\s*['"]false['"]/
    );
  });

  test('relayBridgeEnabled default is NOT opt-in (=== "true")', () => {
    // The old opt-in pattern should NOT be the default declaration
    const declarationMatch = sidecarSource.match(
      /let\s+relayBridgeEnabled\s*=\s*process\.env\.NIGHTJAR_RELAY_BRIDGE\s*===\s*['"]true['"]/
    );
    expect(declarationMatch).toBeNull();
  });

  test('Tor-disable restores relay bridge to default ON semantics', () => {
    // The Tor-disable path should also use !== 'false'
    expect(sidecarSource).toMatch(
      /Restore relay bridge to persisted or env-configured state/
    );
    expect(sidecarSource).toMatch(
      /relayBridgeEnabled\s*=\s*process\.env\.NIGHTJAR_RELAY_BRIDGE\s*!==\s*['"]false['"]/
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Sidecar — Relay bridge LevelDB persistence
// ---------------------------------------------------------------------------
describe('sidecar: relay bridge LevelDB persistence', () => {
  test('saveRelayBridgePreference function exists', () => {
    expect(sidecarSource).toContain('async function saveRelayBridgePreference(enabled)');
  });

  test('loadRelayBridgePreference function exists', () => {
    expect(sidecarSource).toContain('async function loadRelayBridgePreference()');
  });

  test('persistence uses "setting:relayBridgeEnabled" key', () => {
    expect(sidecarSource).toContain("'setting:relayBridgeEnabled'");
  });

  test('relay-bridge:enable handler persists to LevelDB', () => {
    // Find the enable handler and check it calls saveRelayBridgePreference
    const enableMatch = sidecarSource.match(
      /case\s+['"]relay-bridge:enable['"]:[\s\S]*?break;/
    );
    expect(enableMatch).toBeTruthy();
    expect(enableMatch[0]).toContain('saveRelayBridgePreference(true)');
  });

  test('relay-bridge:disable handler persists to LevelDB', () => {
    const disableMatch = sidecarSource.match(
      /case\s+['"]relay-bridge:disable['"]:[\s\S]*?break;/
    );
    expect(disableMatch).toBeTruthy();
    expect(disableMatch[0]).toContain('saveRelayBridgePreference(false)');
  });

  test('persisted preference is restored on startup before P2P init', () => {
    // The restore should happen before initializeP2PWithRetry
    const restorePos = sidecarSource.indexOf('loadRelayBridgePreference');
    const p2pInitPos = sidecarSource.indexOf('setTimeout(initializeP2PWithRetry');
    expect(restorePos).toBeGreaterThan(0);
    expect(p2pInitPos).toBeGreaterThan(0);
    expect(restorePos).toBeLessThan(p2pInitPos);
  });

  test('Tor-disable path reads persisted preference', () => {
    // After restoring env default, it should also check persisted preference
    expect(sidecarSource).toMatch(
      /loadRelayBridgePreference\(\)\.then\(persisted\s*=>/
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Sidecar — connectAllDocsToRelay helper
// ---------------------------------------------------------------------------
describe('sidecar: connectAllDocsToRelay helper', () => {
  test('connectAllDocsToRelay function exists', () => {
    expect(sidecarSource).toContain('async function connectAllDocsToRelay()');
  });

  test('helper connects workspace-meta: rooms', () => {
    const fnMatch = sidecarSource.match(
      /async function connectAllDocsToRelay\(\)\s*\{[\s\S]*?\n\}/
    );
    expect(fnMatch).toBeTruthy();
    expect(fnMatch[0]).toContain("workspace-meta:");
  });

  test('helper connects doc- rooms', () => {
    const fnMatch = sidecarSource.match(
      /async function connectAllDocsToRelay\(\)\s*\{[\s\S]*?\n\}/
    );
    expect(fnMatch).toBeTruthy();
    expect(fnMatch[0]).toContain("doc-");
  });

  test('relay-bridge:enable uses connectAllDocsToRelay helper', () => {
    const enableMatch = sidecarSource.match(
      /case\s+['"]relay-bridge:enable['"]:[\s\S]*?break;/
    );
    expect(enableMatch).toBeTruthy();
    expect(enableMatch[0]).toContain('connectAllDocsToRelay()');
  });
});

// ---------------------------------------------------------------------------
// 4. Sidecar — Proactive doc creation in autoRejoinWorkspaces
// ---------------------------------------------------------------------------
describe('sidecar: proactive workspace-meta doc creation at startup', () => {
  test('autoRejoinWorkspaces uses getOrCreateYDoc instead of docs.get', () => {
    // The relay bridge section in autoRejoinWorkspaces should use getOrCreateYDoc
    // to proactively create the workspace-meta doc
    const autoRejoinMatch = sidecarSource.match(
      /async function autoRejoinWorkspaces\(\)\s*\{[\s\S]*?\n\}/
    );
    expect(autoRejoinMatch).toBeTruthy();
    
    // Should use getOrCreateYDoc for proactive doc creation
    expect(autoRejoinMatch[0]).toContain('getOrCreateYDoc(roomName)');
  });

  test('autoRejoinWorkspaces connects docs to relay when bridge is enabled', () => {
    const autoRejoinMatch = sidecarSource.match(
      /async function autoRejoinWorkspaces\(\)\s*\{[\s\S]*?\n\}/
    );
    expect(autoRejoinMatch).toBeTruthy();
    expect(autoRejoinMatch[0]).toContain('relayBridge.connect(roomName, doc, null, authToken)');
  });
});

// ---------------------------------------------------------------------------
// 5. Frontend — Startup sync (WorkspaceContext)
// ---------------------------------------------------------------------------
describe('frontend: startup relay bridge sync (WorkspaceContext)', () => {
  test('sends relay-bridge:enable on WebSocket connect', () => {
    expect(workspaceContextSource).toContain("type: 'relay-bridge:enable'");
  });

  test('startup sync checks localStorage preference (default ON)', () => {
    // Should use !== 'false' to default to ON
    expect(workspaceContextSource).toContain("relayBridgePref !== 'false'");
  });

  test('startup sync happens after list-workspaces request', () => {
    const listPos = workspaceContextSource.indexOf("type: 'list-workspaces'");
    const relayPos = workspaceContextSource.indexOf("type: 'relay-bridge:enable'");
    expect(listPos).toBeGreaterThan(0);
    expect(relayPos).toBeGreaterThan(0);
    expect(relayPos).toBeGreaterThan(listPos);
  });

  test('startup sync includes custom relay URL from localStorage', () => {
    expect(workspaceContextSource).toContain('Nightjar_custom_relay_url');
    expect(workspaceContextSource).toContain('customRelays');
  });
});

// ---------------------------------------------------------------------------
// 6. Frontend — AppSettings relay bridge toggle defaults ON
// ---------------------------------------------------------------------------
describe('frontend: AppSettings relay bridge default ON', () => {
  test('relay bridge useState initializer uses !== "false" (default ON)', () => {
    expect(appSettingsSource).toMatch(
      /localStorage\.getItem\(['"]Nightjar_relay_bridge_enabled['"]\)\s*!==\s*['"]false['"]/
    );
  });

  test('relay bridge useState does NOT use === "true" (old opt-in)', () => {
    // The old pattern should not appear in the relay bridge initializer
    // (it may appear elsewhere for other settings, so check context)
    const relaySection = appSettingsSource.match(
      /Relay bridge state[\s\S]*?useState\(\(\)\s*=>\s*\{[^}]+\}/
    );
    expect(relaySection).toBeTruthy();
    expect(relaySection[0]).not.toContain("=== 'true'");
  });
});

// ---------------------------------------------------------------------------
// 7. Electron share links include srv: (serverUrl)
// ---------------------------------------------------------------------------
describe('frontend: Electron share links include server URL', () => {
  test('Electron branch sets serverUrl to wss://night-jar.co', () => {
    expect(workspaceSettingsSource).toContain("serverUrl = 'wss://night-jar.co'");
  });

  test('serverUrl assignment is in the isElectron() else branch', () => {
    // The Electron block should have a serverUrl assignment
    const electronBlock = workspaceSettingsSource.match(
      /\}\s*else\s*\{[\s\S]*?serverUrl\s*=\s*['"]wss:\/\/night-jar\.co['"]/
    );
    expect(electronBlock).toBeTruthy();
  });

  test('share link generation passes serverUrl to generateSignedInviteLink', () => {
    expect(workspaceSettingsSource).toMatch(
      /generateSignedInviteLink\(\{[\s\S]*?serverUrl/
    );
  });

  test('share link generation passes serverUrl to generateShareLink (fallback)', () => {
    expect(workspaceSettingsSource).toMatch(
      /generateShareLink\(\{[\s\S]*?serverUrl/
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Docker — relay stays in relay mode (no persistence)
// ---------------------------------------------------------------------------
describe('docker-compose.prod: relay is pure relay (no persistence)', () => {
  test('relay service uses NIGHTJAR_MODE=relay', () => {
    const relayIdx = dockerCompose.indexOf('nightjar-relay:');
    expect(relayIdx).toBeGreaterThan(-1);

    const privateIdx = dockerCompose.indexOf('nightjar-private:', relayIdx);
    const relayBlock = dockerCompose.slice(relayIdx, privateIdx > 0 ? privateIdx : undefined);

    expect(relayBlock).toContain('NIGHTJAR_MODE=relay');
  });

  test('relay service does NOT have NIGHTJAR_MODE=host', () => {
    const relayIdx = dockerCompose.indexOf('nightjar-relay:');
    const privateIdx = dockerCompose.indexOf('nightjar-private:', relayIdx);
    const relayBlock = dockerCompose.slice(relayIdx, privateIdx > 0 ? privateIdx : undefined);

    expect(relayBlock).not.toContain('NIGHTJAR_MODE=host');
  });

  test('relay service does NOT have ENCRYPTED_PERSISTENCE env var', () => {
    const relayIdx = dockerCompose.indexOf('nightjar-relay:');
    const privateIdx = dockerCompose.indexOf('nightjar-private:', relayIdx);
    const relayBlock = dockerCompose.slice(relayIdx, privateIdx > 0 ? privateIdx : undefined);

    expect(relayBlock).not.toContain('ENCRYPTED_PERSISTENCE');
  });

  test('relay service does NOT have a persistent data volume', () => {
    const relayIdx = dockerCompose.indexOf('nightjar-relay:');
    const privateIdx = dockerCompose.indexOf('nightjar-private:', relayIdx);
    const relayBlock = dockerCompose.slice(relayIdx, privateIdx > 0 ? privateIdx : undefined);

    expect(relayBlock).not.toContain('nightjar-relay-data');
  });

  test('relay has no volumes: section', () => {
    const relayIdx = dockerCompose.indexOf('nightjar-relay:');
    const privateIdx = dockerCompose.indexOf('nightjar-private:', relayIdx);
    const relayBlock = dockerCompose.slice(relayIdx, privateIdx > 0 ? privateIdx : undefined);

    // Should not have a volumes: section (only env, ports, healthcheck, etc.)
    expect(relayBlock).not.toMatch(/^\s+volumes:/m);
  });

  test('private service keeps ENCRYPTED_PERSISTENCE=true', () => {
    const privateIdx = dockerCompose.indexOf('nightjar-private:');
    expect(privateIdx).toBeGreaterThan(-1);
    const privateBlock = dockerCompose.slice(privateIdx);

    expect(privateBlock).toContain('ENCRYPTED_PERSISTENCE=true');
  });

  test('private service keeps NIGHTJAR_MODE=private', () => {
    const privateIdx = dockerCompose.indexOf('nightjar-private:');
    const privateBlock = dockerCompose.slice(privateIdx);

    expect(privateBlock).toContain('NIGHTJAR_MODE=private');
  });

  test('top-level volumes only contains nightjar-private-data', () => {
    // The volumes: section at root level should only have private data
    expect(dockerCompose).toContain('nightjar-private-data');
    expect(dockerCompose).not.toContain('nightjar-relay-data');
  });
});

// ---------------------------------------------------------------------------
// 9. nginx — SPA asset + API proxying (regression from v1.7.21)
// ---------------------------------------------------------------------------
describe('nginx: relay SPA asset + API routing (v1.7.21 regression check)', () => {
  test('has location /assets/ block that proxies to relay', () => {
    expect(nginxConf).toMatch(/location\s+\/assets\/\s*\{[^}]*proxy_pass\s+http:\/\/relay/s);
  });

  test('has location /api/ block that proxies to relay', () => {
    expect(nginxConf).toMatch(/location\s+\/api\/\s*\{[^}]*proxy_pass\s+http:\/\/relay/s);
  });

  test('has location /join/ block that proxies to relay', () => {
    expect(nginxConf).toMatch(/location\s+\/join\/\s*\{[^}]*proxy_pass\s+http:\/\/relay/s);
  });
});

// ---------------------------------------------------------------------------
// 10. Server — /api/encrypted-persistence endpoint (regression check)
// ---------------------------------------------------------------------------
describe('server: encrypted-persistence endpoint (regression check)', () => {
  test('endpoint returns ENCRYPTED_PERSISTENCE && !DISABLE_PERSISTENCE', () => {
    const match = serverSource.match(
      /app\.get\([^,]*\/api\/encrypted-persistence['"][^)]*,\s*\(req,\s*res\)\s*=>\s*\{([^}]+)\}/s
    );
    expect(match).toBeTruthy();
    const handler = match[1];
    expect(handler).toContain('DISABLE_PERSISTENCE');
    expect(handler).toMatch(/ENCRYPTED_PERSISTENCE\s*&&\s*!DISABLE_PERSISTENCE/);
  });
});

// ---------------------------------------------------------------------------
// 11. Relay bridge module integrity
// ---------------------------------------------------------------------------
describe('relay-bridge: module integrity', () => {
  test('exports relayBridge singleton', () => {
    expect(relayBridgeSource).toContain('module.exports');
    expect(relayBridgeSource).toContain('relayBridge');
  });

  test('imports BOOTSTRAP_NODES from mesh-constants', () => {
    expect(relayBridgeSource).toContain('BOOTSTRAP_NODES');
    expect(relayBridgeSource).toContain('./mesh-constants');
  });

  test('mesh-constants includes wss://night-jar.co as a bootstrap node', () => {
    const meshConstantsSource = readFile('sidecar/mesh-constants.js');
    expect(meshConstantsSource).toContain('wss://night-jar.co');
  });

  test('has connect method', () => {
    expect(relayBridgeSource).toContain('async connect(');
  });

  test('has disconnectAll method', () => {
    expect(relayBridgeSource).toContain('disconnectAll');
  });
});

// ---------------------------------------------------------------------------
// 12. End-to-end sharing scenario validation
// ---------------------------------------------------------------------------
describe('E2E: Native→Web sharing scenario requirements', () => {
  test('sidecar relay bridge is ON by default (data reaches relay)', () => {
    // The sidecar defaults relay bridge to ON
    expect(sidecarSource).toMatch(
      /let\s+relayBridgeEnabled\s*=\s*process\.env\.NIGHTJAR_RELAY_BRIDGE\s*!==\s*['"]false['"]/
    );
  });

  test('workspace-meta docs are proactively created at startup (relay has data)', () => {
    // autoRejoinWorkspaces creates docs proactively
    expect(sidecarSource).toContain('getOrCreateYDoc(roomName)');
  });

  test('Electron share links include relay URL (web clients know where to sync)', () => {
    expect(workspaceSettingsSource).toContain("serverUrl = 'wss://night-jar.co'");
  });

  test('nginx proxies SPA assets to relay (no blank screen)', () => {
    expect(nginxConf).toMatch(/location\s+\/assets\/\s*\{[^}]*proxy_pass\s+http:\/\/relay/s);
  });

  test('nginx proxies API calls to relay (key delivery works)', () => {
    expect(nginxConf).toMatch(/location\s+\/api\/\s*\{[^}]*proxy_pass\s+http:\/\/relay/s);
  });

  test('relay stays in relay mode (no false persistence claims)', () => {
    const relayIdx = dockerCompose.indexOf('nightjar-relay:');
    const privateIdx = dockerCompose.indexOf('nightjar-private:', relayIdx);
    const relayBlock = dockerCompose.slice(relayIdx, privateIdx > 0 ? privateIdx : undefined);
    expect(relayBlock).toContain('NIGHTJAR_MODE=relay');
    expect(relayBlock).not.toContain('ENCRYPTED_PERSISTENCE');
  });

  test('frontend sends relay-bridge:enable on startup (belt-and-suspenders)', () => {
    expect(workspaceContextSource).toContain("type: 'relay-bridge:enable'");
  });
});

// ---------------------------------------------------------------------------
// 13. Web→Web sharing scenario validation
// ---------------------------------------------------------------------------
describe('E2E: Web→Web sharing scenario', () => {
  test('browser auto-detects relay from window.location.origin', () => {
    // WorkspaceSettings has autoDetectedRelay for browser mode
    expect(workspaceSettingsSource).toContain('autoDetectedRelay');
  });

  test('share link generation includes serverUrl for browser mode', () => {
    expect(workspaceSettingsSource).toMatch(
      /if\s*\(\s*!isElectron\(\)\s*\)[\s\S]*?serverUrl\s*=\s*customRelayUrl|autoDetectedRelay/
    );
  });
});

// ---------------------------------------------------------------------------
// 14. doc-added event auto-connects new docs to relay
// ---------------------------------------------------------------------------
describe('sidecar: doc-added event auto-connects to relay', () => {
  test('doc-added handler connects workspace-meta docs when relay bridge is enabled', () => {
    // The doc-added listener checks relayBridgeEnabled for workspace-meta, workspace-folders, and doc- prefixes
    expect(sidecarSource).toMatch(
      /relayBridgeEnabled\s*&&\s*\(\s*\n?\s*docName\.startsWith\(['"]workspace-meta:/
    );
  });

  test('doc-added handler calls relayBridge.connect for workspace-meta docs', () => {
    // After the check, it should call relayBridge.connect with auth token
    const docAddedSection = sidecarSource.match(
      /docs\.on\(['"]doc-added['"][\s\S]*?(?=\/\/\s*P2P stack|\/\/\s*---\s*Graceful)/
    );
    expect(docAddedSection).toBeTruthy();
    expect(docAddedSection[0]).toContain('relayBridge.connect(docName, doc, null, authToken)');
  });
});

// ---------------------------------------------------------------------------
// 15. Client — key delivery retry logic (regression check from v1.7.20)
// ---------------------------------------------------------------------------
describe('client: key delivery retry logic (v1.7.20 regression check)', () => {
  const clientSource = readFile('frontend/src/utils/websocket.js');

  test('deliverKeyToServer has retry loop', () => {
    expect(clientSource).toMatch(/async\s+function\s+deliverKeyToServer\([^)]*maxRetries/);
  });

  test('retry uses exponential backoff', () => {
    expect(clientSource).toMatch(/Math\.pow\(2,\s*attempt/);
  });
});
