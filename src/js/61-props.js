// ===== Properties panel ========================================================
function propTarget() {
  const doc = activeDoc(); const ms = selected(doc);
  if (ms.length) return { kind: 'sel', ms, s: ms[0].style, types: new Set(ms.map((m) => m.type)) };
  if (state.tool !== 'select' && state.tool !== 'pan') return { kind: 'tool', tool: state.tool, s: toolStyle(state.tool), types: new Set([state.tool]) };
  return { kind: 'page' };
}
function swatchRow(key, cur, allowNone) {
  const sw = SWATCHES.map((c) => `<button type="button" class="sw${cur && cur.toLowerCase() === c ? ' on' : ''}" style="--c:${c}" data-k="${key}" data-v="${c}" aria-label="${c}"></button>`).join('');
  return `<div class="swatches">${allowNone ? `<button type="button" class="sw none${!cur || cur === 'none' ? ' on' : ''}" data-k="${key}" data-v="none" aria-label="No fill"></button>` : ''}${sw}<label class="sw custom" title="Custom colour"><input type="color" data-k="${key}" value="${cur && cur !== 'none' && cur.startsWith('#') && cur.length === 7 ? cur : '#000000'}" aria-label="Custom colour"></label></div>`;
}
function field(label, inner, cls = '') { return `<div class="field ${cls}"><label>${label}</label>${inner}</div>`; }

function renderProps() {
  renderPropbar();
  const el = $('#props'); if (!el) return; const doc = activeDoc();
  if (!doc) { el.innerHTML = '<p class="muted pad">Open a PDF to see properties.</p>'; return; }
  const T = propTarget(); let html = '';
  if (T.kind === 'page') { el.innerHTML = pagePropsHtml(doc); el.dataset.page = currentPage(); applyCollapsed(el); return; }
  el.dataset.page = '';
  const s = T.s; const types = T.types; const one = T.kind === 'sel' && T.ms.length === 1 ? T.ms[0] : null;
  const has = (...ts) => ts.some((t) => types.has(t));
  const tl = T.kind === 'tool' ? TOOLS[T.tool] : null;
  html += `<div class="props-head"><span class="pill-ic">${icon(TOOLS[one ? one.type : T.kind === 'tool' ? T.tool : [...types][0]] ? TOOLS[one ? one.type : T.kind === 'tool' ? T.tool : [...types][0]].icon : 'select')}</span><div><div class="ph-title">${T.kind === 'tool' ? esc(tl.short || tl.label) : one ? esc(one.subject) : `${T.ms.length} markups`}</div><div class="ph-sub">${T.kind === 'tool' ? 'Defaults for new markups' : one ? esc(TOOLS[one.type] ? TOOLS[one.type].short || TOOLS[one.type].label : one.type) + ' · page ' + (one.page + 1) : 'Changes apply to all selected'}</div></div></div>`;

  if (one && MEASURE_TYPES.has(one.type)) {
    const info = measureInfo(one, doc);
    const vp = viewportAt(doc, one.page, one.pts[0]);
    html += `<div class="measure-readout"><div class="mr-val">${esc(info.text || '\u2014')}</div><div class="mr-sub">${esc(info.kind)}${one.type === 'volume' ? ' \u00b7 ' + esc(info.sub) : ''} \u00b7 ${esc(scaleForMarkup(doc, one).label || '')}${vp ? ' \u00b7 viewport ' + esc(vp.name) : ''}</div></div>`;
  }
  if (T.kind === 'tool' && T.tool === 'calibrate') { html += '<p class="muted pad">Click both ends of a dimension you know, such as a dimension string or a scale bar, then enter its real length.</p>'; el.innerHTML = html; return; }
  if (T.kind === 'tool' && T.tool === 'viewport') { html += '<p class="muted pad">Drag a box around a detail or enlarged plan that is drawn at a different scale. Measurements that start inside it use its scale.</p>'; el.innerHTML = html; return; }
  if (T.kind === 'tool' && T.tool === 'zoom') { html += '<p class="muted pad">Drag a box to zoom into it.</p>'; el.innerHTML = html; return; }
  if (T.kind === 'tool' && T.tool === 'edittext') { html += '<p class="muted pad">Click any line of PDF text and type the replacement. When you save, the original glyphs are removed from the page and your text is written in their place. Scanned pages need OCR first.</p>'; el.innerHTML = html; return; }
  if (T.kind === 'tool' && T.tool === 'cutout') { html += '<p class="muted pad">Click the corners of the opening, then double-click or press Enter. Its area is subtracted from the measurement.</p>'; el.innerHTML = html; return; }
  if (one && one.type === 'sketch') html += sketchPropsHtml(doc, one);
  if (T.kind === 'tool' && TOOLS[T.tool].mode === 'sketch') html += sketchToolHtml(doc, T.tool);
  if (one && one.type === 'textedit') html += `<section class="psec"><h3>Text edit</h3>${field('Original text', `<div class="note-box">${esc(one.orig || '')}</div>`)}${field('Replacement', `<input type="text" data-k="text" value="${esc(one.text)}">`)}${field('Background', swatchRow('style.cover', one.style.cover, false))}<p class="muted sm">${one.applied ? 'The original text was removed when this file was saved.' : 'The original glyphs are removed from the page content when you save.'}</p></section>`;

  // ---- appearance
  html += '<section class="psec"><h3>Appearance</h3>';
  if (!has('image') || types.size > 1) html += field('Line colour', swatchRow('style.stroke', s.stroke));
  if (has('rect', 'ellipse', 'polygon', 'cloud', 'text', 'callout', 'area', 'volume', 'note', 'count', 'radius', 'stamp', 'sketch', 'sketchrect', 'sketchcircle')) {
    html += field('Fill', swatchRow('style.fill', s.fill, !has('note')));
    if (s.fill && s.fill !== 'none') html += field('Fill opacity', `<div class="range"><input type="range" min="0" max="1" step="0.05" data-k="style.fillOpacity" value="${s.fillOpacity}"><output>${Math.round(s.fillOpacity * 100)}%</output></div>`);
  }
  if (!has('note', 'texthl', 'textedit')) html += field('Line width', `<div class="range"><input type="range" min="0" max="${has('highlight') ? 40 : 12}" step="0.25" data-k="style.width" value="${s.width}"><input type="number" class="num" min="0" step="0.25" data-k="style.width" value="${s.width}" aria-label="Line width in points"></div>`);
  if (has('strikeout')) html += field('Mark', `<select data-k="style.variant"><option value="strike"${s.variant !== 'under' ? ' selected' : ''}>Strikethrough</option><option value="under"${s.variant === 'under' ? ' selected' : ''}>Underline</option></select>`);
  if (!has('pen', 'highlight', 'note', 'stamp', 'image', 'texthl', 'strikeout', 'textedit')) html += field('Line style', `<select data-k="style.dash">${['solid', 'dashed', 'dotted', 'dashdot'].map((d) => `<option value="${d}"${s.dash === d ? ' selected' : ''}>${d === 'dashdot' ? 'Dash-dot' : d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select>`);
  html += field('Opacity', `<div class="range"><input type="range" min="0.05" max="1" step="0.05" data-k="style.opacity" value="${s.opacity}"><output>${Math.round(s.opacity * 100)}%</output></div>`);
  if (has('rect', 'polygon', 'cloud', 'area', 'perimeter', 'volume')) html += field('Border', `<label class="check"><input type="checkbox" data-k="style.cloud"${s.cloud ? ' checked' : ''}> Cloud border</label>${s.cloud ? `<div class="range"><input type="range" min="5" max="40" step="1" data-k="style.cloudArc" value="${s.cloudArc || 14}"><output>${s.cloudArc || 14} pt arcs</output></div>` : ''}`);
  if (has('line', 'arrow', 'polyline', 'callout', 'length', 'polylength') && !has('rect', 'ellipse', 'text', 'area', 'count')) {
    const lenDef = has('length', 'polylength') ? 'butt' : 'none'; const opt = (k) => leOptions(s[k] || (k === 'arrowEnd' && has('callout') ? 'arrow' : lenDef));
    html += `<div class="field two">${!has('callout') ? `<div><label>Line start</label><select data-k="style.arrowStart">${opt('arrowStart')}</select></div>` : ''}<div><label>${has('callout') ? 'Leader end' : 'Line end'}</label><select data-k="style.arrowEnd">${opt('arrowEnd')}</select></div></div>`;
  }
  if (has('count')) html += `<div class="field two"><div><label>Symbol</label><select data-k="style.symbol">${COUNT_SYMBOLS.map(([v, l]) => `<option value="${v}"${(s.symbol || 'circle') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div><label>Size</label><input type="number" class="num" min="2" max="40" step="0.5" data-k="style.size" value="${s.size || 6}"></div></div><label class="check"><input type="checkbox" data-k="style.numbered"${s.numbered ? ' checked' : ''}> Number each item</label>`;
  html += '</section>';

  // ---- text
  const texty = has('text', 'callout', 'sketch', 'sketchrect', 'sketchcircle', 'textedit', ...MEASURE_TYPES);
  if (texty) {
    html += '<section class="psec"><h3>Text</h3>';
    const F = fmtFlags(T); const rich = [...types].every((t) => TEXT_TYPES.has(t));
    html += field('Font', `<select data-k="style.font">${fontOptions(F.f)}</select>`);
    html += `<div class="field two"><div><label>Font size</label><input type="number" class="num" min="3" max="144" step="0.5" data-k="style.fontSize" value="${s.fontSize}"></div>${has('text', 'callout') ? `<div><label>Align</label><select data-k="style.align">${['left', 'center', 'right'].map((a) => `<option${s.align === a ? ' selected' : ''}>${a}</option>`).join('')}</select></div>` : `<div><label>Label box</label><label class="check"><input type="checkbox" data-k="style.labelBg"${s.labelBg !== false ? ' checked' : ''}> Show</label></div>`}</div>`;
    html += field('Text colour', swatchRow('style.fontColor', s.fontColor || s.stroke));
    html += `<div class="field"><label>Style</label><div class="fmt-row">${fmtButtons(F, rich)}</div>${rich ? '<p class="muted sm">These apply to the whole markup. To format part of the text, double-click it and select the words first.</p>' : ''}</div>`;
    html += '</section>';
  }
  if (has('stamp') && (T.kind === 'tool' || (one && one.asset))) {
    const lib = STAMPLIB.list.length ? STAMPLIB.list : STAMPS.map((t) => ({ id: 'txt:' + t, name: t, kind: 'text' }));
    if (!STAMPLIB.list.length) loadStampLibrary().then(() => { if (rightShown('props')) renderProps(); });
    html += `<section class="psec"><h3>Stamp</h3>${one && one.asset ? `<div class="note-box">${esc(one.text || 'Stamp')}${Object.entries(one.stampValues || {}).filter(([, v]) => v).map(([k, v]) => `<br><span class="muted">${esc(k)}:</span> ${esc(v)}`).join('')}</div><div class="btn-row"><button type="button" class="btn sm" data-act="stamp-fields">Change fields…</button></div>` : field('Stamp', `<select data-k="stamplib">${lib.map((x) => `<option value="${esc(x.id)}"${x.id === state.stampId ? ' selected' : ''}>${esc(x.name)}${x.kind === 'pdf' ? ' (PDF)' : ''}</option>`).join('')}</select>`)}<div class="btn-row"><button type="button" class="btn sm" data-act="stamps">${icon('stamp')} Stamps…</button></div></section>`;
  } else if (has('stamp')) {
    const cur = one ? one.text : state.stampText;
    html += `<section class="psec"><h3>Stamp</h3>${field('Stamp text', `<select data-k="stamppick">${STAMPS.map((x) => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('')}<option value="__custom"${STAMPS.includes(cur) ? '' : ' selected'}>Custom…</option></select><input type="text" id="prop-text" data-k="text" value="${esc(cur)}" maxlength="40" aria-label="Stamp text">`)}${one ? `<label class="check"><input type="checkbox" data-k="stampSub"${one.stampSub !== false ? ' checked' : ''}> Show name and date</label>` : ''}</section>`;
  }
  if (has('volume') && (one || T.kind === 'tool')) {
    const sc = scaleFor(doc, one ? one.page : currentPage()); const dv = one ? one.depth : state.volDepth;
    html += `<section class="psec"><h3>Volume</h3>${field(`Depth (${UNITS[sc.unit].label})`, `<input type="text" data-k="depth" value="${sc.unit === 'ft' && sc.fmt === 'ftin' ? fmtFtIn((dv || 0) * 12, 16) : num(dv || 0, 4)}" placeholder="e.g. 6&quot; or 0.5">`)}</section>`;
  }

  if (one && CUTOUT_TYPES.has(one.type)) {
    const sc = scaleForMarkup(doc, one); const holes = one.holes || [];
    html += `<section class="psec"><h3>Cutouts</h3>${holes.length ? `<p class="sm">${holes.length} cutout${holes.length > 1 ? 's' : ''} removing ${esc(fmtArea(holes.reduce((a, h) => a + G.area(h), 0), sc))} (gross ${esc(fmtArea(G.area(one.pts), sc))})</p>` : '<p class="muted sm">Subtract openings such as shafts, stairs or columns from this area.</p>'}<div class="btn-row"><button type="button" class="btn sm" data-act="cutout">Add cutout</button>${holes.length ? '<button type="button" class="btn sm" data-act="clear-cutouts">Remove cutouts</button>' : ''}</div></section>`;
  }
  // ---- markup info
  if (one) {
    html += '<section class="psec"><h3>Markup</h3>';
    html += field('Subject', `<input type="text" data-k="subject" value="${esc(one.subject)}" maxlength="80">`);
    if (MEASURE_TYPES.has(one.type)) html += field('Label', `<input type="text" data-k="text" value="${esc(one.text || '')}" placeholder="Optional, shown with the value" maxlength="80">`);
    html += field(one.type === 'note' ? 'Note' : 'Comment', `<textarea id="prop-comment" data-k="comment" rows="${one.type === 'note' ? 5 : 3}" placeholder="${one.type === 'note' ? 'Write a note' : 'Add a comment'}">${esc(one.comment || '')}</textarea>`);
    html += `<div class="field two"><div><label>Status</label><select data-k="status">${STATUSES.map((x) => `<option${one.status === x ? ' selected' : ''}>${x}</option>`).join('')}</select></div><div><label>Layer</label><select data-k="layer"><option value="">None</option>${doc.layers.map((l) => `<option value="${l.id}"${one.layer === l.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div></div>`;
    html += `<label class="check"><input type="checkbox" data-k="locked"${one.locked ? ' checked' : ''}> Lock position and content</label>`;
    html += `<dl class="meta"><dt>Author</dt><dd>${esc(one.author)}</dd><dt>Created</dt><dd>${esc(fmtDate(one.created))}</dd><dt>Modified</dt><dd>${esc(fmtDate(one.modified))}</dd></dl>`;
    html += `<div class="btn-row"><button type="button" class="btn sm" data-act="zoom-sel">Zoom to</button><button type="button" class="btn sm" data-act="toolset-sel">Add to tool set</button><button type="button" class="btn sm danger" data-act="del-sel">Delete</button></div>`;
    html += '</section>';
  } else if (T.kind === 'sel') {
    html += `<section class="psec"><h3>Markups</h3><div class="field two"><div><label>Status</label><select data-k="status"><option value="">Mixed</option>${STATUSES.map((x) => `<option>${x}</option>`).join('')}</select></div><div><label>Layer</label><select data-k="layer"><option value="__keep">Mixed</option><option value="">None</option>${doc.layers.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div></div><div class="btn-row"><button type="button" class="btn sm danger" data-act="del-sel">Delete ${T.ms.length}</button></div></section>`;
  } else if (T.kind === 'tool') {
    html += `<section class="psec"><h3>Tool</h3>${field('Subject', `<input type="text" data-k="toolsubject" value="${esc(state.toolSubjects[T.tool] || tl.subject || '')}" maxlength="80">`)}<label class="check"><input type="checkbox" data-k="toollock"${state.toolLocked ? ' checked' : ''}> Keep this tool active after each markup</label><div class="btn-row"><button type="button" class="btn sm" data-act="toolset-tool">Save to tool set</button></div></section>`;
  }
  el.innerHTML = html; applyCollapsed(el);
}
// remember which property headings the user folded away
function applyCollapsed(root) { if (!root) return; root.querySelectorAll('.psec > h3').forEach((h) => { const c = !!state.collapsed[h.textContent.trim()]; h.parentElement.classList.toggle('collapsed', c); h.setAttribute('aria-expanded', String(!c)); h.tabIndex = 0; }); }

// sheet size in the preferred units, with its ISO or ANSI name when it matches
function paperSize(pg) {
  const w = (pg.w / 72) * 25.4, h = (pg.h / 72) * 25.4; const a = Math.max(w, h), b = Math.min(w, h);
  const named = [['A0', 1189, 841], ['A1', 841, 594], ['A2', 594, 420], ['A3', 420, 297], ['A4', 297, 210], ['B1', 1000, 707], ['ANSI E', 1118, 864], ['ANSI D', 864, 559], ['ARCH E', 1219, 914], ['ARCH D', 914, 610], ['ANSI B', 432, 279], ['Letter', 279, 216]].find(([, x, y]) => Math.abs(x - a) < 4 && Math.abs(y - b) < 4);
  const dims = metricPref() ? `${Math.round(w)} × ${Math.round(h)} mm` : `${num(pg.w / 72, 2)} × ${num(pg.h / 72, 2)} in`; return named ? `${named[0]} · ${dims}` : dims;
}
function pagePropsHtml(doc) {
  const i = currentPage(); const pg = doc.pages[i]; const sc = scaleFor(doc, i);
  const mCount = doc.markups.filter((m) => m.page === i).length;
  return `<div class="props-head"><span class="pill-ic">${icon('pages')}</span><div><div class="ph-title">Page ${i + 1}${pg.label && pg.label !== String(i + 1) ? ' · ' + esc(pg.label) : ''}</div><div class="ph-sub">${esc(paperSize(pg))} · ${mCount} markup${mCount === 1 ? '' : 's'}</div></div></div>
  <section class="psec"><h3>Scale</h3><div class="scale-card${sc.unset ? ' unset' : ''}"><div class="sc-label">${esc(sc.label || 'Custom')}</div><div class="sc-sub">${sc.unset ? 'Measurements read at paper size until you set a scale.' : metricPref() ? `10 mm on paper = ${esc(fmtLen((10 / 25.4) * 72, sc))}` : `1 in on paper = ${esc(fmtLen(72, sc))}`}</div></div>
  <div class="btn-row"><button type="button" class="btn sm primary" data-act="scale">Set scale</button><button type="button" class="btn sm" data-act="calibrate">Calibrate</button></div>${((doc.viewports && doc.viewports[i]) || []).length ? `<p class="sm">${doc.viewports[i].length} viewport${doc.viewports[i].length > 1 ? 's' : ''} with ${doc.viewports[i].length > 1 ? 'their' : 'its'} own scale on this page. <button type="button" class="btn sm" data-act="measure-panel">Manage</button></p>` : ''}</section>
  <section class="psec"><h3>Document</h3><dl class="meta"><dt>File</dt><dd>${esc(doc.name)}</dd><dt>Pages</dt><dd>${doc.numPages}</dd><dt>Markups</dt><dd>${doc.markups.length}</dd></dl>
  ${field('Your name on new markups', `<input type="text" data-k="author" value="${esc(state.author)}" maxlength="60">`)}</section>
  <section class="psec"><h3>Shortcuts</h3><button type="button" class="btn sm" data-act="help">Keyboard shortcuts</button></section>`;
}

// ----- property editing --------------------------------------------------------------------
let _propUndo = false;
function setField(m, k, v) {
  if (k.startsWith('style.')) {
    const sk = k.slice(6); m.style = { ...m.style, [sk]: v }; if (/^show(Name|Size|Area)$/.test(sk) && v) m.style.showLabel = true;
    if (TEXT_TYPES.has(m.type)) { const rk = Object.keys(RT_STYLE).find((x) => RT_STYLE[x] === sk); if (rk) rtStrip(m, rk); if (rk || sk === 'align') fitTextBox(m); }
    return;
  }
  if (k === 'depth') { m.depth = v; return; }
  m[k] = v;
}
function coerce(k, el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range' || el.type === 'number') { const n = parseFloat(el.value); return isNaN(n) ? 0 : n; }
  return el.value;
}
function applyProp(k, v, live) {
  const doc = activeDoc(); const T = propTarget();
  if (applySketchProp(doc, T, k, v, live)) return;
  if (k === 'author') { state.author = v.trim() || 'Reviewer'; store.set('author', state.author); return; }
  if (k === 'toollock') { state.toolLocked = v; $$('.tool-btn').forEach((b) => b.classList.toggle('locked', b.dataset.tool === state.tool && v)); return; }
  if (k === 'toolsubject') { state.toolSubjects[state.tool] = v; return; }
  if (k === 'stamplib') { state.stampId = v; store.set('stampId', v); const st = STAMPLIB.list.find((s) => s.id === v); if (st && st.kind === 'text') state.stampText = st.text; return; }
  if (k === 'stamppick') { if (v === '__custom') { const t = $('#prop-text'); if (t) { t.focus(); t.select(); } return; } k = 'text'; }
  if (k === 'depth') { const sc = scaleFor(doc, T.kind === 'sel' ? T.ms[0].page : currentPage()); const d = parseLength(v, sc.unit); if (isNaN(d)) return; v = d; if (T.kind === 'tool') { state.volDepth = d; return; } }
  if (k === 'layer' && v === '__keep') return;
  if (k === 'status' && v === '') return;
  if (T.kind === 'tool') {
    if (k === 'text' && T.tool === 'stamp') { state.stampText = v.toUpperCase() || 'APPROVED'; return; }
    if (!k.startsWith('style.')) return;
    const sk = k.slice(6); state.toolStyles[T.tool] = { ...(state.toolStyles[T.tool] || {}), [sk]: v, ...(/^show(Name|Size|Area)$/.test(sk) && v ? { showLabel: true } : {}) }; store.set('toolStyles', state.toolStyles); return;
  }
  if (T.kind !== 'sel') return;
  if (k === 'layer' && v === '') v = null;
  if (k === 'style.variant') { applyToSelection((m) => { m.style = { ...m.style, variant: v }; if (m.type === 'strikeout' && /^(Strikethrough|Underline)$/.test(m.subject)) m.subject = v === 'under' ? 'Underline' : 'Strikethrough'; }); return; }
  if (k === 'locked') { applyToSelection((m) => { m.locked = v; }, { ignoreLock: true }); refreshSelection(); return; }
  if (!_propUndo) { pushUndo(doc); _propUndo = true; }
  applyToSelection((m) => setField(m, k, v), { noUndo: true });
  if (!live) _propUndo = false;
  renderSel(doc, T.ms[0].page);
}
function bindProps() {
  const el = $('#props');
  el.addEventListener('input', (e) => {
    const t = e.target; const k = t.dataset.k; if (!k || t.tagName === 'SELECT' || t.type === 'checkbox') return;
    const v = coerce(k, t); if (k === 'depth') return;
    applyProp(k, v, true);
    const out = t.parentElement.querySelector('output'); if (out) out.textContent = k === 'style.cloudArc' ? `${v} pt arcs` : k === 'style.size' ? `${v} pt` : `${Math.round(v * 100)}%`;
    if (t.type === 'range') { const n = t.parentElement.querySelector('input.num'); if (n) n.value = v; } else if (t.classList.contains('num')) { const r = t.parentElement.querySelector('input[type=range]'); if (r) r.value = v; }
  });
  el.addEventListener('change', (e) => {
    const t = e.target; const k = t.dataset.k; if (!k) return;
    applyProp(k, coerce(k, t), false); _propUndo = false;
    const structural = t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'color' || k === 'depth' || /^(sz|tsz|rot|link|sk\.|sketchNext)/.test(k);
    if (structural) renderProps();
    renderList(); if (k === 'layer') renderLayers();
  });
  el.addEventListener('click', (e) => {
    const fb = e.target.closest('[data-fmt]'); if (fb) { doFmt(fb.dataset.fmt); return; }
    const sw = e.target.closest('.sw[data-v]');
    if (sw) { applyProp(sw.dataset.k, sw.dataset.v, false); _propUndo = false; renderProps(); renderList(); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act; const ms = selected();
    if (act === 'del-sel') deleteSelected();
    else if (act === 'stamps') stampsDialog();
    else if (act === 'stamp-fields' && ms[0]) editStampFields(ms[0]);
    else if (act === 'zoom-sel' && ms[0]) zoomToBox(ms[0].page, markupBBox(ms[0], activeDoc()));
    else if (act === 'toolset-sel') addSelectionToToolset();
    else if (act === 'toolset-tool') addToolToToolset();
    else if (act === 'scale') scaleDialog(currentPage());
    else if (act === 'calibrate') setTool('calibrate');
    else if (act === 'help') helpDialog();
    else if (act === 'cutout') startCutout(ms[0]);
    else if (act === 'clear-cutouts') applyToSelection((x) => { x.holes = []; });
    else if (act === 'measure-panel') openRight('measure');
    else if (act.startsWith('sk-')) sketchAction(act.slice(3), ms[0]);
    else if (act.startsWith('goto-')) { const m = getMarkup(act.slice(5)); if (m) { goToPage(m.page, m.pts[0]); state.sel.clear(); state.sel.add(m.id); refreshSelection(); } }
  });
}

// ----- sketch to scale properties ---------------------------------------------------------
function dimField(key, v, sc, label) { return `<div><label>${label}</label><input type="text" data-k="${key}" value="${esc(dimVal(v, sc))}" inputmode="decimal"></div>`; }
function sizeFields(prefix, sz, sc, noShape) {
  const shape = noShape ? '' : `<div class="field"><label>Shape</label><select data-k="${prefix}.shape"><option value="rect"${sz.shape === 'rect' ? ' selected' : ''}>Rectangle</option><option value="circle"${sz.shape === 'circle' ? ' selected' : ''}>Round</option></select></div>`;
  return shape + (sz.shape === 'circle' ? `<div class="field two">${dimField(prefix + '.d', sz.d, sc, 'Diameter')}<div></div></div>` : `<div class="field two">${dimField(prefix + '.w', sz.w, sc, 'Width')}${dimField(prefix + '.h', sz.h, sc, 'Height')}</div>`);
}
function sketchSymbolFields(s, sc, m) {
  const on = s.showLabel !== false; const shown = on && (s.showName !== false || s.showSize !== false || s.showArea); const au = sc && !isMetric(sc) ? 'sf' : 'm²';
  return `${field('Symbol', `<select data-k="style.symbol"><option value="x"${s.symbol === 'x' ? ' selected' : ''}>X (duct or shaft)</option><option value="diag"${s.symbol === 'diag' ? ' selected' : ''}>Single diagonal</option><option value="none"${!s.symbol || s.symbol === 'none' ? ' selected' : ''}>None</option></select>`)}
    <div class="field"><label>Label shows</label><div class="chk-row"><label class="check"><input type="checkbox" data-k="style.showName"${on && s.showName !== false ? ' checked' : ''}> Name</label><label class="check"><input type="checkbox" data-k="style.showSize"${on && s.showSize !== false ? ' checked' : ''}> Size</label><label class="check"><input type="checkbox" data-k="style.showArea"${on && s.showArea ? ' checked' : ''}> Area (${au})</label></div></div>
    ${shown ? field('Label position', `<select data-k="style.labelPos">${[['above', 'Above'], ['below', 'Below'], ['right', 'Right'], ['left', 'Left'], ['center', 'Middle of the shape']].map(([v, l]) => `<option value="${v}"${(s.labelPos || 'above') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`) + `<p class="muted sm">Or drag the label anywhere: select the riser, then drag its label. An arrow points back to the riser.</p>${m && m.labelOff ? '<div class="btn-row"><button type="button" class="btn sm" data-act="sk-resetlabel">Reset label position</button></div>' : ''}` : ''}<label class="check"><input type="checkbox" data-k="style.showDims"${s.showDims ? ' checked' : ''}> Show dimension lines</label>`;
}
const NAME_HINTS = ['M1', 'E1', 'H1', 'F1', 'SA-01', 'RA-01', 'EA-01', 'R1'];
function nameField(key, val, label, ph) { return field(label, `<input type="text" data-k="${key}" value="${esc(val || '')}" maxlength="40" list="sk-names" placeholder="${ph || 'e.g. M1, E1, SA-01'}" autocomplete="off"><datalist id="sk-names">${NAME_HINTS.map((n) => `<option value="${n}">`).join('')}</datalist>`); }
function sketchToolHtml(doc, tool) {
  const sh = TOOLS[tool].shape; const sc = scaleFor(doc, currentPage()); const sz = state.sketchDefaults[sh];
  return `<section class="psec"><h3>Next sketch</h3>${nameField('sketchNext', state.sketchNext, 'Name', 'Leave blank for no name')}<label class="check"><input type="checkbox" data-k="sketchAutoNum"${state.sketchAutoNum ? ' checked' : ''}> Number automatically (M1, M2, M3…)</label>${sizeFields('sz', sz, sc, true)}<p class="muted sm">Click to place at this size, or drag to draw it; the size rounds to ${isMetric(sc) ? '10 mm' : 'whole inches'}. Sizes are real dimensions, drawn at ${esc(sc.label)}.</p></section><section class="psec"><h3>Display</h3>${sketchSymbolFields(toolStyle(tool), sc)}</section>`;
}
function sketchPropsHtml(doc, m) {
  const sc = scaleForMarkup(doc, m); const L = linkOf(doc, m); const A = sketchSize(doc, m), B = sketchTrans(doc, m); const n = linkSiblings(doc, m).length;
  const nm = sketchName(doc, m);
  let h = `<div class="measure-readout"><div class="mr-val">${nm ? `<span class="mr-name">${esc(nm)}</span> ` : ''}${esc(sizeLabel(doc, m))}</div><div class="mr-sub">${esc(areaLabel(doc, m))} · drawn at ${esc(sc.label || '')}${L ? ` · on ${n} page${n > 1 ? 's' : ''}` : ''}</div></div>`;
  h += `<section class="psec">${nameField('sk.name', nm, L && n > 1 ? 'Name (every page)' : 'Name')}</section>`;
  h += `<section class="psec"><h3>${B ? 'Size below the transition' : 'Size'}</h3>${sizeFields('sz', A, sc)}<div class="field two"><div><label>Rotation (°)</label><input type="number" data-k="rot" step="1" value="${num(sketchRotDeg(doc, m), 2)}"></div><div></div></div>${L && n > 1 ? `<p class="muted sm">Changing the size here changes it on every page that uses it.</p>` : ''}</section>`;
  h += `<section class="psec"><h3>Transition</h3>${B ? `${sizeFields('tsz', B, sc)}<p class="muted sm">This page shows the change from ${esc(sizeText(A, sc))} to ${esc(sizeText(B, sc))}.${L ? ' Linked pages after this one that use the new size update with it.' : ''}</p><div class="btn-row"><button type="button" class="btn sm" data-act="sk-rmtrans">Remove transition</button></div>` : `<p class="muted sm">Show a size or shape change on this page, such as a riser that steps down from ${esc(sizeText(A, sc))}.</p><div class="btn-row"><button type="button" class="btn sm" data-act="sk-addtrans">Add transition here</button></div>`}</section>`;
  if (L) {
    const sibs = linkSiblings(doc, m).sort((a, b) => a.page - b.page);
    h += `<section class="psec"><h3>Linked set</h3><label class="check"><input type="checkbox" data-k="link.sync"${L.sync ? ' checked' : ''}> Move together on every page</label>
      <div class="link-pages">${sibs.map((x) => { const lab = doc.pages[x.page] && doc.pages[x.page].label; return `<button type="button" class="lp-chip${x.id === m.id ? ' cur' : ''}" data-act="goto-${x.id}" title="Go to page ${x.page + 1}">p.${x.page + 1}${lab && lab !== String(x.page + 1) ? ' ' + esc(lab) : ''} <span>${esc(sizeText(sketchSize(doc, x), scaleForMarkup(doc, x)))}</span>${sketchTrans(doc, x) ? '<span class="t">→</span>' : ''}</button>`; }).join('')}</div>
      <div class="btn-row"><button type="button" class="btn sm" data-act="sk-place">Place on more pages</button><button type="button" class="btn sm" data-act="sk-view">Show on all pages</button></div><div class="btn-row"><button type="button" class="btn sm" data-act="sk-unlink">Unlink this page</button><button type="button" class="btn sm danger" data-act="sk-delall">Delete on all pages</button></div></section>`;
  } else h += `<section class="psec"><h3>Linked set</h3><p class="muted sm">Place this sketch on other pages, for example every floor a riser passes through. The copies stay linked: resize one and they all change.</p><div class="btn-row"><button type="button" class="btn sm primary" data-act="sk-place">Place on pages</button></div></section>`;
  h += `<section class="psec"><h3>Display</h3>${sketchSymbolFields(m.style, sc, m)}</section>`;
  return h;
}
function applySketchProp(doc, T, k, v, live) {
  const isSize = /^(sz|tsz)\.(w|h|d|shape)$/.test(k); const isOther = k === 'rot' || k === 'link.name' || k === 'link.sync' || k === 'sk.name' || k === 'sketchNext' || k === 'sketchAutoNum';
  if (!isSize && !isOther) return false;
  if (k === 'sketchNext') { if (!live) { state.sketchNext = String(v).trim(); store.set('sketchNext', state.sketchNext); } return true; }
  if (k === 'sketchAutoNum') { state.sketchAutoNum = !!v; store.set('sketchAutoNum', state.sketchAutoNum); return true; }
  if (T.kind === 'tool') {
    if (!isSize || live) return true; const sh = TOOLS[T.tool].shape; if (!sh) return true; const f = k.split('.')[1];
    const sc = scaleFor(activeDoc(), currentPage()); const n = parseSketchDim(v, sc); if (!(n > 0)) return true; state.sketchDefaults[sh] = { ...state.sketchDefaults[sh], [f]: n }; store.set('sketchDefaults2', state.sketchDefaults); return true;
  }
  const m = T.ms && T.ms.length === 1 && T.ms[0].type === 'sketch' ? T.ms[0] : null; if (!m) return true;
  if (live) return true; // sizes apply on change or Enter
  const L = linkOf(doc, m);
  let nz = null; let which = 'size';
  if (isSize) {
    which = k.startsWith('tsz') ? 'trans' : 'size'; const f = k.split('.')[1]; const cur = which === 'trans' ? sketchTrans(doc, m) : sketchSize(doc, m); if (!cur) return true;
    if (f === 'shape') nz = v === 'circle' ? { shape: 'circle', d: cur.shape === 'circle' ? cur.d : Math.max(cur.w, cur.h) } : { shape: 'rect', w: cur.shape === 'rect' ? cur.w : cur.d, h: cur.shape === 'rect' ? cur.h : cur.d };
    else { const n = parseSketchDim(v, scaleForMarkup(doc, m)); if (!(n > 0)) { toast('Enter a size like 600, 600 mm, 0.6 m or 24"', 'error'); renderProps(); return true; } nz = { ...cur, [f]: n }; }
  }
  pushUndo(doc);
  if (k === 'link.name' || k === 'sk.name') { const nv = String(v).trim(); if (L) L.name = nv || L.name; else m.name = nv; }
  else if (k === 'link.sync') { if (L) L.sync = !!v; }
  else if (k === 'rot') setSketchRot(doc, m, +v || 0);
  else setSketchSize(doc, m, nz, which);
  linkSiblings(doc, m).forEach(touch); renderAllMarks(doc); renderList(); renderLinkedPanelSoon();
  return true;
}
function startCutout(m) { if (!m) return; state.cutoutFor = m.id; setTool('cutout'); toast('Click the corners of the cutout, then double-click or press Enter'); }
async function sketchAction(kind, m) {
  const doc = activeDoc(); if (!doc || !m) return;
  if (kind === 'place') return placeOnPagesDialog(m);
  if (kind === 'view') { state.linkOpen = m.link; openRight('linked'); return; }
  if (kind === 'resetlabel') { resetLabel(m); return; }
  if (kind === 'rmtrans') { pushUndo(doc); removeTransition(doc, m); renderAllMarks(doc); refreshPanels(); renderLinkedPanelSoon(); return; }
  if (kind === 'unlink') { pushUndo(doc); unlinkInstance(doc, m); renderAllMarks(doc); refreshPanels(); renderLinkedPanelSoon(); toast('This page is now independent of the set'); return; }
  if (kind === 'delall') { const sibs = linkSiblings(doc, m); if (!(await confirmDialog('Delete on all pages?', `Delete ${esc(sketchName(doc, m) || 'this sketch')} from all ${sibs.length} pages?`, 'Delete', true))) return; pushUndo(doc); const ids = new Set(sibs.map((x) => x.id)); doc.markups = doc.markups.filter((x) => !ids.has(x.id)); state.sel.clear(); cleanupLinks(doc); renderAllMarks(doc); refreshPanels(); renderLinkedPanelSoon(); return; }
  if (kind === 'addtrans') {
    const sc = scaleForMarkup(doc, m); const A = sketchSize(doc, m); const later = linkSiblings(doc, m).filter((x) => x.page > m.page).length;
    const r50 = (v) => (isMetric(sc) ? Math.max(50, Math.round((v * 25.4) / 50) * 50) / 25.4 : Math.max(1, Math.round(v)));
    const guess = A.shape === 'circle' ? { shape: 'circle', d: r50(A.d * 0.8) } : { shape: 'rect', w: r50(A.w * 0.75), h: A.h };
    const r = await openDialog({ title: 'Add transition', body: `<p>On this page the shape changes from <b>${esc(sizeText(A, sc))}</b> to:</p>${field('Shape', `<select name="shape" id="tr-shape"><option value="rect"${guess.shape === 'rect' ? ' selected' : ''}>Rectangle</option><option value="circle"${guess.shape === 'circle' ? ' selected' : ''}>Round</option></select>`)}<div class="field two" id="tr-rect"><div><label>Width</label><input type="text" name="w" value="${esc(dimVal(guess.w || guess.d, sc))}"></div><div><label>Height</label><input type="text" name="h" value="${esc(dimVal(guess.h || guess.d, sc))}"></div></div><div class="field two" id="tr-circ"><div><label>Diameter</label><input type="text" name="d" value="${esc(dimVal(guess.d || Math.max(guess.w, guess.h), sc))}"></div><div></div></div>${later ? `<label class="check"><input type="checkbox" name="follow" checked> Use the new size on the ${later} linked page${later > 1 ? 's' : ''} after this one</label>` : ''}`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Add transition', value: true, primary: true }],
      onOpen: (box) => { const sel = box.querySelector('#tr-shape'); const sync = () => { box.querySelector('#tr-rect').hidden = sel.value !== 'rect'; box.querySelector('#tr-circ').hidden = sel.value !== 'circle'; }; sel.onchange = sync; sync(); } });
    if (!r || !r.value) return; const f = r.form;
    const nz = f.shape === 'circle' ? { shape: 'circle', d: parseSketchDim(f.d, sc) } : { shape: 'rect', w: parseSketchDim(f.w, sc), h: parseSketchDim(f.h, sc) };
    if (Object.values(nz).some((v) => typeof v === 'number' && !(v > 0))) { toast('Enter sizes like 450, 450 mm or 18"', 'error'); return; }
    pushUndo(doc); addTransition(doc, m, !!f.follow); setSketchSize(doc, m, nz, 'trans');
    renderAllMarks(doc); refreshPanels(); renderLinkedPanelSoon(); toast(`Transition to ${sizeText(nz, sc)} added`);
  }
}
async function placeOnPagesDialog(m) {
  const doc = activeDoc(); if (!doc || !m) return; const L = linkOf(doc, m); const on = new Set(L ? linkSiblings(doc, m).map((x) => x.page) : [m.page]);
  const boxes = doc.pages.map((pg, i) => { const lab = pg.label && pg.label !== String(i + 1) ? ` · ${esc(pg.label)}` : ''; const has = on.has(i); return `<label class="${has ? 'has' : ''}"><input type="checkbox" name="p${i}"${has ? ' checked disabled' : ''}> Page ${i + 1}${lab}${has ? ' (on it)' : ''}</label>`; }).join('');
  const r = await openDialog({ title: 'Place on pages', wide: true, body: `<p>Copies go to the same spot on each page and stay linked to <b>${esc(L ? L.name : 'this sketch')}</b>: resize or move one and every copy follows.</p><div class="btn-row"><button type="button" class="btn sm" id="pp-all">Select all</button><button type="button" class="btn sm" id="pp-none">Clear</button></div><div class="page-pick">${boxes}</div>${m.transKey || m.tsz ? '<p class="muted sm">Pages after this one get the size after the transition.</p>' : ''}`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Place', value: true, primary: true }],
    onOpen: (box) => { box.querySelector('#pp-all').onclick = () => box.querySelectorAll('.page-pick input:not(:disabled)').forEach((c) => { c.checked = true; }); box.querySelector('#pp-none').onclick = () => box.querySelectorAll('.page-pick input:not(:disabled)').forEach((c) => { c.checked = false; }); } });
  if (!r || !r.value) return; const pages = Object.entries(r.form).filter(([k, v]) => /^p\d+$/.test(k) && v === true).map(([k]) => +k.slice(1)).filter((p) => !on.has(p));
  if (!pages.length) { toast('No new pages chosen'); return; }
  pushUndo(doc); const made = placeOnPages(doc, m, pages); renderAllMarks(doc); refreshPanels(); state.linkOpen = m.link; openRight('linked');
  toast(`${linkOf(doc, m).name} placed on ${made.length} more page${made.length > 1 ? 's' : ''}`);
}

function leOptions(cur) { return LINE_ENDS.map(([v, l]) => `<option value="${v}"${(cur || 'none') === v ? ' selected' : ''}>${l}</option>`).join(''); }
