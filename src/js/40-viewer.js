// ===== Viewer: page layout, rendering, zoom ==================================
const V = { el: null, pages: null, renderBusy: false, renderAgain: false };
const MAX_PIX = 14e6; // per-canvas pixel budget; beyond it a detail canvas covers the visible area
function viewerZoom() { const d = activeDoc(); return d ? d.zoom : 1; }

function mountDoc(doc) {
  V.pages.innerHTML = '';
  if (!doc) { $('#empty').hidden = false; return; }
  $('#empty').hidden = true;
  doc.pageEls = doc.pages.map((pg, i) => {
    const el = document.createElement('div'); el.className = 'page'; el.dataset.i = i;
    el.innerHTML = `<canvas class="base"></canvas><canvas class="detail" hidden></canvas><svg class="ov" xmlns="http://www.w3.org/2000/svg"><g class="grid"></g><g class="vports"></g><g class="search"></g><g class="flat"></g><g class="marks"></g><g class="draft"></g><g class="sel"></g></svg>`;
    V.pages.appendChild(el); return el;
  });
  layoutPages(doc);
  if (!doc.fitted) { doc.fitted = true; fitWidth(false); }
  V.el.scrollTop = doc.scrollTop; V.el.scrollLeft = doc.scrollLeft;
  renderAllMarks(doc); renderSearchHits(); renderFormLayers(); renderColorAdj(doc); scheduleRender(); updateZoomUI(); updatePageUI();
}

function layoutPages(doc = activeDoc()) {
  if (!doc || !doc.pageEls) return; const z = doc.zoom; V.pages.style.setProperty('--z', z);
  doc.pageEls.forEach((el, i) => {
    const pg = doc.pages[i]; const w = Math.round(pg.w * z), h = Math.round(pg.h * z);
    el.style.width = w + 'px'; el.style.height = h + 'px';
    const svg = el.querySelector('svg.ov'); svg.setAttribute('viewBox', `0 0 ${pg.w} ${pg.h}`); svg.setAttribute('width', w); svg.setAttribute('height', h);
    const c = el.querySelector('canvas.base'); c.style.width = w + 'px'; c.style.height = h + 'px';
    el.querySelector('canvas.detail').hidden = true;
  });
}

function visiblePages(doc, margin = 0.4) {
  const st = V.el.scrollTop, ch = V.el.clientHeight; const out = [];
  if (!doc || !doc.pageEls) return out;
  for (let i = 0; i < doc.pageEls.length; i++) { const el = doc.pageEls[i]; const t = el.offsetTop, b = t + el.offsetHeight; if (b >= st - ch * margin && t <= st + ch * (1 + margin)) out.push(i); }
  return out;
}

const scheduleRender = debounce(() => runRender(), 70);
async function runRender() {
  if (V.renderBusy) { V.renderAgain = true; return; }
  V.renderBusy = true;
  try {
    const doc = activeDoc(); if (!doc || !doc.pdf) return;
    const vis = visiblePages(doc);
    // closest to the viewport centre first
    const mid = V.el.scrollTop + V.el.clientHeight / 2;
    vis.sort((a, b) => Math.abs(doc.pageEls[a].offsetTop + doc.pageEls[a].offsetHeight / 2 - mid) - Math.abs(doc.pageEls[b].offsetTop + doc.pageEls[b].offsetHeight / 2 - mid));
    for (const i of vis) { if (activeDoc() !== doc) return; await renderPage(doc, i); }
    for (const i of visiblePages(doc, 0)) { if (activeDoc() !== doc) return; await renderDetail(doc, i); }
    // release far-away canvases
    const keep = new Set(visiblePages(doc, 2.5));
    doc.pageEls.forEach((el, i) => { if (!keep.has(i) && el._scale) { const c = el.querySelector('canvas.base'); c.width = 0; c.height = 0; el._scale = 0; el.querySelector('canvas.detail').hidden = true; } });
  } catch (e) { console.warn(e); } finally {
    V.renderBusy = false; if (V.renderAgain) { V.renderAgain = false; scheduleRender(); }
  }
}

function pageScale(doc, i) {
  const pg = doc.pages[i]; const dpr = window.devicePixelRatio || 1; const want = doc.zoom * dpr; const max = Math.sqrt(MAX_PIX / (pg.w * pg.h));
  return { want, scale: Math.min(want, max), capped: want > max * 1.02 };
}
async function renderPage(doc, i) {
  const el = doc.pageEls[i]; if (!el) return; const { scale } = pageScale(doc, i);
  if (el._scale && Math.abs(el._scale - scale) / scale < 0.01) return;
  const page = await doc.pdf.getPage(i + 1);
  const vp = page.getViewport({ scale, rotation: page.rotate });
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(vp.width)); canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await hideOwnAnnots(doc, i); const task = page.render({ canvasContext: ctx, canvas, viewport: vp, annotationMode: annotMode(doc) });
  try { await task.promise; } catch (e) { if (e && e.name === 'RenderingCancelledException') return; throw e; }
  if (!doc.pageEls || doc.pageEls[i] !== el) return;
  const old = el.querySelector('canvas.base'); canvas.className = 'base'; canvas.style.width = old.style.width; canvas.style.height = old.style.height;
  old.replaceWith(canvas); el._scale = scale;
}
async function renderDetail(doc, i) {
  const el = doc.pageEls[i]; if (!el) return; const det = el.querySelector('canvas.detail'); const { want, capped } = pageScale(doc, i);
  if (!capped) { det.hidden = true; return; }
  const pr = el.getBoundingClientRect(), vr = V.el.getBoundingClientRect();
  const x1 = Math.max(pr.left, vr.left) - pr.left, y1 = Math.max(pr.top, vr.top) - pr.top, x2 = Math.min(pr.right, vr.right) - pr.left, y2 = Math.min(pr.bottom, vr.bottom) - pr.top;
  if (x2 <= x1 || y2 <= y1) { det.hidden = true; return; }
  const dpr = window.devicePixelRatio || 1; const key = [doc.zoom, x1, y1, x2, y2].map((v) => Math.round(v)).join(',');
  if (!det.hidden && det._key === key) return;
  const page = await doc.pdf.getPage(i + 1); await hideOwnAnnots(doc, i); const vp = page.getViewport({ scale: want, rotation: page.rotate });
  const c = document.createElement('canvas'); c.width = Math.ceil((x2 - x1) * dpr); c.height = Math.ceil((y2 - y1) * dpr);
  const ctx = c.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  const task = page.render({ canvasContext: ctx, canvas: c, viewport: vp, transform: [1, 0, 0, 1, -x1 * dpr, -y1 * dpr], annotationMode: annotMode(doc) });
  try { await task.promise; } catch (e) { if (e && e.name === 'RenderingCancelledException') return; throw e; }
  if (!doc.pageEls || doc.pageEls[i] !== el || Math.abs(doc.zoom - want / dpr) > 1e-6) return;
  c.className = 'detail'; c.style.left = x1 + 'px'; c.style.top = y1 + 'px'; c.style.width = x2 - x1 + 'px'; c.style.height = y2 - y1 + 'px'; c._key = key;
  const cur = el.querySelector('canvas.detail'); cur.replaceWith(c);
}

// ----- zoom & navigation ---------------------------------------------------------
function setZoom(z, anchor) {
  const doc = activeDoc(); if (!doc || !doc.pageEls) return; z = clamp(z, 0.04, 24); if (Math.abs(z - doc.zoom) < 1e-5) return;
  const vr = V.el.getBoundingClientRect();
  const ax = anchor ? anchor.clientX - vr.left : V.el.clientWidth / 2, ay = anchor ? anchor.clientY - vr.top : V.el.clientHeight / 2;
  const cy = V.el.scrollTop + ay, cx = V.el.scrollLeft + ax;
  let pi = doc.pageEls.findIndex((el) => cy >= el.offsetTop - 8 && cy <= el.offsetTop + el.offsetHeight + 8); if (pi < 0) pi = currentPage();
  const pel = doc.pageEls[pi]; const ly = (cy - pel.offsetTop) / doc.zoom, lx = (cx - pel.offsetLeft) / doc.zoom;
  doc.zoom = z; layoutPages(doc);
  V.el.scrollTop = pel.offsetTop + ly * z - ay; V.el.scrollLeft = pel.offsetLeft + lx * z - ax;
  if (state.editing) positionEditor();
  rerenderOverlaysSoon(); scheduleRender(); updateZoomUI();
}
const rerenderOverlaysSoon = debounce(() => { const d = activeDoc(); if (d) { visiblePages(d, 1).forEach((i) => renderMarks(d, i)); renderSearchHits(); } }, 120);
function fitWidth(keepPage = true) { const d = activeDoc(); if (!d) return; const i = currentPage(); const pg = d.pages[i]; const z = (V.el.clientWidth - 40) / pg.w; setZoom(z); if (keepPage) goToPage(i); }
function fitPage() { const d = activeDoc(); if (!d) return; const i = currentPage(); const pg = d.pages[i]; const z = Math.min((V.el.clientWidth - 40) / pg.w, (V.el.clientHeight - 40) / pg.h); setZoom(z); goToPage(i); }
function currentPage() {
  const d = activeDoc(); if (!d || !d.pageEls || !d.pageEls.length) return 0; if (state.pageMode === 'single' && d.singleCur != null) return clamp(d.singleCur, 0, d.numPages - 1); const mid = V.el.scrollTop + V.el.clientHeight / 2;
  let best = 0, bd = Infinity; d.pageEls.forEach((el, i) => { const t = el.offsetTop, b = t + el.offsetHeight; const dd = mid < t ? t - mid : mid > b ? mid - b : 0; if (dd < bd) { bd = dd; best = i; } });
  return best;
}
function goToPage(i, at) {
  const d = activeDoc(); if (!d || !d.pageEls) return; i = clamp(i, 0, d.numPages - 1); const el = d.pageEls[i];
  if (state.pageMode === 'single' && d.singleCur !== i) applyPageMode(i);
  if (at) { V.el.scrollTop = el.offsetTop + at[1] * d.zoom - V.el.clientHeight / 2; V.el.scrollLeft = el.offsetLeft + at[0] * d.zoom - V.el.clientWidth / 2; }
  else V.el.scrollTop = el.offsetTop - 16;
  updatePageUI(); scheduleRender();
}
// next / previous page (Ctrl+Right / Ctrl+Left): zoomed in, stay on the same spot of the drawing,
// through the page alignment when the sheets are aligned; zoomed out, show the top of the page
function stepPage(dir) {
  const d = activeDoc(); if (!d || !d.pageEls) return; const i = currentPage(); const j = clamp(i + dir, 0, d.numPages - 1); if (j === i) return;
  const el = d.pageEls[i]; const pg = d.pages[i]; const cx = (V.el.scrollLeft + V.el.clientWidth / 2 - el.offsetLeft) / d.zoom, cy = (V.el.scrollTop + V.el.clientHeight / 2 - el.offsetTop) / d.zoom;
  const inside = cx >= 0 && cy >= 0 && cx <= pg.w && cy <= pg.h; const zoomedIn = pg.h * d.zoom > V.el.clientHeight * 1.02 || pg.w * d.zoom > V.el.clientWidth * 1.02;
  if (inside && zoomedIn) goToPage(j, mapPage(d, i, j, [cx, cy])); else goToPage(j);
}
function zoomToBox(page, b) {
  const d = activeDoc(); if (!d) return; const pad = 60;
  const z = clamp(Math.min((V.el.clientWidth - pad) / Math.max(b.w, 20), (V.el.clientHeight - pad) / Math.max(b.h, 20)), 0.1, 6);
  if (z < d.zoom || z > d.zoom * 2.5) setZoom(Math.min(z, Math.max(d.zoom, 1.2)));
  goToPage(page, [b.x + b.w / 2, b.y + b.h / 2]);
}
function clientToPage(e, i) { const d = activeDoc(); const r = d.pageEls[i].getBoundingClientRect(); return [(e.clientX - r.left) / d.zoom, (e.clientY - r.top) / d.zoom]; }
function pageAtClient(x, y) { const d = activeDoc(); if (!d || !d.pageEls) return -1; for (let i = 0; i < d.pageEls.length; i++) { const r = d.pageEls[i].getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i; } return -1; }

// ----- overlays -------------------------------------------------------------------
function renderMarks(doc, i) {
  if (!doc || !doc.pageEls || !doc.pageEls[i] || doc !== activeDoc()) return;
  const g = doc.pageEls[i].querySelector('g.marks');
  doc.markups.forEach((x) => { if (x.type === 'grille' && x.on && x.page === i) { const pl = grillePlace(doc, x); if (pl.duct) x.pts = [pl.p]; } }); // grilles ride on their duct
  g.innerHTML = doc.markups.filter((m) => m.page === i && layerVisible(doc, m.layer)).map((m) => markupSvg(m, doc, { hideText: state.editing && state.editing.id === m.id })).join('');
  renderSel(doc, i); renderPageExtras(doc, i); renderFlatLayer(doc, i);
}
// grid and viewport outlines (not markups; never exported)
function renderPageExtras(doc, i) {
  const el = doc.pageEls[i]; const pg = doc.pages[i]; const z = doc.zoom;
  const gg = el.querySelector('g.grid'); const step = gridStep(doc, i);
  if (state.showGrid && step && step * z >= 5) {
    let d = ''; for (let x = step; x < pg.w; x += step) d += `M${num(x, 2)} 0V${num(pg.h, 2)}`; for (let y = step; y < pg.h; y += step) d += `M0 ${num(y, 2)}H${num(pg.w, 2)}`;
    gg.innerHTML = `<path d="${d}" class="gridln" stroke-width="${num(0.6 / z, 3)}"/>`;
  } else gg.innerHTML = '';
  const vg = el.querySelector('g.vports'); const vps = (doc.viewports && doc.viewports[i]) || [];
  vg.innerHTML = state.showViewports ? vps.map((v) => { const fs = 10 / Math.max(z, 0.3); return `<g class="vp" data-vp="${v.id}"><rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" stroke-width="${num(1.2 / z, 3)}" stroke-dasharray="${num(6 / z, 2)} ${num(4 / z, 2)}"/><text x="${num(v.x + 4 / z, 2)}" y="${num(v.y + fs + 2 / z, 2)}" font-size="${num(fs, 2)}">${esc(v.name)} \u00b7 ${esc(v.scale.label || '')}</text></g>`; }).join('') : '';
}
function renderAllMarks(doc = activeDoc()) { if (!doc || !doc.pageEls) return; for (let i = 0; i < doc.numPages; i++) renderMarks(doc, i); }
function renderMarkupEl(m, doc = activeDoc(), peer) {
  const el = doc.pageEls && doc.pageEls[m.page]; if (!el) return; const g = el.querySelector(`g.mk[data-id="${m.id}"]`);
  if (!g) { renderMarks(doc, m.page); return; }
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g'); tmp.innerHTML = markupSvg(m, doc, { hideText: state.editing && state.editing.id === m.id });
  g.replaceWith(tmp.firstChild);
  // a unit's clearance warnings depend on its neighbours: redraw the others on the page when one changes
  if (m.type === 'equip' && !peer) doc.markups.forEach((x) => { if (x !== m && x.type === 'equip' && x.page === m.page) renderMarkupEl(x, doc, true); });
  // ductwork: grilles ride on their duct; section details and cut markers follow what they show
  if (DUCT_TYPES.has(m.type) && !peer) {
    if (m.type === 'duct') syncGrilles(doc, m).forEach((x) => renderMarkupEl(x, doc, true));
    const rel = new Set(doc.markups.filter((x) => x.type === 'section' && (x.of === m.id || (m.type === 'duct' && doc.markups.some((gq) => gq.type === 'grille' && gq.on === m.id && gq.id === x.of)))).map((x) => x.id));
    if (m.type === 'section' && m.of) rel.add(m.of); if (m.type === 'grille' && m.on) rel.add(m.on);
    rel.forEach((id) => { const x = getMarkup(id, doc); if (x && x !== m) renderMarkupEl(x, doc, true); });
  }
}
function handlesFor(m) {
  const H = [];
  const pts = m.pts;
  if (m.type === 'sketch') return sketchHandles(m, activeDoc());
  const sides = (b, tag) => [[b.x + b.w / 2, b.y], [b.x + b.w, b.y + b.h / 2], [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h / 2]].forEach((p, k) => H.push({ h: tag + k, p, kind: 'side' }));
  if (BOX_TYPES.has(m.type)) { const b = TEXT_TYPES.has(m.type) ? textBox(m) : boxRect(pts[0], pts[1]); [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].forEach((p, k) => H.push({ h: 'c' + k, p })); sides(b, 'e'); }
  else if (m.type === 'callout') { H.push({ h: 'v0', p: pts[0], kind: 'tip' }); const lds = calloutLeaders(m); H.push({ h: 'n', p: lds[0].knee, kind: 'knee' }); (m.leaders || []).forEach((ld, k) => { H.push({ h: 'l' + k, p: ld.tip, kind: 'tip' }, { h: 'm' + k, p: lds[k + 1].knee, kind: 'knee' }); }); const b = textBox(m); [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].forEach((p, k) => H.push({ h: 'b' + k, p })); sides(b, 'f'); }
  else if (m.type === 'pen' || m.type === 'highlight') { const b = G.bbox(pts); [[b.x, b.y], [b.x2, b.y], [b.x2, b.y2], [b.x, b.y2]].forEach((p, k) => H.push({ h: 's' + k, p })); }
  else if (m.type !== 'note' && m.type !== 'textedit' && !QUAD_TYPES.has(m.type)) pts.forEach((p, k) => H.push({ h: 'v' + k, p }));
  if (CV.has(m)) Object.entries(m.curves).forEach(([k, c]) => { k = +k; if (k < CV.segs(pts, CV.closed(m))) H.push({ h: 'q' + k, p: CV.mid(pts[k], pts[(k + 1) % pts.length], c), kind: 'curve' }); });
  if (m.holes) m.holes.forEach((hole, hk) => hole.forEach((p, hi) => H.push({ h: `h${hk}.${hi}`, p, kind: 'hole' })));
  return H;
}
function renderSel(doc, i) {
  if (!doc.pageEls || !doc.pageEls[i]) return; const g = doc.pageEls[i].querySelector('g.sel'); const z = doc.zoom; const hs = 7 / z;
  let s = '';
  for (const m of doc.markups) {
    if (m.page !== i || !state.sel.has(m.id)) continue; const b = markupBBox(m, doc); const pad = 4 / z;
    s += `<rect class="sel-box" x="${num(b.x - pad, 2)}" y="${num(b.y - pad, 2)}" width="${num(b.w + 2 * pad, 2)}" height="${num(b.h + 2 * pad, 2)}" stroke-width="${num(1 / z, 3)}" stroke-dasharray="${num(4 / z, 2)} ${num(3 / z, 2)}"/>`;
    if (state.sel.size <= 30 && !isLocked(m, doc)) for (const H of handlesFor(m)) {
      if (H.kind === 'rot') { const c = m.pts[0]; s += `<line class="rotln" x1="${num(c[0], 2)}" y1="${num(c[1], 2)}" x2="${num(H.p[0], 2)}" y2="${num(H.p[1], 2)}" stroke-width="${num(1 / z, 3)}"/><circle class="hdl rot" data-m="${m.id}" data-h="rot" cx="${num(H.p[0], 2)}" cy="${num(H.p[1], 2)}" r="${num(hs * 0.6, 2)}" stroke-width="${num(1.2 / z, 3)}"/>`; continue; }
      if (H.kind === 'curve') { s += `<circle class="hdl curve" data-m="${m.id}" data-h="${H.h}" cx="${num(H.p[0], 2)}" cy="${num(H.p[1], 2)}" r="${num(hs * 0.55, 2)}" stroke-width="${num(1.2 / z, 3)}"/>`; continue; }
      s += `<rect class="hdl${H.kind === 'tip' ? ' tip' : ''}${H.kind === 'hole' ? ' hole' : ''}${H.kind === 'side' ? ' side' : ''}${H.kind === 'knee' ? ' knee' : ''}" data-m="${m.id}" data-h="${H.h}" x="${num(H.p[0] - hs / 2, 2)}" y="${num(H.p[1] - hs / 2, 2)}" width="${num(hs, 2)}" height="${num(hs, 2)}" stroke-width="${num(1.2 / z, 3)}"/>`;
    }
  }
  if (doc.sess) s += remoteSelSvg(doc, i, z);
  g.innerHTML = s;
}
function snapMarker(h, z) {
  const [x, y] = h.p; const r = 5 / z; const sw = num(1.4 / z, 3); const k = h.kind;
  if (k === 'mid') return `<path class="snap" d="M${num(x, 2)} ${num(y - r, 2)}L${num(x + r, 2)} ${num(y + r * 0.8, 2)}L${num(x - r, 2)} ${num(y + r * 0.8, 2)}Z" stroke-width="${sw}"/>`;
  if (k === 'int') return `<path class="snap" d="M${num(x - r, 2)} ${num(y - r, 2)}L${num(x + r, 2)} ${num(y + r, 2)}M${num(x + r, 2)} ${num(y - r, 2)}L${num(x - r, 2)} ${num(y + r, 2)}" stroke-width="${sw}"/>`;
  if (k === 'on') return `<path class="snap" d="M${num(x, 2)} ${num(y - r, 2)}L${num(x + r, 2)} ${num(y, 2)}L${num(x, 2)} ${num(y + r, 2)}L${num(x - r, 2)} ${num(y, 2)}Z" stroke-width="${sw}"/>`;
  if (k === 'grid') return `<path class="snap grid" d="M${num(x - r, 2)} ${num(y, 2)}H${num(x + r, 2)}M${num(x, 2)} ${num(y - r, 2)}V${num(y + r, 2)}" stroke-width="${sw}"/>`;
  if (k === 'center') return `<circle class="snap" cx="${num(x, 2)}" cy="${num(y, 2)}" r="${num(r, 2)}" stroke-width="${sw}"/>`;
  return `<rect class="snap" x="${num(x - r, 2)}" y="${num(y - r, 2)}" width="${num(2 * r, 2)}" height="${num(2 * r, 2)}" stroke-width="${sw}"/>`;
}
function refreshSelection() { const d = activeDoc(); if (!d || !d.pageEls) return; for (let i = 0; i < d.numPages; i++) renderSel(d, i); renderProps(); syncListSelection(); updateSelDims(); if (oneSketch() && rightShown('linked')) renderLinkedPanelSoon(); if (state.sel.size === 1 && oneSketch() && state.layout[panelSide('props') + 'Tab'] === 'props' && !document.body.classList.contains(panelSide('props') + '-open') && !narrow()) openPanel('props'); renderToolbarsState(); renderPropbar(); }
function renderDraft() {
  const d = activeDoc(); if (!d || !d.pageEls) return;
  d.pageEls.forEach((el) => { const g = el.querySelector('g.draft'); if (g.childNodes.length) g.innerHTML = ''; });
  const dr = state.draft; const z = d.zoom; let s = '';
  if (dr && d.pageEls[dr.page]) {
    const opts = { noHit: true, open: dr.mode === 'multi' && !dr.boxDrag };
    if (dr.m.type === 'calibrate') opts.draftLabel = `${num(G.dist(dr.m.pts[0], dr.m.pts[1]) / 72, 3)} in on paper`;
    s += markupSvg(dr.m, d, opts);
    if (dr.mode === 'multi' && !dr.boxDrag) {
      dr.m.pts.slice(0, -1).forEach((p, k) => { s += `<circle class="vtx${k === 0 ? ' first' : ''}" cx="${num(p[0], 2)}" cy="${num(p[1], 2)}" r="${num(3.2 / z, 2)}" stroke-width="${num(1 / z, 3)}"/>`; });
      if (dr.m.curves) Object.entries(dr.m.curves).forEach(([k, c]) => { k = +k; const a = dr.m.pts[k], b = dr.m.pts[k + 1]; if (!a || !b) return; const h = CV.mid(a, b, c); const r = 3 / z; s += `<path class="vtx bend" d="M${num(h[0], 2)} ${num(h[1] - r, 2)}L${num(h[0] + r, 2)} ${num(h[1], 2)}L${num(h[0], 2)} ${num(h[1] + r, 2)}L${num(h[0] - r, 2)} ${num(h[1], 2)}Z" stroke-width="${num(1 / z, 3)}"/>`; });
    }
  }
  if (state.marquee && d.pageEls[state.marquee.page]) { const q = state.marquee; const b = boxRect(q.a, q.b); const target = d.pageEls[q.page].querySelector('g.draft'); target.innerHTML = `<rect class="marquee${q.b[0] < q.a[0] ? ' cross' : ''}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" stroke-width="${1 / z}"/>`; }
  if (state.snapHint && d.pageEls[state.snapHint.page]) s += snapMarker(state.snapHint, z);
  const gh = !dr && state.ghost && d.pageEls[state.ghost.page] ? state.ghost : null;
  if (gh) s += state.placeEquip ? equipGhost(d, gh.page, gh.p) : state.placeItem ? toolGhost(d, gh.page, gh.p) : '';
  const page = dr ? dr.page : gh ? gh.page : state.snapHint ? state.snapHint.page : -1;
  if (page >= 0 && s) d.pageEls[page].querySelector('g.draft').insertAdjacentHTML('beforeend', s);
  if (state.alignPick) new Set([state.alignPick.ref, state.alignPick.page]).forEach((pg) => { const el = d.pageEls[pg]; const svg = alignPickSvg(d, pg, z); if (el && svg) el.querySelector('g.draft').insertAdjacentHTML('beforeend', svg); });
  updateDraftBar();
}
