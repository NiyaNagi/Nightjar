/**
 * Tests for the shared content JSON files and public site infrastructure.
 *
 * Covers:
 *  - Content JSON schema validation (all 19 section files + index.json)
 *  - Block-type validation within each content file
 *  - Section ordering and uniqueness
 *  - Landing page HTML structure
 *  - Docs wiki HTML structure (hub, template, section files)
 *  - Content integrity between index.json and individual section files
 *  - HelpPage JSX shared-content import verification
 */

import fs from 'fs';
import path from 'path';

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'frontend', 'public-site', 'content');
const DOCS_DIR = path.join(ROOT, 'frontend', 'public-site', 'docs');
const LANDING_PAGE = path.join(ROOT, 'frontend', 'public-site', 'index.html');
const HELP_PAGE_JSX = path.join(ROOT, 'frontend', 'src', 'components', 'common', 'HelpPage.jsx');

const VALID_BLOCK_TYPES = ['heading', 'paragraph', 'list', 'steps', 'tip', 'shortcuts', 'screenshot', 'mermaid', 'code'];

const SECTION_IDS = [
  'getting-started', 'identity', 'workspaces', 'documents', 'editor',
  'kanban', 'collaboration', 'sharing', 'chat', 'files',
  'inventory', 'search', 'shortcuts', 'networking', 'troubleshooting',
  'self-hosting', 'architecture', 'security-model', 'changelog',
];

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ============================================================
// 1. Content JSON Files — Schema Validation
// ============================================================

describe('Content JSON Files — Schema', () => {
  test('content directory exists', () => {
    expect(fs.existsSync(CONTENT_DIR)).toBe(true);
  });

  test('index.json exists and is valid JSON', () => {
    const indexPath = path.join(CONTENT_DIR, 'index.json');
    expect(fs.existsSync(indexPath)).toBe(true);
    expect(() => readJSON(indexPath)).not.toThrow();
  });

  test('all 15 section JSON files exist', () => {
    for (const id of SECTION_IDS) {
      const filePath = path.join(CONTENT_DIR, `${id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  describe.each(SECTION_IDS)('section: %s', (sectionId) => {
    let data;

    beforeAll(() => {
      data = readJSON(path.join(CONTENT_DIR, `${sectionId}.json`));
    });

    test('has required top-level fields', () => {
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('title');
      expect(data).toHaveProperty('content');
    });

    test('id is a non-empty string matching the filename', () => {
      expect(typeof data.id).toBe('string');
      expect(data.id.length).toBeGreaterThan(0);
      expect(data.id).toBe(sectionId);
    });

    test('title is a non-empty string', () => {
      expect(typeof data.title).toBe('string');
      expect(data.title.length).toBeGreaterThan(0);
    });

    test('content is a non-empty array', () => {
      expect(Array.isArray(data.content)).toBe(true);
      expect(data.content.length).toBeGreaterThan(0);
    });

    test('every block has a valid type', () => {
      data.content.forEach((block, i) => {
        expect(VALID_BLOCK_TYPES).toContain(block.type);
      });
    });

    test('heading/paragraph/tip blocks have text strings', () => {
      const textBlocks = data.content.filter(b =>
        ['heading', 'paragraph', 'tip'].includes(b.type)
      );
      textBlocks.forEach(block => {
        expect(typeof block.text).toBe('string');
        expect(block.text.length).toBeGreaterThan(0);
      });
    });

    test('list/steps blocks have items arrays', () => {
      const listBlocks = data.content.filter(b =>
        ['list', 'steps'].includes(b.type)
      );
      listBlocks.forEach(block => {
        expect(Array.isArray(block.items)).toBe(true);
        expect(block.items.length).toBeGreaterThan(0);
        block.items.forEach(item => {
          expect(typeof item).toBe('string');
        });
      });
    });

    test('shortcuts blocks have items with keys and action', () => {
      const shortcutBlocks = data.content.filter(b => b.type === 'shortcuts');
      shortcutBlocks.forEach(block => {
        expect(Array.isArray(block.items)).toBe(true);
        block.items.forEach(item => {
          expect(item).toHaveProperty('keys');
          expect(item).toHaveProperty('action');
          expect(Array.isArray(item.keys)).toBe(true);
          expect(item.keys.length).toBeGreaterThan(0);
          expect(typeof item.action).toBe('string');
        });
      });
    });

    test('screenshot blocks have id strings', () => {
      const screenshotBlocks = data.content.filter(b => b.type === 'screenshot');
      screenshotBlocks.forEach(block => {
        expect(typeof block.id).toBe('string');
        expect(block.id.length).toBeGreaterThan(0);
      });
    });
  });
});

// ============================================================
// 2. index.json — Catalog Validation
// ============================================================

describe('Content index.json — Catalog', () => {
  let index;

  beforeAll(() => {
    index = readJSON(path.join(CONTENT_DIR, 'index.json'));
  });

  test('has version, generatedAt, and sections fields', () => {
    expect(index).toHaveProperty('version');
    expect(index).toHaveProperty('generatedAt');
    expect(index).toHaveProperty('sections');
  });

  test('sections is an array with 19 entries', () => {
    expect(Array.isArray(index.sections)).toBe(true);
    expect(index.sections.length).toBe(19);
  });

  test('each catalog entry has required fields', () => {
    index.sections.forEach(entry => {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('title');
      expect(entry).toHaveProperty('icon');
      expect(entry).toHaveProperty('order');
      expect(entry).toHaveProperty('file');
      expect(entry).toHaveProperty('summary');
    });
  });

  test('catalog ids are unique', () => {
    const ids = index.sections.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('catalog order values are unique and sequential', () => {
    const orders = index.sections.map(s => s.order).sort((a, b) => a - b);
    for (let i = 0; i < orders.length; i++) {
      expect(orders[i]).toBe(i + 1);
    }
  });

  test('every catalog file reference exists on disk', () => {
    index.sections.forEach(entry => {
      const filePath = path.join(CONTENT_DIR, entry.file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  test('catalog ids match the section file ids', () => {
    index.sections.forEach(entry => {
      const data = readJSON(path.join(CONTENT_DIR, entry.file));
      expect(data.id).toBe(entry.id);
    });
  });

  test('catalog covers all expected sections', () => {
    const catalogIds = index.sections.map(s => s.id).sort();
    expect(catalogIds).toEqual([...SECTION_IDS].sort());
  });
});

// ============================================================
// 3. Landing Page HTML — Structure Validation
// ============================================================

describe('Landing Page HTML', () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(LANDING_PAGE, 'utf8');
  });

  test('file exists and is non-empty', () => {
    expect(html.length).toBeGreaterThan(0);
  });

  test('has proper HTML5 structure', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body');
    expect(html).toContain('</body>');
  });

  test('has meta viewport for responsiveness', () => {
    expect(html).toContain('name="viewport"');
  });

  test('has page title', () => {
    expect(html).toMatch(/<title>.*Nightjar.*<\/title>/i);
  });

  // Navigation
  test('has sticky navigation with key links', () => {
    expect(html).toContain('nav');
    expect(html).toContain('#features');
    expect(html).toContain('#demo');
    expect(html).toContain('#comparison');
  });

  // Hero section
  test('has hero section with download buttons', () => {
    expect(html).toContain('data-platform="windows"');
    expect(html).toContain('data-platform="macos"');
    expect(html).toContain('data-platform="linux"');
  });

  test('download buttons link to GitHub releases', () => {
    expect(html).toContain('github.com/NiyaNagi/Nightjar/releases');
  });

  // Demo / Slideshow
  test('has slideshow section', () => {
    expect(html).toContain('slideshow');
    expect(html).toContain('manifest.json');
  });

  // Features
  test('has feature cards section', () => {
    expect(html).toContain('id="features"');
    // Key features
    expect(html).toContain('End-to-End Encrypted');
    expect(html).toContain('Peer-to-Peer');
  });

  // Competitor comparison
  test('has competitor comparison table', () => {
    expect(html).toContain('id="comparison"');
    expect(html).toContain('Google Docs');
    expect(html).toContain('Notion');
    expect(html).toContain('Standard Notes');
    expect(html).toContain('Obsidian');
  });

  // Security section
  test('has security section', () => {
    expect(html).toContain('id="security"');
    expect(html).toContain('XSalsa20-Poly1305');
  });

  // GitHub link
  test('uses canonical NiyaNagi/Nightjar URL', () => {
    const matches = html.match(/github\.com\/NiyaNagi\/Nightjar/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  // Dynamic download resolution JS
  test('has dynamic GitHub API download resolution script', () => {
    // Uses REPO variable in template literal for API URL
    expect(html).toContain('api.github.com/repos/');
    expect(html).toContain('browser_download_url');
  });

  // Footer
  test('has footer', () => {
    expect(html).toContain('<footer');
    expect(html).toContain('</footer>');
  });

  // Docs link
  test('links to /docs/', () => {
    expect(html).toContain('/docs/');
  });
});

// ============================================================
// 4. Docs Wiki — File Structure
// ============================================================

describe('Docs Wiki — File Structure', () => {
  test('docs directory exists', () => {
    expect(fs.existsSync(DOCS_DIR)).toBe(true);
  });

  test('docs.css exists', () => {
    expect(fs.existsSync(path.join(DOCS_DIR, 'docs.css'))).toBe(true);
  });

  test('index.html (hub) exists', () => {
    expect(fs.existsSync(path.join(DOCS_DIR, 'index.html'))).toBe(true);
  });

  test('_template.html exists', () => {
    expect(fs.existsSync(path.join(DOCS_DIR, '_template.html'))).toBe(true);
  });

  test('all 15 section HTML files exist', () => {
    for (const id of SECTION_IDS) {
      const filePath = path.join(DOCS_DIR, `${id}.html`);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });
});

describe('Docs Hub Page (index.html)', () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(path.join(DOCS_DIR, 'index.html'), 'utf8');
  });

  test('has proper HTML5 structure', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  test('links to docs.css', () => {
    expect(html).toContain('docs.css');
  });

  test('fetches content from index.json', () => {
    // Uses CONTENT_BASE variable + template literal
    expect(html).toContain('CONTENT_BASE');
    expect(html).toContain('index.json');
  });

  test('has topbar with Nightjar branding', () => {
    expect(html).toContain('Nightjar');
    expect(html).toContain('Documentation');
  });

  test('uses canonical GitHub URL', () => {
    expect(html).toContain('github.com/NiyaNagi/Nightjar');
  });

  test('has footer', () => {
    expect(html).toContain('footer');
  });
});

describe('Docs Template Page (_template.html)', () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(path.join(DOCS_DIR, '_template.html'), 'utf8');
  });

  test('has proper HTML5 structure', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  test('links to docs.css', () => {
    expect(html).toContain('docs.css');
  });

  test('derives section id from filename', () => {
    // The template uses location.pathname to derive section id
    expect(html).toContain('location.pathname');
  });

  test('fetches section content JSON', () => {
    // Template uses CONTENT_BASE variable + template literals
    expect(html).toContain('CONTENT_BASE');
    expect(html).toContain('.json');
  });

  test('renders all block types', () => {
    expect(html).toContain("'heading'");
    expect(html).toContain("'paragraph'");
    expect(html).toContain("'list'");
    expect(html).toContain("'steps'");
    expect(html).toContain("'tip'");
    expect(html).toContain("'shortcuts'");
    expect(html).toContain("'screenshot'");
  });

  test('has prev/next navigation', () => {
    expect(html).toMatch(/prev|previous/i);
    expect(html).toContain('next');
  });

  test('builds sidebar navigation', () => {
    expect(html).toContain('sidebar');
    // Uses CONTENT_BASE + '/index.json' via template literal
    expect(html).toContain('CONTENT_BASE');
    expect(html).toContain('index.json');
  });
});

describe('Docs CSS', () => {
  let css;

  beforeAll(() => {
    css = fs.readFileSync(path.join(DOCS_DIR, 'docs.css'), 'utf8');
  });

  test('has CSS custom properties (variables)', () => {
    expect(css).toContain(':root');
    expect(css).toContain('--');
  });

  test('has topbar styles', () => {
    expect(css).toContain('.topbar');
  });

  test('has sidebar styles', () => {
    expect(css).toContain('.docs-sidebar');
  });

  test('has content area styles', () => {
    expect(css).toContain('.docs-content');
  });

  test('has responsive media queries', () => {
    expect(css).toContain('@media');
  });

  test('has hub card grid styles', () => {
    expect(css).toContain('.hub-grid');
  });

  test('has tip box styles', () => {
    expect(css).toContain('.tip');
  });

  test('has shortcut table styles', () => {
    expect(css).toContain('shortcut');
  });

  test('has prev/next navigation styles', () => {
    expect(css).toContain('.docs-nav');
  });
});

// ============================================================
// 5. HelpPage JSX — Shared Content Integration
// ============================================================

describe('HelpPage JSX — Shared Content Integration', () => {
  let source;

  beforeAll(() => {
    source = fs.readFileSync(HELP_PAGE_JSX, 'utf8');
  });

  test('imports the core content JSON files', () => {
    // HelpPage imports the original 15 core sections; newer content-only sections
    // (self-hosting, architecture, security-model, changelog) live on the public site only.
    const HELP_PAGE_SECTIONS = [
      'getting-started', 'identity', 'workspaces', 'documents', 'editor',
      'kanban', 'collaboration', 'sharing', 'chat', 'files',
      'inventory', 'search', 'shortcuts', 'networking', 'troubleshooting',
    ];
    for (const id of HELP_PAGE_SECTIONS) {
      expect(source).toContain(`${id}.json`);
    }
  });

  test('imports from public-site/content/ path', () => {
    expect(source).toContain('public-site/content/');
  });

  test('constructs HELP_SECTIONS array from imports', () => {
    expect(source).toContain('const HELP_SECTIONS');
    expect(source).toContain('HELP_SECTIONS');
  });

  test('exports HELP_SECTIONS as a named export', () => {
    expect(source).toContain('export { HELP_SECTIONS }');
  });

  test('exports HelpPage as default export', () => {
    expect(source).toContain('export default function HelpPage');
  });

  test('handles screenshot block type (returns null)', () => {
    expect(source).toContain("case 'screenshot':");
    expect(source).toContain('return null;');
  });

  test('handles all standard block types', () => {
    expect(source).toContain("case 'heading':");
    expect(source).toContain("case 'paragraph':");
    expect(source).toContain("case 'list':");
    expect(source).toContain("case 'steps':");
    expect(source).toContain("case 'tip':");
    expect(source).toContain("case 'shortcuts':");
  });

  test('does NOT contain hardcoded section content (no 400-line arrays)', () => {
    // After refactoring, HelpPage should be under 250 lines
    const lineCount = source.split('\n').length;
    expect(lineCount).toBeLessThan(250);
  });
});

// ============================================================
// 6. Cross-Reference Integrity
// ============================================================

describe('Cross-Reference Integrity', () => {
  test('every SECTION_ID in index.json has a matching section file', () => {
    const index = readJSON(path.join(CONTENT_DIR, 'index.json'));
    index.sections.forEach(entry => {
      const data = readJSON(path.join(CONTENT_DIR, entry.file));
      expect(data.id).toBe(entry.id);
      expect(data.title).toBeTruthy();
      expect(data.content.length).toBeGreaterThan(0);
    });
  });

  test('every section JSON id has a corresponding docs HTML file', () => {
    for (const id of SECTION_IDS) {
      expect(fs.existsSync(path.join(DOCS_DIR, `${id}.html`))).toBe(true);
    }
  });

  test('section count is consistent: 19 JSONs, 19 HTML pages, 19 index entries', () => {
    const index = readJSON(path.join(CONTENT_DIR, 'index.json'));
    expect(index.sections.length).toBe(19);
    expect(SECTION_IDS.length).toBe(19);

    // Count actual JSON files (exclude index.json)
    const jsonFiles = fs.readdirSync(CONTENT_DIR)
      .filter(f => f.endsWith('.json') && f !== 'index.json');
    expect(jsonFiles.length).toBe(19);

    // Count actual HTML section files (exclude index.html, _template.html, docs.css)
    const htmlFiles = fs.readdirSync(DOCS_DIR)
      .filter(f => f.endsWith('.html') && f !== 'index.html' && f !== '_template.html');
    expect(htmlFiles.length).toBe(19);
  });

  test('landing page and docs wiki both reference NiyaNagi/Nightjar', () => {
    const landing = fs.readFileSync(LANDING_PAGE, 'utf8');
    const docsHub = fs.readFileSync(path.join(DOCS_DIR, 'index.html'), 'utf8');
    
    expect(landing).toContain('NiyaNagi/Nightjar');
    expect(docsHub).toContain('NiyaNagi/Nightjar');
  });
});

// ============================================================
// 7. CI/CD Deployment — File References
// ============================================================

describe('CI/CD Deployment References', () => {
  const BUILD_YML = path.join(ROOT, '.github', 'workflows', 'build.yml');
  const DEPLOY_YML = path.join(ROOT, '.github', 'workflows', 'deploy.yml');
  const BOOTSTRAP = path.join(ROOT, 'server', 'deploy', 'bootstrap.sh');

  test('build.yml deploys docs directory', () => {
    if (!fs.existsSync(BUILD_YML)) return; // Skip if not present
    const content = fs.readFileSync(BUILD_YML, 'utf8');
    expect(content).toContain('docs');
    expect(content).toContain('content');
  });

  test('deploy.yml deploys docs directory', () => {
    if (!fs.existsSync(DEPLOY_YML)) return;
    const content = fs.readFileSync(DEPLOY_YML, 'utf8');
    expect(content).toContain('docs');
    expect(content).toContain('content');
  });

  test('bootstrap.sh creates docs and content directories', () => {
    if (!fs.existsSync(BOOTSTRAP)) return;
    const content = fs.readFileSync(BOOTSTRAP, 'utf8');
    expect(content).toContain('docs');
    expect(content).toContain('content');
  });
});

// ============================================================
// 8. npm Scripts
// ============================================================

describe('npm Scripts', () => {
  let pkg;

  beforeAll(() => {
    pkg = readJSON(path.join(ROOT, 'package.json'));
  });

  test('seed:demo script exists', () => {
    expect(pkg.scripts['seed:demo']).toBeDefined();
    expect(pkg.scripts['seed:demo']).toContain('seed-demo-workspace');
  });

  test('screenshots script exists', () => {
    expect(pkg.scripts.screenshots).toBeDefined();
    expect(pkg.scripts.screenshots).toContain('capture-screenshots');
  });

  test('seed:demo points to existing script file', () => {
    const scriptPath = path.join(ROOT, 'scripts', 'seed-demo-workspace.js');
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  test('screenshots points to existing script file', () => {
    const scriptPath = path.join(ROOT, 'scripts', 'capture-screenshots.js');
    expect(fs.existsSync(scriptPath)).toBe(true);
  });
});
