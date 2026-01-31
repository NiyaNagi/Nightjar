/**
 * Build and Packaging Tests
 * 
 * These tests validate that the Vite build and Electron packaging are configured correctly.
 * They check:
 * - Vite outputs relative asset paths (required for file:// protocol in Electron)
 * - Package.json electron-builder config is valid
 * - Built HTML contains correct asset references
 */

const fs = require('fs');
const path = require('path');

describe('Build Configuration', () => {
  describe('Vite Configuration', () => {
    const viteConfigPath = path.join(__dirname, '..', 'vite.config.js');
    
    it('should have vite.config.js', () => {
      expect(fs.existsSync(viteConfigPath)).toBe(true);
    });
    
    it('should set base to relative path for Electron compatibility', async () => {
      const content = fs.readFileSync(viteConfigPath, 'utf-8');
      // Check that base is set to './' for relative paths
      expect(content).toMatch(/base:\s*['"]\.\/['"]/);
    });
    
    it('should have correct root directory', () => {
      const content = fs.readFileSync(viteConfigPath, 'utf-8');
      expect(content).toMatch(/root:\s*['"]frontend['"]/);
    });
  });
  
  describe('Package.json Electron Builder Config', () => {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    let packageJson;
    
    beforeAll(() => {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    });
    
    it('should have electron-builder build config', () => {
      expect(packageJson.build).toBeDefined();
    });
    
    it('should include frontend/dist in files', () => {
      expect(packageJson.build.files).toContain('frontend/dist/**/*');
    });
    
    it('should include sidecar in files', () => {
      expect(packageJson.build.files).toContain('sidecar/**/*');
    });
    
    it('should include src in files', () => {
      expect(packageJson.build.files).toContain('src/**/*');
    });
    
    it('should have NSIS target for Windows', () => {
      const winTargets = packageJson.build.win?.target;
      expect(winTargets).toBeDefined();
      expect(winTargets.some(t => t === 'nsis' || t.target === 'nsis')).toBe(true);
    });
    
    it('should output to release directory', () => {
      expect(packageJson.build.directories?.output).toBe('release');
    });
  });
  
  describe('Built Assets (if available)', () => {
    const distPath = path.join(__dirname, '..', 'frontend', 'dist');
    const indexHtmlPath = path.join(distPath, 'index.html');
    
    // Skip these tests if dist folder doesn't exist (not built yet)
    const distExists = fs.existsSync(distPath);
    
    (distExists ? it : it.skip)('should have index.html in frontend/dist', () => {
      expect(fs.existsSync(indexHtmlPath)).toBe(true);
    });
    
    (distExists ? it : it.skip)('should have assets folder in frontend/dist', () => {
      const assetsPath = path.join(distPath, 'assets');
      expect(fs.existsSync(assetsPath)).toBe(true);
    });
    
    (distExists ? it : it.skip)('should use relative paths for assets in built HTML', () => {
      const html = fs.readFileSync(indexHtmlPath, 'utf-8');
      
      // Check that asset paths start with ./ (relative) not / (absolute)
      // Look for script and link tags
      const scriptMatch = html.match(/src=["']([^"']+)["']/g);
      const linkMatch = html.match(/href=["']([^"']+\.css)["']/g);
      
      if (scriptMatch) {
        scriptMatch.forEach(match => {
          // Extract the path value
          const pathValue = match.replace(/src=["']/, '').replace(/["']$/, '');
          // Should start with ./ for relative paths (not / for absolute)
          expect(pathValue.startsWith('./')).toBe(true);
        });
      }
      
      if (linkMatch) {
        linkMatch.forEach(match => {
          const pathValue = match.replace(/href=["']/, '').replace(/["']$/, '');
          expect(pathValue.startsWith('./')).toBe(true);
        });
      }
    });
    
    (distExists ? it : it.skip)('should not have X-Frame-Options meta tag (only works as HTTP header)', () => {
      const html = fs.readFileSync(indexHtmlPath, 'utf-8');
      // Check for actual meta tag, not just comments
      expect(html).not.toMatch(/<meta\s+http-equiv=["']X-Frame-Options["']/);
    });
    
    (distExists ? it : it.skip)('should not have frame-ancestors in CSP meta tag', () => {
      const html = fs.readFileSync(indexHtmlPath, 'utf-8');
      // Check that frame-ancestors is not in the actual CSP content (comments are okay)
      const cspMatch = html.match(/Content-Security-Policy[^>]*content="([^"]*)"/s);
      if (cspMatch) {
        expect(cspMatch[1]).not.toMatch(/frame-ancestors/);
      }
    });
  });
});

describe('Main Process Configuration', () => {
  const mainJsPath = path.join(__dirname, '..', 'src', 'main.js');
  
  it('should have main.js', () => {
    expect(fs.existsSync(mainJsPath)).toBe(true);
  });
  
  it('should load frontend/dist/index.html in production mode', () => {
    const content = fs.readFileSync(mainJsPath, 'utf-8');
    expect(content).toMatch(/frontend\/dist\/index\.html/);
  });
  
  it('should pass userData path to sidecar', () => {
    const content = fs.readFileSync(mainJsPath, 'utf-8');
    // Check that sidecar is spawned with userData argument
    expect(content).toMatch(/spawn.*sidecar\/index\.js.*userDataPath/s);
  });
  
  it('should have loading screen functionality', () => {
    const content = fs.readFileSync(mainJsPath, 'utf-8');
    expect(content).toMatch(/loadingWindow|Loading/);
  });
});

describe('Sidecar Configuration', () => {
  const sidecarPath = path.join(__dirname, '..', 'sidecar', 'index.js');
  
  it('should have sidecar/index.js', () => {
    expect(fs.existsSync(sidecarPath)).toBe(true);
  });
  
  it('should use USER_DATA_PATH from command line argument', () => {
    const content = fs.readFileSync(sidecarPath, 'utf-8');
    expect(content).toMatch(/USER_DATA_PATH.*process\.argv\[2\]/);
  });
  
  it('should use path.join for DB_PATH', () => {
    const content = fs.readFileSync(sidecarPath, 'utf-8');
    expect(content).toMatch(/path\.join\(USER_DATA_PATH.*storage/);
  });
  
  it('should use path.join for METADATA_DB_PATH', () => {
    const content = fs.readFileSync(sidecarPath, 'utf-8');
    expect(content).toMatch(/path\.join\(USER_DATA_PATH.*metadata/);
  });
});

describe('Source HTML Configuration', () => {
  const indexHtmlPath = path.join(__dirname, '..', 'frontend', 'index.html');
  
  it('should have source index.html', () => {
    expect(fs.existsSync(indexHtmlPath)).toBe(true);
  });
  
  it('should not have X-Frame-Options meta tag', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf-8');
    expect(html).not.toMatch(/<meta\s+http-equiv=["']X-Frame-Options["']/);
  });
  
  it('should not have frame-ancestors in CSP (only works as HTTP header)', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf-8');
    // Check that frame-ancestors is not inside the CSP content attribute (comments are okay)
    const cspMatch = html.match(/Content-Security-Policy[^>]*content="([^"]*)"/s);
    if (cspMatch) {
      expect(cspMatch[1]).not.toMatch(/frame-ancestors/);
    }
  });
  
  it('should not have Permissions-Policy meta tag (only works as HTTP header)', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf-8');
    expect(html).not.toMatch(/<meta\s+http-equiv=["']Permissions-Policy["']/);
  });
  
  it('should have valid CSP meta tag', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf-8');
    expect(html).toMatch(/Content-Security-Policy/);
    expect(html).toMatch(/default-src\s+['"]self['"]/);
  });
});
