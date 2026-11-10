// ===== Sketch to scale & linked sets (risers) ================================
// A sketch is a rectangle or circle defined by its REAL size (inches), drawn at
// whatever scale applies where it sits. Sketches can be linked across pages: the
// set shares sizes, rotation and (optionally) position, so editing one edits all.
// A size change between levels is a "transition": the instance on that page
// shows both sizes, and instances on later pages use the new size.
//   size  = { shape: 'rect', w, h } | { shape: 'circle', d }   (inches)
//   link  = { id, name, sizes: { a: size, b: size, ... }, rot, sync }
//   markup (type 'sketch'): pts [center], link?, sizeKey?, transKey?, sz?, tsz?, rot?
const SKETCH_DEFAULTS_IMP = { rect: { shape: 'rect', w: 24, h: 12 }, circle: { shape: 'circle', d: 12 } };
const SKETCH_DEFAULTS_SI = { rect: { shape: 'rect', w: 600 / 25.4, h: 300 / 25.4 }, circle: { shape: 'circle', d: 300 / 25.4 } };
const SKETCH_DEFAULTS = SKETCH_DEFAULTS_SI;
function sketchDefaultsFor(metric) { return deep(metric ? SKETCH_DEFAULTS_SI : SKETCH_DEFAULTS_IMP); }

function isMetric(sc) { return ['m', 'cm', 'mm'].includes(sc.unit) || (!!sc.unset && typeof state !== 'undefined' && metricPref()); }
function linkOf(doc, m) { return m.link && doc.links ? doc.links[m.link] || null : null; }
function sketchSize(doc, m) { const L = linkOf(doc, m); if (L) return L.sizes[m.sizeKey] || Object.values(L.sizes)[0] || m.sz || SKETCH_DEFAULTS.rect; return m.sz || SKETCH_DEFAULTS.rect; }
function sketchTrans(doc, m) { const L = linkOf(doc, m); if (L) return m.transKey ? L.sizes[m.transKey] || null : null; return m.tsz || null; }
// linked sets keep rotation in model (grid) orientation; unlinked sketches in page orientation
function sketchRot(doc, m) { const L = linkOf(doc, m); return L ? ((L.rot || 0) * Math.PI) / 180 - alignAngle(doc, m.page) : ((m.rot || 0) * Math.PI) / 180; }
function sketchRotDeg(doc, m) { return ((((sketchRot(doc, m) * 180) / Math.PI) % 360) + 360) % 360; }
function sketchName(doc, m) { const L = linkOf(doc, m); return L ? L.name : m.name || m.text || ''; }
// riser names count up: M1 -> M2, SA-09 -> SA-10, E1a stays E1a
function nextName(name, used) {
  if (!name) return ''; let n = name; const bump = (s) => { const mm = s.match(/^(.*?)(\d+)$/); if (!mm) return null; const d = String(+mm[2] + 1); return mm[1] + (mm[2].length > d.length ? d.padStart(mm[2].length, '0') : d); };
  let next = bump(n); if (next == null) return name; let guard = 0; while (used && used.has(next) && guard++ < 999) next = bump(next); return next;
}
function sketchNamesUsed(doc) { const u = new Set(); Object.values(doc.links || {}).forEach((L) => u.add(L.name)); doc.markups.forEach((m) => { if (m.type === 'sketch' && !m.link && (m.name || m.text)) u.add(m.name || m.text); }); return u; }
function areaLabel(doc, m) {
  const sc = scaleForMarkup(doc, m); const A = sketchSize(doc, m), B = sketchTrans(doc, m); if (!A) return ''; const a = fmtRealArea(sizeAreaIn2(A), sc);
  if (!B) return a; const b = fmtRealArea(sizeAreaIn2(B), sc); return `${a.replace(/ (m²|sf)$/, '')} → ${b}`;
}
function fmtInch(v, sc) {
  if (isMetric(sc)) return `${Math.round(v * 25.4)}`;
  const whole = Math.floor(v + 1e-9), frac = v - whole; const q = Math.round(frac * 8); const w = q === 8 ? whole + 1 : whole;
  const fr = q === 0 || q === 8 ? '' : q === 2 ? '\u00bc' : q === 4 ? '\u00bd' : q === 6 ? '\u00be' : ` ${q}/8`; // keep to characters the PDF font can print
  return `${w}${fr}"`;
}
function sizeText(size, sc) {
  if (!size) return '';
  if (size.shape === 'circle') return isMetric(sc) ? `Ø${fmtInch(size.d, sc)}` : `${fmtInch(size.d, sc)}Ø`;
  return `${fmtInch(size.w, sc)}×${fmtInch(size.h, sc)}`;
}
function sizeLabel(doc, m) { const sc = scaleForMarkup(doc, m); const A = sketchSize(doc, m), B = sketchTrans(doc, m); if (!A) return ''; return B ? `${sizeText(A, sc)} → ${sizeText(B, sc)}` : sizeText(A, sc); }

// geometry of one size at centre c, rotation rot (radians)
function sizeGeom(size, sc, c, rot) {
  const k = 1 / sc.inPerPt; const cos = Math.cos(rot), sin = Math.sin(rot);
  const tr = (x, y) => [c[0] + x * cos - y * sin, c[1] + x * sin + y * cos];
  if (size.shape === 'circle') {
    const r = (size.d * k) / 2; const at = (a) => tr(Math.cos(a) * r, Math.sin(a) * r);
    return { d: P.ellipse(c[0], c[1], r, r), r, corners: [at(-3 * Math.PI / 4), at(-Math.PI / 4), at(Math.PI / 4), at(3 * Math.PI / 4)], quad: [at(-Math.PI / 2), at(0), at(Math.PI / 2), at(Math.PI)], ext: [r, r], tr };
  }
  const hw = (size.w * k) / 2, hh = (size.h * k) / 2; const corners = [tr(-hw, -hh), tr(hw, -hh), tr(hw, hh), tr(-hw, hh)];
  const ex = Math.abs(hw * cos) + Math.abs(hh * sin), ey = Math.abs(hw * sin) + Math.abs(hh * cos);
  return { d: P.poly(corners, true), corners, quad: [tr(0, -hh), tr(hw, 0), tr(0, hh), tr(-hw, 0)], ext: [ex, ey], hw, hh, tr };
}
function sketchPrims(m, doc, opts = {}) {
  const s = m.style; const sc = scaleForMarkup(doc, m); const c = m.pts[0]; const rot = sketchRot(doc, m);
  const A = sketchSize(doc, m), B = sketchTrans(doc, m); const out = [];
  const ga = sizeGeom(A, sc, c, rot); const gb = B ? sizeGeom(B, sc, c, rot) : null;
  // role: what each piece is when the sketch goes out to other apps as separate markups (sketchParts)
  const line = (pts, extra = {}) => ({ k: 'path', d: P.poly(pts), stroke: s.stroke, width: Math.max(0.35, s.width * 0.6), opacity: s.opacity, fill: 'none', role: 'line', ...extra });
  out.push({ k: 'path', d: ga.d, stroke: s.stroke, width: s.width, dash: s.dash, opacity: s.opacity, fill: s.fill, fillOpacity: s.fillOpacity, hit: 'box', role: 'shape' });
  // symbol on the continuing shape (the new size when transitioning)
  const sym = (g) => {
    if (s.symbol === 'x') out.push(line([g.corners[0], g.corners[2]]), line([g.corners[1], g.corners[3]]));
    else if (s.symbol === 'diag') out.push(line([g.corners[0], g.corners[2]]));
  };
  if (gb) {
    out.push({ k: 'path', d: gb.d, stroke: s.stroke, width: s.width, dash: 'solid', opacity: s.opacity, fill: 'none', role: 'trans' });
    const pa = A.shape === 'circle' && B.shape === 'circle' ? ga.quad : ga.corners, pb = A.shape === 'circle' && B.shape === 'circle' ? gb.quad : gb.corners;
    for (let i = 0; i < 4; i++) out.push(line([pa[i], pb[i]], { dash: 'dashed', width: Math.max(0.35, s.width * 0.5) }));
    sym(gb);
  } else sym(ga);
  // dimensions
  if (s.showDims && A.shape === 'rect') {
    const off = 5 + (s.fontSize || 9) * 0.2; const tk = 2.5; const fs = Math.max(5, (s.fontSize || 9) * 0.85); const col = s.fontColor || s.stroke;
    const dimLine = (p0, p1, nx, ny, txt) => {
      const a = [p0[0] + nx * off, p0[1] + ny * off], b = [p1[0] + nx * off, p1[1] + ny * off];
      out.push(line([a, b], { width: 0.5 }), line([[a[0] - nx * tk, a[1] - ny * tk], [a[0] + nx * tk, a[1] + ny * tk]], { width: 0.5 }), line([[b[0] - nx * tk, b[1] - ny * tk], [b[0] + nx * tk, b[1] + ny * tk]], { width: 0.5 }));
      const ang = uprightAngle(Math.atan2(b[1] - a[1], b[0] - a[0])); out.push(...labelPrims([txt], (a[0] + b[0]) / 2 + nx * fs * 1.15, (a[1] + b[1]) / 2 + ny * fs * 1.15, ang, { ...s, fontSize: fs, fontColor: col }, { noBg: true }).map((p) => ({ ...p, role: 'dimtext' })));
    };
    const ux = Math.cos(rot), uy = Math.sin(rot);
    dimLine(ga.corners[3], ga.corners[2], -uy, ux, fmtInch(A.w, sc)); // width along the bottom edge
    dimLine(ga.corners[1], ga.corners[2], ux, uy, fmtInch(A.h, sc)); // height along the right edge
  }
  // label: name, size and area, as chosen; dragged labels get a leader arrow back to the riser
  const L = sketchLabelBox(m, doc, { ga, gb, sc, c, rot });
  if (L) {
    if (L.leader) {
      const lw = Math.max(0.4, (s.width || 1) * 0.55); const tip = L.leader.tip, from = L.leader.from;
      const ah = arrowHead(tip, from, 'arrow', { ...s, width: lw }); out.push({ k: 'path', d: P.poly([from, ah.cut]), stroke: s.fontColor || s.stroke, width: lw, opacity: s.opacity, fill: 'none', role: 'leader' }, ...ah.prims.map((p) => ({ ...p, fill: s.fontColor || s.stroke, role: 'leader' })));
    }
    out.push(...labelPrims(L.lines, L.x, L.y, 0, s).map((p) => ({ ...p, part: 'label', role: 'label' })));
  }
  // riser sections cut through this riser (on any of its floors): the cut marker
  if (doc && doc.markups && !opts.noCuts) doc.markups.forEach((x) => { if (x.type !== 'section') return; const of = x.of === m.id ? m : null; const sib = !of && m.link ? doc.markups.find((y) => y.id === x.of && y.link === m.link) : null; if (of || sib) out.push(...sectionCut(doc, m, x).map((p) => ({ ...p, role: 'cut' }))); });
  return out;
}
// How a sketch goes into the PDF for other apps (Revu): the shape as a plain Square, Circle or Polygon
// at exactly its size, the label as its own text box, line work as ink and the label's leader as an
// arrow, all in one group so they move together. Revu redraws a markup from its dictionary when it is
// edited there, so a single annotation holding the label as well came back the wrong size.
function sketchParts(m, doc) {
  const s = m.style; const sc = scaleForMarkup(doc, m); const c = m.pts[0]; const rot = sketchRot(doc, m);
  const A = sketchSize(doc, m), B = sketchTrans(doc, m); const ga = sizeGeom(A, sc, c, rot), gb = B ? sizeGeom(B, sc, c, rot) : null;
  const name = sketchName(doc, m); const gid = m.group || 'SK-' + m.id; const prims = sketchPrims(m, doc);
  const base = { page: m.page, layer: m.layer, author: m.author, created: m.created, modified: m.modified, status: m.status, group: gid, subject: m.subject };
  const deg = ((((rot * 180) / Math.PI) % 90) + 90) % 90; const square = Math.min(deg, 90 - deg) < 0.01;
  const shapeOf = (size, g) => size.shape === 'circle' ? { type: 'ellipse', pts: [[c[0] - g.r, c[1] - g.r], [c[0] + g.r, c[1] + g.r]] } : square ? (() => { const b = G.bbox(g.corners); return { type: 'rect', pts: [[b.x, b.y], [b.x2, b.y2]] }; })() : { type: 'polygon', pts: g.corners.map((p) => p.slice()) };
  const out = [{ ...base, ...shapeOf(A, ga), id: m.id, style: { ...s, cloud: false }, comment: m.comment, _contents: [name, sizeLabel(doc, m), m.comment].filter(Boolean).join('\n'), ext: { ...(m.ext || {}), groupPrimary: m.group ? undefined : true, groupName: m.group ? undefined : name || 'Sketch' } }];
  if (gb) out.push({ ...base, ...shapeOf(B, gb), id: m.id + '#t', style: { ...s, fill: 'none', dash: 'solid', cloud: false }, ext: {} });
  // line work (symbol, transition connectors, dimension lines): one ink markup per line weight and style
  const inks = new Map(); prims.filter((p) => p.role === 'line').forEach((p) => { const key = `${p.width}|${p.dash || 'solid'}`; if (!inks.has(key)) inks.set(key, []); inks.get(key).push({ pts: p.d.filter((q) => q[0] === 'M' || q[0] === 'L').map((q) => [q[1], q[2]]), p }); });
  [...inks.values()].forEach((L, k) => { const p0 = L[0].p; out.push({ ...base, id: `${m.id}#k${k}`, type: 'pen', pts: L[0].pts, style: { stroke: p0.stroke, width: p0.width, dash: p0.dash || 'solid', opacity: s.opacity }, ext: { extraInk: L.slice(1).map((x) => x.pts) }, _prims: L.map((x) => x.p) }); });
  // dimension figures: small text boxes, drawn as they are on screen
  prims.filter((p) => p.role === 'dimtext').forEach((p, k) => { const w = textWidth(p.str, p.size, p.bold, p.font, p.italic); const a = p.rot || 0; const cos = Math.cos(a), sin = Math.sin(a); const cx = p.x - sin * p.size * -0.3, cy = p.y + cos * p.size * -0.3;
    const b = G.bbox([[-w / 2 - 1, -p.size * 0.62], [w / 2 + 1, -p.size * 0.62], [w / 2 + 1, p.size * 0.62], [-w / 2 - 1, p.size * 0.62]].map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]));
    out.push({ ...base, id: `${m.id}#d${k}`, type: 'text', pts: [[b.x, b.y], [b.x2, b.y2]], text: p.str, fixedH: true, style: { font: p.font, fontSize: p.size, bold: p.bold, italic: p.italic, fontColor: p.color, stroke: 'none', width: 0, fill: 'none', align: 'center', valign: 'middle', pad: 0.5, lineH: 1.18, opacity: s.opacity }, ext: {}, _prims: [p] }); });
  const L = sketchLabelBox(m, doc);
  if (L && L.leader) { const lw = Math.max(0.4, (s.width || 1) * 0.55); out.push({ ...base, id: m.id + '#a', type: 'arrow', pts: [L.leader.from, L.leader.tip], style: { stroke: s.fontColor || s.stroke, width: lw, opacity: s.opacity, arrowStart: 'none', arrowEnd: 'arrow' }, ext: {} }); }
  if (L) { const fs = s.fontSize || 9; const b = L.box;
    out.push({ ...base, id: m.id + '#l', type: 'text', pts: [[b.x - 1, b.y], [b.x + b.w + 1, b.y + b.h]], text: L.lines.join('\n'), fixedH: true, style: { font: s.font, fontSize: fs, bold: s.bold, italic: s.italic, fontColor: s.fontColor || s.stroke, stroke: 'none', width: 0, fill: s.labelBg === false ? 'none' : '#ffffff', fillOpacity: 0.86, align: 'center', valign: 'middle', pad: s.pad != null ? +s.pad : fs * 0.15, lineH: s.lineH || 1.18, letterSp: s.letterSp || 0, opacity: s.opacity }, ext: {} }); }
  return out;
}
// where the label goes: preset position, the centre, or wherever it was dragged (m.labelOff)
function sketchLabelBox(m, doc, g) {
  const s = m.style; const lines = [];
  if (s.showLabel !== false) { if (s.showName !== false) { const nm = sketchName(doc, m); if (nm) lines.push(nm); } if (s.showSize !== false) lines.push(sizeLabel(doc, m)); if (s.showArea) lines.push(areaLabel(doc, m)); if (s.showAir !== false) { const c = riserCalcFor(doc, m); if (c.q > 0 && c.A > 0) lines.push(`${Math.round(c.q)} L/s · ${num(c.v, 1)} m/s · ${num(c.pa, 2)} Pa/m${calcWarn(c).length ? ' !' : ''}`); } }
  if (!lines.length) return null;
  if (!g) { const sc = scaleForMarkup(doc, m); const c = m.pts[0]; const rot = sketchRot(doc, m); const A = sketchSize(doc, m), B = sketchTrans(doc, m); g = { ga: sizeGeom(A, sc, c, rot), gb: B ? sizeGeom(B, sc, c, rot) : null, sc, c, rot }; }
  const { ga, gb, c } = g; const ex = gb ? Math.max(ga.ext[0], gb.ext[0]) : ga.ext[0], ey = gb ? Math.max(ga.ext[1], gb.ext[1]) : ga.ext[1]; const fs = s.fontSize || 9;
  const M = labelMetrics(lines, s); const lw = M.w; const lh = M.h; const half = lh / 2; const dimPad = s.showDims ? fs * 2.2 : 0;
  let at;
  if (m.labelOff) at = [c[0] + m.labelOff[0], c[1] + m.labelOff[1]];
  else at = { above: [c[0], c[1] - ey - fs * 0.5 - half], below: [c[0], c[1] + ey + fs * 0.5 + half + dimPad], right: [c[0] + ex + fs * 0.6 + lw / 2 + dimPad, c[1]], left: [c[0] - ex - fs * 0.6 - lw / 2, c[1]], center: [c[0], c[1]] }[s.labelPos || 'above'];
  const box = { x: at[0] - lw / 2 - M.padX, y: at[1] - half - M.padY, w: lw + 2 * M.padX, h: lh + 2 * M.padY };
  let leader = null;
  if (m.labelOff && s.labelArrow !== false) {
    // aim at the nearest point of the outer outline; none when the label sits inside the shape, on it or next to it
    const outer = gb && (gb.ext[0] * gb.ext[1] > ga.ext[0] * ga.ext[1]) ? gb : ga; const tip = nearestOnOutline(outer, at);
    const from = rayBoxExit(at, tip, box); const inside = insideOutline(outer, at);
    if (!inside && from && G.dist(from, tip) > fs * 0.9 && !(tip[0] >= box.x && tip[0] <= box.x + box.w && tip[1] >= box.y && tip[1] <= box.y + box.h)) leader = { from, tip };
  }
  return { lines, x: at[0], y: at[1], box, leader };
}
function insideOutline(g, p) { if (g.r != null && g.hw == null) { const c = [(g.quad[0][0] + g.quad[2][0]) / 2, (g.quad[0][1] + g.quad[2][1]) / 2]; return G.dist(c, p) < g.r; } return G.pointInPoly(p, g.corners); }
function nearestOnOutline(g, p) {
  if (g.r != null && g.hw == null) { const c = [(g.quad[0][0] + g.quad[2][0]) / 2, (g.quad[0][1] + g.quad[2][1]) / 2]; const d = G.dist(c, p) || 1; return [c[0] + ((p[0] - c[0]) / d) * g.r, c[1] + ((p[1] - c[1]) / d) * g.r]; }
  let best = null, bd = Infinity; for (let i = 0; i < 4; i++) { const a = g.corners[i], b = g.corners[(i + 1) % 4]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1); const q = [a[0] + t * dx, a[1] + t * dy]; const d = G.dist(p, q); if (d < bd) { bd = d; best = q; } }
  return best;
}
// point where the segment from the box centre a to b leaves the box
function rayBoxExit(a, b, box) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; let t = 1;
  if (dx > 0) t = Math.min(t, (box.x + box.w - a[0]) / dx); else if (dx < 0) t = Math.min(t, (box.x - a[0]) / dx);
  if (dy > 0) t = Math.min(t, (box.y + box.h - a[1]) / dy); else if (dy < 0) t = Math.min(t, (box.y - a[1]) / dy);
  return t >= 1 ? null : [a[0] + dx * t, a[1] + dy * t];
}
// dragging a label; linked floors follow according to Preferences (or after asking)
async function finishLabelDrag(m, before) {
  const doc = activeDoc(); const sibs = m.link ? linkSiblings(doc, m).filter((x) => x !== m) : [];
  if (!sibs.length) return;
  let mode = state.prefs.linkLabelMode || 'ask';
  if (mode === 'ask') {
    const r = await openDialog({ title: 'Move the label on other floors?', body: `<p>${esc(sketchName(doc, m) || 'This riser')} is on ${sibs.length + 1} pages. Move its label the same way on the other ${sibs.length}?</p><label class="check"><input type="checkbox" name="remember"> Don't ask again (change this in Preferences)</label>`, buttons: [{ label: 'This floor only', value: 'floor' }, { label: 'All floors', value: 'follow', primary: true }] });
    mode = r && r.value ? r.value : 'floor'; if (r && r.form.remember) { state.prefs.linkLabelMode = mode; savePrefs(); }
  }
  if (mode !== 'follow') return;
  const off = m.labelOff; sibs.forEach((x) => { if (!off) { delete x.labelOff; } else { const A = alignT(doc, m.page), B = tInv(alignT(doc, x.page)); const v = [A[0] * off[0] + A[2] * off[1], A[1] * off[0] + A[3] * off[1]]; x.labelOff = [B[0] * v[0] + B[2] * v[1], B[1] * v[0] + B[3] * v[1]]; } touch(x); });
  renderAllMarks(doc); toast(`Label moved on ${sibs.length + 1} floors`);
}
function sketchBBox(m, doc) {
  const sc = scaleForMarkup(doc, m); const c = m.pts[0]; const rot = sketchRot(doc, m); const A = sketchSize(doc, m), B = sketchTrans(doc, m);
  const pts = []; [A, B].filter(Boolean).forEach((sz) => { const g = sizeGeom(sz, sc, c, rot); if (sz.shape === 'circle') pts.push([c[0] - g.r, c[1] - g.r], [c[0] + g.r, c[1] + g.r]); else pts.push(...g.corners); });
  return G.bbox(pts);
}
function sketchHandles(m, doc) {
  const sc = scaleForMarkup(doc, m); const c = m.pts[0]; const rot = sketchRot(doc, m); const g = sizeGeom(sketchSize(doc, m), sc, c, rot);
  const circ = sketchSize(doc, m).shape === 'circle'; const H = (circ ? g.quad : g.corners).map((p, k) => ({ h: 'k' + k, p }));
  if (!circ) g.quad.forEach((p, k) => H.push({ h: 'j' + k, p, kind: 'side' })); // one side at a time
  const top = g.tr(0, -(g.hh != null ? g.hh : g.r) - 14 / viewerZoom()); H.push({ h: 'rot', p: top, kind: 'rot' });
  return H;
}
// a size typed by the user -> inches. Plain numbers are mm on metric sheets, inches otherwise.
function parseSketchDim(v, sc) { const t = String(v).trim(); if (!t) return NaN; if (/^-?\d+(\.\d+)?$/.test(t)) return isMetric(sc) ? +t / 25.4 : +t; return parseLength(t, 'in'); }
function roundInch(v, sc) { const step = state.sketchStep || (isMetric(sc) ? 10 / 25.4 : 1); return Math.max(step, Math.round(v / step) * step); }
function isMetricScale(sc) { return isMetric(sc) || (sc.unset && metricPref()); }
// write a size change to the shared link (or the markup itself)
function setSketchSize(doc, m, size, which = 'size') {
  const L = linkOf(doc, m);
  if (L) { const key = which === 'trans' ? m.transKey : m.sizeKey; if (key) L.sizes[key] = size; }
  else if (which === 'trans') m.tsz = size; else m.sz = size;
}
function setSketchRot(doc, m, deg) { const L = linkOf(doc, m); if (L) deg += (alignAngle(doc, m.page) * 180) / Math.PI; deg = ((deg % 360) + 360) % 360; deg = Math.round(deg * 1000) / 1000; if (L) L.rot = deg; else m.rot = deg; }
// Resizing: the opposite corner or side stays where it is, as in Revu; hold Alt to size about the centre
// (both sides move). Shift keeps a rectangle square. start = { c, size } when the drag began.
function applySketchHandle(m, h, p, shift, alt, start) {
  const doc = activeDoc(); const sc = scaleForMarkup(doc, m); const rot = sketchRot(doc, m); const c0 = start ? start.c : m.pts[0];
  if (h === 'rot') { const c = m.pts[0]; let a = (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI + 90; a = shift ? Math.round(a / 15) * 15 : Math.round(a); setSketchRot(doc, m, a); return; }
  const cos = Math.cos(rot), sin = Math.sin(rot); const K = 1 / sc.inPerPt; const ipp = sc.inPerPt;
  const dx = p[0] - c0[0], dy = p[1] - c0[1]; const L = [dx * cos + dy * sin, -dx * sin + dy * cos]; // pointer in the shape's own axes
  const toPage = (l) => [c0[0] + l[0] * cos - l[1] * sin, c0[1] + l[0] * sin + l[1] * cos];
  const A0 = start ? start.size : sketchSize(doc, m); const k = +h.slice(1);
  if (A0.shape === 'circle') {
    const u = [[0, -1], [1, 0], [0, 1], [-1, 0]][k] || [1, 0]; const r0 = (A0.d * K) / 2;
    if (alt) { setSketchSize(doc, m, { shape: 'circle', d: roundInch(2 * Math.hypot(L[0], L[1]) * ipp, sc) }); m.pts = [c0.slice()]; return; }
    const opp = [-u[0] * r0, -u[1] * r0]; const along = Math.max(0.5, (L[0] - opp[0]) * u[0] + (L[1] - opp[1]) * u[1]); const d = roundInch(along * ipp, sc);
    setSketchSize(doc, m, { shape: 'circle', d }); m.pts = [toPage([opp[0] + (u[0] * d * K) / 2, opp[1] + (u[1] * d * K) / 2])]; return;
  }
  const hw0 = (A0.w * K) / 2, hh0 = (A0.h * K) / 2; let w, hh, cl;
  if (h[0] === 'j') { // one side: 0 top, 1 right, 2 bottom, 3 left
    const vert = k === 0 || k === 2; const sgn = k === 0 || k === 3 ? -1 : 1;
    if (vert) { const fixed = -sgn * hh0; hh = roundInch((alt ? 2 * Math.abs(L[1]) : Math.abs(L[1] - fixed)) * ipp, sc); w = A0.w; const dir = Math.sign(L[1] - fixed) || sgn; cl = alt ? [0, 0] : [0, fixed + (dir * hh * K) / 2]; }
    else { const fixed = -sgn * hw0; w = roundInch((alt ? 2 * Math.abs(L[0]) : Math.abs(L[0] - fixed)) * ipp, sc); hh = A0.h; const dir = Math.sign(L[0] - fixed) || sgn; cl = alt ? [0, 0] : [fixed + (dir * w * K) / 2, 0]; }
  } else { // a corner: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left
    const sx = [-1, 1, 1, -1][k], sy = [-1, -1, 1, 1][k]; const F = [-sx * hw0, -sy * hh0];
    w = roundInch((alt ? 2 * Math.abs(L[0]) : Math.abs(L[0] - F[0])) * ipp, sc); hh = roundInch((alt ? 2 * Math.abs(L[1]) : Math.abs(L[1] - F[1])) * ipp, sc);
    if (shift) w = hh = Math.max(w, hh);
    const dxs = Math.sign(L[0] - F[0]) || sx, dys = Math.sign(L[1] - F[1]) || sy; cl = alt ? [0, 0] : [F[0] + (dxs * w * K) / 2, F[1] + (dys * hh * K) / 2];
  }
  setSketchSize(doc, m, { shape: 'rect', w, h: hh }); m.pts = [toPage(cl)];
}

// ----- link management ------------------------------------------------------------
function linkSiblings(doc, m) { return m.link ? doc.markups.filter((x) => x.type === 'sketch' && x.link === m.link) : [m]; }
function nextSizeKey(L) { for (const k of 'abcdefghijklmnopqrstuvwxyz') if (!L.sizes[k]) return k; return uid('s'); }
function ensureLink(doc, m) {
  if (linkOf(doc, m)) return linkOf(doc, m);
  doc.links = doc.links || {};
  let name = m.name || m.text || ''; if (!name) { const used = sketchNamesUsed(doc); let n = 1; while (used.has(`R${n}`)) n++; name = `R${n}`; }
  const L = { id: uid('LK'), name, sizes: { a: deep(m.sz || SKETCH_DEFAULTS.rect) }, rot: ((m.rot || 0) + (alignAngle(doc, m.page) * 180) / Math.PI + 360) % 360, sync: true };
  if (m.tsz) { L.sizes.b = deep(m.tsz); m.transKey = 'b'; } else m.transKey = null;
  m.link = L.id; m.sizeKey = 'a'; delete m.sz; delete m.tsz; delete m.rot; delete m.name; m.text = '';
  doc.links[L.id] = L; return L;
}
function cleanupLinks(doc) {
  if (!doc.links) return;
  Object.values(doc.links).forEach((L) => {
    const ms = doc.markups.filter((x) => x.link === L.id); if (!ms.length) { delete doc.links[L.id]; return; }
    const used = new Set(); ms.forEach((x) => { used.add(x.sizeKey); if (x.transKey) used.add(x.transKey); });
    Object.keys(L.sizes).forEach((k) => { if (!used.has(k)) delete L.sizes[k]; });
  });
}
function placeOnPages(doc, m, pages) {
  const L = ensureLink(doc, m); const made = [];
  pages.forEach((p) => {
    if (p === m.page || doc.markups.some((x) => x.link === L.id && x.page === p)) return;
    const pg = doc.pages[p]; const q = mapPage(doc, m.page, p, m.pts[0]); const c = [clamp(q[0], 0, pg.w), clamp(q[1], 0, pg.h)];
    const x = { ...deep(m), id: uid(), page: p, pts: [c], sizeKey: p > m.page && m.transKey ? m.transKey : m.sizeKey, transKey: null, created: nowISO(), modified: nowISO(), author: state.author };
    doc.markups.push(x); made.push(x);
  });
  return made;
}
function addTransition(doc, m, laterFollow) {
  const L = ensureLink(doc, m); const key = nextSizeKey(L); const cur = sketchSize(doc, m);
  L.sizes[key] = cur.shape === 'circle' ? { shape: 'circle', d: Math.max(1, cur.d * 0.8) } : { shape: 'rect', w: Math.max(1, cur.w * 0.75), h: cur.h };
  m.transKey = key;
  if (laterFollow) linkSiblings(doc, m).forEach((x) => { if (x.page > m.page) x.sizeKey = key; });
  return key;
}
function removeTransition(doc, m) {
  const L = linkOf(doc, m); if (!L || !m.transKey) { m.tsz = null; return; }
  const k = m.transKey; m.transKey = null;
  linkSiblings(doc, m).forEach((x) => { if (x.page > m.page && x.sizeKey === k) x.sizeKey = m.sizeKey; });
  cleanupLinks(doc);
}
function unlinkInstance(doc, m) {
  const L = linkOf(doc, m); if (!L) return;
  m.sz = deep(sketchSize(doc, m)); const t = sketchTrans(doc, m); m.tsz = t ? deep(t) : null; m.rot = sketchRotDeg(doc, m); m.name = L.name; m.text = '';
  delete m.link; delete m.sizeKey; delete m.transKey; cleanupLinks(doc);
}
function detachCopy(doc, m) { // used when pasting/duplicating: the copy is independent
  if (m.type !== 'sketch' || !m.link) return m; const L = doc.links[m.link];
  if (L) { m.sz = deep(L.sizes[m.sizeKey] || Object.values(L.sizes)[0]); m.tsz = m.transKey && L.sizes[m.transKey] ? deep(L.sizes[m.transKey]) : null; m.rot = sketchRotDeg(doc, m); m.name = L.name; }
  delete m.link; delete m.sizeKey; delete m.transKey; return m;
}
// moving a synced instance moves its siblings to the same grid position (see syncLinked)
function withLinked(doc, ms) { return ms; }
function resetLabel(m) { const doc = activeDoc(); pushUndo(doc); const all = m.link && state.prefs.linkLabelMode === 'follow' ? linkSiblings(doc, m) : [m]; all.forEach((x) => { delete x.labelOff; touch(x); }); renderAllMarks(doc); refreshPanels(); }
