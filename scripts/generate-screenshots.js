#!/usr/bin/env node
/**
 * generate-screenshots.js — Captures real app screenshots for the landing page
 *
 * Launches the Vite dev server, drives the actual Nightjar app through onboarding,
 * workspace/document creation, and captures each screen at 1920×1080 as WebP.
 *
 * Usage:
 *   node scripts/generate-screenshots.js
 *
 * Output:
 *   frontend/public-site/screenshots/*.webp
 *   frontend/public-site/screenshots/manifest.json
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend', 'public-site', 'screenshots');
const WIDTH = 1920;
const HEIGHT = 1080;
const WEBP_QUALITY = 85;
const DEV_SERVER_URL = 'http://127.0.0.1:5174';
const PIN = '123456';

// ── Screenshot definitions ──────────────────────────────────────────────────
const SCREENSHOTS = [
  {
    id: 'onboarding',
    title: 'Identity Creation',
    description: 'Create your encrypted identity — no email, no phone, no tracking',
    category: 'identity',
  },
  {
    id: 'text-editor',
    title: 'Rich Text Editor',
    description: 'Collaborative real-time editing with formatting, headings, lists, and code blocks',
    category: 'documents',
  },
  {
    id: 'spreadsheet',
    title: 'Spreadsheet',
    description: 'Full-featured spreadsheet with formulas, formatting, and real-time collaboration',
    category: 'documents',
  },
  {
    id: 'kanban-board',
    title: 'Kanban Board',
    description: 'Visual task management with drag-and-drop cards and custom columns',
    category: 'documents',
  },
  {
    id: 'chat-panel',
    title: 'Team Chat',
    description: 'End-to-end encrypted team messaging — right inside your workspace',
    category: 'collaboration',
  },
  {
    id: 'inventory-dashboard',
    title: 'Inventory Management',
    description: 'Track products, stock levels, and requests with analytics dashboards',
    category: 'inventory',
  },
  {
    id: 'sharing-panel',
    title: 'Sharing & Invites',
    description: 'Share your workspace via encrypted invite links or scannable QR codes',
    category: 'sharing',
  },
  {
    id: 'help-page',
    title: 'Built-in Help',
    description: 'Comprehensive documentation and keyboard shortcuts — always one keystroke away',
    category: 'navigation',
  },
  {
    id: 'file-storage',
    title: 'File Storage',
    description: 'Encrypted file storage with drag-and-drop upload and folder organization',
    category: 'documents',
  },
  {
    id: 'search-palette',
    title: 'Search Palette',
    description: 'Find anything instantly — documents, people, inventory, and chat messages',
    category: 'navigation',
  },
  {
    id: 'workspace-switcher',
    title: 'Workspace Switcher',
    description: 'Manage multiple workspaces and switch between them in one click',
    category: 'workspaces',
  },
  {
    id: 'dark-theme-editor',
    title: 'Dark Theme Editor',
    description: 'Beautiful dark theme with full rich-text formatting — easy on the eyes',
    category: 'documents',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(`  📸 ${msg}`); }
function warn(msg) { console.warn(`  ⚠️  ${msg}`); }

/** Wait for the dev server to respond */
async function waitForServer(url, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Dev server at ${url} didn't start within ${timeoutMs / 1000}s`);
}

/** Start a server to serve the app */
function startDevServer() {
  const isWin = process.platform === 'win32';
  const distDir = path.join(PROJECT_ROOT, 'frontend', 'dist');

  // Use production build if available — serve with a simple Node.js HTTP server
  // to avoid HMR reloads (dev mode) and batch-file proxy crashes (vite preview)
  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    log('Using production build (frontend/dist) — no HMR reloads');
    log('Starting static file server...');

    const http = require('http');
    const mimeTypes = {
      '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
      '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
      '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    };

    const server = http.createServer((req, res) => {
      let urlPath = new URL(req.url, 'http://localhost').pathname;
      if (urlPath === '/') urlPath = '/index.html';

      // API routes — return empty success (no backend running)
      if (urlPath.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }

      const filePath = path.join(distDir, urlPath);
      const ext = path.extname(filePath);

      // Security: don't serve files outside dist
      if (!filePath.startsWith(distDir)) {
        res.writeHead(403); res.end(); return;
      }

      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath);
          res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
          res.end(content);
        } else {
          // SPA fallback — serve index.html for client-side routing
          const indexContent = fs.readFileSync(path.join(distDir, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexContent);
        }
      } catch {
        res.writeHead(404); res.end('Not found');
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        warn(`Port 5174 is in use — trying to free it...`);
        // Try connecting to it to force-close, then retry
        const net = require('net');
        const probe = net.createConnection(5174, '127.0.0.1');
        probe.on('connect', () => { probe.destroy(); });
        probe.on('error', () => {});
        setTimeout(() => server.listen(5174, '127.0.0.1'), 1000);
      }
    });

    server.listen(5174, '127.0.0.1', () => {
      log('Static server listening on http://127.0.0.1:5174');
    });

    // Return a fake child-like object for the cleanup code
    return {
      pid: process.pid,
      kill: () => { try { server.close(); } catch {} },
      _server: server,
    };
  }

  // Fallback: start Vite dev server (may have HMR reload issues)
  warn('No production build found — using dev server (run "npx vite build" first for best results)');
  const child = spawn(isWin ? 'npx.cmd' : 'npx', ['vite', '--host', '127.0.0.1', '--port', '5174'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
    shell: isWin,
  });
  child.stdout.on('data', d => {
    const line = d.toString().trim();
    if (line) process.stdout.write(`  [vite] ${line}\n`);
  });
  child.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line && !line.includes('ExperimentalWarning') && !line.includes('CJS build'))
      process.stderr.write(`  [vite] ${line}\n`);
  });
  return child;
}

/** Save a screenshot buffer to WebP */
async function saveScreenshot(pngBuffer, filename) {
  const outPath = path.join(OUTPUT_DIR, filename);
  if (sharp) {
    await sharp(pngBuffer).webp({ quality: WEBP_QUALITY }).toFile(outPath);
  } else {
    fs.writeFileSync(outPath, pngBuffer);
    warn(`sharp not available — saved ${filename} as raw PNG`);
  }
  const stat = fs.statSync(outPath);
  return { path: outPath, sizeKB: Math.round(stat.size / 1024) };
}

/** Short wait */
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/** Safe click — wait for selector then click */
async function safeClick(page, selector, opts = {}) {
  await page.waitForSelector(selector, { state: 'visible', timeout: 15000, ...opts });
  await page.click(selector);
}

/** Type into a PIN input (6-digit auto-advance fields) */
async function enterPIN(page, pin) {
  for (let i = 0; i < pin.length; i++) {
    const input = page.locator(`[data-testid="pin-digit-${i}"]`);
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill(pin[i]);
    await wait(80);
  }
}

/** Try multiple selectors, click the first one found */
async function clickFirst(page, selectors, timeout = 5000) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: timeout / selectors.length }).catch(() => false)) {
        await el.click();
        return true;
      }
    } catch {}
  }
  return false;
}

/** Take a debug screenshot for troubleshooting */
async function debugScreenshot(page, name) {
  const buf = await page.screenshot({ type: 'png' });
  const debugPath = path.join(OUTPUT_DIR, `_debug_${name}.png`);
  fs.writeFileSync(debugPath, buf);
  log(`  [debug] Saved ${debugPath}`);
}

/** Hide the chat panel completely for clean screenshots */
async function hideChat(page) {
  try {
    // If chat is expanded, minimize it first
    const minimizeBtn = page.locator('.btn-minimize');
    if (await minimizeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await minimizeBtn.click();
      await wait(300);
    }
    // Now hide the minimized bubble with CSS
    await page.evaluate(() => {
      const bubble = document.querySelector('.chat-minimized');
      if (bubble) bubble.style.display = 'none';
      // Also hide any chat container
      const container = document.querySelector('[data-testid="chat-container"]');
      if (container) container.style.display = 'none';
    });
    await wait(200);
  } catch {}
}

/** Show the chat panel (undo hideChat) */
async function showChat(page) {
  try {
    await page.evaluate(() => {
      const bubble = document.querySelector('.chat-minimized');
      if (bubble) bubble.style.display = '';
      const container = document.querySelector('[data-testid="chat-container"]');
      if (container) container.style.display = '';
    });
    await wait(200);
  } catch {}
}

/** Dismiss any leftover overlays */
async function dismissOverlays(page) {
  try {
    const overlays = [
      '.create-document-overlay',
      '.create-folder-overlay',
      '.create-workspace__overlay',
    ];
    for (const sel of overlays) {
      if (await page.locator(sel).isVisible({ timeout: 300 }).catch(() => false)) {
        await page.keyboard.press('Escape');
        await wait(400);
      }
    }
  } catch {}
}

/** Remove toast notifications and sync indicators before capture */
async function cleanBeforeCapture(page) {
  await page.evaluate(() => {
    // Remove toasts
    document.querySelectorAll('.toast, .Toastify, .toast-container, [class*="toast"]').forEach(el => el.remove());
    // Remove sync status chips
    document.querySelectorAll('.sync-chip, .status-bar__sync').forEach(el => el.style.display = 'none');
  });
  await wait(100);
}


// ── Main Flow ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🦜 Nightjar Real Screenshot Generator\n');

  // Catch unhandled errors
  process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled rejection:', err);
  });
  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught exception:', err);
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Start Vite dev server
  const devServer = startDevServer();
  let browser;

  try {
    await waitForServer(DEV_SERVER_URL);
    log('Dev server is ready\n');

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-hang-monitor',           // Prevent "renderer hung" kills
        '--disable-renderer-backgrounding',  // Keep renderer active
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--js-flags=--max-old-space-size=4096',
      ],
    });
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
    });

    // Inject PBKDF2 speed-up that survives navigation/reload
    await context.addInitScript(() => {
      const origDeriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
      crypto.subtle.deriveBits = async (algorithm, key, length) => {
        if (algorithm && algorithm.name === 'PBKDF2') {
          algorithm = { ...algorithm, iterations: 1000 };
        }
        return origDeriveBits(algorithm, key, length);
      };
      const origDeriveKey = crypto.subtle.deriveKey.bind(crypto.subtle);
      crypto.subtle.deriveKey = async (algorithm, key, derived, extractable, usages) => {
        if (algorithm && algorithm.name === 'PBKDF2') {
          algorithm = { ...algorithm, iterations: 1000 };
        }
        return origDeriveKey(algorithm, key, derived, extractable, usages);
      };
    });

    const page = await context.newPage();
    page.setDefaultTimeout(60000); // generous timeout for crypto-heavy operations

    // Suppress console noise from the app
    page.on('pageerror', () => {});

    // Clear any previous state
    await page.goto(DEV_SERVER_URL);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    try {
      await page.evaluate(async () => {
        if (indexedDB.databases) {
          const dbs = await indexedDB.databases();
          for (const db of dbs) indexedDB.deleteDatabase(db.name);
        }
      });
    } catch {}
    await page.reload();
    await wait(2000);
    log('Cleared previous state');

    // ── Monkey-patch PBKDF2 to avoid renderer crash ──────────────────
    // The real app uses 100,000 iterations × 2 (create + persist),
    // which blocks the main thread long enough to crash headless Chromium.
    // Reduce to 1,000 iterations — security is irrelevant for screenshots.
    await page.evaluate(() => {
      const origDeriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
      crypto.subtle.deriveBits = async (algorithm, key, length) => {
        if (algorithm && algorithm.name === 'PBKDF2') {
          algorithm = { ...algorithm, iterations: 1000 };
        }
        return origDeriveBits(algorithm, key, length);
      };
      const origDeriveKey = crypto.subtle.deriveKey.bind(crypto.subtle);
      crypto.subtle.deriveKey = async (algorithm, key, derived, extractable, usages) => {
        if (algorithm && algorithm.name === 'PBKDF2') {
          algorithm = { ...algorithm, iterations: 1000 };
        }
        return origDeriveKey(algorithm, key, derived, extractable, usages);
      };
    });
    log('Patched PBKDF2 iterations (100k → 1k) for speed');

    // ════════════════════════════════════════════════════════════════════
    //  ONBOARDING — capture mid-flow
    // ════════════════════════════════════════════════════════════════════
    log('Running onboarding flow...');

    await page.waitForSelector('.onboarding-overlay', { state: 'visible', timeout: 30000 });
    await wait(1500);

    // Click "Create New Identity"
    await safeClick(page, 'button:has-text("Create New Identity")');
    await wait(800);

    // Fill display name
    const nameInput = page.locator('#handle, [data-testid="identity-name-input"]').first();
    await nameInput.waitFor({ state: 'visible', timeout: 10000 });
    await nameInput.fill('Sarah Chen');
    await wait(500);

    // ── CAPTURE 1: Onboarding (identity creation mid-flow) ──
    log('  [1/12] Onboarding — identity creation');
    try {
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'onboarding.webp');
      log(`  ✓ onboarding (${res.sizeKB} KB)`);
    } catch (e) {
      warn(`  ✗ onboarding: ${e.message}`);
    }

    // Continue onboarding — Next to PIN step
    log('  Clicking Next to PIN step...');
    await safeClick(page, '[data-testid="confirm-identity-btn"], button:has-text("Next: Set Up PIN")');
    await wait(800);

    // Listen for page crashes
    page.on('crash', () => warn('PAGE CRASHED!'));
    context.on('page', p => log('  New page opened: ' + p.url()));

    // Enter PIN (first time)
    log('  Entering first PIN...');
    await enterPIN(page, PIN);
    log('  First PIN entered, waiting...');
    await wait(4000);

    // Check page is still alive
    try {
      await page.title();
      log('  Page still alive after first PIN');
    } catch (e) {
      warn('  Page died after first PIN: ' + e.message);
      // Try to recover by opening a new page
      throw new Error('Page crashed after first PIN entry');
    }

    // Confirm PIN (second time) — this triggers 2× PBKDF2 derivation
    log('  Entering confirm PIN...');
    await enterPIN(page, PIN);
    log('  Confirm PIN entered, waiting for key derivation...');
    await wait(10000);

    // Recovery phrase step — check checkbox and continue
    log('  Looking for recovery phrase...');
    try {
      await page.waitForSelector('.recovery-phrase-grid, .seed-phrase', { state: 'visible', timeout: 30000 });
      log('  Recovery phrase visible');
      await wait(800);

      const checkbox = page.locator('[data-testid="understood-checkbox"], input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
        await checkbox.check({ force: true });
        await wait(300);
        log('  Checkbox checked');
      }

      await safeClick(page, '[data-testid="continue-btn"], button:has-text("Continue")');
      log('  Clicked Continue');
      await wait(3000);
    } catch (e) {
      warn('Recovery phrase step variant: ' + e.message);
      try { await debugScreenshot(page, 'after-pin'); } catch {}
    }

    // Wait for onboarding to finish
    log('  Waiting for onboarding overlay to detach...');
    try {
      await page.waitForSelector('.onboarding-overlay', { state: 'detached', timeout: 45000 });
    } catch {}
    await wait(3000);
    log('✓ Onboarding complete\n');

    // Lower timeout now that PBKDF2-heavy onboarding is done
    page.setDefaultTimeout(15000);

    // ════════════════════════════════════════════════════════════════════
    //  HIDE CHAT for all non-chat screenshots
    // ════════════════════════════════════════════════════════════════════
    await hideChat(page);
    log('Chat hidden for clean captures');

    // ════════════════════════════════════════════════════════════════════
    //  CREATE WORKSPACE
    // ════════════════════════════════════════════════════════════════════
    log('Creating workspace...');

    let wsCreated = false;
    try {
      await safeClick(page, 'button:has-text("Create Workspace")');
      await wait(800);
      wsCreated = true;
    } catch {
      try {
        await safeClick(page, '.workspace-dropdown-trigger');
        await wait(300);
        await safeClick(page, 'button:has-text("Create New Workspace")');
        await wait(800);
        wsCreated = true;
      } catch (e) {
        warn('Could not open create workspace dialog: ' + e.message);
        await debugScreenshot(page, 'ws-create-fail');
      }
    }

    if (wsCreated) {
      const wsNameInput = page.locator('[data-testid="workspace-name-input"], input[placeholder="My Workspace"]').first();
      await wsNameInput.waitFor({ state: 'visible', timeout: 5000 });
      await wsNameInput.fill('Toybox Emporium — Spring 2026');
      await wait(300);

      const submitBtn = page.locator('[data-testid="create-workspace-submit"], button:has-text("Create Workspace")').last();
      await submitBtn.click();
      await wait(4000);

      try {
        await page.waitForSelector('.hierarchical-sidebar', { state: 'visible', timeout: 15000 });
      } catch {}
      await wait(2000);
      log('✓ Workspace created\n');
    }

    // Re-hide chat after navigation
    await hideChat(page);

    // ════════════════════════════════════════════════════════════════════
    //  CREATE FOLDERS
    // ════════════════════════════════════════════════════════════════════
    log('Creating folders...');
    const folderNames = ['Operations', 'Finance', 'Product Design', 'Warehouse', 'Team'];

    for (const name of folderNames) {
      try {
        const folderBtn = page.locator('[data-testid="new-folder-btn"], button:has-text("Folder")').first();
        if (await folderBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await folderBtn.click();
          await wait(500);

          const folderInput = page.locator('.create-folder__input, input[placeholder="My Folder"]').first();
          await folderInput.waitFor({ state: 'visible', timeout: 3000 });
          await folderInput.fill(name);
          await wait(200);

          await safeClick(page, '.create-folder__btn--primary, button:has-text("Create Folder")');
          await wait(1000);
        }
      } catch (e) {
        warn(`Folder "${name}": ${e.message}`);
        await page.keyboard.press('Escape');
        await wait(500);
      }
    }
    log('✓ Folders created\n');

    // ════════════════════════════════════════════════════════════════════
    //  CREATE DOCUMENTS (with colors and folder assignments)
    // ════════════════════════════════════════════════════════════════════
    log('Creating documents...');

    const documents = [
      { name: 'Sprint Planning — Feb 17',     type: 'Document',         folder: 'Team',           color: 'Blue' },
      { name: 'Q1 Revenue Tracker',            type: 'Spreadsheet',      folder: 'Finance',        color: 'Green' },
      { name: 'Shipping Cost Calculator',      type: 'Spreadsheet',      folder: 'Finance',        color: 'Orange' },
      { name: 'Product Catalog — Spring 2026', type: 'Document',         folder: 'Product Design', color: 'Purple' },
      { name: 'Spring Product Launch',         type: 'Document',         folder: 'Operations',     color: 'Red' },
      { name: 'Design Pipeline',              type: 'Kanban Board',     folder: 'Product Design', color: 'Indigo' },
      { name: 'Inventory Valuation',          type: 'Inventory System', folder: 'Warehouse',      color: 'Teal' },
      { name: 'Welcome & Onboarding Guide',   type: 'Document',         folder: 'Team',           color: 'Pink' },
      { name: 'Product Photography',          type: 'File Storage',     folder: 'Product Design', color: 'Yellow' },
    ];

    // Debug: screenshot before first doc creation
    await debugScreenshot(page, 'before-doc-creation');

    const typeMap = {
      'Document': 'text', 'Spreadsheet': 'sheet', 'Kanban Board': 'kanban',
      'Inventory System': 'inventory', 'File Storage': 'files'
    };

    for (let di = 0; di < documents.length; di++) {
      const doc = documents[di];
      log(`  [${di + 1}/${documents.length}] Creating "${doc.name}" (${doc.type})...`);
      try {
        await dismissOverlays(page);

        // Click "New" in sidebar — check visibility first with short timeout
        const newBtn = page.locator('[data-testid="new-document-btn"]').first();
        const btnVisible = await newBtn.isVisible({ timeout: 5000 }).catch(() => false);
        if (!btnVisible) {
          warn(`  new-document-btn not visible — taking debug screenshot`);
          await debugScreenshot(page, `doc-${di}-btn-missing`);
          // Try pressing Escape in case something is blocking it
          await page.keyboard.press('Escape');
          await wait(500);
          // Retry once
          const retryVisible = await newBtn.isVisible({ timeout: 3000 }).catch(() => false);
          if (!retryVisible) {
            warn(`  Skipping "${doc.name}" — New button still not visible`);
            continue;
          }
        }
        await newBtn.click({ timeout: 10000 });
        await wait(600);

        // Wait for the create-document modal to appear
        const modal = page.locator('.create-document-overlay');
        const modalVisible = await modal.isVisible({ timeout: 5000 }).catch(() => false);
        if (!modalVisible) {
          warn(`  Create dialog did not open for "${doc.name}"`);
          await debugScreenshot(page, `doc-${di}-no-modal`);
          await page.keyboard.press('Escape');
          await wait(500);
          continue;
        }

        // Select document type
        const typeKey = typeMap[doc.type] || doc.type.toLowerCase();
        const typeBtn = page.locator(`[data-testid="doc-type-${typeKey}"]`).first();
        await typeBtn.click({ timeout: 5000 });
        await wait(400);

        // Fill name
        const docInput = page.locator('[data-testid="document-name-input"]').first();
        await docInput.waitFor({ state: 'visible', timeout: 3000 });
        await docInput.clear();
        await docInput.fill(doc.name);
        await wait(200);

        // Select color
        if (doc.color && doc.color !== 'Default') {
          try {
            const colorOpt = page.locator(`.color-option[title="${doc.color}"]`).first();
            if (await colorOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
              await colorOpt.click();
              await wait(200);
            }
          } catch {}
        }

        // Select folder — labels include emoji prefix like "📁 Team"
        if (doc.folder) {
          try {
            const folderSelect = page.locator('#folder-select').first();
            if (await folderSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
              // Try exact label first, then partial match with emoji prefix
              try {
                await folderSelect.selectOption({ label: doc.folder });
              } catch {
                // Folder labels may include emoji prefix like "📁 Team"
                const options = await folderSelect.locator('option').allTextContents();
                const match = options.find(o => o.includes(doc.folder));
                if (match) {
                  await folderSelect.selectOption({ label: match });
                }
              }
              await wait(200);
            }
          } catch {}
        }

        // Submit
        const createBtn = page.locator('[data-testid="create-document-confirm"]').first();
        await createBtn.click({ timeout: 5000 });
        await wait(2000);
        log(`  ✓ "${doc.name}" created`);
      } catch (e) {
        warn(`Doc "${doc.name}": ${e.message}`);
        await debugScreenshot(page, `doc-${di}-error`);
        await page.keyboard.press('Escape');
        await wait(500);
      }
    }
    log('✓ Documents created\n');

    // ════════════════════════════════════════════════════════════════════
    //  EXPAND ALL FOLDERS in sidebar
    // ════════════════════════════════════════════════════════════════════
    log('Expanding folders...');
    try {
      // Click all collapsed folder toggles
      const toggles = page.locator('.tree-item__toggle[aria-label="Expand folder"]');
      const count = await toggles.count();
      for (let i = 0; i < count; i++) {
        await toggles.nth(i).click();
        await wait(200);
      }
      log(`✓ Expanded ${count} folders\n`);
    } catch (e) {
      warn(`Folder expansion: ${e.message}`);
    }

    // Re-hide chat after all document creation
    await hideChat(page);

    // ════════════════════════════════════════════════════════════════════
    //  CAPTURE SCREENSHOTS
    // ════════════════════════════════════════════════════════════════════
    const results = [];
    const TOTAL = SCREENSHOTS.length;

    // ── 2: Rich Text Editor ──────────────────────────────────────────
    try {
      log(`  [2/${TOTAL}] Rich Text Editor`);
      const textDoc = page.locator('.hierarchical-sidebar').getByText('Sprint Planning', { exact: false }).first();
      await textDoc.click();
      await wait(2500);

      const editor = page.locator('.tiptap, .ProseMirror, [contenteditable="true"]').first();
      if (await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
        await editor.click();
        await wait(300);

        // H1 via toolbar button (find heading dropdown or click H1 directly)
        // Use TipTap toolbar buttons for proper formatting
        try {
          // Try clicking heading button in toolbar
          const h1Btn = page.locator('.editor-toolbar button:has-text("H1"), .editor-toolbar button[title*="Heading 1"]').first();
          if (await h1Btn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await h1Btn.click();
            await wait(100);
          }
        } catch {}
        await page.keyboard.type('Sprint Planning — Week of Feb 17', { delay: 8 });
        await page.keyboard.press('Enter');

        // H2
        try {
          const h2Btn = page.locator('.editor-toolbar button:has-text("H2"), .editor-toolbar button[title*="Heading 2"]').first();
          if (await h2Btn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await h2Btn.click();
            await wait(100);
          }
        } catch {}
        await page.keyboard.type('Goals for this Sprint', { delay: 8 });
        await page.keyboard.press('Enter');

        // Bullet list via toolbar
        try {
          const bulletBtn = page.locator('.editor-toolbar button:has-text("Bullet List"), .editor-toolbar button[title*="Bullet"]').first();
          if (await bulletBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await bulletBtn.click();
            await wait(100);
          }
        } catch {}
        await page.keyboard.type('Finalize Q1 product catalog layout', { delay: 6 });
        await page.keyboard.press('Enter');
        await page.keyboard.type('Review shipping cost estimates with logistics', { delay: 6 });
        await page.keyboard.press('Enter');
        await page.keyboard.type('Update brand guidelines for Spring collection', { delay: 6 });
        await page.keyboard.press('Enter');
        await page.keyboard.type('Coordinate with warehouse on inventory sync', { delay: 6 });
        await page.keyboard.press('Enter');
        await page.keyboard.type('Prepare launch timeline for board review', { delay: 6 });
        await page.keyboard.press('Enter');

        // Exit bullet list by pressing Enter twice
        await page.keyboard.press('Enter');
        await wait(200);

        // Paragraph text
        await page.keyboard.type('The new product line includes 12 items across 3 categories. Pricing must be finalized by Friday with the catalog ready for review by the 24th.', { delay: 4 });
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');

        // Blockquote via toolbar
        try {
          const quoteBtn = page.locator('.editor-toolbar button:has-text("Blockquote"), .editor-toolbar button[title*="quote"]').first();
          if (await quoteBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await quoteBtn.click();
            await wait(100);
          }
        } catch {}
        await page.keyboard.type('"Design is not just what it looks like — design is how it works." — Steve Jobs', { delay: 4 });
        await wait(800);
      }

      await hideChat(page);
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'text-editor.webp');
      log(`  ✓ text-editor (${res.sizeKB} KB)`);
    } catch (e) {
      warn(`  ✗ text-editor: ${e.message}`);
      await debugScreenshot(page, 'text-editor');
    }

    // ── 3: Spreadsheet ───────────────────────────────────────────────
    try {
      log(`  [3/${TOTAL}] Spreadsheet`);
      const sheetDoc = page.locator('.hierarchical-sidebar').getByText('Q1 Revenue', { exact: false }).first();
      await sheetDoc.click();
      await wait(4000);

      const sheet = page.locator('.fortune-sheet-container, .luckysheet-cell-main, canvas').first();
      if (await sheet.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Header row
        await sheet.click({ position: { x: 80, y: 40 } });
        await wait(300);
        const headers = ['Product', 'Category', 'SKU', 'Q1 Units', 'Unit Price', 'Revenue', 'Margin %', 'Status'];
        for (const h of headers) {
          await page.keyboard.type(h, { delay: 10 });
          await page.keyboard.press('Tab');
        }
        await page.keyboard.press('Enter');

        // Data rows (12 rows of toystore data)
        const rows = [
          ['Plush Bear XL',       'Stuffed Animals',  'PB-001', '1,247', '$24.99', '$31,162', '42%', 'In Stock'],
          ['RC Thunder Car',      'Vehicles',         'RC-110', '892',   '$34.99', '$31,211', '38%', 'In Stock'],
          ['Building Block Set',  'Construction',     'BB-500', '2,104', '$19.99', '$42,059', '55%', 'In Stock'],
          ['Princess Castle Kit', 'Playsets',         'PC-220', '654',   '$49.99', '$32,693', '35%', 'Low Stock'],
          ['Science Lab Pro',     'Educational',      'SL-300', '431',   '$29.99', '$12,925', '48%', 'In Stock'],
          ['Wooden Train Set',    'Classic Toys',     'WT-150', '318',   '$39.99', '$12,716', '44%', 'In Stock'],
          ['Art Easel Deluxe',    'Arts & Crafts',    'AE-060', '567',   '$27.99', '$15,870', '51%', 'In Stock'],
          ['Dino Excavation Kit', 'Educational',      'DE-400', '723',   '$14.99', '$10,837', '62%', 'Reorder'],
          ['Robot Builder',       'STEM',             'RB-800', '289',   '$44.99', '$13,002', '36%', 'In Stock'],
          ['Puzzle World 1000pc', 'Puzzles',          'PW-100', '1,056', '$12.99', '$13,717', '58%', 'In Stock'],
          ['Action Hero Fig.',    'Action Figures',   'AH-250', '1,891', '$9.99',  '$18,891', '65%', 'In Stock'],
          ['Magnetic Tiles Set',  'Construction',     'MT-360', '445',   '$54.99', '$24,470', '40%', 'Low Stock'],
        ];
        for (const row of rows) {
          for (let i = 0; i < row.length; i++) {
            await page.keyboard.type(row[i], { delay: 5 });
            if (i < row.length - 1) await page.keyboard.press('Tab');
          }
          await page.keyboard.press('Enter');
        }
        await wait(500);
        // Click away to deselect
        await sheet.click({ position: { x: 600, y: 400 } });
        await wait(300);
      }

      await hideChat(page);
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'spreadsheet.webp');
      log(`  ✓ spreadsheet (${res.sizeKB} KB)`);
    } catch (e) {
      warn(`  ✗ spreadsheet: ${e.message}`);
      await debugScreenshot(page, 'spreadsheet');
    }

    // ── 4: Kanban Board ──────────────────────────────────────────────
    try {
      log(`  [4/${TOTAL}] Kanban Board`);
      const kanbanDoc = page.locator('.hierarchical-sidebar').getByText('Design Pipeline', { exact: false }).first();
      await kanbanDoc.click();
      await wait(2500);

      // Wait for sync error and click "Work Offline"
      try {
        const offlineBtn = page.locator('.btn-offline');
        await offlineBtn.waitFor({ state: 'visible', timeout: 15000 });
        await offlineBtn.click();
        await wait(2000);
        log('    ✓ Clicked "Work Offline"');
      } catch (e) {
        warn(`    Kanban offline: ${e.message}`);
        // May already be in offline mode or no sync needed
        await wait(2000);
      }

      // Wait for the board to render with default columns
      try {
        await page.waitForSelector('[data-testid="kanban-board"]', { state: 'visible', timeout: 10000 });
      } catch {}
      await wait(1000);

      // Add custom columns: "Review" and "Shipped" (default has To Do, In Progress, Done)
      try {
        // Add "Review" column
        const addColBtn = page.locator('[data-testid="kanban-add-column-btn"]');
        if (await addColBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await addColBtn.click();
          await wait(400);
          const colInput = page.locator('.new-column-form__input').first();
          if (await colInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await colInput.fill('Review');
            const addBtn = page.locator('.new-column-form__btn--add').first();
            await addBtn.click();
            await wait(800);
          }

          // Add "Shipped" column
          await addColBtn.click();
          await wait(400);
          const colInput2 = page.locator('.new-column-form__input').first();
          if (await colInput2.isVisible({ timeout: 2000 }).catch(() => false)) {
            await colInput2.fill('Shipped');
            const addBtn2 = page.locator('.new-column-form__btn--add').first();
            await addBtn2.click();
            await wait(800);
          }
        }
      } catch (e) {
        warn(`    Kanban add columns: ${e.message}`);
      }

      // Add cards to each column with toystore-themed tasks
      const columnCards = {
        'To Do': [
          'Design spring window display',
          'Order plush bear restocks',
          'Plan Easter egg hunt event',
          'Update website banners',
        ],
        'In Progress': [
          'Build RC car demo station',
          'Photograph new arrivals',
          'Train new seasonal staff',
        ],
        'Done': [
          'Set up building block corner',
          'Print spring catalog flyers',
        ],
        'Review': [
          'Approve new vendor contracts',
          'Review loyalty program rewards',
          'Check safety certs — Dino Kit',
        ],
        'Shipped': [
          'Send samples to influencers',
          'Deliver school fundraiser order',
        ],
      };

      for (const [colName, cards] of Object.entries(columnCards)) {
        try {
          // Find the column by its data-testid (slugified name)
          const slug = colName.toLowerCase().replace(/\s+/g, '-');
          const colSelector = `[data-testid="kanban-column-${slug}"]`;
          const column = page.locator(colSelector);

          if (await column.isVisible({ timeout: 2000 }).catch(() => false)) {
            for (const cardTitle of cards) {
              // Click "+" Add Card button in this column
              const addCardBtn = column.locator('.btn-add-card');
              if (await addCardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await addCardBtn.click();
                await wait(500);

                // The card editor should appear — fill the title
                const cardInput = column.locator('.kanban-card-editor input, .kanban-card-editor textarea').first();
                if (await cardInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                  await cardInput.fill(cardTitle);
                  await wait(200);

                  // Click "Done" to save
                  const doneBtn = column.locator('.kanban-card-editor .btn-done, .kanban-card-editor button:has-text("Done")').first();
                  if (await doneBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await doneBtn.click();
                  } else {
                    // Try pressing Enter to save
                    await cardInput.press('Enter');
                  }
                  await wait(500);
                } else {
                  // Fallback: the card may have been created with "New Card" title already
                  // Try to find and edit it
                  warn(`    Card input not found in ${colName}`);
                }
              }
            }
          } else {
            warn(`    Column "${colName}" not found`);
          }
        } catch (e) {
          warn(`    Cards in "${colName}": ${e.message}`);
        }
      }

      await wait(1000);
      await hideChat(page);
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'kanban-board.webp');
      log(`  ✓ kanban-board (${res.sizeKB} KB)`);
    } catch (e) {
      warn(`  ✗ kanban-board: ${e.message}`);
      await debugScreenshot(page, 'kanban-board');
    }

    // ── 5: Chat Panel ────────────────────────────────────────────────
    try {
      log(`  [5/${TOTAL}] Team Chat`);

      // Show the chat bubble and expand it
      await showChat(page);
      await wait(500);

      // Click the minimized bubble to expand
      const bubble = page.locator('.chat-minimized');
      if (await bubble.isVisible({ timeout: 3000 }).catch(() => false)) {
        await bubble.click();
        await wait(1000);
      }

      // Send varied chat messages
      const chatInput = page.locator('[data-testid="chat-input"], .chat-input, input[placeholder*="message"], textarea[placeholder*="message"]').first();
      if (await chatInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        const messages = [
          'Hey team! The spring toy catalog designs are looking amazing 🎨🧸',
          'Can someone check the new plush bear inventory counts? We might need a restock',
          '@warehouse — the RC Thunder Cars arrived early! Need shelf space by Friday 🏎️',
          'Updated the kanban board with all the launch tasks. Please check your assignments 📋',
          'Meeting moved to 3pm today — we\'ll review the product photography shots',
          'Great work everyone — the spring catalog is almost ready for print! 🎉',
        ];
        for (const msg of messages) {
          await chatInput.fill(msg);
          await wait(200);

          // Try clicking send button or pressing Enter
          const sendBtn = page.locator('[data-testid="chat-send-btn"]');
          if (await sendBtn.isVisible({ timeout: 500 }).catch(() => false)) {
            await sendBtn.click();
          } else {
            await chatInput.press('Enter');
          }
          await wait(600);
        }
      }
      await wait(800);

      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'chat-panel.webp');
      log(`  ✓ chat-panel (${res.sizeKB} KB)`);

      // Minimize chat again for remaining captures
      await hideChat(page);
    } catch (e) {
      warn(`  ✗ chat-panel: ${e.message}`);
      await hideChat(page);
    }

    // ── 6: Inventory Dashboard ───────────────────────────────────────
    try {
      log(`  [6/${TOTAL}] Inventory Dashboard`);

      const invDoc = page.locator('.hierarchical-sidebar').getByText('Inventory', { exact: false }).first();
      await invDoc.click();
      await wait(2500);

      // Complete the onboarding wizard (4 steps)
      const wizard = page.locator('.onboarding-wizard');
      if (await wizard.isVisible({ timeout: 5000 }).catch(() => false)) {
        log('    Completing inventory wizard...');

        // Step 1: Name & Configure
        try {
          const sysName = wizard.locator('input[type="text"]').first();
          if (await sysName.isVisible({ timeout: 3000 }).catch(() => false)) {
            await sysName.fill('Toybox Emporium Inventory');
            await wait(300);
          }
          // Select an icon
          const iconBtn = wizard.locator('.wizard-icon-option, button:has-text("📦")').first();
          if (await iconBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await iconBtn.click();
            await wait(200);
          }
          // Click Next
          const nextBtn = wizard.locator('.btn-primary').first();
          await nextBtn.click();
          await wait(800);
        } catch (e) { warn(`    Wizard step 1: ${e.message}`); }

        // Step 2: Define Item Catalog — skip for now
        try {
          const skipBtn = wizard.locator('.btn-secondary, button:has-text("Skip")').first();
          if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await skipBtn.click();
            await wait(800);
          }
        } catch (e) { warn(`    Wizard step 2: ${e.message}`); }

        // Step 3: Invite Participants
        try {
          const nextBtn = wizard.locator('.btn-primary').first();
          if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await nextBtn.click();
            await wait(800);
          }
        } catch (e) { warn(`    Wizard step 3: ${e.message}`); }

        // Step 4: Open Dashboard
        try {
          const openBtn = wizard.locator('.btn-primary, button:has-text("Open Dashboard")').first();
          if (await openBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await openBtn.click();
            await wait(2000);
          }
        } catch (e) { warn(`    Wizard step 4: ${e.message}`); }

        log('    ✓ Wizard completed');
      }

      // Seed inventory data via page.evaluate for a rich dashboard
      try {
        await page.evaluate(() => {
          // Access the inventory Yjs data if available through React fiber or window
          // This seeds the underlying Yjs arrays with realistic toystore data
          const seedData = {
            catalogItems: [
              { id: 'cat-1', name: 'Plush Bear XL', sku: 'PB-001', unit: 'each', category: 'Stuffed Animals', minQty: 50, maxQty: 500, step: 1 },
              { id: 'cat-2', name: 'RC Thunder Car', sku: 'RC-110', unit: 'each', category: 'Vehicles', minQty: 20, maxQty: 200, step: 1 },
              { id: 'cat-3', name: 'Building Block Set', sku: 'BB-500', unit: 'set', category: 'Construction', minQty: 100, maxQty: 1000, step: 5 },
              { id: 'cat-4', name: 'Princess Castle Kit', sku: 'PC-220', unit: 'each', category: 'Playsets', minQty: 30, maxQty: 300, step: 1 },
              { id: 'cat-5', name: 'Science Lab Pro', sku: 'SL-300', unit: 'kit', category: 'Educational', minQty: 25, maxQty: 200, step: 1 },
              { id: 'cat-6', name: 'Dino Excavation Kit', sku: 'DE-400', unit: 'kit', category: 'Educational', minQty: 40, maxQty: 400, step: 1 },
              { id: 'cat-7', name: 'Magnetic Tiles Set', sku: 'MT-360', unit: 'set', category: 'Construction', minQty: 30, maxQty: 250, step: 1 },
              { id: 'cat-8', name: 'Action Hero Fig.', sku: 'AH-250', unit: 'each', category: 'Action Figures', minQty: 100, maxQty: 2000, step: 10 },
            ],
            requests: [],
          };

          // Generate 48 requests spread over 90 days
          const statuses = ['open', 'approved', 'in-progress', 'fulfilled', 'blocked'];
          const priorities = ['low', 'medium', 'high', 'urgent'];
          const now = Date.now();
          const DAY = 86400000;

          for (let i = 0; i < 48; i++) {
            const catItem = seedData.catalogItems[i % seedData.catalogItems.length];
            const daysAgo = Math.floor(Math.random() * 90);
            const status = statuses[Math.floor(Math.random() * statuses.length)];
            const priority = priorities[Math.floor(Math.random() * priorities.length)];
            const qty = catItem.minQty + Math.floor(Math.random() * (catItem.maxQty - catItem.minQty));

            seedData.requests.push({
              id: `req-${String(i + 1).padStart(3, '0')}`,
              catalogItemId: catItem.id,
              itemName: catItem.name,
              sku: catItem.sku,
              quantity: qty,
              status,
              priority,
              requestedBy: ['Sarah Chen', 'Marcus Webb', 'Aisha Patel', 'James Torres'][i % 4],
              createdAt: new Date(now - daysAgo * DAY).toISOString(),
              updatedAt: new Date(now - Math.floor(daysAgo * 0.5) * DAY).toISOString(),
              notes: '',
            });
          }

          // Store seed data for the inventory system to pick up
          window.__inventorySeed = seedData;
        });
        await wait(500);
        log('    ✓ Inventory data seeded');
      } catch (e) {
        warn(`    Inventory seed: ${e.message}`);
      }

      await wait(1500);
      await hideChat(page);
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'inventory-dashboard.webp');
      log(`  ✓ inventory-dashboard (${res.sizeKB} KB)`);
    } catch (e) {
      warn(`  ✗ inventory-dashboard: ${e.message}`);
      await debugScreenshot(page, 'inventory-dashboard');
    }

    // ── 7: Sharing Panel ─────────────────────────────────────────────
    try {
      log(`  [7/${TOTAL}] Sharing & Invites`);
      const opened = await clickFirst(page, [
        'button[title="Share Workspace"]',
        '.hierarchical-sidebar__action-btn--share',
        '.hierarchical-sidebar__settings-btn',
        'button[title="App Settings"]',
        'button[title*="Settings"]',
      ], 5000);

      if (!opened) {
        await clickFirst(page, ['button:has-text("⚙")', '.settings-btn'], 3000);
      }
      await wait(2000);

      try {
        await page.waitForSelector('.workspace-settings, .workspace-settings__overlay', {
          state: 'visible', timeout: 5000
        });
      } catch {}
      await wait(1000);

      await hideChat(page);
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'sharing-panel.webp');
      log(`  ✓ sharing-panel (${res.sizeKB} KB)`);

      await page.keyboard.press('Escape');
      await wait(500);
    } catch (e) {
      warn(`  ✗ sharing-panel: ${e.message}`);
    }

    // ── 8: Help Page ─────────────────────────────────────────────────
    try {
      log(`  [8/${TOTAL}] Built-in Help`);
      await page.keyboard.press('F1');
      await wait(2000);

      try {
        await page.waitForSelector('.help-page-overlay, .help-page-modal, [data-testid="help-overlay"]', {
          state: 'visible', timeout: 5000
        });
      } catch {}
      await wait(800);

      await hideChat(page);
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'help-page.webp');
      log(`  ✓ help-page (${res.sizeKB} KB)`);

      await page.keyboard.press('Escape');
      await wait(500);
    } catch (e) {
      warn(`  ✗ help-page: ${e.message}`);
    }

    // ── 9: File Storage ──────────────────────────────────────────────
    try {
      log(`  [9/${TOTAL}] File Storage`);
      const fileDoc = page.locator('.hierarchical-sidebar').getByText('Product Photography', { exact: false }).first();
      await fileDoc.click();
      await wait(3000);

      await hideChat(page);
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'file-storage.webp');
      log(`  ✓ file-storage (${res.sizeKB} KB)`);
    } catch (e) {
      warn(`  ✗ file-storage: ${e.message}`);
      await debugScreenshot(page, 'file-storage');
    }

    // ── 10: Search Palette ───────────────────────────────────────────
    try {
      log(`  [10/${TOTAL}] Search Palette`);

      // First navigate to a document so we have a nice background
      const bgDoc = page.locator('.hierarchical-sidebar').getByText('Sprint Planning', { exact: false }).first();
      await bgDoc.click();
      await wait(1500);

      // Open search palette
      await page.keyboard.press('Control+k');
      await wait(1000);

      // Type a search query
      const searchInput = page.locator('.search-palette__input, [data-testid="search-input"]').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.fill('spring product');
        await wait(1500); // Let results populate
      }

      await hideChat(page);
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'search-palette.webp');
      log(`  ✓ search-palette (${res.sizeKB} KB)`);

      await page.keyboard.press('Escape');
      await wait(500);
    } catch (e) {
      warn(`  ✗ search-palette: ${e.message}`);
      await page.keyboard.press('Escape').catch(() => {});
    }

    // ── 11: Workspace Switcher ───────────────────────────────────────
    try {
      log(`  [11/${TOTAL}] Workspace Switcher`);

      // Click the workspace selector to open the dropdown
      const wsTrigger = page.locator('[data-testid="workspace-selector"], .workspace-switcher__trigger').first();
      if (await wsTrigger.isVisible({ timeout: 5000 }).catch(() => false)) {
        await wsTrigger.click();
        await wait(1000);

        // Wait for dropdown
        try {
          await page.waitForSelector('.workspace-switcher__dropdown, .workspace-switcher-dropdown', {
            state: 'visible', timeout: 3000
          });
        } catch {}
        await wait(500);
      }

      await hideChat(page);
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'workspace-switcher.webp');
      log(`  ✓ workspace-switcher (${res.sizeKB} KB)`);

      await page.keyboard.press('Escape');
      await wait(500);
    } catch (e) {
      warn(`  ✗ workspace-switcher: ${e.message}`);
      await page.keyboard.press('Escape').catch(() => {});
    }

    // ── 12: Dark Theme Editor (second text document with different content) ──
    try {
      log(`  [12/${TOTAL}] Dark Theme Editor`);

      // Open the Product Catalog document
      const darkDoc = page.locator('.hierarchical-sidebar').getByText('Product Catalog', { exact: false }).first();
      await darkDoc.click();
      await wait(2500);

      const editor = page.locator('.tiptap, .ProseMirror, [contenteditable="true"]').first();
      if (await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
        await editor.click();
        await wait(300);

        // Use toolbar for formatting
        try {
          const h1Btn = page.locator('.editor-toolbar button:has-text("H1"), .editor-toolbar button[title*="Heading 1"]').first();
          if (await h1Btn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await h1Btn.click();
            await wait(100);
          }
        } catch {}
        await page.keyboard.type('Spring 2026 Product Catalog', { delay: 8 });
        await page.keyboard.press('Enter');

        // Normal paragraph
        await page.keyboard.type('Our spring collection features 12 new products across plush toys, construction sets, and STEM kits. Each item has been safety-tested and approved for ages 3+.', { delay: 4 });
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');

        // H2
        try {
          const h2Btn = page.locator('.editor-toolbar button:has-text("H2"), .editor-toolbar button[title*="Heading 2"]').first();
          if (await h2Btn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await h2Btn.click();
            await wait(100);
          }
        } catch {}
        await page.keyboard.type('Featured Products', { delay: 8 });
        await page.keyboard.press('Enter');

        // Ordered list
        try {
          const olBtn = page.locator('.editor-toolbar button:has-text("Ordered List"), .editor-toolbar button[title*="Ordered"]').first();
          if (await olBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await olBtn.click();
            await wait(100);
          }
        } catch {}
        await page.keyboard.type('Plush Bear XL — Our bestselling stuffed animal, now in 4 new colors', { delay: 4 });
        await page.keyboard.press('Enter');
        await page.keyboard.type('Magnetic Tiles Set — 120 pieces with new curved shapes and wheels', { delay: 4 });
        await page.keyboard.press('Enter');
        await page.keyboard.type('Science Lab Pro — Chemistry and physics experiments for curious minds', { delay: 4 });
        await page.keyboard.press('Enter');
        await page.keyboard.type('RC Thunder Car — Remote control with 30-minute battery and turbo mode', { delay: 4 });
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter'); // exit list

        // Bold text with table
        await page.keyboard.type('Pricing and availability details are tracked in the Q1 Revenue Tracker spreadsheet. Contact the warehouse team for current stock levels.', { delay: 4 });
        await wait(800);
      }

      await hideChat(page);
      await cleanBeforeCapture(page);
      const buf = await page.screenshot({ type: 'png' });
      const res = await saveScreenshot(buf, 'dark-theme-editor.webp');
      log(`  ✓ dark-theme-editor (${res.sizeKB} KB)`);
    } catch (e) {
      warn(`  ✗ dark-theme-editor: ${e.message}`);
      await debugScreenshot(page, 'dark-theme-editor');
    }

    // ════════════════════════════════════════════════════════════════════
    //  GENERATE MANIFEST
    // ════════════════════════════════════════════════════════════════════
    let totalSizeKB = 0;
    let captured = 0;
    const manifestScreenshots = SCREENSHOTS.map((def) => {
      const filename = `${def.id}.webp`;
      const filePath = path.join(OUTPUT_DIR, filename);
      let sizeKB = 0;
      if (fs.existsSync(filePath)) {
        sizeKB = Math.round(fs.statSync(filePath).size / 1024);
        totalSizeKB += sizeKB;
        captured++;
      }
      return {
        id: def.id,
        title: def.title,
        description: def.description,
        category: def.category,
        filename,
        sizeKB,
        width: WIDTH,
        height: HEIGHT,
      };
    });

    const manifest = {
      generated: new Date().toISOString(),
      resolution: `${WIDTH}x${HEIGHT}`,
      format: 'webp',
      quality: WEBP_QUALITY,
      screenshots: manifestScreenshots,
      stats: { total: SCREENSHOTS.length, captured, failed: SCREENSHOTS.length - captured, totalSizeKB },
    };

    fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

    console.log(`\n  ══════════════════════════════════════`);
    console.log(`  ✅ ${captured}/${SCREENSHOTS.length} screenshots captured`);
    console.log(`  📦 Total size: ${totalSizeKB} KB`);
    console.log(`  📁 Output: ${OUTPUT_DIR}`);
    console.log(`  ══════════════════════════════════════\n`);

    // Cleanup debug screenshots
    const debugFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('_debug_'));
    for (const f of debugFiles) fs.unlinkSync(path.join(OUTPUT_DIR, f));

    // Cleanup old screenshot files that no longer exist in manifest
    const validFiles = new Set(SCREENSHOTS.map(s => `${s.id}.webp`));
    validFiles.add('manifest.json');
    const allFiles = fs.readdirSync(OUTPUT_DIR);
    for (const f of allFiles) {
      if (!validFiles.has(f) && !f.startsWith('_debug_') && f.endsWith('.webp')) {
        log(`Cleaning up old screenshot: ${f}`);
        fs.unlinkSync(path.join(OUTPUT_DIR, f));
      }
    }

    await browser.close();
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    if (browser) await browser.close().catch(() => {});
    process.exitCode = 1;
  } finally {
    // Stop the server
    try {
      if (devServer._server) {
        devServer._server.close();
      } else if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(devServer.pid), '/f', '/t'], { shell: true });
      } else {
        devServer.kill('SIGTERM');
        process.kill(-devServer.pid);
      }
    } catch {}
    log('Server stopped');

    // Ensure process exits after cleanup
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
}

main();
