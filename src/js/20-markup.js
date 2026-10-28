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
  polygon: { label: 'Polygon', key: 'g', icon: 'polygon', mode: 'multi', closed: true, subject: 'Polygon', style: {} },
  polyline: { label: 'Polyline', key: 'y', icon: 'polyline', mode: 'multi', subject: 'Polyline', style: {} },
  cloud: { label: 'Cloud (click points, or drag a box)', short: 'Cloud', key: 'k', icon: 'cloud', mode: 'multi', closed: true, dragBox: true, subject: 'Cloud', style: { cloud: true, cloudArc: 14 } },
  stamp: { label: 'Stamp', key: 's', icon: 'stamp', mode: 'point', subject: 'Stamp', text: 'APPROVED', style: { stroke: '#2e9e3e', width: 2, fontColor: '#2e9e3e', fill: 'none' } },
  image: { label: 'Image', icon: 'image', mode: 'box', subject: 'Image', style: { width: 0, stroke: '#1b1f24' } },
  calibrate: { label: 'Calibrate scale', short: 'Calibrate', key: 'K', icon: 'calibrate', mode: 'line', measure: true, style: { stroke: '#11a3b5', width: 1.25, dash: 'dashed' } },
  length: { label: 'Length', key: 'm', icon: 'length', mode: 'line', measure: true, subject: 'Length', style: { stroke: '#1f5fd1', fontColor: '#1f5fd1', width: 1.25, fontSize: 10 } },
  polylength: { label: 'Polylength', key: 'M', icon: 'polylength', mode: 'multi', measure: true, subject: 'Polylength', style: { stroke: '#1f5fd1', fontColor: '#1f5fd1', width: 1.25, fontSize: 10 } },
  area: { label: 'Area', key: 'A', icon: 'area', mode: 'multi', closed: true, measure: true, subject: 'Area', style: { stroke: '#2e9e3e', fill: '#2e9e3e', fillOpacity: 0.22, fontColor: '#1d6b29', width: 1.25, fontSize: 11 } },
  perimeter: { label: 'Perimeter', key: 'P', icon: 'perimeter', mode: 'multi', closed: true, measure: true, subject: 'Perimeter', style: { stroke: '#8e3fd1', fontColor: '#8e3fd1', width: 1.25, fontSize: 10 } },
  volume: { label: 'Volume', key: 'V', icon: 'volume', mode: 'multi', closed: true, measure: true, subject: 'Volume', style: { stroke: '#f08a00', fill: '#f08a00', fillOpacity: 0.2, fontColor: '#a35d00', width: 1.25, fontSize: 11 } },
  count: { label: 'Count', key: 'C', icon: 'count', mode: 'count', measure: true, subject: 'Count', style: { stroke: '#d1308f', fill: '#d1308f', fillOpacity: 0.85, width: 1, fontSize: 10, size: 6 } },
  angle: { label: 'Angle', key: 'G', icon: 'angle', mode: 'multi', maxPts: 3, measure: true, subject: 'Angle', style: { stroke: '#11a3b5', fontColor: '#0b7482', width: 1.25, fontSize: 10 } },
  radius: { label: 'Radius', key: 'R', icon: 'radius', mode: 'line', measure: true, subject: 'Radius', style: { stroke: '#11a3b5', fontColor: '#0b7482', width: 1.25, fontSize: 10 } },
  zoom: { label: 'Zoom to area', key: 'z', icon: 'zoombox', mode: 'box', style: { stroke: '#1d6ce0', width: 1, dash: 'dashed' } },
  viewport: { label: 'Viewport (area with its own scale)', short: 'Viewport', key: 'W', icon: 'viewport', mode: 'box', measure: true, style: { stroke: '#11a3b5', width: 1, dash: 'dashed', fill: 'none' } },
  cutout: { label: 'Cutout', icon: 'cutout', mode: 'multi', closed: true, style: { stroke: '#d6331f', width: 1, dash: 'dashed', fill: 'none' } },
  sketchrect: { label: 'Sketch rectangle to scale', short: 'Sketch rect', key: 'b', icon: 'sketchrect', mode: 'sketch', shape: 'rect', subject: 'Sketch rectangle', style: { stroke: '#1f5fd1', width: 1.25, fill: '#1f5fd1', fillOpacity: 0.07, fontSize: 9, fontColor: '#1f5fd1', symbol: 'x', showLabel: true, showName: true, showSize: true, showArea: false, showDims: false } },
  sketchcircle: { label: 'Sketch circle to scale', short: 'Sketch circle', key: 'o', icon: 'sketchcircle', mode: 'sketch', shape: 'circle', subject: 'Sketch circle', style: { stroke: '#1f8a3a', width: 1.25, fill: '#1f8a3a', fillOpacity: 0.07, fontSize: 9, fontColor: '#1d6b29', symbol: 'x', showLabel: true, showName: true, showSize: true, showArea: false, showDims: false } },
  sketch: { label: 'Sketch to scale', icon: 'sketchrect', subject: 'Sketch' },
  edittext: { label: 'Edit PDF text', short: 'Edit text', key: 'x', icon: 'edittext', mode: 'textedit', subject: 'Text edit', style: { fontColor: '#000000', cover: '#ffffff', fontSize: 10, stroke: '#000000', width: 0 } },
  textedit: { label: 'Text edit', icon: 'edittext', subject: 'Text edit' },
  alignpts: { label: 'Align pages by grid points', short: 'Align by points', icon: 'align', mode: 'alignpick', style: {} },
};
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

// arrowhead primitives at `tip`, pointing away from `from`; returns {prims, cut}
function arrowHead(tip, from, kind, s) {
  if (!kind || kind === 'none') return { prims: [], cut: tip };
  const w = s.width || 1; const L = 5 + w * 3; const hw = L * 0.42;
  const dx = tip[0] - from[0], dy = tip[1] - from[1]; const l = Math.hypot(dx, dy) || 1; const ux = dx / l, uy = dy / l; const px = -uy, py = ux;
  const base = [tip[0] - ux * L, tip[1] - uy * L];
  const left = [base[0] + px * hw, base[1] + py * hw], right = [base[0] - px * hw, base[1] - py * hw];
  const col = s.stroke;
  if (kind === 'arrow') return { prims: [{ k: 'path', d: P.poly([tip, left, right], true), fill: col, fillOpacity: 1, stroke: 'none', opacity: s.opacity }], cut: [tip[0] - ux * L * 0.8, tip[1] - uy * L * 0.8] };
  if (kind === 'open') return { prims: [{ k: 'path', d: P.poly([left, tip, right]), stroke: col, width: w, opacity: s.opacity, join: 'miter' }], cut: tip };
  if (kind === 'dot') { const r = L * 0.32; return { prims: [{ k: 'path', d: P.ellipse(tip[0], tip[1], r, r), fill: col, fillOpacity: 1, stroke: 'none', opacity: s.opacity }], cut: tip }; }
  if (kind === 'tick') { const t = L * 0.5; return { prims: [{ k: 'path', d: P.poly([[tip[0] + (px + ux) * t * 0.7, tip[1] + (py + uy) * t * 0.7], [tip[0] - (px + ux) * t * 0.7, tip[1] - (py + uy) * t * 0.7]]), stroke: col, width: w, opacity: s.opacity }], cut: tip }; }
  return { prims: [], cut: tip };
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
  const s = m.style; const size = s.fontSize || 12; const pad = Math.max(3, size * 0.4);
  const b = m.type === 'callout' ? boxRect(m.pts[1], m.pts[2]) : boxRect(m.pts[0], m.pts[1]);
  const lay = layoutRich(runsOf(m), s, Math.max(b.w - 2 * pad, size));
  const h = Math.max(b.h, lay.height + 2 * pad);
  return { x: b.x, y: b.y, w: b.w, h, lay, lh: size * 1.2, pad, size };
}
function fitTextBox(m) {
  const L = textLayout(m); const h = Math.max(L.lay.height + 2 * L.pad, L.size + 2 * L.pad);
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
function netArea(m) { let A = G.area(m.pts); if (m.holes) m.holes.forEach((h) => { if (h.length > 2) A -= G.area(h); }); return Math.max(0, A); }
function measureInfo(m, doc) {
  if (m.type === 'sketch') { const A = sketchSize(doc, m); return { kind: 'Size', value: A.shape === 'circle' ? A.d : A.w * A.h, unit: '', text: `${sizeLabel(doc, m)} · ${areaLabel(doc, m)}`, area: areaLabel(doc, m) }; }
  const sc = scaleForMarkup(doc, m); const u = UNITS[sc.unit] || UNITS.in; const pts = m.pts;
  switch (m.type) {
    case 'length': case 'polylength': { const L = G.len(pts); return { kind: 'Length', value: lenValue(L, sc), unit: u.label, text: fmtLen(L, sc) }; }
    case 'perimeter': { const L = G.len(pts, true); return { kind: 'Length', value: lenValue(L, sc), unit: u.label, text: fmtLen(L, sc) }; }
    case 'area': { const A = netArea(m); return { kind: 'Area', value: areaValue(A, sc), unit: u.area, text: fmtArea(A, sc) }; }
    case 'volume': { const A = netArea(m); return { kind: 'Volume', value: volValue(A, m.depth, sc), unit: u.vol, text: fmtVol(A, m.depth, sc), sub: `${fmtArea(A, sc)} × ${sc.unit === 'ft' && sc.fmt === 'ftin' ? fmtFtIn((m.depth || 0) * 12, 16) : num(m.depth || 0, 3) + ' ' + u.label}` }; }
    case 'count': return { kind: 'Count', value: pts.length, unit: 'ea', text: `${pts.length}` };
    case 'angle': { if (pts.length < 3) return { kind: 'Angle', value: 0, unit: '°', text: '' }; const d = (G.angleAt(pts[0], pts[1], pts[2]) * 180) / Math.PI; return { kind: 'Angle', value: d, unit: '°', text: `${d.toFixed(1)}°` }; }
    case 'radius': { const r = G.dist(pts[0], pts[1]); return { kind: 'Length', value: lenValue(r, sc), unit: u.label, text: 'R ' + fmtLen(r, sc) }; }
  }
  return null;
}

// ----- display list -------------------------------------------------------------
function dl(m, doc, opts = {}) {
  const s = m.style; const pts = m.pts; const out = [];
  const stroke = (d, extra = {}) => ({ k: 'path', d, stroke: s.stroke, width: s.width, dash: s.dash, opacity: s.opacity, fill: 'none', blend: s.blend, ...extra });
  const shape = (d, extra = {}) => ({ k: 'path', d, stroke: s.width > 0 ? s.stroke : 'none', width: s.width, dash: s.dash, opacity: s.opacity, fill: s.fill, fillOpacity: s.fillOpacity, blend: s.blend, ...extra });
  const outline = (p, closed) => (s.cloud && closed && p.length > 2 ? P.cloud(p, s.cloudArc || 14) : P.poly(p, closed));
  switch (m.type) {
    case 'rect': out.push(shape(outline(G.rectPts(pts[0], pts[1]), true))); break;
    case 'ellipse': { const b = boxRect(pts[0], pts[1]); out.push(shape(P.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2))); break; }
    case 'line': case 'arrow': case 'polyline': case 'calibrate': {
      if (pts.length < 2) break;
      const p = pts.map((x) => x.slice());
      const a1 = arrowHead(p[p.length - 1], p[p.length - 2], s.arrowEnd, s); const a0 = arrowHead(p[0], p[1], s.arrowStart, s);
      p[p.length - 1] = a1.cut; p[0] = a0.cut;
      out.push(stroke(P.poly(p)), ...a0.prims, ...a1.prims);
      if (m.type === 'calibrate' && opts.draftLabel) out.push(...labelPrims([opts.draftLabel], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, 0, s));
      break;
    }
    case 'polygon': case 'cloud': if (pts.length >= 2) out.push(shape(outline(pts, pts.length > 2 && !opts.open), { fill: pts.length > 2 ? s.fill : 'none' })); break;
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
    case 'textedit': {
      const q = pts; const cover = !m.applied || opts.forceCover;
      out.push({ k: 'path', d: P.poly(q, true), fill: cover ? s.cover || '#ffffff' : 'transparent', fillOpacity: 1, stroke: 'none', hit: 'box', hitOnly: !cover });
      if (!opts.hideText && m.text) out.push({ k: 'text', x: m.base[0], y: m.base[1], size: s.fontSize, bold: !!s.bold, italic: !!s.italic, font: famOf(s.font), str: m.text, color: s.fontColor || '#000000', anchor: 'start', rot: m.ang || 0 });
      break;
    }
    case 'callout': {
      const L = textLayout(m); const tip = pts[0];
      const cands = [[L.x, L.y + L.h / 2], [L.x + L.w, L.y + L.h / 2], [L.x + L.w / 2, L.y], [L.x + L.w / 2, L.y + L.h]];
      let best = cands[0]; for (const c of cands) if (G.dist(c, tip) < G.dist(best, tip)) best = c;
      const ah = arrowHead(tip, best, s.arrowEnd || 'arrow', s);
      out.push(stroke([['M', best[0], best[1]], ['L', ah.cut[0], ah.cut[1]]], { width: Math.max(s.width, 0.75), stroke: s.stroke }), ...ah.prims);
      out.push(...textPrims(L, s, opts.hideText));
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
      const b = boxRect(pts[0], pts[1]); const txt = (m.text || 'STAMP').toUpperCase();
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
      out.push(stroke(P.poly(pts)));
      const tick = 3 + s.width * 2;
      [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]].forEach(([a, b]) => { const l = G.dist(a, b) || 1; const px = -(b[1] - a[1]) / l, py = (b[0] - a[0]) / l; out.push(stroke(P.poly([[a[0] + px * tick, a[1] + py * tick], [a[0] - px * tick, a[1] - py * tick]]), { dash: 'solid' })); });
      const info = measureInfo(m, doc); const tot = G.len(pts); const at = G.along(pts, tot / 2); const ang = uprightAngle(at.angle);
      const size = s.fontSize || 10; const up = [Math.sin(ang), -Math.cos(ang)]; const nLines = m.text ? 2 : 1; const off = size * (0.55 + 0.6 * nLines);
      out.push(...labelPrims([m.text, info.text], at.p[0] + up[0] * off, at.p[1] + up[1] * off, ang, s));
      break;
    }
    case 'area': case 'perimeter': case 'volume': {
      if (pts.length < 2) break;
      const closed = pts.length > 2 && !opts.open; let d = outline(pts, closed); let evenodd = false;
      if (closed && m.holes && m.holes.length && CUTOUT_TYPES.has(m.type)) { m.holes.forEach((h) => { if (h.length > 2) d = d.concat(P.poly(h, true)); }); evenodd = true; }
      out.push(shape(d, { fill: m.type === 'perimeter' || !closed ? 'none' : s.fill, evenodd }));
      if (pts.length > 2) { const info = measureInfo(m, doc); const c = G.centroid(pts); out.push(...labelPrims([m.text, info.text, m.type === 'volume' ? info.sub : null], c[0], c[1], 0, s)); }
      break;
    }
    case 'count': {
      const r = s.size || 6; const fill = s.fill && s.fill !== 'none' ? s.fill : s.stroke;
      pts.forEach((p, i) => {
        out.push({ k: 'path', d: P.ellipse(p[0], p[1], r, r), fill, fillOpacity: s.fillOpacity, stroke: darken(fill, 0.3), width: s.width, opacity: s.opacity, hit: 'box' });
        if (s.numbered) out.push({ k: 'text', x: p[0], y: p[1] + r * 0.4, size: r * 1.1, bold: true, str: String(i + 1), color: '#ffffff', anchor: 'middle', opacity: s.opacity });
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
  if (m.type === 'text' || m.type === 'callout') { const L = textLayout(m); const pts = [[L.x, L.y], [L.x + L.w, L.y + L.h]]; if (m.type === 'callout') pts.push(m.pts[0]); return G.bbox(pts); }
  if (m.type === 'note') return { x: m.pts[0][0], y: m.pts[0][1], w: 18, h: 18, x2: m.pts[0][0] + 18, y2: m.pts[0][1] + 18 };
  if (m.type === 'sketch') return sketchBBox(m, doc);
  if (m.type === 'textedit') { const b = G.bbox(m.pts); if (m.text) { const w = textWidth(m.text, m.style.fontSize, m.style.bold, m.style.font, m.style.italic); const e = [m.base[0] + Math.cos(m.ang || 0) * w, m.base[1] + Math.sin(m.ang || 0) * w]; return G.bbox([...m.pts, e]); } return b; }
  if (m.type === 'radius') { const r = G.dist(m.pts[0], m.pts[1]); const c = m.pts[0]; return { x: c[0] - r, y: c[1] - r, w: 2 * r, h: 2 * r, x2: c[0] + r, y2: c[1] + r }; }
  if (m.type === 'count') { const r = m.style.size || 6; const b = G.bbox(m.pts); return { x: b.x - r, y: b.y - r, w: b.w + 2 * r, h: b.h + 2 * r, x2: b.x2 + r, y2: b.y2 + r }; }
  return G.bbox(m.pts);
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
