/**
 * Tests for FileStorageNavRail component.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5, §15.9
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FileStorageNavRail, { FILE_VIEWS } from '../../../frontend/src/components/files/FileStorageNavRail';

describe('FileStorageNavRail', () => {
  const defaultProps = {
    activeView: FILE_VIEWS.BROWSE,
    onViewChange: jest.fn(),
    role: 'admin',
    trashedCount: 0,
    downloadingCount: 0,
    favoriteCount: 0,
  };

  afterEach(() => jest.clearAllMocks());

  it('should render without crashing', () => {
    render(<FileStorageNavRail {...defaultProps} />);
    expect(screen.getByTestId('fs-nav-rail')).toBeInTheDocument();
  });

  it('should render header with Files label', () => {
    render(<FileStorageNavRail {...defaultProps} />);
    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  // --- Role-based nav items ---

  it('should render all 8 items for admin role', () => {
    render(<FileStorageNavRail {...defaultProps} role="admin" />);
    expect(screen.getByTestId('fs-nav-browse')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-recent')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-downloads')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-favorites')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-trash')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-audit_log')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-storage')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-settings')).toBeInTheDocument();
  });

  it('should render all 8 items for owner role', () => {
    render(<FileStorageNavRail {...defaultProps} role="owner" />);
    expect(screen.getByTestId('fs-nav-audit_log')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-settings')).toBeInTheDocument();
  });

  it('should render 5 items for collaborator role', () => {
    render(<FileStorageNavRail {...defaultProps} role="collaborator" />);
    expect(screen.getByTestId('fs-nav-browse')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-recent')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-downloads')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-favorites')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-trash')).toBeInTheDocument();
    expect(screen.queryByTestId('fs-nav-audit_log')).toBeNull();
    expect(screen.queryByTestId('fs-nav-settings')).toBeNull();
  });

  it('should render 4 items for viewer role', () => {
    render(<FileStorageNavRail {...defaultProps} role="viewer" />);
    expect(screen.getByTestId('fs-nav-browse')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-recent')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-downloads')).toBeInTheDocument();
    expect(screen.getByTestId('fs-nav-favorites')).toBeInTheDocument();
    expect(screen.queryByTestId('fs-nav-trash')).toBeNull();
  });

  // --- Active state ---

  it('should mark active view', () => {
    render(<FileStorageNavRail {...defaultProps} activeView={FILE_VIEWS.FAVORITES} />);
    const favBtn = screen.getByTestId('fs-nav-favorites');
    expect(favBtn.classList.contains('active')).toBe(true);
  });

  it('should not mark non-active views', () => {
    render(<FileStorageNavRail {...defaultProps} activeView={FILE_VIEWS.BROWSE} />);
    const recentBtn = screen.getByTestId('fs-nav-recent');
    expect(recentBtn.classList.contains('active')).toBe(false);
  });

  // --- Click handler ---

  it('should call onViewChange when nav item clicked', () => {
    const handler = jest.fn();
    render(<FileStorageNavRail {...defaultProps} onViewChange={handler} />);
    fireEvent.click(screen.getByTestId('fs-nav-recent'));
    expect(handler).toHaveBeenCalledWith(FILE_VIEWS.RECENT);
  });

  it('should pass correct view id for each nav item', () => {
    const handler = jest.fn();
    render(<FileStorageNavRail {...defaultProps} onViewChange={handler} />);
    
    fireEvent.click(screen.getByTestId('fs-nav-trash'));
    expect(handler).toHaveBeenCalledWith(FILE_VIEWS.TRASH);

    fireEvent.click(screen.getByTestId('fs-nav-storage'));
    expect(handler).toHaveBeenCalledWith(FILE_VIEWS.STORAGE);
  });

  // --- Badges ---

  it('should show trashed count badge', () => {
    render(<FileStorageNavRail {...defaultProps} trashedCount={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('should show download count badge', () => {
    render(<FileStorageNavRail {...defaultProps} downloadingCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should show favorite count badge', () => {
    render(<FileStorageNavRail {...defaultProps} favoriteCount={12} />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('should not show badge when count is 0', () => {
    const { container } = render(<FileStorageNavRail {...defaultProps} />);
    const badges = container.querySelectorAll('.file-storage-nav-badge');
    expect(badges.length).toBe(0);
  });

  it('should cap badge display at 99+', () => {
    render(<FileStorageNavRail {...defaultProps} trashedCount={150} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  // --- FILE_VIEWS export ---

  it('should export all view constants', () => {
    expect(FILE_VIEWS.BROWSE).toBe('browse');
    expect(FILE_VIEWS.RECENT).toBe('recent');
    expect(FILE_VIEWS.DOWNLOADS).toBe('downloads');
    expect(FILE_VIEWS.FAVORITES).toBe('favorites');
    expect(FILE_VIEWS.TRASH).toBe('trash');
    expect(FILE_VIEWS.AUDIT_LOG).toBe('audit_log');
    expect(FILE_VIEWS.STORAGE).toBe('storage');
    expect(FILE_VIEWS.SETTINGS).toBe('settings');
  });
});
