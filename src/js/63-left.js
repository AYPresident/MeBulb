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

// ----- tool sets ------------------------------------------------------------------------------
function saveToolsets() { store.set('toolsets', state.toolsets); }
function renderToolsets() {
  const el = $('#toolsets'); if (!el) return;
  el.innerHTML = state.toolsets.map((ts, si) => `<div class="tset"><div class="tset-head"><input value="${esc(ts.name)}" data-ts="${si}" aria-label="Tool set name"><button class="icon-btn sm" data-tsdel="${si}" aria-label="Delete tool set">${icon('trash')}</button></div>${ts.items.length ? ts.items.map((it, ii) => {
    const col = it.tool === 'highlight' ? (it.style && it.style.stroke) : (it.style && (it.style.fill && it.style.fill !== 'none' && it.tool !== 'callout' ? it.style.fill : it.style.stroke)) || '#d6331f';
    return `<div class="titem" data-s="${si}" data-i="${ii}" role="button" tabindex="0"><span class="ti-ic" style="color:${esc(col)}">${icon(TOOLS[it.tool] ? TOOLS[it.tool].icon : 'rect')}</span><span class="ti-name">${esc(it.name)}</span><span class="ti-kind">${esc(TOOLS[it.tool] ? TOOLS[it.tool].short || TOOLS[it.tool].label : it.tool)}</span><button class="icon-btn sm ti-x" data-tidel="${si}:${ii}" aria-label="Remove ${esc(it.name)}">${icon('close')}</button></div>`;
  }).join('') : '<p class="muted pad sm">Empty. Select a markup and choose Add to tool set.</p>'}</div>`).join('') +
    `<div class="btn-row pad"><button class="btn sm" data-tsa="new">${icon('plus')} New tool set</button><button class="btn sm" data-tsa="reset">Restore defaults</button></div><p class="muted pad sm">Tool sets are saved in this browser.</p>`;
}
function bindToolsets() {
  const el = $('#toolsets');
  el.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-tidel]'); if (del) { e.stopPropagation(); const [s, i] = del.dataset.tidel.split(':').map(Number); state.toolsets[s].items.splice(i, 1); saveToolsets(); renderToolsets(); return; }
    const sd = e.target.closest('[data-tsdel]'); if (sd) { const s = +sd.dataset.tsdel; if (await confirmDialog('Delete tool set?', `Delete <b>${esc(state.toolsets[s].name)}</b> and its ${state.toolsets[s].items.length} tools?`, 'Delete', true)) { state.toolsets.splice(s, 1); saveToolsets(); renderToolsets(); } return; }
    const a = e.target.closest('[data-tsa]'); if (a) { if (a.dataset.tsa === 'new') state.toolsets.push({ id: uid('TS'), name: 'My tools', items: [] }); else state.toolsets = deep(DEFAULT_TOOLSETS); saveToolsets(); renderToolsets(); return; }
    const it = e.target.closest('.titem'); if (it) useToolsetItem(state.toolsets[+it.dataset.s].items[+it.dataset.i]);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('titem')) e.target.click(); });
  el.addEventListener('change', (e) => { const t = e.target; if (t.dataset.ts != null) { state.toolsets[+t.dataset.ts].name = t.value.trim() || 'Tool set'; saveToolsets(); } });
}
function useToolsetItem(it) {
  if (!it || !TOOLS[it.tool]) return; const lock = it.tool === 'count' || MEASURE_TYPES.has(it.tool);
  state.toolStyles[it.tool] = { ...(TOOLS[it.tool].style || {}) };
  setTool(it.tool, { style: it.style, subject: it.subject || it.name, text: it.text, lock });
  if (it.tool === 'volume' && it.depth != null) state.volDepth = it.depth;
  if (it.size && TOOLS[it.tool] && TOOLS[it.tool].shape) state.sketchDefaults[TOOLS[it.tool].shape] = deep(it.size);
  toast(`${it.name}: ${lock ? 'tool stays active until Esc' : 'draw on the page'}`);
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
  pick.set.items.push({ name: pick.name, tool: isSk ? (sz.shape === 'circle' ? 'sketchcircle' : 'sketchrect') : m.type, style: deep(m.style), subject: m.subject, text: m.type === 'stamp' ? m.text : undefined, depth: m.depth, size: sz ? deep(sz) : undefined });
  saveToolsets(); openRight('toolsets'); toast(`Added “${pick.name}” to ${pick.set.name}`);
}
async function addToolToToolset() {
  const t = state.tool; const pick = await pickToolset(state.toolSubjects[t] || TOOLS[t].subject || TOOLS[t].label); if (!pick) return;
  pick.set.items.push({ name: pick.name, tool: t, style: toolStyle(t), subject: state.toolSubjects[t] || TOOLS[t].subject, text: t === 'stamp' ? state.stampText : undefined, depth: t === 'volume' ? state.volDepth : undefined, size: TOOLS[t].shape ? deep(state.sketchDefaults[TOOLS[t].shape]) : undefined });
  saveToolsets(); openRight('toolsets'); toast(`Added “${pick.name}” to ${pick.set.name}`);
}
