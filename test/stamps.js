// Custom PDF stamps: import, fields filled from a popup, Acrobat-style JavaScript, vector output
const { launch } = require('./harness');
const fs = require('fs'); const { execSync } = require('child_process');
const OUT = '/home/claude/planmark/test/out';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1400, height: 900 } });
  const ev = (fn, a) => page.evaluate(fn, a);
  // a dynamic stamp like the ones made in Acrobat: fields + a calculate script with app.response
  await ev(async () => {
    const { PDFDocument, PDFName, PDFString, PDFHexString, rgb, StandardFonts } = PDFLib;
    const pdf = await PDFDocument.create(); const pg = pdf.addPage([220, 90]); const f = await pdf.embedFont(StandardFonts.HelveticaBold);
    pg.drawRectangle({ x: 3, y: 3, width: 214, height: 84, borderColor: rgb(0.1, 0.4, 0.8), borderWidth: 3 }); pg.drawText('CHECKED', { x: 12, y: 62, size: 18, font: f, color: rgb(0.1, 0.4, 0.8) });
    const form = pdf.getForm(); const name = form.createTextField('Name'); name.addToPage(pg, { x: 12, y: 34, width: 196, height: 18, borderWidth: 0 }); const date = form.createTextField('Date'); date.addToPage(pg, { x: 12, y: 10, width: 120, height: 18, borderWidth: 0 });
    const ctx = pdf.context; name.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText('Checked by'));
    const code = 'if (event.source.forReal && event.source.stampName == "#Checked") { this.getField("Name").value = app.response("Checked by:", "Stamp", identity.name); this.getField("Date").value = util.printd("dd/mm/yyyy", new Date(2026, 9, 28)); }';
    date.acroField.dict.set(PDFName.of('AA'), ctx.obj({ C: { S: 'JavaScript', JS: PDFString.of(code) } }));
    const tree = ctx.obj({ Names: [PDFString.of('#Checked'), pg.ref] }); pdf.catalog.set(PDFName.of('Names'), ctx.obj({ Pages: tree }));
    const bytes = await pdf.save(); window.__stampFile = new File([bytes], 'Checked by.pdf', { type: 'application/pdf' });
  });
  const n = await ev(async () => { await mebulb.importStampFiles([window.__stampFile]); return mebulb.STAMPLIB.list.length; });
  ok(n > 10, 'stamp imported into the library (' + n + ' stamps)');
  await ev(() => mebulb.runCommand('tool.stamps')); await page.waitForSelector('.st-row'); await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/stamps-library.png' });
  await page.click('.st-row:has-text("Checked by")'); await page.click('#modal footer .btn.primary');
  ok(await ev(() => mebulb.state.tool === 'stamp' && /^ST-/.test(mebulb.state.stampId)), 'picking it arms the stamp tool');
  const [x, y] = await ev(() => { const d = mebulb.activeDoc(); mebulb.goToPage(0, [800, 700]); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + 800 * d.zoom, r.top + 700 * d.zoom]; });
  await page.waitForTimeout(300); await page.mouse.click(x, y);
  await page.waitForSelector('#modal input[name=p0]'); const q = await ev(() => document.querySelector('#modal label').textContent + ' = ' + document.querySelector('#modal input[name=p0]').value);
  ok(/Checked by/.test(q), 'the stamp script asks its question in a popup: ' + q);
  await page.fill('#modal input[name=p0]', 'J. Citizen'); await page.click('#modal footer .btn.primary'); await page.waitForTimeout(1200);
  const m = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; return { type: m.type, asset: !!m.asset, vals: m.stampValues, img: !!(d.assetImg && d.assetImg[m.asset]) }; });
  ok(m.type === 'stamp' && m.asset && m.img && m.vals.Name === 'J. Citizen' && m.vals.Date === '28/10/2026', 'placed with script results: ' + JSON.stringify(m.vals));
  await page.screenshot({ path: OUT + '/stamps-placed.png' });
  const b64 = await ev(async () => { const d = mebulb.activeDoc(); d.reader = await mebulb.openReader(d.src); const u = await mebulb.incrementalUpdate(d, {}); const all = new Uint8Array(d.src.size + u.bytes.length); all.set(d.src.bytes); all.set(u.bytes, d.src.size); let s = ''; for (let i = 0; i < all.length; i += 32768) s += String.fromCharCode.apply(null, all.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(OUT + '/stamps.pdf', Buffer.from(b64, 'base64'));
  ok(/No syntax or stream encoding errors/.test(execSync(`qpdf --check ${OUT}/stamps.pdf 2>&1 || true`, { encoding: 'utf8' })), 'saved PDF with the stamp passes qpdf');
  const txt = execSync(`pdftotext -f 1 -l 1 ${OUT}/stamps.pdf - 2>/dev/null || true`, { encoding: 'utf8' });
  ok(/J\. Citizen/.test(txt) && /28\/10\/2026/.test(txt) && /CHECKED/.test(txt), 'stamp artwork and filled fields are vector text in the PDF');
  // reopen: artwork comes back from the file
  const re = await ev(async (b) => { const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const d = await mebulb.openBytes('Stamped.pdf', bytes); const m = d.markups.find((x) => x.asset); return { asset: !!m, img: !!(m && d.assetImg && d.assetImg[m.asset]) }; }, b64);
  ok(re.asset && re.img, 'reopened PDF keeps the stamp artwork');
  // a Bluebeam-style stamp: blank page, artwork as annotations, &[User] / &[Date] dynamic text, dialog built with app.execDialog
  await ev(async () => {
    const { PDFDocument, PDFName, PDFString, StandardFonts } = PDFLib;
    const pdf = await PDFDocument.create(); const pg = pdf.addPage([200, 60]); const ctx = pdf.context; const font = await pdf.embedFont(StandardFonts.Helvetica);
    const ap = ctx.register(ctx.stream('1 0 0 RG 2 w 2 2 196 56 re S BT /F1 11 Tf 0 0 1 rg 8 36 Td (Checked by &[User]) Tj 0 -16 Td (on &[Date]) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 60], Resources: { Font: { F1: font.ref } } }));
    const a = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [0, 0, 200, 60], Contents: PDFString.of('Checked by &[User]'), AP: { N: ap }, F: 4 })); pg.node.set(PDFName.of('Annots'), ctx.obj([a]));
    await font.embed(); window.__bbStamp = new File([await pdf.save()], 'BB checked.pdf', { type: 'application/pdf' });
  });
  await ev(async () => { await mebulb.importStampFiles([window.__bbStamp]); const st = mebulb.STAMPLIB.list.find((s) => s.name === 'BB checked'); mebulb.state.stampId = st.id; mebulb.setTool('stamp'); });
  const [x2, y2] = await ev(() => { const d = mebulb.activeDoc(); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + 500 * d.zoom, r.top + 900 * d.zoom]; });
  await ev(() => mebulb.goToPage(0, [500, 900])); await page.waitForTimeout(300);
  const [x3, y3] = await ev(() => { const d = mebulb.activeDoc(); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + 500 * d.zoom, r.top + 900 * d.zoom]; });
  await page.mouse.click(x3, y3); await page.waitForTimeout(1500);
  const b64b = await ev(async () => { const d = mebulb.activeDoc(); d.reader = await mebulb.openReader(d.src); const u = await mebulb.incrementalUpdate(d, {}); const all = new Uint8Array(d.src.size + u.bytes.length); all.set(d.src.bytes); all.set(u.bytes, d.src.size); let s = ''; for (let i = 0; i < all.length; i += 32768) s += String.fromCharCode.apply(null, all.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(OUT + '/stamps-bb.pdf', Buffer.from(b64b, 'base64'));
  const t2 = execSync(`pdftotext -f 1 -l 1 ${OUT}/stamps-bb.pdf - 2>/dev/null || true`, { encoding: 'utf8' });
  ok(/Checked by Reviewer/.test(t2) && !/&\[/.test(t2), 'Bluebeam-style stamp: annotation artwork baked in, &[User] filled: ' + (t2.match(/Checked by.*/) || [''])[0]);
  await page.screenshot({ path: OUT + '/stamps-bb.png' });
  // Revu "interactive stamp" layout: art box on an A4 sheet, a white panel annotation drawn before the fields,
  // a radio group, and the common builder/CreateDialog script with app.execDialog, validate and app.alert
  await ev(async () => {
    const { PDFDocument, PDFName, PDFString, StandardFonts, rgb } = PDFLib; const pdf = await PDFDocument.create(); const pg = pdf.addPage([595, 842]); const ctx = pdf.context;
    pg.node.set(PDFName.of('ArtBox'), ctx.obj([100, 600, 400, 760]));
    const panelAp = ctx.register(ctx.stream('1 1 1 rg 0 0.5 0 RG 2 w 101 601 298 158 re B', { Type: 'XObject', Subtype: 'Form', BBox: [100, 600, 400, 760], Resources: {} }));
    const panel = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [100, 600, 400, 760], IC: [1, 1, 1], F: 4, AP: { N: panelAp } }));
    const form = pdf.getForm(); const by = form.createTextField('CHECKED_BY'); by.addToPage(pg, { x: 120, y: 700, width: 200, height: 18, borderWidth: 0 });
    const st = form.createRadioGroup('Status'); st.addOptionToPage('OK', pg, { x: 120, y: 660, width: 12, height: 12 }); st.addOptionToPage('REDO', pg, { x: 220, y: 660, width: 12, height: 12 });
    const calc = form.createTextField('Calculation'); calc.addToPage(pg, { x: 120, y: 620, width: 1, height: 1, borderWidth: 0 });
    const builder = 'var builder = { textBoxes: [ { field: "CHECKED_BY", description: "Checked By:", default: function () { return String(identity.name || "").toUpperCase(); } } ], radioGroup: "Status", radioButtons: [ { value: "OK", description: "Approved" }, { value: "REDO", description: "Revise" } ], radioErrorMsg: "Please select a status" };';
    const main = 'if (event.source.forReal) { var sd = CreateDialog(builder); app.execDialog(sd); this.getField(builder.radioGroup).value = sd.radioSelection; for (var i = 0; i < builder.textBoxes.length; ++i) this.getField(builder.textBoxes[i].field).value = sd.textBoxResults[i]; }\n' +
      'function CreateDialog(b) { var sd = { builder: b, radioSelection: "", textBoxResults: [] }; var rad = b.radioButtons.map(function (c, i) { return { type: "radio", name: c.description, item_id: "rad" + i, group_id: "grp1" }; }); var opts = b.textBoxes.map(function (t, i) { return { type: "view", align_children: "align_row", elements: [ { type: "static_text", item_id: "sta" + i, name: t.description }, { type: "edit_text", item_id: "edt" + i } ] }; });' +
      ' sd.initialize = function (d) { var o = {}; for (var i = 0; i < this.builder.textBoxes.length; ++i) o["edt" + i] = this.builder.textBoxes[i].default(); d.load(o); };' +
      ' sd.commit = function (d) { var r = d.store(); for (var i = 0; i < this.builder.radioButtons.length; ++i) if (r["rad" + i] == true) { this.radioSelection = this.builder.radioButtons[i].value; break; } for (var j = 0; j < this.builder.textBoxes.length; ++j) this.textBoxResults[j] = r["edt" + j]; };' +
      ' sd.validate = function (d) { var r = d.store(); for (var i = 0; i < this.builder.radioButtons.length; ++i) if (r["rad" + i] == true) return true; app.alert(this.builder.radioErrorMsg); return false; };' +
      ' sd.description = { name: "Stamp Dialog", elements: [ { type: "view", elements: [ { type: "cluster", name: "Status", elements: rad }, { type: "cluster", name: "Options", elements: opts } ] }, { type: "ok" } ] }; return sd; }';
    calc.acroField.dict.set(PDFName.of('AA'), ctx.obj({ C: { S: 'JavaScript', JS: PDFString.of(main) } }));
    const js = ctx.register(ctx.obj({ S: 'JavaScript', JS: PDFString.of(builder) }));
    pdf.catalog.set(PDFName.of('Names'), ctx.obj({ JavaScript: { Names: [PDFString.of('Builder'), js] } }));
    // the panel comes first in /Annots, the fields after it (as Revu writes them)
    const an = pg.node.Annots(); const refs = an.asArray(); pg.node.set(PDFName.of('Annots'), ctx.obj([panel, ...refs]));
    window.__ivStamp = new File([await pdf.save()], 'Interactive QA.pdf', { type: 'application/pdf' });
  });
  await ev(async () => { await mebulb.importStampFiles([window.__ivStamp]); const st = mebulb.STAMPLIB.list.find((s) => s.name === 'Interactive QA'); mebulb.state.stampId = st.id; mebulb.setTool('stamp'); mebulb.goToPage(0, [900, 700]); });
  await page.waitForTimeout(300);
  const [x4, y4] = await ev(() => { const d = mebulb.activeDoc(); const r = d.pageEls[0].getBoundingClientRect(); return [r.left + 900 * d.zoom, r.top + 700 * d.zoom]; });
  await page.mouse.click(x4, y4); await page.waitForSelector('#modal .st-fill');
  const dlg = await ev(() => ({ legends: [...document.querySelectorAll('#modal legend')].map((l) => l.textContent), radios: document.querySelectorAll('#modal input[type=radio]').length, name: document.querySelector('#modal input[type=text]').value }));
  ok(dlg.legends.join() === 'Status,Options' && dlg.radios === 2 && dlg.name === 'REVIEWER', 'the stamp\'s own dialog: status choices and a name box filled in by its script ' + JSON.stringify(dlg));
  await page.click('#modal footer .btn.primary'); await page.waitForSelector('#modal .st-err');
  ok(/select a status/.test(await ev(() => document.querySelector('#modal .st-err').textContent)), 'its own check runs: pressing Stamp with no status shows its message');
  await page.check('#modal input[type=radio] >> nth=1'); await page.click('#modal footer .btn.primary'); await page.waitForTimeout(1500);
  const iv = await ev(() => { const d = mebulb.activeDoc(); const m = d.markups[d.markups.length - 1]; return { vals: m.stampValues, w: Math.round(Math.abs(m.pts[1][0] - m.pts[0][0])), h: Math.round(Math.abs(m.pts[1][1] - m.pts[0][1])), pdf: d.assets[m.asset].pdf }; });
  ok(iv.vals.Status === 'REDO' && iv.vals.CHECKED_BY === 'REVIEWER' && iv.w === 300 && iv.h === 160, `placed at the art box size (${iv.w}×${iv.h}) with ${JSON.stringify(iv.vals)}`);
  fs.writeFileSync(OUT + '/stamps-interactive.pdf', Buffer.from(iv.pdf, 'base64'));
  const t3 = execSync(`pdftotext ${OUT}/stamps-interactive.pdf - 2>/dev/null || true`, { encoding: 'utf8' });
  execSync(`pdftoppm -r 72 -png ${OUT}/stamps-interactive.pdf ${OUT}/stamps-interactive`);
  const px = execSync(`python3 -c "from PIL import Image; im=Image.open('${OUT}/stamps-interactive-1.png').convert('L'); print(sum(1 for y in range(55,80) for x in range(20,200) if im.getpixel((x,y))<128))"`, { encoding: 'utf8' }).trim();
  ok(/REVIEWER/.test(t3) && +px > 20, `filled name is drawn above the white panel (${px} dark pixels where the name is)`);
  console.log(errors.filter((e) => !/XFA/.test(e)).join('\n') || 'no errors');
  await browser.close();
})();
