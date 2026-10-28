// ===== OCR for scanned drawings ===============================================
// Engine 1: Tesseract (runs in the browser; needs to download its language data,
// so it works in the standalone copy). Engine 2: Claude vision through the page's
// sample capability (works on the published page). Recognised words become a text
// layer: searchable, highlightable, and written into saved PDFs as invisible text.
let _ocrEngine = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }
async function tesseractEngine(progress) {
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  const worker = await window.Tesseract.createWorker('eng', 1, { logger: (m) => { if (m.status && progress) progress(m.status + (m.progress != null ? ` ${Math.round(m.progress * 100)}%` : '')); } });
  return {
    name: 'Tesseract',
    async recognize(canvas) { const { data } = await worker.recognize(canvas); return (data.words || []).filter((w) => w.text && w.text.trim() && w.confidence > 35).map((w) => ({ str: w.text.trim(), x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })); },
  };
}
async function claudeEngine() {
  if (!(window.claude && window.claude.use)) return null; const sample = await window.claude.use('sample'); if (!sample) return null;
  try { const lim = sample.limits ? await sample.limits() : null; if (lim && !lim.images) return null; } catch { }
  return {
    name: 'Claude',
    async recognize(canvas, progress) {
      const T = 1400; const out = []; const cols = Math.ceil(canvas.width / T), rows = Math.ceil(canvas.height / T); let n = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = c * T, y = r * T, w = Math.min(T, canvas.width - x), h = Math.min(T, canvas.height - y); const tile = document.createElement('canvas'); tile.width = w; tile.height = h; tile.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
        const blob = await new Promise((res) => tile.toBlob(res, 'image/jpeg', 0.88)); n++; if (progress) progress(`Reading tile ${n} of ${rows * cols}`);
        const prompt = `This image is a ${w}x${h} pixel crop of a scanned construction drawing. Transcribe every legible piece of text. Reply with JSON only: {"lines":[{"text":"...","box":[x0,y0,x1,y1]}]} where box is the tight bounding box of that text line in this image's pixel coordinates (origin top-left). Use one entry per separate label or line. Return {"lines":[]} if there is no text.`;
        let res; try { res = await sample.json(prompt, { images: [blob] }); } catch (e) {
          const code = e && e.code;
          if (code === 'invalid_json' || code === 'empty_completion') continue; // unreadable tile: skip it, keep the rest
          const why = { not_granted: 'Claude was not allowed to read the page images', images_unavailable: 'Claude was not allowed to read the page images', sampling_disabled: 'Claude is not available for this account', rate_limited: 'Claude usage limit reached. Try OCR again later', session_expired: 'Sign in to Claude again, then retry OCR', refused: 'Claude declined to read this page', image_rejected: 'This page image could not be sent to Claude' }[code];
          throw new Error(why || (e && e.message) || 'Claude OCR failed. Try again');
        }
        (res && res.lines || []).forEach((l) => { if (!l || !l.text || !Array.isArray(l.box)) return; const [a, b2, cc, d] = l.box.map(Number); if ([a, b2, cc, d].some((v) => !isFinite(v))) return; out.push({ str: String(l.text).trim(), x0: x + a, y0: y + b2, x1: x + cc, y1: y + d }); });
      }
      return out;
    },
  };
}
function withTimeout(p, ms, msg) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]); }
async function getOcrEngine(progress) {
  if (_ocrEngine) return _ocrEngine;
  const inViewer = !!(window.claude && typeof window.claude.use === 'function');
  const tryTess = async () => { try { return await withTimeout(tesseractEngine(progress), 45000, 'Tesseract did not start'); } catch (e) { console.warn('Tesseract unavailable', e); return null; } };
  const tryClaude = async () => { try { return await withTimeout(claudeEngine(), 12000, 'Claude OCR unavailable'); } catch (e) { console.warn(e); return null; } };
  // the published page cannot download Tesseract's language data, so it asks Claude first
  _ocrEngine = inViewer ? (await tryClaude()) || (await tryTess()) : (await tryTess()) || (await tryClaude());
  if (_ocrEngine) return _ocrEngine;
  throw new Error('No OCR engine could start here. Open the standalone copy of MeBulb in Chrome or Edge with an internet connection.');
}
async function ocrDialog() {
  const doc = activeDoc(); if (!doc) return; const cur = currentPage() + 1;
  const r = await openDialog({ title: 'Recognize text (OCR)', body: `<p class="muted">Finds text on scanned pages so you can search it, highlight it and edit it. Saved PDFs get an invisible text layer that other PDF apps can search too.</p>${field('Pages', `<input type="text" name="range" value="${cur}" placeholder="e.g. 1-3, 5 or all">`)}`, buttons: [{ label: 'Cancel', value: false }, { label: 'Recognize text', value: true, primary: true }] });
  if (!r || !r.value) return; const idxs = /^\s*all\s*$/i.test(r.form.range) ? [...Array(doc.numPages).keys()] : parseRange(r.form.range, doc.numPages); if (!idxs.length) { toast('Enter page numbers like 1-3, 5 or all', 'error'); return; }
  await runOcr(doc, idxs);
}
async function runOcr(doc, idxs) {
  const busy = $('#busy'); busy.hidden = false; const say = (t) => { busy.textContent = t; };
  try {
    say('Starting OCR…'); const engine = await getOcrEngine(say); let words = 0;
    for (const [k, i] of idxs.entries()) {
      say(`OCR page ${i + 1} (${k + 1} of ${idxs.length})…`); const pg = doc.pages[i]; const s = Math.min(300 / 72, Math.sqrt(15e6 / (pg.w * pg.h)), 4200 / Math.max(pg.w, pg.h));
      const canvas = await renderToCanvas(doc, i, s); const found = await engine.recognize(canvas, say);
      doc.ocr[i] = found.map((w) => ({ str: w.str, x: w.x0 / s, y: w.y0 / s, w: Math.max(1, (w.x1 - w.x0) / s), h: Math.max(1, (w.y1 - w.y0) / s) })); words += found.length;
      doc.textCache[i] = null;
    }
    markDirty(doc); state.search.hits = []; renderSearchHits(); toast(`OCR found ${words} word${words === 1 ? '' : 's'} with ${engine.name}. Search, highlight and Edit text now work on ${idxs.length === 1 ? 'that page' : 'those pages'}.`);
  } catch (e) { console.error(e); toast(e.message || String(e), 'error'); } finally { busy.hidden = true; }
}
// invisible text layer for saved PDFs
function bakeOcr(pdfDoc, doc, fonts) {
  const pages = pdfDoc.getPages();
  Object.entries(doc.ocr || {}).forEach(([k, items]) => {
    const i = +k; const page = pages[i]; if (!page || !items || !items.length) return;
    const lines = [`${invertT(doc.pages[i].T).map((v) => num(v, 6)).join(' ')} cm`, 'BT', '3 Tr'];
    items.forEach((w) => { const size = w.h * 0.92; const tw = textWidth(w.str, size, false) || 1; const tz = clamp((100 * w.w) / tw, 5, 2000);
      lines.push(`/FR 1 Tf ${num(tz, 2)} Tz ${num(size, 3)} 0 0 ${num(-size, 3)} ${num(w.x, 3)} ${num(w.y + w.h * 0.8, 3)} Tm ${winAnsiHex(w.str)} Tj`); });
    lines.push('ET'); const res = pdfDoc.context.obj({ Font: { FR: fonts.reg.ref } });
    appendPageContent(pdfDoc, page, lines.join('\n'), res, [PM_MARK.ocrStart, PM_MARK.ocr]);
  });
}
