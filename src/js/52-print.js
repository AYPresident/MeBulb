// ===== Print ===================================================================================
// Printer, paper, orientation and scale up front, with a live preview of how the sheet lands
// on the paper and what scale the drawing prints at. The desktop app prints straight to the
// chosen printer; in a browser the system print dialog opens with the paper already set.
const PAPERS = [
  ['match', 'Same as the drawing', null], ['A0', 'A0', [841, 1189]], ['A1', 'A1', [594, 841]], ['A2', 'A2', [420, 594]], ['A3', 'A3', [297, 420]], ['A4', 'A4', [210, 297]], ['A5', 'A5', [148, 210]],
  ['B1', 'B1', [707, 1000]], ['B2', 'B2', [500, 707]], ['B3', 'B3', [353, 500]],
  ['Letter', 'Letter (8.5 × 11 in)', [215.9, 279.4]], ['Legal', 'Legal (8.5 × 14 in)', [215.9, 355.6]], ['Tabloid', 'Tabloid / Ledger (11 × 17 in)', [279.4, 431.8]],
  ['ANSIC', 'ANSI C (17 × 22 in)', [431.8, 558.8]], ['ANSID', 'ANSI D (22 × 34 in)', [558.8, 863.6]], ['ANSIE', 'ANSI E (34 × 44 in)', [863.6, 1117.6]],
  ['ARCHC', 'ARCH C (18 × 24 in)', [457.2, 609.6]], ['ARCHD', 'ARCH D (24 × 36 in)', [609.6, 914.4]], ['ARCHE1', 'ARCH E1 (30 × 42 in)', [762, 1066.8]], ['ARCHE', 'ARCH E (36 × 48 in)', [914.4, 1219.2]],
  ['custom', 'Custom size…', null],
];
const PT2MM = 25.4 / 72;
// paper in mm (w, h) after orientation, for page i
function paperFor(o, pg) {
  let wh; if (o.paper === 'match') wh = [pg.w * PT2MM, pg.h * PT2MM]; else if (o.paper === 'custom') wh = [+o.cw || 297, +o.ch || 420]; else wh = (PAPERS.find((p) => p[0] === o.paper) || PAPERS[4])[2].slice();
  const land = o.orient === 'auto' ? pg.w > pg.h : o.orient === 'landscape';
  const [a, b] = [Math.min(wh[0], wh[1]), Math.max(wh[0], wh[1])]; return o.paper === 'match' && o.orient === 'auto' ? wh : land ? [b, a] : [a, b];
}
// drawing on paper: factor (paper mm per page mm) and placement
function printLayout(o, pg) {
  const [pw, ph] = paperFor(o, pg); const m = o.margin === 'small' ? 5 : 0; const gw = pw - 2 * m, gh = ph - 2 * m; const dw = pg.w * PT2MM, dh = pg.h * PT2MM;
  const f = o.fit === 'actual' ? 1 : o.fit === 'custom' ? (+o.pct || 100) / 100 : Math.min(gw / dw, gh / dh);
  const w = dw * f, h = dh * f; return { pw, ph, f, w, h, x: m + (gw - w) / 2, y: m + (gh - h) / 2, clipped: w > gw + 0.5 || h > gh + 0.5 };
}
function printScaleNote(doc, i, f) {
  const sc = scaleFor(doc, i); if (!sc || sc.unset || !sc.inPerPt) return ''; const ratio = (72 * sc.inPerPt) / f;
  if (!sc.metric && sc.unit !== 'm' && sc.unit !== 'mm') return Math.abs(f - 1) < 0.005 ? `Prints at the drawing scale (${esc(sc.label || '')})` : `Prints at ${Math.round(f * 100)}% of the drawing scale`;
  const nice = ratio >= 10 ? Math.round(ratio) : +ratio.toFixed(1); return Math.abs(f - 1) < 0.005 ? `Prints at the drawing scale, 1:${nice}` : `Prints at about 1:${nice} (drawing is ${esc(sc.label || '1:' + Math.round(72 * sc.inPerPt))})`;
}
async function printDoc() {
  const doc = activeDoc(); if (!doc) return; const H = HOST(); const cur = currentPage();
  let printers = []; if (H && H.printers) { try { printers = await H.printers(); } catch { } }
  const P0 = store.get('print', {}); const def = printers.find((p) => p.isDefault) || printers[0];
  const o0 = { printer: printers.some((p) => p.name === P0.printer) ? P0.printer : def ? def.name : '', paper: P0.paper || 'match', orient: P0.orient || 'auto', fit: P0.fit || 'fit', pct: P0.pct || 100, cw: P0.cw || 297, ch: P0.ch || 420, margin: P0.margin || 'none', color: P0.color || 'color', q: P0.q || 220, marks: P0.marks !== false, cadj: P0.cadj !== false, copies: 1, range: 'all' };
  const opt = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}"${String(v) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const printerField = H ? `<select name="printer">${printers.map((p) => `<option value="${esc(p.name)}"${p.name === o0.printer ? ' selected' : ''}>${esc(p.displayName || p.name)}${p.isDefault ? ' (default)' : ''}</option>`).join('')}<option value=""${!o0.printer ? ' selected' : ''}>Choose in the Windows print dialog…</option></select>` : '<div class="note-box">Your browser asks which printer next. MeBulb sets the paper size and orientation for it.</div>';
  const body = `<div class="print-grid"><div class="print-set">
    ${field('Printer', printerField)}
    <div class="field two"><div><label>Paper</label><select name="paper">${opt(PAPERS.map(([k, l]) => [k, l]), o0.paper)}</select></div><div><label>Orientation</label><select name="orient">${opt([['auto', 'Automatic'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], o0.orient)}</select></div></div>
    <div class="field two" data-show="custom"${o0.paper === 'custom' ? '' : ' hidden'}><div><label>Width (mm)</label><input type="number" name="cw" min="50" max="5000" value="${o0.cw}"></div><div><label>Height (mm)</label><input type="number" name="ch" min="50" max="5000" value="${o0.ch}"></div></div>
    <div class="field two"><div><label>Size</label><select name="fit">${opt([['fit', 'Fit to paper'], ['actual', 'Actual size (100%)'], ['custom', 'Custom %']], o0.fit)}</select></div><div><label>Margins</label><select name="margin">${opt([['none', 'None'], ['small', '5 mm']], o0.margin)}</select></div></div>
    <div class="field" data-show="pct"${o0.fit === 'custom' ? '' : ' hidden'}><label>Scale (%)</label><input type="number" name="pct" min="5" max="800" value="${o0.pct}"></div>
    <div class="field two"><div><label>Pages</label><select name="which">${opt([['all', `All (${doc.numPages})`], ['current', `Current (${cur + 1})`], ['range', 'Range…']], 'all')}</select><input type="text" name="range" placeholder="e.g. 1-3, 5" hidden></div><div><label>Copies</label><input type="number" name="copies" min="1" max="99" value="1"></div></div>
    <div class="field two"><div><label>Colour</label><select name="color">${opt([['color', 'Colour'], ['grey', 'Greyscale']], o0.color)}</select></div><div><label>Quality</label><select name="q">${opt([[150, 'Draft (150 dpi)'], [220, 'Standard (220 dpi)'], [300, 'High (300 dpi)']], o0.q)}</select></div></div>
    <label class="check"><input type="checkbox" name="marks"${o0.marks ? ' checked' : ''}> Print markups</label>
    ${doc.colorAdj ? `<label class="check"><input type="checkbox" name="cadj"${o0.cadj ? ' checked' : ''}> Apply colour processing</label>` : ''}
  </div><div class="print-prev"><div class="pp-paper" id="pp-paper"><canvas id="pp-canvas"></canvas></div><p class="pp-info" id="pp-info"></p><div class="pp-nav"><button type="button" class="icon-btn sm" data-pp="-1" aria-label="Previous page">${icon('chevl')}</button><span id="pp-page"></span><button type="button" class="icon-btn sm" data-pp="1" aria-label="Next page">${icon('chevr')}</button></div></div></div>`;
  let pv = cur; let token = 0;
  const read = (form) => { const f = Object.fromEntries(new FormData(form)); f.marks = form.marks.checked; f.cadj = form.cadj ? form.cadj.checked : false; return f; };
  const pagesOf = (f) => (f.which === 'current' ? [cur] : f.which === 'range' ? parseRange(f.range || '', doc.numPages) : [...Array(doc.numPages).keys()]);
  const preview = debounce(async (box) => {
    const form = box.querySelector('#dlg-form'); const f = read(form); const idx = pagesOf(f); if (!idx.length) return; if (!idx.includes(pv)) pv = idx[0];
    const pg = doc.pages[pv]; const L = printLayout(f, pg); const paper = box.querySelector('#pp-paper'); const maxW = 300, maxH = 300; const k = Math.min(maxW / L.pw, maxH / L.ph);
    paper.style.width = `${L.pw * k}px`; paper.style.height = `${L.ph * k}px`; const cv = box.querySelector('#pp-canvas'); cv.style.left = `${L.x * k}px`; cv.style.top = `${L.y * k}px`; cv.style.width = `${L.w * k}px`; cv.style.height = `${L.h * k}px`;
    const my = ++token;
    const c = await printCanvas(doc, pv, Math.max(0.15, (L.w * k * (window.devicePixelRatio || 1)) / pg.w), f); if (my !== token) return;
    cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0);
    const name = f.paper === 'match' ? 'drawing size' : f.paper === 'custom' ? `${f.cw} × ${f.ch} mm` : (PAPERS.find((p) => p[0] === f.paper) || [])[1];
    box.querySelector('#pp-info').innerHTML = `${esc(name)} ${L.pw > L.ph ? 'landscape' : 'portrait'} · ${Math.round(L.pw)} × ${Math.round(L.ph)} mm<br>${Math.round(L.f * 100)}% · ${printScaleNote(doc, pv, L.f)}${L.clipped ? '<br><b class="bad">The drawing is larger than the paper and will be cut off.</b>' : ''}`;
    box.querySelector('#pp-page').textContent = `Page ${pv + 1} (${idx.indexOf(pv) + 1} of ${idx.length})`;
  }, 120);
  const r = await openDialog({ title: 'Print', wide: true, body, buttons: [{ label: 'Cancel', value: false }, { label: 'Print', value: true, primary: true }], onOpen: (box) => {
    const form = box.querySelector('#dlg-form');
    form.addEventListener('input', (e) => { if (e.target.name === 'which') form.range.hidden = e.target.value !== 'range'; if (e.target.name === 'paper') box.querySelector('[data-show="custom"]').hidden = e.target.value !== 'custom'; if (e.target.name === 'fit') box.querySelector('[data-show="pct"]').hidden = e.target.value !== 'custom'; preview(box); });
    form.addEventListener('change', () => preview(box));
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-pp]'); if (!b) return; const idx = pagesOf(read(form)); const k = idx.indexOf(pv); pv = idx[clamp(k + +b.dataset.pp, 0, idx.length - 1)]; preview(box); });
    preview(box);
  } });
  if (!r || !r.value) return; const f = r.form; f.marks = !!f.marks; f.cadj = doc.colorAdj ? !!f.cadj : true;
  const idxs = pagesOf(f); if (!idxs.length) { toast('Enter pages like 1-3, 5', 'error'); return; }
  store.set('print', { printer: f.printer, paper: f.paper, orient: f.orient, fit: f.fit, pct: f.pct, cw: f.cw, ch: f.ch, margin: f.margin, color: f.color, q: f.q, marks: f.marks, cadj: f.cadj });
  const busy = $('#busy'); busy.hidden = false; const sheets = [];
  try {
    for (const [k, i] of idxs.entries()) {
      busy.textContent = `Preparing page ${k + 1} of ${idxs.length}…`; const pg = doc.pages[i]; const L = printLayout(f, pg);
      const dpi = +f.q || 220; const s = Math.min((dpi / 72) * L.f, Math.sqrt(60e6 / (pg.w * pg.h)));
      const c = await printCanvas(doc, i, s, f);
      sheets.push({ url: c.toDataURL('image/jpeg', 0.92), ...L });
    }
    busy.textContent = 'Sending to the printer…';
    if (H && H.print) { const res = await H.print({ printer: f.printer || null, copies: clamp(+f.copies || 1, 1, 99), color: f.color !== 'grey', sheets: sheets.map((x) => ({ url: x.url, pw: x.pw, ph: x.ph, x: x.x, y: x.y, w: x.w, h: x.h })), title: doc.name }); if (res && res.ok) toast(`Sent ${sheets.length} page${sheets.length === 1 ? '' : 's'} to ${f.printer || 'the printer'}`); else if (res && res.error) toast('Print failed: ' + res.error, 'error'); }
    else { busy.hidden = true; printSheets(sheets, doc.name, clamp(+f.copies || 1, 1, 99)); }
  } catch (e) { console.error(e); toast('Print failed: ' + e.message, 'error'); } finally { busy.hidden = true; }
}
// one page as it should print: drawing, colour processing, flattened and live markups, greyscale
async function printCanvas(doc, i, s, f) {
  const c = await renderToCanvas(doc, i, s); const ctx = c.getContext('2d');
  if (f.cadj !== false) colorAdjCanvas(ctx, c.width, c.height, colorAdjFor(doc, i));
  if (f.marks !== false) await drawMarkupsOnCanvas(doc, i, c, s);
  if (f.color === 'grey') colorAdjCanvas(ctx, c.width, c.height, { sat: 0, lum: 0 });
  return c;
}
// browser printing: one image per sheet, paper size set with @page
function printSheets(sheets, title, copies = 1) {
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(fr);
  const d = fr.contentDocument; const first = sheets[0]; const all = []; for (let c = 0; c < copies; c++) all.push(...sheets);
  d.open(); d.write(`<!doctype html><html><head><title>${esc(title)}</title><style>@page{size:${num(first.pw, 2)}mm ${num(first.ph, 2)}mm;margin:0}html,body{margin:0;padding:0}.sheet{position:relative;width:${num(first.pw, 2)}mm;height:${num(first.ph, 2)}mm;overflow:hidden;page-break-after:always;break-after:page}.sheet:last-child{page-break-after:auto;break-after:auto}.sheet img{position:absolute}</style></head><body>${all.map((x) => `<div class="sheet" style="width:${num(x.pw, 2)}mm;height:${num(x.ph, 2)}mm"><img src="${x.url}" style="left:${num(x.x, 2)}mm;top:${num(x.y, 2)}mm;width:${num(x.w, 2)}mm;height:${num(x.h, 2)}mm"></div>`).join('')}</body></html>`); d.close();
  const go = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } finally { setTimeout(() => fr.remove(), 60000); } };
  Promise.all([...d.images].map((im) => (im.complete ? 0 : new Promise((res) => { im.onload = im.onerror = res; })))).then(go);
}
