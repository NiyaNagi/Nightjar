/**
 * Tests for TrashView component.
 * 
 * Tests trash listing, restore, permanent delete, bulk operations, empty trash.
 */

import React from 'react';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import TrashView from '../../../frontend/src/components/files/TrashView';

const baseTrashedFile = (overrides = {}) => ({
  id: 'tf1',
  name: 'deleted-doc.pdf',
  sizeBytes: 2048,
  createdAt: Date.now() - 100000,
  deletedAt: Date.now() - 5000,
  typeCategory: 'document',
  extension: 'pdf',
  type: 'file',
  ...overrides,
});

const baseTrashedFolder = (overrides = {}) => ({
  id: 'td1',
  name: 'Old Folder',
  createdAt: Date.now() - 200000,
  deletedAt: Date.now() - 10000,
  type: 'folder',
  icon: '📁',
  ...overrides,
});

const defaultProps = {
  trashedFiles: [],
  trashedFolders: [],
  role: 'admin',
  userIdentity: { publicKeyBase62: 'pk-user1', name: 'Alice' },
  settings: { autoDeleteDays: 30 },
  onRestoreFile: jest.fn(),
  onPermanentlyDeleteFile: jest.fn(),
  onRestoreFolder: jest.fn(),
  onPermanentlyDeleteFolder: jest.fn(),
  onEmptyTrash: jest.fn(),
};

describe('TrashView', () => {
  beforeEach(() => {
    // TrashView now uses useConfirmDialog instead of window.confirm
  });
  afterEach(() => jest.clearAllMocks());

  it('should render empty state when trash is empty', () => {
    render(<TrashView {...defaultProps} />);
    expect(screen.getByTestId('trash-view')).toBeInTheDocument();
    expect(screen.getByTestId('trash-empty-state')).toBeInTheDocument();
  });

  it('should render trashed files', () => {
    render(<TrashView {...defaultProps} trashedFiles={[baseTrashedFile()]} />);
    expect(screen.getByText('deleted-doc.pdf')).toBeInTheDocument();
    expect(screen.getByTestId('trash-list')).toBeInTheDocument();
  });

  it('should render trashed folders', () => {
    render(<TrashView {...defaultProps} trashedFolders={[baseTrashedFolder()]} />);
    expect(screen.getByText('Old Folder')).toBeInTheDocument();
  });

  it('should call onRestoreFile when restore button clicked', () => {
    render(<TrashView {...defaultProps} trashedFiles={[baseTrashedFile()]} />);
    fireEvent.click(screen.getByTestId('trash-restore-tf1'));
    expect(defaultProps.onRestoreFile).toHaveBeenCalledWith('tf1');
  });

  it('should call onPermanentlyDeleteFile when delete button clicked', async () => {
    render(<TrashView {...defaultProps} trashedFiles={[baseTrashedFile()]} />);
    fireEvent.click(screen.getByTestId('trash-perm-delete-tf1'));
    // ConfirmDialog is now rendered — click the confirm button within the dialog
    const dialog = await waitFor(() => screen.getByRole('alertdialog'));
    const confirmBtn = within(dialog).getAllByRole('button').find(b => b.textContent === 'Delete Forever');
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(defaultProps.onPermanentlyDeleteFile).toHaveBeenCalledWith('tf1'));
  });

  it('should call onRestoreFolder for folder restore', () => {
    render(<TrashView {...defaultProps} trashedFolders={[baseTrashedFolder()]} />);
    fireEvent.click(screen.getByTestId('trash-restore-td1'));
    expect(defaultProps.onRestoreFolder).toHaveBeenCalledWith('td1');
  });

  it('should call onPermanentlyDeleteFolder when folder delete button clicked', async () => {
    render(<TrashView {...defaultProps} trashedFolders={[baseTrashedFolder()]} />);
    fireEvent.click(screen.getByTestId('trash-perm-delete-td1'));
    const dialog = await waitFor(() => screen.getByRole('alertdialog'));
    const confirmBtn = within(dialog).getAllByRole('button').find(b => b.textContent === 'Delete Forever');
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(defaultProps.onPermanentlyDeleteFolder).toHaveBeenCalledWith('td1'));
  });

  it('should support checkbox selection', () => {
    render(<TrashView {...defaultProps} trashedFiles={[baseTrashedFile()]} />);
    const checkbox = screen.getByTestId('trash-check-tf1');
    fireEvent.click(checkbox);
    // Bulk action buttons should appear
    expect(screen.getByTestId('trash-bulk-restore')).toBeInTheDocument();
    expect(screen.getByTestId('trash-bulk-delete')).toBeInTheDocument();
  });

  it('should show Empty Trash button for admin', () => {
    render(<TrashView {...defaultProps} trashedFiles={[baseTrashedFile()]} />);
    expect(screen.getByTestId('trash-empty')).toBeInTheDocument();
  });

  it('should call onEmptyTrash when Empty Trash clicked', async () => {
    render(<TrashView {...defaultProps} trashedFiles={[baseTrashedFile()]} />);
    fireEvent.click(screen.getByTestId('trash-empty'));
    const dialog = await waitFor(() => screen.getByRole('alertdialog'));
    const confirmBtn = within(dialog).getAllByRole('button').find(b => b.textContent === 'Empty Trash');
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(defaultProps.onEmptyTrash).toHaveBeenCalled());
  });

  it('should merge and sort files and folders by deletedAt', () => {
    const file = baseTrashedFile({ id: 'tf-late', deletedAt: Date.now() - 1000 });
    const folder = baseTrashedFolder({ id: 'td-early', deletedAt: Date.now() - 50000 });
    render(<TrashView {...defaultProps} trashedFiles={[file]} trashedFolders={[folder]} />);
    
    const items = screen.getByTestId('trash-list');
    const allItems = items.querySelectorAll('[data-testid^="trash-item-"]');
    expect(allItems).toHaveLength(2);
    // Most recently deleted first
    expect(allItems[0].getAttribute('data-testid')).toBe('trash-item-tf-late');
  });
});
