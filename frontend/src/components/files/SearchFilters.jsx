/**
 * SearchFilters
 * 
 * Advanced filter chips for file search.
 * Filters: Type category, Uploader, Date range, Size range, Distribution status.
 * 
 * See docs/FILE_STORAGE_SPEC.md §10
 */

import { useState, useCallback, useMemo } from 'react';
import { FILE_TYPE_COLORS } from '../../utils/fileTypeCategories';
import './SearchFilters.css';

const SIZE_RANGES = [
  { label: 'All sizes', value: null },
  { label: '< 1 MB', value: { max: 1024 * 1024 } },
  { label: '1–10 MB', value: { min: 1024 * 1024, max: 10 * 1024 * 1024 } },
  { label: '10–50 MB', value: { min: 10 * 1024 * 1024, max: 50 * 1024 * 1024 } },
  { label: '> 50 MB', value: { min: 50 * 1024 * 1024 } },
];

const DATE_RANGES = [
  { label: 'Any time', value: null },
  { label: 'Last 24h', value: 24 * 60 * 60 * 1000 },
  { label: 'Last 7d', value: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Last 30d', value: 30 * 24 * 60 * 60 * 1000 },
];

const CATEGORIES = ['all', ...Object.keys(FILE_TYPE_COLORS)];

export default function SearchFilters({ filters, onFiltersChange }) {
  const [showPanel, setShowPanel] = useState(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.category && filters.category !== 'all') count++;
    if (filters.sizeRange) count++;
    if (filters.dateRange) count++;
    if (filters.uploader) count++;
    return count;
  }, [filters]);

  const updateFilter = useCallback((key, value) => {
    onFiltersChange?.({ ...filters, [key]: value });
  }, [filters, onFiltersChange]);

  const clearFilters = useCallback(() => {
    onFiltersChange?.({ category: 'all', sizeRange: null, dateRange: null, uploader: '' });
  }, [onFiltersChange]);

  return (
    <div className="fs-search-filters" data-testid="fs-search-filters">
      <button
        className={`fs-filter-toggle ${activeFilterCount > 0 ? 'fs-filter-toggle--active' : ''}`}
        onClick={() => setShowPanel(!showPanel)}
        data-testid="fs-filter-toggle"
      >
        🔽 Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
      </button>

      {activeFilterCount > 0 && (
        <button className="fs-filter-clear" onClick={clearFilters} data-testid="fs-filter-clear">
          ✕ Clear
        </button>
      )}

      {/* Active filter chips */}
      <div className="fs-filter-chips">
        {filters.category && filters.category !== 'all' && (
          <span className="fs-filter-chip" data-testid="fs-filter-chip-category">
            {FILE_TYPE_COLORS[filters.category]?.icon} {filters.category}
            <button onClick={() => updateFilter('category', 'all')}>✕</button>
          </span>
        )}
        {filters.sizeRange && (
          <span className="fs-filter-chip" data-testid="fs-filter-chip-size">
            📐 {SIZE_RANGES.find(s => s.value === filters.sizeRange)?.label || 'Size'}
            <button onClick={() => updateFilter('sizeRange', null)}>✕</button>
          </span>
        )}
        {filters.dateRange && (
          <span className="fs-filter-chip" data-testid="fs-filter-chip-date">
            📅 {DATE_RANGES.find(d => d.value === filters.dateRange)?.label || 'Date'}
            <button onClick={() => updateFilter('dateRange', null)}>✕</button>
          </span>
        )}
      </div>

      {showPanel && (
        <div className="fs-filter-panel" data-testid="fs-filter-panel">
          <div className="fs-filter-section">
            <label className="fs-filter-label">Type</label>
            <select
              className="fs-filter-select"
              value={filters.category || 'all'}
              onChange={(e) => updateFilter('category', e.target.value)}
              data-testid="fs-filter-category"
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All types' : `${FILE_TYPE_COLORS[cat]?.icon || ''} ${cat}`}
                </option>
              ))}
            </select>
          </div>

          <div className="fs-filter-section">
            <label className="fs-filter-label">Size</label>
            <div className="fs-filter-btn-group">
              {SIZE_RANGES.map((sr, i) => (
                <button
                  key={i}
                  className={`fs-filter-option ${filters.sizeRange === sr.value ? 'fs-filter-option--active' : ''}`}
                  onClick={() => updateFilter('sizeRange', sr.value)}
                >
                  {sr.label}
                </button>
              ))}
            </div>
          </div>

          <div className="fs-filter-section">
            <label className="fs-filter-label">Date</label>
            <div className="fs-filter-btn-group">
              {DATE_RANGES.map((dr, i) => (
                <button
                  key={i}
                  className={`fs-filter-option ${filters.dateRange === dr.value ? 'fs-filter-option--active' : ''}`}
                  onClick={() => updateFilter('dateRange', dr.value)}
                >
                  {dr.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Apply filters to a file list.
 * @param {Array} files
 * @param {Object} filters - { category, sizeRange, dateRange, uploader, searchQuery }
 * @returns {Array}
 */
export function applyFilters(files, filters) {
  let result = files;

  const searchTerm = filters.searchQuery || filters.search;
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    result = result.filter(f => {
      const name = (f.name || '').toLowerCase();
      const ext = (f.extension || '').toLowerCase();
      const tags = (f.tags || []).join(' ').toLowerCase();
      const desc = (f.description || '').toLowerCase();
      const uploader = (f.uploadedByName || '').toLowerCase();
      return name.includes(q) || ext === q || tags.includes(q) || desc.includes(q) || uploader.includes(q);
    });
  }

  if (filters.category && filters.category !== 'all') {
    result = result.filter(f => f.typeCategory === filters.category);
  }

  if (filters.sizeRange) {
    result = result.filter(f => {
      const size = f.sizeBytes || 0;
      if (filters.sizeRange.min != null && size < filters.sizeRange.min) return false;
      if (filters.sizeRange.max != null && size >= filters.sizeRange.max) return false;
      return true;
    });
  }

  if (filters.dateRange) {
    const cutoff = Date.now() - filters.dateRange;
    result = result.filter(f => (f.updatedAt || f.createdAt) >= cutoff);
  }

  if (filters.uploader) {
    const u = filters.uploader.toLowerCase();
    result = result.filter(f => (f.uploadedByName || '').toLowerCase().includes(u));
  }

  return result;
}
