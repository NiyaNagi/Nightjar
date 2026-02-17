/**
 * Tests for StorageView component.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import StorageView from '../../../frontend/src/components/files/StorageView';

const defaultProps = {
  activeFiles: [],
  activeFolders: [],
  trashedFiles: [],
  totalSizeBytes: 0,
  sizeByCategory: {},
  chunkAvailability: {},
  collaborators: [],
  userPublicKey: 'pk-user1',
};

describe('StorageView', () => {
  it('should render storage view', () => {
    render(<StorageView {...defaultProps} />);
    expect(screen.getByTestId('storage-view')).toBeInTheDocument();
  });

  it('should display summary cards', () => {
    render(<StorageView {...defaultProps} />);
    expect(screen.getByTestId('storage-card-size')).toBeInTheDocument();
    expect(screen.getByTestId('storage-card-files')).toBeInTheDocument();
    expect(screen.getByTestId('storage-card-folders')).toBeInTheDocument();
  });

  it('should show file count', () => {
    const files = [
      { id: 'f1', name: 'a.txt', sizeBytes: 100, typeCategory: 'document' },
      { id: 'f2', name: 'b.jpg', sizeBytes: 200, typeCategory: 'image' },
    ];
    render(<StorageView {...defaultProps} activeFiles={files} />);
    const card = screen.getByTestId('storage-card-files');
    expect(card.textContent).toContain('2');
  });

  it('should show folder count', () => {
    const folders = [{ id: 'd1', name: 'Folder' }];
    render(<StorageView {...defaultProps} activeFolders={folders} />);
    const card = screen.getByTestId('storage-card-folders');
    expect(card.textContent).toContain('1');
  });

  it('should show total size', () => {
    render(<StorageView {...defaultProps} totalSizeBytes={1024 * 1024} />);
    const card = screen.getByTestId('storage-card-size');
    expect(card.textContent).toContain('1');
    expect(card.textContent).toMatch(/MB/i);
  });

  it('should show category breakdown', () => {
    render(<StorageView {...defaultProps} sizeByCategory={{ document: 5000, image: 3000 }} />);
    expect(screen.getByTestId('storage-bar')).toBeInTheDocument();
  });

  it('should show trashed file count', () => {
    const trashedFiles = [{ id: 't1', name: 'trashed.txt', sizeBytes: 100 }];
    render(<StorageView {...defaultProps} trashedFiles={trashedFiles} />);
    const card = screen.getByTestId('storage-card-trash');
    expect(card.textContent).toContain('1');
  });
});
