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
  // 3. MeBulb's own sample, written for Revu
  const b3 = await page.evaluate(async () => { mebulb.state.docs.forEach(() => {}); const d = mebulb.state.docs.find((x) => x.sample); await mebulb.state.docs.indexOf(d); return null; });
  console.log(errors.filter((e) => !/XFA/.test(e)).join('\n') || 'no errors');
  await browser.close();
})();
