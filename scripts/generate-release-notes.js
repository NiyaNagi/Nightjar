#!/usr/bin/env node
/**
 * generate-release-notes.js
 * 
 * Automatically generates release notes from git commit history.
 * Categorizes commits into features, fixes, improvements, etc.
 * 
 * Usage:
 *   node scripts/generate-release-notes.js [options]
 * 
 * Options:
 *   --from <tag>     Start from this tag (default: previous tag)
 *   --to <ref>       End at this ref (default: HEAD)
 *   --output <file>  Output file (default: RELEASE_NOTES_<version>.md)
 *   --version <ver>  Version number (default: from package.json)
 *   --stdout         Output to stdout instead of file
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};

// Commit type categories
const CATEGORIES = {
    feat: { label: '🚀 Features', priority: 1 },
    fix: { label: '🐛 Bug Fixes', priority: 2 },
    perf: { label: '⚡ Performance', priority: 3 },
    security: { label: '🔒 Security', priority: 4 },
    refactor: { label: '♻️ Refactoring', priority: 5 },
    style: { label: '💄 Style', priority: 6 },
    docs: { label: '📚 Documentation', priority: 7 },
    test: { label: '🧪 Tests', priority: 8 },
    build: { label: '🔧 Build', priority: 9 },
    ci: { label: '👷 CI', priority: 10 },
    chore: { label: '🧹 Chores', priority: 11 },
    other: { label: '📝 Other Changes', priority: 99 }
};

// Keywords to detect commit types from message content
const TYPE_KEYWORDS = {
    feat: ['add', 'added', 'new', 'feature', 'implement', 'implemented', 'create', 'created'],
    fix: ['fix', 'fixed', 'bug', 'resolve', 'resolved', 'patch', 'patched', 'repair'],
    perf: ['performance', 'optimize', 'optimized', 'faster', 'speed'],
    security: ['security', 'secure', 'vulnerability', 'cve', 'auth'],
    refactor: ['refactor', 'restructure', 'clean', 'cleanup', 'reorganize'],
    docs: ['doc', 'docs', 'documentation', 'readme', 'comment', 'comments'],
    test: ['test', 'tests', 'testing', 'spec'],
    build: ['build', 'package', 'webpack', 'vite', 'electron-builder'],
    ci: ['ci', 'github actions', 'workflow', 'pipeline']
};

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8' }).trim();
    } catch (e) {
        return '';
    }
}

function getTags() {
    const output = run('git tag --sort=-v:refname');
    return output ? output.split('\n').filter(t => t.match(/^v?\d+\.\d+/)) : [];
}

function parseCommitType(message) {
    // Check for conventional commit format: type(scope): message or type: message
    const conventionalMatch = message.match(/^(\w+)(?:\([^)]+\))?:\s*(.*)$/);
    if (conventionalMatch) {
        const type = conventionalMatch[1].toLowerCase();
        if (CATEGORIES[type]) {
            return type;
        }
    }
    
    // Fallback: detect type from keywords in message
    const lowerMessage = message.toLowerCase();
    for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
        for (const keyword of keywords) {
            if (lowerMessage.includes(keyword)) {
                return type;
            }
        }
    }
    
    return 'other';
}

function parseCommits(fromTag, toRef) {
    const range = fromTag ? `${fromTag}..${toRef}` : toRef;
    // Use a unique separator that won't appear in commit messages
    const sep = '<<<COMMIT_SEP>>>';
    const fieldSep = '<<<FIELD>>>';
    const format = `%H${fieldSep}%s${fieldSep}%an${fieldSep}%aI${sep}`;
    const log = run(`git log ${range} --pretty=format:"${format}" --no-merges`);
    
    if (!log) return [];
    
    return log.split(sep).filter(Boolean).map(entry => {
        const parts = entry.trim().split(fieldSep);
        if (parts.length < 4) return null;
        
        const [hash, subject, authorName, date] = parts;
        if (!subject) return null;
        
        const type = parseCommitType(subject);
        
        // Clean up subject (remove conventional commit prefix if present)
        let cleanSubject = subject.replace(/^(\w+)(?:\([^)]+\))?:\s*/, '');
        // Capitalize first letter
        cleanSubject = cleanSubject.charAt(0).toUpperCase() + cleanSubject.slice(1);
        
        return {
            hash: hash.substring(0, 7),
            subject: cleanSubject,
            author: authorName,
            date,
            type
        };
    }).filter(Boolean);
}

function groupByType(commits) {
    const groups = {};
    
    for (const commit of commits) {
        if (!groups[commit.type]) {
            groups[commit.type] = [];
        }
        groups[commit.type].push(commit);
    }
    
    return groups;
}

function generateMarkdown(version, fromTag, groups, commits) {
    const date = new Date().toISOString().split('T')[0];
    const repoUrl = 'https://github.com/InyanRock/Nightjar';
    
    let md = `# Nightjar v${version} Release Notes\n\n`;
    md += `**Release Date:** ${date}\n\n`;
    
    if (fromTag) {
        md += `**Changes since:** ${fromTag}\n\n`;
    }
    
    md += `---\n\n`;
    
    // Summary stats
    const stats = {
        features: groups.feat?.length || 0,
        fixes: groups.fix?.length || 0,
        total: commits.length
    };
    
    md += `## 📊 Summary\n\n`;
    md += `- **${stats.features}** new features\n`;
    md += `- **${stats.fixes}** bug fixes\n`;
    md += `- **${stats.total}** total commits\n\n`;
    md += `---\n\n`;
    
    // Grouped changes
    const sortedTypes = Object.keys(groups).sort((a, b) => 
        (CATEGORIES[a]?.priority || 99) - (CATEGORIES[b]?.priority || 99)
    );
    
    for (const type of sortedTypes) {
        const category = CATEGORIES[type] || CATEGORIES.other;
        const typeCommits = groups[type];
        
        md += `## ${category.label}\n\n`;
        
        for (const commit of typeCommits) {
            const commitUrl = `${repoUrl}/commit/${commit.hash}`;
            md += `- ${commit.subject} ([${commit.hash}](${commitUrl}))\n`;
        }
        
        md += `\n`;
    }
    
    // Contributors
    const contributors = [...new Set(commits.map(c => c.author))];
    if (contributors.length > 0) {
        md += `## 👥 Contributors\n\n`;
        for (const contributor of contributors) {
            md += `- ${contributor}\n`;
        }
        md += `\n`;
    }
    
    // Footer
    md += `---\n\n`;
    md += `**Full Changelog:** [${fromTag || 'initial'}...v${version}](${repoUrl}/compare/${fromTag || 'initial'}...v${version})\n\n`;
    md += `**Download:** [Releases](${repoUrl}/releases/tag/v${version})\n`;
    
    return md;
}

function main() {
    const projectRoot = path.resolve(__dirname, '..');
    process.chdir(projectRoot);
    
    // Get version
    let version = getArg('--version');
    if (!version) {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        version = pkg.version;
    }
    
    // Get tag range
    const tags = getTags();
    let fromTag = getArg('--from');
    const toRef = getArg('--to') || 'HEAD';
    
    if (!fromTag && tags.length > 0) {
        // Find the previous tag (not the current version)
        const currentTag = `v${version}`;
        const tagIndex = tags.indexOf(currentTag);
        if (tagIndex !== -1 && tagIndex < tags.length - 1) {
            fromTag = tags[tagIndex + 1];
        } else if (tagIndex === -1 && tags.length > 0) {
            fromTag = tags[0];
        }
    }
    
    console.log(`Generating release notes for v${version}`);
    console.log(`  From: ${fromTag || '(beginning)'}`);
    console.log(`  To: ${toRef}`);
    
    // Parse commits
    const commits = parseCommits(fromTag, toRef);
    
    if (commits.length === 0) {
        console.log('\nNo commits found in range.');
        return;
    }
    
    console.log(`  Found: ${commits.length} commits\n`);
    
    // Group and generate
    const groups = groupByType(commits);
    const markdown = generateMarkdown(version, fromTag, groups, commits);
    
    // Output
    if (args.includes('--stdout')) {
        console.log(markdown);
    } else {
        const outputFile = getArg('--output') || `RELEASE_NOTES_v${version}.md`;
        fs.writeFileSync(outputFile, markdown);
        console.log(`✅ Release notes written to ${outputFile}`);
    }
}

main();
