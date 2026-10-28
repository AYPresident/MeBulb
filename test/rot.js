const { launch } = require('./harness');
const P = require(require('./paths').pdfLibDir()); const fs = require('fs');
(async () => {
  // build a test PDF: page1 rotated 90, page2 offset mediabox
  const pdf = await P.PDFDocument.create(); const f = await pdf.embedFont(P.StandardFonts.HelveticaBold);
  const p1 = pdf.addPage([612, 792]); p1.setRotation(P.degrees(90));
  // with /Rotate 90, the visual top-left corresponds to PDF user point (0,0)... draw a marker box at (40,40) size 80x40 in user space
  p1.drawRectangle({ x: 40, y: 40, width: 80, height: 40, color: P.rgb(0.2, 0.6, 1) }); p1.drawText('A', { x: 70, y: 52, size: 20, font: f });
  const p2 = pdf.addPage([612, 792]); p2.setMediaBox(100, 100, 612, 792);
  p2.drawRectangle({ x: 140, y: 792 + 100 - 80, width: 80, height: 40, color: P.rgb(1, 0.5, 0.2) }); p2.drawText('B', { x: 170, y: 792 + 100 - 68, size: 20, font: f });
  const bytes = await pdf.save(); fs.writeFileSync('test/out/rot-src.pdf', bytes);
  const { browser, page, errors } = await launch();
  const res = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const d = await planmark.openBytes('rot.pdf', bin);
    // find the drawn boxes via rendering is hard; instead compute where user-space boxes land in viewport coords using T
    const T0 = d.pages[0].T, T1 = d.pages[1].T; const ap = (T, x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]];
    const c0 = [ap(T0, 40, 40), ap(T0, 120, 80)], c1 = [ap(T1, 140, 812), ap(T1, 220, 852)];
    const mk = (page, a, b) => ({ id: 'PM-t' + page, type: 'rect', page, pts: [[Math.min(a[0], b[0]) - 4, Math.min(a[1], b[1]) - 4], [Math.max(a[0], b[0]) + 4, Math.max(a[1], b[1]) + 4]], style: { stroke: '#d6331f', fill: 'none', width: 2, opacity: 1, fillOpacity: 0.2, dash: 'solid' }, text: '', subject: 'Rect', author: 't', created: new Date().toISOString(), modified: new Date().toISOString(), status: 'None', comment: '', layer: null });
    const tx = (page, a) => ({ id: 'PM-x' + page, type: 'text', page, pts: [[a[0], a[1] - 30], [a[0] + 120, a[1] - 10]], style: { stroke: '#d6331f', fill: 'none', width: 0, opacity: 1, fontSize: 12, fontColor: '#1f5fd1', dash: 'solid', align: 'left' }, text: 'upright label', subject: 'Text', author: 't', created: new Date().toISOString(), modified: new Date().toISOString(), status: 'None', comment: '', layer: null });
    d.markups.push(mk(0, ...c0), mk(1, ...c1), tx(0, [Math.min(c0[0][0], c0[1][0]), Math.min(c0[0][1], c0[1][1])]));
    const toB64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
    return { pages: d.pages.map(p => [p.w, p.h, p.rotate]), save: toB64(await planmark.buildPdf(d, { flatten: false })), flat: toB64(await planmark.buildPdf(d, { flatten: true })), c0, c1 };
  }, Buffer.from(bytes).toString('base64'));
  fs.writeFileSync('test/out/rot-save.pdf', Buffer.from(res.save, 'base64')); fs.writeFileSync('test/out/rot-flat.pdf', Buffer.from(res.flat, 'base64'));
  console.log(JSON.stringify({ pages: res.pages, c0: res.c0, c1: res.c1 }));
  console.log('ERRORS:', errors.filter(e => !e.includes('ERR_FAILED')).join('\n') || 'none');
  await browser.close();
})();
