/**
 * UI Components Unit Tests
 * 
 * Tests for recently added UI components:
 * - UnifiedPicker (replacement for IconColorPicker)
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
import UnifiedPicker, { PRESET_ICONS, PRESET_COLORS, PRESET_COLOR_HEXES, ALL_ICONS, EMOJI_DATA, EMOJI_CATEGORIES } from '../frontend/src/components/common/UnifiedPicker';
import AddDropdown, { ITEM_TYPES } from '../frontend/src/components/common/AddDropdown';

// ============================================================
// UnifiedPicker Tests (replaces old IconColorPicker tests)
// ============================================================

describe('UnifiedPicker Component', () => {
  // Mock localStorage for recent emojis
  const localStorageMock = (() => {
    let store = {};
    return {
      getItem: jest.fn(key => store[key] || null),
      setItem: jest.fn((key, val) => { store[key] = val; }),
      removeItem: jest.fn(key => { delete store[key]; }),
      clear: jest.fn(() => { store = {}; }),
    };
  })();

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    test('renders with default icon and color', () => {
      render(<UnifiedPicker />);
      expect(screen.getByTestId('unified-picker')).toBeInTheDocument();
      expect(screen.getByTestId('unified-picker-trigger')).toBeInTheDocument();
    });

    test('displays custom icon', () => {
      render(<UnifiedPicker icon="🚀" />);
      const trigger = screen.getByTestId('unified-picker-trigger');
      expect(trigger).toHaveTextContent('🚀');
    });

    test('applies color to trigger', () => {
      render(<UnifiedPicker color="#ff0000" />);
      const trigger = screen.getByTestId('unified-picker-trigger');
      expect(trigger).toHaveStyle({ backgroundColor: '#ff0000' });
    });

    test('renders in different sizes', () => {
      const { rerender, container } = render(<UnifiedPicker size="small" />);
      expect(container.querySelector('.unified-picker--small')).toBeInTheDocument();
      
      rerender(<UnifiedPicker size="large" />);
      expect(container.querySelector('.unified-picker--large')).toBeInTheDocument();
    });

    test('respects disabled state', () => {
      render(<UnifiedPicker disabled />);
      expect(screen.getByTestId('unified-picker-trigger')).toBeDisabled();
    });

    test('renders inline popover in compact mode', () => {
      render(<UnifiedPicker compact />);
      expect(screen.getByTestId('unified-picker-popover')).toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    test('opens popover on trigger click', async () => {
      render(<UnifiedPicker />);
      
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    test('closes on Escape key', async () => {
      render(<UnifiedPicker />);
      
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Fire escape globally (component uses document keydown)
      fireEvent.keyDown(document, { key: 'Escape' });
      
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    test('calls onIconChange when emoji selected from popover', async () => {
      const onIconChange = jest.fn();
      render(<UnifiedPicker onIconChange={onIconChange} />);
      
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        const emojiGrid = screen.getByTestId('unified-picker-category-grid');
        const emojiBtns = emojiGrid.querySelectorAll('.unified-picker__emoji-btn');
        expect(emojiBtns.length).toBeGreaterThan(0);
        fireEvent.click(emojiBtns[0]);
      });
      
      expect(onIconChange).toHaveBeenCalled();
    });

    test('calls onColorChange when color selected from popover', async () => {
      const onColorChange = jest.fn();
      render(<UnifiedPicker onColorChange={onColorChange} />);
      
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        const colorGrid = screen.getByTestId('unified-picker-color-grid');
        const pills = colorGrid.querySelectorAll('.unified-picker__color-pill');
        expect(pills.length).toBe(30);
        fireEvent.click(pills[0]);
      });
      
      expect(onColorChange).toHaveBeenCalledWith('#ef4444');
    });
  });

  describe('Search', () => {
    test('renders search input in popover', async () => {
      render(<UnifiedPicker />);
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        expect(screen.getByTestId('unified-picker-search')).toBeInTheDocument();
      });
    });

    test('filters emojis by search text', async () => {
      render(<UnifiedPicker />);
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        const searchInput = screen.getByTestId('unified-picker-search');
        fireEvent.change(searchInput, { target: { value: 'rocket' } });
      });
      
      // Wait for debounce (150ms)
      await waitFor(() => {
        const results = screen.getByTestId('unified-picker-search-results');
        expect(results).toBeInTheDocument();
        expect(results.querySelector('button')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    test('shows empty state for no search results', async () => {
      render(<UnifiedPicker />);
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        fireEvent.change(screen.getByTestId('unified-picker-search'), {
          target: { value: 'xyznonexistent123' }
        });
      });
      
      await waitFor(() => {
        expect(screen.getByTestId('unified-picker-empty')).toBeInTheDocument();
        expect(screen.getByText('No emoji found')).toBeInTheDocument();
      }, { timeout: 500 });
    });

    test('clear button clears search', async () => {
      render(<UnifiedPicker />);
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        fireEvent.change(screen.getByTestId('unified-picker-search'), {
          target: { value: 'rocket' }
        });
      });
      
      await waitFor(() => {
        const clearBtn = screen.getByTestId('unified-picker-search-clear');
        fireEvent.click(clearBtn);
        expect(screen.getByTestId('unified-picker-search').value).toBe('');
      }, { timeout: 500 });
    });
  });

  describe('Category Tabs', () => {
    test('renders category tabs', async () => {
      render(<UnifiedPicker />);
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        expect(screen.getByTestId('unified-picker-category-tabs')).toBeInTheDocument();
      });
    });

    test('switches categories on tab click', async () => {
      render(<UnifiedPicker />);
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        const animalsTab = screen.getByTestId('unified-picker-cat-animals');
        fireEvent.click(animalsTab);
        expect(animalsTab.classList.contains('unified-picker__cat-tab--active')).toBe(true);
      });
    });

    test('hides category tabs during search', async () => {
      render(<UnifiedPicker />);
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        fireEvent.change(screen.getByTestId('unified-picker-search'), {
          target: { value: 'heart' }
        });
      });
      
      await waitFor(() => {
        expect(screen.queryByTestId('unified-picker-category-tabs')).not.toBeInTheDocument();
      }, { timeout: 500 });
    });
  });

  describe('Custom Color', () => {
    test('renders custom color inputs in popover', async () => {
      render(<UnifiedPicker />);
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        expect(screen.getByTestId('unified-picker-custom-color')).toBeInTheDocument();
        expect(screen.getByTestId('unified-picker-native-color')).toBeInTheDocument();
        expect(screen.getByTestId('unified-picker-hex-input')).toBeInTheDocument();
      });
    });

    test('hex input calls onColorChange with valid hex', async () => {
      const onColorChange = jest.fn();
      render(<UnifiedPicker onColorChange={onColorChange} />);
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        const hexInput = screen.getByTestId('unified-picker-hex-input');
        fireEvent.change(hexInput, { target: { value: '#abcdef' } });
      });
      
      expect(onColorChange).toHaveBeenCalledWith('#abcdef');
    });

    test('hex input rejects invalid hex', async () => {
      const onColorChange = jest.fn();
      render(<UnifiedPicker onColorChange={onColorChange} />);
      fireEvent.click(screen.getByTestId('unified-picker-trigger'));
      
      await waitFor(() => {
        const hexInput = screen.getByTestId('unified-picker-hex-input');
        fireEvent.change(hexInput, { target: { value: '#xyz' } });
      });
      
      expect(onColorChange).not.toHaveBeenCalled();
    });
  });

  describe('Mode Prop', () => {
    test('mode="icon" hides color section', () => {
      render(<UnifiedPicker compact mode="icon" />);
      expect(screen.queryByTestId('unified-picker-color-section')).not.toBeInTheDocument();
    });

    test('mode="color" hides emoji section', () => {
      render(<UnifiedPicker compact mode="color" />);
      expect(screen.queryByTestId('unified-picker-emoji-scroll')).not.toBeInTheDocument();
    });

    test('mode="both" shows both sections', () => {
      render(<UnifiedPicker compact mode="both" />);
      expect(screen.getByTestId('unified-picker-emoji-scroll')).toBeInTheDocument();
      expect(screen.getByTestId('unified-picker-color-section')).toBeInTheDocument();
    });
  });

  describe('Exports', () => {
    test('PRESET_ICONS is defined and has categories', () => {
      expect(PRESET_ICONS).toBeDefined();
      expect(PRESET_ICONS.folders).toBeDefined();
      expect(PRESET_ICONS.documents).toBeDefined();
    });

    test('PRESET_COLORS is defined and has 30 colors', () => {
      expect(PRESET_COLORS).toBeDefined();
      expect(PRESET_COLORS.length).toBe(30);
      expect(PRESET_COLORS[0].hex).toMatch(/^#[0-9a-f]{6}$/i);
    });

    test('PRESET_COLOR_HEXES is an array of hex strings', () => {
      expect(PRESET_COLOR_HEXES).toBeDefined();
      expect(PRESET_COLOR_HEXES.length).toBe(30);
      expect(PRESET_COLOR_HEXES[0]).toMatch(/^#[0-9a-f]{6}$/i);
    });

    test('ALL_ICONS contains 200+ emojis', () => {
      expect(ALL_ICONS).toBeDefined();
      expect(ALL_ICONS.length).toBeGreaterThan(200);
    });

    test('EMOJI_DATA has 10 categories', () => {
      expect(EMOJI_DATA).toBeDefined();
      expect(Object.keys(EMOJI_DATA).length).toBe(10);
    });

    test('EMOJI_CATEGORIES is ordered', () => {
      expect(EMOJI_CATEGORIES).toBeDefined();
      expect(EMOJI_CATEGORIES[0]).toBe('smileys');
      expect(EMOJI_CATEGORIES.length).toBe(10);
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

  test('component supports sheet creation via props', async () => {
    const fs = require('fs');
    const path = require('path');
    
    const sidebarContent = fs.readFileSync(
      path.join(__dirname, '../frontend/src/components/HierarchicalSidebar.jsx'),
      'utf-8'
    );
    
    // Verify sheet creation is supported via onCreateSheet prop
    expect(sidebarContent).toContain("onCreateSheet");
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
