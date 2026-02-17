/**
 * ViewModeToggle
 * 
 * Toggle between Grid / Table / Compact view modes.
 * 
 * See docs/FILE_STORAGE_SPEC.md §6.6
 */

import './ViewModeToggle.css';

export const VIEW_MODES = {
  GRID: 'grid',
  TABLE: 'table',
  COMPACT: 'compact',
};

const MODE_CONFIG = [
  { id: VIEW_MODES.GRID, icon: '▦', label: 'Grid' },
  { id: VIEW_MODES.TABLE, icon: '☰', label: 'Table' },
  { id: VIEW_MODES.COMPACT, icon: '≡', label: 'Compact' },
];

export default function ViewModeToggle({ viewMode, onViewModeChange }) {
  return (
    <div className="view-mode-toggle" data-testid="view-mode-toggle" role="group" aria-label="View mode">
      {MODE_CONFIG.map(mode => (
        <button
          key={mode.id}
          className={`view-mode-btn ${viewMode === mode.id ? 'view-mode-btn--active' : ''}`}
          onClick={() => onViewModeChange(mode.id)}
          title={mode.label}
          aria-pressed={viewMode === mode.id}
          data-testid={`view-mode-${mode.id}`}
        >
          {mode.icon}
        </button>
      ))}
    </div>
  );
}
