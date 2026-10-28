// ===== Boot & wiring ===========================================================
function keyLabel(k) { return k !== k.toLowerCase() ? 'Shift+' + k : k.toUpperCase(); }
function fillIcons(root = document) { $$('.ic-wrap[data-ic]', root).forEach((e) => { e.innerHTML = icon(e.dataset.ic); }); }
const narrow = () => window.innerWidth <= 860;

function onScroll() {
  if (onScroll._r) return; onScroll._r = requestAnimationFrame(() => { onScroll._r = 0; updatePageUI(); scheduleRender(); noteViewSoon(); if (state.tool !== 'select' && state.tool !== 'pan') prefetchGeometry(); });
}

function wire() {
  // toolbars (commands and tools); double-click a tool to keep it active
  $('#toolbars').addEventListener('click', (e) => {
    if (state.tbCustomize) return;
    const b = e.target.closest('.tool-btn[data-tool]'); if (b) { runCommand('tool.' + b.dataset.tool); return; }
    const c = e.target.closest('[data-cmd]'); if (c) runCommand(c.dataset.cmd);
  });
  $('#toolbars').addEventListener('dblclick', (e) => { if (state.tbCustomize) return; const b = e.target.closest('.tool-btn[data-tool]'); if (!b || ['select', 'pan', 'image', 'zoom'].includes(b.dataset.tool)) return; setTool(b.dataset.tool, { lock: true }); toast(`${TOOLS[b.dataset.tool].short || TOOLS[b.dataset.tool].label} stays active until you press Esc`); });
  bindToolbarDrag();
  $('#empty-open').onclick = pickAndOpen; $('#empty-sample').onclick = openSample;
  $('#btn-panels').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.right - 220, r.bottom + 4, [...Object.keys(PANELS).map((p) => [PANELS[p].title, () => openPanel(p)]), ['-'], ['Markups list', toggleList]]); e.stopPropagation(); };
  // tabs
  $('#tabs').addEventListener('click', (e) => { const x = e.target.closest('[data-close]'); if (x) { e.stopPropagation(); closeDoc(x.dataset.close); return; } const t = e.target.closest('.tab'); if (t) switchDoc(t.dataset.id); });
  $('#tabs').addEventListener('keydown', (e) => { const t = e.target.closest('.tab'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); switchDoc(t.dataset.id); } });
  // panel strips (right-click to move a panel to the other side)
  ['#lstrip', '#rstrip'].forEach((sel) => { $(sel).addEventListener('click', (e) => { const b = e.target.closest('[data-panel]'); if (!b) return; openPanel(b.dataset.panel, true); if (b.dataset.panel === 'search' && panelShown('search')) setTimeout(() => $('#search-q').focus(), 10); }); $(sel).addEventListener('contextmenu', (e) => { const b = e.target.closest('[data-panel]'); if (b) stripMenu(e, b.dataset.panel); }); });
  $$('[data-close-panel]').forEach((b) => { b.onclick = () => { const side = b.dataset.closePanel; document.body.classList.remove(side + '-open'); state.layout[side + 'Open'] = false; saveLayoutSoon(); renderStrips(); scheduleRender(); }; });
  bindPanelResizers();
  // collapsible property sections
  const foldSec = (h) => { const sec = h.parentElement; sec.classList.toggle('collapsed'); const c = sec.classList.contains('collapsed'); h.setAttribute('aria-expanded', String(!c)); if (h.closest('.modal')) return; state.collapsed[h.textContent.trim()] = c; store.set('collapsed', state.collapsed); };
  document.addEventListener('click', (e) => { const h = e.target.closest('.psec > h3'); if (h) foldSec(h); });
  document.addEventListener('keydown', (e) => { const h = e.target.closest && e.target.closest('.psec > h3'); if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); foldSec(h); } });
  $('#thumbs').addEventListener('click', thumbClick);
  $('#page-ops').addEventListener('click', (e) => { const b = e.target.closest('[data-op]'); if (b && activeDoc()) pageOp(b.dataset.op); });
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#search-q').value; if (q === state.search.q && state.search.hits.length) gotoHit(state.search.idx + 1); else runSearch(q); });
  $('#search-q').addEventListener('search', (e) => { if (!e.target.value) runSearch(''); });
  $('#search-case').addEventListener('change', (e) => { state.search.caseSens = e.target.checked; if (state.search.q) runSearch(state.search.q); });
  $('#search-results').addEventListener('click', (e) => { const n = e.target.closest('[data-sr]'); if (n) { gotoHit(state.search.idx + (n.dataset.sr === 'next' ? 1 : -1)); return; } const r = e.target.closest('.sr'); if (r) gotoHit(+r.dataset.k); });
  // markups list
  $('#list-toggle').onclick = toggleList;
  $('#list-grip').addEventListener('pointerdown', (e) => {
    if (!state.listOpen) return; e.preventDefault(); const startY = e.clientY; const startH = $('#list').offsetHeight;
    const mv = (ev) => { const h = clamp(startH - (ev.clientY - startY), 90, window.innerHeight * 0.65); document.documentElement.style.setProperty('--list-h', h + 'px'); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); store.set('listH', $('#list').offsetHeight); scheduleRender(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  // navigation bar and status bar
  bindNavbar();
  $('#status .toggles').addEventListener('click', (e) => { const b = e.target.closest('[data-tog]'); if (b) toggleAid(b.dataset.tog); });
  $('#session-badge').addEventListener('click', () => openPanel('session'));
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  // files
  $('#file-open').addEventListener('change', async (e) => { const fs = [...e.target.files]; e.target.value = ''; await openFiles(fs); });
  $('#file-insert').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { await insertFromFile(state.insertAt, f); } catch (err) { toast('Could not insert pages: ' + err.message, 'error'); } } });
  $('#file-image').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { await insertImageFile(f); } catch (err) { toast('Could not place that image: ' + err.message, 'error'); } } });
  // draft bar
  $('#draftbar').addEventListener('click', (e) => { const a = e.target.closest('[data-a]'); if (!a) return; ({ finish: () => finishDraft(), cancel: cancelDraft, 'undo-pt': draftUndoPoint, 'end-count': endCount, 'cancel-align': cancelAlignPick })[a.dataset.a](); });
  // viewer
  V.el.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp); window.addEventListener('pointercancel', onPointerUp);
  V.el.addEventListener('dblclick', onDblClick); V.el.addEventListener('contextmenu', onContextMenu);
  V.el.addEventListener('wheel', onWheel, { passive: false }); V.el.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _openMenu >= 0) { closeMenus(); return; } if (e.key === '?' && !isTyping(e) && !$('.modal-back:not([hidden])')) { shortcutsDialog(); return; } if (e.key === 'Alt' && !e.repeat) state._altAlone = true; else state._altAlone = false; onKeyDown(e); });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { I.space = false; V.el.classList.remove('space'); });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctx')) hideMenu(); });
  $('#modal-back').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal-back') closeDialog(null); });
  // drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#drop').hidden = false; e.preventDefault(); } });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').hidden = true; });
  window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#drop').hidden = true; const fs = [...(e.dataTransfer ? e.dataTransfer.files : [])]; if (fs.length) openFiles(fs); });
  window.addEventListener('resize', debounce(() => { scheduleRender(); }, 120));
  window.addEventListener('beforeunload', (e) => { if (!window.mebulbHost && state.docs.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });
}

async function boot() {
  V.el = $('#viewer'); V.pages = $('#pages');
  if (window.mebulbHost) document.body.classList.add('desktop');
  state.layout = loadLayout(); applyTheme();
  buildCommands(); rebuildKeymap(); fillIcons(); bindMenus(); bindPropbar(); bindProps(); bindList(); bindLayers(); bindToolsets(); bindMeasurePanel(); bindLinkedPanel(); bindSessionPanel(); bindForms(); wire();
  const lh = store.get('listH', null); if (lh) document.documentElement.style.setProperty('--list-h', clamp(lh, 90, window.innerHeight * 0.65) + 'px');
  applyLayout(narrow() ? { ...state.layout, leftOpen: false, rightOpen: false, listOpen: false } : state.layout);
  document.body.classList.toggle('single-page', state.pageMode === 'single');
  getDownloads();
  if (window.mebulbHost) await hostBoot();
  fontsBoot();
  window.__mebulbReady = true;
  window.mebulb = window.planmark = { state, activeDoc, measureInfo, buildPdf, openBytes, setTool, saveDoc, setZoom, goToPage, currentPage, undo, redo, runSearch, buildGeometry, contentSnap, sketchSize, sketchTrans, linkSiblings, placeOnPages, addTransition, setSketchSize, renderAllMarks, refreshPanels, pageText, csWalkPage, csTokenize, csStreamBytes, runReplacement, presetScale, setUnits, autoAlign, alignT, mapPage, realignLinks, gridLabels, matchLabels, rtFormat, rtGetSel, rtSetSel, layoutRich, runsOf, sketchName, areaLabel, editText, commitEdit, compareOverlay, fmtLen, runCommand, COMMANDS: () => COMMANDS, keysFor, applyLayout, defaultLayout, openPanel, panelShown, fonts: () => FONTS, rtXhtml, addFaces, parseFace, loadFontList, sysFace, ensureDocFonts, openReader, incrementalUpdate, MemSource, blobSource, openSource, docBytes, openPath, sessionStart, sessionStop, renderSessionPanel, FONTS, renderColorAdj, colorAdjFor, scanFlat, readFlatPieces, runOcr, renderToCanvas, importStampFiles, STAMPLIB, scaleFromMeasure, importAnnotations, version: '5.1', importBtx, btxXml, toolRawParts, toolPreview, importBtxFiles, renderToolsets, useToolsetItem, placeToolItem, noteRecentTool, sampleMarkup, unzlib, zlib, hexOf, unhex, unflattenRevu, revuFlatCount, groupSelected, ungroupSelected, patchView, baseReader, refreshSelection };
  mountDoc(null); refreshAll(); updateDraftBar(); renderStrips(); renderStatusAids(); renderNavbar(); renderRecent();
  if (!window.mebulbHost || !state.openedFromArgs) await openSample();
}
boot();
