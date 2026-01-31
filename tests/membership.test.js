/**
 * Workspace Membership Tests
 * 
 * Tests for workspace members Y.Map structure and operations.
 */

import * as Y from 'yjs';
import {
  generateIdentity,
  signData,
  uint8ToBase62,
} from '../frontend/src/utils/identity';

describe('Workspace Membership', () => {
  let ydoc;
  let yMembers;
  let yKicked;
  let ownerIdentity;
  let memberIdentity;
  
  beforeEach(() => {
    ydoc = new Y.Doc();
    yMembers = ydoc.getMap('members');
    yKicked = ydoc.getMap('kicked');
    ownerIdentity = generateIdentity();
    memberIdentity = generateIdentity();
  });
  
  afterEach(() => {
    ydoc.destroy();
  });
  
  describe('Members Map Structure', () => {
    test('can add member with publicKey as key', () => {
      const publicKey = memberIdentity.publicKeyBase62;
      
      yMembers.set(publicKey, {
        publicKey,
        displayName: 'Test User',
        permission: 'editor',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
      
      expect(yMembers.has(publicKey)).toBe(true);
      expect(yMembers.get(publicKey).displayName).toBe('Test User');
    });
    
    test('creator becomes owner', () => {
      const ownerKey = ownerIdentity.publicKeyBase62;
      
      yMembers.set(ownerKey, {
        publicKey: ownerKey,
        displayName: 'Workspace Owner',
        permission: 'owner',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
      
      expect(yMembers.get(ownerKey).permission).toBe('owner');
    });
    
    test('invited user gets correct permission', () => {
      const memberKey = memberIdentity.publicKeyBase62;
      
      yMembers.set(memberKey, {
        publicKey: memberKey,
        displayName: 'Invited Editor',
        permission: 'editor',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
      
      expect(yMembers.get(memberKey).permission).toBe('editor');
    });
    
    test('duplicate publicKey overwrites entry', () => {
      const publicKey = memberIdentity.publicKeyBase62;
      
      yMembers.set(publicKey, {
        publicKey,
        displayName: 'First Name',
        permission: 'viewer',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
      
      yMembers.set(publicKey, {
        publicKey,
        displayName: 'Second Name',
        permission: 'editor',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
      
      // Should only have one entry
      expect(yMembers.size).toBe(1);
      expect(yMembers.get(publicKey).displayName).toBe('Second Name');
    });
    
    test('members map is properly structured', () => {
      const member = {
        publicKey: memberIdentity.publicKeyBase62,
        displayName: 'Test User',
        handle: '@testuser',
        color: '#6366f1',
        icon: '🦊',
        permission: 'editor',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      };
      
      yMembers.set(member.publicKey, member);
      
      const stored = yMembers.get(member.publicKey);
      
      expect(stored.publicKey).toBe(member.publicKey);
      expect(stored.displayName).toBe(member.displayName);
      expect(stored.handle).toBe(member.handle);
      expect(stored.color).toBe(member.color);
      expect(stored.icon).toBe(member.icon);
      expect(stored.permission).toBe(member.permission);
      expect(stored.joinedAt).toBe(member.joinedAt);
      expect(stored.lastSeen).toBe(member.lastSeen);
    });
    
    test('lastSeen updates on activity', () => {
      const publicKey = memberIdentity.publicKeyBase62;
      const initialTime = Date.now() - 10000;
      
      yMembers.set(publicKey, {
        publicKey,
        displayName: 'Test User',
        permission: 'editor',
        joinedAt: initialTime,
        lastSeen: initialTime,
      });
      
      const newTime = Date.now();
      const existing = yMembers.get(publicKey);
      yMembers.set(publicKey, {
        ...existing,
        lastSeen: newTime,
      });
      
      expect(yMembers.get(publicKey).lastSeen).toBe(newTime);
      expect(yMembers.get(publicKey).joinedAt).toBe(initialTime);
    });
  });
  
  describe('Kicked Map Structure', () => {
    test('can add kicked member', () => {
      const publicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:workspace123:${publicKey}:${timestamp}`;
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      
      yKicked.set(publicKey, {
        kickedAt: timestamp,
        kickedBy: ownerIdentity.publicKeyBase62,
        signature: uint8ToBase62(signature),
        reason: 'Test kick',
      });
      
      expect(yKicked.has(publicKey)).toBe(true);
    });
    
    test('kicked user cannot rejoin (application logic)', () => {
      const publicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:workspace123:${publicKey}:${timestamp}`;
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      
      // Add to kicked
      yKicked.set(publicKey, {
        kickedAt: timestamp,
        kickedBy: ownerIdentity.publicKeyBase62,
        signature: uint8ToBase62(signature),
      });
      
      // Application should check kicked before allowing join
      const isKicked = yKicked.has(publicKey);
      expect(isKicked).toBe(true);
      
      // This would be blocked at application level
      // if (isKicked) { throw new Error('User is kicked'); }
    });
    
    test('kicked entry includes required fields', () => {
      const publicKey = memberIdentity.publicKeyBase62;
      const timestamp = Date.now();
      const messageToSign = `kick:workspace123:${publicKey}:${timestamp}`;
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      
      yKicked.set(publicKey, {
        kickedAt: timestamp,
        kickedBy: ownerIdentity.publicKeyBase62,
        signature: uint8ToBase62(signature),
        reason: 'Spam behavior',
      });
      
      const entry = yKicked.get(publicKey);
      expect(entry.kickedAt).toBe(timestamp);
      expect(entry.kickedBy).toBe(ownerIdentity.publicKeyBase62);
      expect(entry.signature).toBeDefined();
      expect(entry.reason).toBe('Spam behavior');
    });
  });
  
  describe('Member Removal', () => {
    test('kicking removes from members map', () => {
      const publicKey = memberIdentity.publicKeyBase62;
      
      // Add member
      yMembers.set(publicKey, {
        publicKey,
        displayName: 'To Be Kicked',
        permission: 'editor',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
      
      expect(yMembers.has(publicKey)).toBe(true);
      
      // Kick and remove
      const timestamp = Date.now();
      const messageToSign = `kick:workspace123:${publicKey}:${timestamp}`;
      const signature = signData(messageToSign, ownerIdentity.privateKey);
      
      ydoc.transact(() => {
        yKicked.set(publicKey, {
          kickedAt: timestamp,
          kickedBy: ownerIdentity.publicKeyBase62,
          signature: uint8ToBase62(signature),
        });
        yMembers.delete(publicKey);
      });
      
      expect(yMembers.has(publicKey)).toBe(false);
      expect(yKicked.has(publicKey)).toBe(true);
    });
  });
  
  describe('Y.Map Observability', () => {
    test('members map emits events on changes', (done) => {
      const publicKey = memberIdentity.publicKeyBase62;
      
      yMembers.observe((event) => {
        expect(event.changes.keys.has(publicKey)).toBe(true);
        done();
      });
      
      yMembers.set(publicKey, {
        publicKey,
        displayName: 'Test',
        permission: 'viewer',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
    });
    
    test('kicked map emits events on changes', (done) => {
      const publicKey = memberIdentity.publicKeyBase62;
      
      yKicked.observe((event) => {
        expect(event.changes.keys.has(publicKey)).toBe(true);
        done();
      });
      
      yKicked.set(publicKey, {
        kickedAt: Date.now(),
        kickedBy: ownerIdentity.publicKeyBase62,
        signature: 'testsig',
      });
    });
  });
  
  describe('Sync Between Documents', () => {
    test('members sync between Y.Docs', () => {
      const ydoc2 = new Y.Doc();
      const yMembers2 = ydoc2.getMap('members');
      
      const publicKey = memberIdentity.publicKeyBase62;
      
      // Add member to first doc
      yMembers.set(publicKey, {
        publicKey,
        displayName: 'Synced User',
        permission: 'editor',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
      
      // Sync updates
      const update = Y.encodeStateAsUpdate(ydoc);
      Y.applyUpdate(ydoc2, update);
      
      expect(yMembers2.has(publicKey)).toBe(true);
      expect(yMembers2.get(publicKey).displayName).toBe('Synced User');
      
      ydoc2.destroy();
    });
  });
});
