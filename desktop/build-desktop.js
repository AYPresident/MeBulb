// Build the portable desktop app.
//   node desktop/build-desktop.js            -> out/app (the app folder) + Linux test copy
//   node desktop/build-desktop.js --win      -> dist/MeBulb-<ver>-portable-win-x64.zip
//   node desktop/build-desktop.js --mac      -> dist/MeBulb-<ver>-portable-mac-{arm64,x64}.zip
//   node desktop/build-desktop.js --linux    -> dist/MeBulb-<ver>-portable-linux-x64.tar.gz
//   node desktop/build-desktop.js --all      -> win + mac + linux
// Mac/Linux Electron binaries are Electron 44.10.0 for darwin and linux x64.
// The app is the same single page as the web build, with pdf.js, its character maps,
// fonts and image decoders, and pdf-lib bundled locally (works offline, no CDN).
'use strict';
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..'); const OUT = path.join(ROOT, 'out'); const APP = path.join(OUT, 'app'); const WEB = path.join(APP, 'web');
const TP = require('../test/paths'); const PDFJS = TP.pdfjsDir(); const PDFLIB = path.join(TP.pdfLibDir(), 'dist/pdf-lib.min.js');
const ELECTRON_WIN = process.env.ELECTRON_WIN || '/tmp/dl/electron-win.zip'; const ELECTRON_LINUX = process.env.ELECTRON_LINUX || '/tmp/dl/linux';
const ELECTRON_LINUX_ZIP = process.env.ELECTRON_LINUX_ZIP || '/tmp/dl/electron-linux.zip';
const ELECTRON_MAC = { arm64: process.env.ELECTRON_MAC_ARM64 || '/tmp/dl/electron-darwin-arm64.zip', x64: process.env.ELECTRON_MAC_X64 || '/tmp/dl/electron-darwin-x64.zip' };
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

const DIST = path.join(ROOT, 'dist'); fs.mkdirSync(DIST, { recursive: true });
const MB = (p) => (fs.statSync(p).size / 1048576).toFixed(1) + ' MB';
const want = (f) => process.argv.includes('--all') || process.argv.includes(f);
// keep only English UI strings (the app ships its own UI text)
const trimLocales = (dir) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir)) if (!/^en-(US|GB)\.pak$/.test(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true }); };
// macOS keeps localisations as <lang>.lproj folders under Resources; keep English only
const trimLproj = (dir) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir)) if (/\.lproj$/.test(f) && !/^(en|en_GB|Base)\.lproj$/.test(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true }); };

// 4. Windows portable zip
if (want('--win')) {
  const W = path.join(OUT, 'MeBulb'); rm(W); fs.mkdirSync(W, { recursive: true });
  execSync(`unzip -q -o ${ELECTRON_WIN} -d ${W}`);
  fs.renameSync(path.join(W, 'electron.exe'), path.join(W, 'MeBulb.exe'));
  rm(path.join(W, 'resources/default_app.asar'));
  trimLocales(path.join(W, 'locales'));
  cp(APP, path.join(W, 'resources/app'));
  try { require('./pe-patch.js').patch(path.join(W, 'MeBulb.exe'), { icon: path.join(__dirname, 'assets/icon.ico'), version: VERSION }); console.log('exe icon and version info set'); } catch (e) { console.warn('exe left with the default icon:', e.message); }
  fs.copyFileSync(path.join(__dirname, 'README.txt'), path.join(W, 'README.txt'));
  const zip = path.join(DIST, `MeBulb-${VERSION}-portable-win-x64.zip`); rm(zip);
  execSync(`cd ${OUT} && zip -q -r -9 ${zip} MeBulb`);
  console.log('windows zip:', zip, MB(zip));
}

// 5. macOS portable .app (per arch), zipped with symlinks preserved
function buildMac(arch) {
  const src = ELECTRON_MAC[arch];
  if (!fs.existsSync(src)) { console.warn(`mac ${arch}: no electron zip at ${src}, skipped`); return; }
  const stage = path.join(OUT, `mac-${arch}`); rm(stage); fs.mkdirSync(stage, { recursive: true });
  execSync(`unzip -q -o ${src} -d ${stage}`);
  const app = path.join(stage, 'MeBulb.app'); fs.renameSync(path.join(stage, 'Electron.app'), app);
  const C = path.join(app, 'Contents');
  // rename the main executable and point the plist at it
  fs.renameSync(path.join(C, 'MacOS/Electron'), path.join(C, 'MacOS/MeBulb'));
  let plist = fs.readFileSync(path.join(C, 'Info.plist'), 'utf8');
  const setStr = (key, val) => {
    const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    if (re.test(plist)) plist = plist.replace(re, `$1${val}$2`);
    else plist = plist.replace('<dict>', `<dict>\n\t<key>${key}</key>\n\t<string>${val}</string>`);
  };
  setStr('CFBundleExecutable', 'MeBulb');
  setStr('CFBundleName', 'MeBulb');
  setStr('CFBundleDisplayName', 'MeBulb');
  setStr('CFBundleIdentifier', 'org.ay.mebulb');
  setStr('CFBundleIconFile', 'electron.icns');
  setStr('CFBundleShortVersionString', VERSION);
  setStr('CFBundleVersion', VERSION);
  fs.writeFileSync(path.join(C, 'Info.plist'), plist);
  // our icon in place of electron's, our app in place of the default app
  fs.copyFileSync(path.join(__dirname, 'assets/icon.icns'), path.join(C, 'Resources/electron.icns'));
  rm(path.join(C, 'Resources/default_app.asar'));
  trimLproj(path.join(C, 'Resources'));
  cp(APP, path.join(C, 'Resources/app'));
  fs.copyFileSync(path.join(__dirname, 'README.txt'), path.join(stage, 'README.txt'));
  fs.chmodSync(path.join(C, 'MacOS/MeBulb'), 0o755);
  const zip = path.join(DIST, `MeBulb-${VERSION}-portable-mac-${arch}.zip`); rm(zip);
  // -y keeps the framework symlinks; without it the bundle balloons and breaks signing/launch
  execSync(`cd ${stage} && zip -q -r -9 -y ${zip} MeBulb.app README.txt`);
  console.log(`mac ${arch} zip:`, zip, MB(zip));
}
if (want('--mac')) { buildMac('arm64'); buildMac('x64'); }

// 6. Linux portable tar.gz
if (want('--linux')) {
  const src = fs.existsSync(ELECTRON_LINUX) ? ELECTRON_LINUX : null;
  const L = path.join(OUT, 'MeBulb-linux'); rm(L); fs.mkdirSync(L, { recursive: true });
  if (src) cp(src, L); else execSync(`unzip -q -o ${ELECTRON_LINUX_ZIP} -d ${L}`);
  fs.renameSync(path.join(L, 'electron'), path.join(L, 'mebulb'));
  rm(path.join(L, 'resources/default_app.asar'));
  trimLocales(path.join(L, 'locales'));
  cp(APP, path.join(L, 'resources/app'));
  fs.chmodSync(path.join(L, 'mebulb'), 0o755);
  // chrome-sandbox needs root-owned setuid; portable users run without it
  const launcher = '#!/bin/sh\n# MeBulb portable launcher\nHERE="$(cd "$(dirname "$0")" && pwd)"\nexec "$HERE/mebulb" --no-sandbox "$@"\n';
  fs.writeFileSync(path.join(L, 'MeBulb'), launcher); fs.chmodSync(path.join(L, 'MeBulb'), 0o755);
  const desktop = `[Desktop Entry]\nType=Application\nName=MeBulb\nComment=PDF markup and takeoff for construction drawings\nExec=MeBulb %f\nIcon=mebulb\nCategories=Graphics;Engineering;\nMimeType=application/pdf;\n`;
  fs.writeFileSync(path.join(L, 'MeBulb.desktop'), desktop);
  fs.copyFileSync(path.join(__dirname, 'assets/icon.png'), path.join(L, 'mebulb.png'));
  fs.copyFileSync(path.join(__dirname, 'README.txt'), path.join(L, 'README.txt'));
  const stageTop = path.join(OUT, 'linux-pack'); rm(stageTop); fs.mkdirSync(stageTop, { recursive: true });
  fs.renameSync(L, path.join(stageTop, 'MeBulb'));
  const tgz = path.join(DIST, `MeBulb-${VERSION}-portable-linux-x64.tar.gz`); rm(tgz);
  execSync(`tar -C ${stageTop} -czf ${tgz} MeBulb`);
  console.log('linux tar.gz:', tgz, MB(tgz));
}
