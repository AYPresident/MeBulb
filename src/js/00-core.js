// ===== Core utilities =====================================================
if (!Promise.withResolvers) Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let _uidN = 0;
const uid = (p = 'PM-') => p + Date.now().toString(36) + (_uidN++).toString(36) + Math.random().toString(36).slice(2, 6);
const deep = (o) => JSON.parse(JSON.stringify(o));
const nowISO = () => new Date().toISOString();
const fmtDate = (iso) => { try { const d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return iso || ''; } };
const num = (v, d = 3) => { const s = (+v).toFixed(d); return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const raf = () => new Promise((r) => requestAnimationFrame(r));

const store = {
  get(k, d) { try { const v = localStorage.getItem('planmark:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('planmark:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ----- geometry ------------------------------------------------------------
const G = {
  dist: (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]),
  len(pts, closed) { let s = 0; for (let i = 1; i < pts.length; i++) s += G.dist(pts[i - 1], pts[i]); if (closed && pts.length > 2) s += G.dist(pts[pts.length - 1], pts[0]); return s; },
  signedArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; },
  area(pts) { return Math.abs(G.signedArea(pts)); },
  centroid(pts) {
    const A = G.signedArea(pts);
    if (Math.abs(A) < 1e-6) { let x = 0, y = 0; pts.forEach((p) => { x += p[0]; y += p[1]; }); return [x / pts.length, y / pts.length]; }
    let cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const f = a[0] * b[1] - b[0] * a[1]; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f; }
    return [cx / (6 * A), cy / (6 * A)];
  },
  bbox(pts) { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const p of pts) { if (p[0] < x1) x1 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[0] > x2) x2 = p[0]; if (p[1] > y2) y2 = p[1]; } return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, x2, y2 }; },
  rectPts(a, b) { const x1 = Math.min(a[0], b[0]), y1 = Math.min(a[1], b[1]), x2 = Math.max(a[0], b[0]), y2 = Math.max(a[1], b[1]); return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]; },
  segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy; let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = clamp(t, 0, 1); return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); },
  angleAt(a, v, b) { const a1 = Math.atan2(a[1] - v[1], a[0] - v[0]), a2 = Math.atan2(b[1] - v[1], b[0] - v[0]); let d = Math.abs(a1 - a2); if (d > Math.PI) d = 2 * Math.PI - d; return d; },
  snapAngle(o, p, stepDeg = 45) { const d = G.dist(o, p); const st = (stepDeg * Math.PI) / 180; const a = Math.round(Math.atan2(p[1] - o[1], p[0] - o[0]) / st) * st; return [o[0] + Math.cos(a) * d, o[1] + Math.sin(a) * d]; },
  // point at distance t along polyline -> {p, angle}
  along(pts, t) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) { const l = G.dist(pts[i - 1], pts[i]); if (acc + l >= t || i === pts.length - 1) { const f = l ? (t - acc) / l : 0; const a = pts[i - 1], b = pts[i]; return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], angle: Math.atan2(b[1] - a[1], b[0] - a[0]) }; } acc += l; }
    return { p: pts[0], angle: 0 };
  },
  // Ramer-Douglas-Peucker
  simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) { const [s, e] = stack.pop(); let md = 0, mi = -1; for (let i = s + 1; i < e; i++) { const d = G.segDist(pts[i], pts[s], pts[e]); if (d > md) { md = d; mi = i; } } if (md > tol && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); } }
    return pts.filter((_, i) => keep[i]);
  },
  pointInPoly(p, pts) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; },
};

// ----- text metrics (PDF standard fonts, codes 32..255 + extras) ----------------
// Widths come from the AFM metrics of the PDF base fonts, so what we lay out on
// screen matches what we write into the PDF exactly.
const FM = /*METRICS*/;
const HELV = FM; // HELV.reg / HELV.bold indexed by code - 32
const FONT_FAMILIES = {
  helv: { label: 'Helvetica', css: "Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', sans-serif", da: 'Helv', res: ['FR', 'FB', 'FI', 'FBI'], std: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'] },
  times: { label: 'Times', css: "'Times New Roman', Times, 'Liberation Serif', 'Nimbus Roman', serif", da: 'TiRo', res: ['TR', 'TB', 'TI', 'TBI'], std: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] },
  courier: { label: 'Courier', css: "'Courier New', Courier, 'Liberation Mono', 'Nimbus Mono PS', monospace", da: 'Cour', res: ['CR', 'CB', 'CI', 'CBI'], std: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] },
};
// installed fonts are keyed 'sys:<family>'; unknown ones keep their key (metrics fall back to Helvetica)
const famOf = (f) => (FONT_FAMILIES[f] ? f : typeof f === 'string' && f.startsWith('sys:') && f.length > 4 ? registerSysFamily(f.slice(4), true) : 'helv');
function fontRes(fam, bold, italic) { return FONT_FAMILIES[famOf(fam)].res[(bold ? 1 : 0) + (italic ? 2 : 0)]; }
function charWidth(code, fam, bold, italic) {
  const E = FONT_FAMILIES[fam]; if (E && E.sys) { const r = sysFace(fam, bold, italic); if (r) return r.face.F.width(code) || r.face.F.width(32) || 500; fam = 'helv'; }
  if (fam === 'courier') return 600;
  const k = fam === 'times' ? (bold ? (italic ? 'tbi' : 'tbold') : italic ? 'tital' : 'treg') : bold ? 'bold' : 'reg'; const t = FM[k];
  if (code >= 32 && code <= 255) { const w = t[code - 32]; if (w) return w; }
  if (code === 8594) return t[187 - 32]; if (code === 8592) return t[171 - 32]; // arrows print as » «
  return FM[k + 'X'][code] || (fam === 'times' ? 500 : 556);
}
function textWidth(str, size, bold, fam, italic) {
  str = String(str); const f = famOf(fam); let w = 0;
  const E = FONT_FAMILIES[f]; const r = E.sys ? sysFace(f, !!bold, !!italic) : null;
  if (r) { const F = r.face.F; for (const ch of str) w += F.width(ch.codePointAt(0)); return (w * size) / 1000; }
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); w += charWidth(c, E.sys ? 'helv' : f, !!bold, !!italic); }
  return (w * size) / 1000;
}
function wrapText(str, size, bold, maxW, fam, italic) {
  const out = []; const tw = (s) => textWidth(s, size, bold, fam, italic);
  String(str || '').split('\n').forEach((para) => {
    if (!para) { out.push(''); return; }
    const words = para.split(/( +)/); let line = '';
    for (const w of words) {
      const test = line + w;
      if (tw(test.trimEnd()) <= maxW || !line.trim()) {
        if (!line.trim() && tw(w) > maxW && w.trim()) {
          // break a long word
          let chunk = line;
          for (const ch of w) { if (tw(chunk + ch) > maxW && chunk) { out.push(chunk); chunk = ch; } else chunk += ch; }
          line = chunk;
        } else line = test;
      } else { out.push(line.trimEnd()); line = w.trim() ? w : ''; }
    }
    out.push(line.trimEnd());
  });
  return out;
}

// ----- colors ----------------------------------------------------------------
function hexToRgb(hex) { if (!hex || hex === 'none') return null; let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function darken(hex, f = 0.35) { const c = hexToRgb(hex); if (!c) return hex; return '#' + c.map((v) => Math.round(v * (1 - f)).toString(16).padStart(2, '0')).join(''); }
const SWATCHES = ['#d6331f', '#f08a00', '#f5d300', '#2e9e3e', '#11a3b5', '#1f5fd1', '#8e3fd1', '#d1308f', '#1b1f24', '#7b8794', '#ffffff'];
