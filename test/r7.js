// Round 7: double-click text, poly nodes and curves, area rectangles, linked sketches, equipment
// clashes on both units, same-spot page flipping, callout knees and extra leaders, side handles
const { launch } = require('./harness');
const fs = require('fs'); const { execSync } = require('child_process');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1500, height: 950 } });
  const ev = (fn, a) => page.evaluate(fn, a);
  await ev(() => { const S = mebulb.state; S.snapMarkup = false; S.snapContent = false; S.snapGrid = false; mebulb.setZoom(1); mebulb.goToPage(0, [400, 400]); });
  await page.waitForTimeout(400);
  const P = (x, y, pg = 0) => ev(([x, y, pg]) => { const d = mebulb.activeDoc(); const r = d.pageEls[pg].getBoundingClientRect(); return [r.left + x * d.zoom, r.top + y * d.zoom]; }, [x, y, pg]);
  const click = async (x, y, mods = []) => { const [cx, cy] = await P(x, y); await page.mouse.move(cx, cy); for (const k of mods) await page.keyboard.down(k); await page.mouse.down(); await page.mouse.up(); for (const k of mods) await page.keyboard.up(k); await page.waitForTimeout(40); };
  const drag = async (a, b, mods = []) => { const [x1, y1] = await P(...a), [x2, y2] = await P(...b); await page.mouse.move(x1, y1); for (const k of mods) await page.keyboard.down(k); await page.mouse.down(); await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await page.mouse.move(x2, y2, { steps: 4 }); await page.mouse.up(); for (const k of mods) await page.keyboard.up(k); await page.waitForTimeout(60); };
  const last = () => ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; return JSON.parse(JSON.stringify({ id: m.id, type: m.type, pts: m.pts, curves: m.curves || null })); });

  // ---- poly lines: Ctrl+click makes the side just drawn a curve, Ctrl+drag shapes it
  await ev(() => mebulb.setTool('polyline'));
  await click(300, 300); await click(400, 300);
  { const [x1, y1] = await P(500, 360), [x2, y2] = await P(460, 300); await page.mouse.move(x1, y1); await page.keyboard.down('Control'); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Control'); }
  await click(560, 420); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  let pl = await last();
  ok(pl.type === 'polyline' && pl.pts.length === 4 && pl.curves && pl.curves[1] && !pl.curves[0] && !pl.curves[2], 'Ctrl+click curved the second side of the polyline ' + JSON.stringify(pl.curves));
  const mid = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); const h = mebulb.CV.mid(m.pts[1], m.pts[2], m.curves[1]); return h; }, pl.id);
  ok(Math.abs(mid[0] - 460) < 3 && Math.abs(mid[1] - 300) < 3, `Ctrl+drag put the curve through the pointer (${mid.map((v) => v.toFixed(1))})`);
  ok(await ev((id) => { const el = document.querySelector(`g.mk[data-id="${id}"] path`); return el && /C/.test(el.getAttribute('d')); }, pl.id), 'the curve is drawn as a true curve');

  // ---- polygon area: Ctrl held while closing curves the closing side too
  await ev(() => mebulb.setTool('area'));
  await click(300, 520); await click(500, 520); await click(500, 640, ['Control']); await click(300, 640);
  await page.mouse.move(...(await P(290, 580))); await page.keyboard.down('Control'); await page.mouse.move(...(await P(300, 521))); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up('Control'); await page.waitForTimeout(150);
  let ar = await last();
  const areas = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); const flat = mebulb.measureInfo({ ...m, curves: null }, d).value; return { curved: mebulb.measureInfo(m, d).value, flat, text: mebulb.measureInfo(m, d).text }; }, ar.id);
  ok(ar.type === 'area' && ar.pts.length === 4 && ar.curves && ar.curves[1] && ar.curves[3] && Object.keys(ar.curves).length === 2, 'area: Ctrl+click and a Ctrl close curved two sides ' + JSON.stringify(Object.keys(ar.curves || {})));
  ok(Math.abs(areas.curved - areas.flat) > areas.flat * 0.05, `the measured area follows the curves (${areas.text}; straight sides would be ${areas.flat.toFixed(2)})`);
  await page.screenshot({ path: OUT + '/r7-curves.png' });

  // ---- Shift+click on a side of the selected polygon adds a node; drag the curve handle; delete a node
  await ev((id) => { mebulb.setTool('select'); const S = mebulb.state; S.sel.clear(); S.sel.add(id); mebulb.refreshSelection(); }, ar.id);
  await click(400, 520, ['Shift']);
  ar = await last();
  ok(ar.pts.length === 5 && Math.abs(ar.pts[1][0] - 400) < 1 && Math.abs(ar.pts[1][1] - 520) < 1 && ar.curves[2] && ar.curves[4] && !ar.curves[1], 'Shift+click on a side added a node there (curves moved along) ' + JSON.stringify(Object.keys(ar.curves)));
  // Shift+click on the curved side splits the curve in two
  const onCurve = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); const CV = mebulb.CV; return CV.at(m.pts[2], CV.ctl(m.pts[2], m.pts[3], m.curves[2]), m.pts[3], 0.3); }, ar.id);
  await click(onCurve[0], onCurve[1], ['Shift']); ar = await last();
  const split = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); return { n: m.pts.length, c: Object.keys(m.curves).map(Number).sort((a, b) => a - b), A: mebulb.measureInfo(m, d).value }; }, ar.id);
  ok(split.n === 6 && split.c.join() === '2,3,5' && Math.abs(split.A - areas.curved) < areas.curved * 0.002, `splitting a curved side keeps the same shape ${JSON.stringify(split)} (area ${split.A.toFixed(3)} vs ${areas.curved.toFixed(3)})`);
  // drag the yellow curve handle of the closing side
  const before5 = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); return mebulb.CV.mid(m.pts[5], m.pts[0], m.curves[5]); }, ar.id);
  const qh = await ev((id) => { const el = document.querySelector(`.hdl.curve[data-m="${id}"][data-h="q5"]`); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, ar.id);
  await page.mouse.move(qh[0], qh[1]); await page.mouse.down(); await page.mouse.move(qh[0] - 40, qh[1], { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(80);
  const moved = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); return mebulb.CV.mid(m.pts[5], m.pts[0], m.curves[5]); }, ar.id);
  ok(Math.abs(moved[0] - (before5[0] - 40)) < 1.5 && Math.abs(moved[1] - before5[1]) < 1.5, 'dragging the curve handle reshapes that side (' + before5.map((v) => v.toFixed(0)) + ' -> ' + moved.map((v) => v.toFixed(0)) + ')');
  // right-click a node -> Delete node
  const vh = await ev((id) => { const el = document.querySelector(`.hdl[data-m="${id}"][data-h="v1"]`); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, ar.id);
  await page.mouse.click(vh[0], vh[1], { button: 'right' }); await page.waitForTimeout(120);
  const menuTxt = await ev(() => [...document.querySelectorAll('.ctx-menu button, .menu button, #ctxmenu button, .cmenu button')].map((b) => b.textContent).join('|'));
  const del = await page.$('text=Delete node'); if (del) await del.click(); await page.waitForTimeout(80);
  ar = await last(); ok(ar.pts.length === 5, 'right-click a node: Delete node (' + menuTxt + ')');
  // Ctrl+drag on a straight side bends it
  const s0 = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); return [(m.pts[0][0] + m.pts[1][0]) / 2, (m.pts[0][1] + m.pts[1][1]) / 2]; }, ar.id);
  await drag(s0, [s0[0], s0[1] - 30], ['Control']); ar = await last();
  ok(ar.curves && ar.curves[0], 'Ctrl+drag on a straight side bends it');
  await page.screenshot({ path: OUT + '/r7-nodes.png' });

  // ---- area as a rectangle: drag from the first corner, or Rectangle mode (two clicks)
  await ev(() => { mebulb.state.polyRect = {}; mebulb.setTool('area'); mebulb.goToPage(0, [700, 900]); }); await page.waitForTimeout(300);
  await drag([650, 880], [750, 960]); let rc = await last();
  const rb = (m) => { const xs = m.pts.map((p) => p[0]), ys = m.pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v)); };
  ok(rc.type === 'area' && rc.pts.length === 4 && rb(rc).join() === '650,880,750,960', 'area: dragging from the first corner draws a rectangle ' + rb(rc));
  await ev(() => mebulb.setTool('area')); await page.waitForTimeout(100);
  ok(await ev(() => document.querySelectorAll('#propbar [data-polyrect]').length === 2), 'property bar offers points or rectangle for the area tool');
  await page.click('#propbar [data-polyrect="1"]'); await page.waitForTimeout(80);
  await click(800, 880); await page.mouse.move(...(await P(870, 930))); await page.waitForTimeout(60);
  const bar = await ev(() => document.querySelector('#draftbar').textContent);
  await click(900, 960); rc = await last();
  const ra = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); return mebulb.measureInfo(m, d).text; }, rc.id);
  ok(rc.type === 'area' && rc.pts.length === 4 && rb(rc).join() === '800,880,900,960' && /rectangle/.test(bar), `Rectangle mode: two clicks make the rectangle (${ra}; bar: ${bar.slice(0, 40)})`);
  await ev(() => { mebulb.state.polyRect = {}; mebulb.setTool('select'); });

  // ---- equipment: both units show the clash, and both clear when one moves away
  const k50 = 72 / (25.4 * 50);
  const ids = await ev((k) => { const L = mebulb.eqLib(); L.length = 0; L.push(mebulb.eqClean({ id: 'EQ-cu', name: 'Test condenser', category: 'Condenser', w: 900, d: 350, h: 1300, clear: { front: 600, back: 300, left: 300, right: 300 }, air: [{ side: 'front', kind: 'discharge', dist: 1500 }] }));
    const d = mebulb.activeDoc(); mebulb.armEquip(L[0]); mebulb.state.placeRot = 0; const a = mebulb.placeEquipAt(0, [1000, 300]); const b = mebulb.placeEquipAt(0, [1000, 300 + (350 / 2 + 700) * k]); mebulb.setTool('select'); return [a.id, b.id]; }, k50);
  const badge = (id) => ev((id) => { const g = document.querySelector(`g.mk[data-id="${id}"]`); return !!g && /e03131/i.test(g.innerHTML); }, id);
  ok(await badge(ids[0]) && await badge(ids[1]), 'clash shows on the unit already placed as well as the new one');
  await ev(() => mebulb.goToPage(0, [1000, 380])); await page.waitForTimeout(300);
  const c2 = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); return m.pts[0]; }, ids[1]);
  await ev((id) => { const S = mebulb.state; S.sel.clear(); S.sel.add(id); mebulb.refreshSelection(); }, ids[1]);
  await drag(c2, [c2[0] + 140, c2[1]]);
  ok(!(await badge(ids[0])) && !(await badge(ids[1])), 'moving one unit clear removes the warning from both');
  await drag([c2[0] + 140, c2[1]], c2);
  ok(await badge(ids[0]) && await badge(ids[1]), 'moving it back shows the warning on both again');
  await page.screenshot({ path: OUT + '/r7-equip.png' });
  await ev((ids) => { const d = mebulb.activeDoc(); d.markups = d.markups.filter((m) => !ids.includes(m.id)); mebulb.renderAllMarks(d); mebulb.state.sel.clear(); mebulb.refreshSelection(); }, ids);

  // ---- Ctrl+Right / Ctrl+Left: same spot, same zoom on the next page (through the alignment when set)
  const view = () => ev(() => { const d = mebulb.activeDoc(); const V = document.querySelector('#viewer'); const i = mebulb.currentPage(); const el = d.pageEls[i]; return { i, z: d.zoom, c: [(V.scrollLeft + V.clientWidth / 2 - el.offsetLeft) / d.zoom, (V.scrollTop + V.clientHeight / 2 - el.offsetTop) / d.zoom] }; });
  await ev(() => { mebulb.setZoom(2.2); mebulb.goToPage(0, [520, 430]); }); await page.waitForTimeout(300);
  await ev(() => { const d = mebulb.activeDoc(); d._alignWas = d.align; d.align = null; }); // the sample's sheets are aligned on open; start without
  await page.mouse.move(700, 500); const v0 = await view(); await page.keyboard.press('Control+ArrowRight'); await page.waitForTimeout(300); const v1 = await view();
  ok(v1.i === 1 && v1.z === v0.z && Math.abs(v1.c[0] - v0.c[0]) < 0.6 && Math.abs(v1.c[1] - v0.c[1]) < 0.6, `Ctrl+Right keeps the spot and zoom: p${v0.i + 1} (${v0.c.map((v) => v.toFixed(1))}) -> p${v1.i + 1} (${v1.c.map((v) => v.toFixed(1))})`);
  await ev(() => { const d = mebulb.activeDoc(); d.align = { ref: 0, T: { 2: [1, 0, 0, 1, 24, -12] } }; });
  await page.keyboard.press('Control+ArrowRight'); await page.waitForTimeout(300); const v2 = await view();
  ok(v2.i === 2 && Math.abs(v2.c[0] - (v1.c[0] - 24)) < 0.6 && Math.abs(v2.c[1] - (v1.c[1] + 12)) < 0.6, `with page 3 aligned 24 pt right / 12 pt up, the view follows the grid (${v2.c.map((v) => v.toFixed(1))})`);
  await page.keyboard.press('Control+ArrowLeft'); await page.keyboard.press('Control+ArrowLeft'); await page.waitForTimeout(300); const v3 = await view();
  await ev(() => { mebulb.activeDoc().align = null; });
  ok(v3.i === 0 && Math.abs(v3.c[0] - v0.c[0]) < 0.8 && Math.abs(v3.c[1] - v0.c[1]) < 0.8, 'Ctrl+Left twice comes back to the same spot on page 1');
  await ev(() => mebulb.runCommand('view.single')); await page.waitForTimeout(200); await page.keyboard.press('Control+ArrowRight'); await page.waitForTimeout(300); const v4 = await view();
  ok(v4.i === 1 && Math.abs(v4.c[0] - v0.c[0]) < 0.8 && await ev(() => !mebulb.activeDoc().pageEls[1].hidden && mebulb.activeDoc().pageEls[0].hidden), 'single page view: Ctrl+Right shows the next page at the same spot');
  await ev(() => { mebulb.runCommand('view.continuous'); const d = mebulb.activeDoc(); d.align = d._alignWas || null; mebulb.setZoom(1); mebulb.goToPage(0, [400, 400]); }); await page.waitForTimeout(200);

  // ---- linked sketches: a style change on one page goes to every page; Revu gets the shape at its size and the label as a text box
  await ev(() => { mebulb.goToPage(1, [700, 300]); mebulb.setTool('sketchrect'); }); await page.waitForTimeout(300);
  { const [x, y] = await P(700, 300, 1); await page.mouse.click(x, y); await page.waitForTimeout(200); }
  const skId = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; mebulb.placeOnPages(d, m, [0, 1, 2, 3]); mebulb.renderAllMarks(d); const S = mebulb.state; mebulb.setTool('select'); S.sel.clear(); S.sel.add(m.id); mebulb.refreshSelection(); return m.id; });
  const sibs = () => ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); return mebulb.linkSiblings(d, m).map((x) => ({ p: x.page, stroke: x.style.stroke, sym: x.style.symbol, sz: mebulb.sketchSize(d, x) })); }, skId);
  await page.click('#propbar .pb-color[data-pop="style.stroke"]'); await page.waitForTimeout(150); const swv = await ev(() => document.querySelectorAll('#pop .sw[data-v]')[4].dataset.v); await page.click(`#pop .sw[data-v="${swv}"]`); await page.waitForTimeout(150);
  let sb = await sibs(); ok(sb.length === 4 && sb.every((x) => x.stroke === swv), 'colour changed on one page changes the sketch on all 4 pages: ' + sb.map((x) => x.stroke).join(','));
  // resize with a corner handle on this page: all pages follow and are marked as changed
  const hk = await ev((id) => { const el = document.querySelector(`.hdl[data-m="${id}"][data-h="k2"]`); const r = el.getBoundingClientRect(); return [r.left + 3, r.top + 3]; }, skId);
  const modsBefore = await ev((id) => { const d = mebulb.activeDoc(); return mebulb.linkSiblings(d, d.markups.find((x) => x.id === id)).map((x) => x.modified); }, skId);
  await page.mouse.move(hk[0], hk[1]); await page.mouse.down(); await page.mouse.move(hk[0] + 30, hk[1] + 20, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(200);
  sb = await sibs(); const modsAfter = await ev((id) => { const d = mebulb.activeDoc(); return mebulb.linkSiblings(d, d.markups.find((x) => x.id === id)).map((x) => x.modified); }, skId);
  ok(sb.every((x) => JSON.stringify(x.sz) === JSON.stringify(sb[0].sz)) && sb[0].sz.w > 30 && modsAfter.every((t, k) => t !== modsBefore[k]), 'resizing on one page resizes all pages (' + JSON.stringify(sb[0].sz) + ')');
  // dimensions on, a transition and a dragged label, then the parts other apps get
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); mebulb.linkSiblings(d, m).forEach((x) => { x.style = { ...x.style, showDims: true }; }); m.labelOff = [150, -90]; mebulb.renderAllMarks(d); }, skId);
  const parts = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); return mebulb.sketchParts(m, d).map((p) => ({ id: p.id.replace(id, ''), type: p.type, n: p.pts.length, text: p.text || '', group: p.group })); }, skId);
  ok(parts[0].id === '' && parts[0].type === 'rect' && parts.some((p) => p.id === '#l' && p.type === 'text' && /×/.test(p.text)) && parts.some((p) => p.type === 'pen') && parts.some((p) => p.id === '#a' && p.type === 'arrow') && new Set(parts.map((p) => p.group)).size === 1, 'sketch goes out as shape + label text box + ink + leader, one group: ' + parts.map((p) => p.type + p.id).join(' '));

  // ---- callouts: a level run out of the box to an adjustable knee, more leaders, side handles, double-click to edit
  await ev(() => { mebulb.goToPage(0, [1250, 820]); }); await page.waitForTimeout(250);
  const coId = await ev(() => { const d = mebulb.activeDoc(); const m = mebulb.sampleMarkup({ tool: 'callout', name: 'Check access panel size' }); m.id = 'PM-co7'; m.page = 0; m.pts = [[1340, 900], [1150, 800], [1260, 830]]; m.created = m.modified = new Date().toISOString(); d.markups.push(m); mebulb.renderAllMarks(d); const S = mebulb.state; S.sel.clear(); S.sel.add(m.id); mebulb.refreshSelection(); return m.id; });
  const leg = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); const L = d.pageEls[0].querySelector(`g.mk[data-id="${id}"] path`); return { d: L && L.getAttribute('d'), box: mebulb.CV ? null : null }; }, coId);
  const ld0 = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); const g = document.querySelector(`.hdl[data-m="${id}"][data-h="n"]`); return { knee: [+g.getAttribute('x'), +g.getAttribute('y')] }; }, coId);
  ok(/M1260 815L/.test(leg.d.replace(/\.0+\b/g, '')) || /M1260/.test(leg.d), 'the leader leaves the side of the box level (' + leg.d.slice(0, 40) + ')');
  // drag the knee up: the level run moves up with it
  const kn = await ev((id) => { const el = document.querySelector(`.hdl[data-m="${id}"][data-h="n"]`); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, coId);
  await page.mouse.move(kn[0], kn[1]); await page.mouse.down(); await page.mouse.move(kn[0] + 25, kn[1] - 8, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(100);
  const k1 = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); return m.knee; }, coId);
  ok(k1 && Math.abs(k1[0] - (1260 + 12.1 + 25)) < 3, 'dragging the knee handle moves the knee ' + JSON.stringify(k1 && k1.map((v) => +v.toFixed(1))));
  // + Leader, then click two things
  await page.click('#propbar [data-act="add-leader"]'); await page.waitForTimeout(100);
  await click(1100, 900); await click(1180, 960); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  const lds = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); return { n: (m.leaders || []).length, tips: (m.leaders || []).map((l) => l.tip.map(Math.round)), adding: !!mebulb.state.addLeaderFor, hdl: document.querySelectorAll(`.hdl[data-m="${id}"].knee`).length }; }, coId);
  ok(lds.n === 2 && lds.tips[0].join() === '1100,900' && lds.tips[1].join() === '1180,960' && !lds.adding && lds.hdl === 3, '+ Leader: two more leaders, each with its own knee handle ' + JSON.stringify(lds));
  await page.screenshot({ path: OUT + '/r7-callout.png' });
  // side handles: drag the right edge of the box out 40 pt
  const e1 = await ev((id) => { const el = document.querySelector(`.hdl[data-m="${id}"][data-h="f1"]`); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, coId);
  const w0 = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); return m.pts[2][0] - m.pts[1][0]; }, coId);
  await page.mouse.move(e1[0], e1[1]); await page.mouse.down(); await page.mouse.move(e1[0] + 40, e1[1], { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(100);
  const w1 = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); return m.pts[2][0] - m.pts[1][0]; }, coId);
  ok(Math.abs(w1 - w0 - 40) < 1.5, `side handle widens the box (${w0.toFixed(0)} → ${w1.toFixed(0)} pt)`);
  const e2 = await ev((id) => { const el = document.querySelector(`.hdl[data-m="${id}"][data-h="f2"]`); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, coId);
  await page.mouse.move(e2[0], e2[1]); await page.mouse.down(); await page.mouse.move(e2[0], e2[1] + 30, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(100);
  const h1 = await ev((id) => { const m = mebulb.activeDoc().markups.find((x) => x.id === id); return { h: m.pts[2][1] - m.pts[1][1], fixed: !!m.fixedH }; }, coId);
  ok(h1.h > 55 && h1.fixed, 'bottom side handle makes the box taller ' + JSON.stringify(h1));
  // double-click the text to edit it (no right-click needed)
  await ev(() => { mebulb.state.sel.clear(); mebulb.refreshSelection(); });
  { const [x, y] = await P(1180, 812); await page.mouse.dblclick(x, y); await page.waitForTimeout(250); }
  ok(await ev(() => !!mebulb.state.editing && mebulb.state.editing.id === 'PM-co7'), 'double-clicking the callout text starts editing');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);

  // ---- page alignment from hand-placed reference points and grid lines
  await ev(() => { mebulb.goToPage(0, [400, 400]); mebulb.setZoom(0.8); mebulb.setTool('refpt'); }); await page.waitForTimeout(300);
  await click(300, 300); await ev(() => mebulb.setTool('refpt')); await click(1200, 800);
  const rp = await ev(() => mebulb.activeDoc().markups.filter((m) => m.type === 'refpt').map((m) => m.text + '@' + m.pts[0].map(Math.round).join(',')));
  ok(rp.join() === 'R1@300,300,R2@1200,800', 'reference point tool places named marks R1, R2: ' + rp.join(' '));
  // copy them to pages 2-4, then move the copies on page 3 as if the drawing sits 20 pt right and 10 pt up there
  await ev(() => mebulb.runCommand('doc.refCopy')); await page.waitForSelector('#modal input[name=range]'); await page.click('#modal footer .btn.primary'); await page.waitForTimeout(200);
  const copies = await ev(() => mebulb.activeDoc().markups.filter((m) => m.type === 'refpt').length);
  ok(copies === 8, 'copied the marks to the other 3 pages (' + copies + ' marks)');
  await ev(() => { const d = mebulb.activeDoc(); d.markups.filter((m) => m.type === 'refpt' && m.page === 2).forEach((m) => { m.pts = [[m.pts[0][0] + 20, m.pts[0][1] - 10]]; }); mebulb.renderAllMarks(d); });
  // grid lines on page 1 and the same grid turned 2° on page 4
  await ev(() => { mebulb.goToPage(0, [500, 500]); mebulb.setTool('gridline'); }); await page.waitForTimeout(200);
  await drag([500, 150], [500, 1000]); await ev(() => mebulb.setTool('gridline')); await drag([150, 450], [1400, 450]);
  const gl = await ev(() => mebulb.activeDoc().markups.filter((m) => m.type === 'gridline').map((m) => m.text));
  ok(gl.join() === 'A,B', 'grid line tool names lines A, B: ' + gl.join(','));
  await ev(() => { mebulb.runCommand('panel.measure'); }); await page.waitForTimeout(300); await page.screenshot({ path: OUT + '/r7-refmarks.png' });
  await ev(() => { const d = mebulb.activeDoc(); const g = d.markups.filter((m) => m.type === 'gridline'); g[1].text = '1'; const a = 2 * Math.PI / 180; const rot = (p) => [600 + (p[0] - 600) * Math.cos(a) - (p[1] - 500) * Math.sin(a) + 15, 500 + (p[0] - 600) * Math.sin(a) + (p[1] - 500) * Math.cos(a) - 8];
    d.markups = d.markups.filter((m) => !(m.type === 'refpt' && m.page === 3)); g.forEach((m) => d.markups.push({ ...JSON.parse(JSON.stringify(m)), id: m.id + 'p4', page: 3, pts: m.pts.map(rot) })); mebulb.renderAllMarks(d); });
  await ev(() => mebulb.runCommand('doc.alignGrid')); await page.waitForSelector('#modal select[name=how]');
  const how = await ev(() => document.querySelector('#modal select[name=how]').value); await page.click('#modal footer .btn.primary'); await page.waitForTimeout(400);
  const al = await ev(() => { const d = mebulb.activeDoc(); return { ref: d.align.ref, t2: d.align.T[2], t3: d.align.T[3], t1: d.align.T[1] }; });
  ok(how === 'marks' && al.ref === 0 && Math.abs(al.t2[4] + 20) < 0.01 && Math.abs(al.t2[5] - 10) < 0.01 && al.t2[0] === 1, 'aligned by reference points: page 3 shifted back 20 pt left, 10 pt down ' + JSON.stringify(al.t2.map((v) => +v.toFixed(3))));
  const ang = Math.atan2(al.t3[1], al.t3[0]) * 180 / Math.PI;
  ok(Math.abs(ang + 2) < 0.01 && Math.abs(Math.hypot(al.t3[0], al.t3[1]) - 1) < 1e-6, `aligned by grid lines: page 4 turned back ${ang.toFixed(3)}° from one crossing and the line directions`);
  const back = await ev(() => { const d = mebulb.activeDoc(); const g = d.markups.find((m) => m.type === 'gridline' && m.page === 3 && m.text === 'A'); return mebulb.mapPage(d, 3, 0, g.pts[0]).map((v) => +v.toFixed(2)); });
  ok(Math.abs(back[0] - 500) < 0.05 && Math.abs(back[1] - 150) < 0.05, 'a point on page 4 maps onto the same point of page 1: ' + back);
  await ev(() => { const d = mebulb.activeDoc(); d.markups = d.markups.filter((m) => m.type !== 'refpt' && m.type !== 'gridline'); mebulb.renderAllMarks(d); mebulb.setTool('select'); });

  // ---- save: other viewers get the curve as vertices; MeBulb gets the curves back
  const b64 = await ev(async () => { const d = mebulb.activeDoc(); d.reader = await mebulb.openReader(d.src); const u = await mebulb.incrementalUpdate(d, {}); const all = new Uint8Array(d.src.size + u.bytes.length); all.set(d.src.bytes); all.set(u.bytes, d.src.size); let s = ''; for (let i = 0; i < all.length; i += 32768) s += String.fromCharCode.apply(null, all.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(OUT + '/r7.pdf', Buffer.from(b64, 'base64'));
  ok(/No syntax or stream encoding errors/.test(execSync(`qpdf --check ${OUT}/r7.pdf 2>&1 || true`, { encoding: 'utf8' })), 'saved PDF passes qpdf');
  const re = await ev(async ([b, id, pid]) => { const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const d = await mebulb.openBytes('R7.pdf', bytes); await new Promise((r) => setTimeout(r, 800)); const m = d.markups.find((x) => x.id === id); const p = d.markups.find((x) => x.id === pid); return { a: m && Object.keys(m.curves || {}).length, p: p && Object.keys(p.curves || {}).length }; }, [b64, ar.id, pl.id]);
  ok(re.a >= 3 && re.p === 1, 'reopened: curves come back ' + JSON.stringify(re));
  const verts = execSync(`qpdf --qdf --object-streams=disable ${OUT}/r7.pdf - | strings | grep -A1 "/Vertices" | head -40 || true`, { encoding: 'utf8' });
  ok(/Vertices/.test(verts), 'curved polys carry vertices for other viewers');
  // the sketch in the saved file: an exact Square, its label a FreeText, grouped the Revu way
  const ann = await ev(async ([b, id]) => { const PDFLib = window.PDFLib; const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const pdf = await PDFLib.PDFDocument.load(bytes); const pg = pdf.getPage(1); const arr = pg.node.lookup(PDFLib.PDFName.of('Annots'));
    const out = []; for (const r of arr.asArray()) { const d = pdf.context.lookup(r); const mid = d.get(PDFLib.PDFName.of('MeBulbId')); if (!mid || !mid.decodeText().startsWith(id)) continue; const num = (k) => { const a = d.lookup(PDFLib.PDFName.of(k)); return a ? a.asArray().map((x) => x.asNumber()) : null; };
      out.push({ id: mid.decodeText().replace(id, ''), sub: d.get(PDFLib.PDFName.of('Subtype')).asString(), rect: num('Rect'), rd: num('RD'), gn: !!d.get(PDFLib.PDFName.of('GroupNesting')), irt: !!d.get(PDFLib.PDFName.of('IRT')), w: d.lookup(PDFLib.PDFName.of('BS')) ? d.lookup(PDFLib.PDFName.of('BS')).lookup(PDFLib.PDFName.of('W')).asNumber() : null }); }
    const d0 = mebulb.activeDoc(); return { out, page: d0.pages[1].h }; }, [b64, skId]);
  const sq = ann.out.find((a) => a.id === ''); const ft = ann.out.find((a) => a.id === '#l');
  const skGeo = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); const sz = mebulb.sketchSize(d, m); const sc = d.scales[m.page] || {}; return { c: m.pts[0], w: sz.w, h: sz.h, ipp: (sc.inPerPt || 0), width: m.style.width }; }, skId);
  const inner = sq && [sq.rect[0] + sq.rd[0], sq.rect[1] + sq.rd[1], sq.rect[2] - sq.rd[2], sq.rect[3] - sq.rd[3]];
  const wPt = inner && inner[2] - inner[0] - sq.w;
  ok(sq && sq.sub === '/Square' && sq.gn && ft && ft.sub === '/FreeText' && ft.irt && skGeo.ipp && Math.abs(wPt * skGeo.ipp - skGeo.w) < 0.05, `saved: Square sized exactly ${(wPt * skGeo.ipp * 25.4).toFixed(0)} mm wide (sketch ${(skGeo.w * 25.4).toFixed(0)} mm), label FreeText in its group; parts ${ann.out.map((a) => a.sub + a.id).join(' ')}`);
  // reopened in MeBulb: still one sketch per page, no stray text boxes
  const re2 = await ev(async ([b, id]) => { const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const d = await mebulb.openBytes('R7b.pdf', bytes); await new Promise((r) => setTimeout(r, 800)); const m = d.markups.find((x) => x.id === id); return { sk: d.markups.filter((x) => x.type === 'sketch' && x.link === m.link).length, stray: d.markups.filter((x) => (x.ext && x.ext.it) || /#/.test(x.id)).length, txt: d.markups.filter((x) => x.type === 'text' && x.page === 1).length }; }, [b64, skId]);
  const co = await ev(async ([b]) => { const PDFLib = window.PDFLib; const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const pdf = await PDFLib.PDFDocument.load(bytes); const arr = pdf.getPage(0).node.lookup(PDFLib.PDFName.of('Annots')); const out = [];
    for (const r of arr.asArray()) { const d = pdf.context.lookup(r); const mid = d.get(PDFLib.PDFName.of('MeBulbId')); if (!mid || !mid.decodeText().startsWith('PM-co7')) continue; const cl = d.lookup(PDFLib.PDFName.of('CL')); out.push({ id: mid.decodeText(), sub: d.get(PDFLib.PDFName.of('Subtype')).asString(), cl: cl ? cl.size() : 0, irt: !!d.get(PDFLib.PDFName.of('IRT')), gn: !!d.get(PDFLib.PDFName.of('GroupNesting')) }); } return out; }, [b64]);
  ok(co.length === 3 && co.find((a) => a.sub === '/FreeText' && a.cl === 6 && a.gn) && co.filter((a) => a.sub === '/PolyLine' && a.irt).length === 2, 'callout saved as a FreeText with its knee (CL) plus 2 grouped leader polylines: ' + co.map((a) => a.sub + (a.cl ? ' CL' + a.cl : '')).join(', '));
  ok(re2.sk === 4 && re2.stray === 0, 'reopened: the linked sketch is back on 4 pages, its parts are not extra markups ' + JSON.stringify(re2));
  // as if moved and resized in Revu: the Square grows by 72 pt wide and moves; MeBulb follows on every page
  const revu = await ev(async ([b, id]) => { const PDFLib = window.PDFLib; const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const pdf = await PDFLib.PDFDocument.load(bytes); const pg = pdf.getPage(1); const arr = pg.node.lookup(PDFLib.PDFName.of('Annots'));
    for (const r of arr.asArray()) { const d = pdf.context.lookup(r); const mid = d.get(PDFLib.PDFName.of('MeBulbId')); if (!mid || mid.decodeText() !== id) continue; const a = d.lookup(PDFLib.PDFName.of('Rect')).asArray().map((x) => x.asNumber()); d.set(PDFLib.PDFName.of('Rect'), pdf.context.obj([a[0] + 10, a[1], a[2] + 82, a[3]])); const t = new Date(Date.now() + 60000); const p2 = (n) => String(n).padStart(2, '0'); d.set(PDFLib.PDFName.of('M'), PDFLib.PDFString.of(`D:${t.getUTCFullYear()}${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())}${p2(t.getUTCHours())}${p2(t.getUTCMinutes())}${p2(t.getUTCSeconds())}Z`)); }
    const out = await pdf.save({ useObjectStreams: false }); const d2 = await mebulb.openBytes('R7revu.pdf', out); await new Promise((r) => setTimeout(r, 900)); const m = d2.markups.find((x) => x.id === id); return { sz: mebulb.sketchSize(d2, m), sibs: mebulb.linkSiblings(d2, m).map((x) => mebulb.sketchSize(d2, x).w), c: m.pts[0] }; }, [b64, skId]);
  ok(Math.abs(revu.sz.w - (skGeo.w + 72 * skGeo.ipp)) < 0.45 && revu.sibs.every((w) => w === revu.sz.w) && Math.abs(revu.c[0] - (skGeo.c[0] + 46)) < 0.6, `edited in Revu (moved, 72 pt wider): MeBulb takes the new size on all pages (${(revu.sz.w * 25.4).toFixed(0)} mm) and position`);

  module.exports.page = page;
  const bad = errors.filter((e) => !/favicon|net::ERR/.test(e)); ok(!bad.length, 'no page errors' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
  await browser.close();
})();
