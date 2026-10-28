// Real-world check on a client drawing flattened in Revu with "Allow markup recovery", the client's
// tool sets and stamps. The files are not in the repository: set IGS_DIR (default /tmp/claude-0/igs)
// to a folder holding flat.pdf, ts-*.btx and st-*.pdf. Skips when they are missing.
const { launch } = require('./harness');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const DIR = process.env.IGS_DIR || '/tmp/claude-0/igs'; const OUT = path.join(__dirname, 'out');
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
if (!fs.existsSync(path.join(DIR, 'flat.pdf'))) { console.log('skipped: no client files in ' + DIR); process.exit(0); }
const sh = (c) => execSync(c, { encoding: 'utf8', maxBuffer: 1 << 28 });
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1500, height: 950 }, init: () => {
    window.__saves = [];
    window.showSaveFilePicker = async (o) => ({ createWritable: async () => ({ write: async (b) => { window.__saveBlob = b; window.__saves.push({ name: o.suggestedName, size: b.size }); }, close: async () => {} }) });
  } });
  const ev = (fn, a) => page.evaluate(fn, a);
  const file = (p) => '/file/' + encodeURIComponent(p);
  await ev(async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); await mebulb.openBytes('M-SD-LL1-L06.pdf', b); await new Promise((r) => setTimeout(r, 2000)); }, file(path.join(DIR, 'flat.pdf')));
  const before = await ev(() => ({ n: mebulb.activeDoc().markups.length, revu: 0 }));
  before.revu = await ev(() => mebulb.revuFlatCount(mebulb.activeDoc()));
  ok(before.revu === 235, `found ${before.revu} markups flattened in Revu with markup recovery`);
  // unflatten from the dialog, all pages
  await ev(() => mebulb.runCommand('doc.unflatten')); await page.waitForSelector('#modal select[name=which]');
  const label = await ev(() => document.querySelector('#modal').textContent.replace(/\s+/g, ' '));
  ok(/flattened in Bluebeam Revu/.test(label), 'unflatten dialog mentions the Revu markups');
  await page.selectOption('#modal select[name=which]', 'all'); await page.click('#modal footer .btn.primary');
  await page.waitForFunction(() => mebulb.activeDoc().markups.length > 200, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  const after = await ev(() => { const d = mebulb.activeDoc(); const t = {}; d.markups.forEach((m) => { t[m.type] = (t[m.type] || 0) + 1; }); return { n: d.markups.length, t, groups: new Set(d.markups.filter((m) => m.group).map((m) => m.group)).size, unmelt: (d.unmelt || []).length }; });
  ok(after.n === before.n + 235 && after.unmelt === 14, `unflattened into ${after.n - before.n} editable markups on ${after.unmelt} pages: ${JSON.stringify(after.t)}`);
  ok(after.groups >= 14, `${after.groups} Revu groups kept as groups (the review stamp on each sheet is one)`);
  // the review stamp: text boxes are real text boxes with their words
  const st = await ev(() => { const d = mebulb.activeDoc(); const t = d.markups.filter((m) => m.page === 0 && m.type === 'text').map((m) => (m.runs ? m.runs.map((r) => r.t).join('') : m.text)); return t; });
  ok(st.some((x) => /DATE RECEIVED:\n25\/05\/2026\n\nAPPROVED:/.test(x)), 'review stamp text box is editable text, blank lines kept');
  // clicking one part of the stamp selects the whole group
  const pos = await ev(() => { const d = mebulb.activeDoc(); mebulb.setZoom(1.6); const m = d.markups.find((x) => x.page === 0 && x.type === 'text' && /DATE RECEIVED/.test(x.text || '')); mebulb.goToPage(0, [m.pts[0][0] + 40, m.pts[0][1] + 40]); return m.id; });
  await page.waitForTimeout(2000);
  const xy = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + (m.pts[0][0] + 20) * d.zoom, r.top + (m.pts[0][1] + 8) * d.zoom]; }, pos);
  await page.mouse.click(xy[0], xy[1]); await page.waitForTimeout(300);
  const sel = await ev(() => { const d = mebulb.activeDoc(); const ids = [...mebulb.state.sel]; const g = d.markups.find((m) => m.id === ids[0]).group; return { n: ids.length, all: d.markups.filter((m) => m.group === g).length, und: [...document.querySelectorAll('#props input, #propbar input')].filter((i) => i.getAttribute('value') === 'undefined').map((i) => i.name || i.dataset.k || i.type) }; });
  ok(sel.n === sel.all && sel.n >= 10, `clicking the stamp selects its whole group (${sel.n} parts)`); if (sel.und.length) console.log('inputs with undefined:', sel.und);
  await page.screenshot({ path: OUT + '/igs-stamp-unflattened.png' });
  await page.keyboard.press('Escape');
  // save the normal way (appends to the file)
  await ev(() => mebulb.runCommand('file.save')); await page.waitForFunction(() => window.__saves.length >= 1, null, { timeout: 60000 });
  const saved = path.join(OUT, 'igs-unflattened.pdf');
  const b64 = await ev(async () => { const b = new Uint8Array(await window.__saveBlob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(saved, Buffer.from(b64, 'base64'));
  const grow = fs.statSync(saved).size - fs.statSync(path.join(DIR, 'flat.pdf')).size;
  ok(grow > 0 && grow < 3e6, `saved by appending ${(grow / 1024).toFixed(0)} KB to the 20 MB drawing`);
  ok(/No syntax or stream encoding errors/.test(sh(`qpdf --check "${saved}" 2>&1 || true`)), 'saved PDF passes qpdf');
  // structure: no melted streams left, annotations back on the pages with Revu's ids and groups
  const info = JSON.parse(sh(`python3 -I - "${saved}" <<'EOF'
import re,sys,json,subprocess,tempfile,os
q=tempfile.mktemp(suffix='.pdf'); subprocess.run(['qpdf','--qdf','--object-streams=disable',sys.argv[1],q],check=False)
d=open(q,'rb').read().decode('latin1'); os.remove(q)
objs={m.group(1):m.group(2) for m in re.finditer(r'\\n(\\d+) 0 obj\\n(.*?)\\nendobj',d,re.S)}
pages=[k for k,v in objs.items() if re.search(r'/Type /Page\\b',v) and '/MediaBox' in v]
melted=0; ann=0; nm=0; grp=0; irt=0; img=0
for k in pages:
  p=objs[k]; c=re.search(r'/Contents (\\[.*?\\]|\\d+ 0 R)',p,re.S).group(1)
  melted+=sum(1 for r in re.findall(r'(\\d+) 0 R',c) if '/BBType /Melted' in objs.get(r,'')[:4000])
  a=re.search(r'/Annots (\\d+) 0 R|/Annots \\[(.*?)\\]',p,re.S)
  refs=re.findall(r'(\\d+) 0 R',objs[a.group(1)] if a and a.group(1) else (a.group(2) if a else ''))
  for r in refs:
    o=objs.get(r,'');
    if '/Subtype /Link' in o: continue
    ann+=1; nm+= bool(re.search(r'/NM \\([A-Z]{16}\\)',o)); grp+= '/GroupNesting' in o; irt+= '/RT /Group' in o; img+= '/IT /SquareImage' in o
print(json.dumps(dict(melted=melted,ann=ann,nm=nm,grp=grp,irt=irt,img=img)))
EOF`));
  ok(info.melted === 0, 'no Revu flattened content left on any page');
  ok(info.ann >= 263 && info.nm >= 235, `${info.ann} annotations on the pages; ${info.nm} keep their Revu ids`);
  ok(info.grp >= 14 && info.irt >= 150, `groups written the Revu way: ${info.grp} groups, ${info.irt} members`);
  ok(info.img >= 14, `IGS logo comes back as a Revu image markup (${info.img})`);
  // what the saved file looks like (rendered by poppler, from MeBulb's appearances)
  sh(`pdftoppm -r 60 -f 1 -l 1 -x 2450 -y 1250 -W 420 -H 350 -png "${saved}" ${OUT}/igs-saved-p1 2>/dev/null; pdftoppm -r 60 -f 1 -l 1 -x 2450 -y 1250 -W 420 -H 350 -png "${path.join(DIR, 'flat.pdf')}" ${OUT}/igs-orig-p1 2>/dev/null`);
  // reopen: the markups are recognised as MeBulb's, nothing doubled, nothing left to unflatten
  const re = await ev(async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); const d = await mebulb.openBytes('again.pdf', b); await new Promise((r) => setTimeout(r, 2000)); return { n: d.markups.length, revu: await mebulb.revuFlatCount(d), groups: new Set(d.markups.filter((m) => m.group).map((m) => m.group)).size, note: d.importNote }; }, file(saved));
  ok(re.n === after.n && re.revu === 0, `reopened: ${re.n} markups, none duplicated, nothing flattened (${JSON.stringify(re.note)})`);
  ok(re.groups === after.groups, `groups survive the round trip (${re.groups})`);
  // the client's tool sets
  const sets = {};
  for (const f of ['ts-text', 'ts-spatial', 'ts-review']) {
    sets[f] = await ev(async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); const { set, skipped } = await mebulb.importBtx(new File([b], 'x.btx')); mebulb.state.toolsets.push(set); return { name: set.name, n: set.items.length, skipped, groups: set.items.filter((i) => i.tool === 'group').map((i) => `${i.name} (${i.shapes.length})`) }; }, file(path.join(DIR, f + '.btx')));
  }
  ok(sets['ts-text'].n === 18 && sets['ts-spatial'].n === 18 && sets['ts-review'].n === 5 && !sets['ts-text'].skipped && !sets['ts-spatial'].skipped && !sets['ts-review'].skipped, `all 41 tools imported from the three IGS tool sets, none skipped`);
  ok(sets['ts-review'].groups.join() === 'INTERNAL QA STAMP (21),DOCUMENT REVIEW DnC STAMP (33),DOCUMENT REVIEW FULL DESIGN STAMP (34),SKETCH STAMP (31)', 'grouped tools keep their names and parts: ' + sets['ts-review'].groups.join(', '));
  ok(sets['ts-spatial'].groups.some((g) => /^Spatial Legend Vertical/.test(g)) && sets['ts-spatial'].groups.some((g) => /^MECH Legend/.test(g)), 'legends come in as groups: ' + sets['ts-spatial'].groups.slice(0, 4).join(', '));
  const rt = await ev(async () => { const set = mebulb.state.toolsets[mebulb.state.toolsets.length - 1]; const { xml } = await mebulb.btxXml(set); const r = await mebulb.importBtx(new File([xml], 'back.btx')); return r.set.items.map((i) => (i.shapes ? i.shapes.length : 1)).join(); });
  ok(rt === '21,33,34,31,1', 'review stamps export as a .btx and come back with every part (' + rt + ')');
  // the client's interactive stamps
  for (const f of ['st-qa', 'st-dnc', 'st-sketch']) {
    await ev(async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); await mebulb.importStampFiles([new File([b], 'IGS ' + u.split('%2F').pop())]); const st = mebulb.STAMPLIB.list[mebulb.STAMPLIB.list.length - 1]; mebulb.state.stampId = st.id; mebulb.setTool('stamp'); mebulb.goToPage(0, [800, 600]); }, file(path.join(DIR, f + '.pdf')));
    await page.waitForTimeout(400); const [sx, sy] = await ev(() => { const d = mebulb.activeDoc(); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + 800 * d.zoom, r.top + 600 * d.zoom]; });
    await page.mouse.click(sx, sy); await page.waitForSelector('#modal .st-fill', { timeout: 10000 });
    if (await page.$('#modal input[type=radio]')) await page.check('#modal input[type=radio] >> nth=1');
    await page.click('#modal footer .btn.primary'); await page.waitForTimeout(1500);
    const v = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; return { type: m.type, vals: m.stampValues || {}, w: Math.round(Math.abs(m.pts[1][0] - m.pts[0][0])) }; });
    ok(v.type === 'stamp' && Object.keys(v.vals).length >= 2 && v.w > 390 && v.w < 410 && (f === 'st-sketch' || v.vals.Status === 'COMMENTS'), `${f}: dialog answered, stamp placed at ${v.w} pt wide with ${JSON.stringify(v.vals)}`);
    await ev(() => mebulb.setTool('select'));
  }
  await page.screenshot({ path: OUT + '/igs-stamps.png' });
  const bad = errors.filter((e) => !/TT:|XObject should be a stream|favicon|net::ERR|beginMarkedContent/.test(e)); ok(!bad.length, 'no page errors' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
  await browser.close();
})();
