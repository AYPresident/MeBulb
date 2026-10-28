// ===== Edit PDF text ==========================================================
// In the viewer an edit is a "textedit" record: the original run's quad, the new
// text, its colour and the sampled background. On save the original glyphs are
// removed from the content stream (the operator is replaced by an equal advance so
// later text keeps its position) and the new text is written as page content.
function sampleTextColors(doc, page, quad) {
  const out = { fg: '#000000', bg: '#ffffff' }; const el = doc.pageEls && doc.pageEls[page]; const c = el && el.querySelector('canvas.base'); if (!c || !c.width) return out;
  const k = c.width / doc.pages[page].w; const b = G.bbox(quad); const x = Math.max(0, Math.floor(b.x * k)), y = Math.max(0, Math.floor(b.y * k)), w = Math.min(c.width - x, Math.ceil(b.w * k)), h = Math.min(c.height - y, Math.ceil(b.h * k));
  if (w < 2 || h < 2) return out;
  let data; try { data = c.getContext('2d').getImageData(x, y, w, h).data; } catch { return out; }
  const px = []; for (let i = 0; i < data.length; i += 4) px.push([data[i], data[i + 1], data[i + 2], 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]]);
  px.sort((a, b) => a[3] - b[3]); const avg = (arr) => '#' + [0, 1, 2].map((j) => Math.round(arr.reduce((s, p) => s + p[j], 0) / arr.length).toString(16).padStart(2, '0')).join('');
  const dark = px.slice(0, Math.max(1, Math.floor(px.length * 0.08))), light = px.slice(Math.floor(px.length * 0.6));
  if (light.length) out.bg = avg(light); if (dark.length && light.length && light[0][3] - dark[0][3] > 60) out.fg = avg(dark);
  return out;
}
function startPdfTextEdit(doc, page, hit) {
  const t = doc.textCache[page]; const it = t.items[hit.k]; if (!it) return;
  const q = itemRect(it, 0, it.str.length); const c = G.centroid(q); const quad = q.map((p) => [c[0] + (p[0] - c[0]) * 1.04 + Math.sign(p[0] - c[0]) * 0.6, c[1] + (p[1] - c[1]) * 1.06 + Math.sign(p[1] - c[1]) * 0.6]);
  const col = sampleTextColors(doc, page, quad); const style = t.styles && t.styles[it.fontName];
  const m = newMarkup('textedit', page, quad, { text: it.str, orig: it.str, base: [it.x, it.y], ang: it.ang, applied: false, subject: 'Text edit' });
  const ff = (style && style.fontFamily) || ''; const fam = /mono|courier/i.test(ff) ? 'courier' : /serif|times|roman|georgia/i.test(ff) && !/sans/i.test(ff) ? 'times' : 'helv';
  m.style = { ...toolStyle('edittext'), fontSize: Math.round(it.fh * 100) / 100, fontColor: col.fg, cover: col.bg, font: fam, bold: !!(style && /bold|black|heavy/i.test(ff)), italic: !!(style && /italic|oblique/i.test(ff)) };
  editPdfText(m, true);
}
function editPdfText(m, isNew) {
  const doc = activeDoc(); const el = doc.pageEls[m.page]; if (!el) return; if (state.editing) commitEdit();
  const old = el.querySelector('.pdf-edit'); if (old) old.remove();
  const inp = document.createElement('input'); inp.className = 'pdf-edit'; inp.value = m.text; inp.setAttribute('aria-label', 'Replacement text');
  const place = () => { const z = doc.zoom; const b = G.bbox(m.pts); const w = Math.max(b.w, textWidth(inp.value || ' ', m.style.fontSize, m.style.bold, m.style.font, m.style.italic) + 8); Object.assign(inp.style, { left: b.x * z + 'px', top: b.y * z + 'px', width: w * z + 'px', height: b.h * z + 'px', fontSize: m.style.fontSize * z + 'px', color: m.style.fontColor, background: m.style.cover, fontWeight: m.style.bold ? '700' : '400', fontStyle: m.style.italic ? 'italic' : 'normal', fontFamily: FONT_FAMILIES[famOf(m.style.font)].css }); };
  place(); el.appendChild(inp); setTimeout(() => { inp.focus(); inp.select(); }, 0);
  const before = m.text; const snap = isNew ? null : snapshot(doc); let done = false;
  const finish = (keep) => {
    if (done) return; done = true; inp.remove(); const v = inp.value;
    if (!keep || v === before) { if (isNew) toolDone(); return; }
    if (isNew) { m.text = v; addMarkup(m, doc); state.sel.clear(); state.sel.add(m.id); toolDone(); refreshSelection(); toast('Text replaced. The original glyphs are removed when you save.'); }
    else { doc.undo.push(snap); doc.redo = []; m.text = v; touch(m); markDirty(doc); renderMarks(doc, m.page); refreshPanels(); }
  };
  inp.addEventListener('input', place);
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
}

// ----- save-time content editing --------------------------------------------------------
function replaceRanges(bytes, edits) {
  edits.sort((a, b) => a.start - b.start); const enc = new TextEncoder(); const parts = []; let at = 0;
  for (const e of edits) { if (e.start < at) continue; parts.push(bytes.subarray(at, e.start), enc.encode(e.text)); at = e.end; }
  parts.push(bytes.subarray(at)); const len = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(len); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; }); return out;
}
function writeStream(ctx, ref, oldObj, bytes) {
  const ns = ctx.flateStream(bytes, {});
  if (oldObj && oldObj.dict) oldObj.dict.entries().forEach(([k, v]) => { const ks = k.asString(); if (ks !== '/Length' && ks !== '/Filter' && ks !== '/DecodeParms') ns.dict.set(k, v); });
  ctx.assign(ref, ns);
}
function runReplacement(r) {
  const n = r.Tfs && r.Th ? num((-r.adv * 1000) / (r.Tfs * r.Th), 3) : '0';
  if (r.op === "'") return ` T* [${n}] TJ `;
  if (r.op === '"') return ` ${+r.operands[0] || 0} Tw ${+r.operands[1] || 0} Tc T* [${n}] TJ `;
  return ` [${n}] TJ `;
}
// removes original glyphs under unapplied edits; returns Set of edit ids that were removed
function removeEditedText(pdfDoc, doc, page, edits) {
  const removed = new Set(); const pending = edits.filter((m) => !m.applied); if (!pending.length) return removed;
  const runs = []; let walk;
  try { walk = csWalkPage(pdfDoc, page, doc.pages[page].T, { text: (r) => runs.push(r) }); } catch (e) { console.warn('text parse failed', e); return removed; }
  const grow = (q) => { const c = G.centroid(q); return q.map((p) => [c[0] + (p[0] - c[0]) * 1.25, c[1] + (p[1] - c[1]) * 1.6]); };
  const bySrc = new Map();
  runs.forEach((r) => {
    if (!r.adv) return; const c = G.centroid(r.quad);
    const hit = pending.find((m) => G.pointInPoly(c, grow(m.pts))); if (!hit) return;
    const key = r.src.ref ? r.src.ref.toString() : 'direct'; if (!r.src.ref) return;
    if (!bySrc.has(key)) bySrc.set(key, { ref: r.src.ref, list: [] }); bySrc.get(key).list.push(r); removed.add(hit.id);
  });
  bySrc.forEach(({ ref, list }) => {
    const obj = pdfDoc.context.lookup(ref); const bytes = csStreamBytes(obj); if (!bytes) { list.forEach(() => {}); return; }
    writeStream(pdfDoc.context, ref, obj, replaceRanges(bytes, list.map((r) => ({ start: r.start, end: r.end, text: runReplacement(r) }))));
  });
  void walk; return removed;
}
const PM_MARK = { editStart: '% planmark-eq', edit: '% planmark-edit', ocrStart: '% planmark-oq', ocr: '% planmark-ocr' };
function appendPageContent(pdfDoc, page, content, resources, mark) {
  const ctx = pdfDoc.context; const mb = page.getMediaBox();
  const xref = ctx.register(ctx.flateStream(content, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [mb.x - 1e4, mb.y - 1e4, mb.x + mb.width + 1e4, mb.y + mb.height + 1e4], Resources: resources }));
  const name = page.node.newXObject('PM', xref); page.node.normalize();
  const start = ctx.register(ctx.stream(`${mark[0]}\nq\n`)); const end = ctx.register(ctx.stream(`${mark[1]}\nQ\nq ${name.toString()} Do Q\n`));
  if (!page.node.wrapContentStreams(start, end)) page.node.set(PDFName.of('Contents'), ctx.obj(page.node.Contents() ? [start, page.node.get(PDFName.of('Contents')), end] : [end]));
}
async function bakeTextEdits(pdfDoc, doc, fonts, imgCache) {
  const applied = new Map(); const pages = pdfDoc.getPages();
  const byPage = new Map(); doc.markups.forEach((m) => { if (m.type === 'textedit') { if (!byPage.has(m.page)) byPage.set(m.page, []); byPage.get(m.page).push(m); } });
  for (const [i, edits] of byPage) {
    const page = pages[i]; if (!page) continue; const removed = removeEditedText(pdfDoc, doc, i, edits);
    const ops = new Ops(doc); ops.s.push(`${invertT(doc.pages[i].T).map((v) => num(v, 6)).join(' ')} cm`);
    edits.forEach((m) => { const isOn = m.applied || removed.has(m.id); applied.set(m.id, isOn); dl({ ...m, applied: isOn }, doc).forEach((p) => ops.prim(p)); });
    const res = await resourcesFor(pdfDoc, ops, fonts, imgCache);
    appendPageContent(pdfDoc, page, ops.toString(), res, [PM_MARK.editStart, PM_MARK.edit]);
  }
  return applied;
}
// strip our baked edit streams when reopening (the edits come back from the saved data)
function stripBakedEdits(pdfDoc) {
  const ctx = pdfDoc.context; const dec = new TextDecoder();
  pdfDoc.getPages().forEach((page) => {
    const c = page.node.Contents(); if (!(c instanceof PDFArray)) return;
    for (let k = c.size() - 1; k >= 0; k--) {
      const obj = c.lookup(k); const b = csStreamBytes(obj); if (!b) continue; const head = dec.decode(b.subarray(0, 24));
      if (head.startsWith(PM_MARK.editStart) || head.startsWith(PM_MARK.edit)) { const ref = c.get(k); c.remove(k); if (ref instanceof PDFRef) ctx.delete(ref); }
    }
  });
}
