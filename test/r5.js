// Round 5: window selection direction, line ends, count symbols, colour processing,
// flatten / unflatten (editable text back), print dialog
const { launch } = require('./harness');
const fs = require('fs'); const { execSync } = require('child_process');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1500, height: 950 } });
  const ev = (fn, a) => page.evaluate(fn, a);
  await ev(() => { const S = mebulb.state; S.snapMarkup = false; S.snapContent = false; mebulb.setZoom(1); mebulb.goToPage(0, [300, 300]); });
  await page.waitForTimeout(400);
  // two rects: A inside the window, B crossing it
  await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); const st = { stroke: '#d6331f', fill: 'none', width: 1.5, opacity: 1 };
    d.markups.push({ id: 'PM-in', type: 'rect', page: 0, pts: [[620, 120], [660, 150]], style: { ...st }, created: now, modified: now }, { id: 'PM-cross', type: 'rect', page: 0, pts: [[690, 120], [800, 150]], style: { ...st }, created: now, modified: now }, { id: 'PM-diag', type: 'line', page: 0, pts: [[600, 200], [900, 260]], style: { ...st }, created: now, modified: now }); mebulb.renderAllMarks(d); });
  const P = (x, y) => ev(([x, y]) => { const d = mebulb.activeDoc(); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + x * d.zoom, r.top + y * d.zoom]; }, [x, y]);
  const drag = async (a, b) => { const [x1, y1] = await P(...a), [x2, y2] = await P(...b); await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await page.mouse.move(x2, y2, { steps: 4 }); };
  await ev(() => mebulb.setTool('select'));
  await drag([600, 100], [720, 170]); const col1 = await ev(() => { const r = document.querySelector('rect.marquee'); return r && getComputedStyle(r).stroke; }); await page.mouse.up(); await page.waitForTimeout(100);
  const s1 = await ev(() => [...mebulb.state.sel]);
  ok(/29, 108, 224|1d6ce0/i.test(col1) && s1.includes('PM-in') && !s1.includes('PM-cross') && !s1.includes('PM-diag'), `left to right is blue (${col1}) and selects only enclosed: ${s1.join(',')}`);
  await ev(() => { mebulb.state.sel.clear(); });
  await drag([720, 170], [600, 100]); const col2 = await ev(() => { const r = document.querySelector('rect.marquee'); return r && getComputedStyle(r).stroke; }); await page.screenshot({ path: OUT + '/r5-crossing.png' }); await page.mouse.up(); await page.waitForTimeout(100);
  const s2 = await ev(() => [...mebulb.state.sel]);
  ok(/43, 154, 62|2b9a3e/i.test(col2) && s2.includes('PM-in') && s2.includes('PM-cross') && !s2.includes('PM-diag'), `right to left is green (${col2}) and selects touching: ${s2.join(',')}`);
  await ev(() => mebulb.state.sel.clear());
  await drag([720, 230], [700, 215]); await page.mouse.up(); await page.waitForTimeout(100);
  ok((await ev(() => [...mebulb.state.sel])).includes('PM-diag'), 'crossing window touching a diagonal line selects it');
  // polyline with arrows both ends, count symbols
  await ev(() => { const d = mebulb.activeDoc(); const now = new Date().toISOString(); d.markups.push({ id: 'PM-pl', type: 'polyline', page: 0, pts: [[300, 980], [420, 940], [520, 1000]], style: { stroke: '#1f5fd1', fill: 'none', width: 2, opacity: 1, arrowStart: 'arrow', arrowEnd: 'diamond' }, created: now, modified: now });
    ['circle', 'square', 'triangle', 'diamond', 'star', 'check', 'cross'].forEach((sym, k) => d.markups.push({ id: 'PM-c' + k, type: 'count', page: 0, pts: [[600 + k * 30, 990]], style: { stroke: '#d1308f', fill: '#d1308f', fillOpacity: 0.85, width: 1, fontSize: 9, size: 8, symbol: sym, numbered: true, labelBg: false }, created: now, modified: now }));
    mebulb.renderAllMarks(d); const S = mebulb.state; S.sel.clear(); S.sel.add('PM-pl'); mebulb.refreshPanels(); });
  const ends = await ev(() => [...document.querySelectorAll('#propbar select[data-k="style.arrowStart"] option')].map((o) => o.textContent));
  ok(ends.length === 10 && ends.includes('Reverse closed arrow') && ends.includes('Diamond'), 'polyline has start and end styles in the property bar: ' + ends.length);
  await ev(() => { mebulb.goToPage(0, [450, 980]); mebulb.setZoom(2); });
  await page.waitForTimeout(500); await page.screenshot({ path: OUT + '/r5-ends-counts.png' });
  // colour processing: overlay on screen, blend overlay in the PDF
  await ev(() => { const d = mebulb.activeDoc(); d.colorAdj = { all: { sat: 0, lum: 0.5 }, pages: {}, save: true }; mebulb.renderColorAdj(d); mebulb.setZoom(0.6); });
  await page.waitForTimeout(400); await page.screenshot({ path: OUT + '/r5-colour.png' });
  ok(await ev(() => document.querySelectorAll('.cadj').length === 8), 'colour overlay on every page, under the markups');
  // flatten page 1 markups (allow unflatten), save, reopen, unflatten
  const before = await ev(() => mebulb.activeDoc().markups.filter((m) => m.page === 0).length);
  await ev(() => mebulb.runCommand('doc.flatten')); await page.waitForSelector('#modal select[name=which]');
  await page.selectOption('#modal select[name=which]', 'page'); await page.click('#modal footer .btn.primary'); await page.waitForTimeout(300);
  const after = await ev(() => ({ left: mebulb.activeDoc().markups.filter((m) => m.page === 0).length, flat: mebulb.activeDoc().flat.length }));
  ok(after.left === 0 && after.flat === 1, `flattened ${before} markups on page 1 (${JSON.stringify(after)})`);
  await page.screenshot({ path: OUT + '/r5-flattened.png' });
  const saved = await ev(async () => { const d = mebulb.activeDoc(); d.reader = await mebulb.openReader(d.src); const u = await mebulb.incrementalUpdate(d, {}); const all = new Uint8Array(d.src.size + u.bytes.length); all.set(d.src.bytes); all.set(u.bytes, d.src.size); let s = ''; for (let i = 0; i < all.length; i += 32768) s += String.fromCharCode.apply(null, all.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(OUT + '/r5-flat.pdf', Buffer.from(saved, 'base64'));
  ok(/No syntax or stream encoding errors/.test(execSync(`qpdf --check ${OUT}/r5-flat.pdf 2>&1 || true`, { encoding: 'utf8' })), 'flattened save passes qpdf');
  execSync(`pdftoppm -r 50 -f 1 -l 1 -png ${OUT}/r5-flat.pdf ${OUT}/r5-flat`);
  const txt = execSync(`pdftotext -f 1 -l 1 ${OUT}/r5-flat.pdf - 2>/dev/null || true`, { encoding: 'utf8' }); ok(/vanity size/.test(txt), 'flattened callout text is part of the page text');
  const re = await ev(async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const d = await mebulb.openBytes('Flattened.pdf', bytes); await new Promise((r) => setTimeout(r, 800)); return { m0: d.markups.filter((m) => m.page === 0).length, flat: (d.flat || []).length, patched: !!d.viewPatched, cadj: !!d.colorAdj }; }, saved);
  ok(re.m0 === 0 && re.flat === 1 && re.patched && re.cadj, 'reopened: page 1 has flattened markups, colour processing kept ' + JSON.stringify(re));
  await page.screenshot({ path: OUT + '/r5-reopened.png' });
  await ev(() => mebulb.runCommand('doc.unflatten')); await page.waitForSelector('#modal select[name=which]'); await page.click('#modal footer .btn.primary'); await page.waitForTimeout(1200);
  const un = await ev(() => { const d = mebulb.activeDoc(); const c = d.markups.find((m) => m.type === 'callout' && m.page === 0); return { m0: d.markups.filter((m) => m.page === 0).length, flat: d.flat.length, callout: c ? c.text || (c.runs || []).map((r) => r.t).join('') : null }; });
  ok(un.m0 === before && un.flat === 0 && /vanity/.test(un.callout || ''), `unflatten restores ${un.m0} editable markups (callout text "${(un.callout || '').slice(0, 30)}…")`);
  await page.screenshot({ path: OUT + '/r5-unflattened.png' });
  // save after unflatten: the page content no longer has the flattened drawing, markups are annotations again
  const saved2 = await ev(async () => { const d = mebulb.activeDoc(); d.reader = await mebulb.openReader(d.base.src); const u = await mebulb.incrementalUpdate(d, {}); const b = await d.base.src.all(); const all = new Uint8Array(b.length + u.bytes.length); all.set(b); all.set(u.bytes, b.length); let s = ''; for (let i = 0; i < all.length; i += 32768) s += String.fromCharCode.apply(null, all.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(OUT + '/r5-unflat.pdf', Buffer.from(saved2, 'base64'));
  const pageObj = execSync(`qpdf --show-object=6 ${OUT}/r5-unflat.pdf`, { encoding: 'utf8' }); const contents = (pageObj.match(/\/Contents \[([^\]]*)\]/) || [])[1] || ''; const kinds = contents.match(/\d+ 0 R/g).map((r) => execSync(`qpdf --show-object=${r.split(' ')[0]} ${OUT}/r5-unflat.pdf`, { encoding: 'utf8' }).match(/\/MeBulb \/(\w+)/)).map((m) => (m ? m[1] : 'original'));
  const nAnn = ((pageObj.match(/\/Annots \[([^\]]*)\]/) || [])[1] || '').split(' R').length - 1;
  ok(/No syntax or stream encoding errors/.test(execSync(`qpdf --check ${OUT}/r5-unflat.pdf 2>&1 || true`, { encoding: 'utf8' })) && !kinds.includes('Flat') && nAnn === before, `after unflatten and save: page content ${kinds.join('+')}, ${nAnn} annotations`);
  // print dialog
  await ev(() => mebulb.runCommand('file.print')); await page.waitForSelector('#pp-canvas'); await page.waitForTimeout(900);
  await page.selectOption('#modal select[name=paper]', 'A3'); await page.waitForTimeout(700);
  const info = await ev(() => document.querySelector('#pp-info').textContent);
  ok(/A3 landscape/.test(info) && /Prints at about 1:/.test(info), 'print preview: ' + info);
  await page.screenshot({ path: OUT + '/r5-print.png' });
  await page.click('#modal footer .btn:not(.primary)');
  console.log(errors.filter((e) => !/XFA/.test(e)).join('\n') || 'no errors');
  await browser.close();
})();
