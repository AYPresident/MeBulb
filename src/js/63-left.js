// ===== Left panel: pages, bookmarks, search, layers, tool sets =============

// ----- thumbnails & page operations ---------------------------------------------------
let thumbIO = null;
function renderThumbs() {
  const el = $('#thumbs'); const doc = activeDoc(); if (!el) return;
  if (!doc) { el.innerHTML = ''; return; }
  if (el.dataset.doc !== doc.id || el.dataset.ver !== String(doc.pdfVer) || el.children.length !== doc.numPages) {
    el.dataset.doc = doc.id; el.dataset.ver = String(doc.pdfVer);
    el.innerHTML = doc.pages.map((pg, i) => { const w = 132, h = Math.round((w * pg.h) / pg.w); return `<button class="thumb" data-i="${i}" title="Page ${i + 1}"><span class="tcv" style="width:${w}px;height:${h}px"></span><span class="tl">${i + 1}${pg.label && pg.label !== String(i + 1) ? ' · ' + esc(pg.label) : ''}</span></button>`; }).join('');
    if (thumbIO) thumbIO.disconnect();
    thumbIO = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { thumbIO.unobserve(en.target); drawThumb(doc, +en.target.dataset.i, en.target); } }), { root: el.closest('.pane'), rootMargin: '300px' });
    $$('.thumb', el).forEach((t) => thumbIO.observe(t));
  }
  const cur = currentPage(); $$('.thumb', el).forEach((t) => { t.classList.toggle('cur', +t.dataset.i === cur); t.classList.toggle('sel', +t.dataset.i === state.thumbSel); });
}
async function drawThumb(doc, i, btn) {
  try {
    const page = await doc.pdf.getPage(i + 1); const pg = doc.pages[i]; const dpr = window.devicePixelRatio || 1; const sc = (132 * dpr) / pg.w;
    const vp = page.getViewport({ scale: sc, rotation: page.rotate }); const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await hideOwnAnnots(doc, i); await page.render({ canvasContext: ctx, canvas: c, viewport: vp, annotationMode: annotMode(doc) }).promise; colorAdjCanvas(ctx, c.width, c.height, colorAdjFor(doc, i));
    const slot = btn.querySelector('.tcv'); if (slot) { slot.innerHTML = ''; slot.appendChild(c); }
  } catch (e) { /* page may have been removed */ }
}
function thumbClick(e) {
  const t = e.target.closest('.thumb'); if (!t) return; const i = +t.dataset.i; state.thumbSel = i; goToPage(i); renderThumbs();
}
function pageOpCurrent(op) { if (!activeDoc()) return; state.thumbSel = currentPage(); pageOp(op); }
function selectedPagesForOp() { const d = activeDoc(); return [clamp(state.thumbSel, 0, d.numPages - 1)]; }
async function pageOp(op) {
  const doc = activeDoc(); if (!doc) return; const [i] = selectedPagesForOp();
  try {
    if (op === 'rotcw') await rotatePages([i], 90);
    else if (op === 'rotccw') await rotatePages([i], -90);
    else if (op === 'delete') {
      if (doc.numPages === 1) { toast('A document needs at least one page'); return; }
      const n = doc.markups.filter((m) => m.page === i).length;
      if (!(await confirmDialog('Delete page?', `Delete page ${i + 1}${n ? ` and its ${n} markup${n > 1 ? 's' : ''}` : ''}? You can undo this.`, 'Delete page', true))) return;
      await deletePages([i]);
    } else if (op === 'blank') await insertBlank(i + 1, doc.pages[i]);
    else if (op === 'insert') { state.insertAt = i + 1; $('#file-insert').click(); }
    else if (op === 'up' && i > 0) { await movePage(i, i - 1); state.thumbSel = i - 1; }
    else if (op === 'down' && i < doc.numPages - 1) { await movePage(i, i + 1); state.thumbSel = i + 1; }
    else if (op === 'extract') extractDialog();
    else if (op === 'compare') compareDialog();
    renderThumbs();
  } catch (err) { console.error(err); toast('Page operation failed: ' + err.message, 'error'); }
}

// ----- bookmarks ------------------------------------------------------------------------
async function renderBookmarks() {
  const el = $('#bookmarks'); const doc = activeDoc(); if (!el) return; if (!doc) { el.innerHTML = ''; return; }
  if (doc.outline === null) { try { doc.outline = (await doc.pdf.getOutline()) || []; } catch { doc.outline = []; } }
  const build = (items) => `<ul>${items.map((it, k) => `<li><button class="bm" data-path="">${esc(it.title || 'Untitled')}</button>${it.items && it.items.length ? build(it.items) : ''}</li>`).join('')}</ul>`;
  if (!doc.outline.length) { el.innerHTML = '<p class="muted pad">This PDF has no bookmarks.</p>'; return; }
  el.innerHTML = build(doc.outline);
  const flat = []; const walk = (items) => items.forEach((it) => { flat.push(it); if (it.items) walk(it.items); }); walk(doc.outline);
  $$('.bm', el).forEach((b, k) => { b.onclick = () => goToDest(flat[k].dest); });
}
async function goToDest(dest) {
  const doc = activeDoc(); if (!dest) return;
  try {
    if (typeof dest === 'string') dest = await doc.pdf.getDestination(dest); if (!dest) return;
    const ref = dest[0]; const idx = typeof ref === 'number' ? ref : await doc.pdf.getPageIndex(ref);
    const T = doc.pages[idx].T; let at = null;
    if (dest[1] && dest[1].name === 'XYZ' && dest[2] != null && dest[3] != null) at = [T[0] * dest[2] + T[2] * dest[3] + T[4], T[1] * dest[2] + T[3] * dest[3] + T[5]];
    if (at) { V.el.scrollTop = doc.pageEls[idx].offsetTop + at[1] * doc.zoom - 20; } else goToPage(idx);
  } catch (e) { console.warn(e); }
}

// ----- text search --------------------------------------------------------------------------
async function pageText(doc, i) {
  if (doc.textCache[i]) return doc.textCache[i];
  const page = await doc.pdf.getPage(i + 1); const tc = await page.getTextContent(); const vp = page.getViewport({ scale: 1, rotation: page.rotate });
  let full = ''; const map = []; // per char: [itemIndex, offset]
  const items = tc.items.filter((it) => it.str !== undefined).map((it) => {
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform); const ang = Math.atan2(tx[1], tx[0]); const fh = Math.hypot(tx[2], tx[3]) || 10;
    const st = tc.styles[it.fontName]; const asc = st && st.ascent ? st.ascent : st && st.descent ? 1 + st.descent : 0.8;
    return { str: it.str, x: tx[4], y: tx[5], ang, fh, w: it.width * vp.scale, asc, eol: it.hasEOL, fontName: it.fontName };
  });
  (doc.ocr && doc.ocr[i] || []).forEach((w) => items.push({ str: w.str, x: w.x, y: w.y + w.h * 0.8, ang: 0, fh: w.h, w: w.w, asc: 0.8, eol: true, ocr: true }));
  const starts = [];
  items.forEach((it, k) => { starts[k] = full.length; for (let c = 0; c < it.str.length; c++) { full += it.str[c]; map.push([k, c]); } if (it.eol || (items[k + 1] && !/\s$/.test(it.str) && !/^\s/.test(items[k + 1].str))) { full += ' '; map.push([k, -1]); } });
  doc.textCache[i] = { full, map, items, starts, styles: tc.styles }; return doc.textCache[i];
}
function itemRect(it, c0, c1) {
  const n = Math.max(1, it.str.length); const x0 = (it.w * c0) / n, x1 = (it.w * c1) / n; const top = -it.fh * it.asc, bot = it.fh * (1 - it.asc) * 0.9;
  const cos = Math.cos(it.ang), sin = Math.sin(it.ang); const tr = (lx, ly) => [it.x + lx * cos - ly * sin, it.y + lx * sin + ly * cos];
  return [tr(x0, top), tr(x1, top), tr(x1, bot), tr(x0, bot)];
}
async function runSearch(q) {
  const doc = activeDoc(); if (!doc) return; state.search.q = q; state.search.hits = []; state.search.idx = -1;
  if (!q.trim()) { renderSearchResults(); renderSearchHits(); return; }
  state.search.busy = true; renderSearchResults(); const token = (state.search.token = {});
  const needle = state.search.caseSens ? q : q.toLowerCase();
  for (let i = 0; i < doc.numPages; i++) {
    const t = await pageText(doc, i); if (state.search.token !== token) return;
    const hay = state.search.caseSens ? t.full : t.full.toLowerCase(); let from = 0;
    while (true) {
      const at = hay.indexOf(needle, from); if (at < 0) break; from = at + Math.max(1, needle.length);
      const rects = []; let k = at;
      while (k < at + needle.length) { const [item, off] = t.map[k]; if (off < 0) { k++; continue; } let e = k; while (e < at + needle.length && t.map[e][0] === item && t.map[e][1] >= 0) e++; rects.push(itemRect(t.items[item], off, t.map[e - 1][1] + 1)); k = e; }
      const s0 = Math.max(0, at - 32), s1 = Math.min(t.full.length, at + needle.length + 32);
      state.search.hits.push({ page: i, rects, pre: (s0 > 0 ? '…' : '') + t.full.slice(s0, at), match: t.full.slice(at, at + needle.length), post: t.full.slice(at + needle.length, s1) + (s1 < t.full.length ? '…' : '') });
      if (state.search.hits.length >= 2000) break;
    }
    if (i % 5 === 4) { renderSearchResults(); await raf(); }
  }
  state.search.busy = false; renderSearchResults(); renderSearchHits(); if (state.search.hits.length) gotoHit(0);
}
function renderSearchResults() {
  const el = $('#search-results'); if (!el) return; const S = state.search;
  const head = S.q ? `<div class="sr-head">${S.busy ? 'Searching… ' : ''}${S.hits.length} result${S.hits.length === 1 ? '' : 's'}${S.hits.length ? `<span><button class="icon-btn sm" data-sr="prev" aria-label="Previous result">${icon('up')}</button><button class="icon-btn sm" data-sr="next" aria-label="Next result">${icon('down')}</button></span>` : ''}</div>` : '<p class="muted pad">Search the text of every page. Scanned drawings without a text layer return no results.</p>';
  el.innerHTML = head + S.hits.slice(0, 500).map((h, k) => `<button class="sr${k === S.idx ? ' on' : ''}" data-k="${k}"><span class="sr-p">p.${h.page + 1}</span><span class="sr-t">${esc(h.pre)}<mark>${esc(h.match)}</mark>${esc(h.post)}</span></button>`).join('');
}
function renderSearchHits() {
  const doc = activeDoc(); if (!doc || !doc.pageEls) return; const z = doc.zoom;
  doc.pageEls.forEach((el, i) => {
    const g = el.querySelector('g.search');
    g.innerHTML = state.search.hits.map((h, k) => (h.page !== i ? '' : h.rects.map((r) => `<path class="shit${k === state.search.idx ? ' cur' : ''}" d="${P.toD(P.poly(r, true))}" stroke-width="${1 / z}"/>`).join(''))).join('');
  });
}
function gotoHit(k) {
  const S = state.search; if (!S.hits.length) return; S.idx = (k + S.hits.length) % S.hits.length; const h = S.hits[S.idx];
  const b = G.bbox(h.rects.flat()); goToPage(h.page, [b.x + b.w / 2, b.y + b.h / 2]); renderSearchHits(); renderSearchResults();
  const on = $('#search-results .sr.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}

// ----- layers -----------------------------------------------------------------------------
function renderLayers() {
  const el = $('#layers'); if (!el) return; const doc = activeDoc(); if (!doc) { el.innerHTML = ''; return; }
  const counts = {}; doc.markups.forEach((m) => { counts[m.layer || ''] = (counts[m.layer || ''] || 0) + 1; });
  el.innerHTML = `<div class="layer-row base"><span class="lr-name">No layer</span><span class="lr-n">${counts[''] || 0}</span><label class="lr-act" title="New markups go to this layer"><input type="radio" name="actlayer" value=""${!doc.activeLayer ? ' checked' : ''}> Active</label></div>` +
    doc.layers.map((l) => `<div class="layer-row" data-id="${l.id}"><button class="icon-btn sm" data-la="vis" aria-label="${l.visible === false ? 'Show' : 'Hide'} layer" title="${l.visible === false ? 'Show' : 'Hide'}">${icon(l.visible === false ? 'eyeoff' : 'eye')}</button><button class="icon-btn sm" data-la="lock" aria-label="${l.locked ? 'Unlock' : 'Lock'} layer" title="${l.locked ? 'Unlock' : 'Lock'}">${icon(l.locked ? 'lock' : 'unlock')}</button><input class="lr-name" value="${esc(l.name)}" data-la="name" aria-label="Layer name"><span class="lr-n">${counts[l.id] || 0}</span><label class="lr-act"><input type="radio" name="actlayer" value="${l.id}"${doc.activeLayer === l.id ? ' checked' : ''}> Active</label><button class="icon-btn sm" data-la="del" aria-label="Delete layer">${icon('trash')}</button></div>`).join('') +
    `<div class="btn-row pad"><button class="btn sm" data-la="new">${icon('plus')} New layer</button><button class="btn sm" data-la="assign"${state.sel.size ? '' : ' disabled'}>Move selection to active layer</button></div>`;
}
function bindLayers() {
  const el = $('#layers');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-la]'); if (!b || b.tagName === 'INPUT') return; const doc = activeDoc(); const row = b.closest('.layer-row'); const l = row && layerOf(doc, row.dataset.id); const a = b.dataset.la;
    if (a === 'new') { pushUndo(doc); const nl = { id: uid('L'), name: `Layer ${doc.layers.length + 1}`, visible: true, locked: false }; doc.layers.push(nl); doc.activeLayer = nl.id; renderLayers(); renderProps(); return; }
    if (a === 'assign') { applyToSelection((m) => { m.layer = doc.activeLayer || null; }); renderLayers(); renderProps(); return; }
    if (!l) return;
    if (a === 'vis') { l.visible = l.visible === false; markDirty(doc); state.sel.forEach((id) => { const m = getMarkup(id); if (m && m.layer === l.id && !l.visible) state.sel.delete(id); }); renderAllMarks(doc); }
    if (a === 'lock') { l.locked = !l.locked; markDirty(doc); refreshSelection(); }
    if (a === 'del') { pushUndo(doc); doc.layers = doc.layers.filter((x) => x.id !== l.id); doc.markups.forEach((m) => { if (m.layer === l.id) m.layer = null; }); if (doc.activeLayer === l.id) doc.activeLayer = null; renderAllMarks(doc); renderProps(); renderList(); }
    renderLayers();
  });
  el.addEventListener('change', (e) => {
    const doc = activeDoc(); const t = e.target;
    if (t.name === 'actlayer') { doc.activeLayer = t.value || null; return; }
    if (t.dataset.la === 'name') { const l = layerOf(doc, t.closest('.layer-row').dataset.id); if (l) { pushUndo(doc); l.name = t.value.trim() || l.name; renderList(); renderProps(); } }
  });
}

// ----- tool sets (a tool chest in the Revu style) -----------------------------------------------
// Each set is a group of saved tools with their look. A tool is used in one of two ways, as in Revu:
// properties mode (draw a new markup with the saved look) or drawing mode (drop a copy of the saved
// markup, same size and shape, where you click). Recent tools collect themselves as you draw.
function saveToolsets() { store.set('toolsets', state.toolsets); }
const _pvCache = new Map();
function previewOf(it) { const k = JSON.stringify([it.tool, it.style, it.text, it.shape, it.depth, it.size, it.name]); let v = _pvCache.get(k); if (!v) { v = toolPreview(it); if (_pvCache.size > 400) _pvCache.clear(); _pvCache.set(k, v); } return v; }
const tsKind = (it) => (it.tool === 'group' ? `Group of ${it.shapes.length}` : TOOLS[it.tool] ? TOOLS[it.tool].short || TOOLS[it.tool].label : it.tool);
const tsFixed = (it) => it.tool === 'group' || (it.tool === 'stamp' && it.asset); // only placed as drawn
const tsSet = (s) => (s === 'r' ? { id: 'recent', name: 'Recent tools', items: state.recentTools || [], collapsed: state.recentCollapsed, view: state.recentView || 'grid', recent: true } : state.toolsets[+s]);
function tsItemHtml(it, si, ii) {
  const tip = `${it.name} · ${tsKind(it)}${it.mode === 'drawing' ? ' · drawing mode (places this exact shape)' : ''}`;
  return `<div class="titem${it.mode === 'drawing' ? ' drawing' : ''}" data-s="${si}" data-i="${ii}" role="button" tabindex="0" draggable="${si === 'r' ? 'false' : 'true'}" title="${esc(tip)}"><span class="ti-pv">${previewOf(it)}</span><span class="ti-name">${esc(it.name)}</span><span class="ti-kind">${esc(tsKind(it))}</span>${it.mode === 'drawing' ? '<span class="ti-mode" aria-label="Drawing mode">D</span>' : ''}</div>`;
}
function tsSectionHtml(ts, si) {
  const view = ts.view || 'grid'; const shut = !!ts.collapsed; const n = ts.items.length;
  const empty = ts.recent ? 'Tools you use appear here.' : 'Empty. Right-click a markup and choose Add to tool set, or drag tools here.';
  return `<section class="tset${shut ? ' shut' : ''}" data-s="${si}"><div class="tset-head" data-s="${si}"><button class="icon-btn sm ts-tog" data-tst="${si}" aria-expanded="${!shut}" aria-label="${shut ? 'Show' : 'Hide'} ${esc(ts.name)}">${icon(shut ? 'chevr' : 'chevd')}</button><span class="ts-name" data-tsn="${si}" title="${ts.recent ? '' : 'Double-click to rename'}">${esc(ts.name)}</span><span class="ts-n">${n}</span>${ts.from === 'btx' ? '<span class="ts-tag" title="Imported from a Bluebeam tool set">BTX</span>' : ''}<button class="icon-btn sm" data-tsm="${si}" aria-label="${esc(ts.name)} options">${icon('more')}</button></div>${shut ? '' : `<div class="tbody ${view}" data-s="${si}">${n ? ts.items.map((it, ii) => tsItemHtml(it, si, ii)).join('') : `<p class="muted pad sm">${empty}</p>`}</div>`}</section>`;
}
function renderToolsets() {
  const el = $('#toolsets'); if (!el) return;
  const bar = `<div class="ts-bar"><button class="btn sm" data-tsa="new">${icon('plus')} New set</button><button class="btn sm" data-tsa="import" title="Import Bluebeam Revu tool sets (.btx)">${icon('import')} Import .btx</button><span class="grow"></span><button class="icon-btn sm" data-tsa="more" aria-label="More tool set options">${icon('more')}</button></div>`;
  const placing = state.placeItem ? `<div class="ts-placing">${icon('info')} Click the page to place “${esc(state.placeItem.name)}”. Esc to stop.</div>` : '';
  el.innerHTML = bar + placing + ((state.recentTools || []).length ? tsSectionHtml(tsSet('r'), 'r') : '') + state.toolsets.map((ts, si) => tsSectionHtml(ts, si)).join('') +
    `<p class="muted pad sm">Tool sets are saved on this computer. Import .btx and Export .btx swap them with Bluebeam Revu.</p>`;
}
function renameToolset(si) {
  const sp = $(`#toolsets [data-tsn="${si}"]`); if (!sp || si === 'r') return; const ts = state.toolsets[+si];
  const inp = document.createElement('input'); inp.value = ts.name; inp.className = 'ts-rename'; inp.setAttribute('aria-label', 'Tool set name'); sp.replaceWith(inp); inp.focus(); inp.select();
  let done = false; const fin = (ok) => { if (done) return; done = true; if (ok) ts.name = inp.value.trim() || ts.name; saveToolsets(); renderToolsets(); };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); }); inp.addEventListener('blur', () => fin(true));
}
async function renameToolItem(si, ii) {
  const it = tsSet(si).items[ii]; const r = await openDialog({ title: 'Rename tool', body: field('Name', `<input type="text" name="name" value="${esc(it.name)}" maxlength="60" required>`), buttons: [{ label: 'Cancel', value: false }, { label: 'Rename', value: true, primary: true }] });
  if (r && r.value && r.form.name.trim()) { it.name = r.form.name.trim(); si === 'r' ? store.set('recentTools', state.recentTools) : saveToolsets(); renderToolsets(); }
}
function pickBtxFiles() { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.btx,application/xml,text/xml'; inp.multiple = true; inp.onchange = () => importBtxFiles([...inp.files]); inp.click(); }
async function exportToolset(si) { const ts = tsSet(si); if (!ts.items.length) { toast('This tool set is empty'); return; } try { const n = await exportBtx(ts); toast(`Exported ${n} tool${n === 1 ? '' : 's'} to ${ts.name}.btx`); } catch (e) { toast('Export failed: ' + (e.message || e), 'error'); } }
function toolsetMenu(si, x, y) {
  const ts = tsSet(si); const k = +si; const items = [];
  if (si === 'r') { items.push([ts.view === 'list' ? 'Show as icons' : 'Show as list', () => { state.recentView = ts.view === 'list' ? 'grid' : 'list'; renderToolsets(); }], ['Save as a tool set…', () => { state.toolsets.push({ id: uid('TS'), name: 'My tools', items: deep(state.recentTools) }); saveToolsets(); renderToolsets(); renameToolset(state.toolsets.length - 1); }], ['Export .btx…', () => exportToolset('r')], ['-'], ['Clear recent tools', () => { state.recentTools = []; store.set('recentTools', []); renderToolsets(); }, 'danger']); showMenu(x, y, items); return; }
  items.push(['Rename', () => renameToolset(si)], [ts.view === 'list' ? 'Show as icons' : 'Show as list', () => { ts.view = ts.view === 'list' ? 'grid' : 'list'; saveToolsets(); renderToolsets(); }], ['Export .btx…', () => exportToolset(si)], ['Duplicate set', () => { state.toolsets.splice(k + 1, 0, { ...deep(ts), id: uid('TS'), name: ts.name + ' copy', from: undefined }); saveToolsets(); renderToolsets(); }]);
  if (k > 0) items.push(['Move up', () => { state.toolsets.splice(k - 1, 0, state.toolsets.splice(k, 1)[0]); saveToolsets(); renderToolsets(); }]);
  if (k < state.toolsets.length - 1) items.push(['Move down', () => { state.toolsets.splice(k + 1, 0, state.toolsets.splice(k, 1)[0]); saveToolsets(); renderToolsets(); }]);
  items.push(['-'], ['Delete set', async () => { if (await confirmDialog('Delete tool set?', `Delete <b>${esc(ts.name)}</b> and its ${ts.items.length} tools?`, 'Delete', true)) { state.toolsets.splice(k, 1); saveToolsets(); renderToolsets(); } }, 'danger']);
  showMenu(x, y, items);
}
function toolItemMenu(si, ii, x, y) {
  const ts = tsSet(si); const it = ts.items[ii]; const save = () => { if (si === 'r') store.set('recentTools', state.recentTools); else saveToolsets(); renderToolsets(); };
  const canDraw = tsFixed(it) || (!(it.tool === 'stamp' && it.stampId && !String(it.stampId).startsWith('txt:')) && TOOLS[it.tool] && !TOOLS[it.tool].shape);
  const items = tsFixed(it) ? [] : [['Use (properties mode)', () => useToolsetItem({ ...it, mode: 'properties' })]];
  if (canDraw) items.push(['Place a copy (drawing mode)', () => useToolsetItem({ ...it, mode: 'drawing' })]);
  if (!ts.recent && canDraw && !tsFixed(it)) items.push([it.mode === 'drawing' ? 'Click uses properties mode' : 'Click uses drawing mode', () => { it.mode = it.mode === 'drawing' ? 'properties' : 'drawing'; save(); }]);
  items.push(['-'], ['Rename…', () => renameToolItem(si, ii)]);
  if (ts.recent) items.push(['Add to tool set…', async () => { const pick = await pickToolset(it.name); if (pick) { pick.set.items.push({ ...deep(it), name: pick.name }); saveToolsets(); renderToolsets(); } }]);
  else {
    items.push(['Duplicate', () => { ts.items.splice(ii + 1, 0, { ...deep(it), name: it.name + ' copy' }); save(); }]);
    if (ii > 0) items.push(['Move up', () => { ts.items.splice(ii - 1, 0, ts.items.splice(ii, 1)[0]); save(); }]);
    if (ii < ts.items.length - 1) items.push(['Move down', () => { ts.items.splice(ii + 1, 0, ts.items.splice(ii, 1)[0]); save(); }]);
    state.toolsets.forEach((o, k) => { if (k !== +si) items.push([`Move to ${o.name}`, () => { o.items.push(ts.items.splice(ii, 1)[0]); save(); }]); });
  }
  items.push(['-'], ['Delete', () => { ts.items.splice(ii, 1); save(); }, 'danger']);
  showMenu(x, y, items);
}
function bindToolsets() {
  const el = $('#toolsets');
  el.addEventListener('click', (e) => {
    const tg = e.target.closest('[data-tst]'); if (tg) { const s = tg.dataset.tst; if (s === 'r') state.recentCollapsed = !state.recentCollapsed; else { state.toolsets[+s].collapsed = !state.toolsets[+s].collapsed; saveToolsets(); } renderToolsets(); return; }
    const mb = e.target.closest('[data-tsm]'); if (mb) { const r = mb.getBoundingClientRect(); toolsetMenu(mb.dataset.tsm, r.left, r.bottom + 2); return; }
    const a = e.target.closest('[data-tsa]');
    if (a) {
      const k = a.dataset.tsa;
      if (k === 'new') { state.toolsets.push({ id: uid('TS'), name: 'My tools', items: [], view: 'grid' }); saveToolsets(); renderToolsets(); renameToolset(state.toolsets.length - 1); }
      else if (k === 'import') pickBtxFiles();
      else if (k === 'more') { const r = a.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, [['Import Bluebeam tool sets (.btx)…', pickBtxFiles], ['Export all sets as .btx…', async () => { for (let s = 0; s < state.toolsets.length; s++) if (state.toolsets[s].items.length) await exportToolset(s); }], ['Collapse all', () => { state.toolsets.forEach((t) => { t.collapsed = true; }); state.recentCollapsed = true; saveToolsets(); renderToolsets(); }], ['Expand all', () => { state.toolsets.forEach((t) => { t.collapsed = false; }); state.recentCollapsed = false; saveToolsets(); renderToolsets(); }], ['-'], ['Add the MeBulb starter sets', () => { const have = new Set(state.toolsets.map((t) => t.id)); state.toolsets.push(...deep(DEFAULT_TOOLSETS).filter((t) => !have.has(t.id))); saveToolsets(); renderToolsets(); }], ['Restore the starter sets only…', async () => { if (await confirmDialog('Restore starter sets?', 'This replaces all your tool sets with the MeBulb starter sets. Export any you want to keep first.', 'Restore', true)) { state.toolsets = deep(DEFAULT_TOOLSETS); saveToolsets(); renderToolsets(); } }, 'danger']]); }
      return;
    }
    const it = e.target.closest('.titem'); if (it) useToolsetItem(tsSet(it.dataset.s).items[+it.dataset.i]);
  });
  el.addEventListener('dblclick', (e) => { const n = e.target.closest('[data-tsn]'); if (n) renameToolset(n.dataset.tsn); });
  el.addEventListener('contextmenu', (e) => {
    const it = e.target.closest('.titem'); if (it) { e.preventDefault(); toolItemMenu(it.dataset.s, +it.dataset.i, e.clientX, e.clientY); return; }
    const h = e.target.closest('.tset-head'); if (h) { e.preventDefault(); toolsetMenu(h.dataset.s, e.clientX, e.clientY); }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('titem')) e.target.click(); if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && e.target.classList.contains('titem')) { e.preventDefault(); const r = e.target.getBoundingClientRect(); toolItemMenu(e.target.dataset.s, +e.target.dataset.i, r.left + 20, r.bottom); } });
  // drag tools to reorder them or move them between sets; drop .btx files to import them
  let drag = null;
  el.addEventListener('dragstart', (e) => { const it = e.target.closest('.titem'); if (!it || it.dataset.s === 'r') return; drag = { s: +it.dataset.s, i: +it.dataset.i }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-mebulb-tool', `${drag.s}:${drag.i}`); it.classList.add('dragging'); });
  el.addEventListener('dragend', () => { drag = null; $$('#toolsets .dragging, #toolsets .drop-before, #toolsets .drop-in').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-in')); });
  el.addEventListener('dragover', (e) => {
    if (!drag) return; const tgt = e.target.closest('.titem, .tset'); if (!tgt || tgt.dataset.s === 'r') return; e.preventDefault(); e.stopPropagation();
    $$('#toolsets .drop-before, #toolsets .drop-in').forEach((x) => x.classList.remove('drop-before', 'drop-in')); tgt.classList.add(tgt.classList.contains('titem') ? 'drop-before' : 'drop-in');
  });
  el.addEventListener('drop', (e) => {
    if (!drag) return; const tgt = e.target.closest('.titem, .tset'); if (!tgt || tgt.dataset.s === 'r') return; e.preventDefault(); e.stopPropagation();
    const from = state.toolsets[drag.s]; const it = from.items.splice(drag.i, 1)[0]; const to = state.toolsets[+tgt.dataset.s];
    let at = tgt.classList.contains('titem') ? +tgt.dataset.i : to.items.length; if (to === from && tgt.classList.contains('titem') && drag.i < at) at--;
    to.items.splice(at, 0, it); to.collapsed = false; drag = null; saveToolsets(); renderToolsets();
  });
}
function useToolsetItem(it) {
  if (it && tsFixed(it)) { setTool('select'); state.placeItem = it; V.el.dataset.place = '1'; renderToolsets(); toast(`${it.name}: click the page to place it`); return; }
  if (!it || !TOOLS[it.tool]) return; const lock = it.tool === 'count' || MEASURE_TYPES.has(it.tool);
  state.toolStyles[it.tool] = { ...(TOOLS[it.tool].style || {}) };
  if (it.tool === 'stamp') state.stampId = it.stampId || 'txt:' + (it.text || 'APPROVED');
  setTool(it.tool, { style: it.style, subject: it.subject || it.name, text: it.text, lock: lock && it.mode !== 'drawing' });
  if (it.tool === 'volume' && it.depth != null) state.volDepth = it.depth;
  if (it.size && TOOLS[it.tool] && TOOLS[it.tool].shape) state.sketchDefaults[TOOLS[it.tool].shape] = deep(it.size);
  if (it.mode === 'drawing' && !TOOLS[it.tool].shape) { state.placeItem = it; V.el.dataset.place = '1'; renderToolsets(); toast(`${it.name}: click the page to place a copy`); return; }
  toast(`${it.name}: ${lock ? 'tool stays active until Esc' : 'draw on the page'}`);
}
// drawing mode: drop the saved markup (or a grouped tool's markups), same size and look, centred where you click
function placeToolItem(it, page, p) {
  const doc = activeDoc(); const ms = toolMarkups(it); const all = G.bbox(ms.flatMap((m) => m.pts)); const dx = p[0] - (all.x + all.x2) / 2, dy = p[1] - (all.y + all.y2) / 2;
  const gid = ms.length > 1 ? uid('G-') : null; const A = toolAssets(); const placed = [];
  pushUndo(doc);
  for (const m of ms) {
    const x = newMarkup(m.type, page, m.pts.map(([a, b]) => [a + dx, b + dy]), { style: deep(m.style), subject: m.subject || it.subject || it.name });
    if (m.text) x.text = m.text; if (m.runs) x.runs = deep(m.runs); if (m.depth != null) x.depth = m.depth; if (x.type === 'volume' && x.depth == null) x.depth = defaultDepth(scaleAt(doc, page, p));
    if (m.asset && A[m.asset]) { doc.assets = doc.assets || {}; doc.assets[m.asset] = doc.assets[m.asset] || A[m.asset]; if (TOOL_ASSETS.img[m.asset]) { doc.assetImg = doc.assetImg || {}; doc.assetImg[m.asset] = TOOL_ASSETS.img[m.asset]; } x.asset = m.asset; }
    if (m.ext && (m.ext.it || m.ext.bsi)) x.ext = { it: m.ext.it, bsi: m.ext.bsi };
    if (gid) { x.group = gid; x.ext = { ...(x.ext || {}), groupPrimary: !!(m.ext && m.ext.groupPrimary), groupName: m.ext && m.ext.groupName || undefined }; }
    doc.markups.push(x); placed.push(x);
  }
  renderMarks(doc, page); refreshPanels(); if (placed.length === 1) noteRecentTool(placed[0]);
  state.sel.clear(); placed.forEach((x) => state.sel.add(x.id));
  if (!state.toolLocked && !state.reuse) { endPlace(); if (state.tool !== 'select') setTool('select'); placed.forEach((x) => state.sel.add(x.id)); }
  refreshSelection();
}
function endPlace() { if (!state.placeItem) return; state.placeItem = null; state.ghost = null; if (V.el) delete V.el.dataset.place; renderDraft(); renderToolsets(); }
// what drawing mode will drop, following the pointer
function toolGhost(doc, page, p) {
  const it = state.placeItem; if (!it) return ''; const ms = toolMarkups(it); const all = G.bbox(ms.flatMap((m) => m.pts)); const dx = p[0] - (all.x + all.x2) / 2, dy = p[1] - (all.y + all.y2) / 2;
  const sd = sampleDoc(); sd.pages = doc.pages; sd.scales = doc.scales; return `<g class="ghost" opacity="0.55">${ms.map((m) => dl({ ...m, page, pts: m.pts.map(([a, b]) => [a + dx, b + dy]) }, sd).map(primSvg).join('')).join('')}</g>`;
}
async function pickToolset(defName) {
  const r = await openDialog({ title: 'Add to tool set', body: `${field('Name', `<input type="text" name="name" value="${esc(defName)}" maxlength="60" required>`)}${field('Tool set', `<select name="set">${state.toolsets.map((t, k) => `<option value="${k}">${esc(t.name)}</option>`).join('')}<option value="new">New tool set…</option></select>`)}`, buttons: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, primary: true }] });
  if (!r || !r.value) return null;
  let k = r.form.set; if (k === 'new' || !state.toolsets.length) { state.toolsets.push({ id: uid('TS'), name: 'My tools', items: [] }); k = state.toolsets.length - 1; }
  return { set: state.toolsets[+k], name: r.form.name.trim() || defName };
}
async function addSelectionToToolset() {
  const m = selected()[0]; if (!m) return; const pick = await pickToolset(m.subject); if (!pick) return;
  const doc = activeDoc(); const isSk = m.type === 'sketch'; const sz = isSk ? sketchSize(doc, m) : null;
  const c = G.bbox(m.pts); const cx = (c.x + c.x2) / 2, cy = (c.y + c.y2) / 2;
  const shape = isSk || m.type === 'count' ? undefined : { pts: m.pts.map(([x, y]) => [x - cx, y - cy]), text: TEXT_TYPES.has(m.type) ? m.text : null, runs: m.runs ? deep(m.runs) : null };
  pick.set.items.push({ name: pick.name, tool: isSk ? (sz.shape === 'circle' ? 'sketchcircle' : 'sketchrect') : m.type, style: deep(m.style), subject: m.subject, text: m.type === 'stamp' ? m.text : undefined, stampId: m.type === 'stamp' ? m.stampId : undefined, depth: m.depth, size: sz ? deep(sz) : undefined, shape });
  saveToolsets(); openRight('toolsets'); toast(`Added “${pick.name}” to ${pick.set.name}`);
}
async function addToolToToolset() {
  const t = state.tool; const pick = await pickToolset(state.toolSubjects[t] || TOOLS[t].subject || TOOLS[t].label); if (!pick) return;
  pick.set.items.push({ name: pick.name, tool: t, style: toolStyle(t), subject: state.toolSubjects[t] || TOOLS[t].subject, text: t === 'stamp' ? (currentStamp() ? currentStamp().name || currentStamp().text : state.stampText) : undefined, stampId: t === 'stamp' ? state.stampId : undefined, depth: t === 'volume' ? state.volDepth : undefined, size: TOOLS[t].shape ? deep(state.sketchDefaults[TOOLS[t].shape]) : undefined });
  saveToolsets(); openRight('toolsets'); toast(`Added “${pick.name}” to ${pick.set.name}`);
}
