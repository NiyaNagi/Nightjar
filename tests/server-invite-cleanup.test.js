/**
 * Test Suite: Server Invite Cleanup
 * 
 * Tests for the v1.7.15 two-tier invite cleanup mechanism:
 * - Tier 1: Hourly deletion of expired invites (expires_at < now)
 * - Tier 2: Nuclear every 6h — delete ALL invites older than 24h from creation
 * - Verifies the server source has all required cleanup infrastructure
 * - Tests SQL statement correctness via source analysis
 */

import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read the server source file for analysis
const serverSource = readFileSync(
  resolve(process.cwd(), 'server/unified/index.js'), 'utf8'
);

describe('Server Invite Cleanup — v1.7.15', () => {
  
  describe('SQL Prepared Statements', () => {
    test('deleteExpiredInvites statement targets expires_at < ?', () => {
      expect(serverSource).toContain(
        "DELETE FROM invites WHERE expires_at IS NOT NULL AND expires_at < ?"
      );
    });
    
    test('nuclearDeleteOldInvites statement targets created_at < ?', () => {
      expect(serverSource).toContain(
        "DELETE FROM invites WHERE created_at < ?"
      );
    });
    
    test('deleteExpiredInvites excludes invites with NULL expires_at', () => {
      // The IS NOT NULL check ensures legacy invites without expiry aren't deleted
      expect(serverSource).toContain('expires_at IS NOT NULL AND expires_at < ?');
    });
    
    test('nuclearDeleteOldInvites does NOT check expires_at', () => {
      // The nuclear query uses only created_at — it doesn't care about expires_at
      const nuclearQuery = "DELETE FROM invites WHERE created_at < ?";
      expect(serverSource).toContain(nuclearQuery);
      // Ensure this is a separate statement from the expiry-based one
      const expiredQuery = "DELETE FROM invites WHERE expires_at IS NOT NULL AND expires_at < ?";
      expect(serverSource).toContain(expiredQuery);
      expect(nuclearQuery).not.toEqual(expiredQuery);
    });
  });
  
  describe('Storage Class Methods', () => {
    test('Storage has deleteExpiredInvites method', () => {
      expect(serverSource).toMatch(/deleteExpiredInvites\s*\(\s*now\s*\)/);
    });
    
    test('Storage has nuclearDeleteOldInvites method', () => {
      expect(serverSource).toMatch(/nuclearDeleteOldInvites\s*\(\s*cutoff\s*\)/);
    });
    
    test('deleteExpiredInvites passes timestamp to prepared statement', () => {
      // The method should pass 'now' to the prepared statement
      expect(serverSource).toContain('this._stmts.deleteExpiredInvites.run(now)');
    });
    
    test('nuclearDeleteOldInvites passes cutoff to prepared statement', () => {
      expect(serverSource).toContain('this._stmts.nuclearDeleteOldInvites.run(cutoff)');
    });
  });
  
  describe('Invite Cleanup Interval', () => {
    test('runs cleanup every hour', () => {
      expect(serverSource).toContain('INVITE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000');
    });
    
    test('nuclear cleanup runs every 6 hours', () => {
      expect(serverSource).toContain('NUCLEAR_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000');
    });
    
    test('max invite age is 24 hours', () => {
      expect(serverSource).toContain('MAX_INVITE_AGE_MS = 24 * 60 * 60 * 1000');
    });
    
    test('tracks lastNuclearCleanup for 6h gating', () => {
      expect(serverSource).toContain('lastNuclearCleanup');
      // Checks that nuclear only runs when enough time has passed
      expect(serverSource).toContain('now - lastNuclearCleanup >= NUCLEAR_CLEANUP_INTERVAL_MS');
    });
    
    test('tier 1 calls deleteExpiredInvites with current time', () => {
      expect(serverSource).toContain('storage.deleteExpiredInvites(now)');
    });
    
    test('tier 2 computes cutoff as now - MAX_INVITE_AGE_MS', () => {
      expect(serverSource).toContain('now - MAX_INVITE_AGE_MS');
      expect(serverSource).toContain('storage.nuclearDeleteOldInvites(cutoff)');
    });
    
    test('cleanup interval error handling exists', () => {
      expect(serverSource).toContain('[Invite Cleanup] Error during invite cleanup:');
    });
    
    test('interval is cleaned up on shutdown', () => {
      expect(serverSource).toContain('clearInterval(inviteCleanupInterval)');
    });
  });
  
  describe('/join/* Route — SPA Serving', () => {
    test('serves the SPA for /join/* paths', () => {
      // Must serve injectedIndexHtml, not a static shim page
      expect(serverSource).toMatch(/app\.get.*\/join\/\*/);
      // Should NOT contain the old JOIN_REDIRECT_HTML shim
      expect(serverSource).not.toContain('JOIN_REDIRECT_HTML');
    });
    
    test('sets no-cache headers on /join/* responses', () => {
      // Find the /join/* route handler section
      const joinRouteIdx = serverSource.indexOf("'/join/*'");
      expect(joinRouteIdx).toBeGreaterThan(-1);
      
      // Check for no-cache headers nearby (800 chars to account for static-asset bypass block)
      const routeSection = serverSource.slice(joinRouteIdx, joinRouteIdx + 800);
      expect(routeSection).toContain('no-cache');
      expect(routeSection).toContain('no-store');
      expect(routeSection).toContain('must-revalidate');
    });
    
    test('serves injectedIndexHtml (not raw index.html)', () => {
      const joinRouteIdx = serverSource.indexOf("'/join/*'");
      const routeSection = serverSource.slice(joinRouteIdx, joinRouteIdx + 800);
      expect(routeSection).toContain('injectedIndexHtml');
    });
    
    test('route is registered BEFORE the SPA fallback', () => {
      const joinRouteIdx = serverSource.indexOf("'/join/*'");
      // The SPA catch-all is `app.get(BASE_PATH + '/*', ...)`
      // Find this specific "SPA fallback" comment + route
      const spaFallbackCommentIdx = serverSource.indexOf('SPA fallback — only serves navigation');
      expect(joinRouteIdx).toBeGreaterThan(-1);
      expect(spaFallbackCommentIdx).toBeGreaterThan(-1);
      // /join/* must come before the SPA fallback catch-all
      expect(joinRouteIdx).toBeLessThan(spaFallbackCommentIdx);
    });
  });
  
  describe('Invite Table Schema', () => {
    test('has created_at column for nuclear cleanup', () => {
      expect(serverSource).toContain('created_at INTEGER');
    });
    
    test('has expires_at column for tier 1 cleanup', () => {
      expect(serverSource).toContain('expires_at INTEGER');
    });
    
    test('has invites table with all required columns', () => {
      expect(serverSource).toContain('CREATE TABLE IF NOT EXISTS invites');
      expect(serverSource).toContain('token TEXT PRIMARY KEY');
      expect(serverSource).toContain('entity_type TEXT NOT NULL');
      expect(serverSource).toContain('entity_id TEXT NOT NULL');
      expect(serverSource).toContain('permission TEXT NOT NULL');
    });
  });
  
  describe('Security: TODO for at-rest encryption', () => {
    test('has TODO for encrypting invite rows at rest', () => {
      expect(serverSource).toContain('TODO: Encrypt invite rows at rest');
    });
  });
});
