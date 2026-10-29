// Renders the app icon and the menu bar template from icon-concepts/ into src-tauri/icons/.
// Run: node scripts/generate-icons.mjs   (macOS: builds icon.icns with iconutil)
import sharp from 'sharp';
import { promises as fs } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSvg = join(root, 'icon-concepts', 'concept6-signal.svg');
const traySvg = join(root, 'icon-concepts', 'tray-template.svg');
const iconsDir = join(root, 'src-tauri', 'icons');

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

const render = (svg, size) => sharp(svg, { density: Math.max(72, (72 * size) / 1024 * 4) }).resize(size, size).png().toBuffer();

async function main() {
  const svg = await fs.readFile(appSvg);
  for (const { name, size } of sizes) {
    await fs.writeFile(join(iconsDir, name), await render(svg, size));
  }
  await fs.writeFile(join(iconsDir, 'icon.ico'), await render(svg, 256));

  // macOS .icns from a full iconset
  const set = join(await fs.mkdtemp(join(tmpdir(), 'pulse-icon-')), 'icon.iconset');
  await fs.mkdir(set);
  for (const s of [16, 32, 128, 256, 512]) {
    await fs.writeFile(join(set, `icon_${s}x${s}.png`), await render(svg, s));
    await fs.writeFile(join(set, `icon_${s}x${s}@2x.png`), await render(svg, s * 2));
  }
  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', set, '-o', join(iconsDir, 'icon.icns')]);
  } else {
    console.warn('Skipped icon.icns: iconutil is macOS only.');
  }

  const tray = await fs.readFile(traySvg);
  await fs.writeFile(join(iconsDir, 'tray-template@2x.png'), await sharp(tray, { density: 144 }).resize(44, 44).png().toBuffer());
  console.log('Icons written to src-tauri/icons/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
