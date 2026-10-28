const { launch } = require('./harness');
const P = require('/opt/npm-tools/node_modules/pdf-lib');
(async () => {
  const pdf = await P.PDFDocument.create(); const f = await pdf.embedFont(P.StandardFonts.Helvetica);
  for (let i = 0; i < 40; i++) { const p = pdf.addPage([2592, 1728]); p.drawText(`SHEET ${i + 1}`, { x: 200, y: 1500, size: 80, font: f }); for (let k = 0; k < 200; k++) p.drawLine({ start: { x: 100 + k * 12, y: 100 }, end: { x: 100 + k * 12, y: 1600 }, thickness: 0.3 }); }
  const bytes = await pdf.save();
  const { browser, page, errors } = await launch();
  const t0 = Date.now();
  await page.evaluate(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await planmark.openBytes('big.pdf', bin); }, Buffer.from(bytes).toString('base64'));
  const tOpen = Date.now() - t0; await page.waitForTimeout(1500);
  const thumbs = await page.evaluate(() => document.querySelectorAll('.thumb canvas').length);
  console.log('open 40 sheets ms', tOpen, 'thumbs drawn', thumbs);
  // deep zoom to trigger detail canvas
  await page.evaluate(() => { planmark.setZoom(6); planmark.goToPage(0, [400, 260]); }); await page.waitForTimeout(2500);
  const det = await page.evaluate(() => { const c = planmark.activeDoc().pageEls[0].querySelector('canvas.detail'); const b = planmark.activeDoc().pageEls[0].querySelector('canvas.base'); return { detailHidden: c.hidden, dw: c.width, bw: b.width, bh: b.height }; });
  console.log('detail', JSON.stringify(det));
  await page.screenshot({ path: 'test/out/deepzoom.png', clip: { x: 300, y: 200, width: 600, height: 400 } });
  await page.evaluate(() => planmark.runSearch('SHEET 3')); await page.waitForTimeout(1500);
  console.log('search hits', await page.evaluate(() => planmark.state.search.hits.length));
  console.log('ERRORS:', errors.filter(e => !e.includes('ERR_FAILED')).join('\n') || 'none');
  await browser.close();
})();
