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
const GRILLE_KINDS = [['supply', 'Supply diffuser', 'SG'], ['return', 'Return grille', 'RG'], ['exhaust', 'Exhaust grille', 'EG'], ['linear', 'Linear slot diffuser', 'LD'], ['transfer', 'Transfer grille', 'TG'], ['spa', 'Stair pressurisation grille', 'SPG'], ['relief', 'Relief air grille', 'RLG'], ['oa', 'Outside air grille', 'OAG']];
// how a grille sits: below the duct on a spigot and plenum (ceiling), flush in the duct's side or underside, or flush in a riser wall
const GRILLE_MOUNTS = [['ceiling', 'Ceiling diffuser below the duct'], ['side', 'Flush in the side of the duct'], ['bottom', 'Flush in the underside of the duct'], ['riser', 'Flush in a riser wall']];
const GRILLE_OUT = new Set(['supply', 'linear', 'spa', 'transfer']); // air comes out of these
const GRILLE_DEFAULT = { kind: 'supply', shape: 'rect', w: 600, h: 600, d: 300, neckW: 250, neckH: 250, neckD: 250, fa: 70, faM2: null, q: null, plenumH: 300, mount: 'ceiling', z: 2100, slots: 2, slotW: 25 };
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
// a duct leaving a riser through a face narrower than the duct starts with a transition (taper) from the
// face size to the duct size: D.trans[0] at the start, D.trans[1] at the end, each { w, h, len } in mm
function transLenMm(fw, W) { return Math.max(150, Math.round(Math.abs(W - fw) / 2 / Math.tan((15 * Math.PI) / 180) / 10) * 10); } // 15° a side
function subPath(pts, s0, s1) { const out = [alongPts(pts, s0).p]; let acc = 0; for (let i = 1; i < pts.length; i++) { acc += G.dist(pts[i - 1], pts[i]); if (acc > s0 + 1e-6 && acc < s1 - 1e-6) out.push(pts[i].slice()); } out.push(alongPts(pts, s1).p); return dedupePts(out); }
function ductGeom(doc, m) {
  const D = ductD(m); const k = ductK(doc, m); const W = ductWmm(D) * k; const pts = dedupePts(m.pts); const len = G.len(pts);
  const half = W / 2; const ins = D.ins > 0 ? D.ins * k : 0; const ext = ins && D.insKind !== 'internal';
  const T = (D.trans || []).map((t) => (t && t.w > 0 && D.shape !== 'round' && pts.length > 1 ? t : null)); const l0 = T[0] ? Math.min(T[0].len * k, len * 0.45) : 0, l1 = T[1] ? Math.min(T[1].len * k, len * 0.45) : 0;
  const body = l0 || l1 ? subPath(pts, l0, len - l1) : pts; let left = offsetPath(body, half), right = offsetPath(body, -half);
  let insL = ext ? offsetPath(body, half + ins) : null, insR = ext ? offsetPath(body, -half - ins) : null; const endW = [W, W]; const seams = [];
  [0, 1].forEach((e) => {
    if (!T[e]) return; const a = e ? pts[pts.length - 1] : pts[0], b = e ? pts[pts.length - 2] : pts[1]; const L = G.dist(a, b) || 1; const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; const nn = e ? [u[1], -u[0]] : [-u[1], u[0]]; const fw = T[e].w * k; endW[e] = fw;
    const fl = [a[0] + nn[0] * fw / 2, a[1] + nn[1] * fw / 2], fr = [a[0] - nn[0] * fw / 2, a[1] - nn[1] * fw / 2]; const sm = e ? body[body.length - 1] : body[0]; seams.push([[sm[0] + nn[0] * half, sm[1] + nn[1] * half], [sm[0] - nn[0] * half, sm[1] - nn[1] * half]]);
    if (e) { left = left.concat([fl]); right = right.concat([fr]); if (ext) { insL = insL.concat([[fl[0] + nn[0] * ins, fl[1] + nn[1] * ins]]); insR = insR.concat([[fr[0] - nn[0] * ins, fr[1] - nn[1] * ins]]); } }
    else { left = [fl].concat(left); right = [fr].concat(right); if (ext) { insL = [[fl[0] + nn[0] * ins, fl[1] + nn[1] * ins]].concat(insL); insR = [[fr[0] - nn[0] * ins, fr[1] - nn[1] * ins]].concat(insR); } }
  });
  return { D, k, W, pts, body, left, right, outline: ring(left, right), ins, ext, insL, insR, len, trans: T, endW, seams };
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
    const ext = g.ext ? g.ins : 0; const ew = g.endW[e]; const h = ew / 2 + ext; const p1 = [a[0] + nn[0] * h, a[1] + nn[1] * h], p2 = [a[0] - nn[0] * h, a[1] - nn[1] * h]; const end = D.ends[e] || 'open';
    if (end === 'open') { out.push(line([[a[0] + nn[0] * ew / 2, a[1] + nn[1] * ew / 2], [a[0] - nn[0] * ew / 2, a[1] - nn[1] * ew / 2]], { width: Math.max(0.25, lw * 0.6) })); return; }
    const cw = Math.max(1.4, lw * 2.6); out.push(line([p1, p2], { width: cw, cap: 'butt' }));
    if (end === 'fp') out.push(line([[p1[0] + u[0] * cw * 1.6, p1[1] + u[1] * cw * 1.6], [p2[0] + u[0] * cw * 1.6, p2[1] + u[1] * cw * 1.6]], { width: Math.max(0.3, lw * 0.8), cap: 'butt' }));
    if (s.showLabel !== false) { const txt = end === 'fp' ? 'CAPPED · FUTURE PROVISION' : 'CAPPED'; const ang = uprightAngle(Math.atan2(nn[1], nn[0])); const off = fs * 0.9 + cw * 2; out.push(...lab(labelPrims([txt], a[0] + u[0] * off, a[1] + u[1] * off, ang, { ...s, fontSize: fs * 0.85, fontColor: s.fontColor || col }))); }
  });
  // transitions: a seam where the taper meets the duct, and the two sizes
  g.seams.forEach((sm) => out.push(line(sm, { width: Math.max(0.25, lw * 0.6) })));
  if (s.showLabel !== false) [0, 1].forEach((e) => {
    const t = g.trans[e]; if (!t) return; const n = g.pts.length; const a = e ? g.pts[n - 1] : g.pts[0], b = e ? g.pts[n - 2] : g.pts[1]; const L = G.dist(a, b) || 1; const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const tl = Math.min(t.len * g.k, g.len * 0.45); const c = [a[0] + u[0] * tl / 2, a[1] + u[1] * tl / 2]; const ang = uprightAngle(Math.atan2(u[1], u[0])); const nn = [Math.sin(ang), -Math.cos(ang)]; const fs2 = fs * 0.8;
    const off = g.W / 2 + (g.ext ? g.ins : 0) + fs2 * 1.1; out.push(...lab(labelPrims([`TRANSITION ${Math.round(t.w)}×${Math.round(t.h)} → ${ductSizeText(D)}`], c[0] - nn[0] * off, c[1] - nn[1] * off, ang, { ...s, fontSize: fs2, fontColor: s.fontColor || col })));
  });
  // airflow arrows, one per long run
  if (s.showFlow !== false) {
    const dir = m.duct && m.duct.rev ? -1 : 1; const al = Math.max(4, Math.min(g.W * 0.5, fs * 2.2));
    for (let i = 1; i < g.pts.length; i++) { const a = g.pts[i - 1], b = g.pts[i]; const L = G.dist(a, b); if (L < al * 5) continue; const u = [(b[0] - a[0]) / L * dir, (b[1] - a[1]) / L * dir]; const c = [a[0] + (b[0] - a[0]) * 0.28, a[1] + (b[1] - a[1]) * 0.28]; const t0 = [c[0] - u[0] * al / 2, c[1] - u[1] * al / 2], t1 = [c[0] + u[0] * al / 2, c[1] + u[1] * al / 2]; const ah = arrowHead(t1, t0, 'arrow', { width: Math.max(0.4, lw * 0.6) }); out.push(line([t0, ah.cut], { width: Math.max(0.4, lw * 0.6) }), ...ah.prims.map((p) => ({ ...p, stroke: col, fill: col, opacity: op, role: 'head' }))); }
  }
  // size label along the longest run: inside the duct when it fits, beside it otherwise
  if (s.showLabel !== false) {
    let bi = 1, bl = 0; for (let i = 1; i < g.pts.length; i++) { const l = G.dist(g.pts[i - 1], g.pts[i]); if (l > bl) { bl = l; bi = i; } }
    const a = g.pts[bi - 1], b = g.pts[bi]; const ang = uprightAngle(Math.atan2(b[1] - a[1], b[0] - a[0])); const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const cq = doc && doc.markups && s.showQ !== false ? ductCalcFor(doc, m) : null; const over = cq && cq.q > 0 && calcWarn(cq).length; const lines = [m.text, ductLabel(m), cq && cq.q > 0 ? `${Math.round(cq.q)} L/s · ${num(cq.v, 1)} m/s · ${num(cq.pa, 2)} Pa/m${over ? ' !' : ''}` : ''].filter(Boolean);
    const M = labelMetrics(lines, s); const inside = M.h + 2 * M.padY < g.W * 0.92 && M.w < bl * 0.8; const off = inside ? 0 : g.W / 2 + (g.ext ? g.ins : 0) + M.h / 2 + M.padY + 2; const nn = [Math.sin(ang), -Math.cos(ang)];
    out.push(...lab(labelPrims(lines, c[0] + nn[0] * off, c[1] + nn[1] * off, ang, { ...s, fontColor: over ? '#c92a2a' : s.fontColor || col })));
  }
  if (doc && doc.markups && !opts.noCuts) doc.markups.forEach((x) => { if (x.type === 'section' && x.of === m.id && x.page === m.page) out.push(...sectionCut(doc, m, x)); });
  return out;
}

// ----- grilles ----------------------------------------------------------------------------------------------
function grilleD(m) { return { ...GRILLE_DEFAULT, ...(m.gr || {}) }; }
function grilleFA(G0) { if (G0.faM2 > 0) return +G0.faM2; const slot = G0.kind === 'linear' && (G0.mount === 'side' || G0.mount === 'bottom'); const face = G0.shape === 'round' && !slot ? Math.PI * (G0.d / 1000) ** 2 / 4 : (G0.w / 1000) * ((slot ? (G0.slots || 2) * (G0.slotW || 25) : G0.h) / 1000); return face * (G0.fa || 0) / 100; }
function grilleFaceText(G0) { return G0.shape === 'round' ? `Ø${Math.round(G0.d)}` : `${Math.round(G0.w)}×${Math.round(G0.h)}`; }
function grilleNeckText(G0) { return G0.shape === 'round' ? `Ø${Math.round(G0.neckD || G0.d)}` : `${Math.round(G0.neckW)}×${Math.round(G0.neckH)}`; }
function grilleVel(G0) { const fa = grilleFA(G0); return G0.q > 0 && fa > 0 ? G0.q / 1000 / fa : null; }
function grilleKind(k) { return GRILLE_KINDS.find(([v]) => v === k) || GRILLE_KINDS[0]; }
function grilleLines(m) {
  const G0 = grilleD(m); const s = m.style; const fa = grilleFA(G0); const v = grilleVel(G0);
  return [s.showTag !== false ? m.tag : '', s.showSize !== false ? grilleFaceText(G0) : '', s.showFa !== false && fa > 0 ? `FA ${num(fa, 3)} m²${G0.faM2 > 0 ? '' : ` (${num(G0.fa, 1)}%)`}` : '', s.showQ !== false && G0.q > 0 ? `${Math.round(G0.q)} L/s${v ? ` · ${num(v, 2)} m/s` : ''}` : ''].filter(Boolean);
}
// where a grille sits: on a duct (along it, by mount), on a riser face, or free-standing. Returns the plan
// centre, the direction along the face (rot), the outward normal, and what it is on
function grillePlace(doc, m) {
  const host = m.on && getMarkup(m.on, doc); const G0 = grilleD(m);
  if (host && host.type === 'duct' && host.page === m.page && host.pts.length > 1) {
    const pts = dedupePts(host.pts); const len = G.len(pts); const half = len ? Math.min(0.5, ((G0.shape === 'round' && G0.mount !== 'side' && G0.mount !== 'bottom' ? G0.d : G0.w) * ductK(doc, m)) / 2 / len) : 0; const a = alongPts(pts, clamp(m.t || 0, half, 1 - half) * len); /* the whole grille stays on the duct */ const nL = [-Math.sin(a.ang), Math.cos(a.ang)]; const side = m.side === -1 ? -1 : 1;
    if (G0.mount === 'side') { const W = ductWmm(ductD(host)) * ductK(doc, host); const th = grilleThick(doc, m); const n = [nL[0] * side, nL[1] * side]; return { p: [a.p[0] + n[0] * (W / 2 - th / 2), a.p[1] + n[1] * (W / 2 - th / 2)], rot: a.ang, n, duct: host, host, face: true, axis: a.p }; }
    return { p: a.p, rot: a.ang, n: nL, duct: host, host };
  }
  if (host && host.type === 'sketch' && host.page === m.page) {
    const F = riserFaces(doc, host); const f = F[clamp(m.face | 0, 0, F.length - 1)];
    if (f) { const u = [-f.n[1], f.n[0]]; const flen = f.wmm * ductK(doc, host); const half = Math.min(0.5, (G0.w * ductK(doc, host)) / 2 / (flen || 1)); const t = clamp(m.t == null ? 0.5 : m.t, half, 1 - half); /* within the wall */ const th = grilleThick(doc, m); const q = [f.p[0] + u[0] * (t - 0.5) * flen - f.n[0] * th / 2, f.p[1] + u[1] * (t - 0.5) * flen - f.n[1] * th / 2]; return { p: q, rot: Math.atan2(u[1], u[0]), n: f.n, host, riser: host, face: true, flen }; }
  }
  return { p: m.pts[0], rot: ((m.rot || 0) * Math.PI) / 180, n: null, duct: null, host: null };
}
// a grille flush in a wall shows on plan as a thin strip of the wall
function grilleThick(doc, m) { return Math.max(2.4, 50 * ductK(doc, m)); }
function grilleGeom(doc, m) {
  const G0 = grilleD(m); const k = ductK(doc, m); const pl = grillePlace(doc, m); const c = pl.p; const cs = Math.cos(pl.rot), sn = Math.sin(pl.rot);
  const tr = (x, y) => [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]; let hw, hh;
  if (pl.face) { hw = (G0.w * k) / 2; hh = grilleThick(doc, m) / 2; } // along the wall, and the wall's thickness
  else if (G0.mount === 'bottom' && pl.duct) { const W = ductWmm(ductD(pl.duct)) * ductK(doc, pl.duct); hw = (G0.w * k) / 2; hh = Math.min(G0.kind === 'linear' ? (G0.slots || 2) * ((G0.slotW || 25) + 25) * k : G0.h * k, W * 0.9) / 2; }
  else { hw = ((G0.shape === 'round' ? G0.d : G0.w) * k) / 2; hh = ((G0.shape === 'round' ? G0.d : G0.h) * k) / 2; }
  return { G0, k, c, rot: pl.rot, tr, hw, hh, corners: [tr(-hw, -hh), tr(hw, -hh), tr(hw, hh), tr(-hw, hh)], duct: pl.duct, riser: pl.riser || null, n: pl.n, face: !!pl.face, mount: pl.face ? (pl.riser ? 'riser' : 'side') : pl.duct ? G0.mount === 'bottom' ? 'bottom' : 'ceiling' : 'free' };
}
// put a grille on whatever is under p: a riser wall, a duct, or nothing
function attachGrille(doc, m, p, tolPt) {
  const G0 = grilleD(m); const r = riserEdgeAt(doc, m.page, p, tolPt);
  if (r) { m.on = r.m.id; m.face = r.face; m.t = r.t; m.gr = { ...G0, mount: 'riser' }; m.pts = [p.slice()]; return 'riser'; }
  const d = ductAt(doc, m.page, p, tolPt);
  if (d) { const pts = dedupePts(d.pts); const na = nearestAlong(pts, p); m.on = d.id; m.t = na.s / (G.len(pts) || 1); const a = alongPts(pts, na.s); const cr = Math.cos(a.ang) * (p[1] - a.p[1]) - Math.sin(a.ang) * (p[0] - a.p[0]); m.side = cr >= 0 ? 1 : -1; if (G0.mount === 'riser') m.gr = { ...G0, mount: grilleDefaults().mount === 'riser' ? 'ceiling' : grilleDefaults().mount }; m.pts = [na.p]; return 'duct'; }
  delete m.on; delete m.t; delete m.face; if (G0.mount === 'riser' || G0.mount === 'side' || G0.mount === 'bottom') m.gr = { ...G0, mount: 'ceiling' }; m.pts = [p.slice()]; return null;
}
// a point on (or just by) a riser's outline: which riser, which face, how far along it
function riserEdgeAt(doc, page, p, tol) {
  let best = null;
  for (const r of doc.markups) {
    if (r.type !== 'sketch' || r.page !== page) continue;
    for (const f of riserFaces(doc, r)) {
      const u = [-f.n[1], f.n[0]]; const flen = f.wmm * ductK(doc, r); const v = [p[0] - f.p[0], p[1] - f.p[1]]; const along = v[0] * u[0] + v[1] * u[1], off = v[0] * f.n[0] + v[1] * f.n[1];
      if (Math.abs(along) > flen / 2 + tol || Math.abs(off) > tol + Math.min(6, flen * 0.15)) continue; const d = Math.abs(off); if (!best || d < best.d) best = { m: r, face: f.i, t: clamp(along / flen + 0.5, 0, 1), d };
    }
  }
  return best;
}
function grillePrims(m, doc, opts = {}) {
  const s = m.style; const g = grilleGeom(doc, m); const G0 = g.G0; const col = s.stroke || '#1c7ed6'; const op = s.opacity; const lw = s.width || 0.8; const out = []; const { tr, hw, hh } = g;
  const line = (pts, extra = {}) => ({ k: 'path', d: P.poly(pts), stroke: col, width: Math.max(0.3, lw * 0.7), fill: 'none', opacity: op, ...extra });
  const outA = GRILLE_OUT.has(G0.kind); const thin = Math.max(0.25, lw * 0.45);
  if (g.face) { // flush in a duct side or a riser wall: a strip of the wall with blades, and which way the air goes
    out.push({ k: 'path', d: P.poly(g.corners, true), stroke: col, width: lw, fill: s.fill && s.fill !== 'none' ? s.fill : '#ffffff', fillOpacity: 1, opacity: op, hit: 'box' });
    if (G0.kind === 'linear') out.push(line([tr(-hw, 0), tr(hw, 0)], { width: thin }));
    else { const nb = Math.max(3, Math.min(16, Math.round((hw * 2) / Math.max(2.5, hh * 1.6)))); for (let i = 1; i < nb; i++) { const x = -hw + (2 * hw * i) / nb; out.push(line([tr(x, -hh), tr(x, hh)], { width: thin })); } }
    const n = g.n; const al = Math.min(Math.max(6, hw * 0.7), 18); const c0 = [g.c[0] + n[0] * hh, g.c[1] + n[1] * hh]; const tipOut = [c0[0] + n[0] * al, c0[1] + n[1] * al];
    const [ta, tb] = outA ? [c0, tipOut] : [tipOut, c0]; const ah = arrowHead(tb, ta, 'arrow', { width: thin }); out.push(line([ta, ah.cut], { width: thin }), ...ah.prims.map((q) => ({ ...q, stroke: col, fill: col, opacity: op })));
    out.push({ k: 'path', d: P.poly([tr(-hw - 2, -hh - 3), tr(hw + 2, -hh - 3), tr(hw + 2, hh + 3), tr(-hw - 2, hh + 3)], true), stroke: 'none', fill: 'transparent', hitOnly: true, hit: 'box' });
  } else if (g.mount === 'bottom') { // flush in the underside: hidden from above, so dashed
    out.push({ k: 'path', d: P.poly(g.corners, true), stroke: col, width: lw, dash: 'dashshort', fill: s.fill && s.fill !== 'none' ? s.fill : col, fillOpacity: 0.06, opacity: op, hit: 'box' });
    if (G0.kind === 'linear') { const n = Math.max(1, G0.slots || 2); for (let i = 0; i < n; i++) { const y = -hh + (2 * hh * (i + 0.5)) / n; out.push(line([tr(-hw * 0.96, y), tr(hw * 0.96, y)], { dash: 'dashshort' })); } }
    else { const [c0, c1, c2, c3] = g.corners; out.push(line([c0, c2], { dash: 'dashshort', width: thin }), line([c1, c3], { dash: 'dashshort', width: thin })); }
  } else if (G0.shape === 'round') {
    out.push({ k: 'path', d: P.ellipse(g.c[0], g.c[1], hw, hw), stroke: col, width: lw, fill: s.fill && s.fill !== 'none' ? s.fill : '#ffffff', fillOpacity: s.fillOpacity == null ? 0.9 : s.fillOpacity, opacity: op, hit: 'box' });
    const r = hw * 0.7071; if (G0.kind !== 'return') out.push(line([tr(-r, -r), tr(r, r)]), line([tr(r, -r), tr(-r, r)])); else out.push(line([tr(-r, -r), tr(r, r)]));
    out.push({ k: 'path', d: P.ellipse(g.c[0], g.c[1], hw * 0.45, hw * 0.45), stroke: col, width: Math.max(0.25, lw * 0.5), fill: 'none', dash: 'dashshort', opacity: op });
  } else {
    out.push({ k: 'path', d: P.poly(g.corners, true), stroke: col, width: lw, fill: s.fill && s.fill !== 'none' ? s.fill : '#ffffff', fillOpacity: s.fillOpacity == null ? 0.9 : s.fillOpacity, opacity: op, hit: 'box' });
    const [c0, c1, c2, c3] = g.corners;
    if (G0.kind === 'supply') { out.push(line([c0, c2]), line([c1, c3])); const nw = Math.min(hw, (G0.neckW * g.k) / 2), nh = Math.min(hh, (G0.neckH * g.k) / 2); out.push(line([tr(-nw, -nh), tr(nw, -nh), tr(nw, nh), tr(-nw, nh), tr(-nw, -nh)], { dash: 'dashshort', width: Math.max(0.25, lw * 0.45) })); }
    else if (G0.kind === 'return') { out.push(line([c0, c2])); for (const f of [0.33, 0.66]) { out.push(line([tr(-hw + 2 * hw * f, -hh), tr(hw, hh - 2 * hh * f)], { width: Math.max(0.25, lw * 0.45) }), line([tr(-hw, -hh + 2 * hh * f), tr(hw - 2 * hw * f, hh)], { width: Math.max(0.25, lw * 0.45) })); } }
    else if (G0.kind === 'exhaust') { out.push(line([c1, c3])); out.push(line([tr(-hw * 0.6, -hh * 0.6), tr(hw * 0.6, -hh * 0.6), tr(hw * 0.6, hh * 0.6), tr(-hw * 0.6, hh * 0.6), tr(-hw * 0.6, -hh * 0.6)], { width: Math.max(0.25, lw * 0.45) })); }
    else if (G0.kind === 'linear') { const n = Math.max(1, G0.slots || 2); for (let i = 1; i <= n; i++) { const y = -hh + (2 * hh * i) / (n + 1); out.push(line([tr(-hw * 0.94, y), tr(hw * 0.94, y)])); } }
    else if (G0.kind === 'spa' || G0.kind === 'relief' || G0.kind === 'oa') { out.push(line([c0, c2]), line([c1, c3])); for (let i = 1; i < 4; i++) { const y = -hh + (2 * hh * i) / 4; out.push(line([tr(-hw, y), tr(hw, y)], { width: thin })); } }
    else { out.push(line([c0, c2], { dash: 'dashshort' }), line([c1, c3], { dash: 'dashshort' })); }
  }
  // label: out from the wall for a flush grille, otherwise beside it reading horizontally
  const lines = grilleLines(m); if (lines.length && s.showLabel !== false) {
    const M = labelMetrics(lines, s);
    if (g.face && g.n) { const d = Math.abs(g.n[0]) * (M.w / 2 + M.padX) + Math.abs(g.n[1]) * (M.h / 2 + M.padY) + g.hh + Math.min(Math.max(6, g.hw * 0.7), 18) + 4; out.push(...labelPrims(lines, g.c[0] + g.n[0] * d, g.c[1] + g.n[1] * d, 0, { ...s, fontColor: s.fontColor || col })); }
    else { const ext = Math.max(...g.corners.map((q) => q[0] - g.c[0])); out.push(...labelPrims(lines, g.c[0] + ext + M.w / 2 + M.padX + 3, g.c[1], 0, { ...s, fontColor: s.fontColor || col })); }
  }
  if (doc && doc.markups && !opts.noCuts) doc.markups.forEach((x) => { if (x.type === 'section' && x.of === m.id && x.page === m.page) out.push(...sectionCut(doc, m, x)); });
  return out;
}
function nextGrilleTag(doc, kind) { const pre = grilleKind(kind)[2]; let n = 1; const used = new Set(doc.markups.filter((m) => m.type === 'grille').map((m) => m.tag)); while (used.has(`${pre}-${String(n).padStart(2, '0')}`)) n++; return `${pre}-${String(n).padStart(2, '0')}`; }
// a grille click: on a duct it attaches to it; elsewhere it stands alone
function placeGrilleAt(doc, page, p) {
  const G0 = deep(grilleDefaults()); if (G0.mount === 'riser') G0.mount = 'ceiling'; const m = newMarkup('grille', page, [p.slice()], { gr: G0, tag: '' }); m.style = toolStyle('grille'); m.subject = state.toolSubjects.grille || grilleKind(G0.kind)[1];
  const on = attachGrille(doc, m, p, 6 / doc.zoom);
  if (on === 'riser') { const r = getMarkup(m.on, doc); const nm = String(sketchName(doc, r) || ''); const rk = riserGrilleKind(nm); if (rk && grilleDefaults().kind === 'supply') m.gr = { ...m.gr, kind: rk }; const f = riserFaces(doc, r)[m.face]; if (f && m.gr.w > f.wmm) m.gr = { ...m.gr, w: Math.round(f.wmm * 0.8 / 50) * 50 || Math.round(f.wmm * 0.8) }; m.subject = grilleKind(m.gr.kind)[1]; }
  m.tag = nextGrilleTag(doc, m.gr.kind); if (on) m.pts = [grillePlace(doc, m).p];
  addMarkup(m, doc); state.sel.clear(); state.sel.add(m.id); refreshSelection(); noteRecentTool(m); return m;
}
// a riser named like a stair pressurisation, relief or outside air riser gets that kind of grille
function riserGrilleKind(name) { const n = name.toUpperCase(); return /\bSP|STAIR|PRESS/.test(n) ? 'spa' : /\bREL|RLF|\bRA\b/.test(n) ? 'relief' : /\bOA|FRESH|\bFA\b|OUTSIDE/.test(n) ? 'oa' : /\bEX|\bEA\b|EXH/.test(n) ? 'exhaust' : null; }
// the same grille on every floor the riser goes through
function grilleEveryFloor(doc, m) {
  const r = m.on && getMarkup(m.on, doc); if (!r || r.type !== 'sketch') return 0; const L = linkOf(doc, r); if (!L) { toast('This riser is only on one page'); return 0; }
  pushUndo(doc); let n = 0;
  doc.markups.filter((x) => x.link === L.id && x.id !== r.id).forEach((x) => {
    if (doc.markups.some((g) => g.type === 'grille' && g.on === x.id && g.face === m.face && Math.abs((g.t ?? 0.5) - (m.t ?? 0.5)) < 0.05)) return; // one there already
    const c = { ...deep(m), id: uid(), page: x.page, on: x.id, created: nowISO(), modified: nowISO() }; delete c.group; c.pts = [grillePlace(doc, c).p]; doc.markups.push(c); n++;
  });
  renderAllMarks(doc); refreshPanels(); toast(n ? `${m.tag || 'Grille'} added on ${n} more floor${n === 1 ? '' : 's'}` : 'Every floor already has this grille'); return n;
}
function ductAt(doc, page, p, tol = 0) { let best = null; for (const m of doc.markups) { if (m.type !== 'duct' || m.page !== page || m.pts.length < 2) continue; const g = ductGeom(doc, m); const na = nearestAlong(g.pts, p); if (na.d <= g.W / 2 + tol && (!best || na.d < best.d)) best = { m, d: na.d }; } return best && best.m; }
// grilles on a duct follow it when it moves or changes
function syncGrilles(doc, host) { const out = []; doc.markups.forEach((x) => { if (x.type === 'grille' && x.on === host.id) { const pl = grillePlace(doc, x); if (pl.host) { x.pts = [pl.p]; out.push(x); } } }); return out; }

// ----- section views -------------------------------------------------------------------------------------
const SECTION_SCALES = [5, 10, 20, 25, 50];
function nextSectionLetter(doc) { const used = new Set(doc.markups.filter((m) => m.type === 'section').map((m) => m.letter)); for (let k = 0; k < 26; k++) { const l = String.fromCharCode(65 + k); if (!used.has(l)) return l; } return String(used.size + 1); }
// the cut marker on the plan: a line across the duct or grille with arrows (the way you look) and the letter
function sectionCut(doc, src, sec) {
  const s = sec.style; const col = s.stroke || '#343a40'; const fs = s.fontSize || 8; const out = []; let c, ang, half;
  if (src.type === 'duct') { const g = ductGeom(doc, src); const a = alongPts(g.pts, clamp(sec.t == null ? 0.5 : sec.t, 0, 1) * g.len); c = a.p; ang = a.ang; half = g.W / 2 + (g.ext ? g.ins : 0) + fs * 1.2; }
  else if (src.type === 'sketch') { const F = riserFaces(doc, src); const f = F[clamp(riserViewFace(doc, sec), 0, F.length - 1)]; if (!f) return out; c = src.pts[0]; ang = Math.atan2(f.n[1], f.n[0]); half = (f.wmm * ductK(doc, src)) / 2 + fs * 1.2; }
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
  if (src.type === 'sketch') return riserSectionPrims(m, doc, src, { o, k, fs, col, op, T, out, top, tw });
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
  } else if (src.type === 'grille' && ['side', 'bottom'].includes(grilleGeom(doc, src).mount) && src.on && getMarkup(src.on, doc)) {
    // a grille flush in the duct: the duct cut across, the grille in its side or underside, the air leaving it
    const gg = grilleGeom(doc, src); const G0 = gg.G0; const duct = getMarkup(src.on, doc); const D = ductD(duct); const W = (D.shape === 'round' ? D.d : D.w) * k, Hh = (D.shape === 'round' ? D.d : D.h) * k;
    const wmm = ductWmm(D) + (D.ins > 0 && D.insKind !== 'internal' ? 2 * D.ins : 0); const cx = x0 + (wmm * k) / 2 + fs * 3; const yb = ductSection(D, cx, top); const yt = yb - Hh - (D.ins > 0 && D.insKind !== 'internal' ? D.ins * k : 0); const outA = GRILLE_OUT.has(G0.kind); const thin = 0.5;
    const arrow = (a, b) => { const ah = arrowHead(b, a, 'arrow', { width: 0.6 }); out.push({ k: 'path', d: P.poly([a, ah.cut]), stroke: col, width: 0.6, fill: 'none', opacity: op }, ...ah.prims.map((q) => ({ ...q, stroke: col, fill: col }))); };
    if (gg.mount === 'side') {
      const sd = src.side === -1 ? 1 : -1; const xe = cx + sd * W / 2; const gh = Math.min((G0.kind === 'linear' ? (G0.slots || 2) * ((G0.slotW || 25) + 25) : G0.h) * k, Hh * 0.9); const yc = yb - (D.ins > 0 && D.insKind !== 'internal' ? D.ins * k : 0) - Hh / 2;
      out.push({ k: 'path', d: P.poly([[xe, yc - gh / 2], [xe, yc + gh / 2]]), stroke: col, width: 3, fill: 'none', opacity: op, cap: 'butt' }); for (let j = 1; j < 5; j++) { const yy = yc - gh / 2 + (gh * j) / 5; out.push({ k: 'path', d: P.poly([[xe - sd * 2, yy - 1], [xe + sd * 2, yy + 1]]), stroke: '#ffffff', width: thin, fill: 'none', opacity: op }); }
      [-0.25, 0.25].forEach((f) => { const yy = yc + gh * f; const a = [xe + sd * 3, yy], b = [xe + sd * fs * 3, yy]; outA ? arrow(a, b) : arrow(b, a); });
      out.push(...dimPrims([xe + sd * fs * 4, yc + gh / 2], [xe + sd * fs * 4, yc - gh / 2], sd * fs * 0.2, `${Math.round(G0.kind === 'linear' ? (G0.slots || 2) * (G0.slotW || 25) : G0.h)}`, col, fs * 0.8, op)); right = Math.max(right, cx + W / 2 + fs * 8);
    } else {
      const gw = Math.min((G0.kind === 'linear' ? (G0.slots || 2) * ((G0.slotW || 25) + 25) : G0.h) * k, W * 0.9); const ye = yb - (D.ins > 0 && D.insKind !== 'internal' ? D.ins * k : 0);
      out.push({ k: 'path', d: P.poly([[cx - gw / 2, ye], [cx + gw / 2, ye]]), stroke: col, width: 3, fill: 'none', opacity: op, cap: 'butt' }); for (let j = 1; j < 5; j++) { const xx = cx - gw / 2 + (gw * j) / 5; out.push({ k: 'path', d: P.poly([[xx - 1, ye - 2], [xx + 1, ye + 2]]), stroke: '#ffffff', width: thin, fill: 'none', opacity: op }); }
      [-0.25, 0.25].forEach((f) => { const xx = cx + gw * f; const a = [xx, ye + 3], b = [xx + f * fs, ye + fs * 3]; outA ? arrow(a, b) : arrow(b, a); });
    }
    bottom = yb + fs * 5; void yt;
    const fa = grilleFA(G0); const v = grilleVel(G0);
    notes.push(`${src.tag ? src.tag + ' ' : ''}${Math.round(G0.w)} LONG ${grilleKind(G0.kind)[1].toUpperCase()}`, `FLUSH IN THE ${gg.mount === 'side' ? 'SIDE' : 'UNDERSIDE'} OF THE ${ductSizeText(D)} ${D.service} DUCT`, `FREE AREA ${num(fa, 3)} m²${G0.faM2 > 0 ? '' : ` (${num(G0.fa, 1)}%)`}`); if (G0.kind === 'linear') notes.push(`${G0.slots || 2} SLOTS × ${G0.slotW || 25} mm`); if (G0.q > 0) notes.push(`${Math.round(G0.q)} L/s${v ? ` @ ${num(v, 2)} m/s FACE VELOCITY` : ''}`);
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
// ----- riser section: the riser through every floor it is linked on, with its grilles -----------------------------
const RISER_SCALES = [20, 50, 100, 200];
function riserInstances(doc, src) { const L = linkOf(doc, src); return (L ? doc.markups.filter((x) => x.type === 'sketch' && x.link === L.id) : [src]).sort((a, b) => a.page - b.page); }
// the wall the section looks at: chosen, or the one with most grilles, or the long one
function riserViewFace(doc, m) {
  if (m.face != null) return m.face; const src = getMarkup(m.of, doc); if (!src || src.type !== 'sketch') return 0; const ids = new Set(riserInstances(doc, src).map((x) => x.id)); const cnt = [0, 0, 0, 0];
  doc.markups.forEach((g) => { if (g.type === 'grille' && ids.has(g.on) && g.face != null) cnt[g.face & 3]++; }); const mx = Math.max(...cnt); if (mx > 0) return cnt.indexOf(mx);
  const F = riserFaces(doc, src); const lf = F.find((f) => f.long && (f.i === 1 || f.i === 0)); return lf ? lf.i : 1;
}
function levelName(doc, page, i) { const lab = doc.pages[page] && doc.pages[page].label; return lab && !/^\d+$/.test(lab) ? lab : i ? `Level ${i}` : 'Ground'; }
// airflow in the riser on floor i: with the air going up, everything let out on that floor and above; going
// down, that floor and below; otherwise the riser's total (set on it, or all its grilles)
function riserFloorQ(doc, src, floors, i, flow, gr) {
  const L = linkOf(doc, src); const set = L && L.q > 0 ? +L.q : src.q > 0 ? +src.q : 0; const qOf = (x) => gr.filter((g) => g.on === x.id).reduce((a, g) => a + +(grilleD(g).q || 0), 0);
  const tot = floors.reduce((a, x) => a + qOf(x), 0); if (flow !== 'up' && flow !== 'down') return set || tot;
  const part = (flow === 'up' ? floors.slice(i) : floors.slice(0, i + 1)).reduce((a, x) => a + qOf(x), 0); return set && tot ? (set * part) / tot : part;
}
function riserSectionPrims(m, doc, src, X) {
  const { o, fs, col, op, T, out, top, tw } = X; const scl = m.scale || 100; const k = 72 / 25.4 / scl; const inst = riserInstances(doc, src); const fv = riserViewFace(doc, m);
  const floors = (m.order === 'down' ? inst.slice().reverse() : inst); const lv = m.levels || {}; const ftf0 = +m.ftf || 3300; const slab = m.slab == null ? 200 : +m.slab; const rl0 = +m.rl0 || 0;
  const line = (pts, extra = {}) => out.push({ k: 'path', d: P.poly(pts), stroke: col, width: 0.8, fill: 'none', opacity: op, ...extra });
  const fwOf = (x, sz) => { const F = riserFaces(doc, { ...x, sz: sz || sketchSize(doc, x), link: sz ? null : x.link }); const f = F[fv] || F[0]; return f ? f.wmm : 0; };
  const sizeTxt = (sz) => (sz.shape === 'circle' ? `Ø${Math.round(sz.d * 25.4)}` : `${Math.round(sz.w * 25.4)}×${Math.round(sz.h * 25.4)}`);
  // heights, from the bottom floor up
  const H = floors.map((x) => +((lv[x.page] || {}).h) || ftf0); const total = H.reduce((a, b) => a + b, 0) + slab;
  const maxW = Math.max(...floors.map((x) => Math.max(fwOf(x), sketchTrans(doc, x) ? fwOf(x, sketchTrans(doc, x)) : 0)), 300);
  const lx = o[0] + fs * 7.5; const cx = lx + fs * 2.6 + (maxW / 2 + 900) * k; const slabL = cx - (maxW / 2 + 900) * k, slabR = cx + (maxW / 2 + 900) * k; const y0 = top + fs * 0.5 + total * k; // bottom of the lowest slab
  const ids = new Set(floors.map((x) => x.id)); const gr = doc.markups.filter((g) => g.type === 'grille' && ids.has(g.on)); const labX = slabR + fs * 1.5; let labW = 0; const labs = [];
  let yb = y0 - slab * k; // top of the slab under the floor being drawn
  floors.forEach((x, i) => {
    const h = H[i]; const yt = yb - (h - slab) * k; const A = sketchSize(doc, x), B = sketchTrans(doc, x); const wa = fwOf(x) * k, wb = B ? fwOf(x, B) * k : wa;
    // slab under this floor (cut by the riser opening), hatched
    const sw = Math.max(wa, i ? (fwOf(floors[i - 1], sketchTrans(doc, floors[i - 1]) || null) * k) : wa) / 2;
    const slabAt = (yTop, half) => { [[slabL, cx - half], [cx + half, slabR]].forEach(([a, b]) => { out.push({ k: 'path', d: P.poly([[a, yTop], [b, yTop], [b, yTop + slab * k], [a, yTop + slab * k]], true), stroke: col, width: 0.6, fill: col, fillOpacity: 0.08, opacity: op }); for (let hx = a + 4; hx < b - 1; hx += 6) line([[hx, yTop + slab * k], [Math.min(b, hx + slab * k * 0.9), yTop]], { width: 0.3 }); }); };
    slabAt(yb, sw);
    // level marker and name at the top of the slab
    const rl = rl0 + H.slice(0, i).reduce((a, b) => a + b, 0); const nm = (lv[x.page] && lv[x.page].name) || levelName(doc, x.page, i);
    out.push({ k: 'path', d: P.poly([[lx - fs * 0.6, yb - fs * 0.7], [lx + fs * 0.6, yb - fs * 0.7], [lx, yb]], true), stroke: col, width: 0.5, fill: col, fillOpacity: 1, opacity: op });
    line([[lx - fs * 0.8, yb], [slabL, yb]], { width: 0.4, dash: 'dashed' }); T(nm.toUpperCase(), o[0], yb - fs * 1.7, { size: fs * 0.85, bold: true }); T(`RL ${rl >= 0 ? '+' : '−'}${Math.abs(rl / 1000).toFixed(3)}`, o[0], yb - fs * 0.5, { size: fs * 0.75 });
    // the shaft walls, with a taper where the size changes on this floor
    if (B && Math.abs(wb - wa) > 0.05) { const ym = (yb + yt) / 2, d = Math.min(300 * k, (yb - yt) * 0.2); [-1, 1].forEach((sg) => line([[cx + sg * wa / 2, yb], [cx + sg * wa / 2, ym + d], [cx + sg * wb / 2, ym - d], [cx + sg * wb / 2, yt]], { width: 1.2 })); }
    else [-1, 1].forEach((sg) => line([[cx + sg * wa / 2, yb], [cx + sg * wa / 2, yt]], { width: 1.2 }));
    // size, beside the shaft low on the floor, with the airflow it carries there
    const qf = riserFloorQ(doc, src, floors, i, m.flow, gr); const cf = qf > 0 ? ductCalc(qf, sizeMm(B || A), { eps: matEps(riserMat(doc, src)) }) : null; const wf = cf ? calcWarn(cf) : [];
    labs.push({ y: yb - fs * 1.2, t: (B ? `${sizeTxt(A)} → ${sizeTxt(B)}` : sizeTxt(A)) + (cf ? ` · ${Math.round(qf)} L/s · ${num(cf.v, 1)} m/s · ${num(cf.pa, 2)} Pa/m${wf.length ? ' !' : ''}` : ''), bold: true, color: wf.length ? '#c92a2a' : null });
    // airflow arrow in the shaft
    if (m.flow === 'up' || m.flow === 'down') { const ya = (yb + yt) / 2, al = Math.min(fs * 2.4, (yb - yt) * 0.3); const a = [cx, m.flow === 'up' ? ya + al / 2 : ya - al / 2], b = [cx, m.flow === 'up' ? ya - al / 2 : ya + al / 2]; const ah = arrowHead(b, a, 'arrow', { width: 0.7 }); line([a, ah.cut], { width: 0.7 }); out.push(...ah.prims.map((q) => ({ ...q, stroke: col, fill: col }))); }
    // grilles on this floor
    gr.filter((g) => g.on === x.id).forEach((g) => {
      const G0 = grilleD(g); const f = g.face & 3; const t = g.t == null ? 0.5 : g.t; const gw = G0.w * k, gh = G0.h * k; const zb = yb - (+G0.z || 0) * k; const zt = zb - gh; const ws = (B ? wb : wa);
      const rel = (f - fv + 4) & 3; let gx1, gx2; let dash = null;
      if (rel === 0 || rel === 2) { const xc = cx + (rel === 0 ? 1 : -1) * (t - 0.5) * ws; gx1 = xc - gw / 2; gx2 = xc + gw / 2; dash = rel === 2 ? 'dashshort' : null;
        out.push({ k: 'path', d: P.poly([[gx1, zt], [gx2, zt], [gx2, zb], [gx1, zb]], true), stroke: col, width: 0.9, fill: '#ffffff', fillOpacity: rel === 0 ? 1 : 0, dash, opacity: op });
        const nb = Math.max(2, Math.min(10, Math.round(gh / 2.2))); for (let j = 1; j < nb; j++) { const yy = zt + (gh * j) / nb; line([[gx1, yy], [gx2, yy]], { width: 0.35, dash }); } }
      else { // in a side wall: seen edge on at the shaft side, air across
        const Fv = riserFaces(doc, x)[fv], Ff = riserFaces(doc, x)[f]; const right = Fv && Ff ? Ff.n[0] * -Fv.n[1] + Ff.n[1] * Fv.n[0] > 0 : rel === 1; const ex = cx + (right ? 1 : -1) * ws / 2; gx1 = Math.min(ex, ex + (right ? 2.5 : -2.5)); gx2 = Math.max(ex, ex + (right ? 2.5 : -2.5));
        out.push({ k: 'path', d: P.poly([[gx1, zt], [gx2, zt], [gx2, zb], [gx1, zb]], true), stroke: col, width: 0.9, fill: col, fillOpacity: 0.3, opacity: op });
        const sg = right ? 1 : -1; const outA = GRILLE_OUT.has(G0.kind); const ym = (zt + zb) / 2; const a = [ex + sg * (outA ? 3 : fs * 2.4), ym], b = [ex + sg * (outA ? fs * 2.4 : 3), ym]; const ah = arrowHead(b, a, 'arrow', { width: 0.6 }); line([a, ah.cut], { width: 0.6 }); out.push(...ah.prims.map((q) => ({ ...q, stroke: col, fill: col })));
      }
      const fa = grilleFA(G0); const v = grilleVel(G0); const txt = `${g.tag ? g.tag + ' ' : ''}${Math.round(G0.w)}×${Math.round(G0.h)}${G0.q > 0 ? ` · ${Math.round(G0.q)} L/s` : ''}${v ? ` · ${num(v, 1)} m/s` : ''}${fa > 0 ? ` · FA ${num(fa, 3)} m²` : ''}${rel === 2 ? ' (far wall)' : ''}`;
      labs.push({ y: (zt + zb) / 2, t: txt, from: [rel === 0 || rel === 2 ? gx2 : gx2, (zt + zb) / 2] });
      // mounting height
      if (rel === 0 && +G0.z > 0) { const dx = cx + ws / 2 + fs * 1.4; out.push(...dimPrims([dx, yb], [dx, zb], 0, `${Math.round(+G0.z)}`, col, fs * 0.7, op)); }
    });
    // floor to floor dimension on the far left
    out.push(...dimPrims([slabL, yb], [slabL, yb - h * k], -fs * 1.2, `${Math.round(h)}`, col, fs * 0.75, op));
    yb -= h * k;
  });
  // roof / top slab
  const last = floors[floors.length - 1]; const wl = last ? (sketchTrans(doc, last) ? fwOf(last, sketchTrans(doc, last)) : fwOf(last)) * k : 0;
  [[slabL, cx - wl / 2], [cx + wl / 2, slabR]].forEach(([a, b]) => { out.push({ k: 'path', d: P.poly([[a, yb], [b, yb], [b, yb + slab * k], [a, yb + slab * k]], true), stroke: col, width: 0.6, fill: col, fillOpacity: 0.08, opacity: op }); });
  T(`${(m.topName || 'Roof').toUpperCase()}`, o[0], yb - fs * 0.6, { size: fs * 0.85, bold: true });
  // labels in a column to the right, kept apart, with leaders
  labs.sort((a, b) => a.y - b.y); let lastY = -Infinity; labs.forEach((L0) => { const y = Math.max(L0.y, lastY + fs * 1.2); lastY = y; T(L0.t, labX, y + fs * 0.32, { size: fs * 0.82, bold: !!L0.bold, ...(L0.color ? { color: L0.color } : {}) }); labW = Math.max(labW, textWidth(L0.t, fs * 0.82, !!L0.bold)); if (L0.from) line([[L0.from[0], L0.from[1]], [labX - 3, y]], { width: 0.35 }); });
  // title notes
  const nm = sketchName(doc, src); T(`${nm ? nm + ' · ' : ''}RISER THROUGH ${floors.length} FLOOR${floors.length === 1 ? '' : 'S'} · LOOKING AT THE ${['+X', '+Y', '−X', '−Y'][fv]} WALL`, o[0] + tw + fs * 1.5, o[1] + fs * 1.1, { size: fs * 0.8 });
  const R = Math.max(labX + labW, o[0] + tw + fs * 30) + fs; const bottom = y0 + fs * 2.5;
  out.unshift({ k: 'path', d: P.poly([[o[0] - fs * 0.6, o[1] - fs * 0.6], [R, o[1] - fs * 0.6], [R, bottom], [o[0] - fs * 0.6, bottom]], true), stroke: m.style.frame === false ? 'none' : col, width: 0.5, fill: '#ffffff', fillOpacity: m.style.fillOpacity == null ? 0.92 : m.style.fillOpacity, opacity: op, hit: 'box' });
  return out;
}
function startSectionPlace(src) { if (!src || !['duct', 'grille', 'sketch'].includes(src.type)) return; if (state.tool !== 'select') setTool('select'); state.placeSection = src.id; V.el.classList.add('picking'); toast(`Click where the ${src.type === 'sketch' || (src.type === 'grille' && src.on && (getMarkup(src.on) || {}).type === 'sketch') ? 'riser section' : 'section detail'} goes (Esc to cancel)`); updateDraftBar(); }
function endSectionPlace() { if (!state.placeSection) return; state.placeSection = null; V.el.classList.remove('picking'); updateDraftBar(); }
function placeSectionAt(doc, page, p) {
  const src = getMarkup(state.placeSection, doc); endSectionPlace(); if (!src) return null; if (src.page !== page) { toast(`Place the section on the same page as the ${src.type === 'sketch' ? 'riser' : src.type}`, 'error'); return null; }
  const riser = src.type === 'sketch' || (src.type === 'grille' && src.on && (getMarkup(src.on, doc) || {}).type === 'sketch'); const rs = src.type === 'grille' && riser ? getMarkup(src.on, doc) : src;
  const m = newMarkup('section', page, [p.slice()], { of: rs.id, letter: nextSectionLetter(doc), scale: riser ? 100 : 10, t: src.type === 'duct' ? 0.5 : null }); m.style = toolStyle('section'); m.subject = riser ? 'Riser section' : 'Section view';
  if (riser) { m.ftf = 3300; m.flow = ''; if (src.type === 'grille') m.face = src.face & 3; }
  if (src.type === 'duct') { const g = ductGeom(doc, src); const na = nearestAlong(g.pts, p); m.t = clamp(na.s / (g.len || 1), 0.05, 0.95); }
  addMarkup(m, doc); renderMarkupEl(rs, doc); state.sel.clear(); state.sel.add(m.id); refreshSelection(); return m;
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
  const soft = new Set(opts.soft || []); // the risers at the two ends: not through them, but right up to them
  for (const m of doc.markups) { if (m.page !== page || skip.has(m.id)) continue; const pad = soft.has(m.id) ? 0 : Wpt / 2; if (m.type === 'equip') blockPoly(eqGeom(doc, m).body, pad); else if (m.type === 'sketch') { const gg = sizeGeom(sketchSize(doc, m), scaleForMarkup(doc, m), m.pts[0], sketchRot(doc, m)); blockPoly(gg.corners, pad); } }
  const s0 = ri(a[1]) * C + ci(a[0]), s1 = ri(b[1]) * C + ci(b[0]); block[s0] = 0; block[s1] = 0;
  const BEND = (opts.bendMm == null ? 1500 : opts.bendMm) * k, LINE = (opts.lineMm == null ? 600 : opts.lineMm) * k, NEAR = (opts.nearMm == null ? 100 : opts.nearMm) * k;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; const gs = new Float32Array(N * 4).fill(Infinity); const from = new Int32Array(N * 4).fill(-1); const done = new Uint8Array(N * 4);
  const tx = s1 % C, ty = (s1 / C) | 0; const hfun = (id) => (Math.abs((id % C) - tx) + Math.abs(((id / C) | 0) - ty)) * cell;
  const H = new MinHeap(); for (let d = 0; d < 4; d++) { if (opts.dir0 != null && d !== opts.dir0) continue; gs[s0 * 4 + d] = 0; H.push(hfun(s0), s0 * 4 + d); }
  let goal = -1; let iter = 0;
  while (H.size && iter++ < 3e6) {
    const st = H.pop(); if (done[st]) continue; done[st] = 1; const id = st >> 2, d = st & 3;
    if (id === s1) { if (opts.dir1 == null || d === opts.dir1) { goal = st; break; } const ns = s1 * 4 + opts.dir1; const cost = gs[st] + BEND; if (!done[ns] && cost < gs[ns]) { gs[ns] = cost; from[ns] = st; H.push(cost, ns); } continue; } // arrive square to the face
    const c = id % C, r = (id / C) | 0;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue; const cc = c + DX[nd], rr = r + DY[nd]; if (cc < 0 || rr < 0 || cc >= C || rr >= R) continue; const nid = rr * C + cc; if (block[nid]) continue;
      const cost = gs[st] + cell + (nd !== d ? BEND : 0) + wall[nid] * LINE + (near[nid] ? NEAR : 0); const ns = nid * 4 + nd;
      if (cost < gs[ns]) { gs[ns] = cost; from[ns] = st; H.push(cost + hfun(nid), ns); }
    }
  }
  if (goal < 0) return { pts: lRoute(a, b, true), cost: Infinity, found: false };
  // walk back, keep only the corners, then make the first and last runs meet the real end points squarely
  const cells = []; for (let st = goal; st >= 0; st = from[st]) { if (cells.length && (cells[cells.length - 1] >> 2) === (st >> 2)) { cells[cells.length - 1] = st; continue; } cells.push(st); } cells.reverse(); // the turn onto the face happens at the end point itself
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
function ductForRiser(doc, r) { const sz = sketchSize(doc, r); const D = deep(ductDefaults()); if (sz) { if (sz.shape === 'circle') { D.shape = 'round'; D.d = Math.round(sz.d * 25.4); } else { D.shape = 'rect'; const a = Math.round(sz.w * 25.4), b = Math.round(sz.h * 25.4); D.w = Math.max(a, b); D.h = Math.min(a, b); } } delete D.trans; return D; }
// the four faces of a riser: centre point on the outline, outward normal, face width (mm) and the riser's
// depth behind it (mm); a round riser has four quarter points
function riserFaces(doc, r) {
  const sz = sketchSize(doc, r); if (!sz) return []; const sc = scaleForMarkup(doc, r); const k = 1 / sc.inPerPt; const rot = sketchRot(doc, r); const c = r.pts[0]; const cs = Math.cos(rot), sn = Math.sin(rot);
  if (sz.shape === 'circle') { const R = (sz.d * k) / 2; return [0, 1, 2, 3].map((i) => { const n = [Math.cos(rot + (i * Math.PI) / 2), Math.sin(rot + (i * Math.PI) / 2)]; return { i, p: [c[0] + n[0] * R, c[1] + n[1] * R], n, wmm: sz.d * 25.4, dmm: sz.d * 25.4, long: true }; }); }
  const hw = (sz.w * k) / 2, hh = (sz.h * k) / 2; const ax = [cs, sn], ay = [-sn, cs];
  return [[ax, hw, sz.h, sz.w], [ay, hh, sz.w, sz.h], [[-ax[0], -ax[1]], hw, sz.h, sz.w], [[-ay[0], -ay[1]], hh, sz.w, sz.h]].map(([n, off, fw, dp], i) => ({ i, p: [c[0] + n[0] * off, c[1] + n[1] * off], n, wmm: fw * 25.4, dmm: dp * 25.4, long: fw >= dp - 1e-6 }));
}
const axisDir = (n) => (Math.abs(n[0]) >= Math.abs(n[1]) ? (n[0] >= 0 ? 0 : 2) : n[1] >= 0 ? 1 : 3); // index into the router's directions
// duct between two risers, leaving and entering square to a face. The long face is preferred (a 600×300
// riser feeds a 600 wide duct through its 600 face); a narrower face gets a transition up to the duct size.
async function riserRoute(doc, ra, rb, D, how = 'best') {
  const page = ra.page; const k = 1 / (25.4 * scaleForMarkup(doc, ra).inPerPt); const Wmm = ductWmm(D); const FA = riserFaces(doc, ra), FB = riserFaces(doc, rb);
  if (!FA.length || !FB.length) return null; const ca = ra.pts[0], cb = rb.pts[0]; const L0 = G.dist(ca, cb) || 1; const toB = [(cb[0] - ca[0]) / L0, (cb[1] - ca[1]) / L0];
  const fits = (f) => D.shape === 'round' || f.wmm >= Wmm - 1; const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const score = (f, dir) => dot(f.n, dir) + (fits(f) ? 0.75 : 0);
  let ca2 = FA, cb2 = FB; const horiz = (f) => Math.abs(f.n[0]) > Math.abs(f.n[1]);
  if (how === 'across') { ca2 = FA.filter((f) => horiz(f) && f.n[0] * toB[0] >= 0); cb2 = FB.filter((f) => !horiz(f) && f.n[1] * -toB[1] >= 0); }
  else if (how === 'down') { ca2 = FA.filter((f) => !horiz(f) && f.n[1] * toB[1] >= 0); cb2 = FB.filter((f) => horiz(f) && f.n[0] * -toB[0] >= 0); }
  if (!ca2.length) ca2 = FA; if (!cb2.length) cb2 = FB;
  const pick = (fs, dir, n) => fs.filter((f) => dot(f.n, dir) > -0.2 || how !== 'best').sort((x, y) => score(y, dir) - score(x, dir)).slice(0, n);
  const A = pick(ca2, toB, how === 'best' ? 2 : 1), B = pick(cb2, [-toB[0], -toB[1]], how === 'best' ? 2 : 1); if (!A.length || !B.length) return null;
  const transFor = (f) => (fits(f) ? null : { w: Math.round(f.wmm), h: Math.round((D.w * D.h) / Math.max(1, f.wmm)), len: transLenMm(f.wmm, Wmm) });
  let best = null;
  for (const fa of A) for (const fb of B) {
    const ta = transFor(fa), tb = transFor(fb); const sa = ((ta ? ta.len : 0) + 200) * k, sb = ((tb ? tb.len : 0) + 200) * k;
    const a1 = [fa.p[0] + fa.n[0] * sa, fa.p[1] + fa.n[1] * sa], b1 = [fb.p[0] + fb.n[0] * sb, fb.p[1] + fb.n[1] * sb];
    let mid, cost;
    if (how === 'straight') { mid = [a1, b1]; cost = G.dist(a1, b1); }
    else if (how === 'across' || how === 'down') { mid = lRoute(a1, b1, how === 'across'); cost = G.len(mid); }
    else { const r = await routeDuct(doc, page, a1, b1, { wmm: Wmm, soft: [ra.id, rb.id], dir0: axisDir(fa.n), dir1: axisDir([-fb.n[0], -fb.n[1]]) }); mid = r.pts; cost = r.found ? r.cost : G.len(r.pts) * 3; }
    cost += ((ta ? 8000 : 0) + (tb ? 8000 : 0)) * k; // out of the long face unless the route that way is far worse
    if (!best || cost < best.cost) best = { cost, pts: simplifyRoute([fa.p.slice(), ...mid, fb.p.slice()]), trans: [ta, tb], faces: [fa.i, fb.i] };
  }
  return best;
}
async function connectRisers(doc, ra, rb, how = 'best') {
  const page = ra.page; const D = ductForRiser(doc, ra); const r = await riserRoute(doc, ra, rb, D, how);
  const pts = r ? r.pts : [ra.pts[0].slice(), rb.pts[0].slice()]; if (r && (r.trans[0] || r.trans[1])) D.trans = r.trans;
  const m = newMarkup('duct', page, pts, { duct: D, from: ra.id, to: rb.id, faces: r ? r.faces : null }); m.style = toolStyle('duct'); m.subject = state.toolSubjects.duct || 'Duct';
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
  const ra = m.from && getMarkup(m.from, doc), rb = m.to && getMarkup(m.to, doc); const D = ductD(m);
  if (ra && rb && ra.type === 'sketch' && rb.type === 'sketch' && ra.page === m.page && rb.page === m.page) { // between two risers: out of a face again
    const r = await riserRoute(doc, ra, rb, { ...D, trans: null }, how); if (r) { pushUndo(doc); m.pts = r.pts; m.faces = r.faces; m.duct = { ...D, trans: r.trans[0] || r.trans[1] ? r.trans : null }; touch(m); syncGrilles(doc, m); renderMarks(doc, m.page); refreshPanels(); renderSel(doc, m.page); return; }
  }
  const pts = how === 'straight' ? [a, b] : how === 'across' ? lRoute(a, b, true) : how === 'down' ? lRoute(a, b, false) : (await routeDuct(doc, m.page, a, b, { wmm: ductWmm(D), ignore: [m.from, m.to, m.id].filter(Boolean) })).pts;
  pushUndo(doc); m.pts = pts; touch(m); syncGrilles(doc, m); renderMarks(doc, m.page); refreshPanels(); renderSel(doc, m.page);
}
// a duct drawn by hand that starts or ends in a riser takes the riser's centre and name
// a duct drawn by hand that starts or ends in a riser starts at the riser face it heads out of (with a
// transition when that face is narrower than the duct) and takes the riser's name
function snapToFace(doc, r, D, p, toward) {
  const F = riserFaces(doc, r); if (!F.length) return null; const d = [toward[0] - r.pts[0][0], toward[1] - r.pts[0][1]]; const L = Math.hypot(d[0], d[1]) || 1;
  const f = F.slice().sort((x, y) => (y.n[0] * d[0] + y.n[1] * d[1]) / L - (x.n[0] * d[0] + x.n[1] * d[1]) / L)[0]; const W = ductWmm(D);
  return { p: f.p.slice(), face: f.i, trans: D.shape === 'round' || f.wmm >= W - 1 ? null : { w: Math.round(f.wmm), h: Math.round((D.w * D.h) / Math.max(1, f.wmm)), len: transLenMm(f.wmm, W) } };
}
function finishDuctDraft(doc, m) {
  if (!m.duct) m.duct = deep(ductDefaults()); const a = riserAt(doc, m.page, m.pts[0]), b = riserAt(doc, m.page, m.pts[m.pts.length - 1]); const n = m.pts.length; const tr = [null, null];
  if (a && n > 1) { m.from = a.id; const f = snapToFace(doc, a, ductD(m), m.pts[0], m.pts[1]); if (f) { m.pts[0] = f.p; tr[0] = f.trans; } }
  if (b && b !== a && n > 1) { m.to = b.id; const f = snapToFace(doc, b, ductD(m), m.pts[n - 1], m.pts[n - 2]); if (f) { m.pts[n - 1] = f.p; tr[1] = f.trans; } }
  if (tr[0] || tr[1]) m.duct = { ...m.duct, trans: tr };
  if (a && b && !m.text) { const na = sketchName(doc, a), nb = sketchName(doc, b); m.text = na && nb ? (na === nb ? `${na} duct` : `${na} → ${nb}`) : ''; }
}

// ----- properties -------------------------------------------------------------------------------------------------
const numIn = (k, v, title, step = 5) => `<input type="number" class="num" data-k="${k}" value="${v == null ? '' : num(+v, 1)}" min="0" step="${step}" title="${esc(title)}">`;
// size and airflow of a duct (or of the next duct) in the shared card
function ductAirCard(doc, D, ctx, pre, m) {
  const q0 = m ? ductQ(doc, m) : 0;
  return airCardHtml({ ctx, q: D.q > 0 ? +D.q : 0, qFall: q0, qPh: q0 > 0 && !(D.q > 0) ? `${Math.round(q0)} from grilles` : 'L/s', qTitle: m ? 'Design airflow; leave blank to use the sum of the grilles on it' : 'Design airflow for the next duct', size: D.shape === 'round' ? { shape: 'round', d: D.d } : { shape: 'rect', w: D.w, h: D.h }, mat: D.mat || 'galv', wLabel: 'Width', hLabel: 'Depth', keys: { q: pre + '.q', shape: pre + '.shape', w: pre + '.w', h: pre + '.h', d: pre + '.d', mat: pre + '.mat' } });
}
function ductFields(D, pre, noSize) {
  return `${noSize ? `<div class="field"><label>Service</label><select data-k="${pre}.service">${DUCT_SERVICES.map(([k, l]) => `<option value="${k}"${D.service === k ? ' selected' : ''}>${k} · ${esc(l)}</option>`).join('')}</select></div>` : `<div class="field two"><div><label>Shape</label><select data-k="${pre}.shape"><option value="rect"${D.shape !== 'round' ? ' selected' : ''}>Rectangular</option><option value="round"${D.shape === 'round' ? ' selected' : ''}>Round</option></select></div><div><label>Service</label><select data-k="${pre}.service">${DUCT_SERVICES.map(([k, l]) => `<option value="${k}"${D.service === k ? ' selected' : ''}>${k} · ${esc(l)}</option>`).join('')}</select></div></div>
    ${D.shape === 'round' ? `<div class="field two"><div><label>Diameter (mm)</label>${numIn(pre + '.d', D.d, 'Diameter')}</div><div></div></div>` : `<div class="field two"><div><label>Width (mm)</label>${numIn(pre + '.w', D.w, 'Width (on plan)')}</div><div><label>Depth (mm)</label>${numIn(pre + '.h', D.h, 'Depth (height)')}</div></div>`}`}
    <div class="field two"><div><label>Insulation (mm)</label>${numIn(pre + '.ins', D.ins, 'Insulation thickness, 0 for none', 5)}</div><div><label>Insulation type</label><select data-k="${pre}.insKind"><option value="external"${D.insKind !== 'internal' ? ' selected' : ''}>External wrap</option><option value="internal"${D.insKind === 'internal' ? ' selected' : ''}>Internal lining</option></select></div></div>
    <div class="field two"><div><label>Start</label><select data-k="${pre}.end0">${DUCT_ENDS.map(([k, l]) => `<option value="${k}"${(D.ends || [])[0] === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div><label>End</label><select data-k="${pre}.end1">${DUCT_ENDS.map(([k, l]) => `<option value="${k}"${(D.ends || [])[1] === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>`;
}
function grilleFields(G0, pre, host) {
  const mounts = host === 'riser' ? GRILLE_MOUNTS.filter(([v]) => v === 'riser') : host === 'duct' ? GRILLE_MOUNTS.filter(([v]) => v !== 'riser') : host === 'free' ? GRILLE_MOUNTS.filter(([v]) => v === 'ceiling') : GRILLE_MOUNTS.filter(([v]) => v !== 'riser');
  const mount = G0.mount || 'ceiling'; const flush = mount === 'side' || mount === 'riser';
  const mountRow = host === 'riser' ? '' : `<div class="field"><label>${host ? 'Mounting' : 'On a duct'}</label><select data-k="${pre}.mount"${host === 'free' ? ' disabled title="Put it on a duct to choose"' : ''}>${mounts.map(([v, l]) => `<option value="${v}"${mount === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  return `${mountRow}<div class="field two"><div><label>Type</label><select data-k="${pre}.kind">${GRILLE_KINDS.map(([k, l]) => `<option value="${k}"${G0.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div><label>Face</label><select data-k="${pre}.shape"><option value="rect"${G0.shape !== 'round' ? ' selected' : ''}>Square / rectangular</option><option value="round"${G0.shape === 'round' ? ' selected' : ''}>Round</option></select></div></div>
    ${G0.shape === 'round' ? `<div class="field two"><div><label>Face Ø (mm)</label>${numIn(pre + '.d', G0.d, 'Face diameter')}</div><div><label>Neck Ø (mm)</label>${numIn(pre + '.neckD', G0.neckD, 'Neck diameter')}</div></div>` : `<div class="field two"><div><label>Face W (mm)</label>${numIn(pre + '.w', G0.w, 'Face width')}</div><div><label>Face H (mm)</label>${numIn(pre + '.h', G0.h, 'Face height (length)')}</div></div><div class="field two"><div><label>Neck W (mm)</label>${numIn(pre + '.neckW', G0.neckW, 'Neck width')}</div><div><label>Neck H (mm)</label>${numIn(pre + '.neckH', G0.neckH, 'Neck height')}</div></div>`}
    <div class="field two"><div><label>Free area (%)</label>${numIn(pre + '.fa', G0.fa, 'Free area as a percentage of the face (from the data sheet)', 1)}</div><div><label>or free area (m²)</label><input type="number" class="num" data-k="${pre}.faM2" value="${G0.faM2 > 0 ? num(G0.faM2, 4) : ''}" min="0" step="0.001" placeholder="from %" title="Free area from the data sheet; overrides the percentage"></div></div>
    <div class="field two"><div><label>Airflow (L/s)</label>${numIn(pre + '.q', G0.q, 'Design airflow', 5)}</div>${mount === 'ceiling' ? `<div><label>Plenum height (mm)</label>${numIn(pre + '.plenumH', G0.plenumH, 'Plenum box height, for the section view', 25)}</div>` : host === 'riser' || (!host && mount === 'riser') ? `<div><label>Height to underside (mm)</label>${numIn(pre + '.z', G0.z, 'From the floor to the bottom of the grille, for the riser section', 50)}</div>` : '<div></div>'}</div>
    ${G0.kind === 'linear' ? `<div class="field two"><div><label>Slots</label>${numIn(pre + '.slots', G0.slots || 2, 'Number of slots', 1)}</div><div><label>Slot width (mm)</label>${numIn(pre + '.slotW', G0.slotW || 25, 'Width of each slot', 5)}</div></div>` : ''}${flush ? '<p class="muted sm">Flush in the wall: on plan it shows as a strip of the wall with an arrow for the air.</p>' : ''}`;
}
function ductPropsHtml(doc, m) {
  const D = ductD(m); const a = ductAreas(doc, m); const fr = m.from && getMarkup(m.from, doc), to = m.to && getMarkup(m.to, doc); const gr = doc.markups.filter((x) => x.type === 'grille' && x.on === m.id).length; const secs = doc.markups.filter((x) => x.type === 'section' && x.of === m.id);
  const c = ductCalcFor(doc, m); const over = c.q > 0 && calcWarn(c).length;
  return `<div class="measure-readout${over ? ' over' : ''}"><div class="mr-val">${esc(ductSizeText(D))} ${esc(D.service || '')}</div><div class="mr-sub">${c.q > 0 ? `${Math.round(c.q)} L/s · ${num(c.v, 2)} m/s · ${num(c.pa, 2)} Pa/m · ` : ''}${num(a.L, 2)} m · ${ductBends(m)} bend${ductBends(m) === 1 ? '' : 's'}${fr || to ? ` · ${esc([fr ? sketchName(doc, fr) : '…', to ? sketchName(doc, to) : '…'].join(' → '))}` : ''}</div></div>
    <section class="psec"><div class="field"><label>Name</label><input type="text" data-k="text" value="${esc(m.text || '')}" maxlength="60" placeholder="e.g. M1 duct"></div></section>
    <section class="psec"><h3>Size and airflow</h3>${ductAirCard(doc, D, 'duct', 'duct', m)}</section>
    <section class="psec"><h3>Duct</h3>${ductFields(D, 'duct', true)}
    <div class="btn-row"><button type="button" class="btn sm" data-act="duct-grilles">${icon('grille')} Add grilles…</button><button type="button" class="btn sm" data-act="duct-section">${icon('section')} Section view</button></div>
    <div class="btn-row"><button type="button" class="btn sm" data-act="duct-route">Best route</button><button type="button" class="btn sm" data-act="duct-flip">Flip airflow</button></div></section>
    <section class="psec"><h3>Shown on the plan</h3><div class="chk-row"><label class="check"><input type="checkbox" data-k="style.showLabel"${m.style.showLabel !== false ? ' checked' : ''}> Size label</label><label class="check"><input type="checkbox" data-k="style.showQ"${m.style.showQ !== false ? ' checked' : ''}> Airflow, m/s and Pa/m</label><label class="check"><input type="checkbox" data-k="style.showFlow"${m.style.showFlow !== false ? ' checked' : ''}> Airflow arrows</label><label class="check"><input type="checkbox" data-k="style.showIns"${m.style.showIns !== false ? ' checked' : ''}> Insulation</label></div></section>
    <section class="psec"><h3>Quantities</h3><dl class="meta"><dt>Length</dt><dd>${num(a.L, 2)} m</dd><dt>Sheet metal</dt><dd>${num(a.metal, 2)} m²</dd>${D.ins > 0 ? `<dt>Insulation</dt><dd>${num(a.ins, 2)} m²</dd>` : ''}<dt>Grilles</dt><dd>${gr}</dd>${secs.length ? `<dt>Sections</dt><dd>${secs.map((x) => x.letter).join(', ')}</dd>` : ''}</dl></section>`;
}
function grillePropsHtml(doc, m) {
  const G0 = grilleD(m); const fa = grilleFA(G0); const v = grilleVel(G0); const h = m.on && getMarkup(m.on, doc); const d = h && h.type === 'duct' ? h : null; const r = h && h.type === 'sketch' ? h : null;
  const onTxt = d ? ` · on ${esc(d.text || ductLabel(d))}` : r ? ` · in the ${['+X', '+Y', '−X', '−Y'][m.face & 3]} wall of ${esc(sketchName(doc, r) || 'the riser')}` : '';
  return `<section class="psec"><h3>Grille</h3><div class="measure-readout"><div class="mr-val">${esc(m.tag || '')} ${esc(grilleFaceText(G0))}</div><div class="mr-sub">Free area ${num(fa, 3)} m²${v ? ` · ${num(v, 2)} m/s face velocity` : ''}${onTxt}</div></div>
    <div class="field"><label>Tag</label><input type="text" data-k="tag" value="${esc(m.tag || '')}" maxlength="20"></div>
    ${grilleFields(G0, 'gr', r ? 'riser' : d ? 'duct' : 'free')}
    ${h ? '' : field('Rotation (°)', `<input type="number" class="num" data-k="rot" value="${num(m.rot || 0, 1)}" step="15">`)}
    ${d && G0.mount === 'side' ? '<div class="btn-row"><button type="button" class="btn sm" data-act="grille-side">Other side of the duct</button></div>' : ''}
    ${r && r.link ? '<div class="btn-row"><button type="button" class="btn sm" data-act="grille-floors">Put it on every floor</button></div>' : ''}
    <div class="chk-row"><label class="check"><input type="checkbox" data-k="style.showTag"${m.style.showTag !== false ? ' checked' : ''}> Tag</label><label class="check"><input type="checkbox" data-k="style.showSize"${m.style.showSize !== false ? ' checked' : ''}> Size</label><label class="check"><input type="checkbox" data-k="style.showFa"${m.style.showFa !== false ? ' checked' : ''}> Free area</label><label class="check"><input type="checkbox" data-k="style.showQ"${m.style.showQ !== false ? ' checked' : ''}> Airflow</label></div>
    <div class="btn-row"><button type="button" class="btn sm" data-act="duct-section">${r ? 'Riser section' : 'Section view'}</button>${h ? `<button type="button" class="btn sm" data-act="grille-detach">Detach from ${r ? 'riser' : 'duct'}</button>` : ''}</div></section>`;
}
function sectionPropsHtml(doc, m) {
  const src = getMarkup(m.of, doc);
  if (src && src.type === 'sketch') {
    const inst = riserInstances(doc, src); const floors = m.order === 'down' ? inst.slice().reverse() : inst; const F = riserFaces(doc, src); const fv = riserViewFace(doc, m); const lv = m.levels || {};
    return `<section class="psec"><h3>Riser section</h3><p class="muted sm">${esc(sketchName(doc, src) || 'The riser')} through ${floors.length} floor${floors.length === 1 ? '' : 's'} (its linked pages), with the grilles in its walls. It redraws when the riser or a grille changes.</p>
      <div class="field two"><div><label>Letter</label><input type="text" data-k="letter" value="${esc(m.letter || 'A')}" maxlength="3"></div><div><label>Scale</label><select data-k="sec.scale">${RISER_SCALES.map((v) => `<option value="${v}"${(m.scale || 100) === v ? ' selected' : ''}>1:${v}</option>`).join('')}</select></div></div>
      <div class="field two"><div><label>Looking at</label><select data-k="sec.face">${F.map((f) => `<option value="${f.i}"${fv === f.i ? ' selected' : ''}>${['+X', '+Y', '−X', '−Y'][f.i]} wall (${Math.round(f.wmm)} wide)</option>`).join('')}</select></div><div><label>Airflow in the riser</label><select data-k="sec.flow">${[['', 'Not shown'], ['up', 'Up'], ['down', 'Down']].map(([v, l]) => `<option value="${v}"${(m.flow || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field two"><div><label>Floor to floor (mm)</label>${numIn('sec.ftf', m.ftf || 3300, 'Typical floor to floor height', 50)}</div><div><label>Slab (mm)</label>${numIn('sec.slab', m.slab == null ? 200 : m.slab, 'Slab thickness', 10)}</div></div>
      <div class="field two"><div><label>Lowest floor RL (mm)</label><input type="number" class="num" data-k="sec.rl0" value="${num(+m.rl0 || 0, 0)}" step="50"></div><div><label>Floor order</label><select data-k="sec.order"><option value="up"${m.order !== 'down' ? ' selected' : ''}>First page lowest</option><option value="down"${m.order === 'down' ? ' selected' : ''}>First page highest</option></select></div></div>
      <h4 class="eq-h">Floors</h4><div class="lv-rows">${floors.map((x, i) => `<div class="field two lv-row"><div><label>Page ${x.page + 1}</label><input type="text" data-k="sec.lvname.${x.page}" value="${esc((lv[x.page] || {}).name || levelName(doc, x.page, i))}" maxlength="30"></div><div><label>Height (mm)</label><input type="number" class="num" data-k="sec.lvh.${x.page}" value="${(lv[x.page] || {}).h || ''}" placeholder="${m.ftf || 3300}" step="50"></div></div>`).reverse().join('')}</div></section>`;
  }
  return `<section class="psec"><h3>Section view</h3><p class="muted sm">${src ? `Cuts ${esc(src.type === 'duct' ? src.text || ductLabel(src) : (src.tag || 'grille'))}. It redraws when that changes.` : 'What it cut has been deleted.'}</p>
    <div class="field two"><div><label>Letter</label><input type="text" data-k="letter" value="${esc(m.letter || 'A')}" maxlength="3"></div><div><label>Detail scale</label><select data-k="sec.scale">${SECTION_SCALES.map((v) => `<option value="${v}"${(m.scale || 10) === v ? ' selected' : ''}>1:${v}</option>`).join('')}</select></div></div>
    ${src && src.type === 'duct' ? field('Cut position along the duct', `<div class="range"><input type="range" min="0.02" max="0.98" step="0.01" data-k="sec.t" value="${m.t == null ? 0.5 : m.t}"><output>${Math.round((m.t == null ? 0.5 : m.t) * 100)}%</output></div>`) : ''}</section>`;
}
// property keys: duct.<f>, gr.<f>, sec.<f>; dd.* / gd.* change the defaults for new ones
function setDuctField(m, k, v) {
  const [g, f] = k.split('.'); const numish = !['shape', 'service', 'insKind', 'kind', 'end0', 'end1', 'mount', 'mat'].includes(f); const val = numish ? (v === '' || v == null ? null : +v) : v;
  if (g === 'duct') { const D = ductD(m); if (f === 'end0' || f === 'end1') { D.ends = D.ends.slice(); D.ends[f === 'end0' ? 0 : 1] = val; } else D[f] = val; m.duct = D; return true; }
  if (g === 'gr') { const G0 = grilleD(m); G0[f] = f === 'faM2' && !(val > 0) ? null : val; if (f === 'kind' && m.tag && /^[A-Z]{2}-\d+$/.test(m.tag)) m.tag = nextGrilleTag(activeDoc(), val); m.gr = G0; return true; }
  if (g === 'sec') {
    const parts = k.split('.'); if (f === 'scale') m.scale = +v || 10; else if (f === 't') m.t = clamp(+v, 0, 1); else if (f === 'face') m.face = +v & 3; else if (f === 'flow') m.flow = v || ''; else if (f === 'order') m.order = v === 'down' ? 'down' : 'up';
    else if (f === 'ftf') m.ftf = +v > 0 ? +v : 3300; else if (f === 'slab') m.slab = +v >= 0 ? +v : 200; else if (f === 'rl0') m.rl0 = +v || 0;
    else if (f === 'lvname' || f === 'lvh') { const pg = parts[2]; m.levels = { ...(m.levels || {}) }; const L0 = { ...(m.levels[pg] || {}) }; if (f === 'lvname') L0.name = String(v || '').trim(); else L0.h = +v > 0 ? +v : null; m.levels[pg] = L0; }
    return true;
  }
  return false;
}
function applyDuctDefault(k, v) { const [g, f] = k.split('.'); const numish = !['shape', 'service', 'insKind', 'kind', 'end0', 'end1', 'mount', 'mat'].includes(f); const val = numish ? (v === '' ? null : +v) : v; if (g === 'dd') { const D = ductDefaults(); if (f === 'end0' || f === 'end1') { D.ends = (D.ends || ['open', 'open']).slice(); D.ends[f === 'end0' ? 0 : 1] = val; } else D[f] = val; } else { const G0 = grilleDefaults(); G0[f] = f === 'faM2' && !(val > 0) ? null : val; } saveDuctDefaults(); }

async function addGrillesDialog(d) {
  const doc = activeDoc(); if (!d || d.type !== 'duct') return; const G0 = grilleDefaults(); const L = ductLengthMm(doc, d) / 1000;
  const r = await openDialog({ title: 'Add grilles along the duct', body: `<p>${esc(d.text || ductLabel(d))}, ${num(L, 2)} m long. Grilles are spaced evenly and use the settings for new grilles (Ductwork panel).</p><div class="field two"><div><label>How many</label><input type="number" name="n" value="${Math.max(1, Math.round(L / 3))}" min="1" max="60"></div><div><label>Type</label><select name="kind">${GRILLE_KINDS.map(([k, l]) => `<option value="${k}"${G0.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div><div class="field two"><div><label>Airflow each (L/s)</label><input type="number" name="q" value="${G0.q || ''}" min="0" step="5"></div><div></div></div>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Add grilles', value: true, primary: true }] });
  if (!r || !r.value) return; const n = clamp(Math.round(+r.form.n || 1), 1, 60); pushUndo(doc); const pts = dedupePts(d.pts); const len = G.len(pts); const made = [];
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; const a = alongPts(pts, t * len); const gg = { ...deep(G0), kind: r.form.kind || G0.kind, q: +r.form.q > 0 ? +r.form.q : null }; const m = newMarkup('grille', d.page, [a.p], { gr: gg, tag: nextGrilleTag(doc, gg.kind), on: d.id, t }); m.style = toolStyle('grille'); m.subject = grilleKind(gg.kind)[1]; doc.markups.push(m); made.push(m); }
  renderMarks(doc, d.page); refreshPanels(); state.sel = new Set(made.map((m) => m.id)); refreshSelection(); toast(`${n} grille${n === 1 ? '' : 's'} added along ${d.text || 'the duct'}`);
}

// ----- the Ductwork panel ------------------------------------------------------------------------------------------
const renderDuctPanelSoon = debounce(() => { const f = document.activeElement; if (panelShown('ductwork') && !(f && f.closest && f.closest('#ductwork') && /INPUT|SELECT/.test(f.tagName))) renderDuctPanel(); }, 150);
// The Mechanical panel has three views: Draw (the steps in the order you work), Ductulator, and Schedule
// (every riser, duct and grille with its airflow, flagged when over the limits). Settings for new ducts and
// grilles live in Properties while the tool is picked, like every other tool.
function renderDuctPanel() {
  const el = $('#ductwork'); if (!el) return; const doc = activeDoc(); const page = doc ? currentPage() : 0; const tab = state.mechTab || 'draw';
  const tabs = `<div class="seg-tabs" role="tablist" aria-label="Mechanical">${[['draw', 'Draw'], ['calc', 'Ductulator'], ['list', 'Schedule']].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" class="seg-tab${tab === k ? ' on' : ''}" data-mt="${k}">${l}</button>`).join('')}</div>`;
  if (!doc) { el.innerHTML = tabs + '<p class="muted pad">Open a PDF to start.</p>'; return; }
  let body = '';
  if (tab === 'calc') body = ductCalcHtml();
  else if (tab === 'list') {
    const seen = new Set(); const risers = doc.markups.filter((m) => { if (m.type !== 'sketch') return false; const k = m.link || m.id; if (seen.has(k)) return false; seen.add(k); return true; });
    const ducts = doc.markups.filter((m) => m.type === 'duct'); const grs = doc.markups.filter((m) => m.type === 'grille');
    const row = (m, main, sub, c) => { const w = c && c.q > 0 ? calcWarn(c) : []; return `<button class="mech-row${w.length ? ' over' : ''}" data-dm="${esc(m.id)}"${w.length ? ` title="${esc(w.join('; '))}"` : ''}><span class="mr-main">${main}</span><span class="mr-air">${c && c.q > 0 ? `${Math.round(c.q)} L/s · ${num(c.v, 1)} m/s · <b>${num(c.pa, 2)} Pa/m</b>${w.length ? ' ' + icon('warn') : ''}` : '<span class="muted">no airflow</span>'}</span><span class="mr-sub muted">${sub}</span></button>`; };
    const nOver = [...risers.map((m) => riserCalcFor(doc, m)), ...ducts.map((m) => ductCalcFor(doc, m))].filter((c) => c.q > 0 && calcWarn(c).length).length;
    body = `${nOver ? `<div class="mech-note over">${icon('warn')} ${nOver} over the limits (${num(fricLimit(), 2)} Pa/m${velLimit() ? `, ${num(velLimit(), 1)} m/s` : ''})</div>` : risers.length + ducts.length ? `<div class="mech-note">${icon('check')} Everything with an airflow is within ${num(fricLimit(), 2)} Pa/m${velLimit() ? ` and ${num(velLimit(), 1)} m/s` : ''}</div>` : ''}
      <h4 class="eq-h">Risers (${risers.length})</h4><div class="eq-placed">${risers.length ? risers.slice(0, 300).map((m) => { const n = m.link ? doc.markups.filter((x) => x.link === m.link).length : 1; return row(m, `<b>${esc(sketchName(doc, m) || 'Riser')}</b> ${esc(sizeLabel(doc, m))}`, n > 1 ? `${n} pages` : `p${m.page + 1}`, riserCalcFor(doc, m)); }).join('') : '<p class="muted sm">None yet. Draw one with Riser on the Draw tab.</p>'}</div>
      <h4 class="eq-h">Ducts (${ducts.length})</h4><div class="eq-placed">${ducts.length ? ducts.slice(0, 300).map((m) => { const d = ductD(m); return row(m, `<b>${esc(m.text || 'Duct')}</b> ${esc(ductSizeText(d))} ${esc(d.service || '')}`, `${num(ductLengthMm(doc, m) / 1000, 1)} m · p${m.page + 1}${d.ins > 0 ? ' · ' + esc(ductInsText(d)) : ''}`, ductCalcFor(doc, m)); }).join('') : '<p class="muted sm">None yet.</p>'}</div>
      <h4 class="eq-h">Grilles (${grs.length})</h4><div class="eq-placed">${grs.length ? grs.slice(0, 400).map((m) => { const g = grilleD(m); const v = grilleVel(g); return `<button class="mech-row" data-dm="${esc(m.id)}"><span class="mr-main"><b>${esc(m.tag || '')}</b> ${esc(grilleFaceText(g))}</span><span class="mr-air">${g.q ? `${Math.round(g.q)} L/s${v ? ` · ${num(v, 2)} m/s` : ''}` : '<span class="muted">no airflow</span>'}</span><span class="mr-sub muted">FA ${num(grilleFA(g), 3)} m² · p${m.page + 1}</span></button>`; }).join('') : '<p class="muted sm">None yet.</p>'}</div>
      <div class="btn-row pad"><button class="btn sm" data-dw="csv">${icon('csv')} Export schedule (CSV)</button></div>`;
  } else {
    const same = (() => { const c = new Map(); doc.markups.forEach((m) => { if (m.type === 'sketch' && m.page === page) { const n = String(sketchName(doc, m) || '').trim().toUpperCase(); if (n) c.set(n, (c.get(n) || 0) + 1); } }); return [...c].filter(([, n]) => n > 1).map(([n]) => n); })();
    const sel = selected(doc); const two = sel.length === 2 && sel.every((m) => m.type === 'sketch'); const one = sel.length === 1 ? sel[0] : null; const canSec = one && ['duct', 'grille', 'sketch'].includes(one.type);
    const step = (n, title, text, btns) => `<section class="mech-step"><div class="ms-n" aria-hidden="true">${n}</div><div class="ms-b"><h4>${title}</h4><p class="muted sm">${text}</p><div class="btn-row">${btns}</div></div></section>`;
    const tb = (k, ic, label, on, dis, tip) => `<button class="btn sm${on ? ' on' : ''}" data-dw="${k}"${dis ? ' disabled' : ''}${tip ? ` title="${esc(tip)}"` : ''}>${icon(ic)} ${label}</button>`;
    body = step(1, 'Risers', 'To scale, with an airflow. Place on every floor.', tb('riser', 'sketchrect', 'Riser', state.tool === 'sketchrect') + tb('riserc', 'sketchcircle', 'Round', state.tool === 'sketchcircle') + tb('place', 'pages2', 'Place on pages', false, !(one && one.type === 'sketch'), 'Select a riser first'))
      + step(2, 'Ducts', 'Draw corner by corner, or route between risers.', tb('draw', 'duct', 'Draw duct', state.tool === 'duct') + tb('same', 'connect', `Connect ${same.length ? esc(same.slice(0, 3).join(', ')) : 'same names'}`, false, !same.length, same.length ? 'Risers sharing a name on this page' : 'No two risers on this page share a name') + tb('sel', 'connect', 'Connect selected', false, !two, 'Select two risers first'))
      + step(3, 'Grilles', 'Click a duct or the wall of a riser.', tb('grille', 'grille', 'Grille', state.tool === 'grille') + tb('along', 'grille', 'Along a duct…', false, !(one && one.type === 'duct'), 'Select a duct first'))
      + step(4, 'Sections', 'Of the selected duct, grille or riser (through all floors).', tb('section', 'section', 'Section view', false, !canSec, 'Select a duct, grille or riser first'))
      + `<p class="muted sm pad">Sizes and airflow are in Properties when a riser or duct is selected. Check a size on the Ductulator tab.</p>`;
  }
  el.innerHTML = tabs + `<div class="mech-body" role="tabpanel">${body}</div>`;
}
function bindDuctPanel() {
  const el = $('#ductwork'); if (!el) return;
  el.addEventListener('click', (e) => { const t = e.target.closest('[data-mt]'); if (t) { state.mechTab = t.dataset.mt; store.set('mechTab', state.mechTab); renderDuctPanel(); } });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dw]'); const doc = activeDoc();
    if (b) { const k = b.dataset.dw;
      const one = doc ? selected(doc)[0] : null;
      if (k === 'draw') setTool('duct'); else if (k === 'grille') setTool('grille'); else if (k === 'same') connectSameNameRisers(); else if (k === 'sel') connectSelectedRisers(); else if (k === 'calc-apply') ductCalcApply(); else if (k === 'calc-from') ductCalcFrom();
      else if (k === 'riser') setTool('sketchrect'); else if (k === 'riserc') setTool('sketchcircle'); else if (k === 'place' && one) placeOnPagesDialog(one); else if (k === 'along' && one) addGrillesDialog(one); else if (k === 'section' && one) startSectionPlace(one); else if (k === 'csv') ductSchedule();
      if (['draw', 'grille', 'riser', 'riserc'].includes(k)) renderDuctPanel();
      else if (k === 'more') { const r = b.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, [['Duct and grille schedule (CSV)…', () => ductSchedule()]]); }
      return; }
    const p = e.target.closest('[data-dm]'); if (p && doc) { const m = getMarkup(p.dataset.dm); if (m) { setTool('select'); state.sel.clear(); state.sel.add(m.id); goToPage(m.page, m.pts[0]); refreshSelection(); } }
  });
  el.addEventListener('change', (e) => { const t = e.target; const k = t.dataset.k; if (!k || !/^(dd|gd)\./.test(k)) return; applyDuctDefault(k, t.value); renderDuctPanel(); });
  bindDuctCalc(el);
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
