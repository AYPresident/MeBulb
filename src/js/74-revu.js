// ===== Bluebeam Revu compatibility ==============================================================
// MeBulb writes its markups the way Revu writes its own: measurements carry Revu's /IT types,
// /MeasurementTypes and a /Measure scale with a caption, counts are Revu count groups, callouts
// have /CL leaders, layers are optional content groups and page scales are standard viewports.
// Revu then lists, measures and edits them as its own markups. In the other direction, Revu's
// markups (and those of Acrobat and other viewers) open in MeBulb as editable markups and are
// written back in place, keeping their identity (NM), custom columns and replies.
const BB_MEASURE = {
  length: ['Line', 'LineDimension', 130, 'Length Measurement'], polylength: ['PolyLine', 'PolyLineDimension', 130, 'Polylength Measurement'], perimeter: ['PolyLine', 'PolyLineDimension', 130, 'Perimeter Measurement'],
  area: ['Polygon', 'PolygonDimension', 129, 'Area Measurement'], volume: ['Polygon', 'PolygonVolume', 132, 'Volume Measurement'], count: ['Polygon', 'PolygonCount', 128, 'Count Measurement'],
  angle: ['PolyLine', 'PolyLineAngle', 1152, 'Angle Measurement'], radius: ['Polygon', 'PolygonRadius', 130, 'Radius Measurement'],
};
const BB_COUNT_STYLE = { circle: 'Circle', square: 'Square', check: 'Checkmark', triangle: 'Triangle', diamond: 'Diamond', star: 'Star', cross: 'Cross', plus: 'Plus', pentagon: 'Pentagon', hexagon: 'Hexagon' };
const BB_COUNT_FROM = Object.fromEntries(Object.entries(BB_COUNT_STYLE).map(([k, v]) => [v, k]));
const pStr = (v) => PDFString.of(String(v));
const T16 = (v) => PDFHexString.fromText(String(v == null ? '' : v));
const isOurs = (d) => !!(d && (d.get(PDFName.of('MeBulbId')) || pdfText(d.get(PDFName.of('NM'))).startsWith('PM-')));

// ----- scales as PDF measure dictionaries ------------------------------------------------------------
function numberFormat(o) { const d = { Type: 'NumberFormat', U: pStr(o.U), C: +o.C, F: o.F || 'D', D: o.D || 100, FD: true, SS: pStr(o.SS || ''), PS: pStr(o.PS || '') }; if (o.RT != null) d.RT = pStr(o.RT); return d; }
function measureDict(ctx, sc) {
  const u = UNITS[sc.unit] || UNITS.in; const unitPerPt = sc.inPerPt * u.perIn; const prec = sc.prec == null ? 2 : sc.prec;
  let X, D;
  if (sc.fmt === 'ftin') { const den = sc.prec || 16; X = [numberFormat({ U: "'", C: sc.inPerPt / 12, F: 'F', D: den })]; D = [numberFormat({ U: "'", C: 1, F: 'F', D: den, SS: '-' }), numberFormat({ U: '"', C: 12, F: 'F', D: den })]; }
  else { const dd = Math.pow(10, Math.max(0, Math.min(6, prec))); X = [numberFormat({ U: u.label, C: unitPerPt, D: dd })]; D = [numberFormat({ U: u.label, C: 1, D: dd })]; }
  const A = [numberFormat({ U: u.area, C: sc.fmt === 'ftin' ? 1 : areaPerUnit2(sc.unit), D: 100 })];
  return ctx.obj({ Type: 'Measure', Subtype: 'RL', R: pStr(sc.label || '1:1'), X, D, A, T: [numberFormat({ U: '°', C: 1, D: 100 })], V: [numberFormat({ U: u.vol, C: 1, D: 100 })], O: [0, 0] });
}
// square display units -> reported area units (mm display still reports m²)
function areaPerUnit2(unit) { return { mm: 1e-6, cm: 1e-4, m: 1, ft: 1, in: 1, yd: 1, mi: 1 }[unit] || 1; }
// a Revu/PDF measure dictionary back to a MeBulb scale
function scaleFromMeasure(Mz, label) {
  if (!(Mz instanceof PDFDict)) return null; const X = Mz.lookup(PDFName.of('X')); const x0 = X instanceof PDFArray ? X.lookup(0) : null; if (!(x0 instanceof PDFDict)) return null;
  const C = nOf(x0.lookup(PDFName.of('C'))); const U = pdfText(x0.lookup(PDFName.of('U'))).trim(); if (!C || !isFinite(C)) return null;
  const map = { "'": 'ft', ft: 'ft', feet: 'ft', '"': 'in', in: 'in', m: 'm', mm: 'mm', cm: 'cm', yd: 'yd', mi: 'mi', km: 'm' }; let unit = map[U.toLowerCase()] || map[U] || 'in';
  const Dv = Mz.lookup(PDFName.of('D')); const two = Dv instanceof PDFArray && Dv.size() > 1; const F = x0.lookup(PDFName.of('F')); const frac = F && F.asString && F.asString() === '/F';
  const inPerPt = (C * (U.toLowerCase() === 'km' ? 1000 : 1)) / UNITS[unit].perIn;
  const prec = frac ? nOf(x0.lookup(PDFName.of('D'))) || 16 : Math.round(Math.log10(nOf(x0.lookup(PDFName.of('D'))) || 100));
  return { inPerPt, unit, fmt: unit === 'ft' && (two || frac) ? 'ftin' : 'dec', prec, label: label || pdfText(Mz.lookup(PDFName.of('R'))) || 'Imported scale', metric: ['m', 'mm', 'cm'].includes(unit), imported: true };
}
// page /VP: the page scale plus any viewports with their own scale
function viewportArray(ctx, doc, i) {
  const pg = doc.pages[i]; const M = invertT(pg.T); const box = (x, y, w, h) => { const b = G.bbox([[x, y], [x + w, y + h]].map((p) => applyT(M, p))); return [b.x, b.y, b.x2, b.y2]; };
  const out = []; const sc = doc.scales[i];
  if (sc && !sc.unset) out.push(ctx.obj({ Type: 'Viewport', BBox: box(0, 0, pg.w, pg.h), Name: T16(sc.label || 'Page scale'), Measure: measureDict(ctx, sc) }));
  ((doc.viewports || {})[i] || []).forEach((v) => { if (v.scale) out.push(ctx.obj({ Type: 'Viewport', BBox: box(v.x, v.y, v.w, v.h), Name: T16(v.name || 'Viewport'), Measure: measureDict(ctx, v.scale) })); });
  return out;
}
function vpSig(doc, i) { const sc = doc.scales[i]; return JSON.stringify([sc && !sc.unset ? [sc.label, +sc.inPerPt.toFixed(9), sc.unit, sc.fmt, sc.prec] : null, ((doc.viewports || {})[i] || []).map((v) => [v.x, v.y, v.w, v.h, v.scale && v.scale.inPerPt])]); }

// ----- caption text the way Revu writes it ----------------------------------------------------------
function revuCaption(text, s, align = 'center') {
  const size = s.fontSize || 10; const col = cssColor(s.fontColor || s.stroke || '#000000'); const font = cssFontName(s.font);
  const style = `font: ${font} ${num(size, 2)}pt; text-align:${align}; line-height:${num(size * 1.15, 2)}pt; color:${col}`;
  const rc = `<?xml version="1.0"?><body xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:contentType="text/html" xfa:APIVersion="BluebeamPDFRevu:2018" xfa:spec="2.2.0" style="${style}" xmlns="http://www.w3.org/1999/xhtml"><p>${esc(text || '')}</p></body>`;
  return { DS: pStr(style), RC: xmlAsciiHex(rc) };
}
function dashArr(s) { const w = s.width || 1; return s.dash === 'dashed' ? [w * 4 + 2, w * 3 + 1.5] : s.dash === 'dotted' ? [Math.max(w, 0.5), w * 2.2 + 1] : s.dash === 'dashdot' ? [w * 5 + 3, w * 2 + 1.5, Math.max(w, 0.5), w * 2 + 1.5] : null; }

// Revu's keys on top of the plain annotation dictionary
function revuDecorate(A, m, doc, ctx, M, info) {
  const s = m.style; const P = (p) => applyT(M, p); const rgb01 = (c) => (hexToRgb(c) || [0, 0, 0]).map((v) => +(v / 255).toFixed(4));
  const da = dashArr(s); A.BS = { Type: 'Border', W: s.width || 0, S: da ? 'D' : 'S' }; if (da) A.BS.D = da.map((v) => +v.toFixed(2)); delete A.Border;
  const filled = s.fill && s.fill !== 'none';
  if (filled && ['Square', 'Circle', 'Polygon'].includes(A.Subtype)) { A.IC = rgb01(s.fill); A.FillOpacity = +(s.fillOpacity == null ? 1 : s.fillOpacity).toFixed(3); }
  if (s.cloud && (A.Subtype === 'Square' || A.Subtype === 'Polygon')) { A.BE = { S: 'C', I: Math.max(0, Math.min(2, Math.round((s.cloudArc || 14) / 10))) }; if (A.Subtype === 'Polygon' && !MEASURE_TYPES.has(m.type)) A.IT = 'PolygonCloud'; }
  if (m.type === 'arrow') A.IT = 'LineArrow';
  if (['line', 'arrow', 'polyline', 'length', 'polylength'].includes(m.type)) {
    const def = m.type === 'length' || m.type === 'polylength' ? 'butt' : 'none'; const le = [LE_TO_PDF[s.arrowStart || def] || 'None', LE_TO_PDF[s.arrowEnd || def] || 'None'];
    if (le.some((x) => x !== 'None')) { A.LE = le; A.IC = A.IC || rgb01(s.stroke); }
  }
  if (m.layer) { const L = layerOf(doc, m.layer); if (L && doc._ocg && doc._ocg[L.id]) A.OC = doc._ocg[L.id]; }
  if (m.ext && m.ext.bsi) A.BSIColumnData = m.ext.bsi.map((x) => T16(x));
  const B = BB_MEASURE[m.type];
  if (B && info) {
    const sc = scaleForMarkup(doc, m); A.Subtype = B[0]; A.IT = B[1]; A.MeasurementTypes = B[2]; if (!m.subject) A.Subj = T16(B[3]);
    A.Measure = measureDict(ctx, sc); A.Label = T16(m.text || ''); const cap = revuCaption(info.text, s); A.DS = cap.DS; A.RC = cap.RC;
    if (m.type === 'length') { A.Cap = true; A.L = [...P(m.pts[0]), ...P(m.pts[m.pts.length - 1])]; }
    if (m.type === 'perimeter') A.Vertices = [...m.pts, m.pts[0]].map(P).flat();
    if (m.type === 'radius' && m.ext && m.ext.it === 'CircleDimension') { A.Subtype = 'Circle'; A.IT = 'CircleDimension'; A.MeasurementTypes = 384; delete A.Vertices; if (!m.subject) A.Subj = T16('Diameter Measurement'); }
    else if (m.type === 'radius') { const [c, e] = m.pts; A.Vertices = [c, e, c].map(P).flat(); }
    if (m.type === 'volume' && m.depth != null) { A.Depth = +(+m.depth).toFixed(6); A.DepthUnit = [numberFormat({ U: (UNITS[sc.unit] || UNITS.in).label, C: 1, D: 100 })]; }
  }
  if (m.type === 'callout') {
    const L = textLayout(m); const tip = m.pts[0]; const cands = [[L.x, L.y + L.h / 2], [L.x + L.w, L.y + L.h / 2], [L.x + L.w / 2, L.y], [L.x + L.w / 2, L.y + L.h]]; let best = cands[0]; for (const c of cands) if (G.dist(c, tip) < G.dist(best, tip)) best = c;
    A.IT = 'FreeTextCallout'; A.CL = [...P(tip), ...P(best), ...P(best)]; A.LE = LE_TO_PDF[s.arrowEnd || 'arrow'] || 'OpenArrow';
    const box = G.bbox([[L.x, L.y], [L.x + L.w, L.y + L.h]].map(P)); A.RD = [box.x - A.Rect[0], box.y - A.Rect[1], A.Rect[2] - box.x2, A.Rect[3] - box.y2].map((v) => +Math.max(0, v).toFixed(3));
  }
  if (TEXT_TYPES.has(m.type)) { A.C = filled ? rgb01(s.fill) : []; if (filled) A.FillOpacity = +(s.fillOpacity == null ? 1 : s.fillOpacity).toFixed(3); }
}

// ----- layers as optional content (Revu's layers) ------------------------------------------------------
// Builds OCGs for MeBulb layers used by markups; returns the catalog /OCProperties merged with the
// file's own layers (drawing layers from CAD stay as they are).
async function layerOcgs(pdfDoc, doc, existing, resolve) {
  const ctx = pdfDoc.context; doc._ocg = {}; const used = new Set(doc.markups.map((m) => m.layer).filter(Boolean)); if (!used.size && !existing) return null;
  const P0 = existing ? await resolve(existing) : null; const keep = []; const order = []; const on = []; const off = [];
  const asArr = async (o) => { const a = await resolve(o); return a instanceof PDFArray ? a.asArray() : []; };
  if (P0 instanceof PDFDict) {
    for (const r of await asArr(P0.get(PDFName.of('OCGs')))) { const g = await resolve(r); if (!(g instanceof PDFDict && g.get(PDFName.of('MeBulbLayer')))) keep.push(r); }
    const D0 = await resolve(P0.get(PDFName.of('D'))); if (D0 instanceof PDFDict) { const kk = new Set(keep.map((r) => String(r))); for (const k of ['Order', 'ON', 'OFF']) for (const r of await asArr(D0.get(PDFName.of(k)))) if (!(r instanceof PDFRef) || kk.has(String(r))) (k === 'Order' ? order : k === 'ON' ? on : off).push(r); }
  }
  doc.layers.filter((l) => used.has(l.id)).forEach((l) => { const r = ctx.register(ctx.obj({ Type: 'OCG', Name: T16(l.name || 'Layer'), MeBulbLayer: pStr(l.id), Usage: {} })); doc._ocg[l.id] = r; keep.push(r); order.push(r); (l.visible === false ? off : on).push(r); });
  if (!keep.length) return null;
  return ctx.obj({ OCGs: keep, D: { Name: pStr('Layers'), Order: order, ON: on, OFF: off, BaseState: 'ON' } });
}

// ----- counts: one annotation per symbol, grouped the way Revu groups them ------------------------------
async function countAnnots(pdfDoc, fonts, imgCache, doc, i, pageRef, m, base) {
  const ctx = pdfDoc.context; const M = invertT(doc.pages[i].T); const cm = `${M.map((v) => num(v, 6)).join(' ')} cm`; const n = m.pts.length; const refs = [];
  const primary = ctx.nextRef(); const nms = [];
  for (let k = 0; k < n; k++) {
    const one = { ...m, pts: [m.pts[k]], _countTotal: n, style: { ...m.style, numStart: k, labelBg: k === 0 ? m.style.labelBg : false } };
    const prims = dl(one, doc); const vb = primsBBox(prims); if (!vb) continue; const rb = G.bbox([[vb.x, vb.y], [vb.x2, vb.y2]].map((p) => applyT(M, p)));
    const ops = new Ops(doc); ops.s.push(cm); prims.forEach((p) => ops.prim(p)); const res = await resourcesFor(pdfDoc, ops, fonts, imgCache);
    const rect = [rb.x, rb.y, rb.x2, rb.y2]; const ap = ctx.register(ctx.flateStream(ops.toString(), { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect, Resources: res }));
    const sym = countSymbol(m.pts[k], m.style.size || 6, m.style.symbol || 'circle', m.style, m.style.fill)[0]; const verts = (sym.d || []).filter((c) => c[0] === 'M' || c[0] === 'L').map((c) => applyT(M, [c[1], c[2]])).flat();
    const nm = (m.ext && m.ext.nms && m.ext.nms[k]) || (k ? `${m.id}-${k}` : m.id); nms.push(nm);
    const A = { ...base, Rect: rect, AP: { N: ap }, NM: pStr(nm), MeBulbId: pStr(k ? `${m.id}#${k}` : m.id), Vertices: verts.map((v) => +v.toFixed(3)), CountStyle: BB_COUNT_STYLE[m.style.symbol || 'circle'] || 'Circle', NumCounts: n, Version: 1 };
    revuDecorate(A, one, doc, ctx, M, measureInfo(one, doc)); A.Subtype = 'Polygon'; A.IT = 'PolygonCount'; A.MeasurementTypes = 128; A.BBMeasure = A.Measure; delete A.Measure;
    A.Contents = T16(k === 0 ? (m.text ? `${m.text}\r${n}` : `${n}`) : `${n}`);
    if (k) { A.IRT = primary; A.RT = 'Group'; refs.push(ctx.register(ctx.obj(A))); }
    else { refs.push(primary); base._primary = A; }
  }
  if (base._primary) { base._primary.GroupNesting = [T16(m.subject || 'Count Measurement'), ...nms.map((x) => PDFName.of(x.replace(/[^A-Za-z0-9_.-]/g, '_')))]; ctx.assign(primary, ctx.obj(base._primary)); delete base._primary; }
  return refs;
}

// ----- reading other apps' markups -----------------------------------------------------------------------
// returns { markups, hide: Map(page -> Set(refKey)), imported: Set(refKey) }
async function importAnnotations(doc, payload) {
  // read the file as saved, not the on-screen copy (that one has MeBulb's own content stripped out)
  const R = doc.reader && doc.base && doc.reader.src === doc.base.src ? doc.reader : doc.viewReader; if (!R) return null; const P = await R.pages(); const out = []; const hide = new Map(); const imported = new Set(); const byNm = new Map();
  const known = new Map(); (doc.markups || []).forEach((m) => { known.set(m.id, m); if (m.ext && m.ext.nm) known.set(m.ext.nm, m); });
  const written = new Set((payload && payload.written) || []); const seen = new Set(); const now = Date.now(); const layerByName = new Map((doc.layers || []).map((l) => [l.name, l]));
  for (let i = 0; i < P.length && i < doc.numPages; i++) {
    const pd = await R.get(P[i].ref); const T = doc.pages[i].T;
    // page scale and viewports from /VP (Revu calibration), unless MeBulb's own data already has them
    if (!(payload && payload.scales && payload.scales[i]) && pd.get(PDFName.of('VP'))) {
      try { await R.pull(pd.get(PDFName.of('VP'))); const vp = await R.resolve(pd.get(PDFName.of('VP'))); const pg = doc.pages[i];
        for (const v of vp instanceof PDFArray ? vp.asArray() : []) { const V = await R.resolve(v); if (!(V instanceof PDFDict)) continue; const sc = scaleFromMeasure(V.lookup(PDFName.of('Measure')), pdfText(V.lookup(PDFName.of('Name')))); if (!sc) continue;
          const bb = V.lookup(PDFName.of('BBox')); const b = bb ? G.bbox([[nOf(bb.lookup(0)), nOf(bb.lookup(1))], [nOf(bb.lookup(2)), nOf(bb.lookup(3))]].map(([x, y]) => applyT(T, [x, y]))) : { x: 0, y: 0, w: pg.w, h: pg.h };
          if (b.w * b.h > 0.85 * pg.w * pg.h) doc.scales[i] = sc; else { doc.viewports = doc.viewports || {}; (doc.viewports[i] = doc.viewports[i] || []).push({ id: uid('VP'), name: sc.label, x: b.x, y: b.y, w: b.w, h: b.h, scale: sc }); } } } catch (e) { console.warn('viewport import', e); }
    }
    const arr = await R.resolve(pd.get(PDFName.of('Annots'))); if (!(arr instanceof PDFArray)) continue; const groups = new Map(); const pageHide = new Set(); const items = [];
    for (const ref of arr.asArray()) { if (!(ref instanceof PDFRef)) continue; let d; try { d = await R.get(ref); } catch { continue; } if (!(d instanceof PDFDict)) continue; items.push({ ref, d }); }
    const byRef = new Map(items.map((x) => [refKey(x.ref), x]));
    for (const { ref, d } of items) {
      const sub = (d.get(PDFName.of('Subtype')) || { asString: () => '' }).asString().slice(1); const nm = pdfText(d.get(PDFName.of('NM'))); const mid = pdfText(d.get(PDFName.of('MeBulbId')));
      if (sub === 'Popup') { const par = d.get(PDFName.of('Parent')); if (par && byRef.has(refKey(par))) { const pp = byRef.get(refKey(par)).d; const ps = pdfText(pp.get(PDFName.of('Subtype'))); if (convertible(pp)) { pageHide.add(refKey(ref)); imported.add(refKey(ref)); } } continue; }
      if (isOurs(d)) {
        pageHide.add(refKey(ref)); const id = (mid || nm).split('#')[0]; const m = known.get(id) || known.get(nm); if (m) seen.add(m.id);
        // edited in Revu since MeBulb saved it? take the change
        const mod = pdfDate2ms(pdfText(d.get(PDFName.of('M')))); if (m && !mid.includes('#') && mod && mod > (Date.parse(m.modified || 0) || 0) + 2000) { const c = await toMarkup(R, d, ref, i, T, layerByName, doc); if (c) mergeExternal(m, c); }
        continue;
      }
      if (!convertible(d)) continue;
      const irt = d.get(PDFName.of('IRT')); const rt = d.get(PDFName.of('RT'));
      if (irt && rt && rt.asString && rt.asString() === '/Group') { const k = refKey(irt); if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ ref, d }); pageHide.add(refKey(ref)); imported.add(refKey(ref)); continue; }
      if (irt) continue; // replies and review states stay as they are
      const m = await toMarkup(R, d, ref, i, T, layerByName, doc); if (!m) continue;
      if (known.has(nm)) { seen.add(known.get(nm).id); pageHide.add(refKey(ref)); imported.add(refKey(ref)); continue; } // already imported earlier (saved by MeBulb with its NM)
      out.push(m); byNm.set(refKey(ref), m); pageHide.add(refKey(ref)); imported.add(refKey(ref));
    }
    // count groups: members join their primary
    groups.forEach((members, k) => { const prim = byNm.get(k); if (!prim || prim.type !== 'count') return; members.forEach(({ d, ref }) => { const r = d.lookup(PDFName.of('Rect')); if (!r) return; const a = r.asArray().map(nOf); prim.pts.push(applyT(T, [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2])); prim.ext.nms.push(pdfText(d.get(PDFName.of('NM')))); prim.ext.refs.push(refKey(ref)); }); });
    if (pageHide.size) hide.set(i, pageHide);
  }
  // markups MeBulb wrote that are gone from the file were deleted in another app
  const removed = (doc.markups || []).filter((m) => written.has(m.id) && !seen.has(m.id));
  return { markups: out, hide, imported, removed };
}
function convertible(d) { const sub = (d.get(PDFName.of('Subtype')) || { asString: () => '' }).asString().slice(1); return ['Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'FreeText', 'Text', 'Highlight', 'StrikeOut', 'Underline', 'Squiggly', 'Stamp'].includes(sub); }
function pdfDate2ms(s) { const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?/.exec(s || ''); if (!m) return 0; const t = Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0); const off = m[7] === '+' || m[7] === '-' ? (m[7] === '+' ? 1 : -1) * ((+m[8] || 0) * 60 + (+m[9] || 0)) * 60000 : 0; return t - off; }
function pdfDateIso(s) { const t = pdfDate2ms(s); return t ? new Date(t).toISOString() : nowISO(); }
const pdfRgbHex = (a) => (a instanceof PDFArray && a.size() >= 3 ? '#' + a.asArray().slice(0, 3).map((v) => Math.round(clamp(nOf(v), 0, 1) * 255).toString(16).padStart(2, '0')).join('') : null);
// one PDF annotation -> one MeBulb markup
async function toMarkup(R, d, ref, i, T, layerByName, doc) {
  await R.pull(d); // indirect values (measure dictionaries, colours, quad points) become directly readable
  const g = (k) => d.get(PDFName.of(k)); const L = (k) => d.lookup(PDFName.of(k)); const sub = g('Subtype').asString().slice(1); const it = g('IT') ? g('IT').asString().slice(1) : '';
  const tp = (x, y) => applyT(T, [x, y]); const nums = (k) => { const a = L(k); return a instanceof PDFArray ? a.asArray().map(nOf) : null; }; const pairs = (a) => { const o = []; for (let k = 0; k + 1 < (a || []).length; k += 2) o.push(tp(a[k], a[k + 1])); return o; };
  const rect = nums('Rect') || [0, 0, 0, 0]; const rd = nums('RD') || [0, 0, 0, 0]; const inner = [rect[0] + rd[0], rect[1] + rd[1], rect[2] - rd[2], rect[3] - rd[3]];
  const stroke = pdfRgbHex(L('C')) || '#d6331f'; const fillC = pdfRgbHex(L('IC')); const ca = L('CA') ? nOf(L('CA')) : 1; const bs = L('BS'); const w = bs instanceof PDFDict && bs.lookup(PDFName.of('W')) ? nOf(bs.lookup(PDFName.of('W'))) : 1;
  const dashed = bs instanceof PDFDict && bs.lookup(PDFName.of('S')) && bs.lookup(PDFName.of('S')).asString() === '/D'; const be = L('BE'); const cloud = be instanceof PDFDict && be.lookup(PDFName.of('S')) && be.lookup(PDFName.of('S')).asString() === '/C';
  const fo = L('FillOpacity') ? nOf(L('FillOpacity')) : fillC ? 1 : 0.25;
  const ocg = await R.resolve(g('OC')); let layer = null; if (ocg instanceof PDFDict) { const name = pdfText(ocg.lookup(PDFName.of('Name'))) || 'Layer'; layer = layerByName.get(name); if (!layer) { layer = { id: uid('L'), name, visible: true, locked: false }; layerByName.set(name, layer); doc.layers = doc.layers || []; doc.layers.push(layer); } }
  const bsi = L('BSIColumnData'); const ext = { nm: pdfText(g('NM')) || null, ref: refKey(ref), it, sub, bsi: bsi instanceof PDFArray ? bsi.asArray().map(pdfText) : null, nms: [], refs: [] };
  const style = { stroke, width: w, opacity: ca, dash: dashed ? 'dashed' : 'solid', fill: ['Square', 'Circle', 'Polygon'].includes(sub) && fillC ? fillC : 'none', fillOpacity: fo, cloud: !!cloud, cloudArc: cloud ? 10 + 10 * (nOf(be.lookup(PDFName.of('I'))) || 1) : undefined };
  const m = { id: uid(), page: i, type: null, pts: [], style, author: pdfText(g('T')), subject: pdfText(g('Subj')), created: pdfDateIso(pdfText(g('CreationDate')) || pdfText(g('M'))), modified: pdfDateIso(pdfText(g('M'))), layer: layer ? layer.id : '', ext, comment: '' };
  const contents = pdfText(g('Contents')); const label = pdfText(g('Label'));
  const le = L('LE'); const leNames = le instanceof PDFArray ? le.asArray().map((x) => x.asString().slice(1)) : le ? [le.asString().slice(1)] : [];
  const Mz = L('Measure') || L('BBMeasure');
  if (Mz) { const sc = scaleFromMeasure(Mz); if (sc && !doc.scales[i]) doc.scales[i] = sc; }
  switch (sub) {
    case 'Square': m.type = 'rect'; m.pts = [tp(inner[0], inner[3]), tp(inner[2], inner[1])]; break;
    case 'Circle': if (it === 'CircleDimension') { m.type = 'radius'; const c = tp((inner[0] + inner[2]) / 2, (inner[1] + inner[3]) / 2); m.pts = [c, tp(inner[2], (inner[1] + inner[3]) / 2)]; break; } m.type = 'ellipse'; m.pts = [tp(inner[0], inner[3]), tp(inner[2], inner[1])]; break;
    case 'Line': { const l = nums('L') || []; m.pts = pairs(l); m.type = it === 'LineDimension' || Mz ? 'length' : it === 'LineArrow' ? 'arrow' : 'line'; style.arrowStart = LE_FROM_PDF[leNames[0]] || 'none'; style.arrowEnd = LE_FROM_PDF[leNames[1]] || 'none'; if (m.type === 'arrow' && style.arrowEnd === 'none') style.arrowEnd = 'arrow'; m.text = m.type === 'length' ? label : ''; if (m.type !== 'length') m.comment = contents; break; }
    case 'PolyLine': { m.pts = pairs(nums('Vertices')); if (it === 'PolyLineAngle') { m.type = 'angle'; m.pts = m.pts.slice(0, 3); } else if (it === 'PolyLineDimension' || Mz) { const closed = /perimeter/i.test(m.subject) || (m.pts.length > 3 && G.dist(m.pts[0], m.pts[m.pts.length - 1]) < 0.5); m.type = closed ? 'perimeter' : 'polylength'; if (closed && G.dist(m.pts[0], m.pts[m.pts.length - 1]) < 0.5) m.pts.pop(); m.text = label; } else { m.type = 'polyline'; style.arrowStart = LE_FROM_PDF[leNames[0]] || 'none'; style.arrowEnd = LE_FROM_PDF[leNames[1]] || 'none'; m.comment = contents; } break; }
    case 'Polygon': {
      m.pts = pairs(nums('Vertices')); m.text = label;
      if (it === 'PolygonCount') { const r = nums('Rect'); m.type = 'count'; m.pts = [tp((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)]; const cs = L('CountStyle'); style.symbol = BB_COUNT_FROM[cs ? cs.asString().slice(1) : 'Circle'] || 'circle'; style.size = Math.max(2, Math.min(r[2] - r[0], r[3] - r[1]) / 2); style.fill = fillC || stroke; style.fillOpacity = fo || 0.85; ext.nms = [ext.nm]; ext.refs = [ext.ref]; m.text = label || (contents.includes('\r') ? contents.split('\r')[0] : ''); }
      else if (it === 'PolygonVolume') { m.type = 'volume'; m.depth = L('Depth') ? nOf(L('Depth')) : null; }
      else if (it === 'PolygonDimension' || Mz && it !== 'PolygonRadius') m.type = 'area';
      else if (it === 'PolygonRadius') { m.type = 'radius'; m.pts = m.pts.slice(0, 2); }
      else { m.type = cloud || it === 'PolygonCloud' ? 'cloud' : 'polygon'; if (m.type === 'cloud') style.cloud = true; m.comment = contents; m.text = ''; }
      break;
    }
    case 'Ink': { const ink = L('InkList'); const strokes = ink instanceof PDFArray ? ink.asArray().map((a) => pairs((a instanceof PDFArray ? a : PDFArray.withContext(R.ctx)).asArray().map(nOf))) : []; m.pts = strokes[0] || []; m.type = /highlight/i.test(m.subject) || (ca < 0.9 && w >= 6) ? 'highlight' : 'pen'; if (m.type === 'highlight') { style.blend = 'multiply'; } m.comment = contents; if (strokes.length > 1) m.ext.extraInk = strokes.slice(1); break; }
    case 'FreeText': {
      m.type = it === 'FreeTextCallout' ? 'callout' : 'text'; const ft = freeTextStyle(d); Object.assign(style, ft.style); style.width = w; style.stroke = ft.border || ft.style.fontColor || stroke; style.fill = pdfRgbHex(L('C')) || 'none'; style.fillOpacity = L('FillOpacity') ? nOf(L('FillOpacity')) : 1;
      const box = [tp(inner[0], inner[3]), tp(inner[2], inner[1])];
      if (m.type === 'callout') { const cl = nums('CL') || []; const tip = cl.length >= 2 ? tp(cl[0], cl[1]) : box[0]; m.pts = [tip, ...box]; style.arrowEnd = LE_FROM_PDF[leNames[0]] || 'open'; } else m.pts = box;
      m.text = contents; const runs = parseRC(pdfText(g('RC')), style); if (runs) setRuns(m, runs); break;
    }
    case 'Text': { m.type = 'note'; m.pts = [tp(rect[0], rect[3])]; style.fill = stroke; style.stroke = darken(stroke); m.comment = contents; break; }
    case 'Highlight': case 'StrikeOut': case 'Underline': case 'Squiggly': {
      const q = nums('QuadPoints') || []; const pts = []; for (let k = 0; k + 7 < q.length; k += 8) { const [x1, y1, x2, y2, x3, y3, x4, y4] = q.slice(k, k + 8); pts.push(tp(x1, y1), tp(x2, y2), tp(x4, y4), tp(x3, y3)); }
      m.pts = pts; if (sub === 'Highlight') { m.type = 'texthl'; style.blend = 'multiply'; style.opacity = ca < 1 ? ca : 0.5; } else { m.type = 'strikeout'; style.variant = sub === 'StrikeOut' ? 'strike' : 'under'; } m.comment = contents; break;
    }
    case 'Stamp': { const asset = await stampFromAP(R, d, doc); if (!asset) return null; m.type = 'stamp'; m.pts = [tp(rect[0], rect[3]), tp(rect[2], rect[1])]; m.asset = asset; m.text = pdfText(g('Name')).replace(/^\//, '') || 'Stamp'; m.comment = contents; break; }
    default: return null;
  }
  if (!m.pts.length) return null;
  if (BOX_TYPES.has(m.type) || TEXT_TYPES.has(m.type)) { /* already corner points */ }
  return m;
}
// DA / DS defaults of a text box
function freeTextStyle(d) {
  const da = pdfText(d.get(PDFName.of('DA'))); const ds = pdfText(d.get(PDFName.of('DS'))); const style = {}; let border = null;
  const sz = /([\d.]+)\s+Tf/.exec(da); if (sz) style.fontSize = +sz[1]; const col = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da); if (col) style.fontColor = '#' + col.slice(1, 4).map((v) => Math.round(+v * 255).toString(16).padStart(2, '0')).join('');
  const bc = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG/.exec(da); if (bc) border = '#' + bc.slice(1, 4).map((v) => Math.round(+v * 255).toString(16).padStart(2, '0')).join('');
  const css = cssDecl(ds); if (css['font-size']) style.fontSize = parseFloat(css['font-size']); if (css.color) style.fontColor = normColor(css.color); if (css['text-align']) style.align = css['text-align'];
  if (css.font) { const f = /([\d.]+)pt/.exec(css.font); if (f) style.fontSize = +f[1]; style.font = fontKeyFromName(css.font.replace(/[\d.]+pt.*$/, '').replace(/^(bold|italic|normal)\s+/i, '').trim()); }
  if (css['font-family']) style.font = fontKeyFromName(css['font-family']); if (/bold/.test(css['font-weight'] || '')) style.bold = true; if (/italic/.test(css['font-style'] || '')) style.italic = true;
  return { style, border };
}
function cssDecl(s) { const o = {}; String(s || '').split(';').forEach((p) => { const k = p.indexOf(':'); if (k > 0) o[p.slice(0, k).trim().toLowerCase()] = p.slice(k + 1).trim(); }); return o; }
function normColor(c) { c = String(c).trim(); if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase(); if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('').toLowerCase(); const m = /rgb\((\d+)\D+(\d+)\D+(\d+)/.exec(c); return m ? '#' + m.slice(1, 4).map((v) => (+v).toString(16).padStart(2, '0')).join('') : null; }
function fontKeyFromName(n) {
  const f = String(n || '').replace(/['"]/g, '').split(',')[0].trim(); const l = f.toLowerCase(); if (!f) return 'helv';
  if (/^(helvetica|helv)$/.test(l)) return 'helv'; if (/^(times|times new roman|times-roman|tiro)$/.test(l) && !FONTS.families.has(f)) return 'times'; if (/^(courier|cour)$/.test(l)) return 'courier';
  return FONTS.families.has(f) ? 'sys:' + f : l.includes('times') ? 'times' : l.includes('courier') ? 'courier' : FONTS.loaded ? 'helv' : 'sys:' + f;
}
// rich text (XHTML in /RC) -> MeBulb runs
function parseRC(rc, base) {
  if (!rc || typeof DOMParser === 'undefined') return null; let doc; try { doc = new DOMParser().parseFromString(rc.replace(/^﻿/, ''), 'application/xml'); } catch { return null; } if (doc.querySelector('parsererror')) return null;
  const runs = []; const D = rtDefaults(base);
  const walk = (node, st) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { if (c.nodeValue) runs.push({ t: c.nodeValue, ...st }); continue; } if (c.nodeType !== 1) continue;
      const tag = c.localName.toLowerCase(); const css = cssDecl(c.getAttribute('style')); const n = { ...st };
      if (css['font-weight'] && /bold|[6-9]00/.test(css['font-weight']) || tag === 'b') n.b = true; if (css['font-style'] === 'italic' || tag === 'i') n.i = true;
      const deco = css['text-decoration'] || ''; if (/underline/.test(deco) || tag === 'u') n.u = true; if (/line-through/.test(deco) || tag === 's') n.s = true;
      if (/super/.test(css['vertical-align'] || '')) n.sup = true; if (/sub/.test(css['vertical-align'] || '')) n.sub = true;
      if (css['font-size']) n.z = parseFloat(css['font-size']); if (css['font-family']) n.f = fontKeyFromName(css['font-family']); if (css.color && normColor(css.color)) n.c = normColor(css.color);
      if (tag === 'p' || tag === 'div') { if (runs.length && !/\n$/.test(runs[runs.length - 1].t)) runs.push({ t: '\n' }); walk(c, n); } else if (tag === 'br') runs.push({ t: '\n' }); else walk(c, n);
    }
  };
  const body = doc.documentElement; const css0 = cssDecl(body.getAttribute('style')); const st0 = {}; if (css0['font-size']) st0.z = parseFloat(css0['font-size']);
  walk(body, st0); const clean = runs.map((r) => { const o = { t: r.t }; ['b', 'i', 'u', 's', 'sup', 'sub', 'f', 'z', 'c'].forEach((k) => { if (r[k] !== undefined && r[k] !== D[k]) o[k] = r[k]; }); return o; });
  return clean.length ? clean : null;
}
// a stamp annotation's appearance becomes a MeBulb stamp asset (one-page PDF drawing that form)
async function stampFromAP(R, d, doc) {
  try {
    let ap = await R.resolve(d.get(PDFName.of('AP'))); ap = ap instanceof PDFDict ? await R.resolve(ap.get(PDFName.of('N'))) : null; if (!ap || !ap.dict) return null;
    const out = await PDFDocument.create(); const pull = new Set(); const load = async (o, depth) => { if (depth > 30) return; if (o instanceof PDFRef) { const k = refKey(o); if (pull.has(k)) return; pull.add(k); await load(await R.get(o), depth + 1); return; } if (o instanceof PDFDict) { for (const [, v] of o.entries()) await load(v, depth + 1); return; } if (o && o.dict) { await load(o.dict, depth + 1); return; } if (o instanceof PDFArray) for (const v of o.asArray()) await load(v, depth + 1); };
    await load(ap.dict, 0); const copy = PDFLib.PDFObjectCopier.for(R.ctx, out.context).copy(ap);
    const bb = (ap.dict.lookup(PDFName.of('BBox')) || PDFArray.withContext(R.ctx)).asArray().map(nOf); const mt = ap.dict.lookup(PDFName.of('Matrix')); const Mx = mt ? mt.asArray().map(nOf) : [1, 0, 0, 1, 0, 0];
    const tb = G.bbox([[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(([x, y]) => [Mx[0] * x + Mx[2] * y + Mx[4], Mx[1] * x + Mx[3] * y + Mx[5]])); if (!tb.w || !tb.h) return null;
    const page = out.addPage([tb.w, tb.h]); const ref = out.context.register(copy); page.node.newXObject('St', ref); page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(1, 0, 0, 1, -tb.x, -tb.y), PDFLib.drawObject('St'), PDFLib.popGraphicsState());
    return addStampAsset(doc, await out.save());
  } catch (e) { console.warn('stamp import', e); return null; }
}
// an annotation MeBulb wrote was changed in another app: take its geometry and text
function mergeExternal(m, c) {
  const simple = ['rect', 'ellipse', 'line', 'arrow', 'polyline', 'polygon', 'cloud', 'pen', 'highlight', 'text', 'callout', 'note', 'length', 'polylength', 'area', 'perimeter', 'angle', 'count'];
  if (c.type === m.type && simple.includes(m.type)) { m.pts = c.pts; if (TEXT_TYPES.has(m.type)) { m.text = c.text; m.runs = c.runs || null; } m.style = { ...m.style, stroke: c.style.stroke, opacity: c.style.opacity, width: c.style.width }; }
  else { const a = G.bbox(m.pts), b = G.bbox(c.pts); const dx = (b.x + b.x2) / 2 - (a.x + a.x2) / 2, dy = (b.y + b.y2) / 2 - (a.y + a.y2) / 2; if (Math.hypot(dx, dy) > 0.5) m.pts = m.pts.map((p) => [p[0] + dx, p[1] + dy]); }
  m.modified = c.modified; m.ext = { ...(m.ext || {}), editedOutside: true };
}
async function revuFlatCount() { return 0; }
async function unflattenRevu() { return 0; }
