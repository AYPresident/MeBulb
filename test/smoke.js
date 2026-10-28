const { launch } = require('./harness');
(async () => {
  const { browser, page, errors } = await launch();
  const info = await page.evaluate(() => { const d = planmark.activeDoc(); return { name: d.name, pages: d.numPages, markups: d.markups.length, zoom: d.zoom, measures: d.markups.filter(m => ['area','polylength','length','count'].includes(m.type)).map(m => [m.type, planmark.measureInfo(m, d).text]) }; });
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: process.argv[2] || 'test/shot1.png' });
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
