const { launch } = require('./harness');
const OUT = '/home/claude/planmark/test/out';
(async () => {
  const dark = process.argv[2] === 'dark';
  const { browser, page, errors } = await launch({ viewport: { width: 1600, height: 950 }, dark });
  const ev = (fn, a) => page.evaluate(fn, a);
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + `/r4-${dark ? 'dark' : 'light'}.png` });
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})();
