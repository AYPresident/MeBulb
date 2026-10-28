// Bluebeam Revu compatibility: open Revu-written measurements and counts as editable markups,
// write them back the way Revu writes them (same NM, same object numbers, /IT, /Measure, count groups)
const { launch } = require('./harness');
const fs = require('fs'); const { execSync } = require('child_process');
const OUT = '/home/claude/planmark/test/out'; const FIX = '/home/claude/planmark/test/fixtures/';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const save = (page) => page.evaluate(async () => { const d = mebulb.activeDoc(); d.reader = await mebulb.openReader(d.base.src); const u = await mebulb.incrementalUpdate(d, {}); const b = await d.base.src.all(); const all = new Uint8Array(b.length + u.bytes.length); all.set(b); all.set(u.bytes, b.length); let s = ''; for (let i = 0; i < all.length; i += 32768) s += String.fromCharCode.apply(null, all.subarray(i, i + 32768)); return btoa(s); });
const open = (page, file, name) => page.evaluate(async ([b64, name]) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const d = await mebulb.openBytes(name, bytes); await new Promise((r) => setTimeout(r, 600)); return d.markups.map((m) => ({ id: m.id, type: m.type, n: m.pts.length, text: mebulb.measureInfo(m, d) ? mebulb.measureInfo(m, d).text : m.text, nm: m.ext && m.ext.nm, sym: m.style.symbol, label: m.text })); }, [fs.readFileSync(file).toString('base64'), name]);
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1400, height: 900 } });
  // 1. Revu measurements
  const ms = await open(page, FIX + 'revu-measure.pdf', 'revu-measure.pdf');
  const types = ms.map((m) => m.type).sort().join(',');
  ok(ms.length === 10, `${ms.length} Revu markups opened as editable markups: ${types}`);
  const byNm = Object.fromEntries(ms.map((m) => [m.nm, m]));
  const len = byNm.MDTQWOSJVVVNNQCS; ok(len && len.type === 'length' && /5'-5/.test(len.text), `Revu length reads the same: ${len && len.text} (Revu: 5'-5")`);
  const area = ms.find((m) => m.type === 'area'); ok(area && /56\.\d+ sf/.test(area.text), `area: ${area && area.text} (Revu: 56.37 sf)`);
  const ang = ms.find((m) => m.type === 'angle'); ok(ang && /96\.\d/.test(ang.text), `angle: ${ang && ang.text} (Revu: 96.69°)`);
  const scale = await page.evaluate(() => { const d = mebulb.activeDoc(); return d.scales[0]; });
  ok(scale && Math.abs(scale.inPerPt - 48 / 72) < 1e-4 && scale.fmt === 'ftin', 'page scale read from Revu: ' + JSON.stringify(scale && { label: scale.label, inPerPt: scale.inPerPt, unit: scale.unit }));
  await page.screenshot({ path: OUT + '/revu-measure.png' });
  const b64 = await save(page); fs.writeFileSync(OUT + '/revu-measure-saved.pdf', Buffer.from(b64, 'base64'));
  ok(/No syntax or stream encoding errors/.test(execSync(`qpdf --check ${OUT}/revu-measure-saved.pdf 2>&1 || true`, { encoding: 'utf8' })), 'saved file passes qpdf');
  const q = execSync(`qpdf --qdf --object-streams=disable ${OUT}/revu-measure-saved.pdf - | strings`, { encoding: 'latin1', maxBuffer: 64e6 });
  for (const it of ['LineDimension', 'PolygonDimension', 'PolyLineDimension', 'PolyLineAngle', 'PolygonVolume', 'PolygonCount', 'PolygonRadius']) ok(q.includes('/IT /' + it), 'written back with /IT /' + it);
  ok(q.includes('MDTQWOSJVVVNNQCS') && q.includes('/MeasurementTypes 130') && q.includes('/Subtype /RL'), 'keeps Revu NM, /MeasurementTypes and /Measure');
  const origRef = execSync(`python3 -c "import re,sys;d=open(sys.argv[1],'rb').read();i=d.find(b'MDTQWOSJVVVNNQCS');j=d.rfind(b' 0 obj',0,i);k=d.rfind(b'\\n',0,j);print(d[k+1:j].decode())" ${FIX}revu-measure.pdf`, { encoding: 'utf8' }).trim();
  const lastObj = execSync(`python3 -c "import re,sys;d=open(sys.argv[1],'rb').read();i=d.rfind(b'MDTQWOSJVVVNNQCS');j=d.rfind(b' 0 obj',0,i);k=d.rfind(b'\\n',0,j);print(d[k+1:j].decode())" ${OUT}/revu-measure-saved.pdf`, { encoding: 'utf8' }).trim();
  ok(origRef === lastObj, `rewritten in place: object ${origRef} -> ${lastObj}`);
  const n2 = await open(page, OUT + '/revu-measure-saved.pdf', 'saved again.pdf');
  ok(n2.length === ms.length && n2.map((m) => m.type).sort().join(',') === types, `reopened in MeBulb: ${n2.length} markups, no duplicates`);
  // 2. Revu count groups
  const cs = await open(page, FIX + 'revu-markups.pdf', 'revu-markups.pdf');
  const counts = cs.filter((m) => m.type === 'count');
  ok(counts.length >= 1 && counts.some((c) => c.n > 5), `Revu count groups become MeBulb counts: ${counts.map((c) => `${c.n}×${c.sym}`).join(', ')}`);
  const b2 = await save(page); fs.writeFileSync(OUT + '/revu-markups-saved.pdf', Buffer.from(b2, 'base64'));
  const q2 = execSync(`qpdf --qdf --object-streams=disable ${OUT}/revu-markups-saved.pdf - | strings`, { encoding: 'latin1', maxBuffer: 64e6 });
  ok(/\/GroupNesting \[/.test(q2) && /\/RT \/Group/.test(q2) && q2.includes('NUZGAFWLSHXPQNLR'), 'counts written back as Revu count groups with their NMs');
  const c3 = await open(page, OUT + '/revu-markups-saved.pdf', 'counts again.pdf');
  ok(c3.filter((m) => m.type === 'count').map((c) => c.n).join() === counts.map((c) => c.n).join(), 'count groups survive a round trip');
  await page.screenshot({ path: OUT + '/revu-counts.png' });
  // 3. Markups flattened in Revu with "Allow markup recovery": a content stream marked /BBType /Melted
  //    draws their appearances and keeps the annotations in its own /Annots (layout taken from a Revu 20 file)
  const melted = await page.evaluate(async () => {
    const { PDFDocument, PDFName, PDFString, PDFHexString } = PDFLib; const pdf = await PDFDocument.create(); const pg = pdf.addPage([600, 400]); const ctx = pdf.context;
    pg.drawText('DRAWING', { x: 40, y: 360, size: 14 });
    const ap1 = ctx.register(ctx.stream('1 0.4 0 RG 3 w 1 1 1 rg 101.5 101.5 197 97 re B', { Type: 'XObject', Subtype: 'Form', BBox: [100, 100, 300, 200], Matrix: [1, 0, 0, 1, -100, -100], Resources: {} }));
    const font = pdf.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }); const fref = ctx.register(font);
    const ap2 = ctx.register(ctx.stream('BT 0 0 0 rg /Helv 10 Tf 1 0 0 1 112 180 Tm (DATE RECEIVED:) Tj 1 0 0 1 112 168 Tm (25/05/2026) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [110, 120, 290, 190], Matrix: [1, 0, 0, 1, -110, -120], Resources: { Font: { Helv: fref } } }));
    const sq = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [100, 100, 300, 200], RD: [1.5, 1.5, 1.5, 1.5], C: [1, 0.4, 0], IC: [1, 1, 1], BS: { Type: 'Border', W: 3, S: 'S' }, NM: PDFString.of('UDSVTLWNQEIQJYSC'), Subj: PDFString.of('Rectangle'), T: PDFString.of('Revu User'), F: 4, AP: { N: ap1 } }));
    const rc = '<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:APIVersion="BluebeamPDFRevu:2018" xfa:spec="2.2.0" style="font:Helvetica 10pt; text-align:left; margin:0.6pt; line-height:11.5pt; color:#000000"><p>DATE RECEIVED:</p><p>25/05/2026</p><p/><p>APPROVED:</p></body>';
    const tx = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [110, 120, 290, 190], C: [1, 1, 1], DA: PDFString.of('1 0 0 rg /Helv 10 Tf'), DS: PDFString.of('font: Helvetica 10pt; text-align:left; margin:0.6pt; line-height:11.5pt; color:#000000'), RC: PDFString.of(rc), Contents: PDFHexString.fromText('DATE RECEIVED:\r25/05/2026\r\rAPPROVED:'), NM: PDFString.of('CLUEBEJZPPYLFMOG'), IRT: sq, RT: PDFName.of('Group'), BS: { Type: 'Border', W: 0, S: 'S' }, F: 4, AP: { N: ap2 } }));
    ctx.lookup(sq).set(PDFName.of('GroupNesting'), ctx.obj([PDFString.of('Group'), PDFName.of('UDSVTLWNQEIQJYSC'), PDFName.of('CLUEBEJZPPYLFMOG')]));
    const xo = pg.node.normalizedEntries().XObject; xo.set(PDFName.of('BBA'), ap1); xo.set(PDFName.of('BBA1'), ap2);
    const mref = ctx.register(ctx.stream('q 1 0 0 1 0 0 cm q 1 0 0 1 100 100 cm /BBA Do Q q 1 0 0 1 110 120 cm /BBA1 Do Q Q ', { BBType: 'Melted', Annots: [sq, tx] }));
    const c = pg.node.get(PDFName.of('Contents')); pg.node.set(PDFName.of('Contents'), ctx.obj([...(c instanceof PDFLib.PDFArray ? c.asArray() : [c]), mref]));
    const bytes = await pdf.save({ useObjectStreams: false }); let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s);
  });
  fs.writeFileSync(OUT + '/revu-melted.pdf', Buffer.from(melted, 'base64'));
  const m0 = await open(page, OUT + '/revu-melted.pdf', 'revu-melted.pdf');
  const found = await page.evaluate(() => mebulb.revuFlatCount(mebulb.activeDoc()));
  ok(m0.length === 0 && found === 2, `Revu-flattened markups found, not shown as live markups (${found})`);
  const un = await page.evaluate(async () => { const d = mebulb.activeDoc(); const rv = await mebulb.unflattenRevu(d, null); await mebulb.patchView(d, rv.pages); const t = d.markups.find((m) => m.type === 'text'); return { rv, n: d.markups.length, groups: new Set(d.markups.map((m) => m.group)).size, text: t && (t.runs ? t.runs.map((r) => r.t).join('') : t.text), stroke: t && t.style.stroke }; });
  ok(un.rv.count === 2 && un.groups === 1 && un.text === 'DATE RECEIVED:\n25/05/2026\n\nAPPROVED:', `unflatten gives an editable group of ${un.n}: text box reads ${JSON.stringify(un.text)}`);
  const b4 = await save(page); fs.writeFileSync(OUT + '/revu-unmelted.pdf', Buffer.from(b4, 'base64'));
  const q4 = execSync(`qpdf --qdf --object-streams=disable ${OUT}/revu-unmelted.pdf - | strings`, { encoding: 'latin1', maxBuffer: 64e6 });
  const cont = (q4.match(/\/Contents \[([^\]]*)\]/g) || []).pop() || '';
  ok(!/BBType \/Melted[\s\S]*?endstream[\s\S]*?\/Contents/.test(q4.slice(q4.lastIndexOf('/Type /Page'))) && /\/IRT \d+ 0 R/.test(q4) && /\/RT \/Group/.test(q4) && q4.includes('/NM (UDSVTLWNQEIQJYSC)') && /No syntax/.test(execSync(`qpdf --check ${OUT}/revu-unmelted.pdf 2>&1 || true`, { encoding: 'utf8' })), 'saved: melted content gone from the page, annotations back with Revu ids and group links');
  const m5 = await open(page, OUT + '/revu-unmelted.pdf', 'unmelted again.pdf'); const left = await page.evaluate(() => mebulb.revuFlatCount(mebulb.activeDoc()));
  ok(m5.length === 2 && left === 0, `reopened: ${m5.length} markups, nothing left flattened`);
  console.log(errors.filter((e) => !/XFA/.test(e)).join('\n') || 'no errors');
  await browser.close();
})();
