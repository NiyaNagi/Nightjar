const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const inputImage = path.join(__dirname, '..', 'nightjar.png');
const assetsDir = path.join(__dirname, '..', 'assets');
const iconsDir = path.join(assetsDir, 'icons');
const buildDir = path.join(__dirname, '..', 'build');

// Icon sizes to generate
const sizes = [
  { size: 512, name: 'nightjar-512.png' },
  { size: 256, name: 'nightjar-256.png' },
  { size: 128, name: 'nightjar-128.png' },
  { size: 64, name: 'nightjar-64.png' },
  { size: 32, name: 'nightjar-32.png' },
  { size: 16, name: 'nightjar-16.png' }
];

async function createCircularIcon(size, outputPath) {
  const circleSize = size;
  
  // Create a circular mask
  const circle = Buffer.from(
    `<svg width="${circleSize}" height="${circleSize}">
      <circle cx="${circleSize/2}" cy="${circleSize/2}" r="${circleSize/2}" fill="white"/>
    </svg>`
  );

  await sharp(inputImage)
    .resize(circleSize, circleSize, { fit: 'cover', position: 'center' })
    .composite([{
      input: circle,
      blend: 'dest-in'
    }])
    .png()
    .toFile(outputPath);
    
  console.log(`Created ${path.basename(outputPath)} (${size}x${size})`);
}

async function createSquareIcon(size, outputPath) {
  await sharp(inputImage)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outputPath);
    
  console.log(`Created ${path.basename(outputPath)} (${size}x${size} square)`);
}

async function generateIcons() {
  console.log('Generating Nightjar icons...\n');
  
  // Ensure directories exist
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
  
  // Generate circular icons for assets/icons
  for (const { size, name } of sizes) {
    const outputPath = path.join(iconsDir, name);
    await createCircularIcon(size, outputPath);
  }
  
  // Generate square icon with full bird
  await createSquareIcon(512, path.join(iconsDir, 'nightjar-square-512.png'));
  
  // Generate logo for loading/splash screens
  await createCircularIcon(256, path.join(assetsDir, 'nightjar-logo.png'));
  
  // Generate build icons
  await createCircularIcon(512, path.join(buildDir, 'icon.png'));
  
  console.log('\n✓ All icons generated successfully!');
  console.log('\nNext steps:');
  console.log('1. Use an icon converter tool to create icon.icns (Mac)');
  console.log('2. Use an icon converter tool to create icon.ico (Windows)');
  console.log('   Or use online tools like https://iconverticons.com/');
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
