// Round 9: linked page picking keeps the clicked page, working in the grey area, autosave and
// recovery, riser grilles and riser sections, riser exits and transitions, face grilles, ductulator
const { launch } = require('./harness');
const fs = require('fs');
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
  const dragC = async (a, b, mods = [], steps = 4) => { await page.mouse.move(a[0], a[1]); for (const k of mods) await page.keyboard.down(k); await page.mouse.down(); await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps }); await page.mouse.move(b[0], b[1], { steps }); await page.mouse.up(); for (const k of mods) await page.keyboard.up(k); await page.waitForTimeout(80); };
  const get = (id) => ev((id) => JSON.parse(JSON.stringify(mebulb.activeDoc().markups.find((m) => m.id === id) || null)), id);

  // ---- linked panel: click a page, then Ctrl+click another: both count
  await ev(() => mebulb.setTool('sketchrect')); await click(700, 300); await page.waitForTimeout(150);
  const sk = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; mebulb.placeOnPages(d, m, [0, 1, 2, 3]); mebulb.renderAllMarks(d); mebulb.setTool('select'); mebulb.state.linkOpen = m.link; mebulb.openPanel('linked'); return { id: m.id, link: m.link }; });
  await page.waitForTimeout(400);
  const tiles = await ev((link) => [...document.querySelectorAll(`#linked-panel .lk-card[data-link="${link}"] [data-lk="goto"]`)].map((b) => b.dataset.id), sk.link);
  await page.click(`#linked-panel [data-lk="goto"][data-id="${tiles[1]}"]`); await page.waitForTimeout(150);
  await page.click(`#linked-panel [data-lk="goto"][data-id="${tiles[3]}"]`, { modifiers: ['Control'] }); await page.waitForTimeout(100);
  const picked = await ev(() => [...document.querySelectorAll('#linked-panel .lk-view.pick')].map((b) => b.dataset.id));
  ok(picked.length === 2 && picked.includes(tiles[1]) && picked.includes(tiles[3]), 'click page 2, Ctrl+click page 4: both pages are picked');
  await page.click(`#linked-panel [data-lk="goto"][data-id="${tiles[2]}"]`, { modifiers: ['Shift'] }); await page.waitForTimeout(100);
  ok(await ev(() => document.querySelectorAll('#linked-panel .lk-view.pick').length) === 3, 'Shift+click adds the range');
  await page.click('#linked-panel [data-lk="clearpick"]');
  await ev((link) => { const d = mebulb.activeDoc(); d.markups = d.markups.filter((m) => m.link !== link); mebulb.cleanupLinks(d); mebulb.renderAllMarks(d); mebulb.state.sel.clear(); mebulb.refreshSelection(); }, sk.link);

  // ---- grey area: drag a markup off the sheet, pick it up again, draw and marquee from the grey area
  await ev(() => { mebulb.setZoom(0.5); mebulb.goToPage(0); });
  await page.waitForTimeout(300);
  const rc = await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); const m = { id: 'PM-g9', type: 'rect', page: 0, pts: [[60, 300], [160, 380]], style: { stroke: '#d9480f', width: 2, opacity: 1, dash: 'solid' }, subject: 'Rectangle', author: 'T', created: now, modified: now }; d.markups.push(m); mebulb.renderAllMarks(d); mebulb.setTool('select'); const r = d.pageEls[0].getBoundingClientRect(); return { left: r.left }; });
  const a0 = await P(110, 300); await dragC(a0, [rc.left - 140, a0[1]], [], 8); await page.waitForTimeout(300);
  let g = await get('PM-g9');
  ok(g.pts[1][0] < 0, `rectangle dragged off the sheet into the grey area (right edge at x ${g.pts[1][0].toFixed(0)} pt)`);
  await ev(() => { mebulb.state.sel.clear(); mebulb.refreshSelection(); });
  const gc = await P((g.pts[0][0] + g.pts[1][0]) / 2, g.pts[0][1]);
  await page.mouse.click(gc[0], gc[1]); await page.waitForTimeout(100);
  ok(await ev(() => mebulb.state.sel.has('PM-g9')), 'a markup in the grey area can be clicked and selected');
  await dragC(gc, [gc[0] - 30, gc[1] + 40]); g = await get('PM-g9');
  ok(g.pts[0][1] > 300 && g.pts[1][0] < 0, 'and moved about out there');
  // marquee from the grey area
  await ev(() => { mebulb.state.sel.clear(); mebulb.refreshSelection(); });
  const ga = await P(g.pts[0][0] - 30, g.pts[0][1] - 30), gb = await P(g.pts[1][0] + 20, g.pts[1][1] + 30);
  await dragC(ga, gb); ok(await ev(() => mebulb.state.sel.has('PM-g9')), 'a window drawn from the grey area selects it');
  // draw a line that starts in the grey area
  await ev(() => mebulb.setTool('line')); const n0 = await ev(() => mebulb.activeDoc().markups.length);
  const la = await P(-60, 700), lb = await P(200, 700); await dragC(la, lb);
  const ln = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; return { n: d.markups.length, type: m.type, page: m.page, x0: m.pts[0][0] }; });
  ok(ln.n === n0 + 1 && ln.type === 'line' && ln.page === 0 && ln.x0 < -40, `a line can start in the grey area (from x ${ln.x0.toFixed(0)} pt)`);
  await page.keyboard.press('Escape'); await ev(() => mebulb.setTool('select'));
  const pad = await ev(() => getComputedStyle(document.querySelector('#pages')).paddingLeft);
  ok(parseFloat(pad) > 50, 'the grey margin grows to keep markups parked off the sheet in view: ' + pad);
  // single page view: drag well past the window edge, the view scrolls and makes room
  await ev(() => { mebulb.setPageMode('single'); mebulb.setZoom(1.4); mebulb.goToPage(0, [300, 400]); });
  await page.waitForTimeout(300);
  await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); d.markups.push({ id: 'PM-g10', type: 'rect', page: 0, pts: [[250, 380], [330, 440]], style: { stroke: '#2b8a3e', width: 2, opacity: 1, dash: 'solid' }, subject: 'Rectangle', author: 'T', created: now, modified: now }); mebulb.renderAllMarks(d); mebulb.setTool('select'); });
  const vr = await ev(() => { const r = document.querySelector('#viewer').getBoundingClientRect(); return [r.left, r.top]; });
  const b0 = await P(290, 380); await page.mouse.move(b0[0], b0[1]); await page.mouse.down(); await page.mouse.move(b0[0] - 50, b0[1], { steps: 3 });
  await page.mouse.move(vr[0] + 4, b0[1], { steps: 6 }); await page.waitForTimeout(1600); await page.mouse.up(); await page.waitForTimeout(300);
  const g10 = await get('PM-g10');
  ok(g10.pts[1][0] < -20, `held at the window edge, the view scrolls into the grey area and the markup goes past the sheet (x ${g10.pts[0][0].toFixed(0)}…${g10.pts[1][0].toFixed(0)} pt)`);
  await page.screenshot({ path: OUT + '/r9-grey.png' });
  await ev(() => { mebulb.setPageMode('continuous'); const d = mebulb.activeDoc(); d.markups = d.markups.filter((m) => !['PM-g9', 'PM-g10'].includes(m.id) && !(m.type === 'line' && m.pts[0][0] < -40)); mebulb.renderAllMarks(d); mebulb.setZoom(1); mebulb.goToPage(0, [700, 300]); });
  await page.waitForTimeout(300);

  // ---- recovery copy (browser: local storage) and adjustable autosave
  const bytes = await ev(async () => Array.from(await mebulb.buildPdf(mebulb.activeDoc(), {})));
  const opened = await ev(async (b) => { const d = await mebulb.openBytes('Recovery test.pdf', new Uint8Array(b)); return { id: d.id, sample: d.sample, n: d.markups.length }; }, bytes);
  await page.waitForTimeout(500);
  await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); mebulb.markDirty(d); d.markups.push({ id: 'PM-rec1', type: 'rect', page: 0, pts: [[300, 300], [420, 380]], style: { stroke: '#c2255c', width: 3, opacity: 1, dash: 'solid' }, subject: 'Rectangle', author: 'T', created: now, modified: now }); d.markups = d.markups.filter((m) => m.id !== d.markups[0].id || m.id === 'PM-rec1'); mebulb.renderAllMarks(d); });
  await page.waitForTimeout(3500);
  const kept = await ev(() => Object.keys(localStorage).filter((k) => k.startsWith('planmark:rec:')).length);
  const badge = await ev(() => document.querySelector('#save-badge').textContent);
  ok(kept === 1 && /Recovery copy/.test(badge), `a recovery copy is kept a few seconds after a change (status bar: "${badge}")`);
  // MeBulb stops without saving: the document simply disappears (no close, no clearing)
  await ev((id) => { const S = mebulb.state; S.docs = S.docs.filter((d) => d.id !== id); S.activeId = S.docs[0].id; }, opened.id);
  await ev((b) => { mebulb.openBytes('Recovery test.pdf', new Uint8Array(b)); }, bytes);
  await page.waitForSelector('#modal', { state: 'visible' }); const dlg = await ev(() => document.querySelector('#modal').textContent.replace(/\s+/g, ' '));
  ok(/Recover unsaved work\?/.test(dlg) && /1 added/.test(dlg) && /1 deleted/.test(dlg) && !/scales/.test(dlg), 'reopening the PDF offers the work back: ' + (dlg.match(/from .*?\./) || [''])[0]);
  await page.click('#modal footer button:has-text("Recover")'); await page.waitForTimeout(300);
  const rec = await ev((n0) => { const d = mebulb.activeDoc(); return { has: d.markups.some((m) => m.id === 'PM-rec1'), n: d.markups.length, dirty: d.dirty }; }, opened.n);
  ok(rec.has && rec.n === opened.n && rec.dirty, `Recover puts the new markup back and the deleted one stays deleted (${rec.n} markups, unsaved)`);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  ok(await ev(() => !mebulb.activeDoc().markups.some((m) => m.id === 'PM-rec1')), 'and Ctrl+Z takes the recovery back out');
  await page.keyboard.press('Control+y'); await page.waitForTimeout(200);
  // the list in File > Recover unsaved work
  await page.waitForTimeout(3000);
  await ev(() => mebulb.recoveryDialog()); await page.waitForSelector('#modal .rec-row');
  const rows = await ev(() => [...document.querySelectorAll('#modal .rec-row')].map((r) => r.textContent.replace(/\s+/g, ' ')));
  ok(rows.length === 1 && /Recovery test\.pdf/.test(rows[0]) && /open now/.test(rows[0]), 'File ▸ Recover unsaved work lists it: ' + rows[0]);
  await page.click('#modal footer .btn.primary');
  // Close without saving removes the copy, so it is not offered again
  await ev(() => { const d = mebulb.activeDoc(); mebulb.closeDoc(d.id); }); await page.waitForSelector('#modal', { state: 'visible' }); await page.click('#modal footer .btn.danger, #modal footer .btn.primary'); await page.waitForTimeout(400);
  ok(await ev(() => Object.keys(localStorage).filter((k) => k.startsWith('planmark:rec:')).length) === 0, 'closing without saving removes the recovery copy');
  // autosave interval from the status bar
  await page.click('#save-badge'); await page.waitForTimeout(100);
  const menu = await ev(() => [...document.querySelectorAll('#ctx button')].map((b) => b.textContent));
  ok(menu.some((t) => /Recover unsaved work/.test(t)), 'status bar badge opens recovery options: ' + menu.join(' | '));
  await page.keyboard.press('Escape'); await ev(() => { document.querySelector('#ctx').hidden = true; });
  await ev(() => mebulb.runCommand('file.autosave')); await page.waitForSelector('#modal select[name=autosavePdf]');
  const opts = await ev(() => [...document.querySelectorAll('#modal select[name=autosavePdf] option')].map((o) => o.textContent));
  await page.selectOption('#modal select[name=autosavePdf]', '10'); await page.click('#modal footer .btn.primary'); await page.waitForTimeout(150);
  ok(opts.length === 7 && opts[0] === 'Off' && await ev(() => mebulb.state.prefs.autosavePdf === 10), 'Preferences: autosave Off or every 1 to 30 minutes (' + opts.join(', ') + '), set to 10');

  // ---- risers to ducts: out of the long face; a narrower face gets a transition
  await ev(() => { mebulb.setZoom(0.7); mebulb.goToPage(1, [800, 700]); });
  await page.waitForTimeout(300);
  const mkR = `(id, page, x, y, name, w = 600, h = 300) => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); const m = { id, type: 'sketch', page, pts: [[x, y]], sz: { shape: 'rect', w: w / 25.4, h: h / 25.4 }, rot: 0, name, text: '', style: { stroke: '#1f5fd1', width: 1.25, fill: '#1f5fd1', fillOpacity: 0.07, fontSize: 9, fontColor: '#1f5fd1', symbol: 'x', showLabel: true, showName: true, showSize: true }, subject: 'Sketch rectangle', author: 'T', created: now, modified: now }; d.markups.push(m); return m; }`;
  const rt = await ev(async (mk) => { const mkR = eval(mk); const d = mebulb.activeDoc(); const a = mkR('PM-ra9', 1, 420, 1040, 'M9'), b = mkR('PM-rb9', 1, 1180, 760, 'M9'); mebulb.renderAllMarks(d);
    const k = 1 / (25.4 * 0.6944444444444444); const best = await mebulb.connectRisers(d, a, b, 'best'); const across = await mebulb.connectRisers(d, a, b, 'across'); d.markups.push(best, across); mebulb.renderAllMarks(d);
    const seg = (m) => ({ a: m.pts[0], b: m.pts[1], vert: Math.abs(m.pts[0][0] - m.pts[1][0]) < 0.6, n: m.pts.length, trans: m.duct.trans || null, last: m.pts[m.pts.length - 1] });
    return { best: seg(best), across: seg(across), ids: [best.id, across.id], hh: 150 * k, hw: 300 * k }; }, mkR);
  ok(rt.best.vert && Math.abs(rt.best.a[0] - 420) < 0.6 && Math.abs(Math.abs(rt.best.a[1] - 1040) - rt.hh) < 0.6 && !rt.best.trans, `a 600×300 riser feeds its 600×300 duct out of the 600 wide face: the duct starts on that face and runs square to it (${rt.best.n - 1} runs)`);
  ok(Math.abs(Math.abs(rt.best.last[1] - 760) - rt.hh) < 0.6, 'and arrives square to the long face of the other riser');
  ok(!rt.across.vert && Math.abs(Math.abs(rt.across.a[0] - 420) - rt.hw) < 0.6 && rt.across.trans && rt.across.trans[0] && rt.across.trans[0].w === 300 && rt.across.trans[0].h === 600, `routed across first, it leaves the 300 face with a transition 300×600 → 600×300 (${rt.across.trans && rt.across.trans[0] && rt.across.trans[0].len} mm long)`);
  const trTxt = await ev((id) => document.querySelector(`g.mk[data-id="${id}"]`).textContent, rt.ids[1]);
  ok(/TRANSITION 300×600 → 600×300/.test(trTxt), 'the transition is drawn and labelled on the plan');
  await page.screenshot({ path: OUT + '/r9-riser-ducts.png' });
  await ev(() => { mebulb.setZoom(3.2); mebulb.goToPage(1, [445, 1025]); }); await page.waitForTimeout(500); await page.screenshot({ path: OUT + '/r9-transition-zoom.png' });
  await ev(() => { mebulb.setZoom(0.7); mebulb.goToPage(1, [800, 700]); }); await page.waitForTimeout(300);

  // ---- grilles flush in a duct: side, underside, linear slots
  const fg = await ev((id) => { const d = mebulb.activeDoc(); const du = d.markups.find((x) => x.id === id); const G = mebulb.grilleDefaults(); Object.assign(G, { mount: 'side', kind: 'return', w: 600, h: 200 });
    let bi = 1, bl = 0; for (let i = 1; i < du.pts.length; i++) { const l = Math.hypot(du.pts[i][0] - du.pts[i - 1][0], du.pts[i][1] - du.pts[i - 1][1]); if (l > bl) { bl = l; bi = i; } } const p = du.pts[bi - 1], q = du.pts[bi]; const L = bl || 1; const n = [-(q[1] - p[1]) / L, (q[0] - p[0]) / L]; return [(p[0] + q[0]) / 2 + n[0] * 9, (p[1] + q[1]) / 2 + n[1] * 9, bi]; }, rt.ids[0]);
  await ev(() => mebulb.setTool('grille')); await click(fg[0], fg[1], [], 1); await page.waitForTimeout(150);
  const sg = await ev(([id, bi]) => { const d = mebulb.activeDoc(); const g = d.markups.filter((x) => x.type === 'grille').pop(); const gg = mebulb.grilleGeom(d, g); const du = d.markups.find((x) => x.id === id); const p = du.pts[bi - 1], q = du.pts[bi]; const L = Math.hypot(q[0] - p[0], q[1] - p[1]); const off = Math.abs((q[0] - p[0]) * (gg.c[1] - p[1]) - (q[1] - p[1]) * (gg.c[0] - p[0])) / L; return { on: g.on === id, mount: gg.mount, side: g.side, tag: g.tag, hh: gg.hh, off, id: g.id }; }, [rt.ids[0], fg[2]]);
  ok(sg.on && sg.mount === 'side' && sg.tag === 'RG-01' && Math.abs(sg.off - (rt.hw - sg.hh)) < 0.8, `grille tool on the side of a duct: a return grille flush in that side (${sg.tag}), drawn in the duct wall`);
  await ev((id) => { const d = mebulb.activeDoc(); mebulb.setTool('select'); const S = mebulb.state; S.sel.clear(); S.sel.add(id); mebulb.refreshSelection(); mebulb.openPanel('props'); }, sg.id); await page.waitForTimeout(150);
  const mopts = await ev(() => [...document.querySelectorAll('#props select[data-k="gr.mount"] option')].map((o) => o.value));
  ok(mopts.join() === 'ceiling,side,bottom', 'mounting choices on a duct: ceiling diffuser, flush in the side, flush in the underside');
  await page.click('#props [data-act="grille-side"]'); await page.waitForTimeout(100);
  ok(await ev((id) => mebulb.activeDoc().markups.find((x) => x.id === id).side, sg.id) === -sg.side, '"Other side of the duct" moves it across');
  await page.selectOption('#props select[data-k="gr.kind"]', 'linear'); await page.waitForTimeout(100); await page.selectOption('#props select[data-k="gr.mount"]', 'bottom'); await page.waitForTimeout(150);
  const bt = await ev((id) => { const d = mebulb.activeDoc(); const g = d.markups.find((x) => x.id === id); return { mount: mebulb.grilleGeom(d, g).mount, dashed: [...document.querySelectorAll(`g.mk[data-id="${id}"] path`)].filter((p) => p.getAttribute('stroke-dasharray')).length, fa: mebulb.grilleFA(g.gr) }; }, sg.id);
  ok(bt.mount === 'bottom' && bt.dashed >= 2 && Math.abs(bt.fa - 0.6 * 0.05 * 0.7) < 1e-6, `linear slots in the underside: dashed on plan (hidden below), free area from 2 slots × 25 mm (${bt.fa.toFixed(3)} m²)`);
  await ev((id) => mebulb.startSectionPlace(mebulb.activeDoc().markups.find((x) => x.id === id)), sg.id); await click(1500, 300, [], 1); await page.waitForTimeout(150);
  const fsec = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.filter((x) => x.type === 'section').pop(); return document.querySelector(`g.mk[data-id="${m.id}"]`).textContent; });
  ok(/FLUSH IN THE UNDERSIDE OF THE 600×300/.test(fsec) && /2 SLOTS × 25 mm/.test(fsec), 'its section view shows the duct with the slots in its underside');

  // ---- riser grilles on every floor, and the riser section through the floors
  await ev(() => { mebulb.setZoom(0.8); mebulb.goToPage(0, [1250, 1000]); });
  await page.waitForTimeout(300);
  const sp = await ev((mk) => { const mkR = eval(mk); const d = mebulb.activeDoc(); const r = mkR('PM-sp9', 0, 1250, 1050, 'SP1', 800, 400); mebulb.placeOnPages(d, r, [0, 1, 2, 3]); mebulb.renderAllMarks(d); const G = mebulb.grilleDefaults(); Object.assign(G, { kind: 'supply', mount: 'ceiling', w: 600, h: 400, fa: 60, q: 300 }); const k = 1 / (25.4 * 0.6944444444444444); return { link: r.link, hh: 200 * k }; }, mkR);
  await ev(() => mebulb.setTool('grille')); await click(1250 + 10, 1050 + sp.hh, [], 0); await page.waitForTimeout(150);
  const rg = await ev(() => { const d = mebulb.activeDoc(); const g = d.markups.filter((x) => x.type === 'grille').pop(); const gg = mebulb.grilleGeom(d, g); const r = d.markups.find((x) => x.id === g.on); return { id: g.id, on: r && r.type, face: g.face, mount: gg.mount, kind: g.gr.kind, tag: g.tag, t: g.t, z: g.gr.z }; });
  ok(rg.on === 'sketch' && rg.mount === 'riser' && rg.face === 1 && rg.kind === 'spa' && rg.tag === 'SPG-01', `grille tool on the riser outline: ${rg.tag}, a stair pressurisation grille flush in the riser's 800 wide wall`);
  await ev((id) => { const S = mebulb.state; mebulb.setTool('select'); S.sel.clear(); S.sel.add(id); mebulb.refreshSelection(); mebulb.openPanel('props'); }, rg.id); await page.waitForTimeout(150);
  ok(await ev(() => !!document.querySelector('#props input[data-k="gr.z"]')), 'a riser grille has a height to its underside for the section');
  await page.click('#props [data-act="grille-floors"]'); await page.waitForTimeout(200);
  const fl = await ev((link) => { const d = mebulb.activeDoc(); const ids = new Set(d.markups.filter((x) => x.link === link).map((x) => x.id)); return d.markups.filter((g) => g.type === 'grille' && ids.has(g.on)).map((g) => g.page).sort(); }, sp.link);
  ok(fl.join() === '0,1,2,3', 'Put it on every floor: the grille on all 4 floors of the riser');
  // drag it along the wall
  const gc0 = await ev((id) => mebulb.activeDoc().markups.find((x) => x.id === id).pts[0], rg.id); const gp = await P(gc0[0], gc0[1], 0); await dragC(gp, [gp[0] - 30, gp[1] + 25]);
  const slid = await ev((id) => { const g = mebulb.activeDoc().markups.find((x) => x.id === id); return { face: g.face, t: g.t, on: g.on }; }, rg.id);
  ok(slid.face === 1 && Math.abs(slid.t - rg.t) > 0.2 && slid.on, `dragging it slides it along the riser wall (${(rg.t * 100).toFixed(0)}% → ${(slid.t * 100).toFixed(0)}%)`);
  // the riser section
  await ev(() => { const d = mebulb.activeDoc(); const r = d.markups.find((x) => x.id === 'PM-sp9'); mebulb.startSectionPlace(r); }); await click(1600, 700, [], 0); await page.waitForTimeout(200);
  const rs = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.filter((x) => x.type === 'section').pop(); return { id: m.id, of: m.of, scale: m.scale, face: mebulb.riserViewFace(d, m), text: [...document.querySelectorAll(`g.mk[data-id="${m.id}"] text`)].map((t) => t.textContent).join(' | ') }; });
  ok(rs.scale === 100 && rs.face === 1 && /SP1 · RISER THROUGH 4 FLOORS/.test(rs.text) && (rs.text.match(/SPG-01 600×400/g) || []).length === 4 && /RL \+3\.300/.test(rs.text) && /ROOF/.test(rs.text), 'riser section at 1:100 through 4 floors, looking at the wall with the grilles: levels, RLs, the grille on each floor');
  ok(await ev(() => { const d = mebulb.activeDoc(); return d.markups.filter((x) => x.link && x.type === 'sketch' && x.name !== 'M9').every((x) => !x.link || [...document.querySelectorAll(`g.mk[data-id="${x.id}"] text`)].length >= 0); }), 'cut marker shown on the riser');
  await ev((id) => { const S = mebulb.state; S.sel.clear(); S.sel.add(id); mebulb.refreshSelection(); mebulb.openPanel('props'); }, rs.id); await page.waitForTimeout(150);
  await page.selectOption('#props select[data-k="sec.flow"]', 'up'); await page.waitForTimeout(150);
  await page.fill('#props input[data-k="sec.lvname.0"]', 'Ground'); await page.press('#props input[data-k="sec.lvname.0"]', 'Enter'); await page.waitForTimeout(150);
  const rs2 = await ev((id) => [...document.querySelectorAll(`g.mk[data-id="${id}"] text`)].map((t) => t.textContent).join(' | '), rs.id);
  ok(/GROUND\b/.test(rs2) && /1200 L\/s/.test(rs2) && /300 L\/s/.test(rs2), 'air going up: the riser carries 1200 L/s at the bottom floor and 300 L/s at the top; level names editable');
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); mebulb.goToPage(0, [m.pts[0][0] + 250, m.pts[0][1] + 300]); }, rs.id); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/r9-riser-section.png' });
  await ev((id) => { const d = mebulb.activeDoc(); const el = document.querySelector(`g.mk[data-id="${id}"]`); const b = el.getBBox(); mebulb.setZoom(Math.min(1050 / b.width, 760 / b.height)); mebulb.goToPage(0, [b.x + b.width / 2, b.y + b.height / 2]); mebulb.state.sel.clear(); mebulb.refreshSelection(); }, rs.id); await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + '/r9-riser-section-zoom.png' });
  await ev((id) => { const d = mebulb.activeDoc(); const r = d.markups.find((x) => x.id === 'PM-sp9'); mebulb.setZoom(4); mebulb.goToPage(0, r.pts[0]); }); await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/r9-riser-plan-zoom.png' });

  // ---- ductulator
  const dc = await ev(() => { const c = mebulb.ductCalc(300, { shape: 'rect', w: 400, h: 200 }); const r = mebulb.ductCalc(300, { shape: 'round', d: 300 }); return { v: c.v, pa: c.pa, dh: c.dh, rv: r.v, rpa: r.pa }; });
  ok(Math.abs(dc.v - 3.75) < 1e-9 && dc.pa > 0.6 && dc.pa < 0.72 && Math.abs(dc.dh - 266.7) < 0.1, `300 L/s in 400×200: ${dc.v.toFixed(2)} m/s, ${dc.pa.toFixed(2)} Pa/m (Dh ${dc.dh.toFixed(0)} mm)`);
  ok(dc.rpa > 0.68 && dc.rpa < 0.76, `300 L/s in Ø300: ${dc.rv.toFixed(2)} m/s, ${dc.rpa.toFixed(2)} Pa/m`);
  await ev(() => mebulb.runCommand('duct.calc')); await page.waitForTimeout(300);
  ok(await ev(() => document.querySelector('#ductwork .seg-tab.on').textContent) === 'Ductulator', 'Mechanical ▸ Ductulator opens the calculator tab of the Mechanical panel');
  const Q = '#ductwork .aircard';
  await page.fill(`${Q} [data-air="w"]`, '400'); await page.press(`${Q} [data-air="w"]`, 'Tab'); await page.waitForTimeout(120); await page.fill(`${Q} [data-air="h"]`, '200'); await page.press(`${Q} [data-air="h"]`, 'Tab'); await page.waitForTimeout(120);
  await page.fill(`${Q} [data-air="q"]`, '900'); await page.waitForTimeout(120); // live, before the value is committed
  const calc = await ev(() => { const c = document.querySelector('#ductwork .aircard'); return { tiles: [...c.querySelectorAll('.air-tile')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()), over: c.querySelectorAll('.air-tile.over').length, sugg: [...c.querySelectorAll('[data-air-set] b')].map((b) => b.textContent), cap: (c.querySelector('.air-cap') || {}).textContent || '' }; });
  ok(calc.over === 2 && /Over 1 Pa\/m/.test(calc.tiles[1]) && /Over 6 m\/s/.test(calc.tiles[0]) && calc.sugg.length >= 3 && /carries up to \d+ L\/s/.test(calc.cap), `Ductulator updates as you type: 900 L/s in 400×200 (supply, 6 m/s) → ${calc.tiles.join(' | ')}; sizes that fit: ${calc.sugg.join(', ')}`);
  const sgOk = await ev(() => { const pa = (z) => mebulb.ductCalc(900, z).pa; return mebulb.sizeChoices(900, { shape: 'rect', w: 400, h: 200 }, 0.09).every((x) => { const z = x.size; if (z.shape === 'round') return pa(z) <= 1 && pa({ shape: 'round', d: z.d - 50 }) > 1; return pa(z) <= 1 && (pa({ ...z, w: z.w - 50 }) > 1 || pa({ ...z, h: z.h - 50 }) > 1); }); });
  ok(sgOk, 'each size offered is the smallest that meets the limit');
  ok(await ev(() => { const a = mebulb.ductCalc(900, { shape: 'rect', w: 600, h: 400 }).pa, b = mebulb.ductCalc(900, { shape: 'rect', w: 600, h: 400 }, { eps: 3 }).pa; const q = mebulb.maxFlow({ shape: 'rect', w: 400, h: 200 }, 0.09); const c = mebulb.ductCalc(q, { shape: 'rect', w: 400, h: 200 }); return b > a * 1.5 && Math.abs(c.pa - 1) < 0.01; }), 'a rough concrete shaft loses more than galvanised duct; the capacity shown is the flow at exactly the limit');
  await page.press(`${Q} [data-air="q"]`, 'Tab'); await page.waitForTimeout(150); await page.click(`${Q} [data-air-set]`); await page.waitForTimeout(200);
  ok(await ev(() => !document.querySelector('#ductwork .air-tile.over') && !!document.querySelector('#ductwork .air-chip.cur')), 'picking an offered size puts it in the calculator and clears the warning');
  // the same card sizes a riser: airflow beside width and height, velocity and Pa/m under them
  await ev(() => { const d = mebulb.activeDoc(); const r = d.markups.find((x) => x.id === 'PM-ra9'); const S = mebulb.state; mebulb.setTool('select'); S.sel.clear(); S.sel.add(r.id); mebulb.refreshSelection(); mebulb.openPanel('props'); mebulb.goToPage(1, r.pts[0]); }); await page.waitForTimeout(300);
  const RC = '#props .aircard[data-ctx="riser"]';
  await page.fill(`${RC} [data-air="q"]`, '1500'); await page.waitForTimeout(120);
  const live = await ev(() => [...document.querySelectorAll('#props .aircard .air-tile')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()));
  await page.press(`${RC} [data-air="q"]`, 'Enter'); await page.waitForTimeout(300);
  const rz = await ev(() => { const d = mebulb.activeDoc(); const r = d.markups.find((x) => x.id === 'PM-ra9'); return { q: r.q, plan: document.querySelector('g.mk[data-id="PM-ra9"]').textContent, head: document.querySelector('#props .measure-readout').textContent, over: document.querySelectorAll('#props .aircard .air-tile.over').length, bar: document.querySelector('#propbar .pb-air').textContent, chips: [...document.querySelectorAll('#props .aircard [data-air-set]')].map((b) => b.textContent) }; });
  ok(/8\.33 m\/s/.test(live[0]) && /Pa\/m/.test(live[1]) && rz.q === 1500 && rz.over === 2 && /1500 L\/s · 8\.3 m\/s · [\d.]+ Pa\/m !/.test(rz.plan) && /8\.3 m\/s · [\d.]+ Pa\/m/.test(rz.bar), `riser 600×300 with 1500 L/s (supply, over 6 m/s and 1 Pa/m): ${live.join(' | ')}; on the plan label and the property bar too`);
  await page.click(`${RC} [data-air-set^="rect:600:"]`); await page.waitForTimeout(300);
  const rz2 = await ev(() => { const d = mebulb.activeDoc(); const r = d.markups.find((x) => x.id === 'PM-ra9'); return { w: Math.round(r.sz.w * 25.4), h: Math.round(r.sz.h * 25.4), over: document.querySelectorAll('#props .aircard .air-tile.over').length, plan: document.querySelector('g.mk[data-id="PM-ra9"]').textContent }; });
  ok(rz2.w === 600 && rz2.h > 300 && rz2.over === 0 && !/ !/.test(rz2.plan), `picking "keeps the 600 width" resizes the riser to ${rz2.w}×${rz2.h} and the warning goes`);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200); ok(await ev(() => Math.round(mebulb.activeDoc().markups.find((x) => x.id === 'PM-ra9').sz.h * 25.4)) === 300, 'Ctrl+Z puts the size back');
  await ev(() => { const d = mebulb.activeDoc(); const r = d.markups.find((x) => x.id === 'PM-ra9'); r.q = null; mebulb.renderAllMarks(d); });
  // a duct with too much air shows it on the plan and in its properties
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); m.duct = { ...m.duct, q: 1400 }; mebulb.renderAllMarks(d); const S = mebulb.state; S.sel.clear(); S.sel.add(id); mebulb.refreshSelection(); mebulb.openPanel('props'); mebulb.goToPage(1, m.pts[1]); }, rt.ids[0]); await page.waitForTimeout(250);
  const over = await ev((id) => ({ lab: document.querySelector(`g.mk[data-id="${id}"]`).textContent, warn: [...document.querySelectorAll('#props .aircard .air-tile.over')].map((t) => t.textContent).join(' | '), chips: [...document.querySelectorAll('#props .aircard [data-air-set] b')].map((b) => b.textContent), head: !!document.querySelector('#props .measure-readout.over') }), rt.ids[0]);
  ok(/1400 L\/s · [\d.]+ m\/s · [\d.]+ Pa\/m !/.test(over.lab) && /Over 1 Pa\/m/.test(over.warn) && over.chips.length >= 2 && over.head, 'a duct over the limit: flagged in its label and properties with sizes to pick: ' + over.chips.join(', '));
  await page.screenshot({ path: OUT + '/r9-ductulator.png' });

  // ---- everything goes into the PDF and comes back
  const rt2 = await ev(async () => { const d = mebulb.activeDoc(); const n0 = d.markups.length; const b = await mebulb.buildPdf(d, {}); const d2 = await mebulb.openBytes('Round trip.pdf', b); const g = d2.markups.filter((m) => m.type === 'grille' && m.gr && m.gr.mount === 'riser'); const du = d2.markups.find((m) => m.duct && m.duct.trans && m.duct.trans[0]); const sec = d2.markups.filter((m) => m.type === 'section'); return { n0, n: d2.markups.length, riserG: g.length, face: g[0] && g[0].face, trans: du && du.duct.trans[0].w, secs: sec.length, bytes: b.length }; });
  ok(rt2.n === rt2.n0 && rt2.riserG === 4 && rt2.face === 1 && rt2.trans === 300 && rt2.secs >= 2, `saved and reopened: ${rt2.n} markups, riser grilles keep their wall, the transition and the sections (${Math.round(rt2.bytes / 1024)} KB)`);

  //@@REST@@

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
})();
