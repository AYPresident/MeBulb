// ===== Bluebeam tool sets (.btx) =================================================================
// A .btx file is XML: <BluebeamRevuToolSet Version="1"> with a <Title> and one <ToolChestItem> per
// tool. <Title> and each item's <Raw> are zlib-compressed and written as hex; Raw holds the
// tool's annotation dictionary in PDF syntax (no appearance, NM or page). MeBulb reads those
// dictionaries with the same code that reads Revu markups from PDFs, and writes its own tools
// with the same code that writes markups, so tool sets move between Revu and MeBulb both ways.
const hexOf = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s.toUpperCase(); };
const unhex = (s) => { s = String(s || '').replace(/[^0-9a-f]/gi, ''); const b = new Uint8Array(s.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16); return b; };
async function zlib(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); }
async function unzlib(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); }
const btxText = async (hex) => new TextDecoder('latin1').decode(await unzlib(unhex(hex)));
const BTX_TYPE = { Square: 'AnnotationSquare', Circle: 'AnnotationCircle', Line: 'AnnotationLine', PolyLine: 'AnnotationPolyLine', Polygon: 'AnnotationPolygon', Ink: 'AnnotationInk', FreeText: 'AnnotationFreeText', Text: 'AnnotationText', Stamp: 'AnnotationStamp', Highlight: 'AnnotationHighlight', StrikeOut: 'AnnotationStrikeOut', Underline: 'AnnotationUnderline' };

// a stand-in page for laying out tool samples (US Letter, PDF coordinates)
function sampleDoc() { return { pages: [{ w: 612, h: 792, T: [1, 0, 0, -1, 0, 792] }], scales: {}, viewports: {}, layers: [], markups: [], links: {}, numPages: 1 }; }
function sampleMarkup(it) {
  const t = it.tool; const s = { ...BASE_STYLE, ...(TOOLS[t] && TOOLS[t].style), ...(it.style || {}) }; const at = (pts) => pts.map(([x, y]) => [300 + x, 400 + y]);
  const geo = { line: [[-60, 20], [60, -20]], arrow: [[-60, 20], [60, -20]], length: [[-60, 0], [60, 0]], polyline: [[-60, 20], [0, -20], [60, 20]], polylength: [[-60, 20], [0, -20], [60, 20]], angle: [[-50, 20], [0, -30], [50, 20]], radius: [[0, 0], [40, 0]], count: [[0, 0]], note: [[-9, -9]], pen: [[-50, 10], [-20, -15], [10, 10], [40, -12]], highlight: [[-50, 0], [50, 0]] };
  const box = [[-60, -30], [60, 30]]; const poly = [[-60, 30], [-50, -30], [40, -25], [60, 25]];
  const pts = it.shape ? it.shape.pts.map((p) => p.slice()) : geo[t] || (['area', 'perimeter', 'volume', 'polygon', 'cloud'].includes(t) ? poly : t === 'callout' ? [[-80, 40], [-20, -30], [70, 10]] : box);
  return { id: 'PM-sample', type: t === 'sketchrect' || t === 'sketchcircle' ? 'rect' : t, page: 0, pts: at(pts), style: s, text: it.shape && it.shape.text != null ? it.shape.text : t === 'text' || t === 'callout' ? it.name || 'Text' : it.text || (t === 'stamp' ? 'APPROVED' : ''), runs: it.shape && it.shape.runs || null, subject: it.subject || it.name, author: state.author, created: nowISO(), modified: nowISO(), depth: it.depth };
}
// tool -> raw annotation dictionary text
async function toolRaw(it) {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([612, 792]); const doc = sampleDoc(); const m = sampleMarkup(it);
  const fonts = fontCache(pdf); fonts.reg = await fonts.get('FR'); fonts.bold = await fonts.get('FB');
  const refs = await annotsForPage(pdf, fonts, new Map(), doc, 0, page.ref, [m]); const d = pdf.context.lookup(refs[0]);
  ['AP', 'NM', 'P', 'MeBulbId', 'IRT', 'RT', 'GroupNesting', 'CreationDate', 'M'].forEach((k) => d.delete(PDFName.of(k)));
  return { sub: d.get(PDFName.of('Subtype')).asString().slice(1), text: d.toString().replace(/\n/g, '') };
}
async function btxXml(set) {
  const items = []; for (const [k, it] of set.items.entries()) { try { const r = await toolRaw(it); items.push(`  <ToolChestItem Version="1">\n    <Resources />\n    <Name>${hexOf(await zlib(new TextEncoder().encode(it.name)))}</Name>\n    <Type>Bluebeam.PDF.Annotations.${BTX_TYPE[r.sub] || 'Annotation' + r.sub}</Type>\n    <Raw>${hexOf(await zlib(bytesOf(r.text)))}</Raw>\n    <X>5.5</X>\n    <Y>5.5</Y>\n    <Index>${k}</Index>\n    <Mode>${it.mode === 'drawing' ? 'drawing' : 'properties'}</Mode>\n  </ToolChestItem>`); } catch (e) { console.warn('tool not exported', it.name, e); } }
  return { xml: `<?xml version="1.0" encoding="utf-8"?>\n<BluebeamRevuToolSet Version="1">\n  <Title>${hexOf(await zlib(new TextEncoder().encode(set.name)))}</Title>\n${items.join('\n')}\n</BluebeamRevuToolSet>\n`, n: items.length };
}
async function exportBtx(set) { const { xml, n } = await btxXml(set); await saveFile(`${set.name.replace(/[\\/:*?"<>|]/g, '_')}.btx`, xml, 'application/xml'); return n; }
// .btx -> MeBulb tool set
async function importBtx(file) {
  const xml = new TextDecoder().decode(new Uint8Array(await file.arrayBuffer())); if (!/<BluebeamRevuToolSet/.test(xml.slice(0, 600))) throw new Error(`${file.name} is not a Bluebeam tool set`);
  const dom = new DOMParser().parseFromString(xml, 'application/xml'); const get = (el, n) => { const c = el.querySelector(n); return c ? c.textContent.trim() : ''; };
  const decodeMaybe = async (s) => { if (/^[0-9a-f]+$/i.test(s) && s.length > 8 && /^78/i.test(s)) { try { return new TextDecoder().decode(await unzlib(unhex(s))); } catch { } } return s; };
  const title = (await decodeMaybe(get(dom.documentElement, 'Title'))) || file.name.replace(/\.btx$/i, '');
  const set = { id: uid('TS'), name: title, items: [], from: 'btx' }; const ctx = PDFLib.PDFContext.create(); const fakeR = { ctx, pull: async () => {}, resolve: async (o) => (o instanceof PDFRef ? ctx.lookup(o) : o), get: async (r) => ctx.lookup(r) };
  const doc = sampleDoc(); let skipped = 0;
  for (const el of dom.querySelectorAll('ToolChestItem')) {
    try {
      const raw = get(el, 'Raw'); const txt = /^[0-9a-f]+$/i.test(raw) ? await btxText(raw) : raw; const d = PDFLib.PDFObjectParser.forBytes(bytesOf(txt), ctx).parseObject(); if (!(d instanceof PDFDict)) { skipped++; continue; }
      if (!d.get(PDFName.of('Rect'))) d.set(PDFName.of('Rect'), ctx.obj([0, 0, 100, 50]));
      const sub = d.get(PDFName.of('Subtype')) ? d.get(PDFName.of('Subtype')).asString().slice(1) : '';
      let name = await decodeMaybe(get(el, 'Name')); const mode = /drawing/i.test(get(el, 'Mode')) ? 'drawing' : 'properties';
      const m = await toMarkup(fakeR, d, PDFRef.of(1, 0), 0, doc.pages[0].T, new Map(), doc);
      if (!m) { // a stamp whose picture lives outside the dictionary: keep it as a text stamp with its name
        if (sub === 'Stamp') { const nm = pdfText(d.get(PDFName.of('Name'))).replace(/^\//, '') || name || 'Stamp'; set.items.push({ name: name || nm, tool: 'stamp', text: nm.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase(), style: { stroke: pdfRgbHex(d.lookup(PDFName.of('C'))) || '#d6331f', fontColor: pdfRgbHex(d.lookup(PDFName.of('C'))) || '#d6331f', width: 2 }, mode: 'properties' }); continue; }
        skipped++; continue;
      }
      if (!name || /^[0-9A-F]{16,}$/.test(name)) name = m.subject || TOOLS[m.type].label; const c = G.bbox(m.pts); const cx = (c.x + c.x2) / 2, cy = (c.y + c.y2) / 2;
      set.items.push({ name, tool: m.type, style: m.style, subject: m.subject, text: m.type === 'stamp' ? m.text : undefined, depth: m.depth, mode: m.type === 'count' ? 'properties' : mode, shape: m.type === 'count' ? undefined : { pts: m.pts.map(([x, y]) => [x - cx, y - cy]), text: TEXT_TYPES.has(m.type) ? m.text : null, runs: m.runs || null }, ext: m.ext && m.ext.bsi ? { bsi: m.ext.bsi } : undefined });
    } catch (e) { console.warn('tool skipped', e); skipped++; }
  }
  return { set, skipped };
}
async function importBtxFiles(files) {
  let n = 0; for (const f of files) { try { const { set, skipped } = await importBtx(f); state.toolsets.push(set); n++; toast(`Imported ${set.items.length} tool${set.items.length === 1 ? '' : 's'} from “${set.name}”${skipped ? ` (${skipped} not supported)` : ''}`); } catch (e) { toast(e.message || String(e), 'error'); } }
  if (n) { saveToolsets(); renderToolsets(); openPanel('toolsets'); }
}
// little picture of a tool, like the Tool Chest shows
function toolPreview(it) {
  try { const m = sampleMarkup(it); const doc = sampleDoc(); const b = markupBBox(m, doc); const pad = 6; const vb = `${num(b.x - pad, 1)} ${num(b.y - pad, 1)} ${num(b.w + 2 * pad, 1)} ${num(b.h + 2 * pad, 1)}`;
    const prims = dl(m, doc).filter((p) => p.k !== 'text' || TEXT_TYPES.has(m.type) || m.type === 'stamp' || m.type === 'count'); return `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${prims.map(primSvg).join('')}</svg>`; } catch { return icon(TOOLS[it.tool] ? TOOLS[it.tool].icon : 'rect'); }
}
// Revu's "Recent Tools": the last looks you used
function noteRecentTool(m) {
  if (!m || !TOOLS[m.type] || ['textedit', 'sketch', 'image'].includes(m.type)) return; const c = G.bbox(m.pts); const cx = (c.x + c.x2) / 2, cy = (c.y + c.y2) / 2;
  const it = { name: m.subject || TOOLS[m.type].label, tool: m.type, style: deep(m.style), subject: m.subject, text: m.type === 'stamp' ? m.text : undefined, stampId: m.type === 'stamp' ? m.stampId : undefined, depth: m.depth,
    shape: m.type === 'count' || m.type === 'stamp' && m.asset ? undefined : { pts: m.pts.map(([x, y]) => [x - cx, y - cy]), text: TEXT_TYPES.has(m.type) ? m.text : null, runs: m.runs ? deep(m.runs) : null } };
  const key = JSON.stringify([it.tool, it.style, it.subject]); state.recentTools = [it, ...(state.recentTools || []).filter((x) => JSON.stringify([x.tool, x.style, x.subject]) !== key)].slice(0, 12); store.set('recentTools', state.recentTools); if (panelShown('toolsets')) renderToolsets();
}
