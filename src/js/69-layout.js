// ===== Layout: panels on either side, customisable toolbars, saved layouts, theme =====
const PANELS = {
  pages: { title: 'Thumbnails', icon: 'pages', render: () => renderThumbs() },
  bookmarks: { title: 'Bookmarks', icon: 'bookmark', render: () => renderBookmarks() },
  layers: { title: 'Layers', icon: 'layers', render: () => renderLayers() },
  toolsets: { title: 'Tool sets', icon: 'toolset', render: () => renderToolsets() },
  equipment: { title: 'Equipment', icon: 'equip', render: () => renderEquipPanel() },
  ductwork: { title: 'Ductwork', icon: 'duct', render: () => renderDuctPanel() },
  props: { title: 'Properties', icon: 'props', render: () => renderProps() },
  measure: { title: 'Measurements', icon: 'scale', render: () => renderMeasurePanel() },
  linked: { title: 'Linked sketches', icon: 'link', render: () => renderLinkedPanel() },
  search: { title: 'Search', icon: 'search', render: () => renderSearchResults() },
  session: { title: 'Live session', icon: 'people', render: () => renderSessionPanel() },
};
// toolbar items: 'tool:<tool>' | 'cmd:<command id>' | 'sep'
const TOOLBAR_DEFS = [
  { id: 'file', name: 'File', items: ['cmd:file.open', 'cmd:file.save', 'cmd:file.print', 'sep', 'cmd:edit.undo', 'cmd:edit.redo'] },
  { id: 'markup', name: 'Markup', items: ['tool:text', 'tool:callout', 'tool:note', 'tool:pen', 'tool:highlight', 'tool:strikeout', 'tool:stamp', 'tool:image'] },
  { id: 'shapes', name: 'Shapes', items: ['tool:line', 'tool:arrow', 'tool:rect', 'tool:ellipse', 'tool:polygon', 'tool:polyline', 'tool:cloud'] },
  { id: 'measure', name: 'Measure', items: ['tool:calibrate', 'tool:viewport', 'sep', 'tool:length', 'tool:polylength', 'tool:area', 'tool:perimeter', 'tool:volume', 'tool:count', 'tool:angle', 'tool:radius'] },
  { id: 'sketch', name: 'Sketch to scale', items: ['tool:sketchrect', 'tool:sketchcircle', 'cmd:sketch.place', 'cmd:sketch.transition', 'tool:equip'] },
  { id: 'ductwork', name: 'Ductwork', items: ['tool:duct', 'tool:grille', 'cmd:duct.connectSame', 'cmd:duct.section'] },
  { id: 'edit', name: 'Edit', items: ['tool:edittext', 'cmd:doc.ocr'] },
  { id: 'arrange', name: 'Arrange', row: 1, items: ['cmd:arr.alignLeft', 'cmd:arr.alignCenter', 'cmd:arr.alignRight', 'cmd:arr.alignTop', 'cmd:arr.alignMiddle', 'cmd:arr.alignBottom', 'sep', 'cmd:arr.distH', 'cmd:arr.distV', 'sep', 'cmd:edit.front', 'cmd:edit.back'] },
  { id: 'properties', name: 'Properties', row: 1, items: ['cmd:edit.copyProps', 'cmd:edit.pasteProps', 'cmd:edit.fitText', 'cmd:edit.lock'] },
  { id: 'view', name: 'View', row: 1, items: ['cmd:view.zoomIn', 'cmd:view.zoomOut', 'cmd:view.fitWidth', 'cmd:view.fitPage'] },
  { id: 'pages', name: 'Pages', row: 1, items: ['cmd:doc.rotCCW', 'cmd:doc.rotCW', 'cmd:doc.compare', 'cmd:doc.alignGrid'] },
  { id: 'navigate', name: 'Navigate', row: 1, hidden: true, items: ['tool:select', 'tool:pan', 'tool:zoom'] },
];
function defaultLayout() {
  return {
    v: 1, toolbars: TOOLBAR_DEFS.map((t) => ({ id: t.id, name: t.name, items: t.items.slice(), row: t.row || 0, hidden: !!t.hidden })),
    panels: { left: ['pages', 'bookmarks', 'layers', 'toolsets', 'equipment', 'ductwork'], right: ['props', 'measure', 'linked', 'search', 'session'] },
    leftOpen: false, rightOpen: true, leftTab: 'pages', rightTab: 'props', listOpen: false, leftW: 250, rightW: 300, propbar: true, navbar: true,
  };
}
function loadLayout() {
  const L = store.get('layout', null); const D = defaultLayout(); if (!L || L.v !== 1) return D;
  // panels that were added after the layout was saved go to their default side
  const all = new Set([...L.panels.left, ...L.panels.right]); Object.keys(PANELS).forEach((p) => { if (!all.has(p)) (D.panels.left.includes(p) ? L.panels.left : L.panels.right).push(p); });
  L.panels.left = L.panels.left.filter((p) => PANELS[p]); L.panels.right = L.panels.right.filter((p) => PANELS[p]);
  // toolbars added since the layout was saved
  if (Array.isArray(L.toolbars)) { const have = new Set(L.toolbars.map((t) => t.id)); D.toolbars.forEach((t, k) => { if (!have.has(t.id)) L.toolbars.splice(Math.min(k, L.toolbars.length), 0, t); }); }
  return { ...D, ...L };
}
function saveLayoutNow() { store.set('layout', state.layout); }
const saveLayoutSoon = debounce(saveLayoutNow, 300);

// ----- panels ------------------------------------------------------------------------------
const panelSide = (p) => (state.layout.panels.left.includes(p) ? 'left' : 'right');
function panelShown(p) { const side = panelSide(p); return document.body.classList.contains(side + '-open') && state.layout[side + 'Tab'] === p; }
function openPanel(p, toggle) {
  if (!PANELS[p]) return; const side = panelSide(p); const L = state.layout;
  if (toggle && panelShown(p)) { L[side + 'Open'] = false; document.body.classList.remove(side + '-open'); renderStrips(); scheduleRender(); saveLayoutSoon(); return; }
  L[side + 'Tab'] = p; L[side + 'Open'] = true; document.body.classList.add(side + '-open');
  if (narrow()) document.body.classList.remove((side === 'left' ? 'right' : 'left') + '-open');
  renderPanels(side); renderStrips(); scheduleRender(); saveLayoutSoon();
}
// compatibility with earlier names
const openLeft = openPanel, openRight = openPanel, leftShown = panelShown, rightShown = panelShown;
function renderLeft() { renderPanels('left'); } function renderRight() { renderPanels('right'); }
function mountPanels() {
  // move every pane into its side's body, in strip order
  ['left', 'right'].forEach((side) => { const body = $(`#${side}-body`); state.layout.panels[side].forEach((p) => { const el = $(`.pane[data-pane="${p}"]`); if (el && el.parentNode !== body) body.appendChild(el); }); });
}
function renderPanels(side) {
  const sides = side ? [side] : ['left', 'right'];
  sides.forEach((s) => {
    const tab = state.layout[s + 'Tab']; const list = state.layout.panels[s];
    const cur = list.includes(tab) ? tab : list[0]; state.layout[s + 'Tab'] = cur;
    $$(`#${s}-body > .pane`).forEach((el) => { el.hidden = el.dataset.pane !== cur; });
    const t = $(`#${s}-title`); if (t) t.textContent = cur ? PANELS[cur].title : '';
    if (cur && document.body.classList.contains(s + '-open')) PANELS[cur].render();
  });
}
function renderStrips() {
  ['left', 'right'].forEach((side) => {
    const el = $(`#${side === 'left' ? 'lstrip' : 'rstrip'}`); if (!el) return;
    const keyFor = (p) => { const k = keyLabelFor('panel.' + p); return k ? ` (${k})` : ''; };
    el.innerHTML = state.layout.panels[side].map((p) => `<button data-panel="${p}" class="${panelShown(p) ? 'on' : ''}" title="${esc(PANELS[p].title)}${keyFor(p)}" aria-label="${esc(PANELS[p].title)}" aria-pressed="${panelShown(p)}">${icon(PANELS[p].icon)}</button>`).join('');
    const t = $(`#${side}-title`); if (t) t.textContent = PANELS[state.layout[side + 'Tab']] ? PANELS[state.layout[side + 'Tab']].title : '';
  });
}
function movePanel(p, side) {
  const L = state.layout; const from = panelSide(p); if (from === side) return;
  L.panels[from] = L.panels[from].filter((x) => x !== p); L.panels[side].push(p); mountPanels();
  if (L[from + 'Tab'] === p) L[from + 'Tab'] = L.panels[from][0] || null;
  openPanel(p); renderPanels(); renderStrips(); saveLayoutSoon();
}
function stripMenu(e, p) {
  e.preventDefault(); const side = panelSide(p); const other = side === 'left' ? 'right' : 'left'; const L = state.layout; const list = L.panels[side]; const i = list.indexOf(p);
  showMenu(e.clientX, e.clientY, [[`Move to the ${other} side`, () => movePanel(p, other)], ['Move up', () => { if (i > 0) { list.splice(i, 1); list.splice(i - 1, 0, p); mountPanels(); renderStrips(); saveLayoutSoon(); } }], ['Move down', () => { if (i < list.length - 1) { list.splice(i, 1); list.splice(i + 1, 0, p); mountPanels(); renderStrips(); saveLayoutSoon(); } }]]);
}
function bindPanelResizers() {
  ['left', 'right'].forEach((side) => {
    const h = $(`#${side} .presize`); if (!h) return;
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); const x0 = e.clientX; const w0 = state.layout[side + 'W'];
      const mv = (ev) => { const dx = ev.clientX - x0; state.layout[side + 'W'] = clamp(w0 + (side === 'left' ? dx : -dx), 190, 560); applyPanelWidths(); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); saveLayoutSoon(); scheduleRender(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
  });
}
function applyPanelWidths() { const r = document.documentElement.style; r.setProperty('--left-w', state.layout.leftW + 'px'); r.setProperty('--right-w', state.layout.rightW + 'px'); }

// ----- toolbars ------------------------------------------------------------------------------
function toolbarItemHtml(it, tbId, k) {
  if (it === 'sep') return `<span class="tsep" data-tb="${tbId}" data-k="${k}"></span>`;
  const [kind, id] = it.split(':'); const cid = kind === 'tool' ? 'tool.' + id : id; const c = COMMANDS[cid]; if (!c) return '';
  const key = keyLabelFor(cid); const ic = cmdIcon(c) || 'more';
  if (kind === 'tool') return `<button class="tool-btn${state.tool === id ? ' on' : ''}" data-tool="${id}" data-tb="${tbId}" data-k="${k}" title="${esc(c.label)}${key ? ` (${key})` : ''}" aria-label="${esc(c.label)}">${icon(ic)}</button>`;
  const en = !c.enabled || c.enabled(); const ck = c.checked ? c.checked() : false;
  return `<button class="tool-btn cmd-btn${ck ? ' on' : ''}" data-cmd="${cid}" data-tb="${tbId}" data-k="${k}" title="${esc(c.label)}${key ? ` (${key})` : ''}" aria-label="${esc(c.label)}"${en ? '' : ' disabled'}>${icon(ic)}</button>`;
}
function renderToolbars() {
  const el = $('#toolbars'); if (!el) return; const tbs = state.layout.toolbars.filter((t) => !t.hidden);
  const rows = []; tbs.forEach((t) => { (rows[t.row || 0] = rows[t.row || 0] || []).push(t); });
  el.innerHTML = rows.filter(Boolean).map((r, ri) => `<div class="trow" data-row="${r[0].row || 0}">${r.map((t) => `<div class="tbar" data-tb="${t.id}" role="toolbar" aria-label="${esc(t.name)}"><span class="tgrip" title="${esc(t.name)}: drag to move"></span>${t.items.map((it, k) => toolbarItemHtml(it, t.id, k)).join('')}${t.items.length ? '' : '<span class="tempty">Drag tools here</span>'}</div>`).join('')}</div>`).join('');
  el.classList.toggle('customizing', !!state.tbCustomize);
  renderToolbarsState();
}
// enabled/checked state only (cheap; called on selection and tool changes)
function renderToolbarsState() {
  $$('#toolbars .tool-btn[data-tool], #navbar .tool-btn[data-tool]').forEach((b) => { b.classList.toggle('on', b.dataset.tool === state.tool); b.classList.toggle('locked', b.dataset.tool === state.tool && (state.toolLocked || state.reuse) && state.tool !== 'select' && state.tool !== 'pan'); });
  $$('#toolbars .cmd-btn, #navbar .cmd-btn').forEach((b) => { const c = COMMANDS[b.dataset.cmd]; if (!c) return; b.disabled = !!(c.enabled && !c.enabled()); b.classList.toggle('on', !!(c.checked && c.checked())); });
}
function toolbarMenu(e) {
  e.preventDefault(); const L = state.layout;
  const items = L.toolbars.map((t) => [`${t.hidden ? '  ' : '✓ '}${t.name}`, () => { t.hidden = !t.hidden; renderToolbars(); saveLayoutSoon(); }]);
  const b = e.target.closest('[data-tb][data-k]');
  if (b && !b.classList.contains('tbar')) { const t = L.toolbars.find((x) => x.id === b.dataset.tb); const k = +b.dataset.k; items.unshift(['Remove from toolbar', () => { t.items.splice(k, 1); renderToolbars(); saveLayoutSoon(); }], ['Add separator after', () => { t.items.splice(k + 1, 0, 'sep'); renderToolbars(); saveLayoutSoon(); }], ['-']); }
  items.push(['-'], ['Customise toolbars…', openToolbarCustomizer], ['Reset toolbars', () => { L.toolbars = defaultLayout().toolbars; renderToolbars(); saveLayoutSoon(); }]);
  showMenu(e.clientX, e.clientY, items);
}
// drag & drop: grips move toolbars; buttons move between toolbars (Alt+drag, or any drag while customising)
const TBD = { drag: null };
function bindToolbarDrag() {
  const root = $('#toolbars');
  root.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.tgrip'); const btn = e.target.closest('.tool-btn, .tsep');
    if (grip) { startTbDrag(e, { kind: 'bar', id: grip.closest('.tbar').dataset.tb }, grip.closest('.tbar')); return; }
    if (btn && (e.altKey || state.tbCustomize) && e.button === 0) { startTbDrag(e, { kind: 'item', tb: btn.dataset.tb, k: +btn.dataset.k }, btn); }
  });
  root.addEventListener('contextmenu', toolbarMenu);
  root.addEventListener('click', (e) => { if (TBD.justDropped) { e.stopPropagation(); e.preventDefault(); TBD.justDropped = false; } }, true);
}
function startTbDrag(e, what, srcEl, paletteItem) {
  e.preventDefault(); const r = srcEl.getBoundingClientRect(); const ghost = srcEl.cloneNode(true); ghost.classList.add('tb-ghost'); Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px' }); document.body.appendChild(ghost);
  TBD.drag = { what, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false, paletteItem }; srcEl.classList.add('dragging'); TBD.src = srcEl;
  const mv = (ev) => {
    const d = TBD.drag; if (!d) return; if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 4) return; d.moved = true;
    d.ghost.style.left = ev.clientX - d.dx + 'px'; d.ghost.style.top = ev.clientY - d.dy + 'px'; d.target = tbDropTarget(ev.clientX, ev.clientY, d.what); showTbIndicator(d.target);
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); const d = TBD.drag; TBD.drag = null; d.ghost.remove(); srcEl.classList.remove('dragging'); showTbIndicator(null);
    if (!d.moved) { if (d.paletteItem) toast('Drag it onto a toolbar'); return; }
    TBD.justDropped = true; setTimeout(() => { TBD.justDropped = false; }, 0); applyTbDrop(d.what, d.target);
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
function tbDropTarget(x, y, what) {
  const bars = $$('#toolbars .tbar'); const rows = $$('#toolbars .trow');
  if (what.kind === 'bar') {
    for (const b of bars) { const r = b.getBoundingClientRect(); if (y >= r.top - 3 && y <= r.bottom + 3 && x >= r.left && x <= r.right) return { bar: b.dataset.tb, before: x < r.left + r.width / 2 }; }
    for (const rw of rows) { const r = rw.getBoundingClientRect(); if (y >= r.top && y <= r.bottom) return { row: +rw.dataset.row, end: true }; }
    const tr = $('#toolbars').getBoundingClientRect(); if (y > tr.bottom - 6 && y < tr.bottom + 30) return { row: Math.max(0, ...state.layout.toolbars.map((t) => t.row || 0)) + 1, end: true };
    return null;
  }
  for (const b of bars) {
    const r = b.getBoundingClientRect(); if (y < r.top - 4 || y > r.bottom + 4 || x < r.left - 4 || x > r.right + 6) continue;
    const items = [...b.querySelectorAll('[data-k]')]; let k = items.length;
    for (let i = 0; i < items.length; i++) { const ir = items[i].getBoundingClientRect(); if (x < ir.left + ir.width / 2) { k = +items[i].dataset.k; break; } }
    return { tb: b.dataset.tb, k };
  }
  return state.tbCustomize && what.kind === 'item' ? { remove: true } : null;
}
function showTbIndicator(t) {
  let ind = $('#tb-ind'); if (!ind) { ind = document.createElement('div'); ind.id = 'tb-ind'; document.body.appendChild(ind); }
  ind.hidden = !t || t.remove; if (!t || t.remove) { document.body.classList.toggle('tb-removing', !!(t && t.remove)); return; } document.body.classList.remove('tb-removing');
  let r;
  if (t.tb) { const b = $(`#toolbars .tbar[data-tb="${t.tb}"]`); const it = b.querySelector(`[data-k="${t.k}"]`); const br = b.getBoundingClientRect(); const x = it ? it.getBoundingClientRect().left - 2 : br.right - 4; r = { left: x, top: br.top + 3, width: 3, height: br.height - 6 }; }
  else if (t.bar) { const br = $(`#toolbars .tbar[data-tb="${t.bar}"]`).getBoundingClientRect(); r = { left: (t.before ? br.left : br.right) - 2, top: br.top, width: 4, height: br.height }; }
  else { const rows = $$('#toolbars .trow'); const rw = rows.find((x) => +x.dataset.row === t.row); const br = rw ? rw.getBoundingClientRect() : $('#toolbars').getBoundingClientRect(); r = rw ? { left: br.right - 6, top: br.top, width: 4, height: br.height } : { left: br.left, top: br.bottom - 2, width: br.width, height: 4 }; }
  Object.assign(ind.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}
function applyTbDrop(what, t) {
  if (!t) return; const L = state.layout;
  if (what.kind === 'bar') {
    const tb = L.toolbars.find((x) => x.id === what.id); const rest = L.toolbars.filter((x) => x !== tb);
    if (t.bar) { if (t.bar === what.id) return; const tgt = L.toolbars.find((x) => x.id === t.bar); tb.row = tgt.row || 0; const i = rest.indexOf(tgt); rest.splice(t.before ? i : i + 1, 0, tb); }
    else { tb.row = t.row; rest.push(tb); }
    L.toolbars = rest; normalizeRows(); renderToolbars(); saveLayoutSoon(); return;
  }
  // item
  let item; if (what.kind === 'palette') item = what.item; else { const src = L.toolbars.find((x) => x.id === what.tb); item = src.items[what.k]; if (t.remove) { src.items.splice(what.k, 1); renderToolbars(); saveLayoutSoon(); return; } src.items.splice(what.k, 1); if (t.tb === what.tb && t.k > what.k) t.k--; }
  if (t.remove) return; const dst = L.toolbars.find((x) => x.id === t.tb);
  if (item !== 'sep') { const dup = dst.items.indexOf(item); if (dup >= 0 && what.kind === 'palette') { toast('That tool is already on this toolbar'); renderToolbars(); return; } }
  dst.items.splice(clamp(t.k, 0, dst.items.length), 0, item); renderToolbars(); saveLayoutSoon();
}
function normalizeRows() { const rows = [...new Set(state.layout.toolbars.map((t) => t.row || 0))].sort((a, b) => a - b); state.layout.toolbars.forEach((t) => { t.row = rows.indexOf(t.row || 0); }); }
// customiser: a floating palette of every command; drag onto toolbars
function openToolbarCustomizer() {
  closeToolbarCustomizer(); state.tbCustomize = true; renderToolbars();
  const groups = {}; Object.values(COMMANDS).forEach((c) => { if (!cmdIcon(c) || c.id.startsWith('panel.') || c.id.startsWith('win.') || c.id.startsWith('help.')) return; (groups[c.group] = groups[c.group] || []).push(c); });
  const pal = document.createElement('div'); pal.id = 'tb-custom'; pal.className = 'tb-custom';
  pal.innerHTML = `<header><b>Customise toolbars</b><button class="btn sm primary" data-tc="done">Done</button></header>
    <p class="muted sm">Drag tools onto any toolbar. Drag a button off the toolbars to remove it. Drag a toolbar by its grip to move it or start a new row. Outside this window, hold Alt and drag.</p>
    <div class="tc-bars">${state.layout.toolbars.map((t) => `<label class="check"><input type="checkbox" data-tcbar="${t.id}"${t.hidden ? '' : ' checked'}> ${esc(t.name)}</label>`).join('')}</div>
    <div class="btn-row"><button class="btn sm" data-tc="new">New toolbar</button><button class="btn sm" data-tc="sep">Separator</button><button class="btn sm" data-tc="reset">Reset toolbars</button></div>
    <div class="tc-groups">${Object.entries(groups).map(([g, cs]) => `<h4>${esc(g)}</h4><div class="tc-items">${cs.map((c) => `<button class="tool-btn tc-item" data-item="${c.id.startsWith('tool.') ? 'tool:' + c.id.slice(5) : 'cmd:' + c.id}" title="${esc(c.label)}">${icon(cmdIcon(c))}</button>`).join('')}</div>`).join('')}</div>`;
  document.body.appendChild(pal);
  pal.addEventListener('pointerdown', (e) => { const b = e.target.closest('.tc-item, [data-tc="sep"]'); if (!b) return; startTbDrag(e, { kind: 'palette', item: b.dataset.item || 'sep' }, b, true); });
  pal.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-tc]'); if (!a) return; const L = state.layout;
    if (a.dataset.tc === 'done') closeToolbarCustomizer();
    else if (a.dataset.tc === 'reset') { L.toolbars = defaultLayout().toolbars; renderToolbars(); saveLayoutSoon(); openToolbarCustomizer(); }
    else if (a.dataset.tc === 'new') { const n = L.toolbars.filter((t) => t.id.startsWith('custom')).length + 1; L.toolbars.push({ id: 'custom' + Date.now().toString(36), name: `My toolbar ${n}`, items: [], row: Math.max(0, ...L.toolbars.map((t) => t.row || 0)), hidden: false }); renderToolbars(); saveLayoutSoon(); openToolbarCustomizer(); }
  });
  pal.addEventListener('change', (e) => { const id = e.target.dataset.tcbar; if (!id) return; const t = state.layout.toolbars.find((x) => x.id === id); t.hidden = !e.target.checked; renderToolbars(); saveLayoutSoon(); });
}
function closeToolbarCustomizer() { const p = $('#tb-custom'); if (p) p.remove(); if (state.tbCustomize) { state.tbCustomize = false; renderToolbars(); } }

// ----- saved layouts -----------------------------------------------------------------------
function captureLayout() { const L = deep(state.layout); L.leftOpen = document.body.classList.contains('left-open'); L.rightOpen = document.body.classList.contains('right-open'); L.listOpen = state.listOpen; return L; }
function applyLayout(L, announce) {
  closeToolbarCustomizer(); state.layout = { ...defaultLayout(), ...deep(L) }; const A = state.layout;
  document.body.classList.toggle('left-open', !!A.leftOpen && !narrow()); document.body.classList.toggle('right-open', !!A.rightOpen && !narrow());
  state.listOpen = !!A.listOpen; document.body.classList.toggle('list-closed', !state.listOpen);
  document.body.classList.toggle('no-propbar', A.propbar === false); document.body.classList.toggle('no-navbar', A.navbar === false);
  applyPanelWidths(); mountPanels(); renderToolbars(); renderStrips(); renderPanels(); saveLayoutNow(); scheduleRender();
  if (announce) toast('Layout applied');
}
async function saveLayoutAs() {
  const r = await openDialog({ title: 'Save layout', body: `${field('Name', '<input type="text" name="name" placeholder="e.g. Takeoff, Review" maxlength="40" required>')}<p class="muted sm">Saves toolbars, panels and their sides. Pick it from Window › Layouts.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }] });
  if (!r || !r.value || !r.form.name.trim()) return; state.layouts[r.form.name.trim()] = captureLayout(); store.set('layouts', state.layouts); toast(`Layout “${r.form.name.trim()}” saved`);
}
function layoutMenuItems() {
  const names = Object.keys(state.layouts || {}).sort();
  return names.map((n) => ({ label: `Layout: ${n}`, run: () => applyLayout(state.layouts[n], true) })).concat(names.length ? [{ label: 'Delete a saved layout…', run: deleteLayoutDialog }] : []);
}
async function deleteLayoutDialog() {
  const names = Object.keys(state.layouts); const r = await openDialog({ title: 'Delete layout', body: field('Layout', `<select name="n">${names.map((n) => `<option>${esc(n)}</option>`).join('')}</select>`), buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true, danger: true }] });
  if (!r || !r.value) return; delete state.layouts[r.form.n]; store.set('layouts', state.layouts);
}
async function exportLayout() { await saveFile('MeBulb layout.json', JSON.stringify({ app: 'MeBulb', layout: captureLayout(), shortcuts: state.shortcuts }, null, 1), 'application/json'); }
function importLayout() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (j.layout) applyLayout(j.layout, true); if (j.shortcuts) { state.shortcuts = j.shortcuts; store.set('shortcuts', state.shortcuts); rebuildKeymap(); } } catch (e) { toast('That is not a MeBulb layout file', 'error'); } };
  inp.click();
}

// ----- theme ---------------------------------------------------------------------------------
function setTheme(t) { state.theme = t; store.set('theme', t); applyTheme(); }
function applyTheme() {
  const t = state.theme || 'system'; if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (window.mebulbHost) setTimeout(() => hostTheme(dark), 0);
}

// ----- page modes, view history, full screen ------------------------------------------------------
const VH = { list: [], i: -1, lock: false };
function noteView() { const d = activeDoc(); if (!d || VH.lock) return; const v = { doc: d.id, page: currentPage(), zoom: d.zoom, st: V.el.scrollTop, sl: V.el.scrollLeft }; const last = VH.list[VH.i]; if (last && last.doc === v.doc && last.page === v.page && Math.abs(last.zoom - v.zoom) < 1e-3) { VH.list[VH.i] = v; return; } VH.list = VH.list.slice(0, VH.i + 1); VH.list.push(v); if (VH.list.length > 60) VH.list.shift(); VH.i = VH.list.length - 1; }
const noteViewSoon = debounce(noteView, 600);
async function viewHistory(dir) { const v = VH.list[VH.i + dir]; if (!v) return; VH.i += dir; VH.lock = true; if (v.doc !== state.activeId) await switchDoc(v.doc); setZoom(v.zoom); V.el.scrollTop = v.st; V.el.scrollLeft = v.sl; updatePageUI(); scheduleRender(); setTimeout(() => { VH.lock = false; }, 700); }
function setPageMode(mode) { state.pageMode = mode; store.set('pageMode', mode); const d = activeDoc(); const cur = d ? currentPage() : 0; document.body.classList.toggle('single-page', mode === 'single'); applyPageMode(cur); renderToolbarsState(); renderNavbar(); }
function applyPageMode(cur) { const d = activeDoc(); if (!d || !d.pageEls) return; const single = state.pageMode === 'single'; d.pageEls.forEach((el, i) => { el.hidden = single && i !== cur; }); if (single) { d.singleCur = cur; V.el.scrollTop = 0; } scheduleRender(); updatePageUI(); }
function toggleFullScreen() { if (window.mebulbHost && window.mebulbHost.toggleFullscreen) { window.mebulbHost.toggleFullscreen(); return; } if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => toast('Full screen is not available here')); }

// ----- navigation bar (under the sheet) ------------------------------------------------------------
function renderNavbar() {
  const el = $('#navbar'); if (!el) return; const d = activeDoc(); const i = d ? currentPage() : 0;
  const b = (cmd) => { const c = COMMANDS[cmd]; const k = keyLabelFor(cmd); return `<button class="tool-btn cmd-btn" data-cmd="${cmd}" title="${esc(c.label)}${k ? ` (${k})` : ''}" aria-label="${esc(c.label)}">${icon(cmdIcon(c))}</button>`; };
  const t = (tool) => { const c = COMMANDS['tool.' + tool]; const k = keyLabelFor('tool.' + tool); return `<button class="tool-btn${state.tool === tool ? ' on' : ''}" data-tool="${tool}" title="${esc(c.label)}${k ? ` (${k})` : ''}" aria-label="${esc(c.label)}">${icon(cmdIcon(c))}</button>`; };
  const pg = d && d.pages[i]; const sc = d ? scaleFor(d, i) : null;
  el.innerHTML = `<div class="nv-l">${b('view.markupsList')}<span class="nsep"></span>${b('view.single')}${b('view.continuous')}</div>
    <div class="nv-c">${t('pan')}${t('select')}${t('zoom')}<span class="nsep"></span>${b('view.firstPage')}${b('view.prevPage')}<span class="nv-page"><input id="page-in" aria-label="Page" inputmode="numeric" value="${d ? esc(pg && pg.label ? pg.label : i + 1) : ''}"><span id="page-count">${d ? `of ${d.numPages}` : ''}</span></span>${b('view.nextPage')}${b('view.lastPage')}<span class="nsep"></span>${b('view.back')}${b('view.forward')}</div>
    <div class="nv-r">${b('view.zoomOut')}<input id="zoom-val" aria-label="Zoom level" value="${d ? Math.round(d.zoom * 100) + '%' : ''}">${b('view.zoomIn')}<span class="nsep"></span><button class="scale-btn${sc && sc.unset ? ' unset' : ''}" id="scale-btn" title="Set the scale for this page">${d ? esc(sc.label || 'Custom scale') : 'Scale not set'}</button><span class="nv-size" id="page-size">${pg ? esc(sheetSizeText(pg)) : ''}</span></div>`;
  renderToolbarsState();
}
function sheetSizeText(pg) { const w = (pg.w / 72) * 2.54, h = (pg.h / 72) * 2.54; return metricPref() ? `${w.toFixed(2)} x ${h.toFixed(2)} cm` : `${(pg.w / 72).toFixed(2)} x ${(pg.h / 72).toFixed(2)} in`; }
function bindNavbar() {
  const el = $('#navbar');
  el.addEventListener('click', (e) => { const t = e.target.closest('[data-tool]'); if (t) { setTool(t.dataset.tool); return; } const c = e.target.closest('[data-cmd]'); if (c) { runCommand(c.dataset.cmd); return; } if (e.target.closest('#scale-btn') && activeDoc()) scaleDialog(currentPage()); });
  el.addEventListener('change', (e) => {
    const d = activeDoc(); if (!d) return;
    if (e.target.id === 'page-in') { const v = e.target.value.trim(); let i = d.pages.findIndex((p) => p.label && p.label === v); if (i < 0) i = parseInt(v, 10) - 1; if (!isNaN(i)) goToPage(i); updatePageUI(); }
    if (e.target.id === 'zoom-val') { const v = parseFloat(e.target.value); if (v > 0) setZoom(v / 100); updateZoomUI(); }
  });
  el.addEventListener('focusin', (e) => { if (e.target.id === 'zoom-val' || e.target.id === 'page-in') e.target.select(); });
}
// status bar aids as icon toggles
const AIDS = [['showGrid', 'grid', 'Show grid'], ['snapGrid', 'snapgrid', 'Snap to grid'], ['snapContent', 'snapcontent', 'Snap to content (drawing linework)'], ['snapMarkup', 'snapmarkup', 'Snap to markups'], ['reuse', 'reuse', 'Reuse tool (keep it active)']];
function renderStatusAids() { const el = $('#status .toggles'); if (!el) return; el.innerHTML = AIDS.map(([k, ic, l]) => `<button class="tog${state[k] ? ' on' : ''}" data-tog="${k}" title="${esc(l)}" aria-label="${esc(l)}" aria-pressed="${!!state[k]}">${icon(ic)}</button>`).join(''); }
function setStatus(msg) { const el = $('#status-text'); if (el) el.textContent = msg || 'Ready'; }
