// ===== Page content that MeBulb adds: colour processing and flattened markups ===========
// Each addition is a tiny content stream tagged /MeBulb /<Kind> that draws one Form XObject
// (named MBo…) from the page resources. The original page content is wrapped in q/Q streams
// tagged /MeBulb /Wrap so nothing it leaves in the graphics state leaks into ours. Everything
// tagged can be found and taken out again: that is how colour processing stays adjustable and
// how flattened markups can be unflattened.
const OWN_KEY = PDFName.of('MeBulb');
const OWN_DATA = PDFName.of('MeBulbMarkups');

// ----- colour processing ------------------------------------------------------------------
// sat 0..1 (1 = unchanged, 0 = grey), lum -1..1 (negative darkens, positive lightens)
function colorAdjFor(doc, i) {
  const C = doc && doc.colorAdj; if (!C) return null; const v = (C.pages && C.pages[i]) || C.all;
  if (!v || ((v.sat == null || v.sat >= 0.999) && Math.abs(v.lum || 0) < 0.001)) return null; return { sat: v.sat == null ? 1 : v.sat, lum: v.lum || 0 };
}
// on screen: the same two layers as in the PDF, between the drawing and the markups
function renderColorAdj(doc = activeDoc()) {
  if (!doc || !doc.pageEls) return;
  doc.pageEls.forEach((el, i) => {
    // two plain layers straight inside the page, so they blend with the rendered drawing below them
    let a = el.querySelector('.c-sat'), b = el.querySelector('.c-lum'); const v = colorAdjFor(doc, i);
    if (!v) { if (a) a.remove(); if (b) b.remove(); return; }
    if (!a) { a = document.createElement('div'); a.className = 'cadj c-sat'; b = document.createElement('div'); b.className = 'cadj c-lum'; const ov = el.querySelector('svg.ov'); el.insertBefore(a, ov); el.insertBefore(b, ov); }
    a.style.opacity = String(1 - v.sat); b.style.background = v.lum >= 0 ? '#ffffff' : '#000000'; b.style.opacity = String(Math.abs(v.lum));
  });
}
// thumbnails, printing, overlays: the same adjustment on a rendered canvas
function colorAdjCanvas(ctx, w, h, v) {
  if (!v) return; ctx.save();
  if (v.sat < 0.999) { ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = 1 - v.sat; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h); }
  if (Math.abs(v.lum) > 0.001) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.abs(v.lum); ctx.fillStyle = v.lum > 0 ? '#ffffff' : '#000000'; ctx.fillRect(0, 0, w, h); }
  ctx.restore();
}
function colorOps(v, mb) {
  const [x0, y0, x1, y1] = [mb[0] - 2, mb[1] - 2, mb[2] + 2, mb[3] + 2]; const r = `${num(x0, 2)} ${num(y0, 2)} ${num(x1 - x0, 2)} ${num(y1 - y0, 2)} re f`;
  const gs = {}; let s = '';
  if (v.sat < 0.999) { gs.G0 = { Type: 'ExtGState', ca: +(1 - v.sat).toFixed(3), BM: 'Saturation' }; s += `q /G0 gs 0.5 g ${r} Q\n`; }
  if (Math.abs(v.lum) > 0.001) { gs.G1 = { Type: 'ExtGState', ca: +Math.abs(v.lum).toFixed(3) }; s += `q /G1 gs ${v.lum > 0 ? 1 : 0} g ${r} Q\n`; }
  return { s, gs };
}

// ----- what each page should carry -------------------------------------------------------------
// pieces: [{ kind: 'Color'|'Flat', content, resources, bbox, data? }]
async function ownedPieces(pdfDoc, doc, i, mb, fonts, imgCache, extraFlat) {
  const ctx = pdfDoc.context; const out = [];
  const v = doc.colorAdj && doc.colorAdj.save !== false ? colorAdjFor(doc, i) : null;
  if (v) { const c = colorOps(v, mb); out.push({ kind: 'Color', content: c.s, resources: ctx.obj({ ExtGState: c.gs }), sig: `c${v.sat.toFixed(3)}/${v.lum.toFixed(3)}`, box: [mb[0] - 2, mb[1] - 2, mb[2] - mb[0] + 4, mb[3] - mb[1] + 4] }); }
  for (const F of [...(doc.flat || []).filter((f) => f.page === i), ...(extraFlat || [])]) {
    const M = invertT(doc.pages[i].T); const ops = new Ops(doc); ops.s.push(`${M.map((x) => num(x, 6)).join(' ')} cm`);
    F.markups.forEach((m) => dl(m, doc).forEach((p) => ops.prim(p)));
    const res = await resourcesFor(pdfDoc, ops, fonts, imgCache);
    const data = true ? ctx.register(ctx.flateStream(new TextEncoder().encode(JSON.stringify({ v: 1, app: 'MeBulb', id: F.id, allowUnflatten: F.allowUnflatten !== false, flattenedBy: F.by || null, flattened: F.at || null, markups: F.markups })), {})) : null;
    out.push({ kind: 'Flat', content: ops.toString(), resources: res, data, sig: `f${F.id}` });
  }
  return out;
}
function pieceSig(pieces) { return pieces.map((p) => p.sig).join('|'); }

// Rebuild a page's /Contents and /Resources with the wanted pieces. `pd` is a map-like copy of
// the page dictionary (it is changed in place); `resolve` follows references (sync or async);
// `isOwned(ref)` says whether a content stream is ours. Returns true if the page changed.
async function rebuildPageContent(pdfDoc, pd, inhResources, resolve, isOwned, pieces) {
  const ctx = pdfDoc.context; const C = PDFName.of('Contents'), RS = PDFName.of('Resources'), XO = PDFName.of('XObject');
  const c0 = pd.get(C); const cr = await resolve(c0); const refs = cr instanceof PDFArray ? cr.asArray() : c0 ? [c0] : [];
  const orig = []; let had = 0; for (const r of refs) { if (r instanceof PDFRef && (await isOwned(r))) had++; else orig.push(r); }
  if (!had && !pieces.length) return false;
  const r0 = await resolve(pd.get(RS) || inhResources); const rmap = r0 instanceof PDFDict ? new Map(r0.entries()) : new Map();
  const x0 = await resolve(rmap.get(XO)); const xmap = x0 instanceof PDFDict ? new Map(x0.entries()) : new Map();
  for (const k of [...xmap.keys()]) if (/^\/MBo\d+$/.test(k.asString())) xmap.delete(k);
  // colour processing blends with what is below it, so the page gets an explicit white backdrop first
  const paper = pieces.some((p) => p.kind === 'Color') && pieces[0].box ? `q 1 g ${pieces[0].box.map((v) => num(v, 2)).join(' ')} re f Q\n` : '';
  const list = pieces.length ? [ctx.register(ctx.stream(paper + 'q\n', { MeBulb: 'Wrap' })), ...orig, ctx.register(ctx.stream('\nQ\n', { MeBulb: 'Wrap' }))] : orig;
  let n = 0;
  for (const p of pieces) {
    const name = `MBo${++n}`; const xd = { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [-1e4, -1e4, 1e5, 1e5], Resources: p.resources, MeBulb: p.kind }; if (p.data) xd.MeBulbMarkups = p.data;
    xmap.set(PDFName.of(name), ctx.register(ctx.flateStream(p.content, xd)));
    list.push(ctx.register(ctx.stream(`q /${name} Do Q\n`, { MeBulb: p.kind })));
  }
  if (xmap.size) rmap.set(XO, PDFDict.fromMapWithContext(xmap, ctx)); else rmap.delete(XO);
  pd.set(RS, PDFDict.fromMapWithContext(rmap, ctx)); pd.set(C, list.length === 1 ? list[0] : ctx.obj(list));
  return true;
}
// full rewrite (pdf-lib document in memory)
async function ownedContentFull(pdfDoc, doc, fonts, imgCache) {
  const ctx = pdfDoc.context; const pages = pdfDoc.getPages(); const sigs = {};
  const resolve = async (o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const isOwned = async (r) => { const s = ctx.lookup(r); return !!(s && s.dict && s.dict.get(OWN_KEY)); };
  for (let i = 0; i < pages.length; i++) {
    if (!doc.pages[i]) continue; const page = pages[i]; const mb = page.getMediaBox(); const box = [mb.x, mb.y, mb.x + mb.width, mb.y + mb.height];
    const pieces = await ownedPieces(pdfDoc, doc, i, box, fonts, imgCache); sigs[i] = pieceSig(pieces);
    const inh = page.node.getInheritableAttribute ? page.node.getInheritableAttribute(PDFName.of('Resources')) : null;
    await rebuildPageContent(pdfDoc, page.node, inh, resolve, isOwned, pieces);
  }
  return sigs;
}
// read flattened MeBulb markups back out of a page (for unflatten): [{id, markups, ref}]
async function readFlatPieces(R, i) {
  const P = await R.pages(); if (!P[i]) return [];
  const pd = await R.get(P[i].ref); const res = await R.resolve(pd.get(PDFName.of('Resources')) || P[i].inh.Resources); if (!(res instanceof PDFDict)) return [];
  const xo = await R.resolve(res.get(PDFName.of('XObject'))); if (!(xo instanceof PDFDict)) return [];
  const out = [];
  for (const [k, v] of xo.entries()) {
    if (!/^\/MBo\d+$/.test(k.asString())) continue; const st = await R.resolve(v); if (!st || !st.dict) continue;
    const kind = st.dict.get(OWN_KEY); if (!kind || kind.asString() !== '/Flat') continue;
    const dr = st.dict.get(OWN_DATA); if (!dr) continue;
    try { const d = JSON.parse(new TextDecoder().decode(decodeStream(await R.resolve(dr)))); out.push({ id: d.id, markups: d.markups || [], allowUnflatten: d.allowUnflatten !== false, by: d.flattenedBy, at: d.flattened }); } catch (e) { console.warn('flattened data unreadable', e); }
  }
  return out;
}

// ----- colour processing dialog -----------------------------------------------------------------
async function colorDialog() {
  const doc = activeDoc(); if (!doc) return; const i = currentPage(); const before = deep(doc.colorAdj || null);
  const cur = colorAdjFor(doc, i) || { sat: 1, lum: 0 }; const pct = (x) => Math.round(x * 100);
  const preview = (f) => { const v = { sat: (+f.sat) / 100, lum: (+f.lum) / 100 }; const C = deep(before || { all: null, pages: {} }); C.pages = C.pages || {};
    const idx = f.scope === 'all' ? null : f.scope === 'page' ? [i] : parseRange(f.range || '', doc.numPages);
    if (!idx) { C.all = v; C.pages = {}; } else idx.forEach((k) => { C.pages[k] = v; }); C.save = !!f.save; doc.colorAdj = C; renderColorAdj(doc);
    const vs = $('#ca-sat-v'), vl = $('#ca-lum-v'); if (vs) vs.textContent = `${f.sat}%`; if (vl) vl.textContent = `${+f.lum > 0 ? '+' : ''}${f.lum}`; };
  const presets = [['Original', 100, 0], ['Greyscale', 0, 0], ['Faded', 0, 55], ['Light', 60, 35], ['Dark', 100, -25]];
  const r = await openDialog({ title: 'Colour processing', body: `
    <p class="muted">Changes how the drawing looks underneath your markups. Markups keep their own colours.</p>
    <div class="btn-row">${presets.map(([l, s, L]) => `<button type="button" class="btn sm" data-cp="${s},${L}">${l}</button>`).join('')}</div>
    <div class="field"><label>Saturation <span id="ca-sat-v" class="muted">${pct(cur.sat)}%</span></label><input type="range" name="sat" min="0" max="100" step="1" value="${pct(cur.sat)}"></div>
    <div class="field"><label>Luminosity <span id="ca-lum-v" class="muted">${pct(cur.lum) > 0 ? '+' : ''}${pct(cur.lum)}</span></label><input type="range" name="lum" min="-100" max="100" step="1" value="${pct(cur.lum)}"><div class="range-ends"><span>Darker</span><span>Lighter</span></div></div>
    <div class="field"><label>Apply to</label><select name="scope"><option value="all">All pages</option><option value="page">This page (${i + 1})</option><option value="range">Pages…</option></select><input type="text" name="range" placeholder="e.g. 1-3, 5" hidden></div>
    <label class="check"><input type="checkbox" name="save"${!doc.colorAdj || doc.colorAdj.save !== false ? ' checked' : ''}> Keep it in the saved PDF (Revu, Acrobat and printouts show it too)</label>`,
    buttons: [{ label: 'Reset', value: 'reset' }, { label: 'Cancel', value: false }, { label: 'Apply', value: true, primary: true }],
    onOpen: (box) => {
      const form = box.querySelector('#dlg-form'); const vals = () => Object.fromEntries(new FormData(form)); const go = () => { const f = vals(); f.save = form.save.checked; preview(f); };
      form.addEventListener('input', (e) => { if (e.target.name === 'scope') form.range.hidden = e.target.value !== 'range'; go(); });
      form.addEventListener('change', go);
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-cp]'); if (!b) return; const [s, L] = b.dataset.cp.split(','); form.sat.value = s; form.lum.value = L; go(); });
    } });
  if (!r || r.value === false) { doc.colorAdj = before; renderColorAdj(doc); return; }
  const after = doc.colorAdj; doc.colorAdj = before; pushUndo(doc);
  doc.colorAdj = r.value === 'reset' ? null : after; renderColorAdj(doc); renderThumbsSoon(); toast(r.value === 'reset' ? 'Colour processing removed' : 'Colour processing applied');
}
const renderThumbsSoon = debounce(() => { const d = activeDoc(); if (d && d.pageEls && typeof renderThumbs === 'function') { d.thumbVer = (d.thumbVer || 0) + 1; renderThumbs(); } }, 200);

// the markups of a "Save flattened copy": everything visible on the page
function exportFlat(doc, i) { const ms = doc.markups.filter((m) => m.page === i && m.type !== 'textedit' && layerVisible(doc, m.layer)); return ms.length ? [{ id: 'copy', page: i, markups: ms, allowUnflatten: true }] : []; }
// flattened markups already inside the file (found when a page's content is about to change, or on open)
async function ensureFlatKnown(doc, i) {
  doc.flat = doc.flat || []; doc.flatScanned = doc.flatScanned || new Set(); if (doc.flatScanned.has(i)) return; doc.flatScanned.add(i);
  const R = doc.viewReader; if (!R) return; const gone = doc.flatGone || new Set();
  for (const p of await readFlatPieces(R, i).catch(() => [])) if (!gone.has(p.id) && !doc.flat.some((f) => f.id === p.id)) doc.flat.push({ id: p.id, page: i, markups: p.markups, allowUnflatten: p.allowUnflatten, by: p.by, at: p.at, inView: true });
}
async function scanFlat(doc, pages) { for (const i of pages || [...Array(doc.numPages).keys()]) await ensureFlatKnown(doc, i); }

// flattened in this session, not yet in the file pdf.js shows: drawn under the live markups
function renderFlatLayer(doc, i) {
  const el = doc.pageEls && doc.pageEls[i]; if (!el) return; const g = el.querySelector('g.flat'); if (!g) return;
  const fs = (doc.flat || []).filter((f) => f.page === i && !f.inView);
  g.innerHTML = fs.map((f) => f.markups.map((m) => markupSvg(m, doc, {})).join('')).join('');
}

// ----- flatten / unflatten in place ---------------------------------------------------------------------
async function flattenDialog() {
  const doc = activeDoc(); if (!doc) return; const sel = selected(doc); const cur = currentPage();
  const r = await openDialog({ title: 'Flatten markups', body: `
    <p class="muted">Flattening makes markups part of the drawing, so they print and show everywhere but can no longer be moved or edited. With unflatten allowed, MeBulb can turn them back into editable markups later.</p>
    <div class="field"><label>Markups</label><select name="which">${sel.length ? `<option value="sel">Selected (${sel.length})</option>` : ''}<option value="page">All on this page (${cur + 1})</option><option value="all">All in the document</option></select></div>
    <label class="check"><input type="checkbox" name="allow" checked> Allow unflatten</label>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Flatten', value: true, primary: true }] });
  if (!r || !r.value) return; const f = r.form;
  const ms = (f.which === 'sel' ? sel : f.which === 'page' ? doc.markups.filter((m) => m.page === cur) : doc.markups).filter((m) => m.type !== 'textedit' && layerVisible(doc, m.layer));
  if (!ms.length) { toast('No markups to flatten'); return; }
  pushUndo(doc); const byPage = new Map(); ms.forEach((m) => { if (!byPage.has(m.page)) byPage.set(m.page, []); byPage.get(m.page).push(m); });
  doc.flat = doc.flat || []; const ids = new Set(ms.map((m) => m.id));
  byPage.forEach((list, page) => doc.flat.push({ id: uid('FL-'), page, markups: deep(list), allowUnflatten: !!f.allow, by: state.author, at: nowISO() }));
  doc.markups = doc.markups.filter((m) => !ids.has(m.id)); state.sel.clear();
  renderAllMarks(doc); refreshAll(); toast(`Flattened ${ms.length} markup${ms.length === 1 ? '' : 's'}. Save to write them into the PDF.`);
}
async function unflattenDialog() {
  const doc = activeDoc(); if (!doc) return; const busy = $('#busy'); busy.hidden = false; busy.textContent = 'Looking for flattened markups…'; await raf();
  try { await scanFlat(doc); } finally { busy.hidden = true; }
  const all = doc.flat || []; const cur = currentPage(); const revu = await revuFlatCount(doc).catch(() => 0);
  if (!all.length && !revu) { toast('No flattened markups that can be unflattened were found'); return; }
  const n = (fs) => fs.reduce((s, f) => s + f.markups.length, 0); const locked = all.filter((f) => f.allowUnflatten === false);
  const r = await openDialog({ title: 'Unflatten markups', body: `
    <p class="muted">Turns flattened markups back into markups you can select and edit. Text boxes come back as real text boxes.</p>
    <div class="field"><label>Pages</label><select name="which"><option value="page">This page (${cur + 1}) · ${n(all.filter((f) => f.page === cur))} markups</option><option value="all">All pages · ${n(all)} markups</option></select></div>
    ${revu ? `<p class="muted sm">${revu} markup${revu === 1 ? '' : 's'} flattened in Bluebeam Revu ${revu === 1 ? 'is' : 'are'} included.</p>` : ''}${locked.length ? `<p class="muted sm">${n(locked)} markups were flattened with unflatten not allowed and stay flattened.</p>` : ''}`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Unflatten', value: true, primary: true }] });
  if (!r || !r.value) return;
  const pick = all.filter((f) => f.allowUnflatten !== false && (r.form.which === 'all' || f.page === cur));
  pushUndo(doc); doc.flatGone = doc.flatGone || new Set(); let count = 0;
  pick.forEach((f) => { f.markups.forEach((m) => { m.page = f.page; if (!doc.markups.some((x) => x.id === m.id)) { doc.markups.push(m); count++; } }); doc.flatGone.add(f.id); });
  doc.flat = all.filter((f) => !pick.includes(f));
  count += await unflattenRevu(doc, r.form.which === 'all' ? null : [cur]).catch((e) => { console.warn(e); return 0; });
  const pages = [...new Set(pick.filter((f) => f.inView).map((f) => f.page))];
  if (pages.length) { doc.flat.filter((f) => pages.includes(f.page)).forEach((f) => { f.inView = false; }); await patchView(doc, pages); }
  renderAllMarks(doc); refreshAll(); toast(`Unflattened ${count} markup${count === 1 ? '' : 's'}`);
}
// the page on screen still has the flattened drawing: show it without, using an in-memory update
// pdf.js never shows MeBulb's own page additions: MeBulb draws them itself (colour overlay,
// flattened-markup layer), so they can change without reloading. This strips them from the copy
// pdf.js reads with a small in-memory update; the file on disk keeps them.
async function patchView(doc, pages, remount = true) {
  const R = doc.viewReader; if (!R || !pages.length) return;
  const upd = await incrementalUpdate(doc, { reader: R, pages, contentOnly: true, forceContent: true, stripOwned: true }); if (!upd) return;
  doc.src = new ConcatSource([doc.src, new MemSource(upd.bytes)]); doc.viewReader = null; doc.viewPatched = true;
  if (!remount) return; const st = V.el.scrollTop, sl = V.el.scrollLeft;
  await loadPdfInto(doc); mountDoc(doc); V.el.scrollTop = st; V.el.scrollLeft = sl;
}
async function stripOwnedFromView(doc, ownSig) {
  const pages = Object.entries(ownSig || {}).filter(([, s]) => s).map(([k]) => +k).filter((k) => k < doc.numPages); if (!pages.length) return false;
  await scanFlat(doc, pages); doc.flat.forEach((f) => { if (pages.includes(f.page)) f.inView = false; });
  await patchView(doc, pages, false); await loadPdfInto(doc); return true;
}
