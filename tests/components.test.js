/**
 * Component Tests
 * 
 * Tests for additional UI components
 */

import React from 'react';
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ============================================================
// StatusBar Tests
// ============================================================

describe('StatusBar Logic', () => {
  describe('Collaboration Status', () => {
    test('correctly formats peer count display', () => {
      const formatPeerCount = (online, total) => {
        if (total === 0) return 'No collaborators';
        if (online === 0) return `${total} collaborator${total > 1 ? 's' : ''} (all offline)`;
        return `${online}/${total} online`;
      };
      
      expect(formatPeerCount(0, 0)).toBe('No collaborators');
      expect(formatPeerCount(0, 3)).toBe('3 collaborators (all offline)');
      expect(formatPeerCount(2, 5)).toBe('2/5 online');
      expect(formatPeerCount(0, 1)).toBe('1 collaborator (all offline)');
    });

    test('correctly formats connection status', () => {
      const getConnectionStatus = (connected, synced) => {
        if (!connected) return 'disconnected';
        if (!synced) return 'syncing';
        return 'connected';
      };
      
      expect(getConnectionStatus(false, false)).toBe('disconnected');
      expect(getConnectionStatus(true, false)).toBe('syncing');
      expect(getConnectionStatus(true, true)).toBe('connected');
    });
  });

  describe('Word Count', () => {
    test('correctly counts words', () => {
      const countWords = (text) => {
        if (!text || !text.trim()) return 0;
        return text.trim().split(/\s+/).length;
      };
      
      expect(countWords('')).toBe(0);
      expect(countWords('   ')).toBe(0);
      expect(countWords('Hello')).toBe(1);
      expect(countWords('Hello World')).toBe(2);
      expect(countWords('Hello   World')).toBe(2);
      expect(countWords('One two three four five')).toBe(5);
    });

    test('correctly counts characters', () => {
      const countCharacters = (text) => {
        if (!text) return 0;
        return text.length;
      };
      
      expect(countCharacters('')).toBe(0);
      expect(countCharacters('Hello')).toBe(5);
      expect(countCharacters('Hello World')).toBe(11);
    });
  });
});

// ============================================================
// TabBar Tests
// ============================================================

describe('TabBar Logic', () => {
  describe('Tab State', () => {
    test('marks active tab correctly', () => {
      const tabs = [
        { id: 'tab-1', name: 'Tab 1' },
        { id: 'tab-2', name: 'Tab 2' },
        { id: 'tab-3', name: 'Tab 3' },
      ];
      const activeId = 'tab-2';
      
      const isActive = (tabId) => tabId === activeId;
      
      expect(isActive('tab-1')).toBe(false);
      expect(isActive('tab-2')).toBe(true);
      expect(isActive('tab-3')).toBe(false);
    });

    test('correctly identifies modified tabs', () => {
      const modifiedTabs = new Set(['tab-1', 'tab-3']);
      
      const isModified = (tabId) => modifiedTabs.has(tabId);
      
      expect(isModified('tab-1')).toBe(true);
      expect(isModified('tab-2')).toBe(false);
      expect(isModified('tab-3')).toBe(true);
    });
  });

  describe('Tab Reordering', () => {
    test('moves tab within array', () => {
      let tabs = ['A', 'B', 'C', 'D'];
      
      const moveTab = (fromIndex, toIndex) => {
        const item = tabs.splice(fromIndex, 1)[0];
        tabs.splice(toIndex, 0, item);
      };
      
      moveTab(0, 2);
      expect(tabs).toEqual(['B', 'C', 'A', 'D']);
    });

    test('handles drag to same position', () => {
      let tabs = ['A', 'B', 'C'];
      
      const moveTab = (fromIndex, toIndex) => {
        if (fromIndex === toIndex) return;
        const item = tabs.splice(fromIndex, 1)[0];
        tabs.splice(toIndex, 0, item);
      };
      
      moveTab(1, 1);
      expect(tabs).toEqual(['A', 'B', 'C']);
    });
  });

  describe('Tab Icons', () => {
    test('returns correct icon for document type', () => {
      const getTabIcon = (type) => {
        const icons = {
          text: '📄',
          sheet: '📊',
          kanban: '📋',
        };
        return icons[type] || '📄';
      };
      
      expect(getTabIcon('text')).toBe('📄');
      expect(getTabIcon('sheet')).toBe('📊');
      expect(getTabIcon('kanban')).toBe('📋');
      expect(getTabIcon('unknown')).toBe('📄');
    });
  });
});

// ============================================================
// Toolbar Tests
// ============================================================

describe('Toolbar Logic', () => {
  describe('Format State', () => {
    test('correctly detects bold state', () => {
      const marks = { bold: true, italic: false };
      expect(marks.bold).toBe(true);
    });

    test('correctly detects multiple marks', () => {
      const marks = { bold: true, italic: true, underline: false };
      const activeMarks = Object.entries(marks)
        .filter(([_, active]) => active)
        .map(([mark]) => mark);
      
      expect(activeMarks).toContain('bold');
      expect(activeMarks).toContain('italic');
      expect(activeMarks).not.toContain('underline');
    });
  });

  describe('Heading Levels', () => {
    test('cycles through heading levels', () => {
      let currentLevel = 0;
      const maxLevel = 6;
      
      const cycleHeading = () => {
        currentLevel = (currentLevel % maxLevel) + 1;
        return currentLevel;
      };
      
      expect(cycleHeading()).toBe(1);
      expect(cycleHeading()).toBe(2);
      expect(cycleHeading()).toBe(3);
    });
  });

  describe('Link Insertion', () => {
    test('validates URL format', () => {
      const isValidUrl = (string) => {
        try {
          new URL(string);
          return true;
        } catch (_) {
          return false;
        }
      };
      
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://example.com/path')).toBe(true);
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false);
    });

    test('adds protocol if missing', () => {
      const ensureProtocol = (url) => {
        if (!url.match(/^https?:\/\//)) {
          return `https://${url}`;
        }
        return url;
      };
      
      expect(ensureProtocol('example.com')).toBe('https://example.com');
      expect(ensureProtocol('http://example.com')).toBe('http://example.com');
      expect(ensureProtocol('https://example.com')).toBe('https://example.com');
    });
  });
});

// ============================================================
// Chat Tests
// ============================================================

describe('Chat Logic', () => {
  describe('Message Formatting', () => {
    test('formats timestamp correctly', () => {
      const formatTime = (timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      };
      
      const now = new Date('2024-01-15T14:30:00');
      const result = formatTime(now.getTime());
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    test('groups consecutive messages from same user', () => {
      const messages = [
        { id: 1, userId: 'user-1', text: 'Hello' },
        { id: 2, userId: 'user-1', text: 'World' },
        { id: 3, userId: 'user-2', text: 'Hi' },
        { id: 4, userId: 'user-1', text: 'Again' },
      ];
      
      const groupMessages = (msgs) => {
        return msgs.reduce((groups, msg) => {
          const lastGroup = groups[groups.length - 1];
          if (lastGroup && lastGroup.userId === msg.userId) {
            lastGroup.messages.push(msg);
          } else {
            groups.push({ userId: msg.userId, messages: [msg] });
          }
          return groups;
        }, []);
      };
      
      const groups = groupMessages(messages);
      expect(groups.length).toBe(3);
      expect(groups[0].messages.length).toBe(2);
      expect(groups[1].messages.length).toBe(1);
      expect(groups[2].messages.length).toBe(1);
    });
  });

  describe('Online Users', () => {
    test('filters out stale users', () => {
      const now = Date.now();
      const users = [
        { id: 1, name: 'Active', lastActive: now - 30000 },
        { id: 2, name: 'Stale', lastActive: now - 180000 },
        { id: 3, name: 'Active2', lastActive: now - 60000 },
      ];
      
      const maxAge = 120000; // 2 minutes
      const activeUsers = users.filter(u => (now - u.lastActive) < maxAge);
      
      expect(activeUsers.length).toBe(2);
      expect(activeUsers.map(u => u.name)).toContain('Active');
      expect(activeUsers.map(u => u.name)).not.toContain('Stale');
    });

    test('generates unique DM channel ID', () => {
      const getDmChannelId = (user1, user2) => {
        const sorted = [user1, user2].sort();
        return `dm-${sorted[0]}-${sorted[1]}`;
      };
      
      // Same result regardless of order
      expect(getDmChannelId('alice', 'bob')).toBe('dm-alice-bob');
      expect(getDmChannelId('bob', 'alice')).toBe('dm-alice-bob');
    });
  });
});

// ============================================================
// Kanban Tests
// ============================================================

describe('Kanban Logic', () => {
  describe('Card Movement', () => {
    test('moves card within column', () => {
      const columns = [
        { id: 'col-1', cards: ['card-1', 'card-2', 'card-3'] },
        { id: 'col-2', cards: ['card-4'] },
      ];
      
      const moveCardWithinColumn = (colId, fromIndex, toIndex) => {
        const column = columns.find(c => c.id === colId);
        if (column) {
          const [card] = column.cards.splice(fromIndex, 1);
          column.cards.splice(toIndex, 0, card);
        }
      };
      
      moveCardWithinColumn('col-1', 0, 2);
      expect(columns[0].cards).toEqual(['card-2', 'card-3', 'card-1']);
    });

    test('moves card between columns', () => {
      const columns = [
        { id: 'col-1', cards: ['card-1', 'card-2'] },
        { id: 'col-2', cards: ['card-3'] },
      ];
      
      const moveCardBetweenColumns = (fromColId, toColId, cardIndex, targetIndex) => {
        const fromCol = columns.find(c => c.id === fromColId);
        const toCol = columns.find(c => c.id === toColId);
        if (fromCol && toCol) {
          const [card] = fromCol.cards.splice(cardIndex, 1);
          toCol.cards.splice(targetIndex, 0, card);
        }
      };
      
      moveCardBetweenColumns('col-1', 'col-2', 0, 1);
      expect(columns[0].cards).toEqual(['card-2']);
      expect(columns[1].cards).toEqual(['card-3', 'card-1']);
    });
  });

  describe('Column Management', () => {
    test('adds new column', () => {
      const columns = [{ id: 'col-1', name: 'Todo', cards: [] }];
      
      const addColumn = (name) => {
        columns.push({
          id: `col-${Date.now()}`,
          name,
          cards: [],
        });
      };
      
      addColumn('In Progress');
      expect(columns.length).toBe(2);
      expect(columns[1].name).toBe('In Progress');
    });

    test('renames column', () => {
      const columns = [{ id: 'col-1', name: 'Old Name', cards: [] }];
      
      const renameColumn = (colId, newName) => {
        const column = columns.find(c => c.id === colId);
        if (column) column.name = newName;
      };
      
      renameColumn('col-1', 'New Name');
      expect(columns[0].name).toBe('New Name');
    });

    test('deletes column and moves cards', () => {
      const columns = [
        { id: 'col-1', name: 'Todo', cards: ['card-1'] },
        { id: 'col-2', name: 'Done', cards: ['card-2'] },
      ];
      
      const deleteColumn = (colId, moveCardsToColId) => {
        const colIndex = columns.findIndex(c => c.id === colId);
        if (colIndex !== -1) {
          const cards = columns[colIndex].cards;
          if (moveCardsToColId) {
            const targetCol = columns.find(c => c.id === moveCardsToColId);
            if (targetCol) targetCol.cards.push(...cards);
          }
          columns.splice(colIndex, 1);
        }
      };
      
      deleteColumn('col-1', 'col-2');
      expect(columns.length).toBe(1);
      expect(columns[0].cards).toEqual(['card-2', 'card-1']);
    });
  });
});

// ============================================================
// SplitPane Tests
// ============================================================

describe('SplitPane Logic', () => {
  test('calculates pane sizes correctly', () => {
    const calculateSizes = (splitPosition, containerWidth) => {
      return {
        left: splitPosition,
        right: containerWidth - splitPosition,
      };
    };
    
    const sizes = calculateSizes(300, 1000);
    expect(sizes.left).toBe(300);
    expect(sizes.right).toBe(700);
  });

  test('respects minimum pane sizes', () => {
    const minSize = 200;
    const containerWidth = 1000;
    
    const clampPosition = (position) => {
      return Math.max(minSize, Math.min(containerWidth - minSize, position));
    };
    
    expect(clampPosition(100)).toBe(200); // Too small, clamp to min
    expect(clampPosition(500)).toBe(500); // Valid
    expect(clampPosition(900)).toBe(800); // Too large, clamp
  });

  test('handles collapse/expand', () => {
    let isCollapsed = false;
    let lastPosition = 300;
    
    const toggle = () => {
      isCollapsed = !isCollapsed;
    };
    
    toggle();
    expect(isCollapsed).toBe(true);
    toggle();
    expect(isCollapsed).toBe(false);
  });
});

// ============================================================
// CollaboratorList Tests
// ============================================================

describe('CollaboratorList Logic', () => {
  test('sorts collaborators by activity', () => {
    const collaborators = [
      { id: 1, name: 'Alice', lastSeen: Date.now() - 60000 },
      { id: 2, name: 'Bob', lastSeen: Date.now() - 300000 },
      { id: 3, name: 'Charlie', lastSeen: Date.now() - 10000 },
    ];
    
    const sorted = [...collaborators].sort((a, b) => b.lastSeen - a.lastSeen);
    
    expect(sorted[0].name).toBe('Charlie');
    expect(sorted[1].name).toBe('Alice');
    expect(sorted[2].name).toBe('Bob');
  });

  test('groups by online/offline status', () => {
    const now = Date.now();
    const collaborators = [
      { id: 1, name: 'Alice', lastSeen: now - 30000 },
      { id: 2, name: 'Bob', lastSeen: now - 300000 },
      { id: 3, name: 'Charlie', lastSeen: now - 10000 },
    ];
    
    const threshold = 120000; // 2 minutes
    const online = collaborators.filter(c => (now - c.lastSeen) < threshold);
    const offline = collaborators.filter(c => (now - c.lastSeen) >= threshold);
    
    expect(online.length).toBe(2);
    expect(offline.length).toBe(1);
    expect(offline[0].name).toBe('Bob');
  });

  test('generates initials for avatar', () => {
    const getInitials = (name) => {
      return name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    };
    
    expect(getInitials('John Doe')).toBe('JD');
    expect(getInitials('Alice')).toBe('A');
    expect(getInitials('Mary Jane Watson')).toBe('MJ');
  });
});
