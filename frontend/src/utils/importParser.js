/**
 * importParser.js
 *
 * Generic CSV / XLSX parsing with header auto-detection.
 * Uses SheetJS (xlsx) for multi-format support.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §9.1–9.4
 */

import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a File/Blob into { headers: string[], rows: object[], sheetNames?: string[] }.
 *
 * @param {File} file
 * @param {object} [opts]
 * @param {number}  [opts.headerRow]   – 0-based row index for headers (auto-detect if omitted)
 * @param {string}  [opts.sheetName]   – For multi-sheet XLSX
 * @param {number}  [opts.maxRows]     – Safety cap (default 50 000)
 * @returns {Promise<{ headers: string[], rows: object[], sheetNames: string[] }>}
 */
export async function parseFile(file, opts = {}) {
  const { maxRows = 50_000 } = opts;
  const ext = file.name.split('.').pop().toLowerCase();

  let workbook;
  if (ext === 'csv') {
    const text = await file.text();
    workbook = XLSX.read(text, { type: 'string', raw: false });
  } else {
    const buf = await file.arrayBuffer();
    workbook = XLSX.read(buf, { type: 'array', raw: false });
  }

  const sheetNames = workbook.SheetNames;
  const sheetName = opts.sheetName || sheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`);

  // Convert to array of arrays
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Detect or use explicit header row
  const headerIdx = opts.headerRow ?? detectHeaderRow(aoa);
  const rawHeaders = (aoa[headerIdx] || []).map(h => normalizeHeader(String(h)));

  // Build rows (objects keyed by normalized header)
  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length && rows.length < maxRows; i++) {
    const row = aoa[i];
    if (isEmptyRow(row)) continue;
    const obj = {};
    rawHeaders.forEach((h, ci) => {
      if (h) obj[h] = row[ci] != null ? String(row[ci]).trim() : '';
    });
    rows.push(obj);
  }

  return { headers: rawHeaders.filter(Boolean), rows, sheetNames };
}

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

/**
 * Auto-detect header row: first row where >50 % of cells are non-empty strings.
 */
export function detectHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const row = aoa[i];
    if (!row || row.length === 0) continue;
    const filled = row.filter(c => c != null && String(c).trim() !== '').length;
    if (filled / row.length > 0.5) return i;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeHeader(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function isEmptyRow(row) {
  if (!row) return true;
  return row.every(c => c == null || String(c).trim() === '');
}

/**
 * Validate a single parsed row against the column mapping.
 *
 * @param {object} row – raw parsed row
 * @param {object} mapping – { sourceCol: targetField }
 * @param {object} catalogLookup – { itemName: catalogItem }
 * @returns {{ valid: boolean, warnings: string[], errors: string[] }}
 */
export function validateRow(row, mapping, catalogLookup = {}) {
  const errors = [];
  const warnings = [];

  // Map source → target
  const mapped = {};
  for (const [src, tgt] of Object.entries(mapping)) {
    if (tgt && tgt !== '__skip__') {
      mapped[tgt] = row[src] ?? '';
    }
  }

  // Required: item, quantity, requesterState
  if (!mapped.item) errors.push('Missing item');
  else if (catalogLookup && Object.keys(catalogLookup).length > 0) {
    const key = mapped.item.trim().toLowerCase();
    if (!Object.keys(catalogLookup).some(k => k.toLowerCase() === key)) {
      warnings.push(`Unknown catalog item: "${mapped.item}"`);
    }
  }

  if (!mapped.quantity) {
    errors.push('Missing quantity');
  } else {
    const q = parseInt(mapped.quantity, 10);
    if (isNaN(q) || q <= 0) errors.push(`Invalid quantity: "${mapped.quantity}"`);
  }

  if (mapped.requester_state) {
    // Loose validation — just flag suspicious
    if (mapped.requester_state.length > 2 && mapped.requester_state.length < 4) {
      warnings.push(`State may be abbreviated incorrectly: "${mapped.requester_state}"`);
    }
  }

  return { valid: errors.length === 0, warnings, errors, mapped };
}
