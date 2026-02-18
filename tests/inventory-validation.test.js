/**
 * tests/inventory-validation.test.js
 *
 * Unit tests for inventoryValidation.js
 * See docs/INVENTORY_SYSTEM_SPEC.md §3.2, §6.6.1
 */

import {
  validateQuantity,
  isValidUSState,
  validateAddress,
  validateCatalogItem,
  parseDate,
  formatDate,
  formatRelativeDate,
  generateId,
  US_STATES,
  US_STATE_NAMES,
} from '../frontend/src/utils/inventoryValidation';

// ---------------------------------------------------------------------------
// validateQuantity
// ---------------------------------------------------------------------------

describe('validateQuantity', () => {
  const item = { quantityMin: 1, quantityMax: 100, quantityStep: 1 };

  it('should accept a valid quantity', () => {
    expect(validateQuantity(5, item)).toEqual({ valid: true });
  });

  it('should reject null quantity', () => {
    const r = validateQuantity(null, item);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/required/i);
  });

  it('should reject NaN quantity', () => {
    expect(validateQuantity(NaN, item).valid).toBe(false);
  });

  it('should reject non-integer quantity', () => {
    expect(validateQuantity(3.5, item).valid).toBe(false);
  });

  it('should reject zero', () => {
    expect(validateQuantity(0, item).valid).toBe(false);
  });

  it('should reject negative', () => {
    expect(validateQuantity(-1, item).valid).toBe(false);
  });

  it('should reject below minimum', () => {
    const r = validateQuantity(1, { quantityMin: 5, quantityMax: 100, quantityStep: 1 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/minimum/i);
  });

  it('should reject above maximum', () => {
    const r = validateQuantity(200, item);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/maximum/i);
  });

  it('should enforce step constraint', () => {
    const stepped = { quantityMin: 5, quantityMax: 100, quantityStep: 5 };
    expect(validateQuantity(10, stepped).valid).toBe(true);
    expect(validateQuantity(15, stepped).valid).toBe(true);
    const r = validateQuantity(7, stepped);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/multiples/i);
  });

  it('should default min=1, max=Infinity, step=1', () => {
    expect(validateQuantity(1, {}).valid).toBe(true);
    expect(validateQuantity(999999, {}).valid).toBe(true);
  });

  it('should accept string number coerced', () => {
    expect(validateQuantity('5', item).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidUSState
// ---------------------------------------------------------------------------

describe('isValidUSState', () => {
  it('should accept valid state codes', () => {
    expect(isValidUSState('CO')).toBe(true);
    expect(isValidUSState('ca')).toBe(true);
    expect(isValidUSState('NY')).toBe(true);
    expect(isValidUSState('DC')).toBe(true);
    expect(isValidUSState('PR')).toBe(true);
  });

  it('should reject invalid state codes', () => {
    expect(isValidUSState('XX')).toBe(false);
    expect(isValidUSState('')).toBe(false);
    expect(isValidUSState('Colorado')).toBe(false);
  });

  it('should handle null/undefined', () => {
    expect(isValidUSState(null)).toBe(false);
    expect(isValidUSState(undefined)).toBe(false);
  });

  it('should trim whitespace', () => {
    expect(isValidUSState(' CO ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateAddress
// ---------------------------------------------------------------------------

describe('validateAddress', () => {
  const validAddress = {
    recipientName: 'John Doe',
    street1: '123 Main St',
    city: 'Denver',
    state: 'CO',
    zip: '80202',
  };

  it('should accept a valid address', () => {
    const r = validateAddress(validAddress);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('should accept alternative field names (fullName, line1)', () => {
    const r = validateAddress({
      fullName: 'Jane',
      line1: '456 Oak Ave',
      city: 'Portland',
      state: 'OR',
      zip: '97201',
    });
    expect(r.valid).toBe(true);
  });

  it('should reject null address', () => {
    const r = validateAddress(null);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Address is required');
  });

  it('should require recipient name', () => {
    const r = validateAddress({ ...validAddress, recipientName: '' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContainEqual(expect.stringMatching(/recipient/i));
  });

  it('should require street address', () => {
    const r = validateAddress({ ...validAddress, street1: '' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContainEqual(expect.stringMatching(/street/i));
  });

  it('should require city', () => {
    const r = validateAddress({ ...validAddress, city: '' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContainEqual(expect.stringMatching(/city/i));
  });

  it('should require state', () => {
    const r = validateAddress({ ...validAddress, state: '' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContainEqual(expect.stringMatching(/state/i));
  });

  it('should validate state abbreviation', () => {
    const r = validateAddress({ ...validAddress, state: 'XX' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContainEqual(expect.stringMatching(/invalid.*state/i));
  });

  it('should require ZIP code', () => {
    const r = validateAddress({ ...validAddress, zip: '' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContainEqual(expect.stringMatching(/zip/i));
  });

  it('should validate ZIP format (5 digits)', () => {
    expect(validateAddress({ ...validAddress, zip: '80202' }).valid).toBe(true);
    expect(validateAddress({ ...validAddress, zip: '80202-1234' }).valid).toBe(true);
    expect(validateAddress({ ...validAddress, zip: 'ABCDE' }).valid).toBe(false);
    expect(validateAddress({ ...validAddress, zip: '123' }).valid).toBe(false);
  });

  it('should collect multiple errors', () => {
    const r = validateAddress({ city: '', state: '' });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// validateCatalogItem
// ---------------------------------------------------------------------------

describe('validateCatalogItem', () => {
  const validItem = {
    name: 'Widget',
    unitName: 'boxes',
    quantityMin: 1,
    quantityMax: 100,
    quantityStep: 1,
  };

  it('should accept a valid catalog item', () => {
    const r = validateCatalogItem(validItem);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('should require name', () => {
    const r = validateCatalogItem({ ...validItem, name: '' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContainEqual(expect.stringMatching(/name/i));
  });

  it('should require unit', () => {
    const r = validateCatalogItem({ ...validItem, unitName: '' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContainEqual(expect.stringMatching(/unit/i));
  });

  it('should validate min >= 1', () => {
    const r = validateCatalogItem({ ...validItem, quantityMin: 0 });
    expect(r.valid).toBe(false);
  });

  it('should validate max >= 1', () => {
    const r = validateCatalogItem({ ...validItem, quantityMax: 0 });
    expect(r.valid).toBe(false);
  });

  it('should reject min > max', () => {
    const r = validateCatalogItem({ ...validItem, quantityMin: 50, quantityMax: 10 });
    expect(r.valid).toBe(false);
    expect(r.errors).toContainEqual(expect.stringMatching(/cannot exceed/i));
  });

  it('should validate step >= 1', () => {
    const r = validateCatalogItem({ ...validItem, quantityStep: 0 });
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseDate
// ---------------------------------------------------------------------------

describe('parseDate', () => {
  it('should parse ISO date strings', () => {
    const ts = parseDate('2025-01-15');
    expect(ts).toBeGreaterThan(0);
    const d = new Date(ts);
    expect(d.getFullYear()).toBe(2025);
  });

  it('should parse ISO datetime strings', () => {
    const ts = parseDate('2025-01-15T12:00:00Z');
    expect(ts).toBeGreaterThan(0);
  });

  it('should parse M/D/YYYY (Google Sheets format)', () => {
    const ts = parseDate('1/15/2025');
    expect(ts).toBeGreaterThan(0);
    const d = new Date(ts);
    expect(d.getMonth()).toBe(0); // January
    expect(d.getDate()).toBe(15);
    expect(d.getFullYear()).toBe(2025);
  });

  it('should return null for empty/invalid input', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('   ')).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
  });

  it('should treat small numbers as Excel serial dates', () => {
    // 42 => Excel serial date (Feb 11, 1900)
    const result = parseDate(42);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('should return "—" for falsy input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(0)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });

  it('should return "—" for invalid timestamps', () => {
    expect(formatDate(NaN)).toBe('—');
  });

  it('should format a valid timestamp', () => {
    // Use a local date to avoid timezone shifts
    const ts = new Date(2025, 5, 15, 12, 0, 0).getTime();
    const result = formatDate(ts);
    expect(result).toContain('2025');
    expect(result).toContain('15');
  });

  it('should include time when requested', () => {
    const ts = new Date(2025, 5, 15, 14, 30, 0).getTime();
    const result = formatDate(ts, { includeTime: true });
    expect(result).toContain('2025');
  });

  it('should use relative formatting when requested', () => {
    const ts = Date.now() - 3600000; // 1 hour ago
    const result = formatDate(ts, { relative: true });
    expect(result).toContain('h ago');
  });
});

// ---------------------------------------------------------------------------
// formatRelativeDate
// ---------------------------------------------------------------------------

describe('formatRelativeDate', () => {
  it('should return "—" for falsy input', () => {
    expect(formatRelativeDate(null)).toBe('—');
    expect(formatRelativeDate(0)).toBe('—');
  });

  it('should return "just now" for very recent', () => {
    expect(formatRelativeDate(Date.now() - 5000)).toBe('just now');
  });

  it('should return minutes ago', () => {
    const result = formatRelativeDate(Date.now() - 5 * 60000);
    expect(result).toBe('5m ago');
  });

  it('should return hours ago', () => {
    const result = formatRelativeDate(Date.now() - 3 * 3600000);
    expect(result).toBe('3h ago');
  });

  it('should return days ago', () => {
    const result = formatRelativeDate(Date.now() - 2 * 86400000);
    expect(result).toBe('2d ago');
  });

  it('should return weeks ago', () => {
    const result = formatRelativeDate(Date.now() - 14 * 86400000);
    expect(result).toBe('2w ago');
  });

  it('should fall back to absolute date for >30 days', () => {
    const ts = Date.now() - 60 * 86400000;
    const result = formatRelativeDate(ts);
    // Should be an absolute date string, not a relative one
    expect(result).not.toContain('ago');
  });
});

// ---------------------------------------------------------------------------
// generateId
// ---------------------------------------------------------------------------

describe('generateId', () => {
  it('should generate a string with the given prefix', () => {
    const id = generateId('req-');
    expect(id).toMatch(/^req-/);
    expect(id.length).toBeGreaterThan(5);
  });

  it('should generate unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId('x-'));
    }
    expect(ids.size).toBe(100);
  });

  it('should work without prefix', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// US_STATES / US_STATE_NAMES constants
// ---------------------------------------------------------------------------

describe('US_STATES', () => {
  it('should include all 50 states + DC + territories', () => {
    expect(US_STATES).toContain('CO');
    expect(US_STATES).toContain('CA');
    expect(US_STATES).toContain('NY');
    expect(US_STATES).toContain('DC');
    expect(US_STATES).toContain('PR');
    expect(US_STATES.length).toBeGreaterThanOrEqual(51);
  });
});

describe('US_STATE_NAMES', () => {
  it('should map abbreviations to full names', () => {
    expect(US_STATE_NAMES.CO).toBe('Colorado');
    expect(US_STATE_NAMES.CA).toBe('California');
    expect(US_STATE_NAMES.NY).toBe('New York');
    expect(US_STATE_NAMES.DC).toBe('District of Columbia');
  });

  it('should have an entry for every state in US_STATES', () => {
    for (const code of US_STATES) {
      expect(US_STATE_NAMES[code]).toBeDefined();
    }
  });
});
