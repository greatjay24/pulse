import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:1420';
const output = '/tmp/pulse-screenshot.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.screenshot({ path: output });
await browser.close();

console.log(`Screenshot saved to ${output}`);
