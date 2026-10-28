const { launch } = require('./harness');
(async () => {
  const { browser, page, errors } = await launch();
  await page.screenshot({ path: 'test/shot1.png' });
  // zoom into the plan's living/bath area
  await page.evaluate(() => { const d = planmark.activeDoc(); });
  const vp = await page.$('#viewer'); const box = await vp.boundingBox();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4);
  for (let i = 0; i < 6; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control'); await page.waitForTimeout(60); }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test/shot2.png' });
  console.log('zoom', await page.evaluate(() => planmark.activeDoc().zoom));
  console.log('ERRORS:', errors.filter(e => !e.includes('ERR_FAILED')).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
