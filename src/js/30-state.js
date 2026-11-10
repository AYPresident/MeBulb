// ===== Application state, documents, undo ===================================
const DEFAULT_TOOLSETS = [
  { id: 'ts-redline', name: 'Redline', items: [
    { name: 'Revision cloud', tool: 'cloud', style: { stroke: '#d6331f', width: 1.5, cloud: true, cloudArc: 14 } },
    { name: 'Red arrow', tool: 'arrow', style: { stroke: '#d6331f', width: 1.5, arrowEnd: 'arrow' } },
    { name: 'Red callout', tool: 'callout', style: { stroke: '#d6331f', width: 1, fill: '#ffffff', fillOpacity: 1, fontSize: 11, fontColor: '#d6331f' } },
    { name: 'Red text', tool: 'text', style: { stroke: '#d6331f', width: 0, fontSize: 12, fontColor: '#d6331f', fill: 'none' } },
    { name: 'Approved', tool: 'stamp', text: 'APPROVED', style: { stroke: '#2e9e3e', width: 2, fontColor: '#2e9e3e' } },
    { name: 'Revise & resubmit', tool: 'stamp', text: 'REVISE & RESUBMIT', style: { stroke: '#d6331f', width: 2, fontColor: '#d6331f' } },
  ] },
  { id: 'ts-takeoff', name: 'Takeoff', items: [
    { name: 'Slab area', tool: 'area', subject: 'Slab', style: { stroke: '#5c6b7a', fill: '#7b8794', fillOpacity: 0.3, fontColor: '#2c3640', width: 1.25, fontSize: 11 } },
    { name: 'Wall length', tool: 'polylength', subject: 'Wall', style: { stroke: '#1f5fd1', fontColor: '#1f5fd1', width: 2.5, fontSize: 10 } },
    { name: 'Outlets', tool: 'count', subject: 'Outlet', style: { stroke: '#f08a00', fill: '#f08a00', fillOpacity: 0.85, size: 6, fontSize: 10 } },
    { name: 'Footing volume', tool: 'volume', subject: 'Footing', style: { stroke: '#a35d00', fill: '#f08a00', fillOpacity: 0.25, fontColor: '#7a4500', width: 1.25, fontSize: 11 } },
    { name: 'Flooring', tool: 'area', subject: 'Flooring', style: { stroke: '#8e3fd1', fill: '#8e3fd1', fillOpacity: 0.18, fontColor: '#5f2a8c', width: 1, fontSize: 11 } },
  ] },
  { id: 'ts-risers', v: 2, name: 'Risers & shafts', items: [
    { name: 'Supply air riser 600\u00d7300', tool: 'sketchrect', subject: 'Supply riser', size: { shape: 'rect', w: 600 / 25.4, h: 300 / 25.4 }, style: { stroke: '#1f5fd1', fill: '#1f5fd1', fillOpacity: 0.07, fontColor: '#1f5fd1', width: 1.25, fontSize: 9, symbol: 'x', showLabel: true } },
    { name: 'Return air riser 750\u00d7400', tool: 'sketchrect', subject: 'Return riser', size: { shape: 'rect', w: 750 / 25.4, h: 400 / 25.4 }, style: { stroke: '#8e3fd1', fill: '#8e3fd1', fillOpacity: 0.07, fontColor: '#5f2a8c', width: 1.25, fontSize: 9, symbol: 'diag', showLabel: true } },
    { name: 'Exhaust riser \u00d8250', tool: 'sketchcircle', subject: 'Exhaust riser', size: { shape: 'circle', d: 250 / 25.4 }, style: { stroke: '#2e9e3e', fill: '#2e9e3e', fillOpacity: 0.07, fontColor: '#1d6b29', width: 1.25, fontSize: 9, symbol: 'x', showLabel: true } },
    { name: 'Electrical riser 900\u00d7400', tool: 'sketchrect', subject: 'Electrical riser', size: { shape: 'rect', w: 900 / 25.4, h: 400 / 25.4 }, style: { stroke: '#d6331f', fill: '#d6331f', fillOpacity: 0.06, fontColor: '#a3200f', width: 1.25, fontSize: 9, symbol: 'diag', showLabel: true } },
    { name: 'Hydraulic riser 450\u00d7300', tool: 'sketchrect', subject: 'Pipe chase', size: { shape: 'rect', w: 450 / 25.4, h: 300 / 25.4 }, style: { stroke: '#f08a00', fill: '#f08a00', fillOpacity: 0.08, fontColor: '#a35d00', width: 1.25, fontSize: 9, symbol: 'none', showLabel: true } },
  ] },
];
const _units = store.get('units', 'm'); const _metric = _units !== 'ftin';
// tool sets saved before the metric defaults: refresh the built-in risers set
function migrateToolsets(ts) { if (!ts) return null; const def = DEFAULT_TOOLSETS.find((t) => t.id === 'ts-risers'); return ts.map((t) => (t.id === 'ts-risers' && !t.v ? deep(def) : t)); }

const state = {
  docs: [], activeId: null,
  tool: 'select', toolLocked: false,
  toolStyles: store.get('toolStyles', {}),
  toolSubjects: {},
  author: store.get('author', 'Reviewer'),
  sel: new Set(), clipboard: null,
  draft: null, editing: null, countId: null,
  toolsets: migrateToolsets(store.get('toolsets', null)) || deep(DEFAULT_TOOLSETS),
  recentTools: store.get('recentTools', []), placeItem: null, polyRect: store.get('polyRect', {}),
  stampText: 'APPROVED', stampId: store.get('stampId', 'txt:APPROVED'), volDepth: null, units: _units,
  leftTab: 'pages', rightTab: 'props', leftOpen: true, rightOpen: true, listOpen: false,
  reuse: store.get('reuse', false), snapMarkup: store.get('snapMarkup', true), snapContent: store.get('snapContent', true), snapGrid: store.get('snapGrid', false), showGrid: store.get('showGrid', false), gridSize: store.get('gridSize2', _metric ? 5 / 25.4 : 0.25),
  sketchDefaults: store.get('sketchDefaults2', null) || sketchDefaultsFor(_metric), sketchStep: null, cutoutFor: null, showViewports: true,
  sketchNext: store.get('sketchNext', 'M1'), sketchAutoNum: store.get('sketchAutoNum', true), alignPick: null,
  theme: store.get('theme', 'system'), layout: null, layouts: store.get('layouts', {}), shortcuts: store.get('shortcuts', {}), collapsed: store.get('collapsed', {}), sketchQ: store.get('sketchQ', 0), airMore: false, mechTab: store.get('mechTab', 'draw'), pageMode: store.get('pageMode', 'continuous'),
  painter: false, propClipboard: null, recent: store.get('recent', []), tbCustomize: false,
  prefs: { linkLabelMode: 'ask', autosavePdf: 5, recoveryMins: 0, largeFileMB: 48, ...store.get('prefs', {}) },
  list: { sort: 'page', dir: 1, q: '', type: 'all', status: 'all', pageOnly: false },
  search: { q: '', hits: [], idx: -1, caseSens: false, busy: false },
  thumbSel: 0,
};

function activeDoc() { return state.docs.find((d) => d.id === state.activeId) || null; }
function getMarkup(id, doc = activeDoc()) { return doc ? doc.markups.find((m) => m.id === id) : null; }
function mapMarkupPoints(m, f) { m.pts = m.pts.map(f); if (m.holes) m.holes = m.holes.map((h) => h.map(f)); if (m.base) m.base = f(m.base); if (m.knee) m.knee = f(m.knee); if (m.leaders) m.leaders = m.leaders.map((l) => ({ tip: f(l.tip), knee: l.knee ? f(l.knee) : null })); }
function markupGeom(m) { return { pts: deep(m.pts), holes: m.holes ? deep(m.holes) : null, base: m.base ? m.base.slice() : null, knee: m.knee ? m.knee.slice() : null, leaders: m.leaders ? deep(m.leaders) : null }; }
function selected(doc = activeDoc()) { return doc ? doc.markups.filter((m) => state.sel.has(m.id)) : []; }
function layerOf(doc, id) { return id ? doc.layers.find((l) => l.id === id) : null; }
function layerVisible(doc, id) { const l = layerOf(doc, id); return !l || l.visible !== false; }
function layerLocked(doc, id) { const l = layerOf(doc, id); return !!(l && l.locked); }
function isLocked(m, doc = activeDoc()) { return m.locked || layerLocked(doc, m.layer); }

function newDoc(name, src) {
  return { id: uid('D'), name, src, bytes: null, pdf: null, numPages: 0, pages: [], markups: [], scales: {}, viewports: {}, links: {}, formValues: {}, ocr: {}, align: null, layers: [], activeLayer: null, zoom: 1, scrollTop: 0, scrollLeft: 0, undo: [], redo: [], dirty: false, handle: null, sample: false, outline: null, textCache: [], fitted: false };
}

// ----- undo / redo (whole-state snapshots; bytes are shared references) -------
function snapshot(doc) { return { markups: JSON.stringify(doc.markups), scales: JSON.stringify(doc.scales), layers: JSON.stringify(doc.layers), viewports: JSON.stringify(doc.viewports || {}), links: JSON.stringify(doc.links || {}), formValues: JSON.stringify(doc.formValues || {}), align: JSON.stringify(doc.align || null), colorAdj: JSON.stringify(doc.colorAdj || null), flat: JSON.stringify(doc.flat || []), unmelt: JSON.stringify([doc.unmelt || [], doc.unmeltKeep || {}]), src: doc.src, rc: doc.sess ? doc.sess.rc : 0 }; }
function pushUndo(doc = activeDoc()) { if (!doc) return; doc.undo.push(snapshot(doc)); if (doc.undo.length > 150) doc.undo.shift(); doc.redo = []; markDirty(doc); }
function markDirty(doc = activeDoc()) { if (!doc) return; SESS.hint = true; if (!doc.dirty) doc.dirtySince = Date.now(); doc.dirty = true; doc.rev = (doc.rev || 0) + 1; renderTabs(); updateUndoUI(); recoveryChanged(doc); }
async function restoreSnap(doc, s) {
  const bytesChanged = s.src !== doc.src;
  const R = sessKeepRemote(doc, s.rc || 0, { markups: JSON.parse(s.markups), scales: JSON.parse(s.scales), layers: JSON.parse(s.layers), viewports: JSON.parse(s.viewports || '{}'), links: JSON.parse(s.links || '{}'), align: JSON.parse(s.align || 'null'), colorAdj: JSON.parse(s.colorAdj || 'null'), flat: JSON.parse(s.flat || '[]') });
  Object.assign(doc, R); doc.formValues = JSON.parse(s.formValues || '{}'); if (s.unmelt) { const [u, k] = JSON.parse(s.unmelt); doc.unmelt = u; doc.unmeltKeep = k; } SESS.hint = true; renderColorAdj(doc); renderFormLayers && renderFormLayers();
  if (bytesChanged) { setDocSource(doc, s.src); await loadPdfInto(doc); mountDoc(doc); }
  state.sel.clear(); markDirty(doc); refreshAll();
}
async function undo() { const d = activeDoc(); if (!d || !d.undo.length) return; cancelDraft(); d.redo.push(snapshot(d)); await restoreSnap(d, d.undo.pop()); toast('Undone'); }
async function redo() { const d = activeDoc(); if (!d || !d.redo.length) return; cancelDraft(); d.undo.push(snapshot(d)); await restoreSnap(d, d.redo.pop()); toast('Redone'); }
function touch(m) { m.modified = nowISO(); SESS.hint = true; }

// ----- markup mutations ---------------------------------------------------------
function addMarkup(m, doc = activeDoc()) { pushUndo(doc); doc.markups.push(m); renderMarks(doc, m.page); renderList(); renderLayers(); return m; }
function deleteSelected() {
  const doc = activeDoc(); if (!doc) return; const ids = [...state.sel].filter((id) => { const m = getMarkup(id); return m && !isLocked(m); });
  if (!ids.length) { if (state.sel.size) toast('Selected markups are locked'); return; }
  pushUndo(doc); const pages = new Set(); doc.markups = doc.markups.filter((m) => { if (ids.includes(m.id)) { pages.add(m.page); return false; } return true; });
  state.sel.clear(); if (ids.includes(state.countId)) state.countId = null; cleanupLinks(doc); pages.forEach((p) => renderMarks(doc, p)); refreshPanels();
  toast(`Deleted ${ids.length} markup${ids.length > 1 ? 's' : ''}`);
}
function copySelected(cut) {
  const ms = selected(); if (!ms.length) return; state.clipboard = { items: deep(ms), page: ms[0].page }; toast(`${cut ? 'Cut' : 'Copied'} ${ms.length} markup${ms.length > 1 ? 's' : ''}`);
  if (cut) deleteSelected();
}
function pasteClipboard(dup, inPlace) {
  const doc = activeDoc(); if (!doc || !state.clipboard) return; const cur = currentPage();
  const sourcePage = state.clipboard.page;
  const off = inPlace ? 0 : dup || cur === sourcePage ? 12 : 0;
  pushUndo(doc); state.sel.clear(); const gmap = new Map();
  state.clipboard.items.forEach((src) => {
    const m = detachCopy(doc, deep(src)); m.id = uid();
    // a copy is a new markup: its own PDF identity, and its own group if it came from one
    if (m.ext) { m.ext = { ...m.ext }; ['ref', 'nm', 'nms', 'refs', 'imageRef'].forEach((k) => delete m.ext[k]); }
    if (m.group) { if (!gmap.has(m.group)) gmap.set(m.group, uid('G-')); m.group = gmap.get(m.group); } m.page = clamp(dup ? src.page : cur + (src.page - sourcePage), 0, doc.numPages - 1); mapMarkupPoints(m, (p) => [p[0] + off, p[1] + off]);
    m.created = m.modified = nowISO(); m.author = state.author; doc.markups.push(m); state.sel.add(m.id);
  });
  if (!dup && off) state.clipboard.items = state.clipboard.items.map((x) => ({ ...x, pts: x.pts.map((p) => [p[0] + off, p[1] + off]) }));
  renderAllMarks(doc); refreshPanels();
}
function duplicateSelected() { const ms = selected(); if (!ms.length) return; const save = state.clipboard; state.clipboard = { items: deep(ms), page: ms[0].page }; pasteClipboard(true); state.clipboard = save; }
function reorderSelected(front) {
  const doc = activeDoc(); const ms = selected(); if (!ms.length) return; pushUndo(doc);
  const rest = doc.markups.filter((m) => !state.sel.has(m.id)); doc.markups = front ? [...rest, ...ms] : [...ms, ...rest];
  new Set(ms.map((m) => m.page)).forEach((p) => renderMarks(doc, p));
}
// sketches placed on several pages share their look: a style change to one goes to all of them
function withLinkedSketches(doc, ms) { const out = new Set(ms); ms.forEach((m) => { if (m.type === 'sketch' && m.link) linkSiblings(doc, m).forEach((x) => out.add(x)); }); return [...out]; }
function applyToSelection(fn, opts = {}) {
  const doc = activeDoc(); let ms = selected(doc).filter((m) => opts.ignoreLock || !isLocked(m)); if (!ms.length) return false; if (opts.linked) ms = withLinkedSketches(doc, ms).filter((m) => opts.ignoreLock || !isLocked(m));
  if (!opts.noUndo) pushUndo(doc); ms.forEach((m) => { fn(m); touch(m); });
  new Set(ms.map((m) => m.page)).forEach((p) => renderMarks(doc, p)); renderList(); return true;
}
