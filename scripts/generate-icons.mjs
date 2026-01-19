import sharp from 'sharp';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const svgPath = join(__dirname, '..', 'icon-concepts', 'concept1-pulse-wave.svg');
const iconsDir = join(__dirname, '..', 'src-tauri', 'icons');

// All sizes needed for Tauri
const sizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: 'icon.png', size: 512 },
  // Windows Store logos
  { name: 'Square30x30Logo.png', size: 30 },
  { name: 'Square44x44Logo.png', size: 44 },
  { name: 'Square71x71Logo.png', size: 71 },
  { name: 'Square89x89Logo.png', size: 89 },
  { name: 'Square107x107Logo.png', size: 107 },
  { name: 'Square142x142Logo.png', size: 142 },
  { name: 'Square150x150Logo.png', size: 150 },
  { name: 'Square284x284Logo.png', size: 284 },
  { name: 'Square310x310Logo.png', size: 310 },
  { name: 'StoreLogo.png', size: 50 },
];

async function generateIcons() {
  const svg = await fs.readFile(svgPath);

  for (const { name, size } of sizes) {
    const outputPath = join(iconsDir, name);
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Generated ${name} (${size}x${size})`);
  }

  // Generate icon.ico for Windows (use 256x256 as source)
  const ico256 = await sharp(svg).resize(256, 256).png().toBuffer();
  await fs.writeFile(join(iconsDir, 'icon.ico'), ico256);
  console.log('Generated icon.ico');

  console.log('\nDone! Icons generated in src-tauri/icons/');
  console.log('\nNote: For macOS, you\'ll need to generate icon.icns separately.');
  console.log('You can use: iconutil -c icns iconset_folder');
}

generateIcons().catch(console.error);
