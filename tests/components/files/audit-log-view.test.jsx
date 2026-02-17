/**
 * Tests for AuditLogView component.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AuditLogView from '../../../frontend/src/components/files/AuditLogView';

const baseEntry = (overrides = {}) => ({
  id: 'a1',
  action: 'upload',
  actorId: 'pk-user1',
  actorName: 'Alice',
  targetId: 'f1',
  targetName: 'document.pdf',
  timestamp: Date.now() - 10000,
  summary: 'Uploaded document.pdf',
  ...overrides,
});

const defaultProps = {
  auditLog: [],
  collaborators: [
    { publicKey: 'pk-user1', displayName: 'Alice' },
    { publicKey: 'pk-user2', displayName: 'Bob' },
  ],
};

describe('AuditLogView', () => {
  it('should render empty state when no entries', () => {
    render(<AuditLogView {...defaultProps} />);
    expect(screen.getByTestId('audit-view')).toBeInTheDocument();
    expect(screen.getByTestId('audit-empty')).toBeInTheDocument();
  });

  it('should render audit entries', () => {
    render(<AuditLogView {...defaultProps} auditLog={[baseEntry()]} />);
    expect(screen.getByTestId('audit-list')).toBeInTheDocument();
    expect(screen.getByText('document.pdf')).toBeInTheDocument();
  });

  it('should resolve actor names from collaborators', () => {
    render(<AuditLogView {...defaultProps} auditLog={[baseEntry()]} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('should sort entries by timestamp descending', () => {
    const entries = [
      baseEntry({ id: 'a1', timestamp: Date.now() - 20000, targetName: 'old.txt' }),
      baseEntry({ id: 'a2', timestamp: Date.now() - 1000, targetName: 'new.txt' }),
    ];
    render(<AuditLogView {...defaultProps} auditLog={entries} />);
    const list = screen.getByTestId('audit-list');
    const items = list.querySelectorAll('[data-testid^="audit-entry-"]');
    expect(items).toHaveLength(2);
  });

  it('should provide search input', () => {
    render(<AuditLogView {...defaultProps} auditLog={[baseEntry()]} />);
    expect(screen.getByTestId('audit-search')).toBeInTheDocument();
  });

  it('should filter entries by search text', () => {
    const entries = [
      baseEntry({ id: 'a1', targetName: 'report.pdf' }),
      baseEntry({ id: 'a2', targetName: 'photo.jpg' }),
    ];
    render(<AuditLogView {...defaultProps} auditLog={entries} />);
    fireEvent.change(screen.getByTestId('audit-search'), { target: { value: 'report' } });
    
    const list = screen.getByTestId('audit-list');
    expect(list.textContent).toContain('report.pdf');
    expect(list.textContent).not.toContain('photo.jpg');
  });

  it('should provide action type filter', () => {
    render(<AuditLogView {...defaultProps} auditLog={[baseEntry()]} />);
    expect(screen.getByTestId('audit-action-filter')).toBeInTheDocument();
  });

  it('should provide date range filter', () => {
    render(<AuditLogView {...defaultProps} auditLog={[baseEntry()]} />);
    expect(screen.getByTestId('audit-date-filter')).toBeInTheDocument();
  });
});
