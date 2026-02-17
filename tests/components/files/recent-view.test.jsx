/**
 * Tests for RecentView component.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import RecentView from '../../../frontend/src/components/files/RecentView';

const baseFile = (overrides = {}) => ({
  id: 'r1',
  name: 'recent-doc.pdf',
  sizeBytes: 2048,
  extension: 'pdf',
  typeCategory: 'document',
  createdAt: Date.now() - 100000,
  updatedAt: Date.now() - 5000,
  deletedAt: null,
  folderId: null,
  favoritedBy: [],
  tags: [],
  ...overrides,
});

const defaultProps = {
  activeFiles: [],
  activeFolders: [],
  chunkAvailability: {},
  userPublicKey: 'pk-user1',
  onSelectFile: jest.fn(),
  onDownloadFile: jest.fn(),
};

describe('RecentView', () => {
  it('should render empty state when no files', () => {
    render(<RecentView {...defaultProps} />);
    expect(screen.getByTestId('recent-view')).toBeInTheDocument();
    expect(screen.getByTestId('recent-empty')).toBeInTheDocument();
  });

  it('should render recent files sorted by updatedAt', () => {
    const files = [
      baseFile({ id: 'r1', name: 'older.txt', updatedAt: Date.now() - 20000 }),
      baseFile({ id: 'r2', name: 'newer.txt', updatedAt: Date.now() - 1000 }),
    ];
    render(<RecentView {...defaultProps} activeFiles={files} />);
    expect(screen.getByTestId('recent-list')).toBeInTheDocument();
    
    const items = screen.getByTestId('recent-list');
    const rows = items.querySelectorAll('[data-testid^="recent-file-"]');
    expect(rows).toHaveLength(2);
    // Newer first
    expect(rows[0].getAttribute('data-testid')).toBe('recent-file-r2');
  });

  it('should show file names', () => {
    render(<RecentView {...defaultProps} activeFiles={[baseFile()]} />);
    expect(screen.getByText('recent-doc.pdf')).toBeInTheDocument();
  });

  it('should limit to 100 files', () => {
    const files = Array.from({ length: 120 }, (_, i) => 
      baseFile({ id: `f${i}`, name: `file-${i}.txt`, updatedAt: Date.now() - i * 1000 })
    );
    render(<RecentView {...defaultProps} activeFiles={files} />);
    const items = screen.getByTestId('recent-list');
    const rows = items.querySelectorAll('[data-testid^="recent-file-"]');
    expect(rows.length).toBeLessThanOrEqual(100);
  });
});
