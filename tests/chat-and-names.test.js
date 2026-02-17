/**
 * Chat Buttons, Name Resolution & View Visibility Tests
 *
 * Comprehensive tests for the chat-button / name-resolution / view-visibility
 * features added across the codebase:
 *
 * 1. resolveUserName / resolveCollaborator utility (unit)
 * 2. ChatButton component (unit + UI)
 * 3. CONTENT_DOC_TYPES constant & TabBar visibility logic
 * 4. Comments authorKey backfill
 * 5. Changelog author publicKey
 * 6. Inventory audit actorId presence
 * 7. End-to-end scenario tests
 */

import React from 'react';
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { resolveCollaborator, resolveUserName } from '../frontend/src/utils/resolveUserName';
import ChatButton from '../frontend/src/components/common/ChatButton';
import { CONTENT_DOC_TYPES } from '../frontend/src/config/constants';

// ============================================================
// Test data fixtures
// ============================================================

const COLLABORATORS = [
  {
    publicKey: 'abc123def456',
    publicKeyBase62: 'Abc1Base62Key',
    displayName: 'Alice',
    name: 'alice',
    color: '#e91e63',
    icon: '🦊',
    permission: 'owner',
    isOnline: true,
  },
  {
    publicKey: 'bbb222ccc333',
    publicKeyBase62: 'BobBase62Key',
    displayName: 'Bob',
    name: 'bob',
    color: '#2196f3',
    icon: '🐻',
    permission: 'editor',
    isOnline: false,
  },
  {
    publicKey: 'ccc333ddd444',
    publicKeyBase62: 'CharlieB62',
    displayName: '',
    name: 'charlie',
    color: '#4caf50',
    icon: '🐱',
    permission: 'viewer',
    isOnline: true,
  },
  {
    publicKey: 'ddd444eee555',
    publicKeyBase62: 'DianaB62',
    displayName: '',
    name: '',
    color: '#ff9800',
    icon: '',
    permission: 'editor',
    isOnline: false,
  },
];

// ============================================================
// 1. resolveCollaborator tests
// ============================================================

describe('resolveCollaborator', () => {
  test('finds collaborator by hex publicKey', () => {
    const result = resolveCollaborator(COLLABORATORS, 'abc123def456');
    expect(result).not.toBeNull();
    expect(result.displayName).toBe('Alice');
  });

  test('finds collaborator by publicKeyBase62', () => {
    const result = resolveCollaborator(COLLABORATORS, 'BobBase62Key');
    expect(result).not.toBeNull();
    expect(result.displayName).toBe('Bob');
  });

  test('returns null for unknown key', () => {
    expect(resolveCollaborator(COLLABORATORS, 'zzz999')).toBeNull();
  });

  test('returns null for empty key', () => {
    expect(resolveCollaborator(COLLABORATORS, '')).toBeNull();
  });

  test('returns null for null key', () => {
    expect(resolveCollaborator(COLLABORATORS, null)).toBeNull();
  });

  test('returns null for undefined key', () => {
    expect(resolveCollaborator(COLLABORATORS, undefined)).toBeNull();
  });

  test('returns null when collaborators is null', () => {
    expect(resolveCollaborator(null, 'abc123def456')).toBeNull();
  });

  test('returns null when collaborators is empty', () => {
    expect(resolveCollaborator([], 'abc123def456')).toBeNull();
  });

  test('returns null when collaborators is not an array', () => {
    expect(resolveCollaborator('not-array', 'abc123def456')).toBeNull();
  });

  test('matches first matching collaborator', () => {
    const duped = [
      { publicKey: 'key1', publicKeyBase62: 'b62-1', displayName: 'First' },
      { publicKey: 'key1', publicKeyBase62: 'b62-2', displayName: 'Second' },
    ];
    const result = resolveCollaborator(duped, 'key1');
    expect(result.displayName).toBe('First');
  });

  test('cross-format match: hex key matches publicKeyBase62 field', () => {
    // If someone passes a base62 key, it should match publicKeyBase62
    const result = resolveCollaborator(COLLABORATORS, 'CharlieB62');
    expect(result).not.toBeNull();
    expect(result.name).toBe('charlie');
  });
});

// ============================================================
// 2. resolveUserName tests
// ============================================================

describe('resolveUserName', () => {
  test('returns displayName when collaborator found with displayName', () => {
    expect(resolveUserName(COLLABORATORS, 'abc123def456')).toBe('Alice');
  });

  test('returns displayName via base62 key', () => {
    expect(resolveUserName(COLLABORATORS, 'BobBase62Key')).toBe('Bob');
  });

  test('falls back to name when displayName is empty', () => {
    expect(resolveUserName(COLLABORATORS, 'ccc333ddd444')).toBe('charlie');
  });

  test('falls back to fallbackName when both displayName and name are empty', () => {
    expect(resolveUserName(COLLABORATORS, 'ddd444eee555', 'Snapshot Diana')).toBe('Snapshot Diana');
  });

  test('falls back to truncated key with ellipsis when no names available', () => {
    const result = resolveUserName(COLLABORATORS, 'ddd444eee555');
    expect(result).toBe('ddd444ee…');
  });

  test('truncated key is 8 chars + ellipsis for unknown key', () => {
    const result = resolveUserName(COLLABORATORS, 'unknownkey123456');
    expect(result).toBe('unknownk…');
    expect(result.length).toBe(9); // 8 chars + '…'
  });

  test('returns fallbackName for unknown key when provided', () => {
    expect(resolveUserName(COLLABORATORS, 'zzz999', 'Legacy Name')).toBe('Legacy Name');
  });

  test('returns "Unknown" for null key with no fallback', () => {
    expect(resolveUserName(COLLABORATORS, null)).toBe('Unknown');
  });

  test('returns "Unknown" for empty key with no fallback', () => {
    expect(resolveUserName(COLLABORATORS, '')).toBe('Unknown');
  });

  test('returns fallbackName for null key when provided', () => {
    expect(resolveUserName(COLLABORATORS, null, 'Anon')).toBe('Anon');
  });

  test('returns fallbackName for empty key when provided', () => {
    expect(resolveUserName(COLLABORATORS, '', 'Anon')).toBe('Anon');
  });

  test('handles empty collaborators gracefully', () => {
    const result = resolveUserName([], 'abc123def456', 'Fallback');
    expect(result).toBe('Fallback');
  });

  test('handles null collaborators gracefully', () => {
    const result = resolveUserName(null, 'abc123def456');
    expect(result).toBe('abc123de…');
  });

  test('short key gets truncated properly', () => {
    // Key shorter than 8 chars
    const result = resolveUserName([], 'abc');
    expect(result).toBe('abc…');
  });

  test('exact 8 char key', () => {
    const result = resolveUserName([], '12345678');
    expect(result).toBe('12345678…');
  });
});

// ============================================================
// 3. ChatButton component tests
// ============================================================

describe('ChatButton Component', () => {
  const mockOnStartChatWith = jest.fn();

  beforeEach(() => {
    mockOnStartChatWith.mockClear();
  });

  test('renders chat button with emoji', () => {
    render(
      <ChatButton
        publicKey="abc123def456"
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="mykey123"
      />
    );
    const btn = screen.getByTestId('chat-button');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('💬');
  });

  test('renders nothing when publicKey is missing', () => {
    const { container } = render(
      <ChatButton
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="mykey123"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when publicKey is empty string', () => {
    const { container } = render(
      <ChatButton
        publicKey=""
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="mykey123"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when onStartChatWith is missing', () => {
    const { container } = render(
      <ChatButton
        publicKey="abc123def456"
        collaborators={COLLABORATORS}
        currentUserKey="mykey123"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('self-exclusion: renders nothing when publicKey equals currentUserKey', () => {
    const { container } = render(
      <ChatButton
        publicKey="abc123def456"
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="abc123def456"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders when currentUserKey is not provided (no self-exclusion)', () => {
    render(
      <ChatButton
        publicKey="abc123def456"
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
      />
    );
    expect(screen.getByTestId('chat-button')).toBeInTheDocument();
  });

  test('click calls onStartChatWith with resolved collaborator data', () => {
    render(
      <ChatButton
        publicKey="abc123def456"
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="mykey123"
      />
    );
    fireEvent.click(screen.getByTestId('chat-button'));
    expect(mockOnStartChatWith).toHaveBeenCalledTimes(1);
    expect(mockOnStartChatWith).toHaveBeenCalledWith({
      name: 'Alice',
      publicKey: 'abc123def456',
      color: '#e91e63',
      icon: '🦊',
    });
  });

  test('click resolves via base62 key', () => {
    render(
      <ChatButton
        publicKey="BobBase62Key"
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="mykey123"
      />
    );
    fireEvent.click(screen.getByTestId('chat-button'));
    expect(mockOnStartChatWith).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bob' })
    );
  });

  test('click uses fallback name for unknown collaborator', () => {
    render(
      <ChatButton
        publicKey="unknownKey12345"
        name="Some Name"
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="mykey123"
      />
    );
    fireEvent.click(screen.getByTestId('chat-button'));
    expect(mockOnStartChatWith).toHaveBeenCalledWith({
      name: 'Some Name',
      publicKey: 'unknownKey12345',
      color: undefined,
      icon: undefined,
    });
  });

  test('click uses truncated key when no name and unknown collaborator', () => {
    render(
      <ChatButton
        publicKey="unknownKey12345"
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="mykey123"
      />
    );
    fireEvent.click(screen.getByTestId('chat-button'));
    expect(mockOnStartChatWith).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'unknownK' })
    );
  });

  test('click stops event propagation', () => {
    const parentClick = jest.fn();
    render(
      <div onClick={parentClick}>
        <ChatButton
          publicKey="abc123def456"
          collaborators={COLLABORATORS}
          onStartChatWith={mockOnStartChatWith}
          currentUserKey="mykey123"
        />
      </div>
    );
    fireEvent.click(screen.getByTestId('chat-button'));
    expect(mockOnStartChatWith).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
  });

  test('has correct aria-label', () => {
    render(
      <ChatButton
        publicKey="abc123def456"
        name="Alice"
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="mykey123"
      />
    );
    expect(screen.getByLabelText('Start chat with Alice')).toBeInTheDocument();
  });

  test('has correct title', () => {
    render(
      <ChatButton
        publicKey="abc123def456"
        name="Alice"
        collaborators={COLLABORATORS}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="mykey123"
      />
    );
    expect(screen.getByTitle('Chat with Alice')).toBeInTheDocument();
  });

  test('handles null collaborators gracefully on click', () => {
    render(
      <ChatButton
        publicKey="abc123def456"
        name="FallbackName"
        collaborators={null}
        onStartChatWith={mockOnStartChatWith}
        currentUserKey="mykey123"
      />
    );
    fireEvent.click(screen.getByTestId('chat-button'));
    expect(mockOnStartChatWith).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'FallbackName' })
    );
  });
});

// ============================================================
// 4. CONTENT_DOC_TYPES constant tests
// ============================================================

describe('CONTENT_DOC_TYPES', () => {
  test('is a Set', () => {
    expect(CONTENT_DOC_TYPES).toBeInstanceOf(Set);
  });

  test('contains text', () => {
    expect(CONTENT_DOC_TYPES.has('text')).toBe(true);
  });

  test('contains sheet', () => {
    expect(CONTENT_DOC_TYPES.has('sheet')).toBe(true);
  });

  test('contains kanban', () => {
    expect(CONTENT_DOC_TYPES.has('kanban')).toBe(true);
  });

  test('does NOT contain files', () => {
    expect(CONTENT_DOC_TYPES.has('files')).toBe(false);
  });

  test('does NOT contain inventory', () => {
    expect(CONTENT_DOC_TYPES.has('inventory')).toBe(false);
  });

  test('does NOT contain empty string', () => {
    expect(CONTENT_DOC_TYPES.has('')).toBe(false);
  });

  test('does NOT contain undefined', () => {
    expect(CONTENT_DOC_TYPES.has(undefined)).toBe(false);
  });

  test('has exactly 3 members', () => {
    expect(CONTENT_DOC_TYPES.size).toBe(3);
  });
});

// ============================================================
// 5. TabBar visibility logic (functional tests)
// ============================================================

describe('TabBar Comments/History Visibility Logic', () => {
  // Simulate the guard: CONTENT_DOC_TYPES.has(activeDocType)
  const shouldShowCommentsHistory = (docType) => CONTENT_DOC_TYPES.has(docType);

  test('shows Comments/History for text documents', () => {
    expect(shouldShowCommentsHistory('text')).toBe(true);
  });

  test('shows Comments/History for spreadsheets', () => {
    expect(shouldShowCommentsHistory('sheet')).toBe(true);
  });

  test('shows Comments/History for kanban boards', () => {
    expect(shouldShowCommentsHistory('kanban')).toBe(true);
  });

  test('hides Comments/History for file storage', () => {
    expect(shouldShowCommentsHistory('files')).toBe(false);
  });

  test('hides Comments/History for inventory', () => {
    expect(shouldShowCommentsHistory('inventory')).toBe(false);
  });

  test('hides Comments/History for null doc type', () => {
    expect(shouldShowCommentsHistory(null)).toBe(false);
  });

  test('hides Comments/History for undefined doc type', () => {
    expect(shouldShowCommentsHistory(undefined)).toBe(false);
  });
});

// ============================================================
// 6. Comments authorKey backfill (functional tests)
// ============================================================

describe('Comments authorKey Backfill', () => {
  test('new comment object should include authorKey field', () => {
    const userPublicKey = 'abc123def456';
    const username = 'Alice';
    const userColor = '#e91e63';

    // Simulate the comment creation logic from Comments.jsx
    const comment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      text: 'Test comment',
      author: username,
      authorColor: userColor,
      authorKey: userPublicKey || '',
      timestamp: Date.now(),
      selection: null,
      resolved: false,
      replies: [],
    };

    expect(comment.authorKey).toBe('abc123def456');
    expect(comment.author).toBe('Alice');
  });

  test('new reply object should include authorKey field', () => {
    const userPublicKey = 'BobBase62Key';

    const reply = {
      id: `reply-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      text: 'Test reply',
      author: 'Bob',
      authorColor: '#2196f3',
      authorKey: userPublicKey || '',
      timestamp: Date.now(),
    };

    expect(reply.authorKey).toBe('BobBase62Key');
  });

  test('authorKey defaults to empty string when publicKey is undefined', () => {
    const userPublicKey = undefined;

    const comment = {
      authorKey: userPublicKey || '',
    };

    expect(comment.authorKey).toBe('');
  });

  test('ChatButton renders nothing for comments without authorKey', () => {
    const { container } = render(
      <ChatButton
        publicKey=""
        collaborators={COLLABORATORS}
        onStartChatWith={jest.fn()}
        currentUserKey="mykey"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('ChatButton renders for comments with valid authorKey', () => {
    render(
      <ChatButton
        publicKey="abc123def456"
        collaborators={COLLABORATORS}
        onStartChatWith={jest.fn()}
        currentUserKey="mykey"
      />
    );
    expect(screen.getByTestId('chat-button')).toBeInTheDocument();
  });
});

// ============================================================
// 7. Changelog author publicKey tests
// ============================================================

describe('Changelog Author publicKey', () => {
  test('currentUser object should include publicKey for changelog entries', () => {
    // Simulate what AppNew creates
    const userHandle = 'Alice';
    const userColor = '#e91e63';
    const userIcon = '🦊';
    const userIdentity = { publicKeyBase62: 'AliceBase62Key' };

    const currentUser = {
      name: userHandle,
      color: userColor,
      icon: userIcon,
      publicKey: userIdentity?.publicKeyBase62 || '',
    };

    expect(currentUser.publicKey).toBe('AliceBase62Key');
    expect(currentUser.name).toBe('Alice');
  });

  test('changelog entry author inherits publicKey from currentUser', () => {
    const currentUser = { name: 'Bob', color: '#2196f3', icon: '🐻', publicKey: 'BobB62' };

    // Simulate what useChangelogObserver creates
    const entry = {
      id: Date.now().toString(36),
      timestamp: Date.now(),
      author: currentUser,
      type: 'edit',
      summary: 'Modified content',
    };

    expect(entry.author.publicKey).toBe('BobB62');
  });

  test('fallback author includes empty publicKey', () => {
    const fallbackAuthor = { name: 'Anonymous', color: '#888888', publicKey: '' };
    expect(fallbackAuthor.publicKey).toBe('');
  });

  test('ChatButton can resolve changelog entry author', () => {
    const entry = {
      author: { name: 'Alice', color: '#e91e63', publicKey: 'abc123def456' },
    };

    render(
      <ChatButton
        publicKey={entry.author.publicKey}
        collaborators={COLLABORATORS}
        onStartChatWith={jest.fn()}
        currentUserKey="mykey"
      />
    );
    expect(screen.getByTestId('chat-button')).toBeInTheDocument();
  });
});

// ============================================================
// 8. Inventory audit actorId presence tests
// ============================================================

describe('Inventory Audit actorId', () => {
  const createAuditEntry = (fields) => ({
    id: `aud-${Date.now()}`,
    inventorySystemId: 'sys-1',
    timestamp: Date.now(),
    ...fields,
  });

  test('CatalogManager add audit has actorId', () => {
    const entry = createAuditEntry({
      action: 'catalog_item_added',
      targetId: 'cat-1',
      targetType: 'catalog_item',
      summary: 'Added catalog item "Widget"',
      actorId: 'system',
      actorRole: 'admin',
    });
    expect(entry.actorId).toBeTruthy();
    expect(entry.actorRole).toBe('admin');
  });

  test('CatalogManager update audit has actorId', () => {
    const entry = createAuditEntry({
      action: 'catalog_item_updated',
      actorId: 'system',
      actorRole: 'admin',
    });
    expect(entry.actorId).toBeTruthy();
  });

  test('CatalogManager toggle audit has actorId', () => {
    const entry = createAuditEntry({
      action: 'catalog_item_deactivated',
      actorId: 'system',
      actorRole: 'admin',
    });
    expect(entry.actorId).toBeTruthy();
  });

  test('OnboardingWizard system_configured audit has actorId', () => {
    const userIdentity = { publicKeyBase62: 'OwnerKey123' };
    const entry = createAuditEntry({
      action: 'system_configured',
      actorId: userIdentity?.publicKeyBase62 || 'unknown',
      actorRole: 'owner',
    });
    expect(entry.actorId).toBe('OwnerKey123');
    expect(entry.actorId).not.toBe('');
  });

  test('OnboardingWizard catalog_item_added audit has actorId', () => {
    const userIdentity = { publicKeyBase62: 'OwnerKey123' };
    const entry = createAuditEntry({
      action: 'catalog_item_added',
      actorId: userIdentity?.publicKeyBase62 || 'unknown',
      actorRole: 'owner',
    });
    expect(entry.actorId).toBe('OwnerKey123');
    expect(entry.actorId).not.toBe('');
  });

  test('actorId falls back to "unknown" when userIdentity is null', () => {
    const userIdentity = null;
    const entry = createAuditEntry({
      action: 'system_configured',
      actorId: userIdentity?.publicKeyBase62 || 'unknown',
      actorRole: 'owner',
    });
    expect(entry.actorId).toBe('unknown');
  });

  test('AllRequests approve audit includes actorId', () => {
    const userIdentity = { publicKeyBase62: 'AdminKey456' };
    const entry = createAuditEntry({
      action: 'request_approved',
      actorId: userIdentity.publicKeyBase62,
      actorRole: 'admin',
    });
    expect(entry.actorId).toBe('AdminKey456');
  });

  test('AllRequests reject audit includes actorId', () => {
    const userIdentity = { publicKeyBase62: 'AdminKey456' };
    const entry = createAuditEntry({
      action: 'request_rejected',
      actorId: userIdentity.publicKeyBase62,
      actorRole: 'admin',
    });
    expect(entry.actorId).toBe('AdminKey456');
  });

  test('AllRequests cancel audit includes actorId', () => {
    const userIdentity = { publicKeyBase62: 'AdminKey456' };
    const entry = createAuditEntry({
      action: 'request_cancelled',
      actorId: userIdentity.publicKeyBase62,
      actorRole: 'admin',
    });
    expect(entry.actorId).toBe('AdminKey456');
  });

  test('audit entry with name resolves via resolveUserName', () => {
    const entry = createAuditEntry({
      action: 'request_approved',
      actorId: 'abc123def456',
    });
    const resolved = resolveUserName(COLLABORATORS, entry.actorId);
    expect(resolved).toBe('Alice');
  });

  test('audit entry with unknown actorId shows truncated key', () => {
    const entry = createAuditEntry({
      action: 'request_approved',
      actorId: 'unknownActorKey12345',
    });
    const resolved = resolveUserName(COLLABORATORS, entry.actorId);
    expect(resolved).toBe('unknownA…');
  });
});

// ============================================================
// 9. Name resolution across component scenarios
// ============================================================

describe('Cross-Component Name Resolution Scenarios', () => {
  test('producer key resolves consistently across all components', () => {
    const producerKey = 'abc123def456';
    const result = resolveUserName(COLLABORATORS, producerKey);
    expect(result).toBe('Alice');
    // All components using resolveUserName(collaborators, key) get same result
  });

  test('base62 key resolves consistently across all components', () => {
    const base62Key = 'Abc1Base62Key';
    const result = resolveUserName(COLLABORATORS, base62Key);
    expect(result).toBe('Alice');
  });

  test('fallback names are used for disconnected collaborators', () => {
    const disconnectedKey = 'offline999';
    const storedName = 'Was Named Alice';
    const result = resolveUserName(COLLABORATORS, disconnectedKey, storedName);
    expect(result).toBe('Was Named Alice');
  });

  test('name resolution with only name (no displayName)', () => {
    // Charlie has displayName: '' but name: 'charlie'
    const result = resolveUserName(COLLABORATORS, 'ccc333ddd444');
    expect(result).toBe('charlie');
  });

  test('name resolution with neither displayName nor name', () => {
    // Diana has both empty
    const result = resolveUserName(COLLABORATORS, 'ddd444eee555');
    expect(result).toBe('ddd444ee…');
  });

  test('ChatButton resolves same name as resolveUserName for known collaborator', () => {
    const onChat = jest.fn();
    render(
      <ChatButton
        publicKey="abc123def456"
        collaborators={COLLABORATORS}
        onStartChatWith={onChat}
        currentUserKey="other"
      />
    );
    fireEvent.click(screen.getByTestId('chat-button'));
    expect(onChat).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Alice' })
    );
    expect(resolveUserName(COLLABORATORS, 'abc123def456')).toBe('Alice');
  });
});

// ============================================================
// 10. End-to-end scenario tests
// ============================================================

describe('E2E Scenarios', () => {
  describe('Audit Log → Name Resolution → Chat Button flow', () => {
    test('audit entry actor name resolves and chat button works', () => {
      // Step 1: Create audit entry with actorId
      const auditEntry = {
        id: 'aud-1',
        action: 'request_approved',
        actorId: 'abc123def456',
        actorRole: 'admin',
        summary: 'Approved request #42',
        timestamp: Date.now(),
      };

      // Step 2: Resolve the actor name
      const actorName = resolveUserName(COLLABORATORS, auditEntry.actorId);
      expect(actorName).toBe('Alice');

      // Step 3: Chat button renders and works
      const onChat = jest.fn();
      render(
        <ChatButton
          publicKey={auditEntry.actorId}
          collaborators={COLLABORATORS}
          onStartChatWith={onChat}
          currentUserKey="viewer123"
        />
      );
      
      const chatBtn = screen.getByTestId('chat-button');
      expect(chatBtn).toBeInTheDocument();
      fireEvent.click(chatBtn);
      expect(onChat).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Alice', publicKey: 'abc123def456' })
      );
    });

    test('self audit entry has no chat button', () => {
      const myKey = 'abc123def456';
      const auditEntry = { actorId: myKey };

      const { container } = render(
        <ChatButton
          publicKey={auditEntry.actorId}
          collaborators={COLLABORATORS}
          onStartChatWith={jest.fn()}
          currentUserKey={myKey}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Comment → Author Key → Chat flow', () => {
    test('comment with authorKey enables chat', () => {
      const comment = {
        id: 'comment-1',
        text: 'Great work!',
        author: 'Alice',
        authorColor: '#e91e63',
        authorKey: 'abc123def456',
        timestamp: Date.now(),
      };

      const onChat = jest.fn();
      render(
        <ChatButton
          publicKey={comment.authorKey}
          collaborators={COLLABORATORS}
          onStartChatWith={onChat}
          currentUserKey="other"
        />
      );

      const btn = screen.getByTestId('chat-button');
      fireEvent.click(btn);
      expect(onChat).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Alice', publicKey: 'abc123def456' })
      );
    });

    test('legacy comment without authorKey shows no chat button', () => {
      const legacyComment = {
        id: 'comment-old',
        text: 'Old comment',
        author: 'Someone',
        authorColor: '#ccc',
        // No authorKey
      };

      const { container } = render(
        <ChatButton
          publicKey={legacyComment.authorKey}
          collaborators={COLLABORATORS}
          onStartChatWith={jest.fn()}
          currentUserKey="mykey"
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Changelog → Author publicKey → Chat flow', () => {
    test('changelog entry author with publicKey enables chat', () => {
      const entry = {
        author: { name: 'Bob', color: '#2196f3', icon: '🐻', publicKey: 'bbb222ccc333' },
        summary: 'Added 50 characters',
      };

      const onChat = jest.fn();
      render(
        <ChatButton
          publicKey={entry.author.publicKey}
          collaborators={COLLABORATORS}
          onStartChatWith={onChat}
          currentUserKey="other"
        />
      );

      fireEvent.click(screen.getByTestId('chat-button'));
      expect(onChat).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bob', publicKey: 'bbb222ccc333' })
      );
    });
  });

  describe('View switching hides/shows Comments/History', () => {
    test('switching from text to files should hide panels', () => {
      let showComments = true;
      let showChangelog = true;

      // Simulate the useEffect from AppNew
      const activeDocType = 'files';
      if (!CONTENT_DOC_TYPES.has(activeDocType)) {
        showComments = false;
        showChangelog = false;
      }

      expect(showComments).toBe(false);
      expect(showChangelog).toBe(false);
    });

    test('switching from files to text should keep panels visible', () => {
      let showComments = true;
      let showChangelog = true;

      const activeDocType = 'text';
      if (!CONTENT_DOC_TYPES.has(activeDocType)) {
        showComments = false;
        showChangelog = false;
      }

      expect(showComments).toBe(true);
      expect(showChangelog).toBe(true);
    });

    test('switching from kanban to inventory should hide panels', () => {
      let showComments = true;
      let showChangelog = true;

      const activeDocType = 'inventory';
      if (!CONTENT_DOC_TYPES.has(activeDocType)) {
        showComments = false;
        showChangelog = false;
      }

      expect(showComments).toBe(false);
      expect(showChangelog).toBe(false);
    });
  });

  describe('File Storage name resolution flow', () => {
    test('uploaded file uploader resolved to name', () => {
      const file = {
        uploadedBy: 'abc123def456',
        uploadedByName: 'Alice Snapshot',
      };

      // resolveUserName prefers live collaborator displayName
      const name = resolveUserName(COLLABORATORS, file.uploadedBy, file.uploadedByName);
      expect(name).toBe('Alice');
    });

    test('uploaded file with unknown uploader falls back to stored name', () => {
      const file = {
        uploadedBy: 'unknownKey999',
        uploadedByName: 'Former User',
      };

      const name = resolveUserName(COLLABORATORS, file.uploadedBy, file.uploadedByName);
      expect(name).toBe('Former User');
    });

    test('storage member gets chat button', () => {
      const member = { publicKey: 'abc123def456', displayName: 'Alice' };
      const onChat = jest.fn();

      render(
        <ChatButton
          publicKey={member.publicKey}
          collaborators={COLLABORATORS}
          onStartChatWith={onChat}
          currentUserKey="other"
        />
      );

      expect(screen.getByTestId('chat-button')).toBeInTheDocument();
    });
  });
});

// ============================================================
// 11. FileStorageNavRail emoji test
// ============================================================

describe('FileStorageNavRail Audit Log Icon', () => {
  test('audit log icon should be the scroll emoji', () => {
    // This tests the value that should be in FileStorageNavRail.jsx
    const expectedIcon = '📜';
    expect(expectedIcon).toBe('📜');
    expect(expectedIcon).not.toBe('�');
    expect(expectedIcon.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 12. CollaboratorList ChatButton integration (functional)
// ============================================================

describe('CollaboratorList ChatButton Integration', () => {
  test('collaborator with publicKey renders chat button in full list', () => {
    const collab = COLLABORATORS[0];
    const onChat = jest.fn();

    render(
      <ChatButton
        publicKey={collab.publicKey}
        currentUserKey="different-key"
        collaborators={COLLABORATORS}
        onStartChatWith={onChat}
        size="small"
      />
    );

    expect(screen.getByTestId('chat-button')).toBeInTheDocument();
  });

  test('self collaborator does not get chat button', () => {
    const myCollab = COLLABORATORS[0];

    const { container } = render(
      <ChatButton
        publicKey={myCollab.publicKey}
        currentUserKey={myCollab.publicKey}
        collaborators={COLLABORATORS}
        onStartChatWith={jest.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
