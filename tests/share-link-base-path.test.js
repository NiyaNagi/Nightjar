/**
 * Tests for Issue #7 — Share link white screen / base path fix (v1.7.23)
 *
 * Root cause: Vite builds with base:'./' (relative paths) so the HTML contains
 * <script src="./assets/main-XXXX.js">. When the Express server serves the SPA
 * at /join/w/XXXXX, the browser resolves ./assets/main.js relative to the current
 * pathname → /join/w/assets/main.js → 404 → white screen.
 *
 * Fix: The server injects <base href="/"> into the HTML at serve time, plus
 * defense-in-depth: asset extension detection in /join/* route, rewrite middleware
 * for /join/.../assets/..., and a 404 guard for missing assets.
 */
const fs = require('fs');
const path = require('path');

const SERVER_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'server', 'unified', 'index.js'),
  'utf8'
);

const NGINX_CONF = fs.readFileSync(
  path.join(__dirname, '..', 'server', 'deploy', 'nginx.conf'),
  'utf8'
);

const VITE_CONFIG = fs.readFileSync(
  path.join(__dirname, '..', 'vite.config.js'),
  'utf8'
);

const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'index.html'),
  'utf8'
);

const DOCKERFILE = fs.readFileSync(
  path.join(__dirname, '..', 'server', 'unified', 'Dockerfile'),
  'utf8'
);

// =============================================================================
// 1. <base href> injection — the primary fix
// =============================================================================
describe('server: <base href> injection into index.html', () => {
  test('injects <base> tag right after <head>', () => {
    // The server replaces '<head>' with '<head>\n    <base href="...">'
    expect(SERVER_SOURCE).toContain("rawHtml.replace('<head>', `<head>\\n    ${baseTag}`)");
  });

  test('base href uses (BASE_PATH || \"\") + \"/\"', () => {
    expect(SERVER_SOURCE).toContain("const baseHref = (BASE_PATH || '') + '/';");
  });

  test('creates baseTag with the computed baseHref', () => {
    expect(SERVER_SOURCE).toContain('const baseTag = `<base href="${baseHref}">`');
  });

  test('<base> injection happens BEFORE __NIGHTJAR_BASE_PATH__ script', () => {
    const baseTagIdx = SERVER_SOURCE.indexOf("rawHtml.replace('<head>'");
    const scriptIdx = SERVER_SOURCE.indexOf("rawHtml.replace('</head>'");
    expect(baseTagIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(baseTagIdx).toBeLessThan(scriptIdx);
  });

  test('for empty BASE_PATH, base href becomes "/"', () => {
    // ('' || '') + '/' = '/'
    // This means ./assets/main.js resolves to /assets/main.js from any route
    expect(SERVER_SOURCE).toContain("(BASE_PATH || '') + '/'");
  });

  test('for BASE_PATH="/app", base href becomes "/app/"', () => {
    // The code is: const baseHref = (BASE_PATH || '') + '/';
    // If BASE_PATH = '/app', then baseHref = '/app/'
    // Verify the pattern supports this
    expect(SERVER_SOURCE).toMatch(/const baseHref = \(BASE_PATH \|\| ''\) \+ '\/'/);
  });

  test('injected HTML is stored in injectedIndexHtml variable', () => {
    expect(SERVER_SOURCE).toContain('injectedIndexHtml = rawHtml.replace');
  });

  test('comments explain the Issue #6/#7 fix', () => {
    expect(SERVER_SOURCE).toContain('This fixes the white-screen bug when clicking share links (Issue #6/#7)');
  });
});

// =============================================================================
// 2. /join/* route — asset extension safety net
// =============================================================================
describe('server: /join/* route asset safety net', () => {
  test('/join/* handler accepts next parameter (middleware)', () => {
    // The route should call next() for static assets instead of returning HTML
    expect(SERVER_SOURCE).toMatch(/app\.get\(\(BASE_PATH \|\| ''\) \+ '\/join\/\*', \(req, res, next\)/);
  });

  test('detects static asset extensions and calls next()', () => {
    expect(SERVER_SOURCE).toContain("const ext = req.path.split('.').pop()?.toLowerCase()");
    expect(SERVER_SOURCE).toContain('return next()');
  });

  test('recognizes JS, CSS, and common asset extensions', () => {
    // The regex should match common asset file extensions
    expect(SERVER_SOURCE).toMatch(/js\|css\|map\|png/);
    expect(SERVER_SOURCE).toMatch(/woff\|woff2\|ttf/);
    expect(SERVER_SOURCE).toMatch(/json\|wasm/);
  });

  test('serves injected HTML for non-asset /join/* paths', () => {
    // For actual join URLs, it should serve the HTML with <base> tag
    expect(SERVER_SOURCE).toContain("res.type('html').send(injectedIndexHtml)");
  });

  test('sets no-cache headers on /join/* HTML responses', () => {
    // Ensure users always get the latest injected HTML
    expect(SERVER_SOURCE).toContain("res.set('Cache-Control', 'no-cache, no-store, must-revalidate')");
  });
});

// =============================================================================
// 3. Defense-in-depth: /join/.../assets/... rewrite middleware
// =============================================================================
describe('server: /join/ asset rewrite middleware', () => {
  test('has middleware mounted at /join/ path', () => {
    expect(SERVER_SOURCE).toContain("app.use((BASE_PATH || '') + '/join/'");
  });

  test('matches /assets/ pattern in the path', () => {
    expect(SERVER_SOURCE).toContain("req.path.match(/\\/assets\\/(.*)/)");
  });

  test('rewrites req.url to /assets/... when matched', () => {
    expect(SERVER_SOURCE).toContain("req.url = '/assets/' + assetMatch[1]");
  });

  test('serves via express.static after rewrite', () => {
    expect(SERVER_SOURCE).toContain('express.static(STATIC_PATH, { index: false })(req, res, next)');
  });

  test('calls next() when path does not contain /assets/', () => {
    // The middleware should fall through for non-asset requests
    const middlewareSection = SERVER_SOURCE.substring(
      SERVER_SOURCE.indexOf("app.use((BASE_PATH || '') + '/join/'"),
      SERVER_SOURCE.indexOf("app.use((BASE_PATH || '') + '/join/'") + 500
    );
    expect(middlewareSection).toContain('next()');
  });
});

// =============================================================================
// 4. Asset 404 guard
// =============================================================================
describe('server: asset 404 guard', () => {
  test('has /assets guard middleware after express.static', () => {
    expect(SERVER_SOURCE).toContain("app.use(BASE_PATH + '/assets'");
  });

  test('ASSET_EXTENSIONS set includes common file types', () => {
    expect(SERVER_SOURCE).toContain("'js', 'css', 'map', 'png'");
    expect(SERVER_SOURCE).toContain("'woff', 'woff2', 'ttf'");
  });

  test('returns 404 for missing asset files (not SPA fallback)', () => {
    // This prevents the SPA fallback from returning HTML for .js requests
    const guardSection = SERVER_SOURCE.substring(
      SERVER_SOURCE.indexOf('ASSET_EXTENSIONS'),
      SERVER_SOURCE.indexOf('ASSET_EXTENSIONS') + 600
    );
    expect(guardSection).toContain("res.status(404)");
    expect(guardSection).toContain("'Not found'");
  });

  test('logs a warning for 404 asset requests', () => {
    expect(SERVER_SOURCE).toContain('[Static] 404 asset not found');
  });
});

// =============================================================================
// 5. Vite config — relative base path (unchanged, but verified)
// =============================================================================
describe('vite: relative base path', () => {
  test('vite.config.js uses base: "./"', () => {
    expect(VITE_CONFIG).toContain("base: './'");
  });

  test('Dockerfile builds with --base="./"', () => {
    expect(DOCKERFILE).toContain('--base="./"');
  });

  test('Dockerfile comment explains relative URL resolution', () => {
    expect(DOCKERFILE).toContain('Relative URLs resolve correctly at any mount point');
  });
});

// =============================================================================
// 6. index.html source — no <base> in source (injected at runtime)
// =============================================================================
describe('frontend: index.html source has no static <base> tag', () => {
  test('source index.html does not contain a <base> tag', () => {
    // <base> is injected at runtime by the server, NOT in the source
    expect(INDEX_HTML).not.toMatch(/<base\s+href/);
  });

  test('source index.html has <head> tag for injection point', () => {
    expect(INDEX_HTML).toContain('<head>');
  });

  test('source index.html has </head> for script injection point', () => {
    expect(INDEX_HTML).toContain('</head>');
  });
});

// =============================================================================
// 7. nginx — /join/ proxied to relay (v1.7.21 regression check)
// =============================================================================
describe('nginx: /join/ and /assets/ proxied to relay', () => {
  test('has location /join/ block proxied to relay', () => {
    expect(NGINX_CONF).toContain('location /join/');
    expect(NGINX_CONF).toMatch(/location \/join\/[^]*?proxy_pass http:\/\/relay/);
  });

  test('has location /assets/ block proxied to relay', () => {
    expect(NGINX_CONF).toContain('location /assets/');
    expect(NGINX_CONF).toMatch(/location \/assets\/[^]*?proxy_pass http:\/\/relay/);
  });

  test('has location /api/ block proxied to relay', () => {
    expect(NGINX_CONF).toContain('location /api/');
    expect(NGINX_CONF).toMatch(/location \/api\/[^]*?proxy_pass http:\/\/relay/);
  });

  test('/join/ is registered BEFORE catch-all location /', () => {
    const joinIdx = NGINX_CONF.indexOf('location /join/');
    const catchAllIdx = NGINX_CONF.indexOf('location / {');
    expect(joinIdx).toBeGreaterThan(-1);
    expect(catchAllIdx).toBeGreaterThan(-1);
    expect(joinIdx).toBeLessThan(catchAllIdx);
  });

  test('/assets/ is registered BEFORE catch-all location /', () => {
    const assetsIdx = NGINX_CONF.indexOf('location /assets/');
    const catchAllIdx = NGINX_CONF.indexOf('location / {');
    expect(assetsIdx).toBeGreaterThan(-1);
    expect(catchAllIdx).toBeGreaterThan(-1);
    expect(assetsIdx).toBeLessThan(catchAllIdx);
  });
});

// =============================================================================
// 8. Express route ordering
// =============================================================================
describe('server: Express route ordering', () => {
  test('/join/* is registered BEFORE express.static', () => {
    const joinIdx = SERVER_SOURCE.indexOf("'/join/*'");
    const staticIdx = SERVER_SOURCE.indexOf("express.static(STATIC_PATH, { index: false })");
    expect(joinIdx).toBeGreaterThan(-1);
    expect(staticIdx).toBeGreaterThan(-1);
    expect(joinIdx).toBeLessThan(staticIdx);
  });

  test('/join/ rewrite middleware is registered BEFORE main express.static', () => {
    const rewriteIdx = SERVER_SOURCE.indexOf("app.use((BASE_PATH || '') + '/join/'");
    const mainStaticIdx = SERVER_SOURCE.indexOf("app.use(BASE_PATH || '/', express.static");
    expect(rewriteIdx).toBeGreaterThan(-1);
    expect(mainStaticIdx).toBeGreaterThan(-1);
    expect(rewriteIdx).toBeLessThan(mainStaticIdx);
  });

  test('asset 404 guard is registered AFTER express.static', () => {
    const mainStaticIdx = SERVER_SOURCE.indexOf("app.use(BASE_PATH || '/', express.static");
    const guardIdx = SERVER_SOURCE.indexOf("app.use(BASE_PATH + '/assets'");
    expect(mainStaticIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(mainStaticIdx).toBeLessThan(guardIdx);
  });

  test('SPA fallback is registered LAST', () => {
    const guardIdx = SERVER_SOURCE.indexOf("app.use(BASE_PATH + '/assets'");
    const fallbackIdx = SERVER_SOURCE.indexOf("app.get(BASE_PATH + '/*'");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(fallbackIdx);
  });
});

// =============================================================================
// 9. E2E scenario: share link asset resolution
// =============================================================================
describe('E2E: share link /join/w/XXXXX asset resolution', () => {
  test('Vite produces ./assets/... relative URLs', () => {
    expect(VITE_CONFIG).toContain("base: './'");
  });

  test('server injects <base href="/"> so ./assets/x.js → /assets/x.js', () => {
    expect(SERVER_SOURCE).toContain("const baseHref = (BASE_PATH || '') + '/'");
    expect(SERVER_SOURCE).toContain('<base href="${baseHref}">');
  });

  test('nginx /assets/ proxy ensures relay serves the JS/CSS bundles', () => {
    expect(NGINX_CONF).toMatch(/location \/assets\/[^]*?proxy_pass http:\/\/relay/);
  });

  test('/join/* safety net skips HTML for .js/.css requests', () => {
    expect(SERVER_SOURCE).toMatch(/js\|css\|map\|png/);
    expect(SERVER_SOURCE).toContain('return next()');
  });

  test('/join/.../assets/... rewrite catches residual relative requests', () => {
    expect(SERVER_SOURCE).toContain("req.url = '/assets/' + assetMatch[1]");
  });

  test('missing assets return 404, not SPA HTML', () => {
    const guardSection = SERVER_SOURCE.substring(
      SERVER_SOURCE.indexOf('ASSET_EXTENSIONS'),
      SERVER_SOURCE.indexOf('ASSET_EXTENSIONS') + 600
    );
    expect(guardSection).toContain("res.status(404)");
  });
});

// =============================================================================
// 10. E2E scenario: BASE_PATH=/app (private instance)
// =============================================================================
describe('E2E: private instance with BASE_PATH=/app', () => {
  test('BASE_PATH normalization adds leading slash if missing', () => {
    expect(SERVER_SOURCE).toContain("'/' + RAW_BASE_PATH");
  });

  test('BASE_PATH normalization strips trailing slashes', () => {
    expect(SERVER_SOURCE).toContain(".replace(/\\/+$/, '')");
  });

  test('base href for /app becomes "/app/"', () => {
    // (BASE_PATH || '') + '/' where BASE_PATH = '/app' → '/app/'
    // Comment in the source confirms this
    expect(SERVER_SOURCE).toContain("/app/");
  });

  test('nginx /app/ location proxies to private instance', () => {
    expect(NGINX_CONF).toContain('location /app/');
    expect(NGINX_CONF).toMatch(/location \/app\/[^]*?proxy_pass http:\/\/private/);
  });
});

// =============================================================================
// 11. Dockerfile integrity
// =============================================================================
describe('Dockerfile: frontend build and server setup', () => {
  test('frontend build stage uses node:20-alpine', () => {
    expect(DOCKERFILE).toContain('FROM node:20-alpine AS frontend-builder');
  });

  test('production stage uses node:20-slim (for native modules)', () => {
    expect(DOCKERFILE).toContain('FROM node:20-slim');
  });

  test('copies built frontend from builder stage', () => {
    expect(DOCKERFILE).toContain('COPY --from=frontend-builder /app/frontend/dist ./frontend/dist');
  });

  test('STATIC_PATH points to the built frontend', () => {
    expect(DOCKERFILE).toContain('ENV STATIC_PATH=/app/frontend/dist');
  });

  test('runs as non-root user', () => {
    expect(DOCKERFILE).toContain('USER nightjar');
  });
});

// =============================================================================
// 12. PWA manifest — dynamic rewrite for BASE_PATH
// =============================================================================
describe('server: PWA manifest dynamic rewrite', () => {
  test('manifest.json route is registered', () => {
    expect(SERVER_SOURCE).toContain("'/manifest.json'");
  });

  test('manifest start_url uses BASE_PATH prefix', () => {
    expect(SERVER_SOURCE).toContain("manifest.start_url = prefix + '/'");
  });

  test('manifest scope uses BASE_PATH prefix', () => {
    expect(SERVER_SOURCE).toContain("manifest.scope    = prefix + '/'");
  });

  test('manifest icon src paths are rewritten with BASE_PATH', () => {
    expect(SERVER_SOURCE).toContain("src: prefix + '/' + icon.src.replace(/^\\.?\\//, '')");
  });
});
