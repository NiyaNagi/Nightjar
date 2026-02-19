/**
 * BugReportModal Component
 *
 * A modal dialog for reporting bugs directly from the app.
 * Features:
 * - Auto-populated title based on active document/workspace context
 * - Title and markdown description fields
 * - Pre-filled template with repro steps (Given/When/Then)
 * - Last 20 UI actions from logger (capped at 2,000 chars)
 * - Inline diagnostic data embedded in issue body
 * - Screenshot capture with download button on success screen
 * - Creates GitHub issue automatically via API (no manual steps)
 * - Post-submit success state with link to created issue
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { generateDiagnosticReport, formatDiagnosticReport } from '../utils/diagnostics';
import { getLogs } from '../utils/logger';
import { useToast } from '../contexts/ToastContext';
import './BugReportModal.css';

// Load PAT from environment variable. In development, create a .env file at the
// project root with VITE_GITHUB_PAT=your_token. In production builds, inject via
// CI or move to an external proxy service (e.g. Cloudflare Worker) to avoid
// shipping credentials in the client bundle.
const GITHUB_PAT = (typeof process !== 'undefined' && process.env?.VITE_GITHUB_PAT) || '';
const GITHUB_API_URL = 'https://api.github.com/repos/niyanagi/nightjar/issues';
const MAX_ACTION_CHARS = 2000;
const MAX_RECENT_ACTIONS = 20;

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
 * Create a GitHub issue via the REST API.
 * @param {string} title - Issue title
 * @param {string} body - Issue body (markdown)
 * @returns {Promise<{ html_url: string, number: number }>}
 */
export async function createGitHubIssue(title, body) {
  const response = await fetch(GITHUB_API_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${GITHUB_PAT}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      title,
      body,
      labels: ['bug'],
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `GitHub API error: ${response.status}`);
  }

  const data = await response.json();
  return { html_url: data.html_url, number: data.number };
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

export default function BugReportModal({ isOpen, onClose, context }) {
  const modalRef = useRef(null);
  const titleRef = useRef(null);
  const { showToast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [issueUrl, setIssueUrl] = useState('');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState(null);
  const [screenshotStatus, setScreenshotStatus] = useState('idle');
  const [diagnosticStatus, setDiagnosticStatus] = useState('idle');

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

  // Reset form state when modal opens, auto-populate title from context
  useEffect(() => {
    if (isOpen) {
      setTitle(generateDefaultTitle(context));
      setDescription('');
      setSubmitted(false);
      setIssueUrl('');
      setIsSubmitting(false);
      setScreenshotDataUrl(null);
      setScreenshotStatus('idle');
      setDiagnosticStatus('idle');
    }
  }, [isOpen, context]);

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

      // Create the GitHub issue via API
      const result = await createGitHubIssue(title.trim(), body);
      setIssueUrl(result.html_url);

      setSubmitted(true);
      showToast(`Bug report #${result.number} created successfully!`, 'success');
    } catch (err) {
      console.error('Bug report submission failed:', err);
      showToast('Failed to submit bug report: ' + err.message, 'error');
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

            <div className="bug-report-field">
              <label htmlFor="bug-description">Description</label>
              <textarea
                id="bug-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the bug in detail..."
                className="bug-report-textarea"
                rows={6}
                disabled={isSubmitting}
              />
            </div>

            <div className="bug-report-field">
              <label>Recent Actions (auto-captured)</label>
              <pre className="bug-report-actions">{recentActions}</pre>
            </div>

            <div className="bug-report-field bug-report-info">
              <p>
                � Your bug report will be submitted automatically with
                diagnostic data. A screenshot will be captured for you to
                download and attach to the issue.
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
            <h3>Bug report created!</h3>
            <p>
              A GitHub issue has been created automatically with your
              diagnostic data included. You can optionally download and
              attach a screenshot to the issue.
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
                  View Issue on GitHub ↗
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
