// ===== Sample drawing set (generated, fictional project) =====================
// Metric, 1:50 on A2. Plan geometry is written in "units" of 300 mm. Level 2 is
// deliberately placed 5 mm right and 3 mm lower on its sheet, the way sheets often
// drift between floors, so page alignment has something to correct.
const SAMPLE = { SW: 1684, SH: 1191, U: 0.3 * (72 / 25.4) * (1000 / 50), OX: 210, TOP: 215, SHIFT: { 1: [5 * 72 / 25.4, 3 * 72 / 25.4] } };
async function buildSamplePdf() {
  const { rgb } = PDFLib; const pdf = await PDFDocument.create();
  pdf.setTitle('Harbour View Residence - Floor Plans (sample)'); pdf.setProducer('MeBulb sample');
  const R = await pdf.embedFont(StandardFonts.Helvetica), B = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { SW, SH, U: S } = SAMPLE;
  const ink = rgb(0.12, 0.13, 0.15), wallC = rgb(0.2, 0.21, 0.23), light = rgb(0.55, 0.57, 0.6), white = rgb(1, 1, 1);
  const mm = (n) => `${Math.round(n * 300)}`;

  function sheet(rev, level, index) {
    const page = pdf.addPage([SW, SH]); const t = 0.75, t2 = 0.42; const bathX = rev === 'B' ? 28 : 26;
    const sh = SAMPLE.SHIFT[index] || [0, 0]; const OX = SAMPLE.OX + sh[0], OY = SH - SAMPLE.TOP - sh[1];
    const X = (f) => OX + f * S, Y = (f) => OY - f * S;
    const rectFt = (x, y, w, h, color = wallC) => page.drawRectangle({ x: X(x), y: Y(y + h), width: w * S, height: h * S, color });
    const path = (d, o = {}) => page.drawSvgPath(d, { x: OX, y: OY, borderColor: o.color || ink, borderWidth: o.w == null ? 0.6 : o.w, color: o.fill, borderDashArray: o.dash });
    const P = (fx, fy) => `${(fx * S).toFixed(2)} ${(fy * S).toFixed(2)}`;
    const text = (s, fx, fy, size, font = R, o = {}) => { const w = font.widthOfTextAtSize(s, size); const dx = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0; page.drawText(s, { x: X(fx) + (o.rot ? 0 : dx), y: Y(fy) + (o.rot ? dx : 0), size, font, color: o.color || ink, rotate: o.rot ? PDFLib.degrees(o.rot) : undefined }); };
    // sheet border (fixed on the sheet)
    page.drawRectangle({ x: 30, y: 30, width: SW - 60, height: SH - 60, borderColor: ink, borderWidth: 1.6 });
    // structural grid: dash-dot lines through the plan with bubbles at both ends
    const cols = [['A', 0], ['B', 20], ['C', 36], ['D', 56]], rows = [['1', 0], ['2', 16], ['3', 21], ['4', 38]];
    const bub = (x, y, l) => { page.drawCircle({ x: X(x), y: Y(y), size: 1.15 * S, borderColor: ink, borderWidth: 0.8, color: white }); text(l, x, y + 0.35, 11, B, { align: 'center' }); };
    cols.forEach(([l, x]) => { path(`M ${P(x, -8.25)} L ${P(x, 41.35)}`, { w: 0.4, color: light, dash: [10, 4, 2, 4] }); bub(x, -9.4, l); bub(x, 42.5, l); });
    rows.forEach(([l, y]) => { path(`M ${P(-8.25, y)} L ${P(59.35, y)}`, { w: 0.4, color: light, dash: [10, 4, 2, 4] }); bub(-9.4, y, l); bub(60.5, y, l); });
    // exterior walls
    rectFt(0, 0, 56, t); rectFt(0, 38 - t, 56, t); rectFt(0, 0, t, 38); rectFt(56 - t, 0, t, 38);
    // interior walls
    const hw = (y, x0, x1) => rectFt(x0, y - t2 / 2, x1 - x0, t2); const vw = (x, y0, y1) => rectFt(x - t2 / 2, y0, t2, y1 - y0);
    hw(16, 0, 56); hw(21, 0, 56); vw(20, 0, 9); vw(36, 0, 16); vw(16, 21, 38); vw(bathX, 21, 38); vw(42, 21, 38); hw(30, 16, bathX);
    // door openings + swings (horizontal walls: swing down; vertical: swing right)
    const doorH = (y, x0, w, up) => { rectFt(x0, y - 0.5, w, 1, white); const dir = up ? -1 : 1; path(`M ${P(x0, y)} L ${P(x0, y + dir * w)}`, { w: 0.9 }); const k = 0.5523; path(`M ${P(x0 + w, y)} C ${P(x0 + w, y + dir * k * w)} ${P(x0 + k * w, y + dir * w)} ${P(x0, y + dir * w)}`, { w: 0.45 }); };
    const doorV = (x, y0, w, left) => { rectFt(x - 0.5, y0, 1, w, white); const dir = left ? -1 : 1; path(`M ${P(x, y0)} L ${P(x + dir * w, y0)}`, { w: 0.9 }); const k = 0.5523; path(`M ${P(x, y0 + w)} C ${P(x + dir * k * w, y0 + w)} ${P(x + dir * w, y0 + k * w)} ${P(x + dir * w, y0)}`, { w: 0.45 }); };
    if (level === 1) doorH(t / 2, 8, 3.5, false); doorH(16, 4, 3, false); doorH(16, 26, 3, false); doorH(16, 44, 3, false);
    doorH(21, 10, 3, false); doorH(21, 17.5, 2.5, false); doorH(21, 32, 3, false); doorH(21, 46, 3, false);
    doorV(36, 6, 3, false); doorH(38 - t / 2, rev === 'B' ? 23 : 19, 3, true);
    // windows
    const winH = (y, x0, w) => { rectFt(x0, y - t / 2, w, t, white); path(`M ${P(x0, y - t / 2)} L ${P(x0 + w, y - t / 2)} M ${P(x0, y)} L ${P(x0 + w, y)} M ${P(x0, y + t / 2)} L ${P(x0 + w, y + t / 2)} M ${P(x0, y - t / 2)} L ${P(x0, y + t / 2)} M ${P(x0 + w, y - t / 2)} L ${P(x0 + w, y + t / 2)}`, { w: 0.5 }); };
    const winV = (x, y0, w) => { rectFt(x - t / 2, y0, t, w, white); path(`M ${P(x - t / 2, y0)} L ${P(x - t / 2, y0 + w)} M ${P(x, y0)} L ${P(x, y0 + w)} M ${P(x + t / 2, y0)} L ${P(x + t / 2, y0 + w)} M ${P(x - t / 2, y0)} L ${P(x + t / 2, y0)} M ${P(x - t / 2, y0 + w)} L ${P(x + t / 2, y0 + w)}`, { w: 0.5 }); };
    if (level > 1) winH(t / 2, 8, 3.5); winH(t / 2, 13, 5); winH(t / 2, 27, 4); winH(t / 2, 42, 6); winH(38 - t / 2, 5, 5); winH(38 - t / 2, 31, 5); winH(38 - t / 2, 46, 5);
    winV(56 - t / 2, 4, 6); winV(56 - t / 2, 26, 5); winV(t / 2, 26, 5); if (rev === 'B') winV(t / 2, 6, 5);
    // fixtures
    path(`M ${P(21, t)} L ${P(21, 2.9)} L ${P(35.6, 2.9)} L ${P(35.6, t)}`, { w: 0.6 });
    if (rev !== 'B') path(`M ${P(25, 7)} L ${P(31, 7)} L ${P(31, 10)} L ${P(25, 10)} Z`, { w: 0.6 });
    path(`M ${P(16.5, 21.6)} L ${P(21.5, 21.6)} L ${P(21.5, 24.2)} L ${P(16.5, 24.2)} Z`, { w: 0.6 }); // bath
    path(`M ${P(bathX - 3.2, 25.2)} L ${P(bathX - 0.5, 25.2)} L ${P(bathX - 0.5, 28.4)} L ${P(bathX - 3.2, 28.4)} Z`, { w: 0.6 }); // vanity
    page.drawEllipse({ x: X(18), y: Y(27.4), xScale: 0.75 * S, yScale: 1 * S, borderColor: ink, borderWidth: 0.6 }); // wc
    [[0.75, 33, 6, 2.2], [26.2, 33.8, 6, 2.2], [42.4, 34, 6, 2.2]].forEach(([x, y, w, h]) => path(`M ${P(x, y)} L ${P(x + w, y)} L ${P(x + w, y + h)} L ${P(x, y + h)} Z`, { w: 0.5, dash: [4, 3] }));
    // power outlets
    const outlet = (x, y) => { page.drawCircle({ x: X(x), y: Y(y), size: 0.32 * S, borderColor: ink, borderWidth: 0.7 }); path(`M ${P(x - 0.12, y - 0.18)} L ${P(x - 0.12, y + 0.18)} M ${P(x + 0.12, y - 0.18)} L ${P(x + 0.12, y + 0.18)}`, { w: 0.6 }); };
    SAMPLE_OUTLETS.forEach(([x, y]) => outlet(x, y));
    // room labels
    [[level === 1 ? 'LIVING' : 'STUDY', 10, 9], [level === 1 ? 'KITCHEN' : 'LOUNGE', 28, 12.6], [level === 1 ? 'DINING' : 'BEDROOM', 46, 9], ['HALL', 28, 18.9], ['BEDROOM 1', 8, 27.5], ['BATH', (16 + bathX) / 2 + 0.6, 29.4], ['LAUNDRY', (16 + bathX) / 2 + 1, 36.8], ['BEDROOM 2', (bathX + 42) / 2, 28.4], ['BEDROOM 3', 49, 28.4]].forEach(([n, x, y]) => { text(n, x, y, n === 'HALL' ? 9 : 11, B, { align: 'center' }); });
    // dimension strings (mm)
    const dimH = (y, xs) => { path(`M ${P(xs[0], y)} L ${P(xs[xs.length - 1], y)}`, { w: 0.5 }); xs.forEach((x) => { path(`M ${P(x - 0.35, y + 0.35)} L ${P(x + 0.35, y - 0.35)} M ${P(x, y - 0.8)} L ${P(x, y + 0.8)}`, { w: 0.7 }); }); for (let k = 1; k < xs.length; k++) text(mm(xs[k] - xs[k - 1]), (xs[k] + xs[k - 1]) / 2, y - 0.45, 8, R, { align: 'center' }); };
    const dimV = (x, ys) => { path(`M ${P(x, ys[0])} L ${P(x, ys[ys.length - 1])}`, { w: 0.5 }); ys.forEach((y) => { path(`M ${P(x - 0.35, y + 0.35)} L ${P(x + 0.35, y - 0.35)} M ${P(x - 0.8, y)} L ${P(x + 0.8, y)}`, { w: 0.7 }); }); for (let k = 1; k < ys.length; k++) text(mm(ys[k] - ys[k - 1]), x - 0.45, (ys[k] + ys[k - 1]) / 2, 8, R, { align: 'center', rot: 90 }); };
    dimH(-3.5, [0, 20, 36, 56]); dimH(-6, [0, 56]); dimV(-3.5, [0, 16, 21, 38]); dimV(-6, [0, 38]);
    // services shaft in the laundry and a comms cupboard at the end of the hall, on every level
    path(`M ${P(16.8, 30.6)} L ${P(23.4, 30.6)} L ${P(23.4, 32.9)} L ${P(16.8, 32.9)} Z`, { w: 0.6, dash: [5, 3] }); text('SHAFT', 16.95, 31.1, 6, B, { color: light });
    path(`M ${P(52.4, 16.6)} L ${P(55.1, 16.6)} L ${P(55.1, 20.4)} L ${P(52.4, 20.4)} Z`, { w: 0.6, dash: [5, 3] }); text('COMMS', 53.75, 20.0, 6.5, B, { align: 'center', color: light });
    // plan title, scale bar (metres), north arrow
    page.drawCircle({ x: X(1.6), y: Y(48.2), size: 1.4 * S, borderColor: ink, borderWidth: 1 }); text(String(level), 1.6, 48.6, 14, B, { align: 'center' });
    text(`LEVEL ${level} FLOOR PLAN`, 4, 48, 16, B); path(`M ${P(4, 48.4)} L ${P(24, 48.4)}`, { w: 1.2 }); text('SCALE 1:50 @ A2', 4, 49.8, 9, R);
    const m1 = 1 / 0.3; for (let k = 0; k < 4; k++) rectFt(30 + k * m1, 48, m1, 0.5, k % 2 ? white : ink); page.drawRectangle({ x: X(30), y: Y(48.5), width: 4 * m1 * S, height: 0.5 * S, borderColor: ink, borderWidth: 0.6 });
    ['0', '1', '2', '3', '4 m'].forEach((l, k) => text(l, 30 + k * m1, 49.7, 8, R, { align: 'center' }));
    path(`M ${P(52, 50)} L ${P(53.2, 46)} L ${P(54.4, 50)} L ${P(53.2, 49)} Z`, { w: 0.8, fill: ink }); text('N', 53.2, 45.2, 12, B, { align: 'center' });
    // title block (fixed on the sheet)
    const tb = { x: SW - 300, y: 30, w: 270, h: SH - 60 };
    page.drawRectangle({ x: tb.x, y: tb.y, width: tb.w, height: tb.h, borderColor: ink, borderWidth: 1.6 });
    const line = (y) => page.drawLine({ start: { x: tb.x, y }, end: { x: tb.x + tb.w, y }, thickness: 0.8, color: ink });
    const tt = (s, y, size, font = R, color = ink) => page.drawText(s, { x: tb.x + 16, y, size, font, color });
    tt('NORTHWALL ARCHITECTS', SH - 80, 14, B); tt('Sample practice  •  not a real firm', SH - 98, 8, R, light); line(SH - 120);
    tt('PROJECT', SH - 142, 7, B, light); tt('HARBOUR VIEW RESIDENCE', SH - 162, 12, B); tt('1 Sample Street, Anytown', SH - 178, 9); line(SH - 200);
    tt('REVISIONS', SH - 222, 7, B, light);
    const revs = rev === 'B' ? [['A', 'Issued for review', '03.02.26'], ['B', 'Bath enlarged, laundry door moved', '17.03.26']] : [['A', 'Issued for review', '03.02.26']];
    revs.forEach(([r, d, dt], k) => { const y = SH - 242 - k * 16; tt(r, y, 9, B); page.drawText(d, { x: tb.x + 34, y, size: 8, font: R, color: ink }); page.drawText(dt, { x: tb.x + tb.w - 54, y, size: 8, font: R, color: ink }); });
    line(300); tt('SHEET TITLE', 280, 7, B, light); tt(`LEVEL ${level} FLOOR PLAN`, 258, 13, B);
    line(232); tt('SCALE', 214, 7, B, light); tt('1:50 @ A2', 198, 10); page.drawText('DATE', { x: tb.x + 150, y: 214, size: 7, font: B, color: light }); page.drawText(rev === 'B' ? '17.03.26' : '03.02.26', { x: tb.x + 150, y: 198, size: 10, font: R, color: ink });
    line(180); tt('SHEET', 162, 7, B, light); tt(`A-10${level}`, 92, 50, B); page.drawText(`REV ${rev}`, { x: tb.x + tb.w - 70, y: 96, size: 15, font: B, color: ink });
    page.drawText('SAMPLE DRAWING FOR DEMONSTRATION ONLY', { x: 46, y: 42, size: 8, font: R, color: light });
  }
  sheet('B', 1, 0); sheet('B', 2, 1); sheet('B', 3, 2); sheet('A', 1, 3);
  return pdf.save();
}
// plan units -> page coordinates on a given sample page (including its shift)
function samplePt(x, y, page = 0) { const sh = SAMPLE.SHIFT[page] || [0, 0]; return [SAMPLE.OX + sh[0] + x * SAMPLE.U, SAMPLE.TOP + sh[1] + y * SAMPLE.U]; }
const SAMPLE_OUTLETS = [[1.15, 5], [6, 1.15], [14, 1.15], [19.4, 12], [24, 3.3], [32, 3.3]];
function sampleMarkups() {
  const f = (x, y) => samplePt(x, y, 0);
  const mk = (type, pts, extra = {}) => ({ ...newMarkup(type, 0, pts), author: 'Sample', layer: null, ...extra });
  const st = (t, o) => ({ ...toolStyle(t), ...(TOOLS[t].style || {}), ...o });
  const callout = mk('callout', [f(26.1, 26.8), f(31, 23.8), f(43.5, 26.2)], { subject: 'Callout', text: 'Confirm vanity size with owner: 1200 wide, ceiling 2700 AFL', style: st('callout', { fontSize: 11 }) });
  callout.runs = [{ t: 'Confirm ' }, { t: 'vanity size', b: true }, { t: ' with owner: ' }, { t: '1200', u: true }, { t: ' wide, ceiling 2700 AFL' }];
  return [
    mk('area', [f(0.75, 0.75), f(19.8, 0.75), f(19.8, 15.8), f(0.75, 15.8)], { subject: 'Flooring', text: 'Living', style: st('area', { stroke: '#8e3fd1', fill: '#8e3fd1', fillOpacity: 0.16, fontColor: '#5f2a8c' }), comment: 'Engineered oak, allow 8% waste' }),
    mk('polylength', [f(0.75, 18.5), f(55.25, 18.5)], { subject: 'Wall', text: 'Hall run', style: st('polylength', {}) }),
    mk('length', [f(20.21, 5), f(35.79, 5)], { subject: 'Length', style: st('length', {}) }),
    mk('count', SAMPLE_OUTLETS.map(([x, y]) => f(x, y)), { subject: 'Outlet', text: 'GPOs', style: st('count', { stroke: '#f08a00', fill: '#f08a00', size: 7 }) }),
    mk('cloud', [f(15.2, 20.4), f(29, 20.4), f(29, 30.2), f(15.2, 30.2)], { subject: 'Cloud', style: st('cloud', { stroke: '#d6331f', width: 1.5 }), status: 'None', comment: 'Bath layout under review' }),
    callout,
    mk('text', [f(37, 1.5), f(51, 4.2)], { subject: 'Text Box', text: 'Floor area 25 m2 (H2O-resistant finish)', runs: [{ t: 'Floor area 25 m' }, { t: '2', sup: true }, { t: ' (H' }, { t: '2', sub: true }, { t: 'O-resistant finish)', i: true }], style: st('text', { fontSize: 10, font: 'times' }) }),
    mk('note', [f(46, 6)], { subject: 'Note', comment: 'Verify ceiling height in dining before ordering the pendant.' }),
    mk('stamp', [[1175, 985], [1345, 1035]], { subject: 'Stamp', text: 'REVIEWED', style: st('stamp', { stroke: '#1f5fd1', fontColor: '#1f5fd1', width: 2 }) }),
  ];
}
async function openSample() {
  const busy = $('#busy'); busy.hidden = false; busy.textContent = 'Loading sample drawings…';
  try {
    const bytes = await buildSamplePdf(); const sc = presetScale('1:50');
    const doc = await openBytes('Harbour View - Architectural.pdf', bytes, { sample: true, scales: { 0: sc, 1: { ...sc }, 2: { ...sc }, 3: { ...sc } } });
    if (doc) {
      const r = sampleRisers(); doc.links = r.links; doc.markups = sampleMarkups().concat(r.markups); doc.markups.forEach((m) => { if (TEXT_TYPES.has(m.type)) fitTextBox(m); });
      // line the floors up on their grid (level 2 is shifted on its sheet) and put the risers on it
      try { await autoAlign(doc, 0, [1, 2, 3]); realignLinks(doc); } catch (e) { console.warn('sample alignment', e); }
      doc.dirty = false; doc.undo = []; renderAllMarks(doc); refreshAll();
    }
  } catch (e) { console.error(e); toast('Could not build the sample drawing: ' + e.message, 'error'); } finally { busy.hidden = true; }
}

// linked risers through levels 1-3: M1 supply air steps down at level 2, M2 exhaust, E1 electrical
function sampleRisers() {
  const mmIn = (v) => v / 25.4;
  const links = {
    'LK-m1': { id: 'LK-m1', name: 'M1', sizes: { a: { shape: 'rect', w: mmIn(600), h: mmIn(300) }, b: { shape: 'rect', w: mmIn(450), h: mmIn(300) } }, rot: 0, sync: true },
    'LK-m2': { id: 'LK-m2', name: 'M2', sizes: { a: { shape: 'circle', d: mmIn(250) } }, rot: 0, sync: true },
    'LK-e1': { id: 'LK-e1', name: 'E1', sizes: { a: { shape: 'rect', w: mmIn(450), h: mmIn(300) } }, rot: 90, sync: true },
  };
  const st = { ...toolStyle('sketchrect'), ...TOOLS.sketchrect.style, labelPos: 'below', showArea: true };
  const stE = { ...toolStyle('sketchcircle'), ...TOOLS.sketchcircle.style, labelPos: 'right' };
  const stEl = { ...st, stroke: '#d6331f', fill: '#d6331f', fontColor: '#a3200f', symbol: 'diag', labelPos: 'left', showArea: false };
  const mk = (page, link, c, sizeKey, transKey, style, subject) => ({ ...newMarkup('sketch', page, [c]), author: 'Sample', layer: null, link, sizeKey, transKey: transKey || null, style: { ...style }, subject });
  const at = (x, y) => samplePt(x, y, 0); // placed on level 1; realignLinks() moves the others onto the grid
  return { links, markups: [
    mk(0, 'LK-m1', at(18.6, 31.75), 'a', null, st, 'Supply riser'), mk(1, 'LK-m1', at(18.6, 31.75), 'a', 'b', st, 'Supply riser'), mk(2, 'LK-m1', at(18.6, 31.75), 'b', null, st, 'Supply riser'),
    mk(0, 'LK-m2', at(21.9, 31.75), 'a', null, stE, 'Exhaust riser'), mk(1, 'LK-m2', at(21.9, 31.75), 'a', null, stE, 'Exhaust riser'), mk(2, 'LK-m2', at(21.9, 31.75), 'a', null, stE, 'Exhaust riser'),
    mk(0, 'LK-e1', at(53.75, 18.2), 'a', null, stEl, 'Electrical riser'), mk(1, 'LK-e1', at(53.75, 18.2), 'a', null, stEl, 'Electrical riser'), mk(2, 'LK-e1', at(53.75, 18.2), 'a', null, stEl, 'Electrical riser'),
  ] };
}
