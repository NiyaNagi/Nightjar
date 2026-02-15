/**
 * tests/import-parser.test.js
 *
 * Unit tests for the CSV/XLSX import parser and column mapper.
 * See docs/INVENTORY_SYSTEM_SPEC.md §9.1–9.4
 */

// Mock SheetJS (xlsx) since it's a heavy module
jest.mock('xlsx', () => {
  const mockRead = jest.fn((data, opts) => {
    // Parse CSV text manually for testing
    if (opts.type === 'string') {
      const lines = data.split('\n').map(l =>
        l.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
      );
      const sheet = {};
      // Build a minimal sheet from lines
      sheet.__lines = lines;
      return {
        SheetNames: ['Sheet1'],
        Sheets: {
          Sheet1: sheet,
        },
      };
    }
    // Array buffer path
    return {
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: { __lines: [] } },
    };
  });

  return {
    read: mockRead,
    utils: {
      sheet_to_json: (sheet, opts) => {
        // Return the __lines array as AOA
        return sheet.__lines || [];
      },
    },
  };
});

import { detectHeaderRow, validateRow } from '../frontend/src/utils/importParser';
import {
  autoMapColumns,
  flattenMapping,
  inferStatus,
  inferUrgency,
  TARGET_FIELDS,
  REQUIRED_FIELDS,
} from '../frontend/src/utils/importMapper';

// ---------------------------------------------------------------------------
// detectHeaderRow
// ---------------------------------------------------------------------------

describe('detectHeaderRow', () => {
  it('should detect first row with >50% filled cells as header', () => {
    const aoa = [
      ['', '', ''],               // empty row
      ['Item', 'Qty', 'State'],   // header row (100% filled)
      ['Widget', '5', 'CO'],
    ];
    expect(detectHeaderRow(aoa)).toBe(1);
  });

  it('should return 0 when first row is the header', () => {
    const aoa = [
      ['Item', 'Quantity', 'State'],
      ['Widget', '5', 'CO'],
    ];
    expect(detectHeaderRow(aoa)).toBe(0);
  });

  it('should handle empty input', () => {
    expect(detectHeaderRow([])).toBe(0);
  });

  it('should handle rows with some empty cells', () => {
    const aoa = [
      ['', ''],                       // 0% filled → skip
      ['Item', '', 'State'],           // 66% filled → header
      ['Widget', '5', 'CO'],
    ];
    expect(detectHeaderRow(aoa)).toBe(1);
  });

  it('should only scan first 10 rows', () => {
    const aoa = Array(15).fill(['', '']);
    aoa[12] = ['Item', 'Qty'];
    // Should not find header at row 12 (past scan limit)
    expect(detectHeaderRow(aoa)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateRow
// ---------------------------------------------------------------------------

describe('validateRow', () => {
  const mapping = {
    item: 'item',
    qty: 'quantity',
    state: 'requester_state',
  };

  it('should validate a valid row', () => {
    const row = { item: 'Widget', qty: '5', state: 'CO' };
    const result = validateRow(row, mapping);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should error on missing item', () => {
    const row = { item: '', qty: '5', state: 'CO' };
    const result = validateRow(row, mapping);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing item');
  });

  it('should error on missing quantity', () => {
    const row = { item: 'Widget', qty: '', state: 'CO' };
    const result = validateRow(row, mapping);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('quantity'))).toBe(true);
  });

  it('should error on invalid quantity (NaN)', () => {
    const row = { item: 'Widget', qty: 'abc', state: 'CO' };
    const result = validateRow(row, mapping);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid quantity'))).toBe(true);
  });

  it('should error on zero quantity', () => {
    const row = { item: 'Widget', qty: '0', state: 'CO' };
    const result = validateRow(row, mapping);
    expect(result.valid).toBe(false);
  });

  it('should warn on unknown catalog item when lookup is provided', () => {
    const row = { item: 'UnknownThing', qty: '5', state: 'CO' };
    const catalog = { widget: { id: 'item-1', name: 'Widget' } };
    const result = validateRow(row, mapping, catalog);
    expect(result.valid).toBe(true); // warnings don't make it invalid
    expect(result.warnings.some(w => w.includes('Unknown catalog item'))).toBe(true);
  });

  it('should match catalog items case-insensitively', () => {
    const row = { item: 'WIDGET', qty: '5', state: 'CO' };
    const catalog = { widget: { id: 'item-1', name: 'Widget' } };
    const result = validateRow(row, mapping, catalog);
    expect(result.warnings.filter(w => w.includes('Unknown catalog'))).toHaveLength(0);
  });

  it('should skip columns mapped to __skip__', () => {
    const skipMapping = { item: 'item', qty: 'quantity', extra: '__skip__' };
    const row = { item: 'Widget', qty: '5', extra: 'ignored' };
    const result = validateRow(row, skipMapping);
    expect(result.valid).toBe(true);
    expect(result.mapped.extra).toBeUndefined();
  });

  it('should return mapped values', () => {
    const row = { item: 'Widget', qty: '5', state: 'CO' };
    const result = validateRow(row, mapping);
    expect(result.mapped.item).toBe('Widget');
    expect(result.mapped.quantity).toBe('5');
    expect(result.mapped.requester_state).toBe('CO');
  });
});

// ---------------------------------------------------------------------------
// autoMapColumns
// ---------------------------------------------------------------------------

describe('autoMapColumns', () => {
  it('should auto-map exact field names with 100% confidence', () => {
    const headers = ['item', 'quantity', 'requester_state'];
    const result = autoMapColumns(headers);

    expect(result.item.target).toBe('item');
    expect(result.item.confidence).toBe(100);
    expect(result.quantity.target).toBe('quantity');
    expect(result.quantity.confidence).toBe(100);
  });

  it('should map common aliases', () => {
    const headers = ['product', 'qty', 'state'];
    const result = autoMapColumns(headers);

    expect(result.product.target).toBe('item');
    expect(result.qty.target).toBe('quantity');
    // 'state' could map to requester_state or status — both have it as alias
    expect(result.state.target).toBeDefined();
  });

  it('should not double-assign targets', () => {
    const headers = ['item', 'product', 'quantity'];
    const result = autoMapColumns(headers);

    // 'item' should get assigned first (exact match), 'product' should not also get 'item'
    expect(result.item.target).toBe('item');
    // 'product' might get a different target or null since 'item' is taken
    if (result.product.target) {
      expect(result.product.target).not.toBe('item');
    }
  });

  it('should return null target for unrecognized headers', () => {
    const headers = ['foo_bar_baz', 'xyz_123'];
    const result = autoMapColumns(headers);

    expect(result.foo_bar_baz.target).toBeNull();
    expect(result.foo_bar_baz.confidence).toBe(0);
  });

  it('should handle empty headers array', () => {
    const result = autoMapColumns([]);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// flattenMapping
// ---------------------------------------------------------------------------

describe('flattenMapping', () => {
  it('should flatten autoMap result to source→target', () => {
    const autoMap = {
      item: { target: 'item', confidence: 100 },
      qty: { target: 'quantity', confidence: 100 },
      foo: { target: null, confidence: 0 },
    };
    const flat = flattenMapping(autoMap);
    expect(flat.item).toBe('item');
    expect(flat.qty).toBe('quantity');
    expect(flat.foo).toBe('__skip__');
  });
});

// ---------------------------------------------------------------------------
// inferStatus
// ---------------------------------------------------------------------------

describe('inferStatus', () => {
  it('should return open for null/empty', () => {
    expect(inferStatus(null)).toBe('open');
    expect(inferStatus('')).toBe('open');
    expect(inferStatus(undefined)).toBe('open');
  });

  it('should map canonical statuses', () => {
    expect(inferStatus('open')).toBe('open');
    expect(inferStatus('shipped')).toBe('shipped');
    expect(inferStatus('delivered')).toBe('delivered');
    expect(inferStatus('cancelled')).toBe('cancelled');
  });

  it('should map aliases', () => {
    expect(inferStatus('new')).toBe('open');
    expect(inferStatus('pending')).toBe('pending_approval');
    expect(inferStatus('completed')).toBe('delivered');
    expect(inferStatus('done')).toBe('delivered');
    expect(inferStatus('fulfilled')).toBe('delivered');
    expect(inferStatus('canceled')).toBe('cancelled'); // US spelling
  });

  it('should be case-insensitive', () => {
    expect(inferStatus('SHIPPED')).toBe('shipped');
    expect(inferStatus('Delivered')).toBe('delivered');
    expect(inferStatus('  Open  ')).toBe('open');
  });

  it('should default to open for unknown values', () => {
    expect(inferStatus('banana')).toBe('open');
    expect(inferStatus('in_transit')).toBe('open');
  });
});

// ---------------------------------------------------------------------------
// inferUrgency
// ---------------------------------------------------------------------------

describe('inferUrgency', () => {
  it('should return normal for null/empty', () => {
    expect(inferUrgency(null)).toBe('normal');
    expect(inferUrgency('')).toBe('normal');
  });

  it('should detect urgent/high/rush', () => {
    expect(inferUrgency('urgent')).toBe('urgent');
    expect(inferUrgency('high')).toBe('urgent');
    expect(inferUrgency('rush')).toBe('urgent');
    expect(inferUrgency('critical')).toBe('urgent');
  });

  it('should detect normal/medium/standard', () => {
    expect(inferUrgency('normal')).toBe('normal');
    expect(inferUrgency('medium')).toBe('normal');
    expect(inferUrgency('standard')).toBe('normal');
  });

  it('should detect low', () => {
    expect(inferUrgency('low')).toBe('low');
  });

  it('should be case-insensitive', () => {
    expect(inferUrgency('URGENT')).toBe('urgent');
    expect(inferUrgency('Normal')).toBe('normal');
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('TARGET_FIELDS should contain expected fields', () => {
    expect(TARGET_FIELDS).toContain('item');
    expect(TARGET_FIELDS).toContain('quantity');
    expect(TARGET_FIELDS).toContain('requester_name');
    expect(TARGET_FIELDS).toContain('requester_state');
    expect(TARGET_FIELDS).toContain('urgency');
    expect(TARGET_FIELDS).toContain('status');
  });

  it('REQUIRED_FIELDS should include item and quantity', () => {
    expect(REQUIRED_FIELDS).toContain('item');
    expect(REQUIRED_FIELDS).toContain('quantity');
    expect(REQUIRED_FIELDS).toHaveLength(2);
  });
});
