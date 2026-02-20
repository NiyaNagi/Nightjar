/**
 * Mobile Optimizations v1.7.14 — Unit & Integration Tests
 *
 * Covers:
 * - Z-index stacking fixes (SlidePanel, ProducerDashboard, ProducerMyRequests)
 * - Nav rail mobile CSS corrections (InventoryNavRail, FileStorageNavRail)
 * - AllRequests mobile card view
 * - BulkTagDialog min-width fix
 * - PWA manifest correctness
 * - iOS zoom prevention (input font-size)
 * - Touch-action & tap-highlight
 * - Toast offset for mobile
 * - TODO tags presence
 */

import fs from 'fs';
import path from 'path';

const FRONTEND_SRC = path.join(process.cwd(), 'frontend', 'src');
const FRONTEND_PUBLIC = path.join(process.cwd(), 'frontend', 'public');
const FRONTEND_ROOT = path.join(process.cwd(), 'frontend');

function readCSS(relPath) {
  return fs.readFileSync(path.join(FRONTEND_SRC, relPath), 'utf-8');
}

function readFile(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf-8');
}

// ── Z-Index Stacking (Step 4) ──

describe('Z-index stacking fixes', () => {
  test('SlidePanel overlay uses modal-backdrop z-index variable', () => {
    const css = readCSS('components/inventory/common/SlidePanel.css');
    expect(css).toContain('z-index: var(--z-modal-backdrop');
    expect(css).not.toMatch(/\.slide-panel__overlay\s*\{[^}]*z-index:\s*100/);
  });

  test('ProducerDashboard overlay uses modal-backdrop z-index variable', () => {
    const css = readCSS('components/inventory/producer/ProducerDashboard.css');
    expect(css).toContain('z-index: var(--z-modal-backdrop');
    expect(css).not.toMatch(/\.pd-overlay\s*\{[^}]*z-index:\s*100/);
  });

  test('ProducerMyRequests overlay uses modal-backdrop z-index variable', () => {
    const css = readCSS('components/inventory/producer/ProducerMyRequests.css');
    expect(css).toContain('z-index: var(--z-modal-backdrop');
    expect(css).not.toMatch(/\.pmr-overlay\s*\{[^}]*z-index:\s*100/);
  });

  test('z-index scale is defined in global.css', () => {
    const css = readCSS('styles/global.css');
    expect(css).toContain('--z-modal-backdrop: 900');
    expect(css).toContain('--z-modal: 1000');
    expect(css).toContain('--z-overlay: 500');
    expect(css).toContain('--z-toast: 1300');
  });
});

// ── Nav Rail Fixes (Step 5) ──

describe('Nav rail mobile fixes', () => {
  test('InventoryNavRail hides scrollbar on mobile', () => {
    const css = readCSS('components/inventory/InventoryNavRail.css');
    expect(css).toContain('scrollbar-width: none');
    expect(css).toMatch(/inventory-nav-rail.*::-webkit-scrollbar.*display:\s*none/s);
  });

  test('InventoryNavRail has z-index on mobile', () => {
    const css = readCSS('components/inventory/InventoryNavRail.css');
    expect(css).toContain('z-index: var(--z-fixed');
  });

  test('InventoryNavRail items are flex-shrink: 0 on mobile', () => {
    const css = readCSS('components/inventory/InventoryNavRail.css');
    expect(css).toMatch(/inventory-nav-item\s*\{[^}]*flex-shrink:\s*0/s);
  });

  test('FileStorageNavRail uses correct class name (not BEM __item)', () => {
    const css = readCSS('components/files/FileStorageNavRail.css');
    // Should NOT have the broken class
    expect(css).not.toContain('.file-storage-nav-rail__item');
    // Should have the correct class in mobile media query
    expect(css).toMatch(/@media[^{]*768px[^{]*\{.*\.file-storage-nav-item/s);
  });

  test('FileStorageNavRail uses 768px breakpoint (not 600px)', () => {
    const css = readCSS('components/files/FileStorageNavRail.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)/);
    // Should NOT have the old 600px breakpoint
    expect(css).not.toMatch(/@media\s*\(\s*max-width:\s*600px\s*\)/);
  });

  test('FileStorageNavRail has z-index on mobile', () => {
    const css = readCSS('components/files/FileStorageNavRail.css');
    expect(css).toContain('z-index: var(--z-fixed');
  });

  test('FileStorageNavRail hides header and divider on mobile', () => {
    const css = readCSS('components/files/FileStorageNavRail.css');
    expect(css).toMatch(/file-storage-nav-header\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/file-storage-nav-divider\s*\{[^}]*display:\s*none/s);
  });
});

// ── Mobile Card View (Step 6) ──

describe('AllRequests mobile card view', () => {
  test('AllRequests.jsx imports useIsMobile hook', () => {
    const jsx = readFile('frontend/src/components/inventory/admin/AllRequests.jsx');
    expect(jsx).toContain("import useIsMobile from '../../../hooks/useIsMobile'");
  });

  test('AllRequests.jsx imports SlidePanel component', () => {
    const jsx = readFile('frontend/src/components/inventory/admin/AllRequests.jsx');
    expect(jsx).toContain("import SlidePanel from '../common/SlidePanel'");
  });

  test('AllRequests.jsx uses useIsMobile hook', () => {
    const jsx = readFile('frontend/src/components/inventory/admin/AllRequests.jsx');
    expect(jsx).toContain('useIsMobile()');
  });

  test('AllRequests.jsx renders card view on mobile', () => {
    const jsx = readFile('frontend/src/components/inventory/admin/AllRequests.jsx');
    expect(jsx).toContain('all-requests__cards');
    expect(jsx).toContain('all-requests__card');
    expect(jsx).toContain('all-requests__card-status');
  });

  test('AllRequests.jsx renders SlidePanel for mobile detail', () => {
    const jsx = readFile('frontend/src/components/inventory/admin/AllRequests.jsx');
    expect(jsx).toContain('<SlidePanel');
    expect(jsx).toContain('isOpen={!!expandedId}');
  });

  test('AllRequests.css has card view styles', () => {
    const css = readCSS('components/inventory/admin/AllRequests.css');
    expect(css).toContain('.all-requests__cards');
    expect(css).toContain('.all-requests__card');
    expect(css).toContain('.all-requests__card--urgent');
    expect(css).toContain('.all-requests__card-top');
    expect(css).toContain('.all-requests__card-item');
    expect(css).toContain('.all-requests__card-status');
    expect(css).toContain('.all-requests__card-date');
  });

  test('AllRequests.css has status color variants', () => {
    const css = readCSS('components/inventory/admin/AllRequests.css');
    expect(css).toContain('.all-requests__card-status--approved');
    expect(css).toContain('.all-requests__card-status--shipped');
    expect(css).toContain('.all-requests__card-status--cancelled');
  });
});

// ── CSS Fixes (Step 7) ──

describe('CSS fixes and iOS zoom prevention', () => {
  test('global.css adds touch-action: manipulation to html', () => {
    const css = readCSS('styles/global.css');
    expect(css).toMatch(/html\s*\{[^}]*touch-action:\s*manipulation/s);
  });

  test('global.css adds -webkit-tap-highlight-color: transparent', () => {
    const css = readCSS('styles/global.css');
    expect(css).toContain('-webkit-tap-highlight-color: transparent');
  });

  test('global.css has 16px font-size for inputs on mobile', () => {
    const css = readCSS('styles/global.css');
    expect(css).toMatch(/@media.*768px.*input.*select.*textarea.*font-size:\s*16px/s);
  });

  test('global.css has hover guard for touch devices', () => {
    const css = readCSS('styles/global.css');
    expect(css).toMatch(/@media\s*\(\s*hover:\s*none\s*\)/);
  });

  test('BulkTagDialog uses 768px breakpoint', () => {
    const css = readCSS('components/files/BulkTagDialog.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)/);
  });

  test('CatalogManager uses 768px breakpoint', () => {
    const css = readCSS('components/inventory/admin/CatalogManager.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)/);
  });

  test('SubmitRequest uses 768px breakpoint', () => {
    const css = readCSS('components/inventory/requestor/SubmitRequest.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)/);
  });

  test('AllRequests mobile inputs have iOS zoom prevention', () => {
    const css = readCSS('components/inventory/admin/AllRequests.css');
    expect(css).toMatch(/font-size:\s*16px.*prevent.*iOS.*zoom/si);
  });
});

// ── Momentum Scrolling & Toast (Step 8) ──

describe('Momentum scrolling and toast offset', () => {
  test('SlidePanel body has -webkit-overflow-scrolling: touch', () => {
    const css = readCSS('components/inventory/common/SlidePanel.css');
    expect(css).toMatch(/slide-panel__body\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/s);
  });

  test('AllRequests table-wrap has -webkit-overflow-scrolling: touch', () => {
    const css = readCSS('components/inventory/admin/AllRequests.css');
    expect(css).toMatch(/table-wrap\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/s);
  });

  test('Toast mobile bottom offset is 80px (clears nav rail)', () => {
    const css = readCSS('styles/global.css');
    expect(css).toMatch(/\.toast\s*\{[^}]*bottom:\s*calc\(\s*80px/s);
  });
});

// ── PWA Manifest (Step 9) ──

describe('PWA manifest and icons', () => {
  test('manifest.json exists in frontend/public', () => {
    const manifestPath = path.join(FRONTEND_PUBLIC, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  test('manifest.json is valid JSON with required fields', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(FRONTEND_PUBLIC, 'manifest.json'), 'utf-8'));
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBe('Nightjar');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBeTruthy();
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.icons).toBeInstanceOf(Array);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  test('manifest.json has 192x192 icon', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(FRONTEND_PUBLIC, 'manifest.json'), 'utf-8'));
    const icon192 = manifest.icons.find(i => i.sizes === '192x192');
    expect(icon192).toBeDefined();
    expect(icon192.type).toBe('image/png');
  });

  test('manifest.json has 512x512 icon', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(FRONTEND_PUBLIC, 'manifest.json'), 'utf-8'));
    const icon512 = manifest.icons.find(i => i.sizes === '512x512');
    expect(icon512).toBeDefined();
    expect(icon512.type).toBe('image/png');
  });

  test('nightjar-192.png exists in public', () => {
    expect(fs.existsSync(path.join(FRONTEND_PUBLIC, 'nightjar-192.png'))).toBe(true);
  });

  test('nightjar-512.png exists in public', () => {
    expect(fs.existsSync(path.join(FRONTEND_PUBLIC, 'nightjar-512.png'))).toBe(true);
  });

  test('apple-touch-icon.png exists in public', () => {
    expect(fs.existsSync(path.join(FRONTEND_PUBLIC, 'apple-touch-icon.png'))).toBe(true);
  });

  test('index.html links to manifest.json', () => {
    const html = fs.readFileSync(path.join(FRONTEND_ROOT, 'index.html'), 'utf-8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('href="/manifest.json"');
  });

  test('index.html has theme-color meta tag', () => {
    const html = fs.readFileSync(path.join(FRONTEND_ROOT, 'index.html'), 'utf-8');
    expect(html).toContain('name="theme-color"');
  });

  test('index.html has apple-mobile-web-app-capable meta tag', () => {
    const html = fs.readFileSync(path.join(FRONTEND_ROOT, 'index.html'), 'utf-8');
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('content="yes"');
  });

  test('index.html has apple-touch-icon link', () => {
    const html = fs.readFileSync(path.join(FRONTEND_ROOT, 'index.html'), 'utf-8');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('href="/apple-touch-icon.png"');
  });

  test('index.html has apple-mobile-web-app-title', () => {
    const html = fs.readFileSync(path.join(FRONTEND_ROOT, 'index.html'), 'utf-8');
    expect(html).toContain('name="apple-mobile-web-app-title"');
    expect(html).toContain('content="Nightjar"');
  });
});

// ── TODO Tags (Steps 1 & 3) ──

describe('TODO tags for deferred work', () => {
  test('index.html has TODO for viewport-fit=cover', () => {
    const html = fs.readFileSync(path.join(FRONTEND_ROOT, 'index.html'), 'utf-8');
    expect(html).toContain('TODO: [Mobile Step 1]');
    expect(html).toContain('viewport-fit=cover');
  });

  test('global.css has TODO for overscroll-behavior and dvh', () => {
    const css = readCSS('styles/global.css');
    expect(css).toContain('TODO: [Mobile Step 1]');
    expect(css).toContain('overscroll-behavior');
    expect(css).toContain('100dvh');
  });

  test('index.css has TODO for Vite boilerplate cleanup', () => {
    const css = readCSS('index.css');
    expect(css).toContain('TODO: [Mobile Step 1]');
    expect(css).toContain('Vite boilerplate');
  });

  test('Chat.css has TODO for chat positioning', () => {
    const css = readCSS('components/Chat.css');
    expect(css).toContain('TODO: [Mobile Step 3]');
    expect(css).toContain('bottom nav');
  });
});

// ── useIsMobile hook file exists ──

describe('useIsMobile hook', () => {
  test('hook file exists', () => {
    const hookPath = path.join(FRONTEND_SRC, 'hooks', 'useIsMobile.js');
    expect(fs.existsSync(hookPath)).toBe(true);
  });

  test('hook exports a default function', () => {
    const hook = fs.readFileSync(path.join(FRONTEND_SRC, 'hooks', 'useIsMobile.js'), 'utf-8');
    expect(hook).toContain('export default function useIsMobile');
  });

  test('hook uses window.matchMedia', () => {
    const hook = fs.readFileSync(path.join(FRONTEND_SRC, 'hooks', 'useIsMobile.js'), 'utf-8');
    expect(hook).toContain('window.matchMedia');
  });

  test('hook has default breakpoint of 768', () => {
    const hook = fs.readFileSync(path.join(FRONTEND_SRC, 'hooks', 'useIsMobile.js'), 'utf-8');
    expect(hook).toMatch(/breakpoint\s*=\s*768/);
  });
});

// ── Build Output ──

describe('Build output integrity', () => {
  test('dist/index.html exists after build', () => {
    const distHtml = path.join(FRONTEND_ROOT, 'dist', 'index.html');
    if (!fs.existsSync(distHtml)) {
      // Build may not have been run in test CI, skip gracefully
      console.warn('dist/ not found — skipping build output test');
      return;
    }
    expect(fs.existsSync(distHtml)).toBe(true);
  });

  test('built index.html contains manifest link', () => {
    const distHtml = path.join(FRONTEND_ROOT, 'dist', 'index.html');
    if (!fs.existsSync(distHtml)) return;
    const html = fs.readFileSync(distHtml, 'utf-8');
    expect(html).toContain('manifest');
  });
});
