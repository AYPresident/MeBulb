// Tool sets: Revu-style tool chest, .btx import and export, drawing mode, recent tools
const { launch } = require('./harness');
const fs = require('fs');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1400, height: 900 } });
  const ev = (fn, a) => page.evaluate(fn, a);
  // A tool set laid out the way Revu writes one: hex of zlib for the title, names and raw dictionaries
  const btx = await ev(async () => {
    const M = mebulb; const hz = async (s) => M.hexOf(await M.zlib(new TextEncoder().encode(s)));
    const raws = [
      ['Revision Cloud', 'AnnotationPolygon', '<</Type/Annot/Subtype/Polygon/IT/PolygonCloud/BE<</S/C/I 1>>/C[1 0 0]/CA 1/BS<</W 2/S/S>>/Vertices[100 100 300 100 300 200 100 200]/Rect[95 95 305 205]/Subj(Revision Cloud)/T(Revu User)/F 4>>', 'properties'],
      ['Slab Area', 'AnnotationPolygon', '<</Type/Annot/Subtype/Polygon/IT/PolygonDimension/C[0 0.4 0.8]/IC[0.6 0.8 1]/FillOpacity 0.4/CA 1/BS<</W 1.5>>/Vertices[100 100 250 100 250 220 100 220]/Rect[100 100 250 220]/Subj(Slab Area)/Measure<</Type/Measure/Subtype/RL/R(1 in = 10 ft)/X[<</Type/NumberFormat/U(ft)/C 0.833333/D 100/F/D>>]/D[<</Type/NumberFormat/U(ft)/C 1/D 100/F/D>>]/A[<</Type/NumberFormat/U(sf)/C 1/D 100/F/D>>]>>/F 4>>', 'properties'],
      ['Arrow', 'AnnotationLine', '<</Type/Annot/Subtype/Line/IT/LineArrow/L[100 100 220 160]/LE[/None/OpenArrow]/C[0 0.6 0]/BS<</W 2>>/Rect[95 95 225 165]/Subj(Arrow)/F 4>>', 'drawing'],
      ['Note Callout', 'AnnotationFreeText', '<</Type/Annot/Subtype/FreeText/IT/FreeTextCallout/CL[100 100 150 150 180 150]/LE/OpenArrow/Rect[95 95 300 180]/RD[0 0 0 0]/C[1 1 1]/DA(0 0 1 rg /Helv 12 Tf)/DS(font: Arial 12pt; text-align:left; color:#0000FF)/Contents(SEE NOTE 4)/Subj(Note Callout)/BS<</W 1>>/F 4>>', 'properties'],
      ['Outlets', 'AnnotationPolygon', '<</Type/Annot/Subtype/Polygon/IT/PolygonCount/CountStyle/Square/C[1 0.5 0]/IC[1 0.5 0]/Vertices[100 100 112 100 112 112 100 112]/Rect[100 100 112 112]/Subj(Outlets)/F 4>>', 'properties'],
      ['Approved', 'AnnotationStamp', '<</Type/Annot/Subtype/Stamp/Name/Approved/C[0 0.6 0]/Rect[100 100 250 150]/Subj(Approved)/F 4>>', 'properties'],
      ['Wavy', 'AnnotationSquiggly', '<</Type/Annot/Subtype/Squiggly/QuadPoints[100 120 200 120 100 100 200 100]/C[1 0 0]/Rect[100 100 200 120]/Subj(Wavy)/F 4>>', 'properties'],
    ];
    const items = []; for (const [k, [n, t, raw, mode]] of raws.entries()) items.push(`  <ToolChestItem Version="1">\n    <Resources />\n    <Name>${'ABCDEFGHIJKLMNOP'.slice(k) + 'QRSTUVWXYZ'.slice(0, k)}</Name>\n    <Type>Bluebeam.PDF.Annotations.${t}</Type>\n    <Raw>${await hz(raw)}</Raw>\n    <X>5.5</X>\n    <Y>5.5</Y>\n    <Index>${k}</Index>\n    <Mode>${mode}</Mode>\n  </ToolChestItem>`);
    return `<?xml version="1.0" encoding="utf-8"?>\n<BluebeamRevuToolSet Version="1">\n  <Title>${await hz('Site Review')}</Title>\n${items.join('\n')}\n</BluebeamRevuToolSet>\n`;
  });
  fs.writeFileSync(OUT + '/site-review.btx', btx);
  const before = await ev(() => mebulb.state.toolsets.length);
  const imp = await ev(async (xml) => { await mebulb.importBtxFiles([new File([xml], 'Site Review.btx')]); const ts = mebulb.state.toolsets[mebulb.state.toolsets.length - 1]; return { n: mebulb.state.toolsets.length, name: ts.name, items: ts.items.map((i) => ({ name: i.name, tool: i.tool, stroke: i.style && i.style.stroke, fill: i.style && i.style.fill, sym: i.style && i.style.symbol, end: i.style && i.style.arrowEnd, mode: i.mode, text: i.text, shape: !!i.shape })) }; }, btx);
  ok(imp.n === before + 1 && imp.name === 'Site Review', 'imported a Revu tool set with its title: ' + imp.name);
  const by = Object.fromEntries(imp.items.map((i) => [i.name, i]));
  ok(by['Revision Cloud'] && by['Revision Cloud'].tool === 'cloud' && by['Revision Cloud'].stroke === '#ff0000', 'cloud tool keeps its type and red colour');
  ok(by['Slab Area'] && by['Slab Area'].tool === 'area' && by['Slab Area'].fill === '#99ccff', 'area takeoff tool keeps its fill');
  ok(by.Arrow && by.Arrow.tool === 'arrow' && by.Arrow.end === 'open' && by.Arrow.mode === 'drawing', 'arrow tool keeps its open arrow head and drawing mode');
  ok(by['Note Callout'] && by['Note Callout'].tool === 'callout', 'callout tool imported');
  ok(by.Outlets && by.Outlets.tool === 'count' && by.Outlets.sym === 'square', 'count tool keeps its square symbol');
  ok(by.Approved && by.Approved.tool === 'stamp' && /APPROVED/.test(by.Approved.text), 'stamp without a picture becomes a text stamp: ' + (by.Approved && by.Approved.text));
  ok(by.Wavy && by.Wavy.tool === 'strikeout', 'squiggly underline comes in as an underline tool');
  // the panel: previews in a grid
  await page.waitForTimeout(400);
  const pv = await ev(() => { const s = [...document.querySelectorAll('#toolsets .tset')].pop(); return { tiles: s.querySelectorAll('.titem').length, svgs: s.querySelectorAll('.ti-pv svg path, .ti-pv svg rect, .ti-pv svg ellipse, .ti-pv svg text, .ti-pv svg polygon, .ti-pv svg polyline').length, grid: s.querySelector('.tbody').classList.contains('grid'), tag: !!s.querySelector('.ts-tag') }; });
  ok(pv.tiles === imp.items.length && pv.svgs >= pv.tiles && pv.grid && pv.tag, `tool chest shows ${pv.tiles} preview tiles in a grid, marked as BTX`);
  await page.screenshot({ path: OUT + '/btx-panel.png' });
  // export: our dictionaries go out in Revu's layout and come back the same
  const back = await ev(async () => {
    const set = mebulb.state.toolsets.find((t) => t.id === 'ts-redline'); const { xml } = await mebulb.btxXml(set);
    const dom = new DOMParser().parseFromString(xml, 'application/xml'); const raw0 = dom.querySelector('ToolChestItem Raw').textContent;
    const txt = new TextDecoder('latin1').decode(await mebulb.unzlib(mebulb.unhex(raw0)));
    const r = await mebulb.importBtx(new File([xml], 'Redline.btx'));
    return { root: dom.documentElement.nodeName, items: dom.querySelectorAll('ToolChestItem').length, types: [...dom.querySelectorAll('Type')].map((t) => t.textContent), txt, title: r.set.name, re: r.set.items.map((i) => [i.tool, i.style.stroke]), orig: set.items.map((i) => [i.tool, i.style.stroke]) };
  });
  ok(back.root === 'BluebeamRevuToolSet' && back.items === 6 && back.types.every((t) => /^Bluebeam\.PDF\.Annotations\.Annotation\w+$/.test(t)), 'export writes a BluebeamRevuToolSet with 6 typed items: ' + [...new Set(back.types)].map((t) => t.split('.').pop()).join(', '));
  ok(/\/IT \/PolygonCloud/.test(back.txt) && /\/BE/.test(back.txt) && !/\/AP/.test(back.txt) && !/\/NM/.test(back.txt) && !/\/P /.test(back.txt), 'raw dictionary carries Revu intent and cloud effect, without appearance, NM or page');
  ok(back.title === 'Redline' && JSON.stringify(back.re) === JSON.stringify(back.orig), 'exported set re-imports with the same tools and colours' + (JSON.stringify(back.re) === JSON.stringify(back.orig) ? '' : ': ' + JSON.stringify(back.re) + ' vs ' + JSON.stringify(back.orig)));
  // clicking a tool: properties mode arms the tool with the saved look
  await page.click('#toolsets .tset:last-of-type .titem:has-text("Revision Cloud")');
  const armed = await ev(() => ({ tool: mebulb.state.tool, stroke: mebulb.state.toolStyles.cloud && mebulb.state.toolStyles.cloud.stroke }));
  ok(armed.tool === 'cloud' && armed.stroke === '#ff0000', 'clicking a tool arms it with its saved properties');
  await page.keyboard.press('Escape');
  // drawing mode: the arrow drops as a copy where you click
  await page.click('#toolsets .tset:last-of-type .titem:has-text("Arrow")'); await page.waitForTimeout(200);
  ok(await ev(() => !!mebulb.state.placeItem && document.querySelector('#viewer').dataset.place === '1' && !!document.querySelector('.ts-placing')), 'drawing-mode tool waits for a click on the page');
  const [x, y, before2] = await ev(() => { const d = mebulb.activeDoc(); mebulb.goToPage(0, [600, 500]); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + 600 * d.zoom, r.top + 500 * d.zoom, d.markups.length]; });
  await page.waitForTimeout(300); const [x2, y2] = await ev(() => { const d = mebulb.activeDoc(); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + 600 * d.zoom, r.top + 500 * d.zoom]; });
  await page.mouse.click(x2, y2); await page.waitForTimeout(300);
  const placed = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; const c = [(m.pts[0][0] + m.pts[1][0]) / 2, (m.pts[0][1] + m.pts[1][1]) / 2]; return { n: d.markups.length, type: m.type, len: Math.hypot(m.pts[1][0] - m.pts[0][0], m.pts[1][1] - m.pts[0][1]), c, end: m.style.arrowEnd, stroke: m.style.stroke, placing: !!mebulb.state.placeItem }; });
  ok(placed.n === before2 + 1 && placed.type === 'arrow' && Math.abs(placed.len - Math.hypot(120, 60)) < 1 && Math.abs(placed.c[0] - 600) < 3 && Math.abs(placed.c[1] - 500) < 3 && placed.end === 'open' && placed.stroke === '#00990' + '0', `drawing mode placed the saved arrow (${placed.len.toFixed(1)} pt long) centred on the click`);
  ok(!placed.placing, 'placing ends after one copy unless the tool is locked');
  // recent tools collect themselves
  await page.waitForTimeout(200);
  const rec = await ev(() => ({ n: (mebulb.state.recentTools || []).length, first: mebulb.state.recentTools[0] && mebulb.state.recentTools[0].tool, shown: !!document.querySelector('#toolsets .tset[data-s="r"]') }));
  ok(rec.n >= 1 && rec.first === 'arrow' && rec.shown, 'recent tools section shows the arrow just used');
  // starter stamp items keep their own words
  await ev(() => { const it = mebulb.state.toolsets.find((t) => t.id === 'ts-redline').items.find((i) => /Revise/.test(i.name)); mebulb.useToolsetItem(it); });
  const [sx, sy] = await ev(() => { const d = mebulb.activeDoc(); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + 300 * d.zoom, r.top + 300 * d.zoom]; });
  await page.mouse.click(sx, sy); await page.waitForTimeout(500);
  const st = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; return { type: m.type, text: m.text }; });
  ok(st.type === 'stamp' && st.text === 'REVISE & RESUBMIT', 'a stamp from a tool set places its own words: ' + st.text);
  // drag a tool into another set
  await ev(() => { const ts = mebulb.state.toolsets; ts.forEach((t, k) => { t.collapsed = k > 0 && k < ts.length - 1; }); mebulb.state.recentCollapsed = true; mebulb.renderToolsets(); document.querySelector('#toolsets').scrollTop = 0; }); await page.waitForTimeout(200);
  const moved = await ev(() => { const ts = mebulb.state.toolsets; return { a: ts[0].items.length, b: ts[ts.length - 1].items.length, names: ts.map((t) => t.name + ':' + t.items.length).join(', ') }; });
  await page.dragAndDrop('#toolsets .tset[data-s="0"] .titem[data-i="0"]', '#toolsets .tset:last-of-type .titem[data-i="0"]'); await page.waitForTimeout(300);
  const moved2 = await ev(() => { const ts = mebulb.state.toolsets; return { a: ts[0].items.length, b: ts[ts.length - 1].items.length, first: ts[ts.length - 1].items[0].name, names: ts.map((t) => t.name + ':' + t.items.length).join(', ') }; });
  console.log(moved.names, '->', moved2.names);
  ok(moved2.a === moved.a - 1 && moved2.b === moved.b + 1, `dragging moved “${moved2.first}” into the imported set`);
  // context menu on a tool
  await page.click('#toolsets .tset:last-of-type .titem[data-i="1"]', { button: 'right' }); await page.waitForTimeout(150);
  const menu = await ev(() => [...document.querySelectorAll('#ctx button')].map((b) => b.textContent));
  ok(menu.some((t) => /drawing mode/.test(t)) && menu.includes('Rename…') && menu.includes('Delete'), 'right-click menu offers modes, rename, move and delete');
  await page.screenshot({ path: OUT + '/btx-menu.png' }); await page.keyboard.press('Escape');
  const bad = errors.filter((e) => !/favicon|tool skipped|net::ERR/.test(e)); ok(!bad.length, 'no page errors' + (bad.length ? ': ' + bad.join(' | ') : ''));
  await browser.close();
})();
