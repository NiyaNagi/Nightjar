/**
 * Tests for bulk file actions: selection, BulkActionBar, BulkTagDialog,
 * ConfirmDialog, bulk-aware context menu, keyboard shortcuts, shift-range
 * selection, FileMoveDialog bulk mode, drag-select hook.
 * 
 * Covers: useDragSelect, BulkActionBar, BulkTagDialog, ConfirmDialog,
 * shift/ctrl selection, keyboard shortcuts, bulk context menu,
 * FileMoveDialog bulk, and end-to-end bulk scenarios.
 */

import React from 'react';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import BulkActionBar from '../../../frontend/src/components/files/BulkActionBar';
import BulkTagDialog from '../../../frontend/src/components/files/BulkTagDialog';
import ConfirmDialog from '../../../frontend/src/components/files/ConfirmDialog';
import FileContextMenu from '../../../frontend/src/components/files/FileContextMenu';
import FileMoveDialog from '../../../frontend/src/components/files/FileMoveDialog';
import FileCard from '../../../frontend/src/components/files/FileCard';
import FolderCard from '../../../frontend/src/components/files/FolderCard';
import BrowseView from '../../../frontend/src/components/files/BrowseView';

// ─── Helpers ─────────────────────────────────────────────

const baseFile = (overrides = {}) => ({
  id: 'f1',
  name: 'test.pdf',
  extension: 'pdf',
  typeCategory: 'document',
  sizeBytes: 1024,
  folderId: null,
  createdAt: Date.now() - 10000,
  updatedAt: Date.now(),
  deletedAt: null,
  uploadedBy: 'pk-user1',
  uploadedByName: 'Alice',
  favoritedBy: [],
  tags: ['alpha'],
  chunkCount: 1,
  chunkHashes: ['hash0'],
  fileHash: 'filehash',
  mimeType: 'application/pdf',
  ...overrides,
});

const baseFolder = (overrides = {}) => ({
  id: 'folder1',
  name: 'Documents',
  parentId: null,
  createdAt: Date.now(),
  color: null,
  icon: null,
  deletedAt: null,
  ...overrides,
});

const browseProps = (overrides = {}) => ({
  activeFiles: [],
  activeFolders: [],
  chunkAvailability: {},
  userPublicKey: 'pk-user1',
  userIdentity: { publicKeyBase62: 'pk-user1', name: 'Alice' },
  role: 'admin',
  uploads: [],
  onUploadFiles: jest.fn(),
  onClearUpload: jest.fn(),
  onClearCompletedUploads: jest.fn(),
  onDownloadFile: jest.fn(),
  onUpdateFile: jest.fn(),
  onDeleteFile: jest.fn(),
  onToggleFavorite: jest.fn(),
  onCreateFolder: jest.fn(),
  onUpdateFolder: jest.fn(),
  onDeleteFolder: jest.fn(),
  onMoveFile: jest.fn(),
  onMoveFolder: jest.fn(),
  collaborators: [],
  favoriteIds: new Set(),
  ...overrides,
});


// ═════════════════════════════════════════════════════════
// ConfirmDialog unit tests
// ═════════════════════════════════════════════════════════

describe('ConfirmDialog', () => {
  it('should not render when closed', () => {
    render(<ConfirmDialog isOpen={false} title="Test" message="msg" onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('should render when open', () => {
    render(<ConfirmDialog isOpen={true} title="Delete Items" message="Are you sure?" onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete Items')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('should call onConfirm when confirm button clicked', () => {
    const onConfirm = jest.fn();
    render(<ConfirmDialog isOpen={true} title="Confirm" message="msg" onConfirm={onConfirm} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when cancel button clicked', () => {
    const onCancel = jest.fn();
    render(<ConfirmDialog isOpen={true} title="Confirm" message="msg" onConfirm={jest.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel on Escape key', () => {
    const onCancel = jest.fn();
    render(<ConfirmDialog isOpen={true} title="Confirm" message="msg" onConfirm={jest.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when overlay clicked', () => {
    const onCancel = jest.fn();
    render(<ConfirmDialog isOpen={true} title="Confirm" message="msg" onConfirm={jest.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('confirm-dialog-overlay'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should show custom labels', () => {
    render(<ConfirmDialog isOpen={true} title="Test" message="msg" confirmLabel="Yes" cancelLabel="No" onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });
});


// ═════════════════════════════════════════════════════════
// BulkActionBar unit tests
// ═════════════════════════════════════════════════════════

describe('BulkActionBar', () => {
  const files = [baseFile({ id: 'f1' }), baseFile({ id: 'f2', name: 'img.png' })];
  const folders = [baseFolder({ id: 'folder1' })];

  it('should not render when no items selected', () => {
    render(<BulkActionBar selectedItems={new Set()} files={files} folders={folders} />);
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('should render with count when items selected', () => {
    render(<BulkActionBar selectedItems={new Set(['f1', 'f2'])} files={files} folders={folders} onClear={jest.fn()} />);
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('2 items selected');
  });

  it('should show singular when 1 item selected', () => {
    render(<BulkActionBar selectedItems={new Set(['f1'])} files={files} folders={folders} onClear={jest.fn()} />);
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('1 item selected');
  });

  it('should show download button when files are selected', () => {
    render(<BulkActionBar selectedItems={new Set(['f1'])} files={files} folders={folders} onDownload={jest.fn()} onClear={jest.fn()} />);
    expect(screen.getByTestId('bulk-action-download')).toBeInTheDocument();
  });

  it('should hide download button when only folders are selected', () => {
    render(<BulkActionBar selectedItems={new Set(['folder1'])} files={files} folders={folders} onClear={jest.fn()} />);
    expect(screen.queryByTestId('bulk-action-download')).not.toBeInTheDocument();
  });

  it('should call onDelete when delete clicked', () => {
    const onDelete = jest.fn();
    render(<BulkActionBar selectedItems={new Set(['f1'])} files={files} folders={folders} onDelete={onDelete} onClear={jest.fn()} />);
    fireEvent.click(screen.getByTestId('bulk-action-delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('should call onMove when move clicked', () => {
    const onMove = jest.fn();
    render(<BulkActionBar selectedItems={new Set(['f1'])} files={files} folders={folders} onMove={onMove} onClear={jest.fn()} />);
    fireEvent.click(screen.getByTestId('bulk-action-move'));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('should call onEditTags when tags clicked', () => {
    const onEditTags = jest.fn();
    render(<BulkActionBar selectedItems={new Set(['f1'])} files={files} folders={folders} onEditTags={onEditTags} onClear={jest.fn()} />);
    fireEvent.click(screen.getByTestId('bulk-action-tags'));
    expect(onEditTags).toHaveBeenCalledTimes(1);
  });

  it('should call onClear when deselect clicked', () => {
    const onClear = jest.fn();
    render(<BulkActionBar selectedItems={new Set(['f1'])} files={files} folders={folders} onClear={onClear} />);
    fireEvent.click(screen.getByTestId('bulk-action-deselect'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('should show favorite button when files selected', () => {
    render(<BulkActionBar selectedItems={new Set(['f1'])} files={files} folders={folders} onToggleFavorite={jest.fn()} onClear={jest.fn()} />);
    expect(screen.getByTestId('bulk-action-favorite')).toBeInTheDocument();
  });
});


// ═════════════════════════════════════════════════════════
// BulkTagDialog unit tests
// ═════════════════════════════════════════════════════════

describe('BulkTagDialog', () => {
  const selectedFiles = [
    baseFile({ id: 'f1', tags: ['alpha'] }),
    baseFile({ id: 'f2', name: 'img.png', tags: ['beta'] }),
  ];

  it('should not render when closed', () => {
    render(<BulkTagDialog isOpen={false} selectedFiles={selectedFiles} onApply={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByTestId('bulk-tag-dialog')).not.toBeInTheDocument();
  });

  it('should render when open', () => {
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByTestId('bulk-tag-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Edit Tags/)).toBeInTheDocument();
  });

  it('should add tags on Enter key', () => {
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={jest.fn()} onClose={jest.fn()} />);
    const input = screen.getByTestId('bulk-tag-input');
    fireEvent.change(input, { target: { value: 'newtag' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('bulk-tag-chips')).toHaveTextContent('newtag');
  });

  it('should add tags on + button click', () => {
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={jest.fn()} onClose={jest.fn()} />);
    const input = screen.getByTestId('bulk-tag-input');
    fireEvent.change(input, { target: { value: 'anothertag' } });
    fireEvent.click(screen.getByTestId('bulk-tag-add-btn'));
    expect(screen.getByTestId('bulk-tag-chips')).toHaveTextContent('anothertag');
  });

  it('should remove tags on ✕ click', () => {
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={jest.fn()} onClose={jest.fn()} />);
    const input = screen.getByTestId('bulk-tag-input');
    fireEvent.change(input, { target: { value: 'tag1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('bulk-tag-chips')).toHaveTextContent('tag1');

    // Click the remove button on the chip
    const chip = screen.getByText('tag1').closest('.bulk-tag-chip');
    fireEvent.click(within(chip).getByTitle('Remove'));
    expect(screen.queryByTestId('bulk-tag-chips')).not.toBeInTheDocument();
  });

  it('should prevent duplicate tags', () => {
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={jest.fn()} onClose={jest.fn()} />);
    const input = screen.getByTestId('bulk-tag-input');
    fireEvent.change(input, { target: { value: 'dup' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'dup' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('bulk-tag-error')).toHaveTextContent('Tag already added');
  });

  it('should have add and replace modes', () => {
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByTestId('bulk-tag-mode-add')).toBeChecked();
    expect(screen.getByTestId('bulk-tag-mode-replace')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('bulk-tag-mode-replace'));
    expect(screen.getByTestId('bulk-tag-mode-replace')).toBeChecked();
  });

  it('should show warning in replace mode', () => {
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByTestId('bulk-tag-mode-replace'));
    expect(screen.getByText(/will replace all existing tags/i)).toBeInTheDocument();
  });

  it('should call onApply in add mode (union)', () => {
    const onApply = jest.fn();
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={onApply} onClose={jest.fn()} />);
    const input = screen.getByTestId('bulk-tag-input');
    fireEvent.change(input, { target: { value: 'gamma' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('bulk-tag-apply'));

    // f1 had ['alpha'], should get ['alpha', 'gamma']
    expect(onApply).toHaveBeenCalledWith('f1', { tags: ['alpha', 'gamma'] });
    // f2 had ['beta'], should get ['beta', 'gamma']
    expect(onApply).toHaveBeenCalledWith('f2', { tags: ['beta', 'gamma'] });
  });

  it('should call onApply in replace mode (overwrite)', () => {
    const onApply = jest.fn();
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={onApply} onClose={jest.fn()} />);
    fireEvent.click(screen.getByTestId('bulk-tag-mode-replace'));
    const input = screen.getByTestId('bulk-tag-input');
    fireEvent.change(input, { target: { value: 'newonly' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('bulk-tag-apply'));

    // Both should get ['newonly'] only
    expect(onApply).toHaveBeenCalledWith('f1', { tags: ['newonly'] });
    expect(onApply).toHaveBeenCalledWith('f2', { tags: ['newonly'] });
  });

  it('should disable apply when no tags entered', () => {
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByTestId('bulk-tag-apply')).toBeDisabled();
  });

  it('should call onClose when cancel clicked', () => {
    const onClose = jest.fn();
    render(<BulkTagDialog isOpen={true} selectedFiles={selectedFiles} onApply={jest.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('bulk-tag-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});


// ═════════════════════════════════════════════════════════
// FileContextMenu bulk-aware tests
// ═════════════════════════════════════════════════════════

describe('FileContextMenu — bulk-aware', () => {
  const target = { type: 'file', item: baseFile() };
  const baseMenuProps = {
    isOpen: true,
    position: { x: 100, y: 200 },
    target,
    onClose: jest.fn(),
    onAction: jest.fn(),
    isAdmin: false,
  };

  it('should show single-item menu by default', () => {
    render(<FileContextMenu {...baseMenuProps} />);
    expect(screen.getByTestId('ctx-rename')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-details')).toBeInTheDocument();
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('should hide rename and properties in bulk mode', () => {
    render(<FileContextMenu {...baseMenuProps} isBulk={true} selectedCount={3} selectedFileCount={2} />);
    expect(screen.queryByTestId('ctx-rename')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ctx-details')).not.toBeInTheDocument();
  });

  it('should show counts in bulk labels', () => {
    render(<FileContextMenu {...baseMenuProps} isBulk={true} selectedCount={3} selectedFileCount={2} />);
    expect(screen.getByText('Download 2 files')).toBeInTheDocument();
    expect(screen.getByText('Delete 3 items')).toBeInTheDocument();
    expect(screen.getByText(/Move 3 items/)).toBeInTheDocument();
  });

  it('should show favorite option in bulk mode', () => {
    render(<FileContextMenu {...baseMenuProps} isBulk={true} selectedCount={3} selectedFileCount={2} />);
    expect(screen.getByTestId('ctx-favorite')).toBeInTheDocument();
    expect(screen.getByText(/Favorite 2 files/)).toBeInTheDocument();
  });

  it('should call onAction for download in bulk mode', () => {
    const onAction = jest.fn();
    render(<FileContextMenu {...baseMenuProps} onAction={onAction} isBulk={true} selectedCount={3} selectedFileCount={2} />);
    fireEvent.click(screen.getByTestId('ctx-download'));
    expect(onAction).toHaveBeenCalledWith('download', target.item);
  });
});


// ═════════════════════════════════════════════════════════
// FileMoveDialog bulk mode tests
// ═════════════════════════════════════════════════════════

describe('FileMoveDialog — bulk mode', () => {
  const folders = [
    baseFolder({ id: 'fold-a', name: 'Folder A' }),
    baseFolder({ id: 'fold-b', name: 'Folder B' }),
  ];

  it('should render with single item (legacy)', () => {
    render(
      <FileMoveDialog
        isOpen={true}
        onClose={jest.fn()}
        onMove={jest.fn()}
        item={{ type: 'file', id: 'f1', name: 'test.pdf' }}
        activeFolders={folders}
      />
    );
    expect(screen.getByText(/Move "test.pdf"/)).toBeInTheDocument();
  });

  it('should render with bulk items', () => {
    render(
      <FileMoveDialog
        isOpen={true}
        onClose={jest.fn()}
        onMove={jest.fn()}
        items={[
          { type: 'file', id: 'f1', name: 'a.pdf' },
          { type: 'file', id: 'f2', name: 'b.pdf' },
          { type: 'folder', id: 'fold-a', name: 'Folder A' },
        ]}
        activeFolders={folders}
      />
    );
    expect(screen.getByText('Move 3 items')).toBeInTheDocument();
  });

  it('should call onMove for each item on submit', () => {
    const onMove = jest.fn();
    render(
      <FileMoveDialog
        isOpen={true}
        onClose={jest.fn()}
        onMove={onMove}
        items={[
          { type: 'file', id: 'f1', name: 'a.pdf' },
          { type: 'file', id: 'f2', name: 'b.pdf' },
        ]}
        activeFolders={folders}
      />
    );
    // Select Folder B
    fireEvent.click(screen.getByTestId('move-tree-fold-b'));
    fireEvent.click(screen.getByTestId('move-dialog-submit'));
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onMove).toHaveBeenCalledWith('f1', 'fold-b', 'file');
    expect(onMove).toHaveBeenCalledWith('f2', 'fold-b', 'file');
  });
});


// ═════════════════════════════════════════════════════════
// FileCard / FolderCard selection tests
// ═════════════════════════════════════════════════════════

describe('FileCard selection', () => {
  const file = baseFile();

  it('should pass { ctrl: true } on checkbox click', () => {
    const onSelect = jest.fn();
    render(<FileCard file={file} onSelect={onSelect} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onSelect).toHaveBeenCalledWith('f1', { ctrl: true, shift: false });
  });

  it('should pass { ctrl: true } on ctrl-click', () => {
    const onSelect = jest.fn();
    render(<FileCard file={file} onSelect={onSelect} onClick={jest.fn()} />);
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledWith('f1', { ctrl: true, shift: false });
  });

  it('should pass { shift: true } on shift-click', () => {
    const onSelect = jest.fn();
    render(<FileCard file={file} onSelect={onSelect} onClick={jest.fn()} />);
    fireEvent.click(screen.getByTestId('fs-file-f1'), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith('f1', { ctrl: false, shift: true });
  });

  it('should pass { ctrl: false, shift: false } on plain click', () => {
    const onSelect = jest.fn();
    const onClick = jest.fn();
    render(<FileCard file={file} onSelect={onSelect} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('fs-file-f1'));
    expect(onSelect).toHaveBeenCalledWith('f1', { ctrl: false, shift: false });
    expect(onClick).toHaveBeenCalledWith(file);
  });
});

describe('FolderCard selection', () => {
  const folder = baseFolder();

  it('should pass { ctrl: true } on checkbox click', () => {
    const onSelect = jest.fn();
    render(<FolderCard folder={folder} onSelect={onSelect} onClick={jest.fn()} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onSelect).toHaveBeenCalledWith('folder1', { ctrl: true, shift: false });
  });

  it('should pass { ctrl: true } on ctrl-click', () => {
    const onSelect = jest.fn();
    render(<FolderCard folder={folder} onSelect={onSelect} onClick={jest.fn()} />);
    fireEvent.click(screen.getByTestId('fs-folder-folder1'), { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledWith('folder1', { ctrl: true, shift: false });
  });

  it('should pass { shift: true } on shift-click', () => {
    const onSelect = jest.fn();
    render(<FolderCard folder={folder} onSelect={onSelect} onClick={jest.fn()} />);
    fireEvent.click(screen.getByTestId('fs-folder-folder1'), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith('folder1', { ctrl: false, shift: true });
  });

  it('should navigate on plain click (no onSelect)', () => {
    const onClick = jest.fn();
    const onSelect = jest.fn();
    render(<FolderCard folder={folder} onClick={onClick} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('fs-folder-folder1'));
    expect(onClick).toHaveBeenCalledWith(folder);
    expect(onSelect).not.toHaveBeenCalled();
  });
});


// ═════════════════════════════════════════════════════════
// BrowseView — bulk selection integration
// ═════════════════════════════════════════════════════════

describe('BrowseView — bulk selection & actions', () => {
  const files = [
    baseFile({ id: 'f1', name: 'alpha.pdf' }),
    baseFile({ id: 'f2', name: 'beta.txt', extension: 'txt', typeCategory: 'document' }),
    baseFile({ id: 'f3', name: 'gamma.png', extension: 'png', typeCategory: 'image' }),
  ];
  const folders = [baseFolder({ id: 'fold1', name: 'Docs' })];

  afterEach(() => jest.clearAllMocks());

  it('should render select-all checkbox', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    expect(screen.getByTestId('browse-select-all')).toBeInTheDocument();
  });

  it('should select all items via select-all checkbox', () => {
    render(<BrowseView {...browseProps({ activeFiles: files, activeFolders: folders })} />);
    fireEvent.click(screen.getByTestId('browse-select-all'));
    // Should show bulk action bar
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('4 items selected');
  });

  it('should deselect all when all selected and select-all clicked again', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    // Select all
    fireEvent.click(screen.getByTestId('browse-select-all'));
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    // Deselect all
    fireEvent.click(screen.getByTestId('browse-select-all'));
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('should show bulk action bar when items are selected via checkbox', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    // Ctrl-click the first file (equivalent to checkbox behavior)
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('1 item selected');
  });

  it('should ctrl-click to toggle multiple file selections', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    // Click first file
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('1 item selected');
    // Ctrl-click second file
    fireEvent.click(screen.getByTestId('fs-file-f2'), { ctrlKey: true });
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('2 items selected');
    // Ctrl-click first again to deselect
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('1 item selected');
  });

  it('should shift-click to select a range', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    // Click first file (plain click sets it as anchor)
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    // Shift-click third file → should select f1, f2, f3
    fireEvent.click(screen.getByTestId('fs-file-f3'), { shiftKey: true });
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('3 items selected');
  });

  it('should deselect all on Escape key', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    fireEvent.click(screen.getByTestId('browse-select-all'));
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('should select all on Ctrl+A', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    fireEvent.keyDown(document, { key: 'a', ctrlKey: true });
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('3 items selected');
  });

  it('should trigger bulk download on Ctrl+D', () => {
    const props = browseProps({ activeFiles: files });
    render(<BrowseView {...props} />);
    // Select all
    fireEvent.click(screen.getByTestId('browse-select-all'));
    // Ctrl+D
    fireEvent.keyDown(document, { key: 'd', ctrlKey: true });
    expect(props.onDownloadFile).toHaveBeenCalledTimes(3);
  });

  it('should show confirm dialog on Delete key', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    fireEvent.click(screen.getByTestId('browse-select-all'));
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText(/delete 3 items/i)).toBeInTheDocument();
  });

  it('should execute bulk delete on confirm', () => {
    const props = browseProps({ activeFiles: files });
    render(<BrowseView {...props} />);
    fireEvent.click(screen.getByTestId('browse-select-all'));
    fireEvent.keyDown(document, { key: 'Delete' });
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(props.onDeleteFile).toHaveBeenCalledTimes(3);
    // Bulk action bar should disappear after delete
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('should cancel bulk delete on confirm dialog cancel', () => {
    const props = browseProps({ activeFiles: files });
    render(<BrowseView {...props} />);
    fireEvent.click(screen.getByTestId('browse-select-all'));
    fireEvent.keyDown(document, { key: 'Delete' });
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(props.onDeleteFile).not.toHaveBeenCalled();
    // Selection should remain
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
  });

  it('should open bulk tag dialog from action bar', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    fireEvent.click(screen.getByTestId('browse-select-all'));
    fireEvent.click(screen.getByTestId('bulk-action-tags'));
    expect(screen.getByTestId('bulk-tag-dialog')).toBeInTheDocument();
  });

  it('should trigger bulk move from action bar', () => {
    render(<BrowseView {...browseProps({ activeFiles: files, activeFolders: folders })} />);
    // Select files only (not the folder)
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('fs-file-f2'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('bulk-action-move'));
    expect(screen.getByTestId('move-dialog')).toBeInTheDocument();
    expect(screen.getByText('Move 2 items')).toBeInTheDocument();
  });

  it('should show single-item move dialog when one item selected', () => {
    render(<BrowseView {...browseProps({ activeFiles: files, activeFolders: folders })} />);
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('bulk-action-move'));
    expect(screen.getByTestId('move-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Move "alpha.pdf"/)).toBeInTheDocument();
  });

  it('should clear selection on deselect button', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    fireEvent.click(screen.getByTestId('browse-select-all'));
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bulk-action-deselect'));
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('should call onToggleFavorite for selected files on favorite click', () => {
    const props = browseProps({ activeFiles: files });
    render(<BrowseView {...props} />);
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('fs-file-f2'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('bulk-action-favorite'));
    expect(props.onToggleFavorite).toHaveBeenCalledWith('f1');
    expect(props.onToggleFavorite).toHaveBeenCalledWith('f2');
  });
});


// ═════════════════════════════════════════════════════════
// BrowseView — bulk context menu integration
// ═════════════════════════════════════════════════════════

describe('BrowseView — bulk context menu', () => {
  const files = [
    baseFile({ id: 'f1', name: 'alpha.pdf' }),
    baseFile({ id: 'f2', name: 'beta.txt', extension: 'txt' }),
  ];

  afterEach(() => jest.clearAllMocks());

  it('should show bulk context menu when right-clicking a selected item with multiple selected', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    // Select both files
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('fs-file-f2'), { ctrlKey: true });
    // Right-click on f1
    fireEvent.contextMenu(screen.getByTestId('fs-file-f1'));
    expect(screen.getByTestId('file-context-menu')).toBeInTheDocument();
    // Should be bulk mode — no rename
    expect(screen.queryByTestId('ctx-rename')).not.toBeInTheDocument();
    expect(screen.getByText(/Delete 2 items/)).toBeInTheDocument();
  });

  it('should show single context menu when right-clicking an unselected item', () => {
    render(<BrowseView {...browseProps({ activeFiles: files })} />);
    // Select f1
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    // Right-click on f2 (not in selection)
    fireEvent.contextMenu(screen.getByTestId('fs-file-f2'));
    expect(screen.getByTestId('file-context-menu')).toBeInTheDocument();
    // Should be single mode — rename should be visible
    expect(screen.getByTestId('ctx-rename')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-delete')).toBeInTheDocument();
  });
});


// ═════════════════════════════════════════════════════════
// E2E-style integration scenarios
// ═════════════════════════════════════════════════════════

describe('BrowseView — end-to-end scenarios', () => {
  afterEach(() => jest.clearAllMocks());

  it('scenario: select-all → delete all → confirm → files removed', () => {
    const files = [
      baseFile({ id: 'f1', name: 'a.pdf' }),
      baseFile({ id: 'f2', name: 'b.pdf' }),
    ];
    const props = browseProps({ activeFiles: files });
    render(<BrowseView {...props} />);

    // Select all via Ctrl+A
    fireEvent.keyDown(document, { key: 'a', ctrlKey: true });
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('2 items selected');

    // Click delete in bulk bar
    fireEvent.click(screen.getByTestId('bulk-action-delete'));

    // Confirm dialog appears
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText(/delete 2 items/i)).toBeInTheDocument();

    // Confirm
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(props.onDeleteFile).toHaveBeenCalledWith('f1');
    expect(props.onDeleteFile).toHaveBeenCalledWith('f2');
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('scenario: shift-select range → bulk download', () => {
    const files = [
      baseFile({ id: 'f1', name: 'a.pdf' }),
      baseFile({ id: 'f2', name: 'b.pdf' }),
      baseFile({ id: 'f3', name: 'c.pdf' }),
      baseFile({ id: 'f4', name: 'd.pdf' }),
    ];
    const props = browseProps({ activeFiles: files });
    render(<BrowseView {...props} />);

    // Ctrl-click f2 to anchor
    fireEvent.click(screen.getByTestId('fs-file-f2'), { ctrlKey: true });
    // Shift-click f4 → selects f2, f3, f4
    fireEvent.click(screen.getByTestId('fs-file-f4'), { shiftKey: true });
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('3 items selected');

    // Click download
    fireEvent.click(screen.getByTestId('bulk-action-download'));
    expect(props.onDownloadFile).toHaveBeenCalledTimes(3);
  });

  it('scenario: ctrl-select → right-click → bulk move', () => {
    const files = [
      baseFile({ id: 'f1', name: 'a.pdf' }),
      baseFile({ id: 'f2', name: 'b.pdf' }),
    ];
    const folders = [baseFolder({ id: 'fold1', name: 'Target' })];
    const props = browseProps({ activeFiles: files, activeFolders: folders });
    render(<BrowseView {...props} />);

    // Ctrl-click both files
    fireEvent.click(screen.getByTestId('fs-file-f1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('fs-file-f2'), { ctrlKey: true });

    // Right-click on f1
    fireEvent.contextMenu(screen.getByTestId('fs-file-f1'));
    // Click move in context menu
    fireEvent.click(screen.getByTestId('ctx-move'));

    // Move dialog opens
    expect(screen.getByTestId('move-dialog')).toBeInTheDocument();
    expect(screen.getByText('Move 2 items')).toBeInTheDocument();
  });

  it('scenario: select files → bulk tag → add mode → apply', () => {
    const files = [
      baseFile({ id: 'f1', name: 'a.pdf', tags: ['existing'] }),
      baseFile({ id: 'f2', name: 'b.pdf', tags: [] }),
    ];
    const props = browseProps({ activeFiles: files });
    render(<BrowseView {...props} />);

    // Select all
    fireEvent.click(screen.getByTestId('browse-select-all'));
    // Click tags in bulk bar
    fireEvent.click(screen.getByTestId('bulk-action-tags'));
    // Tag dialog opens
    expect(screen.getByTestId('bulk-tag-dialog')).toBeInTheDocument();

    // Add a tag
    const input = screen.getByTestId('bulk-tag-input');
    fireEvent.change(input, { target: { value: 'newlabel' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Apply
    fireEvent.click(screen.getByTestId('bulk-tag-apply'));

    // f1 should get union: ['existing', 'newlabel']
    expect(props.onUpdateFile).toHaveBeenCalledWith('f1', { tags: ['existing', 'newlabel'] });
    // f2 should get ['newlabel']
    expect(props.onUpdateFile).toHaveBeenCalledWith('f2', { tags: ['newlabel'] });
  });

  it('scenario: select mixed files + folders → bulk delete respects types', () => {
    const files = [baseFile({ id: 'f1', name: 'a.pdf' })];
    const folders = [baseFolder({ id: 'fold1', name: 'Docs' })];
    const props = browseProps({ activeFiles: files, activeFolders: folders });
    render(<BrowseView {...props} />);

    // Select all (1 folder + 1 file)
    fireEvent.click(screen.getByTestId('browse-select-all'));
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('2 items selected');

    // Delete
    fireEvent.click(screen.getByTestId('bulk-action-delete'));
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(props.onDeleteFile).toHaveBeenCalledWith('f1');
    expect(props.onDeleteFolder).toHaveBeenCalledWith('fold1');
  });
});
