/**
 * Mobile PWA Overhaul Tests for v1.8.1
 *
 * Tests for all 12 steps of the mobile-native PWA overhaul:
 * 1. Toast CSS selectors (BEM naming)
 * 2. Comments full-screen at ≤768px
 * 3. Viewport maximum-scale=5
 * 4. Settings vertical nav on mobile
 * 5. PWA manifest enhancements
 * 6. Haptic web fallback (navigator.vibrate)
 * 7. Touch targets + tab scroll fade indicators
 * 8. MobileTabBar component + Chat visibility + StatusBar hide
 * 9. Sidebar auto-close + wider edge swipe zone
 * 10. MobileToolbar scroll fade + positioning above tab bar
 * 11. Kanban pagination dots at ≤480px
 * 12. Service worker via vite-plugin-pwa
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
const fs = require('fs');
const path = require('path');

const resolve = (...p) => path.resolve(__dirname, '..', ...p);
const readSrc = (...p) => fs.readFileSync(resolve(...p), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Toast CSS selectors — BEM naming
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 1: Toast CSS BEM selectors', () => {
  let css;
  beforeAll(() => { css = readSrc('frontend/src/styles/global.css'); });

  test('uses .toast--success instead of .toast.success', () => {
    expect(css).toContain('.toast--success');
    expect(css).not.toMatch(/\.toast\.success\s*\{/);
  });

  test('uses .toast--error instead of .toast.error', () => {
    expect(css).toContain('.toast--error');
    expect(css).not.toMatch(/\.toast\.error\s*\{/);
  });

  test('uses .toast--info instead of .toast.info', () => {
    expect(css).toContain('.toast--info');
    expect(css).not.toMatch(/\.toast\.info\s*\{/);
  });

  test('uses .toast--warning instead of .toast.warning', () => {
    expect(css).toContain('.toast--warning');
    expect(css).not.toMatch(/\.toast\.warning\s*\{/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Comments full-screen at ≤768px
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 2: Comments panel full-screen breakpoint', () => {
  test('Comments.css uses 768px breakpoint for full-screen layout', () => {
    const css = readSrc('frontend/src/components/Comments.css');
    // Should have 768px breakpoint, not 480px
    expect(css).toContain('max-width: 768px');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Viewport maximum-scale=5
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 3: Viewport allows pinch-zoom', () => {
  test('index.html has maximum-scale=5', () => {
    const html = readSrc('frontend/index.html');
    expect(html).toContain('maximum-scale=5');
    expect(html).not.toContain('maximum-scale=1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Settings vertical nav on mobile
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 4: Settings navigation on mobile', () => {
  test('AppSettings.css uses flex-direction: column on mobile', () => {
    const css = readSrc('frontend/src/components/common/AppSettings.css');
    expect(css).toContain('flex-direction: column');
  });

  test('WorkspaceSettings.css uses flex-wrap on mobile', () => {
    const css = readSrc('frontend/src/components/WorkspaceSettings.css');
    expect(css).toContain('flex-wrap: wrap');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PWA manifest enhancements
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 5: PWA manifest', () => {
  let manifest;
  beforeAll(() => { manifest = JSON.parse(readSrc('frontend/public/manifest.json')); });

  test('has id field', () => {
    expect(manifest.id).toBe('nightjar-app');
  });

  test('has lang and dir', () => {
    expect(manifest.lang).toBe('en');
    expect(manifest.dir).toBe('ltr');
  });

  test('has categories', () => {
    expect(manifest.categories).toContain('productivity');
    expect(manifest.categories).toContain('utilities');
  });

  test('has shortcuts', () => {
    expect(manifest.shortcuts).toHaveLength(2);
    expect(manifest.shortcuts[0].name).toBe('New Document');
    expect(manifest.shortcuts[1].name).toBe('New Workspace');
  });

  test('has maskable icon', () => {
    const maskable = manifest.icons.find(i => i.purpose === 'maskable');
    expect(maskable).toBeDefined();
    expect(maskable.sizes).toBe('512x512');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Haptic web fallback
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 6: Haptic web fallback', () => {
  test('platform.js uses navigator.vibrate as fallback', () => {
    const src = readSrc('frontend/src/utils/platform.js');
    expect(src).toContain('navigator.vibrate');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Touch targets + Tab scroll fade indicators
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 7: Touch targets and tab scroll fade', () => {
  test('TabBar.css has 44px close button touch target', () => {
    const css = readSrc('frontend/src/components/TabBar.css');
    // The close button should be 44px on coarse pointers
    expect(css).toContain('44px');
    expect(css).toContain('pointer: coarse');
  });

  test('TabBar.jsx uses scroll fade indicators', () => {
    const src = readSrc('frontend/src/components/TabBar.jsx');
    expect(src).toContain('tabs-container-wrap');
    expect(src).toContain('--fade-left');
    expect(src).toContain('--fade-right');
  });

  test('TabBar.css has fade gradient pseudo-elements', () => {
    const css = readSrc('frontend/src/components/TabBar.css');
    expect(css).toContain('.tabs-container-wrap::before');
    expect(css).toContain('.tabs-container-wrap::after');
    expect(css).toContain('linear-gradient');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. MobileTabBar + Chat visibility + StatusBar hide
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 8: MobileTabBar component', () => {
  test('MobileTabBar.jsx exists and exports', () => {
    const src = readSrc('frontend/src/components/MobileTabBar.jsx');
    expect(src).toContain('export default');
    expect(src).toContain('MobileTabBar');
  });

  test('MobileTabBar has 5 tabs: Documents, Search, Chat, Comments, More', () => {
    const src = readSrc('frontend/src/components/MobileTabBar.jsx');
    expect(src).toContain('Documents');
    expect(src).toContain('Search');
    expect(src).toContain('Chat');
    expect(src).toContain('Comments');
    expect(src).toContain('More');
  });

  test('MobileTabBar has unread badge for chat', () => {
    const src = readSrc('frontend/src/components/MobileTabBar.jsx');
    expect(src).toContain('chatUnreadCount');
    expect(src).toContain('mobile-tab-bar__badge');
  });

  test('MobileTabBar has connection status dot', () => {
    const src = readSrc('frontend/src/components/MobileTabBar.jsx');
    expect(src).toContain('connection-dot');
  });

  test('MobileTabBar uses virtual keyboard hook', () => {
    const src = readSrc('frontend/src/components/MobileTabBar.jsx');
    expect(src).toContain('useVirtualKeyboard');
  });

  test('MobileTabBar.css exists with fixed bottom positioning', () => {
    const css = readSrc('frontend/src/components/MobileTabBar.css');
    expect(css).toContain('position: fixed');
    expect(css).toContain('bottom: 0');
  });

  test('StatusBar hidden on mobile', () => {
    const css = readSrc('frontend/src/components/StatusBar.css');
    expect(css).toContain('display: none');
  });

  test('Tab bar actions hidden on mobile', () => {
    const css = readSrc('frontend/src/components/TabBar.css');
    // At ≤768px, .tab-bar-actions display: none
    expect(css).toMatch(/tab-bar-actions[\s\S]*?display:\s*none/);
  });

  test('Chat.jsx accepts mobileVisible and onUnreadChange props', () => {
    const src = readSrc('frontend/src/components/Chat.jsx');
    expect(src).toContain('mobileVisible');
    expect(src).toContain('onUnreadChange');
  });

  test('AppNew.jsx imports and renders MobileTabBar', () => {
    const src = readSrc('frontend/src/AppNew.jsx');
    expect(src).toContain("import MobileTabBar from './components/MobileTabBar'");
    expect(src).toContain('<MobileTabBar');
  });

  test('AppNew.jsx has showChat and chatUnreadCount state', () => {
    const src = readSrc('frontend/src/AppNew.jsx');
    expect(src).toContain('showChat');
    expect(src).toContain('chatUnreadCount');
    expect(src).toContain('setChatUnreadCount');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Sidebar auto-close + wider edge swipe zone
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 9: Sidebar auto-close + edge swipe', () => {
  test('AppNew.jsx auto-closes sidebar on document select on mobile', () => {
    const src = readSrc('frontend/src/AppNew.jsx');
    expect(src).toContain('isMobileViewport');
    expect(src).toContain('setSidebarCollapsed(true)');
  });

  test('global.css has wider edge swipe zone (40px)', () => {
    const css = readSrc('frontend/src/styles/global.css');
    expect(css).toContain('sidebar-edge-swipe-zone');
    expect(css).toContain('width: 40px');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. MobileToolbar scroll fade + positioning
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 10: MobileToolbar improvements', () => {
  test('MobileToolbar positions above tab bar', () => {
    const css = readSrc('frontend/src/components/MobileToolbar.css');
    expect(css).toContain('--bottom-nav-height');
    expect(css).toContain('calc(var(--keyboard-height, 0px) + var(--bottom-nav-height, 0px))');
  });

  test('MobileToolbar has scroll fade wrapper', () => {
    const src = readSrc('frontend/src/components/MobileToolbar.jsx');
    expect(src).toContain('mobile-toolbar__scroll-wrap');
    expect(src).toContain('--fade-left');
    expect(src).toContain('--fade-right');
    expect(src).toContain('scrollRef');
  });

  test('MobileToolbar CSS has fade gradient pseudo-elements', () => {
    const css = readSrc('frontend/src/components/MobileToolbar.css');
    expect(css).toContain('.mobile-toolbar__scroll-wrap::before');
    expect(css).toContain('.mobile-toolbar__scroll-wrap::after');
    expect(css).toContain('linear-gradient');
  });

  test('MobileToolbar uses ResizeObserver for fade updates', () => {
    const src = readSrc('frontend/src/components/MobileToolbar.jsx');
    expect(src).toContain('ResizeObserver');
    expect(src).toContain('updateFadeState');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Kanban pagination dots at ≤480px
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 11: Kanban pagination dots', () => {
  test('Kanban.jsx imports useIsMobile', () => {
    const src = readSrc('frontend/src/components/Kanban.jsx');
    expect(src).toContain("import useIsMobile from '../hooks/useIsMobile'");
  });

  test('Kanban.jsx uses 480px breakpoint for mobile narrow', () => {
    const src = readSrc('frontend/src/components/Kanban.jsx');
    expect(src).toContain('useIsMobile(480)');
    expect(src).toContain('isMobileNarrow');
  });

  test('Kanban.jsx renders pagination dots', () => {
    const src = readSrc('frontend/src/components/Kanban.jsx');
    expect(src).toContain('kanban-dots');
    expect(src).toContain('kanban-dot');
    expect(src).toContain('kanban-dot--active');
  });

  test('Kanban.jsx tracks active column via scroll', () => {
    const src = readSrc('frontend/src/components/Kanban.jsx');
    expect(src).toContain('activeColumnIndex');
    expect(src).toContain('handleBoardScroll');
    expect(src).toContain('onScroll={handleBoardScroll}');
  });

  test('Kanban.jsx supports scrollToColumn on dot tap', () => {
    const src = readSrc('frontend/src/components/Kanban.jsx');
    expect(src).toContain('scrollToColumn');
    expect(src).toContain('scrollIntoView');
  });

  test('Kanban dots use column color', () => {
    const src = readSrc('frontend/src/components/Kanban.jsx');
    expect(src).toContain("'--dot-color'");
  });

  test('Kanban.css has dot styles inside ≤480px media query', () => {
    const css = readSrc('frontend/src/components/Kanban.css');
    expect(css).toContain('.kanban-dots');
    expect(css).toContain('.kanban-dot');
    expect(css).toContain('.kanban-dot--active');
    // Active dot uses column color via CSS variable
    expect(css).toContain('--dot-color');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Service Worker via vite-plugin-pwa
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step 12: Service Worker (PWA)', () => {
  test('vite.config.js imports VitePWA', () => {
    const src = readSrc('vite.config.js');
    expect(src).toContain("import { VitePWA } from 'vite-plugin-pwa'");
  });

  test('vite.config.js configures VitePWA plugin', () => {
    const src = readSrc('vite.config.js');
    expect(src).toContain('VitePWA(');
    expect(src).toContain("registerType: 'autoUpdate'");
    expect(src).toContain('manifest: false'); // Uses existing manifest.json
  });

  test('vite.config.js configures workbox with sufficient cache size', () => {
    const src = readSrc('vite.config.js');
    expect(src).toContain('maximumFileSizeToCacheInBytes');
    expect(src).toContain('globPatterns');
    expect(src).toContain('navigateFallback');
  });

  test('vite.config.js disables SW in dev mode', () => {
    const src = readSrc('vite.config.js');
    expect(src).toContain('devOptions');
    expect(src).toContain('enabled: false');
  });

  test('main.jsx registers SW only in web context (not Electron)', () => {
    const src = readSrc('frontend/src/main.jsx');
    expect(src).toContain("'serviceWorker' in navigator");
    expect(src).toContain('!window.electronAPI');
    expect(src).toContain('virtual:pwa-register');
  });

  test('SW registration checks for updates hourly', () => {
    const src = readSrc('frontend/src/main.jsx');
    expect(src).toContain('setInterval');
    expect(src).toContain('60 * 60 * 1000');
    expect(src).toContain('r.update()');
  });

  test('vite-plugin-pwa is in devDependencies', () => {
    const pkg = JSON.parse(readSrc('package.json'));
    expect(pkg.devDependencies['vite-plugin-pwa']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-cutting: Build verification
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-cutting: Build integrity', () => {
  test('frontend/dist exists with SW files after build', () => {
    const distDir = resolve('frontend/dist');
    if (fs.existsSync(distDir)) {
      const files = fs.readdirSync(distDir);
      expect(files).toContain('sw.js');
      expect(files).toContain('index.html');
    }
    // If dist doesn't exist (CI), skip — build tested separately
  });

  test('CSS variable --bottom-nav-height is defined in global.css', () => {
    const css = readSrc('frontend/src/styles/global.css');
    expect(css).toContain('--bottom-nav-height');
  });
});
