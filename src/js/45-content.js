// ===== Content streams: linework snapping and text runs =====================
// A small PDF content-stream interpreter built on pdf-lib's object model. It walks
// page and form-XObject streams, tracks the graphics state, and reports
//   - stroked/filled path segments (for snap to content), in viewport coords
//   - text-showing operators with their byte ranges and quads (for text editing)
const CS_WS = new Uint8Array(256); [0, 9, 10, 12, 13, 32].forEach((c) => { CS_WS[c] = 1; });
const CS_DELIM = new Uint8Array(256); '()<>[]{}/%'.split('').forEach((ch) => { CS_DELIM[ch.charCodeAt(0)] = 1; });
const pname = (x) => (x && x.asString ? x.asString().replace(/^\//, '') : null);
const pnum = (x) => (x && x.asNumber ? x.asNumber() : typeof x === 'number' ? x : 0);
function mmul(A, B) { return [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3], A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5]]; }
function mpt(M, x, y) { return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]; }

// Tokenize a content stream; calls onOp(op, operands, start, end) for each operator.
function csTokenize(b, onOp) {
  const n = b.length; let i = 0; let ops = []; let opStart = -1; const stack = [];
  const push = (v, at) => { if (stack.length) stack[stack.length - 1].push(v); else { if (opStart < 0) opStart = at; ops.push(v); } };
  while (i < n) {
    const c = b[i];
    if (CS_WS[c]) { i++; continue; }
    const at = i;
    if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; } // % comment
    if (c === 40) { // ( literal string
      i++; let depth = 1; const out = [];
      while (i < n) {
        let ch = b[i];
        if (ch === 92) { i++; ch = b[i]; const map = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
          if (map[ch] != null) { out.push(map[ch]); i++; }
          else if (ch >= 48 && ch <= 55) { let v = 0, k = 0; while (k < 3 && b[i] >= 48 && b[i] <= 55) { v = v * 8 + (b[i] - 48); i++; k++; } out.push(v & 255); }
          else if (ch === 13 || ch === 10) { i++; if (ch === 13 && b[i] === 10) i++; }
          else { out.push(ch); i++; }
          continue; }
        if (ch === 40) depth++; else if (ch === 41) { depth--; if (!depth) { i++; break; } }
        out.push(ch); i++;
      }
      push({ str: out }, at); continue;
    }
    if (c === 60) { // < hex or <<
      if (b[i + 1] === 60) { const d = []; d.dict = true; d.at = i; i += 2; stack.push(d); continue; }
      i++; let hex = ''; while (i < n && b[i] !== 62) { if (!CS_WS[b[i]]) hex += String.fromCharCode(b[i]); i++; } i++;
      if (hex.length % 2) hex += '0'; const out = []; for (let k = 0; k < hex.length; k += 2) out.push(parseInt(hex.substr(k, 2), 16) || 0);
      push({ str: out, hex: true }, at); continue;
    }
    if (c === 62 && b[i + 1] === 62) { i += 2; const arr = stack.pop() || []; push({ dict: arr }, arr.at != null ? arr.at : at); continue; }
    if (c === 91) { const a = []; a.at = i; i++; stack.push(a); continue; }
    if (c === 93) { i++; const arr = stack.pop() || []; push(arr, arr.at != null ? arr.at : at); continue; }
    if (c === 47) { i++; let s = ''; while (i < n && !CS_WS[b[i]] && !CS_DELIM[b[i]]) { s += String.fromCharCode(b[i]); i++; } push({ name: s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) }, at); continue; }
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) { let s = ''; while (i < n && ((b[i] >= 48 && b[i] <= 57) || b[i] === 43 || b[i] === 45 || b[i] === 46)) { s += String.fromCharCode(b[i]); i++; } push(parseFloat(s) || 0, at); continue; }
    if (c === 123 || c === 125 || c === 41) { i++; continue; }
    let w = ''; while (i < n && !CS_WS[b[i]] && !CS_DELIM[b[i]]) { w += String.fromCharCode(b[i]); i++; }
    if (!w) { i++; continue; }
    if (w === 'true' || w === 'false' || w === 'null') { push(w === 'true', at); continue; }
    if (stack.length) { stack.length = 0; } // malformed: operator inside array/dict
    if (w === 'BI') { // inline image: skip to EI
      while (i < n - 1 && !(b[i] === 73 && b[i + 1] === 68 && (CS_WS[b[i - 1]] || i === at + 2) && CS_WS[b[i + 2]])) i++;
      i += 3; while (i < n - 1 && !(CS_WS[b[i - 1]] && b[i] === 69 && b[i + 1] === 73 && (i + 2 >= n || CS_WS[b[i + 2]]))) i++;
      i += 2; ops = []; opStart = -1; continue;
    }
    onOp(w, ops, opStart < 0 ? at : opStart, i);
    ops = []; opStart = -1;
  }
}

// font metrics for advancing text
function csFontInfo(fd, cache) {
  if (!fd) return { two: false, w: () => 500 };
  if (cache.has(fd)) return cache.get(fd);
  const sub = pname(fd.lookup(PDFName.of('Subtype'))); let info;
  if (sub === 'Type0') {
    const dfs = fd.lookup(PDFName.of('DescendantFonts')); const df = dfs && dfs.lookup ? dfs.lookup(0) : null; const map = new Map(); let dw = 1000;
    if (df) { const dwo = df.lookup(PDFName.of('DW')); if (dwo) dw = pnum(dwo); const W = df.lookup(PDFName.of('W'));
      if (W && W.size) { const arr = W.asArray().map((x) => df.context.lookup(x)); for (let k = 0; k < arr.length;) { const c0 = pnum(arr[k]); const nx = arr[k + 1]; if (nx && nx.asArray) { nx.asArray().forEach((v, j) => map.set(c0 + j, pnum(df.context.lookup(v)))); k += 2; } else { const c1 = pnum(nx), wv = pnum(arr[k + 2]); for (let c = c0; c <= c1 && c - c0 < 65536; c++) map.set(c, wv); k += 3; } } } }
    info = { two: true, w: (c) => (map.has(c) ? map.get(c) : dw) };
  } else {
    const fc = pnum(fd.lookup(PDFName.of('FirstChar'))); const W = fd.lookup(PDFName.of('Widths')); const ws = W && W.asArray ? W.asArray().map((x) => pnum(fd.context.lookup(x))) : null;
    const desc = fd.lookup(PDFName.of('FontDescriptor')); const miss = desc ? pnum(desc.lookup(PDFName.of('MissingWidth'))) : 0;
    let k = 1; if (sub === 'Type3') { const fm = fd.lookup(PDFName.of('FontMatrix')); if (fm) k = pnum(fd.context.lookup(fm.get(0))) * 1000; }
    const base = (pname(fd.lookup(PDFName.of('BaseFont'))) || '').toLowerCase(); const mono = base.includes('courier');
    info = { two: false, w: (c) => { if (ws && c >= fc && c - fc < ws.length) return ws[c - fc] * k; if (miss) return miss; if (mono) return 600; return c >= 32 && c <= 126 ? HELV.reg[c - 32] : 556; } };
  }
  cache.set(fd, info); return info;
}

function csStreamBytes(obj) { try { if (obj instanceof PDFLib.PDFRawStream) return PDFLib.decodePDFRawStream(obj).decode(); if (obj && obj.getContents) return obj.getContents(); } catch (e) { console.warn('stream decode failed', e); } return null; }

// Walk a page. handlers: { seg(x1,y1,x2,y2), text(run), limit }
function csWalkPage(plib, pageIndex, T, handlers) {
  const ctx = plib.context; const page = plib.getPage(pageIndex); const fontCache = new Map();
  const res0 = page.node.getInheritableAttribute ? page.node.getInheritableAttribute(PDFName.of('Resources')) : page.node.Resources();
  const resources = res0 ? ctx.lookup(res0) : null;
  let segCount = 0; const limit = handlers.limit || 400000;
  const gs0 = { ctm: T.slice(), Tc: 0, Tw: 0, Th: 1, TL: 0, font: null, Tfs: 0, Ts: 0 };
  function run(bytes, res, gs, src, depth) {
    const stack = []; let path = []; let cur = null, start = null; let Tm = [1, 0, 0, 1, 0, 0], Tlm = Tm.slice();
    const seg = (a, b) => { if (segCount >= limit) return; path.push(a[0], a[1], b[0], b[1]); };
    const P2 = (x, y) => mpt(gs.ctm, x, y);
    const bez = (p0, p1, p2, p3) => { let prev = p0; for (let k = 1; k <= 4; k++) { const t = k / 4, u = 1 - t; const q = [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; seg(prev, q); prev = q; } };
    const flush = () => { if (handlers.seg && path.length) { for (let k = 0; k < path.length && segCount < limit; k += 4) { handlers.seg(path[k], path[k + 1], path[k + 2], path[k + 3]); segCount++; } } path = []; };
    const lookupRes = (cat, name) => { if (!res) return null; const d = res.lookup(PDFName.of(cat)); if (!d || !d.get) return null; const ref = d.get(PDFName.of(name)); return ref ? { ref, obj: ctx.lookup(ref) } : null; };
    const show = (strs, opInfo) => {
      const fi = csFontInfo(gs.font, fontCache); let adv = 0;
      for (const it of strs) {
        if (typeof it === 'number') { adv += (-it / 1000) * gs.Tfs * gs.Th; continue; }
        const codes = it.str; const step = fi.two ? 2 : 1;
        for (let k = 0; k + step - 1 < codes.length; k += step) { const code = fi.two ? (codes[k] << 8) | codes[k + 1] : codes[k]; adv += ((fi.w(code) / 1000) * gs.Tfs + gs.Tc + (!fi.two && code === 32 ? gs.Tw : 0)) * gs.Th; }
      }
      if (handlers.text) {
        const M = mmul(Tm, gs.ctm); const y0 = gs.Ts - 0.22 * gs.Tfs, y1 = gs.Ts + 0.8 * gs.Tfs;
        handlers.text({ src, start: opInfo.start, end: opInfo.end, op: opInfo.op, operands: opInfo.operands, adv, Tfs: gs.Tfs, Th: gs.Th, quad: [mpt(M, 0, y1), mpt(M, adv, y1), mpt(M, adv, y0), mpt(M, 0, y0)] });
      }
      Tm = mmul([1, 0, 0, 1, adv, 0], Tm);
    };
    csTokenize(bytes, (op, a, s, e) => {
      switch (op) {
        case 'q': stack.push({ ...gs, ctm: gs.ctm.slice() }); break;
        case 'Q': if (stack.length) gs = stack.pop(); break;
        case 'cm': if (a.length >= 6) gs.ctm = mmul(a.slice(0, 6), gs.ctm); break;
        case 'm': cur = start = P2(a[0], a[1]); break;
        case 'l': { const p = P2(a[0], a[1]); if (cur) seg(cur, p); cur = p; break; }
        case 'c': { const p3 = P2(a[4], a[5]); if (cur) bez(cur, P2(a[0], a[1]), P2(a[2], a[3]), p3); cur = p3; break; }
        case 'v': { const p3 = P2(a[2], a[3]); if (cur) bez(cur, cur, P2(a[0], a[1]), p3); cur = p3; break; }
        case 'y': { const p3 = P2(a[2], a[3]); if (cur) bez(cur, P2(a[0], a[1]), p3, p3); cur = p3; break; }
        case 'h': if (cur && start) { seg(cur, start); cur = start; } break;
        case 're': { const [x, y, w, h] = a; const p0 = P2(x, y), p1 = P2(x + w, y), p2 = P2(x + w, y + h), p3 = P2(x, y + h); seg(p0, p1); seg(p1, p2); seg(p2, p3); seg(p3, p0); cur = start = p0; break; }
        case 'S': case 'f': case 'F': case 'f*': case 'B': case 'B*': flush(); break;
        case 's': case 'b': case 'b*': if (cur && start) seg(cur, start); flush(); break;
        case 'n': path = []; break;
        case 'BT': Tm = [1, 0, 0, 1, 0, 0]; Tlm = Tm.slice(); break;
        case 'Tf': { const f = lookupRes('Font', a[0] && a[0].name); gs.font = f ? f.obj : null; gs.Tfs = +a[1] || 0; break; }
        case 'Tc': gs.Tc = +a[0] || 0; break;
        case 'Tw': gs.Tw = +a[0] || 0; break;
        case 'Tz': gs.Th = (+a[0] || 100) / 100; break;
        case 'TL': gs.TL = +a[0] || 0; break;
        case 'Ts': gs.Ts = +a[0] || 0; break;
        case 'Td': Tlm = mmul([1, 0, 0, 1, +a[0] || 0, +a[1] || 0], Tlm); Tm = Tlm.slice(); break;
        case 'TD': gs.TL = -(+a[1] || 0); Tlm = mmul([1, 0, 0, 1, +a[0] || 0, +a[1] || 0], Tlm); Tm = Tlm.slice(); break;
        case 'Tm': if (a.length >= 6) { Tlm = a.slice(0, 6).map(Number); Tm = Tlm.slice(); } break;
        case 'T*': Tlm = mmul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm.slice(); break;
        case 'Tj': if (a[0] && a[0].str) show([a[0]], { start: s, end: e, op, operands: a }); break;
        case 'TJ': if (Array.isArray(a[0])) show(a[0], { start: s, end: e, op, operands: a }); break;
        case "'": Tlm = mmul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm.slice(); if (a[0] && a[0].str) show([a[0]], { start: s, end: e, op, operands: a }); break;
        case '"': gs.Tw = +a[0] || 0; gs.Tc = +a[1] || 0; Tlm = mmul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm.slice(); if (a[2] && a[2].str) show([a[2]], { start: s, end: e, op, operands: a }); break;
        case 'Do': {
          if (depth > 8) break; const x = lookupRes('XObject', a[0] && a[0].name); if (!x || !x.obj || !x.obj.dict) break;
          if (pname(x.obj.dict.lookup(PDFName.of('Subtype'))) !== 'Form') break;
          const mo = x.obj.dict.lookup(PDFName.of('Matrix')); const M = mo && mo.asArray ? mo.asArray().map((v) => pnum(ctx.lookup(v))) : [1, 0, 0, 1, 0, 0];
          const fres = x.obj.dict.lookup(PDFName.of('Resources')) || res; const fb = csStreamBytes(x.obj); if (!fb) break;
          const sub = { ...gs, ctm: mmul(M, gs.ctm) }; run(fb, fres, sub, { kind: 'xobj', ref: x.ref }, depth + 1); break;
        }
      }
    });
    return gs;
  }
  const contents = page.node.Contents(); const list = [];
  if (contents instanceof PDFArray) for (let k = 0; k < contents.size(); k++) list.push({ ref: contents.get(k), obj: contents.lookup(k) });
  else if (contents) list.push({ ref: page.node.get(PDFName.of('Contents')), obj: contents });
  let gs = gs0;
  list.forEach((c, idx) => { const bytes = csStreamBytes(c.obj); if (bytes) gs = run(bytes, resources, gs, { kind: 'page', idx, ref: c.ref }, 0); });
  return { streams: list, segCount };
}

// ----- geometry cache & snapping ----------------------------------------------------
async function getPlib(doc) {
  if (doc._plib !== undefined) return doc._plib;
  if (!doc._plibP) doc._plibP = docBytes(doc).then((b) => PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false })).then((d) => (d.isEncrypted ? null : d)).catch(() => null);
  doc._plib = await doc._plibP; return doc._plib;
}
const GEO_CELL = 24;
async function buildGeometry(doc, i) {
  doc.geo = doc.geo || {}; if (doc.geo[i]) return doc.geo[i];
  const g = (doc.geo[i] = { pending: true, n: 0 });
  // big files: read just this page's content instead of parsing the whole PDF
  const plib = doc.src.kind === 'mem' ? await getPlib(doc) : doc.viewReader ? await doc.viewReader.partialDoc(i).catch((e) => { console.warn(e); return null; }) : null;
  if (!plib || !doc.pages[i]) { g.pending = false; return g; }
  const segs = []; const t0 = performance.now();
  try { csWalkPage(plib, i, doc.pages[i].T, { seg: (a, b, c, d) => { if (Math.abs(a - c) + Math.abs(b - d) > 0.05) segs.push(a, b, c, d); } }); } catch (e) { console.warn('geometry parse failed', e); }
  const arr = new Float32Array(segs); const grid = new Map(); const n = arr.length / 4;
  for (let k = 0; k < n; k++) {
    const x1 = Math.min(arr[k * 4], arr[k * 4 + 2]), x2 = Math.max(arr[k * 4], arr[k * 4 + 2]), y1 = Math.min(arr[k * 4 + 1], arr[k * 4 + 3]), y2 = Math.max(arr[k * 4 + 1], arr[k * 4 + 3]);
    const cx1 = Math.floor(x1 / GEO_CELL), cx2 = Math.floor(x2 / GEO_CELL), cy1 = Math.floor(y1 / GEO_CELL), cy2 = Math.floor(y2 / GEO_CELL);
    if ((cx2 - cx1 + 1) * (cy2 - cy1 + 1) > 4000) continue; // skip giant diagonal spans of hatching borders
    for (let cx = cx1; cx <= cx2; cx++) for (let cy = cy1; cy <= cy2; cy++) { const key = cx * 100003 + cy; let l = grid.get(key); if (!l) grid.set(key, (l = [])); l.push(k); }
  }
  Object.assign(g, { pending: false, segs: arr, n, grid, ms: Math.round(performance.now() - t0) });
  if (doc.src.kind !== 'mem' && doc.viewReader) doc.viewReader.evictBig();
  return g;
}
function prefetchGeometry() { const d = activeDoc(); if (!d || !d.pdf || !state.snapContent) return; visiblePages(d, 0.3).forEach((i) => { if (!d.geo || !d.geo[i]) buildGeometry(d, i); }); }
function contentSnap(doc, page, p, tol) {
  const g = doc.geo && doc.geo[page]; if (!g) { buildGeometry(doc, page); return null; } if (g.pending || !g.n) return null;
  const S = g.segs; const cand = new Set(); const cx1 = Math.floor((p[0] - tol) / GEO_CELL), cx2 = Math.floor((p[0] + tol) / GEO_CELL), cy1 = Math.floor((p[1] - tol) / GEO_CELL), cy2 = Math.floor((p[1] + tol) / GEO_CELL);
  for (let cx = cx1; cx <= cx2; cx++) for (let cy = cy1; cy <= cy2; cy++) { const l = g.grid.get(cx * 100003 + cy); if (l) for (const k of l) cand.add(k); }
  if (!cand.size) return null;
  let best = null, bd = tol; const take = (x, y, kind, w) => { const d = Math.hypot(x - p[0], y - p[1]) * w; if (d < bd) { bd = d; best = { p: [x, y], kind, d }; } };
  const near = [];
  for (const k of cand) {
    const ax = S[k * 4], ay = S[k * 4 + 1], bx = S[k * 4 + 2], by = S[k * 4 + 3];
    take(ax, ay, 'end', 1); take(bx, by, 'end', 1); take((ax + bx) / 2, (ay + by) / 2, 'mid', 1.3);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; if (!l2) continue; const t = clamp(((p[0] - ax) * dx + (p[1] - ay) * dy) / l2, 0, 1); const qx = ax + t * dx, qy = ay + t * dy;
    if (Math.hypot(qx - p[0], qy - p[1]) < tol) near.push(k);
    take(qx, qy, 'on', 2.2);
  }
  // intersections of lines passing near the cursor
  if (near.length > 1 && near.length < 80) {
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const a = near[i] * 4, b = near[j] * 4; const x1 = S[a], y1 = S[a + 1], x2 = S[a + 2], y2 = S[a + 3], x3 = S[b], y3 = S[b + 1], x4 = S[b + 2], y4 = S[b + 3];
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (Math.abs(den) < 1e-9) continue;
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den, u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
      if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) continue; take(x1 + t * (x2 - x1), y1 + t * (y2 - y1), 'int', 1.05);
    }
  }
  return best;
}
function gridStep(doc, page) { return state.gridSize > 0 ? state.gridSize * 72 : 0; }
