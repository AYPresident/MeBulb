// ===== Big-file PDF access ==============================================================
// Drawings can be hundreds of MB. Instead of loading and rewriting the whole file, MeBulb
// reads only the parts it needs (cross-reference table, catalog, page dictionaries,
// annotations) and saves by appending an incremental update to the end of the file.
// pdf.js reads page content on demand through the same byte source.

// ----- byte sources -------------------------------------------------------------------------
class MemSource {
  constructor(bytes) { this.bytes = bytes; this.size = bytes.length; this.kind = 'mem'; }
  async read(off, len) { return this.bytes.subarray(off, Math.min(this.size, off + len)); }
  async all() { return this.bytes; }
}
// Blob (a File picked in the browser) or the desktop host; small reads go through a block cache
class CachedSource {
  constructor(size, readRaw, kind) { this.size = size; this.readRaw = readRaw; this.kind = kind; this.blocks = new Map(); this.B = 1 << 16; this._all = null; }
  async read(off, len) {
    len = Math.max(0, Math.min(len, this.size - off)); if (!len) return new Uint8Array(0);
    if (this._all) return this._all.subarray(off, off + len);
    if (len > this.B * 4) return this.readRaw(off, len);
    const B = this.B; const b0 = Math.floor(off / B), b1 = Math.floor((off + len - 1) / B);
    const parts = []; for (let b = b0; b <= b1; b++) parts.push(this.block(b));
    const bl = await Promise.all(parts); const out = new Uint8Array(len); let w = 0;
    bl.forEach((blk, k) => { const start = k === 0 ? off - b0 * B : 0; const n = Math.min(blk.length - start, len - w); out.set(blk.subarray(start, start + n), w); w += n; });
    return out;
  }
  block(b) {
    let p = this.blocks.get(b); if (p) { this.blocks.delete(b); this.blocks.set(b, p); return p; }
    p = this.readRaw(b * this.B, Math.min(this.B, this.size - b * this.B)); this.blocks.set(b, p);
    if (this.blocks.size > 96) this.blocks.delete(this.blocks.keys().next().value);
    return p;
  }
  async all() { if (!this._all) this._all = await this.readRaw(0, this.size); return this._all; }
  dropAll() { this._all = null; }
}
function blobSource(blob) { const s = new CachedSource(blob.size, async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer()), 'blob'); s.blob = blob; return s; }
function hostSource(fid, size) { const s = new CachedSource(size, async (o, n) => new Uint8Array(await window.mebulbHost.read(fid, o, n)), 'host'); s.fid = fid; return s; }

// whole file in memory, only for the operations that genuinely rewrite it (page edits, text edits, OCR, forms)
async function docBytes(doc, why) {
  if (doc.src && doc.src.kind === 'mem') return doc.src.bytes;
  if (doc.bytes) return doc.bytes;
  const busy = $('#busy'); const was = busy.hidden; busy.hidden = false; busy.textContent = `${why || 'Loading the whole file'} (${Math.round(doc.src.size / 1048576)} MB)…`; await raf();
  try { doc.bytes = await doc.src.all(); return doc.bytes; } finally { busy.hidden = was; }
}

// ----- tokenizer helpers ----------------------------------------------------------------------
const latin1 = new TextDecoder('latin1');
const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
function bytesOf(str) { const b = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 255; return b; }
function concatBytes(list) { let n = 0; list.forEach((b) => { n += b.length; }); const out = new Uint8Array(n); let o = 0; list.forEach((b) => { out.set(b, o); o += b.length; }); return out; }
function lastIndexOfStr(bytes, str, from = bytes.length - str.length) {
  const p = bytesOf(str); for (let i = Math.min(from, bytes.length - p.length); i >= 0; i--) { let ok = true; for (let j = 0; j < p.length; j++) if (bytes[i + j] !== p[j]) { ok = false; break; } if (ok) return i; } return -1;
}
function indexOfStr(bytes, str, from = 0) {
  const p = bytesOf(str); const n = bytes.length - p.length; for (let i = from; i <= n; i++) { if (bytes[i] !== p[0]) continue; let ok = true; for (let j = 1; j < p.length; j++) if (bytes[i + j] !== p[j]) { ok = false; break; } if (ok) return i; } return -1;
}
// skip "12 0 obj" and return the index just after "obj"
function afterObjHeader(bytes) { const m = /^\s*(\d+)\s+(\d+)\s+obj/.exec(latin1.decode(bytes.subarray(0, 48))); return m ? m[0].length : -1; }
function pngUnpredict(data, columns, colors = 1, bpc = 8) {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8)); const row = Math.ceil((columns * colors * bpc) / 8); const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row); let prev = new Uint8Array(row);
  for (let r = 0; r < rows; r++) {
    const t = data[r * (row + 1)]; const src = data.subarray(r * (row + 1) + 1, (r + 1) * (row + 1)); const cur = out.subarray(r * row, (r + 1) * row);
    for (let i = 0; i < row; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = src[i];
      if (t === 1) v += a; else if (t === 2) v += b; else if (t === 3) v += (a + b) >> 1; else if (t === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return out;
}
function decodeStream(stream) {
  const { PDFRawStream, PDFDict, PDFArray, PDFNumber } = PDFLib;
  let data = stream instanceof PDFRawStream ? PDFLib.decodePDFRawStream(stream).decode() : stream.getContents ? stream.getContents() : stream.contents;
  let parms = stream.dict.lookup(PDFName.of('DecodeParms')); if (parms instanceof PDFArray) parms = parms.lookup(0);
  if (parms instanceof PDFDict) {
    const g = (k, d) => { const v = parms.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : d; };
    const pred = g('Predictor', 1); if (pred >= 10) data = pngUnpredict(data, g('Columns', 1), g('Colors', 1), g('BitsPerComponent', 8));
  }
  return data;
}
const nOf = (o) => (o && o.asNumber ? o.asNumber() : o == null ? null : +o);
const refKey = (r) => `${r.objectNumber} ${r.generationNumber}`;
const pdfjsRefId = (r) => (r.generationNumber ? `${r.objectNumber}R${r.generationNumber}` : `${r.objectNumber}R`);
function pdfText(o) { try { return o && o.decodeText ? o.decodeText() : o && o.asString ? o.asString() : ''; } catch { return ''; } }

// ----- reader ------------------------------------------------------------------------------------
class PdfReader {
  constructor(src) { this.src = src; this.ctx = PDFLib.PDFContext.create(); this.xref = new Map(); this.cache = new Map(); this.stms = new Map(); this.trailer = null; this.kind = 'table'; this.startxref = 0; this._pages = null; this.size = 0; }
  async init() {
    const n = Math.min(this.src.size, 2048); const tail = await this.src.read(this.src.size - n, n);
    const k = lastIndexOfStr(tail, 'startxref'); if (k < 0) throw new Error('no startxref');
    const m = /startxref\s+(\d+)/.exec(latin1.decode(tail.subarray(k))); if (!m) throw new Error('bad startxref');
    this.startxref = +m[1]; this.offsets = [];
    let off = this.startxref; const seen = new Set(); let first = true;
    while (off != null && !seen.has(off) && off >= 0 && off < this.src.size) {
      seen.add(off); this.offsets.push(off);
      const head = await this.src.read(off, 64); let i = 0; while (i < head.length && isWs(head[i])) i++;
      let trailer;
      if (latin1.decode(head.subarray(i, i + 4)) === 'xref') { trailer = await this.readTable(off + i + 4); if (first) this.kind = 'table'; const xs = nOf(trailer.lookup(PDFName.of('XRefStm'))); if (xs != null && !seen.has(xs)) { seen.add(xs); this.offsets.push(xs); await this.readXrefStream(xs); } }
      else { trailer = await this.readXrefStream(off + i); if (first) this.kind = 'stream'; }
      if (first) { this.trailer = trailer; first = false; }
      const prev = trailer.lookup(PDFName.of('Prev')); off = prev ? nOf(prev) : null;
    }
    if (!this.trailer) throw new Error('no trailer');
    this.size = nOf(this.trailer.lookup(PDFName.of('Size'))) || 0;
    this.xref.forEach((e) => { if (e.t === 1) this.offsets.push(e.off); });
    this.offsets.push(this.src.size); this.offsets = [...new Set(this.offsets)].sort((a, b) => a - b);
    this.encrypted = !!this.trailer.get(PDFName.of('Encrypt'));
    return this;
  }
  setEntry(num, e) { if (!this.xref.has(num)) this.xref.set(num, e); }
  async readTable(pos) {
    let len = 1 << 16; let buf, txt, tIdx;
    for (;;) { buf = await this.src.read(pos, len); txt = latin1.decode(buf); tIdx = txt.indexOf('trailer'); if (tIdx >= 0 || pos + len >= this.src.size) break; len *= 4; }
    if (tIdx < 0) throw new Error('xref table without trailer');
    const re = /(\d+)[ \t]+(\d+)[ \t]*[\r\n]+|(\d{1,10})[ \t]+(\d{1,5})[ \t]+([nf])/gy; let cur = 0, left = 0; let i = 0;
    const body = txt.slice(0, tIdx);
    while (i < body.length) {
      while (i < body.length && /\s/.test(body[i])) i++; if (i >= body.length) break;
      re.lastIndex = i; const mm = re.exec(body); if (!mm) break; i = re.lastIndex;
      if (mm[5]) { if (mm[5] === 'n') this.setEntry(cur, { t: 1, off: +mm[3], gen: +mm[4] }); else this.setEntry(cur, { t: 0 }); cur++; left--; }
      else if (left <= 0) { cur = +mm[1]; left = +mm[2]; }
      else { // a line that matched the subsection form but is an entry without type: treat as entry
        cur++; left--; }
    }
    const tb = buf.subarray(tIdx + 7); return PDFLib.PDFObjectParser.forBytes(tb, this.ctx).parseObject();
  }
  async readStreamObjectAt(off) {
    let head = await this.src.read(off, 4096); const h = afterObjHeader(head); if (h < 0) throw new Error('not an object at ' + off);
    let s = indexOfStr(head, 'stream', h); let tries = 0;
    while (s < 0 && tries++ < 6) { head = await this.src.read(off, head.length * 4); s = indexOfStr(head, 'stream', h); }
    if (s < 0) throw new Error('stream keyword not found');
    const dict = PDFLib.PDFObjectParser.forBytes(head.subarray(h, s), this.ctx).parseObject();
    let p = s + 6; if (head[p] === 13) p++; if (head[p] === 10) p++;
    let L = dict.lookup(PDFName.of('Length')); L = L && L.asNumber ? L.asNumber() : null;
    let data;
    if (L != null) data = await this.src.read(off + p, L);
    else { let len = 1 << 18; for (;;) { const b = await this.src.read(off + p, len); const e = indexOfStr(b, 'endstream'); if (e >= 0) { let q = e; if (b[q - 1] === 10) q--; if (b[q - 1] === 13) q--; data = b.subarray(0, q); break; } if (off + p + len >= this.src.size) { data = b; break; } len *= 4; } }
    return PDFLib.PDFRawStream.of(dict, data.slice());
  }
  async readXrefStream(off) {
    const st = await this.readStreamObjectAt(off); const d = st.dict; const data = decodeStream(st);
    const W = d.lookup(PDFName.of('W')).asArray().map(nOf); const size = nOf(d.lookup(PDFName.of('Size')));
    const idx = d.lookup(PDFName.of('Index')); const ranges = idx ? idx.asArray().map(nOf) : [0, size];
    const rec = W[0] + W[1] + W[2]; let p = 0;
    const rd = (w) => { let v = 0; for (let k = 0; k < w; k++) v = v * 256 + data[p++]; return v; };
    for (let r = 0; r < ranges.length; r += 2) {
      for (let k = 0; k < ranges[r + 1]; k++) {
        if (p + rec > data.length) break;
        const t = W[0] ? rd(W[0]) : 1; const f2 = rd(W[1]); const f3 = rd(W[2]); const num = ranges[r] + k;
        if (t === 1) this.setEntry(num, { t: 1, off: f2, gen: f3 }); else if (t === 2) this.setEntry(num, { t: 2, stm: f2, idx: f3 }); else this.setEntry(num, { t: 0 });
      }
    }
    return d;
  }
  nextOffset(off) { const a = this.offsets; let lo = 0, hi = a.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= off) lo = mid + 1; else hi = mid; } return a[lo] > off ? a[lo] : this.src.size; }
  async get(ref) { return this.getNum(ref.objectNumber); }
  async getNum(num) {
    if (this.cache.has(num)) return this.cache.get(num);
    // loaded objects also live in this.ctx so pdf-lib lookups (snapping, text) resolve them
    const p = this.load(num).then((o) => { const e = this.xref.get(num); if (o && o !== PDFLib.PDFNull) this.ctx.assign(PDFRef.of(num, e && e.t === 1 ? e.gen : 0), o); return o; });
    this.cache.set(num, p); return p;
  }
  // load everything a dictionary refers to (except the named keys) so pdf-lib's synchronous lookups work
  async pull(o, skip = ['/P', '/Parent', '/Popup', '/IRT', '/AP', '/Annots', '/Kids'], depth = 0, seen = new Set()) {
    if (depth > 12 || o == null) return;
    if (o instanceof PDFRef) { const k = refKey(o); if (seen.has(k)) return; seen.add(k); await this.pull(await this.get(o), skip, depth + 1, seen); return; }
    if (o instanceof PDFDict) { for (const [k, v] of o.entries()) if (!skip.includes(k.asString())) await this.pull(v, skip, depth + 1, seen); return; }
    if (o instanceof PDFArray) for (const v of o.asArray()) await this.pull(v, skip, depth + 1, seen);
  }
  // is this content stream one of MeBulb's own additions? (ours are tiny: big streams are never read)
  async isOwnedStream(ref) { const e = this.xref.get(ref.objectNumber); if (!e || e.t !== 1) return false; if (this.nextOffset(e.off) - e.off > 65536) return false; try { const o = await this.get(ref); return !!(o && o.dict && o.dict.get(PDFName.of('MeBulb'))); } catch { return false; } }
  // a stream's dictionary without its data (content streams of big drawings can be many MB)
  async streamHead(ref) {
    this.heads = this.heads || new Map(); const k = refKey(ref); if (this.heads.has(k)) return this.heads.get(k);
    const p = (async () => { const e = this.xref.get(ref.objectNumber); if (!e || e.t !== 1) { const o = await this.get(ref); return o && o.dict ? o.dict : null; } return (await this.readStreamHeadAt(e.off)); })().catch(() => null);
    this.heads.set(k, p); return p;
  }
  async readStreamHeadAt(off) {
    let head = await this.src.read(off, 4096); const h = afterObjHeader(head); if (h < 0) return null;
    let s = indexOfStr(head, 'stream', h); let tries = 0;
    while (s < 0 && tries++ < 6 && head.length < this.src.size - off) { head = await this.src.read(off, head.length * 4); s = indexOfStr(head, 'stream', h); }
    if (s < 0) return null; const d = PDFLib.PDFObjectParser.forBytes(head.subarray(h, s), this.ctx).parseObject(); return d instanceof PDFDict ? d : null;
  }
  // Revu's flattened markups ("Allow markup recovery"): content streams marked /BBType /Melted that keep
  // the original annotations in their own /Annots
  async meltedStreams(i) {
    const P = await this.pages(); if (!P[i]) return []; const pd = await this.get(P[i].ref); const c = pd.get(PDFName.of('Contents')); const arr = await this.resolve(c);
    const refs = arr instanceof PDFArray ? arr.asArray() : c instanceof PDFRef ? [c] : []; const out = [];
    for (const r of refs) {
      if (!(r instanceof PDFRef)) continue; const d = await this.streamHead(r); const t = d && d.get(PDFName.of('BBType')); if (!t || !t.asString || t.asString() !== '/Melted') continue;
      const a = await this.resolve(d.get(PDFName.of('Annots'))); out.push({ ref: r, annots: a instanceof PDFArray ? a.asArray().filter((x) => x instanceof PDFRef) : [] });
    }
    return out;
  }
  // drop big streams once used (content of huge drawings is re-read on demand)
  evictBig(limit = 1 << 19) { for (const [num, p] of this.cache) p.then((o) => { if (o && o.contents && o.contents.length > limit) { this.cache.delete(num); const e = this.xref.get(num); this.ctx.delete(PDFRef.of(num, e && e.t === 1 ? e.gen : 0)); } }); }
  async load(num) {
    const e = this.xref.get(num); if (!e || e.t === 0) return PDFLib.PDFNull;
    if (e.t === 1) {
      const end = this.nextOffset(e.off); const b = await this.src.read(e.off, end - e.off); const h = afterObjHeader(b); if (h < 0) throw new Error(`object ${num} not found`);
      const o = PDFLib.PDFObjectParser.forBytes(b.subarray(h), this.ctx).parseObject();
      if (o instanceof PDFLib.PDFRawStream && o.dict.get(PDFName.of('Length')) instanceof PDFRef) { // indirect length: trim to the real length
        const L = nOf(await this.resolve(o.dict.get(PDFName.of('Length')))); if (L != null && L < o.contents.length) return PDFLib.PDFRawStream.of(o.dict, o.contents.subarray(0, L));
      }
      return o;
    }
    const S = await this.objStm(e.stm); const off = S.offs.get(num); if (off == null) return PDFLib.PDFNull;
    return PDFLib.PDFObjectParser.forBytes(S.data.subarray(S.first + off), this.ctx).parseObject();
  }
  async objStm(num) {
    if (this.stms.has(num)) return this.stms.get(num);
    const p = (async () => {
      const st = await this.getNum(num); const data = decodeStream(st); const N = nOf(st.dict.lookup(PDFName.of('N'))); const first = nOf(st.dict.lookup(PDFName.of('First')));
      const nums = latin1.decode(data.subarray(0, first)).trim().split(/\s+/).map(Number); const offs = new Map(); for (let k = 0; k + 1 < nums.length && k < N * 2; k += 2) offs.set(nums[k], nums[k + 1]);
      return { data, first, offs };
    })(); this.stms.set(num, p); return p;
  }
  async resolve(o) { return o instanceof PDFRef ? this.get(o) : o; }
  async catalog() { return this.resolve(this.trailer.get(PDFName.of('Root'))); }
  // page refs in order with inherited attributes
  async pages() {
    if (this._pages) return this._pages;
    const out = []; const seen = new Set(); const cat = await this.catalog();
    const walk = async (ref, inh, depth) => {
      if (!(ref instanceof PDFRef) || seen.has(refKey(ref)) || depth > 64) return; seen.add(refKey(ref));
      const node = await this.get(ref); if (!(node instanceof PDFDict)) return;
      const I = { ...inh }; ['Resources', 'MediaBox', 'CropBox', 'Rotate'].forEach((k) => { const v = node.get(PDFName.of(k)); if (v) I[k] = v; });
      const kids = node.get(PDFName.of('Kids')); const type = node.get(PDFName.of('Type'));
      if (kids && (!type || type.asString() !== '/Page')) { const arr = await this.resolve(kids); for (const k of arr.asArray()) await walk(k, I, depth + 1); }
      else out.push({ ref, inh: I });
    };
    await walk(cat.get(PDFName.of('Pages')), {}, 0); this._pages = out; return out;
  }
  async pageDict(i) { const P = await this.pages(); return P[i] ? this.get(P[i].ref) : null; }
  // the annotations on a page and which of them MeBulb wrote
  async pageAnnots(i) {
    const P = await this.pages(); if (!P[i]) return { list: [], arrRef: null };
    const pd = await this.get(P[i].ref); const a = pd.get(PDFName.of('Annots')); const arrRef = a instanceof PDFRef ? a : null; const arr = await this.resolve(a);
    const list = []; if (!(arr instanceof PDFArray)) return { list, arrRef };
    for (const r of arr.asArray()) {
      let ours = false; if (r instanceof PDFRef) { try { const d = await this.get(r); if (d instanceof PDFDict) ours = !!(d.get(PDFName.of('MeBulbId')) || pdfText(d.get(PDFName.of('NM'))).startsWith('PM-')); } catch { } }
      list.push({ ref: r, ours });
    }
    return { list, arrRef };
  }
  // MeBulb data saved in the catalog (and the older Planmark name)
  async payload() {
    const cat = await this.catalog(); const r = cat.get(PDFName.of('MeBulbData')) || cat.get(PDFName.of('PlanmarkData')); if (!r) return null;
    const st = await this.resolve(r); return JSON.parse(new TextDecoder().decode(decodeStream(st)));
  }
  // load everything a page needs for vector snapping into one small pdf-lib context
  async partialDoc(i) {
    const P = await this.pages(); const pg = P[i]; if (!pg) return null;
    const ctx = this.ctx; const done = new Set();
    const pull = async (o, depth) => {
      if (depth > 40) return;
      if (o instanceof PDFRef) { const k = refKey(o); if (done.has(k)) return; done.add(k); const v = await this.get(o); await pull(v, depth + 1); return; }
      if (o instanceof PDFDict) { for (const [k, v] of o.entries()) { const n = k.asString(); if (n === '/Parent' || n === '/Annots' || n === '/FontFile' || n === '/FontFile2' || n === '/FontFile3' || n === '/Thumb' || n === '/Metadata' || n === '/StructParents') continue; await pull(v, depth + 1); } return; }
      if (o instanceof PDFLib.PDFStream) { const st = o.dict.get(PDFName.of('Subtype')); if (st && st.asString() === '/Image') return; await pull(o.dict, depth + 1); return; }
      if (o instanceof PDFArray) for (const v of o.asArray()) await pull(v, depth + 1);
    };
    const pd = await this.get(pg.ref); const map = new Map(pd.entries()); map.delete(PDFName.of('Parent'));
    Object.entries(pg.inh).forEach(([k, v]) => { if (!map.has(PDFName.of(k))) map.set(PDFName.of(k), v); });
    const leaf = PDFLib.PDFPageLeaf.fromMapWithContext(map, ctx); await pull(leaf, 0);
    return { context: ctx, getPage: () => ({ node: leaf }) };
  }
}
async function openReader(src) { try { return await new PdfReader(src).init(); } catch (e) { console.warn('incremental reader unavailable', e); return null; } }

// ----- hide MeBulb's own annotations already in the file (we draw live markups instead) ---------
async function hideOwnAnnots(doc, i) {
  doc._hidden = doc._hidden || new Map(); if (doc._hidden.has(i)) return doc._hidden.get(i);
  const p = (async () => {
    if (!(doc.viewReader || doc.reader) || !(doc.hasOwnAnnots || (doc.hide && doc.hide.size)) || !doc.pdf) return false;
    try { const extra = (doc.hide && doc.hide.get(i)) || new Set(); const { list } = await (doc.viewReader || doc.reader).pageAnnots(i); let n = 0; list.forEach((a) => { if (a.ref instanceof PDFRef && (a.ours || extra.has(refKey(a.ref)))) { doc.pdf.annotationStorage.setValue(pdfjsRefId(a.ref), { noView: true, noPrint: true }); n++; } }); return n > 0; } catch (e) { console.warn(e); return false; }
  })();
  doc._hidden.set(i, p); return p;
}
function annotMode(doc) { return doc.hasOwnAnnots || (doc.hide && doc.hide.size) || doc.hasForms ? pdfjsLib.AnnotationMode.ENABLE_STORAGE : pdfjsLib.AnnotationMode.ENABLE; }

// ----- incremental save ---------------------------------------------------------------------------
// Builds the bytes to append to the file: new annotation objects for pages whose markups
// changed, new versions of those page dictionaries, the catalog with fresh MeBulb data, and
// a cross-reference section that chains to the previous one.
function serializeObj(num, gen, obj) {
  const head = bytesOf(`${num} ${gen} obj\n`); const n = obj.sizeInBytes(); const body = new Uint8Array(n); obj.copyBytesInto(body, 0);
  return concatBytes([head, body, bytesOf('\nendobj\n')]);
}
async function incrementalUpdate(doc, opts = {}) {
  const R = opts.reader || doc.reader; if (!R || R.encrypted) return null;
  const out = await PDFDocument.create({ updateMetadata: false }); const ctx = out.context;
  const skip = new Set(ctx.enumerateIndirectObjects().map(([, o]) => o)); // the scratch document's own catalog and page tree
  ctx.largestObjectNumber = Math.max(ctx.largestObjectNumber, R.size - 1);
  const rewritten = []; // [ref, obj] for objects that replace existing numbers
  const fonts = fontCache(out); const imgCache = new Map(); const P = await R.pages();
  const pages = opts.pages || [...Array(doc.numPages).keys()]; const newSig = { ...(doc.ownSig || {}) }; const newVp = { ...(doc.vpSig || {}) };
  const cat = await R.catalog(); const ocp = opts.contentOnly || opts.flatten ? null : await layerOcgs(out, doc, cat.get(PDFName.of('OCProperties')), (o) => R.resolve(o));
  for (const i of pages) {
    if (!P[i] || !doc.pages[i]) continue;
    const pd = await R.get(P[i].ref); const pageDict = PDFDict.fromMapWithContext(new Map(pd.entries()), ctx); let changed = false;
    // page content: colour processing and flattened markups
    if (!opts.annotsOnly) {
      await ensureFlatKnown(doc, i);
      const mb = P[i].inh.MediaBox ? (await R.resolve(P[i].inh.MediaBox)).asArray().map(nOf) : [0, 0, 612, 792];
      const pieces = opts.stripOwned ? [] : await ownedPieces(out, doc, i, mb, fonts, imgCache, opts.flatten ? exportFlat(doc, i) : null);
      const sig = pieceSig(pieces); const melt = doc.unmelt && doc.unmelt.includes(i) ? await meltedDrop(R, i) : null;
      if (opts.flatten || opts.forceContent || melt || sig !== (newSig[i] || '')) { if (await rebuildPageContent(out, pageDict, P[i].inh.Resources, (o) => R.resolve(o), async (r) => (melt && melt.streams.has(refKey(r))) || R.isOwnedStream(r), pieces, melt && melt.xobjects)) changed = true; }
      if (!opts.flatten && !opts.contentOnly) newSig[i] = sig;
    }
    // annotations (plus any from a Revu unflatten that MeBulb cannot edit: they go back as they were)
    const back = (doc.unmeltKeep && doc.unmeltKeep[i] || []).map((k) => { const [n, g] = k.split(' ').map(Number); return PDFRef.of(n, g); });
    if (!opts.contentOnly) {
      const { list, arrRef } = await R.pageAnnots(i); const gone = (a) => a.ours || (doc.imported && a.ref instanceof PDFRef && doc.imported.has(refKey(a.ref))); const keep = list.filter((a) => !gone(a)).map((a) => a.ref);
      const have = new Set(keep.filter((r) => r instanceof PDFRef).map(refKey)); const add = back.filter((r) => !have.has(refKey(r)));
      const ms = opts.flatten ? [] : doc.markups.filter((m) => m.page === i && m.type !== 'textedit');
      const fresh = await annotsForPage(out, fonts, imgCache, doc, i, P[i].ref, ms);
      if (fresh.length || add.length || list.some(gone)) { const arr = ctx.obj([...keep, ...add, ...fresh]); if (arrRef) rewritten.push([arrRef, arr]); else { pageDict.set(PDFName.of('Annots'), arr); changed = true; } }
    } else if (back.length) { // on-screen copy: show them where they were
      const { list, arrRef } = await R.pageAnnots(i); const have = new Set(list.filter((a) => a.ref instanceof PDFRef).map((a) => refKey(a.ref))); const add = back.filter((r) => !have.has(refKey(r)));
      if (add.length) { const arr = ctx.obj([...list.map((a) => a.ref), ...add]); if (arrRef) rewritten.push([arrRef, arr]); else { pageDict.set(PDFName.of('Annots'), arr); changed = true; } }
    }
    // page scale and viewports as standard /VP (Revu reads and writes these)
    if (!opts.contentOnly && !opts.flatten) { const sig = vpSig(doc, i); if (sig !== (newVp[i] || '')) { const vp = viewportArray(ctx, doc, i); if (vp.length) pageDict.set(PDFName.of('VP'), ctx.obj(vp)); else pageDict.delete(PDFName.of('VP')); changed = true; newVp[i] = sig; } }
    if (changed) rewritten.push([P[i].ref, pageDict]);
  }
  if (!opts.flatten && !opts.contentOnly) doc.vpSigPending = newVp;
  if (!opts.flatten && !opts.contentOnly) doc.ownSigPending = newSig;
  // catalog with the MeBulb data stream
  const cmap = new Map(cat.entries()); cmap.delete(PDFName.of('PlanmarkData')); if (ocp) cmap.set(PDFName.of('OCProperties'), ocp);
  if (opts.contentOnly) { /* view patch: catalog untouched */ }
  else if (!opts.flatten) { const data = ctx.register(ctx.flateStream(new TextEncoder().encode(payloadJson(doc, opts.editApplied)), { Type: 'MeBulbData' })); cmap.set(PDFName.of('MeBulbData'), data); }
  else cmap.delete(PDFName.of('MeBulbData'));
  if (!opts.contentOnly) rewritten.push([R.trailer.get(PDFName.of('Root')), PDFDict.fromMapWithContext(cmap, ctx)]);
  fonts.finalize(); await out.flush(); // standard fonts and images are written by pdf-lib on flush

  // write the objects
  const base = opts.baseSize != null ? opts.baseSize : R.src.size; const chunks = []; let pos = base; const entries = [];
  const tailByte = (await R.src.read(R.src.size - 1, 1))[0]; if (tailByte !== 10 && tailByte !== 13) { chunks.push(bytesOf('\n')); pos += 1; }
  const put = (num, gen, obj) => { const b = serializeObj(num, gen, obj); entries.push([num, gen, pos]); chunks.push(b); pos += b.length; };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) { if (skip.has(obj)) continue; put(ref.objectNumber, ref.generationNumber, obj); }
  const reNum = new Set(); for (const [ref, obj] of rewritten) { if (!(ref instanceof PDFRef) || reNum.has(ref.objectNumber)) continue; reNum.add(ref.objectNumber); put(ref.objectNumber, ref.generationNumber, obj); }
  let size = Math.max(R.size, ctx.largestObjectNumber + 1);
  const keepKeys = ['Root', 'Info', 'ID'].map((k) => [k, R.trailer.get(PDFName.of(k))]).filter(([, v]) => v);
  const trailerBits = keepKeys.map(([k, v]) => `/${k} ${v.toString()}`).join(' ');
  const xrefAt = pos;
  if (R.kind === 'stream') {
    const xnum = size; size += 1; entries.push([xnum, 0, xrefAt]); entries.sort((a, b) => a[0] - b[0]);
    const idx = []; const rows = []; let k = 0;
    while (k < entries.length) { let j = k; while (j + 1 < entries.length && entries[j + 1][0] === entries[j][0] + 1) j++; idx.push(entries[k][0], j - k + 1); for (let q = k; q <= j; q++) rows.push(entries[q]); k = j + 1; }
    const data = new Uint8Array(rows.length * 7); rows.forEach(([, gen, off], r) => { const o = r * 7; data[o] = 1; data[o + 1] = (off >>> 24) & 255; data[o + 2] = (off >>> 16) & 255; data[o + 3] = (off >>> 8) & 255; data[o + 4] = off & 255; data[o + 5] = (gen >> 8) & 255; data[o + 6] = gen & 255; });
    const dict = `<< /Type /XRef /Size ${size} /W [1 4 2] /Index [${idx.join(' ')}] /Prev ${R.startxref} ${trailerBits} /Length ${data.length} >>`;
    chunks.push(concatBytes([bytesOf(`${xnum} 0 obj\n${dict}\nstream\n`), data, bytesOf(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`)]));
  } else {
    entries.sort((a, b) => a[0] - b[0]); let s = 'xref\n'; let k = 0;
    while (k < entries.length) { let j = k; while (j + 1 < entries.length && entries[j + 1][0] === entries[j][0] + 1) j++; s += `${entries[k][0]} ${j - k + 1}\n`; for (let q = k; q <= j; q++) s += `${String(entries[q][2]).padStart(10, '0')} ${String(entries[q][1]).padStart(5, '0')} n\r\n`; k = j + 1; }
    s += `trailer\n<< /Size ${size} ${trailerBits} /Prev ${R.startxref} >>\nstartxref\n${xrefAt}\n%%EOF\n`; chunks.push(bytesOf(s));
  }
  return { bytes: concatBytes(chunks), startxref: xrefAt, size, kind: R.kind };
}
function payloadJson(doc, editApplied) {
  const markups = doc.markups.map((m) => (m.type === 'textedit' ? { ...m, applied: !!(editApplied && editApplied.get(m.id)) } : m));
  const ownSig = doc.ownSigPending || doc.ownSig || {}; const flat = (doc.flat || []).map((f) => ({ id: f.id, page: f.page }));
  const S = doc.sess; const tomb = S ? Object.fromEntries([...S.tomb].filter(([, t]) => Date.now() - t < 30 * 864e5)) : doc.tomb || undefined;
  return JSON.stringify({ v: 3, app: 'MeBulb', saved: nowISO(), savedBy: state.author, savedById: S ? S.uid : undefined, tomb, markups, scales: doc.scales, layers: doc.layers, links: doc.links || {}, viewports: doc.viewports || {}, align: doc.align || null, colorAdj: doc.colorAdj || null, ownSig, vpSig: doc.vpSigPending || doc.vpSig || {}, flat, assets: usedAssets(doc), written: doc.markups.filter((m) => m.type !== 'textedit').map((m) => m.id) });
}
// can this save be an append, or does it need the whole file rewritten?
function needsRewrite(doc) {
  if (!doc.reader || doc.reader.encrypted) return 'reader';
  if (doc.markups.some((m) => m.type === 'textedit')) return 'text edits';
  if (doc.ocr && Object.keys(doc.ocr).length) return 'OCR';
  if (doc.formValues && Object.keys(doc.formValues).length) return 'form values';
  if (doc.srcChanged) return 'page changes';
  return '';
}

// stamp artwork still used by a markup (or a flattened one)
function usedAssets(doc) { const A = doc.assets || {}; const used = {}; [...doc.markups, ...(doc.flat || []).flatMap((f) => f.markups)].forEach((m) => { if (m.asset && A[m.asset]) used[m.asset] = A[m.asset]; }); return Object.keys(used).length ? used : undefined; }
