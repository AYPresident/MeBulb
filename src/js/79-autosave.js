// ===== Autosave and crash recovery ===========================================================
// Two separate safety nets:
//  - Autosave writes the PDF itself every few minutes (desktop app, a PDF you can write, and in a
//    live session only the person holding the file). Off, or every 1 to 30 minutes.
//  - The recovery copy: a few seconds after each change, unsaved markups are copied to the MeBulb
//    folder under AppData (in a browser, to its local storage). If MeBulb or the PC stops,
//    reopening the PDF offers them back; File > Recover unsaved work lists every copy kept.
// Neither writes anything next to the PDF on the Egnyte drive.
const AUTOSAVE_CHOICES = [0, 1, 2, 5, 10, 15, 30];
const REC_META = ['scales', 'layers', 'links', 'viewports', 'align', 'colorAdj']; // flattened pieces come from the file itself
const nzv = (v) => (v == null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) ? null : v);
const REC = { timer: 0, last: 0, writing: false, lastWrote: 0, autoAt: 0 };
const recKey = (doc) => { let h = 0; const s = (doc.path || doc.name).toLowerCase(); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return 'r' + h.toString(36); };
const autosaveMins = () => { const v = state.prefs.autosavePdf; return v == null ? 5 : +v || 0; };
async function recDir() { const H = HOST(); return H ? pjoin(await H.outboxDir(), 'recovery') : null; }

// ----- the recovery copy ------------------------------------------------------------------------------
function recoveryChanged(doc) {
  if (!doc || doc.sample) return; const every = +(state.prefs.recoveryMins || 0); if (every > 0) return; // on the timer instead
  clearTimeout(REC.timer); const since = Date.now() - REC.last; // a few seconds after you stop; at least every 20 s while you keep going
  REC.timer = setTimeout(() => recoveryWrite(), since > 20000 ? 400 : 2500);
}
async function recoveryWrite(force) {
  if (REC.writing) { REC.again = true; return; } REC.writing = true; REC.last = Date.now(); const H = HOST();
  try {
    for (const doc of state.docs) {
      if (!doc.dirty || doc.sample || (!force && doc.recRev === doc.rev)) continue;
      const body = JSON.stringify({ v: 2, path: doc.path || null, name: doc.name, t: Date.now(), size: doc.stat ? doc.stat.size : null, fileIds: doc.fileIds || [], payload: JSON.parse(payloadJson(doc)) });
      try {
        if (H) await H.sessWrite(pjoin(await recDir(), recKey(doc) + '.json'), body);
        else if (body.length < 2.5e6) localStorage.setItem('planmark:rec:' + recKey(doc), body); else continue;
        doc.recRev = doc.rev; doc.recAt = Date.now(); REC.lastWrote = Date.now();
      } catch (e) { console.warn('recovery copy', e); }
    }
  } finally { REC.writing = false; renderSaveBadge(); if (REC.again) { REC.again = false; setTimeout(() => recoveryWrite(), 500); } }
}
async function recoveryClear(doc) {
  const H = HOST(); doc.recRev = null; doc.recAt = null;
  try { if (H) { await H.sessRm(pjoin(await recDir(), recKey(doc) + '.json')); await H.sessRm(pjoin(await H.outboxDir(), recKey(doc) + '.json')); } else localStorage.removeItem('planmark:rec:' + recKey(doc)); } catch { }
}
async function recoveryRead(doc) {
  const H = HOST();
  try {
    if (H) { for (const p of [pjoin(await recDir(), recKey(doc) + '.json'), pjoin(await H.outboxDir(), recKey(doc) + '.json')]) { const r = await H.sessRead(p).catch(() => null); if (r) return JSON.parse(r.text); } return null; }
    const t = localStorage.getItem('planmark:rec:' + recKey(doc)); return t ? JSON.parse(t) : null;
  } catch { return null; }
}
async function recoveryList() {
  const H = HOST(); const out = [];
  try {
    if (H) {
      for (const dir of [await recDir(), await H.outboxDir()]) {
        for (const f of await H.sessList(dir).catch(() => [])) { if (!/^r[0-9a-z]+\.json$/.test(f.name)) continue; try { const r = await H.sessRead(pjoin(dir, f.name)); const j = JSON.parse(r.text); if (j && j.payload && !out.some((x) => x.key === f.name)) out.push({ ...j, key: f.name, file: pjoin(dir, f.name) }); } catch { } }
      }
    } else for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k || !k.startsWith('planmark:rec:')) continue; try { const j = JSON.parse(localStorage.getItem(k)); if (j && j.payload) out.push({ ...j, key: k }); } catch { } }
  } catch { }
  return out.sort((a, b) => b.t - a.t);
}
// what the copy would change in the PDF as opened: markups added, changed or removed
function recoveryDiff(doc, rec) {
  const P = rec.payload || {}; const mine = new Map((P.markups || []).map((m) => [m.id, JSON.stringify(m)])); const file = new Map(doc.markups.map((m) => [m.id, JSON.stringify(m)]));
  const known = new Set(rec.fileIds || []); let add = 0, chg = 0, del = 0;
  mine.forEach((j, id) => { if (!file.has(id)) add++; else if (file.get(id) !== j) chg++; });
  file.forEach((j, id) => { if (!mine.has(id) && known.has(id)) del++; });
  const meta = REC_META.some((k) => P[k] !== undefined && JSON.stringify(nzv(P[k])) !== JSON.stringify(nzv(doc[k])));
  return { add, chg, del, meta, n: add + chg + del + (meta ? 1 : 0) };
}
function recoveryApply(doc, rec) {
  const P = rec.payload || {}; const known = new Set(rec.fileIds || []); pushUndo(doc);
  const mine = new Map((P.markups || []).map((m) => [m.id, m]));
  // your copy wins for everything in it; markups in the PDF that you had deleted stay deleted; markups others
  // added to the PDF since you opened it are kept
  const list = doc.markups.filter((m) => mine.has(m.id) || !known.has(m.id)).map((m) => mine.get(m.id) || m);
  mine.forEach((m, id) => { if (!list.some((x) => x.id === id)) list.push(m); });
  doc.markups = list; REC_META.forEach((k) => { if (P[k] !== undefined) doc[k] = P[k]; });
  markDirty(doc); if (doc === activeDoc()) { renderAllMarks(doc); refreshAll(); }
}
async function recoveryOffer(doc, rec) {
  if (REC.waitKeys && REC.waitKeys.delete(recKey(doc))) renderSaveBadge();
  if (REC.skipOffer === recKey(doc)) return false; // opened from File > Recover unsaved work, which recovers it itself
  rec = rec || await recoveryRead(doc); if (!rec || !rec.payload) return false;
  const D = recoveryDiff(doc, rec); if (!D.n) { recoveryClear(doc); return false; } // the PDF already has all of it
  const parts = [D.add && `${D.add} added`, D.chg && `${D.chg} changed`, D.del && `${D.del} deleted`, D.meta && 'scales, layers or links changed'].filter(Boolean).join(', ');
  const newer = doc.stat && doc.stat.mtimeMs > rec.t + 2000;
  const r = await openDialog({ title: 'Recover unsaved work?', body: `<p>MeBulb kept a copy of unsaved work on <b>${esc(doc.name)}</b> from ${esc(fmtDate(new Date(rec.t).toISOString()))}: ${esc(parts)}.</p>${newer ? '<p class="muted sm">The PDF has been saved since then (perhaps by someone else). Recovering puts your copy back on top; markups others added since are kept.</p>' : ''}<p class="muted sm">Recover can be undone with Ctrl+Z.</p>`, buttons: [{ label: 'Discard it', value: 'discard', danger: true }, { label: 'Later', value: 'later' }, { label: 'Recover', value: 'recover', primary: true }] });
  if (r && r.value === 'recover') { recoveryApply(doc, rec); toast('Unsaved work recovered. Save to put it in the PDF.'); return true; }
  if (r && r.value === 'discard') recoveryClear(doc);
  return false;
}
// File > Recover unsaved work…
async function recoveryDialog() {
  const list = await recoveryList(); const H = HOST();
  if (!list.length) { await openDialog({ title: 'Recover unsaved work', body: '<p>There is no unsaved work to recover. MeBulb keeps a copy of unsaved markups a few seconds after each change and removes it when you save or choose not to save.</p>', buttons: [{ label: 'OK', value: true, primary: true }] }); return; }
  const row = (j, k) => { const n = (j.payload.markups || []).length; const open = state.docs.find((d) => recKey(d) + '.json' === j.key || 'planmark:rec:' + recKey(d) === j.key); return `<div class="rec-row" data-k="${k}"><div class="rec-main"><b>${esc(j.name)}</b><span class="muted sm">${esc(j.path ? j.path.replace(/[\\/][^\\/]*$/, '') : 'opened in the browser')} · ${esc(fmtDate(new Date(j.t).toISOString()))} · ${n} markup${n === 1 ? '' : 's'}${open ? ' · open now' : ''}</span></div><button type="button" class="btn sm primary" data-rec="open" data-k="${k}">${open ? 'Recover' : H && j.path ? 'Open and recover' : 'How to recover'}</button><button type="button" class="btn sm danger" data-rec="del" data-k="${k}">Delete</button></div>`; };
  openDialog({ title: 'Recover unsaved work', wide: true, body: `<p>Unsaved markups MeBulb kept when a PDF was not saved or MeBulb stopped. Recovering adds them back to the PDF; save afterwards to keep them.</p><div class="rec-list">${list.map(row).join('')}</div>`, buttons: [{ label: 'Close', value: true, primary: true }],
    onOpen: (box) => box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-rec]'); if (!b) return; const j = list[+b.dataset.k]; if (!j) return;
      if (b.dataset.rec === 'del') { if (H) await H.sessRm(j.file).catch(() => {}); else localStorage.removeItem(j.key); if (REC.waitKeys) REC.waitKeys.delete(j.key.replace(/^planmark:rec:/, '').replace(/\.json$/, '')); renderSaveBadge(); b.closest('.rec-row').remove(); return; }
      let doc = state.docs.find((d) => recKey(d) + '.json' === j.key || 'planmark:rec:' + recKey(d) === j.key);
      if (!doc && H && j.path) { closeDialog(null); REC.skipOffer = j.key.replace(/\.json$/, ''); doc = await openPath(j.path); if (!doc) { toast(`${j.name} could not be opened from ${j.path}. Is the Egnyte drive connected?`, 'error'); return; } await waitIdle(); }
      if (!doc) { toast(`Open ${j.name} (File > Open) and MeBulb offers this copy back.`); return; }
      closeDialog(null); if (activeDoc() !== doc) await switchDoc(doc.id); setTimeout(() => { REC.skipOffer = null; }, 3000);
      if (recoveryDiff(doc, j).n) { recoveryApply(doc, j); toast('Unsaved work recovered. Save to put it in the PDF.'); } else { toast('The PDF already has all of that work'); recoveryClear(doc); }
    }) });
}
const waitIdle = () => new Promise((r) => setTimeout(r, 300));
// at start: work left from a stop is listed once
async function recoveryStartup() {
  const list = (await recoveryList()).filter((j) => Date.now() - j.t < 60 * 864e5 && !state.docs.some((d) => recKey(d) + '.json' === j.key || 'planmark:rec:' + recKey(d) === j.key));
  REC.waitKeys = new Set(list.map((j) => j.key.replace(/^planmark:rec:/, '').replace(/\.json$/, '')));
  if (!list.length) return; const names = list.slice(0, 3).map((j) => j.name).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
  setStatus(`Unsaved work was kept for ${names}: File > Recover unsaved work`); renderSaveBadge();
}

// ----- autosave to the PDF ----------------------------------------------------------------------------
function autosaveBusy() { return !!(I.drag || I.pan || state.draft || state.editing || !$('#modal-back').hidden || !$('#busy').hidden || REC.saving); }
function autosaveCan(doc) { return !!(HOST() && doc.path && !doc.sample && !doc.readOnly && !doc.autoBlocked && (!doc.sess || sessHolder(doc))); }
async function autosaveTick() {
  const mins = autosaveMins(); if (!mins || !HOST()) return;
  for (const doc of state.docs) {
    if (!doc.dirty || !autosaveCan(doc)) continue; const since = Math.max(doc.dirtySince || 0, doc.lastSaveT || 0);
    if (Date.now() - since < mins * 60000) continue; if (autosaveBusy()) return;
    REC.saving = true; try { await saveDoc('save', { doc, auto: true, quiet: true }); } catch (e) { console.warn('autosave', e); } finally { REC.saving = false; }
    if (!doc.dirty) { doc.autoAt = Date.now(); REC.autoAt = Date.now(); } renderSaveBadge();
  }
}
setInterval(() => autosaveTick(), 10000);
setInterval(() => { const m = +(state.prefs.recoveryMins || 0); if (m > 0 && Date.now() - REC.last >= m * 60000) recoveryWrite(); }, 15000);

// ----- status bar: autosave and recovery at a glance ----------------------------------------------------
function renderSaveBadge() {
  const b = $('#save-badge'); if (!b) return; const d = activeDoc(); const mins = autosaveMins(); const H = HOST();
  REC.waiting = REC.waitKeys ? REC.waitKeys.size : 0; const t = (x) => new Date(x).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  let txt, tip, cls = '';
  if (REC.waiting) { txt = `${REC.waiting} to recover`; tip = 'Unsaved work was kept from last time. Click to recover it.'; cls = 'warn'; }
  else if (d && d.autoAt && !d.dirty && H && mins) { txt = `Autosaved ${t(d.autoAt)}`; tip = `Autosave every ${mins} min`; }
  else if (d && d.dirty && d.recAt) { txt = `Recovery copy ${t(d.recAt)}`; tip = `Unsaved markups are copied to this PC as you work.${H ? mins ? ` Autosave every ${mins} min${autosaveCan(d) ? '' : ' (not for this PDF: ' + (d.readOnly ? 'read only' : !d.path ? 'not saved to a file yet' : d.autoBlocked ? 'the PDF changed on disk; save to sort it out' : d.sess && !sessHolder(d) ? 'another person holds the file' : 'sample') + ')'}.` : ' Autosave is off.' : ''}`; }
  else { txt = H ? (mins ? `Autosave ${mins} min` : 'Autosave off') : 'Recovery on'; tip = H ? (mins ? `The PDF is saved every ${mins} minutes while there are unsaved markups.` : 'Autosave is off. Unsaved markups are still copied to this PC for recovery.') : 'Unsaved markups are copied to this browser for recovery.'; cls = H && !mins ? 'off' : ''; }
  b.hidden = !d && !REC.waiting; b.textContent = txt; b.title = tip + ' Click to change.'; b.className = 'save-badge ' + cls;
}
function saveBadgeMenu(e) {
  const H = HOST(); const cur = autosaveMins(); const items = [];
  if (H) AUTOSAVE_CHOICES.forEach((v) => items.push([`${v === cur ? '✓ ' : ' '}${v ? `Autosave every ${v} min` : 'Autosave off'}`, () => setAutosave(v)]));
  if (H) items.push(['-']); items.push(['Recover unsaved work…', () => recoveryDialog()], ['Save a recovery copy now', () => recoveryWrite(true).then(() => toast('Recovery copy saved'))], ['Preferences…', () => prefsDialog()]);
  const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.top - 8 - items.length * 30, items);
}
function setAutosave(v) { state.prefs.autosavePdf = v; savePrefs(); renderSaveBadge(); toast(v ? `Autosave every ${v} minutes` : 'Autosave off: unsaved markups are still copied for recovery'); }
