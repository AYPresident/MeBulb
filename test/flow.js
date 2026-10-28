// End-to-end interaction test: every tool, editing, scale, save round trip, page ops.
const { launch } = require('./harness');
const fs = require('fs');
const OUT = '/home/claude/planmark/test/out'; fs.mkdirSync(OUT, { recursive: true });
const stub = () => {
  window.__saves = [];
  window.showSaveFilePicker = async (o) => ({ createWritable: async () => ({ write: async (b) => { const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); window.__saves.push({ name: o.suggestedName, b64: btoa(s) }); }, close: async () => {} }) });
};
(async () => {
  const { browser, page, errors } = await launch({ init: stub, viewport: { width: 1440, height: 1200 } });
  const results = []; try {
  const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const doc = () => ev(() => { const d = planmark.activeDoc(); return { n: d.markups.length, last: d.markups[d.markups.length - 1], pages: d.numPages, zoom: d.zoom }; });
  const P = async (x, y0, i = 0) => { const y = y0 - 110; return ev(([i, x, y]) => { const d = planmark.activeDoc(); const r = d.pageEls[i].getBoundingClientRect(); return [r.left + x * d.zoom, r.top + y * d.zoom]; }, [i, x, y]); };
  const click = async (x, y, opts) => { const [cx, cy] = await P(x, y); await page.mouse.click(cx, cy, opts); await page.waitForTimeout(40); };
  const drag = async (x1, y1, x2, y2, steps = 6) => { const a = await P(x1, y1), b = await P(x2, y2); await page.mouse.move(a[0], a[1]); await page.mouse.down(); for (let k = 1; k <= steps; k++) await page.mouse.move(a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps); await page.mouse.up(); await page.waitForTimeout(60); };
  const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(40); };
  const near = (a, b, t = 1.5) => Math.abs(a - b) <= t;
  const measure = () => ev(() => { const d = planmark.activeDoc(); const m = d.markups[d.markups.length - 1]; return planmark.measureInfo(m, d); });

  // position: zoom 1, show page area x 250.., y 620..
  await ev(() => { planmark.setZoom(1); const d = planmark.activeDoc(); const v = document.getElementById('viewer'); v.scrollTop = d.pageEls[0].offsetTop + 490; v.scrollLeft = d.pageEls[0].offsetLeft + 200; });
  await page.waitForTimeout(400);
  await ev(() => { planmark.state.snapMarkup = false; planmark.state.snapContent = false; planmark.setUnits('ftin'); const d = planmark.activeDoc(); for (let i = 0; i < d.numPages; i++) d.scales[i] = planmark.presetScale(`1/4" = 1'-0"`); planmark.renderAllMarks(); });
  let base = (await doc()).n;

  await key('r'); await drag(300, 650, 400, 720); let d = await doc();
  ok('rectangle', d.n === base + 1 && d.last.type === 'rect' && near(d.last.pts[0][0], 300) && near(d.last.pts[1][1], 610), JSON.stringify(d.last.pts)); base = d.n;
  ok('tool reverts to select', await ev(() => planmark.state.tool === 'select'));
  await key('e'); await drag(420, 650, 500, 720); d = await doc(); ok('ellipse', d.n === base + 1 && d.last.type === 'ellipse'); base = d.n;
  await key('l'); await click(520, 650); await click(600, 700); d = await doc(); ok('line click-click', d.n === base + 1 && d.last.type === 'line' && near(d.last.pts[1][0], 600)); base = d.n;
  await key('a'); await drag(620, 650, 700, 700); d = await doc(); ok('arrow drag', d.n === base + 1 && d.last.type === 'arrow' && d.last.style.arrowEnd === 'arrow'); base = d.n;
  await key('Shift+P'); await click(300, 760); await click(380, 760); await click(340, 820); const [gx, gy] = await P(340, 820); await page.mouse.dblclick(gx, gy); await page.waitForTimeout(60);
  d = await doc(); ok('polygon', d.n === base + 1 && d.last.type === 'polygon' && d.last.pts.length === 3, 'pts=' + (d.last.pts || []).length); base = d.n;
  await key('c'); await drag(420, 760, 520, 830); d = await doc(); ok('cloud box drag', d.n === base + 1 && d.last.type === 'cloud' && d.last.pts.length === 4 && d.last.style.cloud === true, 'pts=' + d.last.pts.length); base = d.n;
  await key('p'); await drag(540, 760, 640, 830, 20); d = await doc(); ok('pen', d.n === base + 1 && d.last.type === 'pen' && d.last.pts.length >= 2); base = d.n;
  await key('t'); await click(660, 760); await page.waitForSelector('.txt-edit'); await page.keyboard.type('Check this dimension'); await key('Escape');
  d = await doc(); ok('text box', d.n === base + 1 && d.last.type === 'text' && d.last.text === 'Check this dimension', JSON.stringify(d.last.text)); base = d.n;
  await key('q'); await drag(300, 880, 360, 860); await page.waitForSelector('.txt-edit'); await page.keyboard.type('Callout note'); await click(900, 1000);
  d = await doc(); ok('callout', d.n === base + 1 && d.last.type === 'callout' && d.last.text === 'Callout note'); base = d.n;
  await key('n'); await click(480, 880); await page.waitForTimeout(80); const focused = await ev(() => document.activeElement && document.activeElement.id); await page.keyboard.type('Sticky'); await page.keyboard.press('Tab');
  d = await doc(); ok('note + comment', d.n === base + 1 && d.last.type === 'note' && d.last.comment === 'Sticky', 'focus=' + focused); base = d.n;
  await ev(() => document.getElementById('viewer').focus()); await key('s'); await click(600, 900); d = await doc(); ok('stamp', d.n === base + 1 && d.last.type === 'stamp' && d.last.text === 'APPROVED'); base = d.n;

  // measurements (sample page scale: 1/4" = 1'-0" => 18 pt per ft)
  await key('Shift+Alt+L'); await click(300, 960); await click(480, 960); d = await doc(); let mi = await measure(); ok('length 10 ft', d.last.type === 'length' && mi.text === `10'-0"`, mi.text); base = d.n;
  await key('Shift+Alt+A'); for (const [x, y] of [[520, 940], [610, 940], [610, 1030]]) await click(x, y); { const [x, y] = await P(520, 1030); await page.mouse.dblclick(x, y); } await page.waitForTimeout(60);
  mi = await measure(); ok('area 25 sf', mi.text === '25.00 sf', mi.text); base = (await doc()).n;
  await key('Shift+Alt+P'); for (const [x, y] of [[640, 940], [820, 940], [820, 1120]]) await click(x, y); { const [x, y] = await P(640, 1120); await page.mouse.dblclick(x, y); } await page.waitForTimeout(60);
  mi = await measure(); ok('perimeter 40 ft', mi.text === `40'-0"`, mi.text);
  await key('Shift+Alt+V'); for (const [x, y] of [[300, 1000], [480, 1000], [480, 1180]]) await click(x, y); await click(300, 1180); await key('Enter');
  mi = await measure(); ok('volume 100sf x 6in', mi.text === '1.85 cy', mi.text + ' / ' + mi.sub);
  await key('Shift+Alt+C'); for (const [x, y] of [[850, 960], [880, 960], [910, 960]]) await click(x, y); await key('Enter');
  d = await doc(); ok('count 3', d.last.type === 'count' && d.last.pts.length === 3, 'pts=' + d.last.pts.length);
  await key('Shift+Alt+G'); for (const [x, y] of [[860, 1000], [860, 1080], [940, 1080]]) await click(x, y); await page.waitForTimeout(60);
  mi = await measure(); ok('angle 90', mi.text === '90.0°', mi.text);
  await key('Shift+Alt+U'); await drag(300, 1250, 336, 1250); mi = await measure(); ok('radius 2 ft', mi.text === `R 2'-0"`, mi.text);
  await key('Shift+Alt+Q'); for (const [x, y] of [[300, 1060], [390, 1060]]) await click(x, y); { const [x, y] = await P(390, 1150); await page.mouse.click(x, y); await page.mouse.dblclick(x, y); } await page.waitForTimeout(60);
  mi = await measure(); ok('polylength 10 ft', mi.text === `10'-0"`, mi.text);
  await key('h'); await drag(700, 1150, 800, 1160, 10); d = await doc(); ok('highlighter', d.last.type === 'highlight' && d.last.style.blend === 'multiply');

  // selection, move, handles, undo/redo
  await key('Escape'); await key('v');
  const rect = await ev(() => planmark.activeDoc().markups.find((m) => m.type === 'rect' && m.author !== 'Sample'));
  await click(300, 685); ok('select by edge', await ev((id) => planmark.state.sel.has(id), rect.id));
  // grab the edge away from its middle: the middle is the side (resize) handle, as in Revu
  await drag(300, 665, 350, 685); let r2 = await ev((id) => planmark.activeDoc().markups.find((m) => m.id === id).pts, rect.id);
  ok('move', near(r2[0][0], 350) && near(r2[0][1], 560), JSON.stringify(r2));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(150); r2 = await ev((id) => planmark.activeDoc().markups.find((m) => m.id === id).pts, rect.id); ok('undo move', near(r2[0][0], 300), JSON.stringify(r2));
  await page.keyboard.press('Control+y'); await page.waitForTimeout(150); r2 = await ev((id) => planmark.activeDoc().markups.find((m) => m.id === id).pts, rect.id); ok('redo move', near(r2[0][0], 350));
  await click(350, 705); await page.waitForTimeout(80);
  await drag(450, 740, 480, 760); r2 = await ev((id) => planmark.activeDoc().markups.find((m) => m.id === id).pts, rect.id); ok('corner handle resize', near(r2[1][0], 480) && near(r2[1][1], 650), JSON.stringify(r2));
  // properties: colour + width
  await page.click('#props .sw[data-k="style.stroke"][data-v="#1f5fd1"]'); await page.fill('#props input.num[data-k="style.width"]', '4'); await page.press('#props input.num[data-k="style.width"]', 'Enter'); await page.waitForTimeout(80);
  let st = await ev((id) => planmark.activeDoc().markups.find((m) => m.id === id).style, rect.id); ok('props colour & width', st.stroke === '#1f5fd1' && st.width === 4, JSON.stringify([st.stroke, st.width]));
  await ev(() => document.getElementById('viewer').focus());
  base = (await doc()).n; await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); await page.waitForTimeout(80); ok('copy/paste', (await doc()).n === base + 1);
  await key('Delete'); ok('delete', (await doc()).n === base);
  // marquee select
  await drag(280, 630, 720, 740); const nsel = await ev(() => planmark.state.sel.size); ok('marquee select', nsel >= 3, 'sel=' + nsel);
  await key('Escape');

  // calibrate (100 pt line = 5 ft => inPerPt 0.6)
  await key('Shift+K'); await click(300, 1200); await click(400, 1200); await page.waitForSelector('#dlg-form input[name=len]');
  await page.fill('#dlg-form input[name=len]', "5'"); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  const sc = await ev(() => planmark.activeDoc().scales[0]); ok('calibrate', sc && Math.abs(sc.inPerPt - 0.6) < 1e-6 && sc.unit === 'ft', JSON.stringify(sc));
  await page.click('#scale-btn'); await page.waitForSelector('#dlg-preset'); await page.selectOption('#dlg-preset', `1/4" = 1'-0"`); await page.click('.modal footer .btn.primary'); await page.waitForTimeout(150);
  const sc2 = await ev(() => planmark.activeDoc().scales[0]); ok('scale preset', sc2.label === `1/4" = 1'-0"` && Math.abs(sc2.inPerPt - 12 / 18) < 1e-9, sc2.label);

  // search
  await ev(() => planmark.runSearch('kitchen')); await page.waitForTimeout(800); const hits = await ev(() => planmark.state.search.hits.length); ok('search', hits === 2, 'hits=' + hits);

  // layers
  await page.click('[data-panel=layers]'); await page.click('[data-la=new]'); const layers = await ev(() => planmark.activeDoc().layers.length); ok('new layer', layers === 1);
  // tool sets
  await page.click('[data-panel=toolsets]'); await page.click('.titem >> text=Slab area'); ok('tool set item', await ev(() => planmark.state.tool === 'area' && planmark.state.toolSubjects.area === 'Slab'));
  await key('Escape');

  // context menu
  { const [x, y] = await P(350, 700); await page.mouse.click(x, y, { button: 'right' }); await page.waitForTimeout(80); }
  ok('context menu on markup', await ev(() => !document.getElementById('ctx').hidden && document.getElementById('ctx').textContent.includes('Bring to front')));
  ok('context menu', await ev(() => !document.getElementById('ctx').hidden)); await key('Escape'); await ev(() => document.getElementById('ctx').hidden = true);

  await page.screenshot({ path: OUT + '/flow-drawn.png' });

  // save round trip
  const markupsBefore = (await doc()).n;
  await page.click('[data-cmd="file.save"]'); await page.waitForFunction(() => window.__saves.length >= 1, null, { timeout: 20000 });
  const saved = await ev(() => window.__saves[window.__saves.length - 1]); fs.writeFileSync(OUT + '/saved.pdf', Buffer.from(saved.b64, 'base64'));
  ok('save produced pdf', saved.name.endsWith('.pdf') && Buffer.from(saved.b64, 'base64').slice(0, 5).toString() === '%PDF-', saved.name);
  await page.keyboard.press('Control+Alt+f'); await page.waitForFunction(() => window.__saves.length >= 2, null, { timeout: 20000 });
  const flat = await ev(() => window.__saves[window.__saves.length - 1]); fs.writeFileSync(OUT + '/flattened.pdf', Buffer.from(flat.b64, 'base64'));
  ok('flatten produced pdf', flat.name.includes('flattened'));
  await ev(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await planmark.openBytes('roundtrip.pdf', bin); }, saved.b64); await page.waitForTimeout(800);
  const rt = await ev(() => { const d = planmark.activeDoc(); return { name: d.name, n: d.markups.length, scales: Object.keys(d.scales).length, layers: d.layers.length }; });
  ok('reopen restores markups', rt.name === 'roundtrip.pdf' && rt.n === markupsBefore && rt.scales === 4 && rt.layers === 1, JSON.stringify(rt));
  const annotsLeft = await ev(async () => { const d = planmark.activeDoc(); const p = await d.pdf.getPage(1); const an = await p.getAnnotations(); return an.filter((a) => !(d.pdf.annotationStorage.getRawValue(a.id) || {}).noView).length + '/' + an.length; });
  ok('reopen hides the saved annotations (drawn live instead)', annotsLeft.startsWith('0/'), 'visible/total=' + annotsLeft);

  // page ops on the roundtrip doc
  const before = await ev(() => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.type === 'rect'); return { w: d.pages[0].w, h: d.pages[0].h, pt: m.pts[0], id: m.id }; });
  await page.click('[data-panel=pages]'); await page.click('[data-op=rotcw]'); await page.waitForTimeout(1200);
  const after = await ev((id) => { const d = planmark.activeDoc(); const m = d.markups.find((x) => x.id === id); return { w: d.pages[0].w, h: d.pages[0].h, pt: m.pts[0] }; }, before.id);
  ok('rotate page', near(after.w, before.h) && near(after.h, before.w) && near(after.pt[1], before.pt[0]), JSON.stringify([before, after]));
  await page.screenshot({ path: OUT + '/flow-rotated.png' });
  await ev(() => planmark.undo()); await page.waitForTimeout(1200); const un = await ev(() => planmark.activeDoc().pages[0].w); ok('undo rotate', near(un, before.w));
  await page.click('[data-op=blank]'); await page.waitForTimeout(1200); ok('insert blank', (await doc()).pages === 5);
  await page.click('.thumb[data-i="2"]'); await page.click('[data-op=up]'); await page.waitForTimeout(1200); ok('move page', (await doc()).pages === 5);
  await page.click('[data-op=delete]'); await page.waitForSelector('.modal footer .btn.primary'); await page.click('.modal footer .btn.primary'); await page.waitForTimeout(1200); ok('delete page', (await doc()).pages === 4);
  await page.click('[data-op=extract]'); await page.waitForSelector('#dlg-form input[name=range]'); await page.fill('#dlg-form input[name=range]', '1'); await page.click('.modal footer .btn.primary'); await page.waitForTimeout(1500);
  const ex = await ev(() => ({ name: planmark.activeDoc().name, pages: planmark.activeDoc().numPages, n: planmark.activeDoc().markups.length })); ok('extract', ex.pages === 1 && ex.n > 0, JSON.stringify(ex));

  // compare (sample doc p1 vs p2)
  await page.click('.tab >> nth=0'); await page.waitForTimeout(500); await page.click('.mtitle >> text=Document'); await page.click('#menu-pop button >> text=Overlay compare'); await page.waitForSelector('#cmp-pa');
  await page.selectOption('#cmp-db', { index: 0 }); await page.fill('#cmp-pa', '1'); await page.fill('#cmp-pb', '4'); await page.click('.modal footer .btn.primary');
  await page.waitForFunction(() => planmark.activeDoc().name.startsWith('Overlay'), null, { timeout: 30000 }); await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/flow-overlay.png' }); ok('overlay compare', true);

  // CSV
  await page.click('.tab >> nth=0'); await page.waitForTimeout(400); await ev(() => { if (!planmark.state.listOpen) planmark.runCommand('view.markupsList'); }); await page.waitForTimeout(200); await page.click('#list-csv'); await page.waitForFunction(() => window.__saves.some((s) => s.name.endsWith('.csv')), null, { timeout: 10000 });
  const csv = Buffer.from((await ev(() => window.__saves.find((s) => s.name.endsWith('.csv')))).b64, 'base64').toString('latin1'); fs.writeFileSync(OUT + '/markups.csv', csv);
  ok('csv export', csv.split('\n').length > 10, csv.split('\n')[0].slice(0, 80));

  } catch (e) { results.push('ERROR ' + e.message.split('\n')[0]); }
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((r) => r.startsWith('FAIL')).length);
  console.log('ERRORS:', errors.filter((e) => !e.includes('ERR_FAILED')).join('\n') || 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
