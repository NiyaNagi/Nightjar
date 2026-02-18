#!/usr/bin/env node
/**
 * Version Sync Script
 * 
 * Automatically synchronizes the version number across the app from:
 * 1. Git tag (when provided via --tag or detected from git)
 * 2. Manual version (when provided via --version)
 * 
 * This ensures package.json (the single source of truth) stays in sync
 * with release tags. All other parts of the app read from package.json.
 * 
 * Usage:
 *   node scripts/sync-version.js --tag v1.3.2
 *   node scripts/sync-version.js --version 1.3.2
 *   node scripts/sync-version.js --from-git
 *   node scripts/sync-version.js --bump patch|minor|major
 * 
 * The script updates:
 *   - package.json (primary source)
 *   - package-lock.json (via npm install --package-lock-only)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');

// ANSI colors for terminal output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logError(message) {
    console.error(`${colors.red}ERROR: ${message}${colors.reset}`);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        tag: null,
        version: null,
        fromGit: false,
        bump: null,
        dryRun: false,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--tag':
            case '-t':
                options.tag = args[++i];
                break;
            case '--version':
            case '-v':
                options.version = args[++i];
                break;
            case '--from-git':
            case '-g':
                options.fromGit = true;
                break;
            case '--bump':
            case '-b':
                options.bump = args[++i];
                break;
            case '--dry-run':
            case '-d':
                options.dryRun = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
        }
    }

    return options;
}

/**
 * Show help message
 */
function showHelp() {
    console.log(`
${colors.bold}Version Sync Script${colors.reset}

Synchronizes version numbers across the Nightjar app.

${colors.cyan}Usage:${colors.reset}
  node scripts/sync-version.js [options]

${colors.cyan}Options:${colors.reset}
  --tag, -t <tag>       Set version from git tag (e.g., v1.3.2)
  --version, -v <ver>   Set version directly (e.g., 1.3.2)
  --from-git, -g        Detect version from current git tag
  --bump, -b <type>     Bump version (patch, minor, major)
  --dry-run, -d         Show what would change without making changes
  --help, -h            Show this help message

${colors.cyan}Examples:${colors.reset}
  # Sync from a specific tag
  node scripts/sync-version.js --tag v1.3.2

  # Detect current git tag and sync
  node scripts/sync-version.js --from-git

  # Bump patch version (1.3.1 -> 1.3.2)
  node scripts/sync-version.js --bump patch

  # Bump minor version (1.3.1 -> 1.4.0)
  node scripts/sync-version.js --bump minor

  # Bump major version (1.3.1 -> 2.0.0)
  node scripts/sync-version.js --bump major

${colors.cyan}Files Updated:${colors.reset}
  - package.json (primary source of truth)
  - package-lock.json (synced automatically)

${colors.cyan}Integration:${colors.reset}
  Add to your release workflow:
    npm run version:sync -- --from-git
`);
}

/**
 * Read package.json
 */
function readPackageJson() {
    try {
        const content = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to read package.json: ${error.message}`);
    }
}

/**
 * Write package.json
 */
function writePackageJson(packageJson) {
    try {
        const content = JSON.stringify(packageJson, null, 2) + '\n';
        fs.writeFileSync(PACKAGE_JSON_PATH, content, 'utf8');
    } catch (error) {
        throw new Error(`Failed to write package.json: ${error.message}`);
    }
}

/**
 * Get version from git tag
 */
function getVersionFromGit() {
    try {
        // Try to get the tag that points to current HEAD
        let tag;
        try {
            tag = execSync('git describe --tags --exact-match HEAD', {
                encoding: 'utf8',
                cwd: ROOT_DIR,
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
        } catch {
            tag = execSync('git describe --tags --abbrev=0', {
                encoding: 'utf8',
                cwd: ROOT_DIR,
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
        }

        if (!tag) {
            throw new Error('No git tag found');
        }

        return tag;
    } catch (error) {
        throw new Error(`Failed to get git tag: ${error.message}`);
    }
}

/**
 * Parse version from tag (removes 'v' prefix if present)
 */
function parseVersionFromTag(tag) {
    // Remove 'v' prefix if present
    const version = tag.startsWith('v') ? tag.slice(1) : tag;
    
    // Validate semver format
    const semverRegex = /^(\d+)\.(\d+)\.(\d+)(-[\w.]+)?(\+[\w.]+)?$/;
    if (!semverRegex.test(version)) {
        throw new Error(`Invalid version format: ${version}. Expected semver format (e.g., 1.3.2)`);
    }

    return version;
}

/**
 * Bump version
 */
function bumpVersion(currentVersion, bumpType) {
    const parts = currentVersion.split('.').map(Number);
    
    if (parts.length !== 3 || parts.some(isNaN)) {
        throw new Error(`Invalid current version format: ${currentVersion}`);
    }

    let [major, minor, patch] = parts;

    switch (bumpType) {
        case 'major':
            major++;
            minor = 0;
            patch = 0;
            break;
        case 'minor':
            minor++;
            patch = 0;
            break;
        case 'patch':
            patch++;
            break;
        default:
            throw new Error(`Invalid bump type: ${bumpType}. Use 'major', 'minor', or 'patch'`);
    }

    return `${major}.${minor}.${patch}`;
}

/**
 * Update package-lock.json by running npm install
 */
function updatePackageLock(dryRun) {
    if (dryRun) {
        log('  Would update package-lock.json via npm', 'yellow');
        return;
    }

    try {
        log('Updating package-lock.json...', 'cyan');
        execSync('npm install --package-lock-only', {
            cwd: ROOT_DIR,
            stdio: 'inherit'
        });
        log('  ✓ package-lock.json updated', 'green');
    } catch (error) {
        log(`  ⚠ Failed to update package-lock.json: ${error.message}`, 'yellow');
    }
}

/**
 * Main function
 */
function main() {
    const options = parseArgs();

    if (options.help) {
        showHelp();
        process.exit(0);
    }

    try {
        const packageJson = readPackageJson();
        const currentVersion = packageJson.version;
        let newVersion;

        // Determine the new version
        if (options.tag) {
            newVersion = parseVersionFromTag(options.tag);
            log(`Setting version from tag: ${options.tag}`, 'cyan');
        } else if (options.version) {
            newVersion = parseVersionFromTag(options.version);
            log(`Setting version directly: ${options.version}`, 'cyan');
        } else if (options.fromGit) {
            const tag = getVersionFromGit();
            newVersion = parseVersionFromTag(tag);
            log(`Detected git tag: ${tag}`, 'cyan');
        } else if (options.bump) {
            newVersion = bumpVersion(currentVersion, options.bump);
            log(`Bumping ${options.bump} version`, 'cyan');
        } else {
            showHelp();
            process.exit(1);
        }

        // Check if version changed
        if (currentVersion === newVersion) {
            log(`\n✓ Version already at ${newVersion}`, 'green');
            process.exit(0);
        }

        log(`\nVersion change: ${currentVersion} → ${newVersion}`, 'bold');
        log('');

        if (options.dryRun) {
            log('DRY RUN - No changes made', 'yellow');
            log('');
            log('Would update:', 'cyan');
            log(`  - package.json: "${currentVersion}" → "${newVersion}"`, 'yellow');
            log('  - package-lock.json (via npm)', 'yellow');
        } else {
            // Update package.json
            packageJson.version = newVersion;
            writePackageJson(packageJson);
            log(`✓ Updated package.json to ${newVersion}`, 'green');

            // Update package-lock.json
            updatePackageLock(options.dryRun);
        }

        log('');
        log(`${colors.green}${colors.bold}Version sync complete: ${newVersion}${colors.reset}`);

        // Show where version is read from
        log('');
        log('Version is read from package.json by:', 'cyan');
        log('  - src/main.js → global.APP_VERSION', 'reset');
        log('  - src/preload.js → electronAPI.appVersion', 'reset');
        log('  - sidecar/mesh-constants.js → getAppVersion()', 'reset');
        log('  - electron-builder → installer name', 'reset');

    } catch (error) {
        logError(error.message);
        process.exit(1);
    }
}

// Export for testing
module.exports = {
    parseVersionFromTag,
    bumpVersion,
    parseArgs
};

// Run if called directly
if (require.main === module) {
    main();
}
