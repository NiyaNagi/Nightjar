/**
 * BugReportModal Component
 *
 * A modal dialog for reporting bugs directly from the app.
 * Features:
 * - Auto-populated title based on active document/workspace context
 * - Title and markdown description fields
 * - Pre-filled template with repro steps (Given/When/Then)
 * - Last 50 UI actions from logger (capped at 3,000 chars)
 * - Inline diagnostic data embedded in issue body
 * - Screenshot capture with download button on success screen
 * - Creates GitHub issue automatically via API (no manual steps)
 * - Post-submit success state with link to created issue
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { generateDiagnosticReport, formatDiagnosticReport } from '../utils/diagnostics';
import { getLogs, logBehavior } from '../utils/logger';
import { useToast } from '../contexts/ToastContext';
import { getBasePath } from '../utils/websocket';
import './BugReportModal.css';

const GITHUB_ISSUES_PAGE = 'https://github.com/NiyaNagi/Nightjar/issues/new?labels=bug';

/**
 * Lightweight markdown-to-HTML renderer for preview.
 * Supports: ## headings, **bold**, *italic*, `code`, \n paragraphs, - lists.
 * No external dependencies — just enough for GitHub-flavored bug reports.
 */
function simpleMarkdown(text) {
  if (!text) return '';
  return text
    .split('\n')
    .map(line => {
      // Headings
      if (line.startsWith('### ')) return `<h4>${esc(line.slice(4))}</h4>`;
      if (line.startsWith('## '))  return `<h3>${esc(line.slice(3))}</h3>`;
      if (line.startsWith('# '))   return `<h2>${esc(line.slice(2))}</h2>`;
      // List items
      if (/^[-*] /.test(line)) return `<li>${inline(line.slice(2))}</li>`;
      // Blank line
      if (line.trim() === '') return '<br/>';
      // Normal paragraph
      return `<p>${inline(line)}</p>`;
    })
    .join('');

  function esc(s) { return inline(s); }
  function inline(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  }
}

/**
 * Tabbed markdown editor with Write and Preview modes.
 * Write mode: plain textarea. Preview mode: rendered HTML.
 */
function MarkdownEditor({ value, onChange, disabled }) {
  const [mode, setMode] = useState('write');
  const textareaRef = useRef(null);

  // Auto-focus textarea when switching to write mode
  useEffect(() => {
    if (mode === 'write' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  return (
    <div className="bug-report-field">
      <div className="bug-report-md-header">
        <label htmlFor="bug-description">Description</label>
        <div className="bug-report-md-tabs">
          <button
            type="button"
            className={`bug-report-md-tab ${mode === 'write' ? 'active' : ''}`}
            onClick={() => setMode('write')}
            disabled={disabled}
          >
            Write
          </button>
          <button
            type="button"
            className={`bug-report-md-tab ${mode === 'preview' ? 'active' : ''}`}
            onClick={() => setMode('preview')}
            disabled={disabled}
          >
            Preview
          </button>
        </div>
      </div>
      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          id="bug-description"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe the bug in detail..."
          className="bug-report-textarea"
          rows={8}
          disabled={disabled}
        />
      ) : (
        <div
          className="bug-report-md-preview"
          dangerouslySetInnerHTML={{ __html: simpleMarkdown(value) }}
        />
      )}
    </div>
  );
}
const MAX_ACTION_CHARS = 3000;
const MAX_RECENT_ACTIONS = 50;

/** Pretty-print document type for display in auto-generated titles. */
const DOC_TYPE_LABELS = {
  text: 'Text Editor',
  sheet: 'Spreadsheet',
  kanban: 'Kanban Board',
  inventory: 'Inventory',
  files: 'File Storage',
};

/**
 * Build a concise action summary from the last N behavior-level log entries.
 * Trims oldest entries first until total length ≤ MAX_ACTION_CHARS.
 */
export function buildActionSummary(logs, maxActions = MAX_RECENT_ACTIONS, maxChars = MAX_ACTION_CHARS) {
  const behaviorLogs = logs
    .filter(entry => entry.level === 'behavior')
    .slice(-maxActions);

  const lines = behaviorLogs.map(entry => {
    const time = entry.timestamp ? entry.timestamp.slice(11, 19) : '??:??:??';
    const cat = entry.category || 'unknown';
    const evt = entry.event || '';
    return `- [${time}] ${cat}: ${evt}`;
  });

  // Trim oldest lines first until within budget
  while (lines.length > 0 && lines.join('\n').length > maxChars) {
    lines.shift();
  }

  return lines.length > 0 ? lines.join('\n') : '(no recent actions recorded)';
}

/**
 * Generate a context-aware default title from the active document/workspace.
 * @param {Object} context - { documentName, documentType, workspaceName }
 * @returns {string} e.g. "Bug in Text Editor: My Document" or "Bug report"
 */
export function generateDefaultTitle(context) {
  if (!context) return 'Bug report';

  const { documentName, documentType, workspaceName } = context;
  const typeLabel = DOC_TYPE_LABELS[documentType] || null;

  if (typeLabel && documentName) {
    return `Bug in ${typeLabel}: ${documentName}`;
  }
  if (typeLabel) {
    return `Bug in ${typeLabel}`;
  }
  if (workspaceName) {
    return `Bug in workspace: ${workspaceName}`;
  }
  return 'Bug report';
}

/**
 * Build the markdown body template for the GitHub issue.
 * Includes inline diagnostic data in a collapsible <details> block.
 * @param {string} description - User-entered description
 * @param {string} recentActions - Auto-captured action log
 * @param {string} [diagnosticText] - Formatted diagnostic report text
 */
export function buildIssueBody(description, recentActions, diagnosticText) {
  const sections = [
    '## Description',
    '',
    description || '(describe the bug here)',
    '',
    '## Steps to Reproduce',
    '',
    '**Given** I am using Nightjar',
    '**When** (describe what you did)',
    '**Then** (describe what happened vs. what you expected)',
    '',
    '## Recent Actions',
    '',
    '```',
    recentActions,
    '```',
    '',
    '## Expected Behavior',
    '',
    '(what should have happened)',
    '',
    '## Environment',
    '',
    '- Nightjar version: ' + (typeof window !== 'undefined' && window.electronAPI?.appVersion || 'unknown'),
    '- OS: ' + (typeof navigator !== 'undefined' ? navigator.platform || 'unknown' : 'unknown'),
    '- Screen: ' + (typeof window !== 'undefined' ? window.innerWidth + 'x' + window.innerHeight : 'unknown'),
  ];

  if (diagnosticText) {
    sections.push(
      '',
      '<details>',
      '<summary>📋 Diagnostic Report (auto-generated)</summary>',
      '',
      '```',
      diagnosticText,
      '```',
      '',
      '</details>',
    );
  }

  // TODO: Upload screenshot to image host and embed link in issue body
  sections.push(
    '',
    '> 📷 Screenshot may be attached as a comment by the reporter.',
  );

  return sections.join('\n');
}



/**
 * Download a data URL (e.g. PNG screenshot) as a file.
 */
function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Create a GitHub issue via the server-side proxy endpoint.
 * Falls back to direct GitHub API if a PAT is available client-side.
 * Returns the HTML URL of the created issue on success.
 */
export async function createGitHubIssue(title, body) {
  // Strategy 1: Use server-side proxy (works in both web and Electron)
  try {
    const serverUrl = typeof window !== 'undefined'
      ? window.location.origin + getBasePath()
      : '';
    const proxyResponse = await fetch(`${serverUrl}/api/bug-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });

    if (proxyResponse.ok) {
      const data = await proxyResponse.json();
      if (data.url) return data.url;
    }

    // If server says 503 (not configured) or 429 (rate limited), fall through
    if (proxyResponse.status !== 503 && proxyResponse.status !== 429) {
      const errData = await proxyResponse.json().catch(() => ({}));
      console.warn('[BugReport] Server proxy error:', proxyResponse.status, errData.error);
    }
  } catch (proxyErr) {
    // Network error (e.g. Electron offline, server unreachable) — fall through
    console.warn('[BugReport] Server proxy unavailable:', proxyErr.message);
  }

  // Strategy 2: Direct GitHub API with client-side PAT (CI-injected builds)
  const pat = typeof process !== 'undefined' && process.env?.VITE_GITHUB_PAT;
  if (pat) {
    const response = await fetch('https://api.github.com/repos/NiyaNagi/Nightjar/issues', {
      method: 'POST',
      headers: {
        'Authorization': `token ${pat}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({ title, body, labels: ['bug'] }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`GitHub API error ${response.status}: ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    return data.html_url;
  }

  throw new Error('Bug report submission unavailable — no server proxy or PAT configured');
}

export default function BugReportModal({ isOpen, onClose, context }) {
  const modalRef = useRef(null);
  const titleRef = useRef(null);
  const prevIsOpenRef = useRef(false);
  const { showToast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [issueUrl, setIssueUrl] = useState('');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState(null);
  const [screenshotStatus, setScreenshotStatus] = useState('idle');
  const [diagnosticStatus, setDiagnosticStatus] = useState('idle');
  const [submittedViaApi, setSubmittedViaApi] = useState(false);

  useFocusTrap(modalRef, isOpen);

  const recentActions = useMemo(() => {
    if (!isOpen) return '';
    return buildActionSummary(getLogs());
  }, [isOpen]);

  // Auto-focus title field when modal opens
  useEffect(() => {
    if (isOpen && titleRef.current) {
      const timer = setTimeout(() => titleRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  // Reset form state only when modal first opens (rising edge)
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (isOpen && !wasOpen) {
      setTitle(generateDefaultTitle(context));
      setDescription(
        '## Description\n\nDescribe the issue you encountered.\n\n' +
        '## Steps to Reproduce\n\n**When** (describe what you did)\n**Then** (describe what happened)\n\n' +
        '## Expected Behavior\n\n**I Expected** (describe what should have happened)'
      );
      setSubmitted(false);
      setIssueUrl('');
      setIsSubmitting(false);
      setScreenshotDataUrl(null);
      setScreenshotStatus('idle');
      setDiagnosticStatus('idle');
      setSubmittedViaApi(false);
    }
  }, [isOpen, context]);

  // Note: We intentionally do NOT re-generate the title when context changes
  // while the modal is open. The context prop is an inline object that gets a
  // new reference on every parent render, which would constantly overwrite
  // whatever the user has typed. The title is set once on the rising edge above.

  const captureScreenshot = useCallback(async () => {
    setScreenshotStatus('capturing');
    try {
      const html2canvasModule = await import('html2canvas');
      const html2canvas = html2canvasModule.default;
      const overlay = modalRef.current?.closest('.bug-report-overlay');
      if (overlay) overlay.style.visibility = 'hidden';

      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        scale: 1,
        ignoreElements: (el) => el.classList?.contains('bug-report-overlay'),
      });

      if (overlay) overlay.style.visibility = 'visible';

      const dataUrl = canvas.toDataURL('image/png');
      setScreenshotDataUrl(dataUrl);
      setScreenshotStatus('done');
      return true;
    } catch (err) {
      console.error('Screenshot capture failed:', err);
      setScreenshotStatus('error');
      const overlay = modalRef.current?.closest('.bug-report-overlay');
      if (overlay) overlay.style.visibility = 'visible';
      return false;
    }
  }, []);

  const handleDownloadScreenshot = useCallback(() => {
    if (!screenshotDataUrl) return;
    const filename = `nightjar-screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    downloadDataUrl(screenshotDataUrl, filename);
    showToast('Screenshot downloaded', 'success');
  }, [screenshotDataUrl, showToast]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) {
      showToast('Please enter a bug title', 'error');
      titleRef.current?.focus();
      return;
    }
    logBehavior('app', 'submit_bug_report');

    setIsSubmitting(true);

    try {
      // Generate diagnostics (inline in issue body)
      let diagnosticText = null;
      setDiagnosticStatus('capturing');
      try {
        const report = await generateDiagnosticReport();
        diagnosticText = formatDiagnosticReport(report);
        setDiagnosticStatus('done');
      } catch (err) {
        console.error('Diagnostic report generation failed:', err);
        setDiagnosticStatus('error');
      }

      // Capture screenshot (stored in state for user to download)
      await captureScreenshot();

      // Build issue body with inline diagnostics
      const body = buildIssueBody(description, recentActions, diagnosticText);

      // Try GitHub API first, fall back to clipboard copy
      let apiSuccess = false;
      try {
        const url = await createGitHubIssue(title.trim(), body);
        setIssueUrl(url);
        setSubmittedViaApi(true);
        apiSuccess = true;
        showToast('Bug report submitted to GitHub!', 'success');
      } catch (apiErr) {
        console.warn('GitHub API submission failed, falling back to clipboard:', apiErr.message);
        setSubmittedViaApi(false);

        const fullReport = `# ${title.trim()}\n\n${body}`;
        try {
          await navigator.clipboard.writeText(fullReport);
          showToast('Bug report copied to clipboard!', 'success');
        } catch {
          // Fallback: save as local text file
          const blob = new Blob([fullReport], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          downloadDataUrl(url, `nightjar-bug-report-${Date.now()}.md`);
          URL.revokeObjectURL(url);
          showToast('Bug report saved as file', 'success');
        }
        setIssueUrl(GITHUB_ISSUES_PAGE);
      }

      setSubmitted(true);
    } catch (err) {
      console.error('Bug report preparation failed:', err);
      showToast('Failed to prepare bug report: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [title, description, recentActions, captureScreenshot, showToast]);

  const handleViewIssue = useCallback(() => {
    if (!issueUrl) return;
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(issueUrl);
    } else {
      window.open(issueUrl, '_blank', 'noopener');
    }
  }, [issueUrl]);

  if (!isOpen) return null;

  return (
    <div className="bug-report-overlay" onClick={(e) => {
      if (e.target === e.currentTarget && !isSubmitting) onClose();
    }}>
      <div
        className="bug-report-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
      >
        <div className="bug-report-modal__header">
          <h2 id="bug-report-title">🐛 Report a Bug</h2>
          <button
            type="button"
            className="bug-report-modal__close"
            onClick={onClose}
            aria-label="Close bug report"
            disabled={isSubmitting}
          >
            ✕
          </button>
        </div>

        {!submitted ? (
          <div className="bug-report-modal__body">
            <div className="bug-report-field">
              <label htmlFor="bug-title">Title</label>
              <input
                id="bug-title"
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief summary of the bug..."
                className="bug-report-input"
                disabled={isSubmitting}
                maxLength={200}
                autoComplete="off"
              />
            </div>

            <MarkdownEditor
              value={description}
              onChange={setDescription}
              disabled={isSubmitting}
            />

            <div className="bug-report-field">
              <label>Recent Actions (auto-captured)</label>
              <pre className="bug-report-actions">{recentActions}</pre>
            </div>

            <div className="bug-report-field bug-report-info">
              <p>
                � Your bug report will be submitted directly to GitHub with
                diagnostic data included. If API submission is unavailable,
                it will be copied to your clipboard instead. A screenshot
                will also be captured for you to download.
              </p>
            </div>

            <div className="bug-report-modal__footer">
              <button
                type="button"
                className="bug-report-btn bug-report-btn--secondary"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="bug-report-btn bug-report-btn--primary"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting…' : '🐛 Submit Bug Report'}
              </button>
            </div>
          </div>
        ) : (
          <div className="bug-report-modal__body bug-report-success">
            <div className="bug-report-success__icon">✅</div>
            <h3>{submittedViaApi ? 'Bug report submitted!' : 'Bug report copied!'}</h3>
            <p>
              {submittedViaApi
                ? 'Your bug report has been submitted directly to GitHub with diagnostic data included. Click below to view the created issue.'
                : 'Your bug report has been copied to the clipboard with diagnostic data included. Click the link below to open GitHub and paste it into a new issue.'
              }
              {' '}You can also download a screenshot to attach.
            </p>

            <div className="bug-report-success__status">
              <div className="bug-report-status-item">
                <span>{diagnosticStatus === 'done' ? '✅' : diagnosticStatus === 'error' ? '❌' : '⏳'}</span>
                <span>Diagnostic logs {diagnosticStatus === 'done' ? 'included in issue' : diagnosticStatus === 'error' ? 'failed' : 'pending'}</span>
              </div>
              <div className="bug-report-status-item">
                <span>{screenshotStatus === 'done' ? '📷' : screenshotStatus === 'error' ? '❌' : '⏳'}</span>
                <span>Screenshot {screenshotStatus === 'done' ? 'ready to download' : screenshotStatus === 'error' ? 'capture failed' : 'pending'}</span>
              </div>
            </div>

            <div className="bug-report-success__actions">
              {screenshotDataUrl && (
                <button
                  type="button"
                  className="bug-report-btn bug-report-btn--secondary"
                  onClick={handleDownloadScreenshot}
                  data-testid="download-screenshot-btn"
                >
                  📷 Download Screenshot
                </button>
              )}

              {issueUrl && (
                <button
                  type="button"
                  className="bug-report-btn bug-report-btn--link"
                  onClick={handleViewIssue}
                  data-testid="view-issue-btn"
                >
                  {submittedViaApi ? 'View Issue on GitHub ↗' : 'Open GitHub Issues ↗'}
                </button>
              )}
            </div>

            <div className="bug-report-modal__footer">
              <button
                type="button"
                className="bug-report-btn bug-report-btn--primary"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
