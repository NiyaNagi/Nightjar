const png2icons = require('png2icons');
const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'build');
const iconPath = path.join(buildDir, 'icon.png');

async function createPlatformIcons() {
  console.log('Creating platform-specific icons...\n');
  
  const input = fs.readFileSync(iconPath);
  
  // Create .icns for Mac
  const icns = png2icons.createICNS(input, png2icons.BICUBIC, 0);
  fs.writeFileSync(path.join(buildDir, 'icon.icns'), icns);
  console.log('✓ Created icon.icns (Mac)');
  
  // Create .ico for Windows
  const ico = png2icons.createICO(input, png2icons.BICUBIC, 0, false);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
  console.log('✓ Created icon.ico (Windows)');
  
  console.log('\n✓ All platform icons created successfully!');
}

createPlatformIcons().catch(err => {
  console.error('Error creating platform icons:', err);
  process.exit(1);
});
