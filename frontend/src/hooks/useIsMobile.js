/**
 * useIsMobile — media-query-based mobile viewport detection hook.
 *
 * Uses `window.matchMedia` to reactively detect mobile viewports (≤768px).
 * Unlike `useEnvironment().isMobile` (which only detects Capacitor native),
 * this works for all browsers/web views.
 *
 * @param {number} [breakpoint=768] - Max-width breakpoint in px
 * @returns {boolean} true when viewport width ≤ breakpoint
 */

import { useState, useEffect } from 'react';

export default function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint}px)`;

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const handler = (e) => setIsMobile(e.matches);

    // Modern browsers
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    // Safari < 14 fallback
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [query]);

  return isMobile;
}
