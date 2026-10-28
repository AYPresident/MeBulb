// ===== Equipment to scale: top views of AHUs, FCUs, condensers… with their clearances =================
// A placed unit is one markup (type 'equip', pts = [centre]) carrying a copy of its unit data, so a
// drawing stays right when the library changes. Sizes are real millimetres, drawn at the scale where
// the unit sits. Units come from the equipment library: typed in from data sheets, imported from a CSV,
// or exported from Revit families (see revit/ in the repository).
//   unit: { id, name, category, maker, model, tag, w, d, h,              (mm; w across the front, d front to back)
//           clear: { front, back, left, right },                         service access (mm), measured from the body
//           air: [{ side: front|back|left|right|up, kind: discharge|intake, dist }],
//           body?: [[x, y]…], lines?: [[[x, y]…]…], zones?: [{ kind, poly, label }],   from Revit: real outline
//           source: manual|csv|revit, notes }
//   unit space: millimetres from the centre, x to the unit's right as you face its front, y towards the front
//   (down the page when the unit is not rotated). "left" is the -x side.
const EQ_CATS = ['Condenser', 'AHU', 'FCU', 'Fan', 'Pump', 'Chiller', 'Cooling tower', 'Other'];
const EQ_SIDES = ['front', 'back', 'left', 'right'];
const EQ_ZONE = {
  service: { stroke: '#5b6b7b', fill: '#8a9aaa', label: 'SERVICE' },
  discharge: { stroke: '#1864ab', fill: '#4dabf7', label: 'DISCHARGE' },
  intake: { stroke: '#2b8a3e', fill: '#69db7c', label: 'INTAKE' },
};
const EQ = { lib: null };
function eqLib() { if (!EQ.lib) EQ.lib = store.get('equipLib', []); return EQ.lib; }
function saveEqLib() { store.set('equipLib', EQ.lib || []); }
const eqNum = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.+-]/g, '')); return isFinite(n) ? n : 0; };
function eqClean(u) {
  const o = { id: u.id || uid('EQ-'), name: String(u.name || u.model || 'Unit').trim(), category: EQ_CATS.includes(u.category) ? u.category : guessEqCat(u), maker: u.maker || '', model: u.model || '', tag: (u.tag || eqTagFor(u)).toUpperCase(),
    w: Math.max(1, eqNum(u.w)), d: Math.max(1, eqNum(u.d)), h: eqNum(u.h), clear: {}, air: [], source: u.source || 'manual', notes: u.notes || '' };
  EQ_SIDES.forEach((k) => { o.clear[k] = Math.max(0, eqNum(u.clear && u.clear[k])); });
  (u.air || []).forEach((a) => { const side = ['front', 'back', 'left', 'right', 'up'].includes(a.side) ? a.side : 'front'; const kind = a.kind === 'intake' ? 'intake' : 'discharge'; o.air.push({ side, kind, dist: Math.max(0, eqNum(a.dist)) }); });
  if (u.body && u.body.length > 2) o.body = u.body; if (u.lines && u.lines.length) o.lines = u.lines; if (u.zones && u.zones.length) o.zones = u.zones; if (u.params) o.params = u.params; if (u.family) o.family = u.family; if (u.type) o.type = u.type;
  return o;
}
function guessEqCat(u) { const s = `${u.name || ''} ${u.model || ''} ${u.family || ''}`.toLowerCase(); if (/condens|outdoor|odu|cu\b|vrv|vrf/.test(s)) return 'Condenser'; if (/ahu|air handl/.test(s)) return 'AHU'; if (/fcu|fan coil|indoor|ducted/.test(s)) return 'FCU'; if (/chiller/.test(s)) return 'Chiller'; if (/pump/.test(s)) return 'Pump'; if (/fan|exhaust|ef\b/.test(s)) return 'Fan'; if (/tower/.test(s)) return 'Cooling tower'; return 'Other'; }
function eqTagFor(u) { return { Condenser: 'CU', AHU: 'AHU', FCU: 'FCU', Fan: 'EF', Pump: 'P', Chiller: 'CH', 'Cooling tower': 'CT' }[u.category || guessEqCat(u)] || 'EQ'; }

// ----- geometry -------------------------------------------------------------------------------------------
const eqRect = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
function eqBody(eq) { return eq.body && eq.body.length > 2 ? eq.body : eqRect(-eq.w / 2, -eq.d / 2, eq.w / 2, eq.d / 2); }
// clearance zones in unit space: from Revit when the family has them, else from the distances per side
function eqZones(eq) {
  if (eq.zones && eq.zones.length) return eq.zones;
  const b = G.bbox(eqBody(eq)); const out = [];
  const side = (s, dist) => (s === 'front' ? eqRect(b.x, b.y2, b.x2, b.y2 + dist) : s === 'back' ? eqRect(b.x, b.y - dist, b.x2, b.y) : s === 'left' ? eqRect(b.x - dist, b.y, b.x, b.y2) : eqRect(b.x2, b.y, b.x2 + dist, b.y2));
  EQ_SIDES.forEach((s) => { const v = eq.clear && eq.clear[s]; if (v > 0) out.push({ kind: 'service', side: s, dist: v, poly: side(s, v) }); });
  (eq.air || []).forEach((a) => { if (a.side !== 'up' && a.dist > 0) out.push({ kind: a.kind, side: a.side, dist: a.dist, poly: side(a.side, a.dist) }); });
  return out;
}
// unit space (mm) -> page points
function eqXf(doc, m) {
  const sc = scaleForMarkup(doc, m); const k = 1 / (25.4 * sc.inPerPt); const a = ((m.rot || 0) * Math.PI) / 180; const cs = Math.cos(a), sn = Math.sin(a); const f = m.flip ? -1 : 1; const c = m.pts[0];
  const fn = ([x, y]) => [c[0] + (f * x * cs - y * sn) * k, c[1] + (f * x * sn + y * cs) * k]; fn.k = k; fn.a = a; return fn;
}
function eqGeom(doc, m) {
  const eq = m.eq || {}; const T = eqXf(doc, m); const show = m.show || {};
  const zones = eqZones(eq).filter((z) => (z.kind === 'service' ? show.service !== false : show.air !== false)).map((z) => ({ ...z, pts: z.poly.map(T) }));
  return { T, body: eqBody(eq).map(T), lines: (eq.lines || []).map((l) => l.map(T)), zones };
}
// ----- drawing ------------------------------------------------------------------------------------------------
function equipPrims(m, doc, opts = {}) {
  const s = m.style; const eq = m.eq || {}; const g = eqGeom(doc, m); const out = []; const k = g.T.k; const show = m.show || {};
  const clash = opts.noClash ? null : equipClashFor(doc, m);
  const bad = clash ? new Set(clash.zones) : new Set();
  // zones under the unit
  g.zones.forEach((z, i) => { const Z = EQ_ZONE[z.kind] || EQ_ZONE.service; const hot = bad.has(i);
    out.push({ k: 'path', d: P.poly(z.pts, true), stroke: hot ? '#e03131' : Z.stroke, width: hot ? Math.max(1, s.width) : Math.max(0.35, s.width * 0.6), dash: 'dashed', fill: hot ? '#ff8787' : Z.fill, fillOpacity: hot ? 0.3 : 0.14, opacity: s.opacity, role: 'zone', zone: z, pts: z.pts });
    // airflow: arrows pointing away from the unit
    if (z.kind !== 'service') { const bb = G.bbox(z.poly); const mid = [(bb.x + bb.x2) / 2, (bb.y + bb.y2) / 2]; const out1 = z.side === 'front' ? [0, 1] : z.side === 'back' ? [0, -1] : z.side === 'left' ? [-1, 0] : [1, 0]; const dir = z.kind === 'intake' ? -1 : 1; const len = Math.min(z.dist || 600, 900) * 0.45;
      const a0 = [mid[0] - out1[0] * len * 0.5 * dir, mid[1] - out1[1] * len * 0.5 * dir], a1 = [mid[0] + out1[0] * len * 0.5 * dir, mid[1] + out1[1] * len * 0.5 * dir]; const p0 = g.T(a0), p1 = g.T(a1);
      const st = { width: Math.max(0.5, s.width * 0.8) }; const ah = arrowHead(p1, p0, 'arrow', st); out.push({ k: 'path', d: P.poly([p0, ah.cut]), stroke: Z.stroke, width: st.width, fill: 'none', opacity: s.opacity, role: 'flow', seg: [p0, p1] }, ...ah.prims.map((p) => ({ ...p, stroke: Z.stroke, fill: p.fill && p.fill !== 'none' ? Z.stroke : p.fill, role: 'flowhead' })));
    }
  });
  // zone labels: along each side, in the part of the zone that is not covered by a shorter zone on that side
  if (show.zoneLabels !== false) {
    const bb0 = G.bbox(eqBody(eq)); const bySide = {}; g.zones.forEach((z, i) => { if (z.side && EQ_SIDES.includes(z.side)) (bySide[z.side] = bySide[z.side] || []).push(i); });
    Object.entries(bySide).forEach(([side, idx]) => {
      idx.sort((a, b) => (g.zones[a].dist || 0) - (g.zones[b].dist || 0)); let from = 0;
      idx.forEach((i, n) => {
        const z = g.zones[i]; const Z = EQ_ZONE[z.kind] || EQ_ZONE.service; const to = z.dist || 0; if (to <= from + 1) return; const mid = (from + to) / 2; const band = to - from; from = to;
        const same = idx.slice(n + 1).filter((j) => Math.abs((g.zones[j].dist || 0) - to) <= 1).map((j) => g.zones[j].label || (EQ_ZONE[g.zones[j].kind] || EQ_ZONE.service).label);
        const along = side === 'front' || side === 'back' ? bb0.w : bb0.h; const p = side === 'front' ? [(bb0.x + bb0.x2) / 2, bb0.y2 + mid] : side === 'back' ? [(bb0.x + bb0.x2) / 2, bb0.y - mid] : side === 'left' ? [bb0.x - mid, (bb0.y + bb0.y2) / 2] : [bb0.x2 + mid, (bb0.y + bb0.y2) / 2];
        const str = `${Math.round(to)} ${[z.label || Z.label, ...same].join(' · ')}`; const fit = Math.min((s.fontSize || 8) * 0.7, band * k * 0.6, (along * k * 0.9) / Math.max(4, str.length * 0.55)); if (fit < 2.2) return;
        let a = (side === 'front' || side === 'back' ? 0 : Math.PI / 2) * (m.flip ? -1 : 1) + g.T.a; a = Math.atan2(Math.sin(a), Math.cos(a)); if (a > Math.PI / 2 + 1e-6) a -= Math.PI; if (a <= -Math.PI / 2 - 1e-6) a += Math.PI; // keep text readable
        const c = g.T(p); out.push({ k: 'text', x: c[0] - Math.sin(a) * fit * 0.35, y: c[1] + Math.cos(a) * fit * 0.35, size: fit, str, color: bad.has(i) ? '#c92a2a' : Z.stroke, font: s.font, anchor: 'middle', rot: a, opacity: s.opacity, role: 'zlabel' });
      });
    });
  }
  // the unit
  out.push({ k: 'path', d: P.poly(g.body, true), stroke: clash && clash.body ? '#e03131' : s.stroke, width: clash && clash.body ? Math.max(1.2, s.width * 1.5) : s.width, fill: s.fill && s.fill !== 'none' ? s.fill : '#ffffff', fillOpacity: s.fill && s.fill !== 'none' ? s.fillOpacity : 0.85, opacity: s.opacity, hit: 'box', role: 'body' });
  g.lines.forEach((l) => { if (l.length > 1) out.push({ k: 'path', d: P.poly(l), stroke: s.stroke, width: Math.max(0.25, s.width * 0.45), fill: 'none', opacity: s.opacity, role: 'line', pts: l }); });
  // front marker: a small triangle on the front edge
  const bb = G.bbox(eqBody(eq)); const tri = [[-1, 0], [1, 0], [0, 1]].map(([x, y]) => [x * Math.min(bb.w, bb.h) * 0.08, bb.y2 - Math.min(bb.w, bb.h) * 0.11 + y * Math.min(bb.w, bb.h) * 0.09]);
  out.push({ k: 'path', d: P.poly(tri.map(g.T), true), stroke: 'none', fill: s.stroke, opacity: s.opacity, role: 'mark', pts: tri.map(g.T) });
  // discharge straight up (condensers): a circle with a dot
  if ((eq.air || []).some((a) => a.side === 'up') && show.air !== false) { const c = g.T([(bb.x + bb.x2) / 2, (bb.y + bb.y2) / 2 - bb.h * 0.08]); const r = Math.min(bb.w, bb.h) * 0.22 * k; out.push({ k: 'path', d: P.ellipse(c[0], c[1], r, r), stroke: EQ_ZONE.discharge.stroke, width: Math.max(0.4, s.width * 0.6), fill: 'none', opacity: s.opacity, role: 'mark' }, { k: 'path', d: P.ellipse(c[0], c[1], r * 0.15, r * 0.15), stroke: 'none', fill: EQ_ZONE.discharge.stroke, opacity: s.opacity, role: 'mark' }); }
  // tag and model
  if (show.label !== false) {
    // inside the unit when it fits (shrinking down to 4 pt), otherwise above everything the unit draws
    const B = G.bbox(g.body); const z0 = s.fontSize || 8; const lines = [m.tag || eq.tag || '', show.model === false ? '' : eq.model || eq.name || ''].filter(Boolean);
    const size = (z) => ({ w: Math.max(...lines.map((t, i) => textWidth(t, i ? z * 0.8 : z, i === 0, s.font))), h: z + (lines.length - 1) * z * 0.95 });
    let z = z0; while (z > 4 && (size(z).w > B.w * 0.9 || size(z).h > B.h * 0.85)) z -= 0.5; const inside = size(z).w <= B.w * 0.9 && size(z).h <= B.h * 0.85;
    if (!inside) z = z0; const all = inside ? B : G.bbox([...g.body, ...g.zones.flatMap((q) => q.pts)]); const h = size(z).h;
    const y0 = inside ? (B.y + B.y2) / 2 - h / 2 + z * 0.8 : all.y - h + z * 0.6;
    lines.forEach((t, i) => out.push({ k: 'text', x: (all.x + all.x2) / 2, y: y0 + i * z * 0.95 + (i ? z * 0.05 : 0), size: i ? z * 0.8 : z, str: t, color: clash ? '#c92a2a' : s.fontColor || s.stroke, bold: i === 0, font: s.font, anchor: 'middle', opacity: s.opacity, role: 'label' }));
  }
  if (clash) { const B = G.bbox(g.body); const r = Math.max(3, (s.fontSize || 8) * 0.6); const c = [B.x2, B.y]; out.push({ k: 'path', d: P.ellipse(c[0], c[1], r, r), stroke: '#ffffff', width: 0.6, fill: '#e03131' }, { k: 'text', x: c[0], y: c[1] + r * 0.45, size: r * 1.3, str: '!', color: '#ffffff', bold: true, anchor: 'middle' }); }
  return out;
}
// How a unit goes into the PDF for other apps: the body as a plain Square or Polygon at its exact size,
// each clearance zone a dashed Polygon, airflow arrows, text boxes for the tag and zone sizes, all grouped
// (see sketchParts). Clash warnings are live checks in MeBulb and are left out.
function equipParts(m, doc) {
  const s = m.style; const g = eqGeom(doc, m); const prims = equipPrims(m, doc, { noClash: true }); const gid = m.group || 'EQ-' + m.id;
  const base = { page: m.page, layer: m.layer, author: m.author, created: m.created, modified: m.modified, status: m.status, group: gid, subject: m.subject };
  const body = g.body; const bb = G.bbox(body); const axis = body.length === 4 && body.every((p) => (Math.abs(p[0] - bb.x) < 0.01 || Math.abs(p[0] - bb.x2) < 0.01) && (Math.abs(p[1] - bb.y) < 0.01 || Math.abs(p[1] - bb.y2) < 0.01));
  const bp = prims.find((p) => p.role === 'body') || {};
  const contents = [m.tag, m.eq && m.eq.name, m.eq && `${Math.round(m.eq.w)} × ${Math.round(m.eq.d)} mm`, m.comment].filter(Boolean).join('\n');
  const out = [{ ...base, id: m.id, type: axis ? 'rect' : 'polygon', pts: axis ? [[bb.x, bb.y], [bb.x2, bb.y2]] : body.map((p) => p.slice()), style: { stroke: s.stroke, width: s.width, fill: bp.fill, fillOpacity: bp.fillOpacity, opacity: s.opacity, dash: 'solid' }, comment: m.comment, _contents: contents, ext: { ...(m.ext || {}), groupPrimary: m.group ? undefined : true, groupName: m.group ? undefined : m.tag || 'Equipment' } }];
  prims.forEach((p, k) => {
    const st = { stroke: p.stroke && p.stroke !== 'none' ? p.stroke : p.fill, width: p.width || 0, fill: p.fill || 'none', fillOpacity: p.fillOpacity == null ? 1 : p.fillOpacity, opacity: s.opacity, dash: p.dash || 'solid' };
    if (p.role === 'zone') out.push({ ...base, id: `${m.id}#z${k}`, type: 'polygon', pts: p.pts.map((q) => q.slice()), subject: ((EQ_ZONE[p.zone.kind] || EQ_ZONE.service).label || 'Clearance'), style: st, ext: {} });
    else if (p.role === 'flow') out.push({ ...base, id: `${m.id}#f${k}`, type: 'arrow', pts: p.seg, style: { ...st, fill: 'none', arrowStart: 'none', arrowEnd: 'arrow' }, ext: {} });
    else if (p.role === 'line') out.push({ ...base, id: `${m.id}#k${k}`, type: 'polyline', pts: p.pts.map((q) => q.slice()), style: { ...st, fill: 'none' }, ext: {}, _prims: [p] });
    else if (p.role === 'mark') { if (p.pts) out.push({ ...base, id: `${m.id}#m${k}`, type: 'polygon', pts: p.pts.map((q) => q.slice()), style: st, ext: {}, _prims: [p] }); else { const b = primsBBox([p]); const w = p.width || 0; out.push({ ...base, id: `${m.id}#m${k}`, type: 'ellipse', pts: [[b.x + w / 2 + 1, b.y + w / 2 + 1], [b.x2 - w / 2 - 1, b.y2 - w / 2 - 1]], style: st, ext: {}, _prims: [p] }); } }
  });
  // text: the tag block as one text box, each zone size on its own
  const textBoxOf = (ps, id) => { const b = primsBBox(ps); if (!b) return; const p0 = ps[0]; out.push({ ...base, id, type: 'text', pts: [[b.x, b.y], [b.x2, b.y2]], text: ps.map((p) => p.str).join('\n'), fixedH: true, style: { font: p0.font, fontSize: p0.size, bold: !!p0.bold, fontColor: p0.color, stroke: 'none', width: 0, fill: 'none', align: 'center', valign: 'middle', pad: 0.5, lineH: 1.1, opacity: s.opacity }, ext: {}, _prims: ps }); };
  const lab = prims.filter((p) => p.role === 'label'); if (lab.length) textBoxOf(lab, m.id + '#l');
  prims.filter((p) => p.role === 'zlabel').forEach((p, k) => textBoxOf([p], `${m.id}#t${k}`));
  return out;
}
function equipBBox(m, doc) { const g = eqGeom(doc, m); return G.bbox([...g.body, ...g.zones.flatMap((z) => z.pts)]); }

// ----- clearance clashes ------------------------------------------------------------------------------------------
// A unit clashes when its body overlaps another unit, sits in another unit's clearance zone, or when one
// unit's discharge blows into another's intake. Shared service space between units is allowed.
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p; const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// separating axis test on convex outlines; tol shrinks the overlap needed (touching is fine)
function convexOverlap(A, B, tol = 0) {
  for (const P0 of [A, B]) for (let i = 0; i < P0.length; i++) {
    const a = P0[i], b = P0[(i + 1) % P0.length]; const nx = a[1] - b[1], ny = b[0] - a[0]; const L = Math.hypot(nx, ny) || 1;
    let a1 = Infinity, a2 = -Infinity, b1 = Infinity, b2 = -Infinity; for (const q of A) { const v = (q[0] * nx + q[1] * ny) / L; a1 = Math.min(a1, v); a2 = Math.max(a2, v); } for (const q of B) { const v = (q[0] * nx + q[1] * ny) / L; b1 = Math.min(b1, v); b2 = Math.max(b2, v); }
    if (a2 <= b1 + tol || b2 <= a1 + tol) return false;
  }
  return true;
}
const _eqClash = new WeakMap();
function equipClashes(doc, page) {
  const units = doc.markups.filter((m) => m.type === 'equip' && m.page === page && layerVisible(doc, m.layer)); if (units.length < 2) return { list: [], by: new Map() };
  const key = JSON.stringify(units.map((m) => [m.id, m.pts[0], m.rot, m.flip, m.show, m.eq && [m.eq.w, m.eq.d, m.eq.clear, m.eq.air, m.eq.zones && m.eq.zones.length]]));
  let cache = _eqClash.get(doc); if (!cache) { cache = {}; _eqClash.set(doc, cache); } if (cache[page] && cache[page].key === key) return cache[page].res;
  const G2 = units.map((m) => { const g = eqGeom(doc, m); return { m, body: convexHull(g.body), zones: g.zones.map((z) => ({ kind: z.kind, side: z.side, hull: convexHull(z.pts) })), tol: g.T.k * 5 }; }); // 5 mm tolerance
  const list = []; const by = new Map(); const hit = (m, rec) => { if (!by.has(m.id)) by.set(m.id, { body: false, zones: [], with: [] }); const r = by.get(m.id); Object.assign(r, { body: r.body || !!rec.body }); if (rec.zone != null) r.zones.push(rec.zone); r.with.push(rec.other); };
  for (let i = 0; i < G2.length; i++) for (let j = 0; j < G2.length; j++) {
    if (i === j) continue; const A = G2[i], B = G2[j]; const tol = Math.max(A.tol, B.tol);
    if (i < j && convexOverlap(A.body, B.body, tol)) { list.push({ kind: 'overlap', a: A.m.id, b: B.m.id, text: `${A.m.tag || 'Unit'} and ${B.m.tag || 'unit'} overlap` }); hit(A.m, { body: true, other: B.m.id }); hit(B.m, { body: true, other: A.m.id }); }
    A.zones.forEach((z, zi) => {
      if (convexOverlap(z.hull, B.body, tol)) { list.push({ kind: z.kind, a: A.m.id, b: B.m.id, text: `${B.m.tag || 'A unit'} is in the ${z.side} ${z.kind === 'service' ? 'service clearance' : z.kind} zone of ${A.m.tag || 'a unit'}` }); hit(A.m, { zone: zi, other: B.m.id }); hit(B.m, { body: true, other: A.m.id }); }
      if (z.kind === 'discharge') B.zones.forEach((y, yi) => { if (y.kind === 'intake' && convexOverlap(z.hull, y.hull, tol)) { list.push({ kind: 'recirculation', a: A.m.id, b: B.m.id, text: `${A.m.tag || 'A unit'} discharges into the intake of ${B.m.tag || 'a unit'}` }); hit(A.m, { zone: zi, other: B.m.id }); hit(B.m, { zone: yi, other: A.m.id }); } });
    });
  }
  const res = { list, by }; cache[page] = { key, res }; return res;
}
function equipClashFor(doc, m) { if (!doc || !doc.markups) return null; const r = equipClashes(doc, m.page).by.get(m.id); return r || null; }
function equipClashList(doc) { const out = []; for (let i = 0; i < doc.numPages; i++) if (doc.markups.some((m) => m.page === i && m.type === 'equip')) equipClashes(doc, i).list.forEach((c) => out.push({ ...c, page: i })); return out; }

// ----- placing ------------------------------------------------------------------------------------------------------
function nextEqTag(doc, prefix) {
  const used = new Set(doc.markups.filter((m) => m.type === 'equip').map((m) => m.tag)); let n = 1; const p = (prefix || 'EQ').replace(/-+$/, '');
  while (used.has(`${p}-${String(n).padStart(2, '0')}`) && n < 999) n++; return `${p}-${String(n).padStart(2, '0')}`;
}
function armEquip(u) {
  if (!u) return; state.placeEquip = u; state.placeRot = state.placeRot || 0; setTool('equip', { lock: true });
  toast(`${u.name}: click to place · R turns it 90° · Esc when done`);
}
function placeEquipAt(page, p) {
  const doc = activeDoc(); const u = state.placeEquip; if (!u) { openPanel('equipment'); toast('Pick a unit in the Equipment panel first'); return null; }
  if (scaleAt(doc, page, p).unset) toast('This page has no scale yet: the unit is drawn at paper size. Set the page scale first.', 'error');
  const m = newMarkup('equip', page, [p.slice()], { eq: deep(u), rot: state.placeRot || 0, flip: false, tag: nextEqTag(doc, u.tag), show: { service: true, air: true, label: true } });
  m.subject = u.category || 'Equipment'; m.text = u.name; addMarkup(m, doc); state.sel.clear(); state.sel.add(m.id); refreshSelection(); renderEquipPanelSoon(); return m;
}
function equipGhost(doc, page, p) { if (!state.placeEquip) return ''; const m = { id: 'ghost', type: 'equip', page, pts: [p], style: toolStyle('equip'), eq: state.placeEquip, rot: state.placeRot || 0, tag: nextEqTag(doc, state.placeEquip.tag), show: { service: true, air: true, label: true } }; return `<g class="ghost" opacity="0.6">${dl(m, doc, { noClash: true }).map(primSvg).join('')}</g>`; }
function rotateEquip(ms, deg) { const doc = activeDoc(); if (!ms.length) return; pushUndo(doc); ms.forEach((m) => { m.rot = ((((m.rot || 0) + deg) % 360) + 360) % 360; touch(m); }); renderAllMarks(doc); refreshPanels(); }

// ----- library: add / edit ---------------------------------------------------------------------------------------------
function eqPreviewSvg(u, size = 120) {
  try { const m = { id: 'pv', type: 'equip', page: 0, pts: [[0, 0]], style: { ...toolStyle('equip'), fontSize: 9 }, eq: u, rot: 0, tag: u.tag, show: { service: true, air: true, label: false, zoneLabels: false } };
    const doc = { pages: [{ w: 1000, h: 1000, T: [1, 0, 0, -1, 0, 1000] }], scales: { 0: { inPerPt: 1 / 25.4, unit: 'mm', fmt: 'dec', prec: 0 } }, viewports: {}, markups: [], numPages: 1, layers: [] };
    const prims = equipPrims(m, doc, { noClash: true }); const b = equipBBox(m, doc); const pad = Math.max(b.w, b.h) * 0.06 + 1;
    return `<svg viewBox="${num(b.x - pad, 1)} ${num(b.y - pad, 1)} ${num(b.w + 2 * pad, 1)} ${num(b.h + 2 * pad, 1)}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${prims.map((p) => primSvg({ ...p, width: p.width ? p.width * Math.max(b.w, b.h) / 160 : p.width })).join('')}</svg>`; } catch { return icon('equip'); }
}
async function editEquipDialog(u0) {
  const u = eqClean(u0 || { name: '', category: 'Condenser', w: 900, d: 350, h: 1300, clear: { front: 600, back: 300, left: 300, right: 300 }, air: [{ side: 'front', kind: 'discharge', dist: 1500 }] });
  const num0 = (v) => (v ? Math.round(v) : '');
  const airRow = (a, i) => `<div class="eq-air" data-i="${i}"><select name="as${i}">${['front', 'back', 'left', 'right', 'up'].map((s) => `<option${a.side === s ? ' selected' : ''}>${s}</option>`).join('')}</select><select name="ak${i}">${['discharge', 'intake'].map((s) => `<option${a.kind === s ? ' selected' : ''}>${s}</option>`).join('')}</select><input type="number" name="ad${i}" min="0" step="10" value="${num0(a.dist)}" placeholder="mm" aria-label="Clear distance (mm)"></div>`;
  const airs = u.air.length ? u.air : [{ side: 'front', kind: 'discharge', dist: 0 }]; while (airs.length < 3) airs.push({ side: 'back', kind: 'intake', dist: 0 });
  const r = await openDialog({ title: u0 ? 'Edit unit' : 'Add a unit', wide: true, body: `
    <div class="eq-edit"><div class="eq-form">
      ${field('Name', `<input type="text" name="name" value="${esc(u.name)}" placeholder="e.g. Daikin RXYQ10U condenser" required>`)}
      <div class="field two"><div><label>Category</label><select name="category">${EQ_CATS.map((c) => `<option${u.category === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div><div><label>Tag prefix</label><input type="text" name="tag" value="${esc(u.tag)}" maxlength="8"></div></div>
      <div class="field two"><div><label>Manufacturer</label><input type="text" name="maker" value="${esc(u.maker)}"></div><div><label>Model</label><input type="text" name="model" value="${esc(u.model)}"></div></div>
      <div class="field three"><div><label>Width (mm)</label><input type="number" name="w" min="1" step="1" value="${num0(u.w)}" required></div><div><label>Depth (mm)</label><input type="number" name="d" min="1" step="1" value="${num0(u.d)}" required></div><div><label>Height (mm)</label><input type="number" name="h" min="0" step="1" value="${num0(u.h)}"></div></div>
      <p class="muted sm">Width is across the front; depth is front to back.${u.body ? ' The outline comes from Revit; width and depth only change the clearances drawn from them.' : ''}</p>
      <fieldset class="st-cluster"><legend>Service access clearance (mm)</legend><div class="field four">${EQ_SIDES.map((s) => `<div><label>${s[0].toUpperCase() + s.slice(1)}</label><input type="number" name="c_${s}" min="0" step="10" value="${num0(u.clear[s])}"></div>`).join('')}</div></fieldset>
      <fieldset class="st-cluster"><legend>Airflow clear zones</legend>${airs.map(airRow).join('')}<p class="muted sm">“up” is a discharge straight up (a fan on top): shown as a symbol, no zone on plan.</p></fieldset>
      ${field('Notes', `<input type="text" name="notes" value="${esc(u.notes)}" placeholder="e.g. clearances per installation manual, rev C">`)}
      ${u.zones ? '<p class="muted sm">This unit has clearance zones drawn in its Revit family; they are used instead of the distances above.</p>' : ''}
    </div><div class="eq-pv" id="eq-pv">${eqPreviewSvg(u, 220)}</div></div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: u0 ? 'Save' : 'Add unit', value: true, primary: true }],
    onOpen: (box) => { const form = box.querySelector('#dlg-form'); const upd = () => { const f = Object.fromEntries(new FormData(form)); const v = eqFromForm(f, u, airs.length); box.querySelector('#eq-pv').innerHTML = eqPreviewSvg(v, 220); }; form.addEventListener('input', upd); form.addEventListener('change', upd); } });
  if (!r || !r.value) return null; return eqFromForm(r.form, u, airs.length);
}
function eqFromForm(f, u, nAir) {
  const air = []; for (let i = 0; i < nAir; i++) { const dist = eqNum(f['ad' + i]); if (dist > 0 || f['as' + i] === 'up' && f['ad' + i] !== undefined && f['ad' + i] !== '') air.push({ side: f['as' + i], kind: f['ak' + i], dist }); }
  return eqClean({ ...u, name: f.name, category: f.category, tag: f.tag, maker: f.maker, model: f.model, w: f.w, d: f.d, h: f.h, notes: f.notes, clear: Object.fromEntries(EQ_SIDES.map((s) => [s, f['c_' + s]])), air });
}

// ----- import: CSV from data sheets, JSON from the Revit exporter, MeBulb library files --------------------------------------
const EQ_CSV_HEAD = ['Name', 'Category', 'Manufacturer', 'Model', 'Tag', 'Width mm', 'Depth mm', 'Height mm', 'Front mm', 'Back mm', 'Left mm', 'Right mm', 'Discharge side', 'Discharge mm', 'Intake side', 'Intake mm', 'Notes'];
function eqCsvTemplate() { return EQ_CSV_HEAD.join(',') + '\n' + '"Example condenser (replace with data sheet values)",Condenser,,,CU,900,350,1300,600,300,300,300,front,1500,back,300,"Check the installation manual"\n'; }
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false; const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ',' || c === ';' || c === '\t') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows.filter((r) => r.some((x) => String(x).trim()));
}
function eqFromCsv(text) {
  const rows = parseCsv(text); if (rows.length < 2) throw new Error('The CSV has no unit rows'); const H = rows[0].map((h) => h.toLowerCase());
  const col = (...keys) => { for (const k of keys) { const i = H.findIndex((h) => h.includes(k)); if (i >= 0) return i; } return -1; }; // keys in order of preference
  const C = { name: col('name'), cat: col('categ', 'type'), maker: col('manuf', 'maker', 'brand'), model: col('model'), tag: col('tag', 'prefix'), w: col('width'), d: col('depth', 'length'), h: col('height'), front: col('front'), back: col('back', 'rear'), left: col('left'), right: col('right'), ds: col('discharge side'), dd: col('discharge mm', 'discharge dist', 'discharge clear', 'discharge'), is: col('intake side', 'inlet side'), id: col('intake mm', 'intake dist', 'intake clear', 'inlet mm'), notes: col('note', 'comment') };
  if (C.w < 0 || C.d < 0) throw new Error('The CSV needs Width and Depth columns (in mm)');
  const g = (r, k) => (C[k] >= 0 ? String(r[C[k]] || '').trim() : '');
  return rows.slice(1).map((r) => {
    const air = []; const ds = g(r, 'ds').toLowerCase(); const is = g(r, 'is').toLowerCase();
    if (C.dd >= 0 && C.dd !== C.ds && (eqNum(g(r, 'dd')) > 0 || ds === 'up')) air.push({ side: ds || 'front', kind: 'discharge', dist: eqNum(g(r, 'dd')) });
    if (C.id >= 0 && C.id !== C.is && eqNum(g(r, 'id')) > 0) air.push({ side: is || 'back', kind: 'intake', dist: eqNum(g(r, 'id')) });
    return eqClean({ name: g(r, 'name') || g(r, 'model'), category: g(r, 'cat'), maker: g(r, 'maker'), model: g(r, 'model'), tag: g(r, 'tag'), w: g(r, 'w'), d: g(r, 'd'), h: g(r, 'h'), clear: { front: g(r, 'front'), back: g(r, 'back'), left: g(r, 'left'), right: g(r, 'right') }, air, notes: g(r, 'notes'), source: 'csv' });
  }).filter((u) => u.w > 1 && u.d > 1);
}
// the Revit exporter writes each family type in its own coordinates (mm, y up the plan, front = -y)
function eqFromRevit(json, frontAxis = '-y') {
  if (!json || json.kind !== 'equipment' || !Array.isArray(json.items)) throw new Error('This is not a MeBulb equipment export from Revit');
  const rot = { '-y': ([x, y]) => [x, -y], '+y': ([x, y]) => [-x, y], '-x': ([x, y]) => [-y, -x], '+x': ([x, y]) => [y, x] }[frontAxis] || (([x, y]) => [x, -y]);
  return json.items.map((it) => {
    const tf = (pts) => (pts || []).map(rot); const body0 = tf(it.body); const lines0 = (it.lines || []).map(tf); const zones0 = (it.zones || []).map((z) => ({ ...z, poly: tf(z.poly) }));
    const allPts = body0.length ? body0 : lines0.flat(); const B = allPts.length ? G.bbox(allPts) : { x: -(it.w || 1000) / 2, y: -(it.d || 600) / 2, x2: (it.w || 1000) / 2, y2: (it.d || 600) / 2, w: it.w || 1000, h: it.d || 600 };
    const cx = (B.x + B.x2) / 2, cy = (B.y + B.y2) / 2; const mv = (p) => [Math.round((p[0] - cx) * 10) / 10, Math.round((p[1] - cy) * 10) / 10];
    const zones = zones0.map((z) => { const zb = G.bbox(z.poly); const side = zb.y >= B.y2 - 1 ? 'front' : zb.y2 <= B.y + 1 ? 'back' : zb.x2 <= B.x + 1 ? 'left' : zb.x >= B.x2 - 1 ? 'right' : 'around'; return { kind: /disch|exhaust|outlet|supply air/i.test(z.kind + ' ' + (z.label || '')) ? 'discharge' : /intake|inlet|return|fresh/i.test(z.kind + ' ' + (z.label || '')) ? 'intake' : 'service', side, dist: Math.round(side === 'front' || side === 'back' ? zb.h : zb.w), label: z.label && !/clear|service|access/i.test(z.label) ? z.label : '', poly: z.poly.map(mv) }; });
    const p = it.params || {}; const pv = (re) => { const k = Object.keys(p).find((n) => re.test(n)); return k ? eqNum(p[k]) : 0; };
    const clear = zones.length ? {} : { front: pv(/front.*(clear|service|access)|(clear|service|access).*front/i), back: pv(/(back|rear).*(clear|service|access)|(clear|service|access).*(back|rear)/i), left: pv(/left.*(clear|service|access)|(clear|service|access).*left/i), right: pv(/right.*(clear|service|access)|(clear|service|access).*right/i) };
    return eqClean({ name: it.name || [it.family, it.type].filter(Boolean).join(': '), family: it.family, type: it.type, category: guessEqCat({ name: `${it.family} ${it.type} ${it.category}` }), maker: it.maker || p.Manufacturer || '', model: it.model || p.Model || it.type || '', w: B.w, d: B.h, h: it.h || 0, clear, air: [], body: body0.length > 2 ? body0.map(mv) : null, lines: lines0.map((l) => l.map(mv)), zones, params: p, source: 'revit' });
  });
}
async function importEquipFiles(files) {
  const added = []; const lib = eqLib();
  for (const f of files) {
    try {
      const text = await f.text(); let units;
      if (/\.csv$|\.txt$/i.test(f.name) || /^[^{[]*,/.test(text.slice(0, 200))) units = eqFromCsv(text);
      else { const j = JSON.parse(text); if (j.kind === 'equipment' && j.app === 'MeBulb' && j.items && j.items[0] && j.items[0].w !== undefined && !j.items[0].family) units = j.items.map((u) => eqClean(u)); else {
        const ax = await openDialog({ title: 'Units from Revit', body: `<p>${(j.items || []).length} family type${(j.items || []).length === 1 ? '' : 's'} from <b>${esc(j.source || f.name)}</b>.</p>${field('The front of each unit faces', `<select name="ax"><option value="-y">down the plan (−Y in the family, Revit's usual “Front”)</option><option value="+y">up the plan (+Y)</option><option value="-x">left (−X)</option><option value="+x">right (+X)</option></select>`)}<p class="muted sm">You can turn any placed unit afterwards; this only sets which side counts as its front for the clearances.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Import', value: true, primary: true }] });
        if (!ax || !ax.value) continue; units = eqFromRevit(j, ax.form.ax); } }
      units.forEach((u) => { const i = lib.findIndex((x) => x.name === u.name && x.source === u.source); if (i >= 0) lib[i] = { ...u, id: lib[i].id }; else lib.push(u); added.push(u); });
    } catch (e) { toast(`${f.name}: ${e.message || e}`, 'error'); }
  }
  if (added.length) { saveEqLib(); renderEquipPanel(); openPanel('equipment'); toast(`${added.length} unit${added.length === 1 ? '' : 's'} added to the equipment library`); }
  return added;
}
function pickEquipFiles() { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,.csv,.txt,application/json,text/csv'; inp.multiple = true; inp.onchange = () => importEquipFiles([...inp.files]); inp.click(); }

// ----- the Equipment panel --------------------------------------------------------------------------------------------
const renderEquipPanelSoon = debounce(() => { if (panelShown('equipment')) renderEquipPanel(); }, 150);
function renderEquipPanel() {
  const el = $('#equipment'); if (!el) return; const lib = eqLib(); const q = (EQ.q || '').toLowerCase(); const cat = EQ.cat || '';
  const doc = activeDoc(); const clashes = doc ? equipClashList(doc) : []; const placed = doc ? doc.markups.filter((m) => m.type === 'equip') : [];
  const items = lib.filter((u) => (!cat || u.category === cat) && (!q || `${u.name} ${u.maker} ${u.model} ${u.category}`.toLowerCase().includes(q)));
  el.innerHTML = `<div class="ts-bar"><button class="btn sm" data-eq="add">${icon('plus')} Add unit</button><button class="btn sm" data-eq="import" title="Revit export (.json), data sheet table (.csv) or a MeBulb library">${icon('import')} Import</button><span class="grow"></span><button class="icon-btn sm" data-eq="more" aria-label="More equipment options">${icon('more')}</button></div>
    ${clashes.length ? `<div class="eq-clashes" role="alert"><b>${clashes.length} clearance clash${clashes.length === 1 ? '' : 'es'}</b>${clashes.slice(0, 12).map((c, k) => `<button class="eq-clash" data-clash="${k}">${esc(c.text)}<span class="muted"> · p${c.page + 1}</span></button>`).join('')}</div>` : placed.length > 1 ? '<div class="eq-ok">No clearance clashes</div>' : ''}
    <div class="eq-search"><input type="search" placeholder="Search units" value="${esc(EQ.q || '')}" data-eq-q aria-label="Search units"><select data-eq-cat aria-label="Category"><option value="">All</option>${EQ_CATS.map((c) => `<option${c === cat ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
    ${state.placeEquip ? `<div class="ts-placing">${icon('info')} Placing ${esc(state.placeEquip.name)} · R turns · Esc when done</div>` : ''}
    <div class="eq-list">${items.length ? items.map((u) => `<div class="eq-item${state.placeEquip && state.placeEquip.id === u.id ? ' on' : ''}" data-u="${esc(u.id)}" role="button" tabindex="0" title="${esc(`${u.name}\n${Math.round(u.w)} × ${Math.round(u.d)}${u.h ? ' × ' + Math.round(u.h) : ''} mm${u.notes ? '\n' + u.notes : ''}`)}"><span class="eq-pv">${eqPreviewSvg(u, 44)}</span><span class="eq-txt"><span class="eq-name">${esc(u.name)}</span><span class="eq-sub">${esc([u.category, `${Math.round(u.w)}×${Math.round(u.d)}`, u.source === 'revit' ? 'Revit' : ''].filter(Boolean).join(' · '))}</span></span></div>`).join('') : `<p class="muted pad sm">${lib.length ? 'No units match.' : 'No units yet. Add one from its data sheet, import a table (CSV), or import an export from Revit.'}</p>`}</div>
    ${placed.length ? `<h4 class="eq-h">On this drawing (${placed.length})</h4><div class="eq-placed">${placed.slice(0, 200).map((m) => `<button class="eq-pl${equipClashFor(doc, m) ? ' bad' : ''}" data-m="${esc(m.id)}"><b>${esc(m.tag || '')}</b> ${esc(m.eq ? m.eq.model || m.eq.name : '')}<span class="muted"> · p${m.page + 1}</span></button>`).join('')}</div>` : ''}`;
}
function bindEquipPanel() {
  const el = $('#equipment'); if (!el) return;
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-eq]'); const doc = activeDoc();
    if (b) { const k = b.dataset.eq;
      if (k === 'add') { const u = await editEquipDialog(null); if (u) { eqLib().push(u); saveEqLib(); renderEquipPanel(); armEquip(u); } }
      else if (k === 'import') pickEquipFiles();
      else if (k === 'more') { const r = b.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, [
        ['Import Revit export, CSV or library…', pickEquipFiles],
        ['Download the CSV template', () => saveFile('MeBulb equipment template.csv', eqCsvTemplate(), 'text/csv')],
        ['Download the Revit exporter…', () => revitExporterDialog()],
        ['Export the library (to share)…', () => saveFile('MeBulb equipment library.json', JSON.stringify({ app: 'MeBulb', kind: 'equipment', version: 1, units: 'mm', items: eqLib() }, null, 1), 'application/json')],
        ['Equipment schedule (CSV)…', () => equipSchedule()],
        ['-'], ['Clear the library…', async () => { if (await confirmDialog('Clear the equipment library?', 'Units already placed on drawings stay as they are.', 'Clear', true)) { EQ.lib = []; saveEqLib(); renderEquipPanel(); } }, 'danger']]); }
      return; }
    const it = e.target.closest('.eq-item'); if (it) { const u = eqLib().find((x) => x.id === it.dataset.u); if (u) { armEquip(u); renderEquipPanel(); } return; }
    const c = e.target.closest('[data-clash]'); if (c && doc) { const x = equipClashList(doc)[+c.dataset.clash]; if (x) { state.sel.clear(); [x.a, x.b].forEach((id) => state.sel.add(id)); const m = getMarkup(x.a); if (m) { goToPage(m.page, m.pts[0]); } refreshSelection(); } return; }
    const pl = e.target.closest('[data-m]'); if (pl && doc) { const m = getMarkup(pl.dataset.m); if (m) { state.sel.clear(); state.sel.add(m.id); goToPage(m.page, m.pts[0]); refreshSelection(); } }
  });
  el.addEventListener('contextmenu', (e) => { const it = e.target.closest('.eq-item'); if (!it) return; e.preventDefault(); const lib = eqLib(); const i = lib.findIndex((x) => x.id === it.dataset.u); if (i < 0) return; const u = lib[i];
    showMenu(e.clientX, e.clientY, [['Place', () => armEquip(u)], ['Edit…', async () => { const v = await editEquipDialog(u); if (v) { lib[i] = { ...v, id: u.id }; saveEqLib(); renderEquipPanel(); } }], ['Duplicate', () => { lib.splice(i + 1, 0, { ...deep(u), id: uid('EQ-'), name: u.name + ' copy' }); saveEqLib(); renderEquipPanel(); }], ['-'], ['Delete', () => { lib.splice(i, 1); saveEqLib(); renderEquipPanel(); }, 'danger']]); });
  el.addEventListener('input', (e) => { if (e.target.matches('[data-eq-q]')) { EQ.q = e.target.value; const pos = e.target.selectionStart; renderEquipPanel(); const s = el.querySelector('[data-eq-q]'); s.focus(); try { s.setSelectionRange(pos, pos); } catch { } } });
  el.addEventListener('change', (e) => { if (e.target.matches('[data-eq-cat]')) { EQ.cat = e.target.value; renderEquipPanel(); } });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('eq-item')) e.target.click(); });
}
// every placed unit, for checking against the schedule
function equipSchedule() {
  const doc = activeDoc(); if (!doc) return; const rows = [['Tag', 'Page', 'Name', 'Category', 'Manufacturer', 'Model', 'Width mm', 'Depth mm', 'Height mm', 'Rotation', 'Clashes']];
  doc.markups.filter((m) => m.type === 'equip').sort((a, b) => String(a.tag).localeCompare(String(b.tag), undefined, { numeric: true })).forEach((m) => { const e = m.eq || {}; const c = equipClashFor(doc, m); rows.push([m.tag, m.page + 1, e.name, e.category, e.maker, e.model, Math.round(e.w), Math.round(e.d), Math.round(e.h || 0), m.rot || 0, c ? c.with.map((id) => (getMarkup(id) || {}).tag).filter(Boolean).join(' ') : '']); });
  saveFile(`${doc.name.replace(/\.pdf$/i, '')} equipment.csv`, rows.map((r) => r.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'text/csv');
}

// ----- the Revit exporter, for whoever has Revit ------------------------------------------------------------------------
function revitExporterDyn() {
  const g = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const node = g(); const port = (name, desc) => ({ Id: g(), Name: name, Description: desc, UsingDefaultValue: false, Level: 2, UseLevels: false, KeepListStructure: false });
  return JSON.stringify({ Uuid: [g().slice(0, 8), g().slice(0, 4), g().slice(0, 4), g().slice(0, 4), g().slice(0, 12)].join('-'), IsCustomNode: false, Description: 'Exports mechanical equipment plan outlines and clearances for MeBulb', Name: 'MeBulb equipment export', ElementResolver: { ResolutionMap: {} }, Inputs: [], Outputs: [],
    Nodes: [{ ConcreteType: 'PythonNodeModels.PythonNode, PythonNodeModels', NodeType: 'PythonScriptNode', Code: REVIT_EXPORTER, Engine: 'CPython3', EngineName: 'CPython3', VariableInputPorts: true, Id: node, Inputs: [port('IN[0]', 'Input #0')], Outputs: [port('OUT', 'Result of the python script')], Replication: 'Disabled', Description: 'Runs an embedded Python script.' }],
    Connectors: [], Dependencies: [], NodeLibraryDependencies: [], Bindings: [],
    View: { Dynamo: { ScaleFactor: 1.0, HasRunWithoutCrash: false, IsVisibleInDynamoLibrary: true, Version: '2.19.0', RunType: 'Manual', RunPeriod: '1000' }, Camera: { Name: 'Background Preview', EyeX: -17, EyeY: 24, EyeZ: 50, LookX: 12, LookY: -13, LookZ: -58, UpX: 0, UpY: 1, UpZ: 0 },
      NodeViews: [{ Id: node, Name: 'MeBulb equipment export', IsSetAsInput: false, IsSetAsOutput: false, Excluded: false, ShowGeometry: true, X: 200, Y: 200 }], Annotations: [], X: 0, Y: 0, Zoom: 1 } }, null, 2);
}
async function revitExporterDialog() {
  const r = await openDialog({ title: 'Units from Revit', body: `
    <p>Someone with Revit runs a small export once per project (or whenever families change); everyone else imports the file it writes.</p>
    <ol class="eq-steps"><li>Open a floor plan in Revit and select the units (or select nothing to take every mechanical equipment unit in the view).</li>
    <li>Run the exporter: in <b>Dynamo</b> open <i>MeBulb equipment export.dyn</i> and press Run (if Dynamo asks for a Python engine, pick CPython3 or PythonNet3), or run the <i>.py</i> file from pyRevit or RevitPythonShell.</li>
    <li>It writes <i>MeBulb equipment.json</i> next to the model. In MeBulb: Equipment ▸ Import, and pick that file.</li></ol>
    <p class="muted sm">It reads each family type's plan outline and any clearance solids (subcategories named clearance, service, access, airflow, discharge, intake…) plus clearance parameters. Nothing in the model is changed.</p>`,
    buttons: [{ label: 'Close', value: false }, { label: 'Python script (.py)', value: 'py' }, { label: 'Dynamo graph (.dyn)', value: 'dyn', primary: true }] });
  if (!r || !r.value) return;
  if (r.value === 'py') await saveFile('mebulb_export_equipment.py', REVIT_EXPORTER, 'text/x-python'); else await saveFile('MeBulb equipment export.dyn', revitExporterDyn(), 'application/json');
}

// ----- properties of a placed unit ------------------------------------------------------------------------------------------
function equipPropsHtml(doc, m) {
  const e = m.eq || {}; const show = m.show || {}; const c = equipClashFor(doc, m); const lib = eqLib(); const sc = scaleForMarkup(doc, m);
  const clashText = c ? equipClashes(doc, m.page).list.filter((x) => x.a === m.id || x.b === m.id).map((x) => `<li>${esc(x.text)}</li>`).join('') : '';
  return `<section class="psec"><h3>Equipment</h3>
    <div class="eq-propv">${eqPreviewSvg(e, 90)}<div><b>${esc(e.name || '')}</b><br><span class="muted">${esc([e.maker, e.model].filter(Boolean).join(' '))}</span><br><span class="muted">${Math.round(e.w)} × ${Math.round(e.d)}${e.h ? ' × ' + Math.round(e.h) : ''} mm${e.source === 'revit' ? ' · from Revit' : ''}</span></div></div>
    ${sc.unset ? '<p class="st-err">This page has no scale, so the unit is drawn at paper size. Set the page scale.</p>' : ''}
    ${c ? `<div class="eq-clashes" role="alert"><b>Clearance clash</b><ul>${clashText}</ul></div>` : ''}
    <div class="field two"><div><label>Tag</label><input type="text" data-k="tag" value="${esc(m.tag || '')}" maxlength="24"></div><div><label>Turned</label><div class="row-inline"><button type="button" class="icon-btn sm" data-act="equip-rot-l" title="Turn 90° anticlockwise" aria-label="Turn 90° anticlockwise">${icon('rotccw')}</button><input type="number" class="num" data-k="rot" value="${num(m.rot || 0, 1)}" step="15" aria-label="Rotation in degrees">°<button type="button" class="icon-btn sm" data-act="equip-rot-r" title="Turn 90° clockwise" aria-label="Turn 90° clockwise">${icon('rotcw')}</button></div></div></div>
    <label class="check"><input type="checkbox" data-k="flip"${m.flip ? ' checked' : ''}> Mirror (handed unit)</label>
    <label class="check"><input type="checkbox" data-k="show.service"${show.service !== false ? ' checked' : ''}> Service access clearances</label>
    <label class="check"><input type="checkbox" data-k="show.air"${show.air !== false ? ' checked' : ''}> Airflow zones</label>
    <label class="check"><input type="checkbox" data-k="show.label"${show.label !== false ? ' checked' : ''}> Tag and model</label>
    ${lib.length ? field('Unit', `<select data-k="eqpick"><option value="">${esc(e.name || 'Swap for…')}</option>${lib.filter((u) => u.id !== e.id).map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select>`) : ''}
    <div class="btn-row"><button type="button" class="btn sm" data-act="equip-edit">Edit this unit's sizes…</button></div></section>`;
}
