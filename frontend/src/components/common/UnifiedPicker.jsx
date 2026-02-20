/**
 * UnifiedPicker Component
 *
 * A comprehensive emoji + color picker that replaces all bespoke icon/color
 * pickers across the app. Features an inline mini-strip for quick picks and
 * a full popover with a Teams-like emoji browser and expanded color palette.
 *
 * Backward-compatible API with the old IconColorPicker.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './UnifiedPicker.css';

import {
  EMOJI_DATA,
  EMOJI_CATEGORIES,
  ALL_ICONS,
  POPULAR_EMOJIS,
  PRESET_COLORS,
  PRESET_COLOR_HEXES,
  PRESET_ICONS,
} from './UnifiedPickerData';

// ---------------------------------------------------------------------------
// localStorage helpers for recent emojis
// ---------------------------------------------------------------------------
const LS_KEY = 'nightjar-recent-emojis';
const MAX_RECENT = 16;

function loadRecentEmojis() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.slice(0, MAX_RECENT);
    }
  } catch {
    // ignore corrupt data
  }
  return [];
}

function saveRecentEmojis(arr) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, MAX_RECENT)));
  } catch {
    // ignore quota errors
  }
}

function addRecentEmoji(emoji, prev) {
  const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, MAX_RECENT);
  saveRecentEmojis(next);
  return next;
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------
function UnifiedPicker({
  icon = '📁',
  color = '#6366f1',
  onIconChange,
  onColorChange,
  size = 'medium',
  disabled = false,
  compact = false,
  showStrip,             // deprecated — ignored (kept for backward compat)
  showColorPreview,      // deprecated — ignored
  mode = 'both',
}) {
  // Normalize falsy (null, undefined, '') → default (default params only catch undefined)
  color = color || '#6366f1';

  // ---- state ----
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState(EMOJI_CATEGORIES[0]);
  const [recentEmojis, setRecentEmojis] = useState(loadRecentEmojis);
  const [customColor, setCustomColor] = useState(color || '#6366f1');
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  // ---- refs ----
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const searchRef = useRef(null);
  const categoryTabsRef = useRef(null);

  // debounced search
  const debouncedSearch = useDebounce(searchText, 150);

  // sync customColor when prop changes externally
  useEffect(() => {
    setCustomColor(color || '#6366f1');
  }, [color]);

  // ---- position the portal popover near the trigger ----
  useEffect(() => {
    if (!isOpen || !triggerRef.current || compact) return;

    const updatePos = () => {
      const rect = triggerRef.current.getBoundingClientRect();
      const popW = 520;
      const gap = 8;
      let top = rect.bottom + gap;
      let left = rect.left;

      // Keep within viewport horizontally
      if (left + popW > window.innerWidth - gap) {
        left = window.innerWidth - popW - gap;
      }
      if (left < gap) left = gap;

      // Use actual popover height if rendered, else estimate
      const popH = popoverRef.current?.offsetHeight || 420;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;

      // Only flip above if popover doesn't fit below AND there's more room above
      if (popH > spaceBelow && spaceAbove > spaceBelow) {
        top = Math.max(gap, rect.top - popH - gap);
      }

      setPopoverPos({ top, left });
    };

    updatePos();
    // Re-measure after first paint (popover now in DOM → accurate height)
    const raf = requestAnimationFrame(updatePos);
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isOpen, compact]);

  // ---- click-outside to close (checks both trigger and portal popover) ----
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      const inTrigger = triggerRef.current?.contains(e.target);
      const inPopover = popoverRef.current?.contains(e.target);
      if (!inTrigger && !inPopover) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // ---- escape key ----
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  // ---- focus search when popover opens ----
  useEffect(() => {
    if (isOpen && searchRef.current) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [isOpen]);

  // ---- handlers ----
  const handleIconSelect = useCallback(
    (emoji) => {
      setRecentEmojis((prev) => addRecentEmoji(emoji, prev));
      onIconChange?.(emoji);
    },
    [onIconChange]
  );

  const handleColorSelect = useCallback(
    (hex) => {
      setCustomColor(hex);
      onColorChange?.(hex);
    },
    [onColorChange]
  );

  const handleCustomNativeColor = useCallback(
    (e) => {
      const hex = e.target.value;
      setCustomColor(hex);
      onColorChange?.(hex);
    },
    [onColorChange]
  );

  const handleCustomHexInput = useCallback(
    (e) => {
      const val = e.target.value;
      if (/^#[0-9a-fA-F]{0,6}$/.test(val) || val === '') {
        setCustomColor(val || '#');
        if (val.length === 7) {
          onColorChange?.(val);
        }
      }
    },
    [onColorChange]
  );

  const togglePopover = useCallback(() => {
    if (!disabled) setIsOpen((o) => !o);
  }, [disabled]);

  // ---- memoised search results ----
  const filteredEmojis = useMemo(() => {
    if (!debouncedSearch) return null;
    const q = debouncedSearch.toLowerCase();
    const results = [];
    for (const catKey of EMOJI_CATEGORIES) {
      for (const entry of EMOJI_DATA[catKey].emojis) {
        if (
          entry.emoji.includes(q) ||
          entry.keywords.some((kw) => kw.includes(q))
        ) {
          results.push(entry);
        }
      }
    }
    return results;
  }, [debouncedSearch]);

  // ---- scroll active category tab into view ----
  useEffect(() => {
    if (!categoryTabsRef.current) return;
    const active = categoryTabsRef.current.querySelector(
      '.unified-picker__cat-tab--active'
    );
    if (active) {
      active.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, [activeCategory]);

  // ---- emojis for active category ----
  const activeCategoryEmojis = useMemo(
    () => EMOJI_DATA[activeCategory]?.emojis || [],
    [activeCategory]
  );

  // ---- size modifier ----
  const sizeClass = `unified-picker--${size}`;

  // ---- mode helpers ----
  const showIcons = mode === 'both' || mode === 'icon';
  const showColors = mode === 'both' || mode === 'color';

  // ===========================================================================
  // POPOVER CONTENT (used by both portal and inline compact mode)
  // ===========================================================================
  const popoverContent = (
    <div
      ref={popoverRef}
      className={`unified-picker__popover ${compact ? 'unified-picker__popover--inline' : ''}`}
      style={!compact ? { top: popoverPos.top, left: popoverPos.left } : undefined}
      role="dialog"
      aria-label="Pick icon and color"
      data-testid="unified-picker-popover"
    >
      {/* Close button */}
      {!compact && (
        <button
          type="button"
          className="unified-picker__close"
          onClick={() => setIsOpen(false)}
          aria-label="Close picker"
          data-testid="unified-picker-close"
        >
          ✕
        </button>
      )}
      <div className="unified-picker__panes">
        {/* ====== EMOJI PANE (left, wider) ====== */}
        {showIcons && (
          <div className="unified-picker__emoji-pane">
            {/* header: search + category tabs */}
            <div className="unified-picker__emoji-header">
              {/* search */}
              <div className="unified-picker__search-wrap">
                <input
                  ref={searchRef}
                  type="text"
                  className="unified-picker__search"
                  placeholder="Search emoji…"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  aria-label="Search emoji"
                  data-testid="unified-picker-search"
                />
                {searchText && (
                  <button
                    type="button"
                    className="unified-picker__search-clear"
                    onClick={() => setSearchText('')}
                    aria-label="Clear search"
                    data-testid="unified-picker-search-clear"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* category tabs (hidden during search) */}
              {!debouncedSearch && (
                <div className="unified-picker__cat-tabs" ref={categoryTabsRef} data-testid="unified-picker-category-tabs">
                  {EMOJI_CATEGORIES.map((catKey) => (
                    <button
                      key={catKey}
                      type="button"
                      className={`unified-picker__cat-tab ${catKey === activeCategory ? 'unified-picker__cat-tab--active' : ''}`}
                      onClick={() => setActiveCategory(catKey)}
                      title={EMOJI_DATA[catKey].label}
                      data-testid={`unified-picker-cat-${catKey}`}
                    >
                      {EMOJI_DATA[catKey].icon}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* recently used (when NOT searching) */}
            {!debouncedSearch && recentEmojis.length > 0 && (
              <div className="unified-picker__recent" data-testid="unified-picker-recent">
                <div className="unified-picker__section-label">Recently Used</div>
                <div className="unified-picker__emoji-grid">
                  {recentEmojis.map((em, i) => (
                    <button
                      key={`recent-${em}-${i}`}
                      type="button"
                      className={`unified-picker__emoji-btn ${em === icon ? 'unified-picker__emoji-btn--selected' : ''}`}
                      onClick={() => handleIconSelect(em)}
                      title={em}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* emoji scroll area */}
            <div className="unified-picker__emoji-scroll" data-testid="unified-picker-emoji-scroll">
              {debouncedSearch ? (
                /* search results */
                filteredEmojis && filteredEmojis.length > 0 ? (
                  <div className="unified-picker__emoji-grid" data-testid="unified-picker-search-results">
                    {filteredEmojis.map((entry) => (
                      <button
                        key={entry.emoji}
                        type="button"
                        className={`unified-picker__emoji-btn ${entry.emoji === icon ? 'unified-picker__emoji-btn--selected' : ''}`}
                        onClick={() => handleIconSelect(entry.emoji)}
                        title={entry.keywords.join(', ')}
                      >
                        {entry.emoji}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="unified-picker__empty" data-testid="unified-picker-empty">No emoji found</div>
                )
              ) : (
                /* category grid */
                <div>
                  <div className="unified-picker__section-label">
                    {EMOJI_DATA[activeCategory].label}
                  </div>
                  <div className="unified-picker__emoji-grid" data-testid="unified-picker-category-grid">
                    {activeCategoryEmojis.map((entry) => (
                      <button
                        key={entry.emoji}
                        type="button"
                        className={`unified-picker__emoji-btn ${entry.emoji === icon ? 'unified-picker__emoji-btn--selected' : ''}`}
                        onClick={() => handleIconSelect(entry.emoji)}
                        title={entry.keywords.join(', ')}
                      >
                        {entry.emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ====== COLOR PANE (right, narrower) ====== */}
        {showColors && (
          <div className="unified-picker__color-pane">
            <div className="unified-picker__color-section" data-testid="unified-picker-color-section">
              <div className="unified-picker__section-label">Color</div>
              <div className="unified-picker__color-grid" data-testid="unified-picker-color-grid">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    className={`unified-picker__color-pill ${c.hex === color ? 'unified-picker__color-pill--selected' : ''} ${c.hex === '#ffffff' ? 'unified-picker__color-pill--white' : ''}`}
                    style={{ backgroundColor: c.hex }}
                    onClick={() => handleColorSelect(c.hex)}
                    title={c.name}
                    aria-label={`Select ${c.name} color`}
                  />
                ))}
              </div>

              {/* custom color */}
              <div className="unified-picker__custom-color" data-testid="unified-picker-custom-color">
                <span className="unified-picker__custom-label">Custom</span>
                <div className="unified-picker__custom-row">
                  <input
                    type="color"
                    className="unified-picker__native-color"
                    value={customColor && customColor.length === 7 ? customColor : '#6366f1'}
                    onChange={handleCustomNativeColor}
                    aria-label="Pick custom color"
                    data-testid="unified-picker-native-color"
                  />
                  <input
                    type="text"
                    className="unified-picker__hex-input"
                  value={customColor || '#'}
                    onChange={handleCustomHexInput}
                    maxLength={7}
                    placeholder="#6366f1"
                    aria-label="Hex color code"
                    data-testid="unified-picker-hex-input"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ===========================================================================
  // RENDER
  // ===========================================================================
  return (
    <div
      className={`unified-picker ${sizeClass} ${compact ? 'unified-picker--compact' : ''} ${disabled ? 'unified-picker--disabled' : ''}`}
      data-testid="unified-picker"
    >
      {/* ---- PREVIEW BUBBLE TRIGGER ---- */}
      {!compact && (
        <button
          ref={triggerRef}
          type="button"
          className="unified-picker__bubble"
          style={{ backgroundColor: color }}
          onClick={togglePopover}
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          title="Change icon and color"
          data-testid="unified-picker-trigger"
        >
          <span className="unified-picker__bubble-icon">{icon}</span>
        </button>
      )}

      {/* ---- POPOVER ---- */}
      {(isOpen || compact) && (
        compact
          ? popoverContent
          : createPortal(popoverContent, document.body)
      )}
    </div>
  );
}

export default UnifiedPicker;

export {
  EMOJI_DATA,
  PRESET_COLORS,
  PRESET_COLOR_HEXES,
  ALL_ICONS,
  EMOJI_CATEGORIES,
  PRESET_ICONS,
  POPULAR_EMOJIS,
};
