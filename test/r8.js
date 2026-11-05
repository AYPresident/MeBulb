// Round 8: linked sketch page picking, text spacing, Revu line types, sketch label arrows,
// independent / Alt-centred resizing; ductwork (sizes, insulation, caps, grilles, routing, sections)
const { launch } = require('./harness');
const fs = require('fs'); const { execSync } = require('child_process');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', (e) => console.log('STACK', e.stack));
  const ev = (fn, a) => page.evaluate(fn, a);
  await ev(() => { const S = mebulb.state; S.snapMarkup = false; S.snapContent = false; S.snapGrid = false; mebulb.setZoom(1); mebulb.goToPage(0, [700, 300]); });
  await page.waitForTimeout(400);
  const P = (x, y, pg = 0) => ev(([x, y, pg]) => { const d = mebulb.activeDoc(); const r = d.pageEls[pg].getBoundingClientRect(); return [r.left + x * d.zoom, r.top + y * d.zoom]; }, [x, y, pg]);
  const click = async (x, y, mods = [], pg = 0) => { const [cx, cy] = await P(x, y, pg); await page.mouse.move(cx, cy); for (const k of mods) await page.keyboard.down(k); await page.mouse.down(); await page.mouse.up(); for (const k of mods) await page.keyboard.up(k); await page.waitForTimeout(40); };
  const dragC = async (a, b, mods = []) => { await page.mouse.move(a[0], a[1]); for (const k of mods) await page.keyboard.down(k); await page.mouse.down(); await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 }); await page.mouse.move(b[0], b[1], { steps: 4 }); await page.mouse.up(); for (const k of mods) await page.keyboard.up(k); await page.waitForTimeout(80); };
  const hdl = (id, h) => ev(([id, h]) => { const el = document.querySelector(`.hdl[data-m="${id}"][data-h="${h}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, [id, h]);
  const get = (id) => ev((id) => JSON.parse(JSON.stringify(mebulb.activeDoc().markups.find((m) => m.id === id) || null)), id);

  // ---- linked sketches: pick pages, take the riser off some, unlink others
  await ev(() => mebulb.setTool('sketchrect')); await click(700, 300); await page.waitForTimeout(150);
  const sk = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; mebulb.placeOnPages(d, m, [0, 1, 2, 3]); mebulb.renderAllMarks(d); mebulb.setTool('select'); const S = mebulb.state; S.sel.clear(); S.linkOpen = m.link; mebulb.refreshSelection(); mebulb.openPanel('linked'); return { id: m.id, link: m.link }; });
  await page.waitForTimeout(400);
  const tiles = await ev((link) => [...document.querySelectorAll(`#linked-panel .lk-card[data-link="${link}"] [data-lk="goto"]`)].map((b) => b.dataset.id), sk.link);
  ok(tiles.length === 4, 'linked panel shows the riser on 4 pages');
  await page.click(`#linked-panel [data-lk="goto"][data-id="${tiles[2]}"]`, { modifiers: ['Control'] });
  await page.click(`#linked-panel [data-lk="goto"][data-id="${tiles[3]}"]`, { modifiers: ['Control'] });
  const bar = await ev(() => (document.querySelector('#linked-panel .lk-pickbar') || {}).textContent || '');
  ok(/2 pages picked/.test(bar) && await ev(() => document.querySelectorAll('#linked-panel .lk-view.pick').length === 2), 'Ctrl+click picks two pages: ' + bar.replace(/\s+/g, ' '));
  await page.click('#linked-panel [data-lk="rmpick"]'); await page.waitForTimeout(200);
  let left = await ev((link) => mebulb.activeDoc().markups.filter((m) => m.link === link).map((m) => m.page).sort(), sk.link);
  ok(left.join() === '0,1', 'Remove takes the riser off the picked pages only: still on pages ' + left.map((p) => p + 1).join(', '));
  await ev((id) => mebulb.runCommand ? null : null, sk.id);
  await page.click(`#linked-panel [data-lk="choose"]`); await page.waitForSelector('#modal .page-picks');
  const second = await ev((link) => mebulb.activeDoc().markups.find((m) => m.link === link && m.page === 1).id, sk.link);
  await page.check(`#modal input[name="i_${second}"]`); await page.selectOption('#modal select[name=what]', 'unlink'); await page.click('#modal footer .btn.primary'); await page.waitForTimeout(200);
  const un = await get(second); left = await ev((link) => mebulb.activeDoc().markups.filter((m) => m.link === link).length, sk.link);
  ok(un && !un.link && un.type === 'sketch' && left <= 1, 'Choose pages… unlinks the ticked page: it stays as its own sketch');

  // ---- text: padding, line spacing, character spacing
  const tx = await ev(() => { const d = mebulb.activeDoc(); const m = mebulb.sampleMarkup({ tool: 'text', name: 'Spacing test' }); m.id = 'PM-tx8'; m.page = 0; m.pts = [[900, 700], [1060, 730]]; m.text = 'Two lines\nof text'; m.created = m.modified = new Date().toISOString(); d.markups.push(m); mebulb.renderAllMarks(d); const S = mebulb.state; S.sel.clear(); S.sel.add(m.id); mebulb.refreshSelection(); mebulb.openPanel('props'); return m.id; });
  await page.waitForTimeout(250);
  const h0 = await ev(() => { const m = mebulb.activeDoc().markups.find((x) => x.id === 'PM-tx8'); return m.pts[1][1] - m.pts[0][1]; });
  await page.fill('#props input[data-k="style.pad"]', '10'); await page.press('#props input[data-k="style.pad"]', 'Enter');
  await page.selectOption('#props select[data-k="style.lineH"]', '2');
  await page.fill('#props input[data-k="style.letterSp"]', '1.5'); await page.press('#props input[data-k="style.letterSp"]', 'Enter'); await page.waitForTimeout(150);
  const t1 = await ev(() => { const m = mebulb.activeDoc().markups.find((x) => x.id === 'PM-tx8'); const g = document.querySelector('g.mk[data-id="PM-tx8"] text'); return { h: m.pts[1][1] - m.pts[0][1], s: m.style, ls: g && g.getAttribute('letter-spacing') }; });
  ok(t1.s.pad === 10 && t1.s.lineH === 2 && t1.s.letterSp === 1.5 && t1.ls === '1.5' && t1.h > h0 * 1.6, `text box: padding 10 pt, double line spacing, 1.5 pt character spacing (height ${h0.toFixed(0)} → ${t1.h.toFixed(0)} pt)`);
  const lab = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.type === 'area'); const before = mebulb.measureInfo(m, d) && document.querySelector(`g.mk[data-id="${m.id}"] text`); m.style = { ...m.style, letterSp: 2, lineH: 1.6, pad: 6 }; mebulb.renderAllMarks(d); const t = document.querySelector(`g.mk[data-id="${m.id}"] text`); return { id: m.id, ls: t && t.getAttribute('letter-spacing') }; });
  ok(lab.ls === '2', 'measurement labels take character spacing too');
  await page.screenshot({ path: OUT + '/r8-text.png' });

  // ---- line types: fixed dash lengths like Revu, whatever the width
  const ln = await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); const m = { id: 'PM-ln8', type: 'line', page: 0, pts: [[200, 1050], [700, 1050]], style: { stroke: '#3b5bdb', width: 30, opacity: 0.6, dash: 'dashed' }, subject: 'Line', author: 'T', created: now, modified: now }; d.markups.push(m); mebulb.renderAllMarks(d); const S = mebulb.state; S.sel.clear(); S.sel.add(m.id); mebulb.refreshSelection(); const p = document.querySelector('g.mk[data-id="PM-ln8"] path'); return { da: p.getAttribute('stroke-dasharray'), cap: p.getAttribute('stroke-linecap') }; });
  ok(ln.da === '3 3' && ln.cap === 'butt', `a 30 pt dashed line keeps 3 pt dashes with square ends (${ln.da}, ${ln.cap})`);
  await page.click('#propbar [data-ltpop]'); await page.waitForTimeout(100);
  const kinds = await ev(() => [...document.querySelectorAll('#pop .lt-row')].map((b) => b.textContent.trim()));
  ok(kinds.length >= 11 && kinds.includes('Centre line') && kinds.includes('Dash dot dot') && kinds.includes('Custom…'), 'line style list drawn like Revu: ' + kinds.join(', '));
  await page.click('#pop .lt-row[data-v="dashdot"]'); await page.waitForTimeout(100);
  ok(await ev(() => mebulb.activeDoc().markups.find((x) => x.id === 'PM-ln8').style.dash === 'dashdot' && document.querySelector('g.mk[data-id="PM-ln8"] path').getAttribute('stroke-dasharray') === '8 2.5 1.5 2.5'), 'picking Dash dot applies it');
  await page.click('#propbar [data-ltpop]'); await page.click('#pop .lt-row[data-v="__custom"]'); await page.waitForSelector('#modal input[name=pat]'); await page.fill('#modal input[name=pat]', '10 2 2 2'); await page.click('#modal footer .btn.primary'); await page.waitForTimeout(100);
  const cu = await get('PM-ln8'); ok(cu.style.dash === 'custom' && cu.style.dashPat.join() === '10,2,2,2', 'custom pattern 10 2 2 2');
  await page.screenshot({ path: OUT + '/r8-linetypes.png' });

  // ---- sketch label arrow: none when the moved label sits inside the riser; can be turned off
  const big = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id && x.type === 'sketch' && !x.link); mebulb.setSketchSize(d, m, { shape: 'rect', w: 200, h: 160 }); m.labelOff = [10, -20]; mebulb.renderAllMarks(d); return m.id; });
  const hasLeader = (id) => ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); return mebulb.sketchParts(m, d).some((p) => p.id.endsWith('#a')); }, id);
  ok(!(await hasLeader(big)), 'big riser with its label moved inside it: no arrow');
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); m.labelOff = [400, -300]; mebulb.renderAllMarks(d); }, big);
  ok(await hasLeader(big), 'label moved outside: arrow back to the riser');
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); m.style = { ...m.style, labelArrow: false }; mebulb.renderAllMarks(d); }, big);
  ok(!(await hasLeader(big)), '"Arrow from a moved label" off: no arrow');

  // ---- resizing: the opposite corner stays; Alt sizes about the centre; side handles
  const rs = await ev(() => { const d = mebulb.activeDoc(); mebulb.setTool('sketchrect'); return null; });
  await click(500, 500); await page.waitForTimeout(150);
  const r8 = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; mebulb.setTool('select'); const S = mebulb.state; S.sel.clear(); S.sel.add(m.id); mebulb.refreshSelection(); return m.id; });
  const corner = async (id) => ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); const sz = mebulb.sketchSize(d, m); const sc = d.scales[m.page]; const k = 1 / sc.inPerPt; return { c: m.pts[0], tl: [m.pts[0][0] - sz.w * k / 2, m.pts[0][1] - sz.h * k / 2], br: [m.pts[0][0] + sz.w * k / 2, m.pts[0][1] + sz.h * k / 2], sz }; }, id);
  const g0 = await corner(r8); let hp = await hdl(r8, 'k2'); await dragC(hp, [hp[0] + 40, hp[1] + 30]); const g1 = await corner(r8);
  ok(Math.abs(g1.tl[0] - g0.tl[0]) < 0.6 && Math.abs(g1.tl[1] - g0.tl[1]) < 0.6 && g1.sz.w > g0.sz.w, `dragging the bottom-right corner keeps the top-left where it was (${g0.tl.map((v) => v.toFixed(1))} → ${g1.tl.map((v) => v.toFixed(1))})`);
  hp = await hdl(r8, 'k2'); await dragC(hp, [hp[0] + 30, hp[1] + 20], ['Alt']); const g2 = await corner(r8);
  ok(Math.abs(g2.c[0] - g1.c[0]) < 0.01 && Math.abs(g2.c[1] - g1.c[1]) < 0.01 && g2.sz.w > g1.sz.w, 'Alt+drag sizes about the centre (centre unchanged, both sides move)');
  hp = await hdl(r8, 'j1'); await dragC(hp, [hp[0] + 25, hp[1]]); const g3 = await corner(r8);
  ok(hp && Math.abs(g3.tl[0] - g2.tl[0]) < 0.6 && g3.sz.w > g2.sz.w && g3.sz.h === g2.sz.h, 'the right-side handle changes the width only, the left side stays');
  const rect = await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); const m = { id: 'PM-rc8', type: 'rect', page: 0, pts: [[1100, 300], [1200, 360]], style: { stroke: '#d6331f', width: 1, opacity: 1, fill: 'none' }, subject: 'Rectangle', author: 'T', created: now, modified: now }; d.markups.push(m); mebulb.renderAllMarks(d); const S = mebulb.state; S.sel.clear(); S.sel.add(m.id); mebulb.refreshSelection(); return m.id; });
  hp = await hdl(rect, 'c2'); await dragC(hp, [hp[0] + 20, hp[1] + 10], ['Alt']); const rc = await get(rect);
  ok(Math.abs(rc.pts[0][0] - 1080) < 0.6 && Math.abs(rc.pts[1][0] - 1220) < 0.6 && Math.abs(rc.pts[0][1] - 290) < 0.6, 'rectangle corner with Alt grows about its centre ' + JSON.stringify(rc.pts.map((p) => p.map(Math.round))));
  await page.screenshot({ path: OUT + '/r8-resize.png' });

  // ---- ductwork: same-name risers connected by a routed, sized duct
  await ev(() => { const d = mebulb.activeDoc(); d.markups = d.markups.filter((m) => !['PM-ln8', 'PM-rc8', 'PM-tx8'].includes(m.id)); mebulb.renderAllMarks(d); mebulb.setZoom(0.8); mebulb.goToPage(2, [800, 600]); });
  await page.waitForTimeout(400);
  const risers = await ev(async () => { const d = mebulb.activeDoc(); const S = mebulb.state; S.sketchAutoNum = false; S.sketchNext = 'M7'; const mk = (x, y) => { const m = { id: 'PM-rs' + x, type: 'sketch', page: 2, pts: [[x, y]], sz: { shape: 'rect', w: 600 / 25.4, h: 300 / 25.4 }, rot: 0, name: 'M7', text: '', style: { stroke: '#1f5fd1', width: 1.25, fill: '#1f5fd1', fillOpacity: 0.07, fontSize: 9, fontColor: '#1f5fd1', symbol: 'x', showLabel: true, showName: true, showSize: true }, subject: 'Sketch rectangle', author: 'T', created: new Date().toISOString(), modified: new Date().toISOString() }; d.markups.push(m); return m.id; };
    const a = mk(330, 560), b = mk(1250, 800); mebulb.renderAllMarks(d); return [a, b]; });
  const n = await ev(() => mebulb.connectSameNameRisers(2)); await page.waitForTimeout(300);
  const du = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.type === 'duct'); if (!m) return null; const orth = m.pts.every((p, i) => !i || Math.abs(p[0] - m.pts[i - 1][0]) < 0.6 || Math.abs(p[1] - m.pts[i - 1][1]) < 0.6); return { id: m.id, from: m.from, to: m.to, n: m.pts.length, orth, size: m.duct.w + 'x' + m.duct.h, text: m.text, len: mebulb.ductLengthMm(d, m), bends: mebulb.ductBends(m), a: m.pts[0], b: m.pts[m.pts.length - 1] }; });
  ok(n === 1 && du && du.from === risers[0] && du.to === risers[1] && du.orth && du.size === '600x300' && du.text === 'M7 duct', `same-name risers M7 → M7 connected: square runs, riser size 600×300, ${(du.len / 1000).toFixed(1)} m, ${du.bends} bends`);
  // the route crosses less of the drawing than a straight line would
  const cross = await ev(async (du) => { const d = mebulb.activeDoc(); const g = d.geo[2]; const S = g.segs; const hits = (a, b) => { let n = 0; for (let k = 0; k < g.n; k++) { const p = [S[k * 4], S[k * 4 + 1]], q = [S[k * 4 + 2], S[k * 4 + 3]]; const den = (b[0] - a[0]) * (q[1] - p[1]) - (b[1] - a[1]) * (q[0] - p[0]); if (Math.abs(den) < 1e-9) continue; const t = ((p[0] - a[0]) * (q[1] - p[1]) - (p[1] - a[1]) * (q[0] - p[0])) / den, u = ((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / den; if (t > 0 && t < 1 && u > 0 && u < 1) n++; } return n; };
    const m = d.markups.find((x) => x.id === du.id); let r = 0; for (let i = 1; i < m.pts.length; i++) r += hits(m.pts[i - 1], m.pts[i]); const st = hits(du.a, du.b); const lr = hits(du.a, [du.b[0], du.a[1]]) + hits([du.b[0], du.a[1]], du.b); return { r, st, lr }; }, du);
  ok(cross.r <= cross.st && cross.r <= cross.lr, `best route crosses ${cross.r} drawing lines (straight line ${cross.st}, simple L ${cross.lr})`);
  const svg = await ev((id) => { const g = document.querySelector(`g.mk[data-id="${id}"]`); return { paths: g.querySelectorAll('path').length, text: [...g.querySelectorAll('text')].map((t) => t.textContent).join(' | ') }; }, du.id);
  ok(svg.paths >= 4 && /600×300 SA · 25 INS/.test(svg.text), 'duct drawn to scale as a double line with its size and insulation: ' + svg.text);
  // capped for a future provision
  await ev((id) => { const S = mebulb.state; S.sel.clear(); S.sel.add(id); mebulb.refreshSelection(); mebulb.openPanel('props'); }, du.id); await page.waitForTimeout(200);
  await page.selectOption('#props select[data-k="duct.end1"]', 'fp'); await page.waitForTimeout(150);
  ok(await ev((id) => /CAPPED · FUTURE PROVISION/.test(document.querySelector(`g.mk[data-id="${id}"]`).textContent) && mebulb.activeDoc().markups.find((m) => m.id === id).duct.ends[1] === 'fp', du.id), 'end capped as a future provision, labelled on the drawing');
  await page.fill('#props input[data-k="duct.ins"]', '50'); await page.press('#props input[data-k="duct.ins"]', 'Enter'); await page.waitForTimeout(100);
  ok(await ev((id) => mebulb.activeDoc().markups.find((m) => m.id === id).duct.ins === 50, du.id), 'insulation thickness changed to 50 mm');
  // grilles along it
  await page.click('#props [data-act="duct-grilles"]'); await page.waitForSelector('#modal input[name=n]'); await page.fill('#modal input[name=n]', '3'); await page.fill('#modal input[name=q]', '150'); await page.click('#modal footer .btn.primary'); await page.waitForTimeout(200);
  const grs = await ev((id) => { const d = mebulb.activeDoc(); return d.markups.filter((m) => m.type === 'grille' && m.on === id).map((m) => ({ id: m.id, tag: m.tag, fa: mebulb.grilleFA(m.gr), v: mebulb.grilleVel(m.gr), p: m.pts[0] })); }, du.id);
  ok(grs.length === 3 && grs.map((g) => g.tag).join() === 'SG-01,SG-02,SG-03' && Math.abs(grs[0].fa - 0.252) < 1e-6 && Math.abs(grs[0].v - 0.595) < 0.001, `3 supply grilles on the duct: 600×600, free area ${grs[0] && grs[0].fa.toFixed(3)} m², 150 L/s at ${grs[0] && grs[0].v && grs[0].v.toFixed(2)} m/s`);
  const glab = await ev((id) => document.querySelector(`g.mk[data-id="${id}"]`).textContent, grs[0].id);
  ok(/SG-01/.test(glab) && /600×600/.test(glab) && /FA 0\.252 m²/.test(glab) && /150 L\/s/.test(glab), 'grille shows its tag, size, free area and airflow: ' + glab);
  // moving the duct takes its grilles along
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); m.pts = m.pts.map((p) => [p[0], p[1] + 20]); mebulb.renderAllMarks(d); const dm = d.markups.find((x) => x.id === id); }, du.id);
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); const el = d.pageEls[m.page].querySelector(`g.mk[data-id="${id}"]`); return el; }, du.id);
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); m.modified = new Date().toISOString(); }, du.id);
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); const r = d.pageEls[m.page]; void r; }, du.id);
  const moved = await ev(([id, g0]) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); mebulb.renderAllMarks(d); const gm = d.markups.find((x) => x.id === g0.id); return gm.pts[0][1] - g0.p[1]; }, [du.id, grs[0]]);
  ok(Math.abs(moved - 20) < 0.5, 'grilles ride on the duct when it moves (' + moved.toFixed(1) + ' pt)');
  // section views of the duct and a grille
  await ev(() => mebulb.goToPage(2, [1100, 500])); await page.waitForTimeout(250);
  await ev((id) => { const d = mebulb.activeDoc(); mebulb.startSectionPlace(d.markups.find((x) => x.id === id)); }, du.id); await click(1250, 300, [], 2); await page.waitForTimeout(150);
  await ev((id) => { const d = mebulb.activeDoc(); mebulb.startSectionPlace(d.markups.find((x) => x.id === id)); }, grs[1].id); await click(1250, 450, [], 2); await page.waitForTimeout(150);
  const secs = await ev(() => { const d = mebulb.activeDoc(); return d.markups.filter((m) => m.type === 'section').map((m) => ({ id: m.id, of: m.of, letter: m.letter, text: document.querySelector(`g.mk[data-id="${m.id}"]`).textContent })); });
  ok(secs.length === 2 && secs[0].letter === 'A' && /SECTION A/.test(secs[0].text) && /600/.test(secs[0].text) && /50 mm EXTERNAL INSULATION/.test(secs[0].text), 'duct section A: the duct cut at 1:10 with size and insulation');
  ok(secs[1] && secs[1].letter === 'B' && /SECTION B/.test(secs[1].text) && /FREE AREA 0\.252/.test(secs[1].text) && /NECK 250×250/.test(secs[1].text) && /CEILING/.test(secs[1].text), 'grille section B: plenum, neck, free area and ceiling');
  ok(await ev((id) => /\bA\b/.test([...document.querySelectorAll(`g.mk[data-id="${id}"] text`)].map((t) => t.textContent).join(' ')), du.id), 'the duct shows the section A cut marker');
  await page.screenshot({ path: OUT + '/r8-duct.png' });
  // hand-drawn duct from one riser to the other connects to both
  await ev(() => { mebulb.setZoom(0.6); mebulb.goToPage(2, [800, 760]); mebulb.setTool('duct'); }); await page.waitForTimeout(300); await click(330, 562, [], 2); await click(330, 950, [], 2); { const [x, y] = await P(1250, 802, 2); await page.mouse.click(x, y); await page.mouse.dblclick(x, y); } await page.waitForTimeout(150);
  const hd = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.filter((x) => x.type === 'duct').pop(); return { from: m.from, to: m.to, a: m.pts[0], n: d.markups.filter((x) => x.type === 'duct').length }; });
  ok(hd.n === 2 && hd.from === risers[0] && hd.to === risers[1] && Math.abs(hd.a[0] - 330) < 0.01 && hd.a[1] > 563 && hd.a[1] < 572, 'a duct drawn from riser to riser starts at the riser face it leaves through and records the connection');
  // grille tool: a click on the duct puts the grille on it
  const onDuct = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.filter((x) => x.type === 'duct').pop(); return [m.pts[0][0], (m.pts[0][1] + m.pts[1][1]) / 2]; });
  await ev(() => mebulb.setTool('grille')); await click(onDuct[0] + 1, onDuct[1], [], 2); await page.waitForTimeout(150);
  const g4 = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.filter((x) => x.type === 'grille').pop(); const du = d.markups.filter((x) => x.type === 'duct').pop(); return { on: m.on === du.id, tag: m.tag, x: m.pts[0][0], dx: du.pts[0][0] }; });
  ok(g4.on && g4.tag === 'SG-04' && Math.abs(g4.x - g4.dx) < 0.01, 'grille tool: clicking on a duct puts the grille on its centreline (' + g4.tag + ')');
  ok(await ev(() => { mebulb.openPanel('ductwork'); return new Promise((r) => setTimeout(() => r(document.querySelectorAll('#ductwork .eq-pl').length), 300)); }) === 6, 'Ductwork panel lists 2 ducts and 4 grilles');
  await page.screenshot({ path: OUT + '/r8-ductpanel.png' });
  // saved: Revu gets plain grouped markups; MeBulb gets its ducts back
  const b64 = await ev(async () => { const d = mebulb.activeDoc(); d.reader = await mebulb.openReader(d.src); const u = await mebulb.incrementalUpdate(d, {}); const all = new Uint8Array(d.src.size + u.bytes.length); all.set(d.src.bytes); all.set(u.bytes, d.src.size); let s = ''; for (let i = 0; i < all.length; i += 32768) s += String.fromCharCode.apply(null, all.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(OUT + '/r8.pdf', Buffer.from(b64, 'base64'));
  ok(/No syntax or stream encoding errors/.test(execSync(`qpdf --check ${OUT}/r8.pdf 2>&1 || true`, { encoding: 'utf8' })), 'saved PDF passes qpdf');
  const kinds2 = await ev(async ([b, id]) => { const PDFLib = window.PDFLib; const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const pdf = await PDFLib.PDFDocument.load(bytes); const arr = pdf.getPage(2).node.lookup(PDFLib.PDFName.of('Annots')); const out = {}; for (const r of arr.asArray()) { const dd = pdf.context.lookup(r); const mid = dd.get(PDFLib.PDFName.of('MeBulbId')); if (!mid) continue; const t = mid.decodeText(); const sub = dd.get(PDFLib.PDFName.of('Subtype')).asString(); if (t === id) out.duct = sub + (dd.get(PDFLib.PDFName.of('GroupNesting')) ? '+group' : ''); if (/#t\d/.test(t) && t.startsWith(id)) out.label = sub; if (sub === '/Stamp') out.stamp = (out.stamp || 0) + 1; } return out; }, [b64, du.id]);
  ok(kinds2.duct === '/Polygon+group' && kinds2.label === '/FreeText' && kinds2.stamp >= 2, 'in the PDF the duct is a grouped polygon with a text box label; section views are stamps ' + JSON.stringify(kinds2));
  const re = await ev(async (b) => { const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const d = await mebulb.openBytes('R8.pdf', bytes); await new Promise((r) => setTimeout(r, 900)); return { duct: d.markups.filter((m) => m.type === 'duct').length, gr: d.markups.filter((m) => m.type === 'grille').length, sec: d.markups.filter((m) => m.type === 'section').length, stray: d.markups.filter((m) => /#/.test(m.id) || (m.ext && m.ext.it)).length }; }, b64);
  ok(re.duct === 2 && re.gr === 4 && re.sec === 2 && re.stray === 0, 'reopened: 2 ducts, 4 grilles, 2 sections and no stray parts ' + JSON.stringify(re));

  module.exports.page = page;
  const bad = errors.filter((e) => !/favicon|net::ERR/.test(e)); ok(!bad.length, 'no page errors' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
  await browser.close();
})();
