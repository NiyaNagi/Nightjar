/**
 * Tests for DownloadsView and DownloadsBar components.
 * 
 * Tests Open File / Show in Folder buttons, progress bar display,
 * and download history rendering.
 * 
 * See docs/FILE_STORAGE_SPEC.md §7, §15.9
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DownloadsView from '../../../frontend/src/components/files/DownloadsView';
import DownloadsBar from '../../../frontend/src/components/files/DownloadsBar';

// Mock window.electronAPI
const mockOpenFile = jest.fn();
const mockShowInFolder = jest.fn();

beforeAll(() => {
  window.electronAPI = {
    fileSystem: {
      openFile: mockOpenFile,
      showInFolder: mockShowInFolder,
      selectFolder: jest.fn(),
      saveDownload: jest.fn(),
    },
  };
});

afterAll(() => {
  delete window.electronAPI;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DownloadsView', () => {
  const defaultProps = {
    downloads: [],
    downloadHistory: [],
    onClearDownload: jest.fn(),
    onClearHistory: jest.fn(),
    onRetryDownload: jest.fn(),
  };

  it('should render without crashing', () => {
    render(<DownloadsView {...defaultProps} />);
    expect(screen.getByTestId('downloads-view')).toBeInTheDocument();
  });

  it('should show empty state when no downloads', () => {
    render(<DownloadsView {...defaultProps} />);
    expect(screen.getByText(/No downloads yet/i)).toBeInTheDocument();
  });

  it('should show active downloads', () => {
    const props = {
      ...defaultProps,
      downloads: [
        {
          downloadId: 'd1',
          fileId: 'f1',
          fileName: 'report.pdf',
          status: 'fetching',
          startedAt: Date.now(),
          totalChunks: 10,
          chunksDownloaded: 5,
          isActive: true,
        },
      ],
    };

    render(<DownloadsView {...props} />);
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('should show Open File button for completed downloads with filePath', () => {
    const props = {
      ...defaultProps,
      downloads: [
        {
          downloadId: 'd1',
          fileId: 'f1',
          fileName: 'complete.pdf',
          status: 'complete',
          startedAt: Date.now(),
          totalChunks: 1,
          chunksDownloaded: 1,
          filePath: 'C:\\Downloads\\complete.pdf',
          isActive: false,
        },
      ],
      downloadHistory: [
        {
          downloadId: 'd1',
          fileId: 'f1',
          fileName: 'complete.pdf',
          status: 'complete',
          startedAt: Date.now(),
          completedAt: Date.now(),
          filePath: 'C:\\Downloads\\complete.pdf',
          isActive: false,
        },
      ],
    };

    render(<DownloadsView {...props} />);
    // Should have open file button(s)
    const openBtns = screen.getAllByTitle(/Open File/i);
    expect(openBtns.length).toBeGreaterThan(0);
  });

  it('should show Show in Folder button for completed downloads', () => {
    const props = {
      ...defaultProps,
      downloads: [
        {
          downloadId: 'd1',
          fileId: 'f1',
          fileName: 'complete.pdf',
          status: 'complete',
          startedAt: Date.now(),
          totalChunks: 1,
          chunksDownloaded: 1,
          filePath: 'C:\\Downloads\\complete.pdf',
          isActive: false,
        },
      ],
      downloadHistory: [
        {
          downloadId: 'd1',
          fileId: 'f1',
          fileName: 'complete.pdf',
          status: 'complete',
          startedAt: Date.now(),
          completedAt: Date.now(),
          filePath: 'C:\\Downloads\\complete.pdf',
          isActive: false,
        },
      ],
    };

    render(<DownloadsView {...props} />);
    const folderBtns = screen.getAllByTitle(/Show in Folder/i);
    expect(folderBtns.length).toBeGreaterThan(0);
  });

  it('should not show file action buttons for downloads without filePath', () => {
    const props = {
      ...defaultProps,
      downloadHistory: [
        {
          downloadId: 'd1',
          fileId: 'f1',
          fileName: 'legacy.pdf',
          status: 'complete',
          startedAt: Date.now(),
          completedAt: Date.now(),
          isActive: false,
        },
      ],
    };

    render(<DownloadsView {...props} />);
    expect(screen.queryByTitle(/Open File/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Show in Folder/i)).not.toBeInTheDocument();
  });

  it('should call electronAPI.fileSystem.openFile when Open File clicked', () => {
    const filePath = 'C:\\Downloads\\test.pdf';
    const props = {
      ...defaultProps,
      downloadHistory: [
        {
          downloadId: 'd1',
          fileId: 'f1',
          fileName: 'test.pdf',
          status: 'complete',
          startedAt: Date.now(),
          completedAt: Date.now(),
          filePath,
          isActive: false,
        },
      ],
    };

    render(<DownloadsView {...props} />);
    const openBtn = screen.getByTitle(/Open File/i);
    fireEvent.click(openBtn);
    expect(mockOpenFile).toHaveBeenCalledWith(filePath);
  });

  it('should call electronAPI.fileSystem.showInFolder when Show in Folder clicked', () => {
    const filePath = 'C:\\Downloads\\test.pdf';
    const props = {
      ...defaultProps,
      downloadHistory: [
        {
          downloadId: 'd1',
          fileId: 'f1',
          fileName: 'test.pdf',
          status: 'complete',
          startedAt: Date.now(),
          completedAt: Date.now(),
          filePath,
          isActive: false,
        },
      ],
    };

    render(<DownloadsView {...props} />);
    const folderBtn = screen.getByTitle(/Show in Folder/i);
    fireEvent.click(folderBtn);
    expect(mockShowInFolder).toHaveBeenCalledWith(filePath);
  });
});

describe('DownloadsBar', () => {
  const defaultProps = {
    downloads: [],
    onClearDownload: jest.fn(),
    onClearAll: jest.fn(),
  };

  it('should return null when no downloads', () => {
    const { container } = render(<DownloadsBar {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('should show active download with file name', () => {
    const props = {
      ...defaultProps,
      downloads: [
        {
          downloadId: 'd1',
          fileName: 'report.pdf',
          status: 'fetching',
          totalChunks: 10,
          chunksDownloaded: 5,
        },
      ],
    };

    render(<DownloadsBar {...props} />);
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('should show correct progress via bar fill width', () => {
    const props = {
      ...defaultProps,
      downloads: [
        {
          downloadId: 'd1',
          fileName: 'data.zip',
          status: 'fetching',
          totalChunks: 4,
          chunksDownloaded: 3,
        },
      ],
    };

    const { container } = render(<DownloadsBar {...props} />);
    const fill = container.querySelector('.downloads-bar-progress-fill');
    expect(fill).toBeInTheDocument();
    expect(fill.style.width).toBe('75%');
  });

  it('should show Open File button for completed downloads with filePath', () => {
    const props = {
      ...defaultProps,
      downloads: [
        {
          downloadId: 'd1',
          fileName: 'done.pdf',
          status: 'complete',
          totalChunks: 1,
          chunksDownloaded: 1,
          filePath: 'C:\\Downloads\\done.pdf',
        },
      ],
    };

    render(<DownloadsBar {...props} />);
    const openBtn = screen.getByTitle(/Open File/i);
    expect(openBtn).toBeInTheDocument();
  });

  it('should call electronAPI.fileSystem.openFile from bar', () => {
    const filePath = 'C:\\Downloads\\done.pdf';
    const props = {
      ...defaultProps,
      downloads: [
        {
          downloadId: 'd1',
          fileName: 'done.pdf',
          status: 'complete',
          totalChunks: 1,
          chunksDownloaded: 1,
          filePath,
        },
      ],
    };

    render(<DownloadsBar {...props} />);
    const openBtn = screen.getByTitle(/Open File/i);
    fireEvent.click(openBtn);
    expect(mockOpenFile).toHaveBeenCalledWith(filePath);
  });

  it('should call electronAPI.fileSystem.showInFolder from bar', () => {
    const filePath = 'C:\\Downloads\\done.pdf';
    const props = {
      ...defaultProps,
      downloads: [
        {
          downloadId: 'd1',
          fileName: 'done.pdf',
          status: 'complete',
          totalChunks: 1,
          chunksDownloaded: 1,
          filePath,
        },
      ],
    };

    render(<DownloadsBar {...props} />);
    const folderBtn = screen.getByTitle(/Show in Folder/i);
    fireEvent.click(folderBtn);
    expect(mockShowInFolder).toHaveBeenCalledWith(filePath);
  });
});
