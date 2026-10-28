const { launch } = require('./harness');
(async () => {
  for (const [name, opts] of [['phone', { viewport: { width: 400, height: 800 } }], ['dark', { viewport: { width: 1280, height: 820 }, dark: true }]]) {
    const { browser, page, errors } = await launch(opts);
    if (name === 'dark') { await page.click('.titem >> nth=0').catch(() => {}); await page.evaluate(() => { const d = planmark.activeDoc(); const m = d.markups.find(x => x.type === 'area'); planmark.state.sel.add(m.id); }); await page.keyboard.press('Escape'); await page.evaluate(() => { const d = planmark.activeDoc(); const m = d.markups.find(x => x.type === 'area'); planmark.state.sel.clear(); planmark.state.sel.add(m.id); }); await page.click('#viewer'); }
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test/out/view-${name}.png` });
    const ov = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(name, 'horizontal overflow:', ov, 'errors:', errors.filter(e => !e.includes('ERR_FAILED')).join('; ') || 'none');
    if (name === 'phone') { await page.click('#btn-panels'); await page.click('#ctx button >> text=Linked sketches'); await page.waitForTimeout(1200); await page.screenshot({ path: 'test/out/view-phone-props.png' }); }
    await browser.close();
  }
})();
