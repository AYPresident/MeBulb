const { launch } = require('./harness');
const OUT = '/home/claude/planmark/test/out';
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1440, height: 900 } });
  const ev = (fn, a) => page.evaluate(fn, a);
  await ev(() => { const d = planmark.activeDoc(); planmark.setZoom(1.25); const m = d.markups.find((x) => x.link === 'LK-m1' && x.page === 1); planmark.goToPage(1, m.pts[0]); planmark.state.sel.clear(); planmark.state.sel.add(m.id); planmark.refreshPanels(); });
  await page.waitForTimeout(300); await ev(() => { if (!document.body.classList.contains('right-open')) document.querySelector('[data-panel=props]').click(); });
  await page.waitForTimeout(1200); await page.screenshot({ path: OUT + '/r3-desktop.png' });
  // text box with rich text
  await ev(() => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.type === 'text'); planmark.state.sel.clear(); planmark.state.sel.add(m.id); planmark.goToPage(0, m.pts[0]); planmark.setZoom(2); planmark.goToPage(0, m.pts[0]); planmark.refreshPanels(); });
  await page.waitForTimeout(1200); await page.screenshot({ path: OUT + '/r3-text.png' });
  await ev(() => document.querySelector('[data-panel=measure]').click()); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/r3-measure.png' });
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})();
