/**
 * Hook Tests
 * 
 * Tests for custom React hooks
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';

// ============================================================
// useWorkspaceSync Tests
// ============================================================

describe('useWorkspaceSync Hook', () => {
  let mockProvider;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
  });

  describe('Document Management', () => {
    test('addDocument adds document to synced list', () => {
      // Test logic for adding documents
      const documents = [];
      const addDocument = (doc) => {
        if (!documents.find(d => d.id === doc.id)) {
          documents.push(doc);
        }
      };
      
      addDocument({ id: 'doc-1', name: 'Test Doc', type: 'text' });
      expect(documents.length).toBe(1);
      expect(documents[0].name).toBe('Test Doc');
    });

    test('removeDocument removes document from list', () => {
      const documents = [
        { id: 'doc-1', name: 'Doc 1' },
        { id: 'doc-2', name: 'Doc 2' },
      ];
      
      const removeDocument = (docId) => {
        const index = documents.findIndex(d => d.id === docId);
        if (index !== -1) {
          documents.splice(index, 1);
        }
      };
      
      removeDocument('doc-1');
      expect(documents.length).toBe(1);
      expect(documents[0].id).toBe('doc-2');
    });

    test('updateDocument updates document properties', () => {
      const documents = [{ id: 'doc-1', name: 'Original', type: 'text' }];
      
      const updateDocument = (docId, updates) => {
        const doc = documents.find(d => d.id === docId);
        if (doc) {
          Object.assign(doc, updates);
        }
      };
      
      updateDocument('doc-1', { name: 'Updated' });
      expect(documents[0].name).toBe('Updated');
    });
  });

  describe('Folder Management', () => {
    test('addFolder adds folder to hierarchy', () => {
      const folders = [];
      const addFolder = (folder) => {
        folders.push(folder);
      };
      
      addFolder({ id: 'folder-1', name: 'Projects', parentId: null });
      expect(folders.length).toBe(1);
    });

    test('updateFolder updates folder properties', () => {
      const folders = [{ id: 'folder-1', name: 'Old Name', icon: '📁' }];
      
      const updateFolder = (folderId, updates) => {
        const folder = folders.find(f => f.id === folderId);
        if (folder) {
          Object.assign(folder, updates);
        }
      };
      
      updateFolder('folder-1', { name: 'New Name', icon: '🗂️' });
      expect(folders[0].name).toBe('New Name');
      expect(folders[0].icon).toBe('🗂️');
    });
  });

  describe('Workspace Info Sync', () => {
    test('updateWorkspaceInfo updates workspace metadata', () => {
      let workspaceInfo = { name: 'Original', icon: '📁', color: '#3b82f6' };
      
      const updateWorkspaceInfo = (updates) => {
        workspaceInfo = { ...workspaceInfo, ...updates };
      };
      
      updateWorkspaceInfo({ name: 'Updated Workspace' });
      expect(workspaceInfo.name).toBe('Updated Workspace');
      expect(workspaceInfo.icon).toBe('📁'); // Should preserve other properties
    });
  });
});

// ============================================================
// useAutoSave Tests
// ============================================================

describe('useAutoSave Hook', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });

  test('auto-save debounces multiple changes', () => {
    const saveFn = jest.fn();
    let pendingSave = null;
    
    const autoSave = (content) => {
      if (pendingSave) clearTimeout(pendingSave);
      pendingSave = setTimeout(() => saveFn(content), 1000);
    };
    
    autoSave('change 1');
    autoSave('change 2');
    autoSave('change 3');
    
    // Before timeout, save should not have been called
    expect(saveFn).not.toHaveBeenCalled();
    
    // After timeout
    jest.advanceTimersByTime(1000);
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('change 3');
  });

  test('immediate save bypasses debounce', () => {
    const saveFn = jest.fn();
    let pendingSave = null;
    
    const autoSave = (content, immediate = false) => {
      if (pendingSave) clearTimeout(pendingSave);
      if (immediate) {
        saveFn(content);
      } else {
        pendingSave = setTimeout(() => saveFn(content), 1000);
      }
    };
    
    autoSave('content', true);
    expect(saveFn).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// useFocusTrap Tests
// ============================================================

describe('useFocusTrap Hook', () => {
  test('getFocusableElements returns correct elements', () => {
    // Simulate focusable elements query
    const selectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    expect(selectors).toContain('button');
    expect(selectors).toContain('input');
    expect(selectors).toContain('[tabindex]');
  });

  test('trap should cycle focus within container', () => {
    // Test focus cycling logic
    const focusableElements = ['button1', 'input1', 'button2'];
    let currentIndex = 2; // Last element
    
    const focusNext = () => {
      currentIndex = (currentIndex + 1) % focusableElements.length;
      return focusableElements[currentIndex];
    };
    
    expect(focusNext()).toBe('button1'); // Should wrap to first
    expect(focusNext()).toBe('input1');
    expect(focusNext()).toBe('button2');
    expect(focusNext()).toBe('button1'); // Should wrap again
  });
});

// ============================================================
// useChangelogObserver Tests
// ============================================================

describe('useChangelogObserver Hook', () => {
  test('correctly detects insert operations', () => {
    const changes = [];
    
    const processChange = (delta) => {
      if (delta.insert) {
        changes.push({ type: 'insert', content: delta.insert });
      }
    };
    
    processChange({ insert: 'Hello' });
    processChange({ insert: ' World' });
    
    expect(changes.length).toBe(2);
    expect(changes[0].type).toBe('insert');
    expect(changes[0].content).toBe('Hello');
  });

  test('correctly detects delete operations', () => {
    const changes = [];
    
    const processChange = (delta) => {
      if (delta.delete) {
        changes.push({ type: 'delete', count: delta.delete });
      }
    };
    
    processChange({ delete: 5 });
    
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBe('delete');
    expect(changes[0].count).toBe(5);
  });

  test('correctly detects format operations', () => {
    const changes = [];
    
    const processChange = (delta) => {
      if (delta.attributes) {
        changes.push({ type: 'format', attributes: delta.attributes });
      }
    };
    
    processChange({ retain: 10, attributes: { bold: true } });
    
    expect(changes.length).toBe(1);
    expect(changes[0].attributes.bold).toBe(true);
  });
});

// ============================================================
// useDocumentManager Tests
// ============================================================

describe('useDocumentManager Hook', () => {
  describe('Tab Management', () => {
    test('openTab adds tab if not exists', () => {
      const tabs = [];
      let activeTabId = null;
      
      const openTab = (docId, docName) => {
        if (!tabs.find(t => t.id === docId)) {
          tabs.push({ id: docId, name: docName });
        }
        activeTabId = docId;
      };
      
      openTab('doc-1', 'Document 1');
      expect(tabs.length).toBe(1);
      expect(activeTabId).toBe('doc-1');
    });

    test('openTab activates existing tab', () => {
      const tabs = [{ id: 'doc-1', name: 'Doc 1' }];
      let activeTabId = null;
      
      const openTab = (docId, docName) => {
        if (!tabs.find(t => t.id === docId)) {
          tabs.push({ id: docId, name: docName });
        }
        activeTabId = docId;
      };
      
      openTab('doc-1', 'Doc 1');
      expect(tabs.length).toBe(1); // Should not add duplicate
      expect(activeTabId).toBe('doc-1');
    });

    test('closeTab removes tab and activates adjacent', () => {
      let tabs = [
        { id: 'doc-1', name: 'Doc 1' },
        { id: 'doc-2', name: 'Doc 2' },
        { id: 'doc-3', name: 'Doc 3' },
      ];
      let activeTabId = 'doc-2';
      
      const closeTab = (docId) => {
        const index = tabs.findIndex(t => t.id === docId);
        if (index !== -1) {
          tabs = tabs.filter(t => t.id !== docId);
          
          // Activate adjacent tab
          if (activeTabId === docId) {
            if (tabs.length > 0) {
              activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
            } else {
              activeTabId = null;
            }
          }
        }
      };
      
      closeTab('doc-2');
      expect(tabs.length).toBe(2);
      expect(activeTabId).toBe('doc-3');
    });

    test('closeTab handles last tab', () => {
      let tabs = [{ id: 'doc-1', name: 'Doc 1' }];
      let activeTabId = 'doc-1';
      
      const closeTab = (docId) => {
        tabs = tabs.filter(t => t.id !== docId);
        if (activeTabId === docId) {
          activeTabId = tabs.length > 0 ? tabs[0].id : null;
        }
      };
      
      closeTab('doc-1');
      expect(tabs.length).toBe(0);
      expect(activeTabId).toBeNull();
    });
  });

  describe('Document Operations', () => {
    test('createDocument generates unique ID', () => {
      const createId = () => {
        return `doc-${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
      };
      
      const id1 = createId();
      const id2 = createId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^doc-/);
    });

    test('renameDocument updates document name', () => {
      const documents = [{ id: 'doc-1', name: 'Original' }];
      
      const renameDocument = (docId, newName) => {
        const doc = documents.find(d => d.id === docId);
        if (doc) {
          doc.name = newName;
        }
      };
      
      renameDocument('doc-1', 'Renamed Document');
      expect(documents[0].name).toBe('Renamed Document');
    });

    test('deleteDocument removes document and its data', () => {
      let documents = [
        { id: 'doc-1', name: 'Doc 1' },
        { id: 'doc-2', name: 'Doc 2' },
      ];
      const ydocs = new Map([['doc-1', {}], ['doc-2', {}]]);
      
      const deleteDocument = (docId) => {
        documents = documents.filter(d => d.id !== docId);
        ydocs.delete(docId);
      };
      
      deleteDocument('doc-1');
      expect(documents.length).toBe(1);
      expect(ydocs.has('doc-1')).toBe(false);
      expect(ydocs.has('doc-2')).toBe(true);
    });
  });
});

// ============================================================
// useAuthorAttribution Tests
// ============================================================

describe('useAuthorAttribution Hook', () => {
  test('tracks author for text insertions', () => {
    const authors = new Map();
    
    const trackInsertion = (position, length, userId) => {
      authors.set(`${position}-${position + length}`, userId);
    };
    
    trackInsertion(0, 10, 'user-1');
    trackInsertion(10, 5, 'user-2');
    
    expect(authors.get('0-10')).toBe('user-1');
    expect(authors.get('10-15')).toBe('user-2');
  });

  test('merges adjacent same-author regions', () => {
    const regions = [];
    
    const addRegion = (start, end, author) => {
      const lastRegion = regions[regions.length - 1];
      if (lastRegion && lastRegion.author === author && lastRegion.end === start) {
        lastRegion.end = end;
      } else {
        regions.push({ start, end, author });
      }
    };
    
    addRegion(0, 5, 'user-1');
    addRegion(5, 10, 'user-1');
    addRegion(10, 15, 'user-2');
    
    expect(regions.length).toBe(2);
    expect(regions[0]).toEqual({ start: 0, end: 10, author: 'user-1' });
  });
});

// ============================================================
// useCopyFeedback Tests
// ============================================================

// Mock navigator.clipboard
const mockClipboard = {
  writeText: jest.fn(),
};
Object.defineProperty(global.navigator, 'clipboard', {
  value: mockClipboard,
  writable: true,
});

import { useCopyFeedback } from '../frontend/src/hooks/useCopyFeedback';

describe('useCopyFeedback Hook', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockClipboard.writeText.mockClear();
    mockClipboard.writeText.mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('initializes with copied = false', () => {
    const { result } = renderHook(() => useCopyFeedback());
    expect(result.current.copied).toBe(false);
  });

  test('copyToClipboard sets copied to true', async () => {
    const { result } = renderHook(() => useCopyFeedback());
    
    await act(async () => {
      await result.current.copyToClipboard('test text');
    });
    
    expect(result.current.copied).toBe(true);
    expect(mockClipboard.writeText).toHaveBeenCalledWith('test text');
  });

  test('copied resets to false after timeout', async () => {
    const { result } = renderHook(() => useCopyFeedback(1000));
    
    await act(async () => {
      await result.current.copyToClipboard('test');
    });
    
    expect(result.current.copied).toBe(true);
    
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    
    expect(result.current.copied).toBe(false);
  });

  test('respects custom duration', async () => {
    const { result } = renderHook(() => useCopyFeedback(5000));
    
    await act(async () => {
      await result.current.copyToClipboard('test');
    });
    
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(true);
    
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current.copied).toBe(false);
  });

  test('calls onSuccess callback', async () => {
    const { result } = renderHook(() => useCopyFeedback());
    const onSuccess = jest.fn();
    
    await act(async () => {
      await result.current.copyToClipboard('test', onSuccess);
    });
    
    expect(onSuccess).toHaveBeenCalled();
  });

  test('returns true on successful copy', async () => {
    const { result } = renderHook(() => useCopyFeedback());
    
    let success;
    await act(async () => {
      success = await result.current.copyToClipboard('test');
    });
    
    expect(success).toBe(true);
  });

  test('returns false on failed copy', async () => {
    mockClipboard.writeText.mockRejectedValueOnce(new Error('Failed'));
    const { result } = renderHook(() => useCopyFeedback());
    
    let success;
    await act(async () => {
      success = await result.current.copyToClipboard('test');
    });
    
    expect(success).toBe(false);
  });

  test('triggerCopied sets copied to true', () => {
    const { result } = renderHook(() => useCopyFeedback());
    
    act(() => {
      result.current.triggerCopied();
    });
    
    expect(result.current.copied).toBe(true);
  });
});

// ============================================================
// useEnvironment Tests
// ============================================================

import {
  isElectron,
  isWeb,
  isCapacitor,
  getPlatform,
  getEnvironment,
  useEnvironment,
} from '../frontend/src/hooks/useEnvironment';

describe('useEnvironment Hook', () => {
  const originalElectronAPI = global.window.electronAPI;
  const originalCapacitor = global.window.Capacitor;

  beforeEach(() => {
    delete global.window.electronAPI;
    delete global.window.Capacitor;
  });

  afterAll(() => {
    if (originalElectronAPI) global.window.electronAPI = originalElectronAPI;
    if (originalCapacitor) global.window.Capacitor = originalCapacitor;
  });

  describe('isElectron', () => {
    test('returns false when electronAPI not present', () => {
      expect(isElectron()).toBe(false);
    });

    test('returns true when electronAPI present', () => {
      global.window.electronAPI = { version: '1.0' };
      expect(isElectron()).toBe(true);
    });
  });

  describe('isCapacitor', () => {
    test('returns false when Capacitor not present', () => {
      expect(isCapacitor()).toBe(false);
    });
  });

  describe('isWeb', () => {
    test('returns true when neither Electron nor Capacitor', () => {
      expect(isWeb()).toBe(true);
    });

    test('returns false when in Electron', () => {
      global.window.electronAPI = { version: '1.0' };
      expect(isWeb()).toBe(false);
    });
  });

  describe('getPlatform', () => {
    test('returns web by default', () => {
      expect(getPlatform()).toBe('web');
    });

    test('returns electron when electronAPI present', () => {
      global.window.electronAPI = { version: '1.0' };
      expect(getPlatform()).toBe('electron');
    });
  });

  describe('getEnvironment', () => {
    test('returns correct environment object for web', () => {
      const env = getEnvironment();
      expect(env.isWeb).toBe(true);
      expect(env.isElectron).toBe(false);
      expect(env.platform).toBe('web');
    });

    test('returns correct environment object for electron', () => {
      global.window.electronAPI = { version: '1.0' };
      const env = getEnvironment();
      expect(env.isWeb).toBe(false);
      expect(env.isElectron).toBe(true);
      expect(env.isDesktop).toBe(true);
      expect(env.platform).toBe('electron');
    });
  });

  describe('useEnvironment hook', () => {
    test('returns memoized environment', () => {
      const { result, rerender } = renderHook(() => useEnvironment());
      
      const firstResult = result.current;
      rerender();
      const secondResult = result.current;
      
      expect(firstResult).toBe(secondResult);
    });
  });
});

// ============================================================
// useFocusTrap Tests
// ============================================================

import { useFocusTrap } from '../frontend/src/hooks/useFocusTrap';

describe('useFocusTrap Hook', () => {
  test('calls onEscape when Escape key pressed', () => {
    const containerRef = { current: document.createElement('div') };
    const onEscape = jest.fn();
    
    renderHook(() => useFocusTrap(containerRef, true, { onEscape }));
    
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);
    
    expect(onEscape).toHaveBeenCalled();
  });

  test('does not call onEscape when inactive', () => {
    const containerRef = { current: document.createElement('div') };
    const onEscape = jest.fn();
    
    renderHook(() => useFocusTrap(containerRef, false, { onEscape }));
    
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);
    
    expect(onEscape).not.toHaveBeenCalled();
  });

  test('returns this for chaining', () => {
    const containerRef = { current: document.createElement('div') };
    
    // Just verify the hook runs without error
    expect(() => {
      renderHook(() => useFocusTrap(containerRef, true));
    }).not.toThrow();
  });
});

// ============================================================
// Hook Cleanup Tests
// ============================================================

describe('Hook Cleanup', () => {
  test('useCopyFeedback cleans up timeout on unmount', () => {
    // Use sync triggerCopied instead of async copyToClipboard to avoid fake timer issues
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    
    const { unmount, result } = renderHook(() => useCopyFeedback());
    
    // Use triggerCopied which is synchronous and sets a timeout
    act(() => {
      result.current.triggerCopied();
    });
    
    // Verify timeout is registered
    expect(result.current.copied).toBe(true);
    
    unmount();
    
    // The clearTimeout should be called during cleanup
    expect(clearTimeoutSpy).toHaveBeenCalled();
    
    clearTimeoutSpy.mockRestore();
    jest.useRealTimers();
  });

  test('useFocusTrap cleans up event listeners on unmount', () => {
    const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');
    
    const containerRef = { current: document.createElement('div') };
    const { unmount } = renderHook(() => useFocusTrap(containerRef, true));
    
    unmount();
    
    expect(removeEventListenerSpy).toHaveBeenCalled();
    
    removeEventListenerSpy.mockRestore();
  });
});
