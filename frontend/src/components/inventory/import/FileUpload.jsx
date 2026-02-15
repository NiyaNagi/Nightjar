/**
 * FileUpload.jsx
 *
 * Step 1 of the import wizard — drag-drop or browse for CSV/XLSX files.
 * Auto-detects header row and previews detected columns.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §9.1
 */

import React, { useState, useCallback, useRef } from 'react';

const ACCEPTED = '.csv,.xlsx,.xls';
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * @param {{ onFileLoaded: (file: File, parsed: { headers, rows, sheetNames }) => void }} props
 */
export default function FileUpload({ onFileLoaded }) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const inputRef = useRef(null);

  const handleFile = useCallback(async (file, sheetName) => {
    setError(null);
    if (!file) return;

    // Validate extension
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      setError('Unsupported file type. Please use CSV, XLSX, or XLS.');
      return;
    }

    // Validate size
    if (file.size > MAX_SIZE) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`);
      return;
    }

    setLoading(true);
    try {
      const { parseFile } = await import('../../../utils/importParser');
      const result = await parseFile(file, { sheetName });

      // If multi-sheet XLSX and no sheet was explicitly selected, show selector
      if (!sheetName && result.sheetNames && result.sheetNames.length > 1) {
        setPendingFile(file);
        setSheetNames(result.sheetNames);
        setSelectedSheet(result.sheetNames[0]);
        setLoading(false);
        return;
      }

      setPendingFile(null);
      setSheetNames([]);
      onFileLoaded(file, result);
    } catch (err) {
      setError(`Failed to parse file: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [onFileLoaded]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  return (
    <div className="file-upload">
      <div
        className={`fu-dropzone ${dragOver ? 'drag-over' : ''} ${loading ? 'loading' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          onChange={e => handleFile(e.target.files?.[0])}
          style={{ display: 'none' }}
        />
        {loading ? (
          <div className="fu-loading">
            <span className="fu-spinner" />
            <p>Parsing file...</p>
          </div>
        ) : (
          <>
            <div className="fu-icon">📁</div>
            <p className="fu-text">Drag & drop a file here, or click to browse</p>
            <p className="fu-hint">CSV, XLSX, or XLS — up to 50 MB</p>
          </>
        )}
      </div>

      {error && <p className="fu-error">{error}</p>}

      {/* Sheet selector for multi-sheet XLSX */}
      {sheetNames.length > 1 && pendingFile && (
        <div className="fu-sheet-selector">
          <p>This workbook has multiple sheets. Select which one to import:</p>
          <select value={selectedSheet} onChange={e => setSelectedSheet(e.target.value)}>
            {sheetNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button className="btn-primary btn-sm" onClick={() => handleFile(pendingFile, selectedSheet)}>
            Import "{selectedSheet}"
          </button>
        </div>
      )}
    </div>
  );
}
