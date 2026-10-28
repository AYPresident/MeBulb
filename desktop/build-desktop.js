// Build the portable desktop app.
//   node desktop/build-desktop.js            -> out/app (the app folder) + Linux test copy
//   node desktop/build-desktop.js --win      -> also dist/MeBulb-portable-win-x64.zip
// The app is the same single page as the web build, with pdf.js, its character maps,
// fonts and image decoders, and pdf-lib bundled locally (works offline, no CDN).
'use strict';
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..'); const OUT = path.join(ROOT, 'out'); const APP = path.join(OUT, 'app'); const WEB = path.join(APP, 'web');
const TP = require('../test/paths'); const PDFJS = TP.pdfjsDir(); const PDFLIB = path.join(TP.pdfLibDir(), 'dist/pdf-lib.min.js');
const ELECTRON_WIN = process.env.ELECTRON_WIN || '/tmp/dl/electron-win.zip'; const ELECTRON_LINUX = process.env.ELECTRON_LINUX || '/tmp/dl/linux';
const VERSION = require('./package.json').version;
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const cp = (a, b) => fs.cpSync(a, b, { recursive: true });

rm(APP); fs.mkdirSync(WEB, { recursive: true });
// 1. the page
const tmp = path.join(OUT, 'index.tmp.html');
execSync(`node ${path.join(ROOT, 'build.js')} ${tmp}`, { env: { ...process.env, DESKTOP: '1', PDFJS_BASE: 'app://mebulb/pdfjs/build', PDFLIB_URL: 'app://mebulb/vendor/pdf-lib.min.js', OCR_BASE: 'app://mebulb/ocr/' }, stdio: 'inherit' });
const csp = "default-src 'self' app:; script-src 'self' app: 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' app: 'unsafe-inline'; img-src 'self' app: data: blob:; font-src 'self' app: data:; worker-src 'self' app: blob:; connect-src 'self' app: data: blob:; object-src 'none'; base-uri 'none'";
const page = fs.readFileSync(tmp, 'utf8').replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
fs.writeFileSync(path.join(WEB, 'index.html'), `<!doctype html>\n<html lang="en">\n${page}</html>\n`); rm(tmp);
// 2. engines
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) { fs.mkdirSync(path.join(WEB, 'pdfjs/build'), { recursive: true }); fs.copyFileSync(path.join(PDFJS, 'build', f), path.join(WEB, 'pdfjs/build', f)); }
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) if (fs.existsSync(path.join(PDFJS, d))) cp(path.join(PDFJS, d), path.join(WEB, 'pdfjs', d));
fs.copyFileSync(path.join(PDFJS, 'LICENSE'), path.join(WEB, 'pdfjs/LICENSE'));
cp(path.join(ROOT, 'vendor/ocr'), path.join(WEB, 'ocr'));
fs.mkdirSync(path.join(WEB, 'vendor'), { recursive: true }); fs.copyFileSync(PDFLIB, path.join(WEB, 'vendor/pdf-lib.min.js'));
fs.copyFileSync(path.join(TP.pdfLibDir(), 'LICENSE.md'), path.join(WEB, 'vendor/pdf-lib-LICENSE.md'));
// 3. shell
for (const f of ['main.js', 'preload.js', 'package.json']) fs.copyFileSync(path.join(__dirname, f), path.join(APP, f));
fs.copyFileSync(path.join(__dirname, 'assets/icon.png'), path.join(APP, 'icon.png'));
console.log('app folder:', APP);

// Linux copy for automated testing
if (fs.existsSync(ELECTRON_LINUX)) { const L = path.join(OUT, 'linux-test'); rm(L); cp(ELECTRON_LINUX, L); rm(path.join(L, 'resources/default_app.asar')); cp(APP, path.join(L, 'resources/app')); console.log('linux test build:', L); }

// 4. Windows portable zip
if (process.argv.includes('--win')) {
  const W = path.join(OUT, 'MeBulb'); rm(W); fs.mkdirSync(W, { recursive: true });
  execSync(`unzip -q -o ${ELECTRON_WIN} -d ${W}`);
  fs.renameSync(path.join(W, 'electron.exe'), path.join(W, 'MeBulb.exe'));
  rm(path.join(W, 'resources/default_app.asar'));
  // keep English UI strings only (the app has its own UI text)
  for (const f of fs.readdirSync(path.join(W, 'locales'))) if (!/^en-(US|GB)\.pak$/.test(f)) fs.rmSync(path.join(W, 'locales', f));
  cp(APP, path.join(W, 'resources/app'));
  try { require('./pe-patch.js').patch(path.join(W, 'MeBulb.exe'), { icon: path.join(__dirname, 'assets/icon.ico'), version: VERSION }); console.log('exe icon and version info set'); } catch (e) { console.warn('exe left with the default icon:', e.message); }
  fs.copyFileSync(path.join(__dirname, 'README.txt'), path.join(W, 'README.txt'));
  const zip = path.join(ROOT, 'dist', `MeBulb-${VERSION}-portable-win-x64.zip`); rm(zip);
  execSync(`cd ${OUT} && zip -q -r -9 ${zip} MeBulb`);
  console.log('windows zip:', zip, (fs.statSync(zip).size / 1048576).toFixed(1) + ' MB');
}
