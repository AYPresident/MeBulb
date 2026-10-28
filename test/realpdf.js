// Text removal + geometry on PDFs produced by other software
const { launch } = require('./harness');
const fs = require('fs');
const stub = () => { window.__saves = []; window.showSaveFilePicker = async (o) => ({ createWritable: async () => ({ write: async (b) => { const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); window.__saves.push({ name: o.suggestedName, b64: btoa(s) }); }, close: async () => {} }) }); };
(async () => {
  const { browser, page, errors } = await launch({ init: stub });
  for (const [file, want] of [['/mnt/skills/examples/theme-factory/theme-showcase.pdf', 6], ['/usr/share/texmf/doc/fonts/tex-gyre/qhv-test.pdf', 5]]) {
    const b64 = fs.readFileSync(file).toString('base64'); const name = file.split('/').pop();
    const res = await page.evaluate(async ([b64, name, want]) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const d = await planmark.openBytes(name, bin);
      const t = await planmark.pageText(d, 0); const it = t.items.find((x) => x.str.trim().length >= want && !/\s{2}/.test(x.str));
      const g = await planmark.buildGeometry(d, 0);
      // simulate a text edit of that run
      const k = t.items.indexOf(it); planmark.setTool('edittext');
      return { item: it.str, k, geo: g.n };
    }, [b64, name, want]);
    // perform edit through the UI: click the item's centre
    const pt = await page.evaluate((k) => { const d = planmark.activeDoc(); const it = d.textCache[0].items[k]; planmark.setZoom(1.5); const c = [it.x + Math.cos(it.ang) * it.w / 2, it.y - it.fh * 0.3]; planmark.goToPage(0, c); return c; }, res.k);
    await page.waitForTimeout(600);
    const [cx, cy] = await page.evaluate(([x, y]) => { const d = planmark.activeDoc(); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + x * d.zoom, r.top + y * d.zoom]; }, pt);
    await page.keyboard.press('x'); await page.mouse.click(cx, cy); await page.waitForSelector('.pdf-edit', { timeout: 5000 });
    await page.fill('.pdf-edit', 'REPLACED TEXT'); await page.press('.pdf-edit', 'Enter'); await page.waitForTimeout(200);
    const n0 = await page.evaluate(() => window.__saves.length);
    await page.keyboard.press('Control+s'); await page.waitForFunction((n) => window.__saves.length > n, n0, { timeout: 30000 });
    const saved = await page.evaluate(() => window.__saves[window.__saves.length - 1]);
    const out = `/home/claude/planmark/test/out/real-${name}`; fs.writeFileSync(out, Buffer.from(saved.b64, 'base64'));
    console.log(name, '| edited:', JSON.stringify(res.item), '| linework segments:', res.geo);
  }
  console.log('ERRORS:', errors.filter((e) => !e.includes('ERR_FAILED')).join('\n') || 'none');
  await browser.close();
})();
