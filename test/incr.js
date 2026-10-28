// Incremental save, reopen (own annotations hidden), chained saves, installed font embedding
const { launch } = require('./harness');
const fs = require('fs'); const { execSync } = require('child_process');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const annotCount = (f) => { try { const j = JSON.parse(execSync(`qpdf --json --json-key=pages ${f}`, { encoding: 'utf8' })); const o = j.pages[0].object.split(' ')[0]; const d = execSync(`qpdf --show-object=${o} ${f}`, { encoding: 'utf8' }); const m = /\/Annots \[([^\]]*)\]/.exec(d); return m ? (m[1].match(/ R/g) || []).length : 0; } catch (e) { return -1; } };
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return 'ERR ' + (e.stderr || e.message); } };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1400, height: 900 } });
  const ev = (fn, a) => page.evaluate(fn, a);
  const LIB = '/usr/share/fonts/truetype/liberation/';
  // installed fonts (as the desktop app would list them)
  await ev((LIB) => {
    const src = (f) => () => fetch('/font/' + encodeURIComponent(LIB + f)).then((r) => r.arrayBuffer()).then((b) => ({ bytes: new Uint8Array(b), index: 0 }));
    mebulb.addFaces([
      { family: 'Liberation Sans', sub: 'Regular', weight: 400, src: src('LiberationSans-Regular.ttf') },
      { family: 'Liberation Sans', sub: 'Bold', weight: 700, src: src('LiberationSans-Bold.ttf') },
      { family: 'Liberation Serif', sub: 'Regular', weight: 400, src: src('LiberationSerif-Regular.ttf') },
    ]);
  }, LIB);
  const fams = await ev(() => mebulb.fonts().list);
  ok(fams.includes('Liberation Sans') && fams.includes('Liberation Serif'), 'font list has installed families: ' + fams.join(', '));
  // put a text markup in Liberation Sans (bold run + plain) and the riser label in Liberation Serif
  const tinfo = await ev(async () => {
    const d = mebulb.activeDoc(); const t = d.markups.find((m) => m.type === 'text'); t.style.font = 'sys:Liberation Sans'; t.runs = null; t.text = 'Liberation text ² → check';
    const sk = d.markups.find((m) => m.type === 'sketch'); sk.style.font = 'sys:Liberation Serif'; sk.style.italic = true;
    await mebulb.ensureDocFonts(d); mebulb.renderAllMarks(d);
    const w1 = mebulb.layoutRich ? 1 : 0; return { id: t.id, sk: sk.id, w: w1 };
  });
  const widths = await ev(() => { const S = mebulb.sysFace('sys:Liberation Sans', false, false); return S ? [S.face.F.width(65), S.face.F.width(87)] : null; });
  ok(widths && Math.abs(widths[0] - 667) < 2 && Math.abs(widths[1] - 944) < 2, 'Liberation Sans metrics read from the font (A, W): ' + JSON.stringify(widths));
  // 1. incremental save on the sample
  const r1 = await ev(async () => {
    const d = mebulb.activeDoc(); d.reader = await mebulb.openReader(d.src);
    const t0 = performance.now(); const u = await mebulb.incrementalUpdate(d, {}); const ms = performance.now() - t0;
    const all = new Uint8Array(d.src.size + u.bytes.length); all.set(d.src.bytes); all.set(u.bytes, d.src.size);
    return { b64: btoa(Array.from(all, (c) => String.fromCharCode(c)).join('')), app: u.bytes.length, base: d.src.size, ms, kind: u.kind, n: d.markups.length };
  });
  fs.writeFileSync(OUT + '/incr1.pdf', Buffer.from(r1.b64, 'base64'));
  // the append carries the markups (a few KB each with their appearances; sketches go out as several
  // grouped parts) and the fonts they use, never the drawing itself
  ok(r1.app > 1000 && r1.app < r1.n * 8000, `appended ${r1.app} bytes for ${r1.n} markups to ${r1.base} (xref ${r1.kind}) in ${r1.ms.toFixed(0)} ms`);
  console.log('qpdf:', sh(`qpdf --check ${OUT}/incr1.pdf 2>&1 | tail -2`).trim());
  ok(/No syntax or stream encoding errors/.test(sh(`qpdf --check ${OUT}/incr1.pdf 2>&1`)), 'qpdf finds no structural errors');
  const fonts1 = sh(`pdffonts ${OUT}/incr1.pdf`); console.log(fonts1.trim());
  ok(/\+LiberationSans\S*\s+CID TrueType\s+Identity-H\s+yes\s+yes\s+yes/.test(fonts1), 'Liberation Sans embedded as a subset with ToUnicode');
  ok(/\+LiberationSerif/.test(fonts1), 'Liberation Serif (riser label, synthetic italic) embedded');
  const txt = sh(`pdftotext -layout ${OUT}/incr1.pdf - | grep -i "liberation text"`); ok(/Liberation text/.test(txt), 'text in the embedded font extracts: ' + txt.trim().slice(0, 60));
  sh(`pdftoppm -r 60 -f 1 -l 1 -png ${OUT}/incr1.pdf ${OUT}/incr1`);
  // annotation counts with pdf.js in the page
  const counts = await ev(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = await mebulb.openBytes('Saved once.pdf', bytes); await new Promise((r) => setTimeout(r, 800));
    const p0 = await d.pdf.getPage(1); const anns = await p0.getAnnotations();
    const own = (await d.viewReader.pageAnnots(0)).list.filter((a) => a.ours).length;
    return { annots: anns.length, own, markups: d.markups.length, hasOwn: d.hasOwnAnnots, stored: d.pdf.annotationStorage.size, mode: mebulb.state.docs.length };
  }, r1.b64);
  ok(counts.hasOwn && counts.own > 5 && counts.markups === r1.n, `reopened: ${counts.markups} markups restored, ${counts.own} own annotations found on page 1 (pdf.js sees ${counts.annots})`);
  ok(counts.stored >= counts.own, `own annotations hidden from the canvas (${counts.stored} storage entries)`);
  await page.screenshot({ path: OUT + '/incr-reopen.png' });
  // 2. chained save: change one markup, append again on top of the saved file
  const r2 = await ev(async () => {
    const d = mebulb.activeDoc(); const t = d.markups.find((m) => m.type === 'text'); t.text = 'Second save'; t.runs = null;
    d.reader = await mebulb.openReader(d.src); const u = await mebulb.incrementalUpdate(d, {});
    const all = new Uint8Array(d.src.size + u.bytes.length); all.set(d.src.bytes); all.set(u.bytes, d.src.size);
    return { b64: btoa(Array.from(all, (c) => String.fromCharCode(c)).join('')), app: u.bytes.length };
  });
  fs.writeFileSync(OUT + '/incr2.pdf', Buffer.from(r2.b64, 'base64'));
  ok(/No syntax or stream encoding errors/.test(sh(`qpdf --check ${OUT}/incr2.pdf 2>&1`)), 'second append passes qpdf');
  const n1 = sh(`qpdf --show-npages ${OUT}/incr2.pdf`).trim(); ok(n1 === '4', 'still 4 pages');
  const txt2 = sh(`pdftotext ${OUT}/incr2.pdf - | grep -c "Second save" || true`).trim(); const txt2b = sh(`pdftotext ${OUT}/incr2.pdf - 2>/dev/null | grep -c "Liberation text" || true`).trim();
  ok(txt2 === '1' && txt2b === '0', `old annotation replaced, not duplicated (new ${txt2}, old ${txt2b})`);
  const a0 = annotCount(`${OUT}/incr2.pdf`);
  ok(a0 === counts.own, `page 1 annotation count unchanged after second save (${a0})`);
  // 3. pdf-lib full rewrite path on the reopened file still strips and rewrites cleanly
  const r3 = await ev(async () => { const d = mebulb.activeDoc(); const b = await mebulb.buildPdf(d, {}); return btoa(Array.from(b, (c) => String.fromCharCode(c)).join('')); });
  fs.writeFileSync(OUT + '/full.pdf', Buffer.from(r3, 'base64'));
  const f0 = annotCount(`${OUT}/full.pdf`);
  ok(f0 === counts.own, `full rewrite: page 1 has ${f0} annotations (no duplicates)`);
  // 4. big-file path: open through a Blob source (range reads), check pdf.js and snapping geometry
  const r4 = await ev(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const blob = new Blob([bytes]); const src = mebulb.blobSource(blob);
    const d = await mebulb.openSource('Big.pdf', src, {}); await new Promise((r) => setTimeout(r, 600));
    const g = await mebulb.buildGeometry(d, 0); return { pages: d.numPages, markups: d.markups.length, segs: g.n, kind: d.src.kind, own: d.hasOwnAnnots };
  }, r2.b64);
  ok(r4.kind === 'blob' && r4.pages === 4 && r4.markups === r1.n && r4.own, `range-read open: ${r4.pages} pages, ${r4.markups} markups`);
  ok(r4.segs > 100, `vector snapping geometry from a partial page load: ${r4.segs} segments`);
  await page.screenshot({ path: OUT + '/incr-big.png' });
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})();
