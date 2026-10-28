// ===== PDF input/output: open, save with annotations, flatten, page ops =====
const { PDFDocument, PDFName, PDFString, PDFHexString, PDFDict, PDFRef, PDFArray, StandardFonts, degrees } = PDFLib;
const MARKER = '/MeBulbData'; // older saves used /PlanmarkData; both are read

// ----- opening ----------------------------------------------------------------------
function hasMarker(bytes) {
  const pats = ['/MeBulbData', '/PlanmarkData'].map((t) => [...t].map((c) => c.charCodeAt(0)));
  for (let i = bytes.length - 12; i >= 0; i--) { if (bytes[i] !== 47) continue; for (const pat of pats) { let ok = true; for (let j = 1; j < pat.length; j++) if (bytes[i + j] !== pat[j]) { ok = false; break; } if (ok) return true; } }
  return false;
}
// remove MeBulb's own annotations and data from a loaded pdf-lib document; returns the data
function stripPlanmark(pdfDoc, doc) {
  const ctx = pdfDoc.context; let key = PDFName.of('MeBulbData'); let ref = pdfDoc.catalog.get(key); if (!ref) { key = PDFName.of('PlanmarkData'); ref = pdfDoc.catalog.get(key); }
  let data = null; if (ref) { try { data = JSON.parse(new TextDecoder().decode(decodeStream(ctx.lookup(ref)))); } catch (e) { console.warn('markup data unreadable', e); } }
  const drop = (r) => { if (r instanceof PDFRef) ctx.delete(r); };
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots(); if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const aref = annots.get(i); const a = ctx.lookup(aref); if (!(a instanceof PDFDict)) continue;
      if (!isOurs(a) && !(doc && doc.imported && aref instanceof PDFRef && doc.imported.has(refKey(aref)))) continue;
      annots.remove(i); if (!isOurs(a)) continue; // imported: the object number is reused for the rewritten markup
      const ap = a.lookup(PDFName.of('AP'));
      if (ap instanceof PDFDict) { const n = ap.get(PDFName.of('N')); const ns = n && ctx.lookup(n); if (ns && ns.dict) { const res = ns.dict.lookup(PDFName.of('Resources')); const xo = res instanceof PDFDict && res.lookup(PDFName.of('XObject')); if (xo instanceof PDFDict) xo.values().forEach(drop); } drop(n); }
      drop(aref);
    }
  }
  if (ref) { pdfDoc.catalog.delete(key); drop(ref); }
  return data;
}
async function extractPlanmark(bytes) {
  if (!hasMarker(bytes)) return null;
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const data = stripPlanmark(pdfDoc); if (!data) return null; stripBakedEdits(pdfDoc);
  return { data, bytes: await pdfDoc.save() };
}

// pdf.js reads the file through our byte source: whole for small files, on demand for big ones
function pdfjsParams(doc) {
  const src = doc.src; const common = { isEvalSupported: false, password: doc.password || undefined, useSystemFonts: true, ...PDFJS_ASSETS };
  if (src.kind === 'mem') return { ...common, data: src.bytes.slice() };
  const T = new pdfjsLib.PDFDataRangeTransport(src.size, null);
  T.requestDataRange = (begin, end) => { src.read(begin, end - begin).then((b) => T.onDataRange(begin, b), (e) => console.error('read failed', e)); };
  return { ...common, range: T, length: src.size, rangeChunkSize: 1 << 18, disableAutoFetch: true, disableStream: true };
}
async function loadPdfInto(doc) {
  if (doc.pdf) { try { await doc.pdf.loadingTask.destroy(); } catch { } }
  const task = pdfjsLib.getDocument(pdfjsParams(doc));
  task.onPassword = (update, reason) => {
    openDialog({ title: 'Password required', body: `<p>${reason === 2 ? 'That password did not work. ' : ''}<b>${esc(doc.name)}</b> is protected.</p>${field('Password', '<input type="password" name="pw" autocomplete="off">')}`, buttons: [{ label: 'Cancel', value: false }, { label: 'Open', value: true, primary: true }] })
      .then((r) => { if (r && r.value) { doc.password = r.form.pw; doc.encrypted = true; update(r.form.pw); } else task.destroy(); });
  };
  doc.pdf = await task.promise; doc.numPages = doc.pdf.numPages; doc.pdfVer = (doc.pdfVer || 0) + 1; doc._hidden = new Map();
  doc.viewReader = doc.viewReader && doc.viewReader.src === doc.src ? doc.viewReader : await openReader(doc.src);
  doc.hasOwnAnnots = !!(doc.viewReader && (await doc.viewReader.catalog().then((c) => !!(c.get(PDFName.of('MeBulbData')) || c.get(PDFName.of('PlanmarkData')))).catch(() => false)));
  let labels = null; try { labels = await doc.pdf.getPageLabels(); } catch { }
  const pages = [];
  for (let i = 0; i < doc.numPages; i++) { const page = await doc.pdf.getPage(i + 1); const vp = page.getViewport({ scale: 1, rotation: page.rotate }); pages.push({ w: vp.width, h: vp.height, T: Array.from(vp.transform), rotate: page.rotate, label: labels ? labels[i] : null }); }
  doc.pages = pages; doc.textCache = []; doc.outline = null; doc._plib = undefined; doc._plibP = null; doc.geo = {}; doc.fieldsLoaded = false; doc.fields = {}; doc.hasForms = false;
  loadFields(doc);
}

// Open a PDF from any byte source. Nothing is copied or rewritten on open.
async function openSource(name, src, opts = {}) {
  const doc = newDoc(name, src); doc.handle = opts.handle || null; doc.sample = !!opts.sample; doc.path = opts.path || null; doc.fid = opts.fid || null; doc.stat = opts.stat || null;
  try {
    const R = await openReader(src); let data = null;
    if (R) { try { data = await R.payload(); } catch (e) { console.warn('markup data unreadable', e); } }
    if ((!R && src.size < 300 * 1048576) || (data && (data.markups || []).some((m) => m.type === 'textedit' && m.applied))) {
      // edits baked into the page content (or a file our reader cannot follow): clean copy in memory
      const ext = await extractPlanmark(await src.all()).catch((e) => { console.warn(e); return null; });
      if (ext) { doc.src = new MemSource(ext.bytes); data = ext.data; doc.diskMatches = false; doc.cleanCopy = true; }
    }
    if (data) { doc.markups = data.markups || []; doc.scales = data.scales || {}; doc.layers = data.layers || []; doc.links = data.links || {}; doc.viewports = data.viewports || {}; doc.align = data.align || null; doc.tomb = data.tomb || null; doc.colorAdj = data.colorAdj || null; doc.ownSig = data.ownSig || {}; doc.vpSig = data.vpSig || {}; doc.assets = data.assets || {}; await ensureAssetImages(doc).catch(() => {}); }
    doc.base = { src: doc.src, appends: [] }; doc.reader = doc.src === src ? R : await openReader(doc.src); doc.viewReader = doc.reader;
    await loadPdfInto(doc);
    if (data && data.ownSig) await stripOwnedFromView(doc, data.ownSig);
    // markups from Revu, Acrobat and other apps become editable MeBulb markups
    try { const imp = await importAnnotations(doc, data); if (imp) { doc.hide = imp.hide; doc.imported = imp.imported; if (imp.removed.length && !doc.cleanCopy) { const gone = new Set(imp.removed.map((m) => m.id)); doc.markups = doc.markups.filter((m) => !gone.has(m.id)); } doc.markups.push(...imp.markups); doc.importNote = { added: imp.markups.length, removed: doc.cleanCopy ? 0 : imp.removed.length }; doc._hidden = new Map(); } } catch (e) { console.warn('import of existing markups failed', e); }
  } catch (e) {
    console.error(e); if (e && e.name === 'PasswordException') return null;
    toast(`Could not open ${name}: ${e.message || e}`, 'error'); return null;
  }
  if (opts.markups) doc.markups = opts.markups; if (opts.scales) doc.scales = opts.scales; if (opts.layers) doc.layers = opts.layers; if (opts.links) doc.links = opts.links; if (opts.viewports) doc.viewports = opts.viewports; if (opts.align) doc.align = opts.align;
  state.docs.push(doc); await switchDoc(doc.id); renderTabs(); sessionOpened(doc);
  return doc;
}
function openBytes(name, bytes, opts = {}) { return openSource(name, new MemSource(bytes), { ...opts }).then((d) => { if (d) d.diskMatches = false; return d; }); }
async function openFiles(files) {
  files = [...files];
  const btx = files.filter((f) => /\.btx$/i.test(f.name)); if (btx.length) { await importBtxFiles(btx); files = files.filter((f) => !btx.includes(f)); }
  const brx = files.filter((f) => /\.brx$/i.test(f.name)); if (brx.length) { await importStampFiles(brx); files = files.filter((f) => !brx.includes(f)); }
  for (const f of files) {
    const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; if (!isPdf) { toast(`${f.name} is not a PDF`, 'error'); continue; }
    const H = HOST(); const p = H && H.pathForFile ? H.pathForFile(f) : ''; if (p) { await openPath(p); continue; }
    const handle = f.handle || null; const file = f.getFile ? await f.getFile() : f;
    const big = file.size > state.prefs.largeFileMB * 1048576;
    const src = big ? blobSource(file) : new MemSource(new Uint8Array(await file.arrayBuffer()));
    const d = await openSource(file.name, src, { handle }); if (d) d.diskMatches = !!handle;
  }
}
async function pickAndOpen() {
  const H = HOST(); if (H) { const list = await H.openDialog(); for (const f of list || []) await openPath(f.path, f); return; }
  if (window.showOpenFilePicker && window.self === window.top) {
    try { const hs = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }); const files = []; for (const h of hs) { const f = await h.getFile(); f.handle = h; files.push(f); } await openFiles(files); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  $('#file-open').click();
}

// ----- saving files ----------------------------------------------------------------------
let _dlPromise = null;
function getDownloads() {
  if (!(window.claude && typeof window.claude.use === 'function')) return Promise.resolve(null);
  if (!_dlPromise) _dlPromise = Promise.resolve(window.claude.use('downloads')).catch(() => null);
  return _dlPromise;
}
async function saveFile(filename, data, mime, handle) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const dl = await getDownloads();
  if (dl) {
    try { await dl.save({ filename, data: blob }); toast(`Saved ${filename}`); return true; }
    catch (e) { const c = e && e.code; if (c === 'declined') { toast('Save cancelled'); return false; } if (c === 'rate_limited') { toast('A save prompt is already open'); return false; } if (c !== 'unavailable' && c !== 'not_granted' && c !== 'capability_disabled') { toast(`Could not save: ${(e && e.message) || c}`, 'error'); return false; } }
  }
  if (handle && handle.createWritable) { try { const w = await handle.createWritable(); await w.write(blob); await w.close(); toast(`Saved ${filename}`); return true; } catch (e) { console.warn(e); } }
  if (window.showSaveFilePicker && window.self === window.top) {
    try { const ext = filename.split('.').pop(); const h = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: ext.toUpperCase(), accept: { [mime]: ['.' + ext] } }] }); const w = await h.createWritable(); await w.write(blob); await w.close(); toast(`Saved ${filename}`); return h; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000); toast(`Downloaded ${filename}`); return true;
}

// ----- PDF content writer ----------------------------------------------------------------------
const WINANSI = { 8594: 187, 8592: 171, 8211: 150, 8364: 128, 8218: 130, 402: 131, 8222: 132, 8230: 133, 8224: 134, 8225: 135, 710: 136, 8240: 137, 352: 138, 8249: 139, 338: 140, 381: 142, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149, 8211: 150, 8212: 151, 732: 152, 8482: 153, 353: 154, 8250: 155, 339: 156, 382: 158, 376: 159 };
function winAnsiHex(str) { let h = ''; for (const ch of str) { const c = ch.codePointAt(0); let b = c >= 32 && c <= 126 ? c : c >= 160 && c <= 255 ? c : WINANSI[c] || 63; h += b.toString(16).padStart(2, '0'); } return '<' + h + '>'; }
class Ops {
  constructor(doc) { this.s = []; this.gs = new Map(); this.imgs = new Map(); this.fonts = new Set(); this.glyphs = new Map(); this.assets = new Map(); this.doc = doc || (typeof activeDoc === 'function' ? activeDoc() : null); }
  font(p) { const P = pdfFontFor(p.font, p.bold, p.italic); this.fonts.add(P.res); if (P.sys) { if (!this.glyphs.has(P.res)) this.glyphs.set(P.res, { face: P.face, used: new Map() }); const u = this.glyphs.get(P.res).used; return { ...P, hex: (s) => P.enc(s, u) }; } return { ...P, hex: (s) => P.enc(s) }; }
  // text matrix, with a slant for synthetic italics; synthetic bold strokes the outline too
  tm(size, cos, sin, x, y, synth) { const k = synth & 2 ? 0.21 : 0; return [size * cos, size * sin, k * size * cos + size * sin, k * size * sin - size * cos, x, y].map((v) => this.n(v)).join(' '); }
  bold(F, size, color) { return F.synth & 1 ? `2 Tr ${this.n(size * 0.028)} w ${this.rgb(color)} RG ` : ''; }
  n(v) { return num(v, 4); }
  rgb(hex) { const c = hexToRgb(hex) || [0, 0, 0]; return c.map((v) => num(v / 255, 4)).join(' '); }
  gsName(CA, ca, bm) { CA = +(+CA).toFixed(3); ca = +(+ca).toFixed(3); const key = `${CA}|${ca}|${bm || ''}`; if (!this.gs.has(key)) this.gs.set(key, { name: 'G' + this.gs.size, CA, ca, bm }); return this.gs.get(key).name; }
  path(d) { for (const s of d) { if (s[0] === 'M') this.s.push(`${this.n(s[1])} ${this.n(s[2])} m`); else if (s[0] === 'L') this.s.push(`${this.n(s[1])} ${this.n(s[2])} l`); else if (s[0] === 'C') this.s.push(`${s.slice(1).map((v) => this.n(v)).join(' ')} c`); else if (s[0] === 'Z') this.s.push('h'); } }
  prim(p) {
    if (p.hitOnly) return;
    const op = p.opacity == null ? 1 : p.opacity;
    if (p.k === 'path') {
      const hasFill = p.fill && p.fill !== 'none' && p.fill !== 'transparent'; const hasStroke = p.stroke && p.stroke !== 'none' && p.width > 0; if (!hasFill && !hasStroke) return;
      const fo = hasFill ? (p.fillOpacity == null ? 1 : p.fillOpacity) : 1;
      this.s.push('q'); if (op < 1 || fo < 1 || p.blend) this.s.push(`/${this.gsName(op, op * fo, p.blend)} gs`);
      if (hasFill) this.s.push(`${this.rgb(p.fill)} rg`);
      if (hasStroke) {
        this.s.push(`${this.rgb(p.stroke)} RG ${this.n(p.width)} w`); const cap = p.cap || (p.dash === 'dotted' ? 'round' : 'butt'); this.s.push(`${cap === 'round' ? 1 : 0} J ${p.join === 'miter' ? 0 : 1} j`);
        const da = dashArray(p.dash, p.width); this.s.push(da ? `[${da}] 0 d` : '[] 0 d');
      }
      this.path(p.d); this.s.push(hasFill && hasStroke ? (p.evenodd ? 'B*' : 'B') : hasFill ? (p.evenodd ? 'f*' : 'f') : 'S'); this.s.push('Q'); return;
    }
    if (p.k === 'text') {
      const F = this.font(p); if ([...p.str].some((ch) => /[\u00b2\u00b3\u2192]/.test(ch) && !F.has(ch))) { this.textSpecial(p, op, F); return; }
      const w = textWidth(p.str, p.size, p.bold, p.font, p.italic); const dx = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0; const a = p.rot || 0; const cos = Math.cos(a), sin = Math.sin(a);
      this.s.push('q'); if (op < 1) this.s.push(`/${this.gsName(op, op)} gs`);
      this.s.push(`BT /${F.res} 1 Tf ${this.rgb(p.color)} rg ${this.bold(F, p.size, p.color)}${this.tm(p.size, cos, sin, p.x + dx * cos, p.y + dx * sin, F.synth)} Tm ${F.hex(p.str)} Tj ET Q`); return;
    }
    if (p.k === 'asset') { // a stamp's vector artwork: its PDF page as a form XObject
      const A = this.doc && this.doc.assets && this.doc.assets[p.asset]; if (!A) return;
      if (!this.assets.has(p.asset)) this.assets.set(p.asset, 'S' + this.assets.size);
      this.s.push('q'); if (op < 1) this.s.push(`/${this.gsName(op, op)} gs`); this.s.push(`${this.n(p.w / A.w)} 0 0 ${this.n(-p.h / A.h)} ${this.n(p.x)} ${this.n(p.y + p.h)} cm /${this.assets.get(p.asset)} Do Q`); return;
    }
    if (p.k === 'image' && p.src) {
      if (!this.imgs.has(p.src)) this.imgs.set(p.src, 'I' + this.imgs.size);
      this.s.push('q'); if (op < 1) this.s.push(`/${this.gsName(op, op)} gs`); this.s.push(`${this.n(p.w)} 0 0 ${this.n(-p.h)} ${this.n(p.x)} ${this.n(p.y + p.h)} cm /${this.imgs.get(p.src)} Do Q`);
    }
  }
  // ², ³ and → drawn without relying on the viewer's font: small raised digits and a vector arrow
  textSpecial(p, op, F) {
    const w = textWidth(p.str, p.size, p.bold, p.font, p.italic); const dx = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0; const a = p.rot || 0; const cos = Math.cos(a), sin = Math.sin(a);
    const at = (lx, ly) => [p.x + lx * cos - ly * sin, p.y + lx * sin + ly * cos];
    const run = (str, lx, ly, size) => { const [X, Y] = at(lx, ly); this.s.push(`BT /${F.res} 1 Tf ${this.rgb(p.color)} rg ${this.bold(F, size, p.color)}${this.tm(size, cos, sin, X, Y, F.synth)} Tm ${F.hex(str)} Tj ET`); };
    this.s.push('q'); if (op < 1) this.s.push(`/${this.gsName(op, op)} gs`);
    let lx = dx; let buf = '';
    const flush = () => { if (buf) { run(buf, lx, 0, p.size); lx += textWidth(buf, p.size, p.bold, p.font, p.italic); buf = ''; } };
    for (const ch of p.str) {
      if (F.has(ch)) buf += ch;
      else if (ch === '\u00b2' || ch === '\u00b3') { flush(); run(ch === '\u00b2' ? '2' : '3', lx, -p.size * 0.36, p.size * 0.62); lx += textWidth(ch, p.size, p.bold, p.font, p.italic); }
      else if (ch === '\u2192') {
        flush(); const aw = textWidth(ch, p.size, p.bold, p.font, p.italic); const yy = -p.size * 0.32; const h = p.size * 0.16; const a0 = at(lx + aw * 0.12, yy), a1 = at(lx + aw * 0.72, yy), tip = at(lx + aw * 0.9, yy), l = at(lx + aw * 0.6, yy - h), r = at(lx + aw * 0.6, yy + h);
        this.s.push(`${this.rgb(p.color)} RG ${this.rgb(p.color)} rg ${this.n(Math.max(0.3, p.size * 0.07))} w 0 J ${this.n(a0[0])} ${this.n(a0[1])} m ${this.n(a1[0])} ${this.n(a1[1])} l S ${this.n(tip[0])} ${this.n(tip[1])} m ${this.n(l[0])} ${this.n(l[1])} l ${this.n(r[0])} ${this.n(r[1])} l h f`); lx += aw;
      } else buf += ch;
    }
    flush(); this.s.push('Q');
  }
  toString() { return this.s.join('\n'); }
}
function invertT(T) { const [a, b, c, d, e, f] = T; const det = a * d - b * c; return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]; }
function applyT(M, p) { return [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]; }
function primsBBox(prims) {
  const pts = []; let pad = 0;
  for (const p of prims) {
    if (p.k === 'path') { p.d.forEach((s) => { for (let i = 1; i < s.length; i += 2) pts.push([s[i], s[i + 1]]); }); pad = Math.max(pad, (p.width || 0) / 2 + 1); }
    else if (p.k === 'text') { const w = textWidth(p.str, p.size, p.bold, p.font, p.italic); const dx = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0; const a = p.rot || 0; const c = Math.cos(a), s = Math.sin(a); [[dx, -p.size], [dx + w, -p.size], [dx + w, p.size * 0.3], [dx, p.size * 0.3]].forEach(([lx, ly]) => pts.push([p.x + lx * c - ly * s, p.y + lx * s + ly * c])); }
    else if (p.k === 'image' || p.k === 'asset') pts.push([p.x, p.y], [p.x + p.w, p.y + p.h]);
  }
  if (!pts.length) return null; const b = G.bbox(pts); return { x: b.x - pad, y: b.y - pad, x2: b.x2 + pad, y2: b.y2 + pad };
}
function pdfDate(iso) { const d = new Date(iso || Date.now()); const p = (n) => String(n).padStart(2, '0'); return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`; }
async function embedImageData(pdfDoc, src, cache) {
  if (cache.has(src)) return cache.get(src);
  const b64 = src.split(',')[1]; const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const img = /^data:image\/jpe?g/i.test(src) ? await pdfDoc.embedJpg(bin) : await pdfDoc.embedPng(bin); cache.set(src, img); return img;
}
// standard fonts, embedded once per save and only when used
// installed fonts get a reserved object number now and are written once at the end, as one subset per save
function fontCache(pdfDoc) {
  const map = new Map(); const sys = new Map();
  const get = async (res) => {
    if (sys.has(res)) return sys.get(res);
    if (!map.has(res)) { const fam = Object.values(FONT_FAMILIES).find((f) => !f.sys && f.res.includes(res)) || FONT_FAMILIES.helv; map.set(res, await pdfDoc.embedFont(StandardFonts[fam.std[Math.max(0, fam.res.indexOf(res))]])); }
    return map.get(res);
  };
  const use = (glyphs) => { glyphs.forEach((g, res) => { let e = sys.get(res); if (!e) { e = { ref: pdfDoc.context.nextRef(), face: g.face, used: new Map() }; sys.set(res, e); } g.used.forEach((cp, gid) => e.used.set(gid, cp)); }); };
  const finalize = () => { sys.forEach((e) => { if (!e.done) { pdfDoc.context.assign(e.ref, embedSysFont(pdfDoc, e.face, e.used)); e.done = true; } }); };
  return { get, use, finalize };
}
async function resourcesFor(pdfDoc, ops, fonts, imgCache) {
  const ctx = pdfDoc.context; const res = { Font: {} }; fonts.use(ops.glyphs);
  for (const name of ops.fonts) res.Font[name] = (await fonts.get(name)).ref;
  if (ops.gs.size) { res.ExtGState = {}; ops.gs.forEach((g) => { const o = { Type: 'ExtGState', CA: g.CA, ca: g.ca }; if (g.bm) o.BM = g.bm === 'multiply' ? 'Multiply' : 'Normal'; res.ExtGState[g.name] = ctx.obj(o); }); }
  if (ops.imgs.size || ops.assets.size) res.XObject = {};
  for (const [src, name] of ops.imgs) { const img = await embedImageData(pdfDoc, src, imgCache); res.XObject[name] = img.ref; }
  for (const [id, name] of ops.assets) { const key = 'asset:' + id; if (!imgCache.has(key)) { const [pg] = await pdfDoc.embedPdf(b64ToBytes(ops.doc.assets[id].pdf), [0]); imgCache.set(key, pg); } res.XObject[name] = imgCache.get(key).ref; }
  return ctx.obj(res);
}
const ANNOT_SUBTYPE = { equip: 'Square', rect: 'Square', ellipse: 'Circle', radius: 'Circle', line: 'Line', arrow: 'Line', length: 'Line', polyline: 'PolyLine', polylength: 'PolyLine', angle: 'PolyLine', polygon: 'Polygon', cloud: 'Polygon', area: 'Polygon', perimeter: 'Polygon', volume: 'Polygon', pen: 'Ink', highlight: 'Ink', text: 'FreeText', callout: 'FreeText', note: 'Text', stamp: 'Stamp', image: 'Stamp', count: 'Square', texthl: 'Highlight', strikeout: 'StrikeOut', sketch: 'Square', refpt: 'Stamp', gridline: 'Line' };

// a callout with extra leaders: the callout itself (first leader) plus a grouped polyline per extra leader
function calloutParts(m, doc) {
  const s = m.style; const gid = m.group || 'CO-' + m.id; const L = textLayout(m); const lds = calloutLeaders(m, L);
  const base = { page: m.page, layer: m.layer, author: m.author, created: m.created, modified: m.modified, status: m.status, group: gid, subject: m.subject };
  return [{ ...m, leaders: null, group: gid, ext: { ...(m.ext || {}), groupPrimary: m.group ? (m.ext && m.ext.groupPrimary) || undefined : true, groupName: m.group ? m.ext && m.ext.groupName : 'Callout' } },
    ...lds.slice(1).map((ld, k) => ({ ...base, id: `${m.id}#L${k}`, type: 'polyline', pts: [ld.tip, ld.knee, ld.attach], style: { stroke: s.stroke, width: Math.max(s.width, 0.75), opacity: s.opacity, dash: 'solid', arrowStart: s.arrowEnd || 'arrow', arrowEnd: 'none' }, ext: {} }))];
}
// rich text goes in as plain ASCII with XML character references: pdf.js (and others) read RC
// as a byte string, so UTF-16 here would arrive as mojibake
function xmlAsciiHex(x) { const a = x.replace(/[^\x20-\x7e]/gu, (c) => `&#${c.codePointAt(0)};`); let h = ''; for (let i = 0; i < a.length; i++) h += a.charCodeAt(i).toString(16).padStart(2, '0'); return PDFHexString.of(h); }
// annotation objects for one page's markups, in whichever pdf-lib document is being written
async function annotsForPage(pdfDoc, fonts, imgCache, doc, i, pageRef, ms) {
  const ctx = pdfDoc.context; const pg = doc.pages[i]; const M = invertT(pg.T); const cm = `${M.map((v) => num(v, 6)).join(' ')} cm`; const refs = []; const groups = new Map();
  // sketches go out as several plain markups (see sketchParts)
  for (const m of ms.flatMap((x) => (x.type === 'sketch' ? sketchParts(x, doc) : x.type === 'equip' ? equipParts(x, doc) : x.type === 'callout' && x.leaders && x.leaders.length ? calloutParts(x, doc) : [x]))) {
    const s = m.style; const base = { Type: 'Annot', F: 4, P: pageRef, C: (hexToRgb(s.stroke) || [0, 0, 0]).map((v) => +(v / 255).toFixed(4)), CA: s.opacity == null ? 1 : s.opacity, T: PDFHexString.fromText(m.author || ''), Subj: PDFHexString.fromText(m.subject || ''), M: PDFString.of(pdfDate(m.modified)), CreationDate: PDFString.of(pdfDate(m.created)) };
    if (m.type === 'count' && m.pts.length) { refs.push(...(await countAnnots(pdfDoc, fonts, imgCache, doc, i, pageRef, m, base))); continue; }
    const prims = m._prims || dl(m, doc); const vb = primsBBox(prims); if (!vb) continue;
    const corners = [[vb.x, vb.y], [vb.x2, vb.y], [vb.x2, vb.y2], [vb.x, vb.y2]].map((p) => applyT(M, p)); const rb = G.bbox(corners); const rect = [rb.x, rb.y, rb.x2, rb.y2];
    const ops = new Ops(doc); ops.s.push(cm); prims.forEach((p) => ops.prim(p));
    const res = await resourcesFor(pdfDoc, ops, fonts, imgCache);
    const ap = ctx.register(ctx.flateStream(ops.toString(), { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect, Resources: res }));
    const col = hexToRgb(m.type === 'note' ? s.fill : s.stroke) || [0, 0, 0]; let sub = ANNOT_SUBTYPE[m.type] || 'Square'; if (m.type === 'sketch' && sketchSize(doc, m).shape === 'circle') sub = 'Circle';
    const info = MEASURE_TYPES.has(m.type) ? measureInfo(m, doc) : null;
    const contents = m._contents != null ? m._contents : m.type === 'equip' ? [m.tag, m.eq && m.eq.name, m.eq && `${Math.round(m.eq.w)} × ${Math.round(m.eq.d)} mm`, m.comment].filter(Boolean).join('\n') : TEXT_TYPES.has(m.type) ? m.text : m.type === 'stamp' ? m.text : m.type === 'sketch' ? [sketchName(doc, m), sizeLabel(doc, m), m.comment].filter(Boolean).join('\n') : info ? info.text : [m.text, m.comment].filter(Boolean).join('\n');
    const A = {
      ...base, Subtype: sub, Rect: rect, NM: PDFString.of((m.ext && m.ext.nm) || m.id.replace(/[^A-Za-z0-9_.-]/g, '_')), MeBulbId: PDFString.of(m.id), AP: { N: ap },
      C: col.map((v) => +(v / 255).toFixed(4)), Contents: PDFHexString.fromText(contents || ''), Border: [0, 0, s.width || 0],
    };
    if (s.fill && s.fill !== 'none' && (sub === 'Square' || sub === 'Circle' || sub === 'Polygon')) A.IC = (hexToRgb(s.fill) || [1, 1, 1]).map((v) => v / 255);
    const pdfPts = m.pts.map((p) => applyT(M, p));
    if (sub === 'Line') A.L = [...pdfPts[0], ...pdfPts[pdfPts.length - 1]];
    // squares and circles: the border sits inside Rect minus RD, so other apps redraw them at exactly this size
    if ((m.type === 'rect' || m.type === 'ellipse') && m.pts.length === 2) { const b = boxRect(m.pts[0], m.pts[1]); const hw = (s.width || 0) / 2; const ib = G.bbox([[b.x - hw, b.y - hw], [b.x + b.w + hw, b.y + b.h + hw]].map((p) => applyT(M, p))); A.RD = [ib.x - rect[0], ib.y - rect[1], rect[2] - ib.x2, rect[3] - ib.y2].map((v) => +Math.max(0, v).toFixed(3)); }
    if (sub === 'PolyLine' || sub === 'Polygon') A.Vertices = (CV.has(m) ? CV.pts(m).map((p) => applyT(M, p)) : pdfPts).flat(); // bends go out as short straight pieces other viewers can draw
    if (sub === 'Ink') A.InkList = [pdfPts.flat(), ...((m.ext && m.ext.extraInk) || []).map((st) => st.map((p) => applyT(M, p)).flat())];
    if (QUAD_TYPES.has(m.type)) { if (m.type === 'strikeout' && s.variant === 'under') A.Subtype = 'Underline'; const q = []; for (let k = 0; k + 3 < pdfPts.length; k += 4) { const [tl, tr, br, bl] = pdfPts.slice(k, k + 4); q.push(...tl, ...tr, ...bl, ...br); } A.QuadPoints = q; }
    if (sub === 'FreeText') {
      // as Revu writes them: DA rg is the border and leader colour, DS gives the text (font, colour, spacing), /C the fill
      const rgb3 = (c) => (hexToRgb(c) || [0, 0, 0]).map((v) => num(v / 255, 3)).join(' '); const z = s.fontSize || 12;
      const pad = s.pad != null ? s.pad : Math.max(3, z * 0.4); const margin = Math.max(0, pad - 1 - (s.width || 0) / 2);
      A.DA = PDFString.of(`${rgb3(s.stroke && s.stroke !== 'none' ? s.stroke : s.fontColor || '#000000')} rg /${FONT_FAMILIES[famOf(s.font)].da} ${num(z, 2)} Tf`);
      A.RC = xmlAsciiHex(rtXhtml(m)); A.DS = PDFString.of(`font: ${s.bold ? 'bold ' : ''}${s.italic ? 'italic ' : ''}${cssFontName(s.font)} ${num(z, 2)}pt; text-align:${s.align || 'left'};${s.valign ? ` text-valign:${s.valign};` : ''} margin:${num(margin, 3)}pt; line-height:${num(z * (s.lineH || 1.2), 3)}pt; color:${cssColor(s.fontColor || s.stroke)}`);
    }
    if (sub === 'Text') A.Name = 'Comment';
    if (m.type === 'refpt') A.Name = 'ReferencePoint';
    else if (sub === 'Stamp') A.Name = m.type === 'image' ? 'Image' : (m.text || 'Approved').replace(/[^A-Za-z0-9]+/g, '') || 'Approved';
    revuDecorate(A, m, doc, ctx, M, info);
    // markups that came from another app keep their object number, so replies and links to them survive
    const reuse = m.ext && m.ext.ref && /^\d+ \d+$/.test(m.ext.ref) && doc.imported && doc.imported.has(m.ext.ref) ? PDFRef.of(+m.ext.ref.split(' ')[0], +m.ext.ref.split(' ')[1]) : null;
    let ref; if (reuse) { ctx.assign(reuse, ctx.obj(A)); ref = reuse; } else ref = ctx.register(ctx.obj(A)); refs.push(ref);
    if (m.group) { if (!groups.has(m.group)) groups.set(m.group, []); groups.get(m.group).push({ m, ref }); }
  }
  // groups the way Revu writes them: the first markup lists the group, the others point at it
  for (const mem of groups.values()) {
    if (mem.length < 2) continue; const prim = mem.find((x) => x.m.ext && x.m.ext.groupPrimary) || mem[0]; const nmOf = (x) => String((x.m.ext && x.m.ext.nm) || x.m.id).replace(/[^A-Za-z0-9_.-]/g, '_');
    ctx.lookup(prim.ref).set(PDFName.of('GroupNesting'), ctx.obj([PDFHexString.fromText((prim.m.ext && prim.m.ext.groupName) || 'Group'), ...mem.map((x) => PDFName.of(nmOf(x)))]));
    for (const x of mem) if (x !== prim) { const d = ctx.lookup(x.ref); d.set(PDFName.of('IRT'), prim.ref); d.set(PDFName.of('RT'), PDFName.of('Group')); }
  }
  return refs;
}

// Whole-file rewrite with pdf-lib: used when the save changes page content (text edits, OCR,
// form values), and for files our incremental reader cannot follow.
async function buildPdf(doc, { flatten }) {
  const pdfDoc = await PDFDocument.load(await docBytes(doc, 'Preparing the whole file'), { ignoreEncryption: true, updateMetadata: false });
  if (pdfDoc.isEncrypted) throw new Error('This PDF is password-protected, so its pages cannot be rewritten. Export the markup list as CSV instead.');
  stripPlanmark(pdfDoc, doc);
  const ctx = pdfDoc.context; const fonts = fontCache(pdfDoc); fonts.reg = await fonts.get('FR'); fonts.bold = await fonts.get('FB');
  const imgCache = new Map(); const pages = pdfDoc.getPages();
  const editApplied = await bakeTextEdits(pdfDoc, doc, fonts, imgCache);
  bakeOcr(pdfDoc, doc, fonts);
  applyFormValues(pdfDoc, doc, fonts.reg, flatten);
  await scanFlat(doc);
  const savedFlat = doc.flat; if (flatten) doc.flat = [...(doc.flat || []), ...[...Array(pages.length).keys()].flatMap((i) => exportFlat(doc, i))];
  try { const sigs = await ownedContentFull(pdfDoc, doc, fonts, imgCache); if (!flatten) doc.ownSigPending = sigs; } finally { doc.flat = savedFlat; }
  if (!flatten) { const ocp = await layerOcgs(pdfDoc, doc, pdfDoc.catalog.get(PDFName.of('OCProperties')), async (o) => (o instanceof PDFRef ? ctx.lookup(o) : o)); if (ocp) pdfDoc.catalog.set(PDFName.of('OCProperties'), ocp); }
  const vps = {};
  for (let i = 0; i < pages.length && !flatten; i++) {
    const page = pages[i]; if (!doc.pages[i]) continue;
    const vp = viewportArray(ctx, doc, i); if (vp.length) page.node.set(PDFName.of('VP'), ctx.obj(vp)); else page.node.delete(PDFName.of('VP')); vps[i] = vpSig(doc, i);
    const ms = doc.markups.filter((m) => m.page === i && m.type !== 'textedit'); if (!ms.length) continue;
    for (const ref of await annotsForPage(pdfDoc, fonts, imgCache, doc, i, page.ref, ms)) page.node.addAnnot(ref);
  }
  if (!flatten) doc.vpSigPending = vps;
  if (!flatten) { cleanupLinks(doc); const ref = ctx.register(ctx.flateStream(new TextEncoder().encode(payloadJson(doc, editApplied)), { Type: 'MeBulbData' })); pdfDoc.catalog.set(PDFName.of('MeBulbData'), ref); }
  fonts.finalize(); pdfDoc.setModificationDate(new Date()); pdfDoc.setProducer('MeBulb');
  return pdfDoc.save();
}

// the bytes of the file as it will be after this save, as parts (big files are never copied in memory)
function baseParts(doc) { const b = doc.base; const s = b.src; const head = s.kind === 'host' ? { fid: s.fid, off: 0, len: s.size } : s.kind === 'blob' ? s.blob : s.bytes; return [head, ...b.appends]; }
class ConcatSource {
  constructor(parts) { this.parts = parts; this.size = parts.reduce((n, p) => n + p.size, 0); this.kind = 'concat'; }
  async read(off, len) {
    const out = []; let o = off, left = Math.max(0, Math.min(len, this.size - off)); let at = 0;
    for (const p of this.parts) { if (left <= 0) break; if (o < at + p.size) { const lo = o - at; const n = Math.min(left, p.size - lo); out.push(await p.read(lo, n)); o += n; left -= n; } at += p.size; }
    return out.length === 1 ? out[0] : concatBytes(out);
  }
  async all() { return concatBytes(await Promise.all(this.parts.map((p) => p.all()))); }
}
function baseSource(doc) { const b = doc.base; return b.appends.length ? new ConcatSource([b.src, ...b.appends.map((a) => new MemSource(a))]) : b.src; }

// Save. Normal saves append an incremental update (fast even for a 400 MB drawing).
async function saveDoc(mode = 'save') {
  const doc = activeDoc(); if (!doc) return; if (state.editing) commitEdit(); cancelDraft();
  const busy = $('#busy'); busy.hidden = false; busy.textContent = mode === 'flatten' ? 'Flattening markups…' : 'Saving…'; await raf();
  const H = HOST(); const t0 = performance.now(); if (doc.sess) { doc.sess.saving = true; sessTick(doc, true); }
  try {
    cleanupLinks(doc); await ensureDocFonts(doc); if (!doc.reader) doc.reader = await openReader(baseSource(doc));
    const why = needsRewrite(doc); let parts, appendOnly = null, full = null;
    if (!why) {
      const upd = await incrementalUpdate(doc, { flatten: mode === 'flatten' });
      if (!upd) throw new Error('Could not prepare the update');
      parts = [...baseParts(doc), upd.bytes]; appendOnly = upd;
    } else { full = await buildPdf(doc, { flatten: mode === 'flatten' }); parts = [full]; }
    const base = doc.name.replace(/\.pdf$/i, ''); const name = mode === 'flatten' ? `${base} (flattened).pdf` : `${base}.pdf`;
    let ok = false; let target = null;
    if (H) {
      target = mode === 'save' && doc.path ? doc.path : await H.saveDialog({ defaultPath: doc.path ? doc.path.replace(/[^\\/]*$/, name) : name });
      if (!target) return;
      busy.textContent = 'Writing…'; await raf();
      if (appendOnly && target === doc.path && doc.diskMatches && doc.stat) {
        try { doc.stat = await H.append(target, appendOnly.bytes, doc.stat); ok = true; }
        catch (e) {
          if (!(e && /CHANGED/.test(e.message || e))) throw e;
          if (doc.sess) { // live session: take their newer file, merge, and append our update to it
            await sessRebase(doc); const upd2 = await incrementalUpdate(doc, {}); appendOnly = upd2; doc.stat = await H.append(target, upd2.bytes, doc.stat); ok = true;
          } else { busy.hidden = true; if (!(await resolveDiskChange(doc))) return; busy.hidden = false; doc.stat = await H.writeFile(target, parts); ok = true; }
        }
      } else { doc.stat = await H.writeFile(target, parts); ok = true; }
      if (ok && mode !== 'flatten') { if (target !== doc.path) { doc.path = target; doc.name = target.split(/[\\/]/).pop(); H.addRecent && H.addRecent(target); } }
    } else {
      const blob = new Blob(parts, { type: 'application/pdf' }); busy.hidden = true;
      ok = !!(await saveFile(name, blob, 'application/pdf', mode === 'save' ? doc.handle : null)); if (ok && ok.createWritable) doc.handle = ok;
    }
    if (!ok) return;
    if (mode !== 'flatten') {
      if (appendOnly) { doc.base.appends.push(appendOnly.bytes); doc.reader = await openReader(baseSource(doc)); }
      else { doc.base = { src: new MemSource(full), appends: [] }; doc.reader = await openReader(doc.base.src); }
      if (doc.ownSigPending) { doc.ownSig = doc.ownSigPending; doc.ownSigPending = null; } if (doc.vpSigPending) { doc.vpSig = doc.vpSigPending; doc.vpSigPending = null; }
      doc.diskMatches = !!(H ? doc.path : doc.handle); doc.dirty = false; doc.savedAt = nowISO(); renderTabs(); sessionSaved(doc);
      const ms = Math.round(performance.now() - t0); setStatus(`Saved ${doc.name} in ${ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s'}${appendOnly ? ` (${fmtBytes(appendOnly.bytes.length)} added)` : ' (whole file rewritten)'}`);
    }
  } catch (e) { console.error(e); toast(e.message || String(e), 'error'); } finally { busy.hidden = true; if (doc.sess) doc.sess.saving = false; }
}
function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
// someone else changed the file on disk since we opened it (Egnyte synced a newer copy)
async function resolveDiskChange(doc) {
  const r = await openDialog({ title: 'The PDF changed on disk', body: `<p><b>${esc(doc.name)}</b> was changed by someone else since you opened it.</p><p>Saving now replaces their version with yours. Live sharing (Window ▸ Live session) merges everyone's markups so this does not happen.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Save a copy…', value: 'copy' }, { label: 'Replace their version', value: true, danger: true }] });
  if (!r || !r.value) return false; if (r.value === 'copy') { setTimeout(() => saveDoc('saveas'), 0); return false; } return true;
}

// ----- page operations -----------------------------------------------------------------------------
function remapPages(doc, f) {
  doc.markups = doc.markups.filter((m) => { const n = f(m.page); if (n == null) return false; m.page = n; return true; });
  const sc = {}; Object.entries(doc.scales).forEach(([k, v]) => { const n = f(+k); if (n != null) sc[n] = v; }); doc.scales = sc;
  const vp = {}; Object.entries(doc.viewports || {}).forEach(([k, v]) => { const n = f(+k); if (n != null) vp[n] = v; }); doc.viewports = vp; cleanupLinks(doc);
  if (doc.flat) doc.flat = doc.flat.filter((F) => { const n = f(F.page); if (n == null) return false; F.page = n; F.markups.forEach((m) => { m.page = n; }); return true; });
  if (doc.colorAdj && doc.colorAdj.pages) { const cp = {}; Object.entries(doc.colorAdj.pages).forEach(([k, v]) => { const n = f(+k); if (n != null) cp[n] = v; }); doc.colorAdj.pages = cp; }
  if (doc.align) { const ref = f(doc.align.ref); if (ref == null) doc.align = null; else { const T = {}; Object.entries(doc.align.T || {}).forEach(([k, v]) => { const n = f(+k); if (n != null) T[n] = v; }); doc.align = { ref, T }; } }
  [...state.sel].forEach((id) => { if (!getMarkup(id, doc)) state.sel.delete(id); });
}
async function pageOpRun(label, fn, remap) {
  const doc = activeDoc(); const busy = $('#busy'); busy.hidden = false; busy.textContent = label; await raf();
  try {
    const pdfDoc = await PDFDocument.load(await docBytes(doc, 'Loading the whole file'), { ignoreEncryption: true, updateMetadata: false });
    if (pdfDoc.isEncrypted) throw new Error('Pages of a password-protected PDF cannot be changed.');
    await fn(pdfDoc); const bytes = await pdfDoc.save();
    pushUndo(doc); if (remap) remap(doc); setDocSource(doc, new MemSource(bytes)); const st = V.el.scrollTop;
    await loadPdfInto(doc); mountDoc(doc); V.el.scrollTop = st; refreshAll();
  } finally { busy.hidden = true; }
}
async function rotatePages(idxs, delta) {
  const doc = activeDoc(); const dims = idxs.map((i) => [doc.pages[i].w, doc.pages[i].h]);
  await pageOpRun('Rotating…', (pdf) => { idxs.forEach((i) => { const p = pdf.getPage(i); p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360)); }); }, (d) => {
    idxs.forEach((i, k) => {
      const [W, H] = dims[k]; const f = delta > 0 ? (p) => [H - p[1], p[0]] : (p) => [p[1], W - p[0]];
      d.markups.forEach((m) => {
        if (m.page !== i) return; mapMarkupPoints(m, f); if (m.type === 'textedit') m.ang = (m.ang || 0) + (delta > 0 ? Math.PI / 2 : -Math.PI / 2); if (m.type === 'sketch' && !m.link) m.rot = (m.rot || 0) + delta;
        if (BOX_TYPES.has(m.type)) { const b = boxRect(m.pts[0], m.pts[1]); m.pts = [[b.x, b.y], [b.x + b.w, b.y + b.h]]; }
        if (m.type === 'callout') { const b = boxRect(m.pts[1], m.pts[2]); m.pts = [m.pts[0], [b.x, b.y], [b.x + b.w, b.y + b.h]]; }
        if (m.type === 'note') m.pts = [[m.pts[0][0] - (delta > 0 ? 18 : 0), m.pts[0][1] - (delta > 0 ? 0 : 18)]];
      });
      (d.viewports[i] || []).forEach((v) => { const a = f([v.x, v.y]), b = f([v.x + v.w, v.y + v.h]); const r = boxRect(a, b); Object.assign(v, r); });
      if (d.align) { if (d.align.ref === i) d.align = null; else if (d.align.T) delete d.align.T[i]; }
    });
  });
}
async function deletePages(idxs) { const set = new Set(idxs); await pageOpRun('Deleting page…', (pdf) => { [...idxs].sort((a, b) => b - a).forEach((i) => pdf.removePage(i)); }, (d) => { remapPages(d, (p) => (set.has(p) ? null : p - idxs.filter((x) => x < p).length)); }); state.thumbSel = clamp(idxs[0], 0, activeDoc().numPages - 1); }
async function insertBlank(at, like) { await pageOpRun('Inserting page…', (pdf) => { pdf.insertPage(at, [like.w, like.h]); }, (d) => remapPages(d, (p) => (p >= at ? p + 1 : p))); state.thumbSel = at; }
async function insertFromFile(at, file) {
  let bytes = new Uint8Array(await file.arrayBuffer()); const ext = await extractPlanmark(bytes).catch(() => null); if (ext) bytes = ext.bytes;
  let n = 0;
  await pageOpRun('Inserting pages…', async (pdf) => { const src = await PDFDocument.load(bytes, { ignoreEncryption: true }); const pages = await pdf.copyPages(src, src.getPageIndices()); pages.forEach((p, k) => pdf.insertPage(at + k, p)); n = pages.length; }, (d) => {
    remapPages(d, (p) => (p >= at ? p + n : p));
    if (ext) { (ext.data.markups || []).forEach((m) => { m.page += at; m.id = uid(); d.markups.push(m); }); Object.entries(ext.data.scales || {}).forEach(([k, v]) => { d.scales[+k + at] = v; }); (ext.data.layers || []).forEach((l) => { if (!d.layers.find((x) => x.id === l.id)) d.layers.push(l); }); }
  });
  toast(`Inserted ${n} page${n === 1 ? '' : 's'} from ${file.name}`);
}
async function movePage(i, j) { await pageOpRun('Moving page…', (pdf) => { const p = pdf.getPage(i); pdf.removePage(i); pdf.insertPage(j, p); }, (d) => remapPages(d, (p) => { if (p === i) return j; if (i < j && p > i && p <= j) return p - 1; if (i > j && p >= j && p < i) return p + 1; return p; })); }
function parseRange(str, max) {
  const out = []; String(str).split(',').forEach((part) => { const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if (!m) return; let a = +m[1], b = m[2] ? +m[2] : a; if (a > b) [a, b] = [b, a]; for (let k = a; k <= b; k++) if (k >= 1 && k <= max && !out.includes(k - 1)) out.push(k - 1); }); return out;
}
async function extractPages(idxs, asNew = true) {
  const doc = activeDoc(); const busy = $('#busy'); busy.hidden = false; busy.textContent = 'Extracting pages…'; await raf();
  try {
    const src = await PDFDocument.load(await docBytes(doc), { ignoreEncryption: true }); stripPlanmark(src); const out = await PDFDocument.create(); const pages = await out.copyPages(src, idxs); pages.forEach((p) => out.addPage(p));
    const bytes = await out.save(); const map = new Map(idxs.map((p, k) => [p, k]));
    const markups = deep(doc.markups.filter((m) => map.has(m.page))).map((m) => ({ ...m, id: uid(), page: map.get(m.page) }));
    const scales = {}; idxs.forEach((p, k) => { if (doc.scales[p]) scales[k] = deep(doc.scales[p]); });
    const viewports = {}; idxs.forEach((p, k) => { if (doc.viewports && doc.viewports[p]) viewports[k] = deep(doc.viewports[p]); });
    busy.hidden = true;
    await openBytes(`${doc.name.replace(/\.pdf$/i, '')} (pages ${idxs.map((x) => x + 1).join(',')}).pdf`.slice(0, 120), bytes, { markups, scales, layers: deep(doc.layers), links: deep(doc.links || {}), viewports });
    const nd = activeDoc(); if (nd) nd.dirty = true; renderTabs();
  } finally { busy.hidden = true; }
}

// the document now shows different bytes (page operations, undo of one): saves go out as a whole file
function setDocSource(doc, src) { doc.src = src; doc.bytes = null; doc.base = { src, appends: [] }; doc.reader = null; doc.viewReader = null; doc.diskMatches = false; doc.ownSig = {}; doc.flatScanned = new Set(); }
