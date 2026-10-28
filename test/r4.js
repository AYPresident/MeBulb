// Round 4 UI: Bluebeam-style shortcuts (Alt+Z, Ctrl+Shift+C/V, painter), editable keys,
// toolbars on/off, property sections, font list (standard vs installed), web save of big files
const { launch } = require('./harness');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1500, height: 950 } });
  const ev = (fn, a) => page.evaluate(fn, a);
  // two text boxes: one wide with short text, one styled
  const ids = await ev(() => {
    const d = mebulb.activeDoc(); const now = new Date().toISOString(); const base = { type: 'text', page: 0, author: 'T', created: now, modified: now, layer: '' };
    const a = { ...base, id: 'PM-a', pts: [[300, 250], [700, 330]], text: 'Short', style: { stroke: '#000000', fill: 'none', width: 0, opacity: 1, fontSize: 12, fontColor: '#000000', font: 'helv' } };
    const b = { ...base, id: 'PM-b', pts: [[300, 400], [420, 440]], text: 'Styled note', style: { stroke: '#1971c2', fill: '#fff3bf', fillOpacity: 1, width: 1.5, opacity: 1, fontSize: 16, fontColor: '#c92a2a', font: 'times', bold: true } };
    d.markups.push(a, b); mebulb.renderAllMarks(d); return [a.id, b.id];
  });
  const sel = (id) => ev((id) => { const S = mebulb.state; S.sel.clear(); S.sel.add(id); mebulb.refreshPanels(); }, id);
  const focusViewer = () => ev(() => document.getElementById('viewer').focus());
  // Alt+Z fits the box to the text
  await sel('PM-a'); await focusViewer(); await page.keyboard.press('Alt+z'); await page.waitForTimeout(150);
  const wA = await ev(() => { const m = mebulb.activeDoc().markups.find((x) => x.id === 'PM-a'); return m.pts[1][0] - m.pts[0][0]; });
  ok(wA < 80 && wA > 20, `Alt+Z shrinks the box to its text (width ${wA.toFixed(1)} pt, was 400)`);
  // Ctrl+Shift+C on B, then select A and Ctrl+Shift+V
  await sel('PM-b'); await focusViewer(); await page.keyboard.press('Control+Shift+c'); await page.waitForTimeout(100);
  ok(await ev(() => mebulb.state.painter && document.body.classList.contains('painting')), 'Ctrl+Shift+C copies properties and turns on the format painter');
  await page.keyboard.press('Escape'); await sel('PM-a'); await focusViewer(); await page.keyboard.press('Control+Shift+v'); await page.waitForTimeout(150);
  const sA = await ev(() => mebulb.activeDoc().markups.find((x) => x.id === 'PM-a').style);
  ok(sA.font === 'times' && sA.fontColor === '#c92a2a' && sA.fontSize === 16 && sA.bold && sA.fill === '#fff3bf', 'Ctrl+Shift+V pastes font, colour, size, bold and fill: ' + JSON.stringify({ f: sA.font, c: sA.fontColor, z: sA.fontSize }));
  await ev(() => mebulb.undo()); await page.waitForTimeout(100);
  ok(await ev(() => mebulb.activeDoc().markups.find((x) => x.id === 'PM-a').style.font === 'helv'), 'undo restores the original look');
  // shortcut editor: rebind Alt+Z to Alt+F, then reset
  await ev(() => mebulb.runCommand('win.shortcuts')); await page.waitForSelector('.sc-row[data-cmd="edit.fitText"]');
  await page.click('.sc-row[data-cmd="edit.fitText"] [data-sc="set"]'); await page.keyboard.press('Alt+f'); await page.waitForTimeout(100);
  ok(JSON.stringify(await ev(() => mebulb.keysFor('edit.fitText'))).includes('Alt+F'), 'shortcut changed to Alt+F: ' + JSON.stringify(await ev(() => mebulb.keysFor('edit.fitText'))));
  await page.screenshot({ path: OUT + '/r4-shortcuts.png' });
  await page.click('[data-sc="resetall"]'); await page.waitForTimeout(100);
  ok(JSON.stringify(await ev(() => mebulb.keysFor('edit.fitText'))) === '["Alt+Z"]', 'reset to the default Alt+Z');
  await page.click('#modal footer .btn.primary');
  // toolbars: hide one, then reset layout
  const tb = await ev(() => mebulb.state.layout.toolbars.map((t) => t.id));
  await ev((id) => { const L = mebulb.state.layout; L.toolbars.find((t) => t.id === id).hidden = true; mebulb.applyLayout(L); }, tb[1]);
  ok(await ev((id) => !document.querySelector(`.tbar[data-tb="${id}"]`), tb[1]), `toolbar "${tb[1]}" hidden`);
  await ev(() => mebulb.applyLayout(mebulb.defaultLayout(), true));
  ok(await ev((id) => !!document.querySelector(`.tbar[data-tb="${id}"]`), tb[1]), 'reset layout shows it again');
  // property sections: fold "Appearance" and keep it folded after re-render
  await sel('PM-b'); await ev(() => mebulb.openPanel('props'));
  const heads = await ev(() => [...document.querySelectorAll('#props .psec > h3')].map((h) => h.textContent.trim()));
  ok(heads.length >= 3, 'property sections: ' + heads.join(' | '));
  const h0 = heads.find((h) => /appearance/i.test(h)) || heads[1];
  await page.click(`#props .psec > h3:text-is("${h0}")`); await ev(() => mebulb.refreshPanels()); await page.waitForTimeout(100);
  ok(await ev((h) => [...document.querySelectorAll('#props .psec > h3')].find((x) => x.textContent.trim() === h).parentElement.classList.contains('collapsed'), h0), `"${h0}" stays folded after a refresh`);
  await page.screenshot({ path: OUT + '/r4-props.png' });
  await page.click(`#props .psec > h3:text-is("${h0}")`);
  // fonts: standard and installed families are separate entries
  await ev(() => { mebulb.addFaces([{ family: 'Arial', sub: 'Regular', weight: 400, src: () => Promise.reject(new Error('not needed')) }]); mebulb.refreshPanels(); });
  const opts = await ev(() => [...document.querySelectorAll('#props select[data-k="style.font"] option')].map((o) => o.textContent));
  ok(opts.includes('Helvetica') && opts.includes('Arial') && opts.indexOf('Helvetica') !== opts.indexOf('Arial'), 'font list keeps Helvetica and Arial separate: ' + opts.slice(0, 6).join(', '));
  const groups = await ev(() => [...document.querySelectorAll('#props select[data-k="style.font"] optgroup')].map((g) => g.label));
  ok(groups.join('|') === 'PDF standard fonts|Fonts on this PC', 'grouped: ' + groups.join(' / '));
  // riser label font controls
  const sk = await ev(() => mebulb.activeDoc().markups.find((x) => x.type === 'sketch' && x.page === 0).id); await sel(sk);
  const sko = await ev(() => ({ font: !!document.querySelector('#props select[data-k="style.font"]'), size: !!document.querySelector('#props input[data-k="style.fontSize"]'), pos: [...document.querySelectorAll('#props select[data-k="style.labelPos"] option')].map((o) => o.value) }));
  ok(sko.font && sko.size && sko.pos.includes('center'), 'riser label: font, size and position (incl. middle) available');
  console.log(errors.filter((e) => !/XFA/.test(e)).join('\n') || 'no errors');
  await browser.close();
})();
