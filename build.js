// Assemble src/ into one self-contained HTML page.
const fs = require('fs'); const path = require('path');
const root = __dirname; const js = fs.readdirSync(path.join(root, 'src/js')).filter((f) => f.endsWith('.js')).sort();
const metrics = fs.readFileSync(path.join(root, 'metrics.json'), 'utf8').trim();
let code = js.map((f) => `// ---- ${f}\n` + fs.readFileSync(path.join(root, 'src/js', f), 'utf8')).join('\n');
code = code.replace('/*METRICS*/', metrics);
const PDFJS = process.env.PDFJS_BASE || 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build';
const PDFLIB = process.env.PDFLIB_URL || 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
const DESKTOP = !!process.env.DESKTOP;
// the desktop app ships pdf.js with its character maps, standard fonts and image decoders (JPEG 2000)
const ASSETS = DESKTOP ? `{ cMapUrl: '${PDFJS}/../cmaps/', cMapPacked: true, standardFontDataUrl: '${PDFJS}/../standard_fonts/', wasmUrl: '${PDFJS}/../wasm/', iccUrl: '${PDFJS}/../iccs/' }` : '{}';
const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
const body = fs.readFileSync(path.join(root, 'src/body.html'), 'utf8');
const html = `<title>MeBulb</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
${css}
</style>
${body}
<script src="${PDFLIB}"></script>
<script>
setTimeout(function () { if (!window.__mebulbReady) { var e = document.getElementById('empty'); if (e) { e.hidden = false; e.querySelector('h1').textContent = 'The PDF engine did not load'; e.querySelector('p').textContent = 'MeBulb loads pdf.js and pdf-lib from cdn.jsdelivr.net. Check your connection or network filters, then reload.'; } } }, 12000);
</script>
<script type="module">
import * as pdfjsLib from '${PDFJS}/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS}/pdf.worker.min.mjs';
const PDFJS_ASSETS = ${ASSETS};
const OCR_BASE = '${process.env.OCR_BASE || 'ocr/'}';
${code}
</script>
`;
const out = process.argv[2] || path.join(root, 'dist/mebulb.html');
fs.writeFileSync(out, html); console.log('wrote', out, (html.length / 1024).toFixed(1) + ' KB');
