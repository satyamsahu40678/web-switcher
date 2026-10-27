// Export the project's existing vector brand to Chrome's required PNG formats.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const svg = await readFile('extension/spider.svg', 'utf8');
await mkdir('extension/icons', {recursive: true});
await mkdir('docs/store-assets', {recursive: true});
const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    const data = await page.evaluate(async ({svg, size}) => {
      const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(svg); await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, {svg, size});
    await writeFile(`extension/icons/icon-${size}.png`, Buffer.from(data, 'base64'));
  }
  const promo = await page.evaluate(async svg => {
    const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(svg); await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = 440; canvas.height = 280;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f6f3ed'; ctx.fillRect(0, 0, 440, 280);
    ctx.drawImage(img, 176, 29, 88, 88); ctx.textAlign = 'center'; ctx.fillStyle = '#292435';
    ctx.font = 'bold 35px sans-serif'; ctx.fillText('Web Switcher', 220, 166);
    ctx.font = '18px sans-serif'; ctx.fillText('Connect the addresses you choose.', 220, 205);
    ctx.fillStyle = '#6544b5'; ctx.font = '15px sans-serif'; ctx.fillText('Local mappings. Your control.', 220, 236);
    return canvas.toDataURL('image/png').split(',')[1];
  }, svg);
  await writeFile('docs/store-assets/small-promo-440x280.png', Buffer.from(promo, 'base64'));
} finally { await browser.close(); }
console.log('Chrome PNG icons and 440×280 promotional tile exported.');
