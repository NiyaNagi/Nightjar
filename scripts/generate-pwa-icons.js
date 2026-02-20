/**
 * generate-pwa-icons.js
 * 
 * Generates PWA icons (192×192, 180×180) from the existing nightjar-512 source.
 * Also copies the 512×512 icon to the public folder for the manifest.
 * 
 * Usage: node scripts/generate-pwa-icons.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE = path.join(__dirname, '..', 'assets', 'icons', 'nightjar-square-512.png');
const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Source icon not found:', SOURCE);
    process.exit(1);
  }

  const sizes = [
    { size: 512, name: 'nightjar-512.png' },
    { size: 192, name: 'nightjar-192.png' },
    { size: 180, name: 'apple-touch-icon.png' },
  ];

  for (const { size, name } of sizes) {
    const outPath = path.join(PUBLIC, name);
    await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outPath);
    console.log(`✓ Generated ${name} (${size}×${size})`);
  }

  console.log('Done! PWA icons generated in frontend/public/');
}

main().catch(err => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
