const { launch } = require('./harness'); const fs = require('fs');
(async () => {
  const { browser, page } = await launch({ viewport: { width: 1440, height: 1000 } });
  const ev = (fn, a) => page.evaluate(fn, a);
  for (const grid of [true, false]) {
    const url = await ev(async (grid) => { const d = planmark.activeDoc(); await planmark.compareOverlay(d, 0, d, 1, grid); const o = planmark.activeDoc(); const p = await o.pdf.getPage(1); const vp = p.getViewport({ scale: 1 }); const c = document.createElement('canvas'); c.width = 700; c.height = 420; await p.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: [1, 0, 0, 1, -330, -560] }).promise; const u = c.toDataURL('image/png'); planmark.activeDoc().dirty = false; document.querySelector('.tab.on .tab-x').click(); return u; }, grid);
    fs.writeFileSync(`test/out/r3-overlay-${grid ? 'grid' : 'plain'}.png`, Buffer.from(url.split(',')[1], 'base64')); await page.waitForTimeout(400);
  }
  await browser.close();
})();
