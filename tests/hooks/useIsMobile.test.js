/**
 * useIsMobile hook tests
 * 
 * Verifies the useIsMobile hook correctly detects mobile viewport widths
 * using window.matchMedia.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import useIsMobile from '../../frontend/src/hooks/useIsMobile';

// Store listeners for matchMedia mock
let mediaQueryListeners = [];
let currentMatches = false;

function createMockMatchMedia(matches) {
  currentMatches = matches;
  mediaQueryListeners = [];

  return jest.fn().mockImplementation((query) => ({
    matches: currentMatches,
    media: query,
    addEventListener: jest.fn((event, handler) => {
      if (event === 'change') mediaQueryListeners.push(handler);
    }),
    removeEventListener: jest.fn((event, handler) => {
      mediaQueryListeners = mediaQueryListeners.filter(h => h !== handler);
    }),
    addListener: jest.fn((handler) => {
      mediaQueryListeners.push(handler);
    }),
    removeListener: jest.fn((handler) => {
      mediaQueryListeners = mediaQueryListeners.filter(h => h !== handler);
    }),
    dispatchEvent: jest.fn(),
  }));
}

function triggerMediaChange(matches) {
  currentMatches = matches;
  mediaQueryListeners.forEach(fn => fn({ matches }));
}

describe('useIsMobile', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  test('returns true when viewport is at or below default breakpoint (768px)', () => {
    window.matchMedia = createMockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  test('returns false when viewport is above default breakpoint (768px)', () => {
    window.matchMedia = createMockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  test('accepts custom breakpoint', () => {
    window.matchMedia = createMockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile(480));
    expect(result.current).toBe(true);
    // Verify the query was constructed with the custom breakpoint
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 480px)');
  });

  test('updates reactively when viewport size changes', () => {
    window.matchMedia = createMockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Simulate viewport shrinking below breakpoint
    act(() => {
      triggerMediaChange(true);
    });
    expect(result.current).toBe(true);

    // Simulate viewport expanding above breakpoint
    act(() => {
      triggerMediaChange(false);
    });
    expect(result.current).toBe(false);
  });

  test('cleans up event listener on unmount', () => {
    const mockMql = {
      matches: false,
      media: '(max-width: 768px)',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    window.matchMedia = jest.fn().mockReturnValue(mockMql);

    const { unmount } = renderHook(() => useIsMobile());
    expect(mockMql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    unmount();
    expect(mockMql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
