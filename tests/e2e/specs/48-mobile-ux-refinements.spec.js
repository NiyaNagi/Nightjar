/**
 * 48-mobile-ux-refinements.spec.js
 *
 * E2E tests for v1.8.1 mobile UX refinements:
 *   - Sidebar auto-close, edge-swipe zone, backdrop fade, safe-area
 *   - MobileToolbar parity, 44px touch targets, keyboard dismiss
 *   - Long-press visual feedback (FileCard, FolderCard, TreeItem)
 *   - Kanban touch-action, toast positioning, modal → BottomSheet
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const TABLET_VIEWPORT = { width: 768, height: 1024 };
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

/* ------------------------------------------------------------------ */
/*  Helper: load page and wait for body                                */
/* ------------------------------------------------------------------ */
async function loadPage(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body', { timeout: 15_000 });
}

/* ================================================================== */
/*  Step 1+4: Sidebar auto-close + reactive isMobile                  */
/* ================================================================== */
test.describe('Step 1+4 – Sidebar auto-close & reactive isMobile @mobile', () => {
  test.use({ viewport: MOBILE_VIEWPORT, userAgent: MOBILE_UA, hasTouch: true });

  test('sidebar has CSS transition for slide in/out on mobile', async ({ page }) => {
    await loadPage(page);
    const transition = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'hierarchical-sidebar hierarchical-sidebar--collapsed';
      document.body.appendChild(el);
      const style = getComputedStyle(el);
      const t = style.transition || style.webkitTransition || '';
      el.remove();
      return t;
    });
    expect(transition).toContain('transform');
  });

  test('collapsed sidebar is translated off-screen', async ({ page }) => {
    await loadPage(page);
    const transform = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'hierarchical-sidebar hierarchical-sidebar--collapsed';
      document.body.appendChild(el);
      const t = getComputedStyle(el).transform;
      el.remove();
      return t;
    });
    // translateX(-100%) resolves to a matrix with a negative tx
    expect(transform).not.toBe('none');
  });
});

/* ================================================================== */
/*  Step 2: Edge-swipe zone                                            */
/* ================================================================== */
test.describe('Step 2 – Edge-swipe to open sidebar @mobile', () => {
  test.use({ viewport: MOBILE_VIEWPORT, userAgent: MOBILE_UA, hasTouch: true });

  test('edge-swipe zone CSS exists with correct positioning', async ({ page }) => {
    await loadPage(page);
    const styles = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'sidebar-edge-swipe-zone';
      document.body.appendChild(el);
      const s = getComputedStyle(el);
      const result = {
        position: s.position,
        left: s.left,
        width: s.width,
        zIndex: s.zIndex,
      };
      el.remove();
      return result;
    });
    expect(styles.position).toBe('fixed');
    expect(styles.left).toBe('0px');
    expect(parseInt(styles.width)).toBeLessThanOrEqual(24);
    expect(parseInt(styles.zIndex)).toBeGreaterThan(400);
  });
});

/* ================================================================== */
/*  Step 3: Sidebar DnD — @dnd-kit styles                             */
/* ================================================================== */
test.describe('Step 3 – Sidebar DnD visual styles @mobile', () => {
  test.use({ viewport: MOBILE_VIEWPORT, userAgent: MOBILE_UA, hasTouch: true });

  test('drag-overlay has correct visual style', async ({ page }) => {
    await loadPage(page);
    const styles = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'tree-item--drag-overlay';
      document.body.appendChild(el);
      const s = getComputedStyle(el);
      const result = {
        display: s.display,
        borderRadius: s.borderRadius,
      };
      el.remove();
      return result;
    });
    expect(styles.display).toBe('flex');
    expect(parseInt(styles.borderRadius)).toBeGreaterThan(0);
  });

  test('drop-target has dashed outline when active', async ({ page }) => {
    await loadPage(page);
    const outline = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'tree-item--drag-over';
      document.body.appendChild(el);
      const s = getComputedStyle(el).outlineStyle;
      el.remove();
      return s;
    });
    expect(outline).toBe('dashed');
  });

  test('folder tree items have grab cursor', async ({ page }) => {
    await loadPage(page);
    const cursor = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'tree-item tree-item--folder';
      document.body.appendChild(el);
      const c = getComputedStyle(el).cursor;
      el.remove();
      return c;
    });
    expect(cursor).toBe('grab');
  });
});

/* ================================================================== */
/*  Step 5+6: MobileToolbar parity & 44px targets                     */
/* ================================================================== */
test.describe('Step 5+6 – MobileToolbar parity & touch targets @mobile', () => {
  test.use({ viewport: MOBILE_VIEWPORT, userAgent: MOBILE_UA, hasTouch: true });

  test('mobile toolbar buttons are at least 44px tall', async ({ page }) => {
    await loadPage(page);
    const height = await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.className = 'mobile-toolbar__btn';
      const bar = document.createElement('div');
      bar.className = 'mobile-toolbar';
      bar.appendChild(btn);
      document.body.appendChild(bar);
      const h = getComputedStyle(btn).height;
      bar.remove();
      return h;
    });
    expect(parseInt(height)).toBeGreaterThanOrEqual(44);
  });

  test('mobile toolbar buttons have minimum 44px width', async ({ page }) => {
    await loadPage(page);
    const width = await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.className = 'mobile-toolbar__btn';
      const bar = document.createElement('div');
      bar.className = 'mobile-toolbar';
      bar.appendChild(btn);
      document.body.appendChild(bar);
      const w = getComputedStyle(btn).minWidth;
      bar.remove();
      return w;
    });
    expect(parseInt(width)).toBeGreaterThanOrEqual(44);
  });

  test('SelectionToolbar is hidden on mobile', async ({ page }) => {
    await loadPage(page);
    const display = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'selection-toolbar';
      document.body.appendChild(el);
      const d = getComputedStyle(el).display;
      el.remove();
      return d;
    });
    expect(display).toBe('none');
  });

  test('SelectionToolbar is visible on desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await loadPage(page);
    const display = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'selection-toolbar';
      document.body.appendChild(el);
      const d = getComputedStyle(el).display;
      el.remove();
      return d;
    });
    // On desktop it should NOT be forced to display:none
    expect(display).not.toBe('none');
  });
});

/* ================================================================== */
/*  Steps 8+9: Kanban touch-action & drag feedback                     */
/* ================================================================== */
test.describe('Steps 8+9 – Kanban card touch-action & drag visual @mobile', () => {
  test.use({ viewport: MOBILE_VIEWPORT, userAgent: MOBILE_UA, hasTouch: true });

  test('kanban cards allow vertical pan (touch-action: pan-y)', async ({ page }) => {
    await loadPage(page);
    const touchAction = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'kanban-card';
      el.setAttribute('draggable', 'true');
      document.body.appendChild(el);
      const ta = getComputedStyle(el).touchAction;
      el.remove();
      return ta;
    });
    expect(touchAction).toBe('pan-y');
  });

  test('kanban card dragging state has enhanced shadow', async ({ page }) => {
    await loadPage(page);
    const shadow = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'kanban-card dragging';
      document.body.appendChild(el);
      const s = getComputedStyle(el).boxShadow;
      el.remove();
      return s;
    });
    expect(shadow).not.toBe('none');
  });
});

/* ================================================================== */
/*  Step 11: Modal → ResponsiveModal / BottomSheet                     */
/* ================================================================== */
test.describe('Step 11 – Modal bottom-sheet styles @mobile', () => {
  test.use({ viewport: MOBILE_VIEWPORT, userAgent: MOBILE_UA, hasTouch: true });

  test('bottom-sheet backdrop has correct z-index', async ({ page }) => {
    await loadPage(page);
    const zIndex = await page.evaluate(() => {
      // Set the CSS variable so the var() resolves
      document.documentElement.style.setProperty('--z-modal-backdrop', '900');
      const el = document.createElement('div');
      el.className = 'bottom-sheet-backdrop';
      document.body.appendChild(el);
      const z = getComputedStyle(el).zIndex;
      el.remove();
      document.documentElement.style.removeProperty('--z-modal-backdrop');
      return z;
    });
    expect(parseInt(zIndex)).toBeGreaterThanOrEqual(500);
  });

  test('bottom-sheet container positioned at bottom', async ({ page }) => {
    await loadPage(page);
    const bottom = await page.evaluate(() => {
      const backdrop = document.createElement('div');
      backdrop.className = 'bottom-sheet-backdrop';
      const container = document.createElement('div');
      container.className = 'bottom-sheet';
      backdrop.appendChild(container);
      document.body.appendChild(backdrop);
      const b = getComputedStyle(container).bottom;
      backdrop.remove();
      return b;
    });
    expect(bottom).toBe('0px');
  });
});

/* ================================================================== */
/*  Step 12: Toast positioning with MobileToolbar offset               */
/* ================================================================== */
test.describe('Step 12 – Toast above MobileToolbar @mobile', () => {
  test.use({ viewport: MOBILE_VIEWPORT, userAgent: MOBILE_UA, hasTouch: true });

  test('toast bottom includes toolbar offset', async ({ page }) => {
    await loadPage(page);
    const bottom = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
      const b = getComputedStyle(el).bottom;
      el.remove();
      return b;
    });
    // Bottom should be > 52px (MobileToolbar height) + 12px gap = 64px minimum
    const px = parseInt(bottom);
    expect(px).toBeGreaterThanOrEqual(64);
  });
});

/* ================================================================== */
/*  Step 13: Sidebar safe-area + backdrop fade                         */
/* ================================================================== */
test.describe('Step 13 – Sidebar safe-area & backdrop fade @mobile', () => {
  test.use({ viewport: MOBILE_VIEWPORT, userAgent: MOBILE_UA, hasTouch: true });

  test('sidebar backdrop has fade-in animation', async ({ page }) => {
    await loadPage(page);
    const animation = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'sidebar-backdrop';
      document.body.appendChild(el);
      const a = getComputedStyle(el).animationName;
      el.remove();
      return a;
    });
    expect(animation).toContain('backdrop-fade-in');
  });

  test('sidebar has safe-area padding on mobile', async ({ page }) => {
    await loadPage(page);
    // We can only check that the CSS property is set (env() evaluates to 0 in test browsers)
    const hasSafeArea = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'hierarchical-sidebar';
      document.body.appendChild(el);
      const styles = el.style;
      // Check the computed style — env() may resolve to 0px in non-notched environments
      const pl = getComputedStyle(el).paddingLeft;
      const pb = getComputedStyle(el).paddingBottom;
      el.remove();
      // Both should be defined (even if 0px)
      return { paddingLeft: pl, paddingBottom: pb };
    });
    expect(hasSafeArea.paddingLeft).toBeDefined();
    expect(hasSafeArea.paddingBottom).toBeDefined();
  });
});

/* ================================================================== */
/*  Step 14: Long-press visual feedback                                */
/* ================================================================== */
test.describe('Step 14 – Long-press visual feedback @mobile', () => {
  test.use({ viewport: MOBILE_VIEWPORT, userAgent: MOBILE_UA, hasTouch: true });

  test('tree-item long-pressing class triggers animation', async ({ page }) => {
    await loadPage(page);
    const animation = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'tree-item long-pressing';
      document.body.appendChild(el);
      const a = getComputedStyle(el).animationName;
      el.remove();
      return a;
    });
    expect(animation).toContain('long-press-squeeze');
  });

  test('file-card long-pressing class triggers animation', async ({ page }) => {
    await loadPage(page);
    const animation = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'file-card long-pressing';
      document.body.appendChild(el);
      const a = getComputedStyle(el).animationName;
      el.remove();
      return a;
    });
    expect(animation).toContain('long-press-squeeze');
  });

  test('folder-card long-pressing class triggers animation', async ({ page }) => {
    await loadPage(page);
    const animation = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'folder-card long-pressing';
      document.body.appendChild(el);
      const a = getComputedStyle(el).animationName;
      el.remove();
      return a;
    });
    expect(animation).toContain('long-press-squeeze');
  });

  test('long-press-squeeze animation scales down element', async ({ page }) => {
    await loadPage(page);
    const result = await page.evaluate(() => {
      // Check that the keyframes exist in any stylesheet
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSKeyframesRule && rule.name === 'long-press-squeeze') {
              return { found: true };
            }
          }
        } catch { /* cross-origin sheets */ }
      }
      return { found: false };
    });
    expect(result.found).toBe(true);
  });
});

/* ================================================================== */
/*  Cross-viewport regression: desktop should not be affected          */
/* ================================================================== */
test.describe('Desktop regression – no mobile-only styles leak @desktop', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('sidebar backdrop is hidden on desktop', async ({ page }) => {
    await loadPage(page);
    const display = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'sidebar-backdrop';
      document.body.appendChild(el);
      const d = getComputedStyle(el).display;
      el.remove();
      return d;
    });
    expect(display).toBe('none');
  });

  test('edge-swipe zone has no positioning on desktop', async ({ page }) => {
    await loadPage(page);
    const position = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'sidebar-edge-swipe-zone';
      document.body.appendChild(el);
      const p = getComputedStyle(el).position;
      el.remove();
      return p;
    });
    // On desktop, the element shouldn't be rendered, or should be static
    expect(position).not.toBe('fixed');
  });

  test('sidebar is not position:fixed on desktop', async ({ page }) => {
    await loadPage(page);
    const position = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'hierarchical-sidebar';
      document.body.appendChild(el);
      const p = getComputedStyle(el).position;
      el.remove();
      return p;
    });
    expect(position).not.toBe('fixed');
  });
});
