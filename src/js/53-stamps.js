// ===== Stamps ==================================================================================
// Text stamps (APPROVED, REVIEWED, …) plus your own stamps designed as PDFs. A PDF stamp can
// have form fields: when you place it MeBulb asks for their values in a popup, the way a
// dynamic stamp does. Acrobat-style stamp JavaScript (app.response prompts, identity.name,
// util.printd dates, event.source.forReal …) runs in an isolated worker with no access to the
// page, files or network. The filled stamp is drawn into the PDF as vector artwork.
const STAMPLIB = { list: [], ready: null, cache: new Map() };
const STAMP_DB = 'mebulb-stamps';

// ----- storage: AppData + an optional shared team folder (desktop), IndexedDB (browser) ----------
function idb() { return new Promise((res, rej) => { const r = indexedDB.open(STAMP_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('stamps', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbAll() { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('stamps').objectStore('stamps').getAll(); t.onsuccess = () => res(t.result || []); t.onerror = () => rej(t.error); }); }
async function idbPut(v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('stamps', 'readwrite').objectStore('stamps').put(v); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }
async function idbDel(id) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('stamps', 'readwrite').objectStore('stamps').delete(id); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }
async function loadStampLibrary(force) {
  if (STAMPLIB.ready && !force) return STAMPLIB.ready;
  STAMPLIB.ready = (async () => {
    const list = STAMPS.map((t) => ({ id: 'txt:' + t, name: t.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase()), kind: 'text', text: t }));
    (store.get('textStamps', []) || []).forEach((s) => list.push({ ...s, kind: 'text' }));
    const H = HOST();
    try {
      if (H && H.stampList) { for (const f of await H.stampList(state.prefs.stampFolder || '')) list.push({ id: 'file:' + f.path, name: f.name.replace(/\.(pdf|brx)$/i, ''), kind: 'pdf', path: f.path, shared: f.shared, size: f.size }); }
      else if (window.indexedDB) { for (const s of await idbAll()) list.push({ id: s.id, name: s.name, kind: 'pdf', bytes: s.bytes }); }
    } catch (e) { console.warn('stamp library', e); }
    STAMPLIB.list = list; return list;
  })();
  return STAMPLIB.ready;
}
async function stampBytes(st) { if (st.bytes) return st.bytes; if (st.path) { st.bytes = new Uint8Array(await HOST().stampRead(st.path)); return st.bytes; } return null; }
async function importStampFiles(files) {
  const H = HOST(); let n = 0;
  for (const f of files) {
    let bytes = new Uint8Array(await f.arrayBuffer()); if (bytes[0] === 0x50 && bytes[1] === 0x4b) bytes = (await unzipFirstPdf(bytes)) || bytes;
    if (!isPdfBytes(bytes)) { toast(`${f.name} is not a PDF or Bluebeam stamp`, 'error'); continue; }
    const name = f.name.replace(/\.(pdf|brx)$/i, '');
    if (H && H.stampAdd) await H.stampAdd(f.name.replace(/\.brx$/i, '.pdf'), bytes); else await idbPut({ id: uid('ST-'), name, bytes });
    n++;
  }
  await loadStampLibrary(true); if (n) toast(`Added ${n} stamp${n === 1 ? '' : 's'}`); return n;
}
const isPdfBytes = (b) => { const h = new TextDecoder('latin1').decode(b.subarray(0, 1024)); return h.includes('%PDF-'); };

// ----- what is inside a PDF stamp: size, fields, scripts ----------------------------------------------
async function analyseStamp(st) {
  if (STAMPLIB.cache.has(st.id)) return STAMPLIB.cache.get(st.id);
  const p = (async () => {
    const bytes = await stampBytes(st); const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const page = pdf.getPage(0); const { width: w, height: h } = page.getSize(); const fields = []; const scripts = [];
    const jsOf = (a) => { if (!(a instanceof PDFDict)) return ''; const s = a.lookup(PDFName.of('S')); if (!s || s.asString() !== '/JavaScript') return ''; const js = a.lookup(PDFName.of('JS')); return js ? (js.decodeText ? js.decodeText() : new TextDecoder().decode(decodeStream(js))) : ''; };
    try {
      for (const f of pdf.getForm().getFields()) {
        const d = f.acroField.dict; const name = f.getName(); const tu = pdfText(d.lookup(PDFName.of('TU'))); const type = f.constructor.name.replace(/^PDF|Field$/g, '');
        const aa = d.lookup(PDFName.of('AA')); const calc = aa instanceof PDFDict ? jsOf(aa.lookup(PDFName.of('C'))) : ''; const fmt = aa instanceof PDFDict ? jsOf(aa.lookup(PDFName.of('F'))) : '';
        let value = ''; try { value = f.getText ? f.getText() || '' : ''; } catch { }
        fields.push({ name, label: tu || name, type, value, ro: f.isReadOnly ? f.isReadOnly() : false }); if (calc) scripts.push({ field: name, code: calc }); if (fmt) scripts.push({ field: name, code: fmt, format: true });
      }
    } catch (e) { console.warn('stamp form', e); }
    const docJs = []; try { const names = pdf.catalog.lookup(PDFName.of('Names')); const jsTree = names instanceof PDFDict ? names.lookup(PDFName.of('JavaScript')) : null; const walk = (n) => { if (!(n instanceof PDFDict)) return; const arr = n.lookup(PDFName.of('Names')); if (arr instanceof PDFArray) for (let k = 1; k < arr.size(); k += 2) { const c = jsOf(arr.lookup(k)); if (c) docJs.push(c); } const kids = n.lookup(PDFName.of('Kids')); if (kids instanceof PDFArray) for (let k = 0; k < kids.size(); k++) walk(kids.lookup(k)); }; walk(jsTree); } catch { }
    // Acrobat dynamic stamps check event.source.stampName against the page's name ("#…")
    let apName = ''; try { const names = pdf.catalog.lookup(PDFName.of('Names')); const pg = names instanceof PDFDict ? names.lookup(PDFName.of('Pages')) : null; const arr = pg instanceof PDFDict ? pg.lookup(PDFName.of('Names')) : null; if (arr instanceof PDFArray && arr.size()) apName = pdfText(arr.lookup(0)); } catch { }
    return { w, h, fields, scripts, docJs, apName, hasJs: scripts.length > 0 || docJs.length > 0 };
  })();
  STAMPLIB.cache.set(st.id, p); return p;
}

// ----- the stamp JavaScript sandbox ------------------------------------------------------------------
const STAMP_SANDBOX = `
self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.importScripts = undefined; self.EventSource = undefined; self.indexedDB = undefined; self.caches = undefined;
const pad = (n, w) => String(n).padStart(w, '0');
const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'], DAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function printd(f, d) {
  if (!(d instanceof Date)) d = new Date(d); if (typeof f === 'number') f = ['ddd mmm d, yyyy', 'yyyy.mm.dd HH:MM:ss', 'yyyy/mm/dd'][f] || 'yyyy/mm/dd';
  return String(f).replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|HH|H|hh|h|MM|M|ss|s|tt|t/g, (t) => ({ yyyy: d.getFullYear(), yy: pad(d.getFullYear() % 100, 2), mmmm: MON[d.getMonth()], mmm: MON[d.getMonth()].slice(0, 3), mm: pad(d.getMonth() + 1, 2), m: d.getMonth() + 1, dddd: DAY[d.getDay()], ddd: DAY[d.getDay()].slice(0, 3), dd: pad(d.getDate(), 2), d: d.getDate(), HH: pad(d.getHours(), 2), H: d.getHours(), hh: pad(d.getHours() % 12 || 12, 2), h: d.getHours() % 12 || 12, MM: pad(d.getMinutes(), 2), M: d.getMinutes(), ss: pad(d.getSeconds(), 2), s: d.getSeconds(), tt: d.getHours() < 12 ? 'am' : 'pm', t: d.getHours() < 12 ? 'a' : 'p' }[t]));
}
self.onmessage = (e) => {
  const { docJs, scripts, fields: F, answers, author, stampName } = e.data; const prompts = []; let ai = 0; const fields = {};
  F.forEach((f) => { fields[f.name] = { name: f.name, value: f.value || '', valueAsString: f.value || '', display: 0, readonly: false, userName: f.label }; });
  const getField = (n) => fields[n] || (fields[n] = { name: n, value: '', valueAsString: '' });
  const app = { response(q, t, d) { if (q && typeof q === 'object') { t = q.cTitle; d = q.cDefault; q = q.cQuestion; } prompts.push({ q: String(q == null ? '' : q), t: String(t == null ? '' : t), d: d == null ? '' : String(d) }); const a = answers ? answers[ai] : undefined; ai++; return a !== undefined ? a : d == null ? '' : String(d); },
    alert() { return 1; }, beep() {},
    // dialogs built with app.execDialog (Bluebeam's interactive stamp template): their text boxes become our prompts
    execDialog(desc) {
      const els = []; const walk = (list, label) => { (list || []).forEach((el) => { if (el.type === 'static_text') label = el.name; if (el.type === 'edit_text') els.push({ id: el.item_id, label: el.name || label || el.item_id }); if (el.elements) walk(el.elements, label); }); };
      walk(desc && desc.description && desc.description.elements); const defaults = {}; const vals = {};
      const dlg = { load(o) { Object.assign(defaults, o); }, store() { return { ...defaults, ...vals }; }, enable() {}, visible() {}, end() {}, setForeColorRed() {} };
      try { if (desc.initialize) desc.initialize(dlg); } catch (err) { /* ignore */ }
      els.forEach((el) => { prompts.push({ q: String(el.label), t: String((desc.description && desc.description.name) || ''), d: defaults[el.id] == null ? '' : String(defaults[el.id]) }); const a = answers ? answers[ai] : undefined; ai++; vals[el.id] = a !== undefined ? a : defaults[el.id] == null ? '' : defaults[el.id]; });
      if (!answers) return 'cancel'; try { if (desc.commit) desc.commit(dlg); } catch (err) { /* ignore */ } return 'ok';
    }, viewerType: 'Exchange-Pro', viewerVariation: 'Full', viewerVersion: 21, platform: 'WIN', language: 'ENU', setTimeOut() {}, setInterval() {}, clearTimeOut() {}, clearInterval() {} };
  const identity = { name: author, loginName: author, corporation: '', email: '' }; const Collab = { user: author };
  const util = { printd, printf: (f, ...a) => String(f).replace(/%[0-9.,+]*[dfsx]/g, () => String(a.shift())), scand: (f, s) => new Date(s) };
  const target = { info: { Author: author, Title: '', Subject: '' }, documentFileName: '', path: '' };
  const doc = { getField, info: { Author: author, Title: stampName, Subject: '' }, author, title: stampName, documentFileName: stampName + '.pdf', path: '/', numPages: 1, calculateNow() {}, resetForm() {} };
  const consoleShim = { println() {}, show() {}, clear() {} };
  const run = (code, event) => { try { new Function('app', 'identity', 'util', 'event', 'console', 'global', 'Collab', code).call(doc, app, identity, util, event, consoleShim, {}, Collab); } catch (err) { /* a script error leaves that field as it was */ } };
  const source = { forReal: true, stampName, source: target };
  // document-level scripts (dialog builders, helper functions) share scope with each field script
  const prefix = (docJs || []).join('\\n;\\n') + '\\n;\\n';
  if (!scripts.length) run(prefix, { source, rc: true });
  scripts.filter((s) => !s.format).forEach((s) => { const f = getField(s.field); const event = { value: f.value, target: f, source, rc: true, name: 'Calculate', type: 'Field' }; const v0 = event.value; run(prefix + s.code, event); if (event.rc !== false && event.value !== undefined && event.value !== v0) f.value = event.value; });
  scripts.filter((s) => s.format).forEach((s) => { const f = getField(s.field); const event = { value: f.value, target: f, source, rc: true, name: 'Format', type: 'Field' }; run(prefix + s.code, event); if (event.value !== undefined) f.formatted = event.value; });
  postMessage({ prompts, values: Object.fromEntries(Object.values(fields).map((f) => [f.name, String(f.formatted !== undefined ? f.formatted : f.value == null ? '' : f.value)])) });
};`;
function runStampScripts(info, st, answers) {
  return new Promise((resolve) => {
    let w; try { w = new Worker(URL.createObjectURL(new Blob([STAMP_SANDBOX], { type: 'text/javascript' }))); } catch (e) { resolve(null); return; }
    const t = setTimeout(() => { w.terminate(); resolve(null); }, 3000); // runaway scripts are stopped
    w.onmessage = (e) => { clearTimeout(t); w.terminate(); resolve(e.data); }; w.onerror = () => { clearTimeout(t); w.terminate(); resolve(null); };
    w.postMessage({ docJs: info.docJs, scripts: info.scripts, fields: info.fields, answers, author: state.author, stampName: info.apName || st.name });
  });
}
// guesses for stamps without scripts: dates get today, names get you
function fieldDefault(f) { const n = (f.name + ' ' + f.label).toLowerCase(); if (/date/.test(n)) return new Date().toLocaleDateString(); if (/\btime\b/.test(n)) return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); if (/name|by|author|reviewer|checked|approved/.test(n)) return state.author; return f.value || ''; }

// ask for the stamp's values: prompts from its scripts, otherwise its text fields
async function stampValues(st, prev) {
  const info = await analyseStamp(st); const text = info.fields.filter((f) => f.type === 'Text' && !f.ro);
  let prompts = []; let base = null;
  if (info.hasJs) { const r1 = await runStampScripts(info, st, null); if (r1) { prompts = r1.prompts; base = r1.values; } }
  const ask = prompts.length ? prompts.map((p, k) => ({ key: 'p' + k, label: p.q || p.t || `Value ${k + 1}`, value: prev && prev.answers ? prev.answers[k] : p.d }))
    : text.map((f) => ({ key: 'f:' + f.name, label: f.label, value: prev && prev.values ? prev.values[f.name] : base && base[f.name] ? base[f.name] : fieldDefault(f) }));
  if (!ask.length) return { values: base || {}, answers: [] };
  const r = await openDialog({ title: st.name, body: `<p class="muted">Fill in the stamp.</p>${ask.map((a) => field(esc(a.label), `<input type="text" name="${esc(a.key)}" value="${esc(a.value || '')}">`)).join('')}`, buttons: [{ label: 'Cancel', value: false }, { label: 'Stamp', value: true, primary: true }] });
  if (!r || !r.value) return null;
  if (prompts.length) { const answers = prompts.map((p, k) => r.form['p' + k] || ''); const r2 = await runStampScripts(info, st, answers); return { values: (r2 && r2.values) || {}, answers }; }
  const values = {}; text.forEach((f) => { values[f.name] = r.form['f:' + f.name] || ''; }); return { values, answers: [] };
}
// the stamp with its fields filled in and flattened: one vector page
async function fillStamp(st, values) {
  const pdf = await PDFDocument.load(await stampBytes(st), { ignoreEncryption: true, updateMetadata: false });
  try { const form = pdf.getForm(); Object.entries(values || {}).forEach(([k, v]) => { try { const f = form.getField(k); if (f.setText) f.setText(String(v)); else if (f.select) f.select(String(v)); } catch { } }); form.flatten(); } catch (e) { console.warn('fill stamp', e); }
  while (pdf.getPageCount() > 1) pdf.removePage(1);
  // Bluebeam stamps are drawn with annotations on a blank page: bake those in, with &[Date]-style text filled
  bakeStampAnnots(pdf, pdf.getPage(0), stampTokens());
  return pdf.save();
}
// Bluebeam dynamic text: &[Date], &[Time], &[User], &[File] …
function stampTokens() {
  const d = new Date(); const doc = activeDoc(); const name = doc ? doc.name : ''; const p2 = (n) => String(n).padStart(2, '0');
  const M = d.toLocaleDateString(undefined, { month: 'long' });
  return { date: d.toLocaleDateString(), time: d.toLocaleTimeString(), user: state.author, author: state.author, file: name, filewithoutextension: name.replace(/\.pdf$/i, ''), filenoext: name.replace(/\.pdf$/i, ''), path: doc && doc.path ? doc.path : name, day: p2(d.getDate()), month: p2(d.getMonth() + 1), monthname: M, mon: M.slice(0, 3), year: String(d.getFullYear()), yy: p2(d.getFullYear() % 100), hour: p2(d.getHours()), minute: p2(d.getMinutes()), minutes: p2(d.getMinutes()), second: p2(d.getSeconds()), seconds: p2(d.getSeconds()) };
}
function fillTokens(str, T) { return str.replace(/&\[([A-Za-z ]+)\]/g, (all, k) => { const v = T[k.toLowerCase().replace(/\s+/g, '')]; return v == null ? all : v; }); }
// draw each annotation's appearance into the page content (as a viewer would), then drop the annotations
function bakeStampAnnots(pdf, page, T) {
  const ctx = pdf.context; const annots = page.node.Annots(); if (!annots || !annots.size()) { tokensInContent(pdf, page, T); return; }
  const ops = []; const xo = {}; let n = 0;
  for (let k = 0; k < annots.size(); k++) {
    const a = annots.lookup(k); if (!(a instanceof PDFDict)) continue; const sub = a.lookup(PDFName.of('Subtype')); if (sub && ['/Popup', '/Widget', '/Link'].includes(sub.asString())) continue;
    let ap = a.lookup(PDFName.of('AP')); ap = ap instanceof PDFDict ? ap.lookup(PDFName.of('N')) : null; if (ap instanceof PDFDict && !(ap instanceof PDFLib.PDFStream)) { const as = a.lookup(PDFName.of('AS')); ap = as ? ap.lookup(as) : null; }
    if (!ap || !ap.dict) continue; const rect = a.lookup(PDFName.of('Rect')); if (!rect) continue; const R = rect.asArray().map(nOf);
    const bb = (ap.dict.lookup(PDFName.of('BBox')) || PDFArray.withContext(ctx)).asArray().map(nOf); const mt = ap.dict.lookup(PDFName.of('Matrix')); const M = mt ? mt.asArray().map(nOf) : [1, 0, 0, 1, 0, 0];
    if (bb.length < 4) continue; const pts = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]); const tb = G.bbox(pts);
    const sx = tb.w ? (R[2] - R[0]) / tb.w : 1, sy = tb.h ? (R[3] - R[1]) / tb.h : 1; const A = [sx, 0, 0, sy, R[0] - tb.x * sx, R[1] - tb.y * sy];
    let form = ap; // fill Bluebeam dynamic text inside the appearance
    try { const raw = new TextDecoder('latin1').decode(decodeStream(ap)); if (/&\[/.test(raw)) { const t = fillTokens(raw, T); const d = new Map(ap.dict.entries()); d.delete(PDFName.of('Filter')); d.delete(PDFName.of('DecodeParms')); d.delete(PDFName.of('Length')); form = PDFLib.PDFRawStream.of(PDFDict.fromMapWithContext(d, ctx), bytesOf(t)); } } catch { }
    const name = `BA${++n}`; xo[name] = ctx.register(form); ops.push(`q ${A.map((v) => num(v, 5)).join(' ')} cm /${name} Do Q`);
  }
  if (ops.length) {
    const res = page.node.Resources() || ctx.obj({}); let X = res.lookup(PDFName.of('XObject')); if (!(X instanceof PDFDict)) { X = ctx.obj({}); res.set(PDFName.of('XObject'), X); }
    Object.entries(xo).forEach(([k, v]) => X.set(PDFName.of(k), v)); page.node.set(PDFName.of('Resources'), res);
    const s = ctx.register(ctx.stream(`q\n${ops.join('\n')}\nQ\n`)); const c = page.node.get(PDFName.of('Contents'));
    page.node.set(PDFName.of('Contents'), c ? ctx.obj([c instanceof PDFArray ? c.asArray() : c, s].flat()) : s);
  }
  page.node.delete(PDFName.of('Annots')); tokensInContent(pdf, page, T);
}
function tokensInContent(pdf, page, T) {
  const ctx = pdf.context; const c = page.node.Contents(); const list = c instanceof PDFArray ? c.asArray().map((r) => ({ ref: r, st: ctx.lookup(r) })) : c ? [{ ref: page.node.get(PDFName.of('Contents')), st: c }] : [];
  for (const { ref, st } of list) { try { const raw = new TextDecoder('latin1').decode(decodeStream(st)); if (!/&\[/.test(raw) || !(ref instanceof PDFRef)) continue; ctx.assign(ref, ctx.stream(bytesOf(fillTokens(raw, T)))); } catch { } }
}
// stamp artwork lives once per document (doc.assets, saved in the MeBulb data); markups point at it
async function addStampAsset(doc, bytes) {
  const b64 = bytesToB64(bytes); let h = 0; for (let i = 0; i < b64.length; i += 7) h = (h * 31 + b64.charCodeAt(i)) >>> 0; const id = 'A' + h.toString(36) + b64.length.toString(36);
  doc.assets = doc.assets || {}; if (!doc.assets[id]) { const pdf = await PDFDocument.load(bytes); const { width, height } = pdf.getPage(0).getSize(); doc.assets[id] = { pdf: b64, w: width, h: height }; }
  await assetImage(doc, id); return id;
}
function bytesToB64(b) { let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); }
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// screen image of an asset (rendered once, kept in memory)
async function assetImage(doc, id) {
  doc.assetImg = doc.assetImg || {}; if (doc.assetImg[id]) return doc.assetImg[id]; const A = doc.assets && doc.assets[id]; if (!A) return null;
  const task = pdfjsLib.getDocument({ data: b64ToBytes(A.pdf), isEvalSupported: false, ...PDFJS_ASSETS }); const pdf = await task.promise; const page = await pdf.getPage(1);
  const s = Math.min(4, 1600 / Math.max(A.w, A.h)); const vp = page.getViewport({ scale: s }); const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), canvas: c, viewport: vp, background: 'rgba(0,0,0,0)' }).promise; task.destroy();
  doc.assetImg[id] = c.toDataURL('image/png'); return doc.assetImg[id];
}
async function ensureAssetImages(doc) { for (const id of Object.keys(doc.assets || {})) await assetImage(doc, id).catch((e) => console.warn(e)); }

// ----- placing ---------------------------------------------------------------------------------------------
function currentStamp() { return STAMPLIB.list.find((s) => s.id === state.stampId) || null; }
async function placeStamp(doc, i, p) {
  await loadStampLibrary(); const st = currentStamp();
  if (!st || st.kind === 'text') { const txt = st ? st.text : state.stampText; const size = 20; const w = textWidth(txt, size, true) + 30, h = size * 2.1; const m = newDraftMarkup('stamp', i, [[p[0] - w / 2, p[1] - h / 2], [p[0] + w / 2, p[1] + h / 2]]); m.text = txt; if (st && st.style) m.style = { ...m.style, ...st.style }; if (st && st.sub) m.stampSub = st.sub; return m; }
  const vals = await stampValues(st); if (!vals) return null;
  const busy = $('#busy'); busy.hidden = false; busy.textContent = 'Preparing stamp…';
  try {
    const bytes = await fillStamp(st, vals.values); const asset = await addStampAsset(doc, bytes); const A = doc.assets[asset];
    const k = Math.min(1, 220 / Math.max(A.w, A.h)) || 1; const w = A.w * k, h = A.h * k;
    const m = newDraftMarkup('stamp', i, [[p[0] - w / 2, p[1] - h / 2], [p[0] + w / 2, p[1] + h / 2]]); Object.assign(m, { text: st.name, asset, stampId: st.id, stampValues: vals.values, stampAnswers: vals.answers });
    return m;
  } finally { busy.hidden = true; }
}
// double-click a placed PDF stamp: change its fields
async function editStampFields(m) {
  const doc = activeDoc(); await loadStampLibrary(); const st = STAMPLIB.list.find((s) => s.id === m.stampId); if (!st) { toast('That stamp is not in your stamp library on this PC'); return; }
  const vals = await stampValues(st, { values: m.stampValues, answers: m.stampAnswers }); if (!vals) return;
  pushUndo(doc); const bytes = await fillStamp(st, vals.values); m.asset = await addStampAsset(doc, bytes); m.stampValues = vals.values; m.stampAnswers = vals.answers; touch(m); renderMarkupEl(m, doc); refreshPanels();
}

// ----- stamp library dialog ------------------------------------------------------------------------------------
async function stampsDialog() {
  await loadStampLibrary(true); const H = HOST();
  const row = (s) => `<div class="st-row${s.id === state.stampId ? ' on' : ''}" data-st="${esc(s.id)}"><span class="st-prev" data-prev="${esc(s.id)}">${s.kind === 'text' ? `<span class="st-txt">${esc(s.text)}</span>` : ''}</span><span class="st-name">${esc(s.name)}${s.shared ? ' <span class="tag">team</span>' : ''}</span>${s.kind === 'pdf' && !s.shared ? `<button type="button" class="icon-btn sm" data-st-del="${esc(s.id)}" title="Remove" aria-label="Remove ${esc(s.name)}">${icon('trash')}</button>` : ''}</div>`;
  const body = () => `<p class="muted">Pick the stamp to use, or add your own. PDF stamps with form fields ask for their values when placed; their JavaScript (Acrobat-style dynamic stamps) runs isolated from the rest of MeBulb.</p>
    <div class="st-list">${STAMPLIB.list.map(row).join('')}</div>
    <div class="btn-row"><button type="button" class="btn sm" data-sa2="import">${icon('insert')} Import PDF or Bluebeam stamp…</button><button type="button" class="btn sm" data-sa2="text">${icon('plus')} New text stamp…</button></div>
    <div class="btn-row" id="st-newtext" hidden><input type="text" placeholder="Stamp text, e.g. CHECKED" maxlength="40" aria-label="New stamp text"><button type="button" class="btn sm primary" data-sa2="addtext">Add</button></div>
    ${H ? `<div class="field"><label>Team stamp folder (for example on the Egnyte drive)</label><div class="btn-row"><input type="text" readonly value="${esc(state.prefs.stampFolder || 'Not set')}"><button type="button" class="btn sm" data-sa2="folder">Choose…</button>${state.prefs.stampFolder ? '<button type="button" class="btn sm" data-sa2="nofolder">Clear</button>' : ''}</div></div>` : ''}`;
  await openDialog({ title: 'Stamps', wide: true, body: body(), buttons: [{ label: 'Done', value: true, primary: true }], onOpen: (box) => {
    const form = box.querySelector('#dlg-form'); const redraw = async () => { form.innerHTML = body(); previews(); }; const previews = () => form.querySelectorAll('[data-prev]').forEach(async (el) => { const st = STAMPLIB.list.find((s) => s.id === el.dataset.prev); if (!st || st.kind !== 'pdf') return; try { el.innerHTML = `<img alt="" src="${await stampPreview(st)}">`; } catch { el.textContent = 'PDF'; } });
    previews();
    form.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-st-del]'); if (del) { const st = STAMPLIB.list.find((s) => s.id === del.dataset.stDel); if (st && (await confirmDialog('Remove stamp?', `Remove <b>${esc(st.name)}</b> from your stamps?`, 'Remove', true))) { if (st.path) await H.stampRemove(st.path); else await idbDel(st.id); await loadStampLibrary(true); redraw(); } return; }
      const rowEl = e.target.closest('[data-st]'); if (rowEl) { state.stampId = rowEl.dataset.st; store.set('stampId', state.stampId); const st = currentStamp(); if (st && st.kind === 'text') state.stampText = st.text; form.querySelectorAll('.st-row').forEach((x) => x.classList.toggle('on', x === rowEl)); setTool('stamp'); return; }
      const b = e.target.closest('[data-sa2]'); if (!b) return; const a = b.dataset.sa2;
      if (a === 'import') { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf,.brx,application/pdf'; inp.multiple = true; inp.onchange = async () => { await importStampFiles([...inp.files]); redraw(); }; inp.click(); }
      if (a === 'folder') { const p = await H.pickFolder(); if (p) { state.prefs.stampFolder = p; savePrefs(); await loadStampLibrary(true); redraw(); } }
      if (a === 'nofolder') { state.prefs.stampFolder = ''; savePrefs(); await loadStampLibrary(true); redraw(); }
      if (a === 'text') { const t = form.querySelector('#st-newtext'); if (t) { t.hidden = false; t.querySelector('input').focus(); } }
      if (a === 'addtext') { const inp = form.querySelector('#st-newtext input'); const t = (inp.value || '').trim(); if (t) { const list = store.get('textStamps', []); list.push({ id: 'utxt:' + uid(''), name: t, text: t.toUpperCase() }); store.set('textStamps', list); await loadStampLibrary(true); redraw(); } }
    });
  } });
}
async function stampPreview(st) { const bytes = await stampBytes(st); const tmp = { assets: { p: { pdf: bytesToB64(bytes), w: 1, h: 1 } } }; const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true }); const { width, height } = pdf.getPage(0).getSize(); tmp.assets.p.w = width; tmp.assets.p.h = height; return assetImage(tmp, 'p'); }

// minimal zip reader: the first .pdf inside (stored or deflated)
async function unzipFirstPdf(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let e = b.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) return null;
  let p = dv.getUint32(e + 16, true); const n = dv.getUint16(e + 10, true);
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) return null; const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (!/\.pdf$/i.test(name)) continue; const d0 = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true); const data = b.subarray(d0, d0 + csize);
    if (method === 0) return data.slice(); if (method !== 8) return null;
    const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer(); return new Uint8Array(out);
  }
  return null;
}
