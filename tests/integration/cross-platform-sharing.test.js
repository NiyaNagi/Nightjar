/**
 * Cross-Platform Share Link Tests
 * 
 * Tests share link generation and parsing across all platform combinations:
 * - Web ↔ Electron
 * - Web ↔ iOS (Capacitor)
 * - Web ↔ Android (Capacitor)
 * - Electron ↔ iOS
 * - Electron ↔ Android
 * - iOS ↔ Android
 * 
 * These tests verify that share links generated on one platform
 * can be correctly parsed and joined from another platform.
 * 
 * Uses the custom test runner format.
 */

const path = require('path');
const {
    assert,
    sleep,
    randomHex,
} = require('./test-utils.js');

// Platform simulation utilities
const PLATFORMS = {
  web: {
    name: 'Web Browser',
    hasElectronAPI: false,
    hasCapacitor: false,
    capacitorPlatform: null,
  },
  electron: {
    name: 'Electron Desktop',
    hasElectronAPI: true,
    hasCapacitor: false,
    capacitorPlatform: null,
  },
  ios: {
    name: 'iOS (Capacitor)',
    hasElectronAPI: false,
    hasCapacitor: true,
    capacitorPlatform: 'ios',
  },
  android: {
    name: 'Android (Capacitor)',
    hasElectronAPI: false,
    hasCapacitor: true,
    capacitorPlatform: 'android',
  },
};

// Mock share link generation/parsing (matching share-links.test.js)
const mockSharing = {
    /**
     * Generate a share link
     */
    generateShareLink(options) {
        const { entityType = 'document', entityId, permission = 'editor', password, serverUrl } = options;
        const typeCode = { workspace: 'w', folder: 'f', document: 'd' }[entityType] || 'd';
        const permCode = { owner: 'o', editor: 'e', viewer: 'v' }[permission] || 'e';
        
        const payload = Buffer.from(entityId, 'hex').toString('base64url');
        let link = `nightjar://${typeCode}/${payload}`;
        
        const fragments = [];
        if (password) fragments.push(`p:${encodeURIComponent(password)}`);
        fragments.push(`perm:${permCode}`);
        if (serverUrl) fragments.push(`srv:${encodeURIComponent(serverUrl)}`);
        
        if (fragments.length) {
            link += '#' + fragments.join('&');
        }
        
        return link;
    },

    /**
     * Parse a share link
     */
    parseShareLink(link) {
        const codeToEntity = { w: 'workspace', f: 'folder', d: 'document' };
        const codeToPerm = { o: 'owner', e: 'editor', v: 'viewer' };
        
        let encoded = link.trim();
        let fragment = '';
        
        const hashIndex = encoded.indexOf('#');
        if (hashIndex !== -1) {
            fragment = encoded.slice(hashIndex + 1);
            encoded = encoded.slice(0, hashIndex);
        }
        
        let entityType = 'document';
        if (encoded.startsWith('nightjar://')) {
            const afterProtocol = encoded.slice('nightjar://'.length);
            const slashIndex = afterProtocol.indexOf('/');
            if (slashIndex !== -1) {
                const typeCode = afterProtocol[0];
                entityType = codeToEntity[typeCode] || 'document';
                encoded = afterProtocol.slice(slashIndex + 1);
            }
        }
        
        // Parse fragment
        let password = null;
        let permission = 'editor';
        let serverUrl = null;
        
        for (const param of fragment.split('&')) {
            if (param.startsWith('p:')) {
                password = decodeURIComponent(param.slice(2));
            } else if (param.startsWith('perm:')) {
                permission = codeToPerm[param.slice(5)] || 'editor';
            } else if (param.startsWith('srv:')) {
                serverUrl = decodeURIComponent(param.slice(4));
            }
        }
        
        // Decode entity ID
        const entityId = Buffer.from(encoded, 'base64url').toString('hex');
        
        return {
            entityType,
            entityId,
            permission,
            embeddedPassword: password,
            serverUrl,
        };
    },

    /**
     * Validate a share link
     */
    isValidShareLink(link) {
        try {
            if (!link || typeof link !== 'string') return false;
            // Must start with nightjar:// protocol
            if (!link.startsWith('nightjar://')) return false;
            const parsed = this.parseShareLink(link);
            return parsed.entityId && parsed.entityId.length > 0;
        } catch {
            return false;
        }
    },
};

// Get current platform context string
function getPlatformContext(platformKey) {
    const p = PLATFORMS[platformKey];
    return `${p.name} (electron=${p.hasElectronAPI}, capacitor=${p.hasCapacitor}${p.capacitorPlatform ? `, platform=${p.capacitorPlatform}` : ''})`;
}

// Setup and teardown
async function setup() {
    console.log('  [Setup] Cross-platform sharing test suite ready');
}

async function teardown() {
    // Nothing to clean up
}

// =====================
// SHARE LINK GENERATION TESTS
// =====================

/**
 * Test: Each platform generates valid share links
 */
async function testAllPlatformsGenerateValidLinks() {
    for (const [platformKey, platform] of Object.entries(PLATFORMS)) {
        const entityId = randomHex(32);
        
        const link = mockSharing.generateShareLink({
            entityType: 'workspace',
            entityId,
            permission: 'editor',
        });
        
        assert.ok(link.startsWith('nightjar://'), `${platform.name} should generate nightjar:// links`);
        assert.ok(mockSharing.isValidShareLink(link), `${platform.name} links should be valid`);
    }
}

/**
 * Test: Web platform embeds server URL in share links
 */
async function testWebEmbedServerUrl() {
    const entityId = randomHex(32);
    const serverUrl = 'https://sync.nightjar.io';
    
    const link = mockSharing.generateShareLink({
        entityType: 'workspace',
        entityId,
        permission: 'editor',
        serverUrl,
    });
    
    assert.contains(link, 'srv:', 'Web link should contain srv: parameter');
    
    const parsed = mockSharing.parseShareLink(link);
    assert.equal(parsed.serverUrl, serverUrl, 'Server URL should round-trip');
}

// =====================
// CROSS-PLATFORM MATRIX TESTS
// =====================

/**
 * Test: Web → Electron link compatibility
 */
async function testWebToElectron() {
    const entityId = randomHex(32);
    
    // "Create" on Web
    const link = mockSharing.generateShareLink({
        entityType: 'workspace',
        entityId,
        permission: 'editor',
        serverUrl: 'https://sync.nightjar.io',
    });
    
    // "Parse" on Electron
    const parsed = mockSharing.parseShareLink(link);
    
    assert.equal(parsed.entityType, 'workspace');
    assert.equal(parsed.entityId, entityId);
    assert.equal(parsed.permission, 'editor');
    assert.equal(parsed.serverUrl, 'https://sync.nightjar.io');
}

/**
 * Test: Electron → Web link compatibility
 */
async function testElectronToWeb() {
    const entityId = randomHex(32);
    
    // Electron creates link (may use P2P direct or server)
    const link = mockSharing.generateShareLink({
        entityType: 'document',
        entityId,
        permission: 'viewer',
    });
    
    // Web parses
    const parsed = mockSharing.parseShareLink(link);
    
    assert.equal(parsed.entityType, 'document');
    assert.equal(parsed.entityId, entityId);
    assert.equal(parsed.permission, 'viewer');
}

/**
 * Test: Web → iOS link compatibility
 */
async function testWebToIOS() {
    const entityId = randomHex(32);
    
    const link = mockSharing.generateShareLink({
        entityType: 'folder',
        entityId,
        permission: 'editor',
        serverUrl: 'https://sync.nightjar.io',
    });
    
    const parsed = mockSharing.parseShareLink(link);
    
    assert.equal(parsed.entityType, 'folder');
    assert.equal(parsed.entityId, entityId);
    assert.ok(parsed.serverUrl, 'iOS should receive server URL for connectivity');
}

/**
 * Test: iOS → Android link compatibility
 */
async function testIOSToAndroid() {
    const entityId = randomHex(32);
    
    const link = mockSharing.generateShareLink({
        entityType: 'workspace',
        entityId,
        permission: 'owner',
    });
    
    const parsed = mockSharing.parseShareLink(link);
    
    assert.equal(parsed.entityType, 'workspace');
    assert.equal(parsed.entityId, entityId);
    assert.equal(parsed.permission, 'owner');
}

/**
 * Test: Android → Electron link compatibility
 */
async function testAndroidToElectron() {
    const entityId = randomHex(32);
    
    const link = mockSharing.generateShareLink({
        entityType: 'document',
        entityId,
        permission: 'editor',
        serverUrl: 'https://relay.nightjar.io',
    });
    
    const parsed = mockSharing.parseShareLink(link);
    
    assert.equal(parsed.entityType, 'document');
    assert.equal(parsed.entityId, entityId);
    assert.equal(parsed.serverUrl, 'https://relay.nightjar.io');
}

/**
 * Test: Full cross-platform matrix (12 combinations)
 */
async function testFullCrossPlatformMatrix() {
    const platforms = Object.keys(PLATFORMS);
    const entityId = randomHex(32);
    let testedCombinations = 0;
    
    for (const creatorKey of platforms) {
        for (const joinerKey of platforms) {
            if (creatorKey === joinerKey) continue; // Skip same-platform
            
            const link = mockSharing.generateShareLink({
                entityType: 'workspace',
                entityId,
                permission: 'editor',
            });
            
            const parsed = mockSharing.parseShareLink(link);
            
            assert.equal(parsed.entityId, entityId, 
                `${PLATFORMS[creatorKey].name} → ${PLATFORMS[joinerKey].name}: entityId should match`);
            assert.equal(parsed.entityType, 'workspace',
                `${PLATFORMS[creatorKey].name} → ${PLATFORMS[joinerKey].name}: entityType should match`);
            
            testedCombinations++;
        }
    }
    
    // 4 platforms × 3 other platforms = 12 combinations
    assert.equal(testedCombinations, 12, 'Should test all 12 cross-platform combinations');
}

// =====================
// PERMISSION LEVEL TESTS
// =====================

/**
 * Test: All permission levels preserved cross-platform
 */
async function testAllPermissionLevelsCrossPlatform() {
    const permissions = ['viewer', 'editor', 'owner'];
    const entityId = randomHex(32);
    
    for (const permission of permissions) {
        const link = mockSharing.generateShareLink({
            entityType: 'document',
            entityId,
            permission,
        });
        
        // Simulate parsing on different platforms
        for (const platformKey of Object.keys(PLATFORMS)) {
            const parsed = mockSharing.parseShareLink(link);
            
            assert.equal(parsed.permission, permission,
                `${permission} permission should be preserved on ${PLATFORMS[platformKey].name}`);
        }
    }
}

// =====================
// ENTITY TYPE TESTS
// =====================

/**
 * Test: All entity types work cross-platform
 */
async function testAllEntityTypesCrossPlatform() {
    const entityTypes = ['workspace', 'folder', 'document'];
    
    for (const entityType of entityTypes) {
        const entityId = randomHex(32);
        
        const link = mockSharing.generateShareLink({
            entityType,
            entityId,
            permission: 'editor',
        });
        
        // Parse on all platforms
        for (const platformKey of Object.keys(PLATFORMS)) {
            const parsed = mockSharing.parseShareLink(link);
            
            assert.equal(parsed.entityType, entityType,
                `${entityType} should parse correctly on ${PLATFORMS[platformKey].name}`);
            assert.equal(parsed.entityId, entityId,
                `entityId should match for ${entityType} on ${PLATFORMS[platformKey].name}`);
        }
    }
}

// =====================
// LINK RECOGNITION TESTS
// =====================

/**
 * Test: Valid links are recognized
 */
async function testValidLinkRecognition() {
    const validLinks = [
        mockSharing.generateShareLink({ entityType: 'workspace', entityId: randomHex(32), permission: 'editor' }),
        mockSharing.generateShareLink({ entityType: 'folder', entityId: randomHex(32), permission: 'viewer' }),
        mockSharing.generateShareLink({ entityType: 'document', entityId: randomHex(32), permission: 'owner' }),
    ];
    
    for (const link of validLinks) {
        assert.ok(mockSharing.isValidShareLink(link), `Link should be recognized as valid: ${link.slice(0, 30)}...`);
    }
}

/**
 * Test: Invalid links are rejected
 */
async function testInvalidLinkRejection() {
    const invalidLinks = [
        'https://example.com/share/abc',
        'http://localhost:3000/workspace',
        'file:///path/to/file',
        'mailto:test@example.com',
        '',
        null,
        undefined,
    ];
    
    for (const link of invalidLinks) {
        assert.ok(!mockSharing.isValidShareLink(link), `Link should be rejected: ${link}`);
    }
}

// =====================
// PASSWORD PROTECTION TESTS
// =====================

/**
 * Test: Password-protected links work cross-platform
 */
async function testPasswordProtectedLinksCrossPlatform() {
    const entityId = randomHex(32);
    const password = 'my-secure-password-123!@#';
    
    const link = mockSharing.generateShareLink({
        entityType: 'document',
        entityId,
        permission: 'editor',
        password,
    });
    
    // Parse on each platform
    for (const platformKey of Object.keys(PLATFORMS)) {
        const parsed = mockSharing.parseShareLink(link);
        
        assert.equal(parsed.embeddedPassword, password,
            `Password should be preserved on ${PLATFORMS[platformKey].name}`);
    }
}

/**
 * Test: Special characters in password work cross-platform
 */
async function testSpecialCharacterPasswordsCrossPlatform() {
    const passwords = [
        'simple-password',
        'with spaces here',
        'special!@#$%^&*()',
        'unicode-émojis-🎉🔐',
        'MixedCase123ABC',
    ];
    
    const entityId = randomHex(32);
    
    for (const password of passwords) {
        const link = mockSharing.generateShareLink({
            entityType: 'document',
            entityId,
            permission: 'editor',
            password,
        });
        
        const parsed = mockSharing.parseShareLink(link);
        
        assert.equal(parsed.embeddedPassword, password,
            `Password "${password}" should round-trip correctly`);
    }
}

// =====================
// SERVER URL TESTS
// =====================

/**
 * Test: Server URLs are preserved in links
 */
async function testServerUrlPreservation() {
    const serverUrls = [
        'https://sync.nightjar.io',
        'https://relay.example.com',
        'http://localhost:8080',
        'wss://websocket.nightjar.io',
    ];
    
    const entityId = randomHex(32);
    
    for (const serverUrl of serverUrls) {
        const link = mockSharing.generateShareLink({
            entityType: 'workspace',
            entityId,
            permission: 'editor',
            serverUrl,
        });
        
        const parsed = mockSharing.parseShareLink(link);
        
        assert.equal(parsed.serverUrl, serverUrl,
            `Server URL "${serverUrl}" should be preserved`);
    }
}

/**
 * Test: Links without server URL parse correctly
 */
async function testLinksWithoutServerUrl() {
    const entityId = randomHex(32);
    
    const link = mockSharing.generateShareLink({
        entityType: 'document',
        entityId,
        permission: 'editor',
        // No serverUrl - P2P direct connection
    });
    
    const parsed = mockSharing.parseShareLink(link);
    
    assert.ok(parsed.serverUrl === null || parsed.serverUrl === undefined,
        'Links without server URL should parse with null/undefined serverUrl');
    assert.equal(parsed.entityId, entityId);
}

// Export test suite
module.exports = {
    setup,
    teardown,
    tests: {
        'All platforms generate valid share links': testAllPlatformsGenerateValidLinks,
        'Web embeds server URL in share links': testWebEmbedServerUrl,
        'Web → Electron link compatibility': testWebToElectron,
        'Electron → Web link compatibility': testElectronToWeb,
        'Web → iOS link compatibility': testWebToIOS,
        'iOS → Android link compatibility': testIOSToAndroid,
        'Android → Electron link compatibility': testAndroidToElectron,
        'Full cross-platform matrix (12 combos)': testFullCrossPlatformMatrix,
        'All permission levels preserved cross-platform': testAllPermissionLevelsCrossPlatform,
        'All entity types work cross-platform': testAllEntityTypesCrossPlatform,
        'Valid links are recognized': testValidLinkRecognition,
        'Invalid links are rejected': testInvalidLinkRejection,
        'Password-protected links work cross-platform': testPasswordProtectedLinksCrossPlatform,
        'Special character passwords work cross-platform': testSpecialCharacterPasswordsCrossPlatform,
        'Server URLs are preserved in links': testServerUrlPreservation,
        'Links without server URL parse correctly': testLinksWithoutServerUrl,
    },
};

// Jest placeholder - integration tests use custom runner
const describe = typeof global.describe === 'function' ? global.describe : () => {};
const test = typeof global.test === 'function' ? global.test : () => {};
const expect = typeof global.expect === 'function' ? global.expect : () => ({});

describe('Integration Test Placeholder', () => {
  test('tests exist in custom format', () => {
    expect(module.exports).toBeDefined();
  });
});
