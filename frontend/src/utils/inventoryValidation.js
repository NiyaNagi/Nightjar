/**
 * inventoryValidation.js
 * 
 * Validation utilities for inventory requests and catalog items.
 * Used by SubmitRequest, CatalogManager, and ImportWizard.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §3.2 (CatalogItem constraints), §6.6.1 (form validation)
 */

/**
 * Validate a quantity against a catalog item's constraints.
 * @param {number} quantity - Requested quantity
 * @param {Object} catalogItem - Catalog item with min, max, step
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateQuantity(quantity, catalogItem) {
  if (quantity == null || isNaN(quantity)) {
    return { valid: false, error: 'Quantity is required' };
  }
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    return { valid: false, error: 'Quantity must be a positive whole number' };
  }
  const min = catalogItem.quantityMin || 1;
  const max = catalogItem.quantityMax != null ? catalogItem.quantityMax : Infinity;
  const step = catalogItem.quantityStep || 1;

  if (qty < min) {
    return { valid: false, error: `Minimum quantity is ${min}` };
  }
  if (qty > max) {
    return { valid: false, error: `Maximum quantity is ${max.toLocaleString()}` };
  }
  if (step > 1 && (qty - min) % step !== 0) {
    return { valid: false, error: `Quantity must be in multiples of ${step} (starting from ${min})` };
  }
  return { valid: true };
}

/**
 * Validate a US state abbreviation.
 * @param {string} state
 * @returns {boolean}
 */
export function isValidUSState(state) {
  return US_STATES.includes((state || '').toUpperCase().trim());
}

/**
 * Validate a shipping address object.
 * Supports US and international addresses with light validation.
 * @param {Object} address
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAddress(address) {
  const errors = [];
  if (!address) {
    return { valid: false, errors: ['Address is required'] };
  }
  // Accept both field naming conventions: recipientName/fullName/name, street1/line1
  const recipientName = address.recipientName || address.fullName || address.name;
  const street1 = address.street1 || address.line1;
  if (!recipientName?.trim()) errors.push('Recipient name is required');
  if (!street1?.trim()) errors.push('Street address is required');
  if (!address.city?.trim()) errors.push('City is required');

  const country = (address.country || 'US').toUpperCase();

  if (country === 'US') {
    // US-specific validation
    if (!address.state?.trim()) {
      errors.push('State is required');
    } else if (!isValidUSState(address.state)) {
      errors.push('Invalid US state abbreviation');
    }
    if (!address.zip?.trim()) {
      errors.push('ZIP code is required');
    } else if (!/^\d{5}(-\d{4})?$/.test(address.zip.trim())) {
      errors.push('ZIP code must be 5 digits (or ZIP+4 format)');
    }
  } else {
    // International: require state/province and postal code (any format)
    if (!address.state?.trim()) errors.push('State/Province is required');
    if (!address.zip?.trim()) errors.push('Postal code is required');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a catalog item before saving.
 * @param {Object} item
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCatalogItem(item) {
  const errors = [];
  if (!item.name?.trim()) errors.push('Item name is required');
  if (!item.unitName?.trim()) errors.push('Unit type is required (e.g., "units", "boxes", "lbs")');
  
  const min = Number(item.quantityMin);
  const max = item.quantityMax != null && item.quantityMax !== '' ? Number(item.quantityMax) : null;
  const step = Number(item.quantityStep);

  if (isNaN(min) || min < 1) errors.push('Minimum quantity must be at least 1');
  if (max !== null && (isNaN(max) || max < 1)) errors.push('Maximum quantity must be at least 1');
  if (max !== null && min > max) errors.push('Minimum quantity cannot exceed maximum');
  if (isNaN(step) || step < 1) errors.push('Step must be at least 1');

  return { valid: errors.length === 0, errors };
}

/**
 * Parse a date string into a timestamp. Handles common formats including Excel serial dates.
 * @param {string|number} dateStr - Date string (M/D/YYYY, YYYY-MM-DD, ISO, Excel serial number, etc.)
 * @returns {number|null} Timestamp or null if invalid
 */
export function parseDate(dateStr) {
  if (dateStr == null) return null;

  // Handle numeric values FIRST (Excel serial dates from SheetJS)
  // SheetJS converts date cells to serial numbers; handle them before string parsing
  // so that stringified serials like "46044" don't get misinterpreted by Date.parse.
  const numVal = typeof dateStr === 'number' ? dateStr : null;
  if (numVal != null && !isNaN(numVal) && numVal > 0 && numVal < 2958466) {
    const ms = (numVal - 25569) * 86400000;
    const d = new Date(ms);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100) {
      return d.getTime();
    }
  }

  // String-based formats
  if (typeof dateStr === 'string') {
    const str = dateStr.trim();
    if (!str) return null;

    // If the string is a pure number, treat it as an Excel serial date
    // (e.g., "46044" from SheetJS). Do NOT pass to Date.parse which
    // would interpret it as year 46044.
    if (/^\d+(\.\d+)?$/.test(str)) {
      const serial = Number(str);
      if (serial > 0 && serial < 2958466) {
        const ms = (serial - 25569) * 86400000;
        const d = new Date(ms);
        if (!isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100) {
          return d.getTime();
        }
      }
      return null;
    }

    // Try M/D/YYYY (Google Sheets / US format) — check before Date.parse
    // to avoid timezone issues with Date.parse
    const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdyMatch) {
      const d = new Date(+mdyMatch[3], +mdyMatch[1] - 1, +mdyMatch[2]);
      if (!isNaN(d.getTime())) return d.getTime();
    }

    // Try ISO / other standard formats via Date.parse
    const iso = Date.parse(str);
    if (!isNaN(iso)) {
      // Sanity check: reject results outside 1900–2100
      const d = new Date(iso);
      if (d.getFullYear() >= 1900 && d.getFullYear() <= 2100) {
        return iso;
      }
    }
  }

  return null;
}

/**
 * Format a timestamp as a human-readable date.
 * @param {number} timestamp
 * @param {Object} [options]
 * @returns {string}
 */
export function formatDate(timestamp, options = {}) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '—';
  
  const { includeTime = false, relative = false } = options;
  
  if (relative) {
    return formatRelativeDate(timestamp);
  }
  
  const dateOpts = { year: 'numeric', month: 'short', day: 'numeric' };
  if (includeTime) {
    dateOpts.hour = '2-digit';
    dateOpts.minute = '2-digit';
  }
  return date.toLocaleDateString('en-US', dateOpts);
}

/**
 * Format a timestamp as relative time (e.g., "2 days ago", "just now").
 * @param {number} timestamp
 * @returns {string}
 */
export function formatRelativeDate(timestamp) {
  if (!timestamp) return '—';
  const now = Date.now();
  const diff = now - timestamp;

  // Future dates or very old dates — show absolute date
  if (diff < 0) return formatDate(timestamp, { relative: false });

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDate(timestamp, { relative: false });
}

/**
 * Generate a unique ID for inventory entities.
 * @param {string} prefix - e.g., 'req-', 'cat-', 'inv-'
 * @returns {string}
 */
export function generateId(prefix = '') {
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const randomPart = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return prefix + Date.now().toString(36) + randomPart;
}

/**
 * All US state abbreviations.
 */
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
];

/**
 * Map of US state abbreviations to full names.
 */
export const US_STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', PR: 'Puerto Rico', VI: 'Virgin Islands', GU: 'Guam',
  AS: 'American Samoa', MP: 'Northern Mariana Islands',
};

/**
 * Common countries for the international address dropdown.
 */
export const COUNTRIES = [
  'US', 'CA', 'MX', 'GB', 'AU', 'DE', 'FR', 'JP', 'KR', 'BR',
  'IN', 'IT', 'ES', 'NL', 'SE', 'NO', 'DK', 'FI', 'PL', 'AT',
  'CH', 'BE', 'IE', 'NZ', 'SG', 'HK', 'TW', 'IL', 'ZA', 'AE',
  'CL', 'CO', 'AR', 'PH', 'TH', 'MY', 'ID', 'VN', 'CZ', 'PT',
];
