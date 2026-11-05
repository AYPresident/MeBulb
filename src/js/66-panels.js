// ===== Right panels: measurements (scales, viewports, grid) and linked sketches ==
function renderMeasurePanel() {
  const el = $('#measure-panel'); if (!el) return; const doc = activeDoc();
  if (!doc) { el.innerHTML = '<p class="muted pad">Open a PDF to manage scales.</p>'; return; }
  const i = currentPage(); const sc = scaleFor(doc, i); const vps = (doc.viewports && doc.viewports[i]) || [];
  const gridOpts = metricPref() ? [1, 2, 5, 10, 20, 50].map((mm) => [mm / 25.4, `${mm} mm`]) : [[1 / 16, '1/16"'], [1 / 8, '1/8"'], [1 / 4, '1/4"'], [1 / 2, '1/2"'], [1, '1"'], [2, '2"']];
  if (!gridOpts.some(([v]) => Math.abs(v - state.gridSize) < 1e-6)) gridOpts.push([state.gridSize, metricPref() ? `${num(state.gridSize * 25.4, 2)} mm` : `${num(state.gridSize, 3)}"`]);
  const A = doc.align; const refPg = A ? A.ref : 0;
  el.innerHTML = `<section class="psec"><h3>Units</h3><div class="seg" role="radiogroup" aria-label="Units">${[['m', 'Metres'], ['mm', 'Millimetres'], ['ftin', 'Feet-inches']].map(([v, l]) => `<label><input type="radio" name="units" data-ma="units" value="${v}"${state.units === v ? ' checked' : ''}> ${l}</label>`).join('')}</div><p class="muted sm">${state.units === 'ftin' ? 'Areas in square feet, sketch sizes in inches.' : 'Areas in m², volumes in m³, sketch sizes in mm.'}</p></section>
    <section class="psec"><h3>Page ${i + 1} scale</h3><div class="scale-card${sc.unset ? ' unset' : ''}"><div class="sc-label">${esc(sc.label || 'Custom')}</div><div class="sc-sub">${sc.unset ? 'Measurements read at paper size until you set a scale.' : metricPref() ? `10 mm on paper = ${esc(fmtLen((10 / 25.4) * 72, sc))}` : `1 in on paper = ${esc(fmtLen(72, sc))}`}</div></div>
      <div class="btn-row"><button class="btn sm primary" data-ma="scale">Set scale</button><button class="btn sm" data-ma="calibrate">Calibrate</button></div></section>
    <section class="psec"><h3>Page alignment</h3><div class="align-card${isAligned(doc, i) ? ' on' : ''}"><div class="sc-label">${esc(alignSummary(doc, i))}</div><div class="sc-sub">${A ? `Reference: page ${refPg + 1} · ${Object.keys(A.T || {}).length} page${Object.keys(A.T || {}).length === 1 ? '' : 's'} aligned` : 'Line sheets up on their grid so linked risers land on the same grid position on every floor.'}</div></div>
      <div class="btn-row"><button class="btn sm primary" data-ma="align-auto">Align pages…</button><button class="btn sm" data-ma="align-pick"${A && A.ref === i ? ' disabled' : ''}>Align by points</button>${A ? `<button class="btn sm" data-ma="align-cmp"${A.ref === i ? ' disabled' : ''}>Check overlay</button><button class="btn sm" data-ma="align-clear">Clear</button>` : ''}</div>
      <p class="muted sm">No grid on the drawings? Mark the same places on every page:</p><div class="btn-row"><button class="btn sm" data-ma="ref-pt">${icon('refpt')} Reference point</button><button class="btn sm" data-ma="ref-grid">${icon('gridline')} Grid line</button><button class="btn sm" data-ma="ref-copy"${doc.markups.some((m) => m.page === i && REF_TYPES.has(m.type)) ? '' : ' disabled'}>Copy to pages…</button></div></section>
    <section class="psec"><h3>Viewports on this page</h3>${vps.length ? '' : '<p class="muted sm">A viewport gives part of a sheet its own scale, for details and enlarged plans. Measurements that start inside it use that scale.</p>'}</section>
    ${vps.map((v) => `<div class="vp-row" data-vp="${v.id}"><div class="vp-main"><div class="vp-name">${esc(v.name)}</div><div class="vp-sub">${esc(v.scale.label || '')}</div></div><button class="icon-btn sm" data-ma="vp-scale" title="Change scale" aria-label="Change scale of ${esc(v.name)}">${icon('scale')}</button><button class="icon-btn sm" data-ma="vp-zoom" title="Zoom to" aria-label="Zoom to ${esc(v.name)}">${icon('zoombox')}</button><button class="icon-btn sm danger" data-ma="vp-del" title="Delete" aria-label="Delete ${esc(v.name)}">${icon('trash')}</button></div>`).join('')}
    <section class="psec"><div class="btn-row"><button class="btn sm" data-ma="vp-add">${icon('viewport')} Add viewport</button></div><label class="check"><input type="checkbox" data-ma="vp-show"${state.showViewports ? ' checked' : ''}> Show viewport outlines</label></section>
    <section class="psec"><h3>Grid</h3><div class="field two"><div><label>Spacing on paper</label><select data-ma="grid-size">${gridOpts.map(([v, l]) => `<option value="${v}"${Math.abs(v - state.gridSize) < 1e-6 ? ' selected' : ''}>${l}</option>`).join('')}</select></div><div><label>Real spacing</label><div class="note-box">${esc(fmtLen(state.gridSize * 72, sc))}</div></div></div>
      <label class="check"><input type="checkbox" data-ma="tog-showGrid"${state.showGrid ? ' checked' : ''}> Show grid</label><label class="check"><input type="checkbox" data-ma="tog-snapGrid"${state.snapGrid ? ' checked' : ''}> Snap to grid</label></section>
    <section class="psec"><h3>Snapping</h3><label class="check"><input type="checkbox" data-ma="tog-snapContent"${state.snapContent ? ' checked' : ''}> Snap to drawing linework</label><label class="check"><input type="checkbox" data-ma="tog-snapMarkup"${state.snapMarkup ? ' checked' : ''}> Snap to markup points</label>${contentStatus(doc, i)}</section>`;
  applyCollapsed(el);
}
function contentStatus(doc, i) { const g = doc.geo && doc.geo[i]; if (!state.snapContent) return ''; if (!g) return '<p class="muted sm">Linework is read when you start drawing on a page.</p>'; if (g.pending) return '<p class="muted sm">Reading this page’s linework…</p>'; return `<p class="muted sm">${g.n.toLocaleString()} line segments indexed on this page${g.n ? ' (endpoints, midpoints, intersections and lines)' : '. This page may be a scan; run OCR for its text.'}</p>`; }
function bindMeasurePanel() {
  const el = $('#measure-panel');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ma]'); if (!b || b.tagName === 'SELECT' || b.type === 'checkbox') return; const doc = activeDoc(); const i = currentPage(); const a = b.dataset.ma;
    const row = b.closest('.vp-row'); const v = row && (doc.viewports[i] || []).find((x) => x.id === row.dataset.vp);
    if (a === 'scale') scaleDialog(i); else if (a === 'calibrate') setTool('calibrate'); else if (a === 'vp-add') setTool('viewport');
    else if (a === 'ref-pt') setTool('refpt'); else if (a === 'ref-grid') setTool('gridline'); else if (a === 'ref-copy') copyRefMarksDialog();
    else if (a === 'align-auto') autoAlignDialog(); else if (a === 'align-pick') startAlignPick(i); else if (a === 'align-clear') clearAlignment(); else if (a === 'align-cmp') compareOverlay(doc, doc.align.ref, doc, i, true);
    else if (a === 'vp-scale' && v) scaleDialog(i, v);
    else if (a === 'vp-zoom' && v) zoomToBox(i, { x: v.x, y: v.y, w: v.w, h: v.h });
    else if (a === 'vp-del' && v) { pushUndo(doc); doc.viewports[i] = doc.viewports[i].filter((x) => x !== v); renderAllMarks(doc); renderMeasurePanel(); refreshPanels(); }
  });
  el.addEventListener('change', (e) => {
    const t = e.target; const a = t.dataset.ma; if (!a) return;
    if (a === 'vp-show') { state.showViewports = t.checked; renderAllMarks(); }
    else if (a === 'grid-size') { state.gridSize = +t.value; store.set('gridSize2', state.gridSize); renderAllMarks(); renderMeasurePanel(); }
    else if (a === 'units') setUnits(t.value);
    else if (a.startsWith('tog-')) { const k = a.slice(4); if (!!state[k] !== t.checked) toggleAid(k); renderMeasurePanel(); }
  });
}
// switch the unit system; the open document's scales switch their display units too
function setUnits(u) {
  if (!['m', 'mm', 'ftin'].includes(u)) return; const was = metricPref(); state.units = u; store.set('units', u);
  const doc = activeDoc(); const disp = u === 'ftin' ? { unit: 'ft', fmt: 'ftin', prec: 16 } : metricDisp();
  if (doc) { const sc = Object.values(doc.scales || {}); const vps = Object.values(doc.viewports || {}).flat().map((v) => v.scale); if (sc.length || vps.length) { pushUndo(doc); sc.concat(vps).forEach((x) => Object.assign(x, disp)); } }
  if (was !== metricPref()) { state.sketchDefaults = sketchDefaultsFor(metricPref()); store.set('sketchDefaults2', state.sketchDefaults); state.gridSize = metricPref() ? 5 / 25.4 : 0.25; store.set('gridSize2', state.gridSize); }
  renderAllMarks(); refreshPanels(); updatePageUI(); renderMeasurePanel(); toast(`Units: ${{ m: 'metres', mm: 'millimetres', ftin: 'feet and inches' }[u]}`);
}
async function viewportDialog(page, b) {
  const doc = activeDoc(); const n = ((doc.viewports && doc.viewports[page]) || []).length + 1; const cur = scaleFor(doc, page);
  const presetOpts = SCALE_PRESETS.map((g) => `<optgroup label="${g.group}">${g.items.map(([l]) => `<option>${esc(l)}</option>`).join('')}</optgroup>`).join('');
  const r = await openDialog({ title: 'New viewport', body: `${field('Name', `<input type="text" name="name" value="Detail ${n}" maxlength="40">`)}${field('Scale inside this viewport', `<select name="preset" id="vp-preset">${presetOpts}</select>`)}<p class="muted sm">You can also calibrate inside the viewport afterwards: measurements that start inside it use its scale.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add viewport', value: true, primary: true }], onOpen: (box) => { const s = box.querySelector('#vp-preset'); s.value = cur.unset ? (metricPref() ? '1:20' : '1/2" = 1\'-0"') : cur.label; if (!s.value) s.value = metricPref() ? '1:20' : '1/2" = 1\'-0"'; } });
  if (!r || !r.value) return; const sc = { ...presetScale(r.form.preset), label: r.form.preset };
  pushUndo(doc); doc.viewports = doc.viewports || {}; (doc.viewports[page] = doc.viewports[page] || []).push({ id: uid('VP'), name: r.form.name.trim() || `Detail ${n}`, x: b.x, y: b.y, w: b.w, h: b.h, scale: sc });
  renderAllMarks(doc); refreshPanels(); openRight('measure'); toast(`Viewport added at ${sc.label}`);
}

// ----- linked sketches (risers) -----------------------------------------------------------
const renderLinkedPanelSoon = debounce(() => { if (rightShown('linked')) renderLinkedPanel(); }, 120);
const _cropCache = new Map();
function renderLinkedPanel() {
  const el = $('#linked-panel'); if (!el) return; const doc = activeDoc();
  if (!doc) { el.innerHTML = '<p class="muted pad">Open a PDF to see linked sketches.</p>'; return; }
  cleanupLinks(doc); const links = Object.values(doc.links || {});
  if (!links.length) {
    el.innerHTML = `<div class="empty-pane"><p><b>Linked sketches</b> are rectangles or circles drawn to scale that appear on several pages, like a duct riser passing through every floor.</p><p>Draw one with <b>Sketch rectangle</b> or <b>Sketch circle</b>, then choose <b>Place on pages</b>. Resize it on any page and every page updates. Add a <b>transition</b> where the size or shape changes.</p><div class="btn-row"><button class="btn sm" data-lk="tool-sketchrect">${icon('sketchrect')} Sketch rectangle</button><button class="btn sm" data-lk="tool-sketchcircle">${icon('sketchcircle')} Sketch circle</button></div></div>`;
    return;
  }
  const selM = oneSketch(); if (selM && selM.link) state.linkOpen = selM.link; if (!state.linkOpen || !doc.links[state.linkOpen]) state.linkOpen = links[0].id;
  el.innerHTML = links.map((L) => {
    const inst = doc.markups.filter((x) => x.link === L.id).sort((a, b) => a.page - b.page); const first = inst[0]; const sc0 = first ? scaleForMarkup(doc, first) : DEFAULT_SCALE;
    const sizes = [...new Set(inst.flatMap((x) => [sizeText(sketchSize(doc, x), sc0)].concat(sketchTrans(doc, x) ? [sizeText(sketchTrans(doc, x), sc0)] : [])))];
    const col = first ? first.style.stroke : '#1f5fd1'; const shape = first && sketchSize(doc, first).shape === 'circle' ? 'sketchcircle' : 'sketchrect'; const open = state.linkOpen === L.id;
    return `<div class="lk-card${open ? ' on' : ''}" data-link="${L.id}"><div class="lk-head" data-lk="toggle"><span class="lk-swatch" style="--c:${esc(col)}">${icon(shape)}</span><div class="lk-main"><div class="lk-name">${esc(L.name)}</div><div class="lk-sub">${esc(sizes.join(' → '))} · ${inst.length} page${inst.length > 1 ? 's' : ''}</div></div></div>
      ${open ? `<div class="lk-grid">${inst.map((x) => { const lab = doc.pages[x.page].label; const sc = scaleForMarkup(doc, x); return `<button class="lk-view${state.sel.has(x.id) ? ' cur' : ''}${state.lkPick && state.lkPick.has(x.id) ? ' pick' : ''}" data-lk="goto" data-id="${x.id}" title="Go to page ${x.page + 1} · Ctrl+click to pick several pages" aria-pressed="${!!(state.lkPick && state.lkPick.has(x.id))}"><div class="lk-crop" data-crop="${x.id}"></div><div class="lk-cap"><b>p.${x.page + 1}${lab && lab !== String(x.page + 1) ? ' ' + esc(lab) : ''}</b><span${sketchTrans(doc, x) ? ' class="t"' : ''}>${esc(sketchTrans(doc, x) ? sizeText(sketchSize(doc, x), sc) + '→' + sizeText(sketchTrans(doc, x), sc) : sizeText(sketchSize(doc, x), sc))}</span></div></button>`; }).join('')}</div>
      ${(() => { const n = inst.filter((x) => state.lkPick && state.lkPick.has(x.id)).length; return n ? `<div class="lk-pickbar pad"><b>${n} page${n === 1 ? '' : 's'} picked</b><button class="btn sm" data-lk="unlinkpick">Unlink</button><button class="btn sm danger" data-lk="rmpick">Remove from ${n === 1 ? 'page' : 'these pages'}</button><button class="btn sm" data-lk="clearpick">Clear</button></div>` : '<p class="muted sm pad" style="margin:0;padding-top:0">Ctrl+click pages to pick several, then unlink them or take the sketch off them.</p>'; })()}
      <div class="btn-row pad" style="padding-top:0"><button class="btn sm" data-lk="place" data-id="${first ? first.id : ''}">Place on more pages</button><button class="btn sm" data-lk="choose" data-id="${first ? first.id : ''}">Choose pages…</button><button class="btn sm" data-lk="selall">Select on this page</button></div>` : ''}</div>`;
  }).join('');
  drawCrops(doc);
}
async function drawCrops(doc) {
  const slots = $$('#linked-panel [data-crop]'); const token = (drawCrops._t = {});
  for (const slot of slots) {
    if (drawCrops._t !== token) return; const m = getMarkup(slot.dataset.crop, doc); if (!m) continue;
    const b = sketchBBox(m, doc); const c = m.pts[0]; const R = Math.max(b.w, b.h) * 1.6 + 36; const box = { x: c[0] - R, y: c[1] - R, w: 2 * R, h: 2 * R };
    const px = 240; const key = `${m.page}|${doc.pdfVer}|${Math.round(box.x)}|${Math.round(box.y)}|${Math.round(R)}`;
    let img = _cropCache.get(key);
    if (!img) {
      try {
        const page = await doc.pdf.getPage(m.page + 1); const s = px / box.w; const vp = page.getViewport({ scale: s, rotation: page.rotate }); const cv = document.createElement('canvas'); cv.width = px; cv.height = px;
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px); await hideOwnAnnots(doc, m.page); await page.render({ canvasContext: ctx, canvas: cv, viewport: vp, intent: 'print', annotationMode: annotMode(doc), transform: [1, 0, 0, 1, -box.x * s, -box.y * s] }).promise; img = cv.toDataURL('image/jpeg', 0.85); _cropCache.set(key, img);
        if (_cropCache.size > 120) _cropCache.delete(_cropCache.keys().next().value);
      } catch (e) { continue; }
    }
    if (!slot.isConnected) continue;
    slot.innerHTML = `<img src="${img}" alt="" style="position:absolute;inset:0;width:100%;height:100%"><svg viewBox="${num(box.x, 2)} ${num(box.y, 2)} ${num(box.w, 2)} ${num(box.h, 2)}" xmlns="http://www.w3.org/2000/svg">${markupSvg(m, doc, { noHit: true })}</svg>`;
  }
}
// take a linked sketch off some pages, or make those pages independent of the set
async function linkedPagesAction(doc, ms, what) {
  if (!ms.length) return; const L = linkOf(doc, ms[0]); const all = L ? doc.markups.filter((x) => x.link === L.id) : ms;
  if (what === 'remove' && ms.length >= all.length && !(await confirmDialog('Remove from every page?', `That takes ${esc(L ? L.name : 'the sketch')} off all ${all.length} pages.`, 'Remove', true))) return;
  pushUndo(doc); const ids = new Set(ms.map((m) => m.id));
  if (what === 'remove') { doc.markups = doc.markups.filter((x) => !ids.has(x.id)); ids.forEach((id) => state.sel.delete(id)); }
  else ms.forEach((m) => unlinkInstance(doc, m));
  cleanupLinks(doc); ms.forEach(touch); renderAllMarks(doc); refreshPanels(); renderLinkedPanel(); refreshSelection();
  const pg = ms.map((m) => m.page + 1).sort((a, b) => a - b).join(', ');
  toast(what === 'remove' ? `${L ? L.name : 'Sketch'} removed from page${ms.length === 1 ? '' : 's'} ${pg}` : `Page${ms.length === 1 ? '' : 's'} ${pg} unlinked: ${ms.length === 1 ? 'it is now a separate sketch' : 'they are now separate sketches'}`);
}
async function chooseLinkedPagesDialog(m) {
  const doc = activeDoc(); const L = linkOf(doc, m); if (!L) { toast('This sketch is only on one page'); return; }
  const inst = doc.markups.filter((x) => x.link === L.id).sort((a, b) => a.page - b.page);
  const rows = inst.map((x) => { const lab = doc.pages[x.page] && doc.pages[x.page].label; return `<label class="check"><input type="checkbox" name="i_${x.id}"> Page ${x.page + 1}${lab && lab !== String(x.page + 1) ? ` · ${esc(lab)}` : ''}</label>`; }).join('');
  const r = await openDialog({ title: `${esc(L.name)}: choose pages`, body: `<p>Tick the pages to change. Useful when a floor is split over two sheets and the riser belongs on only one of them.</p><div class="page-picks">${rows}</div>${field('Do this', '<select name="what"><option value="remove">Take the sketch off the ticked pages</option><option value="unlink">Unlink the ticked pages (keep them as separate sketches)</option></select>')}`, buttons: [{ label: 'Cancel', value: false }, { label: 'Apply', value: true, primary: true }] });
  if (!r || !r.value) return; const ms = inst.filter((x) => r.form['i_' + x.id]); if (!ms.length) { toast('No pages ticked'); return; }
  linkedPagesAction(doc, ms, r.form.what === 'unlink' ? 'unlink' : 'remove');
}
function bindLinkedPanel() {
  $('#linked-panel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lk]'); if (!b) return; const doc = activeDoc(); const a = b.dataset.lk; const card = b.closest('.lk-card');
    if (a.startsWith('tool-')) { setTool(a.slice(5)); return; }
    if (a === 'toggle') { state.linkOpen = state.linkOpen === card.dataset.link ? null : card.dataset.link; renderLinkedPanel(); return; }
    if (a === 'goto' && (e.ctrlKey || e.metaKey || e.shiftKey)) { // pick several pages
      const id = b.dataset.id; let pick = state.lkPick;
      if (!pick || !pick.size) { // start from the page already clicked (or selected) so it counts too
        pick = state.lkPick = new Set();
        const cur = card ? [...card.querySelectorAll('[data-lk="goto"]')].map((x) => x.dataset.id).filter((x) => state.sel.has(x)) : [];
        cur.forEach((x) => { if (x !== id) pick.add(x); });
        if (cur.length && !cur.includes(state.lkPickLast)) state.lkPickLast = cur[0];
      }
      if (e.shiftKey && state.lkPickLast && card) { const ids = [...card.querySelectorAll('[data-lk="goto"]')].map((x) => x.dataset.id); const i0 = ids.indexOf(state.lkPickLast), i1 = ids.indexOf(id); if (i0 >= 0 && i1 >= 0) ids.slice(Math.min(i0, i1), Math.max(i0, i1) + 1).forEach((x) => pick.add(x)); }
      else if (pick.has(id)) pick.delete(id); else pick.add(id);
      state.lkPickLast = id; renderLinkedPanel(); return;
    }
    if (a === 'clearpick') { state.lkPick = null; renderLinkedPanel(); return; }
    if (a === 'unlinkpick' || a === 'rmpick') { const ms = [...(state.lkPick || [])].map((id) => getMarkup(id)).filter((m) => m && m.link === card.dataset.link); state.lkPick = null; linkedPagesAction(doc, ms, a === 'rmpick' ? 'remove' : 'unlink'); return; }
    if (a === 'choose') { const m = getMarkup(b.dataset.id); if (m) chooseLinkedPagesDialog(m); return; }
    if (a === 'goto') { state.lkPick = null; state.lkPickLast = b.dataset.id; const m = getMarkup(b.dataset.id); if (!m) return; setTool('select'); state.sel.clear(); state.sel.add(m.id); goToPage(m.page, m.pts[0]); refreshSelection(); renderLinkedPanel(); return; }
    if (a === 'place') { const m = getMarkup(b.dataset.id); if (m) placeOnPagesDialog(m); return; }
    if (a === 'selall') { const p = currentPage(); const ids = doc.markups.filter((x) => x.link === card.dataset.link && x.page === p).map((x) => x.id); if (!ids.length) { toast('This set is not on the current page'); return; } setTool('select'); state.sel = new Set(ids); refreshSelection(); }
  });
}
