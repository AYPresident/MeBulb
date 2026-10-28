// ===== Fonts installed on this PC ======================================================
// Helvetica, Times and Courier are the PDF standard fonts (every viewer has them, nothing
// is embedded). Any other font comes from the PC: the desktop app lists the Windows font
// folders, Chrome/Edge can list them through the Local Font Access permission. The glyphs a
// document uses are embedded in the saved PDF as a subset, so it prints the same anywhere.
const FONTS = { list: [], families: new Map(), faces: new Map(), loaded: false, asked: false, warned: new Set(), uid: 0 };

// ----- reading TrueType / OpenType files -----------------------------------------------------
function sfntTables(dv, off) {
  const n = dv.getUint16(off + 4); const t = {};
  for (let i = 0; i < n; i++) { const r = off + 12 + i * 16; const tag = String.fromCharCode(dv.getUint8(r), dv.getUint8(r + 1), dv.getUint8(r + 2), dv.getUint8(r + 3)); t[tag] = { off: dv.getUint32(r + 8), len: dv.getUint32(r + 12) }; }
  return t;
}
function sfntDirOffset(dv, index = 0) { const tag = dv.getUint32(0); if (tag === 0x74746366) { const n = dv.getUint32(8); return dv.getUint32(12 + 4 * Math.min(index, n - 1)); } return 0; }
function sfntNames(dv, t) {
  const out = {}; if (!t.name) return out; const o = t.name.off; const count = dv.getUint16(o + 2); const so = o + dv.getUint16(o + 4);
  const rank = (p, e, l) => (p === 3 && (e === 1 || e === 10) ? (l === 0x409 ? 0 : 1) : p === 0 ? 2 : p === 1 && e === 0 ? 3 : 9);
  const best = {};
  for (let i = 0; i < count; i++) {
    const r = o + 6 + i * 12; const p = dv.getUint16(r), e = dv.getUint16(r + 2), l = dv.getUint16(r + 4), id = dv.getUint16(r + 6), len = dv.getUint16(r + 8), off = dv.getUint16(r + 10);
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue; const k = rank(p, e, l); if (k >= 9 || (best[id] != null && best[id] <= k)) continue;
    let s = ''; if (p === 3 || p === 0) for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(dv.getUint16(so + off + j)); else for (let j = 0; j < len; j++) s += String.fromCharCode(dv.getUint8(so + off + j));
    best[id] = k; out[id] = s;
  }
  return out;
}
function parseFace(bytes, index = 0) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const dir = sfntDirOffset(dv, index); const t = sfntTables(dv, dir);
  if (!t.head || !t.hhea || !t.hmtx || !t.maxp || !t.cmap) throw new Error('not a usable font');
  const u16 = (o) => dv.getUint16(o), i16 = (o) => dv.getInt16(o);
  const h = t.head.off; const upem = u16(h + 18); const bbox = [i16(h + 36), i16(h + 38), i16(h + 40), i16(h + 42)]; const locFmt = i16(h + 50); const macStyle = u16(h + 44);
  const numH = u16(t.hhea.off + 34); const asc = i16(t.hhea.off + 4), desc = i16(t.hhea.off + 6); const numGlyphs = u16(t.maxp.off + 4);
  const adv = new Uint16Array(numGlyphs); for (let g = 0; g < numGlyphs; g++) adv[g] = u16(t.hmtx.off + 4 * Math.min(g, numH - 1));
  let fsType = 0, weight = macStyle & 1 ? 700 : 400, fsSel = 0, capH = 0, typoAsc = asc, typoDesc = desc;
  if (t['OS/2']) { const o = t['OS/2'].off; const v = u16(o); weight = u16(o + 4); fsType = u16(o + 8); fsSel = u16(o + 62); typoAsc = i16(o + 68); typoDesc = i16(o + 70); if (v >= 2 && t['OS/2'].len >= 90) capH = i16(o + 88); }
  let italicAngle = 0, fixed = false; if (t.post) { italicAngle = dv.getInt32(t.post.off + 4) / 65536; fixed = dv.getUint32(t.post.off + 12) !== 0; }
  const names = sfntNames(dv, t);
  // cmap: Windows Unicode full (format 12) or BMP (format 4)
  const c = t.cmap.off; const nsub = u16(c + 2); let pick = null, score = 99;
  for (let i = 0; i < nsub; i++) { const p = u16(c + 4 + i * 8), e = u16(c + 6 + i * 8); const off = c + dv.getUint32(c + 8 + i * 8); const fmt = u16(off); const s = fmt === 12 && (p === 3 || p === 0) ? 0 : fmt === 4 && p === 3 && e === 1 ? 1 : fmt === 4 && p === 0 ? 2 : fmt === 4 && p === 3 && e === 0 ? 3 : 99; if (s < score) { score = s; pick = off; } }
  if (pick == null) throw new Error('no Unicode character map');
  const cache = new Map(); let glyph;
  if (u16(pick) === 12) {
    const n = dv.getUint32(pick + 12); glyph = (cp) => { let lo = 0, hi = n - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; const r = pick + 16 + mid * 12; const a = dv.getUint32(r), b = dv.getUint32(r + 4); if (cp < a) hi = mid - 1; else if (cp > b) lo = mid + 1; else return dv.getUint32(r + 8) + cp - a; } return 0; };
  } else {
    const segX2 = u16(pick + 6); const ends = pick + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    glyph = (cp) => {
      if (cp > 0xffff) return 0; let lo = 0, hi = segX2 / 2 - 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; const end = u16(ends + mid * 2); const start = u16(starts + mid * 2); if (cp > end) lo = mid + 1; else if (cp < start) hi = mid - 1; else {
        const d = i16(deltas + mid * 2); const ro = u16(ranges + mid * 2); if (!ro) return (cp + d) & 0xffff; const ga = ranges + mid * 2 + ro + (cp - start) * 2; const g = u16(ga); return g ? (g + d) & 0xffff : 0; } }
      return 0;
    };
  }
  const gid = (cp) => { let g = cache.get(cp); if (g === undefined) { g = glyph(cp); if (g >= numGlyphs) g = 0; cache.set(cp, g); } return g; };
  return {
    bytes, dir, t, upem, bbox, asc: typoAsc || asc, desc: typoDesc || desc, capH: capH || Math.round(typoAsc * 0.7), italicAngle, fixed, weight, fsType, fsSel, adv, numGlyphs, locFmt, gid,
    family: names[1] || names[16] || 'Font', sub: names[2] || 'Regular', ps: (names[6] || names[4] || names[1] || 'Font').replace(/[^A-Za-z0-9-]/g, ''),
    isTT: !!(t.glyf && t.loca), isCFF: !!t['CFF '],
    width(cp) { return (this.adv[this.gid(cp)] * 1000) / this.upem; },
  };
}
// TrueType subset: same glyph numbers, outlines kept only for the glyphs used (plus composite parts)
function subsetTrueType(F, gids) {
  const dv = new DataView(F.bytes.buffer, F.bytes.byteOffset, F.bytes.byteLength); const t = F.t;
  const loca = (g) => (F.locFmt ? dv.getUint32(t.loca.off + g * 4) : dv.getUint16(t.loca.off + g * 2) * 2);
  const keep = new Set([0, ...gids]); const queue = [...keep];
  while (queue.length) {
    const g = queue.pop(); if (g >= F.numGlyphs) continue; const a = loca(g), b = loca(g + 1); if (b <= a) continue; const o = t.glyf.off + a;
    if (dv.getInt16(o) >= 0) continue; let p = o + 10;
    for (;;) { const flags = dv.getUint16(p); const cg = dv.getUint16(p + 2); if (!keep.has(cg)) { keep.add(cg); queue.push(cg); } p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0); if (!(flags & 0x20)) break; }
  }
  const parts = []; const offs = new Uint32Array(F.numGlyphs + 1); let pos = 0;
  for (let g = 0; g < F.numGlyphs; g++) { offs[g] = pos; if (keep.has(g)) { const a = loca(g), b = loca(g + 1); if (b > a) { const len = b - a; const pad = (4 - (len % 4)) % 4; parts.push(F.bytes.subarray(t.glyf.off + a, t.glyf.off + b)); if (pad) parts.push(new Uint8Array(pad)); pos += len + pad; } } }
  offs[F.numGlyphs] = pos;
  const glyf = concatBytes(parts); const locaB = new Uint8Array((F.numGlyphs + 1) * 4); const ldv = new DataView(locaB.buffer); offs.forEach((v, k) => ldv.setUint32(k * 4, v));
  const tbl = (tag) => (t[tag] ? F.bytes.slice(t[tag].off, t[tag].off + t[tag].len) : null);
  const head = tbl('head'); new DataView(head.buffer).setInt16(50, 1); new DataView(head.buffer).setUint32(8, 0);
  const tables = { head, hhea: tbl('hhea'), maxp: tbl('maxp'), hmtx: tbl('hmtx'), loca: locaB, glyf, 'cvt ': tbl('cvt '), fpgm: tbl('fpgm'), prep: tbl('prep'), 'OS/2': tbl('OS/2') };
  return buildSfnt(tables);
}
function buildSfnt(tables) {
  const tags = Object.keys(tables).filter((k) => tables[k]).sort(); const n = tags.length; let es = 0; while (1 << (es + 1) <= n) es++; const sr = (1 << es) * 16;
  const headLen = 12 + 16 * n; let size = headLen; tags.forEach((k) => { size += (tables[k].length + 3) & ~3; });
  const out = new Uint8Array(size); const dv = new DataView(out.buffer); dv.setUint32(0, 0x00010000); dv.setUint16(4, n); dv.setUint16(6, sr); dv.setUint16(8, es); dv.setUint16(10, n * 16 - sr);
  const sum = (b) => { let s = 0; const L = (b.length + 3) & ~3; const p = new Uint8Array(L); p.set(b); const d = new DataView(p.buffer); for (let i = 0; i < L; i += 4) s = (s + d.getUint32(i)) >>> 0; return s; };
  let pos = headLen; let headAt = 0;
  tags.forEach((k, i) => { const b = tables[k]; const r = 12 + i * 16; for (let j = 0; j < 4; j++) out[r + j] = k.charCodeAt(j); dv.setUint32(r + 4, sum(b)); dv.setUint32(r + 8, pos); dv.setUint32(r + 12, b.length); out.set(b, pos); if (k === 'head') headAt = pos; pos += (b.length + 3) & ~3; });
  if (headAt) dv.setUint32(headAt + 8, (0xb1b0afba - sum(out)) >>> 0);
  return out;
}

// ----- the font list -------------------------------------------------------------------------------
const STYLE_SLOT = (bold, italic) => (bold ? 1 : 0) + (italic ? 2 : 0);
function classify(sub, weight) { const s = String(sub || '').toLowerCase(); const italic = /italic|oblique/.test(s); const bold = weight >= 600 || /\bbold\b|black|heavy/.test(s); const plain = /^(regular|normal|roman|book|bold|italic|oblique|bold italic|bold oblique)$/.test(s.trim()); return { bold, italic, plain }; }
// add faces to the family table: [{ family, sub, weight, src }] where src loads the bytes
function addFaces(list) {
  for (const f of list) {
    const c = classify(f.sub, f.weight || 400); let fam = f.family;
    if (!c.plain && f.familyIsTypographic) fam = `${f.family} ${String(f.sub).replace(/\s*(italic|oblique)\s*/i, ' ').trim()}`.trim();
    if (!fam || fam.startsWith('.')) continue;
    let F = FONTS.families.get(fam); if (!F) { F = { name: fam, slots: [null, null, null, null] }; FONTS.families.set(fam, F); }
    const k = STYLE_SLOT(c.bold, c.italic); const cur = F.slots[k]; if (!cur || (c.plain && !cur.plain)) F.slots[k] = { ...f, plain: c.plain };
  }
  FONTS.list = [...FONTS.families.keys()].filter((n) => FONTS.families.get(n).slots.some(Boolean)).sort((a, b) => a.localeCompare(b));
  FONTS.list.forEach((n) => registerSysFamily(n));
  FONTS.loaded = true;
}
function registerSysFamily(name, missing) {
  const key = 'sys:' + name; const E = FONT_FAMILIES[key] || (FONT_FAMILIES[key] = { sys: true, name, da: 'Helv', res: FONT_FAMILIES.helv.res, std: FONT_FAMILIES.helv.std });
  E.missing = !!missing && !FONTS.families.has(name); E.label = name + (E.missing ? ' (not on this PC)' : ''); E.css = `"${name.replace(/"/g, '')}", ${FONT_FAMILIES.helv.css}`; return key;
}
// desktop app: list from the Windows font folders; browser: Local Font Access (asks once)
async function loadFontList(interactive) {
  const H = HOST();
  try {
    if (H && H.listFonts) { const list = await H.listFonts(); addFaces(list.map((f) => ({ family: f.family, sub: f.sub, weight: f.weight, src: () => H.fontBytes(f.path).then((b) => ({ bytes: new Uint8Array(b), index: f.index || 0 })) }))); }
    else if (window.queryLocalFonts && (interactive || FONTS.asked)) {
      const fds = await window.queryLocalFonts(); FONTS.asked = true; store.set('fontsAsked', true);
      addFaces(fds.map((fd) => ({ family: fd.family, sub: fd.style, weight: /bold|black|heavy/i.test(fd.style) ? 700 : 400, familyIsTypographic: true, src: () => fd.blob().then((b) => b.arrayBuffer()).then((ab) => ({ bytes: new Uint8Array(ab), index: 0 })) })));
    }
  } catch (e) { console.warn('font list unavailable', e); if (interactive) toast('Fonts on this PC are not available here. Allow font access for this site, or use the desktop app.', 'error'); return false; }
  if (FONTS.loaded) { renderPropbar(); if (rightShown('props')) renderProps(); }
  return FONTS.loaded;
}
// the face for a family + style, loading it in the background the first time
function sysFace(fam, bold, italic) {
  const E = FONT_FAMILIES[fam]; if (!E || !E.sys) return null; const F = FONTS.families.get(E.name); if (!F) return null;
  let k = STYLE_SLOT(bold, italic); let synth = 0;
  if (!F.slots[k]) { const alts = italic ? (bold ? [2, 1, 0] : [0]) : bold ? [0] : [0, 2, 1, 3]; k = alts.find((a) => F.slots[a]); if (k == null) k = F.slots.findIndex(Boolean); synth = (bold && !(k & 1) ? 1 : 0) | (italic && !(k & 2) ? 2 : 0); }
  const slot = F.slots[k]; if (!slot) return null; const id = `${E.name}|${k}`;
  let face = FONTS.faces.get(id);
  if (!face) {
    face = { id, ready: false, failed: false, F: null, res: 'S' + ++FONTS.uid };
    FONTS.faces.set(id, face);
    face.promise = slot.src().then(({ bytes, index }) => { face.F = parseFace(bytes, index); face.ready = true; fontsChanged(); }).catch((e) => { console.warn('font load failed', E.name, e); face.failed = true; });
  }
  return face.ready ? { face, synth } : null;
}
const fontsChanged = debounce(() => { const d = activeDoc(); if (d) { renderAllMarks(d); if (state.editing) positionEditor(); } }, 60);
async function ensureDocFonts(doc) {
  const want = new Set(); doc.markups.forEach((m) => { if (m.style && m.style.font) want.add(m.style.font); (m.runs || []).forEach((r) => { if (r.f) want.add(r.f); }); });
  const waits = [];
  for (const f of want) { if (!String(f).startsWith('sys:')) continue; famOf(f); for (const b of [false, true]) for (const i of [false, true]) { sysFace(f, b, i); } }
  FONTS.faces.forEach((x) => { if (!x.ready && !x.failed && x.promise) waits.push(x.promise); });
  await Promise.all(waits);
}
// can this face go into a PDF? (licence bits and outline type)
function embeddable(face) {
  const F = face.F; if (!F) return false; if ((F.fsType & 0x000f) === 0x0002 || F.fsType & 0x0200) return 'licence'; if (!F.isTT) return 'outlines'; return true;
}
function cssFontName(f) { const E = FONT_FAMILIES[famOf(f)]; return E.sys ? E.name : { helv: 'Helvetica', times: 'Times', courier: 'Courier' }[famOf(f)] || 'Helvetica'; }

// ----- PDF output --------------------------------------------------------------------------------------
// how text in a given font is written: resource name and string encoding
function pdfFontFor(fam, bold, italic) {
  const E = FONT_FAMILIES[famOf(fam)];
  if (E && E.sys) {
    const r = sysFace(fam, bold, italic); const ok = r && embeddable(r.face);
    if (ok === true) { const F = r.face.F; return { res: r.face.res, face: r.face, sys: true, synth: r.synth, enc: (str, used) => { let h = ''; for (const ch of str) { const cp = ch.codePointAt(0); const g = F.gid(cp); used.set(g, cp); h += g.toString(16).padStart(4, '0'); } return '<' + h + '>'; }, has: (ch) => F.gid(ch.codePointAt(0)) > 0 }; }
    if (r && ok && !FONTS.warned.has(E.name)) { FONTS.warned.add(E.name); toast(`${E.name} ${ok === 'licence' ? 'does not allow embedding' : 'uses PostScript outlines'}, so Helvetica is used in the PDF.`); }
  }
  return { res: fontRes(fam, bold, italic), sys: false, synth: 0, enc: (str) => winAnsiHex(str), has: (ch) => !/[²³→]/.test(ch) };
}
// Type 0 font with a TrueType subset, widths and a ToUnicode map for copy/search
function embedSysFont(pdfDoc, face, used) {
  const ctx = pdfDoc.context; const F = face.F; const gids = [...used.keys()].sort((a, b) => a - b);
  let hsh = 0; gids.forEach((g) => { hsh = (hsh * 31 + g) >>> 0; }); hsh = (hsh ^ (face.res.length * 7919)) >>> 0; let tag = ''; for (let k = 0; k < 6; k++) { tag += String.fromCharCode(65 + (hsh % 26)); hsh = Math.floor(hsh / 26) + k * 7; }
  const name = `${tag}+${F.ps || 'Font'}`; const sc = 1000 / F.upem;
  const prog = subsetTrueType(F, gids); const file = ctx.register(ctx.flateStream(prog, { Length1: prog.length }));
  const flags = (F.fixed ? 1 : 0) | 32 | (F.italicAngle ? 64 : 0);
  const desc = ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: name, Flags: flags, FontBBox: F.bbox.map((v) => Math.round(v * sc)), ItalicAngle: F.italicAngle, Ascent: Math.round(F.asc * sc), Descent: Math.round(F.desc * sc), CapHeight: Math.round(F.capH * sc), StemV: F.weight >= 600 ? 140 : 80, FontFile2: file }));
  const W = []; gids.forEach((g) => { W.push(g, [Math.round(F.adv[g] * sc)]); });
  const cid = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: name, CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 }, FontDescriptor: desc, DW: 1000, W, CIDToGIDMap: 'Identity' }));
  const u16 = (cp) => { if (cp > 0xffff) { const v = cp - 0x10000; return ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 1023)).toString(16)).toUpperCase(); } return cp.toString(16).padStart(4, '0').toUpperCase(); };
  const pairs = gids.filter((g) => g).map((g) => `<${g.toString(16).padStart(4, '0').toUpperCase()}> <${u16(used.get(g))}>`);
  let cm = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
  for (let k = 0; k < pairs.length; k += 100) { const blk = pairs.slice(k, k + 100); cm += `${blk.length} beginbfchar\n${blk.join('\n')}\nendbfchar\n`; }
  cm += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
  const tu = ctx.register(ctx.flateStream(cm));
  return ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: tu });
}

// "Fonts on this PC…" in a font list asks the browser for access
document.addEventListener('change', (e) => {
  const t = e.target; if (!(t instanceof HTMLSelectElement) || t.value !== '__pcfonts') return;
  e.stopImmediatePropagation(); e.preventDefault(); const prev = t.querySelector('option[selected]'); t.value = prev ? prev.value : 'helv';
  loadFontList(true).then((ok) => { if (ok) toast(`${FONTS.list.length} fonts available`); });
}, true);
async function fontsBoot() {
  if (HOST()) return loadFontList(false);
  if (!window.queryLocalFonts) return;
  try { const p = await navigator.permissions.query({ name: 'local-fonts' }); if (p.state === 'granted') loadFontList(true); } catch { /* not supported */ }
}
