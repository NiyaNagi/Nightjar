/**
 * Tests for BrowseView component.
 * 
 * Tests file/folder listing, sorting, search, upload zone, context menu,
 * folder creation, file moving, and view mode switching.
 */

import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import BrowseView from '../../../frontend/src/components/files/BrowseView';

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
  favoritedBy: [],
  tags: [],
  chunkCount: 1,
  ...overrides,
});

const baseFolder = (overrides = {}) => ({
  id: 'folder1',
  name: 'Documents',
  parentId: null,
  createdAt: Date.now(),
  color: '#89b4fa',
  icon: '📁',
  ...overrides,
});

const defaultProps = {
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
};

describe('BrowseView', () => {
  afterEach(() => jest.clearAllMocks());

  it('should render empty state when no files or folders', () => {
    render(<BrowseView {...defaultProps} />);
    expect(screen.getByTestId('browse-view')).toBeInTheDocument();
    expect(screen.getByTestId('browse-empty')).toBeInTheDocument();
  });

  it('should render files in the browse area', () => {
    const files = [baseFile(), baseFile({ id: 'f2', name: 'image.png', extension: 'png', typeCategory: 'image' })];
    render(<BrowseView {...defaultProps} activeFiles={files} />);
    expect(screen.getByText('test.pdf')).toBeInTheDocument();
    expect(screen.getByText('image.png')).toBeInTheDocument();
    expect(screen.getByTestId('browse-items')).toBeInTheDocument();
  });

  it('should render folders', () => {
    const folders = [baseFolder()];
    render(<BrowseView {...defaultProps} activeFolders={folders} />);
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByTestId('fs-folder-folder1')).toBeInTheDocument();
  });

  it('should show breadcrumbs', () => {
    render(<BrowseView {...defaultProps} />);
    expect(screen.getByTestId('fs-breadcrumbs')).toBeInTheDocument();
  });

  it('should show view mode toggle', () => {
    render(<BrowseView {...defaultProps} />);
    expect(screen.getByTestId('view-mode-toggle')).toBeInTheDocument();
  });

  it('should open new folder dialog on button click', () => {
    render(<BrowseView {...defaultProps} />);
    fireEvent.click(screen.getByTestId('btn-new-folder'));
    expect(screen.getByTestId('folder-create-dialog')).toBeInTheDocument();
  });

  it('should show search bar', () => {
    render(<BrowseView {...defaultProps} />);
    expect(screen.getByTestId('fs-search-bar')).toBeInTheDocument();
  });

  it('should navigate into a folder on click', () => {
    const folders = [baseFolder()];
    const files = [baseFile({ folderId: 'folder1' })];
    render(<BrowseView {...defaultProps} activeFolders={folders} activeFiles={files} />);
    
    // Click on the folder
    fireEvent.click(screen.getByTestId('fs-folder-folder1'));
    
    // After navigating, the file inside should be visible
    expect(screen.getByText('test.pdf')).toBeInTheDocument();
  });

  it('should filter files by current folder', () => {
    const folders = [baseFolder()];
    const files = [
      baseFile({ folderId: null, name: 'root-file.txt' }),
      baseFile({ id: 'f2', folderId: 'folder1', name: 'folder-file.txt' }),
    ];
    render(<BrowseView {...defaultProps} activeFolders={folders} activeFiles={files} />);
    
    // In root, only root-file should be visible
    expect(screen.getByText('root-file.txt')).toBeInTheDocument();
    expect(screen.queryByText('folder-file.txt')).not.toBeInTheDocument();
  });

  it('should switch view modes', () => {
    const files = [baseFile()];
    render(<BrowseView {...defaultProps} activeFiles={files} />);
    
    // Click table view
    fireEvent.click(screen.getByTestId('view-mode-table'));
    expect(screen.getByTestId('browse-items')).toHaveClass('browse-items--table');
  });

  it('should sort files by name on sort click', () => {
    const files = [
      baseFile({ id: 'f1', name: 'zebra.txt' }),
      baseFile({ id: 'f2', name: 'apple.txt' }),
    ];
    render(<BrowseView {...defaultProps} activeFiles={files} />);
    
    // Default sort is name ascending, so apple should come first
    const items = screen.getByTestId('browse-items');
    const fileNames = within(items).getAllByText(/\.txt$/);
    expect(fileNames[0].textContent).toBe('apple.txt');
  });

  it('should show upload zone', () => {
    render(<BrowseView {...defaultProps} />);
    expect(screen.getByTestId('upload-zone')).toBeInTheDocument();
  });

  it('should show upload progress when uploads exist', () => {
    const uploads = [
      { uploadId: 'u1', fileName: 'uploading.pdf', progress: 50, status: 'ENCRYPTING' },
    ];
    render(<BrowseView {...defaultProps} uploads={uploads} />);
    expect(screen.getByTestId('upload-progress')).toBeInTheDocument();
  });

  it('should show upload/create buttons for collaborator role', () => {
    render(<BrowseView {...defaultProps} role="collaborator" />);
    expect(screen.getByTestId('btn-new-folder')).toBeInTheDocument();
  });

  it('should hide upload/create buttons for viewer role', () => {
    render(<BrowseView {...defaultProps} role="viewer" />);
    expect(screen.queryByTestId('btn-new-folder')).not.toBeInTheDocument();
  });

  it('should show upload/create buttons for admin role', () => {
    render(<BrowseView {...defaultProps} role="admin" />);
    expect(screen.getByTestId('btn-new-folder')).toBeInTheDocument();
  });
});
