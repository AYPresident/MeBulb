// ===== UI shell: dialogs, toasts, tabs, status bar ===========================
function toast(msg, kind) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (kind ? ' ' + kind : ''); clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 5200 : 2200);
}

let _dlgResolve = null;
function openDialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], onOpen, wide }) {
  closeDialog(null);
  const back = $('#modal-back'); const box = $('#modal');
  box.className = 'modal' + (wide ? ' wide' : '');
  box.innerHTML = `<header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></header><form class="modal-body" id="dlg-form" autocomplete="off">${body}</form><footer>${buttons.map((b, k) => `<button type="button" class="btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}" data-b="${k}">${esc(b.label)}</button>`).join('')}</footer>`;
  back.hidden = false;
  return new Promise((res) => {
    _dlgResolve = res;
    box.querySelector('[data-close]').onclick = () => closeDialog(null);
    box.querySelectorAll('[data-b]').forEach((btn) => { btn.onclick = () => { const b = buttons[+btn.dataset.b]; if (b.validate && !b.validate(formValues())) return; closeDialog(b.value === undefined ? b.label : b.value); }; });
    box.querySelector('form').onsubmit = (e) => { e.preventDefault(); const k = buttons.findIndex((b) => b.primary); if (k >= 0) box.querySelector(`[data-b="${k}"]`).click(); };
    if (onOpen) onOpen(box);
    setTimeout(() => { const f = box.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea'); if (f) f.focus(); }, 30);
  });
}
function formValues() { const f = $('#dlg-form'); const o = {}; if (!f) return o; new FormData(f).forEach((v, k) => { o[k] = v; }); f.querySelectorAll('input[type=checkbox]').forEach((c) => { o[c.name] = c.checked; }); return o; }
function closeDialog(v) { const back = $('#modal-back'); if (back.hidden) return; const vals = formValues(); back.hidden = true; const r = _dlgResolve; _dlgResolve = null; if (r) r(v == null ? null : { value: v, form: vals }); }
async function confirmDialog(title, msg, okLabel = 'Confirm', danger) { const r = await openDialog({ title, body: `<p>${msg}</p>`, buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: true, danger }] }); return !!(r && r.value === true); }

// ----- tabs -----------------------------------------------------------------------
function renderTabs() {
  const el = $('#tabs');
  el.innerHTML = state.docs.map((d) => `<div class="tab${d.id === state.activeId ? ' on' : ''}" data-id="${d.id}" title="${esc(d.name)}" role="tab" tabindex="0"><span class="tab-name">${esc(d.name)}</span>${d.sample ? '<span class="badge">Sample</span>' : ''}${d.readOnly ? `<span class="badge ro" title="${esc(d.readOnlyWhy || 'Read only')}">Read only</span>` : ''}${d.dirty ? '<span class="dot" title="Unsaved changes"></span>' : ''}<button class="tab-x" data-close="${d.id}" aria-label="Close ${esc(d.name)}">${icon('close')}</button></div>`).join('');
  document.title = activeDoc() ? `${activeDoc().name}${activeDoc().readOnly ? ' (read only)' : ''} · MeBulb` : 'MeBulb'; const dt = $('#doc-title'); if (dt) dt.textContent = activeDoc() ? activeDoc().name : '';
}
async function switchDoc(id) {
  const cur = activeDoc(); if (cur && cur.id === id) return;
  if (state.editing) commitEdit(); cancelDraft(); endCount();
  if (cur) { cur.scrollTop = V.el.scrollTop; cur.scrollLeft = V.el.scrollLeft; }
  state.activeId = id; state.sel.clear(); state.search.hits = []; state.thumbSel = 0;
  const d = activeDoc(); mountDoc(d); refreshAll();
  if (d) { state.thumbSel = currentPage(); renderLeft(); }
}
async function closeDoc(id) {
  const d = state.docs.find((x) => x.id === id); if (!d) return;
  if (d.dirty) {
    const r = await openDialog({ title: 'Save changes before closing?', body: `<p><b>${esc(d.name)}</b> has unsaved markups.</p>`, buttons: [{ label: 'Cancel', value: 'cancel' }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save and close', value: 'save', primary: true }] });
    if (!r || r.value === 'cancel') return;
    if (r.value === 'save') { if (state.activeId !== id) await switchDoc(id); await saveDoc('save', { doc: d }); if (d.dirty) return; } // save was cancelled or failed: leave it open
  }
  const idx = state.docs.indexOf(d); state.docs.splice(idx, 1); try { d.pdf && d.pdf.loadingTask.destroy(); } catch { } if (d.fid && HOST()) HOST().close(d.fid); sessionClosed(d, d.dirty);
  if (state.activeId === id) { state.activeId = null; const next = state.docs[Math.min(idx, state.docs.length - 1)]; if (next) await switchDoc(next.id); else { mountDoc(null); refreshAll(); } }
  else renderTabs();
}

// ----- status bar ---------------------------------------------------------------------
function updateZoomUI() { const d = activeDoc(); const z = $('#zoom-val'); if (z && document.activeElement !== z) z.value = d ? Math.round(d.zoom * 100) + '%' : ''; }
function updatePageUI() {
  const d = activeDoc(); const i = d ? currentPage() : 0; const nav = $('#navbar'); if (!nav || !nav.firstChild) { renderNavbar(); }
  const pin = $('#page-in'); if (pin && document.activeElement !== pin) pin.value = d ? (d.pages[i] && d.pages[i].label ? d.pages[i].label : i + 1) : '';
  const pc = $('#page-count'); if (pc) pc.textContent = d ? `of ${d.numPages}` : '';
  const sc = d ? scaleFor(d, i) : null; const sb = $('#scale-btn'); if (sb) { sb.textContent = d ? sc.label || 'Custom scale' : 'Scale not set'; sb.classList.toggle('unset', !!(sc && sc.unset)); }
  const ps = $('#page-size'); if (ps) ps.textContent = d && d.pages[i] ? sheetSizeText(d.pages[i]) : '';
  if (d && panelShown('pages')) $$('.thumb').forEach((t) => t.classList.toggle('cur', +t.dataset.i === i));
  if (d && !state.sel.size && state.tool === 'select') { const pi = $('#props').dataset.page; if (pi !== String(i)) { renderProps(); if (panelShown('measure')) renderMeasurePanel(); } }
  renderToolbarsState();
}
function updateCoords(e, i) {
  const d = activeDoc(); const el = $('#coords'); if (!d || i < 0) { el.textContent = ''; return; }
  const p = clientToPage(e, i); const vp = viewportAt(d, i, p); const sc = vp ? vp.scale : scaleFor(d, i); el.textContent = `X ${fmtLen(p[0], sc)}   Y ${fmtLen(p[1], sc)}${vp ? '   ' + vp.name : ''}`;
}
function updateSelDims() {
  const el = $('#seldims'); if (!el) return; const d = activeDoc(); const ms = d ? selected(d) : [];
  if (ms.length !== 1) { el.textContent = ms.length > 1 ? `${ms.length} selected` : ''; return; }
  const m = ms[0]; const sc = scaleForMarkup(d, m);
  if (m.type === 'sketch') { el.textContent = sizeLabel(d, m); return; }
  const b = markupBBox(m, d); el.textContent = `W ${fmtLen(b.w, sc)}   H ${fmtLen(b.h, sc)}`;
}
function updateUndoUI() { renderToolbarsState(); }
function updateDraftBar() {
  const bar = $('#draftbar'); const d = state.draft; let html = '';
  if (state.alignPick) html = alignPickText();
  else if (d && d.mode === 'multi' && d.rect) html = `<span><b>${esc(TOOLS[d.m.type].short || TOOLS[d.m.type].label)}</b> · rectangle: click the opposite corner, or drag (Shift for a square)</span><button class="btn sm" data-a="cancel">Cancel</button>`;
  else if (d && d.mode === 'multi' && !d.boxDrag) { const t = TOOLS[d.m.type]; const n = d.m.pts.length - 1; html = `<span><b>${esc(t.short || t.label)}</b> · ${n} point${n === 1 ? '' : 's'} · click to add${CURVE_TYPES.has(d.m.type) ? ' (Ctrl+click curves the side, drag to shape it)' : ''}, double-click or Enter to finish</span><button class="btn sm" data-a="undo-pt">Remove point</button><button class="btn sm" data-a="cancel">Cancel</button><button class="btn sm primary" data-a="finish">Finish</button>`; }
  else if (d && d.mode === 'click') html = `<span><b>${esc(TOOLS[d.m.type].short || TOOLS[d.m.type].label)}</b> · click the end point (Shift snaps to 45°)</span><button class="btn sm" data-a="cancel">Cancel</button>`;
  else if (state.placeSection) html = '<span><b>Section view</b> · click where the detail goes · Esc to cancel</span>';
  else if (state.addLeaderFor) html = '<span><b>Add leaders</b> · click each thing the callout should point to · Enter or Esc when done</span><button class="btn sm primary" data-a="end-leaders">Done</button>';
  else if (state.countId) { const m = getMarkup(state.countId); html = `<span><b>Counting</b> · ${m ? m.pts.length : 0} · click each item, Enter to finish</span><button class="btn sm primary" data-a="end-count">Finish</button>`; }
  else if (state.tool === 'calibrate') html = '<span><b>Calibrate</b> · click both ends of a known dimension</span>';
  bar.innerHTML = html; bar.hidden = !html;
}
function refreshPanels() { renderProps(); renderList(); if (panelShown('layers')) renderLayers(); if (panelShown('equipment')) renderEquipPanelSoon(); if (panelShown('ductwork')) renderDuctPanelSoon(); updateSelDims(); if (panelShown('measure')) renderMeasurePanel(); renderLinkedPanelSoon(); if (panelShown('session')) renderSessionPanel(); renderToolbarsState(); }
function refreshAll() { renderTabs(); renderAllMarks(); refreshPanels(); renderPanels(); updateUndoUI(); renderNavbar(); updatePageUI(); updateZoomUI(); renderToggles(); renderSaveBadge(); }

// ----- icons (24px stroke icons drawn for this app) -----------------------------------------
const ICONS = {
  // ---- tools: grey line art (currentColor) with one small colour accent ----
  select: '<path class="t-paper" d="M6 3.5l12 7-5.3 1.3-2.9 5.3z"/>',
  pan: '<path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v7c0 4-2.5 7-6.5 7S5.5 18 4 15l-1-2a1.5 1.5 0 012.6-1.5L8 14"/>',
  zoombox: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5" stroke-width="2"/><path class="s-blue" d="M8 10.5h5M10.5 8v5"/>',
  text: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path class="s-red" d="M8 8.5V7.5h8v1M12 7.5v9M10.3 16.5h3.4" stroke-width="1.8"/>',
  callout: '<rect x="9" y="3.5" width="12" height="8.5" rx="1"/><path d="M11.5 6.5h7M11.5 9h4.5" stroke-width="1.2"/><path class="s-red" d="M9.5 11L4 19.5"/><path class="f-red" d="M3 21l.7-4 2.8 1.8z"/>',
  note: '<path class="t-yellow" d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5M7.5 9h9M7.5 12.5h6" stroke-width="1.3"/>',
  pen: '<path d="M14.5 5.5l4 4L8.5 19.5l-5 1 1-5z"/><path d="M13 7l4 4"/><path class="s-blue" d="M3 22c3-2 6 0 9-1.5" stroke-width="1.4"/>',
  highlight: '<path class="f-yellow" d="M3 18.5h18v3H3z" opacity=".9"/><path d="M8.6 14.6l6.8-10.4 4.1 2.6-6.7 10.4z"/><path d="M8.6 14.6l-.8 3 3.6-1.2"/>',
  strike: '<path d="M5 7h14M5 17h10" stroke-width="1.6"/><path class="s-red" d="M3 12h18" stroke-width="1.8"/>',
  underline: '<path d="M7.5 4v7a4.5 4.5 0 009 0V4"/><path class="s-blue" d="M5 20h14" stroke-width="1.8"/>',
  stamp: '<path d="M9.5 12.5V9.2a2.5 2.5 0 115 0v3.3M4.5 12.5h15v4h-15z"/><path class="s-red" d="M6 20.5h12" stroke-width="2"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="1.2"/><circle class="f-amber" cx="8.5" cy="9.5" r="1.8"/><path class="s-green" d="M4 18l5-5.5 3.3 3.3 3.3-4 4.4 6.2" stroke-width="1.5"/>',
  line: '<path d="M5 19L19 5"/><circle class="f-blue" cx="5" cy="19" r="1.7"/><circle class="f-blue" cx="19" cy="5" r="1.7"/>',
  arrow: '<path d="M4.5 19.5L16.5 7.5"/><path class="f-red" d="M20 4l-1.9 7.6-5.7-5.7z"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/><rect class="f-blue" x="18.2" y="16.2" width="3.6" height="3.6"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/><circle class="f-blue" cx="20.5" cy="12" r="1.7"/>',
  polygon: '<path d="M12 3.5l8.5 6.6-3.3 9.4H6.8L3.5 10.1z"/><circle class="f-blue" cx="12" cy="3.5" r="1.7"/>',
  polyline: '<path d="M3 18l5-9 5 6 4-10 4 6"/><circle class="f-blue" cx="3" cy="18" r="1.6"/><circle class="f-blue" cx="21" cy="11" r="1.6"/>',
  cloud: '<path class="s-red" d="M6 17a3 3 0 01-1-5.8A3.5 3.5 0 0111 8a3.5 3.5 0 016.5 1.5A3 3 0 0118 17a2.5 2.5 0 01-4 1 2.5 2.5 0 01-4 0 2.5 2.5 0 01-4-1z" stroke-width="1.7"/>',
  calibrate: '<path d="M2.8 15.2L15.2 2.8l6 6L8.8 21.2z"/><path class="s-orange" d="M6.8 11.2l2 2M9.8 8.2l2 2M12.8 5.2l2 2" stroke-width="1.4"/>',
  length: '<path d="M3 12h18"/><path class="s-blue" d="M3 7.5v9M21 7.5v9" stroke-width="1.8"/><path d="M8 12V9.6M12 12V8.8M16 12V9.6" stroke-width="1.2"/>',
  polylength: '<path d="M3 19l6-10 5 5 7-9"/><circle class="f-blue" cx="3" cy="19" r="1.6"/><circle class="f-blue" cx="9" cy="9" r="1.6"/><circle class="f-blue" cx="14" cy="14" r="1.6"/><circle class="f-blue" cx="21" cy="5" r="1.6"/>',
  area: '<path class="t-green" d="M4 5h11l5 6-3 8H4z"/><path class="f-green" d="M8 13.5h7v2H8z" opacity=".75"/>',
  perimeter: '<path d="M4 5h11l5 6-3 8H4z" stroke-dasharray="3 2.2"/><circle class="f-purple" cx="4" cy="5" r="1.6"/><circle class="f-purple" cx="17" cy="19" r="1.6"/>',
  volume: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path class="t-orange" d="M12 12l8-4.5L12 3 4 7.5z"/><path d="M12 12v9"/>',
  count: '<circle cx="6.5" cy="7" r="2.8"/><circle cx="17.5" cy="7" r="2.8"/><circle class="f-pink" cx="6.5" cy="17" r="2.9"/><path d="M14.5 17h6M17.5 14v6" stroke-width="1.7"/>',
  angle: '<path d="M20 19H4L15 5"/><path class="s-teal" d="M10.5 19a6.5 6.5 0 00-2-4.8" stroke-width="2"/>',
  radius: '<circle cx="12" cy="12" r="8.5"/><path class="s-teal" d="M12 12l6-6" stroke-width="1.8"/><circle class="f-teal" cx="12" cy="12" r="1.4"/>',
  viewport: '<rect x="3" y="4" width="18" height="16" rx="1"/><rect class="s-teal" x="10.5" y="9.5" width="8" height="7.5" stroke-dasharray="2.5 1.8"/><path d="M6 8h4"/>',
  cutout: '<path class="t-green" d="M3 4h18v16H3z M9 9v6h6V9z" fill-rule="evenodd"/><rect class="s-red" x="9" y="9" width="6" height="6" stroke-dasharray="2.4 1.8"/>',
  sketchrect: '<rect x="4" y="5.5" width="16" height="11"/><path d="M4 5.5l16 11M20 5.5L4 16.5" stroke-width="1.1"/><path class="s-blue" d="M4 20.5h16M4 19v3M20 19v3" stroke-width="1.5"/>',
  sketchcircle: '<circle cx="12" cy="10.5" r="7"/><path d="M7 5.5l10 10M17 5.5L7 15.5" stroke-width="1.1"/><path class="s-green" d="M5 21h14M5 19.5v3M19 19.5v3" stroke-width="1.5"/>',
  edittext: '<path d="M4 6V4h11v2M9.5 4v13M7 17h5"/><path class="s-orange" d="M14 20.5l1-3.2 5-5 2.2 2.2-5 5z"/>',
  ocr: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M8 9h8M8 15h5"/><path class="s-teal" d="M3 12h18" stroke-width="1.6"/>',
  align: '<path d="M7 3v18M17 3v18M3 7h18M3 17h18" stroke-dasharray="2.6 1.8" stroke-width="1.1"/><rect class="s-blue" x="5" y="5" width="14" height="14" rx="1" transform="rotate(-4 12 12)"/>',
  refpt: '<circle class="s-pink" cx="12" cy="12" r="4.2"/><path d="M12 3v5.2M12 15.8V21M3 12h5.2M15.8 12H21"/>',
  gridline: '<circle class="s-pink" cx="6.5" cy="6.5" r="3.6"/><path d="M6.5 10.1V21" stroke-dasharray="3.2 1.6 .5 1.6"/><path d="M10.1 6.5H21" stroke-dasharray="3.2 1.6 .5 1.6"/>',
  alignpts: '<path d="M7 3v18M17 3v18M3 7h18M3 17h18" stroke-dasharray="2.6 1.8" stroke-width="1.1"/><circle class="s-red" cx="7" cy="7" r="2.6"/><circle class="s-red" cx="17" cy="17" r="2.6"/>',
  transition: '<rect x="3" y="8" width="9" height="9"/><circle cx="17.5" cy="12.5" r="3.5"/><path class="s-blue" d="M9.5 4.5h6l-2-2M15.5 4.5l-2 2" stroke-width="1.4"/>',
  // ---- commands ----
  open: '<path class="t-yellow" d="M3 7a1 1 0 011-1h5l2 2h8a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>',
  save: '<path d="M5 3h11l4 4v13a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M8 3v5h7V3"/><path class="s-blue" d="M7 21v-7h10v7"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="1.2"/><path class="s-blue" d="M7 14.5h10V21H7z"/>',
  cut: '<circle cx="6.5" cy="17.5" r="2.8"/><circle cx="17.5" cy="17.5" r="2.8"/><path d="M8.5 15.5L18 4M15.5 15.5L6 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  paste: '<rect x="5" y="4.5" width="14" height="16.5" rx="1"/><path d="M9 4.5V3h6v1.5"/><path class="s-blue" d="M9 11h6M9 15h4"/>',
  copyprops: '<path d="M5 3h11v5H5z"/><path d="M16 5.5h2.5V11H10.5v3"/><path class="s-amber" d="M9 14h3v7H9z" stroke-width="1.6"/>',
  pasteprops: '<path d="M5 3h11v5H5z"/><path d="M16 5.5h2.5V11H10.5v3"/><path d="M9 14h3v7H9z"/><rect class="s-blue" x="14" y="15" width="7" height="6" stroke-width="1.6"/>',
  fittext: '<rect x="3" y="5" width="18" height="14" rx="1" stroke-dasharray="2.6 1.8"/><path d="M8.5 9V8h7v1M12 8v8M10.5 16h3"/><path class="s-blue" d="M3 12h3M21 12h-3" stroke-width="1.7"/>',
  front: '<rect x="3" y="3" width="11" height="11" stroke-dasharray="2.5 1.8"/><rect class="t-blue s-blue" x="9" y="9" width="12" height="12"/>',
  back: '<rect class="t-blue s-blue" x="3" y="3" width="11" height="11"/><rect class="t-paper" x="9" y="9" width="12" height="12"/>',
  'arr-alignLeft': '<path class="s-blue" d="M4 3v18" stroke-width="1.8"/><rect x="7" y="5.5" width="12" height="4.5"/><rect x="7" y="14" width="7" height="4.5"/>',
  'arr-alignCenter': '<path class="s-blue" d="M12 3v18" stroke-width="1.8"/><rect x="5" y="5.5" width="14" height="4.5"/><rect x="8" y="14" width="8" height="4.5"/>',
  'arr-alignRight': '<path class="s-blue" d="M20 3v18" stroke-width="1.8"/><rect x="5" y="5.5" width="12" height="4.5"/><rect x="10" y="14" width="7" height="4.5"/>',
  'arr-alignTop': '<path class="s-blue" d="M3 4h18" stroke-width="1.8"/><rect x="5.5" y="7" width="4.5" height="12"/><rect x="14" y="7" width="4.5" height="7"/>',
  'arr-alignMiddle': '<path class="s-blue" d="M3 12h18" stroke-width="1.8"/><rect x="5.5" y="5" width="4.5" height="14"/><rect x="14" y="8" width="4.5" height="8"/>',
  'arr-alignBottom': '<path class="s-blue" d="M3 20h18" stroke-width="1.8"/><rect x="5.5" y="5" width="4.5" height="12"/><rect x="14" y="10" width="4.5" height="7"/>',
  'arr-distH': '<path class="s-blue" d="M3 4v16M21 4v16" stroke-width="1.6"/><rect x="6" y="8" width="4" height="8"/><rect x="14" y="8" width="4" height="8"/>',
  'arr-distV': '<path class="s-blue" d="M4 3h16M4 21h16" stroke-width="1.6"/><rect x="8" y="6" width="8" height="4"/><rect x="8" y="14" width="8" height="4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 017.5-2"/>',
  actual: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 9.5l2-1.5v8M14 9.5l2-1.5v8"/>',
  'back-view': '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  'fwd-view': '<path d="M14 6l6 6-6 6M20 12H4"/>',
  single: '<rect x="6" y="3" width="12" height="18" rx="1"/>',
  continuous: '<rect x="6" y="2" width="12" height="9" rx="1"/><rect x="6" y="13" width="12" height="9" rx="1"/>',
  grid: '<path d="M4 4h16v16H4zM9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" stroke-width="1.2"/>',
  snapgrid: '<path d="M4 4v16M10 4v16M4 4h16M4 10h16" stroke-width="1.1" stroke-dasharray="2 2"/><circle class="f-blue" cx="16" cy="16" r="2.4"/><path d="M16 10v10M10 16h10" stroke-width="1.1"/>',
  snapcontent: '<path d="M3 17h10V7" stroke-width="2"/><circle class="s-pink" cx="13" cy="17" r="3"/><path d="M17 4l4 4" stroke-width="1.2"/>',
  snapmarkup: '<rect x="4" y="8" width="10" height="10"/><rect class="f-pink" x="12" y="6" width="4" height="4"/><path d="M18 4l3 3" stroke-width="1.2"/>',
  reuse: '<path d="M4 11a8 8 0 0114-4.5M20 13a8 8 0 01-14 4.5"/><path class="s-blue" d="M18 3v4h-4M6 21v-4h4"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle class="s-green" cx="17" cy="9" r="2.6"/><path class="s-green" d="M15.5 14.3c3 .2 5.5 2.4 5.5 5.7"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  toolbars: '<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="11" height="6" rx="1"/><path class="s-blue" d="M17 14v6M14.5 17h5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 9.5h1M9 9.5h1M12 9.5h1M15 9.5h1M18 9.5h0M6 12.5h1M9 12.5h1M12 12.5h1M15 12.5h3M8 15.5h8" stroke-width="1.6"/>',
  flatten: '<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
  csv: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 15h7M9 18h4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  zoomin: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>',
  zoomout: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5"/>',
  fitw: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  fitp: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 8h6M9 12h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  pages: '<rect x="4" y="3" width="11" height="14" rx="1"/><path d="M9 21h10a1 1 0 001-1V7"/>',
  colorproc: '<circle cx="12" cy="12" r="8"/><path class="f-mute" d="M12 4a8 8 0 010 16z"/><path class="s-blue" d="M12 4v16"/>',
  unflatten: '<path d="M4 18h16"/><path class="s-blue" d="M7 14l5-9 5 9"/><path d="M8 21h8"/>',
  pdf: '<path d="M6 3h8l4 4v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v4h4"/><path class="s-red" d="M8 13h8M8 16h5"/>',
  share: '<circle cx="6" cy="12" r="2.4"/><circle class="s-green" cx="18" cy="6" r="2.4"/><circle class="s-blue" cx="18" cy="18" r="2.4"/><path d="M8.2 11l7.6-4M8.2 13l7.6 4"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  toolset: '<rect x="3" y="7" width="18" height="13" rx="1.5"/><path d="M8 7V5a1 1 0 011-1h6a1 1 0 011 1v2M3 12h18M10 12v2h4v-2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  props: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  rotcw: '<path d="M20 12a8 8 0 11-2.3-5.7"/><path d="M20 3v6h-6"/>',
  rotccw: '<path d="M4 12a8 8 0 102.3-5.7"/><path d="M4 3v6h6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  insert: '<path d="M6 3h9l4 4v14H6z"/><path d="M12 10v7M8.5 13.5h7"/>',
  extract: '<path d="M6 3h9l4 4v6M6 3v18h7"/><path d="M16 15v6M13 18l3 3 3-3"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.3 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 004.2-.9"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  compare: '<rect x="3" y="5" width="11" height="14" rx="1"/><rect x="10" y="5" width="11" height="14" rx="1" stroke-dasharray="2.5 2"/>',
  snap: '<path d="M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3z"/><path d="M6 7h4M14 7h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17.5v.01"/>',
  chevl: '<path d="M15 5l-7 7 7 7"/>',
  chevr: '<path d="M9 5l7 7-7 7"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  chevd: '<path d="M5 9l7 7 7-7"/>',
  duct: '<path class="s-blue" d="M3 9h9.5V3.5M3 15h15.5V3.5"/><path d="M3 9v6M12.5 3.5h6" stroke-width="1.1"/><path class="s-blue" d="M5.5 12h4" stroke-width="1"/><path class="f-blue" d="M10.5 12l-1.6-1v2z"/>',
  grille: '<rect x="4" y="5" width="16" height="14" rx="1"/><path class="s-blue" d="M7 9h10M7 12h10M7 15h10"/>',
  section: '<path d="M4 4v16M20 4v16" stroke-dasharray="4 1.6 1 1.6" stroke-width="1.1"/><path class="s-blue" d="M4 4h4M20 4h-4"/><path class="f-blue" d="M8 4l-1.6-1.3v2.6zM16 4l1.6-1.3v2.6z"/><rect x="8" y="9" width="8" height="6" rx=".5"/>',
  equip: '<rect x="3.5" y="6" width="17" height="12" rx="1"/><circle class="s-blue" cx="9" cy="12" r="3.2"/><path class="s-blue" d="M9 9.6v4.8M6.6 12h4.8"/><path class="s-mute" d="M15 9h3M15 12h3M15 15h3" stroke-dasharray="1.5 1.5"/>',
  import: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5"/><path class="s-blue" d="M4 15v4.5h16V15"/>',
  export: '<path d="M12 14V3M7.5 7.5L12 3l4.5 4.5"/><path class="s-blue" d="M4 15v4.5h16V15"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path class="s-blue" d="M12 11v5.5M12 7.6v.1"/>',
  warn: '<path d="M12 3.5l9 16H3z"/><path class="s-red" d="M12 9.5v4.5M12 16.8v.1"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path class="s-blue" d="M8 12.3l2.7 2.7L16 9.5"/>',
  calc: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><rect class="s-blue" x="8" y="6.5" width="8" height="3.5" rx=".5"/><path d="M8.5 13.5h.1M12 13.5h.1M15.5 13.5h.1M8.5 17h.1M12 17h.1M15.5 17h.1" stroke-width="1.8"/>',
  connect: '<rect x="3" y="14" width="6" height="6"/><rect x="15" y="4" width="6" height="6"/><path class="s-blue" d="M9 17h5.5a2 2 0 002-2v-5"/><path class="f-blue" d="M16.5 10l-1.4 1.8h2.8z"/>',
  mech: '<circle cx="12" cy="12" r="8.5"/><path class="s-blue" d="M12 12c0-3 1.5-4.5 3.5-4.5M12 12c2.6 1.5 3.2 3.6 2.2 5.3M12 12c-2.6 1.5-4.7 1-5.7-.8"/><circle class="f-blue" cx="12" cy="12" r="1.4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  scale: '<path d="M3 17h18M3 13v8M21 13v8M12 15v4M7.5 16v3M16.5 16v3M8 9l4-6 4 6z"/>',
  pages2: '<rect x="3" y="3" width="10" height="13" rx="1"/><rect x="11" y="8" width="10" height="13" rx="1"/><path d="M14 13h4M14 16h4"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.2-1.2"/>',
  first: '<path d="M7 5v14M18 5l-7 7 7 7"/>',
  last: '<path d="M17 5v14M6 5l7 7-7 7"/>',
};
function icon(name, cls = '') { return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`; }
