/**
 * Tests for DownloadsView component.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DownloadsView from '../../../frontend/src/components/files/DownloadsView';

const defaultProps = {
  downloads: [],
  downloadHistory: [],
  onClearDownload: jest.fn(),
  onClearHistory: jest.fn(),
  onRetryDownload: jest.fn(),
};

describe('DownloadsView', () => {
  afterEach(() => jest.clearAllMocks());

  it('should render empty state when no downloads', () => {
    render(<DownloadsView {...defaultProps} />);
    expect(screen.getByTestId('downloads-view')).toBeInTheDocument();
    expect(screen.getByTestId('downloads-empty')).toBeInTheDocument();
  });

  it('should render active downloads', () => {
    const downloads = [
      { downloadId: 'd1', fileName: 'downloading.zip', sizeBytes: 5000, status: 'fetching', progress: 30, startedAt: Date.now() },
    ];
    render(<DownloadsView {...defaultProps} downloads={downloads} />);
    expect(screen.getByTestId('downloads-list')).toBeInTheDocument();
    expect(screen.getByText('downloading.zip')).toBeInTheDocument();
  });

  it('should render download history', () => {
    const history = [
      { downloadId: 'h1', fileName: 'completed.pdf', sizeBytes: 10000, status: 'complete', completedAt: Date.now() - 60000, isActive: false },
    ];
    render(<DownloadsView {...defaultProps} downloadHistory={history} />);
    expect(screen.getByText('completed.pdf')).toBeInTheDocument();
  });

  it('should call onClearDownload when clear button clicked', () => {
    const downloads = [
      { downloadId: 'd1', fileName: 'done.pdf', sizeBytes: 5000, status: 'complete', startedAt: Date.now() },
    ];
    render(<DownloadsView {...defaultProps} downloads={downloads} />);
    fireEvent.click(screen.getByTestId('download-clear-d1'));
    expect(defaultProps.onClearDownload).toHaveBeenCalledWith('d1');
  });

  it('should show retry button for errored downloads', () => {
    const downloads = [
      { downloadId: 'd-err', fileName: 'failed.zip', sizeBytes: 1000, status: 'error', startedAt: Date.now(), error: 'Network error' },
    ];
    render(<DownloadsView {...defaultProps} downloads={downloads} />);
    expect(screen.getByTestId('download-retry-d-err')).toBeInTheDocument();
  });

  it('should call onRetryDownload when retry clicked', () => {
    const downloads = [
      { downloadId: 'd-err', fileName: 'failed.zip', fileId: 'file-err', sizeBytes: 1000, status: 'error', startedAt: Date.now(), error: 'Network error' },
    ];
    render(<DownloadsView {...defaultProps} downloads={downloads} />);
    fireEvent.click(screen.getByTestId('download-retry-d-err'));
    expect(defaultProps.onRetryDownload).toHaveBeenCalled();
  });

  it('should call onClearHistory when clear all clicked', () => {
    const history = [
      { downloadId: 'h1', fileName: 'old.pdf', sizeBytes: 100, status: 'complete', completedAt: Date.now(), isActive: false },
    ];
    render(<DownloadsView {...defaultProps} downloadHistory={history} />);
    fireEvent.click(screen.getByTestId('downloads-clear-all'));
    expect(defaultProps.onClearHistory).toHaveBeenCalled();
  });
});
