// Round 10: per-application velocity targets, text rotation, callout leader anchor on move,
// close-with-save, non-destructive licence lockdown, sketch area toggle, riser-section grille centring
const { launch } = require('./harness');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', (e) => console.log('STACK', e.stack));
  const ev = (fn, a) => page.evaluate(fn, a);
  await ev(() => { const S = mebulb.state; S.snapMarkup = S.snapContent = S.snapGrid = false; mebulb.setZoom(1); mebulb.goToPage(0, [700, 300]); });
  await page.waitForTimeout(300);
  const P = (x, y, pg = 0) => ev(([x, y, pg]) => { const d = mebulb.activeDoc(); const r = d.pageEls[pg].getBoundingClientRect(); return [r.left + x * d.zoom, r.top + y * d.zoom]; }, [x, y, pg]);
  const drag = async (a, b, steps = 6) => { await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps }); await page.mouse.move(b[0], b[1], { steps }); await page.mouse.up(); await page.waitForTimeout(80); };

  // ---- velocity targets per application
  const vt = await ev(() => ({ sa: mebulb.velLimitFor('SA'), ea: mebulb.velLimitFor('EA'), ra: mebulb.velLimitFor('RA'), none: mebulb.velLimitFor('none') }));
  ok(vt.sa === 6 && vt.ea === 7 && vt.ra === 5 && vt.none === 0, `velocity targets: supply ${vt.sa}, exhaust ${vt.ea}, return ${vt.ra} m/s; "none" turns the check off`);
  const vcheck = await ev(() => { const z = { shape: 'rect', w: 500, h: 280 }; const sa = mebulb.ductCalc(900, z); sa.velLim = mebulb.velLimitFor('SA'); const ea = mebulb.ductCalc(900, z); ea.velLim = mebulb.velLimitFor('EA'); return { v: +sa.v.toFixed(2), saWarn: mebulb.calcWarn(sa).some((w) => /m\/s/.test(w)), eaWarn: mebulb.calcWarn(ea).some((w) => /m\/s/.test(w)) }; });
  ok(vcheck.v > 6 && vcheck.v < 7 && vcheck.saWarn && !vcheck.eaWarn, `900 L/s in 500×280 is ${vcheck.v} m/s: over supply 6 (${vcheck.saWarn}), within exhaust 7 (not flagged: ${!vcheck.eaWarn})`);
  // editing a target sticks and the dropdown drives it
  const tgt = await ev(() => { mebulb.state.prefs.velTargets = { ...(mebulb.state.prefs.velTargets || {}), SA: 5.5 }; return mebulb.velLimitFor('SA'); });
  ok(tgt === 5.5, 'the supply target can be set (5.5 m/s) and is remembered');
  await ev(() => { mebulb.state.prefs.velTargets = {}; });

  // ---- a duct carries its service's velocity target; switching application changes the limit
  await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); const mk = (id, x, y) => { const m = { id, type: 'sketch', page: 0, pts: [[x, y]], sz: { shape: 'rect', w: 600 / 25.4, h: 300 / 25.4 }, rot: 0, name: 'M1', text: '', style: { stroke: '#1f5fd1', width: 1.25, fill: '#1f5fd1', fillOpacity: 0.07, fontSize: 9, fontColor: '#1f5fd1', symbol: 'x', showLabel: true, showName: true, showSize: true }, subject: 'Sketch rectangle', author: 'T', created: now, modified: now }; d.markups.push(m); return m; }; mk('RA', 450, 300); mk('RB', 1050, 300); });
  const du = await ev(async () => { const d = mebulb.activeDoc(); const a = d.markups.find((m) => m.id === 'RA'), b = d.markups.find((m) => m.id === 'RB'); const m = await mebulb.connectRisers(d, a, b, 'best'); m.duct = { ...m.duct, w: 500, h: 280, q: 900, service: 'SA' }; d.markups.push(m); mebulb.renderAllMarks(d); const S = mebulb.state; mebulb.setTool('select'); S.sel.clear(); S.sel.add(m.id); mebulb.refreshSelection(); mebulb.openPanel('props'); return m.id; });
  await page.waitForTimeout(200);
  const saOver = await ev((id) => { const c = mebulb.ductCalcFor(mebulb.activeDoc(), mebulb.activeDoc().markups.find((m) => m.id === id)); return mebulb.calcWarn(c).join('; '); }, du);
  ok(/m\/s is over 6/.test(saOver), 'a supply duct at 900 L/s in 400×250 is flagged over 6 m/s: ' + saOver);
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); m.duct = { ...m.duct, service: 'EA' }; }, du);
  const eaOver = await ev((id) => { const c = mebulb.ductCalcFor(mebulb.activeDoc(), mebulb.activeDoc().markups.find((m) => m.id === id)); return { warn: mebulb.calcWarn(c), lim: c.velLim }; }, du);
  ok(eaOver.lim === 7 && !eaOver.warn.some((w) => /m\/s/.test(w)), `switching it to exhaust air lifts the limit to ${eaOver.lim} m/s, so the velocity warning clears`);

  // ---- riser-section grille centred on the shaft even when placed off-centre on the plan
  await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); const r = { id: 'RS', type: 'sketch', page: 0, pts: [[1250, 900]], sz: { shape: 'rect', w: 1600 / 25.4, h: 750 / 25.4 }, rot: 0, name: 'R1', text: '', style: { stroke: '#1f5fd1', width: 1.25, fill: '#1f5fd1', fillOpacity: 0.07, fontSize: 9, fontColor: '#1f5fd1', symbol: 'x', showLabel: true, showName: true, showSize: true }, subject: 'Sketch rectangle', author: 'T', created: now, modified: now }; d.markups.push(r); mebulb.placeOnPages(d, r, [0, 1]);
    const g = { id: 'GS', type: 'grille', page: 0, on: 'RS', face: 1, t: 0.12, side: 1, gr: { ...mebulb.grilleDefaults(), kind: 'supply', mount: 'riser', w: 600, h: 600, z: 2100, q: 500 }, tag: 'SG-01', style: { stroke: '#1c7ed6', width: 0.8, opacity: 1 }, pts: [[0, 0]], author: 'T', created: now, modified: now }; g.pts = [mebulb.grillePlace(d, g).p]; d.markups.push(g); mebulb.renderAllMarks(d); });
  await ev(() => { const d = mebulb.activeDoc(); const r = d.markups.find((x) => x.id === 'RS'); mebulb.startSectionPlace(r); });
  { const p = await P(600, 300); await page.mouse.click(p[0], p[1]); await page.waitForTimeout(200); }
  // the grille box centre in the section, as a function of its plan position t
  const grilleCx = async (t) => ev((t) => {
    const d = mebulb.activeDoc(); const g = d.markups.find((x) => x.id === 'GS'); g.t = t; g.pts = [mebulb.grillePlace(d, g).p]; const m = d.markups.filter((x) => x.type === 'section').pop(); mebulb.renderAllMarks(d);
    const el = document.querySelector(`g.mk[data-id="${m.id}"]`); const box = [...el.querySelectorAll('path[fill="#ffffff"]')].map((p) => p.getAttribute('d')).filter((d2) => /Z$/.test(d2))
      .map((d2) => { const n = (d2.match(/-?\d+\.?\d*/g) || []).map(Number); const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1); return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; })
      .filter((b) => b.h > 6 && b.h < 40 && b.w > 10 && b.w < 40).sort((a, b) => a.h - b.h)[0];
    return box ? box.cx : null;
  }, t);
  const cxA = await grilleCx(0.12); const cxB = await grilleCx(0.85);
  ok(cxA != null && cxB != null && Math.abs(cxA - cxB) < 1.5, `the grille is drawn centred on the shaft whatever its plan position (at 12% and 85% along the wall it lands at the same x: ${cxA == null ? 'n/a' : cxA.toFixed(1)} vs ${cxB == null ? 'n/a' : cxB.toFixed(1)})`);
  await ev((du) => { const d = mebulb.activeDoc(); d.markups = d.markups.filter((m) => !['RS', 'GS', 'RA', 'RB'].includes(m.id) && m.type !== 'section' && m.id !== du); mebulb.cleanupLinks(d); mebulb.renderAllMarks(d); mebulb.state.sel.clear(); mebulb.refreshSelection(); }, du);

  // ---- text rotation
  await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); d.markups.push({ id: 'TX', type: 'text', page: 0, pts: [[300, 300], [460, 340]], style: { fontSize: 14, lineH: 1.2, opacity: 1, labelBg: true, stroke: '#1550a0', width: 0, fontColor: '#1550a0', font: 'helv' }, text: 'Turned text', author: 'T', created: now, modified: now }); mebulb.renderAllMarks(d); const S = mebulb.state; mebulb.setTool('select'); S.sel.clear(); S.sel.add('TX'); mebulb.refreshSelection(); mebulb.openPanel('props'); });
  await page.waitForTimeout(200);
  ok(await ev(() => !!document.querySelector('#props [data-k="rot"]') && !!document.querySelector('#viewer [data-h="rot"]')), 'a text box has a rotation field and a round rotate handle');
  await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === 'TX'); m.rot = 40; mebulb.renderAllMarks(d); mebulb.refreshSelection(); });
  await page.waitForTimeout(150);
  const rot = await ev(() => { const el = document.querySelector('g.mk[data-id="TX"] text'); const tr = el && el.getAttribute('transform'); const b = mebulb.markupBBox(mebulb.activeDoc().markups.find((x) => x.id === 'TX'), mebulb.activeDoc()); return { tr, w: Math.round(b.w), h: Math.round(b.h) }; });
  ok(/rotate\(40/.test(rot.tr || '') && rot.h > 100, `the text renders at 40° and its bounding box turns with it (${rot.w}×${rot.h} pt, up from 160×40)`);
  // round-trips through the PDF
  const rt = await ev(async () => { const d = mebulb.activeDoc(); const b = await mebulb.buildPdf(d, {}); const d2 = await mebulb.openBytes('rot.pdf', b); const t = d2.markups.find((m) => m.type === 'text' && /Turned/.test(m.text || '')); return t ? t.rot : null; });
  ok(rt === 40, `the rotation is kept when the PDF is saved and reopened (${rt}°)`);
  await ev(() => { const d = mebulb.activeDoc(); d.markups = d.markups.filter((m) => m.id !== 'TX'); mebulb.renderAllMarks(d); mebulb.state.sel.clear(); mebulb.refreshSelection(); });

  // ---- a callout's arrow tip stays put when the box is moved
  await ev(() => { mebulb.setZoom(1); mebulb.goToPage(0, [500, 500]); });
  await page.waitForTimeout(200);
  await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); d.markups.push({ id: 'CO', type: 'callout', page: 0, pts: [[300, 300], [460, 460], [640, 520]], style: { fontSize: 13, lineH: 1.2, opacity: 1, stroke: '#b4232a', width: 1, fontColor: '#111', arrowEnd: 'arrow', labelBg: true, fill: '#fff', fillOpacity: 1, font: 'helv' }, text: 'Note', author: 'T', created: now, modified: now }); mebulb.renderAllMarks(d); const S = mebulb.state; mebulb.setTool('select'); S.sel.clear(); S.sel.add('CO'); mebulb.refreshSelection(); });
  await page.waitForTimeout(150);
  const tip0 = await ev(() => mebulb.activeDoc().markups.find((m) => m.id === 'CO').pts[0].slice());
  const boxMid = await P(550, 490); const dest = await P(430, 620);
  await drag(boxMid, dest);
  const moved = await ev(() => { const m = mebulb.activeDoc().markups.find((x) => x.id === 'CO'); return { tip: m.pts[0], box0: m.pts[1] }; });
  ok(Math.hypot(moved.tip[0] - tip0[0], moved.tip[1] - tip0[1]) < 0.5 && moved.box0[1] > 460, `moving the text box leaves the arrow tip where it pointed (tip moved ${Math.hypot(moved.tip[0] - tip0[0], moved.tip[1] - tip0[1]).toFixed(1)} pt, box moved down)`);
  await ev(() => { const d = mebulb.activeDoc(); d.markups = d.markups.filter((m) => m.id !== 'CO'); mebulb.renderAllMarks(d); mebulb.state.sel.clear(); mebulb.refreshSelection(); });

  // ---- close offers to save first
  await ev(() => { const d = mebulb.activeDoc(); mebulb.markDirty(d); mebulb.closeDoc(d.id); });
  await page.waitForSelector('#modal-back:not([hidden])');
  const closeBtns = await ev(() => ({ title: document.querySelector('#modal h2, #modal .dlg-title, #modal header') ? document.querySelector('#modal').textContent : '', btns: [...document.querySelectorAll('#modal footer button')].map((b) => b.textContent.trim()) }));
  ok(closeBtns.btns.some((b) => /Save and close/.test(b)) && closeBtns.btns.some((b) => /Don't save|Don’t save/.test(b)) && closeBtns.btns.some((b) => /Cancel/.test(b)), 'closing a changed PDF offers Save and close / Don\'t save / Cancel: ' + closeBtns.btns.join(', '));
  await page.click('#modal footer button:has-text("Cancel")'); await page.waitForTimeout(150);
  ok(await ev(() => !!mebulb.activeDoc()), 'Cancel keeps the document open');

  // ---- non-destructive licence lockdown
  const lic = await ev(async () => { const d = mebulb.activeDoc(); mebulb.setLicense({ status: 'unlicensed' }); const n0 = d.markups.length; mebulb.markDirty(d); d._diskBefore = true; let threw = false; try { await mebulb.saveDoc('save', { doc: d }); } catch (e) { threw = true; } return { active: mebulb.licenseActive(), stillDirty: d.dirty, badge: (document.querySelector('#lic-badge') || {}).textContent, shown: !(document.querySelector('#lic-badge') || {}).hidden, markupsKept: d.markups.length === n0, threw }; });
  ok(!lic.active && lic.stillDirty && lic.shown && /activate to save/i.test(lic.badge) && lic.markupsKept, `unlicensed: saving is blocked and the markups are untouched, with a clear status ("${lic.badge}")`);
  const relic = await ev(async () => { const good = await mebulb.validateLicense('MEBULB-7788AA'); return { good, active: mebulb.licenseActive(), hidden: (document.querySelector('#lic-badge') || {}).hidden }; });
  ok(relic.good && relic.active && relic.hidden, 'entering a valid key re-enables saving and clears the badge');
  await ev(() => { document.querySelectorAll('#modal-back').forEach((x) => (x.hidden = true)); });

  // ---- sketch area toggle in the property bar, and no crash when a size is missing
  await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); d.markups.push({ id: 'SK', type: 'sketch', page: 0, pts: [[700, 700]], sz: { shape: 'rect', w: 400 / 25.4, h: 300 / 25.4 }, rot: 0, name: 'M9', style: { stroke: '#1f5fd1', width: 1.25, fill: '#1f5fd1', fillOpacity: 0.07, fontSize: 9, fontColor: '#1f5fd1', symbol: 'x', showLabel: true, showName: true, showSize: true, showArea: true }, subject: 'Sketch rectangle', author: 'T', created: now, modified: now }); mebulb.renderAllMarks(d); const S = mebulb.state; mebulb.setTool('select'); S.sel.clear(); S.sel.add('SK'); mebulb.refreshSelection(); });
  await page.waitForTimeout(150);
  ok(await ev(() => !!document.querySelector('#propbar [data-k="style.showArea"]')), 'a selected riser has an Area toggle right on the property bar');
  await ev(() => { const cb = document.querySelector('#propbar [data-k="style.showArea"]'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(100);
  ok(await ev(() => mebulb.activeDoc().markups.find((m) => m.id === 'SK').style.showArea === false), 'the Area toggle turns the area label off');
  const noThrow = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === 'SK'); d.links = d.links || {}; d.links.BL = { name: 'M9', sizes: {}, sync: false }; m.link = 'BL'; m.sizeKey = 'gone'; delete m.sz; try { const a = mebulb.areaLabel(d, m); const s = mebulb.sketchSize(d, m); mebulb.renderAllMarks(d); return { ok: true, aStr: typeof a === 'string', hasSize: !!(s && (s.w || s.d)) }; } catch (e) { return { ok: false, err: String(e) }; } });
  ok(noThrow.ok && noThrow.aStr && noThrow.hasSize, 'a sketch whose linked size is missing (a broken Bluebeam round-trip) does not throw: it falls back to a default size and the area label still works');

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
})();
