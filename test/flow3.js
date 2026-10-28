// Round 3: branding, coloured icons, metric defaults, rich text, sketch names/area,
// page alignment by grid (auto + manual), aligned overlay, save/reopen.
const { launch } = require('./harness');
const fs = require('fs');
const OUT = '/home/claude/planmark/test/out';
const stub = () => {
  window.__saves = [];
  window.showSaveFilePicker = async (o) => ({ createWritable: async () => ({ write: async (b) => { const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); window.__saves.push({ name: o.suggestedName, b64: btoa(s) }); }, close: async () => {} }) });
};
(async () => {
  const { browser, page, errors } = await launch({ init: stub, viewport: { width: 1440, height: 1000 } });
  const results = []; const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const P = async (x, y, i = 0) => ev(([i, x, y]) => { const d = planmark.activeDoc(); const r = d.pageEls[i].getBoundingClientRect(); return [r.left + x * d.zoom, r.top + y * d.zoom]; }, [i, x, y]);
  const click = async (x, y, i = 0) => { const [cx, cy] = await P(x, y, i); await page.mouse.click(cx, cy); await page.waitForTimeout(60); };
  const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(60); };
  const last = () => ev(() => { const d = planmark.activeDoc(); return d.markups[d.markups.length - 1]; });
  const show = async (x, y, i = 0, z = 1) => { await ev(([x, y, i, z]) => { planmark.setZoom(z); const d = planmark.activeDoc(); const v = document.getElementById('viewer'); v.scrollTop = d.pageEls[i].offsetTop + y * z - 260; v.scrollLeft = d.pageEls[i].offsetLeft + x * z - 260; }, [x, y, i, z]); await page.waitForTimeout(350); };
  try {
    // ---------- branding and icons
    ok('title is MeBulb', (await page.title()).includes('MeBulb'), await page.title());
    ok('brand shows MeBulb with tagline', await ev(() => document.querySelector('.brand').textContent.trim() === 'MeBulb' && document.querySelector('.brand').title.includes('Not the brightest, but it gets the job done.')));
    const cols = await ev(() => ['text', 'cloud', 'area', 'sketchrect', 'sketchcircle', 'count', 'note'].map((t) => { const el = document.querySelector(`.tool-btn[data-tool="${t}"] .ic [class]`); return el ? getComputedStyle(el).stroke + '/' + getComputedStyle(el).fill : 'none'; }));
    ok('tool icons are colour-coded', new Set(cols).size >= 5 && !cols.includes('none'), JSON.stringify(cols));
    await page.click('.mtitle >> text=Help'); await page.click('#menu-pop button >> text=About MeBulb'); await page.waitForSelector('.modal .tagline');
    ok('about shows tagline', await ev(() => document.querySelector('.modal .tagline').textContent === 'Not the brightest, but it gets the job done.')); await key('Escape');

    // ---------- metric defaults
    const u = await ev(() => { const d = planmark.activeDoc(); const a = d.markups.find((m) => m.type === 'area'); return { units: planmark.state.units, scale: d.scales[0].label, area: planmark.measureInfo(a, d).text, def: planmark.state.sketchDefaults.rect }; });
    ok('metric by default (m, m², 1:50 sample)', u.units === 'm' && u.scale === '1:50' && / m²$/.test(u.area), JSON.stringify(u));
    ok('default sketch is 600 x 300 mm', Math.round(u.def.w * 25.4) === 600 && Math.round(u.def.h * 25.4) === 300);
    await ev(() => planmark.setUnits('mm')); let len = await ev(() => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.type === 'length'); return planmark.measureInfo(m, d).text; });
    ok('millimetres option', /^\d+ mm$/.test(len), len);
    await ev(() => planmark.setUnits('m')); len = await ev(() => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.type === 'length'); return planmark.measureInfo(m, d).text; });
    ok('back to metres', /^\d+\.\d\d m$/.test(len), len);

    // ---------- rich text
    await ev(() => { planmark.state.snapMarkup = false; planmark.state.snapContent = false; });
    await show(250, 880, 0, 1.5);
    await key('t'); await click(260, 900); await page.waitForSelector('.txt-edit');
    await page.keyboard.type('Area 25 m2 bold');
    // select "2" after m (index 9..10) and superscript it with the toolbar
    await ev(() => { const ed = document.querySelector('.txt-edit'); planmark.rtSetSel(ed, 9, 10); });
    await page.click('#propbar [data-fmt="sup"]'); await page.waitForTimeout(80);
    await ev(() => { const ed = document.querySelector('.txt-edit'); planmark.rtSetSel(ed, 11, 15); }); await page.keyboard.press('Control+b'); await page.waitForTimeout(80);
    await ev(() => { const ed = document.querySelector('.txt-edit'); planmark.rtSetSel(ed, 0, 4); }); await page.keyboard.press('Control+u'); await page.waitForTimeout(80);
    await ev(() => { const ed = document.querySelector('.txt-edit'); planmark.rtSetSel(ed, 5, 7); }); await page.click('#propbar [data-fmt="s"]'); await page.waitForTimeout(80);
    // font for the selection via the toolbar select
    await ev(() => { const ed = document.querySelector('.txt-edit'); planmark.rtSetSel(ed, 0, 4); }); await page.selectOption('#propbar select[data-k="style.font"]', 'times'); await page.waitForTimeout(120);
    // typing after a pending format: caret at end, italic on, type
    await ev(() => { const ed = document.querySelector('.txt-edit'); ed.focus(); planmark.rtSetSel(ed, 15, 15); }); await page.keyboard.press('Control+i'); await page.keyboard.type(' it'); await page.waitForTimeout(80);
    await page.screenshot({ path: OUT + '/r3-editing.png' });
    await key('Escape'); await page.waitForTimeout(150);
    let m = await last(); const rr = m.runs || [];
    const find = (pred) => rr.filter(pred).map((r) => r.t).join('');
    ok('rich text keeps plain text', m.text === 'Area 25 m2 bold it', JSON.stringify(m.text));
    ok('superscript run', find((r) => r.sup) === '2', JSON.stringify(rr));
    ok('bold run', find((r) => r.b) === 'bold' || find((r) => r.b).startsWith('bold'), find((r) => r.b));
    ok('underline + Times on "Area"', rr.some((r) => r.t === 'Area' && r.u && r.f === 'times'), JSON.stringify(rr.slice(0, 2)));
    ok('strikethrough run', find((r) => r.s) === '25', find((r) => r.s));
    ok('pending italic applies to typed text', find((r) => r.i).trim() === 'it', JSON.stringify(find((r) => r.i)));
    const svg = await ev((id) => document.querySelector(`g.mk[data-id="${id}"]`).innerHTML, m.id);
    ok('SVG uses Times, bold, underline line and smaller raised 2', /Times New Roman/.test(svg) && /font-weight="700"/.test(svg) && (svg.match(/<path/g) || []).length >= 3, '');
    // whole-markup formatting when selected (not editing)
    await key('Escape'); await ev((id) => { planmark.state.sel.clear(); planmark.state.sel.add(id); planmark.refreshPanels(); }, m.id); await page.waitForTimeout(100);
    await page.selectOption('#propbar select[data-k="style.font"]', 'courier'); await page.waitForTimeout(100);
    m = await ev((id) => planmark.activeDoc().markups.find((x) => x.id === id), m.id);
    ok('font for whole markup replaces part fonts', m.style.font === 'courier' && !(m.runs || []).some((r) => r.f), JSON.stringify(m.runs));
    await page.click('#propbar [data-fmt="i"]'); await page.waitForTimeout(100); m = await ev((id) => planmark.activeDoc().markups.find((x) => x.id === id), m.id);
    ok('italic for whole markup', m.style.italic === true, JSON.stringify(m.style.italic));
    await ev(async () => { await planmark.undo(); await planmark.undo(); }); m = await ev((id) => planmark.activeDoc().markups.find((x) => x.id === id), m.id);
    ok('undo restores per-word fonts', (m.runs || []).some((r) => r.f === 'times') && !m.style.italic, JSON.stringify(m.style.font));
    const richId = m.id;

    // ---------- sketch names, auto numbering, area
    await ev(() => { planmark.state.sketchNext = 'M5'; planmark.state.sketchAutoNum = true; });
    await show(300, 700, 0, 1); await key('b'); await click(330, 720); await key('b'); await click(420, 720);
    const names = await ev(() => { const d = planmark.activeDoc(); return d.markups.filter((x) => x.type === 'sketch' && x.page === 0 && !x.link).map((x) => planmark.sketchName(d, x)); });
    ok('names count up M5, M6', JSON.stringify(names.slice(-2)) === '["M5","M6"]', JSON.stringify(names));
    ok('next name is M7', await ev(() => planmark.state.sketchNext === 'M7'));
    // rename a linked sample riser from the props panel: all pages change
    await ev(() => { const d = planmark.activeDoc(); const x = d.markups.find((q) => q.link === 'LK-e1' && q.page === 0); planmark.setTool('select'); planmark.state.sel.clear(); planmark.state.sel.add(x.id); planmark.refreshPanels(); });
    await ev(() => { if (!document.body.classList.contains('right-open') || planmark.state.rightTab !== 'props') document.querySelector('#rstrip [data-panel=props]').click(); }); await page.waitForTimeout(150);
    await page.fill('#props [data-k="sk.name"]', 'E2'); await page.press('#props [data-k="sk.name"]', 'Enter'); await page.waitForTimeout(150);
    const en = await ev(() => { const d = planmark.activeDoc(); return d.markups.filter((q) => q.link === 'LK-e1').map((q) => planmark.sketchName(d, q)); });
    ok('renaming a riser renames it on every page', JSON.stringify(en) === '["E2","E2","E2"]', JSON.stringify(en));
    await page.check('#props [data-k="style.showArea"]'); await page.waitForTimeout(150);
    const lab = await ev(() => { const d = planmark.activeDoc(); const x = d.markups.find((q) => q.link === 'LK-e1' && q.page === 0); return [...document.querySelectorAll(`g.mk[data-id="${x.id}"] text`)].map((t) => t.textContent); });
    ok('area label in m²', lab.some((t) => /^0\.135 m²$/.test(t)) && lab.includes('E2'), JSON.stringify(lab));
    const m1 = await ev(() => { const d = planmark.activeDoc(); const x = d.markups.find((q) => q.link === 'LK-m1' && q.page === 1); return planmark.areaLabel(d, x); });
    ok('transition shows both areas', m1 === '0.180 → 0.135 m²', m1);

    // ---------- alignment (sample: level 2 sheet is 5 mm right, 3 mm down)
    const al = await ev(() => { const d = planmark.activeDoc(); return { ref: d.align && d.align.ref, T1: planmark.alignT(d, 1), T2: planmark.alignT(d, 2) }; });
    const mm5 = (5 / 25.4) * 72, mm3 = (3 / 25.4) * 72;
    ok('auto-align found level 2 offset', al.ref === 0 && Math.abs(al.T1[4] + mm5) < 0.3 && Math.abs(al.T1[5] + mm3) < 0.3 && al.T1[0] === 1 && al.T1[1] === 0, JSON.stringify(al.T1));
    ok('level 3 matches level 1', Math.hypot(al.T2[4], al.T2[5]) < 0.3, JSON.stringify(al.T2));
    const rp = await ev(() => { const d = planmark.activeDoc(); const xs = d.markups.filter((q) => q.link === 'LK-m1').sort((a, b) => a.page - b.page); return xs.map((q) => q.pts[0]); });
    ok('risers sit on the same grid position on every floor', Math.abs(rp[1][0] - rp[0][0] - mm5) < 0.3 && Math.abs(rp[1][1] - rp[0][1] - mm3) < 0.3 && Math.hypot(rp[2][0] - rp[0][0], rp[2][1] - rp[0][1]) < 0.3, JSON.stringify(rp));
    // the riser on level 2 is inside the shaft drawn on that sheet: check against the shaft's linework there
    const U = 0.3 * (72 / 25.4) * 20; const exp2 = [210 + mm5 + 18.6 * U, 215 + mm3 + 31.75 * U];
    ok('level 2 riser sits where the shaft is drawn on that sheet', Math.hypot(rp[1][0] - exp2[0], rp[1][1] - exp2[1]) < 0.3, JSON.stringify([rp[1], exp2]));
    // moving a riser on level 1 moves level 2 to the same grid position
    await ev(() => { const d = planmark.activeDoc(); const x = d.markups.find((q) => q.link === 'LK-m2' && q.page === 0); planmark.setTool('select'); planmark.state.sel.clear(); planmark.state.sel.add(x.id); planmark.refreshPanels(); });
    await show(500, 760, 0, 1); await key('ArrowRight'); await key('ArrowRight');
    const mv = await ev(() => { const d = planmark.activeDoc(); const xs = d.markups.filter((q) => q.link === 'LK-m2').sort((a, b) => a.page - b.page); return xs.map((q) => q.pts[0]); });
    ok('nudge keeps linked risers on the grid', Math.abs(mv[1][0] - mv[0][0] - mm5) < 0.3 && Math.abs(mv[2][0] - mv[0][0]) < 0.3, JSON.stringify(mv));
    // manual: clear, then pick A/1 and D/4 on both sheets
    await ev(() => { planmark.activeDoc().align = null; });
    const A1 = [210, 215], D4 = [210 + 56 * (0.3 * (72 / 25.4) * 20), 215 + 38 * (0.3 * (72 / 25.4) * 20)];
    await ev(() => { document.querySelector('#rstrip [data-panel=measure]').click(); }); await page.waitForTimeout(200);
    await ev(() => planmark.goToPage(1)); await page.waitForTimeout(300);
    await page.click('#measure-panel [data-ma="align-pick"]'); await page.waitForTimeout(300);
    ok('align-by-points instructions shown', await ev(() => /Align page 2/.test(document.getElementById('draftbar').textContent)));
    await ev(() => { planmark.state.snapContent = false; });
    for (const [pt, pg] of [[A1, 0], [D4, 0], [[A1[0] + mm5, A1[1] + mm3], 1], [[D4[0] + mm5, D4[1] + mm3], 1]]) { await show(pt[0], pt[1], pg, 1); await click(pt[0], pt[1], pg); await page.waitForTimeout(150); }
    const man = await ev(() => planmark.alignT(planmark.activeDoc(), 1));
    ok('manual alignment from 4 clicks', Math.abs(man[4] + mm5) < 1.2 && Math.abs(man[5] + mm3) < 1.2 && Math.abs(man[0] - 1) < 1e-9, JSON.stringify(man));
    // aligned overlay vs unaligned overlay: count coloured (changed) pixels
    const cnt = async (grid) => ev(async (grid) => {
      const d = planmark.activeDoc(); d.align = d.align || { ref: 0, T: {} }; if (grid) { d.align.T[1] = [1, 0, 0, 1, -(5 / 25.4) * 72, -(3 / 25.4) * 72]; }
      await planmark.compareOverlay(d, 0, d, 1, grid); const o = planmark.activeDoc(); const p = await o.pdf.getPage(1); const vp = p.getViewport({ scale: 0.5 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const px = c.getContext('2d').getImageData(105, 108, 476, 323).data; let n = 0; for (let k = 0; k < px.length; k += 4) if (Math.abs(px[k] - px[k + 2]) > 60) n++; // plan area only
      if (grid) { const a = document.createElement('a'); a.download = 'x'; window.__ovl = c.toDataURL('image/png'); }
      const id = o.id; document.querySelector(`.tab[data-id="${id}"] .tab-x`).click(); return n;
    }, grid);
    const nA = await cnt(true); await page.waitForTimeout(500); await ev(() => { const t = document.querySelector('.modal footer .btn.danger'); if (t) t.click(); }); await page.waitForTimeout(300);
    const nU = await cnt(false); await page.waitForTimeout(500); await ev(() => { const t = document.querySelector('.modal footer .btn.danger'); if (t) t.click(); }); await page.waitForTimeout(300);
    ok('grid-aligned overlay shows far fewer differences', nA * 3 < nU, `aligned=${nA} unaligned=${nU}`);

    // ---------- save and reopen
    await page.click('[data-cmd="file.save"]'); await page.waitForFunction(() => window.__saves.length >= 1, null, { timeout: 30000 });
    const saved = await ev(() => window.__saves[window.__saves.length - 1]); const buf = Buffer.from(saved.b64, 'base64'); fs.writeFileSync(OUT + '/r3-saved.pdf', buf);
    const chk = await ev(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const doc = await PDFLib.PDFDocument.load(bin); const fonts = new Set(); doc.context.enumerateIndirectObjects().forEach(([, o]) => { if (o instanceof PDFLib.PDFDict) { const bf = o.get(PDFLib.PDFName.of('BaseFont')); if (bf) fonts.add(bf.toString()); } }); const rc = doc.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFLib.PDFDict && o.get(PDFLib.PDFName.of('RC'))); return { fonts: [...fonts], data: !!doc.catalog.get(PDFLib.PDFName.of('MeBulbData')), rc }; }, saved.b64);
    ok('PDF embeds Times/Courier fonts, rich-text RC and the MeBulb data', chk.fonts.includes('/Times-Roman') && chk.data && chk.rc, JSON.stringify(chk));
    await ev(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await planmark.openBytes('r3-roundtrip.pdf', bin); }, saved.b64); await page.waitForTimeout(1500);
    const rt = await ev((rid) => { const d = planmark.activeDoc(); const t = d.markups.find((x) => x.id === rid) || d.markups.find((x) => x.type === 'text' && x.runs && x.text.startsWith('Area 25')); return { runs: t && t.runs && t.runs.length, align: d.align && planmark.alignT(d, 1)[4], names: d.markups.filter((x) => x.type === 'sketch').map((x) => planmark.sketchName(d, x)).filter(Boolean).length }; }, richId);
    ok('reopen keeps rich text, alignment and names', rt.runs >= 4 && rt.align < -10 && rt.names >= 11, JSON.stringify(rt));
    const annots = await ev(async () => { const d = planmark.activeDoc(); return d.markups.length; });
    ok('reopened markups present', annots > 15, 'n=' + annots);
  } catch (e) { results.push('ERROR ' + e.message.split('\n')[0]); }
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((r) => !r.startsWith('PASS')).length);
  console.log('ERRORS:', errors.filter((e) => !e.includes('ERR_FAILED')).join('\n') || 'none');
  await browser.close();
})();
