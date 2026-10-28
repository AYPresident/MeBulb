// ===== Markup model: tools, display lists, SVG output =======================
// Coordinates: page units = PDF points in the page's displayed orientation,
// origin top-left, y down (pdf.js viewport at scale 1).
const BASE_STYLE = { stroke: '#d6331f', fill: 'none', width: 1.5, opacity: 1, fillOpacity: 0.25, dash: 'solid', fontSize: 10, fontColor: null, font: 'helv', bold: false, italic: false, underline: false, strike: false, align: 'left', arrowStart: 'none', arrowEnd: 'none', cloud: false, blend: null, labelBg: true };

const TOOLS = {
  select: { label: 'Select', key: 'v', icon: 'select' },
  pan: { label: 'Pan', key: 'h', icon: 'pan' },
  text: { label: 'Text box', key: 't', icon: 'text', mode: 'box', subject: 'Text Box', style: { width: 0, stroke: '#d6331f', fill: 'none', fontSize: 12, fontColor: '#d6331f' } },
  callout: { label: 'Callout', key: 'q', icon: 'callout', mode: 'callout', subject: 'Callout', style: { width: 1, fill: '#ffffff', fillOpacity: 1, fontSize: 11, fontColor: '#d6331f', arrowEnd: 'arrow' } },
  note: { label: 'Note', key: 'n', icon: 'note', mode: 'point', subject: 'Note', style: { fill: '#ffd84d', stroke: '#9a7a00', fillOpacity: 1, width: 0.75 } },
  strikeout: { label: 'Strikethrough / underline text', short: 'Strike', key: 'u', icon: 'strike', mode: 'textsel', subject: 'Strikethrough', style: { stroke: '#d6331f', width: 1.25, variant: 'strike' } },
  texthl: { label: 'Text highlight', icon: 'highlight', mode: 'textsel', subject: 'Highlight', style: { stroke: '#f5d300', opacity: 0.5, blend: 'multiply', width: 0 } },
  pen: { label: 'Pen', key: 'p', icon: 'pen', mode: 'free', subject: 'Pen', style: { width: 1.5 } },
  highlight: { label: 'Highlighter (drag over PDF text to highlight it)', short: 'Highlight', key: 'i', icon: 'highlight', mode: 'free', subject: 'Highlight', style: { stroke: '#f5d300', width: 12, opacity: 0.5, blend: 'multiply' } },
  line: { label: 'Line', key: 'l', icon: 'line', mode: 'line', subject: 'Line', style: {} },
  arrow: { label: 'Arrow', key: 'a', icon: 'arrow', mode: 'line', subject: 'Arrow', style: { arrowEnd: 'arrow' } },
  rect: { label: 'Rectangle', key: 'r', icon: 'rect', mode: 'box', subject: 'Rectangle', style: {} },
  ellipse: { label: 'Ellipse', key: 'e', icon: 'ellipse', mode: 'box', subject: 'Ellipse', style: {} },
  polygon: { label: 'Polygon', key: 'g', icon: 'polygon', mode: 'multi', closed: true, dragBox: true, subject: 'Polygon', style: {} },
  polyline: { label: 'Polyline', key: 'y', icon: 'polyline', mode: 'multi', subject: 'Polyline', style: {} },
  cloud: { label: 'Cloud (click points, or drag a box)', short: 'Cloud', key: 'k', icon: 'cloud', mode: 'multi', closed: true, dragBox: true, subject: 'Cloud', style: { cloud: true, cloudArc: 14 } },
  stamp: { label: 'Stamp', key: 's', icon: 'stamp', mode: 'point', subject: 'Stamp', text: 'APPROVED', style: { stroke: '#2e9e3e', width: 2, fontColor: '#2e9e3e', fill: 'none' } },
  image: { label: 'Image', icon: 'image', mode: 'box', subject: 'Image', style: { width: 0, stroke: '#1b1f24' } },
  calibrate: { label: 'Calibrate scale', short: 'Calibrate', key: 'K', icon: 'calibrate', mode: 'line', measure: true, style: { stroke: '#11a3b5', width: 1.25, dash: 'dashed' } },
  length: { label: 'Length', key: 'm', icon: 'length', mode: 'line', measure: true, subject: 'Length', style: { stroke: '#1f5fd1', fontColor: '#1f5fd1', width: 1.25, fontSize: 10, arrowStart: 'arrow', arrowEnd: 'arrow' } },
  polylength: { label: 'Polylength', key: 'M', icon: 'polylength', mode: 'multi', measure: true, subject: 'Polylength', style: { stroke: '#1f5fd1', fontColor: '#1f5fd1', width: 1.25, fontSize: 10, arrowStart: 'butt', arrowEnd: 'butt' } },
  area: { label: 'Area', key: 'A', icon: 'area', mode: 'multi', closed: true, dragBox: true, measure: true, subject: 'Area', style: { stroke: '#2e9e3e', fill: '#2e9e3e', fillOpacity: 0.22, fontColor: '#1d6b29', width: 1.25, fontSize: 11 } },
  perimeter: { label: 'Perimeter', key: 'P', icon: 'perimeter', mode: 'multi', closed: true, dragBox: true, measure: true, subject: 'Perimeter', style: { stroke: '#8e3fd1', fontColor: '#8e3fd1', width: 1.25, fontSize: 10 } },
  volume: { label: 'Volume', key: 'V', icon: 'volume', mode: 'multi', closed: true, dragBox: true, measure: true, subject: 'Volume', style: { stroke: '#f08a00', fill: '#f08a00', fillOpacity: 0.2, fontColor: '#a35d00', width: 1.25, fontSize: 11 } },
  count: { label: 'Count', key: 'C', icon: 'count', mode: 'count', measure: true, subject: 'Count', style: { stroke: '#d1308f', fill: '#d1308f', fillOpacity: 0.85, width: 1, fontSize: 10, size: 6, symbol: 'circle' } },
  angle: { label: 'Angle', key: 'G', icon: 'angle', mode: 'multi', maxPts: 3, measure: true, subject: 'Angle', style: { stroke: '#11a3b5', fontColor: '#0b7482', width: 1.25, fontSize: 10 } },
  radius: { label: 'Radius', key: 'R', icon: 'radius', mode: 'line', measure: true, subject: 'Radius', style: { stroke: '#11a3b5', fontColor: '#0b7482', width: 1.25, fontSize: 10 } },
  zoom: { label: 'Zoom to area', key: 'z', icon: 'zoombox', mode: 'box', style: { stroke: '#1d6ce0', width: 1, dash: 'dashed' } },
  viewport: { label: 'Viewport (area with its own scale)', short: 'Viewport', key: 'W', icon: 'viewport', mode: 'box', measure: true, style: { stroke: '#11a3b5', width: 1, dash: 'dashed', fill: 'none' } },
  cutout: { label: 'Cutout', icon: 'cutout', mode: 'multi', closed: true, style: { stroke: '#d6331f', width: 1, dash: 'dashed', fill: 'none' } },
  sketchrect: { label: 'Sketch rectangle to scale', short: 'Sketch rect', key: 'b', icon: 'sketchrect', mode: 'sketch', shape: 'rect', subject: 'Sketch rectangle', style: { stroke: '#1f5fd1', width: 1.25, fill: '#1f5fd1', fillOpacity: 0.07, fontSize: 9, fontColor: '#1f5fd1', symbol: 'x', showLabel: true, showName: true, showSize: true, showArea: false, showDims: false } },
  sketchcircle: { label: 'Sketch circle to scale', short: 'Sketch circle', key: 'o', icon: 'sketchcircle', mode: 'sketch', shape: 'circle', subject: 'Sketch circle', style: { stroke: '#1f8a3a', width: 1.25, fill: '#1f8a3a', fillOpacity: 0.07, fontSize: 9, fontColor: '#1d6b29', symbol: 'x', showLabel: true, showName: true, showSize: true, showArea: false, showDims: false } },
  equip: { label: 'Equipment to scale (top view with clearances)', short: 'Equipment', icon: 'equip', mode: 'equip', subject: 'Equipment', style: { stroke: '#343a40', width: 1, fill: '#ffffff', fillOpacity: 0.85, fontSize: 8, fontColor: '#212529' } },
  sketch: { label: 'Sketch to scale', icon: 'sketchrect', subject: 'Sketch' },
  edittext: { label: 'Edit PDF text', short: 'Edit text', key: 'x', icon: 'edittext', mode: 'textedit', subject: 'Text edit', style: { fontColor: '#000000', cover: '#ffffff', fontSize: 10, stroke: '#000000', width: 0 } },
  textedit: { label: 'Text edit', icon: 'edittext', subject: 'Text edit' },
  alignpts: { label: 'Align pages by grid points', short: 'Align by points', icon: 'align', mode: 'alignpick', style: {} },
  // reference marks for lining pages up when the drawings have no grid to read (see 27-align.js)
  refpt: { label: 'Reference point (for lining pages up)', short: 'Ref point', icon: 'refpt', mode: 'point', subject: 'Reference point', style: { stroke: '#c2255c', width: 1, fontSize: 10, fontColor: '#c2255c', fill: 'none' } },
  gridline: { label: 'Grid line (for lining pages up)', short: 'Grid line', icon: 'gridline', mode: 'line', subject: 'Grid line', style: { stroke: '#c2255c', width: 0.75, dash: 'dashdot', fontSize: 10, fontColor: '#c2255c', fill: 'none' } },
};
const REF_TYPES = new Set(['refpt', 'gridline']);
const MEASURE_TYPES = new Set(['length', 'polylength', 'area', 'perimeter', 'volume', 'count', 'angle', 'radius']);
const BOX_TYPES = new Set(['rect', 'ellipse', 'text', 'stamp', 'image']);
const CUTOUT_TYPES = new Set(['area', 'volume']);
const QUAD_TYPES = new Set(['texthl', 'strikeout']);
const TEXT_TYPES = new Set(['text', 'callout']);
const STAMPS = ['APPROVED', 'REVIEWED', 'REJECTED', 'REVISE & RESUBMIT', 'FOR CONSTRUCTION', 'NOT FOR CONSTRUCTION', 'PRELIMINARY', 'VOID', 'AS-BUILT', 'DRAFT'];
const STATUSES = ['None', 'Accepted', 'Rejected', 'Completed', 'Cancelled'];

function toolStyle(tool) { return { ...BASE_STYLE, ...(TOOLS[tool] && TOOLS[tool].style), ...(state.toolStyles[tool] || {}) }; }

function newMarkup(type, page, pts, extra = {}) {
  const t = TOOLS[type] || {};
  return {
    id: uid(), type, page, pts, style: toolStyle(type), text: t.text || '', subject: t.subject || type,
    author: state.author, created: nowISO(), modified: nowISO(), status: 'None', comment: '', layer: activeDoc() ? activeDoc().activeLayer || null : null, locked: false, ...extra,
  };
}

// ----- path helpers ----------------------------------------------------------
const P = {
  poly(pts, closed) { const d = pts.map((p, i) => [i ? 'L' : 'M', p[0], p[1]]); if (closed) d.push(['Z']); return d; },
  ellipse(cx, cy, rx, ry) {
    const k = 0.5522847498;
    return [['M', cx + rx, cy], ['C', cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry], ['C', cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy],
      ['C', cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry], ['C', cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy], ['Z']];
  },
  roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); const k = 0.5522847498 * r;
    return [['M', x + r, y], ['L', x + w - r, y], ['C', x + w - r + k, y, x + w, y + r - k, x + w, y + r], ['L', x + w, y + h - r], ['C', x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h],
      ['L', x + r, y + h], ['C', x + r - k, y + h, x, y + h - r + k, x, y + h - r], ['L', x, y + r], ['C', x, y + r - k, x + r - k, y, x + r, y], ['Z']];
  },
  cloud(pts, arc) {
    if (pts.length < 2) return P.poly(pts);
    const sign = G.signedArea(pts) >= 0 ? 1 : -1; const d = [['M', pts[0][0], pts[0][1]]];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]; const L = G.dist(a, b); if (L < 1e-6) continue;
      const n = Math.max(1, Math.round(L / arc)); const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const nx = sign > 0 ? uy : -uy, ny = sign > 0 ? -ux : ux; const seg = L / n; const bulge = (seg / 2) * 1.15;
      for (let j = 0; j < n; j++) {
        const p = [a[0] + ux * seg * j, a[1] + uy * seg * j], q = [a[0] + ux * seg * (j + 1), a[1] + uy * seg * (j + 1)];
        d.push(['C', p[0] + nx * bulge - ux * seg * 0.1, p[1] + ny * bulge - uy * seg * 0.1, q[0] + nx * bulge + ux * seg * 0.1, q[1] + ny * bulge + uy * seg * 0.1, q[0], q[1]]);
      }
    }
    d.push(['Z']); return d;
  },
  smooth(pts) {
    if (pts.length < 3) return P.poly(pts);
    const d = [['M', pts[0][0], pts[0][1]]]; let c = pts[0];
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], m = [(p[0] + pts[i + 1][0]) / 2, (p[1] + pts[i + 1][1]) / 2];
      d.push(['C', c[0] + (2 / 3) * (p[0] - c[0]), c[1] + (2 / 3) * (p[1] - c[1]), m[0] + (2 / 3) * (p[0] - m[0]), m[1] + (2 / 3) * (p[1] - m[1]), m[0], m[1]]); c = m;
    }
    const l = pts[pts.length - 1]; d.push(['L', l[0], l[1]]); return d;
  },
  toD(d) { return d.map((s) => s[0] + (s.length > 1 ? s.slice(1).map((v) => num(v, 2)).join(' ') : '')).join(''); },
};

// ----- curved segments (polylines, polygons and the measured polys) ------------------------
// m.curves[k] bends the segment from pts[k] to pts[k+1] (k = n-1 is a polygon's closing side).
// It keeps the point the curve passes through halfway, relative to the segment ([along, across]
// as fractions of its length), so moving, turning or resizing the markup carries the bend along.
const CURVE_TYPES = new Set(['polyline', 'polygon', 'cloud', 'polylength', 'area', 'perimeter', 'volume']);
const CV = {
  has(m) { return !!(m && m.curves && CURVE_TYPES.has(m.type) && Object.keys(m.curves).length); },
  closed(m) { return m.type === 'polygon' || m.type === 'cloud' || m.type === 'area' || m.type === 'perimeter' || m.type === 'volume'; },
  // the point halfway along a bent segment, in page units
  mid(a, b, c) { const dx = b[0] - a[0], dy = b[1] - a[1]; return [a[0] + c[0] * dx - c[1] * dy, a[1] + c[0] * dy + c[1] * dx]; },
  // a halfway point -> [along, across] for segment a-b
  rel(a, b, h) { const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; const rx = h[0] - a[0], ry = h[1] - a[1]; return [(rx * dx + ry * dy) / l2, (ry * dx - rx * dy) / l2]; },
  // quadratic control point of a bent segment
  ctl(a, b, c) { const h = CV.mid(a, b, c); return [2 * h[0] - (a[0] + b[0]) / 2, 2 * h[1] - (a[1] + b[1]) / 2]; },
  at(a, c, b, t) { const u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; },
  segs(pts, closed) { return pts.length < 2 ? 0 : closed && pts.length > 2 ? pts.length : pts.length - 1; },
  // absolute control points per segment (null for straight ones)
  ctls(pts, curves, closed) { const n = pts.length, out = []; for (let k = 0; k < CV.segs(pts, closed); k++) { const c = curves && curves[k]; out.push(c ? CV.ctl(pts[k], pts[(k + 1) % n], c) : null); } return out; },
  // the shape as points, bent segments broken into short straight pieces (measuring, hit tests, PDF vertices).
  // step: aim for pieces about that long (clouds want even arcs); otherwise enough pieces to be exact to well under 0.1%
  flat(pts, curves, closed, step) {
    if (!curves || pts.length < 2) return pts; const n = pts.length; const out = [pts[0]]; const S = CV.segs(pts, closed);
    for (let k = 0; k < S; k++) {
      const a = pts[k], b = pts[(k + 1) % n], c = curves[k];
      if (!c) { out.push(b); continue; }
      const C = CV.ctl(a, b, c); const L = G.dist(a, C) + G.dist(C, b); const N = step ? Math.max(1, Math.round(L / step)) : clamp(Math.ceil(L / 3), 12, 64);
      for (let j = 1; j <= N; j++) out.push(CV.at(a, C, b, j / N));
    }
    if (closed && S === n) out.pop();
    return out;
  },
  pts(m) { return CV.has(m) ? CV.flat(m.pts, m.curves, CV.closed(m)) : m.pts; },
  // path commands with the bends as cubic Béziers (the same curves PDF and SVG draw)
  path(pts, ctl, closed) {
    const n = pts.length; if (!n) return []; const d = [['M', pts[0][0], pts[0][1]]]; const S = closed && n > 2 ? n : n - 1;
    for (let k = 0; k < S; k++) {
      const a = pts[k], b = pts[(k + 1) % n], c = ctl && ctl[k];
      if (c) d.push(['C', a[0] + (2 / 3) * (c[0] - a[0]), a[1] + (2 / 3) * (c[1] - a[1]), b[0] + (2 / 3) * (c[0] - b[0]), b[1] + (2 / 3) * (c[1] - b[1]), b[0], b[1]]);
      else if (k < n - 1) d.push(['L', b[0], b[1]]);
    }
    if (closed && n > 2) d.push(['Z']); return d;
  },
  // a bend that carries on smoothly from the previous side (an arc-like curve), or a gentle one
  auto(pts, k) {
    const a = pts[k], b = pts[k + 1]; const p = k > 0 ? pts[k - 1] : null; const cx = b[0] - a[0], cy = b[1] - a[1]; const cl = Math.hypot(cx, cy); if (cl < 1e-6) return [0.5, 0.25];
    if (p) { const dx = a[0] - p[0], dy = a[1] - p[1]; const dl = Math.hypot(dx, dy); const dot = dl ? (dx * cx + dy * cy) / dl : 0;
      if (dl > 1e-6 && dot > cl * 0.15) { const t = (cl * cl) / 2 / dot; const C = [a[0] + (dx / dl) * t, a[1] + (dy / dl) * t]; const h = [(a[0] + 2 * C[0] + b[0]) / 4, (a[1] + 2 * C[1] + b[1]) / 4]; const r = CV.rel(a, b, h); if (Math.abs(r[1]) > 0.02 && Math.abs(r[1]) < 0.6) return r; } }
    return [0.5, 0.25];
  },
  // split segment k at the point nearest p: a new vertex at k+1, the bend shared by both halves
  insert(m, k, p) {
    const n = m.pts.length, a = m.pts[k], b = m.pts[(k + 1) % n], c = m.curves && m.curves[k]; const shifted = {};
    if (m.curves) Object.entries(m.curves).forEach(([j, v]) => { j = +j; if (j > k) shifted[j + 1] = v; else if (j < k) shifted[j] = v; });
    let q;
    if (c) {
      const C = CV.ctl(a, b, c); let bt = 0.5, bd = Infinity; for (let j = 0; j <= 64; j++) { const t = j / 64; const d = G.dist(CV.at(a, C, b, t), p); if (d < bd) { bd = d; bt = t; } }
      const t = clamp(bt, 0.02, 0.98); q = CV.at(a, C, b, t); const c1 = [a[0] + (C[0] - a[0]) * t, a[1] + (C[1] - a[1]) * t], c2 = [C[0] + (b[0] - C[0]) * t, C[1] + (b[1] - C[1]) * t];
      shifted[k] = CV.rel(a, q, [(a[0] + 2 * c1[0] + q[0]) / 4, (a[1] + 2 * c1[1] + q[1]) / 4]); shifted[k + 1] = CV.rel(q, b, [(q[0] + 2 * c2[0] + b[0]) / 4, (q[1] + 2 * c2[1] + b[1]) / 4]);
    } else { const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1); q = [a[0] + dx * t, a[1] + dy * t]; }
    m.pts.splice(k + 1, 0, q); if (m.curves || c) m.curves = shifted; return k + 1;
  },
  // drop vertex k; the sides either side become one straight side
  remove(m, k) {
    const n = m.pts.length; if (!m.curves) { m.pts.splice(k, 1); return; } const out = {};
    Object.entries(m.curves).forEach(([j, v]) => { j = +j; if (j === k || j === k - 1 || (k === 0 && j === n - 1)) return; out[j > k ? j - 1 : j] = v; });
    m.pts.splice(k, 1); m.curves = out;
  },
  // which side of the markup is near p? -> {k, d}
  nearSeg(m, p) {
    const closed = CV.closed(m); const n = m.pts.length; let best = null;
    for (let k = 0; k < CV.segs(m.pts, closed); k++) {
      const a = m.pts[k], b = m.pts[(k + 1) % n]; const c = m.curves && m.curves[k];
      const line = c ? CV.flat([a, b], { 0: c }, false) : [a, b]; for (let j = 1; j < line.length; j++) { const d = G.segDist(p, line[j - 1], line[j]); if (!best || d < best.d) best = { k, d }; }
    }
    return best;
  },
};

// Line endings, the same set as PDF annotations (and Bluebeam): value -> PDF /LE name
const LINE_ENDS = [['none', 'None', 'None'], ['arrow', 'Closed arrow', 'ClosedArrow'], ['open', 'Open arrow', 'OpenArrow'], ['rarrow', 'Reverse closed arrow', 'RClosedArrow'], ['ropen', 'Reverse open arrow', 'ROpenArrow'], ['dot', 'Circle', 'Circle'], ['square', 'Square', 'Square'], ['diamond', 'Diamond', 'Diamond'], ['tick', 'Slash', 'Slash'], ['butt', 'Butt', 'Butt']];
const LE_TO_PDF = Object.fromEntries(LINE_ENDS.map(([k, , p]) => [k, p])); const LE_FROM_PDF = Object.fromEntries(LINE_ENDS.map(([k, , p]) => [p, k]));
// arrowhead primitives at `tip`, pointing away from `from`; returns {prims, cut}
function arrowHead(tip, from, kind, s) {
  if (!kind || kind === 'none') return { prims: [], cut: tip };
  const w = s.width || 1; const L = 5 + w * 3; const hw = L * 0.42;
  const dx = tip[0] - from[0], dy = tip[1] - from[1]; const l = Math.hypot(dx, dy) || 1; const ux = dx / l, uy = dy / l; const px = -uy, py = ux;
  const at = (a, b) => [tip[0] + ux * a + px * b, tip[1] + uy * a + py * b];
  const col = s.stroke; const solid = (pts) => ({ k: 'path', d: P.poly(pts, true), fill: col, fillOpacity: 1, stroke: col, width: Math.min(w, 0.6), opacity: s.opacity, join: 'miter' });
  const line = (pts) => ({ k: 'path', d: P.poly(pts), stroke: col, width: w, opacity: s.opacity, join: 'miter', fill: 'none' });
  switch (kind) {
    case 'arrow': return { prims: [solid([tip, at(-L, hw), at(-L, -hw)])], cut: at(-L * 0.8, 0) };
    case 'open': return { prims: [line([at(-L, hw), tip, at(-L, -hw)])], cut: tip };
    case 'rarrow': return { prims: [solid([tip, at(L, hw), at(L, -hw)])], cut: tip };
    case 'ropen': return { prims: [line([at(L, hw), tip, at(L, -hw)])], cut: tip };
    case 'dot': { const r = L * 0.32; return { prims: [{ k: 'path', d: P.ellipse(tip[0], tip[1], r, r), fill: col, fillOpacity: 1, stroke: 'none', opacity: s.opacity }], cut: tip }; }
    case 'square': { const h = L * 0.3; return { prims: [solid([at(-h, -h), at(h, -h), at(h, h), at(-h, h)])], cut: tip }; }
    case 'diamond': { const h = L * 0.42; return { prims: [solid([at(-h, 0), at(0, h), at(h, 0), at(0, -h)])], cut: tip }; }
    case 'tick': { const t = L * 0.5; return { prims: [line([at(-t * 0.6, -t), at(t * 0.6, t)])], cut: tip }; }
    case 'butt': { const t = L * 0.5; return { prims: [line([at(0, -t), at(0, t)])], cut: tip }; }
  }
  return { prims: [], cut: tip };
}

// Count symbols
const COUNT_SYMBOLS = [['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle'], ['diamond', 'Diamond'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['star', 'Star'], ['cross', 'Cross (×)'], ['plus', 'Plus (+)'], ['check', 'Check (✓)']];
function countSymbol(p, r, sym, s, fill) {
  const [x, y] = p; const poly = (n, rot, rr = r) => { const pts = []; for (let k = 0; k < n; k++) { const a = rot + (k * 2 * Math.PI) / n; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); } return P.poly(pts, true); };
  const filled = fill && fill !== 'none'; const edge = filled ? darken(fill, 0.3) : s.stroke;
  const shape = (d) => ({ k: 'path', d, fill: filled ? fill : 'transparent', fillOpacity: filled ? s.fillOpacity : 1, stroke: edge, width: filled ? s.width : Math.max(1, s.width * 1.5), opacity: s.opacity, hit: 'box', join: 'miter' });
  const strokeOnly = (d) => [{ k: 'path', d: P.ellipse(x, y, r, r), fill: 'transparent', stroke: 'none', hitOnly: true, hit: 'box' }, { k: 'path', d, fill: 'none', stroke: filled ? fill : s.stroke, width: Math.max(1.2, r * 0.32), opacity: s.opacity, cap: 'round', join: 'round' }];
  switch (sym) {
    case 'square': return [shape(P.poly([[x - r * 0.88, y - r * 0.88], [x + r * 0.88, y - r * 0.88], [x + r * 0.88, y + r * 0.88], [x - r * 0.88, y + r * 0.88]], true))];
    case 'triangle': return [shape(poly(3, -Math.PI / 2, r * 1.15))];
    case 'diamond': return [shape(poly(4, -Math.PI / 2, r * 1.1))];
    case 'pentagon': return [shape(poly(5, -Math.PI / 2, r * 1.05))];
    case 'hexagon': return [shape(poly(6, 0, r * 1.02))];
    case 'star': { const pts = []; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5; const rr = k % 2 ? r * 0.5 : r * 1.2; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); } return [shape(P.poly(pts, true))]; }
    case 'cross': return strokeOnly([['M', x - r * 0.75, y - r * 0.75], ['L', x + r * 0.75, y + r * 0.75], ['M', x + r * 0.75, y - r * 0.75], ['L', x - r * 0.75, y + r * 0.75]]);
    case 'plus': return strokeOnly([['M', x - r, y], ['L', x + r, y], ['M', x, y - r], ['L', x, y + r]]);
    case 'check': return strokeOnly([['M', x - r * 0.85, y + r * 0.05], ['L', x - r * 0.25, y + r * 0.7], ['L', x + r * 0.9, y - r * 0.7]]);
    default: return [shape(P.ellipse(x, y, r, r))];
  }
}

// ----- labels ----------------------------------------------------------------
function labelPrims(lines, cx, cy, angle, s, opts = {}) {
  const size = s.fontSize || 10; const lh = size * 1.18; const col = s.fontColor || s.stroke; const fam = famOf(s.font), b = !!s.bold, it = !!s.italic;
  lines = lines.filter((l) => l != null && l !== '');
  if (!lines.length) return [];
  const w = Math.max(...lines.map((l) => textWidth(l, size, b, fam, it))); const totalH = lines.length * lh;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const tr = (lx, ly) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
  const out = [];
  if (s.labelBg !== false && !opts.noBg) {
    const x1 = -w / 2 - size * 0.3, x2 = w / 2 + size * 0.3, y1 = -totalH / 2 - size * 0.12, y2 = totalH / 2 + size * 0.12;
    out.push({ k: 'path', d: P.poly([tr(x1, y1), tr(x2, y1), tr(x2, y2), tr(x1, y2)], true), fill: '#ffffff', fillOpacity: 0.86, stroke: 'none', opacity: s.opacity });
  }
  lines.forEach((l, i) => { const ly = -totalH / 2 + i * lh + size * 0.84; const [x, y] = tr(0, ly); out.push({ k: 'text', x, y, size, str: l, color: col, anchor: 'middle', rot: angle, opacity: s.opacity, font: fam, bold: b, italic: it }); });
  return out;
}
function uprightAngle(a) { if (a > Math.PI / 2 - 1e-6) a -= Math.PI; if (a < -Math.PI / 2 - 1e-6) a += Math.PI; return a; } // vertical text reads bottom-to-top

// ----- text layout (text box, callout) ---------------------------------------
function boxRect(a, b) { return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }; }
function textLayout(m) {
  const s = m.style; const size = s.fontSize || 12; const pad = s.pad != null ? s.pad : Math.max(3, size * 0.4);
  const b = m.type === 'callout' ? boxRect(m.pts[1], m.pts[2]) : boxRect(m.pts[0], m.pts[1]);
  const lay = layoutRich(runsOf(m), s, Math.max(b.w - 2 * pad, size));
  const h = Math.max(b.h, lay.height + 2 * pad);
  return { x: b.x, y: b.y, w: b.w, h, lay, lh: size * (s.lineH || 1.2), pad, size };
}
// A callout's leaders, the way Revu draws them: from the arrow tip to a knee, then level into the side of
// the box facing the knee. The knee is set by dragging its handle (m.knee); otherwise it sits a short
// run out from the middle of the side facing the tip. Extra leaders (m.leaders: [{tip, knee}]) work the same.
function calloutLeader(L, s, tip, knee) {
  const x1 = L.x, x2 = L.x + L.w, y1 = L.y, y2 = L.y + L.h; const cx = (x1 + x2) / 2; const stub = Math.max(10, (s.fontSize || 12) * 1.1);
  if (knee && knee[0] > x1 - 0.5 && knee[0] < x2 + 0.5) knee = null; // a knee inside the box's width means "automatic"
  if (!knee) { const right = tip[0] >= cx; const y = (y1 + y2) / 2; return { tip, knee: [right ? x2 + stub : x1 - stub, y], attach: [right ? x2 : x1, y], auto: true }; }
  const right = knee[0] > cx; return { tip, knee, attach: [right ? x2 : x1, clamp(knee[1], y1, y2)], auto: false };
}
function calloutLeaders(m, L) { L = L || textLayout(m); const s = m.style; return [calloutLeader(L, s, m.pts[0], m.knee), ...(m.leaders || []).map((ld) => calloutLeader(L, s, ld.tip, ld.knee))]; }
// the box a text box or callout shows (it grows to fit its text)
function textBox(m) { const L = textLayout(m); return { x: L.x, y: L.y, w: L.w, h: L.h }; }
// height follows the text, unless the box was made taller by hand (then it only grows)
function fitTextBox(m) {
  const L = textLayout(m); const need = Math.max(L.lay.height + 2 * L.pad, L.size + 2 * L.pad); const cur = m.type === 'callout' ? boxRect(m.pts[1], m.pts[2]).h : boxRect(m.pts[0], m.pts[1]).h; const h = m.fixedH ? Math.max(need, cur) : need;
  if (m.type === 'text') m.pts = [[L.x, L.y], [L.x + L.w, L.y + h]]; else if (m.type === 'callout') m.pts = [m.pts[0], [L.x, L.y], [L.x + L.w, L.y + h]];
}
function textPrims(L, s, hideText) {
  const out = [];
  const hasFill = s.fill && s.fill !== 'none'; const hasStroke = s.width > 0 && s.stroke && s.stroke !== 'none';
  if (hasFill || hasStroke) out.push({ k: 'path', d: P.poly(G.rectPts([L.x, L.y], [L.x + L.w, L.y + L.h]), true), fill: hasFill ? s.fill : 'none', fillOpacity: s.fillOpacity, stroke: hasStroke ? s.stroke : 'none', width: s.width, dash: s.dash, opacity: s.opacity, hit: 'box' });
  else out.push({ k: 'path', d: P.poly(G.rectPts([L.x, L.y], [L.x + L.w, L.y + L.h]), true), fill: 'transparent', stroke: 'none', hitOnly: true });
  if (!hideText) richPrims(L, s, out);
  return out;
}

// ----- measurement info --------------------------------------------------------
function netArea(m) { let A = G.area(CV.pts(m)); if (m.holes) m.holes.forEach((h) => { if (h.length > 2) A -= G.area(h); }); return Math.max(0, A); }
function measureInfo(m, doc) {
  if (m.type === 'sketch') { const A = sketchSize(doc, m); return { kind: 'Size', value: A.shape === 'circle' ? A.d : A.w * A.h, unit: '', text: `${sizeLabel(doc, m)} · ${areaLabel(doc, m)}`, area: areaLabel(doc, m) }; }
  const sc = scaleForMarkup(doc, m); const u = UNITS[sc.unit] || UNITS.in; const pts = CV.pts(m);
  switch (m.type) {
    case 'length': case 'polylength': { const L = G.len(pts); return { kind: 'Length', value: lenValue(L, sc), unit: u.label, text: fmtLen(L, sc) }; }
    case 'perimeter': { const L = G.len(pts, true); return { kind: 'Length', value: lenValue(L, sc), unit: u.label, text: fmtLen(L, sc) }; }
    case 'area': { const A = netArea(m); return { kind: 'Area', value: areaValue(A, sc), unit: u.area, text: fmtArea(A, sc) }; }
    case 'volume': { const A = netArea(m); return { kind: 'Volume', value: volValue(A, m.depth, sc), unit: u.vol, text: fmtVol(A, m.depth, sc), sub: `${fmtArea(A, sc)} × ${sc.unit === 'ft' && sc.fmt === 'ftin' ? fmtFtIn((m.depth || 0) * 12, 16) : num(m.depth || 0, 3) + ' ' + u.label}` }; }
    case 'count': { const n = m._countTotal || pts.length; return { kind: 'Count', value: n, unit: 'ea', text: `${n}` }; }
    case 'angle': { if (pts.length < 3) return { kind: 'Angle', value: 0, unit: '°', text: '' }; const d = (G.angleAt(pts[0], pts[1], pts[2]) * 180) / Math.PI; return { kind: 'Angle', value: d, unit: '°', text: `${d.toFixed(1)}°` }; }
    case 'radius': { const r = G.dist(pts[0], pts[1]); if (m.ext && m.ext.it === 'CircleDimension') return { kind: 'Length', value: lenValue(2 * r, sc), unit: u.label, text: 'Ø ' + fmtLen(2 * r, sc) }; return { kind: 'Length', value: lenValue(r, sc), unit: u.label, text: 'R ' + fmtLen(r, sc) }; }
  }
  return null;
}

// ----- display list -------------------------------------------------------------
function dl(m, doc, opts = {}) {
  const s = m.style; const pts = m.pts; const out = [];
  const stroke = (d, extra = {}) => ({ k: 'path', d, stroke: s.stroke, width: s.width, dash: s.dash, opacity: s.opacity, fill: 'none', blend: s.blend, ...extra });
  const shape = (d, extra = {}) => ({ k: 'path', d, stroke: s.width > 0 ? s.stroke : 'none', width: s.width, dash: s.dash, opacity: s.opacity, fill: s.fill, fillOpacity: s.fillOpacity, blend: s.blend, ...extra });
  const outline = (p, closed) => (s.cloud && closed && p.length > 2 ? P.cloud(p, s.cloudArc || 14) : P.poly(p, closed));
  const curved = CV.has(m); const fp = curved ? CV.flat(pts, m.curves, CV.closed(m) && !opts.open) : pts; // fp: the drawn shape as points
  const outlineC = (p, closed) => (!curved ? outline(p, closed) : (s.cloud || m.type === 'cloud') && closed && p.length > 2 ? P.cloud(CV.flat(p, m.curves, true, s.cloudArc || 14), s.cloudArc || 14) : CV.path(p, CV.ctls(p, m.curves, closed), closed));
  switch (m.type) {
    case 'rect': out.push(shape(outline(G.rectPts(pts[0], pts[1]), true))); break;
    case 'ellipse': { const b = boxRect(pts[0], pts[1]); out.push(shape(P.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2))); break; }
    case 'line': case 'arrow': case 'polyline': case 'calibrate': {
      if (pts.length < 2) break;
      const p = pts.map((x) => x.slice()); const n = p.length; const ctl = CV.has(m) ? CV.ctls(pts, m.curves, false) : null; // arrowheads follow a bent end's tangent
      const a1 = arrowHead(p[n - 1], (ctl && ctl[n - 2]) || p[n - 2], s.arrowEnd, s); const a0 = arrowHead(p[0], (ctl && ctl[0]) || p[1], s.arrowStart, s);
      p[n - 1] = a1.cut; p[0] = a0.cut;
      out.push(stroke(ctl ? CV.path(p, ctl, false) : P.poly(p)), ...a0.prims, ...a1.prims);
      if (m.type === 'calibrate' && opts.draftLabel) out.push(...labelPrims([opts.draftLabel], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, 0, s));
      break;
    }
    case 'polygon': case 'cloud': if (pts.length >= 2) out.push(shape(outlineC(pts, pts.length > 2 && !opts.open), { fill: pts.length > 2 ? s.fill : 'none' })); break;
    case 'pen': case 'highlight': out.push(stroke(P.smooth(pts), { cap: 'round', join: 'round', dash: 'solid' })); break;
    case 'texthl': for (let k = 0; k + 3 < pts.length; k += 4) out.push({ k: 'path', d: P.poly(pts.slice(k, k + 4), true), fill: s.stroke, fillOpacity: 1, stroke: 'none', opacity: s.opacity, blend: s.blend || 'multiply', hit: 'box' }); break;
    case 'strikeout':
      for (let k = 0; k + 3 < pts.length; k += 4) {
        const [tl, tr, br, bl] = pts.slice(k, k + 4); const f = s.variant === 'under' ? 0.9 : 0.55; const L = (a, b) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        out.push({ k: 'path', d: P.poly([tl, tr, br, bl], true), fill: 'transparent', stroke: 'none', hitOnly: true });
        out.push(stroke(P.poly([L(tl, bl), L(tr, br)]), { dash: 'solid' }));
      }
      break;
    case 'text': out.push(...textPrims(textLayout(m), s, opts.hideText)); break;
    case 'sketch': out.push(...sketchPrims(m, doc, opts)); break;
    case 'equip': out.push(...equipPrims(m, doc, opts)); break;
    case 'textedit': {
      const q = pts; const cover = !m.applied || opts.forceCover;
      out.push({ k: 'path', d: P.poly(q, true), fill: cover ? s.cover || '#ffffff' : 'transparent', fillOpacity: 1, stroke: 'none', hit: 'box', hitOnly: !cover });
      if (!opts.hideText && m.text) out.push({ k: 'text', x: m.base[0], y: m.base[1], size: s.fontSize, bold: !!s.bold, italic: !!s.italic, font: famOf(s.font), str: m.text, color: s.fontColor || '#000000', anchor: 'start', rot: m.ang || 0 });
      break;
    }
    case 'callout': {
      const L = textLayout(m);
      calloutLeaders(m, L).forEach((ld) => { const ah = arrowHead(ld.tip, ld.knee, s.arrowEnd || 'arrow', s); out.push(stroke(P.poly([ld.attach, ld.knee, ah.cut]), { width: Math.max(s.width, 0.75), stroke: s.stroke, join: 'miter' }), ...ah.prims); });
      out.push(...textPrims(L, s, opts.hideText));
      break;
    }
    case 'refpt': {
      const [x, y] = pts[0]; const r = Math.max(4, (s.fontSize || 10) * 0.55); const col = s.fontColor || s.stroke;
      out.push({ k: 'path', d: P.ellipse(x, y, r, r), stroke: s.stroke, width: s.width, fill: '#ffffff', fillOpacity: 0.5, opacity: s.opacity, hit: 'box' }, stroke(P.poly([[x - r * 1.9, y], [x + r * 1.9, y]]), { dash: 'solid' }), stroke(P.poly([[x, y - r * 1.9], [x, y + r * 1.9]]), { dash: 'solid' }));
      if (m.text) out.push({ k: 'text', x: x + r * 1.3, y: y - r * 1.2, size: s.fontSize || 10, str: m.text, color: col, bold: true, opacity: s.opacity, font: famOf(s.font) });
      break;
    }
    case 'gridline': {
      if (pts.length < 2) break; const [a, b] = pts; const Ln = G.dist(a, b) || 1; const ux = (b[0] - a[0]) / Ln, uy = (b[1] - a[1]) / Ln; const fs = s.fontSize || 10; const R = fs * 0.95; const c = [a[0] - ux * R, a[1] - uy * R];
      out.push(stroke(P.poly([a, b])), { k: 'path', d: P.ellipse(c[0], c[1], R, R), stroke: s.stroke, width: Math.max(0.75, s.width), fill: '#ffffff', fillOpacity: 1, opacity: s.opacity, hit: 'box' });
      if (m.text) out.push({ k: 'text', x: c[0], y: c[1] + fs * 0.36, size: fs, str: m.text, color: s.fontColor || s.stroke, bold: true, anchor: 'middle', opacity: s.opacity, font: famOf(s.font) });
      break;
    }
    case 'note': {
      const [x, y] = pts[0]; const z = 18; const fill = s.fill && s.fill !== 'none' ? s.fill : '#ffd84d'; const sk = s.stroke || darken(fill);
      out.push({ k: 'path', d: [['M', x, y], ['L', x + z, y], ['L', x + z, y + z * 0.72], ['L', x + z * 0.72, y + z], ['L', x, y + z], ['Z']], fill, fillOpacity: 1, stroke: sk, width: 0.75, opacity: s.opacity, hit: 'box' });
      out.push({ k: 'path', d: [['M', x + z, y + z * 0.72], ['L', x + z * 0.72, y + z * 0.72], ['L', x + z * 0.72, y + z]], fill: 'none', stroke: sk, width: 0.75, opacity: s.opacity });
      for (let i = 0; i < 3; i++) out.push({ k: 'path', d: [['M', x + 4, y + 5 + i * 3.6], ['L', x + (i === 2 ? 10 : 14), y + 5 + i * 3.6]], stroke: sk, width: 0.9, fill: 'none', opacity: s.opacity });
      break;
    }
    case 'stamp': {
      const b = boxRect(pts[0], pts[1]);
      if (m.asset) { const src = doc && doc.assetImg && doc.assetImg[m.asset]; if (!src && doc) assetImage(doc, m.asset).then(() => renderMarkupEl(m, doc)).catch(() => {}); out.push({ k: 'asset', asset: m.asset, src, x: b.x, y: b.y, w: b.w, h: b.h, opacity: s.opacity }, { k: 'path', d: P.poly(G.rectPts(pts[0], pts[1]), true), fill: 'transparent', stroke: 'none', hitOnly: true, hit: 'box' }); break; } const txt = (m.text || 'STAMP').toUpperCase();
      const sub = m.stampSub === false ? '' : `${m.author || ''}  ${new Date(m.created || Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`.trim();
      const mainSize = Math.max(4, Math.min(b.h * (sub ? 0.46 : 0.62), (b.w - 14) / Math.max(1, textWidth(txt, 1, true))));
      const col = s.fontColor || s.stroke; const sw = Math.max(0.5, s.width);
      out.push({ k: 'path', d: P.roundRect(b.x, b.y, b.w, b.h, Math.min(8, b.h * 0.2)), fill: s.fill && s.fill !== 'none' ? s.fill : 'transparent', fillOpacity: s.fill && s.fill !== 'none' ? s.fillOpacity : 1, stroke: s.stroke, width: sw, opacity: s.opacity, hit: 'box' });
      out.push({ k: 'path', d: P.roundRect(b.x + sw * 1.8, b.y + sw * 1.8, b.w - sw * 3.6, b.h - sw * 3.6, Math.min(6, b.h * 0.16)), fill: 'none', stroke: s.stroke, width: sw * 0.5, opacity: s.opacity });
      const my = sub ? b.y + b.h * 0.56 : b.y + b.h / 2 + mainSize * 0.36;
      out.push({ k: 'text', x: b.x + b.w / 2, y: my, size: mainSize, bold: true, str: txt, color: col, anchor: 'middle', opacity: s.opacity });
      if (sub) { const ss = Math.min(mainSize * 0.36, (b.w - 14) / Math.max(1, textWidth(sub, 1, false))); out.push({ k: 'text', x: b.x + b.w / 2, y: b.y + b.h * 0.84, size: ss, str: sub, color: col, anchor: 'middle', opacity: s.opacity }); }
      break;
    }
    case 'image': {
      const b = boxRect(pts[0], pts[1]);
      out.push({ k: 'image', x: b.x, y: b.y, w: b.w, h: b.h, src: m.src, opacity: s.opacity });
      out.push({ k: 'path', d: P.poly(G.rectPts(pts[0], pts[1]), true), fill: 'transparent', stroke: s.width > 0 ? s.stroke : 'none', width: s.width, opacity: s.opacity, hit: 'box' });
      break;
    }
    // ---- measurements ----
    case 'length': case 'polylength': {
      if (pts.length < 2) break;
      { const p = pts.map((x) => x.slice()); const n = p.length; const ctl = curved ? CV.ctls(pts, m.curves, false) : null; const a0 = arrowHead(p[0], (ctl && ctl[0]) || p[1], s.arrowStart || 'butt', s), a1 = arrowHead(p[n - 1], (ctl && ctl[n - 2]) || p[n - 2], s.arrowEnd || 'butt', s); p[0] = a0.cut; p[n - 1] = a1.cut; out.push(stroke(ctl ? CV.path(p, ctl, false) : P.poly(p)), ...a0.prims.map((x) => ({ ...x, dash: 'solid' })), ...a1.prims.map((x) => ({ ...x, dash: 'solid' }))); }
      const info = measureInfo(m, doc); const tot = G.len(fp); const at = G.along(fp, tot / 2); const ang = uprightAngle(at.angle);
      const size = s.fontSize || 10; const up = [Math.sin(ang), -Math.cos(ang)]; const nLines = m.text ? 2 : 1; const off = size * (0.55 + 0.6 * nLines);
      out.push(...labelPrims([m.text, info.text], at.p[0] + up[0] * off, at.p[1] + up[1] * off, ang, s));
      break;
    }
    case 'area': case 'perimeter': case 'volume': {
      if (pts.length < 2) break;
      const closed = pts.length > 2 && !opts.open; let d = outlineC(pts, closed); let evenodd = false;
      if (closed && m.holes && m.holes.length && CUTOUT_TYPES.has(m.type)) { m.holes.forEach((h) => { if (h.length > 2) d = d.concat(P.poly(h, true)); }); evenodd = true; }
      out.push(shape(d, { fill: m.type === 'perimeter' || !closed ? 'none' : s.fill, evenodd }));
      if (pts.length > 2) { const info = measureInfo(m, doc); const c = G.centroid(fp); out.push(...labelPrims([m.text, info.text, m.type === 'volume' ? info.sub : null], c[0], c[1], 0, s)); }
      break;
    }
    case 'count': {
      const r = s.size || 6; const fill = s.fill; const sym = s.symbol || 'circle'; const lineSym = ['cross', 'plus', 'check'].includes(sym);
      pts.forEach((p, i) => {
        out.push(...countSymbol(p, r, sym, s, fill));
        if (s.numbered && !lineSym) out.push({ k: 'text', x: p[0], y: p[1] + r * 0.4, size: r * 1.05, bold: true, str: String((s.numStart || 0) + i + 1), color: fill && fill !== 'none' ? '#ffffff' : s.stroke, anchor: 'middle', opacity: s.opacity });
      });
      if (pts.length && s.labelBg !== false) { const p = pts[0]; const info = measureInfo(m, doc); const lab = (m.text ? m.text + ': ' : '') + info.text; const w = textWidth(lab, s.fontSize || 10, s.bold, s.font, s.italic); out.push(...labelPrims([lab], p[0] + r + 4 + w / 2, p[1] - r - (s.fontSize || 10) * 0.4, 0, { ...s, fontColor: s.fontColor || darken(fill, 0.3) })); }
      break;
    }
    case 'angle': {
      if (pts.length < 2) break;
      out.push(stroke(P.poly(pts)));
      if (pts.length === 3) {
        const [a, v, b] = pts; const r = Math.max(6, Math.min(26, 0.4 * Math.min(G.dist(a, v), G.dist(b, v))));
        let a1 = Math.atan2(a[1] - v[1], a[0] - v[0]), a2 = Math.atan2(b[1] - v[1], b[0] - v[0]); let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        const arc = []; for (let i = 0; i <= 16; i++) { const t = a1 + (da * i) / 16; arc.push([v[0] + Math.cos(t) * r, v[1] + Math.sin(t) * r]); }
        out.push(stroke(P.poly(arc), { dash: 'solid' }));
        const mid = a1 + da / 2; const info = measureInfo(m, doc); const size = s.fontSize || 10; const lr = r + size * 1.4;
        out.push(...labelPrims([info.text], v[0] + Math.cos(mid) * lr, v[1] + Math.sin(mid) * lr, 0, s));
      }
      break;
    }
    case 'radius': {
      if (pts.length < 2) break;
      const [c, e] = pts; const r = G.dist(c, e);
      out.push(shape(P.ellipse(c[0], c[1], r, r), { fill: s.fill }));
      out.push(stroke(P.poly([c, e]), { dash: 'solid' }));
      out.push(stroke(P.poly([[c[0] - 3, c[1]], [c[0] + 3, c[1]]]), { dash: 'solid' }), stroke(P.poly([[c[0], c[1] - 3], [c[0], c[1] + 3]]), { dash: 'solid' }));
      const info = measureInfo(m, doc); const ang = uprightAngle(Math.atan2(e[1] - c[1], e[0] - c[0])); const size = s.fontSize || 10; const up = [Math.sin(ang), -Math.cos(ang)];
      out.push(...labelPrims([m.text, info.text], (c[0] + e[0]) / 2 + up[0] * size * 1.1, (c[1] + e[1]) / 2 + up[1] * size * 1.1, ang, s));
      break;
    }
  }
  return out;
}

// bounding box of a markup in page units (for selection, marquee, hit)
function markupBBox(m, doc) {
  if (m.type === 'text' || m.type === 'callout') { const L = textLayout(m); const pts = [[L.x, L.y], [L.x + L.w, L.y + L.h]]; if (m.type === 'callout') calloutLeaders(m, L).forEach((ld) => pts.push(ld.tip, ld.knee)); return G.bbox(pts); }
  if (m.type === 'note') return { x: m.pts[0][0], y: m.pts[0][1], w: 18, h: 18, x2: m.pts[0][0] + 18, y2: m.pts[0][1] + 18 };
  if (REF_TYPES.has(m.type)) { const b = primsBBox(dl(m, doc)); return b ? { ...b, w: b.x2 - b.x, h: b.y2 - b.y } : G.bbox(m.pts); }
  if (m.type === 'sketch') return sketchBBox(m, doc);
  if (m.type === 'equip') return equipBBox(m, doc);
  if (m.type === 'textedit') { const b = G.bbox(m.pts); if (m.text) { const w = textWidth(m.text, m.style.fontSize, m.style.bold, m.style.font, m.style.italic); const e = [m.base[0] + Math.cos(m.ang || 0) * w, m.base[1] + Math.sin(m.ang || 0) * w]; return G.bbox([...m.pts, e]); } return b; }
  if (m.type === 'radius') { const r = G.dist(m.pts[0], m.pts[1]); const c = m.pts[0]; return { x: c[0] - r, y: c[1] - r, w: 2 * r, h: 2 * r, x2: c[0] + r, y2: c[1] + r }; }
  if (m.type === 'count') { const r = m.style.size || 6; const b = G.bbox(m.pts); return { x: b.x - r, y: b.y - r, w: b.w + 2 * r, h: b.h + 2 * r, x2: b.x2 + r, y2: b.y2 + r }; }
  return G.bbox(CV.pts(m));
}

// does a markup touch a rectangle? (crossing window selection) Uses the drawn geometry,
// so a diagonal line only counts where its stroke actually passes through the window.
function segHitsRect(a, b, r) {
  const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h; const inside = (p) => p[0] >= x1 && p[0] <= x2 && p[1] >= y1 && p[1] <= y2;
  if (inside(a) || inside(b)) return true;
  const cross = (p, q, u, v) => { const d = (q[0] - p[0]) * (v[1] - u[1]) - (q[1] - p[1]) * (v[0] - u[0]); if (Math.abs(d) < 1e-12) return false; const t = ((u[0] - p[0]) * (v[1] - u[1]) - (u[1] - p[1]) * (v[0] - u[0])) / d; const s = ((u[0] - p[0]) * (q[1] - p[1]) - (u[1] - p[1]) * (q[0] - p[0])) / d; return t >= 0 && t <= 1 && s >= 0 && s <= 1; };
  const c = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]; for (let k = 0; k < 4; k++) if (cross(a, b, c[k], c[(k + 1) % 4])) return true; return false;
}
function markupTouchesRect(m, doc, r, mb) {
  mb = mb || markupBBox(m, doc); if (mb.x2 < r.x || mb.x > r.x + r.w || mb.y2 < r.y || mb.y > r.y + r.h) return false;
  if (['text', 'callout', 'note', 'stamp', 'image', 'count', 'textedit', 'sketch'].includes(m.type)) {
    if (m.type !== 'callout') return true; // box-like: the bounding box is the markup
  }
  for (const p of dl(m, doc)) {
    if (p.k === 'text') return true; if (p.k !== 'path' || p.hitOnly) continue;
    const segs = []; let cur = null, start = null;
    for (const s of p.d) {
      if (s[0] === 'M') { cur = [s[1], s[2]]; start = cur; }
      else if (s[0] === 'L') { const n = [s[1], s[2]]; segs.push([cur, n]); cur = n; }
      else if (s[0] === 'C') { const p0 = cur; let prev = p0; for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; const q = [u * u * u * p0[0] + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5], u * u * u * p0[1] + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6]]; segs.push([prev, q]); prev = q; } cur = prev; }
      else if (s[0] === 'Z' && cur && start) { segs.push([cur, start]); cur = start; }
    }
    if (segs.some(([a, b]) => segHitsRect(a, b, r))) return true;
    // a filled shape also counts when the window sits inside it
    if (p.fill && p.fill !== 'none' && (p.fillOpacity == null || p.fillOpacity > 0.02)) { const poly = segs.map(([a]) => a); if (poly.length > 2 && G.pointInPoly([r.x + r.w / 2, r.y + r.h / 2], poly)) return true; }
  }
  return false;
}

// ----- SVG output --------------------------------------------------------------
const DASH = { dashed: (w) => `${num(w * 4 + 2, 2)} ${num(w * 3 + 1.5, 2)}`, dotted: (w) => `${num(Math.max(w, 0.5) * 0.01, 2)} ${num(w * 2.2 + 1, 2)}`, dashdot: (w) => `${num(w * 5 + 3, 2)} ${num(w * 2 + 1.5, 2)} ${num(w * 0.01, 2)} ${num(w * 2 + 1.5, 2)}` };
function dashArray(dash, w) { return dash && DASH[dash] ? DASH[dash](w) : null; }
const SVG_FONT = FONT_FAMILIES.helv.css;
function primSvg(p) {
  if (p.k === 'path') {
    const a = [`d="${P.toD(p.d)}"`];
    a.push(`fill="${p.fill && p.fill !== 'none' ? p.fill : 'none'}"`);
    if (p.fill && p.fill !== 'none' && p.fill !== 'transparent' && p.fillOpacity != null && p.fillOpacity < 1) a.push(`fill-opacity="${p.fillOpacity}"`);
    if (p.stroke && p.stroke !== 'none' && p.width > 0) {
      a.push(`stroke="${p.stroke}" stroke-width="${num(p.width, 3)}"`);
      const da = dashArray(p.dash, p.width); if (da) a.push(`stroke-dasharray="${da}"`);
      a.push(`stroke-linecap="${p.cap || (p.dash === 'dotted' ? 'round' : 'butt')}" stroke-linejoin="${p.join || 'round'}"`);
    }
    if (p.opacity != null && p.opacity < 1) a.push(`opacity="${p.opacity}"`);
    if (p.blend) a.push(`style="mix-blend-mode:${p.blend}"`);
    if (p.evenodd) a.push('fill-rule="evenodd"');
    return `<path ${a.join(' ')}/>`;
  }
  if (p.k === 'text') {
    const rot = p.rot ? ` transform="rotate(${num((p.rot * 180) / Math.PI, 3)} ${num(p.x, 2)} ${num(p.y, 2)})"` : '';
    return `<text x="${num(p.x, 2)}" y="${num(p.y, 2)}" font-size="${num(p.size, 2)}" font-family="${FONT_FAMILIES[famOf(p.font)].css}"${p.bold ? ' font-weight="700"' : ''}${p.italic ? ' font-style="italic"' : ''} fill="${p.color}" text-anchor="${p.anchor || 'start'}"${p.opacity != null && p.opacity < 1 ? ` opacity="${p.opacity}"` : ''}${rot} xml:space="preserve">${esc(p.str)}</text>`;
  }
  if (p.k === 'asset') return p.src ? `<image href="${p.src}" x="${num(p.x, 2)}" y="${num(p.y, 2)}" width="${num(p.w, 2)}" height="${num(p.h, 2)}" preserveAspectRatio="none"${p.opacity != null && p.opacity < 1 ? ` opacity="${p.opacity}"` : ''}/>` : `<rect x="${num(p.x, 2)}" y="${num(p.y, 2)}" width="${num(p.w, 2)}" height="${num(p.h, 2)}" fill="none" stroke="#999" stroke-dasharray="3 2"/>`;
  if (p.k === 'image') return p.src ? `<image href="${p.src}" x="${num(p.x, 2)}" y="${num(p.y, 2)}" width="${num(p.w, 2)}" height="${num(p.h, 2)}" preserveAspectRatio="none"${p.opacity < 1 ? ` opacity="${p.opacity}"` : ''}/>` : '';
  return '';
}
// SVG for one markup, including invisible fat hit targets
function markupSvg(m, doc, opts = {}) {
  const prims = dl(m, doc, opts); const z = viewerZoom(); const hitW = Math.max(10 / z, 3);
  let body = ''; let hits = '';
  for (const p of prims) {
    if (!p.hitOnly) body += primSvg(p);
    if (p.k === 'path') {
      if (p.hit === 'box' || p.hitOnly || (p.fill && p.fill !== 'none')) hits += `<path d="${P.toD(p.d)}" fill="transparent"${p.evenodd ? ' fill-rule="evenodd"' : ''} stroke="transparent" stroke-width="${num(p.part ? 1 : hitW, 2)}" class="hit"${p.part ? ` data-part="${p.part}"` : ''}/>`;
      else hits += `<path d="${P.toD(p.d)}" fill="none" stroke="transparent" stroke-width="${num(Math.max(hitW, p.width || 0), 2)}" class="hit hit-s"/>`;
    } else if (p.k === 'text' && !TEXT_TYPES.has(m.type) && m.type !== 'stamp' && m.type !== 'textedit') {
      const w = textWidth(p.str, p.size, p.bold, p.font, p.italic); const x = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0;
      hits += `<rect x="${num(p.x + x, 2)}" y="${num(p.y - p.size * 0.85, 2)}" width="${num(w, 2)}" height="${num(p.size * 1.1, 2)}" fill="transparent" class="hit"${p.part ? ` data-part="${p.part}"` : ''}${p.rot ? ` transform="rotate(${num((p.rot * 180) / Math.PI, 2)} ${num(p.x, 2)} ${num(p.y, 2)})"` : ''}/>`;
    }
  }
  const title = m.type === 'note' ? `<title>${esc((m.comment || m.text || 'Note') + '\n— ' + (m.author || ''))}</title>` : '';
  return `<g class="mk${m.locked ? ' locked' : ''}" data-id="${m.id}">${title}${body}${opts.noHit ? '' : hits}</g>`;
}
