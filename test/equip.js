// Equipment to scale: library, placing with rotation, clearance zones, clash warnings, saving, CSV and Revit imports
const { launch } = require('./harness');
const fs = require('fs'); const { execSync } = require('child_process');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1500, height: 950 }, init: () => { localStorage.removeItem('planmark:equipLib'); } });
  const ev = (fn, a) => page.evaluate(fn, a);
  // a library made from data sheets (values are made up for the test)
  await ev(() => { const L = mebulb.eqLib(); L.length = 0;
    L.push(mebulb.eqClean({ id: 'EQ-cu', name: 'Test condenser', category: 'Condenser', maker: 'Test', model: 'CU900', w: 900, d: 350, h: 1300, clear: { front: 600, back: 300, left: 300, right: 300 }, air: [{ side: 'front', kind: 'discharge', dist: 1500 }, { side: 'back', kind: 'intake', dist: 300 }] }));
    L.push(mebulb.eqClean({ id: 'EQ-ahu', name: 'Test AHU', category: 'AHU', model: 'AHU-2000', w: 2000, d: 1100, h: 1500, clear: { front: 1100, back: 600, left: 0, right: 0 } }));
    mebulb.saveEqLib(); mebulb.runCommand('panel.equipment'); });
  await page.waitForTimeout(400);
  ok(await ev(() => document.querySelectorAll('#equipment .eq-item').length === 2), 'Equipment panel lists the library');
  // place the condenser at 1:50 by clicking it in the panel and then the page
  const at = async (x, y) => { const [cx, cy] = await ev(([x, y]) => { const d = mebulb.activeDoc(); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + x * d.zoom, r.top + y * d.zoom]; }, [x, y]); return [cx, cy]; };
  await ev(() => { mebulb.setZoom(1.4); mebulb.goToPage(0, [520, 900]); }); await page.waitForTimeout(400);
  await page.click('#equipment .eq-item[data-u="EQ-cu"]'); await page.waitForTimeout(200);
  ok(await ev(() => mebulb.state.tool === 'equip' && !!mebulb.state.placeEquip), 'picking a unit arms placing');
  let p = await at(520, 900); await page.mouse.move(p[0], p[1]); await page.waitForTimeout(150);
  ok(await ev(() => !!document.querySelector('.page g.draft g.ghost')), 'the unit follows the pointer before it is placed');
  await page.mouse.click(p[0], p[1]); await page.waitForTimeout(300);
  const u1 = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; const b = mebulb.equipBBox({ ...m, show: { service: false, air: false } }, d); return { type: m.type, tag: m.tag, w: b.w, h: b.h, rot: m.rot, sc: mebulb.activeDoc().scales[0] && mebulb.activeDoc().scales[0].label }; });
  const k = 72 / (25.4 * 50); // points per mm at 1:50
  ok(u1.type === 'equip' && u1.tag === 'CU-01' && Math.abs(u1.w - 900 * k) < 0.5 && Math.abs(u1.h - 350 * k) < 0.5, `placed CU-01 to scale (${u1.w.toFixed(1)} × ${u1.h.toFixed(1)} pt = 900 × 350 mm at ${u1.sc})`);
  // R turns the next one; place it in the first unit's discharge zone
  await page.keyboard.press('r'); p = await at(520, 900 + (350 / 2 + 700) * k); await page.mouse.click(p[0], p[1]); await page.waitForTimeout(300);
  const u2 = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; return { tag: m.tag, rot: m.rot }; });
  ok(u2.tag === 'CU-02' && u2.rot === 90, 'R turned the next unit 90°, tagged CU-02');
  await page.keyboard.press('Escape');
  const cl = await ev(() => mebulb.equipClashList(mebulb.activeDoc()).map((c) => c.text));
  ok(cl.some((t) => /CU-02 is in the front discharge zone of CU-01/.test(t)), 'clash found: ' + cl.join(' | '));
  await ev(() => mebulb.renderEquipPanel()); await page.waitForTimeout(200);
  ok(await ev(() => /clearance clash/.test(document.querySelector('#equipment .eq-clashes') ? document.querySelector('#equipment .eq-clashes').textContent : '')), 'the panel shows the clash');
  await page.screenshot({ path: OUT + '/equip-clash.png' });
  // move CU-02 clear: no clash; then put a third unit beside CU-01 inside its side service space
  await ev((k) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.tag === 'CU-02'); m.pts[0][1] += 1400 * k; mebulb.renderAllMarks(d); }, k);
  ok(await ev(() => mebulb.equipClashList(mebulb.activeDoc()).length === 0), 'moved out of the discharge zone: no clash');
  await ev((k) => { const d = mebulb.activeDoc(); const c1 = d.markups.find((x) => x.tag === 'CU-01'); mebulb.armEquip(mebulb.eqLib()[0]); mebulb.state.placeRot = 0; mebulb.placeEquipAt(0, [c1.pts[0][0] + (900 + 200) * k, c1.pts[0][1]]); mebulb.setTool('select'); }, k);
  const side = await ev(() => mebulb.equipClashList(mebulb.activeDoc()).map((c) => c.text));
  ok(side.some((t) => /service clearance/.test(t)), 'unit 200 mm beside another sits in its 300 mm side service space: ' + side[0]);
  // properties
  await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.tag === 'CU-03'); mebulb.state.sel.clear(); mebulb.state.sel.add(m.id); mebulb.refreshSelection(); });
  await page.waitForTimeout(300);
  ok(await ev(() => !!document.querySelector('#props [data-k="show.service"]') && /Clearance clash/.test(document.querySelector('#props').textContent)), 'properties show the unit, its options and its clash');
  await page.click('#props [data-act="equip-rot-r"]'); ok(await ev(() => mebulb.activeDoc().markups.find((x) => x.tag === 'CU-03').rot === 90), 'turn button rotates the unit');
  await page.screenshot({ path: OUT + '/equip-props.png' });
  // save and reopen
  const b64 = await ev(async () => { const d = mebulb.activeDoc(); d.reader = await mebulb.openReader(d.src); const u = await mebulb.incrementalUpdate(d, {}); const all = new Uint8Array(d.src.size + u.bytes.length); all.set(d.src.bytes); all.set(u.bytes, d.src.size); let s = ''; for (let i = 0; i < all.length; i += 32768) s += String.fromCharCode.apply(null, all.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(OUT + '/equip.pdf', Buffer.from(b64, 'base64'));
  ok(/No syntax or stream encoding errors/.test(execSync(`qpdf --check ${OUT}/equip.pdf 2>&1 || true`, { encoding: 'utf8' })), 'saved PDF passes qpdf');
  const t = execSync(`qpdf --qdf --object-streams=disable ${OUT}/equip.pdf - | strings | grep -ci "Subj <feff0043006f006e00640065006e007300650072>" || true`, { encoding: 'utf8' }).trim();
  ok(+t >= 3, `units are annotations other viewers show (${t} condensers)`);
  const re = await ev(async (b) => { const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const d = await mebulb.openBytes('Equip.pdf', bytes); await new Promise((r) => setTimeout(r, 800)); const ms = d.markups.filter((m) => m.type === 'equip'); return { n: ms.length, tags: ms.map((m) => m.tag).sort().join(), w: ms[0] && ms[0].eq.w }; }, b64);
  ok(re.n === 3 && re.tags === 'CU-01,CU-02,CU-03' && re.w === 900, 'reopened: units come back with their data ' + JSON.stringify(re));
  // CSV from data sheets
  const csv = await ev(() => mebulb.eqFromCsv('Name,Category,Manufacturer,Model,Width mm,Depth mm,Height mm,Front mm,Back mm,Left mm,Right mm,Discharge side,Discharge mm\n"Test FCU",FCU,Test,F1,1100,600,280,600,0,450,0,,\n"Test CU2",Condenser,Test,C2,1000,400,1400,500,300,0,0,up,0\n').map((u) => `${u.name}:${u.category}:${u.w}x${u.d}:${u.clear.front}/${u.clear.left}:${u.air.map((a) => a.side + a.kind).join('')}`));
  ok(csv.join('|') === 'Test FCU:FCU:1100x600:600/450:|Test CU2:Condenser:1000x400:500/0:updischarge', 'CSV rows become units: ' + csv.join(' | '));
  // what the Revit exporter writes (family coordinates, front = -Y): outline, linework, clearance solids
  const rv = await ev(() => { const j = { app: 'MeBulb', kind: 'equipment', version: 1, units: 'mm', source: 'Revit 2026 - Test', items: [{ name: 'Test Family: 12kW', family: 'Test Family', type: '12kW', category: 'Mechanical Equipment', model: 'X12', h: 900,
    body: [[-470, -170], [470, -170], [470, 170], [-470, 170]], lines: [[[-470, -170], [470, -170]], [[-300, 0], [300, 0]]],
    zones: [{ kind: 'Mechanical Equipment / Service Clearance', label: 'Service Clearance', poly: [[-470, -770], [470, -770], [470, -170], [-470, -170]] }, { kind: 'Mechanical Equipment / Airflow Discharge', label: 'Airflow Discharge', poly: [[-470, 170], [470, 170], [470, 1670], [-470, 1670]] }], params: { 'Service Clearance Front': 600 } }] };
    const u = mebulb.eqFromRevit(j, '-y')[0]; return { w: u.w, d: u.d, zones: u.zones.map((z) => `${z.kind}:${z.side}:${z.dist}`), lines: u.lines.length, src: u.source }; });
  ok(rv.w === 940 && rv.d === 340 && rv.zones.join() === 'service:front:600,discharge:back:1500' && rv.lines === 2 && rv.src === 'revit', 'Revit export: outline, linework and clearance solids read in unit axes ' + JSON.stringify(rv));
  const dyn = await ev(() => { const j = JSON.parse(mebulb.revitExporterDyn()); return { node: j.Nodes[0].NodeType, code: /OST_MechanicalEquipment/.test(j.Nodes[0].Code), view: j.View.NodeViews[0].Id === j.Nodes[0].Id }; });
  ok(dyn.node === 'PythonScriptNode' && dyn.code && dyn.view, 'Dynamo graph carries the exporter script');
  const bad = errors.filter((e) => !/favicon|net::ERR/.test(e)); ok(!bad.length, 'no page errors' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
  await browser.close();
})();
