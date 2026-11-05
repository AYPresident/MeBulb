// ===== Rich text: runs, layout and the in-place editor ==========================
// Text boxes and callouts keep their words in m.text (plain, used for search, the
// markups list and PDF /Contents) and, once part of the text is formatted
// differently, in m.runs = [{ t, b, i, u, s, sup, sub, f, z, c }]. Every key but t
// overrides the markup's style: b bold, i italic, u underline, s strikethrough,
// sup/sub super- and subscript, f font family, z size (pt), c colour.
const RT_KEYS = ['b', 'i', 'u', 's', 'sup', 'sub', 'f', 'z', 'c'];
const RT_STYLE = { b: 'bold', i: 'italic', u: 'underline', s: 'strike', f: 'font', z: 'fontSize', c: 'fontColor' };
const ZW = '​';
const SUPK = 0.62; // super/subscript size factor
function rtDefaults(s) { return { b: !!s.bold, i: !!s.italic, u: !!s.underline, s: !!s.strike, sup: false, sub: false, f: famOf(s.font), z: s.fontSize || 12, c: (s.fontColor || s.stroke || '#000000').toLowerCase() }; }
function runsOf(m) { return m.runs && m.runs.length ? m.runs : [{ t: m.text || '' }]; }
function runsText(runs) { return runs.map((r) => r.t).join(''); }
function rtEff(a, D) { const o = { ...D }; for (const k of RT_KEYS) if (a[k] !== undefined) o[k] = a[k]; return o; }
function rtSize(e) { return e.sup || e.sub ? e.z * SUPK : e.z; }
function runsToChars(runs) {
  const out = [];
  runs.forEach((r) => { const a = {}; RT_KEYS.forEach((k) => { if (r[k] !== undefined && r[k] !== null) a[k] = r[k]; }); const t = String(r.t || ''); for (let i = 0; i < t.length; i++) out.push({ ch: t[i], a }); });
  return out;
}
function charsToRuns(chars, D) {
  const out = []; let cur = null;
  for (const { ch, a } of chars) {
    const o = {}; RT_KEYS.forEach((k) => { const v = a[k]; if (v === undefined || v === null) return; if (k === 'c' ? String(v).toLowerCase() === D.c : v === D[k]) return; o[k] = k === 'c' ? String(v).toLowerCase() : v; });
    if (cur && RT_KEYS.every((k) => cur[k] === o[k])) cur.t += ch; else { cur = { t: ch, ...o }; out.push(cur); }
  }
  return out;
}
function setRuns(m, runs) {
  const D = rtDefaults(m.style); const rs = charsToRuns(runsToChars(runs), D);
  m.text = runsText(rs); m.runs = rs.some((r) => RT_KEYS.some((k) => r[k] !== undefined)) ? rs : null;
}
function rtTrimEnd(m) { const chars = runsToChars(runsOf(m)); while (chars.length && /\s/.test(chars[chars.length - 1].ch)) chars.pop(); setRuns(m, charsToRuns(chars, {})); }
// remove one formatting key from every run (when the whole markup gets that property)
function rtStrip(m, key) { if (!m.runs) return; setRuns(m, m.runs.map((r) => { const o = { ...r }; delete o[key]; return o; })); }

// ----- layout -----------------------------------------------------------------------
// Returns lines of positioned pieces; widths use the PDF font metrics.
function layoutRich(runs, s, maxW) {
  const D = rtDefaults(s); const chars = runsToChars(runs); const paras = [[]]; const ls = +s.letterSp || 0; // character spacing (pt) after every character
  let lastA = {};
  chars.forEach((c) => { if (c.ch === '\n') { paras.push([]); lastA = c.a; } else if (c.ch !== ZW) paras[paras.length - 1].push(c); });
  const lines = [];
  for (const p of paras) {
    const cs = p.map((c) => { const e = rtEff(c.a, D); return { ch: c.ch, e, w: (charWidth(c.ch.charCodeAt(0), e.f, e.b, e.i) * rtSize(e)) / 1000 + ls }; });
    if (!cs.length) { lines.push({ cs: [], z: rtEff(lastA, D).z }); continue; }
    let start = 0;
    while (start < cs.length) {
      let w = 0, k = start, brk = -1;
      for (; k < cs.length; k++) { const c = cs[k]; if (c.ch === ' ') { brk = k + 1; w += c.w; continue; } if (w + c.w > maxW && k > start) break; w += c.w; }
      const end = k < cs.length && brk > start ? brk : k;
      lines.push({ cs: cs.slice(start, end) }); start = end;
    }
  }
  let top = 0, width = 0;
  const out = lines.map((ln) => {
    const z = ln.cs.length ? Math.max(...ln.cs.map((c) => c.e.z)) : ln.z; const pieces = []; let x = 0;
    for (const c of ln.cs) {
      const last = pieces[pieces.length - 1]; const key = RT_KEYS.map((k) => c.e[k]).join('|');
      if (last && last.key === key) { last.str += c.ch; last.w += c.w; } else pieces.push({ key, str: c.ch, x, w: c.w, e: c.e });
      x += c.w;
    }
    let w = x; for (let k = ln.cs.length - 1; k >= 0 && ln.cs[k].ch === ' '; k--) w -= ln.cs[k].w;
    pieces.forEach((pc) => { pc.wt = Math.max(0, Math.min(pc.w, w - pc.x)); });
    const f = s.lineH || 1.2; const h = z * f; const L = { pieces, w, z, top, base: top + z * (f - 0.38), h }; top += h; width = Math.max(width, w); return L;
  });
  return { lines: out, height: top, width };
}
// display-list primitives for laid-out rich text inside box L
function richPrims(L, s, out) {
  const free = Math.max(0, L.h - 2 * L.pad - L.lay.height); const vo = s.valign === 'middle' ? free / 2 : s.valign === 'bottom' ? free : 0;
  L.lay.lines.forEach((ln) => {
    let x0 = L.x + L.pad; if (s.align === 'center') x0 = L.x + (L.w - ln.w) / 2; else if (s.align === 'right') x0 = L.x + L.w - L.pad - ln.w;
    const yb = L.y + L.pad + vo + ln.base;
    ln.pieces.forEach((pc) => {
      const e = pc.e; const sz = rtSize(e); const y = yb + (e.sup ? -e.z * 0.36 : e.sub ? e.z * 0.16 : 0); const x = x0 + pc.x;
      if (pc.str.trim()) out.push({ k: 'text', x, y, size: sz, str: pc.str, color: e.c, bold: e.b, italic: e.i, font: e.f, anchor: 'start', opacity: s.opacity, ls: +s.letterSp || 0 });
      const th = Math.max(0.35, sz * 0.065); const len = pc.wt;
      if (len > 0 && e.u) out.push({ k: 'path', d: P.poly([[x, y + sz * 0.15], [x + len, y + sz * 0.15]]), stroke: e.c, width: th, opacity: s.opacity, fill: 'none', cap: 'butt' });
      if (len > 0 && e.s) out.push({ k: 'path', d: P.poly([[x, y - sz * 0.27], [x + len, y - sz * 0.27]]), stroke: e.c, width: th, opacity: s.opacity, fill: 'none', cap: 'butt' });
    });
  });
}

// ----- rich text as XHTML for the PDF /RC entry (so other PDF apps keep the formatting)
function cssColor(c) { return String(c || '#000000').toUpperCase(); }
function rtXhtml(m) {
  const D = rtDefaults(m.style); const runs = runsOf(m); const fam0 = { helv: 'Helvetica', times: 'Times', courier: 'Courier' }; const pdfFam = new Proxy({}, { get: (_, f) => fam0[f] || (String(f).startsWith('sys:') ? String(f).slice(4) : 'Helvetica') });
  const spanStyle = (e) => [`font-family:${pdfFam[e.f]}`, `font-size:${num(rtSize(e), 2)}pt`, `color:${cssColor(e.c)}`, `font-weight:${e.b ? 'bold' : 'normal'}`, `font-style:${e.i ? 'italic' : 'normal'}`, (e.u || e.s) ? `text-decoration:${[e.u ? 'underline' : '', e.s ? 'line-through' : ''].filter(Boolean).join(' ')}` : '', e.sup ? 'vertical-align:super' : e.sub ? 'vertical-align:sub' : ''].filter(Boolean).join(';');
  const paras = [[]]; runsToChars(runs).forEach((c) => { if (c.ch === '\n') paras.push([]); else if (c.ch !== ZW) paras[paras.length - 1].push(c); });
  const body = paras.map((p) => { const rs = charsToRuns(p, {}); return `<p dir="ltr">${rs.map((r) => `<span style="${spanStyle(rtEff(r, D))}">${esc(r.t)}</span>`).join('')}</p>`; }).join('');
  return `<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:APIVersion="Acrobat:11.0.0" xfa:spec="2.0.2" style="font-size:${num(D.z, 2)}pt;text-align:${m.style.align || 'left'};color:${cssColor(D.c)};font-family:${pdfFam[D.f]};line-height:${num(D.z * (m.style.lineH || 1.2), 3)}pt${m.style.letterSp ? `;letter-spacing:${num(m.style.letterSp, 3)}pt` : ''}">${body}</body>`;
}

// ----- editor -------------------------------------------------------------------------
// The editor is a contentEditable box styled like the markup. What it shows is what is
// read back: formatting comes from computed styles, so browser-made spans work too.
function rtCss(e, zoom, root) {
  const st = [];
  if (!root) st.push(`font-family:${FONT_FAMILIES[e.f].css}`, `font-weight:${e.b ? 700 : 400}`, `font-style:${e.i ? 'italic' : 'normal'}`, `color:${e.c}`, `font-size:${num(rtSize(e) * zoom, 3)}px`);
  const deco = [e.u ? 'underline' : '', e.s ? 'line-through' : ''].filter(Boolean).join(' ');
  if (!root) st.push(`text-decoration:${deco || 'none'}`, `vertical-align:${e.sup ? 'super' : e.sub ? 'sub' : 'baseline'}`);
  return st.join(';');
}
function rtRenderEditor(el, m) {
  const z = viewerZoom(); const D = rtDefaults(m.style); el.dataset.z = z;
  Object.assign(el.style, { fontFamily: FONT_FAMILIES[D.f].css, fontWeight: D.b ? '700' : '400', fontStyle: D.i ? 'italic' : 'normal', color: D.c, fontSize: D.z * z + 'px', lineHeight: String(m.style.lineH || 1.2), letterSpacing: (+m.style.letterSp || 0) * z + 'px' });
  const paras = [[]]; runsToChars(runsOf(m)).forEach((c) => { if (c.ch === '\n') paras.push([]); else paras[paras.length - 1].push(c); });
  el.innerHTML = paras.map((p) => { const rs = charsToRuns(p, {}); const inner = rs.map((r) => `<span style="${esc(rtCss(rtEff(r, D), z))}">${esc(r.t)}</span>`).join(''); return `<div>${inner || '<br>'}</div>`; }).join('');
}
// walk the editor DOM like innerText: blocks and <br> make newlines
function rtScan(root, bounds) {
  const chars = [], pos = []; const res = { chars, pos, at: {} }; let started = false, pending = false; let lastEnd = [root, 0];
  const isBlock = (n) => n === root || (n.nodeType === 1 && /^(DIV|P|LI|H\d)$/.test(n.tagName));
  const blockOf = (n) => { let b = n.parentNode; while (b && !isBlock(b)) b = b.parentNode; return b || root; };
  const hasContent = (n) => (n.nodeType === 3 ? n.data.replace(/​/g, '').length > 0 : n.nodeType === 1 && (n.tagName === 'BR' || [...n.childNodes].some(hasContent)));
  const lastInBlock = (br) => { const blk = blockOf(br); let n = br; while (n && n !== blk) { for (let s = n.nextSibling; s; s = s.nextSibling) if (hasContent(s)) return false; n = n.parentNode; } return true; };
  const flush = () => { if (pending && started) { pos.push(lastEnd); chars.push({ ch: '\n', el: null }); } pending = false; started = true; };
  const rec = (key, extra = 0) => { if (bounds && res.at[key] === undefined) res.at[key] = chars.length + extra; };
  const check = (node, off) => { if (!bounds) return; for (const [key, [bn, bo]] of Object.entries(bounds)) if (bn === node && bo === off) rec(key, pending && started && node.nodeType === 1 ? 1 : 0); };
  function visit(node) {
    if (node.nodeType === 3) {
      const t = node.data; if (t.length) flush();
      for (let i = 0; i < t.length; i++) { check(node, i); if (t[i] === ZW) continue; pos.push([node, i]); chars.push({ ch: t[i], el: node.parentNode }); lastEnd = [node, i + 1]; }
      check(node, t.length); return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName === 'BR') {
      const blk = blockOf(node); const blkText = [...blk.childNodes].some((c) => c !== node && hasContent(c) && !(c.nodeType === 1 && c.tagName === 'BR'));
      if (lastInBlock(node)) { if (!blkText) { flush(); lastEnd = [blk, 0]; } return; }
      flush(); pos.push(lastEnd); chars.push({ ch: '\n', el: null }); lastEnd = [node.parentNode, [...node.parentNode.childNodes].indexOf(node) + 1]; return;
    }
    const blk = isBlock(node) && node !== root; if (blk && started) pending = true;
    const kids = [...node.childNodes];
    kids.forEach((c, i) => { check(node, i); visit(c); });
    check(node, kids.length);
    if (blk && started) pending = true;
  }
  visit(root); res.end = lastEnd;
  return res;
}
function rgbHex(c) { const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (!m) return '#000000'; return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join(''); }
function rtAttrsOf(el, root, zoom, cache) {
  if (!el || el === root.parentNode) el = root; if (cache.has(el)) return cache.get(el);
  const cs = getComputedStyle(el); const b = (parseInt(cs.fontWeight, 10) || 400) >= 600; const i = /italic|oblique/.test(cs.fontStyle);
  let u = false, s = false, sup = false, sub = false;
  for (let n = el; n; n = n.parentElement) {
    const c = n === el ? cs : getComputedStyle(n); const dl = c.textDecorationLine || c.textDecoration || '';
    if (/underline/.test(dl) || n.tagName === 'U') u = true; if (/line-through/.test(dl) || /^(S|STRIKE|DEL)$/.test(n.tagName)) s = true;
    if (c.verticalAlign === 'super' || n.tagName === 'SUP') sup = true; if (c.verticalAlign === 'sub' || n.tagName === 'SUB') sub = true;
    if (n === root) break;
  }
  const first = cs.fontFamily.split(',')[0].toLowerCase(); const f = /courier|mono/.test(first) ? 'courier' : /times|georgia|serif/.test(first) && !/sans/.test(first) ? 'times' : 'helv';
  let px = parseFloat(cs.fontSize) || 12; if (sup || sub) px /= SUPK; const z = Math.round((px / zoom) * 4) / 4;
  const a = { b, i, u, s, sup, sub: sub && !sup, f, z, c: rgbHex(cs.color) }; cache.set(el, a); return a;
}
function rtReadEditor(el, m) {
  const z = parseFloat(el.dataset.z) || viewerZoom(); const sc = rtScan(el); const cache = new Map(); const D = rtDefaults(m.style);
  const chars = sc.chars.map((c) => ({ ch: c.ch, a: c.el ? rtAttrsOf(c.el, el, z, cache) : {} }));
  // a newline takes the formatting of the character before it
  for (let k = 0; k < chars.length; k++) if (chars[k].ch === '\n') chars[k].a = k ? chars[k - 1].a : {};
  const rs = charsToRuns(chars, D); m.text = runsText(rs); m.runs = rs.some((r) => RT_KEYS.some((k) => r[k] !== undefined)) ? rs : null;
}
function rtGetSel(el) {
  const s = window.getSelection(); if (!s || !s.rangeCount) return null; const r = s.getRangeAt(0);
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const res = rtScan(el, { a: [r.startContainer, r.startOffset], b: [r.endContainer, r.endOffset] });
  const a = res.at.a != null ? res.at.a : res.chars.length, b = res.at.b != null ? res.at.b : res.chars.length; return { a: Math.min(a, b), b: Math.max(a, b) };
}
function rtSetSel(el, a, b = a) {
  const res = rtScan(el); const at = (k) => (k < res.pos.length ? res.pos[k] : res.end);
  const r = document.createRange(); const [sn, so] = at(a), [en, eo] = at(b);
  try { r.setStart(sn, so); r.setEnd(en, eo); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* ignore */ }
}
// apply a formatting key to characters [a, b) of a markup. val 'toggle' flips booleans.
function rtApply(m, a, b, key, val) {
  const D = rtDefaults(m.style); const chars = runsToChars(runsOf(m)); const idx = [];
  for (let k = a; k < b && k < chars.length; k++) if (chars[k].ch !== '\n') idx.push(k);
  if (!idx.length) return false;
  let v = val; if (val === 'toggle') v = !idx.every((k) => rtEff(chars[k].a, D)[key]);
  idx.forEach((k) => { const o = { ...chars[k].a, [key]: v }; if (key === 'sup' && v) o.sub = false; if (key === 'sub' && v) o.sup = false; chars[k].a = o; });
  setRuns(m, charsToRuns(chars, D)); return true;
}
// effective attributes at a character position (for toolbar state)
function rtAttrsAt(m, k) { const D = rtDefaults(m.style); const chars = runsToChars(runsOf(m)).filter((c) => c.ch !== ZW); if (!chars.length) return D; const c = chars[clamp(k, 0, chars.length - 1)]; return rtEff(c.a, D); }
// does every character of the markup have this property?
function rtAll(m, key) { const D = rtDefaults(m.style); const cs = runsToChars(runsOf(m)).filter((c) => c.ch !== '\n'); return cs.length ? cs.every((c) => rtEff(c.a, D)[key]) : !!D[key]; }

// format the selection in the open editor (or the word at the caret, or what is typed next)
function rtFormat(key, val) {
  const ed = state.editing; const m = ed && getMarkup(ed.id); if (!m) return false; const el = ed.ta;
  rtReadEditor(el, m); let sel = rtGetSel(el) || ed.sel || { a: m.text.length, b: m.text.length };
  if (sel.a === sel.b) {
    const t = m.text; let a = sel.a, b = sel.a; while (a > 0 && /\w/.test(t[a - 1])) a--; while (b < t.length && /\w/.test(t[b])) b++;
    if (a < sel.a && b > sel.a) { rtApply(m, a, b, key, val); rtRenderEditor(el, m); rtSetSel(el, sel.a); }
    else { // nothing to format yet: the next characters typed get the format
      const D = rtDefaults(m.style); const chars = runsToChars(runsOf(m)); const base = sel.a > 0 && chars[sel.a - 1] && chars[sel.a - 1].ch !== '\n' ? chars[sel.a - 1].a : sel.a < chars.length ? chars[sel.a].a : {};
      const cur = rtEff(base, D); const o = { ...base, [key]: val === 'toggle' ? !cur[key] : val }; if (key === 'sup' && o.sup) o.sub = false; if (key === 'sub' && o.sub) o.sup = false;
      chars.splice(sel.a, 0, { ch: ZW, a: o }); const rs = charsToRuns(chars, D); m.runs = rs; m.text = runsText(rs); rtRenderEditor(el, m);
      const zw = [...el.querySelectorAll('span')].find((s) => s.textContent.includes(ZW)); if (zw) { const tn = zw.firstChild; const off = tn.data.indexOf(ZW) + 1; const r = document.createRange(); r.setStart(tn, off); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      rtReadEditor(el, m);
    }
  } else { rtApply(m, sel.a, sel.b, key, val); rtRenderEditor(el, m); rtSetSel(el, sel.a, sel.b); }
  ed.sel = rtGetSel(el) || sel; el.focus({ preventScroll: true }); positionEditor(); renderMarkupEl(m); renderPropbar(); return true;
}
// formatting for whole markups (selected, not being edited)
function rtFormatWhole(ms, key, val) {
  const doc = activeDoc(); if (!ms.length) return; pushUndo(doc); ms = withLinkedSketches(doc, ms);
  const textMs = ms.filter((m) => TEXT_TYPES.has(m.type));
  let v = val; if (val === 'toggle') v = !(textMs.length ? textMs.every((m) => rtAll(m, key)) : ms.every((m) => (RT_STYLE[key] ? !!m.style[RT_STYLE[key]] : false)));
  ms.forEach((m) => {
    if (RT_STYLE[key]) { m.style = { ...m.style, [RT_STYLE[key]]: v }; if (TEXT_TYPES.has(m.type)) rtStrip(m, key); }
    else if (TEXT_TYPES.has(m.type)) { rtApply(m, 0, (m.text || '').length, key, v); }
    if (TEXT_TYPES.has(m.type)) fitTextBox(m); touch(m);
  });
  new Set(ms.map((m) => m.page)).forEach((p) => renderMarks(doc, p)); renderList();
}
