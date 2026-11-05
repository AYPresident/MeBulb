// ===== Ductwork: sized ducts drawn to scale, riser to riser ==========================================
// A duct is a centreline (m.pts) with a size in mm (m.duct): rectangular W x H or round Ø, insulation
// (external wrap or internal lining), a service (SA, RA…) and an end condition at each end (open,
// capped, or capped for a future provision / warm shell). Grilles (m.type 'grille') sit on a duct or
// anywhere, with face size, neck, free area and airflow. Section views (m.type 'section') draw a
// detail of a duct or grille at their own scale, with a cut marker on the plan.
// Ducts between risers are routed on a grid: orthogonal runs, few bends, avoiding the drawing's
// linework (walls), equipment and other risers.
const DUCT_SERVICES = [['SA', 'Supply air'], ['RA', 'Return air'], ['EA', 'Exhaust air'], ['OA', 'Outside air'], ['TA', 'Transfer air'], ['KE', 'Kitchen exhaust']];
const DUCT_ENDS = [['open', 'Open (connected)'], ['cap', 'Capped'], ['fp', 'Capped, future provision']];
const DUCT_DEFAULT = { shape: 'rect', w: 600, h: 300, d: 300, ins: 25, insKind: 'external', service: 'SA', ends: ['open', 'open'] };
const GRILLE_KINDS = [['supply', 'Supply diffuser', 'SG'], ['return', 'Return grille', 'RG'], ['exhaust', 'Exhaust grille', 'EG'], ['linear', 'Linear slot diffuser', 'LD'], ['transfer', 'Transfer grille', 'TG']];
const GRILLE_DEFAULT = { kind: 'supply', shape: 'rect', w: 600, h: 600, d: 300, neckW: 250, neckH: 250, neckD: 250, fa: 70, faM2: null, q: null, plenumH: 300 };
const DW = { duct: null, grille: null };
function ductDefaults() { if (!DW.duct) DW.duct = { ...DUCT_DEFAULT, ...store.get('ductDefaults', {}) }; return DW.duct; }
function grilleDefaults() { if (!DW.grille) DW.grille = { ...GRILLE_DEFAULT, ...store.get('grilleDefaults', {}) }; return DW.grille; }
function saveDuctDefaults() { store.set('ductDefaults', ductDefaults()); store.set('grilleDefaults', grilleDefaults()); }
// points per mm at this markup's scale
function ductK(doc, m) { const sc = scaleForMarkup(doc, m); return 1 / (25.4 * sc.inPerPt); }
function ductD(m) { return { ...DUCT_DEFAULT, ...(m.duct || {}), ends: (m.duct && m.duct.ends) || ['open', 'open'] }; }
function ductWmm(D) { return D.shape === 'round' ? +D.d || 0 : +D.w || 0; }
function ductSizeText(D) { return D.shape === 'round' ? `Ø${Math.round(D.d)}` : `${Math.round(D.w)}×${Math.round(D.h)}`; }
function ductInsText(D) { return D.ins > 0 ? `${Math.round(D.ins)} ${D.insKind === 'internal' ? 'LINED' : 'INS'}` : ''; }
function ductLabel(m) { const D = ductD(m); return [`${ductSizeText(D)} ${D.service || ''}`.trim(), ductInsText(D)].filter(Boolean).join(' · '); }
function serviceName(code) { const s = DUCT_SERVICES.find(([k]) => k === code); return s ? s[1] : code || ''; }

// ----- geometry --------------------------------------------------------------------------------------------
// an open polyline offset sideways by d (left of the direction of travel for d > 0), mitred at bends
function offsetPath(pts, d) {
  const n = pts.length; if (n < 2) return pts.map((p) => p.slice()); const out = []; const nrm = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1]; const l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  for (let i = 0; i < n; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    if (!a || !c) { const nn = a ? nrm(a, b) : nrm(b, c); out.push([b[0] + nn[0] * d, b[1] + nn[1] * d]); continue; }
    const n1 = nrm(a, b), n2 = nrm(b, c); const bis = [n1[0] + n2[0], n1[1] + n2[1]]; const bl = Math.hypot(bis[0], bis[1]);
    if (bl < 1e-6) { out.push([b[0] + n1[0] * d, b[1] + n1[1] * d]); continue; }
    const cosHalf = (n1[0] * bis[0] + n1[1] * bis[1]) / bl; const L = d / Math.max(cosHalf, 0.2);
    out.push([b[0] + (bis[0] / bl) * L, b[1] + (bis[1] / bl) * L]);
  }
  return out;
}
const ring = (l, r) => l.concat(r.slice().reverse());
function ductGeom(doc, m) {
  const D = ductD(m); const k = ductK(doc, m); const W = ductWmm(D) * k; const pts = dedupePts(m.pts);
  const half = W / 2; const left = offsetPath(pts, half), right = offsetPath(pts, -half);
  const ins = D.ins > 0 ? D.ins * k : 0; const ext = ins && D.insKind !== 'internal';
  return { D, k, W, pts, left, right, outline: ring(left, right), ins, ext, insL: ext ? offsetPath(pts, half + ins) : null, insR: ext ? offsetPath(pts, -half - ins) : null, len: G.len(pts) };
}
function dedupePts(pts) { const out = []; for (const p of pts) if (!out.length || G.dist(out[out.length - 1], p) > 0.01) out.push(p); return out; }
// the point a distance s along a polyline, with the direction there
function alongPts(pts, s) { let acc = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const l = G.dist(a, b); if (acc + l >= s || i === pts.length - 1) { const t = l ? clamp((s - acc) / l, 0, 1) : 0; return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ang: Math.atan2(b[1] - a[1], b[0] - a[0]), seg: i - 1 }; } acc += l; } return { p: pts[0], ang: 0, seg: 0 }; }
// nearest point of a polyline to p -> { s (distance along), d (distance away), p }
function nearestAlong(pts, p) { let best = null, acc = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy; const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0; const q = [a[0] + dx * t, a[1] + dy * t]; const d = G.dist(p, q); if (!best || d < best.d) best = { s: acc + Math.sqrt(l2) * t, d, p: q }; acc += Math.sqrt(l2); } return best || { s: 0, d: Infinity, p: pts[0] }; }
function ductLengthMm(doc, m) { return G.len(dedupePts(m.pts)) / ductK(doc, m); }
function ductBends(m) { const p = dedupePts(m.pts); let n = 0; for (let i = 1; i < p.length - 1; i++) { const a1 = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]), a2 = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]); let d = Math.abs(a1 - a2); if (d > Math.PI) d = 2 * Math.PI - d; if (d > 0.05) n++; } return n; }
function ductAreas(doc, m) { const D = ductD(m); const L = ductLengthMm(doc, m) / 1000; const per = D.shape === 'round' ? Math.PI * D.d / 1000 : 2 * (D.w + D.h) / 1000; const insPer = D.ins > 0 ? (D.shape === 'round' ? Math.PI * (D.d + (D.insKind === 'internal' ? 0 : 2 * D.ins)) / 1000 : 2 * (D.w + D.h + (D.insKind === 'internal' ? 0 : 4 * D.ins)) / 1000) : 0; return { L, metal: per * L, ins: insPer * L }; }

// ----- drawing ----------------------------------------------------------------------------------------------
function ductPrims(m, doc, opts = {}) {
  const s = m.style; const out = []; if (!m.pts || m.pts.length < 2) return out; const g = ductGeom(doc, m); const D = g.D; if (g.pts.length < 2 || g.W <= 0) return out;
  const col = s.stroke || '#1c7ed6'; const op = s.opacity; const lw = s.width || 0.8; const fs = s.fontSize || 8;
  const line = (pts, extra = {}) => ({ k: 'path', d: P.poly(pts), stroke: col, width: lw, fill: 'none', opacity: op, join: 'miter', role: 'line', ...extra }); let lg = 0; const lab = (ps) => { lg++; return ps.map((p) => ({ ...p, role: 'label', lg })); };
  if (g.ext && s.showIns !== false) out.push({ k: 'path', d: P.poly(ring(g.insL, g.insR), true), fill: col, fillOpacity: 0.05, stroke: col, width: Math.max(0.25, lw * 0.5), dash: 'dashshort', opacity: op, join: 'miter', role: 'ins', pts: ring(g.insL, g.insR) });
  out.push({ k: 'path', d: P.poly(g.outline, true), fill: s.fill && s.fill !== 'none' ? s.fill : col, fillOpacity: s.fillOpacity == null ? 0.12 : s.fillOpacity, stroke: 'none', opacity: op, hit: 'box', role: 'body' });
  out.push(line(g.left, { role: 'side' }), line(g.right, { role: 'side' }));
  if (D.ins > 0 && D.insKind === 'internal' && s.showIns !== false && g.ins < g.W / 2) out.push(line(offsetPath(g.pts, g.W / 2 - g.ins), { width: Math.max(0.25, lw * 0.5), dash: 'dashshort' }), line(offsetPath(g.pts, -g.W / 2 + g.ins), { width: Math.max(0.25, lw * 0.5), dash: 'dashshort' }));
  if (D.shape === 'round') out.push(line(g.pts, { width: Math.max(0.25, lw * 0.45), dash: 'center' }));
  // ends: open (connected), capped, or capped for a future provision
  [0, 1].forEach((e) => {
    const n = g.pts.length; const a = e ? g.pts[n - 1] : g.pts[0], b = e ? g.pts[n - 2] : g.pts[1]; const L = G.dist(a, b) || 1; const u = [(a[0] - b[0]) / L, (a[1] - b[1]) / L]; const nn = [-u[1], u[0]];
    const ext = g.ext ? g.ins : 0; const h = g.W / 2 + ext; const p1 = [a[0] + nn[0] * h, a[1] + nn[1] * h], p2 = [a[0] - nn[0] * h, a[1] - nn[1] * h]; const end = D.ends[e] || 'open';
    if (end === 'open') { out.push(line([[a[0] + nn[0] * g.W / 2, a[1] + nn[1] * g.W / 2], [a[0] - nn[0] * g.W / 2, a[1] - nn[1] * g.W / 2]], { width: Math.max(0.25, lw * 0.6) })); return; }
    const cw = Math.max(1.4, lw * 2.6); out.push(line([p1, p2], { width: cw, cap: 'butt' }));
    if (end === 'fp') out.push(line([[p1[0] + u[0] * cw * 1.6, p1[1] + u[1] * cw * 1.6], [p2[0] + u[0] * cw * 1.6, p2[1] + u[1] * cw * 1.6]], { width: Math.max(0.3, lw * 0.8), cap: 'butt' }));
    if (s.showLabel !== false) { const txt = end === 'fp' ? 'CAPPED · FUTURE PROVISION' : 'CAPPED'; const ang = uprightAngle(Math.atan2(nn[1], nn[0])); const off = fs * 0.9 + cw * 2; out.push(...lab(labelPrims([txt], a[0] + u[0] * off, a[1] + u[1] * off, ang, { ...s, fontSize: fs * 0.85, fontColor: s.fontColor || col }))); }
  });
  // airflow arrows, one per long run
  if (s.showFlow !== false) {
    const dir = m.duct && m.duct.rev ? -1 : 1; const al = Math.max(4, Math.min(g.W * 0.5, fs * 2.2));
    for (let i = 1; i < g.pts.length; i++) { const a = g.pts[i - 1], b = g.pts[i]; const L = G.dist(a, b); if (L < al * 5) continue; const u = [(b[0] - a[0]) / L * dir, (b[1] - a[1]) / L * dir]; const c = [a[0] + (b[0] - a[0]) * 0.28, a[1] + (b[1] - a[1]) * 0.28]; const t0 = [c[0] - u[0] * al / 2, c[1] - u[1] * al / 2], t1 = [c[0] + u[0] * al / 2, c[1] + u[1] * al / 2]; const ah = arrowHead(t1, t0, 'arrow', { width: Math.max(0.4, lw * 0.6) }); out.push(line([t0, ah.cut], { width: Math.max(0.4, lw * 0.6) }), ...ah.prims.map((p) => ({ ...p, stroke: col, fill: col, opacity: op, role: 'head' }))); }
  }
  // size label along the longest run: inside the duct when it fits, beside it otherwise
  if (s.showLabel !== false) {
    let bi = 1, bl = 0; for (let i = 1; i < g.pts.length; i++) { const l = G.dist(g.pts[i - 1], g.pts[i]); if (l > bl) { bl = l; bi = i; } }
    const a = g.pts[bi - 1], b = g.pts[bi]; const ang = uprightAngle(Math.atan2(b[1] - a[1], b[0] - a[0])); const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const lines = [m.text, ductLabel(m)].filter(Boolean);
    const M = labelMetrics(lines, s); const inside = M.h + 2 * M.padY < g.W * 0.92 && M.w < bl * 0.8; const off = inside ? 0 : g.W / 2 + (g.ext ? g.ins : 0) + M.h / 2 + M.padY + 2; const nn = [Math.sin(ang), -Math.cos(ang)];
    out.push(...lab(labelPrims(lines, c[0] + nn[0] * off, c[1] + nn[1] * off, ang, { ...s, fontColor: s.fontColor || col })));
  }
  if (doc && doc.markups && !opts.noCuts) doc.markups.forEach((x) => { if (x.type === 'section' && x.of === m.id && x.page === m.page) out.push(...sectionCut(doc, m, x)); });
  return out;
}

// ----- grilles ----------------------------------------------------------------------------------------------
function grilleD(m) { return { ...GRILLE_DEFAULT, ...(m.gr || {}) }; }
function grilleFA(G0) { if (G0.faM2 > 0) return +G0.faM2; const face = G0.shape === 'round' ? Math.PI * (G0.d / 1000) ** 2 / 4 : (G0.w / 1000) * (G0.h / 1000); return face * (G0.fa || 0) / 100; }
function grilleFaceText(G0) { return G0.shape === 'round' ? `Ø${Math.round(G0.d)}` : `${Math.round(G0.w)}×${Math.round(G0.h)}`; }
function grilleNeckText(G0) { return G0.shape === 'round' ? `Ø${Math.round(G0.neckD || G0.d)}` : `${Math.round(G0.neckW)}×${Math.round(G0.neckH)}`; }
function grilleVel(G0) { const fa = grilleFA(G0); return G0.q > 0 && fa > 0 ? G0.q / 1000 / fa : null; }
function grilleKind(k) { return GRILLE_KINDS.find(([v]) => v === k) || GRILLE_KINDS[0]; }
function grilleLines(m) {
  const G0 = grilleD(m); const s = m.style; const fa = grilleFA(G0); const v = grilleVel(G0);
  return [s.showTag !== false ? m.tag : '', s.showSize !== false ? grilleFaceText(G0) : '', s.showFa !== false && fa > 0 ? `FA ${num(fa, 3)} m²${G0.faM2 > 0 ? '' : ` (${num(G0.fa, 1)}%)`}` : '', s.showQ !== false && G0.q > 0 ? `${Math.round(G0.q)} L/s${v ? ` · ${num(v, 2)} m/s` : ''}` : ''].filter(Boolean);
}
// a grille on a duct sits on its centreline, turned with it
function grillePlace(doc, m) {
  const d = m.on && getMarkup(m.on, doc); if (d && d.type === 'duct' && d.page === m.page && d.pts.length > 1) { const pts = dedupePts(d.pts); const a = alongPts(pts, clamp(m.t || 0, 0, 1) * G.len(pts)); return { p: a.p, rot: a.ang, duct: d }; }
  return { p: m.pts[0], rot: ((m.rot || 0) * Math.PI) / 180, duct: null };
}
function grilleGeom(doc, m) {
  const G0 = grilleD(m); const k = ductK(doc, m); const pl = grillePlace(doc, m); const c = pl.p; const cs = Math.cos(pl.rot), sn = Math.sin(pl.rot);
  const tr = (x, y) => [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs];
  const hw = ((G0.shape === 'round' ? G0.d : G0.w) * k) / 2, hh = ((G0.shape === 'round' ? G0.d : G0.h) * k) / 2;
  return { G0, k, c, rot: pl.rot, tr, hw, hh, corners: [tr(-hw, -hh), tr(hw, -hh), tr(hw, hh), tr(-hw, hh)], duct: pl.duct };
}
function grillePrims(m, doc, opts = {}) {
  const s = m.style; const g = grilleGeom(doc, m); const G0 = g.G0; const col = s.stroke || '#1c7ed6'; const op = s.opacity; const lw = s.width || 0.8; const out = []; const { tr, hw, hh } = g;
  const line = (pts, extra = {}) => ({ k: 'path', d: P.poly(pts), stroke: col, width: Math.max(0.3, lw * 0.7), fill: 'none', opacity: op, ...extra });
  if (G0.shape === 'round') {
    out.push({ k: 'path', d: P.ellipse(g.c[0], g.c[1], hw, hw), stroke: col, width: lw, fill: s.fill && s.fill !== 'none' ? s.fill : '#ffffff', fillOpacity: s.fillOpacity == null ? 0.9 : s.fillOpacity, opacity: op, hit: 'box' });
    const r = hw * 0.7071; if (G0.kind !== 'return') out.push(line([tr(-r, -r), tr(r, r)]), line([tr(r, -r), tr(-r, r)])); else out.push(line([tr(-r, -r), tr(r, r)]));
    out.push({ k: 'path', d: P.ellipse(g.c[0], g.c[1], hw * 0.45, hw * 0.45), stroke: col, width: Math.max(0.25, lw * 0.5), fill: 'none', dash: 'dashshort', opacity: op });
  } else {
    out.push({ k: 'path', d: P.poly(g.corners, true), stroke: col, width: lw, fill: s.fill && s.fill !== 'none' ? s.fill : '#ffffff', fillOpacity: s.fillOpacity == null ? 0.9 : s.fillOpacity, opacity: op, hit: 'box' });
    const [c0, c1, c2, c3] = g.corners;
    if (G0.kind === 'supply') { out.push(line([c0, c2]), line([c1, c3])); const nw = Math.min(hw, (G0.neckW * g.k) / 2), nh = Math.min(hh, (G0.neckH * g.k) / 2); out.push(line([tr(-nw, -nh), tr(nw, -nh), tr(nw, nh), tr(-nw, nh), tr(-nw, -nh)], { dash: 'dashshort', width: Math.max(0.25, lw * 0.45) })); }
    else if (G0.kind === 'return') { out.push(line([c0, c2])); for (const f of [0.33, 0.66]) { out.push(line([tr(-hw + 2 * hw * f, -hh), tr(hw, hh - 2 * hh * f)], { width: Math.max(0.25, lw * 0.45) }), line([tr(-hw, -hh + 2 * hh * f), tr(hw - 2 * hw * f, hh)], { width: Math.max(0.25, lw * 0.45) })); } }
    else if (G0.kind === 'exhaust') { out.push(line([c1, c3])); out.push(line([tr(-hw * 0.6, -hh * 0.6), tr(hw * 0.6, -hh * 0.6), tr(hw * 0.6, hh * 0.6), tr(-hw * 0.6, hh * 0.6), tr(-hw * 0.6, -hh * 0.6)], { width: Math.max(0.25, lw * 0.45) })); }
    else if (G0.kind === 'linear') { for (let i = 1; i <= 2; i++) { const y = -hh + (2 * hh * i) / 3; out.push(line([tr(-hw * 0.94, y), tr(hw * 0.94, y)])); } }
    else { out.push(line([c0, c2], { dash: 'dashshort' }), line([c1, c3], { dash: 'dashshort' })); }
  }
  // label beside the grille, reading horizontally
  const lines = grilleLines(m); if (lines.length && s.showLabel !== false) { const M = labelMetrics(lines, s); const ext = Math.max(...g.corners.map((q) => q[0] - g.c[0])); out.push(...labelPrims(lines, g.c[0] + ext + M.w / 2 + M.padX + 3, g.c[1], 0, { ...s, fontColor: s.fontColor || col })); }
  if (doc && doc.markups && !opts.noCuts) doc.markups.forEach((x) => { if (x.type === 'section' && x.of === m.id && x.page === m.page) out.push(...sectionCut(doc, m, x)); });
  return out;
}
function nextGrilleTag(doc, kind) { const pre = grilleKind(kind)[2]; let n = 1; const used = new Set(doc.markups.filter((m) => m.type === 'grille').map((m) => m.tag)); while (used.has(`${pre}-${String(n).padStart(2, '0')}`)) n++; return `${pre}-${String(n).padStart(2, '0')}`; }
// a grille click: on a duct it attaches to it; elsewhere it stands alone
function placeGrilleAt(doc, page, p) {
  const G0 = deep(grilleDefaults()); const m = newMarkup('grille', page, [p.slice()], { gr: G0, tag: nextGrilleTag(doc, G0.kind) }); m.style = toolStyle('grille'); m.subject = state.toolSubjects.grille || grilleKind(G0.kind)[1];
  const d = ductAt(doc, page, p, 6 / doc.zoom); if (d) { const pts = dedupePts(d.pts); const na = nearestAlong(pts, p); m.on = d.id; m.t = na.s / (G.len(pts) || 1); m.pts = [na.p]; }
  addMarkup(m, doc); state.sel.clear(); state.sel.add(m.id); refreshSelection(); noteRecentTool(m); return m;
}
function ductAt(doc, page, p, tol = 0) { let best = null; for (const m of doc.markups) { if (m.type !== 'duct' || m.page !== page || m.pts.length < 2) continue; const g = ductGeom(doc, m); const na = nearestAlong(g.pts, p); if (na.d <= g.W / 2 + tol && (!best || na.d < best.d)) best = { m, d: na.d }; } return best && best.m; }
// grilles on a duct follow it when it moves or changes
function syncGrilles(doc, duct) { const out = []; doc.markups.forEach((x) => { if (x.type === 'grille' && x.on === duct.id) { const pl = grillePlace(doc, x); if (pl.duct) { x.pts = [pl.p]; out.push(x); } } }); return out; }

// ----- section views -------------------------------------------------------------------------------------
const SECTION_SCALES = [5, 10, 20, 25, 50];
function nextSectionLetter(doc) { const used = new Set(doc.markups.filter((m) => m.type === 'section').map((m) => m.letter)); for (let k = 0; k < 26; k++) { const l = String.fromCharCode(65 + k); if (!used.has(l)) return l; } return String(used.size + 1); }
// the cut marker on the plan: a line across the duct or grille with arrows (the way you look) and the letter
function sectionCut(doc, src, sec) {
  const s = sec.style; const col = s.stroke || '#343a40'; const fs = s.fontSize || 8; const out = []; let c, ang, half;
  if (src.type === 'duct') { const g = ductGeom(doc, src); const a = alongPts(g.pts, clamp(sec.t == null ? 0.5 : sec.t, 0, 1) * g.len); c = a.p; ang = a.ang; half = g.W / 2 + (g.ext ? g.ins : 0) + fs * 1.2; }
  else { const g = grilleGeom(doc, src); c = g.c; ang = g.rot; half = Math.max(g.hw, g.hh) + fs * 1.2; }
  const u = [Math.cos(ang), Math.sin(ang)], nn = [-u[1], u[0]]; const p1 = [c[0] + nn[0] * half, c[1] + nn[1] * half], p2 = [c[0] - nn[0] * half, c[1] - nn[1] * half];
  out.push({ k: 'path', d: P.poly([p1, p2]), stroke: col, width: 0.9, dash: 'center', fill: 'none', opacity: s.opacity });
  [p1, p2].forEach((p) => { const tip = [p[0] + u[0] * fs * 1.4, p[1] + u[1] * fs * 1.4]; const ah = arrowHead(tip, p, 'arrow', { width: 0.9 }); out.push({ k: 'path', d: P.poly([p, ah.cut]), stroke: col, width: 0.9, fill: 'none', opacity: s.opacity }, ...ah.prims.map((q) => ({ ...q, stroke: col, fill: col }))); const b = [p[0] + nn[0] * (p === p1 ? 1 : -1) * fs * 0.95, p[1] + nn[1] * (p === p1 ? 1 : -1) * fs * 0.95]; out.push({ k: 'path', d: P.ellipse(b[0], b[1], fs * 0.75, fs * 0.75), stroke: col, width: 0.7, fill: '#ffffff', fillOpacity: 1, opacity: s.opacity }, { k: 'text', x: b[0], y: b[1] + fs * 0.33, size: fs * 0.95, str: sec.letter || 'A', color: col, bold: true, anchor: 'middle', opacity: s.opacity }); });
  return out;
}
function dimPrims(a, b, off, txt, col, fs, op) { // a dimension line parallel to a-b, offset sideways by off
  const L = G.dist(a, b) || 1; const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; const nn = [-u[1], u[0]]; const A = [a[0] + nn[0] * off, a[1] + nn[1] * off], B = [b[0] + nn[0] * off, b[1] + nn[1] * off]; const t = 2.2;
  const ln = (p, q) => ({ k: 'path', d: P.poly([p, q]), stroke: col, width: 0.4, fill: 'none', opacity: op });
  const out = [ln(A, B), ln([a[0] + nn[0] * off * 0.15, a[1] + nn[1] * off * 0.15], [A[0] + nn[0] * 2, A[1] + nn[1] * 2]), ln([b[0] + nn[0] * off * 0.15, b[1] + nn[1] * off * 0.15], [B[0] + nn[0] * 2, B[1] + nn[1] * 2]), ln([A[0] - (u[0] + nn[0]) * t, A[1] - (u[1] + nn[1]) * t], [A[0] + (u[0] + nn[0]) * t, A[1] + (u[1] + nn[1]) * t]), ln([B[0] - (u[0] + nn[0]) * t, B[1] - (u[1] + nn[1]) * t], [B[0] + (u[0] + nn[0]) * t, B[1] + (u[1] + nn[1]) * t])];
  const ang = uprightAngle(Math.atan2(u[1], u[0])); const sd = Math.sign(off) || 1; const mid = [(A[0] + B[0]) / 2 + nn[0] * sd * fs * 0.75, (A[1] + B[1]) / 2 + nn[1] * sd * fs * 0.75];
  out.push(...labelPrims([txt], mid[0], mid[1], ang, { fontSize: fs, fontColor: col, labelBg: false, opacity: op }, { noBg: true })); return out;
}
// the detail itself, at its own scale, top-left at m.pts[0]
function sectionPrims(m, doc) {
  const s = m.style; const col = s.stroke || '#343a40'; const op = s.opacity; const fs = s.fontSize || 8; const out = []; const o = m.pts[0];
  const src = getMarkup(m.of, doc); const scl = m.scale || 10; const k = 72 / 25.4 / scl; // detail scale on paper
  const T = (txt, x, y, extra = {}) => out.push({ k: 'text', x, y, size: fs, str: txt, color: col, opacity: op, anchor: 'start', ...extra });
  const box = (x, y, w, h, extra = {}) => out.push({ k: 'path', d: P.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true), stroke: col, width: 1, fill: 'none', opacity: op, join: 'miter', ...extra });
  T(`SECTION ${m.letter || 'A'}`, o[0], o[1] + fs * 1.1, { bold: true, size: fs * 1.3 }); const tw = textWidth(`SECTION ${m.letter || 'A'}`, fs * 1.3, true);
  out.push({ k: 'path', d: P.poly([[o[0], o[1] + fs * 1.5], [o[0] + tw, o[1] + fs * 1.5]]), stroke: col, width: 0.8, fill: 'none', opacity: op }); T(`1:${scl}`, o[0], o[1] + fs * 2.7, { size: fs * 0.9 });
  const top = o[1] + fs * 4.2; const x0 = o[0] + fs * 2;
  if (!src) { T('(the duct or grille this section cut has been deleted)', o[0], top + fs, { size: fs * 0.9 }); out.push({ k: 'path', d: P.poly([[o[0], o[1]], [o[0] + 200, o[1]], [o[0] + 200, top + fs * 2], [o[0], top + fs * 2]], true), stroke: 'none', fill: 'transparent', hitOnly: true, hit: 'box' }); return out; }
  const notes = []; let right = x0, bottom = top;
  const ductSection = (D, cx, y) => { // cross-section of a duct centred on cx, top at y; returns its bottom
    const ins = D.ins > 0 ? D.ins * k : 0; const ext = ins && D.insKind !== 'internal';
    if (D.shape === 'round') { const r = (D.d * k) / 2; const cy = y + (ext ? ins : 0) + r; if (ext) out.push({ k: 'path', d: P.ellipse(cx, cy, r + ins, r + ins), stroke: col, width: 0.5, dash: 'dashshort', fill: col, fillOpacity: 0.07, opacity: op }); out.push({ k: 'path', d: P.ellipse(cx, cy, r, r), stroke: col, width: 1.2, fill: '#ffffff', fillOpacity: 1, opacity: op }); if (ins && !ext) out.push({ k: 'path', d: P.ellipse(cx, cy, Math.max(0.5, r - ins), Math.max(0.5, r - ins)), stroke: col, width: 0.5, dash: 'dashshort', fill: 'none', opacity: op }); out.push(...dimPrims([cx - r, cy + r + (ext ? ins : 0)], [cx + r, cy + r + (ext ? ins : 0)], -(fs * 1.6), `Ø${Math.round(D.d)}`, col, fs * 0.85, op)); right = Math.max(right, cx + r + (ext ? ins : 0)); return cy + r + (ext ? ins : 0); }
    const W = D.w * k, H = D.h * k; const x = cx - W / 2, yy = y + (ext ? ins : 0);
    if (ext) box(x - ins, yy - ins, W + 2 * ins, H + 2 * ins, { width: 0.5, dash: 'dashshort', fill: col, fillOpacity: 0.07 });
    box(x, yy, W, H, { width: 1.2, fill: '#ffffff', fillOpacity: 1 }); if (ins && !ext && ins * 2 < Math.min(W, H)) box(x + ins, yy + ins, W - 2 * ins, H - 2 * ins, { width: 0.5, dash: 'dashshort' });
    out.push(...dimPrims([x, yy + H + (ext ? ins : 0)], [x + W, yy + H + (ext ? ins : 0)], -(fs * 1.6), `${Math.round(D.w)}`, col, fs * 0.85, op), ...dimPrims([x + W + (ext ? ins : 0), yy + H], [x + W + (ext ? ins : 0), yy], -(fs * 1.6), `${Math.round(D.h)}`, col, fs * 0.85, op));
    right = Math.max(right, x + W + (ext ? ins : 0) + fs * 2.5); return yy + H + (ext ? ins : 0);
  };
  if (src.type === 'duct') {
    const D = ductD(src); const wmm = ductWmm(D) + (D.ins > 0 && D.insKind !== 'internal' ? 2 * D.ins : 0); const cx = x0 + (wmm * k) / 2; bottom = ductSection(D, cx, top) + fs * 3;
    notes.push(`${ductSizeText(D)} ${serviceName(D.service).toUpperCase()} DUCT`); if (D.ins > 0) notes.push(`${Math.round(D.ins)} mm ${D.insKind === 'internal' ? 'INTERNAL ACOUSTIC LINING' : 'EXTERNAL INSULATION'}`); if (src.text) notes.push(src.text);
    const aa = ductAreas(doc, src); notes.push(`RUN ${num(aa.L, 2)} m`);
  } else if (src.type === 'grille') {
    const G0 = grilleD(src); const face = (G0.shape === 'round' ? G0.d : G0.w) * k; const neck = (G0.shape === 'round' ? G0.neckD || G0.d : G0.neckW) * k; const ple = (G0.plenumH || 300) * k; const spig = 150 * k; const cx = x0 + Math.max(face, 1) / 2 + fs; let y = top;
    const duct = src.on && getMarkup(src.on, doc); if (duct && duct.type === 'duct') { const D = ductD(duct); y = ductSection(D, cx, y) + 0; notes.push(`FROM ${ductSizeText(D)} ${D.service} DUCT`); }
    // spigot (neck) from the duct to the plenum
    out.push({ k: 'path', d: P.poly([[cx - neck / 2, y], [cx - neck / 2, y + spig]]), stroke: col, width: 1, fill: 'none', opacity: op }, { k: 'path', d: P.poly([[cx + neck / 2, y], [cx + neck / 2, y + spig]]), stroke: col, width: 1, fill: 'none', opacity: op }); y += spig;
    box(cx - face / 2, y, face, ple, { width: 1 }); out.push({ k: 'path', d: P.poly([[cx - neck / 2, y], [cx + neck / 2, y]]), stroke: '#ffffff', width: 1.6, fill: 'none', opacity: op });
    const ceil = y + ple; const cl = cx - face / 2 - 300 * k, cr = cx + face / 2 + 300 * k;
    out.push({ k: 'path', d: P.poly([[cl, ceil], [cr, ceil]]), stroke: col, width: 0.6, fill: 'none', dash: 'dashed', opacity: op }); T('CEILING', cr + 2, ceil + fs * 0.35, { size: fs * 0.75 });
    out.push({ k: 'path', d: P.poly([[cx - face / 2, ceil], [cx + face / 2, ceil]]), stroke: col, width: 2.4, fill: 'none', opacity: op, cap: 'butt' });
    const nb = Math.max(3, Math.min(9, Math.round(face / 6))); for (let i = 1; i < nb; i++) { const xb = cx - face / 2 + (face * i) / nb; out.push({ k: 'path', d: P.poly([[xb, ceil - 1.8], [xb + (G0.kind === 'return' || G0.kind === 'exhaust' ? -1.5 : 1.5), ceil + 1.8]]), stroke: col, width: 0.5, fill: 'none', opacity: op }); }
    const up = G0.kind === 'return' || G0.kind === 'exhaust'; [-0.3, 0, 0.3].forEach((f) => { const ax = cx + face * f; const a = [ax, ceil + (up ? fs * 2.6 : fs * 0.7)], b = [ax + (up ? 0 : f * fs * 2), ceil + (up ? fs * 0.7 : fs * 2.6)]; const ah = arrowHead(b, a, 'arrow', { width: 0.6 }); out.push({ k: 'path', d: P.poly([a, ah.cut]), stroke: col, width: 0.6, fill: 'none', opacity: op }, ...ah.prims.map((q) => ({ ...q, stroke: col, fill: col }))); });
    out.push(...dimPrims([cx - face / 2, ceil], [cx + face / 2, ceil], -(fs * 4.4), grilleFaceText(G0), col, fs * 0.85, op));
    out.push(...dimPrims([cx + face / 2, ceil], [cx + face / 2, ceil - ple], -(fs * 1.6), `${Math.round(G0.plenumH || 300)}`, col, fs * 0.85, op));
    right = Math.max(right, cr + fs * 5, cx + face / 2 + fs * 3); bottom = ceil + fs * 6;
    const fa = grilleFA(G0); const v = grilleVel(G0);
    notes.push(`${src.tag ? src.tag + ' ' : ''}${grilleFaceText(G0)} ${grilleKind(G0.kind)[1].toUpperCase()}`, `NECK ${grilleNeckText(G0)} · PLENUM ${Math.round(G0.plenumH || 300)} HIGH`, `FREE AREA ${num(fa, 3)} m²${G0.faM2 > 0 ? '' : ` (${num(G0.fa, 1)}%)`}`); if (G0.q > 0) notes.push(`${Math.round(G0.q)} L/s${v ? ` @ ${num(v, 2)} m/s FACE VELOCITY` : ''}`);
  }
  // notes to the right
  const nx = right + fs * 1.5; notes.forEach((t, i) => T(t, nx, top + fs * (1 + i * 1.35), { size: fs * 0.9 }));
  const nw = notes.length ? Math.max(...notes.map((t) => textWidth(t, fs * 0.9))) : 0; const R = Math.max(nx + nw, o[0] + tw) + fs;
  out.unshift({ k: 'path', d: P.poly([[o[0] - fs * 0.6, o[1] - fs * 0.6], [R, o[1] - fs * 0.6], [R, bottom], [o[0] - fs * 0.6, bottom]], true), stroke: s.frame === false ? 'none' : col, width: 0.5, fill: '#ffffff', fillOpacity: s.fillOpacity == null ? 0.92 : s.fillOpacity, opacity: op, hit: 'box' });
  return out;
}
function startSectionPlace(src) { if (!src || !['duct', 'grille'].includes(src.type)) return; if (state.tool !== 'select') setTool('select'); state.placeSection = src.id; V.el.classList.add('picking'); toast('Click where the section detail goes (Esc to cancel)'); updateDraftBar(); }
function endSectionPlace() { if (!state.placeSection) return; state.placeSection = null; V.el.classList.remove('picking'); updateDraftBar(); }
function placeSectionAt(doc, page, p) {
  const src = getMarkup(state.placeSection, doc); endSectionPlace(); if (!src) return null; if (src.page !== page) { toast('Place the section on the same page as the duct or grille', 'error'); return null; }
  const m = newMarkup('section', page, [p.slice()], { of: src.id, letter: nextSectionLetter(doc), scale: 10, t: src.type === 'duct' ? 0.5 : null }); m.style = toolStyle('section'); m.subject = 'Section view';
  if (src.type === 'duct') { const g = ductGeom(doc, src); const na = nearestAlong(g.pts, p); m.t = clamp(na.s / (g.len || 1), 0.05, 0.95); }
  addMarkup(m, doc); renderMarkupEl(src, doc); state.sel.clear(); state.sel.add(m.id); refreshSelection(); return m;
}

// ----- routing ------------------------------------------------------------------------------------------------
// Orthogonal route from a to b on a grid: shortest with few bends, crossing as little of the drawing's
// linework (walls, doors) as possible, around equipment and other risers. Costs are in real mm.
class MinHeap { constructor() { this.k = []; this.v = []; } push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val); while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val; } pop() { const k = this.k, v = this.v; const top = v[0]; const lk = k.pop(), lv = v.pop(); if (k.length) { let i = 0; const n = k.length; while (true) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lk; v[i] = lv; } return top; } get size() { return this.k.length; } }
async function routeDuct(doc, page, a, b, opts = {}) {
  const pg = doc.pages[page]; const k = opts.k || (1 / (25.4 * scaleAt(doc, page, a).inPerPt)); const Wpt = (opts.wmm || 600) * k;
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]); const margin = Math.max(span * 0.45, 80, Wpt * 3);
  const X1 = clamp(Math.min(a[0], b[0]) - margin, 0, pg.w), Y1 = clamp(Math.min(a[1], b[1]) - margin, 0, pg.h), X2 = clamp(Math.max(a[0], b[0]) + margin, 0, pg.w), Y2 = clamp(Math.max(a[1], b[1]) + margin, 0, pg.h);
  let cell = clamp(Wpt / 2, 2.5, 40); const area = (X2 - X1) * (Y2 - Y1); if (area / (cell * cell) > 90000) cell = Math.sqrt(area / 90000);
  const C = Math.max(2, Math.ceil((X2 - X1) / cell)), R = Math.max(2, Math.ceil((Y2 - Y1) / cell)); const N = C * R;
  const wall = new Uint16Array(N), near = new Uint8Array(N), block = new Uint8Array(N);
  const ci = (x) => clamp(Math.floor((x - X1) / cell), 0, C - 1), ri = (y) => clamp(Math.floor((y - Y1) / cell), 0, R - 1);
  // drawing linework
  const g = await buildGeometry(doc, page); let nseg = 0;
  if (g && g.n && opts.avoidLines !== false) {
    const seen = new Set(); const gx1 = Math.floor(X1 / GEO_CELL), gx2 = Math.floor(X2 / GEO_CELL), gy1 = Math.floor(Y1 / GEO_CELL), gy2 = Math.floor(Y2 / GEO_CELL);
    for (let gx = gx1; gx <= gx2; gx++) for (let gy = gy1; gy <= gy2; gy++) { const l = g.grid.get(gx * 100003 + gy); if (l) for (const s of l) seen.add(s); }
    const S = g.segs; const stamp = new Uint32Array(N); let tag = 0; const rad = Math.max(1, Math.round(Wpt / 2 / cell));
    for (const s of seen) {
      const ax = S[s * 4], ay = S[s * 4 + 1], bx = S[s * 4 + 2], by = S[s * 4 + 3]; const L = Math.hypot(bx - ax, by - ay); if (L < 0.5) continue; tag++; nseg++;
      const steps = Math.ceil(L / (cell * 0.5)); for (let j = 0; j <= steps; j++) { const x = ax + ((bx - ax) * j) / steps, y = ay + ((by - ay) * j) / steps; if (x < X1 || x > X2 || y < Y1 || y > Y2) continue; const c = ci(x), r = ri(y); const id = r * C + c; if (stamp[id] !== tag) { stamp[id] = tag; if (wall[id] < 65000) wall[id]++; } }
    }
    // keep the duct's own width clear of walls: cells near linework cost a little extra
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { if (!wall[r * C + c]) continue; for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < R && cc >= 0 && cc < C) near[rr * C + cc] = 1; } }
  }
  // equipment and other risers are in the way (the two ends are not)
  const skip = new Set(opts.ignore || []);
  const blockPoly = (poly, pad) => { const bb = G.bbox(poly); for (let r = ri(bb.y - pad); r <= ri(bb.y2 + pad); r++) for (let c = ci(bb.x - pad); c <= ci(bb.x2 + pad); c++) { const p = [X1 + (c + 0.5) * cell, Y1 + (r + 0.5) * cell]; if (G.pointInPoly(p, poly) || pad > 0 && polyDist(poly, p) < pad) block[r * C + c] = 1; } };
  for (const m of doc.markups) { if (m.page !== page || skip.has(m.id)) continue; if (m.type === 'equip') blockPoly(eqGeom(doc, m).body, Wpt / 2); else if (m.type === 'sketch') { const gg = sizeGeom(sketchSize(doc, m), scaleForMarkup(doc, m), m.pts[0], sketchRot(doc, m)); blockPoly(gg.corners, Wpt / 2); } }
  const s0 = ri(a[1]) * C + ci(a[0]), s1 = ri(b[1]) * C + ci(b[0]); block[s0] = 0; block[s1] = 0;
  const BEND = (opts.bendMm == null ? 1500 : opts.bendMm) * k, LINE = (opts.lineMm == null ? 600 : opts.lineMm) * k, NEAR = (opts.nearMm == null ? 100 : opts.nearMm) * k;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; const gs = new Float32Array(N * 4).fill(Infinity); const from = new Int32Array(N * 4).fill(-1); const done = new Uint8Array(N * 4);
  const tx = s1 % C, ty = (s1 / C) | 0; const hfun = (id) => (Math.abs((id % C) - tx) + Math.abs(((id / C) | 0) - ty)) * cell;
  const H = new MinHeap(); for (let d = 0; d < 4; d++) { gs[s0 * 4 + d] = 0; H.push(hfun(s0), s0 * 4 + d); }
  let goal = -1; let iter = 0;
  while (H.size && iter++ < 3e6) {
    const st = H.pop(); if (done[st]) continue; done[st] = 1; const id = st >> 2, d = st & 3; if (id === s1) { goal = st; break; }
    const c = id % C, r = (id / C) | 0;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue; const cc = c + DX[nd], rr = r + DY[nd]; if (cc < 0 || rr < 0 || cc >= C || rr >= R) continue; const nid = rr * C + cc; if (block[nid]) continue;
      const cost = gs[st] + cell + (nd !== d ? BEND : 0) + wall[nid] * LINE + (near[nid] ? NEAR : 0); const ns = nid * 4 + nd;
      if (cost < gs[ns]) { gs[ns] = cost; from[ns] = st; H.push(cost + hfun(nid), ns); }
    }
  }
  if (goal < 0) return { pts: lRoute(a, b, true), cost: Infinity, found: false };
  // walk back, keep only the corners, then make the first and last runs meet the real end points squarely
  const cells = []; for (let st = goal; st >= 0; st = from[st]) cells.push(st); cells.reverse();
  const centre = (id) => [X1 + ((id % C) + 0.5) * cell, Y1 + (((id / C) | 0) + 0.5) * cell];
  const corners = [centre(cells[0] >> 2)]; for (let i = 1; i < cells.length - 1; i++) { if ((cells[i] & 3) !== (cells[i + 1] & 3)) corners.push(centre(cells[i] >> 2)); } corners.push(centre(cells[cells.length - 1] >> 2));
  return { pts: squareRoute(a, b, corners), cost: gs[goal], found: true, crossings: cells.reduce((n, st) => n + (wall[st >> 2] ? 1 : 0), 0), nseg };
}
function polyDist(poly, p) { let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, G.segDist(p, poly[i], poly[(i + 1) % poly.length])); return d; }
// replace the grid end points by the real ones, keeping every run horizontal or vertical
function squareRoute(a, b, corners) {
  const pts = corners.map((p) => p.slice()); if (pts.length < 2) return lRoute(a, b, true);
  const horiz = (p, q) => Math.abs(p[1] - q[1]) < Math.abs(p[0] - q[0]);
  if (pts.length === 2) return Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5 ? [a.slice(), b.slice()] : horiz(pts[0], pts[1]) ? [a.slice(), [(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]], b.slice()] : [a.slice(), [a[0], (a[1] + b[1]) / 2], [b[0], (a[1] + b[1]) / 2], b.slice()];
  if (horiz(pts[0], pts[1])) pts[1][1] = a[1]; else pts[1][0] = a[0];
  const n = pts.length; if (horiz(pts[n - 2], pts[n - 1])) pts[n - 2][1] = b[1]; else pts[n - 2][0] = b[0];
  pts[0] = a.slice(); pts[n - 1] = b.slice();
  return simplifyRoute(pts);
}
function simplifyRoute(pts) { const out = []; for (const p of pts) { if (out.length && G.dist(out[out.length - 1], p) < 0.3) continue; if (out.length >= 2) { const a = out[out.length - 2], b = out[out.length - 1]; const cross = (b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]); if (Math.abs(cross) < 0.5 * Math.max(1, G.dist(a, b))) { out[out.length - 1] = p; continue; } } out.push(p); } return out; }
function lRoute(a, b, acrossFirst) { if (Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5) return [a.slice(), b.slice()]; return acrossFirst ? [a.slice(), [b[0], a[1]], b.slice()] : [a.slice(), [a[0], b[1]], b.slice()]; }

// ----- connecting risers -------------------------------------------------------------------------------------------
function riserAt(doc, page, p) { for (const m of doc.markups) { if (m.type !== 'sketch' || m.page !== page) continue; const g = sizeGeom(sketchSize(doc, m), scaleForMarkup(doc, m), m.pts[0], sketchRot(doc, m)); if (insideOutline(g, p)) return m; } return null; }
function ductForRiser(doc, r) { const sz = sketchSize(doc, r); const D = deep(ductDefaults()); if (sz) { if (sz.shape === 'circle') { D.shape = 'round'; D.d = Math.round(sz.d * 25.4); } else { D.shape = 'rect'; const a = Math.round(sz.w * 25.4), b = Math.round(sz.h * 25.4); D.w = Math.max(a, b); D.h = Math.min(a, b); } } return D; }
async function connectRisers(doc, ra, rb, how = 'best') {
  const page = ra.page; const D = ductForRiser(doc, ra); const a = ra.pts[0].slice(), b = rb.pts[0].slice();
  const pts = how === 'straight' ? [a, b] : how === 'across' ? lRoute(a, b, true) : how === 'down' ? lRoute(a, b, false) : (await routeDuct(doc, page, a, b, { wmm: ductWmm(D), ignore: [ra.id, rb.id] })).pts;
  const m = newMarkup('duct', page, pts, { duct: D, from: ra.id, to: rb.id }); m.style = toolStyle('duct'); m.subject = state.toolSubjects.duct || 'Duct';
  const na = sketchName(doc, ra), nb = sketchName(doc, rb); m.text = na && nb ? (na === nb ? `${na} duct` : `${na} → ${nb}`) : '';
  return m;
}
async function connectSelectedRisers() {
  const doc = activeDoc(); if (!doc) return; const rs = selected(doc).filter((m) => m.type === 'sketch');
  if (rs.length !== 2 || rs[0].page !== rs[1].page) { toast('Select two risers on the same page (Shift+click the second), then connect them', 'error'); return; }
  pushUndo(doc); const m = await connectRisers(doc, rs[0], rs[1]); addMarkup(m, doc); state.sel.clear(); state.sel.add(m.id); refreshSelection(); openPanel('ductwork');
  toast(`Duct routed: ${num(ductLengthMm(doc, m) / 1000, 2)} m, ${ductBends(m)} bend${ductBends(m) === 1 ? '' : 's'}. Right-click it for other routes.`);
}
// every group of risers with the same name on this page gets ducts joining them (shortest tree)
async function connectSameNameRisers(page = currentPage()) {
  const doc = activeDoc(); if (!doc) return 0; const groups = new Map();
  doc.markups.forEach((m) => { if (m.type !== 'sketch' || m.page !== page) return; const n = String(sketchName(doc, m) || '').trim().toUpperCase(); if (!n) return; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(m); });
  const have = new Set(doc.markups.filter((m) => m.type === 'duct' && m.from && m.to).map((m) => [m.from, m.to].sort().join('|'))); const pairs = [];
  groups.forEach((rs) => { if (rs.length < 2) return; const inT = [rs[0]]; const out = rs.slice(1); while (out.length) { let best = null; inT.forEach((x) => out.forEach((y) => { const d = G.dist(x.pts[0], y.pts[0]); if (!best || d < best.d) best = { x, y, d }; })); pairs.push([best.x, best.y]); inT.push(best.y); out.splice(out.indexOf(best.y), 1); } });
  const todo = pairs.filter(([x, y]) => !have.has([x.id, y.id].sort().join('|')));
  if (!todo.length) { toast(pairs.length ? 'Those risers are already connected' : 'No two risers on this page share a name (for example M1 and M1)'); return 0; }
  const busy = $('#busy'); busy.hidden = false; busy.textContent = 'Routing ducts…'; await raf(); pushUndo(doc); const made = [];
  try { for (const [x, y] of todo) { const m = await connectRisers(doc, x, y); doc.markups.push(m); made.push(m); } } finally { busy.hidden = true; }
  renderMarks(doc, page); refreshPanels(); state.sel = new Set(made.map((m) => m.id)); refreshSelection(); openPanel('ductwork');
  toast(`${made.length} duct${made.length === 1 ? '' : 's'} routed between same-name risers (${made.map((m) => m.text).join(', ')})`); return made.length;
}
async function rerouteDuct(m, how) {
  const doc = activeDoc(); if (!m || m.type !== 'duct' || m.pts.length < 2) return; const a = m.pts[0].slice(), b = m.pts[m.pts.length - 1].slice();
  const pts = how === 'straight' ? [a, b] : how === 'across' ? lRoute(a, b, true) : how === 'down' ? lRoute(a, b, false) : (await routeDuct(doc, m.page, a, b, { wmm: ductWmm(ductD(m)), ignore: [m.from, m.to, m.id].filter(Boolean) })).pts;
  pushUndo(doc); m.pts = pts; touch(m); syncGrilles(doc, m); renderMarks(doc, m.page); refreshPanels(); renderSel(doc, m.page);
}
// a duct drawn by hand that starts or ends in a riser takes the riser's centre and name
function finishDuctDraft(doc, m) {
  if (!m.duct) m.duct = deep(ductDefaults()); const a = riserAt(doc, m.page, m.pts[0]), b = riserAt(doc, m.page, m.pts[m.pts.length - 1]);
  if (a) { m.from = a.id; m.pts[0] = a.pts[0].slice(); } if (b && b !== a) { m.to = b.id; m.pts[m.pts.length - 1] = b.pts[0].slice(); }
  if (a && b && !m.text) { const na = sketchName(doc, a), nb = sketchName(doc, b); m.text = na && nb ? (na === nb ? `${na} duct` : `${na} → ${nb}`) : ''; }
}

// ----- properties -------------------------------------------------------------------------------------------------
const numIn = (k, v, title, step = 5) => `<input type="number" class="num" data-k="${k}" value="${v == null ? '' : num(+v, 1)}" min="0" step="${step}" title="${esc(title)}">`;
function ductFields(D, pre) {
  return `<div class="field two"><div><label>Shape</label><select data-k="${pre}.shape"><option value="rect"${D.shape !== 'round' ? ' selected' : ''}>Rectangular</option><option value="round"${D.shape === 'round' ? ' selected' : ''}>Round</option></select></div><div><label>Service</label><select data-k="${pre}.service">${DUCT_SERVICES.map(([k, l]) => `<option value="${k}"${D.service === k ? ' selected' : ''}>${k} · ${esc(l)}</option>`).join('')}</select></div></div>
    ${D.shape === 'round' ? `<div class="field two"><div><label>Diameter (mm)</label>${numIn(pre + '.d', D.d, 'Diameter')}</div><div></div></div>` : `<div class="field two"><div><label>Width (mm)</label>${numIn(pre + '.w', D.w, 'Width (on plan)')}</div><div><label>Depth (mm)</label>${numIn(pre + '.h', D.h, 'Depth (height)')}</div></div>`}
    <div class="field two"><div><label>Insulation (mm)</label>${numIn(pre + '.ins', D.ins, 'Insulation thickness, 0 for none', 5)}</div><div><label>Insulation type</label><select data-k="${pre}.insKind"><option value="external"${D.insKind !== 'internal' ? ' selected' : ''}>External wrap</option><option value="internal"${D.insKind === 'internal' ? ' selected' : ''}>Internal lining</option></select></div></div>
    <div class="field two"><div><label>Start</label><select data-k="${pre}.end0">${DUCT_ENDS.map(([k, l]) => `<option value="${k}"${(D.ends || [])[0] === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div><label>End</label><select data-k="${pre}.end1">${DUCT_ENDS.map(([k, l]) => `<option value="${k}"${(D.ends || [])[1] === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>`;
}
function grilleFields(G0, pre) {
  return `<div class="field two"><div><label>Type</label><select data-k="${pre}.kind">${GRILLE_KINDS.map(([k, l]) => `<option value="${k}"${G0.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div><label>Face</label><select data-k="${pre}.shape"><option value="rect"${G0.shape !== 'round' ? ' selected' : ''}>Square / rectangular</option><option value="round"${G0.shape === 'round' ? ' selected' : ''}>Round</option></select></div></div>
    ${G0.shape === 'round' ? `<div class="field two"><div><label>Face Ø (mm)</label>${numIn(pre + '.d', G0.d, 'Face diameter')}</div><div><label>Neck Ø (mm)</label>${numIn(pre + '.neckD', G0.neckD, 'Neck diameter')}</div></div>` : `<div class="field two"><div><label>Face W (mm)</label>${numIn(pre + '.w', G0.w, 'Face width')}</div><div><label>Face H (mm)</label>${numIn(pre + '.h', G0.h, 'Face height (length)')}</div></div><div class="field two"><div><label>Neck W (mm)</label>${numIn(pre + '.neckW', G0.neckW, 'Neck width')}</div><div><label>Neck H (mm)</label>${numIn(pre + '.neckH', G0.neckH, 'Neck height')}</div></div>`}
    <div class="field two"><div><label>Free area (%)</label>${numIn(pre + '.fa', G0.fa, 'Free area as a percentage of the face (from the data sheet)', 1)}</div><div><label>or free area (m²)</label><input type="number" class="num" data-k="${pre}.faM2" value="${G0.faM2 > 0 ? num(G0.faM2, 4) : ''}" min="0" step="0.001" placeholder="from %" title="Free area from the data sheet; overrides the percentage"></div></div>
    <div class="field two"><div><label>Airflow (L/s)</label>${numIn(pre + '.q', G0.q, 'Design airflow', 5)}</div><div><label>Plenum height (mm)</label>${numIn(pre + '.plenumH', G0.plenumH, 'Plenum box height, for the section view', 25)}</div></div>`;
}
function ductPropsHtml(doc, m) {
  const D = ductD(m); const a = ductAreas(doc, m); const fr = m.from && getMarkup(m.from, doc), to = m.to && getMarkup(m.to, doc); const gr = doc.markups.filter((x) => x.type === 'grille' && x.on === m.id).length; const secs = doc.markups.filter((x) => x.type === 'section' && x.of === m.id);
  return `<section class="psec"><h3>Duct</h3><div class="measure-readout"><div class="mr-val">${esc(ductSizeText(D))} ${esc(D.service || '')}</div><div class="mr-sub">${num(a.L, 2)} m · ${ductBends(m)} bend${ductBends(m) === 1 ? '' : 's'}${fr || to ? ` · ${esc([fr ? sketchName(doc, fr) : '…', to ? sketchName(doc, to) : '…'].join(' → '))}` : ''}</div></div>
    ${ductFields(D, 'duct')}
    <div class="field"><label>Name</label><input type="text" data-k="text" value="${esc(m.text || '')}" maxlength="60" placeholder="e.g. M1 duct"></div>
    <div class="chk-row"><label class="check"><input type="checkbox" data-k="style.showLabel"${m.style.showLabel !== false ? ' checked' : ''}> Size label</label><label class="check"><input type="checkbox" data-k="style.showFlow"${m.style.showFlow !== false ? ' checked' : ''}> Airflow arrows</label><label class="check"><input type="checkbox" data-k="style.showIns"${m.style.showIns !== false ? ' checked' : ''}> Insulation</label></div>
    <dl class="meta"><dt>Sheet metal</dt><dd>${num(a.metal, 2)} m²</dd>${D.ins > 0 ? `<dt>Insulation</dt><dd>${num(a.ins, 2)} m²</dd>` : ''}<dt>Grilles</dt><dd>${gr}</dd>${secs.length ? `<dt>Sections</dt><dd>${secs.map((x) => x.letter).join(', ')}</dd>` : ''}</dl>
    <div class="btn-row"><button type="button" class="btn sm" data-act="duct-route">Best route</button><button type="button" class="btn sm" data-act="duct-flip">Flip airflow</button><button type="button" class="btn sm" data-act="duct-grilles">Add grilles…</button><button type="button" class="btn sm" data-act="duct-section">Section view</button></div></section>`;
}
function grillePropsHtml(doc, m) {
  const G0 = grilleD(m); const fa = grilleFA(G0); const v = grilleVel(G0); const d = m.on && getMarkup(m.on, doc);
  return `<section class="psec"><h3>Grille</h3><div class="measure-readout"><div class="mr-val">${esc(m.tag || '')} ${esc(grilleFaceText(G0))}</div><div class="mr-sub">Free area ${num(fa, 3)} m²${v ? ` · ${num(v, 2)} m/s face velocity` : ''}${d ? ` · on ${esc(d.text || ductLabel(d))}` : ''}</div></div>
    <div class="field"><label>Tag</label><input type="text" data-k="tag" value="${esc(m.tag || '')}" maxlength="20"></div>
    ${grilleFields(G0, 'gr')}
    ${d ? '' : field('Rotation (°)', `<input type="number" class="num" data-k="rot" value="${num(m.rot || 0, 1)}" step="15">`)}
    <div class="chk-row"><label class="check"><input type="checkbox" data-k="style.showTag"${m.style.showTag !== false ? ' checked' : ''}> Tag</label><label class="check"><input type="checkbox" data-k="style.showSize"${m.style.showSize !== false ? ' checked' : ''}> Size</label><label class="check"><input type="checkbox" data-k="style.showFa"${m.style.showFa !== false ? ' checked' : ''}> Free area</label><label class="check"><input type="checkbox" data-k="style.showQ"${m.style.showQ !== false ? ' checked' : ''}> Airflow</label></div>
    <div class="btn-row"><button type="button" class="btn sm" data-act="duct-section">Section view</button>${d ? '<button type="button" class="btn sm" data-act="grille-detach">Detach from duct</button>' : ''}</div></section>`;
}
function sectionPropsHtml(doc, m) {
  const src = getMarkup(m.of, doc);
  return `<section class="psec"><h3>Section view</h3><p class="muted sm">${src ? `Cuts ${esc(src.type === 'duct' ? src.text || ductLabel(src) : (src.tag || 'grille'))}. It redraws when that changes.` : 'What it cut has been deleted.'}</p>
    <div class="field two"><div><label>Letter</label><input type="text" data-k="letter" value="${esc(m.letter || 'A')}" maxlength="3"></div><div><label>Detail scale</label><select data-k="sec.scale">${SECTION_SCALES.map((v) => `<option value="${v}"${(m.scale || 10) === v ? ' selected' : ''}>1:${v}</option>`).join('')}</select></div></div>
    ${src && src.type === 'duct' ? field('Cut position along the duct', `<div class="range"><input type="range" min="0.02" max="0.98" step="0.01" data-k="sec.t" value="${m.t == null ? 0.5 : m.t}"><output>${Math.round((m.t == null ? 0.5 : m.t) * 100)}%</output></div>`) : ''}</section>`;
}
// property keys: duct.<f>, gr.<f>, sec.<f>; dd.* / gd.* change the defaults for new ones
function setDuctField(m, k, v) {
  const [g, f] = k.split('.'); const numish = !['shape', 'service', 'insKind', 'kind', 'end0', 'end1'].includes(f); const val = numish ? (v === '' || v == null ? null : +v) : v;
  if (g === 'duct') { const D = ductD(m); if (f === 'end0' || f === 'end1') { D.ends = D.ends.slice(); D.ends[f === 'end0' ? 0 : 1] = val; } else D[f] = val; m.duct = D; return true; }
  if (g === 'gr') { const G0 = grilleD(m); G0[f] = f === 'faM2' && !(val > 0) ? null : val; if (f === 'kind' && m.tag && /^[A-Z]{2}-\d+$/.test(m.tag)) m.tag = nextGrilleTag(activeDoc(), val); m.gr = G0; return true; }
  if (g === 'sec') { if (f === 'scale') m.scale = +v || 10; else if (f === 't') m.t = clamp(+v, 0, 1); return true; }
  return false;
}
function applyDuctDefault(k, v) { const [g, f] = k.split('.'); const numish = !['shape', 'service', 'insKind', 'kind', 'end0', 'end1'].includes(f); const val = numish ? (v === '' ? null : +v) : v; if (g === 'dd') { const D = ductDefaults(); if (f === 'end0' || f === 'end1') { D.ends = (D.ends || ['open', 'open']).slice(); D.ends[f === 'end0' ? 0 : 1] = val; } else D[f] = val; } else { const G0 = grilleDefaults(); G0[f] = f === 'faM2' && !(val > 0) ? null : val; } saveDuctDefaults(); }

async function addGrillesDialog(d) {
  const doc = activeDoc(); if (!d || d.type !== 'duct') return; const G0 = grilleDefaults(); const L = ductLengthMm(doc, d) / 1000;
  const r = await openDialog({ title: 'Add grilles along the duct', body: `<p>${esc(d.text || ductLabel(d))}, ${num(L, 2)} m long. Grilles are spaced evenly and use the settings for new grilles (Ductwork panel).</p><div class="field two"><div><label>How many</label><input type="number" name="n" value="${Math.max(1, Math.round(L / 3))}" min="1" max="60"></div><div><label>Type</label><select name="kind">${GRILLE_KINDS.map(([k, l]) => `<option value="${k}"${G0.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div><div class="field two"><div><label>Airflow each (L/s)</label><input type="number" name="q" value="${G0.q || ''}" min="0" step="5"></div><div></div></div>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Add grilles', value: true, primary: true }] });
  if (!r || !r.value) return; const n = clamp(Math.round(+r.form.n || 1), 1, 60); pushUndo(doc); const pts = dedupePts(d.pts); const len = G.len(pts); const made = [];
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; const a = alongPts(pts, t * len); const gg = { ...deep(G0), kind: r.form.kind || G0.kind, q: +r.form.q > 0 ? +r.form.q : null }; const m = newMarkup('grille', d.page, [a.p], { gr: gg, tag: nextGrilleTag(doc, gg.kind), on: d.id, t }); m.style = toolStyle('grille'); m.subject = grilleKind(gg.kind)[1]; doc.markups.push(m); made.push(m); }
  renderMarks(doc, d.page); refreshPanels(); state.sel = new Set(made.map((m) => m.id)); refreshSelection(); toast(`${n} grille${n === 1 ? '' : 's'} added along ${d.text || 'the duct'}`);
}

// ----- the Ductwork panel ------------------------------------------------------------------------------------------
const renderDuctPanelSoon = debounce(() => { if (panelShown('ductwork')) renderDuctPanel(); }, 150);
function renderDuctPanel() {
  const el = $('#ductwork'); if (!el) return; const doc = activeDoc(); const D = ductDefaults(), G0 = grilleDefaults(); const page = doc ? currentPage() : 0;
  const ducts = doc ? doc.markups.filter((m) => m.type === 'duct') : []; const grs = doc ? doc.markups.filter((m) => m.type === 'grille') : [];
  const same = doc ? (() => { const c = new Map(); doc.markups.forEach((m) => { if (m.type === 'sketch' && m.page === page) { const n = String(sketchName(doc, m) || '').trim().toUpperCase(); if (n) c.set(n, (c.get(n) || 0) + 1); } }); return [...c].filter(([, n]) => n > 1).map(([n]) => n); })() : [];
  el.innerHTML = `<div class="ts-bar"><button class="btn sm" data-dw="draw">${icon('duct')} Draw duct</button><button class="btn sm" data-dw="grille">${icon('grille')} Grille</button><span class="grow"></span><button class="icon-btn sm" data-dw="more" aria-label="More ductwork options">${icon('more')}</button></div>
    <section class="psec"><h3>Connect risers</h3><p class="muted sm">Routes a duct between risers: square runs, few bends, around walls, equipment and other risers. Edit the corners afterwards, or right-click the duct for other routes.</p>
      <div class="btn-row"><button class="btn sm primary" data-dw="same"${same.length ? '' : ' disabled'} title="${same.length ? 'Risers sharing a name on this page: ' + esc(same.join(', ')) : 'No two risers on this page share a name'}">Connect same-name risers${same.length ? ` (${esc(same.join(', '))})` : ''}</button><button class="btn sm" data-dw="sel">Connect the two selected</button></div></section>
    <section class="psec"><h3>New ducts</h3>${ductFields(D, 'dd')}<p class="muted sm">Ducts connected to a riser take the riser's size.</p></section>
    <section class="psec"><h3>New grilles</h3>${grilleFields(G0, 'gd')}<p class="muted sm">Click on a duct to put the grille on it, or anywhere for a free-standing one.</p></section>
    ${ducts.length ? `<h4 class="eq-h">Ducts (${ducts.length})</h4><div class="eq-placed">${ducts.slice(0, 200).map((m) => { const d = ductD(m); return `<button class="eq-pl" data-dm="${esc(m.id)}"><b>${esc(m.text || ductSizeText(d))}</b> ${esc(ductSizeText(d))} ${esc(d.service || '')}${d.ins > 0 ? ' · ' + esc(ductInsText(d)) : ''}<span class="muted"> · ${num(ductLengthMm(doc, m) / 1000, 1)} m · p${m.page + 1}</span>${d.ends.some((e) => e !== 'open') ? '<span class="muted"> · capped</span>' : ''}</button>`; }).join('')}</div>` : ''}
    ${grs.length ? `<h4 class="eq-h">Grilles (${grs.length})</h4><div class="eq-placed">${grs.slice(0, 300).map((m) => { const g = grilleD(m); const v = grilleVel(g); return `<button class="eq-pl" data-dm="${esc(m.id)}"><b>${esc(m.tag || '')}</b> ${esc(grilleFaceText(g))} · FA ${num(grilleFA(g), 3)} m²${g.q ? ` · ${Math.round(g.q)} L/s` : ''}${v ? ` · ${num(v, 2)} m/s` : ''}<span class="muted"> · p${m.page + 1}</span></button>`; }).join('')}</div>` : ''}`;
}
function bindDuctPanel() {
  const el = $('#ductwork'); if (!el) return;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dw]'); const doc = activeDoc();
    if (b) { const k = b.dataset.dw;
      if (k === 'draw') setTool('duct'); else if (k === 'grille') setTool('grille'); else if (k === 'same') connectSameNameRisers(); else if (k === 'sel') connectSelectedRisers();
      else if (k === 'more') { const r = b.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, [['Duct and grille schedule (CSV)…', () => ductSchedule()]]); }
      return; }
    const p = e.target.closest('[data-dm]'); if (p && doc) { const m = getMarkup(p.dataset.dm); if (m) { setTool('select'); state.sel.clear(); state.sel.add(m.id); goToPage(m.page, m.pts[0]); refreshSelection(); } }
  });
  el.addEventListener('change', (e) => { const t = e.target; const k = t.dataset.k; if (!k || !/^(dd|gd)\./.test(k)) return; applyDuctDefault(k, t.value); renderDuctPanel(); });
}
function ductSchedule() {
  const doc = activeDoc(); if (!doc) return; const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`; const rows = [['Kind', 'Tag / name', 'Page', 'Size', 'Service', 'Insulation', 'Length m', 'Sheet metal m²', 'Insulation m²', 'Ends', 'Free area m²', 'Airflow L/s', 'Face velocity m/s']];
  doc.markups.filter((m) => m.type === 'duct').forEach((m) => { const D = ductD(m); const a = ductAreas(doc, m); rows.push(['Duct', m.text || '', m.page + 1, ductSizeText(D), D.service, ductInsText(D), num(a.L, 3), num(a.metal, 3), num(a.ins, 3), D.ends.join(' / '), '', '', '']); });
  doc.markups.filter((m) => m.type === 'grille').forEach((m) => { const g = grilleD(m); rows.push([grilleKind(g.kind)[1], m.tag || '', m.page + 1, grilleFaceText(g), '', '', '', '', '', '', num(grilleFA(g), 4), g.q || '', grilleVel(g) ? num(grilleVel(g), 3) : '']); });
  saveFile(`${doc.name.replace(/\.pdf$/i, '')} ductwork schedule.csv`, rows.map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv');
}

// ----- PDF: plain markups other apps can draw and edit (see sketchParts) ----------------------------------------
function ductParts(m, doc) {
  const s = m.style; const g = ductGeom(doc, m); const gid = m.group || 'DU-' + m.id; const prims = ductPrims(m, doc, { noCuts: true });
  const base = { page: m.page, layer: m.layer, author: m.author, created: m.created, modified: m.modified, status: m.status, group: gid, subject: m.subject };
  const out = [{ ...base, id: m.id, type: 'polygon', pts: g.outline.map((p) => p.slice()), style: { stroke: s.stroke, width: s.width, fill: s.fill && s.fill !== 'none' ? s.fill : s.stroke, fillOpacity: s.fillOpacity == null ? 0.12 : s.fillOpacity, opacity: s.opacity, dash: 'solid' }, comment: m.comment, _contents: [m.text, ductLabel(m), `${num(ductLengthMm(doc, m) / 1000, 2)} m`].filter(Boolean).join('\n'), ext: { ...(m.ext || {}), groupPrimary: m.group ? undefined : true, groupName: m.group ? undefined : m.text || 'Duct' }, _prims: prims.filter((p) => p.role === 'body' || p.role === 'side') }];
  let k = 0; const ptsOf = (p) => p.d.filter((q) => q[0] === 'M' || q[0] === 'L').map((q) => [q[1], q[2]]);
  prims.forEach((p) => {
    if (p.role === 'ins') out.push({ ...base, id: `${m.id}#i`, type: 'polygon', pts: p.pts.map((q) => q.slice()), style: { stroke: p.stroke, width: p.width, dash: p.dash, fill: p.fill, fillOpacity: p.fillOpacity, opacity: s.opacity }, ext: {}, _prims: [p] });
    else if (p.role === 'line') out.push({ ...base, id: `${m.id}#k${k++}`, type: 'polyline', pts: ptsOf(p), style: { stroke: p.stroke, width: p.width, dash: p.dash || 'solid', opacity: s.opacity }, ext: {}, _prims: [p] });
    else if (p.role === 'head') out.push({ ...base, id: `${m.id}#k${k++}`, type: 'polygon', pts: ptsOf(p), style: { stroke: p.stroke, width: p.width || 0, fill: p.fill, fillOpacity: 1, opacity: s.opacity }, ext: {}, _prims: [p] });
  });
  const groups = new Map(); prims.forEach((p) => { if (p.role === 'label') { if (!groups.has(p.lg)) groups.set(p.lg, []); groups.get(p.lg).push(p); } });
  [...groups.values()].forEach((ps, j) => { const b = primsBBox(ps); const t0 = ps.find((p) => p.k === 'text'); if (!b || !t0) return; out.push({ ...base, id: `${m.id}#t${j}`, type: 'text', pts: [[b.x, b.y], [b.x2, b.y2]], text: ps.filter((p) => p.k === 'text').map((p) => p.str).join('\n'), fixedH: true, style: { font: t0.font, fontSize: t0.size, bold: !!t0.bold, fontColor: t0.color, stroke: 'none', width: 0, fill: 'none', align: 'center', valign: 'middle', pad: 0.5, lineH: 1.18, opacity: s.opacity }, ext: {}, _prims: ps }); });
  return out;
}
// a grille for other apps: its face as a Square (Circle when round), its lines, and a text box
function grilleParts(m, doc) {
  const s = m.style; const g = grilleGeom(doc, m); const gid = m.group || 'GR-' + m.id; const prims = grillePrims(m, doc, { noCuts: true }); const G0 = g.G0;
  const base = { page: m.page, layer: m.layer, author: m.author, created: m.created, modified: m.modified, status: m.status, group: gid, subject: m.subject };
  const axis = Math.abs(Math.sin(2 * g.rot)) < 1e-3; const bb = G.bbox(g.corners); const face = prims.find((p) => p.hit === 'box');
  const out = [{ ...base, id: m.id, type: G0.shape === 'round' ? 'ellipse' : axis ? 'rect' : 'polygon', pts: G0.shape === 'round' ? [[g.c[0] - g.hw, g.c[1] - g.hw], [g.c[0] + g.hw, g.c[1] + g.hw]] : axis ? [[bb.x, bb.y], [bb.x2, bb.y2]] : g.corners.map((p) => p.slice()), style: { stroke: s.stroke, width: s.width, fill: face && face.fill, fillOpacity: face && face.fillOpacity, opacity: s.opacity, dash: 'solid' }, comment: m.comment, _contents: [m.tag, ...grilleLines(m).slice(1)].filter(Boolean).join('\n'), ext: { ...(m.ext || {}), groupPrimary: m.group ? undefined : true, groupName: m.group ? undefined : m.tag || 'Grille' }, _prims: face ? [face] : [] }];
  let k = 0; prims.forEach((p) => { if (p === face || p.k !== 'path') return; if (p.stroke === 'none' && p.fill) return; if (p.d.some((q) => q[0] === 'C')) { const b = primsBBox([{ ...p, width: 0 }]); out.push({ ...base, id: `${m.id}#k${k++}`, type: 'ellipse', pts: [[b.x + 1, b.y + 1], [b.x2 - 1, b.y2 - 1]], style: { stroke: p.stroke, width: p.width, dash: p.dash || 'solid', fill: 'none', opacity: s.opacity }, ext: {}, _prims: [p] }); return; } out.push({ ...base, id: `${m.id}#k${k++}`, type: 'polyline', pts: p.d.filter((q) => q[0] === 'M' || q[0] === 'L').map((q) => [q[1], q[2]]), style: { stroke: p.stroke, width: p.width, dash: p.dash || 'solid', opacity: s.opacity }, ext: {}, _prims: [p] }); });
  const texts = prims.filter((p) => p.k === 'text'); if (texts.length) { const bgs = prims.filter((p) => p.k === 'path' && p.stroke === 'none'); const ps = [...bgs, ...texts]; const b = primsBBox(ps); out.push({ ...base, id: `${m.id}#l`, type: 'text', pts: [[b.x, b.y], [b.x2, b.y2]], text: texts.map((p) => p.str).join('\n'), fixedH: true, style: { font: texts[0].font, fontSize: texts[0].size, fontColor: texts[0].color, stroke: 'none', width: 0, fill: 'none', align: 'center', valign: 'middle', pad: 0.5, lineH: 1.18, opacity: s.opacity }, ext: {}, _prims: ps }); }
  return out;
}
