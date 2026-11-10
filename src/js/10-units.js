// ===== Units, scales, measurement formatting ===============================
// A scale converts page points (1/72 in of paper) into real-world inches.
//   scale = { inPerPt, unit, fmt: 'ftin'|'dec', prec, label }
const UNITS = {
  m: { label: 'm', perIn: 0.0254, area: 'm²', aIn2: 0.00064516, vol: 'm³', vIn3: 1.6387064e-5 },
  mm: { label: 'mm', perIn: 25.4, area: 'm²', aIn2: 0.00064516, vol: 'm³', vIn3: 1.6387064e-5 },
  cm: { label: 'cm', perIn: 2.54, area: 'm²', aIn2: 0.00064516, vol: 'm³', vIn3: 1.6387064e-5 },
  ft: { label: 'ft', perIn: 1 / 12, area: 'sf', aIn2: 1 / 144, vol: 'cy', vIn3: 1 / 46656 },
  in: { label: 'in', perIn: 1, area: 'sq in', aIn2: 1, vol: 'cu in', vIn3: 1 },
  yd: { label: 'yd', perIn: 1 / 36, area: 'sq yd', aIn2: 1 / 1296, vol: 'cu yd', vIn3: 1 / 46656 },
  mi: { label: 'mi', perIn: 1 / 63360, area: 'sq mi', aIn2: 1 / 4014489600, vol: 'cu mi', vIn3: 1 / 2.54358061e14 },
};
// unit preference: 'm' or 'mm' (metric, the default) or 'ftin' (imperial)
function unitPref() { return (typeof state !== 'undefined' && state.units) || 'm'; }
const metricPref = () => unitPref() !== 'ftin';
function metricDisp() { return unitPref() === 'mm' ? { unit: 'mm', fmt: 'dec', prec: 0 } : { unit: 'm', fmt: 'dec', prec: 2 }; }

function archScale(numer, denom) { // a" = 1'-0"
  const a = numer / denom; return { inPerPt: 12 / (a * 72), unit: 'ft', fmt: 'ftin', prec: 16 };
}
const SCALE_PRESETS = [
  { group: 'Metric', items: [1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 250, 500, 1000, 1250, 2000, 2500, 5000].map((n) => [`1:${n}`, { inPerPt: n / 72, unit: 'm', fmt: 'dec', prec: 2, metric: true }]) },
  { group: 'Architectural (imperial)', items: [
    ['1/32" = 1\'-0"', archScale(1, 32)], ['1/16" = 1\'-0"', archScale(1, 16)], ['3/32" = 1\'-0"', archScale(3, 32)], ['1/8" = 1\'-0"', archScale(1, 8)],
    ['3/16" = 1\'-0"', archScale(3, 16)], ['1/4" = 1\'-0"', archScale(1, 4)], ['3/8" = 1\'-0"', archScale(3, 8)], ['1/2" = 1\'-0"', archScale(1, 2)],
    ['3/4" = 1\'-0"', archScale(3, 4)], ['1" = 1\'-0"', archScale(1, 1)], ['1-1/2" = 1\'-0"', archScale(3, 2)], ['3" = 1\'-0"', archScale(3, 1)],
  ] },
  { group: 'Engineering (imperial)', items: [10, 20, 30, 40, 50, 60, 100, 200].map((n) => [`1" = ${n}'`, { inPerPt: (n * 12) / 72, unit: 'ft', fmt: 'dec', prec: 2 }]) },
  { group: 'Full size', items: [['1:1 (paper size)', { inPerPt: 1 / 72, unit: 'mm', fmt: 'dec', prec: 1 }]] },
];
const DEFAULT_SCALE = { inPerPt: 1 / 72, unit: 'mm', fmt: 'dec', prec: 1, label: 'Not set (paper size)', unset: true };
function defaultScale() { return metricPref() ? DEFAULT_SCALE : { ...DEFAULT_SCALE, unit: 'in', prec: 2 }; }
// metric presets show lengths in the preferred metric unit
function presetScale(label) { for (const g of SCALE_PRESETS) for (const [l, s] of g.items) if (l === label) { const o = { ...s, label: l }; if (s.metric) { Object.assign(o, unitPref() === 'ftin' ? { unit: 'm', fmt: 'dec', prec: 2 } : metricDisp()); delete o.metric; } return o; } return null; }
const DEFAULT_PRESET = () => (metricPref() ? '1:100' : '1/4" = 1\'-0"');

function scaleFor(doc, page) { return (doc && doc.scales && doc.scales[page]) || defaultScale(); }
// viewports: rectangles on a page with their own scale (detail callouts, enlarged plans)
function viewportAt(doc, page, p) { const vps = doc && doc.viewports && doc.viewports[page]; if (!vps || !p) return null; for (let i = vps.length - 1; i >= 0; i--) { const v = vps[i]; if (p[0] >= v.x && p[0] <= v.x + v.w && p[1] >= v.y && p[1] <= v.y + v.h) return v; } return null; }
function scaleAt(doc, page, p) { const v = viewportAt(doc, page, p); return v ? v.scale : scaleFor(doc, page); }
function scaleForMarkup(doc, m) { return scaleAt(doc, m.page, m.pts && m.pts[0]); }

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
function fmtFtIn(totalIn, denom = 16) {
  const neg = totalIn < 0; totalIn = Math.abs(totalIn);
  let ft = Math.floor(totalIn / 12); let inch = totalIn - ft * 12;
  let whole = Math.floor(inch); let frac = Math.round((inch - whole) * denom);
  if (frac === denom) { whole++; frac = 0; }
  if (whole === 12) { ft++; whole = 0; }
  let fs = '';
  if (frac) { const g = gcd(frac, denom); fs = ` ${frac / g}/${denom / g}`; }
  return `${neg ? '-' : ''}${ft}'-${whole}${fs}"`;
}
function fmtLen(pts, sc) {
  const u = UNITS[sc.unit] || UNITS.in; const v = pts * sc.inPerPt * u.perIn;
  if (sc.unit === 'ft' && sc.fmt === 'ftin') return fmtFtIn(v * 12, sc.prec || 16);
  return `${v.toFixed(sc.prec == null ? 2 : sc.prec)} ${u.label}`;
}
function lenValue(pts, sc) { return pts * sc.inPerPt * (UNITS[sc.unit] || UNITS.in).perIn; }
// areas: metric lengths of any unit report square metres
function areaValue(pts2, sc) { const u = UNITS[sc.unit] || UNITS.in; return pts2 * sc.inPerPt * sc.inPerPt * u.aIn2; }
function fmtArea(pts2, sc) { const u = UNITS[sc.unit] || UNITS.in; return `${areaValue(pts2, sc).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${u.area}`; }
// volume: plan area x depth (depth in the scale's length unit) -> cubic metres or cubic yards
function volValue(pts2, depth, sc) { const u = UNITS[sc.unit] || UNITS.in; const in3 = pts2 * sc.inPerPt * sc.inPerPt * ((depth || 0) / u.perIn); return in3 * u.vIn3; }
function defaultDepth(sc) { return { m: 0.15, mm: 150, cm: 15, ft: 0.5, in: 6, yd: 0.15, mi: 0.0001 }[sc.unit] || 0.15; }
// real-world area of a sketch size given in inches, formatted for the scale's unit system
function sizeAreaIn2(size) { if (!size) return 0; return size.shape === 'circle' ? (Math.PI * (+size.d || 0) * (+size.d || 0)) / 4 : (+size.w || 0) * (+size.h || 0); }
function fmtRealArea(in2, sc) { if (['m', 'mm', 'cm'].includes(sc.unit) || (sc.unset && metricPref())) { const v = in2 * 0.00064516; return `${v.toFixed(v < 1 ? 3 : 2)} m²`; } const v = in2 / 144; return `${v.toFixed(v < 10 ? 2 : 1)} sf`; }
function fmtVol(pts2, depth, sc) { const u = UNITS[sc.unit] || UNITS.in; return `${volValue(pts2, depth, sc).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${u.vol}`; }

// parse a user length like 12'-6", 12' 6 1/2", 12.5, 3.2m -> value in given unit
function parseLength(str, unit) {
  str = String(str).trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!str) return NaN;
  const ftin = str.match(/^(-?\d+(?:\.\d+)?)\s*'\s*-?\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*"?)?$/);
  if (ftin) { const ft = +ftin[1]; let inch = ftin[2] ? +ftin[2] : 0; if (ftin[3]) inch += +ftin[3] / +ftin[4]; const totalIn = ft * 12 + (ft < 0 ? -inch : inch); return totalIn * UNITS[unit].perIn; }
  const inch = str.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*"$/);
  if (inch) { let v = +inch[1]; if (inch[2]) v += +inch[2] / +inch[3]; return v * UNITS[unit].perIn; }
  const withUnit = str.match(/^(-?\d+(?:\.\d+)?)\s*(ft|in|yd|mi|m|cm|mm)$/i);
  if (withUnit) { const u = withUnit[2].toLowerCase(); return (+withUnit[1] / UNITS[u].perIn) * UNITS[unit].perIn; }
  const n = parseFloat(str); return isNaN(n) ? NaN : n;
}
