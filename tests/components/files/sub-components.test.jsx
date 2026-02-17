/**
 * Tests for sub-components: DistributionBadge, FileTypeIcon, SearchBar,
 * ViewModeToggle, Breadcrumbs, DownloadsBar, FolderCreateDialog,
 * FileMoveDialog, ReplaceDialog, FilePickerModal.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// DistributionBadge
import DistributionBadge, { computeDistributionHealth } from '../../../frontend/src/components/files/DistributionBadge';

describe('DistributionBadge', () => {
  it('should render with file id', () => {
    render(<DistributionBadge fileId="f1" chunkCount={3} chunkAvailability={{}} userPublicKey="pk1" />);
    expect(screen.getByTestId('distribution-badge-f1')).toBeInTheDocument();
  });

  it('computeDistributionHealth returns health object', () => {
    const health = computeDistributionHealth('f1', 2, {}, 'pk1', 3);
    // Returns { state, icon, color, tooltip, seededCount, totalHolders }
    expect(health).toHaveProperty('state');
    expect(health).toHaveProperty('tooltip');
    expect(health).toHaveProperty('totalHolders');
  });

  it('should show distributed when all chunks have enough peers', () => {
    const availability = {
      'f1:0': { holders: ['pk1', 'pk2', 'pk3'] },
      'f1:1': { holders: ['pk1', 'pk2', 'pk3'] },
    };
    const health = computeDistributionHealth('f1', 2, availability, 'pk1', 3);
    expect(health.state).toBe('distributed');
  });

  it('should show local-only when only local user holds chunks', () => {
    const availability = {
      'f1:0': { holders: ['pk1'] },
      'f1:1': { holders: ['pk1'] },
    };
    const health = computeDistributionHealth('f1', 2, availability, 'pk1', 3);
    expect(health.state).toBe('local-only');
  });
});

// ViewModeToggle
import ViewModeToggle, { VIEW_MODES } from '../../../frontend/src/components/files/ViewModeToggle';

describe('ViewModeToggle', () => {
  it('should render toggle buttons', () => {
    render(<ViewModeToggle viewMode={VIEW_MODES.GRID} onViewModeChange={jest.fn()} />);
    expect(screen.getByTestId('view-mode-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-grid')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-table')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-compact')).toBeInTheDocument();
  });

  it('should highlight active mode', () => {
    render(<ViewModeToggle viewMode={VIEW_MODES.TABLE} onViewModeChange={jest.fn()} />);
    expect(screen.getByTestId('view-mode-table')).toHaveClass('view-mode-btn--active');
  });

  it('should call onViewModeChange when clicked', () => {
    const onChange = jest.fn();
    render(<ViewModeToggle viewMode={VIEW_MODES.GRID} onViewModeChange={onChange} />);
    fireEvent.click(screen.getByTestId('view-mode-table'));
    expect(onChange).toHaveBeenCalledWith(VIEW_MODES.TABLE);
  });

  it('should export VIEW_MODES constant', () => {
    expect(VIEW_MODES).toEqual({ GRID: 'grid', TABLE: 'table', COMPACT: 'compact' });
  });
});

// Breadcrumbs
import Breadcrumbs from '../../../frontend/src/components/files/Breadcrumbs';

describe('Breadcrumbs', () => {
  // Breadcrumbs accepts currentFolderId + folders (builds path by walking parentId chain)
  const folders = [
    { id: 'f1', name: 'Documents', parentId: null },
    { id: 'f2', name: 'Projects', parentId: 'f1' },
  ];

  it('should render root', () => {
    render(<Breadcrumbs currentFolderId={null} folders={[]} onNavigate={jest.fn()} />);
    expect(screen.getByTestId('fs-breadcrumbs')).toBeInTheDocument();
    expect(screen.getByTestId('fs-breadcrumb-root')).toBeInTheDocument();
  });

  it('should render folder segments', () => {
    render(<Breadcrumbs currentFolderId="f2" folders={folders} onNavigate={jest.fn()} />);
    expect(screen.getByText(/Documents/)).toBeInTheDocument();
    expect(screen.getByText(/Projects/)).toBeInTheDocument();
  });

  it('should call onNavigate when root clicked', () => {
    const onNavigate = jest.fn();
    render(<Breadcrumbs currentFolderId="f1" folders={folders} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('fs-breadcrumb-root'));
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('should call onNavigate with folder id when segment clicked', () => {
    const onNavigate = jest.fn();
    render(<Breadcrumbs currentFolderId="f2" folders={folders} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('fs-breadcrumb-f1'));
    expect(onNavigate).toHaveBeenCalledWith('f1');
  });
});

// SearchBar
import SearchBar from '../../../frontend/src/components/files/SearchBar';

describe('SearchBar', () => {
  it('should render', () => {
    render(<SearchBar files={[]} onSearch={jest.fn()} />);
    expect(screen.getByTestId('fs-search-bar')).toBeInTheDocument();
    expect(screen.getByTestId('fs-search-input')).toBeInTheDocument();
  });

  it('should call onSearch with debounced value', async () => {
    jest.useFakeTimers();
    const onSearch = jest.fn();
    render(<SearchBar files={[]} onSearch={onSearch} />);
    fireEvent.change(screen.getByTestId('fs-search-input'), { target: { value: 'test' } });
    act(() => { jest.advanceTimersByTime(400); });
    expect(onSearch).toHaveBeenCalledWith('test');
    jest.useRealTimers();
  });

  it('should show clear button when text entered', () => {
    render(<SearchBar files={[]} onSearch={jest.fn()} />);
    fireEvent.change(screen.getByTestId('fs-search-input'), { target: { value: 'query' } });
    expect(screen.getByTestId('fs-search-clear')).toBeInTheDocument();
  });
});

// DownloadsBar
import DownloadsBar from '../../../frontend/src/components/files/DownloadsBar';

describe('DownloadsBar', () => {
  it('should return null when no downloads', () => {
    const { container } = render(<DownloadsBar downloads={[]} onClearDownload={jest.fn()} onClearAll={jest.fn()} />);
    // DownloadsBar returns null when downloads is empty
    expect(container.firstChild).toBeNull();
  });

  it('should show active downloads', () => {
    const downloads = [
      { downloadId: 'd1', fileName: 'test.zip', status: 'FETCHING', progress: 40 },
    ];
    render(<DownloadsBar downloads={downloads} onClearDownload={jest.fn()} onClearAll={jest.fn()} />);
    expect(screen.getByText('test.zip')).toBeInTheDocument();
  });

  it('should show clear all button when multiple downloads exist', () => {
    const downloads = [
      { downloadId: 'd1', fileName: 'done.pdf', status: 'COMPLETE', progress: 100 },
      { downloadId: 'd2', fileName: 'done2.pdf', status: 'COMPLETE', progress: 100 },
    ];
    render(<DownloadsBar downloads={downloads} onClearDownload={jest.fn()} onClearAll={jest.fn()} />);
    expect(screen.getByTestId('dbar-clear-all')).toBeInTheDocument();
  });
});

// FolderCreateDialog
import FolderCreateDialog from '../../../frontend/src/components/files/FolderCreateDialog';

describe('FolderCreateDialog', () => {
  // Component accepts: isOpen, onClose, onCreateFolder, parentId, allFolders
  it('should render dialog with name input', () => {
    render(<FolderCreateDialog isOpen={true} onClose={jest.fn()} onCreateFolder={jest.fn()} parentId={null} allFolders={[]} />);
    expect(screen.getByTestId('folder-create-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('folder-create-name-input')).toBeInTheDocument();
  });

  it('should call onClose when cancel clicked', () => {
    const onClose = jest.fn();
    render(<FolderCreateDialog isOpen={true} onClose={onClose} onCreateFolder={jest.fn()} parentId={null} allFolders={[]} />);
    fireEvent.click(screen.getByTestId('folder-create-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('should show error for duplicate name', () => {
    const existingFolders = [{ id: 'f1', name: 'Docs', parentId: null }];
    render(<FolderCreateDialog isOpen={true} onClose={jest.fn()} onCreateFolder={jest.fn()} parentId={null} allFolders={existingFolders} />);
    fireEvent.change(screen.getByTestId('folder-create-name-input'), { target: { value: 'Docs' } });
    fireEvent.click(screen.getByTestId('folder-create-submit'));
    expect(screen.getByTestId('folder-create-error')).toBeInTheDocument();
  });

  it('should call onCreateFolder with folder data', () => {
    const onCreateFolder = jest.fn();
    const onClose = jest.fn();
    render(<FolderCreateDialog isOpen={true} onClose={onClose} onCreateFolder={onCreateFolder} parentId={null} allFolders={[]} />);
    fireEvent.change(screen.getByTestId('folder-create-name-input'), { target: { value: 'New Folder' } });
    fireEvent.click(screen.getByTestId('folder-create-submit'));
    expect(onCreateFolder).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Folder' }));
  });
});

// ReplaceDialog
import ReplaceDialog from '../../../frontend/src/components/files/ReplaceDialog';

describe('ReplaceDialog', () => {
  // Component accepts: isOpen, fileName, onReplace, onKeepBoth, onCancel
  it('should render dialog', () => {
    render(<ReplaceDialog isOpen={true} fileName="test.pdf" onReplace={jest.fn()} onKeepBoth={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByTestId('replace-dialog')).toBeInTheDocument();
  });

  it('should show file name', () => {
    render(<ReplaceDialog isOpen={true} fileName="test.pdf" onReplace={jest.fn()} onKeepBoth={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText(/test\.pdf/)).toBeInTheDocument();
  });

  it('should call onReplace when Replace clicked', () => {
    const onReplace = jest.fn();
    render(<ReplaceDialog isOpen={true} fileName="test.pdf" onReplace={onReplace} onKeepBoth={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByTestId('replace-btn-replace'));
    expect(onReplace).toHaveBeenCalled();
  });

  it('should call onKeepBoth when Keep Both clicked', () => {
    const onKeepBoth = jest.fn();
    render(<ReplaceDialog isOpen={true} fileName="test.pdf" onReplace={jest.fn()} onKeepBoth={onKeepBoth} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByTestId('replace-btn-keep'));
    expect(onKeepBoth).toHaveBeenCalled();
  });

  it('should call onCancel when Cancel clicked', () => {
    const onCancel = jest.fn();
    render(<ReplaceDialog isOpen={true} fileName="test.pdf" onReplace={jest.fn()} onKeepBoth={jest.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('replace-btn-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});

// FileMoveDialog
import FileMoveDialog from '../../../frontend/src/components/files/FileMoveDialog';

describe('FileMoveDialog', () => {
  // Component accepts: isOpen, onClose, onMove, item ({ type, id, name }), activeFolders
  const folders = [
    { id: 'f1', name: 'Folder A', parentId: null },
    { id: 'f2', name: 'Folder B', parentId: null },
    { id: 'f3', name: 'Sub Folder', parentId: 'f1' },
  ];
  const item = { type: 'file', id: 'file1', name: 'test.pdf' };

  it('should render dialog', () => {
    render(<FileMoveDialog isOpen={true} onClose={jest.fn()} onMove={jest.fn()} item={item} activeFolders={folders} />);
    expect(screen.getByTestId('move-dialog')).toBeInTheDocument();
  });

  it('should show root option', () => {
    render(<FileMoveDialog isOpen={true} onClose={jest.fn()} onMove={jest.fn()} item={item} activeFolders={folders} />);
    expect(screen.getByTestId('move-tree-root')).toBeInTheDocument();
  });

  it('should show folder tree', () => {
    render(<FileMoveDialog isOpen={true} onClose={jest.fn()} onMove={jest.fn()} item={item} activeFolders={folders} />);
    expect(screen.getByText('Folder A')).toBeInTheDocument();
    expect(screen.getByText('Folder B')).toBeInTheDocument();
  });

  it('should call onMove with selected folder', () => {
    const onMove = jest.fn();
    const onClose = jest.fn();
    render(<FileMoveDialog isOpen={true} onClose={onClose} onMove={onMove} item={item} activeFolders={folders} />);
    fireEvent.click(screen.getByTestId('move-tree-f1'));
    fireEvent.click(screen.getByTestId('move-dialog-submit'));
    // onMove is called with (itemId, selectedFolderId, itemType)
    expect(onMove).toHaveBeenCalledWith('file1', 'f1', 'file');
  });

  it('should call onClose when cancel clicked', () => {
    const onClose = jest.fn();
    render(<FileMoveDialog isOpen={true} onClose={onClose} onMove={jest.fn()} item={item} activeFolders={folders} />);
    fireEvent.click(screen.getByTestId('move-dialog-cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
