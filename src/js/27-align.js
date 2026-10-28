// ===== Page alignment by grid lines =============================================
// Sheets in a set are often placed a little differently on each page. An alignment
// maps a page's coordinates onto a reference page ("model" coordinates):
//   doc.align = { ref: pageIndex, T: { [page]: [a, b, c, d, e, f] } }
// [a b c d e f] maps (x, y) -> (a x + c y + e, b x + d y + f), like a PDF matrix.
// Linked sketches use it so a riser placed on one floor lands on the same grid
// position on every other floor, even when the plans are shifted on the sheet.
const T_ID = [1, 0, 0, 1, 0, 0];
function tApply(T, p) { return [T[0] * p[0] + T[2] * p[1] + T[4], T[1] * p[0] + T[3] * p[1] + T[5]]; }
function tMul(A, B) { return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]]; } // A after B
function tInv(T) { const [a, b, c, d, e, f] = T; const det = a * d - b * c || 1; return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]; }
function alignT(doc, page) { const A = doc && doc.align; return (A && A.T && A.T[page]) || T_ID; }
function alignAngle(doc, page) { const T = alignT(doc, page); return Math.atan2(T[1], T[0]); }
function alignScale(doc, page) { const T = alignT(doc, page); return Math.hypot(T[0], T[1]); }
function isAligned(doc, page) { const A = doc && doc.align; return !!(A && (A.ref === page || (A.T && A.T[page]))); }
// a point on page `from` -> the same building position on page `to`
function mapPage(doc, from, to, p) { if (from === to) return p.slice(); return tApply(tInv(alignT(doc, to)), tApply(alignT(doc, from), p)); }
// similarity transform taking points src[i] onto dst[i] (least squares)
function fitSimilarity(src, dst) {
  const n = src.length; if (!n) return T_ID.slice();
  let sx = 0, sy = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; } sx /= n; sy /= n; dx /= n; dy /= n;
  if (n === 1) return [1, 0, 0, 1, dx - sx, dy - sy];
  let a = 0, b = 0, den = 0;
  for (let i = 0; i < n; i++) { const px = src[i][0] - sx, py = src[i][1] - sy, qx = dst[i][0] - dx, qy = dst[i][1] - dy; a += px * qx + py * qy; b += px * qy - py * qx; den += px * px + py * py; }
  if (den < 1e-9) return [1, 0, 0, 1, dx - sx, dy - sy];
  a /= den; b /= den; return [a, b, -b, a, dx - (a * sx - b * sy), dy - (b * sx + a * sy)];
}
// prefer a plain shift when rotation and scale are negligible
function cleanAlign(T, src, dst) {
  const s = Math.hypot(T[0], T[1]), ang = Math.atan2(T[1], T[0]);
  if (Math.abs(s - 1) < 0.003 && Math.abs(ang) < 0.0015) { let ex = 0, ey = 0; src.forEach((p, i) => { ex += dst[i][0] - p[0]; ey += dst[i][1] - p[1]; }); return [1, 0, 0, 1, ex / src.length, ey / src.length]; }
  return T;
}
function alignSummary(doc, page) {
  const A = doc.align; if (!A) return 'Not aligned';
  if (A.ref === page) return 'Reference page';
  const T = A.T && A.T[page]; if (!T) return 'Not aligned';
  const sc = scaleFor(doc, page); const metric = !['ft', 'in', 'yd', 'mi'].includes(sc.unit);
  const paper = (v) => (metric ? `${num(Math.abs(v) / 72 * 25.4, 1)} mm` : `${num(Math.abs(v) / 72, 2)}"`);
  const parts = []; if (Math.abs(T[4]) > 0.05) parts.push(`${paper(T[4])} ${T[4] > 0 ? 'right' : 'left'}`); if (Math.abs(T[5]) > 0.05) parts.push(`${paper(T[5])} ${T[5] > 0 ? 'down' : 'up'}`);
  const ang = (alignAngle(doc, page) * 180) / Math.PI; if (Math.abs(ang) > 0.01) parts.push(`${num(ang, 2)}° turned`);
  const s = alignScale(doc, page); if (Math.abs(s - 1) > 0.0005) parts.push(`${num(s * 100, 2)}% size`);
  return parts.length ? `Shifted ${parts.join(', ')} from page ${A.ref + 1}` : `Matches page ${A.ref + 1}`;
}

// ----- automatic alignment from grid bubble labels ----------------------------------
const GRID_LABEL = /^(?:[A-Z]{1,2}|\d{1,2}|[A-Z]{1,2}\.\d{1,2}|\d{1,2}\.\d{1,2}|[A-Z]'|\d{1,2}')$/;
async function gridLabels(doc, page) {
  const t = await pageText(doc, page); const out = [];
  t.items.forEach((it) => { const s = it.str.trim(); if (!GRID_LABEL.test(s) || it.ocr) return; out.push({ s, p: G.centroid(itemRect(it, 0, it.str.length)) }); });
  return out;
}
// find the shift (and, if present, rotation and scale) that best lines up the grid labels
function matchLabels(ref, tgt) {
  const byS = new Map(); ref.forEach((r) => { if (!byS.has(r.s)) byS.set(r.s, []); byS.get(r.s).push(r.p); });
  const pairs = []; tgt.forEach((t) => (byS.get(t.s) || []).forEach((rp) => pairs.push({ s: t.s, src: t.p, dst: rp })));
  if (pairs.length < 2) return null;
  const tol = 4; let best = null;
  const score = (T) => { const hit = new Map(); pairs.forEach((pr) => { const q = tApply(T, pr.src); const e = Math.hypot(q[0] - pr.dst[0], q[1] - pr.dst[1]); if (e < tol && (!hit.has(pr.s) || hit.get(pr.s).e > e)) hit.set(pr.s, { e, pr }); }); return hit; };
  const consider = (T) => { const s = Math.hypot(T[0], T[1]); if (s < 0.5 || s > 2) return; const hit = score(T); const n = hit.size; const err = [...hit.values()].reduce((a, h) => a + h.e, 0); if (!best || n > best.n || (n === best.n && err < best.err)) best = { n, err, hit }; };
  // shifts first (the usual case), then pairs of pairs for rotated or rescaled sheets
  pairs.forEach((pr) => consider([1, 0, 0, 1, pr.dst[0] - pr.src[0], pr.dst[1] - pr.src[1]]));
  const N = pairs.length; let tries = 0;
  for (let i = 0; i < N && tries < 6000; i++) for (let j = i + 1; j < N && tries < 6000; j++) {
    const a = pairs[i], b = pairs[j]; if (a.s === b.s || G.dist(a.src, b.src) < 30) continue; tries++;
    consider(fitSimilarity([a.src, b.src], [a.dst, b.dst]));
  }
  if (!best || best.n < 3) return null;
  const inl = [...best.hit.values()].map((h) => h.pr); const src = inl.map((p) => p.src), dst = inl.map((p) => p.dst);
  let T = fitSimilarity(src, dst); T = cleanAlign(T, src, dst);
  const rms = Math.sqrt(inl.reduce((a, p) => { const q = tApply(T, p.src); return a + (q[0] - p.dst[0]) ** 2 + (q[1] - p.dst[1]) ** 2; }, 0) / inl.length);
  return { T, labels: inl.map((p) => p.s), rms };
}
async function autoAlign(doc, ref, pages) {
  const refL = await gridLabels(doc, ref); const res = { ok: [], fail: [] };
  if (refL.length < 3) return { ...res, noRef: true };
  doc.align = doc.align && doc.align.ref === ref ? doc.align : { ref, T: {} };
  for (const p of pages) {
    if (p === ref) continue; const m = matchLabels(refL, await gridLabels(doc, p));
    if (m) { doc.align.T[p] = m.T; res.ok.push({ page: p, labels: m.labels, rms: m.rms }); } else res.fail.push(p);
  }
  return res;
}
async function autoAlignDialog() {
  const doc = activeDoc(); if (!doc) return; const ref0 = doc.align ? doc.align.ref : 0;
  const marks = hasRefMarks(doc);
  const r = await openDialog({ title: 'Align pages', body: `<p>Line the sheets up so linked sketches and overlays land on the same spot of the building on every page.</p>${field('Line up using', `<select name="how"><option value="marks"${marks ? ' selected' : ''}>Reference points and grid lines I placed</option><option value="grid"${marks ? '' : ' selected'}>Grid bubbles on the drawings (A, B… 1, 2…)</option></select>`)}${field('Reference page (the others line up to it)', `<select name="ref">${doc.pages.map((pg, i) => `<option value="${i}"${i === ref0 ? ' selected' : ''}>Page ${i + 1}${pg.label && pg.label !== String(i + 1) ? ' · ' + esc(pg.label) : ''}</option>`).join('')}</select>`)}${field('Pages to align', `<input type="text" name="range" value="all" placeholder="e.g. all or 2-5">`)}<label class="check"><input type="checkbox" name="move" checked> Move linked sketches to match</label><p class="muted sm">No grid on the drawings, or bubbles drawn as linework? Place <b>Reference points</b> or <b>Grid lines</b> (Measurements panel) with the same names on each page and line up using those.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Align pages', value: true, primary: true }] });
  if (!r || !r.value) return; const ref = +r.form.ref; const pages = /^\s*all\s*$/i.test(r.form.range) ? [...Array(doc.numPages).keys()] : parseRange(r.form.range, doc.numPages);
  const busy = $('#busy'); busy.hidden = false; busy.textContent = 'Reading grid labels…'; await raf();
  try {
    const before = snapshot(doc); const byMarks = r.form.how === 'marks'; const res = byMarks ? alignByMarks(doc, ref, pages) : await autoAlign(doc, ref, pages);
    if (res.noRef) { toast(byMarks ? `No reference points or grid lines on page ${ref + 1}. Place some there first.` : `No grid labels found on page ${ref + 1}. Place reference points or grid lines instead.`, 'error'); return; }
    doc.undo.push(before); doc.redo = []; markDirty(doc);
    const moved = r.form.move ? realignLinks(doc) : 0; renderAllMarks(doc); refreshPanels(); openRight('measure');
    const shifted = res.ok.filter((o) => { const T = doc.align.T[o.page]; return Math.hypot(T[4], T[5]) > 0.5 || Math.abs(T[1]) > 1e-4; }).length;
    toast(`${res.ok.length} page${res.ok.length === 1 ? '' : 's'} aligned to page ${ref + 1}${shifted ? ` (${shifted} were offset)` : ''}${res.fail.length ? `. No ${byMarks ? 'matching marks' : 'grid match'} on page ${res.fail.map((p) => p + 1).join(', ')}` : ''}${moved ? `. ${moved} linked sketch${moved === 1 ? '' : 'es'} moved.` : ''}`, res.fail.length ? 'error' : undefined);
  } catch (e) { console.error(e); toast('Alignment failed: ' + (e.message || e), 'error'); } finally { busy.hidden = true; }
}
// put every synced linked sketch on its set's grid position
function realignLinks(doc) {
  let n = 0;
  Object.values(doc.links || {}).forEach((L) => {
    if (!L.sync) return; const inst = doc.markups.filter((x) => x.link === L.id).sort((a, b) => a.page - b.page); if (inst.length < 2) return;
    const master = inst.find((x) => doc.align && x.page === doc.align.ref) || inst[0];
    inst.forEach((x) => { if (x === master) return; const c = mapPage(doc, master.page, x.page, master.pts[0]); if (G.dist(c, x.pts[0]) > 0.01) { x.pts = [c]; touch(x); n++; } });
  });
  return n;
}
// keep synced siblings of moved sketches on the same grid position
function syncLinked(doc, ms) {
  const changed = [];
  ms.forEach((m) => { const L = linkOf(doc, m); if (!L || !L.sync) return; linkSiblings(doc, m).forEach((x) => { if (x === m || x.page === m.page) return; x.pts = [mapPage(doc, m.page, x.page, m.pts[0])]; changed.push(x); }); });
  return changed;
}

// ----- reference marks drawn by hand ----------------------------------------------------------------
// For sheets with no grid to read: name reference points (R1, R2…) and grid lines (A, B, 1, 2…) on the
// reference page, put the same names on the same places of the other pages, and every page lines up.
function nextRefLabel(doc, page, type) {
  const used = new Set((doc ? doc.markups : []).filter((m) => m.type === type && m.page === page).map((m) => String(m.text || '').trim()));
  if (type === 'refpt') { let n = 1; while (used.has('R' + n)) n++; return 'R' + n; }
  const last = (doc ? doc.markups : []).filter((m) => m.type === 'gridline' && m.page === page).pop(); const num0 = last && /^\d+$/.test(last.text || '');
  if (num0) { let n = +last.text + 1; while (used.has(String(n))) n++; return String(n); }
  for (let k = 0; k < 26; k++) { const l = String.fromCharCode(65 + k); if (!used.has(l)) return l; } return String(used.size + 1);
}
// named points on a page: reference points, plus where named grid lines cross (labelled "A×1")
function refMarks(doc, page) {
  const pts = new Map(); const lines = [];
  doc.markups.forEach((m) => { if (m.page !== page || !m.text) return; const t = String(m.text).trim().toUpperCase(); if (m.type === 'refpt') pts.set('P:' + t, m.pts[0]); else if (m.type === 'gridline' && m.pts.length > 1) lines.push({ t, a: m.pts[0], b: m.pts[1] }); });
  const dirs = new Map(); lines.forEach((L) => { const d = [L.b[0] - L.a[0], L.b[1] - L.a[1]]; const n = Math.hypot(d[0], d[1]) || 1; dirs.set(L.t, [d[0] / n, d[1] / n]); });
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const A = lines[i], B = lines[j]; const r = [A.b[0] - A.a[0], A.b[1] - A.a[1]], s = [B.b[0] - B.a[0], B.b[1] - B.a[1]]; const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < Math.hypot(...r) * Math.hypot(...s) * 0.34) continue; // nearly parallel (under ~20°)
    const t = ((B.a[0] - A.a[0]) * s[1] - (B.a[1] - A.a[1]) * s[0]) / den; const key = [A.t, B.t].sort().join('×'); pts.set('X:' + key, [A.a[0] + r[0] * t, A.a[1] + r[1] * t]);
  }
  return { pts, dirs };
}
// transform taking page `p` onto the reference page from the marks they share; null when none match
function matchMarks(doc, ref, p) {
  const R = refMarks(doc, ref), Q = refMarks(doc, p); const src = [], dst = [], names = [];
  Q.pts.forEach((q, k) => { const r = R.pts.get(k); if (r) { src.push(q); dst.push(r); names.push(k.slice(2)); } });
  if (!src.length) return null;
  if (src.length === 1) { // one shared point: grid line directions (when there are any) give the turn
    const both = [...Q.dirs.keys()].filter((t) => R.dirs.has(t)); if (both.length) { const t = both[0]; let a = Q.dirs.get(t); const b = R.dirs.get(t); if (a[0] * b[0] + a[1] * b[1] < 0) a = [-a[0], -a[1]]; /* lines drawn either way round */ src.push([src[0][0] + a[0] * 100, src[0][1] + a[1] * 100]); dst.push([dst[0][0] + b[0] * 100, dst[0][1] + b[1] * 100]); }
  }
  let T = fitSimilarity(src, dst); T = cleanAlign(T, src, dst); const s = Math.hypot(T[0], T[1]); if (s < 0.5 || s > 2) return null;
  const rms = Math.sqrt(src.reduce((a, q, k) => { const v = tApply(T, q); return a + (v[0] - dst[k][0]) ** 2 + (v[1] - dst[k][1]) ** 2; }, 0) / src.length);
  return { T, names, rms };
}
function alignByMarks(doc, ref, pages) {
  const res = { ok: [], fail: [] }; if (!refMarks(doc, ref).pts.size) return { ...res, noRef: true };
  doc.align = doc.align && doc.align.ref === ref ? doc.align : { ref, T: {} }; const refT = alignT(doc, ref);
  for (const p of pages) { if (p === ref) continue; const m = matchMarks(doc, ref, p); if (m) { doc.align.T[p] = tMul(refT, m.T); res.ok.push({ page: p, labels: m.names, rms: m.rms }); } else res.fail.push(p); }
  return res;
}
function hasRefMarks(doc) { return doc.markups.some((m) => REF_TYPES.has(m.type)); }
// copy this page's reference marks to other pages at the same place on the sheet, ready to nudge into position
function copyRefMarks(doc, from, pages) {
  const src = doc.markups.filter((m) => m.page === from && REF_TYPES.has(m.type)); let n = 0;
  pages.forEach((p) => { if (p === from || !doc.pages[p]) return; const have = new Set(doc.markups.filter((m) => m.page === p && REF_TYPES.has(m.type)).map((m) => m.type + ':' + String(m.text || '').toUpperCase()));
    src.forEach((m) => { if (have.has(m.type + ':' + String(m.text || '').toUpperCase())) return; const x = { ...deep(m), id: uid(), page: p, pts: m.pts.map((q) => mapPage(doc, from, p, q)), created: nowISO(), modified: nowISO(), author: state.author }; delete x.group; doc.markups.push(x); n++; }); });
  return n;
}
async function copyRefMarksDialog() {
  const doc = activeDoc(); if (!doc) return; const i = currentPage(); const n0 = doc.markups.filter((m) => m.page === i && REF_TYPES.has(m.type)).length;
  if (!n0) { toast('Put reference points or grid lines on this page first (Measurements panel)', 'error'); return; }
  const r = await openDialog({ title: 'Copy reference marks', body: `<p>Copy the ${n0} reference mark${n0 === 1 ? '' : 's'} on page ${i + 1} to the same place on other pages. Then drag each copy onto the same feature of that drawing and align.</p>${field('Pages', '<input type="text" name="range" value="all" placeholder="e.g. all or 2-5">')}`, buttons: [{ label: 'Cancel', value: false }, { label: 'Copy', value: true, primary: true }] });
  if (!r || !r.value) return; const pages = /^\s*all\s*$/i.test(r.form.range) ? [...Array(doc.numPages).keys()] : parseRange(r.form.range, doc.numPages);
  pushUndo(doc); const n = copyRefMarks(doc, i, pages); renderAllMarks(doc); refreshPanels(); toast(n ? `${n} mark${n === 1 ? '' : 's'} copied. Move them onto the drawing on each page, then Align pages.` : 'Those pages already have these marks');
}

// ----- manual alignment: pick the same two grid intersections on both pages ---------------
function startAlignPick(page) {
  const doc = activeDoc(); if (!doc) return; const ref = doc.align ? doc.align.ref : page === 0 ? null : 0;
  if (ref == null || ref === page) { toast('Pick a page other than the reference page, or choose a different reference in the Measurements panel', 'error'); return; }
  setTool('alignpts'); state.alignPick = { ref, page, step: 0, pts: [] }; goToPage(ref); updateDraftBar(); renderDraft();
  if (!state.snapContent) toggleAid('snapContent');
}
const ALIGN_STEPS = ['first grid intersection on the reference page', 'second grid intersection on the reference page (far from the first)', 'same first intersection on this page', 'same second intersection on this page'];
function alignPickText() { const a = state.alignPick; if (!a) return ''; const pg = a.step < 2 ? a.ref : a.page; return `<span><b>Align page ${a.page + 1}</b> · click the ${ALIGN_STEPS[a.step]} (page ${pg + 1}) · ${a.step + 1} of 4</span><button class="btn sm" data-a="cancel-align">Cancel</button>`; }
function alignPickClick(p, i) {
  const a = state.alignPick; if (!a) return; const want = a.step < 2 ? a.ref : a.page;
  if (i !== want) { toast(`Click on page ${want + 1}`); goToPage(want, a.step === 2 ? a.pts[0] : a.step === 3 ? a.pts[2] || a.pts[1] : undefined); return; }
  a.pts.push(p); a.step++;
  if (a.step === 2) { const pg = a.page; setTimeout(() => goToPage(pg, a.pts[0]), 250); }
  if (a.step === 3) goToPage(a.page, a.pts[2]);
  if (a.step >= 4) { finishAlignPick(); return; }
  updateDraftBar(); renderDraft();
}
function finishAlignPick() {
  const doc = activeDoc(); const a = state.alignPick; state.alignPick = null; if (!doc || !a || a.pts.length < 4) return;
  const dst = [a.pts[0], a.pts[1]], src = [a.pts[2], a.pts[3]];
  if (G.dist(dst[0], dst[1]) < 20 || G.dist(src[0], src[1]) < 20) { toast('Pick two intersections further apart', 'error'); setTool('select'); return; }
  pushUndo(doc); doc.align = doc.align || { ref: a.ref, T: {} };
  const refT = alignT(doc, a.ref); const T = tMul(refT, cleanAlign(fitSimilarity(src, dst), src, dst)); doc.align.T[a.page] = T;
  const moved = realignLinks(doc); setTool('select'); renderAllMarks(doc); refreshPanels(); openRight('measure');
  toast(`Page ${a.page + 1} aligned. ${alignSummary(doc, a.page)}${moved ? `. ${moved} linked sketch${moved === 1 ? '' : 'es'} moved.` : ''}`);
}
function cancelAlignPick() { if (!state.alignPick) return; state.alignPick = null; if (state.tool === 'alignpts') setTool('select'); updateDraftBar(); renderDraft(); }
function alignPickSvg(doc, page, z) {
  const a = state.alignPick; if (!a) return ''; let s = '';
  a.pts.forEach((p, k) => { const pg = k < 2 ? a.ref : a.page; if (pg !== page) return; const r = 9 / z, sw = num(1.6 / z, 3); s += `<g class="apick"><circle cx="${num(p[0], 2)}" cy="${num(p[1], 2)}" r="${num(r, 2)}" stroke-width="${sw}"/><path d="M${num(p[0] - r * 1.6, 2)} ${num(p[1], 2)}H${num(p[0] + r * 1.6, 2)}M${num(p[0], 2)} ${num(p[1] - r * 1.6, 2)}V${num(p[1] + r * 1.6, 2)}" stroke-width="${sw}"/><text x="${num(p[0] + r * 1.3, 2)}" y="${num(p[1] - r * 1.3, 2)}" font-size="${num(12 / z, 2)}">${(k % 2) + 1}</text></g>`; });
  return s;
}
function clearAlignment(pages) {
  const doc = activeDoc(); if (!doc || !doc.align) return; pushUndo(doc);
  if (!pages) doc.align = null; else pages.forEach((p) => { if (doc.align.T) delete doc.align.T[p]; });
  renderAllMarks(doc); refreshPanels(); toast(pages ? 'Alignment removed for this page' : 'Page alignment cleared');
}
