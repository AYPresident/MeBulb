// ===== Commands, keyboard shortcuts ===============================================
// Every action (tools included) is a command with an id. Menus, toolbars and the
// keyboard all run commands, so any shortcut can be remapped and any command can be
// dragged onto a toolbar.
let COMMANDS = {};
const selTextMs = () => selected().filter((m) => TEXT_TYPES.has(m.type));
const anySel = () => state.sel.size > 0;
const multiSel = (n = 2) => () => state.sel.size >= n;
function buildCommands() {
  const C = {};
  const add = (id, label, run, o = {}) => { C[id] = { id, label, run, icon: o.icon || null, enabled: o.enabled || null, checked: o.checked || null, group: o.group || 'General', short: o.short || null, hint: o.hint || '' }; };
  add('tool.underline', 'Underline text', () => { state.toolStyles.strikeout = { ...(state.toolStyles.strikeout || {}), variant: 'under' }; setTool('strikeout'); }, { group: 'Markup', icon: 'underline', enabled: hasDoc, checked: () => state.tool === 'strikeout' && toolStyle('strikeout').variant === 'under' });
  // tools
  Object.entries(TOOLS).forEach(([t, T]) => {
    if (['sketch', 'textedit', 'cutout'].includes(t)) return;
    add('tool.' + t, T.label.replace(/\s*\(.*\)$/, ''), () => { if (t === 'image') { $('#file-image').click(); return; } if (t === 'strikeout') state.toolStyles.strikeout = { ...(state.toolStyles.strikeout || {}), variant: 'strike' }; setTool(t); }, { icon: T.icon, enabled: t === 'select' || t === 'pan' ? null : hasDoc, checked: () => state.tool === t, group: MEASURE_TYPES.has(t) || ['calibrate', 'viewport'].includes(t) ? 'Measure' : ['sketchrect', 'sketchcircle'].includes(t) ? 'Sketch to scale' : ['select', 'pan', 'zoom', 'alignpts'].includes(t) ? 'Navigate' : ['line', 'arrow', 'rect', 'ellipse', 'polygon', 'polyline', 'cloud'].includes(t) ? 'Shapes' : 'Markup', short: T.short });
  });
  const G_FILE = { group: 'File' }, G_EDIT = { group: 'Edit' }, G_VIEW = { group: 'View' }, G_DOC = { group: 'Document' }, G_ARR = { group: 'Arrange' }, G_WIN = { group: 'Window' };
  add('file.open', 'Open…', pickAndOpen, { ...G_FILE, icon: 'open' });
  add('file.save', 'Save', () => saveDoc('save'), { ...G_FILE, icon: 'save', enabled: hasDoc });
  add('file.saveAs', 'Save As…', () => saveDoc('saveas'), { ...G_FILE, icon: 'save', enabled: hasDoc });
  add('file.flatten', 'Save flattened copy…', () => saveDoc('flatten'), { ...G_FILE, icon: 'flatten', enabled: hasDoc });
  add('file.csv', 'Export markups list (CSV)…', exportCsv, { ...G_FILE, icon: 'csv', enabled: hasDoc });
  add('file.insert', 'Insert pages from PDF…', () => pageOpCurrent('insert'), { ...G_FILE, icon: 'insert', enabled: hasDoc });
  add('file.extract', 'Extract pages…', extractDialog, { ...G_FILE, icon: 'extract', enabled: hasDoc });
  add('file.sample', 'Open sample drawings', openSample, { ...G_FILE, icon: 'pages' });
  add('file.close', 'Close document', () => closeDoc(state.activeId), { ...G_FILE, icon: 'close', enabled: hasDoc });
  add('file.print', 'Print…', printDoc, { ...G_FILE, icon: 'print', enabled: hasDoc });
  // edit
  add('edit.undo', 'Undo', undo, { ...G_EDIT, icon: 'undo', enabled: () => hasDoc() && activeDoc().undo.length });
  add('edit.redo', 'Redo', redo, { ...G_EDIT, icon: 'redo', enabled: () => hasDoc() && activeDoc().redo.length });
  add('edit.cut', 'Cut', () => copySelected(true), { ...G_EDIT, icon: 'cut', enabled: anySel });
  add('edit.copy', 'Copy', () => copySelected(false), { ...G_EDIT, icon: 'copy', enabled: anySel });
  add('edit.paste', 'Paste', () => pasteClipboard(false), { ...G_EDIT, icon: 'paste', enabled: () => !!state.clipboard && hasDoc() });
  add('edit.pasteInPlace', 'Paste in place', () => pasteClipboard(false, true), { ...G_EDIT, icon: 'paste', enabled: () => !!state.clipboard && hasDoc() });
  add('edit.duplicate', 'Duplicate', duplicateSelected, { ...G_EDIT, enabled: anySel });
  add('edit.delete', 'Delete', deleteSelected, { ...G_EDIT, icon: 'trash', enabled: anySel });
  add('edit.selectAll', 'Select all on page', () => { const d = activeDoc(); const p = currentPage(); setTool('select'); state.sel = new Set(d.markups.filter((m) => m.page === p && layerVisible(d, m.layer)).map((m) => m.id)); refreshSelection(); }, { ...G_EDIT, enabled: hasDoc });
  add('edit.copyProps', 'Copy properties', copyProperties, { ...G_EDIT, icon: 'copyprops', enabled: () => state.sel.size === 1, hint: 'Style, font and layer of the selected markup' });
  add('edit.pasteProps', 'Paste properties', pasteProperties, { ...G_EDIT, icon: 'pasteprops', enabled: () => anySel() && !!state.propClipboard });
  add('edit.fitText', 'Fit text box to text', fitTextCommand, { ...G_EDIT, icon: 'fittext', enabled: () => selTextMs().length > 0 || !!state.editing });
  add('edit.lock', 'Lock / unlock', () => { const ms = selected(); if (!ms.length) return; const v = !ms[0].locked; applyToSelection((x) => { x.locked = v; }, { ignoreLock: true }); refreshSelection(); }, { ...G_EDIT, icon: 'lock', enabled: anySel });
  add('edit.front', 'Bring to front', () => reorderSelected(true), { ...G_ARR, icon: 'front', enabled: anySel });
  add('edit.back', 'Send to back', () => reorderSelected(false), { ...G_ARR, icon: 'back', enabled: anySel });
  add('edit.find', 'Find text', () => { openPanel('search'); setTimeout(() => { const q = $('#search-q'); if (q) q.focus(); }, 20); }, { ...G_EDIT, icon: 'search', enabled: hasDoc });
  add('edit.prefs', 'Preferences…', prefsDialog, { ...G_EDIT, icon: 'gear' });
  // arrange
  [['alignLeft', 'Align left'], ['alignCenter', 'Align centre'], ['alignRight', 'Align right'], ['alignTop', 'Align top'], ['alignMiddle', 'Align middle'], ['alignBottom', 'Align bottom']].forEach(([k, l]) => add('arr.' + k, l, () => arrangeSelected(k), { ...G_ARR, icon: 'arr-' + k, enabled: multiSel(2) }));
  add('arr.distH', 'Distribute horizontally', () => arrangeSelected('distH'), { ...G_ARR, icon: 'arr-distH', enabled: multiSel(3) });
  add('arr.distV', 'Distribute vertically', () => arrangeSelected('distV'), { ...G_ARR, icon: 'arr-distV', enabled: multiSel(3) });
  // view
  add('view.zoomIn', 'Zoom in', () => setZoom(activeDoc().zoom * 1.25), { ...G_VIEW, icon: 'zoomin', enabled: hasDoc });
  add('view.zoomOut', 'Zoom out', () => setZoom(activeDoc().zoom / 1.25), { ...G_VIEW, icon: 'zoomout', enabled: hasDoc });
  add('view.fitWidth', 'Fit width', () => fitWidth(), { ...G_VIEW, icon: 'fitw', enabled: hasDoc });
  add('view.fitPage', 'Fit page', fitPage, { ...G_VIEW, icon: 'fitp', enabled: hasDoc });
  add('view.actualSize', 'Actual size', () => setZoom(1), { ...G_VIEW, icon: 'actual', enabled: hasDoc });
  add('view.nextPage', 'Next page', () => goToPage(currentPage() + 1), { ...G_VIEW, icon: 'chevr', enabled: hasDoc });
  add('view.prevPage', 'Previous page', () => goToPage(currentPage() - 1), { ...G_VIEW, icon: 'chevl', enabled: hasDoc });
  add('view.firstPage', 'First page', () => goToPage(0), { ...G_VIEW, icon: 'first', enabled: hasDoc });
  add('view.lastPage', 'Last page', () => goToPage(activeDoc().numPages - 1), { ...G_VIEW, icon: 'last', enabled: hasDoc });
  add('view.back', 'Previous view', () => viewHistory(-1), { ...G_VIEW, icon: 'back-view', enabled: () => hasDoc() && VH.i > 0 });
  add('view.forward', 'Next view', () => viewHistory(1), { ...G_VIEW, icon: 'fwd-view', enabled: () => hasDoc() && VH.i < VH.list.length - 1 });
  add('view.single', 'Single page', () => setPageMode('single'), { ...G_VIEW, icon: 'single', checked: () => state.pageMode === 'single' });
  add('view.continuous', 'Continuous', () => setPageMode('continuous'), { ...G_VIEW, icon: 'continuous', checked: () => state.pageMode !== 'single' });
  add('view.markupsList', 'Markups list', toggleList, { ...G_VIEW, icon: 'list', checked: () => state.listOpen });
  add('view.grid', 'Show grid', () => toggleAid('showGrid'), { ...G_VIEW, icon: 'grid', checked: () => state.showGrid });
  add('view.snapGrid', 'Snap to grid', () => toggleAid('snapGrid'), { ...G_VIEW, icon: 'snapgrid', checked: () => state.snapGrid });
  add('view.snapContent', 'Snap to content', () => toggleAid('snapContent'), { ...G_VIEW, icon: 'snapcontent', checked: () => state.snapContent });
  add('view.snapMarkup', 'Snap to markups', () => toggleAid('snapMarkup'), { ...G_VIEW, icon: 'snapmarkup', checked: () => state.snapMarkup });
  add('view.reuse', 'Reuse tool', () => toggleAid('reuse'), { ...G_VIEW, icon: 'reuse', checked: () => state.reuse });
  add('view.viewports', 'Show viewports', () => { state.showViewports = !state.showViewports; renderAllMarks(); }, { ...G_VIEW, checked: () => state.showViewports });
  add('view.fullScreen', 'Full screen', toggleFullScreen, { ...G_VIEW, icon: 'fullscreen' });
  add('view.nextDoc', 'Next document', () => cycleDoc(1), { ...G_VIEW, enabled: () => state.docs.length > 1 });
  add('view.prevDoc', 'Previous document', () => cycleDoc(-1), { ...G_VIEW, enabled: () => state.docs.length > 1 });
  Object.keys(PANELS).forEach((p) => add('panel.' + p, PANELS[p].title, () => openPanel(p, true), { ...G_WIN, icon: PANELS[p].icon, checked: () => panelShown(p) }));
  // document
  add('doc.rotCW', 'Rotate page right', () => pageOpCurrent('rotcw'), { ...G_DOC, icon: 'rotcw', enabled: hasDoc });
  add('doc.rotCCW', 'Rotate page left', () => pageOpCurrent('rotccw'), { ...G_DOC, icon: 'rotccw', enabled: hasDoc });
  add('doc.blank', 'Insert blank page', () => pageOpCurrent('blank'), { ...G_DOC, icon: 'plus', enabled: hasDoc });
  add('doc.deletePage', 'Delete page', () => pageOpCurrent('delete'), { ...G_DOC, icon: 'trash', enabled: hasDoc });
  add('doc.compare', 'Overlay compare…', compareDialog, { ...G_DOC, icon: 'compare', enabled: hasDoc });
  add('doc.ocr', 'Recognize text (OCR)…', ocrDialog, { ...G_DOC, icon: 'ocr', enabled: hasDoc, short: 'OCR' });
  add('doc.color', 'Colour processing…', colorDialog, { ...G_DOC, icon: 'colorproc', enabled: hasDoc });
  add('doc.flatten', 'Flatten markups…', flattenDialog, { ...G_DOC, icon: 'flatten', enabled: hasDoc });
  add('doc.unflatten', 'Unflatten markups…', unflattenDialog, { ...G_DOC, icon: 'unflatten', enabled: hasDoc });
  add('doc.alignGrid', 'Align pages to grid…', autoAlignDialog, { ...G_DOC, icon: 'align', enabled: hasDoc });
  add('doc.alignPoints', 'Align this page by points', () => startAlignPick(currentPage()), { ...G_DOC, icon: 'alignpts', enabled: hasDoc });
  add('doc.scale', 'Set page scale…', () => scaleDialog(currentPage()), { ...G_DOC, icon: 'scale', enabled: hasDoc });
  // sketch
  add('sketch.place', 'Place selected sketch on pages…', () => placeOnPagesDialog(oneSketch()), { group: 'Sketch to scale', icon: 'pages2', enabled: () => !!oneSketch(), short: 'Place on pages' });
  add('sketch.transition', 'Add transition to selected sketch…', () => sketchAction('addtrans', oneSketch()), { group: 'Sketch to scale', icon: 'transition', enabled: () => !!oneSketch() && !sketchTrans(activeDoc(), oneSketch()) });
  add('sketch.cutout', 'Add cutout to selected area', () => startCutout(oneCutoutTarget()), { group: 'Measure', icon: 'cutout', enabled: () => !!oneCutoutTarget() });
  // window
  add('win.toolbars', 'Customise toolbars…', openToolbarCustomizer, { ...G_WIN, icon: 'toolbars' });
  add('win.shortcuts', 'Keyboard shortcuts…', shortcutsDialog, { ...G_WIN, icon: 'keyboard' });
  add('win.saveLayout', 'Save layout as…', saveLayoutAs, { ...G_WIN });
  add('win.resetLayout', 'Reset layout', () => applyLayout(defaultLayout(), true), { ...G_WIN });
  add('win.themeSystem', 'Theme: follow Windows', () => setTheme('system'), { ...G_WIN, checked: () => state.theme === 'system' });
  add('win.themeLight', 'Theme: light', () => setTheme('light'), { ...G_WIN, checked: () => state.theme === 'light' });
  add('win.themeDark', 'Theme: dark', () => setTheme('dark'), { ...G_WIN, checked: () => state.theme === 'dark' });
  add('help.shortcuts', 'Keyboard shortcuts', shortcutsDialog, { group: 'Help', icon: 'help' });
  add('help.about', 'About MeBulb', aboutDialog, { group: 'Help' });
  COMMANDS = C;
}
function runCommand(id) {
  const c = COMMANDS[id]; if (!c) return false; if (c.enabled && !c.enabled()) return false;
  try { const r = c.run(); if (r && r.catch) r.catch((e) => { console.error(e); toast(e.message || String(e), 'error'); }); } catch (e) { console.error(e); toast(e.message || String(e), 'error'); }
  return true;
}
function cmdIcon(c) { return c.icon || (c.id.startsWith('tool.') && TOOLS[c.id.slice(5)] ? TOOLS[c.id.slice(5)].icon : null); }

// ----- keyboard ------------------------------------------------------------------------------
// Key strings: modifiers in the order Ctrl, Shift, Alt, then the key ("Ctrl+Shift+C", "Alt+Z",
// "Shift+Alt+L", "T", "F11", "Delete", "PageDown").
function comboOf(e) {
  let k = e.key; if (k === ' ') k = 'Space'; if (k.length === 1) k = k.toUpperCase();
  const code = e.code || ''; const CODEKEY = { Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\' };
  if (/^Key[A-Z]$/.test(code)) k = code.slice(3); else if (/^Digit\d$/.test(code)) k = code.slice(5); else if (CODEKEY[code]) k = CODEKEY[code];
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', k].filter(Boolean).join('+');
}
function normCombo(s) { const parts = String(s).split('+').map((p) => p.trim()).filter(Boolean); const key = parts.pop() || ''; const has = (m) => parts.some((p) => p.toLowerCase() === m); return [has('ctrl') && 'Ctrl', has('shift') && 'Shift', has('alt') && 'Alt', key.length === 1 ? key.toUpperCase() : key].filter(Boolean).join('+'); }
let KEYMAP = {}; // combo -> command id
function effectiveShortcuts() { const out = {}; Object.entries(DEFAULT_SHORTCUTS).forEach(([id, ks]) => { out[id] = ks.slice(); }); Object.entries(state.shortcuts || {}).forEach(([id, ks]) => { out[id] = ks.slice(); }); return out; }
function rebuildKeymap() { KEYMAP = {}; Object.entries(effectiveShortcuts()).forEach(([id, ks]) => ks.forEach((k) => { if (k) KEYMAP[normCombo(k)] = id; })); }
function keysFor(id) { return (effectiveShortcuts()[id] || []).map(normCombo); }
function keyLabelFor(id) { const k = keysFor(id)[0]; return k || ''; }
// returns true when the key was handled by a command
function dispatchShortcut(e) {
  const combo = comboOf(e); if (!combo) return false; const id = KEYMAP[combo]; if (!id || !COMMANDS[id]) return false;
  e.preventDefault(); runCommand(id); return true;
}

// Defaults follow Bluebeam Revu 21's published shortcuts (support.bluebeam.com/revu/resources/keyboard-shortcuts.html)
// where Revu has an equivalent; MeBulb-only commands get keys Revu leaves free. Everything is remappable.
const DEFAULT_SHORTCUTS = {
  'tool.select': ['V'], 'tool.pan': ['Shift+V'], 'tool.zoom': ['Z'],
  'tool.text': ['T'], 'tool.callout': ['Q'], 'tool.note': ['N'], 'tool.pen': ['P'], 'tool.highlight': ['H'], 'tool.strikeout': ['D'], 'tool.underline': ['U'], 'tool.stamp': ['S'], 'tool.image': ['I'],
  'tool.line': ['L'], 'tool.arrow': ['A'], 'tool.rect': ['R'], 'tool.ellipse': ['E'], 'tool.polygon': ['Shift+P'], 'tool.polyline': ['Shift+N'], 'tool.cloud': ['C'],
  'tool.length': ['Shift+Alt+L'], 'tool.polylength': ['Shift+Alt+Q'], 'tool.area': ['Shift+Alt+A'], 'tool.perimeter': ['Shift+Alt+P'], 'tool.volume': ['Shift+Alt+V'], 'tool.count': ['Shift+Alt+C'], 'tool.angle': ['Shift+Alt+G'], 'tool.radius': ['Shift+Alt+U'],
  'tool.calibrate': ['Shift+K'], 'tool.viewport': ['Shift+W'], 'tool.sketchrect': ['B'], 'tool.sketchcircle': ['O'], 'tool.edittext': ['X'],
  'edit.undo': ['Ctrl+Z'], 'edit.redo': ['Ctrl+Y', 'Ctrl+Shift+Z'], 'edit.cut': ['Ctrl+X'], 'edit.copy': ['Ctrl+C'], 'edit.paste': ['Ctrl+V'], 'edit.pasteInPlace': ['Ctrl+Alt+Shift+V'], 'edit.duplicate': ['Ctrl+D'], 'edit.delete': ['Delete'],
  'edit.selectAll': ['Ctrl+A'], 'edit.find': ['Ctrl+F'], 'edit.copyProps': ['Ctrl+Shift+C'], 'edit.pasteProps': ['Ctrl+Shift+V'], 'edit.fitText': ['Alt+Z'], 'edit.lock': ['Ctrl+Shift+L'],
  'edit.front': ['Ctrl+Shift+J'], 'edit.back': ['Ctrl+Shift+['], 'edit.prefs': ['Ctrl+K'],
  'arr.alignLeft': ['Ctrl+Alt+L'], 'arr.alignCenter': ['Ctrl+Alt+E'], 'arr.alignRight': ['Ctrl+Alt+R'], 'arr.alignTop': ['Ctrl+Alt+T'], 'arr.alignMiddle': ['Ctrl+Alt+M'], 'arr.alignBottom': ['Ctrl+Alt+B'],
  'view.zoomIn': ['Ctrl+=', 'Ctrl++', 'Ctrl+Shift+=', '+', '=', 'Shift+='], 'view.zoomOut': ['Ctrl+-', '-'], 'view.fitWidth': ['Ctrl+0'], 'view.fitPage': ['Ctrl+9'], 'view.actualSize': ['Ctrl+8'],
  'view.firstPage': ['Home'], 'view.lastPage': ['End'], 'view.nextPage': ['Ctrl+ArrowRight', 'PageDown'], 'view.prevPage': ['Ctrl+ArrowLeft', 'PageUp'], 'view.back': ['Alt+ArrowLeft'], 'view.forward': ['Alt+ArrowRight'],
  'view.single': ['Ctrl+4'], 'view.continuous': ['Ctrl+5'], 'view.markupsList': ['Alt+L'], 'view.grid': ['Shift+F9'], 'view.snapGrid': ['Ctrl+Shift+F9'], 'view.snapContent': ['Ctrl+Shift+F8'], 'view.snapMarkup': ['Ctrl+Shift+F7'], 'view.fullScreen': ['F11'],
  'view.nextDoc': ['Ctrl+Tab'], 'view.prevDoc': ['Ctrl+Shift+Tab'],
  'panel.pages': ['Alt+T'], 'panel.bookmarks': ['Alt+B'], 'panel.layers': ['Alt+Y'], 'panel.toolsets': ['Alt+X'], 'panel.props': ['Alt+P'], 'panel.measure': ['Alt+U'], 'panel.search': ['Alt+1'], 'panel.session': ['Alt+C'], 'panel.linked': ['Alt+K'],
  'file.open': ['Ctrl+O'], 'file.save': ['Ctrl+S'], 'file.saveAs': ['Ctrl+Shift+S'], 'file.flatten': ['Ctrl+Alt+F'], 'file.print': ['Ctrl+P'], 'file.close': ['Ctrl+F4', 'Ctrl+W'],
  'doc.rotCW': ['Shift+Alt+=', 'Shift+Alt++'], 'doc.rotCCW': ['Shift+Alt+-'], 'doc.blank': ['Ctrl+Shift+N'], 'doc.deletePage': ['Ctrl+Shift+D'], 'file.extract': ['Ctrl+Shift+X'], 'file.insert': ['Ctrl+Shift+I'], 'doc.ocr': ['Ctrl+Shift+O'],
  'help.shortcuts': ['F1'],
};
