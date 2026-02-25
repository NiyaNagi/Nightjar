/**
 * Sheet Component Unit Tests
 * 
 * Unit tests for the Sheet (Spreadsheet) component
 * Tests component rendering, state management, and Yjs integration
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as Y from 'yjs';

// Mock Fortune Sheet since it's complex
jest.mock('@fortune-sheet/react', () => ({
  Workbook: jest.fn(({ data, onChange }) => (
    <div data-testid="fortune-sheet-mock">
      <span data-testid="sheet-data">{JSON.stringify(data)}</span>
      <button 
        data-testid="trigger-change"
        onClick={() => onChange && onChange([{ name: 'Sheet1', celldata: [{ r: 0, c: 0, v: 'test' }] }])}
      >
        Trigger Change
      </button>
    </div>
  )),
}));

// Import after mocking
import Sheet, { SHEET_TYPE, SHEET_ICON } from '../frontend/src/components/Sheet';

// Helper to create a fully mocked provider that triggers sync
const createMockProvider = () => {
  const localState = {};
  const syncHandlers = [];
  
  const mockAwareness = {
    clientID: 1,
    getLocalState: jest.fn(() => localState),
    setLocalStateField: jest.fn((field, value) => {
      localState[field] = value;
    }),
    getStates: jest.fn(() => new Map([[1, localState]])),
    on: jest.fn(),
    off: jest.fn(),
  };
  
  const mockProvider = {
    awareness: mockAwareness,
    synced: true, // Already synced
    on: jest.fn((event, handler) => {
      if (event === 'sync') {
        syncHandlers.push(handler);
        // Immediately call handler since we're already synced
        setTimeout(() => handler(true), 0);
      }
    }),
    off: jest.fn(),
  };
  
  return { mockProvider, mockAwareness, syncHandlers };
};

describe('Sheet Component', () => {
  let ydoc;
  let mockProvider;
  let mockAwareness;

  beforeEach(() => {
    // Create fresh Yjs document for each test
    ydoc = new Y.Doc();
    
    const mocks = createMockProvider();
    mockProvider = mocks.mockProvider;
    mockAwareness = mocks.mockAwareness;
  });

  afterEach(() => {
    ydoc.destroy();
    jest.clearAllMocks();
  });

  describe('Constants', () => {
    test('exports correct SHEET_TYPE', () => {
      expect(SHEET_TYPE).toBe('sheet');
    });

    test('exports correct SHEET_ICON', () => {
      expect(SHEET_ICON).toBe('📊');
    });
  });

  describe('Rendering', () => {
    test('renders loading state when not synced', () => {
      // Create a provider that is NOT synced yet
      const unsyncedProvider = {
        awareness: mockAwareness,
        synced: false,
        on: jest.fn(),
        off: jest.fn(),
      };
      render(<Sheet ydoc={ydoc} provider={unsyncedProvider} />);
      expect(screen.getByText(/loading spreadsheet/i)).toBeInTheDocument();
    });

    test('renders Fortune Sheet after initialization', async () => {
      render(<Sheet ydoc={ydoc} provider={mockProvider} />);
      
      // Wait for Yjs to initialize
      await waitFor(() => {
        expect(screen.getByTestId('fortune-sheet-mock')).toBeInTheDocument();
      });
    });

    test('passes data to Fortune Sheet', async () => {
      render(<Sheet ydoc={ydoc} provider={mockProvider} />);
      
      await waitFor(() => {
        const dataSpan = screen.getByTestId('sheet-data');
        const data = JSON.parse(dataSpan.textContent);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Yjs Integration', () => {
    test('creates sheet-meta map in Yjs', async () => {
      render(<Sheet ydoc={ydoc} provider={mockProvider} />);
      
      await waitFor(() => {
        const ymeta = ydoc.getMap('sheet-meta');
        expect(ymeta.size).toBeGreaterThan(0);
      });
    });

    test('initializes with default sheet structure', async () => {
      render(<Sheet ydoc={ydoc} provider={mockProvider} />);
      
      await waitFor(() => {
        const ymeta = ydoc.getMap('sheet-meta');
        expect(ymeta.size).toBe(1);
        const firstId = [...ymeta.keys()][0];
        const meta = ymeta.get(firstId);
        expect(meta).toBeDefined();
        expect(meta.name).toBe('Sheet1');
        expect(meta.row).toBe(100);
        expect(meta.column).toBe(26);
      });
    });

    test('loads existing data from Yjs', async () => {
      // Pre-populate Yjs
      const ysheet = ydoc.getMap('sheet-data');
      ysheet.set('sheets', [{
        name: 'Existing Sheet',
        id: 'existing-1',
        row: 50,
        column: 10,
        celldata: [{ r: 0, c: 0, v: 'Hello' }],
        config: {},
        status: 1,
      }]);

      render(<Sheet ydoc={ydoc} provider={mockProvider} />);
      
      await waitFor(() => {
        const dataSpan = screen.getByTestId('sheet-data');
        const data = JSON.parse(dataSpan.textContent);
        expect(data[0].name).toBe('Existing Sheet');
      });
    });
  });

  describe('Event Handlers', () => {
    test('handles onChange from Fortune Sheet', async () => {
      render(<Sheet ydoc={ydoc} provider={mockProvider} />);
      
      await waitFor(() => {
        expect(screen.getByTestId('fortune-sheet-mock')).toBeInTheDocument();
      });

      // Trigger a change
      fireEvent.click(screen.getByTestId('trigger-change'));

      await waitFor(() => {
        const ymeta = ydoc.getMap('sheet-meta');
        // Should have written sheet metadata after the change
        expect(ymeta.size).toBeGreaterThan(0);
      });
    });

    test('syncs via full-sheet path only (op-based path removed)', async () => {
      render(<Sheet ydoc={ydoc} provider={mockProvider} />);
      
      await waitFor(() => {
        expect(screen.getByTestId('fortune-sheet-mock')).toBeInTheDocument();
      });

      // The op-based Y.Array path has been removed (Issue #16).
      // Sync now relies solely on full-sheet setData via Y.Map.
      // Verify that Y.Array 'sheet-ops' is empty (cleaned up on init).
      const yOps = ydoc.getArray('sheet-ops');
      expect(yOps.length).toBe(0);
      
      // Verify Workbook no longer receives onOp prop
      const { Workbook } = require('@fortune-sheet/react');
      const lastCall = Workbook.mock.calls[Workbook.mock.calls.length - 1];
      if (lastCall) {
        const props = lastCall[0];
        expect(props.onOp).toBeUndefined();
      }
    });
  });

  describe('Props', () => {
    test('accepts userColor prop', async () => {
      render(<Sheet ydoc={ydoc} provider={mockProvider} userColor="#ff0000" />);
      
      await waitFor(() => {
        expect(screen.getByTestId('fortune-sheet-mock')).toBeInTheDocument();
      });
    });

    test('accepts userHandle prop', async () => {
      render(<Sheet ydoc={ydoc} provider={mockProvider} userHandle="TestUser" />);
      
      await waitFor(() => {
        expect(screen.getByTestId('fortune-sheet-mock')).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    test('handles null ydoc gracefully', () => {
      render(<Sheet ydoc={null} provider={mockProvider} />);
      expect(screen.getByText(/loading spreadsheet/i)).toBeInTheDocument();
    });

    test('handles null provider gracefully', async () => {
      render(<Sheet ydoc={ydoc} provider={null} />);
      
      // With null provider, the sheet should show loading or render without awareness
      await waitFor(() => {
        // Either shows loading or the sheet without awareness features
        const loading = screen.queryByText(/loading spreadsheet/i);
        const sheet = screen.queryByTestId('fortune-sheet-mock');
        expect(loading || sheet).toBeTruthy();
      });
    });
  });
});

describe('Sheet Default Configuration', () => {
  test('default sheet has Google Sheets dimensions (26 cols x 100 rows)', async () => {
    const ydoc = new Y.Doc();
    const { mockProvider } = createMockProvider();
    
    render(<Sheet ydoc={ydoc} provider={mockProvider} />);
    
    await waitFor(() => {
      const ymeta = ydoc.getMap('sheet-meta');
      expect(ymeta.size).toBeGreaterThan(0);
      const firstId = [...ymeta.keys()][0];
      const meta = ymeta.get(firstId);
      expect(meta.column).toBe(26);
      expect(meta.row).toBe(100);
    }, { timeout: 3000 });

    ydoc.destroy();
  });
});
