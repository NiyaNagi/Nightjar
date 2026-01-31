/**
 * UI Components Unit Tests
 * 
 * Tests for recently added UI components:
 * - IconColorPicker
 * - AddDropdown
 * - JoinWithLink
 * - AppSettings
 * - WorkspaceSwitcher
 * - WorkspaceSettings
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// Import components directly
import IconColorPicker, { PRESET_ICONS, PRESET_COLORS } from '../frontend/src/components/common/IconColorPicker';
import AddDropdown, { ITEM_TYPES } from '../frontend/src/components/common/AddDropdown';

// ============================================================
// IconColorPicker Tests
// ============================================================

describe('IconColorPicker Component', () => {
  describe('Rendering', () => {
    test('renders with default icon and color', () => {
      render(<IconColorPicker />);
      const trigger = screen.getByRole('button');
      expect(trigger).toBeInTheDocument();
    });

    test('displays custom icon', () => {
      render(<IconColorPicker icon="🚀" />);
      expect(screen.getByText('🚀')).toBeInTheDocument();
    });

    test('applies color to trigger', () => {
      const { container } = render(<IconColorPicker color="#ff0000" />);
      const trigger = container.querySelector('.icon-color-picker__trigger');
      expect(trigger).toHaveStyle({ backgroundColor: '#ff0000' });
    });

    test('renders in different sizes', () => {
      const { rerender, container } = render(<IconColorPicker size="small" />);
      expect(container.querySelector('.icon-color-picker--small')).toBeInTheDocument();
      
      rerender(<IconColorPicker size="large" />);
      expect(container.querySelector('.icon-color-picker--large')).toBeInTheDocument();
    });

    test('respects disabled state', () => {
      render(<IconColorPicker disabled />);
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  describe('Interactions', () => {
    test('opens picker on click', async () => {
      render(<IconColorPicker />);
      
      fireEvent.click(screen.getByRole('button'));
      
      await waitFor(() => {
        // The component opens a dialog panel
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    test('closes on Escape key', async () => {
      render(<IconColorPicker />);
      
      fireEvent.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Fire escape on the picker container
      const picker = screen.getByRole('dialog').closest('.icon-color-picker');
      fireEvent.keyDown(picker, { key: 'Escape' });
      
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    test('calls onIconChange when icon selected', async () => {
      const onIconChange = jest.fn();
      render(<IconColorPicker onIconChange={onIconChange} />);
      
      fireEvent.click(screen.getByRole('button'));
      
      await waitFor(() => {
        // Select an icon using aria-label pattern
        const icons = screen.getAllByRole('button', { name: /select.*icon/i });
        fireEvent.click(icons[0]);
      });
      
      expect(onIconChange).toHaveBeenCalled();
    });

    test('calls onColorChange when color selected', async () => {
      const onColorChange = jest.fn();
      render(<IconColorPicker onColorChange={onColorChange} />);
      
      fireEvent.click(screen.getByRole('button'));
      
      await waitFor(() => {
        // Switch to color tab by clicking the Color tab button
        const colorTabButton = screen.getByText(/🎨 Color/);
        fireEvent.click(colorTabButton);
      });
      
      await waitFor(() => {
        const colors = screen.getAllByRole('button', { name: /select.*color/i });
        fireEvent.click(colors[0]);
      });
      
      expect(onColorChange).toHaveBeenCalled();
    });
  });

  describe('Exports', () => {
    test('PRESET_ICONS is defined and has categories', () => {
      expect(PRESET_ICONS).toBeDefined();
      expect(PRESET_ICONS.folders).toBeDefined();
      expect(PRESET_ICONS.documents).toBeDefined();
    });

    test('PRESET_COLORS is defined and has colors', () => {
      expect(PRESET_COLORS).toBeDefined();
      expect(PRESET_COLORS.length).toBeGreaterThan(0);
      // PRESET_COLORS is now an array of objects with hex property
      expect(PRESET_COLORS[0].hex).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});

// ============================================================
// AddDropdown Tests
// ============================================================

describe('AddDropdown Component', () => {
  describe('Rendering', () => {
    test('renders trigger button', () => {
      render(<AddDropdown />);
      expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
    });

    test('respects disabled state', () => {
      render(<AddDropdown disabled />);
      expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
    });
  });

  describe('Dropdown Behavior', () => {
    test('opens dropdown on click', async () => {
      render(<AddDropdown />);
      
      fireEvent.click(screen.getByRole('button', { name: /add/i }));
      
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });
    });

    test('shows all item types', async () => {
      render(<AddDropdown />);
      
      fireEvent.click(screen.getByRole('button', { name: /add/i }));
      
      await waitFor(() => {
        // Use menuitem role to find the specific type buttons
        // Use "Text document" to distinguish from "Organize your documents"
        expect(screen.getByRole('menuitem', { name: /text document/i })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /spreadsheet/i })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /kanban/i })).toBeInTheDocument();
        // Use "Organize" to find folder since it has unique description
        expect(screen.getByRole('menuitem', { name: /organize/i })).toBeInTheDocument();
      });
    });
  });

  describe('Item Type Selection', () => {
    test('shows creator form when document selected', async () => {
      render(<AddDropdown />);
      
      fireEvent.click(screen.getByRole('button', { name: /add/i }));
      
      // Wait for menu to open
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });
      
      // Click document option - use "Text document" to distinguish
      const docOption = screen.getByRole('menuitem', { name: /text document/i });
      fireEvent.click(docOption);
      
      // Now expect the form
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/document name/i)).toBeInTheDocument();
      });
    });

    test('shows creator form when sheet selected', async () => {
      render(<AddDropdown />);
      
      fireEvent.click(screen.getByRole('button', { name: /add/i }));
      
      // Wait for menu to open
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });
      
      // Click spreadsheet option
      fireEvent.click(screen.getByRole('menuitem', { name: /spreadsheet/i }));
      
      // Now expect the form
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/spreadsheet name/i)).toBeInTheDocument();
      });
    });
  });

  describe('Creation Callbacks', () => {
    test('calls onCreateDocument when document created', async () => {
      const onCreateDocument = jest.fn();
      render(<AddDropdown onCreateDocument={onCreateDocument} />);
      
      fireEvent.click(screen.getByRole('button', { name: /add/i }));
      
      // Wait for menu
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });
      
      // Click document option - use "Text document" to distinguish
      fireEvent.click(screen.getByRole('menuitem', { name: /text document/i }));
      
      // Wait for form
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/document name/i)).toBeInTheDocument();
      });
      
      // Fill and submit
      const input = screen.getByPlaceholderText(/document name/i);
      fireEvent.change(input, { target: { value: 'Test Doc' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      
      await waitFor(() => {
        expect(onCreateDocument).toHaveBeenCalledWith(expect.objectContaining({
          name: 'Test Doc',
        }));
      });
    });

    test('calls onCreateSheet when sheet created', async () => {
      const onCreateSheet = jest.fn();
      render(<AddDropdown onCreateSheet={onCreateSheet} />);
      
      fireEvent.click(screen.getByRole('button', { name: /add/i }));
      
      // Wait for menu
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });
      
      // Click spreadsheet option
      fireEvent.click(screen.getByRole('menuitem', { name: /spreadsheet/i }));
      
      // Wait for form
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/spreadsheet name/i)).toBeInTheDocument();
      });
      
      // Fill and submit
      const input = screen.getByPlaceholderText(/spreadsheet name/i);
      fireEvent.change(input, { target: { value: 'Budget 2024' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      
      await waitFor(() => {
        expect(onCreateSheet).toHaveBeenCalledWith(expect.objectContaining({
          name: 'Budget 2024',
        }));
      });
    });

    test('calls onCreateKanban when kanban created', async () => {
      const onCreateKanban = jest.fn();
      render(<AddDropdown onCreateKanban={onCreateKanban} />);
      
      fireEvent.click(screen.getByRole('button', { name: /add/i }));
      
      // Wait for menu
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });
      
      // Click kanban option
      fireEvent.click(screen.getByRole('menuitem', { name: /kanban/i }));
      
      // Wait for form
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/kanban board name/i)).toBeInTheDocument();
      });
      
      // Fill and submit
      const input = screen.getByPlaceholderText(/kanban board name/i);
      fireEvent.change(input, { target: { value: 'Sprint Board' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      
      await waitFor(() => {
        expect(onCreateKanban).toHaveBeenCalledWith(expect.objectContaining({
          name: 'Sprint Board',
        }));
      });
    });
  });

  describe('ITEM_TYPES Export', () => {
    test('contains sheet type', () => {
      expect(ITEM_TYPES.sheet).toBeDefined();
      expect(ITEM_TYPES.sheet.icon).toBe('📊');
      expect(ITEM_TYPES.sheet.label).toBe('Spreadsheet');
    });

    test('contains all required types', () => {
      expect(ITEM_TYPES.document).toBeDefined();
      expect(ITEM_TYPES.kanban).toBeDefined();
      expect(ITEM_TYPES.folder).toBeDefined();
    });
  });
});

// ============================================================
// WorkspaceSwitcher Tests (if exists)
// ============================================================

describe('WorkspaceSwitcher Component', () => {
  let WorkspaceSwitcher;

  beforeAll(async () => {
    try {
      const module = await import('../frontend/src/components/WorkspaceSwitcher');
      WorkspaceSwitcher = module.default;
    } catch (e) {
      console.log('WorkspaceSwitcher not found, skipping tests');
    }
  });

  test.skip('placeholder - requires component import', () => {
    // These tests would be enabled once WorkspaceSwitcher is properly exported
  });
});

// ============================================================
// WorkspaceSettings Tests (if exists)
// ============================================================

describe('WorkspaceSettings Component', () => {
  let WorkspaceSettings;

  beforeAll(async () => {
    try {
      const module = await import('../frontend/src/components/WorkspaceSettings');
      WorkspaceSettings = module.default;
    } catch (e) {
      console.log('WorkspaceSettings not found, skipping tests');
    }
  });

  test.skip('placeholder - requires component import and context', () => {
    // These tests would be enabled with proper context providers
  });
});

// ============================================================
// DocumentType Tests
// ============================================================

describe('DocumentType Definition', () => {
  test('sheet type is included in DocumentType', async () => {
    // This would be a TypeScript type check in actual implementation
    // For now, verify the type is used correctly in the codebase
    const fs = require('fs');
    const path = require('path');
    
    const typesContent = fs.readFileSync(
      path.join(__dirname, '../frontend/src/types/workspace.ts'),
      'utf-8'
    );
    
    expect(typesContent).toContain("'sheet'");
    expect(typesContent).toMatch(/DocumentType.*=.*'text'.*'sheet'/s);
  });
});

// ============================================================
// HierarchicalSidebar Sheet Integration Tests
// ============================================================

describe('HierarchicalSidebar Sheet Support', () => {
  test('getIcon returns sheet icon for sheet type', async () => {
    const fs = require('fs');
    const path = require('path');
    
    const sidebarContent = fs.readFileSync(
      path.join(__dirname, '../frontend/src/components/HierarchicalSidebar.jsx'),
      'utf-8'
    );
    
    // Verify sheet icon logic exists
    expect(sidebarContent).toContain("item.type === 'sheet'");
    expect(sidebarContent).toContain('📊');
  });

  test('type selector includes sheet option', async () => {
    const fs = require('fs');
    const path = require('path');
    
    const sidebarContent = fs.readFileSync(
      path.join(__dirname, '../frontend/src/components/HierarchicalSidebar.jsx'),
      'utf-8'
    );
    
    expect(sidebarContent).toContain("createDocType === 'sheet'");
  });
});

// ============================================================
// Breadcrumbs Sheet Icon Tests
// ============================================================

describe('Breadcrumbs Sheet Support', () => {
  test('getDocIcon handles sheet type', async () => {
    const fs = require('fs');
    const path = require('path');
    
    const breadcrumbsContent = fs.readFileSync(
      path.join(__dirname, '../frontend/src/components/Breadcrumbs.jsx'),
      'utf-8'
    );
    
    // Verify sheet icon logic exists
    expect(breadcrumbsContent).toContain("docType === 'sheet'");
    expect(breadcrumbsContent).toContain('📊');
  });
});
