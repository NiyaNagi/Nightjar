/**
 * Test Suite: Breadcrumbs
 * Tests for navigation path rendering and functionality
 */

import { describe, test, expect, jest } from '@jest/globals';

describe('Breadcrumbs Logic', () => {
  // Simulated breadcrumb path building
  const buildBreadcrumbPath = (currentDocument, folders, workspace) => {
    const path = [];
    
    // Add workspace
    if (workspace) {
      path.push({
        id: workspace.id,
        name: workspace.name,
        type: 'workspace',
      });
    }
    
    // Add folder hierarchy
    if (currentDocument?.folderId && folders) {
      const folderPath = [];
      let currentFolderId = currentDocument.folderId;
      
      while (currentFolderId) {
        const folder = folders.find(f => f.id === currentFolderId);
        if (!folder) break;
        
        folderPath.unshift({
          id: folder.id,
          name: folder.name,
          type: 'folder',
        });
        currentFolderId = folder.parentId;
      }
      
      path.push(...folderPath);
    }
    
    // Add current document
    if (currentDocument) {
      path.push({
        id: currentDocument.id,
        name: currentDocument.name || 'Untitled',
        type: 'document',
      });
    }
    
    return path;
  };

  describe('Path Building', () => {
    test('builds path with workspace only', () => {
      const workspace = { id: 'ws-1', name: 'My Workspace' };
      
      const path = buildBreadcrumbPath(null, [], workspace);
      
      expect(path.length).toBe(1);
      expect(path[0].type).toBe('workspace');
      expect(path[0].name).toBe('My Workspace');
    });

    test('builds path with workspace and document', () => {
      const workspace = { id: 'ws-1', name: 'My Workspace' };
      const doc = { id: 'doc-1', name: 'Test Document' };
      
      const path = buildBreadcrumbPath(doc, [], workspace);
      
      expect(path.length).toBe(2);
      expect(path[0].type).toBe('workspace');
      expect(path[1].type).toBe('document');
      expect(path[1].name).toBe('Test Document');
    });

    test('builds full path with folder', () => {
      const workspace = { id: 'ws-1', name: 'My Workspace' };
      const folders = [
        { id: 'f-1', name: 'Documents', parentId: null },
      ];
      const doc = { id: 'doc-1', name: 'Test', folderId: 'f-1' };
      
      const path = buildBreadcrumbPath(doc, folders, workspace);
      
      expect(path.length).toBe(3);
      expect(path[0].type).toBe('workspace');
      expect(path[1].type).toBe('folder');
      expect(path[2].type).toBe('document');
    });

    test('builds path with nested folders', () => {
      const workspace = { id: 'ws-1', name: 'Workspace' };
      const folders = [
        { id: 'f-1', name: 'Level 1', parentId: null },
        { id: 'f-2', name: 'Level 2', parentId: 'f-1' },
        { id: 'f-3', name: 'Level 3', parentId: 'f-2' },
      ];
      const doc = { id: 'doc-1', name: 'Deep Doc', folderId: 'f-3' };
      
      const path = buildBreadcrumbPath(doc, folders, workspace);
      
      expect(path.length).toBe(5); // workspace + 3 folders + document
      expect(path[1].name).toBe('Level 1');
      expect(path[2].name).toBe('Level 2');
      expect(path[3].name).toBe('Level 3');
    });

    test('uses Untitled for unnamed documents', () => {
      const workspace = { id: 'ws-1', name: 'Workspace' };
      const doc = { id: 'doc-1', name: '' };
      
      const path = buildBreadcrumbPath(doc, [], workspace);
      
      expect(path[1].name).toBe('Untitled');
    });
  });

  describe('Path Truncation', () => {
    const truncatePath = (path, maxItems = 4) => {
      if (path.length <= maxItems) return path;
      
      // Keep first item, ellipsis, and last (maxItems - 2) items
      const first = path[0];
      const lastItems = path.slice(-(maxItems - 2));
      
      return [
        first,
        { id: 'ellipsis', name: '...', type: 'ellipsis' },
        ...lastItems,
      ];
    };

    test('does not truncate short paths', () => {
      const path = [
        { id: 'ws', name: 'Workspace', type: 'workspace' },
        { id: 'f', name: 'Folder', type: 'folder' },
        { id: 'd', name: 'Doc', type: 'document' },
      ];
      
      const result = truncatePath(path);
      
      expect(result.length).toBe(3);
      expect(result).toEqual(path);
    });

    test('truncates long paths with ellipsis', () => {
      const path = [
        { id: 'ws', name: 'Workspace', type: 'workspace' },
        { id: 'f1', name: 'Folder 1', type: 'folder' },
        { id: 'f2', name: 'Folder 2', type: 'folder' },
        { id: 'f3', name: 'Folder 3', type: 'folder' },
        { id: 'f4', name: 'Folder 4', type: 'folder' },
        { id: 'd', name: 'Doc', type: 'document' },
      ];
      
      const result = truncatePath(path, 4);
      
      expect(result.length).toBe(4);
      expect(result[0].type).toBe('workspace');
      expect(result[1].type).toBe('ellipsis');
      expect(result[1].name).toBe('...');
      expect(result[3].type).toBe('document');
    });

    test('preserves first and last items', () => {
      const path = [
        { id: 'ws', name: 'Workspace', type: 'workspace' },
        { id: 'f1', name: 'Skip 1', type: 'folder' },
        { id: 'f2', name: 'Skip 2', type: 'folder' },
        { id: 'f3', name: 'Keep 1', type: 'folder' },
        { id: 'd', name: 'Keep 2', type: 'document' },
      ];
      
      const result = truncatePath(path, 4);
      
      expect(result[0].name).toBe('Workspace');
      expect(result[2].name).toBe('Keep 1');
      expect(result[3].name).toBe('Keep 2');
    });
  });

  describe('Breadcrumb Navigation', () => {
    test('generates correct navigation targets', () => {
      const path = [
        { id: 'ws-1', name: 'Workspace', type: 'workspace' },
        { id: 'f-1', name: 'Folder', type: 'folder' },
        { id: 'doc-1', name: 'Document', type: 'document' },
      ];
      
      const getNavigationTarget = (item) => {
        switch (item.type) {
          case 'workspace':
            return { action: 'selectWorkspace', id: item.id };
          case 'folder':
            return { action: 'openFolder', id: item.id };
          case 'document':
            return { action: 'openDocument', id: item.id };
          default:
            return null;
        }
      };
      
      expect(getNavigationTarget(path[0])).toEqual({ 
        action: 'selectWorkspace', 
        id: 'ws-1' 
      });
      expect(getNavigationTarget(path[1])).toEqual({ 
        action: 'openFolder', 
        id: 'f-1' 
      });
      expect(getNavigationTarget(path[2])).toEqual({ 
        action: 'openDocument', 
        id: 'doc-1' 
      });
    });

    test('ellipsis has no navigation target', () => {
      const ellipsis = { id: 'ellipsis', name: '...', type: 'ellipsis' };
      
      const isNavigable = (item) => item.type !== 'ellipsis';
      
      expect(isNavigable(ellipsis)).toBe(false);
    });
  });

  describe('Breadcrumb Display', () => {
    test('formats names correctly', () => {
      const formatName = (name, maxLength = 20) => {
        if (name.length <= maxLength) return name;
        return name.substring(0, maxLength - 3) + '...';
      };
      
      expect(formatName('Short')).toBe('Short');
      expect(formatName('This is a very long folder name that should be truncated'))
        .toBe('This is a very lo...');
    });

    test('separators between items', () => {
      const renderPath = (path) => {
        return path.map(item => item.name).join(' / ');
      };
      
      const path = [
        { name: 'Workspace' },
        { name: 'Folder' },
        { name: 'Document' },
      ];
      
      expect(renderPath(path)).toBe('Workspace / Folder / Document');
    });
  });
});

describe('Breadcrumb Accessibility', () => {
  test('generates aria labels', () => {
    const getAriaLabel = (item, isLast) => {
      if (isLast) {
        return `Current location: ${item.name}`;
      }
      return `Navigate to ${item.type}: ${item.name}`;
    };
    
    const workspace = { name: 'My Workspace', type: 'workspace' };
    const doc = { name: 'My Document', type: 'document' };
    
    expect(getAriaLabel(workspace, false))
      .toBe('Navigate to workspace: My Workspace');
    expect(getAriaLabel(doc, true))
      .toBe('Current location: My Document');
  });

  test('last item is not a link', () => {
    const isClickable = (item, isLast) => {
      if (isLast) return false;
      if (item.type === 'ellipsis') return false;
      return true;
    };
    
    expect(isClickable({ type: 'workspace' }, false)).toBe(true);
    expect(isClickable({ type: 'folder' }, false)).toBe(true);
    expect(isClickable({ type: 'document' }, true)).toBe(false);
    expect(isClickable({ type: 'ellipsis' }, false)).toBe(false);
  });
});
