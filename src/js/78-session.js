// ===== Live sessions over the Egnyte drive ===================================================
// Everyone opens the same PDF from the Egnyte Desktop App drive. Each person's changes are
// written as small files into a hidden ".mebulb" folder beside the PDF; Egnyte syncs them,
// and everyone else's MeBulb merges them in (newest change to each markup wins). The PDF
// stays the document: saving writes everyone's merged markups into it. Nothing is lost when
// the connection drops: the files sit in the Egnyte cache on this PC and upload later, and
// a recovery copy is kept in the MeBulb folder under AppData.
// The transport is a class, so a server-based one can replace FolderTransport later (for
// consultants without Egnyte access) without touching the merge logic.
const SESS_META = ['scales', 'layers', 'links', 'viewports', 'align'];
const PEER_COLORS = ['#e8590c', '#2b8a3e', '#1971c2', '#c2255c', '#6741d9', '#0c8599', '#e67700', '#5c940d'];
const SESS = { hint: false };
const sanit = (s) => String(s || '').replace(/[\\/:*?"<>|~\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'user';
const pjoin = (a, ...b) => [a.replace(/[\\/]+$/, ''), ...b].join(a.includes('\\') ? '\\' : '/');
const peerColor = (uid) => { let h = 0; for (const c of uid) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PEER_COLORS[h % PEER_COLORS.length]; };

class FolderTransport {
  constructor(H, root, uid) { this.H = H; this.root = root; this.uid = uid; this.ops = pjoin(root, 'ops'); this.pres = pjoin(root, 'presence'); }
  async list() { return this.H.sessList(this.ops); }
  async read(name) { const r = await this.H.sessRead(pjoin(this.ops, name)); return r ? JSON.parse(r.text) : null; }
  async send(seq, body) { const name = `${this.uid}~${String(seq).padStart(8, '0')}.json`; await this.H.sessWrite(pjoin(this.ops, name), JSON.stringify(body)); return name; }
  async remove(name) { return this.H.sessRm(pjoin(this.ops, name)); }
  async presence(p) { return this.H.sessWrite(pjoin(this.pres, `${this.uid}.json`), JSON.stringify(p)); }
  async peers() { const out = []; for (const f of await this.H.sessList(this.pres)) { if (!f.name.endsWith('.json')) continue; try { const r = await this.H.sessRead(pjoin(this.pres, f.name)); if (r) out.push(JSON.parse(r.text)); } catch { } } return out; }
  async watch(cb) { await this.H.sessWatch(this.ops).catch(() => {}); this.off = this.H.onSessChanged((d) => { if (d.replace(/[\\/]+$/, '') === this.ops.replace(/[\\/]+$/, '')) cb(); }); }
  close() { if (this.off) this.off(); this.H.sessUnwatch(this.ops).catch(() => {}); }
}
function sessRoot(doc, dir) { return pjoin(dir, sanit(doc.name.replace(/\.pdf$/i, ''))); }
async function myUid() { const i = state.hostInfo || (HOST() ? await HOST().info() : {}); return sanit(`${i.user || 'user'}@${i.host || 'pc'}`); }
const verOf = (m) => (m && m.modified ? Date.parse(m.modified) || 0 : 0);

// ----- start / stop ------------------------------------------------------------------------------------
async function sessionStart(doc = activeDoc()) {
  const H = HOST(); if (!H || !doc || !doc.path) { toast('Open the PDF from the Egnyte drive in the MeBulb desktop app to share it live.', 'error'); return; }
  if (doc.sess) return;
  const dir = await H.sessDir(doc.path); const uid = await myUid(); const T = new FolderTransport(H, sessRoot(doc, dir), uid);
  const S = { T, uid, name: state.author, color: peerColor(uid), seq: 1, applied: new Set(), known: new Map(), metaKnown: {}, mt: new Map(), tomb: new Map(Object.entries(doc.tomb || {}).map(([k, v]) => [k, +v])), metaT: {}, rc: 0, rlog: new Map(), rlogMeta: new Map(), peers: new Map(), sent: 0, recv: 0, lastSent: null, lastRecv: null, errors: 0, timers: [], queue: [], started: Date.now() };
  doc.markups.forEach((m) => { S.known.set(m.id, JSON.stringify(m)); S.mt.set(m.id, verOf(m)); });
  SESS_META.forEach((k) => { S.metaKnown[k] = JSON.stringify(doc[k] ?? null); S.metaT[k] = 0; });
  doc.sess = S;
  // a colour nobody else in the session is using
  try { const used = new Set((await T.peers()).filter((p) => p && p.uid !== uid && !p.left && Date.now() - (p.t || 0) < 180000).map((p) => p.color)); if (used.has(S.color)) S.color = PEER_COLORS.find((c) => !used.has(c)) || S.color; } catch { }
  // catch up: everything already in the folder (including our own unsaved work from last time)
  const files = (await T.list()).filter((f) => f.name.endsWith('.json')).sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const f of files) { const [u, s] = f.name.replace(/\.json$/, '').split('~'); if (u === uid) S.seq = Math.max(S.seq, (+s || 0) + 1); }
  await sessPull(doc, files);
  S.timers.push(setInterval(() => sessTick(doc), 1200), setInterval(() => sessPull(doc).catch(sessErr(doc)), 4000), setInterval(() => sessPresence(doc).catch(sessErr(doc)), 9000), setInterval(() => sessCheckPdf(doc).catch(sessErr(doc)), 8000));
  await T.watch(debounce(() => sessPull(doc).catch(sessErr(doc)), 250));
  await sessPresence(doc); sessGc(doc).catch(() => {});
  store.set('sess:' + doc.path, true); renderSessionPanel(); renderSessionBadge(); toast('Live session on: your team sees your changes as Egnyte syncs them');
}
async function sessionStop(doc = activeDoc(), quiet) {
  const S = doc && doc.sess; if (!S) return; sessTick(doc, true); await sessFlush(doc).catch(() => {});
  S.timers.forEach(clearInterval); S.T.close(); await S.T.presence({ uid: S.uid, name: S.name, left: true, t: Date.now() }).catch(() => {});
  doc.sess = null; store.set('sess:' + doc.path, false); if (!quiet) toast('Left the live session'); renderSessionPanel(); renderSessionBadge(); renderAllMarks(doc);
}
const sessErr = (doc) => (e) => { if (doc.sess) { doc.sess.errors++; doc.sess.lastError = String(e && e.message || e); renderSessionBadge(); } console.warn('live session', e); };

// ----- local changes out ------------------------------------------------------------------------------
function sessTick(doc, force) {
  const S = doc.sess; if (!S) return; if (!force && !SESS.hint && Date.now() - (S.lastFull || 0) < 3000) return;
  SESS.hint = false; S.lastFull = Date.now(); const now = Date.now(); const ops = []; const seen = new Set();
  for (const m of doc.markups) { seen.add(m.id); if (state.editing && state.editing.id === m.id) continue; const j = JSON.stringify(m); if (S.known.get(m.id) !== j) { S.known.set(m.id, j); S.mt.set(m.id, now); S.tomb.delete(m.id); ops.push({ k: 'm', id: m.id, m: JSON.parse(j), t: now }); } }
  for (const id of [...S.known.keys()]) if (!seen.has(id)) { S.known.delete(id); S.mt.set(id, now); S.tomb.set(id, now); ops.push({ k: 'm', id, m: null, t: now }); }
  for (const k of SESS_META) { const j = JSON.stringify(doc[k] ?? null); if (S.metaKnown[k] !== j) { S.metaKnown[k] = j; S.metaT[k] = now; ops.push({ k: 'meta', key: k, v: JSON.parse(j), t: now }); } }
  if (ops.length) { S.queue.push(...ops); sessFlush(doc).catch(sessErr(doc)); }
}
async function sessFlush(doc) {
  const S = doc.sess; if (!S || !S.queue.length || S.flushing) return; S.flushing = true;
  try {
    while (S.queue.length) {
      const ops = S.queue.splice(0, 200); const seq = S.seq++;
      try { const name = await S.T.send(seq, { v: 1, by: S.uid, name: S.name, t: Date.now(), ops }); S.applied.add(name); S.sent += ops.length; S.lastSent = Date.now(); }
      catch (e) { S.queue.unshift(...ops); S.seq = seq; throw e; }
    }
  } finally { S.flushing = false; renderSessionBadge(); }
}

// ----- other people's changes in ------------------------------------------------------------------------
async function sessPull(doc, listed) {
  const S = doc.sess; if (!S || S.pulling) return; S.pulling = true;
  try {
    const files = (listed || (await S.T.list())).filter((f) => f.name.endsWith('.json') && !S.applied.has(f.name));
    if (!files.length) return; const batches = [];
    for (const f of files) { try { const b = await S.T.read(f.name); if (b && Array.isArray(b.ops)) batches.push(b); S.applied.add(f.name); } catch (e) { /* half-synced file: try again next time */ } }
    const ops = []; batches.forEach((b) => b.ops.forEach((o) => ops.push({ ...o, by: b.by, name: b.name }))); ops.sort((a, b) => a.t - b.t);
    if (ops.length) sessApply(doc, ops);
  } finally { S.pulling = false; }
}
function sessApply(doc, ops) {
  const S = doc.sess; const pages = new Set(); let meta = false; let n = 0; const who = new Set();
  const wins = (t, by, cur, curBy) => t > cur || (t === cur && String(by) > String(curBy || ''));
  for (const op of ops) {
    if (op.k === 'm') {
      const local = getMarkup(op.id, doc); const cur = S.mt.has(op.id) ? S.mt.get(op.id) : local ? verOf(local) : S.tomb.has(op.id) ? S.tomb.get(op.id) : -1;
      if (!wins(op.t, op.by, cur, S.mby && S.mby.get(op.id))) continue;
      if (state.editing && state.editing.id === op.id) continue; // finishing your own edit wins
      if (local) { pages.add(local.page); const k = doc.markups.indexOf(local); if (op.m) doc.markups[k] = op.m; else { doc.markups.splice(k, 1); state.sel.delete(op.id); } }
      else if (op.m) doc.markups.push(op.m);
      if (op.m) { pages.add(op.m.page); S.known.set(op.id, JSON.stringify(op.m)); S.tomb.delete(op.id); } else { S.known.delete(op.id); S.tomb.set(op.id, op.t); }
      S.mt.set(op.id, op.t); (S.mby || (S.mby = new Map())).set(op.id, op.by); S.rlog.set(op.id, ++S.rc); n++; if (op.by !== S.uid) who.add(op.name || op.by);
    } else if (op.k === 'meta' && SESS_META.includes(op.key)) {
      if (!wins(op.t, op.by, S.metaT[op.key] || 0)) continue;
      doc[op.key] = op.v; S.metaT[op.key] = op.t; S.metaKnown[op.key] = JSON.stringify(op.v ?? null); S.rlogMeta.set(op.key, ++S.rc); meta = true; n++;
    }
  }
  if (!n) return; S.recv += n; S.lastRecv = Date.now();
  if (doc === activeDoc()) { if (meta) { renderAllMarks(doc); } else pages.forEach((p) => renderMarks(doc, p)); refreshPanels(); renderList(); }
  doc.dirty = true; renderTabs(); renderSessionBadge(); if (rightShown('session')) renderSessionPanel();
  if (who.size && Date.now() - S.started > 5000) setStatus(`${[...who].join(', ')} updated ${n} markup${n === 1 ? '' : 's'}`);
}
// undo must not take back other people's changes made after the snapshot
function sessKeepRemote(doc, snapRc, restored) {
  const S = doc.sess; if (!S) return restored;
  const keep = [...S.rlog].filter(([, rc]) => rc > snapRc).map(([id]) => id); if (!keep.length && ![...S.rlogMeta.values()].some((rc) => rc > snapRc)) return restored;
  const cur = new Map(doc.markups.map((m) => [m.id, m])); let list = restored.markups.filter((m) => !keep.includes(m.id));
  keep.forEach((id) => { if (cur.has(id)) list.push(cur.get(id)); }); restored.markups = list;
  S.rlogMeta.forEach((rc, k) => { if (rc > snapRc) restored[k] = doc[k]; });
  return restored;
}

// ----- presence: who is here, which page, what they have selected ----------------------------------------
async function sessPresence(doc) {
  const S = doc.sess; if (!S) return;
  await S.T.presence({ uid: S.uid, name: state.author, color: S.color, t: Date.now(), page: doc === activeDoc() ? currentPage() : null, sel: doc === activeDoc() ? [...state.sel].slice(0, 50) : [], saving: !!S.saving, app: 'MeBulb' });
  const now = Date.now(); const before = new Set(S.peers.keys()); S.peers.clear();
  for (const p of await S.T.peers()) { if (!p || p.uid === S.uid || p.left || now - (p.t || 0) > 180000) continue; S.peers.set(p.uid, p); }
  const joined = [...S.peers.keys()].filter((k) => !before.has(k)); if (joined.length && before.size + joined.length > 0 && now - S.started > 3000) setStatus(`${joined.map((k) => S.peers.get(k).name).join(', ')} joined the live session`);
  renderSessionBadge(); if (rightShown('session')) renderSessionPanel(); if (doc === activeDoc()) doc.pageEls && doc.pageEls.forEach((_, i) => renderSel(doc, i));
}
function remoteSelSvg(doc, i, z) {
  const S = doc.sess; if (!S || !S.peers.size) return ''; let s = '';
  S.peers.forEach((p) => { (p.sel || []).forEach((id) => { const m = getMarkup(id, doc); if (!m || m.page !== i) return; const b = markupBBox(m, doc); const pad = 6 / z; s += `<g class="remote-sel" style="--pc:${p.color}"><rect x="${num(b.x - pad, 2)}" y="${num(b.y - pad, 2)}" width="${num(b.w + 2 * pad, 2)}" height="${num(b.h + 2 * pad, 2)}" stroke-width="${num(1.5 / z, 3)}"/><text x="${num(b.x - pad, 2)}" y="${num(b.y - pad - 3 / z, 2)}" font-size="${num(10 / z, 2)}">${esc(p.name)}</text></g>`; }); });
  return s;
}

// ----- the PDF itself changed (someone saved): take their file as the new base, merge their data ------------
async function sessCheckPdf(doc) {
  const S = doc.sess; const H = HOST(); if (!S || S.saving || !doc.path) return;
  const st = await H.stat(doc.path); if (!st || !doc.stat || (st.size === doc.stat.size && Math.abs(st.mtimeMs - doc.stat.mtimeMs) < 2)) return;
  await sessRebase(doc);
}
async function sessRebase(doc) {
  const H = HOST(); const f = await H.openPath(doc.path); const src = hostSource(f.fid, f.size); const R = await openReader(src);
  let data = null; if (R) { try { data = await R.payload(); } catch { } }
  (doc.extraFids = doc.extraFids || []).push(f.fid);
  doc.base = { src, appends: [] }; doc.reader = R; doc.stat = { size: f.size, mtimeMs: f.mtimeMs }; doc.diskMatches = true;
  if (data && doc.sess) {
    const S = doc.sess; const ops = (data.markups || []).map((m) => ({ k: 'm', id: m.id, m, t: verOf(m), by: data.savedById || '' }));
    Object.entries(data.tomb || {}).forEach(([id, t]) => ops.push({ k: 'm', id, m: null, t: +t, by: data.savedById || '' }));
    // markups missing from their file that we have not touched since their save were deleted by them
    sessApply(doc, ops);
    const theirs = sessHash(data.markups || []); if (theirs === sessHash(doc.markups)) { doc.dirty = false; renderTabs(); }
    if (data.savedBy && data.savedById !== S.uid) toast(`${data.savedBy} saved the PDF`);
    sessGc(doc).catch(() => {});
  }
}
function sessHash(ms) { const a = ms.map((m) => JSON.stringify(m)).sort(); let h = 0; for (const s of a) for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h + ':' + a.length; }
// tidy the shared folder: change files already contained in the saved PDF (by a day's margin) are removed
async function sessGc(doc) {
  const S = doc.sess; if (!S || !doc.stat) return; const cutoff = doc.stat.mtimeMs - 24 * 3600e3;
  for (const f of await S.T.list()) if (f.mtimeMs < cutoff && f.name.endsWith('.json')) await S.T.remove(f.name).catch(() => {});
}
async function sessionSaved(doc) { const S = doc.sess; if (S) { await sessPresence(doc).catch(() => {}); sessGc(doc).catch(() => {}); } recoveryClear(doc); }
async function sessionOpened(doc) {
  if (!HOST() || !doc.path) { recoveryOffer(doc); return; }
  await recoveryOffer(doc);
  try {
    const dir = doc.path.replace(/[\\/][^\\/]*$/, ''); const root = sessRoot(doc, pjoin(dir, '.mebulb')); const uid = await myUid();
    const pres = await HOST().sessList(pjoin(root, 'presence')).catch(() => []); const now = Date.now(); const others = [];
    for (const f of pres) { if (!f.name.endsWith('.json') || f.name === uid + '.json' || now - f.mtimeMs > 180000) continue; const r = await HOST().sessRead(pjoin(root, 'presence', f.name)).catch(() => null); if (r) { try { const p = JSON.parse(r.text); if (!p.left) others.push(p.name); } catch { } } }
    const pref = state.prefs.liveJoin || 'ask'; const was = store.get('sess:' + doc.path, false);
    if (others.length || was) {
      if (pref === 'always' || (was && !others.length && pref !== 'never')) { await sessionStart(doc); return; }
      if (pref === 'never') return;
      const r = await openDialog({ title: 'Join the live session?', body: `<p>${others.length ? `<b>${esc(others.join(', '))}</b> ${others.length === 1 ? 'is' : 'are'} working on this PDF right now.` : 'You were in a live session on this PDF.'}</p><p>Join to see each other's markups as they are made. Changes travel through the Egnyte drive, so expect a few seconds' delay.</p><label class="check"><input type="checkbox" name="always"> Always join automatically</label>`, buttons: [{ label: 'Work alone', value: false }, { label: 'Join', value: true, primary: true }] });
      if (r && r.form && r.form.always) { state.prefs.liveJoin = r.value ? 'always' : 'never'; savePrefs(); }
      if (r && r.value) await sessionStart(doc);
    }
  } catch (e) { console.warn(e); }
}
function sessionClosed(doc) { if (doc.sess) sessionStop(doc, true); (doc.extraFids || []).forEach((f) => HOST() && HOST().close(f)); recoveryClear(doc, true); }
async function sessionShutdown() { for (const d of state.docs) if (d.sess) await sessionStop(d, true); }

// ----- crash recovery: unsaved markups copied to AppData every few minutes ------------------------------
const recKey = (doc) => { let h = 0; const s = (doc.path || doc.name).toLowerCase(); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return 'r' + h.toString(36); };
async function recoveryWrite() {
  const H = HOST();
  for (const doc of state.docs) {
    if (!doc.dirty || doc.sample) continue; const body = JSON.stringify({ path: doc.path, name: doc.name, t: Date.now(), payload: JSON.parse(payloadJson(doc)) });
    try { if (H) { const dir = await H.outboxDir(); await H.sessWrite(pjoin(dir, recKey(doc) + '.json'), body); } else if (body.length < 1.5e6) localStorage.setItem('planmark:rec:' + recKey(doc), body); } catch { }
  }
}
async function recoveryClear(doc, onlyIfClean) { if (onlyIfClean && doc.dirty) return; const H = HOST(); try { if (H) { const dir = await H.outboxDir(); await H.sessRm(pjoin(dir, recKey(doc) + '.json')); } else localStorage.removeItem('planmark:rec:' + recKey(doc)); } catch { } }
async function recoveryOffer(doc) {
  const H = HOST(); let rec = null;
  try { if (H) { const dir = await H.outboxDir(); const r = await H.sessRead(pjoin(dir, recKey(doc) + '.json')); rec = r ? JSON.parse(r.text) : null; } else { const t = localStorage.getItem('planmark:rec:' + recKey(doc)); rec = t ? JSON.parse(t) : null; } } catch { }
  if (!rec || !rec.payload) return; if (doc.stat && rec.t < doc.stat.mtimeMs) { recoveryClear(doc); return; }
  const n = (rec.payload.markups || []).length;
  const r = await openDialog({ title: 'Recover unsaved markups?', body: `<p>MeBulb kept a copy of unsaved work on <b>${esc(doc.name)}</b> from ${esc(fmtDate(new Date(rec.t).toISOString()))} (${n} markup${n === 1 ? '' : 's'}).</p>`, buttons: [{ label: 'Discard it', value: 'discard', danger: true }, { label: 'Recover', value: true, primary: true }] });
  if (r && r.value === true) { pushUndo(doc); const P = rec.payload; doc.markups = P.markups || []; SESS_META.forEach((k) => { if (P[k] !== undefined) doc[k] = P[k]; }); doc.dirty = true; renderAllMarks(doc); refreshAll(); toast('Unsaved markups recovered'); }
  else if (r && r.value === 'discard') recoveryClear(doc);
}
setInterval(() => recoveryWrite(), 30000);

// ----- panel and status badge -----------------------------------------------------------------------------------
function ago(t) { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000); return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : fmtDate(new Date(t).toISOString()); }
function renderSessionBadge() {
  const b = $('#session-badge'); if (!b) return; const d = activeDoc(); const S = d && d.sess;
  if (!S) { b.hidden = true; return; } b.hidden = false; const n = S.peers.size + 1; const pending = S.queue.length;
  b.className = 'session-badge' + (S.errors && S.lastError ? ' warn' : '') + (pending ? ' busy' : '');
  b.innerHTML = `<span class="dot"></span>Live · ${n} ${n === 1 ? 'person' : 'people'}${pending ? ` · ${pending} waiting` : ''}`;
  b.title = `Live session. Last sent ${ago(S.lastSent)}, last received ${ago(S.lastRecv)}.${S.lastError ? ' Problem: ' + S.lastError : ''}`; b.onclick = () => openPanel('session');
}
function renderSessionPanel() {
  const el = $('#session-panel'); if (!el) return; const d = activeDoc(); const H = HOST();
  if (!H) { el.innerHTML = `<section class="psec"><h3>Live session</h3><p class="muted">Live sessions run in the MeBulb desktop app, which works straight from the Egnyte drive. Everyone opens the same PDF and sees each other's markups as they are made.</p></section>`; return; }
  if (!d) { el.innerHTML = '<p class="muted pad">Open a PDF from the Egnyte drive to share it live.</p>'; return; }
  const S = d.sess;
  if (!S) {
    el.innerHTML = `<section class="psec"><h3>Live session</h3><p class="muted">Work on <b>${esc(d.name)}</b> at the same time as your team. Everyone opens this PDF from the Egnyte drive and joins.</p>
      <div class="btn-row"><button class="btn primary" data-sa="start"${d.path ? '' : ' disabled'}>${icon('people')} Start live session</button></div>
      ${d.path ? '' : '<p class="muted sm">This PDF was not opened from a folder on disk, so it cannot be shared.</p>'}</section>
      <section class="psec collapsed"><h3>How it works</h3><p class="muted sm">Your changes are saved every second as small files in a hidden <b>.mebulb</b> folder beside the PDF. Egnyte syncs that folder like any other, and everyone's MeBulb merges the changes: the newest edit to each markup wins. If you lose connection, your changes wait on this PC and go out when Egnyte reconnects. Saving writes everyone's markups into the PDF itself.</p></section>`;
    applyCollapsed(el); return;
  }
  const me = `<li><span class="pdot" style="background:${S.color}"></span><span><b>${esc(state.author)}</b> <span class="muted">(you)</span></span><small>page ${currentPage() + 1}</small></li>`;
  const peers = [...S.peers.values()].map((p) => `<li><span class="pdot" style="background:${p.color}"></span><span><b>${esc(p.name)}</b>${p.saving ? ' <span class="tag">saving</span>' : ''}</span><small>${p.page != null ? `page ${p.page + 1} · ` : ''}${ago(p.t)}</small></li>`).join('');
  el.innerHTML = `<section class="psec"><h3>People</h3><div class="live-head"><span class="live-dot"></span><b>Live</b><span class="muted">${esc(d.name)}</span></div>
    <ul class="people">${me}${peers || ''}</ul>${S.peers.size ? '' : '<p class="muted sm">Nobody else is here yet. Others join by opening this PDF in MeBulb.</p>'}</section>
    <section class="psec"><h3>Sync</h3><dl class="kv"><dt>Sent</dt><dd>${S.sent} change${S.sent === 1 ? '' : 's'}, ${ago(S.lastSent)}</dd><dt>Received</dt><dd>${S.recv} change${S.recv === 1 ? '' : 's'}, ${ago(S.lastRecv)}</dd><dt>Waiting</dt><dd>${S.queue.length ? `${S.queue.length} (will send when the folder is writable)` : 'nothing'}</dd>${S.lastError ? `<dt>Problem</dt><dd class="bad">${esc(S.lastError)}</dd>` : ''}</dl>
    <div class="btn-row"><button class="btn sm" data-sa="save">${icon('save')} Save PDF for everyone</button><button class="btn sm" data-sa="stop">Leave</button></div></section>`;
  applyCollapsed(el);
}
function bindSessionPanel() {
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-sa]'); if (!b) return; const a = b.dataset.sa; if (a === 'start') sessionStart(); else if (a === 'stop') sessionStop(); else if (a === 'save') saveDoc('save'); });
}
function sessionStartDialog() { openPanel('session'); }
