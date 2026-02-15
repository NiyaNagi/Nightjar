/**
 * ColumnMapper.jsx
 *
 * Step 2 of the import wizard — map source columns to target fields.
 * Auto-suggests mappings and allows manual override.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §9.2
 */

import React, { useState, useMemo, useEffect } from 'react';
import { autoMapColumns, TARGET_FIELDS, REQUIRED_FIELDS } from '../../../utils/importMapper';

/**
 * @param {{
 *   headers: string[],
 *   sampleRows: object[],
 *   onMappingComplete: (mapping: Record<string, string>) => void,
 *   catalogItems: object[]
 * }} props
 */
export default function ColumnMapper({ headers, sampleRows, onMappingComplete, catalogItems }) {
  // Auto-map on mount
  const autoMap = useMemo(() => autoMapColumns(headers), [headers]);

  const [mapping, setMapping] = useState(() => {
    const m = {};
    for (const h of headers) {
      m[h] = autoMap[h]?.target || '__skip__';
    }
    return m;
  });

  // Default catalog item for unmapped item column
  const [defaultItem, setDefaultItem] = useState(catalogItems?.[0]?.name || '');
  const [defaultStatus, setDefaultStatus] = useState('open');

  // Check if required fields are mapped
  const missingRequired = useMemo(() => {
    const mapped = new Set(Object.values(mapping).filter(v => v !== '__skip__'));
    return REQUIRED_FIELDS.filter(f => !mapped.has(f));
  }, [mapping]);

  const handleChange = (source, target) => {
    setMapping(prev => {
      const next = { ...prev };
      // If this target is already used elsewhere, un-assign it
      if (target !== '__skip__') {
        for (const [k, v] of Object.entries(next)) {
          if (v === target && k !== source) next[k] = '__skip__';
        }
      }
      next[source] = target;
      return next;
    });
  };

  const handleContinue = () => {
    const finalMapping = { ...mapping };
    // If item is missing and we have a default, mark it
    if (missingRequired.includes('item') && defaultItem) {
      finalMapping.__defaultItem = defaultItem;
    }
    finalMapping.__defaultStatus = defaultStatus;
    onMappingComplete(finalMapping);
  };

  return (
    <div className="column-mapper">
      <p className="cm-description">
        Map your file columns to inventory fields. Auto-detected mappings are pre-filled.
      </p>

      <table className="cm-table">
        <thead>
          <tr>
            <th>Source Column</th>
            <th>Sample Value</th>
            <th>Maps To</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {headers.map(h => {
            const sample = sampleRows?.[0]?.[h] || '';
            const conf = autoMap[h]?.confidence || 0;
            return (
              <tr key={h}>
                <td className="cm-source">{h}</td>
                <td className="cm-sample">{String(sample).slice(0, 40)}</td>
                <td>
                  <select
                    value={mapping[h]}
                    onChange={e => handleChange(h, e.target.value)}
                    className="cm-select"
                  >
                    <option value="__skip__">— Skip —</option>
                    {TARGET_FIELDS.map(tf => (
                      <option key={tf} value={tf}>{tf}</option>
                    ))}
                  </select>
                </td>
                <td className={`cm-conf ${conf === 100 ? 'exact' : conf > 0 ? 'partial' : ''}`}>
                  {conf > 0 ? `${conf}%` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Defaults for unmapped required fields */}
      {missingRequired.includes('item') && (
        <div className="cm-default">
          <label>Default catalog item (for all rows):</label>
          <select value={defaultItem} onChange={e => setDefaultItem(e.target.value)}>
            <option value="">— Select —</option>
            {(catalogItems || []).map(ci => (
              <option key={ci.id} value={ci.name}>{ci.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="cm-default">
        <label>Default status for imported requests:</label>
        <select value={defaultStatus} onChange={e => setDefaultStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="approved">Approved</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
        </select>
      </div>

      {missingRequired.length > 0 && !missingRequired.every(f => f === 'item' && defaultItem) && (
        <p className="cm-warning">
          ⚠️ Missing required fields: {missingRequired.join(', ')}
        </p>
      )}

      <div className="cm-actions">
        <button
          className="btn-sm btn-primary"
          onClick={handleContinue}
          disabled={missingRequired.includes('quantity')}
        >
          Continue to Preview →
        </button>
      </div>
    </div>
  );
}
