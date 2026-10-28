// Tests for the round-2 features: sketch to scale + linked risers, transitions, cutouts,
// viewports, content snap, grid snap, edit text, forms, OCR layer.
const { launch } = require('./harness');
const fs = require('fs');
const OUT = '/home/claude/planmark/test/out';
const stub = () => {
  window.__saves = [];
  window.showSaveFilePicker = async (o) => ({ createWritable: async () => ({ write: async (b) => { const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); window.__saves.push({ name: o.suggestedName, b64: btoa(s) }); }, close: async () => {} }) });
};
(async () => {
  const { browser, page, errors } = await launch({ init: stub, viewport: { width: 1440, height: 1200 } });
  const results = []; const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const P = async (x, y, i = 0) => ev(([i, x, y]) => { const d = planmark.activeDoc(); const r = d.pageEls[i].getBoundingClientRect(); return [r.left + x * d.zoom, r.top + y * d.zoom]; }, [i, x, y]);
  const click = async (x, y, i = 0) => { const [cx, cy] = await P(x, y, i); await page.mouse.click(cx, cy); await page.waitForTimeout(50); };
  const drag = async (x1, y1, x2, y2, steps = 8, i = 0) => { const a = await P(x1, y1, i), b = await P(x2, y2, i); await page.mouse.move(a[0], a[1]); await page.mouse.down(); for (let k = 1; k <= steps; k++) await page.mouse.move(a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps); await page.mouse.up(); await page.waitForTimeout(80); };
  const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(50); };
  const last = () => ev(() => { const d = planmark.activeDoc(); return d.markups[d.markups.length - 1]; });
  const show = async (x, y, i = 0) => { await ev(([x, y, i]) => { planmark.setZoom(1); const d = planmark.activeDoc(); const v = document.getElementById('viewer'); v.scrollTop = d.pageEls[i].offsetTop + y - 60; v.scrollLeft = d.pageEls[i].offsetLeft + x - 60; }, [x, y, i]); await page.waitForTimeout(350); };
  try {
    await ev(() => { planmark.state.snapMarkup = false; planmark.state.snapContent = false; });
    // ---------- sample risers
    const MM = (v) => Math.round(v * 25.4); const nearMM = (v, t, tol = 10) => Math.abs(MM(v) - t) <= tol;
    let r = await ev(() => { const d = planmark.activeDoc(); const sa = d.markups.filter((m) => m.link === 'LK-m1').sort((a, b) => a.page - b.page); return sa.map((m) => planmark.sketchTrans(d, m) ? 'T' : Math.round(planmark.sketchSize(d, m).w * 25.4)); });
    ok('sample riser M1 on 3 levels with transition on level 2', JSON.stringify(r) === '[600,"T",450]', JSON.stringify(r));
    // ---------- sketch rectangle: click to place default size
    await show(300, 620);
    await key('b'); await click(420, 700);
    let m = await last(); ok('sketch rect click places default 600x300 mm', m.type === 'sketch' && MM(m.sz.w) === 600 && MM(m.sz.h) === 300, JSON.stringify(m.sz));
    ok('new sketch gets the next riser name', !!m.name, m.name);
    // drag to draw at 1:50: 56.7 pt = 1000 mm real
    await key('b'); await drag(500, 680, 557, 708); m = await last(); ok('sketch rect drag rounds to 10 mm', nearMM(m.sz.w, 1000) && nearMM(m.sz.h, 500) && MM(m.sz.w) % 10 === 0, JSON.stringify([MM(m.sz.w), MM(m.sz.h)]));
    await key('o'); await drag(650, 700, 658.5, 700); m = await last(); ok('sketch circle drag sets diameter', m.sz.shape === 'circle' && nearMM(m.sz.d, 300), JSON.stringify(MM(m.sz.d)));
    // select the 36x18 rectangle and place it on pages 2 and 3
    await key('Escape'); await key('v'); await click(528, 694);
    const selId = await ev(() => [...planmark.state.sel][0]); const sel = await ev((id) => planmark.activeDoc().markups.find((x) => x.id === id), selId);
    ok('select sketch', sel && sel.type === 'sketch' && sel.sz && nearMM(sel.sz.w, 1000), sel && JSON.stringify(sel.sz));
    await page.click('#propbar [data-act="place"]'); await page.waitForSelector('.page-pick');
    await page.check('.page-pick input[name=p1]'); await page.check('.page-pick input[name=p2]'); await page.click('.modal footer .btn.primary'); await page.waitForTimeout(300);
    r = await ev((id) => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.id === id); return { link: m.link, pages: planmark.linkSiblings(d, m).map((x) => x.page).sort() }; }, selId);
    ok('place on pages links 3 instances', r.link && JSON.stringify(r.pages) === '[0,1,2]', JSON.stringify(r));
    // resize via properties width -> all pages follow
    await page.click('#rstrip [data-panel=props]'); await page.waitForTimeout(100);
    await page.fill('#props [data-k="sz.w"]', '750'); await page.press('#props [data-k="sz.w"]', 'Enter'); await page.waitForTimeout(200);
    r = await ev((id) => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.id === id); return planmark.linkSiblings(d, m).map((x) => Math.round(planmark.sketchSize(d, x).w * 25.4)); }, selId);
    ok('resize one updates all pages (typed 750 = mm)', JSON.stringify(r) === '[750,750,750]', JSON.stringify(r));
    // handle drag resize also propagates
    await ev(() => { planmark.state.snapMarkup = false; });
    // add transition on page 1 instance, later pages follow
    await page.click('#props [data-act="sk-addtrans"]'); await page.waitForSelector('#tr-shape');
    await page.selectOption('#tr-shape', 'circle'); await page.fill('#dlg-form input[name=d]', '350'); await page.click('.modal footer .btn.primary'); await page.waitForTimeout(200);
    r = await ev((id) => { const d = planmark.activeDoc(); const R = (v) => Math.round(v * 25.4); const m = d.markups.find((x) => x.id === id); return planmark.linkSiblings(d, m).sort((a, b) => a.page - b.page).map((x) => { const s = planmark.sketchSize(d, x); const t = planmark.sketchTrans(d, x); return (s.shape === 'circle' ? 'O' + R(s.d) : R(s.w) + 'x' + 'h') + (t ? '>' + (t.shape === 'circle' ? 'O' + R(t.d) : R(t.w)) : ''); }); }, selId);
    ok('transition rect->round on this page, later pages use round', JSON.stringify(r) === '["750xh>O350","O350","O350"]', JSON.stringify(r));
    // change the round size on the transition page -> later pages change
    await page.fill('#props [data-k="tsz.d"]', '400'); await page.press('#props [data-k="tsz.d"]', 'Enter'); await page.waitForTimeout(200);
    r = await ev((id) => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.id === id); return planmark.linkSiblings(d, m).filter((x) => x.page > 0).map((x) => Math.round(planmark.sketchSize(d, x).d * 25.4)); }, selId);
    ok('editing transition size updates pages above', JSON.stringify(r) === '[400,400]', JSON.stringify(r));
    // move with sync
    const before = await ev((id) => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.id === id); return planmark.linkSiblings(d, m).map((x) => x.pts[0].slice()); }, selId);
    await drag(528, 694, 548, 704);
    const after = await ev((id) => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.id === id); return planmark.linkSiblings(d, m).map((x) => x.pts[0].slice()); }, selId);
    ok('moving one moves the whole set', after.every((p, k) => Math.abs(p[0] - before[k][0] - 20) < 1 && Math.abs(p[1] - before[k][1] - 10) < 1), JSON.stringify([before[1], after[1]]));
    // linked panel previews
    await page.click('#rstrip [data-panel=linked]'); await page.waitForTimeout(1500);
    const crops = await ev(() => document.querySelectorAll('#linked-panel .lk-crop img').length); ok('linked panel shows per-page previews', crops >= 3, 'crops=' + crops);
    await page.screenshot({ path: OUT + '/r2-linked.png' });
    await page.click('#rstrip [data-panel=props]');
    // undo restores size
    const und = await ev(async () => { await planmark.undo(); await planmark.undo(); const d = planmark.activeDoc(); return Object.keys(d.links).length; }); ok('undo works with links', und >= 3, 'links=' + und);
    await ev(async () => { await planmark.redo(); await planmark.redo(); });

    // ---------- area with cutout
    await key('Escape'); await show(300, 900);
    await key('Shift+Alt+A'); for (const [x, y] of [[320, 940], [500, 940], [500, 1120]]) await click(x, y); { const [x, y] = await P(320, 1120); await page.mouse.dblclick(x, y); } await page.waitForTimeout(80);
    m = await last(); let a0 = await ev((id) => { const d = planmark.activeDoc(); return planmark.measureInfo(d.markups.find((x) => x.id === id), d).text; }, m.id);
    ok('area 10.08 m² (180 pt square at 1:50)', a0 === '10.08 m²', a0);
    await key('v'); await click(410, 1030); await page.waitForTimeout(100);
    await page.click('#props [data-act="cutout"]'); await page.waitForTimeout(100);
    for (const [x, y] of [[380, 1000], [416, 1000], [416, 1036]]) await click(x, y); { const [x, y] = await P(380, 1036); await page.mouse.dblclick(x, y); } await page.waitForTimeout(150);
    a0 = await ev((id) => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.id === id); return [planmark.measureInfo(m, d).text, (m.holes || []).length]; }, m.id);
    ok('cutout subtracts 0.40 m²', a0[0] === '9.68 m²' && a0[1] === 1, JSON.stringify(a0));
    await page.screenshot({ path: OUT + '/r2-cutout.png' });

    // ---------- viewport with its own scale
    await key('Escape'); await key('Shift+W'); await drag(600, 940, 900, 1150); await page.waitForSelector('#vp-preset');
    await page.selectOption('#vp-preset', '1:20'); await page.fill('#dlg-form input[name=name]', 'Enlarged laundry'); await page.click('.modal footer .btn.primary'); await page.waitForTimeout(200);
    const vps = await ev(() => (planmark.activeDoc().viewports[0] || []).map((v) => v.name + '|' + v.scale.label)); ok('viewport created', vps.length === 1 && vps[0].includes('1:20'), JSON.stringify(vps));
    await key('Shift+Alt+L'); await click(620, 1100); await click(710, 1100); let mi = await ev(() => { const d = planmark.activeDoc(); return planmark.measureInfo(d.markups[d.markups.length - 1], d).text; });
    ok('length inside viewport uses 1:20 (90 pt = 0.64 m)', mi === '0.64 m', mi);
    await key('Shift+Alt+L'); await click(320, 1160); await click(410, 1160); mi = await ev(() => { const d = planmark.activeDoc(); return planmark.measureInfo(d.markups[d.markups.length - 1], d).text; });
    ok('length outside viewport uses page scale (1.59 m)', mi === '1.59 m', mi);

    // ---------- content snap: wall corner of the plan (outer corner at plan (0,0) -> page (210,215))
    await key('Escape'); await ev(() => { planmark.state.snapContent = true; }); await show(210, 215);
    const g = await ev(async () => { const d = planmark.activeDoc(); const t0 = performance.now(); const g = await planmark.buildGeometry(d, 0); return { n: g.n, ms: Math.round(performance.now() - t0) }; });
    ok('linework indexed', g.n > 500, JSON.stringify(g));
    const sn = await ev(() => planmark.contentSnap(planmark.activeDoc(), 0, [212.5, 212.8], 9));
    ok('snaps to wall corner endpoint', sn && Math.abs(sn.p[0] - 210) < 0.6 && Math.abs(sn.p[1] - 215) < 0.6 && (sn.kind === 'end' || sn.kind === 'int'), JSON.stringify(sn));
    const sn2 = await ev(() => planmark.contentSnap(planmark.activeDoc(), 0, [600, 218.5], 9));
    ok('snaps onto wall line', sn2 && Math.abs(sn2.p[1] - 215) < 0.6, JSON.stringify(sn2));
    // drawing a length with content snap lands on linework
    await key('Shift+Alt+L'); { const [x, y] = await P(212, 213); await page.mouse.move(x, y); await page.waitForTimeout(80); await page.mouse.click(x, y); } { const [x, y] = await P(600, 212); await page.mouse.click(x, y); }
    m = await last(); ok('length endpoints snapped to wall', m.type === 'length' && Math.abs(m.pts[0][0] - 210) < 0.6 && Math.abs(m.pts[0][1] - 215) < 0.6 && Math.abs(m.pts[1][1] - 215) < 0.6, JSON.stringify(m.pts));
    await ev(() => { planmark.state.snapContent = false; });
    // ---------- grid snap
    await page.click('.tog[data-tog=showGrid]'); await page.click('.tog[data-tog=snapGrid]');
    await key('l'); await click(303, 305); await click(352, 307); m = await last();
    const g5 = (5 / 25.4) * 72; const onGrid = (v) => Math.abs(v / g5 - Math.round(v / g5)) < 1e-6;
    ok('grid snap rounds to the 5 mm paper grid', m.pts.flat().every(onGrid) && Math.abs(m.pts[0][0] - 303) < g5 / 2 + 0.01, JSON.stringify(m.pts));
    await page.click('.tog[data-tog=showGrid]'); await page.click('.tog[data-tog=snapGrid]');

    // ---------- edit PDF text on page 1 ("BEDROOM 2")
    await ev(() => planmark.runSearch('BEDROOM 2')); await page.waitForTimeout(500);
    const hit = await ev(() => planmark.state.search.hits.find((h) => h.page === 0));
    const hx = (hit.rects[0][0][0] + hit.rects[0][1][0]) / 2, hy = (hit.rects[0][0][1] + hit.rects[0][2][1]) / 2;
    await ev(() => planmark.runSearch('')); await show(hx - 100, hy - 100); await ev(() => planmark.pageText(planmark.activeDoc(), 0));
    await key('x'); await click(hx, hy); await page.waitForSelector('.pdf-edit');
    await page.fill('.pdf-edit', 'BEDROOM 4'); await page.press('.pdf-edit', 'Enter'); await page.waitForTimeout(150);
    m = await last(); ok('text edit created', m.type === 'textedit' && m.text === 'BEDROOM 4' && m.orig === 'BEDROOM 2', JSON.stringify({ t: m.type, text: m.text, orig: m.orig }));
    await page.screenshot({ path: OUT + '/r2-textedit.png' });

    // ---------- OCR layer (simulated recognition results; the engines need network access)
    await ev(() => { const d = planmark.activeDoc(); d.ocr[3] = [{ str: 'SCANNEDWORD', x: 300, y: 1000, w: 120, h: 14 }]; d.textCache[3] = null; });
    await ev(() => planmark.runSearch('scannedword')); await page.waitForTimeout(800);
    ok('OCR words are searchable', await ev(() => planmark.state.search.hits.length === 1 && planmark.state.search.hits[0].page === 3));
    await ev(() => planmark.runSearch(''));

    // ---------- save, inspect, reopen
    await page.click('[data-cmd="file.save"]'); await page.waitForFunction(() => window.__saves.length >= 1, null, { timeout: 30000 });
    const saved = await ev(() => window.__saves[window.__saves.length - 1]); fs.writeFileSync(OUT + '/r2-saved.pdf', Buffer.from(saved.b64, 'base64'));
    ok('saved', saved.name.endsWith('.pdf'));
    await ev(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await planmark.openBytes('r2-roundtrip.pdf', bin); }, saved.b64); await page.waitForTimeout(1200);
    const rt = await ev(() => { const d = planmark.activeDoc(); const te = d.markups.find((m) => m.type === 'textedit'); return { links: Object.keys(d.links).length, sketches: d.markups.filter((m) => m.type === 'sketch').length, vps: (d.viewports[0] || []).length, te: te && { applied: te.applied, text: te.text }, holes: (d.markups.find((m) => m.holes && m.holes.length) || {}).holes }; });
    ok('reopen keeps links, viewports, cutouts and text edit', rt.links === 4 && rt.sketches === 14 && rt.vps === 1 && rt.te && rt.te.applied === true && rt.holes && rt.holes.length === 1, JSON.stringify({ ...rt, holes: rt.holes && rt.holes.length }));
    const txt = await ev(async () => { const d = planmark.activeDoc(); const p = await d.pdf.getPage(1); const tc = await p.getTextContent(); return tc.items.map((i) => i.str).join('|'); });
    ok('original glyphs removed from page content', !txt.includes('BEDROOM 2') && txt.includes('BEDROOM 1') && txt.includes('BEDROOM 3'), txt.slice(0, 200));
    const reAnn = await ev(async () => { const d = planmark.activeDoc(); const p = await d.pdf.getPage(1); return (await p.getAnnotations()).length; }); ok('reopen strips our annotations', reAnn === 0, 'annots=' + reAnn);

    // ---------- forms
    const formB64 = fs.readFileSync(OUT + '/form-src.pdf').toString('base64');
    await ev(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await planmark.openBytes('form.pdf', bin); }, formB64);
    await page.waitForSelector('.forms .ff', { timeout: 10000 }); const nff = await ev(() => document.querySelectorAll('.forms .ff').length); ok('form fields rendered', nff === 5, 'fields=' + nff);
    await key('v');
    await page.fill('.forms input[type=text]', 'Jordan Lee'); await page.press('.forms input[type=text]', 'Tab');
    await page.check('.forms input[type=checkbox]'); await page.selectOption('.forms select', 'Mechanical'); await page.check('.forms input[type=radio] >> nth=1');
    await page.waitForTimeout(100);
    const fv = await ev(() => planmark.activeDoc().formValues); ok('form values captured', fv['applicant.name'] === 'Jordan Lee' && fv.approved && fv.approved !== 'Off' && fv.discipline === 'Mechanical' && fv.phase, JSON.stringify(fv));
    await page.click('[data-cmd="file.save"]'); await page.waitForFunction(() => window.__saves.some((s) => s.name === 'form.pdf'), null, { timeout: 20000 });
    const fsaved = await ev(() => window.__saves.find((s) => s.name === 'form.pdf')); fs.writeFileSync(OUT + '/form-saved.pdf', Buffer.from(fsaved.b64, 'base64')); ok('form saved', true);
  } catch (e) { results.push('ERROR ' + e.message.split('\n')[0]); }
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((r) => !r.startsWith('PASS')).length);
  console.log('ERRORS:', errors.filter((e) => !e.includes('ERR_FAILED')).join('\n') || 'none');
  await browser.close();
})();
