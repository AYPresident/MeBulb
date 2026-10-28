// OCR with the bundled engine on a scanned (image-only) drawing
const { launch } = require('./harness');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1400, height: 900 } });
  const ev = (fn, a) => page.evaluate(fn, a);
  const r = await ev(async () => {
    const d = mebulb.activeDoc(); const c = await mebulb.renderToCanvas(d, 0, 2.2); const jpg = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85)).then((b) => b.arrayBuffer());
    const pdf = await PDFLib.PDFDocument.create(); const img = await pdf.embedJpg(jpg); const pg = pdf.addPage([d.pages[0].w, d.pages[0].h]); pg.drawImage(img, { x: 0, y: 0, width: d.pages[0].w, height: d.pages[0].h });
    const scan = await mebulb.openBytes('Scanned plan.pdf', await pdf.save()); const before = (await (await scan.pdf.getPage(1)).getTextContent()).items.length;
    const t0 = performance.now(); await mebulb.runOcr(scan, [0], {}); const ms = performance.now() - t0;
    const words = (scan.ocr[0] || []).map((w) => w.str); mebulb.runSearch('bedroom'); await new Promise((r) => setTimeout(r, 800));
    return { before, n: words.length, ms: Math.round(ms), sample: words.slice(0, 40).join(' '), hits: mebulb.state.search.hits.length };
  });
  ok(r.before === 0, 'scanned page has no text before OCR');
  ok(r.n > 40 && /BEDROOM/i.test(r.sample + ' ') , `OCR found ${r.n} words in ${r.ms} ms: ${r.sample.slice(0, 160)}`);
  ok(r.hits >= 3, `search finds OCR text: ${r.hits} hits for "bedroom"`);
  await page.screenshot({ path: OUT + '/ocr.png' });
  console.log(errors.filter((e) => !/XFA/.test(e)).join('\n') || 'no errors');
  await browser.close();
})();
