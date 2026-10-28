// ===== Menu bar, properties toolbar, toolbars, panel strips, status toggles ===
const hasDoc = () => !!activeDoc();
const oneSketch = () => { const s = selected(); return s.length === 1 && s[0].type === 'sketch' ? s[0] : null; };
const oneCutoutTarget = () => { const s = selected(); return s.length === 1 && CUTOUT_TYPES.has(s[0].type) ? s[0] : null; };
// menus are lists of command ids ('-' separates, {sub} nests, functions build dynamic items)
function menuDefs() {
  const toolbarsSub = () => state.layout.toolbars.map((t) => ({ label: t.name, run: () => { t.hidden = !t.hidden; renderToolbars(); saveLayoutSoon(); }, checked: () => !t.hidden }));
  const panelsSub = () => Object.keys(PANELS).map((p) => 'panel.' + p);
  const layoutsSub = () => [...layoutMenuItems(), '-', 'win.saveLayout', { label: 'Export layout and shortcuts…', run: exportLayout }, { label: 'Import layout and shortcuts…', run: importLayout }, '-', 'win.resetLayout'];
  return [
    ['File', ['file.open', () => recentMenuItems(), '-', 'file.save', 'file.saveAs', 'file.flatten', 'file.print', '-', 'file.csv', 'file.insert', 'file.extract', '-', { label: 'Show in folder', run: () => HOST().reveal(activeDoc().path), enabled: () => !!(HOST() && activeDoc() && activeDoc().path) }, 'file.sample', 'file.close']],
    ['Edit', ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete', '-', 'edit.copyProps', 'edit.pasteProps', 'edit.fitText', '-', 'edit.selectAll', 'edit.lock', 'edit.find', '-', 'edit.prefs']],
    ['View', ['view.zoomIn', 'view.zoomOut', 'view.fitWidth', 'view.fitPage', 'view.actualSize', '-', 'view.single', 'view.continuous', 'view.fullScreen', '-', 'view.markupsList', { label: 'Property bar', run: () => { state.layout.propbar = state.layout.propbar === false; applyLayout(state.layout); }, checked: () => state.layout.propbar !== false }, { label: 'Navigation bar', run: () => { state.layout.navbar = state.layout.navbar === false; applyLayout(state.layout); }, checked: () => state.layout.navbar !== false }, '-', 'view.grid', 'view.viewports']],
    ['Document', ['doc.rotCW', 'doc.rotCCW', 'doc.blank', 'doc.deletePage', 'file.extract', '-', 'doc.alignGrid', 'doc.alignPoints', { label: 'Clear page alignment', run: () => clearAlignment(), enabled: () => hasDoc() && !!activeDoc().align }, '-', 'doc.compare', 'doc.ocr', 'tool.edittext', 'doc.color', '-', 'doc.flatten', 'doc.unflatten', '-', 'doc.scale', 'tool.calibrate']],
    ['Markup', ['tool.text', 'tool.callout', 'tool.note', 'tool.pen', 'tool.highlight', 'tool.strikeout', 'tool.stamp', 'tool.stamps', 'tool.image', '-', 'tool.line', 'tool.arrow', 'tool.rect', 'tool.ellipse', 'tool.polygon', 'tool.polyline', 'tool.cloud', '-', 'arr.alignLeft', 'arr.alignCenter', 'arr.alignRight', 'arr.alignTop', 'arr.alignMiddle', 'arr.alignBottom', 'arr.distH', 'arr.distV', 'edit.front', 'edit.back']],
    ['Measure', ['tool.calibrate', 'doc.scale', 'tool.viewport', '-', 'tool.length', 'tool.polylength', 'tool.area', 'tool.perimeter', 'tool.volume', 'tool.count', 'tool.angle', 'tool.radius', '-', 'sketch.cutout', 'panel.measure', '-', { label: 'Units: metres', run: () => setUnits('m'), checked: () => state.units === 'm' }, { label: 'Units: millimetres', run: () => setUnits('mm'), checked: () => state.units === 'mm' }, { label: 'Units: feet-inches', run: () => setUnits('ftin'), checked: () => state.units === 'ftin' }]],
    ['Tools', ['tool.sketchrect', 'tool.sketchcircle', 'sketch.place', 'sketch.transition', 'panel.linked', '-', 'panel.session', { label: 'Start or join live session…', run: () => sessionStartDialog(), enabled: hasDoc }, '-', 'view.snapContent', 'view.snapMarkup', 'view.snapGrid', 'view.reuse', '-', 'panel.toolsets']],
    ['Window', [{ label: 'Panels', sub: panelsSub }, { label: 'Toolbars', sub: toolbarsSub }, 'win.toolbars', '-', { label: 'Layouts', sub: layoutsSub }, '-', 'win.themeSystem', 'win.themeLight', 'win.themeDark', '-', 'win.shortcuts', 'edit.prefs']],
    ['Help', ['help.shortcuts', 'help.about']],
  ];
}
// expand a menu definition into concrete items
function menuItems(list) {
  const out = [];
  (typeof list === 'function' ? list() : list).forEach((it) => {
    if (typeof it === 'function') { out.push(...menuItems(it())); return; }
    if (it === '-') { if (out.length && out[out.length - 1] !== '-') out.push('-'); return; }
    if (typeof it === 'string') { const c = COMMANDS[it]; if (!c) return; out.push({ label: c.label, kb: keyLabelFor(it), run: () => runCommand(it), icon: cmdIcon(c), enabled: c.enabled, checked: c.checked }); return; }
    out.push(it);
  });
  while (out[out.length - 1] === '-') out.pop(); return out;
}
let _openMenu = -1, _menuItems = [];
function renderMenus() { $('#menus').innerHTML = menuDefs().map(([t], k) => `<button class="mtitle" data-m="${k}" role="menuitem" aria-haspopup="true">${t}</button>`).join(''); }
function menuHtml(items) {
  return items.map((it, j) => {
    if (it === '-') return '<hr>'; const en = !it.enabled || it.enabled(); const ck = it.checked ? it.checked() : null;
    return `<button data-j="${j}"${en ? '' : ' disabled'} role="${ck != null ? 'menuitemcheckbox' : 'menuitem'}"${ck != null ? ` aria-checked="${!!ck}"` : ''}><span class="${ck ? 'chk' : 'mk-ic'}">${ck ? '✓' : it.icon ? icon(it.icon) : ''}</span>${esc(it.label)}${it.kb ? `<span class="kb">${esc(it.kb)}</span>` : ''}${it.sub ? '<span class="sub">▸</span>' : ''}</button>`;
  }).join('');
}
function openMenu(k, sub) {
  const defs = menuDefs(); const btn = $(`.mtitle[data-m="${k}"]`); if (!btn) return; _openMenu = k; $$('.mtitle').forEach((b) => b.classList.toggle('open', +b.dataset.m === k));
  const items = menuItems(sub ? sub.list : defs[k][1]); _menuItems = items; const pop = $('#menu-pop');
  pop.innerHTML = (sub ? `<div class="mhead">${esc(sub.title)}</div>` : '') + menuHtml(items);
  pop.hidden = false; const r = btn.getBoundingClientRect(); pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 6) + 'px'; pop.style.top = r.bottom + 'px';
  pop.onclick = (e) => { const b = e.target.closest('button[data-j]'); if (!b) return; const it = _menuItems[+b.dataset.j]; if (it.sub) { openMenu(k, { title: it.label, list: it.sub }); return; } closeMenus(); it.run(); };
}
function closeMenus() { _openMenu = -1; $('#menu-pop').hidden = true; $$('.mtitle').forEach((b) => b.classList.remove('open')); }
function bindMenus() {
  renderMenus();
  $('#menus').addEventListener('click', (e) => { const b = e.target.closest('.mtitle'); if (!b) return; const k = +b.dataset.m; if (_openMenu === k) closeMenus(); else openMenu(k); });
  $('#menus').addEventListener('mouseover', (e) => { const b = e.target.closest('.mtitle'); if (b && _openMenu >= 0 && +b.dataset.m !== _openMenu) openMenu(+b.dataset.m); });
  document.addEventListener('pointerdown', (e) => { if (_openMenu >= 0 && !e.target.closest('#menu-pop') && !e.target.closest('#menus')) closeMenus(); if (!e.target.closest('#pop') && !e.target.closest('.pb-color')) hidePop(); });
}
function recentMenuItems() { const r = window.mebulbHost ? recentList().slice(0, 8) : []; if (!r.length) return []; return [{ label: 'Open recent', sub: () => r.map((f) => ({ label: f.name + (f.dir ? '  —  ' + f.dir : ''), run: () => openRecent(f) })) }]; }

function toggleList() { state.listOpen = !state.listOpen; state.layout.listOpen = state.listOpen; saveLayoutSoon(); store.set('listOpen', state.listOpen); document.body.classList.toggle('list-closed', !state.listOpen); $('#list-toggle').setAttribute('aria-expanded', state.listOpen); renderList(); scheduleRender(); renderToolbarsState(); }
function toggleAid(k) {
  state[k] = !state[k]; store.set(k, state[k]); renderToggles();
  if (k === 'showGrid') renderAllMarks();
  if (k === 'snapContent' && state.snapContent) prefetchGeometry();
  toast(`${{ snapGrid: 'Snap to grid', showGrid: 'Grid', snapContent: 'Snap to content', snapMarkup: 'Snap to markups', reuse: 'Reuse tool' }[k]} ${state[k] ? 'on' : 'off'}`);
}
function renderToggles() { renderStatusAids(); renderToolbarsState(); }

// ----- properties toolbar (contextual to the selection or active tool) ------------
function hidePop() { const p = $('#pop'); if (p) p.hidden = true; }
function showColorPop(anchor, key, cur, allowNone) {
  const pop = $('#pop'); pop.innerHTML = swatchRow(key, cur, allowNone); pop.hidden = false; const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px'; pop.style.top = r.bottom + 4 + 'px';
}
const WIDTHS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8, 12, 16, 24];
function renderPropbar() {
  const el = $('#propbar'); if (!el) return; const doc = activeDoc(); renderToolbarsState();
  if (!doc) { el.innerHTML = '<span class="pb-hint">Open a PDF to start.</span>'; return; }
  const T = propTarget();
  if (T.kind === 'page') { const i = currentPage(); const sc = scaleFor(doc, i); el.innerHTML = `<div class="pb-name">${icon('select')} Select</div><span class="pb-hint">Page ${i + 1} of ${doc.numPages} · scale ${esc(sc.label || 'custom')} · select a markup or pick a tool to change its properties here</span>`; return; }
  const s = T.s; const types = T.types; const has = (...ts) => ts.some((t) => types.has(t)); const one = T.kind === 'sel' && T.ms.length === 1 ? T.ms[0] : null;
  const typeKey = one ? one.type : T.kind === 'tool' ? T.tool : [...types][0]; const tt = TOOLS[typeKey] || {};
  const name = T.kind === 'tool' ? (tt.short || tt.label) : one ? one.subject : `${T.ms.length} markups`;
  let h = `<div class="pb-name" title="${esc(name)}">${icon(tt.icon || 'select')} <span>${esc(name)}</span></div>`;
  if (T.kind === 'tool' && ['calibrate', 'zoom', 'edittext'].includes(T.tool)) { h += `<span class="pb-hint">${T.tool === 'calibrate' ? 'Click both ends of a known dimension.' : T.tool === 'zoom' ? 'Drag a box to zoom into.' : 'Click a line of PDF text to replace it.'}</span>`; el.innerHTML = h; return; }
  const sw = (key, cur, none) => `<button class="pb-color" data-pop="${key}" data-none="${none ? 1 : 0}" data-cur="${esc(cur || 'none')}" title="${key === 'style.fill' ? 'Fill colour' : key === 'style.fontColor' ? 'Text colour' : 'Line colour'}"><span class="swatch${!cur || cur === 'none' ? ' none' : ''}" style="--c:${esc(cur || 'transparent')}"></span><span class="caret"></span></button>`;
  if (!has('image')) h += `<div class="pb-group"><label>Line</label>${sw('style.stroke', s.stroke)}</div>`;
  if (has('rect', 'ellipse', 'polygon', 'cloud', 'text', 'callout', 'area', 'volume', 'note', 'count', 'radius', 'stamp', 'sketch', 'sketchrect', 'sketchcircle')) h += `<div class="pb-group"><label>Fill</label>${sw('style.fill', s.fill, !has('note'))}${s.fill && s.fill !== 'none' ? `<select data-k="style.fillOpacity" title="Fill opacity">${[1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05].map((v) => `<option value="${v}"${Math.abs(v - s.fillOpacity) < 0.001 ? ' selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}${[1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05].some((v) => Math.abs(v - s.fillOpacity) < 0.001) ? '' : `<option selected value="${s.fillOpacity}">${Math.round(s.fillOpacity * 100)}%</option>`}</select>` : ''}</div>`;
  if (!has('note', 'texthl', 'textedit', 'edittext')) { const ws = WIDTHS.includes(s.width) ? WIDTHS : [...WIDTHS, s.width].sort((a, b) => a - b); h += `<div class="pb-group"><label>Width</label><select data-k="style.width" title="Line width (pt)">${ws.map((w) => `<option value="${w}"${w === s.width ? ' selected' : ''}>${w} pt</option>`).join('')}</select></div>`; }
  if (!has('pen', 'highlight', 'note', 'stamp', 'image', 'texthl', 'strikeout', 'textedit', 'edittext')) h += `<div class="pb-group"><label>Style</label><select data-k="style.dash" title="Line style">${['solid', 'dashed', 'dotted', 'dashdot'].map((d) => `<option value="${d}"${s.dash === d ? ' selected' : ''}>${d === 'dashdot' ? 'Dash-dot' : d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select></div>`;
  if (has('line', 'arrow', 'polyline', 'length', 'polylength') && !has('rect', 'ellipse', 'text', 'area', 'count', 'callout')) { const lenDef = has('length', 'polylength') ? 'butt' : 'none'; h += `<div class="pb-group"><label>Ends</label><select data-k="style.arrowStart" title="Line start">${leOptions(s.arrowStart || lenDef)}</select><select data-k="style.arrowEnd" title="Line end">${leOptions(s.arrowEnd || lenDef)}</select></div>`; }
  if (has('callout') && types.size === 1) h += `<div class="pb-group"><label>Leader</label><select data-k="style.arrowEnd" title="Leader end">${leOptions(s.arrowEnd || 'arrow')}</select></div>`;
  if (has('count') && types.size === 1) h += `<div class="pb-group"><label>Symbol</label><select data-k="style.symbol" title="Count symbol">${COUNT_SYMBOLS.map(([v, l]) => `<option value="${v}"${(s.symbol || 'circle') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select><input type="number" data-k="style.size" min="2" max="40" step="0.5" value="${s.size || 6}" title="Symbol size (pt)"></div>`;
  h += `<div class="pb-group"><label>Opacity</label><select data-k="style.opacity">${[1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1].map((v) => `<option value="${v}"${Math.abs(v - s.opacity) < 0.001 ? ' selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}${[1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1].some((v) => Math.abs(v - s.opacity) < 0.001) ? '' : `<option selected value="${s.opacity}">${Math.round(s.opacity * 100)}%</option>`}</select></div>`;
  if (has('text', 'callout', 'textedit', 'edittext', 'sketch', 'sketchrect', 'sketchcircle', ...MEASURE_TYPES)) {
    const F = fmtFlags(T); const rich = [...types].every((t) => TEXT_TYPES.has(t));
    h += `<div class="pb-group pb-font"><label>Font</label><select data-k="style.font" title="Font">${fontOptions(F.f)}</select><input type="number" data-k="style.fontSize" min="3" max="144" step="0.5" value="${num(F.z, 2)}" title="Font size (pt)">${fmtButtons(F, rich)}${sw('style.fontColor', F.c)}</div>`;
  }
  // sketch dimensions right on the toolbar
  if (has('sketch', 'sketchrect', 'sketchcircle')) {
    const sc = one ? scaleForMarkup(doc, one) : scaleFor(doc, currentPage()); const sz = one ? sketchSize(doc, one) : state.sketchDefaults[TOOLS[T.tool] && TOOLS[T.tool].shape || 'rect'];
    if (one || T.kind === 'tool') h += `<div class="pb-group"><label>Name</label><input type="text" class="name-in" data-k="${one ? 'sk.name' : 'sketchNext'}" value="${esc(one ? sketchName(doc, one) : state.sketchNext || '')}" placeholder="M1" title="${one ? 'Riser name (all linked pages)' : 'Name for the next sketch; counts up automatically'}" maxlength="40"></div><div class="pb-group"><label>Size</label>${sz.shape === 'circle' ? `Ø <input type="text" class="dim-in" data-k="sz.d" value="${esc(dimVal(sz.d, sc))}" title="Diameter">` : `<input type="text" class="dim-in" data-k="sz.w" value="${esc(dimVal(sz.w, sc))}" title="Width">×<input type="text" class="dim-in" data-k="sz.h" value="${esc(dimVal(sz.h, sc))}" title="Height">`}${one ? `<input type="number" data-k="rot" value="${num(sketchRotDeg(doc, one), 2)}" step="1" title="Rotation (degrees)" style="width:58px">°` : ''}</div>${one ? `<span class="pb-area" title="Area">${esc(areaLabel(doc, one))}</span>` : ''}`;
    if (one) h += `<div class="pb-group"><button class="btn sm" data-act="place">${icon('pages2')} Place on pages</button>${sketchTrans(doc, one) ? '' : `<button class="btn sm" data-act="addtrans">Transition</button>`}</div>`;
  }
  el.innerHTML = h;
}
// ----- text formatting controls (shared by the properties toolbar and panel) -------------
function fontOptions(cur) {
  const f = famOf(cur); const opt = (k, l) => `<option value="${esc(k)}"${f === k ? ' selected' : ''}>${esc(l)}</option>`;
  let h = `<optgroup label="PDF standard fonts">${['helv', 'times', 'courier'].map((k) => opt(k, FONT_FAMILIES[k].label)).join('')}</optgroup>`;
  if (FONT_FAMILIES[f].sys && FONT_FAMILIES[f].missing) h = opt(f, FONT_FAMILIES[f].label) + h;
  if (FONTS.list.length) h += `<optgroup label="Fonts on this PC">${FONTS.list.map((n) => opt('sys:' + n, n)).join('')}</optgroup>`;
  else if (!HOST() && window.queryLocalFonts) h += '<option value="__pcfonts">Fonts on this PC…</option>';
  return h;
}
const FMT_BTNS = [['b', '<b>B</b>', 'Bold (Ctrl+B)'], ['i', '<i>I</i>', 'Italic (Ctrl+I)'], ['u', '<u>U</u>', 'Underline (Ctrl+U)'], ['s', '<s>S</s>', 'Strikethrough (Ctrl+Shift+X)'], ['sup', 'x<sup>2</sup>', 'Superscript (Ctrl+Shift+=)'], ['sub', 'x<sub>2</sub>', 'Subscript (Ctrl+=)']];
function fmtButtons(F, rich) { return `<span class="fmt-btns">${FMT_BTNS.filter(([k]) => rich || k === 'b' || k === 'i').map(([k, l, t]) => `<button type="button" class="pb-tog pb-fmt${F[k] ? ' on' : ''}" data-fmt="${k}" title="${t}" aria-pressed="${!!F[k]}">${l}</button>`).join('')}</span>`; }
// formatting state shown on the buttons: the caret while editing, else the whole markup
function fmtFlags(T) {
  const ed = state.editing && getMarkup(state.editing.id);
  if (ed) { const sel = state.editing.sel || { a: 0, b: 0 }; return rtAttrsAt(ed, sel.a === sel.b ? sel.a - 1 : sel.a); }
  const s = T.s || {}; const one = T.kind === 'sel' && T.ms.length === 1 ? T.ms[0] : null;
  if (one && TEXT_TYPES.has(one.type)) { const F = rtDefaults(one.style); ['b', 'i', 'u', 's', 'sup', 'sub'].forEach((k) => { F[k] = rtAll(one, k); }); return F; }
  return { ...rtDefaults(s), c: s.fontColor || s.stroke };
}
function doFmt(key) {
  if (state.editing) { rtFormat(key, 'toggle'); return; }
  const T = propTarget();
  if (T.kind === 'sel') rtFormatWhole(T.ms.filter((m) => !isLocked(m)), key, 'toggle');
  else if (T.kind === 'tool' && RT_STYLE[key]) { const sk = RT_STYLE[key]; state.toolStyles[T.tool] = { ...(state.toolStyles[T.tool] || {}), [sk]: !toolStyle(T.tool)[sk] }; store.set('toolStyles', state.toolStyles); }
  renderPropbar(); renderProps();
}
// font family, size or colour: to the selected characters while editing, else as a property
function textPropWhileEditing(k, v) {
  if (!state.editing) return false; const key = { 'style.font': 'f', 'style.fontSize': 'z', 'style.fontColor': 'c' }[k]; if (!key) return false;
  if (key === 'z') { v = parseFloat(v); if (!(v > 0)) return true; } rtFormat(key, v); return true;
}
function dimVal(v, sc) { return isMetric(sc) ? `${Math.round(v * 25.4)}` : `${num(v, 3)}"`; }
function bindPropbar() {
  const el = $('#propbar');
  el.addEventListener('mousedown', (e) => { if (e.target.closest('[data-fmt], .pb-color')) e.preventDefault(); });
  el.addEventListener('click', (e) => {
    const f = e.target.closest('[data-fmt]'); if (f) { doFmt(f.dataset.fmt); return; }
    const c = e.target.closest('.pb-color'); if (c) { showColorPop(c, c.dataset.pop, c.dataset.cur, c.dataset.none === '1'); return; }
    const t = e.target.closest('[data-tog-k]'); if (t) { const T = propTarget(); const cur = T.s && T.s[t.dataset.togK.slice(6)]; applyProp(t.dataset.togK, !cur, false); renderPropbar(); renderProps(); return; }
    const a = e.target.closest('[data-act]'); if (a) { const m = oneSketch(); if (!m) return; if (a.dataset.act === 'place') placeOnPagesDialog(m); else if (a.dataset.act === 'addtrans') sketchAction('addtrans', m); }
  });
  el.addEventListener('change', (e) => { const t = e.target; const k = t.dataset.k; if (!k) return; if (textPropWhileEditing(k, t.value)) return; applyProp(k, coerce(k, t), false); renderProps(); renderPropbar(); renderList(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.k) e.target.blur(); });
  $('#pop').addEventListener('mousedown', (e) => { if (e.target.closest('.sw[data-v]')) e.preventDefault(); });
  $('#pop').addEventListener('click', (e) => { const sw = e.target.closest('.sw[data-v]'); if (!sw) return; hidePop(); if (textPropWhileEditing(sw.dataset.k, sw.dataset.v)) return; applyProp(sw.dataset.k, sw.dataset.v, false); renderPropbar(); renderProps(); renderList(); });
  $('#pop').addEventListener('change', (e) => { const t = e.target; if (t.dataset.k) { hidePop(); if (textPropWhileEditing(t.dataset.k, t.value)) return; applyProp(t.dataset.k, t.value, false); renderPropbar(); renderProps(); } });
}
function aboutDialog() { openDialog({ title: 'About MeBulb', body: '<div class="about-head"><svg viewBox="0 0 32 32" class="mark" aria-hidden="true"><path class="bulb-glass" d="M16 3.5a9 9 0 00-5.2 16.4c1 .8 1.6 1.9 1.6 3.1v.5h7.2V23c0-1.2.6-2.3 1.6-3.1A9 9 0 0016 3.5z"/><path class="bulb-fil" d="M13.2 23.3v-5.6l1.4-2.2 1.4 2.2 1.4-2.2 1.4 2.2v5.6"/><path class="bulb-base" d="M12.4 25.6h7.2M12.9 27.8h6.2M14.3 30h3.4"/><path class="bulb-ray" d="M27.2 7.4l1.7-1M28.6 13h2"/></svg><div><div class="empty-brand">Me<b>Bulb</b></div><p class="tagline">Not the brightest, but it gets the job done.</p></div></div><p>PDF markup, measurement, takeoff and sketch-to-scale for construction drawings. It runs entirely in your browser and never uploads your files.</p><p class="muted">Built with pdf.js and pdf-lib.</p>', buttons: [{ label: 'Close', value: true, primary: true }] }); }
