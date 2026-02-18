/**
 * SearchPalette component tests.
 *
 * Separated from cross-app-search.test.js because jest.mock() is hoisted
 * and would conflict with the real SearchIndexCache tests.
 */
import { jest } from '@jest/globals';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Mock SearchIndexCache (hoisted by Jest) ─────────────────────────
jest.mock('../frontend/src/services/SearchIndexCache', () => ({
    __esModule: true,
    buildIndex: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockReturnValue([]),
    invalidate: jest.fn(),
    clearCache: jest.fn(),
    cacheSize: jest.fn().mockReturnValue(0),
    handleIndexResults: jest.fn(),
}));

import SearchPalette from '../frontend/src/components/SearchPalette';

describe('SearchPalette', () => {
    const defaultProps = {
        show: true,
        onClose: jest.fn(),
        documents: [
            { id: 'doc1', name: 'Meeting Notes', type: 'text' },
            { id: 'doc2', name: 'Budget Report', type: 'sheet' },
            { id: 'doc3', name: 'Project Board', type: 'kanban' },
        ],
        folders: [
            { id: 'folder1', name: 'Work' },
            { id: 'folder2', name: 'Personal' },
        ],
        workspaceCollaborators: [
            { name: 'Alice', publicKey: 'key1', color: '#f00', icon: '👤' },
            { name: 'Bob', publicKey: 'key2', color: '#0f0', icon: '👤' },
        ],
        workspaceMembers: [],
        yCatalogItems: null,
        yStorageFiles: null,
        yStorageFolders: null,
        workspaceYdoc: null,
        onOpenDocument: jest.fn(),
        onNavigateFolder: jest.fn(),
        onOpenChat: jest.fn(),
        onOpenInventory: jest.fn(),
        onOpenFileStorage: jest.fn(),
        isElectronMode: false,
        metaSocketRef: { current: null },
        ydocsRef: { current: new Map() },
        workspaceName: 'Test Workspace',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // jsdom doesn't implement scrollIntoView
        Element.prototype.scrollIntoView = jest.fn();
    });

    // ── Visibility ─────────────────────────────────────────────────
    test('renders nothing when show is false', () => {
        const { container } = render(<SearchPalette {...defaultProps} show={false} />);
        expect(container.firstChild).toBeNull();
    });

    test('renders overlay and input when show is true', () => {
        render(<SearchPalette {...defaultProps} />);
        expect(screen.getByTestId('search-palette-overlay')).toBeInTheDocument();
        expect(screen.getByTestId('search-palette-input')).toBeInTheDocument();
    });

    // ── Scope hint ─────────────────────────────────────────────────
    test('shows workspace name scope hint', () => {
        render(<SearchPalette {...defaultProps} />);
        expect(screen.getByText('Test Workspace')).toBeInTheDocument();
    });

    // ── Placeholder / empty state ──────────────────────────────────
    test('shows placeholder hint when query is empty', () => {
        render(<SearchPalette {...defaultProps} />);
        expect(screen.getByText(/Start typing/)).toBeInTheDocument();
    });

    test('shows "No results" for unmatched query', async () => {
        render(<SearchPalette {...defaultProps} />);
        // Wait for indexing to finish (buildIndex mock resolves)
        await waitFor(() => {
            expect(screen.queryByText(/Indexing/)).not.toBeInTheDocument();
        });
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'zzzzzzzzzzzzz' } });
        expect(screen.getByText(/No results for/)).toBeInTheDocument();
    });

    // ── Category matching ──────────────────────────────────────────
    test('shows document results on matching query', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'Meeting' } });
        const items = screen.getAllByTestId('search-palette-item');
        expect(items.length).toBeGreaterThanOrEqual(1);
    });

    test('shows people results on matching query', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'Alice' } });
        const items = screen.getAllByTestId('search-palette-item');
        expect(items.length).toBeGreaterThanOrEqual(1);
    });

    test('shows folder results on matching query', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'Work' } });
        const items = screen.getAllByTestId('search-palette-item');
        expect(items.length).toBeGreaterThanOrEqual(1);
    });

    test('shows multiple category results', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        // "B" matches Bob (people) and Budget Report (documents)
        fireEvent.change(input, { target: { value: 'B' } });
        const items = screen.getAllByTestId('search-palette-item');
        expect(items.length).toBeGreaterThanOrEqual(2);
    });

    // ── Keyboard navigation ────────────────────────────────────────
    test('Escape key calls onClose', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    test('Enter key selects active result', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'Meeting' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    test('ArrowDown/ArrowUp navigate results without crash', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'B' } });

        const items = screen.getAllByTestId('search-palette-item');
        expect(items.length).toBeGreaterThanOrEqual(1);

        // Navigate
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        // Should not crash
    });

    test('ArrowUp at top stays at index 0', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'Meeting' } });
        // Press up from the first item
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        // Enter should still select the first item
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    // ── Overlay click ──────────────────────────────────────────────
    test('clicking overlay calls onClose', () => {
        render(<SearchPalette {...defaultProps} />);
        const overlay = screen.getByTestId('search-palette-overlay');
        fireEvent.click(overlay);
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    test('clicking inside palette does NOT call onClose', () => {
        render(<SearchPalette {...defaultProps} />);
        const palette = screen.getByTestId('search-palette');
        fireEvent.click(palette);
        expect(defaultProps.onClose).not.toHaveBeenCalled();
    });

    // ── Result selection callbacks ─────────────────────────────────
    test('selecting a document calls onOpenDocument', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'Budget' } });

        const items = screen.getAllByTestId('search-palette-item');
        fireEvent.click(items[0]);
        expect(defaultProps.onClose).toHaveBeenCalled();
        expect(defaultProps.onOpenDocument).toHaveBeenCalled();
    });

    test('selecting a person calls onOpenChat', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'Alice' } });

        const items = screen.getAllByTestId('search-palette-item');
        fireEvent.click(items[0]);
        expect(defaultProps.onClose).toHaveBeenCalled();
        expect(defaultProps.onOpenChat).toHaveBeenCalled();
    });

    test('selecting a folder calls onNavigateFolder', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'Personal' } });

        const items = screen.getAllByTestId('search-palette-item');
        fireEvent.click(items[0]);
        expect(defaultProps.onClose).toHaveBeenCalled();
        expect(defaultProps.onNavigateFolder).toHaveBeenCalled();
    });

    // ── Footer ─────────────────────────────────────────────────────
    test('footer shows navigation hints', () => {
        render(<SearchPalette {...defaultProps} />);
        expect(screen.getByText('navigate')).toBeInTheDocument();
        expect(screen.getByText('open')).toBeInTheDocument();
        expect(screen.getByText('close')).toBeInTheDocument();
    });

    // ── Re-open reset ──────────────────────────────────────────────
    test('resets query when reopened', () => {
        const { rerender } = render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'test' } });
        expect(input.value).toBe('test');

        // Close and reopen
        rerender(<SearchPalette {...defaultProps} show={false} />);
        rerender(<SearchPalette {...defaultProps} show={true} />);

        const newInput = screen.getByTestId('search-palette-input');
        expect(newInput.value).toBe('');
    });

    // ── Chat cap ───────────────────────────────────────────────────
    test('does not show chat cap notice without workspaceYdoc', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'a' } });
        expect(screen.queryByTestId('search-all-messages-btn')).toBeNull();
    });

    // ── No workspace name ──────────────────────────────────────────
    test('no scope hint when workspaceName is empty', () => {
        render(<SearchPalette {...defaultProps} workspaceName="" />);
        expect(screen.queryByText('Searching in')).toBeNull();
    });

    // ── Type badges ────────────────────────────────────────────────
    test('shows type badge for sheet documents', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'Budget' } });
        // Budget Report is type "sheet" — should show 📊 Sheet badge
        expect(screen.getByText('📊 Sheet')).toBeInTheDocument();
    });

    test('shows type badge for kanban documents', () => {
        render(<SearchPalette {...defaultProps} />);
        const input = screen.getByTestId('search-palette-input');
        fireEvent.change(input, { target: { value: 'Project' } });
        expect(screen.getByText('📋 Kanban')).toBeInTheDocument();
    });
});
