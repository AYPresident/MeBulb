// ===== Dialogs: scale, calibrate, extract, compare, help, image ==============
const PT_PER = { in: 72, mm: 72 / 25.4, cm: 72 / 2.54 };
function displayFields(sc) {
  const units = ['m', 'mm', 'cm', 'ft', 'in', 'yd'];
  return `<div class="field three"><div><label>Show in</label><select name="unit" id="dlg-unit">${units.map((u) => `<option value="${u}"${sc.unit === u ? ' selected' : ''}>${UNITS[u].label}</option>`).join('')}</select></div>
  <div><label>Format</label><select name="fmt" id="dlg-fmt"><option value="ftin"${sc.fmt === 'ftin' ? ' selected' : ''}>Feet-inches</option><option value="dec"${sc.fmt !== 'ftin' ? ' selected' : ''}>Decimal</option></select></div>
  <div><label>Precision</label><select name="prec" id="dlg-prec"></select></div></div>`;
}
function wireDisplayFields(box, sc) {
  const u = box.querySelector('#dlg-unit'), f = box.querySelector('#dlg-fmt'), p = box.querySelector('#dlg-prec');
  const fill = (keep) => {
    const ftin = u.value === 'ft' && f.value === 'ftin'; f.disabled = u.value !== 'ft';
    const opts = ftin ? [[2, '1/2"'], [4, '1/4"'], [8, '1/8"'], [16, '1/16"'], [32, '1/32"']] : [[0, '1'], [1, '0.1'], [2, '0.01'], [3, '0.001']];
    p.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join(''); p.value = keep != null && opts.some((o) => o[0] == keep) ? keep : ftin ? 16 : 2;
  };
  u.onchange = () => fill(); f.onchange = () => fill(); fill(sc.prec);
}
function readDisplay(form) { const unit = form.unit; const fmt = unit === 'ft' ? form.fmt : 'dec'; return { unit, fmt, prec: +form.prec }; }
function applyScale(pageIdxs, sc, vp) {
  const doc = activeDoc(); pushUndo(doc);
  if (vp) { vp.scale = { ...sc }; renderAllMarks(doc); refreshPanels(); updatePageUI(); toast(`Viewport ${vp.name} set to ${sc.label}`); return; }
  pageIdxs.forEach((i) => { doc.scales[i] = { ...sc }; });
  renderAllMarks(doc); refreshPanels(); updatePageUI(); toast(`Scale set to ${sc.label} on ${pageIdxs.length === 1 ? 'page ' + (pageIdxs[0] + 1) : 'all ' + pageIdxs.length + ' pages'}`);
}

async function scaleDialog(page, vp) {
  const doc = activeDoc(); if (!doc) return; const cur = vp ? vp.scale : scaleFor(doc, page);
  const presetOpts = SCALE_PRESETS.map((g) => `<optgroup label="${g.group}">${g.items.map(([l]) => `<option${cur.label === l ? ' selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`).join('');
  const r = await openDialog({
    title: vp ? `Viewport scale · ${vp.name}` : `Page scale · page ${page + 1}`,
    body: `${field('Scale', `<select name="preset" id="dlg-preset"><option value="__custom">Custom…</option>${presetOpts}</select>`)}
      <div class="field custom-scale" id="dlg-custom"><label>Custom ratio</label><div class="ratio"><input type="number" name="pv" value="1" min="0" step="any" aria-label="Paper length"><select name="pu">${(metricPref() ? ['mm', 'cm', 'in'] : ['in', 'mm', 'cm']).map((u) => `<option value="${u}">${u}</option>`).join('')}</select><span>=</span><input type="number" name="rv" value="${metricPref() ? 100 : 8}" min="0" step="any" aria-label="Real length"><select name="ru">${(metricPref() ? ['mm', 'm', 'cm', 'ft', 'in', 'yd'] : ['ft', 'in', 'yd', 'm', 'cm', 'mm']).map((u) => `<option>${u}</option>`).join('')}</select></div></div>
      ${displayFields(cur.unset ? unsetDisp() : cur)}
      ${vp ? '' : `<div class="field"><label>Apply to</label><div class="seg"><label><input type="radio" name="apply" value="page" checked> This page</label><label><input type="radio" name="apply" value="all"> All ${doc.numPages} pages</label></div></div>`}`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Apply scale', value: true, primary: true }],
    onOpen: (box) => {
      const sel = box.querySelector('#dlg-preset'); const custom = box.querySelector('#dlg-custom');
      if (cur.unset || !SCALE_PRESETS.some((g) => g.items.some(([l]) => l === cur.label))) sel.value = cur.unset ? DEFAULT_PRESET() : '__custom';
      wireDisplayFields(box, cur.unset ? unsetDisp() : cur);
      const sync = () => { custom.hidden = sel.value !== '__custom'; if (sel.value !== '__custom') { const p = presetScale(sel.value); box.querySelector('#dlg-unit').value = p.unit; box.querySelector('#dlg-fmt').value = p.fmt; box.querySelector('#dlg-unit').onchange(); box.querySelector('#dlg-prec').value = p.prec; } };
      sel.onchange = sync; custom.hidden = sel.value !== '__custom'; if (cur.unset) sync();
    },
  });
  if (!r || !r.value) return; const f = r.form; const disp = readDisplay(f); let sc;
  if (f.preset !== '__custom') sc = { ...presetScale(f.preset), ...disp, label: f.preset };
  else {
    const pv = parseFloat(f.pv), rv = parseFloat(f.rv); if (!(pv > 0 && rv > 0)) { toast('Enter two positive numbers for a custom scale', 'error'); return; }
    const inPerPt = rv / UNITS[f.ru].perIn / (pv * PT_PER[f.pu]); const pl = f.pu === 'in' ? `${num(pv, 4)}"` : `${num(pv, 4)} ${f.pu}`; const rl = f.ru === 'ft' ? `${num(rv, 4)}'` : f.ru === 'in' ? `${num(rv, 4)}"` : `${num(rv, 4)} ${f.ru}`;
    sc = { inPerPt, ...disp, label: `${pl} = ${rl}` };
  }
  applyScale(f.apply === 'all' ? [...Array(doc.numPages).keys()] : [page], sc, vp);
}

function unsetDisp() { return metricPref() ? metricDisp() : { unit: 'ft', fmt: 'ftin', prec: 16 }; }
async function calibrateDialog(page, lenPts, mid) {
  const doc = activeDoc(); const vp = viewportAt(doc, page, mid); const cur = vp ? vp.scale : scaleFor(doc, page); const base = cur.unset ? unsetDisp() : cur;
  const r = await openDialog({
    title: 'Calibrate scale',
    body: `<p>The line you drew is <b>${metricPref() ? `${num((lenPts / 72) * 25.4, 1)} mm` : `${num(lenPts / 72, 3)} in`}</b> long on paper${cur.unset ? '' : `, which currently reads <b>${esc(fmtLen(lenPts, cur))}</b>`}.</p>
      ${field('Its real length', `<div class="ratio"><input type="text" name="len" placeholder="${metricPref() ? 'e.g. 3600 or 3.6' : 'e.g. 20\' or 12\'-6&quot; or 6.5'}" required><select name="lu">${['m', 'mm', 'cm', 'ft', 'in', 'yd'].map((u) => `<option${u === base.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></div>`)}
      ${displayFields(base)}
      <div class="field"><label>Apply to</label><div class="seg">${vp ? `<label><input type="radio" name="apply" value="vp" checked> Viewport “${esc(vp.name)}”</label>` : ''}<label><input type="radio" name="apply" value="page"${vp ? '' : ' checked'}> This page</label><label><input type="radio" name="apply" value="all"> All ${doc.numPages} pages</label></div></div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Calibrate', value: true, primary: true }],
    onOpen: (box) => { wireDisplayFields(box, base); const lu = box.querySelector('[name=lu]'); lu.onchange = () => { const u = box.querySelector('#dlg-unit'); u.value = lu.value; u.onchange(); }; },
  });
  toolDone();
  if (!r || !r.value) return; const f = r.form; const v = parseLength(f.len, f.lu);
  if (!(v > 0)) { toast('Enter the real length, for example 3600 mm or 3.6 m', 'error'); return; }
  const inPerPt = v / UNITS[f.lu].perIn / lenPts; const disp = readDisplay(f);
  const sc = { inPerPt, ...disp, label: `Calibrated (${f.len.trim()}${/[a-z'"]$/i.test(f.len.trim()) ? '' : ' ' + f.lu})` };
  applyScale(f.apply === 'all' ? [...Array(doc.numPages).keys()] : [page], sc, f.apply === 'vp' ? vp : null);
}

async function extractDialog() {
  const doc = activeDoc(); if (!doc) return; const cur = state.thumbSel + 1;
  const r = await openDialog({ title: 'Extract pages', body: `${field('Pages', `<input type="text" name="range" value="${cur}" placeholder="e.g. 1-3, 5">`)}<p class="muted">The pages and their markups open as a new document you can save separately.</p>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Extract', value: true, primary: true }] });
  if (!r || !r.value) return; const idxs = parseRange(r.form.range, doc.numPages); if (!idxs.length) { toast('Enter page numbers like 1-3, 5', 'error'); return; }
  await extractPages(idxs);
}

function helpDialog() {
  const rows = [
    ['Tools', ''], ['V', 'Select'], ['H or hold Space', 'Pan'], ['T / Q / N', 'Text box / Callout / Note'], ['P / I', 'Pen / Highlighter (drag across PDF text to highlight it)'], ['U', 'Strikethrough or underline PDF text'], ['L / A', 'Line / Arrow'], ['R / E', 'Rectangle / Ellipse'], ['G / Y / K', 'Polygon / Polyline / Cloud'], ['S', 'Stamp'],
    ['Measure', ''], ['Shift+K', 'Calibrate'], ['Shift+W', 'Viewport (area with its own scale)'], ['M / Shift+M', 'Length / Polylength'], ['Shift+A / Shift+P', 'Area / Perimeter'], ['Shift+V', 'Volume'], ['Shift+C', 'Count'], ['Shift+G / Shift+R', 'Angle / Radius'],
    ['Sketch & edit', ''], ['B / O', 'Sketch rectangle / circle to scale'], ['Type a number', 'With a sketch tool active: enter its size'], ['X', 'Edit PDF text'], ['Z', 'Zoom to area'],
    ['Text formatting (while typing)', ''], ['Ctrl+B / I / U', 'Bold / Italic / Underline'], ['Ctrl+Shift+X', 'Strikethrough'], ['Ctrl+Shift+= / Ctrl+=', 'Superscript / Subscript'],
    ['Drawing', ''], ['Click, click, double-click', 'Multi-point shapes (Enter also finishes)'], ['Backspace', 'Remove last point while drawing'], ['Shift', 'Snap to 45°, square, or circle'], ['Esc', 'Cancel drawing, then return to Select'], ['Double-click a tool', 'Keep that tool active'],
    ['Editing', ''], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+C / X / V / D', 'Copy / Cut / Paste / Duplicate'], ['Delete', 'Delete selection'], ['Arrow keys', 'Nudge (Shift for 10 pt)'], ['Ctrl+A', 'Select all on page'], ['Double-click text', 'Edit text'],
    ['View & file', ''], ['Ctrl+scroll or pinch', 'Zoom at cursor'], ['Ctrl+0', 'Fit width'], ['Page Up / Down', 'Previous / next page'], ['Ctrl+F', 'Search text'], ['Ctrl+O', 'Open PDF'], ['Ctrl+S / Ctrl+Shift+S', 'Save / Save flattened copy'],
  ];
  openDialog({ title: 'Keyboard shortcuts', wide: true, body: `<div class="keys">${rows.map(([k, v]) => (v ? `<div class="krow"><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>` : `<h4>${esc(k)}</h4>`)).join('')}</div><p class="muted">On a Mac, use ⌘ in place of Ctrl.</p>`, buttons: [{ label: 'Done', value: true, primary: true }] });
}

// ----- image markup ---------------------------------------------------------------------------
async function insertImageFile(file) {
  const doc = activeDoc(); if (!doc || !file) { setTool('select'); return; }
  const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Unsupported image')); im.src = url; });
  let src = url;
  if (!/^data:image\/(png|jpe?g)/i.test(url) || img.naturalWidth > 2400 || img.naturalHeight > 2400) {
    const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight)); const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); src = c.toDataURL(/jpe?g/i.test(file.type) ? 'image/jpeg' : 'image/png', 0.9);
  }
  const i = currentPage(); const pg = doc.pages[i]; const w0 = Math.min(pg.w * 0.35, img.naturalWidth), h0 = (w0 * img.naturalHeight) / img.naturalWidth;
  const vr = V.el.getBoundingClientRect(); const el = doc.pageEls[i].getBoundingClientRect();
  const cx = clamp((vr.left + vr.width / 2 - el.left) / doc.zoom, w0 / 2, pg.w - w0 / 2), cy = clamp((vr.top + vr.height / 2 - el.top) / doc.zoom, h0 / 2, pg.h - h0 / 2);
  const m = newMarkup('image', i, [[cx - w0 / 2, cy - h0 / 2], [cx + w0 / 2, cy + h0 / 2]], { src, imgW: img.naturalWidth, imgH: img.naturalHeight, subject: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Image' });
  setTool('select', { noPick: true }); addMarkup(m); state.sel.clear(); state.sel.add(m.id); refreshSelection();
  toast('Image placed. Drag a corner to resize; hold Shift to keep its proportions.');
}

// ----- overlay compare --------------------------------------------------------------------------
async function compareDialog() {
  const docs = state.docs; if (!docs.length) return; const a = activeDoc();
  const docOpts = (sel) => docs.map((d) => `<option value="${d.id}"${d.id === sel ? ' selected' : ''}>${esc(d.name)}</option>`).join('');
  const other = docs.find((d) => d !== a) || a;
  const r = await openDialog({
    title: 'Overlay compare',
    body: `<p class="muted">Overlays two sheets in colour. Content only in the first sheet shows in red, only in the second in blue, and unchanged linework in black.</p>
      <div class="field two"><div><label>First sheet (red)</label><select name="da" id="cmp-da">${docOpts(a.id)}</select></div><div><label>Page</label><input type="number" name="pa" id="cmp-pa" min="1" value="${currentPage() + 1}"></div></div>
      <div class="field two"><div><label>Second sheet (blue)</label><select name="db" id="cmp-db">${docOpts(other.id)}</select></div><div><label>Page</label><input type="number" name="pb" id="cmp-pb" min="1" value="${other === a ? Math.min(a.numPages, currentPage() + 2) : 1}"></div></div>
      <label class="check"><input type="checkbox" name="grid" checked> Line up on the grid when the pages are aligned (Measurements panel)</label>
      <p class="muted sm">Otherwise sheets are aligned at their top-left corners and scaled to the first sheet's width.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Create overlay', value: true, primary: true }],
  });
  if (!r || !r.value) return; const f = r.form;
  const A = docs.find((d) => d.id === f.da), B = docs.find((d) => d.id === f.db); const pa = clamp((+f.pa || 1) - 1, 0, A.numPages - 1), pb = clamp((+f.pb || 1) - 1, 0, B.numPages - 1);
  await compareOverlay(A, pa, B, pb, !!f.grid);
}
async function renderToCanvas(doc, i, scale, w, h, M) {
  const page = await doc.pdf.getPage(i + 1); const vp = page.getViewport({ scale, rotation: page.rotate }); const c = document.createElement('canvas'); c.width = w || Math.floor(vp.width); c.height = h || Math.floor(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  // M (page units of this page -> page units of the target canvas) applied in device space
  const transform = M ? [M[0], M[1], M[2], M[3], M[4] * scale, M[5] * scale] : undefined;
  await hideOwnAnnots(doc, i); await page.render({ canvasContext: ctx, canvas: c, viewport: vp, transform, annotationMode: annotMode(doc) }).promise; return c;
}
async function compareOverlay(A, pa, B, pb, useGrid) {
  const busy = $('#busy'); busy.hidden = false; busy.textContent = 'Building overlay…'; await raf();
  try {
    const ga = A.pages[pa], gb = B.pages[pb]; const s = Math.min(3, Math.sqrt(9e6 / (ga.w * ga.h))); const W = Math.floor(ga.w * s), H = Math.floor(ga.h * s);
    const aligned = useGrid && A === B && isAligned(A, pa) && isAligned(A, pb);
    const ca = await renderToCanvas(A, pa, s, W, H); const cb = aligned ? await renderToCanvas(B, pb, s, W, H, tMul(tInv(alignT(A, pa)), alignT(A, pb))) : await renderToCanvas(B, pb, s * (ga.w / gb.w), W, H);
    const da = ca.getContext('2d').getImageData(0, 0, W, H), db = cb.getContext('2d').getImageData(0, 0, W, H); const out = new ImageData(W, H);
    const A8 = da.data, B8 = db.data, O = out.data;
    for (let k = 0; k < O.length; k += 4) {
      const a = 255 - (A8[k] * 0.299 + A8[k + 1] * 0.587 + A8[k + 2] * 0.114), b = 255 - (B8[k] * 0.299 + B8[k + 1] * 0.587 + B8[k + 2] * 0.114);
      O[k] = 255 - b; O[k + 1] = 255 - Math.max(a, b); O[k + 2] = 255 - a; O[k + 3] = 255;
    }
    const oc = document.createElement('canvas'); oc.width = W; oc.height = H; oc.getContext('2d').putImageData(out, 0, 0);
    const blob = await new Promise((res) => oc.toBlob(res, 'image/png')); const png = new Uint8Array(await blob.arrayBuffer());
    const pdf = await PDFDocument.create(); const page = pdf.addPage([ga.w, ga.h]); const img = await pdf.embedPng(png); page.drawImage(img, { x: 0, y: 0, width: ga.w, height: ga.h });
    const font = await pdf.embedFont(StandardFonts.Helvetica); const legend = `Overlay  •  red: ${A.name} p.${pa + 1}  •  blue: ${B.name} p.${pb + 1}  •  black: unchanged${aligned ? '  •  lined up on the grid' : ''}`.replace(/[^\x20-\x7e•]/g, '?');
    const lw = font.widthOfTextAtSize(legend, 9);
    page.drawRectangle({ x: 12, y: ga.h - 30, width: lw + 16, height: 18, color: PDFLib.rgb(1, 1, 1), borderColor: PDFLib.rgb(0.2, 0.2, 0.2), borderWidth: 0.5 });
    page.drawText(legend, { x: 20, y: ga.h - 24.5, size: 9, font, color: PDFLib.rgb(0.1, 0.1, 0.1) });
    const bytes = await pdf.save(); busy.hidden = true;
    const scales = A.scales[pa] ? { 0: deep(A.scales[pa]) } : {};
    await openBytes(`Overlay - ${A.name.replace(/\.pdf$/i, '')} p${pa + 1} vs ${B.name.replace(/\.pdf$/i, '')} p${pb + 1}.pdf`, bytes, { scales });
    const nd = activeDoc(); if (nd) { nd.dirty = true; renderTabs(); }
    toast('Overlay created as a new document');
  } catch (e) { console.error(e); toast('Overlay failed: ' + e.message, 'error'); } finally { busy.hidden = true; }
}
