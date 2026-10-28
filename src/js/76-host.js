// ===== Desktop host bridge (MeBulb.exe) ==========================================
// In the portable Windows app, window.mebulbHost is provided by the preload script.
// In a browser it is absent and the web fallbacks are used.
const HOST = () => window.mebulbHost || null;

async function hostBoot() {
  const H = HOST();
  try { const info = await H.info(); state.hostInfo = info; if (!store.get('author', null) && info.user) { state.author = info.user.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); store.set('author', state.author); } } catch { }
  try { state.recent = await H.getRecent(); } catch { state.recent = []; }
  H.onOpenFiles(async (paths) => { for (const p of paths) await openPath(p); });
  H.onCloseRequest(async () => {
    const dirty = state.docs.filter((d) => d.dirty);
    if (dirty.length) {
      const r = await openDialog({ title: 'Save changes?', body: `<p>${dirty.length === 1 ? `<b>${esc(dirty[0].name)}</b> has` : `${dirty.length} documents have`} unsaved markups.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: "Don't save", value: 'discard', danger: true }, { label: dirty.length === 1 ? 'Save' : 'Save all', value: 'save', primary: true }] });
      if (!r || !r.value) return;
      if (r.value === 'save') { for (const d of dirty) { await switchDoc(d.id); await saveDoc('save'); if (d.dirty) return; } }
    }
    await sessionShutdown();
    H.closeOk();
  });
  state.openedFromArgs = true; // desktop starts on the start page (recent files); files from the command line arrive after load
}
// open a file from disk: small files are read whole, big ones stream through the open handle
async function openPath(p, info) {
  const H = HOST(); const have = state.docs.find((d) => d.path && d.path.toLowerCase() === p.toLowerCase()); if (have) { await switchDoc(have.id); return have; }
  let f = info; if (!f || !f.fid) { try { f = await H.openPath(p); } catch (e) { toast(`Could not open ${p}: ${e.message || e}`, 'error'); if (H.removeRecent) { state.recent = await H.removeRecent(p); renderRecent(); } return null; } }
  const big = f.size > state.prefs.largeFileMB * 1048576; let src;
  if (big) src = hostSource(f.fid, f.size);
  else { const b = new Uint8Array(await H.read(f.fid, 0, f.size)); src = new MemSource(b); }
  const doc = await openSource(f.name, src, { path: f.path, fid: f.fid, stat: { size: f.size, mtimeMs: f.mtimeMs } });
  if (!doc) { H.close(f.fid); return null; }
  doc.diskMatches = true; if (!big) { H.close(f.fid); doc.fid = null; }
  try { state.recent = await H.addRecent(f.path); } catch { } renderRecent();
  return doc;
}
function recentList() { return (state.recent || []).map((p) => (typeof p === 'string' ? { path: p, name: p.split(/[\\/]/).pop(), dir: p.replace(/[\\/][^\\/]*$/, '') } : p)); }
function renderRecent() {
  const el = $('#recent-files'); if (!el) return; const r = HOST() ? recentList().slice(0, 8) : [];
  el.innerHTML = r.length ? `<h3>Recent</h3>${r.map((f, k) => `<button class="recent" data-k="${k}" title="${esc(f.path)}">${icon('pdf')}<span><b>${esc(f.name)}</b><small>${esc(f.dir)}</small></span></button>`).join('')}` : '';
  el.onclick = (e) => { const b = e.target.closest('.recent'); if (b) openRecent(r[+b.dataset.k]); };
}
async function openRecent(f) { if (f && f.path) await openPath(f.path); }
function hostTheme(dark) { const H = HOST(); if (!H || !H.setTitleBar) return; const cs = getComputedStyle(document.documentElement); H.setTitleBar({ bg: cs.getPropertyValue('--title').trim() || (dark ? '#2b3038' : '#f3f4f6'), fg: cs.getPropertyValue('--fg').trim() || (dark ? '#e6e8eb' : '#1f2329'), h: Math.round($('#menubar') ? $('#menubar').getBoundingClientRect().height : 32) || 32 }); }
