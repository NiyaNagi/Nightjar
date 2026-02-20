/**
 * UnifiedPicker Component — Comprehensive Test Suite
 *
 * Tests cover:
 * - Rendering (default, sizes, disabled, compact, bubble trigger)
 * - Emoji browsing (category tabs, scrolling, selection, recent tracking)
 * - Search (filtering, empty state, clear, debounce)
 * - Color selection (preset palette, custom hex, native picker)
 * - Popover lifecycle (open, close, Escape, click-outside)
 * - Mode prop (both, icon, color)
 * - Exported constants (EMOJI_DATA, PRESET_COLORS, ALL_ICONS, etc.)
 * - Backward-compat exports (PRESET_ICONS)
 * - Edge cases (disabled interactions, rapid clicks, empty strings)
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import UnifiedPicker, {
  EMOJI_DATA,
  PRESET_COLORS,
  PRESET_COLOR_HEXES,
  ALL_ICONS,
  EMOJI_CATEGORIES,
  PRESET_ICONS,
  POPULAR_EMOJIS,
} from '../../../frontend/src/components/common/UnifiedPicker';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, val) => { store[key] = val; }),
    removeItem: jest.fn((key) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
  };
})();

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
  localStorageMock.clear();
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// helper — advance timers + flush React state
function advanceTimersAndFlush(ms = 200) {
  act(() => { jest.advanceTimersByTime(ms); });
}

// helper — open popover on the default (strip) trigger
async function openPopover() {
  fireEvent.click(screen.getByTestId('unified-picker-trigger'));
  advanceTimersAndFlush();
}

// ============================================================
// 1. RENDERING
// ============================================================
describe('Rendering', () => {
  test('renders with data-testid', () => {
    render(<UnifiedPicker />);
    expect(screen.getByTestId('unified-picker')).toBeInTheDocument();
  });

  test('renders trigger with default icon 📁 and default color', () => {
    render(<UnifiedPicker />);
    const trigger = screen.getByTestId('unified-picker-trigger');
    expect(trigger).toHaveTextContent('📁');
    expect(trigger).toHaveStyle({ backgroundColor: '#6366f1' });
  });

  test('renders with custom icon and color', () => {
    render(<UnifiedPicker icon="🔥" color="#ef4444" />);
    const trigger = screen.getByTestId('unified-picker-trigger');
    expect(trigger).toHaveTextContent('🔥');
    expect(trigger).toHaveStyle({ backgroundColor: '#ef4444' });
  });

  test('size="small" applies correct class', () => {
    const { container } = render(<UnifiedPicker size="small" />);
    expect(container.querySelector('.unified-picker--small')).toBeInTheDocument();
  });

  test('size="large" applies correct class', () => {
    const { container } = render(<UnifiedPicker size="large" />);
    expect(container.querySelector('.unified-picker--large')).toBeInTheDocument();
  });

  test('disabled state disables trigger', () => {
    render(<UnifiedPicker disabled />);
    expect(screen.getByTestId('unified-picker-trigger')).toBeDisabled();
  });

  test('compact mode renders inline popover immediately', () => {
    render(<UnifiedPicker compact />);
    expect(screen.getByTestId('unified-picker-popover')).toBeInTheDocument();
  });
});

// ============================================================
// 2. POPOVER LIFECYCLE
// ============================================================
describe('Popover lifecycle', () => {
  test('trigger click opens popover', () => {
    render(<UnifiedPicker />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openPopover();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('trigger click toggles popover', () => {
    render(<UnifiedPicker />);
    const trigger = screen.getByTestId('unified-picker-trigger');
    fireEvent.click(trigger);
    advanceTimersAndFlush();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(trigger);
    advanceTimersAndFlush();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('Escape key closes popover', () => {
    render(<UnifiedPicker />);
    openPopover();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    advanceTimersAndFlush();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('click outside closes popover', () => {
    render(<UnifiedPicker />);
    openPopover();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    advanceTimersAndFlush();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('disabled prevents popover from opening', () => {
    render(<UnifiedPicker disabled />);
    fireEvent.click(screen.getByTestId('unified-picker-trigger'));
    advanceTimersAndFlush();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ============================================================
// 3. EMOJI BROWSING
// ============================================================
describe('Emoji browsing', () => {
  test('popover shows category tabs', () => {
    render(<UnifiedPicker />);
    openPopover();
    expect(screen.getByTestId('unified-picker-category-tabs')).toBeInTheDocument();
    // Should have one tab per category
    EMOJI_CATEGORIES.forEach((cat) => {
      expect(screen.getByTestId(`unified-picker-cat-${cat}`)).toBeInTheDocument();
    });
  });

  test('first category (smileys) is active by default', () => {
    render(<UnifiedPicker />);
    openPopover();
    const tab = screen.getByTestId('unified-picker-cat-smileys');
    expect(tab.classList.contains('unified-picker__cat-tab--active')).toBe(true);
  });

  test('clicking a category tab switches the grid', () => {
    render(<UnifiedPicker />);
    openPopover();

    const animalsTab = screen.getByTestId('unified-picker-cat-animals');
    fireEvent.click(animalsTab);
    advanceTimersAndFlush();

    expect(animalsTab.classList.contains('unified-picker__cat-tab--active')).toBe(true);
    // smileys tab should no longer be active
    expect(
      screen.getByTestId('unified-picker-cat-smileys').classList.contains('unified-picker__cat-tab--active')
    ).toBe(false);
  });

  test('emoji grid displays category emojis', () => {
    render(<UnifiedPicker />);
    openPopover();

    const grid = screen.getByTestId('unified-picker-category-grid');
    const btns = grid.querySelectorAll('.unified-picker__emoji-btn');
    expect(btns.length).toBe(EMOJI_DATA.smileys.emojis.length);
  });

  test('clicking an emoji calls onIconChange', () => {
    const onIconChange = jest.fn();
    render(<UnifiedPicker onIconChange={onIconChange} />);
    openPopover();

    const grid = screen.getByTestId('unified-picker-category-grid');
    const firstBtn = grid.querySelector('.unified-picker__emoji-btn');
    fireEvent.click(firstBtn);

    expect(onIconChange).toHaveBeenCalledWith(EMOJI_DATA.smileys.emojis[0].emoji);
  });

  test('selecting an emoji adds it to recents in localStorage', () => {
    const onIconChange = jest.fn();
    render(<UnifiedPicker onIconChange={onIconChange} />);
    openPopover();

    const grid = screen.getByTestId('unified-picker-category-grid');
    const firstBtn = grid.querySelector('.unified-picker__emoji-btn');
    fireEvent.click(firstBtn);

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'nightjar-recent-emojis',
      expect.any(String)
    );
    const stored = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
    expect(stored[0]).toBe(EMOJI_DATA.smileys.emojis[0].emoji);
  });

  test('recently used emojis appear in recents section after selection', () => {
    // Pre-seed recents
    localStorageMock.setItem('nightjar-recent-emojis', JSON.stringify(['🔥', '🚀', '💎']));

    // Re-render picks up seeded data
    render(<UnifiedPicker />);
    openPopover();

    const recent = screen.getByTestId('unified-picker-recent');
    expect(recent).toBeInTheDocument();
    expect(recent.textContent).toContain('🔥');
  });

  test('selected emoji gets --selected class in grid', () => {
    render(<UnifiedPicker icon="😀" />);
    openPopover();

    const grid = screen.getByTestId('unified-picker-category-grid');
    const selected = grid.querySelector('.unified-picker__emoji-btn--selected');
    expect(selected).toBeInTheDocument();
    expect(selected.textContent).toBe('😀');
  });
});

// ============================================================
// 4. SEARCH
// ============================================================
describe('Search', () => {
  test('search input is present in popover', () => {
    render(<UnifiedPicker />);
    openPopover();
    expect(screen.getByTestId('unified-picker-search')).toBeInTheDocument();
  });

  test('typing in search filters emojis (debounced)', () => {
    render(<UnifiedPicker />);
    openPopover();

    fireEvent.change(screen.getByTestId('unified-picker-search'), {
      target: { value: 'rocket' },
    });
    // Before debounce — category tabs should still show
    expect(screen.getByTestId('unified-picker-category-tabs')).toBeInTheDocument();

    // After debounce
    advanceTimersAndFlush(200);
    expect(screen.queryByTestId('unified-picker-category-tabs')).not.toBeInTheDocument();
    expect(screen.getByTestId('unified-picker-search-results')).toBeInTheDocument();
    const btns = screen.getByTestId('unified-picker-search-results')
      .querySelectorAll('.unified-picker__emoji-btn');
    expect(btns.length).toBeGreaterThan(0);
    // Should find the rocket emoji
    expect([...btns].some((b) => b.textContent === '🚀')).toBe(true);
  });

  test('search with no matches shows empty state', () => {
    render(<UnifiedPicker />);
    openPopover();
    fireEvent.change(screen.getByTestId('unified-picker-search'), {
      target: { value: 'zzzzxyznonexistent' },
    });
    advanceTimersAndFlush(200);
    expect(screen.getByTestId('unified-picker-empty')).toBeInTheDocument();
    expect(screen.getByText('No emoji found')).toBeInTheDocument();
  });

  test('clear button resets search', () => {
    render(<UnifiedPicker />);
    openPopover();
    fireEvent.change(screen.getByTestId('unified-picker-search'), {
      target: { value: 'fire' },
    });
    advanceTimersAndFlush(200);
    expect(screen.getByTestId('unified-picker-search-clear')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('unified-picker-search-clear'));
    advanceTimersAndFlush();
    expect(screen.getByTestId('unified-picker-search').value).toBe('');
    // Category tabs should reappear
    expect(screen.getByTestId('unified-picker-category-tabs')).toBeInTheDocument();
  });

  test('search results show keyword-matching emojis across all categories', () => {
    render(<UnifiedPicker />);
    openPopover();
    fireEvent.change(screen.getByTestId('unified-picker-search'), {
      target: { value: 'heart' },
    });
    advanceTimersAndFlush(200);
    const results = screen.getByTestId('unified-picker-search-results')
      .querySelectorAll('.unified-picker__emoji-btn');
    // Should find hearts from symbols category (❤️, 🧡, 💛, etc.)
    expect(results.length).toBeGreaterThanOrEqual(6);
  });
});

// ============================================================
// 5. COLOR SELECTION
// ============================================================
describe('Color selection', () => {
  test('popover shows all 30 preset colors', () => {
    render(<UnifiedPicker />);
    openPopover();
    const grid = screen.getByTestId('unified-picker-color-grid');
    const pills = grid.querySelectorAll('.unified-picker__color-pill');
    expect(pills.length).toBe(30);
  });

  test('clicking a color pill calls onColorChange', () => {
    const onColorChange = jest.fn();
    render(<UnifiedPicker onColorChange={onColorChange} />);
    openPopover();
    const grid = screen.getByTestId('unified-picker-color-grid');
    const pills = grid.querySelectorAll('.unified-picker__color-pill');
    fireEvent.click(pills[2]); // third color
    expect(onColorChange).toHaveBeenCalledWith(PRESET_COLORS[2].hex);
  });

  test('selected color has --selected class', () => {
    render(<UnifiedPicker color="#ef4444" />);
    openPopover();
    const grid = screen.getByTestId('unified-picker-color-grid');
    const selected = grid.querySelector('.unified-picker__color-pill--selected');
    expect(selected).toBeInTheDocument();
    expect(selected).toHaveStyle({ backgroundColor: '#ef4444' });
  });

  test('white pill gets --white modifier class', () => {
    render(<UnifiedPicker />);
    openPopover();
    const grid = screen.getByTestId('unified-picker-color-grid');
    const white = grid.querySelector('.unified-picker__color-pill--white');
    expect(white).toBeInTheDocument();
  });

  test('custom color hex input present', () => {
    render(<UnifiedPicker />);
    openPopover();
    expect(screen.getByTestId('unified-picker-hex-input')).toBeInTheDocument();
  });

  test('typing a valid 7-char hex fires onColorChange', () => {
    const onColorChange = jest.fn();
    render(<UnifiedPicker onColorChange={onColorChange} />);
    openPopover();
    fireEvent.change(screen.getByTestId('unified-picker-hex-input'), {
      target: { value: '#aabbcc' },
    });
    expect(onColorChange).toHaveBeenCalledWith('#aabbcc');
  });

  test('typing partial hex does NOT fire onColorChange', () => {
    const onColorChange = jest.fn();
    render(<UnifiedPicker onColorChange={onColorChange} />);
    openPopover();
    fireEvent.change(screen.getByTestId('unified-picker-hex-input'), {
      target: { value: '#aab' },
    });
    expect(onColorChange).not.toHaveBeenCalled();
  });

  test('invalid hex string is rejected', () => {
    const onColorChange = jest.fn();
    render(<UnifiedPicker onColorChange={onColorChange} />);
    openPopover();
    const input = screen.getByTestId('unified-picker-hex-input');
    fireEvent.change(input, { target: { value: '#xyz' } });
    expect(onColorChange).not.toHaveBeenCalled();
  });

  test('native color input calls onColorChange', () => {
    const onColorChange = jest.fn();
    render(<UnifiedPicker onColorChange={onColorChange} />);
    openPopover();
    fireEvent.change(screen.getByTestId('unified-picker-native-color'), {
      target: { value: '#112233' },
    });
    expect(onColorChange).toHaveBeenCalledWith('#112233');
  });
});

// ============================================================
// 6. MODE PROP
// ============================================================
describe('Mode prop', () => {
  test('mode="both" (default) shows emoji and color sections', () => {
    render(<UnifiedPicker compact />);
    expect(screen.getByTestId('unified-picker-emoji-scroll')).toBeInTheDocument();
    expect(screen.getByTestId('unified-picker-color-section')).toBeInTheDocument();
  });

  test('mode="icon" hides color section', () => {
    render(<UnifiedPicker compact mode="icon" />);
    expect(screen.getByTestId('unified-picker-emoji-scroll')).toBeInTheDocument();
    expect(screen.queryByTestId('unified-picker-color-section')).not.toBeInTheDocument();
  });

  test('mode="color" hides emoji section', () => {
    render(<UnifiedPicker compact mode="color" />);
    expect(screen.queryByTestId('unified-picker-emoji-scroll')).not.toBeInTheDocument();
    expect(screen.getByTestId('unified-picker-color-section')).toBeInTheDocument();
  });
});

// ============================================================
// 7. EXPORTED CONSTANTS
// ============================================================
describe('Exported constants', () => {
  test('EMOJI_DATA has 10 categories', () => {
    expect(Object.keys(EMOJI_DATA).length).toBe(10);
  });

  test('every category has label, icon, and emojis array', () => {
    for (const key of Object.keys(EMOJI_DATA)) {
      expect(EMOJI_DATA[key]).toHaveProperty('label');
      expect(EMOJI_DATA[key]).toHaveProperty('icon');
      expect(Array.isArray(EMOJI_DATA[key].emojis)).toBe(true);
      expect(EMOJI_DATA[key].emojis.length).toBeGreaterThan(0);
    }
  });

  test('every emoji entry has emoji string and keywords array', () => {
    for (const key of Object.keys(EMOJI_DATA)) {
      for (const entry of EMOJI_DATA[key].emojis) {
        expect(typeof entry.emoji).toBe('string');
        expect(Array.isArray(entry.keywords)).toBe(true);
        expect(entry.keywords.length).toBeGreaterThan(0);
      }
    }
  });

  test('EMOJI_CATEGORIES matches EMOJI_DATA keys', () => {
    expect(EMOJI_CATEGORIES).toEqual(Object.keys(EMOJI_DATA));
  });

  test('ALL_ICONS is flat array of all emoji strings', () => {
    const expected = EMOJI_CATEGORIES.flatMap((cat) =>
      EMOJI_DATA[cat].emojis.map((e) => e.emoji)
    );
    expect(ALL_ICONS).toEqual(expected);
  });

  test('ALL_ICONS has 500+ emojis', () => {
    expect(ALL_ICONS.length).toBeGreaterThan(500);
  });

  test('PRESET_COLORS has 30 entries with hex and name', () => {
    expect(PRESET_COLORS.length).toBe(30);
    for (const c of PRESET_COLORS) {
      expect(c.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(typeof c.name).toBe('string');
    }
  });

  test('PRESET_COLOR_HEXES matches PRESET_COLORS hex values', () => {
    expect(PRESET_COLOR_HEXES).toEqual(PRESET_COLORS.map((c) => c.hex));
  });

  test('POPULAR_EMOJIS has 16 entries', () => {
    expect(POPULAR_EMOJIS.length).toBe(16);
  });
});

// ============================================================
// 8. BACKWARD-COMPAT EXPORTS
// ============================================================
describe('Backward-compat PRESET_ICONS', () => {
  test('PRESET_ICONS has expected category keys', () => {
    expect(PRESET_ICONS).toHaveProperty('folders');
    expect(PRESET_ICONS).toHaveProperty('documents');
    expect(PRESET_ICONS).toHaveProperty('work');
    expect(PRESET_ICONS).toHaveProperty('creative');
    expect(PRESET_ICONS).toHaveProperty('nature');
    expect(PRESET_ICONS).toHaveProperty('tech');
    expect(PRESET_ICONS).toHaveProperty('objects');
    expect(PRESET_ICONS).toHaveProperty('symbols');
  });

  test('each PRESET_ICONS category has 8 emoji strings', () => {
    for (const key of Object.keys(PRESET_ICONS)) {
      expect(PRESET_ICONS[key].length).toBe(8);
      for (const emoji of PRESET_ICONS[key]) {
        expect(typeof emoji).toBe('string');
      }
    }
  });
});

// ============================================================
// 9. EDGE CASES
// ============================================================
describe('Edge cases', () => {
  test('no crash when onIconChange is undefined', () => {
    render(<UnifiedPicker />);
    openPopover();
    const grid = screen.getByTestId('unified-picker-category-grid');
    expect(() => fireEvent.click(grid.querySelector('.unified-picker__emoji-btn'))).not.toThrow();
  });

  test('no crash when onColorChange is undefined', () => {
    render(<UnifiedPicker />);
    openPopover();
    const grid = screen.getByTestId('unified-picker-color-grid');
    expect(() => fireEvent.click(grid.querySelector('.unified-picker__color-pill'))).not.toThrow();
  });

  test('accepts showColorPreview prop without error (backward compat no-op)', () => {
    expect(() => render(<UnifiedPicker showColorPreview={false} />)).not.toThrow();
  });

  test('corrupted localStorage recents does not crash', () => {
    localStorageMock.getItem.mockReturnValueOnce('not-json{{{');
    expect(() => render(<UnifiedPicker />)).not.toThrow();
  });

  test('empty search text shows category grid (not search results)', () => {
    render(<UnifiedPicker />);
    openPopover();
    fireEvent.change(screen.getByTestId('unified-picker-search'), {
      target: { value: '' },
    });
    advanceTimersAndFlush(200);
    expect(screen.getByTestId('unified-picker-category-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('unified-picker-category-grid')).toBeInTheDocument();
  });

  test('rapid emoji selection still calls onIconChange each time', () => {
    const onIconChange = jest.fn();
    render(<UnifiedPicker onIconChange={onIconChange} />);
    openPopover();
    const grid = screen.getByTestId('unified-picker-category-grid');
    const btns = grid.querySelectorAll('.unified-picker__emoji-btn');
    fireEvent.click(btns[0]);
    fireEvent.click(btns[1]);
    fireEvent.click(btns[2]);
    expect(onIconChange).toHaveBeenCalledTimes(3);
  });

  test('color prop change syncs customColor input', () => {
    const { rerender } = render(<UnifiedPicker color="#aabbcc" compact />);
    const hexInput = screen.getByTestId('unified-picker-hex-input');
    expect(hexInput.value).toBe('#aabbcc');

    rerender(<UnifiedPicker color="#112233" compact />);
    expect(hexInput.value).toBe('#112233');
  });
});
