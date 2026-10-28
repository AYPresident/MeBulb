// ===== Editing operations: properties copy/paste (format painter), fit text, arrange =====
// Ctrl+Shift+C copies the selected markup's look (style, font, layer) and turns on the
// format painter: click other markups to apply it, Esc to stop. Ctrl+Shift+V pastes the
// copied look onto whatever is selected.
const PROP_SKIP = new Set(['cloudArc']);
function copyProperties() {
  const ms = selected(); if (ms.length !== 1) { toast('Select one markup to copy its properties'); return; }
  const m = ms[0]; state.propClipboard = { type: m.type, style: deep(m.style), layer: m.layer || null, depth: m.depth };
  state.painter = true; document.body.classList.add('painting'); setStatus('Format painter: click markups to give them this look · Ctrl+Shift+V pastes onto the selection · Esc to stop');
  toast('Properties copied. Click markups to apply them, or select markups and press Ctrl+Shift+V');
}
function endPainter() { state.painter = false; document.body.classList.remove('painting'); setStatus(''); }
function applyPropsTo(ms) {
  const P0 = state.propClipboard; if (!P0 || !ms.length) return 0; const doc = activeDoc(); pushUndo(doc); let n = 0;
  ms.forEach((m) => {
    if (isLocked(m, doc)) return; const st = { ...m.style };
    Object.entries(P0.style).forEach(([k, v]) => { if (!PROP_SKIP.has(k)) st[k] = v; });
    // keep shape-specific geometry settings that would not make sense across types
    if (P0.type !== m.type) { ['variant', 'size', 'numbered', 'symbol', 'labelPos'].forEach((k) => { if (m.style[k] !== undefined) st[k] = m.style[k]; else delete st[k]; }); }
    m.style = st; m.layer = P0.layer; if (m.type === 'volume' && P0.type === 'volume') m.depth = P0.depth;
    if (TEXT_TYPES.has(m.type)) { Object.keys(RT_STYLE).forEach((k) => rtStrip(m, k)); fitTextBox(m); }
    touch(m); n++;
  });
  new Set(ms.map((m) => m.page)).forEach((p) => renderMarks(doc, p)); refreshPanels(); return n;
}
function pasteProperties() { if (!state.propClipboard) { toast('Copy properties first (Ctrl+Shift+C)'); return; } const n = applyPropsTo(selected()); if (n) toast(`Properties pasted onto ${n} markup${n > 1 ? 's' : ''}`); }

// Alt+Z: make a text box exactly fit its text (no wrapping beyond the widest line)
function fitTextToContent(m) {
  const s = m.style; const size = s.fontSize || 12; const pad = Math.max(3, size * 0.4); const lay = layoutRich(runsOf(m), s, 1e6);
  const w = Math.max(lay.width + 2 * pad + 1, size * 2), h = Math.max(lay.height + 2 * pad, size + 2 * pad);
  const b = m.type === 'callout' ? boxRect(m.pts[1], m.pts[2]) : boxRect(m.pts[0], m.pts[1]);
  let x = b.x; if (s.align === 'center') x = b.x + (b.w - w) / 2; else if (s.align === 'right') x = b.x + b.w - w;
  if (m.type === 'callout') m.pts = [m.pts[0], [x, b.y], [x + w, b.y + h]]; else m.pts = [[x, b.y], [x + w, b.y + h]];
}
function fitTextCommand() {
  const doc = activeDoc(); if (!doc) return;
  if (state.editing) { const m = getMarkup(state.editing.id); if (!m) return; rtReadEditor(state.editing.ta, m); fitTextToContent(m); positionEditor(); renderMarkupEl(m); return; }
  const ms = selTextMs().filter((m) => !isLocked(m, doc)); if (!ms.length) { toast('Select a text box or callout'); return; }
  pushUndo(doc); ms.forEach((m) => { fitTextToContent(m); touch(m); }); new Set(ms.map((m) => m.page)).forEach((p) => renderMarks(doc, p)); refreshPanels();
}

// align and distribute selected markups (by their bounding boxes)
function arrangeSelected(kind) {
  const doc = activeDoc(); const ms = selected(doc).filter((m) => !isLocked(m, doc)); if (ms.length < 2) return;
  const page = ms[0].page; const same = ms.filter((m) => m.page === page); if (same.length < 2) { toast('Select markups on the same page'); return; }
  const bb = new Map(same.map((m) => [m, markupBBox(m, doc)])); const all = G.bbox(same.flatMap((m) => { const b = bb.get(m); return [[b.x, b.y], [b.x2, b.y2]]; }));
  pushUndo(doc);
  const move = (m, dx, dy) => { if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return; mapMarkupPoints(m, (p) => [p[0] + dx, p[1] + dy]); touch(m); };
  if (kind === 'distH' || kind === 'distV') {
    const h = kind === 'distH'; const sorted = same.slice().sort((a, b) => (h ? bb.get(a).x - bb.get(b).x : bb.get(a).y - bb.get(b).y));
    const total = sorted.reduce((t, m) => t + (h ? bb.get(m).w : bb.get(m).h), 0); const span = h ? all.w : all.h; const gap = (span - total) / (sorted.length - 1);
    let at = h ? all.x : all.y; sorted.forEach((m) => { const b = bb.get(m); if (h) move(m, at - b.x, 0); else move(m, 0, at - b.y); at += (h ? b.w : b.h) + gap; });
  } else {
    same.forEach((m) => { const b = bb.get(m);
      if (kind === 'alignLeft') move(m, all.x - b.x, 0); else if (kind === 'alignRight') move(m, all.x2 - b.x2, 0); else if (kind === 'alignCenter') move(m, all.x + all.w / 2 - (b.x + b.w / 2), 0);
      else if (kind === 'alignTop') move(m, 0, all.y - b.y); else if (kind === 'alignBottom') move(m, 0, all.y2 - b.y2); else if (kind === 'alignMiddle') move(m, 0, all.y + all.h / 2 - (b.y + b.h / 2)); });
  }
  syncLinked(doc, same.filter((m) => m.type === 'sketch')); renderAllMarks(doc); refreshPanels();
}
function cycleDoc(dir) { if (state.docs.length < 2) return; const i = state.docs.findIndex((d) => d.id === state.activeId); switchDoc(state.docs[(i + dir + state.docs.length) % state.docs.length].id); }

// ----- print: renders pages with their markups and hands them to the system print dialog
async function printDoc() {
  const doc = activeDoc(); if (!doc) return; const cur = currentPage() + 1;
  const r = await openDialog({ title: 'Print', body: `${field('Pages', `<input type="text" name="range" value="${doc.numPages <= 1 ? '1' : 'all'}" placeholder="e.g. all, ${cur} or 1-3">`)}${field('Quality', '<select name="q"><option value="150">Standard (150 dpi)</option><option value="220" selected>High (220 dpi)</option><option value="300">Best (300 dpi, slower)</option></select>')}<label class="check"><input type="checkbox" name="marks" checked> Include markups</label>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Print…', value: true, primary: true }] });
  if (!r || !r.value) return; const idxs = /^\s*all\s*$/i.test(r.form.range) ? [...Array(doc.numPages).keys()] : parseRange(r.form.range, doc.numPages); if (!idxs.length) { toast('Enter pages like all, 2 or 1-3', 'error'); return; }
  const busy = $('#busy'); busy.hidden = false; const imgs = [];
  try {
    for (const [k, i] of idxs.entries()) {
      busy.textContent = `Preparing page ${k + 1} of ${idxs.length}…`; const pg = doc.pages[i]; const s = Math.min(+r.form.q / 72, Math.sqrt(40e6 / (pg.w * pg.h)));
      const c = await renderToCanvas(doc, i, s); if (r.form.marks) await drawMarkupsOnCanvas(doc, i, c, s);
      imgs.push({ url: c.toDataURL('image/jpeg', 0.92), w: pg.w, h: pg.h });
    }
    busy.hidden = true; printImages(imgs, doc.name);
  } catch (e) { console.error(e); toast('Print failed: ' + e.message, 'error'); } finally { busy.hidden = true; }
}
async function drawMarkupsOnCanvas(doc, i, canvas, s) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${doc.pages[i].w} ${doc.pages[i].h}">${doc.markups.filter((m) => m.page === i && layerVisible(doc, m.layer)).map((m) => dl(m, doc).map(primSvg).join('')).join('')}</svg>`;
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode(); canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
}
function printImages(imgs, title) {
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(fr);
  const d = fr.contentDocument; const first = imgs[0];
  d.open(); d.write(`<!doctype html><html><head><title>${esc(title)}</title><style>@page{size:${num(first.w / 72, 3)}in ${num(first.h / 72, 3)}in;margin:0}html,body{margin:0;padding:0}img{display:block;width:100vw;height:100vh;object-fit:contain;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}</style></head><body>${imgs.map((m) => `<img src="${m.url}">`).join('')}</body></html>`); d.close();
  const go = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } finally { setTimeout(() => fr.remove(), 60000); } };
  const all = [...d.images]; Promise.all(all.map((im) => (im.complete ? 0 : new Promise((res) => { im.onload = im.onerror = res; })))).then(go);
}
