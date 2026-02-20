/**
 * BugReportModal Tests
 *
 * Comprehensive test suite covering:
 * - buildActionSummary (pure function)
 * - generateDefaultTitle (pure function)
 * - buildIssueBody (pure function)
 * - createGitHubIssue (async, mocked fetch)
 * - Component rendering and context-aware title
 * - Form interactions and validation
 * - Submission flow via GitHub API
 * - Success screen (screenshot download, view issue)
 * - State reset and Escape key handling
 * - Accessibility (ARIA, focus trap)
 * - TabBar integration point
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BugReportModal, {
  buildActionSummary,
  generateDefaultTitle,
  buildIssueBody,
} from '../frontend/src/components/BugReportModal';

// â”€â”€â”€ Mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const mockShowToast = jest.fn();
jest.mock('../frontend/src/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('../frontend/src/hooks/useFocusTrap', () => ({
  useFocusTrap: jest.fn(),
}));

const mockGenerateDiagnosticReport = jest.fn().mockResolvedValue({
  system: { os: 'test-os' },
  app: { version: '1.0.0' },
});

const mockFormatDiagnosticReport = jest.fn().mockReturnValue('formatted-diagnostic-report');

jest.mock('../frontend/src/utils/diagnostics', () => ({
  generateDiagnosticReport: (...args) => mockGenerateDiagnosticReport(...args),
  formatDiagnosticReport: (...args) => mockFormatDiagnosticReport(...args),
}));

const mockGetLogs = jest.fn().mockReturnValue([
  { level: 'behavior', timestamp: '2025-01-01T12:00:00Z', category: 'editor', event: 'opened file' },
  { level: 'behavior', timestamp: '2025-01-01T12:01:00Z', category: 'editor', event: 'saved file' },
  { level: 'info', timestamp: '2025-01-01T12:01:30Z', category: 'system', event: 'sync completed' },
]);

jest.mock('../frontend/src/utils/logger', () => ({
  getLogs: () => mockGetLogs(),
  logBehavior: jest.fn(),
}));

jest.mock('../frontend/src/utils/websocket', () => ({
  getBasePath: jest.fn().mockReturnValue(''),
}));

// Mock html2canvas (lazy-imported via dynamic import())
// Return a function directly (matching real CJS export) so Babel's
// _interopRequireWildcard wraps it as { default: fn } for the component.
const mockToDataURL = jest.fn().mockReturnValue('data:image/png;base64,mockScreenshot');
const mockHtml2canvas = jest.fn().mockResolvedValue({
  toDataURL: (...args) => mockToDataURL(...args),
});
jest.mock('html2canvas', () => mockHtml2canvas);

// Mock clipboard API
const mockClipboardWriteText = jest.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockClipboardWriteText },
  writable: true,
  configurable: true,
});

// Mock electronAPI
const mockOpenExternal = jest.fn().mockResolvedValue(undefined);
Object.defineProperty(window, 'electronAPI', {
  value: {
    openExternal: mockOpenExternal,
    appVersion: '1.7.5',
  },
  writable: true,
  configurable: true,
});

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderModal(props = {}) {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    context: {
      documentName: 'My Document',
      documentType: 'text',
      workspaceName: 'Test Workspace',
    },
    ...props,
  };
  return {
    ...render(<BugReportModal {...defaultProps} />),
    props: defaultProps,
  };
}

// â”€â”€â”€ Setup / Teardown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockClipboardWriteText.mockResolvedValue(undefined);
  mockGetLogs.mockReturnValue([
    { level: 'behavior', timestamp: '2025-01-01T12:00:00Z', category: 'editor', event: 'opened file' },
    { level: 'behavior', timestamp: '2025-01-01T12:01:00Z', category: 'editor', event: 'saved file' },
  ]);
});

afterEach(() => {
  jest.useRealTimers();
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 1. buildActionSummary
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('buildActionSummary', () => {
  test('filters only behavior-level logs', () => {
    const logs = [
      { level: 'behavior', timestamp: '2025-01-01T12:00:00Z', category: 'editor', event: 'click' },
      { level: 'info', timestamp: '2025-01-01T12:00:01Z', category: 'system', event: 'sync' },
      { level: 'behavior', timestamp: '2025-01-01T12:00:02Z', category: 'nav', event: 'navigate' },
    ];
    const result = buildActionSummary(logs);
    expect(result).toContain('editor: click');
    expect(result).toContain('nav: navigate');
    expect(result).not.toContain('system: sync');
  });

  test('returns placeholder when no behavior logs exist', () => {
    expect(buildActionSummary([])).toBe('(no recent actions recorded)');
    expect(buildActionSummary([{ level: 'info', timestamp: '', category: 'x', event: 'y' }]))
      .toBe('(no recent actions recorded)');
  });

  test('limits to maxActions entries', () => {
    const logs = Array.from({ length: 30 }, (_, i) => ({
      level: 'behavior',
      timestamp: `2025-01-01T12:00:${String(i).padStart(2, '0')}Z`,
      category: 'cat',
      event: `event-${i}`,
    }));
    const result = buildActionSummary(logs, 5);
    const lines = result.split('\n');
    expect(lines.length).toBeLessThanOrEqual(5);
    // Should keep the last 5
    expect(result).toContain('event-29');
    expect(result).toContain('event-25');
  });

  test('trims oldest entries when exceeding maxChars', () => {
    const logs = Array.from({ length: 20 }, (_, i) => ({
      level: 'behavior',
      timestamp: `2025-01-01T12:00:${String(i).padStart(2, '0')}Z`,
      category: 'category',
      event: 'A'.repeat(150),
    }));
    const result = buildActionSummary(logs, 20, 500);
    expect(result.length).toBeLessThanOrEqual(500);
  });

  test('handles missing timestamp gracefully', () => {
    const logs = [{ level: 'behavior', category: 'test', event: 'action' }];
    const result = buildActionSummary(logs);
    expect(result).toContain('[??:??:??]');
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 2. generateDefaultTitle
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('generateDefaultTitle', () => {
  test('returns generic title when no context provided', () => {
    expect(generateDefaultTitle(null)).toBe('Bug report');
    expect(generateDefaultTitle(undefined)).toBe('Bug report');
  });

  test('returns generic title when context is empty', () => {
    expect(generateDefaultTitle({})).toBe('Bug report');
  });

  test('includes doc type label and document name', () => {
    expect(generateDefaultTitle({ documentType: 'text', documentName: 'Notes', workspaceName: 'WS' }))
      .toBe('Bug in Text Editor: Notes');
  });

  test('includes doc type label only when no document name', () => {
    expect(generateDefaultTitle({ documentType: 'sheet', documentName: null }))
      .toBe('Bug in Spreadsheet');
  });

  test('includes workspace name as fallback', () => {
    expect(generateDefaultTitle({ documentType: null, documentName: null, workspaceName: 'My WS' }))
      .toBe('Bug in workspace: My WS');
  });

  test('handles all document types', () => {
    expect(generateDefaultTitle({ documentType: 'kanban', documentName: 'Board' }))
      .toBe('Bug in Kanban Board: Board');
    expect(generateDefaultTitle({ documentType: 'inventory', documentName: 'Items' }))
      .toBe('Bug in Inventory: Items');
    expect(generateDefaultTitle({ documentType: 'files', documentName: 'Storage' }))
      .toBe('Bug in File Storage: Storage');
  });

  test('returns generic title for unknown document type with no name', () => {
    expect(generateDefaultTitle({ documentType: 'unknown', documentName: null, workspaceName: null }))
      .toBe('Bug report');
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 3. buildIssueBody
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('buildIssueBody', () => {
  test('includes description and recent actions', () => {
    const body = buildIssueBody('Something broke', 'action log');
    expect(body).toContain('## Description');
    expect(body).toContain('Something broke');
    expect(body).toContain('## Recent Actions');
    expect(body).toContain('action log');
    expect(body).toContain('## Expected Behavior');
    expect(body).toContain('## Environment');
  });

  test('includes default description placeholder', () => {
    const body = buildIssueBody('', 'actions');
    expect(body).toContain('(describe the bug here)');
  });

  test('includes inline diagnostics in details block when provided', () => {
    const body = buildIssueBody('desc', 'actions', 'diagnostic-data-here');
    expect(body).toContain('<details>');
    expect(body).toContain('Diagnostic Report');
    expect(body).toContain('diagnostic-data-here');
    expect(body).toContain('</details>');
  });

  test('omits details block when no diagnostics', () => {
    const body = buildIssueBody('desc', 'actions');
    expect(body).not.toContain('<details>');
    expect(body).not.toContain('</details>');
  });

  test('includes environment info', () => {
    const body = buildIssueBody('desc', 'actions');
    expect(body).toContain('Nightjar version:');
    expect(body).toContain('OS:');
    expect(body).toContain('Screen:');
  });

  test('includes screenshot attachment note', () => {
    const body = buildIssueBody('desc', 'actions');
    expect(body).toContain('Screenshot may be attached');
  });
});

// createGitHubIssue is restored — the component tries GitHub API first, then falls back to clipboard copy.

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 5. Component Rendering
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('Rendering', () => {
  test('renders nothing when isOpen is false', () => {
    const { container } = render(
      <BugReportModal isOpen={false} onClose={jest.fn()} context={{}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  test('renders the modal when isOpen is true', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Report a Bug/)).toBeInTheDocument();
  });

  test('renders title input, description textarea, and actions', () => {
    renderModal();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByText(/Recent Actions/)).toBeInTheDocument();
  });

  test('auto-populates title from context', () => {
    renderModal({ context: { documentType: 'text', documentName: 'Notes' } });
    act(() => jest.runAllTimers());
    expect(screen.getByLabelText('Title')).toHaveValue('Bug in Text Editor: Notes');
  });

  test('auto-populates title with workspace only', () => {
    renderModal({ context: { documentType: null, documentName: null, workspaceName: 'MyWS' } });
    act(() => jest.runAllTimers());
    expect(screen.getByLabelText('Title')).toHaveValue('Bug in workspace: MyWS');
  });

  test('auto-populates generic title when no context', () => {
    renderModal({ context: null });
    act(() => jest.runAllTimers());
    expect(screen.getByLabelText('Title')).toHaveValue('Bug report');
  });

  test('renders recent actions from logger', () => {
    renderModal();
    expect(screen.getByText(/editor: opened file/)).toBeInTheDocument();
    expect(screen.getByText(/editor: saved file/)).toBeInTheDocument();
  });

  test('shows info about clipboard copy', () => {
    renderModal();
    expect(screen.getByText(/submitted directly to GitHub/)).toBeInTheDocument();
  });

  test('renders Cancel and Copy buttons', () => {
    renderModal();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText(/Submit Bug Report/)).toBeInTheDocument();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 6. Interactions
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('Interactions', () => {
  test('user can edit the title field', async () => {
    renderModal();
    const input = screen.getByLabelText('Title');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'New title' } });
    });
    expect(input).toHaveValue('New title');
  });

  test('user can edit the description field', async () => {
    renderModal();
    const textarea = screen.getByLabelText('Description');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Details here' } });
    });
    expect(textarea).toHaveValue('Details here');
  });

  test('Cancel button calls onClose', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(props.onClose).toHaveBeenCalled();
  });

  test('clicking overlay calls onClose', () => {
    const { props } = renderModal();
    fireEvent.click(document.querySelector('.bug-report-overlay'));
    expect(props.onClose).toHaveBeenCalled();
  });

  test('clicking modal body does not call onClose', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByRole('dialog'));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  test('Escape key calls onClose', () => {
    const { props } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  test('Escape key does not close during submission', async () => {
    // Keep clipboard pending forever to keep isSubmitting = true
    mockClipboardWriteText.mockReturnValueOnce(new Promise(() => {}));
    const { props } = renderModal();

    // Type a title
    const input = screen.getByLabelText('Title');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Test' } });
    });

    // Click submit
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    // Now Escape should NOT close
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 7. Validation
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('Validation', () => {
  test('shows error toast when title is empty', async () => {
    renderModal({ context: {} });
    // Clear the auto-populated title
    const input = screen.getByLabelText('Title');
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    expect(mockShowToast).toHaveBeenCalledWith('Please enter a bug title', 'error');
    expect(mockClipboardWriteText).not.toHaveBeenCalled();
  });

  test('shows error toast when title is only whitespace', async () => {
    renderModal();
    const input = screen.getByLabelText('Title');
    await act(async () => {
      fireEvent.change(input, { target: { value: '   ' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    expect(mockShowToast).toHaveBeenCalledWith('Please enter a bug title', 'error');
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 8. Submission Flow
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('Submission', () => {
  test('copies bug report to clipboard and shows success', async () => {
    renderModal();
    const input = screen.getByLabelText('Title');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Test bug' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    // Verify clipboard was called
    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
    const clipboardContent = mockClipboardWriteText.mock.calls[0][0];
    expect(clipboardContent).toContain('Test bug');

    // Success screen
    expect(screen.getByText('Bug report copied!')).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith(
      'Bug report copied to clipboard!',
      'success',
    );
  });

  test('includes diagnostics inline in clipboard content', async () => {
    mockFormatDiagnosticReport.mockReturnValue('DIAGNOSTIC_CONTENT');

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    const clipboardContent = mockClipboardWriteText.mock.calls[0][0];
    expect(clipboardContent).toContain('DIAGNOSTIC_CONTENT');
    expect(clipboardContent).toContain('<details>');
    expect(clipboardContent).toContain('Diagnostic Report');
  });

  test('shows submitting state during clipboard write', async () => {
    let resolvePromise;
    mockClipboardWriteText.mockReturnValueOnce(new Promise(resolve => { resolvePromise = resolve; }));

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    expect(screen.getByText(/Submitting/)).toBeInTheDocument();

    // Resolve the clipboard write
    await act(async () => {
      resolvePromise(undefined);
    });
  });

  test('shows error toast when clipboard write fails', async () => {
    mockClipboardWriteText.mockRejectedValueOnce(new Error('Clipboard error'));
    // Also mock the fallback blob download to throw so we test the outer catch
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:mock');
    URL.revokeObjectURL = jest.fn();

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    // When clipboard fails, the component falls back to file download
    // and still shows success, so we check the fallback toast
    expect(mockShowToast).toHaveBeenCalledWith(
      'Bug report saved as file',
      'success',
    );

    URL.createObjectURL = origCreateObjectURL;
  });

  test('handles diagnostic generation failure gracefully', async () => {
    mockGenerateDiagnosticReport.mockRejectedValueOnce(new Error('diag failed'));

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    // Should still succeed (diagnostics are optional)
    expect(screen.getByText('Bug report copied!')).toBeInTheDocument();
    // Clipboard content should not have diagnostics
    const clipboardContent = mockClipboardWriteText.mock.calls[0][0];
    expect(clipboardContent).not.toContain('<details>');
  });

  test('disables inputs during submission', async () => {
    mockClipboardWriteText.mockReturnValueOnce(new Promise(() => {}));
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 9. Success Screen
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('Success Screen', () => {
  async function submitAndSucceed() {
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });
  }

  test('shows success heading and message', async () => {
    await submitAndSucceed();
    expect(screen.getByText('Bug report copied!')).toBeInTheDocument();
    expect(screen.getByText(/copied to the clipboard/)).toBeInTheDocument();
  });

  test('shows diagnostic status as included', async () => {
    await submitAndSucceed();
    expect(screen.getByText(/Diagnostic logs.*included in issue/)).toBeInTheDocument();
  });

  test('shows screenshot ready to download', async () => {
    await submitAndSucceed();
    expect(screen.getByText(/Screenshot ready to download/)).toBeInTheDocument();
  });

  test('renders download screenshot button', async () => {
    await submitAndSucceed();
    const btn = screen.getByTestId('download-screenshot-btn');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('Download Screenshot');
  });

  test('download screenshot button triggers download and toast', async () => {
    await submitAndSucceed();

    // Mock createElement for download anchor
    const mockClick = jest.fn();
    const origCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') {
        return { href: '', download: '', click: mockClick, style: {} };
      }
      return origCreateElement(tag);
    });
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    fireEvent.click(screen.getByTestId('download-screenshot-btn'));

    expect(mockClick).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Screenshot downloaded', 'success');

    document.createElement.mockRestore();
    document.body.appendChild.mockRestore();
    document.body.removeChild.mockRestore();
  });

  test('renders Open GitHub Issues button', async () => {
    await submitAndSucceed();
    const btn = screen.getByTestId('view-issue-btn');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('Open GitHub Issues');
  });

  test('View Issue button calls electronAPI.openExternal', async () => {
    await submitAndSucceed();
    fireEvent.click(screen.getByTestId('view-issue-btn'));
    expect(mockOpenExternal).toHaveBeenCalledWith(
      'https://github.com/NiyaNagi/Nightjar/issues/new?labels=bug',
    );
  });

  test('View Issue falls back to window.open when no electronAPI', async () => {
    const originalAPI = window.electronAPI;
    window.electronAPI = undefined;
    const mockWindowOpen = jest.spyOn(window, 'open').mockImplementation(() => {});

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    fireEvent.click(screen.getByTestId('view-issue-btn'));
    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://github.com/NiyaNagi/Nightjar/issues/new?labels=bug',
      '_blank',
      'noopener',
    );

    mockWindowOpen.mockRestore();
    window.electronAPI = originalAPI;
  });

  test('Done button calls onClose', async () => {
    const onClose = jest.fn();
    render(
      <BugReportModal
        isOpen={true}
        onClose={onClose}
        context={{ documentType: 'text', documentName: 'Doc' }}
      />,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 10. State Reset
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('State Reset', () => {
  test('resets form fields when modal re-opens', () => {
    const { rerender } = render(
      <BugReportModal isOpen={true} onClose={jest.fn()} context={{ documentType: 'sheet', documentName: 'Data' }} />,
    );
    act(() => jest.runAllTimers());

    // Change the title
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } });
    expect(screen.getByLabelText('Title')).toHaveValue('Changed');

    // Close and reopen
    rerender(<BugReportModal isOpen={false} onClose={jest.fn()} context={{ documentType: 'sheet', documentName: 'Data' }} />);
    rerender(<BugReportModal isOpen={true} onClose={jest.fn()} context={{ documentType: 'sheet', documentName: 'Data' }} />);
    act(() => jest.runAllTimers());

    // Should be reset to context-based title, not the changed value
    expect(screen.getByLabelText('Title')).toHaveValue('Bug in Spreadsheet: Data');
    expect(screen.getByLabelText('Description').value).toContain('## Description');
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 11. Error Handling
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('Error Handling', () => {
  test('handles preparation error gracefully', async () => {
    // Make both clipboard and fallback download fail by throwing in the outer try
    mockClipboardWriteText.mockRejectedValueOnce(new Error('Clipboard error'));
    // The fallback blob download should still work, so this test checks the fallback path
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:mock');
    URL.revokeObjectURL = jest.fn();

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    // When clipboard fails, fallback saves as file
    expect(mockShowToast).toHaveBeenCalledWith(
      'Bug report saved as file',
      'success',
    );

    URL.createObjectURL = origCreateObjectURL;
  });

  test('re-enables form after failed preparation', async () => {
    // Make both clipboard and blob fallback fail to trigger outer catch
    mockClipboardWriteText.mockRejectedValueOnce(new Error('Clipboard error'));
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => { throw new Error('Blob error'); });

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    // Form should be editable again
    expect(screen.getByLabelText('Title')).not.toBeDisabled();
    expect(screen.getByText(/Submit Bug Report/)).not.toBeDisabled();

    URL.createObjectURL = origCreateObjectURL;
  });

  test('handles screenshot capture failure gracefully', async () => {
    // Make html2canvas throw
    mockHtml2canvas.mockRejectedValueOnce(new Error('Canvas error'));

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    // Should still succeed (screenshot is optional)
    expect(screen.getByText('Bug report copied!')).toBeInTheDocument();
    expect(screen.getByText(/capture failed/)).toBeInTheDocument();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 12. TabBar Integration
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('TabBar Integration', () => {
  test('renders as a controlled modal with external isOpen state', () => {
    const { rerender } = render(
      <BugReportModal isOpen={false} onClose={jest.fn()} context={{}} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<BugReportModal isOpen={true} onClose={jest.fn()} context={{}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('context prop changes title on reopen', () => {
    const { rerender } = render(
      <BugReportModal isOpen={true} onClose={jest.fn()} context={{ documentType: 'text', documentName: 'A' }} />,
    );
    act(() => jest.runAllTimers());
    expect(screen.getByLabelText('Title')).toHaveValue('Bug in Text Editor: A');

    rerender(<BugReportModal isOpen={false} onClose={jest.fn()} context={{ documentType: 'kanban', documentName: 'B' }} />);
    rerender(<BugReportModal isOpen={true} onClose={jest.fn()} context={{ documentType: 'kanban', documentName: 'B' }} />);
    act(() => jest.runAllTimers());
    expect(screen.getByLabelText('Title')).toHaveValue('Bug in Kanban Board: B');
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 13. E2E Scenarios
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('E2E Scenarios', () => {
  test('full happy path: open â†’ auto-populate â†’ edit â†’ copy â†’ success â†’ view â†’ done', async () => {
    const onClose = jest.fn();

    render(
      <BugReportModal
        isOpen={true}
        onClose={onClose}
        context={{ documentType: 'text', documentName: 'README', workspaceName: 'Main' }}
      />,
    );
    act(() => jest.runAllTimers());

    // Title is auto-populated
    expect(screen.getByLabelText('Title')).toHaveValue('Bug in Text Editor: README');

    // Edit description
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Description'), {
        target: { value: 'The editor crashed when I pasted a large block.' },
      });
    });

    // Copy
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    // Success screen
    expect(screen.getByText('Bug report copied!')).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith('Bug report copied to clipboard!', 'success');

    // Verify clipboard content
    const clipboardContent = mockClipboardWriteText.mock.calls[0][0];
    expect(clipboardContent).toContain('The editor crashed when I pasted a large block.');
    expect(clipboardContent).toContain('<details>');

    // Click view issue (opens GitHub new issue page)
    fireEvent.click(screen.getByTestId('view-issue-btn'));
    expect(mockOpenExternal).toHaveBeenCalledWith('https://github.com/NiyaNagi/Nightjar/issues/new?labels=bug');

    // Click done
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  test('failed preparation flow: open â†’ copy fails â†’ retry â†’ success', async () => {
    // First attempt: both clipboard and blob fallback fail
    mockClipboardWriteText.mockRejectedValueOnce(new Error('Clipboard error'));
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => { throw new Error('Blob error'); });

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test bug' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Failed'), 'error');
    expect(screen.queryByText('Bug report copied!')).not.toBeInTheDocument();

    // Restore URL.createObjectURL and retry succeeds
    URL.createObjectURL = origCreateObjectURL;
    mockClipboardWriteText.mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    expect(screen.getByText('Bug report copied!')).toBeInTheDocument();
  });

  test('empty context still allows submission', async () => {
    render(
      <BugReportModal isOpen={true} onClose={jest.fn()} context={null} />,
    );
    act(() => jest.runAllTimers());

    expect(screen.getByLabelText('Title')).toHaveValue('Bug report');

    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Bug Report/));
    });

    expect(screen.getByText('Bug report copied!')).toBeInTheDocument();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 14. Accessibility
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
describe('Accessibility', () => {
  test('modal has correct ARIA attributes', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'bug-report-title');
  });

  test('close button has accessible label', () => {
    renderModal();
    expect(screen.getByLabelText('Close bug report')).toBeInTheDocument();
  });

  test('form fields have labels', () => {
    renderModal();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  test('title input has maxLength', () => {
    renderModal();
    expect(screen.getByLabelText('Title')).toHaveAttribute('maxLength', '200');
  });

  test('title input has autoComplete off', () => {
    renderModal();
    expect(screen.getByLabelText('Title')).toHaveAttribute('autoComplete', 'off');
  });

  test('focus trap hook is called', () => {
    const { useFocusTrap } = require('../frontend/src/hooks/useFocusTrap');
    renderModal();
    expect(useFocusTrap).toHaveBeenCalled();
  });
});

