/**
 * SearchBar
 * 
 * File search with autocomplete dropdown.
 * Searches across filename, extension, tags, description, uploader name.
 * Debounce 300ms, limit 10 autocomplete results.
 * 
 * See docs/FILE_STORAGE_SPEC.md §10
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { getFileIcon } from '../../utils/fileTypeCategories';
import './SearchBar.css';

export default function SearchBar({
  files,
  folders,
  onSelectFile,
  onSelectFolder,
  onSearch,
  placeholder = 'Search files...',
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const debounceRef = useRef(null);

  const search = useCallback((q) => {
    if (!q || q.trim().length === 0) {
      setResults([]);
      setIsOpen(false);
      onSearch?.('');
      return;
    }

    const lower = q.toLowerCase().trim();
    onSearch?.(lower);

    const fileResults = (files || [])
      .filter(f => {
        const name = (f.name || '').toLowerCase();
        const ext = (f.extension || '').toLowerCase();
        const tags = (f.tags || []).join(' ').toLowerCase();
        const desc = (f.description || '').toLowerCase();
        const uploader = (f.uploadedByName || '').toLowerCase();
        const category = (f.typeCategory || '').toLowerCase();
        return (
          name.includes(lower) ||
          ext === lower ||
          tags.includes(lower) ||
          desc.includes(lower) ||
          uploader.includes(lower) ||
          category === lower
        );
      })
      .slice(0, 8)
      .map(f => ({ type: 'file', item: f }));

    const folderResults = (folders || [])
      .filter(f => (f.name || '').toLowerCase().includes(lower))
      .slice(0, 2)
      .map(f => ({ type: 'folder', item: f }));

    const combined = [...folderResults, ...fileResults].slice(0, 10);
    setResults(combined);
    setIsOpen(combined.length > 0);
  }, [files, folders, onSearch]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setQuery(val);
    
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  }, [search]);

  const handleSelect = useCallback((result) => {
    setIsOpen(false);
    setQuery('');
    onSearch?.('');
    if (result.type === 'file') {
      onSelectFile?.(result.item);
    } else {
      onSelectFolder?.(result.item);
    }
  }, [onSelectFile, onSelectFolder, onSearch]);

  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    onSearch?.('');
    inputRef.current?.focus();
  }, [onSearch]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) && inputRef.current && !inputRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="fs-search-bar" data-testid="fs-search-bar">
      <div className="fs-search-input-wrap">
        <span className="fs-search-icon">🔍</span>
        <input
          ref={inputRef}
          type="text"
          className="fs-search-input"
          placeholder={placeholder}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
          data-testid="fs-search-input"
        />
        {query && (
          <button className="fs-search-clear" onClick={handleClear} title="Clear search" data-testid="fs-search-clear">
            ✕
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="fs-search-dropdown" ref={dropdownRef} data-testid="fs-search-dropdown">
          {results.map((r, i) => (
            <button
              key={r.item.id || i}
              className="fs-search-result"
              onClick={() => handleSelect(r)}
              data-testid={`fs-search-result-${i}`}
            >
              <span className="fs-search-result-icon">
                {r.type === 'folder' ? (r.item.icon || '📁') : getFileIcon(r.item.extension)}
              </span>
              <span className="fs-search-result-name">{r.item.name}</span>
              <span className="fs-search-result-type">
                {r.type === 'folder' ? 'Folder' : (r.item.extension?.toUpperCase() || 'File')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
