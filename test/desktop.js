// Desktop app end to end (Linux Electron build of the same app): big file streaming,
// incremental save to disk, installed fonts, live session between two running copies.
const { _electron } = require('./paths').playwright();
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const OUT = '/home/claude/planmark/test/out'; const EXE = '/home/claude/planmark/out/linux-test/electron';
const PDF = '/tmp/claude-0/egnyte/Project/L1 Big Plan.pdf';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function start(user) {
  const data = `/tmp/claude-0/mb-${user}`; fs.rmSync(data, { recursive: true, force: true });
  const app = await _electron.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu'], env: { ...process.env, MEBULB_USERDATA: data, MEBULB_USER: user, MEBULB_HOST: 'pc-' + user } });
  const win = await app.firstWindow(); const errors = [];
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await win.waitForFunction(() => window.__mebulbReady === true, null, { timeout: 30000 });
  return { app, win, errors, ev: (fn, a) => win.evaluate(fn, a) };
}
(async () => {
  const size0 = fs.statSync(PDF).size;
  const A = await start('alice');
  ok(await A.ev(() => !!window.mebulbHost && document.body.classList.contains('desktop')), 'desktop bridge present');
  ok(await A.ev(() => !document.querySelector('#empty').hidden && mebulb.state.docs.length === 0), 'starts on the start page (no sample)');
  // big file
  const t0 = Date.now();
  const info = await A.ev(async (p) => { const d = await mebulb.openPath(p); await new Promise((r) => setTimeout(r, 1500)); return { kind: d.src.kind, pages: d.numPages, size: d.src.size, path: d.path }; }, PDF);
  ok(info.kind === 'host' && info.pages === 3, `60 MB PDF streamed from disk (${info.kind}, ${info.pages} pages) opened in ${Date.now() - t0} ms`);
  await A.win.screenshot({ path: OUT + '/desk-open.png' });
  // fonts from the system font folders
  const fl = await A.ev(async () => { for (let k = 0; k < 40 && !mebulb.FONTS.loaded; k++) await new Promise((r) => setTimeout(r, 250)); return mebulb.FONTS.list; });
  ok(fl.length > 10 && fl.includes('Liberation Sans'), `${fl.length} installed font families listed (e.g. ${fl.slice(0, 5).join(', ')})`);
  // add markups: text in Liberation Sans + a riser, then save
  const r1 = await A.ev(async () => {
    const d = mebulb.activeDoc(); const now = new Date().toISOString();
    d.markups.push({ id: 'PM-t1', type: 'text', page: 0, pts: [[400, 300], [700, 360]], text: 'Desktop save test', style: { stroke: '#d03030', fill: 'none', width: 0, opacity: 1, fontSize: 18, font: 'sys:Liberation Sans', fontColor: '#d03030' }, author: 'Alice', created: now, modified: now, layer: '' });
    d.dirty = true; await mebulb.ensureDocFonts(d); mebulb.renderAllMarks(d);
    const t = performance.now(); await mebulb.saveDoc('save'); return { ms: Math.round(performance.now() - t), dirty: d.dirty, status: document.querySelector('#status-text').textContent };
  });
  const size1 = fs.statSync(PDF).size;
  ok(!r1.dirty && size1 > size0 && size1 - size0 < 200000, `saved by appending ${size1 - size0} bytes to a ${(size0 / 1048576).toFixed(0)} MB file in ${r1.ms} ms — "${r1.status}"`);
  ok(/No syntax or stream encoding errors/.test(execSync(`qpdf --check "${PDF}" 2>&1 || true`, { encoding: 'utf8' })), 'saved file passes qpdf');
  ok(/\+LiberationSans/.test(execSync(`pdffonts "${PDF}"`, { encoding: 'utf8' })), 'installed font embedded in the saved PDF');
  // second instance: Bob opens the same PDF; Alice starts a live session first
  await A.ev(async () => { await mebulb.sessionStart(); });
  ok(fs.existsSync(path.join(path.dirname(PDF), '.mebulb')), 'hidden .mebulb folder created beside the PDF');
  const B = await start('bob');
  const joinP = B.ev(async (p) => { mebulb.openPath(p); return true; }, PDF);
  await joinP; await B.win.waitForSelector('#modal-back:not([hidden])', { timeout: 15000 }).catch(() => {});
  const prompt = await B.ev(() => document.querySelector('#modal') && !document.querySelector('#modal-back').hidden ? document.querySelector('#modal').textContent : '');
  ok(/alice/i.test(prompt) && /join/i.test(prompt), 'Bob is asked to join: ' + prompt.replace(/\s+/g, ' ').slice(0, 90));
  await B.win.click('#modal footer button:has-text("Join")'); await sleep(1500);
  const bs = await B.ev(() => ({ live: !!mebulb.activeDoc().sess, n: mebulb.activeDoc().markups.length }));
  ok(bs.live && bs.n === 1, `Bob joined live with ${bs.n} markup`);
  // Alice adds a riser; Bob should see it within a few seconds
  await A.ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); d.markups.push({ id: 'PM-r1', type: 'rect', page: 0, pts: [[900, 500], [980, 560]], style: { stroke: '#1971c2', fill: 'none', width: 2, opacity: 1 }, author: 'Alice', created: now, modified: now, layer: '' }); mebulb.renderAllMarks(d); mebulb.state.docs[0].dirty = true; });
  await A.ev(() => { mebulb.activeDoc(); }); 
  let seen = false; for (let k = 0; k < 20 && !seen; k++) { await sleep(500); seen = await B.ev(() => !!mebulb.activeDoc().markups.find((m) => m.id === 'PM-r1')); }
  ok(seen, 'Alice\'s new markup appears for Bob');
  // Bob moves it; Alice sees the move
  await B.ev(() => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === 'PM-r1'); m.pts = [[1000, 600], [1080, 660]]; m.modified = new Date().toISOString(); mebulb.renderAllMarks(d); });
  let moved = false; for (let k = 0; k < 20 && !moved; k++) { await sleep(500); moved = await A.ev(() => { const m = mebulb.activeDoc().markups.find((x) => x.id === 'PM-r1'); return !!m && m.pts[0][0] === 1000; }); }
  ok(moved, 'Bob\'s move appears for Alice');
  // both edit different markups at once, then Bob deletes Alice's text: everything converges
  await A.ev(() => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === 'PM-r1'); m.style.stroke = '#e8590c'; m.modified = new Date().toISOString(); });
  await B.ev(() => { const d = mebulb.activeDoc(); d.markups = d.markups.filter((x) => x.id !== 'PM-t1'); mebulb.renderAllMarks(d); });
  await sleep(6000);
  const sA = await A.ev(() => JSON.stringify(mebulb.activeDoc().markups.map((m) => [m.id, m.style.stroke, m.pts[0]]).sort()));
  const sB = await B.ev(() => JSON.stringify(mebulb.activeDoc().markups.map((m) => [m.id, m.style.stroke, m.pts[0]]).sort()));
  ok(sA === sB && /e8590c/.test(sA) && !/PM-t1/.test(sA), 'both copies converge: ' + sA);
  // presence and panel
  await A.ev(() => mebulb.renderSessionPanel()); await A.ev(() => window.mebulb && document.querySelector('[data-panel="session"]') ? 0 : 0);
  const peers = await A.ev(async () => { await new Promise((r) => setTimeout(r, 200)); return [...mebulb.activeDoc().sess.peers.values()].map((p) => p.name); });
  ok(peers.length === 1, 'Alice sees Bob in the session: ' + peers.join(', '));
  await A.ev(() => { const b = document.querySelector('#session-badge'); b && b.click(); });
  await sleep(400); await A.win.screenshot({ path: OUT + '/desk-live-alice.png' });
  // Bob saves; Alice notices, rebases on Bob's file, and is clean if nothing else changed
  const before = fs.statSync(PDF).size;
  await B.ev(async () => { await mebulb.saveDoc('save'); });
  const afterB = fs.statSync(PDF).size; ok(afterB > before, `Bob's save appended ${afterB - before} bytes`);
  let rebased = false; for (let k = 0; k < 24 && !rebased; k++) { await sleep(500); rebased = await A.ev(() => mebulb.activeDoc().stat.size); rebased = rebased === afterB; }
  ok(rebased, 'Alice picked up Bob\'s saved file as her new base');
  const aClean = await A.ev(() => mebulb.activeDoc().dirty); ok(aClean === false, 'Alice shows no unsaved changes after Bob saved the same markups');
  // Alice adds one more and saves on top of Bob's save (append chain across users)
  await A.ev(async () => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); d.markups.push({ id: 'PM-r2', type: 'ellipse', page: 1, pts: [[300, 300], [380, 360]], style: { stroke: '#2b8a3e', fill: 'none', width: 2, opacity: 1 }, author: 'Alice', created: now, modified: now, layer: '' }); d.dirty = true; await mebulb.saveDoc('save'); });
  ok(/No syntax or stream encoding errors/.test(execSync(`qpdf --check "${PDF}" 2>&1 || true`, { encoding: 'utf8' })), 'file valid after saves by two people');
  const pm = execSync(`python3 -c "
import re,sys,zlib
d=open(sys.argv[1],'rb').read()
print(d.count(b'/MeBulbData'))
" "${PDF}"`, { encoding: 'utf8' }).trim(); console.log('MeBulbData occurrences (one per save):', pm);
  // close: unsaved prompt
  await B.ev(() => { mebulb.activeDoc().dirty = true; });
  await B.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await B.win.waitForSelector('#modal-back:not([hidden])', { timeout: 5000 }).catch(() => {});
  const closeTxt = await B.ev(() => document.querySelector('#modal').textContent).catch(() => '');
  ok(/unsaved/i.test(closeTxt), 'closing with unsaved work asks first');
  await B.win.click('#modal footer button:has-text("Don\'t save")').catch(() => {});
  await sleep(800);
  console.log('A errors:', A.errors.join('\n') || 'none'); console.log('B errors:', B.errors.join('\n') || 'none');
  await A.app.close().catch(() => {}); await B.app.close().catch(() => {});
})();
