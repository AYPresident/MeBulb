// Riser label: centre position, drag with leader arrow, ask dialog, follow/floor modes, reset
const { launch } = require('./harness');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1500, height: 950 } });
  const ev = (fn, a) => page.evaluate(fn, a);
  const info = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.type === 'sketch' && mebulb.sketchName(d, x) === 'M1' && x.page === 0); return { id: m.id, link: m.link, n: mebulb.linkSiblings(d, m).length }; });
  ok(info.n >= 2, 'M1 linked over ' + info.n + ' floors');
  // select M1 and set centre position
  await ev((id) => { const S = mebulb.state; S.sel.clear(); S.sel.add(id); mebulb.refreshPanels(); }, info.id);
  await mebulb_wait(page);
  await page.goto; // noop
  const hasCenter = await ev(() => !!document.querySelector('#props select[data-k="style.labelPos"] option[value="center"]'));
  ok(hasCenter, 'Label position offers Middle of the shape');
  await page.selectOption('#props select[data-k="style.labelPos"]', 'center');
  await page.waitForTimeout(200);
  const pos = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); return m.style.labelPos; }, info.id);
  ok(pos === 'center', 'labelPos saved as center');
  // find label hit rect
  const lab = await ev((id) => { const el = document.querySelector(`[data-id="${id}"] [data-part="label"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, info.id);
  ok(!!lab, 'label has a drag handle');
  // drag 160px right / 90 up
  await page.mouse.move(lab.x, lab.y); await page.mouse.down(); await page.mouse.move(lab.x + 80, lab.y - 40, { steps: 4 }); await page.mouse.move(lab.x + 160, lab.y - 90, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const dlg = await ev(() => { const m = document.querySelector('#modal'); return m && !document.querySelector('#modal-back').hidden ? m.textContent : null; });
  ok(dlg && /other floors/i.test(dlg), 'asks about other floors: ' + (dlg || '').slice(0, 80));
  await page.screenshot({ path: OUT + '/label-ask.png' });
  // tick "don't ask" and pick All floors
  await page.check('#modal input[type=checkbox]');
  await page.click('#modal footer button:has-text("All floors")');
  await page.waitForTimeout(300);
  const r = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); return { off: m.labelOff, sibs: mebulb.linkSiblings(d, m).map((x) => x.labelOff && x.labelOff.map((v) => Math.round(v))), pref: mebulb.state.prefs.linkLabelMode, arrow: !!document.querySelector(`[data-id="${id}"] path`) }; }, info.id);
  ok(r.off && Math.abs(r.off[0]) > 20, 'label offset stored ' + JSON.stringify(r.off));
  ok(r.sibs.every((s) => s), 'all floors got an offset ' + JSON.stringify(r.sibs));
  ok(r.pref === 'follow', 'never ask again -> pref follow');
  await page.screenshot({ path: OUT + '/label-drag.png' });
  // zoom screenshot near the riser
  const box = await ev((id) => { const el = document.querySelector(`[data-id="${id}"]`); const r = el.getBoundingClientRect(); return { x: r.x - 60, y: r.y - 60, width: r.width + 120, height: r.height + 120 }; }, info.id);
  await page.screenshot({ path: OUT + '/label-zoom.png', clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(700, box.width), height: Math.min(500, box.height) } });
  // reset via props button
  await ev(() => mebulb.refreshPanels());
  const hasReset = await ev(() => !!document.querySelector('#props [data-act="sk-resetlabel"]'));
  ok(hasReset, 'Reset label position button shown');
  if (hasReset) { await page.click('#props [data-act="sk-resetlabel"]'); await page.waitForTimeout(200); }
  const after = await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); return mebulb.linkSiblings(d, m).map((x) => !!x.labelOff); }, info.id);
  ok(after.every((x) => !x), 'reset cleared offsets on all floors ' + JSON.stringify(after));
  // save PDF and check the arrow survives export
  await ev((id) => { const d = mebulb.activeDoc(); const m = d.markups.find((x) => x.id === id); m.labelOff = [180, -60]; mebulb.renderAllMarks(d); }, info.id);
  const bytes = await ev(async () => { const d = mebulb.activeDoc(); const b = await mebulb.buildPdf(d, {}); return b.length; });
  ok(bytes > 1000, 'PDF builds with dragged label: ' + bytes + ' bytes');
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})();
async function mebulb_wait(page) { await page.waitForTimeout(250); }
