#!/usr/bin/env node
/**
 * capture-screenshots.js — Automated screenshot capture pipeline for Nightjar
 * 
 * Launches the Electron app pointed at a seeded demo workspace, navigates to
 * each major screen, and captures 1920×1080 screenshots compressed to WebP.
 * 
 * Prerequisites:
 *   - Demo data must exist (run seed-demo-workspace.js first)
 *   - The app must be built (npm run build)
 * 
 * Usage:
 *   node scripts/capture-screenshots.js [--demo-dir <path>] [--output-dir <path>]
 *   npm run screenshots
 * 
 * Output:
 *   frontend/public-site/screenshots/*.webp
 *   frontend/public-site/screenshots/manifest.json
 */

const { _electron: electron } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

// Optional: sharp for WebP compression (falls back to PNG if unavailable)
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DEMO_DIR = path.join(PROJECT_ROOT, 'demo-data');
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend', 'public-site', 'screenshots');
const MAIN_JS = path.join(PROJECT_ROOT, 'src', 'main.js');
const SIDECAR_PATH = path.join(PROJECT_ROOT, 'sidecar', 'index.js');
const ELECTRON_PATH = require.resolve('electron/cli');

const WIDTH = 1920;
const HEIGHT = 1080;
const WEBP_QUALITY = 85;

// Sidecar ports for screenshot session
const PORTS = {
  YJS: 9780,
  META: 9781,
  WSS: 9743,
};

// ── Screenshot definitions ──────────────────────────────────────────────────
// Each entry describes a screen to capture and how to navigate there
const SCREENSHOTS = [
  {
    id: 'workspace-overview',
    title: 'Workspace Overview',
    description: 'Sidebar with folders and documents, workspace tree expanded',
    category: 'workspaces',
    actions: async (page) => {
      // Wait for the workspace to load and sidebar to populate
      await page.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'text-editor',
    title: 'Rich Text Editor',
    description: 'TipTap editor with formatted content, toolbar visible',
    category: 'documents',
    actions: async (page) => {
      // Click on a text document in the sidebar
      await page.click('text=Product Catalog').catch(() => {});
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'spreadsheet',
    title: 'Spreadsheet View',
    description: 'Fortune Sheet with data, formulas, and formatting',
    category: 'documents',
    actions: async (page) => {
      await page.click('text=Q1 Revenue').catch(() => {});
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'kanban-board',
    title: 'Kanban Board',
    description: 'Kanban board with columns and cards',
    category: 'documents',
    actions: async (page) => {
      await page.click('text=Spring Product Launch').catch(() => {});
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'chat-panel',
    title: 'Team Chat',
    description: 'Chat panel open with messages',
    category: 'collaboration',
    actions: async (page) => {
      // Open chat panel
      await page.click('[data-testid="chat-toggle"]').catch(() =>
        page.click('button:has-text("Chat")').catch(() => {})
      );
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'inventory-list',
    title: 'Inventory Management',
    description: 'Inventory list with items, search, and filters',
    category: 'inventory',
    actions: async (page) => {
      await page.click('text=Inventory').catch(() => {});
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'inventory-map',
    title: 'Inventory Map View',
    description: 'Geographic distribution of inventory across US states',
    category: 'inventory',
    actions: async (page) => {
      await page.click('[data-testid="inventory-map-tab"]').catch(() =>
        page.click('text=Map').catch(() => {})
      );
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'file-storage',
    title: 'File Storage',
    description: 'Encrypted file storage with folder organization',
    category: 'files',
    actions: async (page) => {
      await page.click('text=Files').catch(() => {});
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'sharing-panel',
    title: 'Sharing & Invites',
    description: 'Share dialog with QR code and invite link',
    category: 'sharing',
    actions: async (page) => {
      await page.click('[data-testid="share-button"]').catch(() =>
        page.click('text=Share').catch(() => {})
      );
      await page.waitForTimeout(1500);
    },
  },
  {
    id: 'settings',
    title: 'Application Settings',
    description: 'Settings panel with theme, network, and security options',
    category: 'settings',
    actions: async (page) => {
      await page.click('[data-testid="settings-button"]').catch(() =>
        page.click('text=Settings').catch(() => {})
      );
      await page.waitForTimeout(1500);
    },
  },
  {
    id: 'search-palette',
    title: 'Search Palette',
    description: 'Quick search palette for navigating documents',
    category: 'navigation',
    actions: async (page) => {
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(1000);
    },
  },
  {
    id: 'identity-profile',
    title: 'Identity & Profile',
    description: 'User profile with avatar, display name, and recovery phrase option',
    category: 'identity',
    actions: async (page) => {
      await page.click('[data-testid="profile-button"]').catch(() =>
        page.click('[data-testid="avatar"]').catch(() => {})
      );
      await page.waitForTimeout(1500);
    },
  },
  {
    id: 'dark-theme',
    title: 'Dark Theme',
    description: 'Full application view in dark theme',
    category: 'themes',
    actions: async (page) => {
      // Already dark by default, just ensure we're on workspace view
      await page.keyboard.press('Escape'); // Close any dialogs
      await page.waitForTimeout(1000);
    },
  },
  {
    id: 'collaboration-cursors',
    title: 'Real-Time Collaboration',
    description: 'Multiple colored cursors showing collaborative editing',
    category: 'collaboration',
    actions: async (page) => {
      // Navigate to a text doc
      await page.click('text=Product Catalog').catch(() => {});
      await page.waitForTimeout(2000);
    },
  },
  {
    id: 'help-page',
    title: 'Help & Documentation',
    description: 'Built-in help overlay with table of contents',
    category: 'navigation',
    actions: async (page) => {
      await page.keyboard.press('F1');
      await page.waitForTimeout(1500);
    },
  },
];

// ── Utility functions ───────────────────────────────────────────────────────
async function isPortAvailable(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}

async function waitForPort(port, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1');
        sock.once('connect', () => { sock.destroy(); resolve(); });
        sock.once('error', reject);
        sock.setTimeout(1000, () => { sock.destroy(); reject(); });
      });
      return true;
    } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  return false;
}

async function compressToWebP(pngBuffer, outputPath) {
  if (sharp) {
    await sharp(pngBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'contain', background: { r: 15, g: 17, b: 23, alpha: 1 } })
      .webp({ quality: WEBP_QUALITY })
      .toFile(outputPath);
    return outputPath;
  }
  // Fallback: save as PNG
  const pngPath = outputPath.replace(/\.webp$/, '.png');
  fs.writeFileSync(pngPath, pngBuffer);
  return pngPath;
}

// ── Main capture function ───────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const demoDir = args.includes('--demo-dir')
    ? args[args.indexOf('--demo-dir') + 1]
    : DEFAULT_DEMO_DIR;
  const outputDir = args.includes('--output-dir')
    ? args[args.indexOf('--output-dir') + 1]
    : DEFAULT_OUTPUT_DIR;

  console.log('📸 Nightjar Screenshot Capture');
  console.log('==============================');
  console.log(`Demo data: ${demoDir}`);
  console.log(`Output: ${outputDir}`);

  // Validate demo data exists
  if (!fs.existsSync(demoDir)) {
    console.error('❌ Demo data not found. Run seed-demo-workspace.js first.');
    process.exit(1);
  }

  // Prepare output directory
  fs.mkdirSync(outputDir, { recursive: true });

  // Check port availability
  for (const [name, port] of Object.entries(PORTS)) {
    if (!(await isPortAvailable(port))) {
      console.error(`❌ Port ${port} (${name}) is in use.`);
      process.exit(1);
    }
  }

  // Start sidecar with demo data
  console.log('\n📡 Starting sidecar with demo data...');
  const isWindows = process.platform === 'win32';
  // Quote paths on Windows to handle spaces in directory names
  const sidecarArg = isWindows ? `"${SIDECAR_PATH}"` : SIDECAR_PATH;
  const demoDirArg = isWindows ? `"${demoDir}"` : demoDir;
  const sidecar = spawn('node', [sidecarArg, demoDirArg], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NIGHTJAR_MESH: 'false',
      NIGHTJAR_UPNP: 'false',
      P2P_INIT_MAX_ATTEMPTS: '2',
      P2P_INIT_RETRY_INTERVAL_MS: '1000',
      YJS_WEBSOCKET_PORT: String(PORTS.YJS),
      METADATA_WEBSOCKET_PORT: String(PORTS.META),
      YJS_WEBSOCKET_SECURE_PORT: String(PORTS.WSS),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWindows,
  });

  let sidecarReady = false;
  sidecar.stdout.on('data', d => {
    if (d.toString().includes('Startup complete')) sidecarReady = true;
  });
  sidecar.stderr.on('data', () => {}); // Suppress warnings

  const startTime = Date.now();
  while (!sidecarReady && Date.now() - startTime < 60000) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (!sidecarReady) {
    console.error('❌ Sidecar failed to start.');
    sidecar.kill();
    process.exit(1);
  }
  console.log('  ✅ Sidecar ready');

  // Launch Electron app via Playwright
  console.log('\n🖥️ Launching Electron app...');
  let electronApp;
  try {
    electronApp = await electron.launch({
      executablePath: ELECTRON_PATH,
      args: [MAIN_JS],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        NIGHTJAR_DEMO_MODE: 'true',
        NIGHTJAR_DEMO_DATA: demoDir,
        NIGHTJAR_MESH: 'false',
        NIGHTJAR_UPNP: 'false',
        YJS_WEBSOCKET_PORT: String(PORTS.YJS),
        METADATA_WEBSOCKET_PORT: String(PORTS.META),
        YJS_WEBSOCKET_SECURE_PORT: String(PORTS.WSS),
      },
    });
  } catch (err) {
    console.error('❌ Failed to launch Electron:', err.message);
    sidecar.kill();
    process.exit(1);
  }

  const page = await electronApp.firstWindow();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  console.log('  ✅ Electron window ready');

  // Wait for app to fully load
  await page.waitForTimeout(5000);

  // Capture screenshots
  const manifest = [];
  console.log(`\n📷 Capturing ${SCREENSHOTS.length} screenshots...\n`);

  for (const shot of SCREENSHOTS) {
    process.stdout.write(`  ${shot.id}...`);
    try {
      // Run navigation actions
      await shot.actions(page);

      // Capture PNG buffer
      const pngBuffer = await page.screenshot({ type: 'png' });

      // Compress to WebP
      const filename = `${shot.id}.webp`;
      const outputPath = path.join(outputDir, filename);
      const savedPath = await compressToWebP(pngBuffer, outputPath);
      const finalFilename = path.basename(savedPath);

      const stats = fs.statSync(savedPath);
      manifest.push({
        id: shot.id,
        title: shot.title,
        description: shot.description,
        category: shot.category,
        filename: finalFilename,
        sizeKB: Math.round(stats.size / 1024),
        width: WIDTH,
        height: HEIGHT,
      });

      console.log(` ✅ (${Math.round(stats.size / 1024)}KB)`);
    } catch (err) {
      console.log(` ⚠️ ${err.message}`);
      manifest.push({
        id: shot.id,
        title: shot.title,
        description: shot.description,
        category: shot.category,
        filename: null,
        error: err.message,
      });
    }
  }

  // Write manifest
  const manifestData = {
    generated: new Date().toISOString(),
    resolution: `${WIDTH}x${HEIGHT}`,
    format: sharp ? 'webp' : 'png',
    quality: sharp ? WEBP_QUALITY : 'lossless',
    screenshots: manifest,
    stats: {
      total: manifest.length,
      captured: manifest.filter(s => s.filename).length,
      failed: manifest.filter(s => !s.filename).length,
      totalSizeKB: manifest.reduce((sum, s) => sum + (s.sizeKB || 0), 0),
    },
  };
  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifestData, null, 2)
  );

  // Cleanup
  console.log('\n🧹 Cleaning up...');
  await electronApp.close();
  if (process.platform === 'win32') {
    try { require('child_process').execSync(`taskkill /pid ${sidecar.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  } else {
    sidecar.kill('SIGTERM');
  }
  await new Promise(r => setTimeout(r, 2000));

  console.log(`\n✅ Screenshot capture complete!`);
  console.log(`   ${manifestData.stats.captured}/${manifestData.stats.total} captured`);
  console.log(`   Total size: ${manifestData.stats.totalSizeKB}KB`);
  console.log(`   Output: ${outputDir}`);
}

main().catch(err => {
  console.error('❌ Capture failed:', err);
  process.exit(1);
});
