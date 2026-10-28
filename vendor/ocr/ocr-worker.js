// MeBulb OCR worker: runs Tesseract (WebAssembly) on page images, entirely offline.
// Messages in:  { id, type: 'init', base }            -> { id, ok }
//               { id, type: 'recognize', png, psm }   -> { id, words: [{ str, x0, y0, x1, y1, conf }] }
/* global TesseractCore */
let api = null; let Mod = null;
async function init(base) {
  if (api) return;
  importScripts(base + 'tesseract-core-simd-lstm.wasm.js');
  Mod = await TesseractCore({ print: () => {}, printErr: () => {} });
  // some web hosts only serve known file types, so the model may also be published as base64 text
  let data; const res = await fetch(base + 'eng.traineddata');
  if (res.ok) data = new Uint8Array(await res.arrayBuffer());
  else {
    const r2 = await fetch(base + 'eng.traineddata.b64.txt'); if (!r2.ok) throw new Error('The OCR model (eng.traineddata) is missing');
    const bin = atob((await r2.text()).replace(/\s+/g, '')); data = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  }
  Mod.FS.writeFile('/eng.traineddata', data);
  api = new Mod.TessBaseAPI();
  if (api.Init(null, 'eng', 1) !== 0) throw new Error('Tesseract could not load the English model');
}
function recognize(png, psm) {
  Mod.FS.writeFile('/input', new Uint8Array(png));
  api.SetVariable('tessedit_pageseg_mode', String(psm || 11)); // 11: sparse text, best for drawings
  api.SetVariable('preserve_interword_spaces', '1');
  if (api.SetImageFile(1, 0) === 1) throw new Error('Tesseract could not read the page image');
  api.Recognize(null);
  const tsv = api.GetTSVText(0) || ''; const words = [];
  for (const line of tsv.split('\n')) {
    const c = line.split('\t'); if (c.length < 12 || c[0] !== '5') continue;
    const str = c.slice(11).join('\t').trim(); const conf = +c[10]; if (!str || conf < 0) continue;
    const x = +c[6], y = +c[7], w = +c[8], h = +c[9]; words.push({ str, x0: x, y0: y, x1: x + w, y1: y + h, conf });
  }
  api.Clear(); try { Mod.FS.unlink('/input'); } catch (e) { /* already gone */ }
  return words;
}
self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'init') { await init(e.data.base); self.postMessage({ id, ok: true }); }
    else if (type === 'recognize') self.postMessage({ id, words: recognize(e.data.png, e.data.psm) });
  } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
};
