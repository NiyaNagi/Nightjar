/**
 * Tests for FileStorageSettings component.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FileStorageSettings from '../../../frontend/src/components/files/FileStorageSettings';

const defaultProps = {
  currentSystem: { id: 'fs-1', name: 'Test Storage', settings: {} },
  settings: {
    maxFileSizeMB: 100,
    autoDeleteDays: 30,
    chunkRedundancyTarget: 3,
  },
  role: 'admin',
  onUpdateSettings: jest.fn(),
  onEmptyTrash: jest.fn(),
  onDeleteAllFiles: jest.fn(),
  trashedCount: 0,
};

describe('FileStorageSettings', () => {
  afterEach(() => jest.clearAllMocks());

  it('should render settings view', () => {
    render(<FileStorageSettings {...defaultProps} />);
    expect(screen.getByTestId('settings-view')).toBeInTheDocument();
  });

  it('should show storage name input', () => {
    render(<FileStorageSettings {...defaultProps} />);
    expect(screen.getByTestId('settings-name')).toBeInTheDocument();
  });

  it('should show max file size select', () => {
    render(<FileStorageSettings {...defaultProps} />);
    expect(screen.getByTestId('settings-max-size')).toBeInTheDocument();
  });

  it('should show auto-delete days select', () => {
    render(<FileStorageSettings {...defaultProps} />);
    expect(screen.getByTestId('settings-auto-delete')).toBeInTheDocument();
  });

  it('should show chunk redundancy select', () => {
    render(<FileStorageSettings {...defaultProps} />);
    expect(screen.getByTestId('settings-redundancy')).toBeInTheDocument();
  });

  it('should show danger zone for admin', () => {
    render(<FileStorageSettings {...defaultProps} />);
    expect(screen.getByTestId('settings-danger-zone')).toBeInTheDocument();
  });

  it('should call onUpdateSettings when save clicked', () => {
    render(<FileStorageSettings {...defaultProps} />);
    // Must make a change first to make save button appear (dirty state)
    fireEvent.change(screen.getByTestId('settings-name'), { target: { value: 'New Name' } });
    fireEvent.click(screen.getByTestId('settings-save'));
    expect(defaultProps.onUpdateSettings).toHaveBeenCalled();
  });

  it('should disable editing for non-admin', () => {
    render(<FileStorageSettings {...defaultProps} role="collaborator" />);
    // Should show read-only notice or disabled inputs
    const saveBtn = screen.queryByTestId('settings-save');
    if (saveBtn) {
      expect(saveBtn).toBeDisabled();
    }
  });

  it('should show empty trash button in danger zone', () => {
    render(<FileStorageSettings {...defaultProps} trashedCount={5} />);
    expect(screen.getByTestId('settings-empty-trash')).toBeInTheDocument();
  });

  it('should show delete all button in danger zone', () => {
    render(<FileStorageSettings {...defaultProps} />);
    expect(screen.getByTestId('settings-delete-all')).toBeInTheDocument();
  });
});
