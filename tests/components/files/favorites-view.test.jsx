/**
 * Tests for FavoritesView component.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FavoritesView from '../../../frontend/src/components/files/FavoritesView';

const baseFavFile = (overrides = {}) => ({
  id: 'fav1',
  name: 'starred-doc.pdf',
  sizeBytes: 4096,
  extension: 'pdf',
  typeCategory: 'document',
  createdAt: Date.now() - 50000,
  updatedAt: Date.now(),
  deletedAt: null,
  favoritedBy: ['pk-user1'],
  tags: [],
  ...overrides,
});

const defaultProps = {
  activeFiles: [],
  userIdentity: { publicKeyBase62: 'pk-user1', displayName: 'Alice' },
  onSelectFile: jest.fn(),
  onToggleFavorite: jest.fn(),
};

describe('FavoritesView', () => {
  afterEach(() => jest.clearAllMocks());

  it('should render empty state when no favorites', () => {
    render(<FavoritesView {...defaultProps} />);
    expect(screen.getByTestId('favorites-view')).toBeInTheDocument();
    expect(screen.getByTestId('favorites-empty')).toBeInTheDocument();
  });

  it('should render favorited files', () => {
    render(<FavoritesView {...defaultProps} activeFiles={[baseFavFile()]} />);
    expect(screen.getByText('starred-doc.pdf')).toBeInTheDocument();
    expect(screen.getByTestId('favorites-list')).toBeInTheDocument();
  });

  it('should not show non-favorited files', () => {
    const nonFav = baseFavFile({ id: 'nf1', name: 'not-fav.txt', favoritedBy: [] });
    render(<FavoritesView {...defaultProps} activeFiles={[nonFav]} />);
    expect(screen.getByTestId('favorites-empty')).toBeInTheDocument();
  });

  it('should call onToggleFavorite when unfavorite clicked', () => {
    render(<FavoritesView {...defaultProps} activeFiles={[baseFavFile()]} />);
    fireEvent.click(screen.getByTestId('unfav-fav1'));
    expect(defaultProps.onToggleFavorite).toHaveBeenCalledWith('fav1');
  });

  it('should filter by current user publicKey', () => {
    const otherUserFav = baseFavFile({ id: 'other', name: 'other-fav.txt', favoritedBy: ['pk-other'] });
    render(<FavoritesView {...defaultProps} activeFiles={[otherUserFav]} />);
    expect(screen.getByTestId('favorites-empty')).toBeInTheDocument();
  });
});
