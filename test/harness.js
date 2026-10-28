// Shared Playwright harness: serves the built page and maps CDN URLs to local copies.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const PDFJS_DIR = '/opt/npm-tools/node_modules/pdfjs-dist/build';
const PDFLIB = '/opt/npm-tools/node_modules/pdf-lib/dist/pdf-lib.min.js';
async function launch(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: opts.dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('http://planmark.test/font/')) { const f = decodeURIComponent(url.split('/font/')[1]); return route.fulfill({ contentType: 'font/ttf', body: fs.readFileSync(f) }); }
    if (url.startsWith('http://planmark.test/file/')) { const f = decodeURIComponent(url.split('/file/')[1]); return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync(f) }); }
    if (url.startsWith('http://planmark.test/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/mebulb.html'), 'utf8') + '</body></html>' });
    if (url.includes('pdfjs-dist@4.10.38/build/')) { const f = url.split('/build/')[1]; return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(PDFJS_DIR, f)) }); }
    if (url.includes('pdf-lib@1.17.1')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(PDFLIB) });
    return route.abort();
  });
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto('http://planmark.test/');
  await page.waitForFunction(() => window.planmark && window.planmark.activeDoc() && window.planmark.activeDoc().markups.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return { browser, page, errors };
}
module.exports = { launch };
