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
    const jsOf = (a) => { if (!(a instanceof PDFDict)) return ''; const s = a.lookup(PDFName.of('S')); if (!s || s.asString() !== '/JavaScript') return ''; const js = a.lookup(PDFName.of('JS')); return js ? (js.decodeText ? js.decodeText() : jsText(decodeStream(js))) : ''; };
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

// script text in a stream: UTF-16 with a byte-order mark (as Revu writes it), else UTF-8 / PDFDocEncoding
function jsText(b) {
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2)); if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('latin1').decode(b); }
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
  const alerts = []; let invalid = null;
  const app = { response(q, t, d) { if (q && typeof q === 'object') { t = q.cTitle; d = q.cDefault; q = q.cQuestion; } prompts.push({ kind: 'response', q: String(q == null ? '' : q), t: String(t == null ? '' : t), d: d == null ? '' : String(d) }); const a = answers ? answers[ai] : undefined; ai++; return a !== undefined ? a : d == null ? '' : String(d); },
    alert(m) { alerts.push(String(m && typeof m === 'object' ? m.cMsg : m)); return 1; }, beep() {},
    // Acrobat dialogs (app.execDialog), as used by Bluebeam's and Acrobat's interactive stamps: the first run
    // describes the dialog for MeBulb to show; the second run gets the answers, validates and commits them
    execDialog(desc) {
      const D = desc && desc.description || {}; const controls = [];
      const walk = (list, ctx) => { let label = ''; (list || []).forEach((el) => {
        if (!el || typeof el !== 'object') return; const t = String(el.type || '');
        if (t === 'static_text') { label = el.name || ''; if (!(list || []).some((x) => x && x.type === 'edit_text')) controls.push({ type: 'text', label: el.name || '', cluster: ctx }); }
        else if (t === 'edit_text') { controls.push({ type: 'edit', id: el.item_id, label: el.name || label || '', multi: !!el.multiline, cluster: ctx }); label = ''; }
        else if (t === 'radio') controls.push({ type: 'radio', id: el.item_id, label: el.name || '', group: el.group_id || 'g', cluster: ctx });
        else if (t === 'check_box') controls.push({ type: 'check', id: el.item_id, label: el.name || '', cluster: ctx });
        else if (t === 'popup' || t === 'list_box') controls.push({ type: 'list', id: el.item_id, label: el.name || label || '', cluster: ctx });
        if (el.elements) walk(el.elements, t === 'cluster' ? (el.name || ctx) : ctx);
      }); };
      walk(D.elements, ''); const defaults = {}; const vals = {};
      const dlg = { load(o) { Object.assign(defaults, o || {}); }, store() { return { ...defaults, ...vals }; }, enable() {}, visible() {}, end() {}, setForeColorRed() {}, setForeColorBlack() {}, gotoNextTab() {} };
      try { if (desc.initialize) desc.initialize(dlg); } catch (err) { /* ignore */ }
      // list items come in through load(): { "Item": -1, "Chosen": 1 }
      controls.forEach((c) => { if (c.type === 'list') { const v = defaults[c.id]; c.items = v && typeof v === 'object' ? Object.keys(v) : []; c.d = v && typeof v === 'object' ? (Object.keys(v).find((k) => v[k] > 0) || '') : ''; } else if (c.id) c.d = defaults[c.id]; });
      const k = ai; prompts.push({ kind: 'dialog', t: String(D.name || 'Stamp'), controls }); const a = answers ? answers[k] : undefined; ai++;
      if (!a || typeof a !== 'object') return 'cancel';
      controls.forEach((c) => { if (!c.id || !(c.id in a)) return; if (c.type === 'list') { const o = {}; (c.items || []).forEach((it) => { o[it] = it === a[c.id] ? 1 : -1; }); vals[c.id] = o; } else vals[c.id] = a[c.id]; });
      let okv = true; try { if (desc.validate) okv = desc.validate(dlg) !== false; } catch (err) { /* ignore */ }
      if (!okv) { invalid = { index: k, message: alerts[alerts.length - 1] || 'Please check the values' }; return 'cancel'; }
      try { if (desc.commit) desc.commit(dlg); } catch (err) { /* ignore */ } return 'ok';
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
  postMessage({ prompts, invalid, values: Object.fromEntries(Object.values(fields).map((f) => [f.name, String(f.formatted !== undefined ? f.formatted : f.value == null ? '' : f.value)])) });
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

// ask for the stamp's values: the stamp's own dialog or questions (from its scripts), otherwise its text fields
function stampPromptHtml(prompts, prev, err) {
  return prompts.map((p, k) => {
    const old = prev && prev.answers ? prev.answers[k] : undefined;
    if (p.kind !== 'dialog') return field(esc(p.q || p.t || `Value ${k + 1}`), `<input type="text" name="p${k}" value="${esc(old !== undefined && typeof old !== 'object' ? old : p.d || '')}">`);
    const val = (c) => (old && typeof old === 'object' && c.id in old ? old[c.id] : c.d);
    const groups = new Map(); let html = ''; let cur = null;
    p.controls.forEach((c) => {
      if (c.cluster !== cur) { if (cur !== null) html += '</fieldset>'; cur = c.cluster; html += `<fieldset class="st-cluster">${cur ? `<legend>${esc(cur)}</legend>` : ''}`; }
      if (c.type === 'text') html += `<p class="muted sm">${esc(c.label)}</p>`;
      else if (c.type === 'edit') html += field(esc(c.label || c.id), c.multi ? `<textarea name="p${k}:${esc(c.id)}" rows="3">${esc(val(c) == null ? '' : val(c))}</textarea>` : `<input type="text" name="p${k}:${esc(c.id)}" value="${esc(val(c) == null ? '' : val(c))}">`);
      else if (c.type === 'radio') { groups.set(c.group, true); html += `<label class="check"><input type="radio" name="p${k}:radio:${esc(c.group)}" value="${esc(c.id)}"${val(c) === true ? ' checked' : ''}> ${esc(c.label)}</label>`; }
      else if (c.type === 'check') html += `<label class="check"><input type="checkbox" name="p${k}:${esc(c.id)}"${val(c) === true ? ' checked' : ''}> ${esc(c.label)}</label>`;
      else if (c.type === 'list') html += field(esc(c.label || c.id), `<select name="p${k}:${esc(c.id)}">${(c.items || []).map((it) => `<option${it === val(c) ? ' selected' : ''}>${esc(it)}</option>`).join('')}</select>`);
    });
    if (cur !== null) html += '</fieldset>';
    return (err && err.index === k ? `<p class="st-err" role="alert">${esc(err.message)}</p>` : '') + html;
  }).join('');
}
function readStampAnswers(prompts, form) {
  return prompts.map((p, k) => {
    if (p.kind !== 'dialog') return form['p' + k] || '';
    const o = {};
    p.controls.forEach((c) => {
      if (c.type === 'edit' || c.type === 'list') o[c.id] = form[`p${k}:${c.id}`] || '';
      else if (c.type === 'check') o[c.id] = form[`p${k}:${c.id}`] === true || form[`p${k}:${c.id}`] === 'on';
      else if (c.type === 'radio') o[c.id] = form[`p${k}:radio:${c.group}`] === c.id;
    });
    return o;
  });
}
async function stampValues(st, prev) {
  const info = await analyseStamp(st); const text = info.fields.filter((f) => f.type === 'Text' && !f.ro);
  let prompts = []; let base = null;
  if (info.hasJs) { const r1 = await runStampScripts(info, st, null); if (r1) { prompts = r1.prompts; base = r1.values; } }
  if (prompts.length) {
    let err = null; let last = prev;
    for (let tries = 0; tries < 6; tries++) {
      const r = await openDialog({ title: st.name, body: `<div class="st-fill">${stampPromptHtml(prompts, last, err)}</div>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Stamp', value: true, primary: true }] });
      if (!r || !r.value) return null;
      const answers = readStampAnswers(prompts, r.form);
      const r2 = await runStampScripts(info, st, answers);
      if (r2 && r2.invalid) { err = r2.invalid; last = { answers }; continue; } // the stamp's own check said no: ask again with its message
      const orig = Object.fromEntries(info.fields.map((f) => [f.name, f.value || ''])); // labels and untouched fields are left as drawn
      return { values: Object.fromEntries(Object.entries((r2 && r2.values) || {}).filter(([k, v]) => v !== (orig[k] || ''))), answers };
    }
    return null;
  }
  const ask = text.map((f) => ({ key: 'f:' + f.name, label: f.label, value: prev && prev.values ? prev.values[f.name] : base && base[f.name] ? base[f.name] : fieldDefault(f) }));
  if (!ask.length) return { values: base || {}, answers: [] };
  const r = await openDialog({ title: st.name, body: `<p class="muted">Fill in the stamp.</p>${ask.map((a) => field(esc(a.label), `<input type="text" name="${esc(a.key)}" value="${esc(a.value || '')}">`)).join('')}`, buttons: [{ label: 'Cancel', value: false }, { label: 'Stamp', value: true, primary: true }] });
  if (!r || !r.value) return null;
  const values = {}; text.forEach((f) => { values[f.name] = r.form['f:' + f.name] || ''; }); return { values, answers: [] };
}
// the stamp with its fields filled in and flattened: one vector page
async function fillStamp(st, values) {
  const pdf = await PDFDocument.load(await stampBytes(st), { ignoreEncryption: true, updateMetadata: false });
  // fill the fields; their appearances are then drawn with the stamp's other annotations, in the stacking
  // order of the page (a field flattened into the page content would end up under a filled shape)
  try { const form = pdf.getForm(); Object.entries(values || {}).forEach(([k, v]) => { try { const f = form.getField(k); if (f.setText) f.setText(String(v)); else if (f.select) f.select(String(v)); else if (f.check && /^(true|on|yes|1)$/i.test(String(v))) f.check(); } catch { } }); form.updateFieldAppearances(); } catch (e) { console.warn('fill stamp', e); }
  while (pdf.getPageCount() > 1) pdf.removePage(1);
  // Bluebeam stamps are drawn with annotations on a blank page: bake those in, with &[Date]-style text filled
  const page = pdf.getPage(0); bakeStampAnnots(pdf, page, stampTokens());
  // the stamp is the page's art box (crop box) when it has one, not the whole sheet it was drawn on
  const box = page.node.lookup(PDFName.of('ArtBox')) || page.node.lookup(PDFName.of('CropBox')); const mb = page.getMediaBox();
  if (box instanceof PDFArray && box.size() === 4) {
    const [x1, y1, x2, y2] = box.asArray().map(nOf); const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    if (w > 4 && h > 4 && (w < mb.width - 1 || h < mb.height - 1 || x || y)) {
      const ctx = pdf.context; const c = page.node.get(PDFName.of('Contents')); const list = c ? (ctx.lookup(c) instanceof PDFArray ? ctx.lookup(c).asArray() : [c]) : [];
      page.node.set(PDFName.of('Contents'), ctx.obj([ctx.register(ctx.stream(`q 1 0 0 1 ${num(-x, 4)} ${num(-y, 4)} cm\n`)), ...list, ctx.register(ctx.stream('\nQ\n'))]));
      page.setMediaBox(0, 0, w, h); ['CropBox', 'ArtBox', 'BleedBox', 'TrimBox'].forEach((k) => page.node.delete(PDFName.of(k)));
    }
  }
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
    const a = annots.lookup(k); if (!(a instanceof PDFDict)) continue; const sub = a.lookup(PDFName.of('Subtype')); if (sub && ['/Popup', '/Link'].includes(sub.asString())) continue;
    const fl = nOf(a.lookup(PDFName.of('F'))) || 0; if (fl & 2 || fl & 32) continue; // hidden / not shown
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
  page.node.delete(PDFName.of('Annots')); pdf.catalog.delete(PDFName.of('AcroForm')); tokensInContent(pdf, page, T);
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
    const pg = doc.pages[i] || { w: 600 }; const k = Math.min(1, (pg.w * 0.4) / A.w) || 1; const w = A.w * k, h = A.h * k; // actual size, unless wider than 40% of the sheet
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
