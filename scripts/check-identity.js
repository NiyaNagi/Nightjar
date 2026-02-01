// Script to check identity file locations across platforms
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('=== Identity File Location Check ===\n');

// Check legacy path
const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const legacyPath = path.join(homeDir, '.Nightjar', 'identity.json');
console.log('Legacy path:', legacyPath);
console.log('Exists:', fs.existsSync(legacyPath));
if (fs.existsSync(legacyPath)) {
    const stats = fs.statSync(legacyPath);
    console.log('Size:', stats.size, 'bytes');
    console.log('Modified:', stats.mtime);
}
console.log();

// Check Electron userData paths (platform-specific)
let userDataPath;
if (process.platform === 'win32') {
    userDataPath = path.join(process.env.APPDATA || '', 'Nightjar');
} else if (process.platform === 'darwin') {
    userDataPath = path.join(homeDir, 'Library', 'Application Support', 'Nightjar');
} else {
    userDataPath = path.join(homeDir, '.config', 'Nightjar');
}

const newPath = path.join(userDataPath, 'identity', 'identity.json');
console.log('New userData path:', newPath);
console.log('Exists:', fs.existsSync(newPath));
if (fs.existsSync(newPath)) {
    const stats = fs.statSync(newPath);
    console.log('Size:', stats.size, 'bytes');
    console.log('Modified:', stats.mtime);
}
console.log();

// Check if either exists
if (!fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
    console.log('❌ No identity file found at either location!');
    console.log('   You need to create an identity in the app first.');
} else if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
    console.log('⚠️  Identity exists at LEGACY path only.');
    console.log('   Migration should copy it to new path on next app start.');
} else if (!fs.existsSync(legacyPath) && fs.existsSync(newPath)) {
    console.log('✅ Identity exists at NEW path (migration complete or created there).');
} else {
    console.log('✅ Identity exists at BOTH paths (migration preserved legacy).');
}
