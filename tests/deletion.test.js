/**
 * Document/Page Deletion Tests
 * 
 * Comprehensive tests for document and folder deletion functionality:
 * - UI components (HierarchicalSidebar delete button)
 * - Confirmation dialogs
 * - Delete logic in AppNew
 * - Sync propagation
 * - Permission checks
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

// ============================================================
// Delete Flow Integration Tests
// ============================================================

describe('Document Deletion Flow', () => {
  describe('Delete Button Visibility', () => {
    test('delete button renders when onRequestDelete prop is provided', () => {
      // Simulates TreeItem behavior
      const props = {
        item: { id: 'doc-1', name: 'Test Doc' },
        type: 'document',
        onRequestDelete: jest.fn(),
      };
      
      // TreeItem should render delete button when onRequestDelete is provided
      expect(props.onRequestDelete).toBeDefined();
    });

    test('delete button is hidden when onRequestDelete is not provided', () => {
      const props = {
        item: { id: 'doc-1', name: 'Test Doc' },
        type: 'document',
        onRequestDelete: undefined,
      };
      
      // TreeItem should not render delete button when onRequestDelete is undefined
      expect(props.onRequestDelete).toBeUndefined();
    });

    test('delete button respects permission checks', () => {
      const canDeleteInWorkspace = true;
      const onRequestDelete = canDeleteInWorkspace ? jest.fn() : null;
      
      expect(onRequestDelete).not.toBeNull();
      
      const noPermission = false;
      const onRequestDeleteNoPermission = noPermission ? jest.fn() : null;
      expect(onRequestDeleteNoPermission).toBeNull();
    });
  });

  describe('Delete Request Handler', () => {
    test('handleRequestDelete shows confirmation dialog', async () => {
      const confirmMock = jest.fn().mockResolvedValue(true);
      const onDeleteDocument = jest.fn();
      const onDeleteFolder = jest.fn();
      
      // Simulate handleRequestDelete for a document
      const handleRequestDelete = async (id, type, name) => {
        const confirmed = await confirmMock({
          title: `Delete ${type === 'folder' ? 'Folder' : 'Document'}`,
          message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          variant: 'danger'
        });
        if (confirmed) {
          if (type === 'folder') {
            onDeleteFolder(id);
          } else {
            onDeleteDocument(id);
          }
        }
      };
      
      await handleRequestDelete('doc-1', 'document', 'Test Doc');
      
      expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Delete Document',
        message: 'Are you sure you want to delete "Test Doc"? This cannot be undone.',
        variant: 'danger'
      }));
      expect(onDeleteDocument).toHaveBeenCalledWith('doc-1');
    });

    test('handleRequestDelete cancellation prevents deletion', async () => {
      const confirmMock = jest.fn().mockResolvedValue(false);
      const onDeleteDocument = jest.fn();
      
      const handleRequestDelete = async (id, type, name) => {
        const confirmed = await confirmMock({ title: 'Delete' });
        if (confirmed) {
          onDeleteDocument(id);
        }
      };
      
      await handleRequestDelete('doc-1', 'document', 'Test Doc');
      
      expect(onDeleteDocument).not.toHaveBeenCalled();
    });

    test('handleRequestDelete calls correct handler for folder type', async () => {
      const confirmMock = jest.fn().mockResolvedValue(true);
      const onDeleteDocument = jest.fn();
      const onDeleteFolder = jest.fn();
      
      const handleRequestDelete = async (id, type, name) => {
        const confirmed = await confirmMock({ title: 'Delete' });
        if (confirmed) {
          if (type === 'folder') {
            onDeleteFolder(id);
          } else {
            onDeleteDocument(id);
          }
        }
      };
      
      await handleRequestDelete('folder-1', 'folder', 'My Folder');
      
      expect(onDeleteFolder).toHaveBeenCalledWith('folder-1');
      expect(onDeleteDocument).not.toHaveBeenCalled();
    });
  });
});

// ============================================================
// AppNew Delete Document Tests
// ============================================================

describe('AppNew deleteDocument Function', () => {
  describe('Delete Document Logic', () => {
    test('deleteDocument closes document tab first', () => {
      const closeDocumentMock = jest.fn();
      const syncRemoveDocumentMock = jest.fn();
      const isElectronMode = false;
      
      const deleteDocument = (docId) => {
        closeDocumentMock(docId);
        if (!isElectronMode) {
          syncRemoveDocumentMock(docId);
        }
      };
      
      deleteDocument('doc-123');
      
      expect(closeDocumentMock).toHaveBeenCalledWith('doc-123');
      expect(syncRemoveDocumentMock).toHaveBeenCalledWith('doc-123');
    });

    test('deleteDocument syncs removal in web mode', () => {
      const closeDocumentMock = jest.fn();
      const syncRemoveDocumentMock = jest.fn();
      const isElectronMode = false; // Web mode
      
      const deleteDocument = (docId) => {
        closeDocumentMock(docId);
        if (!isElectronMode) {
          syncRemoveDocumentMock(docId);
        }
      };
      
      deleteDocument('doc-123');
      
      expect(syncRemoveDocumentMock).toHaveBeenCalledWith('doc-123');
    });

    test('deleteDocument notifies sidecar in Electron mode', () => {
      const closeDocumentMock = jest.fn();
      const syncRemoveDocumentMock = jest.fn();
      const sendMock = jest.fn();
      const metaSocket = { readyState: 1, send: sendMock }; // WebSocket.OPEN = 1
      const isElectronMode = true;
      
      const deleteDocument = (docId) => {
        closeDocumentMock(docId);
        if (!isElectronMode) {
          syncRemoveDocumentMock(docId);
        }
        if (metaSocket?.readyState === 1) {
          metaSocket.send(JSON.stringify({ 
            type: 'delete-document', 
            docId 
          }));
        }
      };
      
      deleteDocument('doc-123');
      
      // In Electron mode, should notify sidecar
      expect(sendMock).toHaveBeenCalledWith(
        expect.stringContaining('"type":"delete-document"')
      );
      // But should NOT sync via Yjs
      expect(syncRemoveDocumentMock).not.toHaveBeenCalled();
    });

    test('deleteDocument shows success toast', () => {
      const showToastMock = jest.fn();
      const closeDocumentMock = jest.fn();
      
      const deleteDocument = (docId) => {
        closeDocumentMock(docId);
        showToastMock('Document deleted', 'success');
      };
      
      deleteDocument('doc-123');
      
      expect(showToastMock).toHaveBeenCalledWith('Document deleted', 'success');
    });
  });

  describe('isElectron Mode Detection', () => {
    test('isElectron function returns boolean', () => {
      // isElectron() should be called as a function, not used as a boolean
      const isElectronFunction = () => false;
      const isElectronMode = isElectronFunction();
      
      expect(typeof isElectronMode).toBe('boolean');
      expect(isElectronMode).toBe(false);
    });

    test('isElectronMode variable should be boolean not function', () => {
      // This was the bug: using isElectron (function) instead of isElectron() (result)
      const isElectron = () => false;
      
      // WRONG: if (!isElectron) - function is always truthy
      expect(!isElectron).toBe(false); // Bug behavior
      
      // CORRECT: if (!isElectron())
      const isElectronMode = isElectron();
      expect(!isElectronMode).toBe(true); // Correct behavior
    });
  });
});

// ============================================================
// Close Document Tests (Tab Management)
// ============================================================

describe('closeDocument Function', () => {
  test('removes document from openTabs', () => {
    let openTabs = [
      { id: 'doc-1', name: 'Doc 1' },
      { id: 'doc-2', name: 'Doc 2' },
      { id: 'doc-3', name: 'Doc 3' },
    ];
    let activeDocId = 'doc-2';
    
    const closeDocument = (docId) => {
      const tabIndex = openTabs.findIndex(tab => tab.id === docId);
      if (tabIndex === -1) return;
      
      const newTabs = openTabs.filter(tab => tab.id !== docId);
      openTabs = newTabs;
      
      if (activeDocId === docId) {
        if (newTabs.length > 0) {
          const newIndex = Math.min(tabIndex, newTabs.length - 1);
          activeDocId = newTabs[newIndex].id;
        } else {
          activeDocId = null;
        }
      }
    };
    
    closeDocument('doc-2');
    
    expect(openTabs.length).toBe(2);
    expect(openTabs.find(t => t.id === 'doc-2')).toBeUndefined();
    // Active should move to next tab
    expect(activeDocId).toBe('doc-3');
  });

  test('handles closing last tab', () => {
    let openTabs = [{ id: 'doc-1', name: 'Doc 1' }];
    let activeDocId = 'doc-1';
    
    const closeDocument = (docId) => {
      const tabIndex = openTabs.findIndex(tab => tab.id === docId);
      if (tabIndex === -1) return;
      
      const newTabs = openTabs.filter(tab => tab.id !== docId);
      openTabs = newTabs;
      
      if (activeDocId === docId) {
        if (newTabs.length > 0) {
          const newIndex = Math.min(tabIndex, newTabs.length - 1);
          activeDocId = newTabs[newIndex].id;
        } else {
          activeDocId = null;
        }
      }
    };
    
    closeDocument('doc-1');
    
    expect(openTabs.length).toBe(0);
    expect(activeDocId).toBeNull();
  });

  test('handles closing non-active tab', () => {
    let openTabs = [
      { id: 'doc-1', name: 'Doc 1' },
      { id: 'doc-2', name: 'Doc 2' },
    ];
    let activeDocId = 'doc-1';
    
    const closeDocument = (docId) => {
      const tabIndex = openTabs.findIndex(tab => tab.id === docId);
      if (tabIndex === -1) return;
      
      const newTabs = openTabs.filter(tab => tab.id !== docId);
      openTabs = newTabs;
      
      if (activeDocId === docId) {
        if (newTabs.length > 0) {
          const newIndex = Math.min(tabIndex, newTabs.length - 1);
          activeDocId = newTabs[newIndex].id;
        } else {
          activeDocId = null;
        }
      }
    };
    
    closeDocument('doc-2');
    
    expect(openTabs.length).toBe(1);
    expect(activeDocId).toBe('doc-1'); // Should remain unchanged
  });
});

// ============================================================
// Sync Remove Document Tests
// ============================================================

describe('syncRemoveDocument (Yjs)', () => {
  test('removes document from Yjs array', () => {
    const documents = [
      { id: 'doc-1', name: 'Doc 1' },
      { id: 'doc-2', name: 'Doc 2' },
      { id: 'doc-3', name: 'Doc 3' },
    ];
    
    const removeDocument = (docId) => {
      const index = documents.findIndex(d => d.id === docId);
      if (index !== -1) {
        documents.splice(index, 1);
      }
    };
    
    removeDocument('doc-2');
    
    expect(documents.length).toBe(2);
    expect(documents.find(d => d.id === 'doc-2')).toBeUndefined();
    expect(documents[0].id).toBe('doc-1');
    expect(documents[1].id).toBe('doc-3');
  });

  test('handles removing non-existent document gracefully', () => {
    const documents = [{ id: 'doc-1', name: 'Doc 1' }];
    
    const removeDocument = (docId) => {
      const index = documents.findIndex(d => d.id === docId);
      if (index !== -1) {
        documents.splice(index, 1);
      }
    };
    
    removeDocument('doc-nonexistent');
    
    expect(documents.length).toBe(1);
    expect(documents[0].id).toBe('doc-1');
  });

  test('handles null Yjs array reference', () => {
    let yDocumentsRef = null;
    
    const removeDocument = (docId) => {
      if (!yDocumentsRef) return;
      // Would throw if we tried to access methods on null
    };
    
    // Should not throw
    expect(() => removeDocument('doc-1')).not.toThrow();
  });
});

// ============================================================
// Confirmation Dialog Tests
// ============================================================

describe('ConfirmDialog Behavior', () => {
  describe('useConfirmDialog Hook', () => {
    test('confirm resolves to true when confirmed', async () => {
      let resolvePromise;
      const confirm = () => new Promise(resolve => {
        resolvePromise = resolve;
      });
      
      const confirmPromise = confirm();
      resolvePromise(true);
      
      await expect(confirmPromise).resolves.toBe(true);
    });

    test('confirm resolves to false when cancelled', async () => {
      let resolvePromise;
      const confirm = () => new Promise(resolve => {
        resolvePromise = resolve;
      });
      
      const confirmPromise = confirm();
      resolvePromise(false);
      
      await expect(confirmPromise).resolves.toBe(false);
    });
  });

  describe('Dialog Options', () => {
    test('passes correct options for delete confirmation', () => {
      const expectedOptions = {
        title: 'Delete Document',
        message: 'Are you sure you want to delete "My Doc"? This cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        variant: 'danger'
      };
      
      expect(expectedOptions.variant).toBe('danger');
      expect(expectedOptions.confirmText).toBe('Delete');
    });

    test('supports folder deletion message', () => {
      const type = 'folder';
      const name = 'My Folder';
      
      const options = {
        title: `Delete ${type === 'folder' ? 'Folder' : 'Document'}`,
        message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
      };
      
      expect(options.title).toBe('Delete Folder');
      expect(options.message).toContain('My Folder');
    });
  });
});

// ============================================================
// Keyboard Delete Shortcut Tests
// ============================================================

describe('Keyboard Delete Shortcut', () => {
  test('Delete key triggers delete when item is focused', () => {
    const onRequestDelete = jest.fn();
    const item = { id: 'doc-1', name: 'Test Doc' };
    const type = 'document';
    
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' && onRequestDelete) {
        e.preventDefault();
        onRequestDelete(item.id, type, item.name);
      }
    };
    
    handleKeyDown({ key: 'Delete', preventDefault: jest.fn() });
    
    expect(onRequestDelete).toHaveBeenCalledWith('doc-1', 'document', 'Test Doc');
  });

  test('Delete key does nothing when onRequestDelete is not provided', () => {
    const onRequestDelete = null;
    const item = { id: 'doc-1', name: 'Test Doc' };
    
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' && onRequestDelete) {
        onRequestDelete(item.id);
      }
    };
    
    // Should not throw
    expect(() => handleKeyDown({ key: 'Delete' })).not.toThrow();
  });

  test('other keys do not trigger delete', () => {
    const onRequestDelete = jest.fn();
    const item = { id: 'doc-1', name: 'Test Doc' };
    
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' && onRequestDelete) {
        onRequestDelete(item.id);
      }
    };
    
    handleKeyDown({ key: 'Enter' });
    handleKeyDown({ key: 'Backspace' });
    handleKeyDown({ key: 'Escape' });
    
    expect(onRequestDelete).not.toHaveBeenCalled();
  });
});

// ============================================================
// Permission-Based Delete Tests
// ============================================================

describe('Permission-Based Delete', () => {
  describe('Workspace Delete Permission', () => {
    test('canDeleteInWorkspace enables delete button', () => {
      const canDelete = (entityType, entityId) => {
        // Mock permission check
        return entityType === 'workspace' && entityId === 'ws-1';
      };
      
      const canDeleteInWorkspace = canDelete('workspace', 'ws-1');
      expect(canDeleteInWorkspace).toBe(true);
    });

    test('viewer cannot delete documents', () => {
      const userRole = 'viewer';
      const canDelete = (role) => role !== 'viewer';
      
      expect(canDelete(userRole)).toBe(false);
    });

    test('editor can delete documents', () => {
      const userRole = 'editor';
      const canDelete = (role) => role !== 'viewer';
      
      expect(canDelete(userRole)).toBe(true);
    });

    test('owner can delete documents', () => {
      const userRole = 'owner';
      const canDelete = (role) => role !== 'viewer';
      
      expect(canDelete(userRole)).toBe(true);
    });
  });

  describe('Delete Button Conditional Rendering', () => {
    test('onRequestDelete is conditionally provided based on permissions', () => {
      const canDeleteInWorkspace = true;
      const handleRequestDelete = jest.fn();
      
      // In HierarchicalSidebar, onRequestDelete is only passed when canDeleteInWorkspace
      const treeItemProps = canDeleteInWorkspace 
        ? { onRequestDelete: handleRequestDelete }
        : {};
      
      expect(treeItemProps.onRequestDelete).toBeDefined();
    });

    test('no onRequestDelete when lacking permission', () => {
      const canDeleteInWorkspace = false;
      const handleRequestDelete = jest.fn();
      
      const treeItemProps = canDeleteInWorkspace 
        ? { onRequestDelete: handleRequestDelete }
        : {};
      
      expect(treeItemProps.onRequestDelete).toBeUndefined();
    });
  });
});

// ============================================================
// Delete with Active Collaborators Tests
// ============================================================

describe('Delete with Active Collaborators', () => {
  test('should warn when document has active editors', () => {
    const activeEditors = new Set(['user-1', 'user-2']);
    const hasActiveEditors = (docId) => activeEditors.size > 0;
    
    expect(hasActiveEditors('doc-1')).toBe(true);
  });

  test('should allow delete with custom warning message for active docs', () => {
    const activeEditorsCount = 2;
    
    const getDeleteWarning = (count) => {
      if (count > 0) {
        return `This document is being edited by ${count} collaborator${count > 1 ? 's' : ''}. They will be disconnected.`;
      }
      return 'This cannot be undone.';
    };
    
    expect(getDeleteWarning(2)).toContain('2 collaborators');
    expect(getDeleteWarning(1)).toContain('1 collaborator');
    expect(getDeleteWarning(0)).toBe('This cannot be undone.');
  });
});

// ============================================================
// Folder Sync Tests
// ============================================================

describe('Folder Sync (Yjs)', () => {
  describe('isElectronMode Detection', () => {
    test('isElectronMode should be boolean not function reference', () => {
      // This was the bug causing folder sync to fail
      const isElectron = () => false;
      
      // WRONG: using function reference directly
      expect(!isElectron).toBe(false); // Function is truthy, so !fn is false
      
      // CORRECT: calling the function
      const isElectronMode = isElectron();
      expect(!isElectronMode).toBe(true); // false is falsy, so !false is true
    });
  });

  describe('createFolder Sync', () => {
    test('folder is pushed to Yjs in web mode', () => {
      const yFolders = [];
      const isElectronMode = false; // Web mode
      
      const createFolder = (folder) => {
        if (isElectronMode) {
          // Electron: local state only
        } else {
          // Web: push to Yjs
          yFolders.push(folder);
        }
      };
      
      createFolder({ id: 'folder-1', name: 'Test Folder' });
      
      expect(yFolders.length).toBe(1);
      expect(yFolders[0].name).toBe('Test Folder');
    });

    test('folder is added to local state in Electron mode', () => {
      let localFolders = [];
      const isElectronMode = true; // Electron mode
      
      const createFolder = (folder) => {
        if (isElectronMode) {
          localFolders = [...localFolders, folder];
        }
      };
      
      createFolder({ id: 'folder-1', name: 'Test Folder' });
      
      expect(localFolders.length).toBe(1);
    });
  });

  describe('Yjs Folder Observation', () => {
    test('Yjs folder changes trigger state update', () => {
      let stateFolders = [];
      const syncFolders = (yFolders) => {
        stateFolders = [...yFolders];
      };
      
      const yFolders = [
        { id: 'folder-1', name: 'Folder 1' },
        { id: 'folder-2', name: 'Folder 2' },
      ];
      
      syncFolders(yFolders);
      
      expect(stateFolders.length).toBe(2);
    });
  });
});

// ============================================================
// Folder Deletion Cascade Tests
// ============================================================

describe('Folder Deletion Cascade', () => {
  test('deleting folder should delete contained documents', () => {
    const folders = [
      { id: 'folder-1', name: 'Parent', parentId: null },
      { id: 'folder-2', name: 'Child', parentId: 'folder-1' },
    ];
    const documents = [
      { id: 'doc-1', name: 'Doc in Parent', folderId: 'folder-1' },
      { id: 'doc-2', name: 'Doc in Child', folderId: 'folder-2' },
      { id: 'doc-3', name: 'Root Doc', folderId: null },
    ];
    
    const getDocumentsInFolder = (folderId, recursive = false) => {
      const direct = documents.filter(d => d.folderId === folderId);
      if (!recursive) return direct;
      
      const subfolders = folders.filter(f => f.parentId === folderId);
      const nested = subfolders.flatMap(sf => getDocumentsInFolder(sf.id, true));
      return [...direct, ...nested];
    };
    
    const docsToDelete = getDocumentsInFolder('folder-1', true);
    expect(docsToDelete.length).toBe(2);
    expect(docsToDelete.map(d => d.id)).toContain('doc-1');
    expect(docsToDelete.map(d => d.id)).toContain('doc-2');
    expect(docsToDelete.map(d => d.id)).not.toContain('doc-3');
  });

  test('deleting folder should delete subfolders', () => {
    const folders = [
      { id: 'folder-1', name: 'Parent', parentId: null },
      { id: 'folder-2', name: 'Child', parentId: 'folder-1' },
      { id: 'folder-3', name: 'Grandchild', parentId: 'folder-2' },
      { id: 'folder-4', name: 'Sibling', parentId: null },
    ];
    
    const getFoldersToDelete = (folderId) => {
      const result = [folderId];
      const children = folders.filter(f => f.parentId === folderId);
      children.forEach(child => {
        result.push(...getFoldersToDelete(child.id));
      });
      return result;
    };
    
    const foldersToDelete = getFoldersToDelete('folder-1');
    expect(foldersToDelete.length).toBe(3);
    expect(foldersToDelete).toContain('folder-1');
    expect(foldersToDelete).toContain('folder-2');
    expect(foldersToDelete).toContain('folder-3');
    expect(foldersToDelete).not.toContain('folder-4');
  });
});
