// MeBulb desktop shell (portable, no installer, no admin rights).
// Runs the same app as the web build from local files, and gives it what a browser cannot:
// direct file access for huge PDFs (range reads, in-place appends, atomic rewrites), the
// Windows font folders, and the hidden .mebulb folders used for live sharing over Egnyte.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu, nativeTheme, session } = require('electron');
const path = require('path'); const fs = require('fs'); const fsp = fs.promises; const os = require('os'); const { execFile } = require('child_process'); const { pathToFileURL } = require('url');

const APP_DIR = __dirname; const WEB_DIR = path.join(APP_DIR, 'web');
const isWin = process.platform === 'win32';
app.setName('MeBulb'); if (isWin) app.setAppUserModelId('com.mebulb.app');
if (process.env.MEBULB_USERDATA) app.setPath('userData', process.env.MEBULB_USERDATA);
const DATA = () => app.getPath('userData');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

// ----- single instance: a second launch (double-clicked PDF) opens in the running window ---------
if (!app.requestSingleInstanceLock()) { app.quit(); }
let win = null; const pendingOpen = [];
const pdfArgs = (argv) => argv.slice(1).filter((a) => /\.pdf$/i.test(a) && !a.startsWith('--')).map((a) => path.resolve(a));
pendingOpen.push(...pdfArgs(process.argv));
app.on('second-instance', (_e, argv) => { const files = pdfArgs(argv); if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (files.length) win.webContents.send('app:open', files); } });

// ----- open files: one read handle per PDF, kept open so big files stream on demand ---------------
const files = new Map(); let nextFid = 1;
async function openFid(p) {
  const fh = await fsp.open(p, 'r'); const st = await fh.stat(); const fid = nextFid++;
  files.set(fid, { fh, path: p });
  return { fid, path: p, name: path.basename(p), size: st.size, mtimeMs: st.mtimeMs, readOnly: await readOnly(p) };
}
// can we write the file? Egnyte makes a file locked by someone else read-only on this PC
async function readOnly(p) { try { const st = await fsp.stat(p); if (!(st.mode & 0o222)) return true; await fsp.access(p, fs.constants.W_OK); return false; } catch { return true; } } // no write bits: the Windows read-only attribute

// ----- holding a PDF open while it is open in MeBulb ------------------------------------------------------
// The Egnyte Desktop App locks a file in the cloud while an application keeps it open (a few seconds
// after the handle is opened), so colleagues opening it in Bluebeam or MeBulb are told it is locked
// and get it read-only. Small PDFs are read into memory, so without this nothing would be holding them.
const holds = new Map(); // resolved path -> { fh, n }
const holdKey = (p) => (isWin ? path.resolve(p).toLowerCase() : path.resolve(p));
async function hold(p) {
  const k = holdKey(p); const h = holds.get(k); if (h) { h.n++; return true; }
  try { const fh = await fsp.open(p, 'r'); holds.set(k, { fh, n: 1, path: p }); return true; } catch { return false; }
}
async function release(p) { const k = holdKey(p); const h = holds.get(k); if (!h) return; if (--h.n > 0) return; holds.delete(k); await h.fh.close().catch(() => {}); }
// a whole-file rewrite swaps in a new file: hold the new one
async function rehold(p) { const k = holdKey(p); const h = holds.get(k); if (!h) return; const old = h.fh; try { h.fh = await fsp.open(p, 'r'); } catch { } await old.close().catch(() => {}); }
ipcMain.handle('file:hold', (_e, p) => hold(p));
ipcMain.handle('file:release', (_e, p) => release(p));
ipcMain.handle('file:readOnly', (_e, p) => readOnly(p));
ipcMain.handle('file:holding', () => [...holds.values()].map((h) => h.path));
ipcMain.handle('file:openDialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open PDF', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled) return []; const out = []; for (const p of r.filePaths) out.push(await openFid(p)); return out;
});
ipcMain.handle('file:openPath', (_e, p) => openFid(p));
ipcMain.handle('file:read', async (_e, fid, off, len) => {
  const f = files.get(fid); if (!f) throw new Error('file closed');
  const buf = Buffer.allocUnsafe(len); let got = 0;
  while (got < len) { const { bytesRead } = await f.fh.read(buf, got, len - got, off + got); if (!bytesRead) break; got += bytesRead; }
  return got === len ? buf : buf.subarray(0, got);
});
ipcMain.handle('file:close', async (_e, fid) => { const f = files.get(fid); if (f) { files.delete(fid); await f.fh.close().catch(() => {}); } });
ipcMain.handle('file:stat', async (_e, p) => { try { const st = await fsp.stat(p); return { size: st.size, mtimeMs: st.mtimeMs }; } catch { return null; } });
const sameStat = (st, exp) => st && exp && st.size === exp.size && Math.abs(st.mtimeMs - exp.mtimeMs) < 2;
// append an incremental update to the end of the PDF, only if nobody changed the file meanwhile
ipcMain.handle('file:append', async (_e, p, bytes, expect) => {
  const st = await fsp.stat(p).catch(() => null); if (!sameStat(st, expect)) throw new Error('CHANGED');
  const fh = await fsp.open(p, 'r+');
  try { await fh.write(Buffer.from(bytes), 0, bytes.length, st.size); await fh.sync(); } finally { await fh.close(); }
  const s2 = await fsp.stat(p); return { size: s2.size, mtimeMs: s2.mtimeMs };
});
// write a whole file: a temp file beside it, then swap it in. Parts can point into an open file,
// so a 400 MB original is copied disk to disk, never through the renderer.
ipcMain.handle('file:write', async (_e, p, parts) => {
  const dir = path.dirname(p); const tmp = path.join(dir, `~${path.basename(p)}.${process.pid}.mebulb.tmp`);
  const fh = await fsp.open(tmp, 'w');
  try {
    for (const part of parts) {
      if (part && part.fid) {
        const f = files.get(part.fid); if (!f) throw new Error('source closed'); const CH = 8 << 20; const buf = Buffer.allocUnsafe(Math.min(CH, Math.max(1, part.len)));
        for (let o = 0; o < part.len; o += CH) { const n = Math.min(CH, part.len - o); const { bytesRead } = await f.fh.read(buf, 0, n, part.off + o); await fh.write(buf, 0, bytesRead); if (bytesRead < n) break; }
      } else { const b = Buffer.from(part.buffer ? new Uint8Array(part.buffer, part.byteOffset, part.byteLength) : part); await fh.write(b); }
    }
    await fh.sync();
  } finally { await fh.close(); }
  try { await fsp.rename(tmp, p); }
  catch (e) { // another program has the PDF open without sharing (Acrobat/Revu): write in place instead
    try { await fsp.copyFile(tmp, p); await fsp.unlink(tmp); } catch (e2) { await fsp.unlink(tmp).catch(() => {}); throw new Error(`Could not write ${path.basename(p)}. Is it open in another program? (${e2.code || e2.message})`); }
  }
  await rehold(p); const st = await fsp.stat(p); return { size: st.size, mtimeMs: st.mtimeMs };
});
ipcMain.handle('file:saveDialog', async (_e, opts = {}) => {
  const r = await dialog.showSaveDialog(win, { title: opts.title || 'Save PDF', defaultPath: opts.defaultPath, filters: opts.filters || [{ name: 'PDF', extensions: ['pdf'] }] });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('file:saveOther', async (_e, name, bytes, filters) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters }); if (r.canceled) return null;
  await fsp.writeFile(r.filePath, Buffer.from(bytes)); return r.filePath;
});
ipcMain.handle('file:reveal', (_e, p) => { shell.showItemInFolder(p); });

// ----- recent files and small settings ----------------------------------------------------------------
const jsonPath = (n) => path.join(DATA(), n);
async function readJson(n, d) { try { return JSON.parse(await fsp.readFile(jsonPath(n), 'utf8')); } catch { return d; } }
async function writeJson(n, v) { await fsp.mkdir(DATA(), { recursive: true }); const t = jsonPath(n) + '.tmp'; await fsp.writeFile(t, JSON.stringify(v)); await fsp.rename(t, jsonPath(n)); }
ipcMain.handle('recent:get', () => readJson('recent.json', []));
ipcMain.handle('recent:add', async (_e, p) => { let r = await readJson('recent.json', []); r = [p, ...r.filter((x) => x !== p)].slice(0, 15); await writeJson('recent.json', r); return r; });
ipcMain.handle('recent:remove', async (_e, p) => { const r = (await readJson('recent.json', [])).filter((x) => x !== p); await writeJson('recent.json', r); return r; });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, platform: process.platform, user: process.env.MEBULB_USER || os.userInfo().username, host: process.env.MEBULB_HOST || os.hostname(), data: DATA(), exe: process.execPath }));

// ----- fonts installed on this PC ------------------------------------------------------------------
function fontDirs() {
  if (isWin) { const w = process.env.WINDIR || 'C:\\Windows'; const l = process.env.LOCALAPPDATA; return [path.join(w, 'Fonts'), l && path.join(l, 'Microsoft', 'Windows', 'Fonts')].filter(Boolean); }
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local/share/fonts')];
}
async function walkFonts(dir, out, depth = 0) {
  let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory() && depth < 4) await walkFonts(p, out, depth + 1); else if (/\.(ttf|otf|ttc)$/i.test(e.name)) out.push(p); }
}
// read just the name and OS/2 tables of a font file
async function fontNames(p) {
  const fh = await fsp.open(p, 'r'); const out = [];
  try {
    const rd = async (o, n) => { const b = Buffer.alloc(n); await fh.read(b, 0, n, o); return b; };
    const head = await rd(0, 12); let dirs = [0];
    if (head.toString('latin1', 0, 4) === 'ttcf') { const n = head.readUInt32BE(8); const ob = await rd(12, 4 * Math.min(n, 64)); dirs = []; for (let i = 0; i < Math.min(n, 64); i++) dirs.push(ob.readUInt32BE(i * 4)); }
    for (let index = 0; index < dirs.length; index++) {
      const d = dirs[index]; const h = await rd(d, 12); const nt = h.readUInt16BE(4); const tb = await rd(d + 12, nt * 16); const t = {};
      for (let i = 0; i < nt; i++) t[tb.toString('latin1', i * 16, i * 16 + 4)] = { off: tb.readUInt32BE(i * 16 + 8), len: tb.readUInt32BE(i * 16 + 12) };
      if (!t.name || !t.cmap) continue; const nb = await rd(t.name.off, Math.min(t.name.len, 1 << 18));
      const count = nb.readUInt16BE(2), so = nb.readUInt16BE(4); const best = {}; const names = {};
      for (let i = 0; i < count; i++) {
        const r = 6 + i * 12; if (r + 12 > nb.length) break; const pl = nb.readUInt16BE(r), en = nb.readUInt16BE(r + 2), la = nb.readUInt16BE(r + 4), id = nb.readUInt16BE(r + 6), len = nb.readUInt16BE(r + 8), off = nb.readUInt16BE(r + 10);
        if (![1, 2, 4, 6].includes(id)) continue; const rank = pl === 3 && (en === 1 || en === 10) ? (la === 0x409 ? 0 : 1) : pl === 0 ? 2 : pl === 1 && en === 0 ? 3 : 9; if (rank >= 9 || (best[id] != null && best[id] <= rank)) continue;
        const s0 = so + off; if (s0 + len > nb.length) continue; let s = ''; if (pl === 3 || pl === 0) { for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(nb.readUInt16BE(s0 + j)); } else s = nb.toString('latin1', s0, s0 + len);
        best[id] = rank; names[id] = s;
      }
      let weight = 400; if (t['OS/2']) { const ob = await rd(t['OS/2'].off, 8); weight = ob.readUInt16BE(4); }
      if (names[1]) out.push({ family: names[1], sub: names[2] || 'Regular', full: names[4] || '', ps: names[6] || '', weight, path: p, index, cff: !!t['CFF '] });
    }
  } finally { await fh.close(); }
  return out;
}
ipcMain.handle('fonts:list', async () => {
  const paths = []; for (const d of fontDirs()) await walkFonts(d, paths);
  const cache = await readJson('fonts-cache.json', {}); const next = {}; const list = []; let changed = false;
  for (const p of paths) {
    let st; try { st = await fsp.stat(p); } catch { continue; } const key = `${p}|${st.size}|${Math.round(st.mtimeMs)}`;
    let faces = cache[key]; if (!faces) { try { faces = await fontNames(p); } catch { faces = []; } changed = true; }
    next[key] = faces; list.push(...faces);
  }
  if (changed || Object.keys(cache).length !== Object.keys(next).length) await writeJson('fonts-cache.json', next).catch(() => {});
  return list;
});
ipcMain.handle('fonts:bytes', async (_e, p) => { const ok = fontDirs().some((d) => path.resolve(p).toLowerCase().startsWith(path.resolve(d).toLowerCase())); if (!ok) throw new Error('not a font folder'); return fsp.readFile(p); });

// ----- live sharing over Egnyte: a hidden .mebulb folder beside the PDF ---------------------------
// Only paths inside a .mebulb folder (or the local outbox) can be written through these calls.
const OUTBOX = () => path.join(DATA(), 'outbox');
function guard(p) { const r = path.resolve(p); if (r.split(path.sep).includes('.mebulb') || r.startsWith(path.resolve(OUTBOX()))) return r; throw new Error('path not allowed'); }
function hide(dir) { return new Promise((res) => { if (!isWin) return res(); execFile('attrib', ['+h', dir], { windowsHide: true }, () => res()); }); }
ipcMain.handle('sess:dir', async (_e, pdfPath) => { const d = path.join(path.dirname(pdfPath), '.mebulb'); const had = fs.existsSync(d); await fsp.mkdir(d, { recursive: true }); if (!had) await hide(d); return d; });
ipcMain.handle('sess:list', async (_e, dir) => { const d = guard(dir); let ents = []; try { ents = await fsp.readdir(d); } catch { return []; } const out = []; for (const n of ents) { try { const st = await fsp.stat(path.join(d, n)); if (st.isFile()) out.push({ name: n, size: st.size, mtimeMs: st.mtimeMs }); } catch { } } return out; });
ipcMain.handle('sess:read', async (_e, p, from = 0) => { const r = guard(p); try { const fh = await fsp.open(r, 'r'); try { const st = await fh.stat(); const n = Math.max(0, st.size - from); const b = Buffer.alloc(n); if (n) await fh.read(b, 0, n, from); return { text: b.toString('utf8'), size: st.size }; } finally { await fh.close(); } } catch (e) { if (e.code === 'ENOENT') return null; throw e; } });
ipcMain.handle('sess:append', async (_e, p, text) => { const r = guard(p); await fsp.mkdir(path.dirname(r), { recursive: true }); await fsp.appendFile(r, text, 'utf8'); const st = await fsp.stat(r); return st.size; });
ipcMain.handle('sess:write', async (_e, p, text) => { const r = guard(p); await fsp.mkdir(path.dirname(r), { recursive: true }); const t = r + '.tmp'; await fsp.writeFile(t, text, 'utf8'); await fsp.rename(t, r).catch(async () => { await fsp.writeFile(r, text, 'utf8'); await fsp.unlink(t).catch(() => {}); }); return true; });
ipcMain.handle('sess:rm', async (_e, p) => { await fsp.unlink(guard(p)).catch(() => {}); return true; });
const watchers = new Map();
ipcMain.handle('sess:watch', (_e, dir) => {
  const d = guard(dir); if (watchers.has(d)) return true;
  try { const w = fs.watch(d, { persistent: false }, (ev, name) => { if (win && name) win.webContents.send('sess:changed', d, String(name)); }); w.on('error', () => { watchers.delete(d); }); watchers.set(d, w); } catch { return false; }
  return true;
});
ipcMain.handle('sess:unwatch', (_e, dir) => { const d = path.resolve(dir); const w = watchers.get(d); if (w) { w.close(); watchers.delete(d); } return true; });
ipcMain.handle('outbox:dir', async () => { await fsp.mkdir(OUTBOX(), { recursive: true }); return OUTBOX(); });

// ----- stamp library: AppData\MeBulb\stamps plus an optional shared team folder ----------------------
const STAMPS_DIR = () => path.join(DATA(), 'stamps');
async function listStampDir(dir, shared) { let ents = []; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; } const out = []; for (const e of ents) { if (!e.isFile() || !/\.(pdf|brx)$/i.test(e.name)) continue; const p = path.join(dir, e.name); try { const st = await fsp.stat(p); out.push({ path: p, name: e.name, size: st.size, shared }); } catch { } } return out.sort((a, b) => a.name.localeCompare(b.name)); }
const stampRoots = new Set();
ipcMain.handle('stamps:list', async (_e, team) => { await fsp.mkdir(STAMPS_DIR(), { recursive: true }); stampRoots.clear(); stampRoots.add(path.resolve(STAMPS_DIR())); if (team) stampRoots.add(path.resolve(team)); return [...(await listStampDir(STAMPS_DIR(), false)), ...(team ? await listStampDir(team, true) : [])]; });
const inStampRoots = (p) => [...stampRoots].some((r) => path.resolve(p).toLowerCase().startsWith(r.toLowerCase() + path.sep.toLowerCase()) || path.dirname(path.resolve(p)).toLowerCase() === r.toLowerCase());
ipcMain.handle('stamps:read', async (_e, p) => { if (!inStampRoots(p)) throw new Error('not a stamp folder'); return fsp.readFile(p); });
ipcMain.handle('stamps:add', async (_e, name, bytes) => { await fsp.mkdir(STAMPS_DIR(), { recursive: true }); let base = path.basename(String(name)).replace(/[\\/:*?"<>|]/g, '_'); if (!/\.pdf$/i.test(base)) base += '.pdf'; let p = path.join(STAMPS_DIR(), base); let k = 1; while (fs.existsSync(p)) p = path.join(STAMPS_DIR(), base.replace(/\.pdf$/i, ` (${++k}).pdf`)); await fsp.writeFile(p, Buffer.from(bytes)); return p; });
ipcMain.handle('stamps:remove', async (_e, p) => { if (path.dirname(path.resolve(p)).toLowerCase() !== path.resolve(STAMPS_DIR()).toLowerCase()) throw new Error('only your own stamps can be removed'); await fsp.unlink(p); return true; });
ipcMain.handle('dialog:folder', async (_e, title) => { const r = await dialog.showOpenDialog(win, { title: title || 'Choose folder', properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });

// ----- printing: straight to the chosen printer, paper size from MeBulb's print dialog ------------------
ipcMain.handle('print:printers', async () => { if (!win) return []; try { return (await win.webContents.getPrintersAsync()).map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault, status: p.status, description: p.description })); } catch { return []; } });
ipcMain.handle('print:run', async (_e, job) => {
  const first = job.sheets[0]; const mm = (v) => Math.round(v * 1000); // Electron wants microns
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${first.pw}mm ${first.ph}mm;margin:0}html,body{margin:0;padding:0}.s{position:relative;overflow:hidden;page-break-after:always;break-after:page}.s:last-child{page-break-after:auto;break-after:auto}.s img{position:absolute}</style></head><body>${job.sheets.map((x) => `<div class="s" style="width:${x.pw}mm;height:${x.ph}mm"><img src="${x.url}" style="left:${x.x}mm;top:${x.y}mm;width:${x.w}mm;height:${x.h}mm"></div>`).join('')}</body></html>`;
  const tmp = path.join(os.tmpdir(), `mebulb-print-${process.pid}-${Date.now()}.html`); await fsp.writeFile(tmp, html);
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await pw.loadFile(tmp);
    return await new Promise((resolve) => pw.webContents.print({ silent: !!job.printer, deviceName: job.printer || undefined, printBackground: true, color: job.color !== false, copies: job.copies || 1, margins: { marginType: 'none' }, pageSize: { width: mm(first.pw), height: mm(first.ph) }, landscape: false, header: '', footer: '' }, (ok, err) => resolve(ok ? { ok: true } : { ok: false, error: err === 'cancelled' ? null : err })));
  } finally { pw.destroy(); fsp.unlink(tmp).catch(() => {}); }
});

// ----- window ------------------------------------------------------------------------------------------
ipcMain.handle('win:titlebar', (_e, c) => { if (win && isWin && win.setTitleBarOverlay) { try { win.setTitleBarOverlay({ color: c.bg, symbolColor: c.fg, height: c.h || 32 }); } catch { } } });
ipcMain.handle('win:title', (_e, t) => { if (win) win.setTitle(t); });
ipcMain.handle('win:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); return win ? win.isFullScreen() : false; });
ipcMain.handle('win:devtools', () => { if (win) win.webContents.toggleDevTools(); });
ipcMain.on('app:close-ok', () => { closing = true; if (win) win.close(); });
let closing = false;

function createWindow() {
  const bounds = readWinState();
  win = new BrowserWindow({
    width: bounds.width || 1500, height: bounds.height || 950, x: bounds.x, y: bounds.y, minWidth: 720, minHeight: 480, show: false, title: 'MeBulb',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f2329' : '#eceef1', icon: path.join(APP_DIR, 'icon.png'),
    titleBarStyle: isWin ? 'hidden' : 'default', titleBarOverlay: isWin ? { color: nativeTheme.shouldUseDarkColors ? '#2b3038' : '#f3f4f6', symbolColor: nativeTheme.shouldUseDarkColors ? '#e6e8eb' : '#1f2329', height: 32 } : false,
    webPreferences: { preload: path.join(APP_DIR, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
  });
  if (bounds.max) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F12' && input.control && input.shift) { win.webContents.toggleDevTools(); e.preventDefault(); } });
  win.on('close', (e) => { saveWinState(); if (closing) return; e.preventDefault(); win.webContents.send('app:close-request'); });
  win.on('closed', () => { win = null; });
  win.webContents.on('did-finish-load', () => { if (pendingOpen.length) { win.webContents.send('app:open', pendingOpen.splice(0)); } });
  win.loadURL('app://mebulb/index.html');
}
function readWinState() { try { return JSON.parse(fs.readFileSync(jsonPath('window.json'), 'utf8')); } catch { return {}; } }
function saveWinState() { if (!win) return; try { const b = win.getNormalBounds(); fs.mkdirSync(DATA(), { recursive: true }); fs.writeFileSync(jsonPath('window.json'), JSON.stringify({ ...b, max: win.isMaximized() })); } catch { } }

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', (req) => {
    const u = new URL(req.url); const rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''); const p = path.normalize(path.join(WEB_DIR, rel));
    if (!p.startsWith(WEB_DIR)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['local-fonts', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['local-fonts', 'clipboard-sanitized-write', 'fullscreen'].includes(perm));
  createWindow();
});
app.on('window-all-closed', () => { for (const f of files.values()) f.fh.close().catch(() => {}); for (const h of holds.values()) h.fh.close().catch(() => {}); for (const w of watchers.values()) w.close(); app.quit(); });
