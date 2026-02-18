/**
 * ImportPreview.jsx
 *
 * Step 3 of the import wizard — validate and preview mapped data.
 * Shows validation summary (total/valid/warning/error) and paginated preview table.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §9.3
 */

import React, { useMemo, useState } from 'react';
import { validateRow } from '../../../utils/importParser';
import { inferStatus, inferUrgency } from '../../../utils/importMapper';
import { useInventory } from '../../../contexts/InventoryContext';

const PAGE_SIZE = 25;

/**
 * @param {{
 *   rows: object[],
 *   mapping: Record<string, string>,
 *   catalogItems: object[],
 *   onConfirm: (validRows: object[], opts: object) => void,
 *   onBack: () => void
 * }} props
 */
export default function ImportPreview({ rows, mapping, catalogItems, onConfirm, onBack }) {
  const ctx = useInventory();
  const collaborators = ctx.collaborators || [];
  const [page, setPage] = useState(0);
  const [skipErrors, setSkipErrors] = useState(true);
  const [skipWarnings, setSkipWarnings] = useState(false);

  // Build catalog lookup (lowercased keys to match case-insensitive import logic)
  const catalogLookup = useMemo(() => {
    const m = {};
    for (const ci of (catalogItems || [])) {
      m[ci.name.toLowerCase()] = ci;
    }
    return m;
  }, [catalogItems]);

  // Validate all rows
  const validated = useMemo(() => {
    return rows.map((row, i) => {
      const result = validateRow(row, mapping, catalogLookup, collaborators);
      return { index: i, row, ...result };
    });
  }, [rows, mapping, catalogLookup, collaborators]);

  const summary = useMemo(() => {
    const total = validated.length;
    const valid = validated.filter(v => v.valid && v.warnings.length === 0).length;
    const withWarnings = validated.filter(v => v.valid && v.warnings.length > 0).length;
    const errors = validated.filter(v => !v.valid).length;
    return { total, valid, withWarnings, errors };
  }, [validated]);

  // Paginate
  const pageCount = Math.ceil(validated.length / PAGE_SIZE);
  const pageData = validated.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Get mapped target field names for table headers
  const targetFields = useMemo(() => {
    const fields = new Set();
    for (const [, tgt] of Object.entries(mapping)) {
      if (tgt && typeof tgt === 'string' && tgt !== '__skip__' && !tgt.startsWith('__')) fields.add(tgt);
    }
    return Array.from(fields);
  }, [mapping]);

  const handleConfirm = () => {
    let toImport = validated;
    if (skipErrors) toImport = toImport.filter(v => v.valid);
    if (skipWarnings) toImport = toImport.filter(v => v.warnings.length === 0);

    // Build final rows with mapped fields + defaults
    const finalRows = toImport.map(v => {
      const mapped = { ...v.mapped };
      // Apply defaults
      if (!mapped.item && mapping.__defaultItem) mapped.item = mapping.__defaultItem;
      if (mapped.status) mapped.status = inferStatus(mapped.status);
      else mapped.status = mapping.__defaultStatus || 'open';
      if (mapped.urgency) mapped.urgency = inferUrgency(mapped.urgency);
      else mapped.urgency = 'normal';
      if (mapped.quantity) mapped.quantity = parseInt(mapped.quantity, 10) || 1;
      return mapped;
    });

    onConfirm(finalRows, { skipErrors, skipWarnings, mapping });
  };

  return (
    <div className="import-preview">
      {/* Validation summary */}
      <div className="ip-summary">
        <div className="ip-summary-card">
          <span className="ip-count">{summary.total}</span>
          <span className="ip-label">Total Rows</span>
        </div>
        <div className="ip-summary-card valid">
          <span className="ip-count">{summary.valid}</span>
          <span className="ip-label">✅ Valid</span>
        </div>
        <div className="ip-summary-card warn">
          <span className="ip-count">{summary.withWarnings}</span>
          <span className="ip-label">⚠️ Warnings</span>
        </div>
        <div className="ip-summary-card error">
          <span className="ip-count">{summary.errors}</span>
          <span className="ip-label">❌ Errors</span>
        </div>
      </div>

      {/* Options */}
      <div className="ip-options">
        <label>
          <input type="checkbox" checked={skipErrors} onChange={e => setSkipErrors(e.target.checked)} />
          Skip rows with errors
        </label>
        <label>
          <input type="checkbox" checked={skipWarnings} onChange={e => setSkipWarnings(e.target.checked)} />
          Skip rows with warnings
        </label>
      </div>

      {/* Preview table */}
      <div className="ip-table-wrapper">
        <table className="ip-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Status</th>
              {targetFields.map(f => <th key={f}>{f}</th>)}
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map(v => (
              <tr key={v.index} className={!v.valid ? 'row-error' : v.warnings.length > 0 ? 'row-warn' : ''}>
                <td>{v.index + 1}</td>
                <td>
                  {!v.valid ? '❌' : v.warnings.length > 0 ? '⚠️' : '✅'}
                </td>
                {targetFields.map(f => (
                  <td key={f}>{v.mapped?.[f] ?? v.row?.[f] ?? ''}</td>
                ))}
                <td className="ip-issues">
                  {[...v.errors, ...v.warnings].join('; ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="ip-pagination">
          <button className="btn-sm btn-secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            ← Prev
          </button>
          <span>Page {page + 1} of {pageCount}</span>
          <button className="btn-sm btn-secondary" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>
            Next →
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="ip-actions">
        <button className="btn-sm btn-secondary" onClick={onBack}>← Back to Mapping</button>
        <button
          className="btn-sm btn-primary"
          onClick={handleConfirm}
          disabled={(
            (skipErrors ? summary.valid + (skipWarnings ? 0 : summary.withWarnings) : summary.total - (skipWarnings ? summary.withWarnings : 0))
          ) === 0}
        >
          Import {skipErrors
            ? summary.valid + (skipWarnings ? 0 : summary.withWarnings)
            : summary.total - (skipWarnings ? summary.withWarnings : 0)
          } rows →
        </button>
      </div>
    </div>
  );
}
