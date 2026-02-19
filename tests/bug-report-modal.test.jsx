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
  createGitHubIssue,
} from '../frontend/src/components/BugReportModal';

// ─── Mocks ───────────────────────────────────────────────────────────────────

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
}));

// Mock html2canvas (lazy-imported via dynamic import())
// Return a function directly (matching real CJS export) so Babel's
// _interopRequireWildcard wraps it as { default: fn } for the component.
const mockToDataURL = jest.fn().mockReturnValue('data:image/png;base64,mockScreenshot');
const mockHtml2canvas = jest.fn().mockResolvedValue({
  toDataURL: (...args) => mockToDataURL(...args),
});
jest.mock('html2canvas', () => mockHtml2canvas);

// Mock fetch for GitHub API
const mockFetch = jest.fn();
global.fetch = mockFetch;

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function setupSuccessfulFetch(issueNumber = 42) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      html_url: `https://github.com/niyanagi/nightjar/issues/${issueNumber}`,
      number: issueNumber,
    }),
  });
}

function setupFailedFetch(statusCode = 422, message = 'Validation Failed') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: statusCode,
    json: async () => ({ message }),
  });
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockGetLogs.mockReturnValue([
    { level: 'behavior', timestamp: '2025-01-01T12:00:00Z', category: 'editor', event: 'opened file' },
    { level: 'behavior', timestamp: '2025-01-01T12:01:00Z', category: 'editor', event: 'saved file' },
  ]);
});

afterEach(() => {
  jest.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. buildActionSummary
// ═════════════════════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════════════════════
// 2. generateDefaultTitle
// ═════════════════════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════════════════════
// 3. buildIssueBody
// ═════════════════════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════════════════════
// 4. createGitHubIssue
// ═════════════════════════════════════════════════════════════════════════════
describe('createGitHubIssue', () => {
  test('sends POST to GitHub API with correct headers and body', async () => {
    setupSuccessfulFetch(99);
    const result = await createGitHubIssue('Test Title', 'Test body');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/niyanagi/nightjar/issues',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': expect.stringContaining('Bearer'),
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.title).toBe('Test Title');
    expect(body.body).toBe('Test body');
    expect(body.labels).toEqual(['bug']);

    expect(result.html_url).toBe('https://github.com/niyanagi/nightjar/issues/99');
    expect(result.number).toBe(99);
  });

  test('throws on API error with message from response', async () => {
    setupFailedFetch(422, 'Validation Failed');
    await expect(createGitHubIssue('Title', 'Body')).rejects.toThrow('Validation Failed');
  });

  test('throws with status code when no message in error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('parse error'); },
    });
    await expect(createGitHubIssue('Title', 'Body')).rejects.toThrow('GitHub API error: 500');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Component Rendering
// ═════════════════════════════════════════════════════════════════════════════
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
    expect(screen.getByText('🐛 Report a Bug')).toBeInTheDocument();
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

  test('shows info about automatic submission', () => {
    renderModal();
    expect(screen.getByText(/submitted automatically/)).toBeInTheDocument();
  });

  test('renders Cancel and Submit buttons', () => {
    renderModal();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('🐛 Submit Bug Report')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Interactions
// ═════════════════════════════════════════════════════════════════════════════
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
    // Keep fetch pending forever to keep isSubmitting = true
    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    const { props } = renderModal();

    // Type a title
    const input = screen.getByLabelText('Title');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Test' } });
    });

    // Click submit
    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    // Now Escape should NOT close
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Validation
// ═════════════════════════════════════════════════════════════════════════════
describe('Validation', () => {
  test('shows error toast when title is empty', async () => {
    renderModal({ context: {} });
    // Clear the auto-populated title
    const input = screen.getByLabelText('Title');
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    expect(mockShowToast).toHaveBeenCalledWith('Please enter a bug title', 'error');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('shows error toast when title is only whitespace', async () => {
    renderModal();
    const input = screen.getByLabelText('Title');
    await act(async () => {
      fireEvent.change(input, { target: { value: '   ' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    expect(mockShowToast).toHaveBeenCalledWith('Please enter a bug title', 'error');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Submission Flow
// ═════════════════════════════════════════════════════════════════════════════
describe('Submission', () => {
  test('submits bug report via GitHub API and shows success', async () => {
    setupSuccessfulFetch(42);
    renderModal();
    const input = screen.getByLabelText('Title');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Test bug' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    // Verify fetch was called
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/niyanagi/nightjar/issues');
    const body = JSON.parse(opts.body);
    expect(body.title).toBe('Test bug');
    expect(body.labels).toEqual(['bug']);

    // Success screen
    expect(screen.getByText('Bug report created!')).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith(
      'Bug report #42 created successfully!',
      'success',
    );
  });

  test('includes diagnostics inline in issue body', async () => {
    setupSuccessfulFetch(10);
    mockFormatDiagnosticReport.mockReturnValue('DIAGNOSTIC_CONTENT');

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.body).toContain('DIAGNOSTIC_CONTENT');
    expect(body.body).toContain('<details>');
    expect(body.body).toContain('Diagnostic Report');
  });

  test('shows submitting state during fetch', async () => {
    let resolvePromise;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { resolvePromise = resolve; }));

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    expect(screen.getByText('Submitting…')).toBeInTheDocument();

    // Resolve the fetch
    await act(async () => {
      resolvePromise({
        ok: true,
        json: async () => ({ html_url: 'https://example.com/1', number: 1 }),
      });
    });
  });

  test('shows error toast when API call fails', async () => {
    setupFailedFetch(500, 'Server error');
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('Failed to submit bug report'),
      'error',
    );
    // Should still show the form (not success screen)
    expect(screen.queryByText('Bug report created!')).not.toBeInTheDocument();
  });

  test('handles diagnostic generation failure gracefully', async () => {
    mockGenerateDiagnosticReport.mockRejectedValueOnce(new Error('diag failed'));
    setupSuccessfulFetch(50);

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    // Should still succeed (diagnostics are optional)
    expect(screen.getByText('Bug report created!')).toBeInTheDocument();
    // Body should not have diagnostics
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.body).not.toContain('<details>');
  });

  test('disables inputs during submission', async () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Success Screen
// ═════════════════════════════════════════════════════════════════════════════
describe('Success Screen', () => {
  async function submitAndSucceed(issueNumber = 42) {
    setupSuccessfulFetch(issueNumber);
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });
  }

  test('shows success heading and message', async () => {
    await submitAndSucceed();
    expect(screen.getByText('Bug report created!')).toBeInTheDocument();
    expect(screen.getByText(/GitHub issue has been created automatically/)).toBeInTheDocument();
  });

  test('shows diagnostic status as included', async () => {
    await submitAndSucceed();
    expect(screen.getByText(/Diagnostic logs included in issue/)).toBeInTheDocument();
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

  test('renders View Issue on GitHub button', async () => {
    await submitAndSucceed();
    const btn = screen.getByTestId('view-issue-btn');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('View Issue on GitHub');
  });

  test('View Issue button calls electronAPI.openExternal', async () => {
    await submitAndSucceed(42);
    fireEvent.click(screen.getByTestId('view-issue-btn'));
    expect(mockOpenExternal).toHaveBeenCalledWith(
      'https://github.com/niyanagi/nightjar/issues/42',
    );
  });

  test('View Issue falls back to window.open when no electronAPI', async () => {
    const originalAPI = window.electronAPI;
    window.electronAPI = undefined;
    const mockWindowOpen = jest.spyOn(window, 'open').mockImplementation(() => {});

    setupSuccessfulFetch(55);
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    fireEvent.click(screen.getByTestId('view-issue-btn'));
    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://github.com/niyanagi/nightjar/issues/55',
      '_blank',
      'noopener',
    );

    mockWindowOpen.mockRestore();
    window.electronAPI = originalAPI;
  });

  test('Done button calls onClose', async () => {
    const onClose = jest.fn();
    setupSuccessfulFetch(1);
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
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. State Reset
// ═════════════════════════════════════════════════════════════════════════════
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
    expect(screen.getByLabelText('Description')).toHaveValue('');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. Error Handling
// ═════════════════════════════════════════════════════════════════════════════
describe('Error Handling', () => {
  test('handles fetch network error gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('Network error'),
      'error',
    );
  });

  test('re-enables form after failed submission', async () => {
    setupFailedFetch(500, 'Error');
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    // Form should be editable again
    expect(screen.getByLabelText('Title')).not.toBeDisabled();
    expect(screen.getByText('🐛 Submit Bug Report')).not.toBeDisabled();
  });

  test('handles screenshot capture failure gracefully', async () => {
    // Make html2canvas throw
    mockHtml2canvas.mockRejectedValueOnce(new Error('Canvas error'));

    setupSuccessfulFetch(60);
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Title' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    // Should still succeed (screenshot is optional)
    expect(screen.getByText('Bug report created!')).toBeInTheDocument();
    expect(screen.getByText(/capture failed/)).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. TabBar Integration
// ═════════════════════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════════════════════
// 13. E2E Scenarios
// ═════════════════════════════════════════════════════════════════════════════
describe('E2E Scenarios', () => {
  test('full happy path: open → auto-populate → edit → submit → success → view → done', async () => {
    setupSuccessfulFetch(100);
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

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    // Success screen
    expect(screen.getByText('Bug report created!')).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith('Bug report #100 created successfully!', 'success');

    // Verify issue body
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.body).toContain('The editor crashed when I pasted a large block.');
    expect(body.body).toContain('<details>');

    // Click view issue
    fireEvent.click(screen.getByTestId('view-issue-btn'));
    expect(mockOpenExternal).toHaveBeenCalledWith('https://github.com/niyanagi/nightjar/issues/100');

    // Click done
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  test('failed submission flow: open → submit → error → retry → success', async () => {
    // First attempt fails
    setupFailedFetch(500, 'Server error');

    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test bug' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Failed'), 'error');
    expect(screen.queryByText('Bug report created!')).not.toBeInTheDocument();

    // Retry succeeds
    setupSuccessfulFetch(77);
    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    expect(screen.getByText('Bug report created!')).toBeInTheDocument();
  });

  test('empty context still allows submission', async () => {
    setupSuccessfulFetch(5);
    render(
      <BugReportModal isOpen={true} onClose={jest.fn()} context={null} />,
    );
    act(() => jest.runAllTimers());

    expect(screen.getByLabelText('Title')).toHaveValue('Bug report');

    await act(async () => {
      fireEvent.click(screen.getByText('🐛 Submit Bug Report'));
    });

    expect(screen.getByText('Bug report created!')).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. Accessibility
// ═════════════════════════════════════════════════════════════════════════════
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
