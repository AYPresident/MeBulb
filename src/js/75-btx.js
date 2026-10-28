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

// a stand-in page for laying out tool samples (US Letter, PDF coordinates); stamp artwork from the tool sets
function sampleDoc() { return { pages: [{ w: 612, h: 792, T: [1, 0, 0, -1, 0, 792] }], scales: {}, viewports: {}, layers: [], markups: [], links: {}, numPages: 1, assets: typeof toolAssets === 'function' ? toolAssets() : {}, assetImg: TOOL_ASSETS.img }; }
function sampleMarkup(it) {
  if (it.tool === 'group') return toolMarkups(it)[0];
  const t = it.tool; const s = { ...BASE_STYLE, ...(TOOLS[t] && TOOLS[t].style), ...(it.style || {}) }; const at = (pts) => pts.map(([x, y]) => [300 + x, 400 + y]);
  const geo = { line: [[-60, 20], [60, -20]], arrow: [[-60, 20], [60, -20]], length: [[-60, 0], [60, 0]], polyline: [[-60, 20], [0, -20], [60, 20]], polylength: [[-60, 20], [0, -20], [60, 20]], angle: [[-50, 20], [0, -30], [50, 20]], radius: [[0, 0], [40, 0]], count: [[0, 0]], note: [[-9, -9]], pen: [[-50, 10], [-20, -15], [10, 10], [40, -12]], highlight: [[-50, 0], [50, 0]] };
  const box = [[-60, -30], [60, 30]]; const poly = [[-60, 30], [-50, -30], [40, -25], [60, 25]];
  const pts = it.shape ? it.shape.pts.map((p) => p.slice()) : geo[t] || (['area', 'perimeter', 'volume', 'polygon', 'cloud'].includes(t) ? poly : t === 'callout' ? [[-80, 40], [-20, -30], [70, 10]] : box);
  return { id: 'PM-sample', type: t === 'sketchrect' || t === 'sketchcircle' ? 'rect' : t, page: 0, pts: at(pts), style: s, text: it.shape && it.shape.text != null ? it.shape.text : t === 'text' || t === 'callout' ? it.name || 'Text' : it.text || (t === 'stamp' ? 'APPROVED' : ''), runs: it.shape && it.shape.runs || null, curves: it.shape && it.shape.curves ? deep(it.shape.curves) : undefined, subject: it.subject || it.name, author: state.author, created: nowISO(), modified: nowISO(), depth: it.depth, asset: it.asset, ext: it.ext ? deep(it.ext) : undefined };
}
// every markup of a tool (a grouped tool has several), laid out around (300, 400)
function toolMarkups(it) {
  if (it.tool !== 'group') return [sampleMarkup(it)];
  return it.shapes.map((sh, k) => ({ id: 'PM-sample' + k, type: sh.type, page: 0, pts: sh.pts.map(([x, y]) => [300 + x, 400 + y]), style: { ...BASE_STYLE, ...((TOOLS[sh.type] && TOOLS[sh.type].style) || {}), ...sh.style }, text: sh.text || '', runs: sh.runs || null, subject: sh.subject, depth: sh.depth, asset: sh.asset, group: 'G-sample', ext: { ...(sh.ext || {}), groupPrimary: !!sh.primary || undefined, groupName: sh.primary ? it.name : undefined }, author: state.author, created: nowISO(), modified: nowISO() }));
}
// ----- export: MeBulb tools -> Revu tool chest items --------------------------------------------------------
const btxId = () => { let s = ''; for (let k = 0; k < 16; k++) s += String.fromCharCode(65 + Math.floor(Math.random() * 26)); return s; };
// objects an annotation points at (stamp artwork, images) become <Resources>, referenced as /BBObjPtr_<ID>
function btxResourcesOut(ctx, d) {
  const ids = new Map(); const queue = []; const out = [];
  const sub = (o) => {
    if (o instanceof PDFRef) { const k = refKey(o); if (!ids.has(k)) { ids.set(k, btxId()); queue.push(o); } return PDFName.of('BBObjPtr_' + ids.get(k)); }
    if (o instanceof PDFDict) return PDFDict.fromMapWithContext(new Map([...o.entries()].map(([k, v]) => [k, sub(v)])), ctx);
    if (o instanceof PDFArray) { const a = PDFArray.withContext(ctx); o.asArray().forEach((v) => a.push(sub(v))); return a; }
    return o;
  };
  const top = sub(d);
  while (queue.length) {
    const ref = queue.shift(); const o = ctx.lookup(ref); let bytes; if (o == null) { out.push({ id: ids.get(refKey(ref)), bytes: bytesOf('null') }); continue; }
    if (o instanceof PDFLib.PDFStream) { const dd = sub(o.dict); const data = o.getContents ? o.getContents() : o.contents; dd.set(PDFName.of('Length'), PDFLib.PDFNumber.of(data.length)); bytes = concatBytes([bytesOf(dd.toString() + '\nstream\n'), data, bytesOf('\nendstream')]); }
    else bytes = bytesOf(sub(o).toString());
    out.push({ id: ids.get(refKey(ref)), bytes });
  }
  return { dict: top, resources: out };
}
// local coordinates: Revu keeps every tool part at Rect [0 0 w h]
function btxLocal(ctx, d) {
  const r = d.lookup(PDFName.of('Rect')).asArray().map(nOf); const [x0, y0] = [Math.min(r[0], r[2]), Math.min(r[1], r[3])]; const w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
  const shift = (k) => { const a = d.lookup(PDFName.of(k)); if (!(a instanceof PDFArray)) return; const nested = a.size() && a.lookup(0) instanceof PDFArray; const mv = (arr) => ctx.obj(arr.asArray().map((v, i) => +(nOf(v) - (i % 2 ? y0 : x0)).toFixed(4))); d.set(PDFName.of(k), nested ? ctx.obj(a.asArray().map((x) => mv(x))) : mv(a)); };
  ['Vertices', 'L', 'CL', 'InkList', 'QuadPoints'].forEach(shift);
  d.set(PDFName.of('Rect'), ctx.obj([0, 0, +w.toFixed(4), +h.toFixed(4)])); d.set(PDFName.of('TempBBox'), ctx.obj([0, 0, +w.toFixed(4), +h.toFixed(4)]));
  return { left: x0, bottom: y0, w, h };
}
async function toolRawParts(it) {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([612, 792]); const doc = sampleDoc(); const ms = toolMarkups(it).filter((m) => !(it.tool === 'group' && m.type === 'count'));
  const fonts = fontCache(pdf); fonts.reg = await fonts.get('FR'); fonts.bold = await fonts.get('FB'); const ctx = pdf.context; const parts = [];
  for (const m of ms) {
    const refs = await annotsForPage(pdf, fonts, new Map(), doc, 0, page.ref, [m]); const d = ctx.lookup(refs[0]); const keepAp = d.get(PDFName.of('Subtype')).asString() === '/Stamp';
    ['NM', 'P', 'MeBulbId', 'IRT', 'RT', 'GroupNesting', 'CreationDate', 'M', 'Popup'].forEach((k) => d.delete(PDFName.of(k))); if (!keepAp) d.delete(PDFName.of('AP'));
    const box = btxLocal(ctx, d); parts.push({ m, d, box, sub: d.get(PDFName.of('Subtype')).asString().slice(1), id: btxId() });
  }
  fonts.finalize(); await pdf.flush(); return { ctx, parts }; // fonts and embedded artwork are written on flush
}
async function btxXml(set) {
  const hz = async (s) => hexOf(await zlib(typeof s === 'string' ? bytesOf(s) : s)); const items = [];
  for (const [k, it] of set.items.entries()) {
    try {
      const { ctx, parts } = await toolRawParts(it); if (!parts.length) continue; const head = parts.find((p) => p.m.ext && p.m.ext.groupPrimary) || parts[0];
      const grouped = parts.length > 1; const names = parts.map((p) => PDFName.of(p.id));
      const xml = []; let idx = k * 100;
      const partXml = async (p, child) => {
        if (grouped) { if (p === head) { const gn = ctx.obj([PDFHexString.fromText(it.name || 'Group'), ...names]); p.d.set(PDFName.of('TempNameID'), PDFName.of(p.id)); p.d.set(PDFName.of('TempGroupNesting'), gn); p.d.set(PDFName.of('TempGroupNestingName'), PDFName.of(p.id)); p.d.set(PDFName.of('GroupNesting'), gn); }
          else { p.d.set(PDFName.of('TempRT'), PDFName.of('Group')); p.d.set(PDFName.of('TempIRT'), PDFName.of(head.id)); p.d.set(PDFName.of('TempGroupNestingName'), PDFName.of(p.id)); } }
        const { dict, resources } = btxResourcesOut(ctx, p.d); const X = head.box.left - p.box.left, Y = head.box.bottom - p.box.bottom; // lower-left corner at (-X, -Y) from the first part's
        const res = []; for (const r of resources) res.push(`    <Resources>\n      <ID>${await hz(r.id)}</ID>\n      <Data>${await hz(r.bytes)}</Data>\n    </Resources>`);
        const ind = child ? '      ' : '    ';
        return { res, body: `${ind}<Type>Bluebeam.PDF.Annotations.${BTX_TYPE[p.sub] || 'Annotation' + p.sub}</Type>\n${ind}<Raw>${await hz(dict.toString().replace(/\n/g, ''))}</Raw>\n${ind}<X>${num(X, 4)}</X>\n${ind}<Y>${num(Y, 4)}</Y>\n${ind}<Index>${idx++}</Index>` };
      };
      const h = await partXml(head, false); const kids = []; const res = [...h.res];
      for (const p of parts) if (p !== head) { const c = await partXml(p, true); res.push(...c.res); kids.push(`    <Child>\n${c.body}\n    </Child>`); }
      xml.push(`  <ToolChestItem Version="1">\n${res.join('\n')}${res.length ? '\n' : ''}    <Name>${btxId()}</Name>\n${h.body}\n${kids.join('\n')}${kids.length ? '\n' : ''}    <Mode>${it.mode === 'drawing' || it.tool === 'group' ? 'drawing' : 'properties'}</Mode>\n  </ToolChestItem>`);
      items.push(xml.join('\n'));
    } catch (e) { console.warn('tool not exported', it.name, e); }
  }
  return { xml: `<?xml version="1.0" encoding="utf-8"?>\n<BluebeamRevuToolSet Version="1">\n  <Title>${await hz(new TextEncoder().encode(set.name))}</Title>\n${items.join('\n')}\n</BluebeamRevuToolSet>\n`, n: items.length };
}
async function exportBtx(set) { const { xml, n } = await btxXml(set); await saveFile(`${set.name.replace(/[\\/:*?"<>|]/g, '_')}.btx`, xml, 'application/xml'); return n; }
// .btx -> MeBulb tool set. Each <ToolChestItem> holds a <Raw> annotation dictionary (zlib + hex) drawn
// at Rect [0 0 w h], its <Resources> (fonts, images, stamp artwork: zlib + hex PDF objects that the
// dictionaries point at as /BBObjPtr_<ID>), and for grouped tools a <Child> per further markup.
// <X>/<Y> place each part: its Rect's lower-left corner sits at (-X, -Y) from the tool's origin (y up).
const TOOL_ASSETS = { list: null, img: {} };
function toolAssets() { if (!TOOL_ASSETS.list) TOOL_ASSETS.list = store.get('toolAssets', {}); return TOOL_ASSETS.list; }
async function btxResources(el, ctx) {
  const map = new Map(); const kids = (e, tag) => [...e.children].filter((c) => c.localName === tag); const txt = (e, tag) => { const c = kids(e, tag)[0]; return c ? c.textContent.trim() : ''; };
  const all = []; const walk = (e) => { kids(e, 'Resources').forEach((r) => all.push(r)); kids(e, 'Child').forEach(walk); }; walk(el);
  for (const r of all) {
    if (!txt(r, 'ID') || !txt(r, 'Data')) continue; // <Resources /> is often empty
    try { const id = new TextDecoder('latin1').decode(await unzlib(unhex(txt(r, 'ID')))); const data = await unzlib(unhex(txt(r, 'Data'))); if (map.has(id)) continue;
      const o = PDFLib.PDFObjectParser.forBytes(data, ctx).parseObject(); map.set(id, ctx.register(o)); } catch (e) { console.warn('tool resource skipped', e); }
  }
  // the objects point at each other by name: make those names real references
  const fix = (o, depth = 0) => {
    if (depth > 40 || !o) return o; if (o instanceof PDFName) { const m = /^\/BBObjPtr_(.+)$/.exec(o.asString()); return m && map.has(m[1]) ? map.get(m[1]) : o; }
    if (o instanceof PDFDict) { for (const [k, v] of o.entries()) { const n = fix(v, depth + 1); if (n !== v) o.set(k, n); } return o; }
    if (o instanceof PDFArray) { for (let k = 0; k < o.size(); k++) { const v = o.get(k); const n = fix(v, depth + 1); if (n !== v) o.set(k, n); } return o; }
    if (o.dict) fix(o.dict, depth + 1); return o;
  };
  for (const ref of map.values()) fix(ctx.lookup(ref));
  return { map, fix };
}
// one part of a tool -> a markup positioned from the tool's origin
async function btxPart(e, ctx, R, res, doc) {
  const kids = (tag) => [...e.children].filter((c) => c.localName === tag); const txt = (tag) => { const c = kids(tag)[0]; return c ? c.textContent.trim() : ''; };
  const raw = txt('Raw'); const bytes = /^[0-9a-f]+$/i.test(raw) ? await unzlib(unhex(raw)) : bytesOf(raw);
  const d = PDFLib.PDFObjectParser.forBytes(bytes, ctx).parseObject(); if (!(d instanceof PDFDict)) return { m: null, d: null };
  res.fix(d); const tb = d.lookup(PDFName.of('TempBBox')); if (!d.get(PDFName.of('Rect'))) d.set(PDFName.of('Rect'), tb || ctx.obj([0, 0, 100, 50]));
  const r = d.lookup(PDFName.of('Rect')).asArray().map(nOf); const X = +txt('X') || 0, Y = +txt('Y') || 0;
  const T = [1, 0, 0, -1, -X - r[0], Y + r[1]]; // the part's Rect corner sits at (-X, -Y) from the tool's origin (PDF axes, y up); tool space is y down
  const m = await toMarkup(R, d, PDFRef.of(1, 0), 0, T, new Map(), doc); return { m, d };
}
async function importBtx(file) {
  const xml = new TextDecoder().decode(new Uint8Array(await file.arrayBuffer())); if (!/<BluebeamRevuToolSet/.test(xml.slice(0, 600))) throw new Error(`${file.name} is not a Bluebeam tool set`);
  const dom = new DOMParser().parseFromString(xml, 'application/xml'); const kids = (e, tag) => [...e.children].filter((c) => c.localName === tag); const txt = (e, tag) => { const c = kids(e, tag)[0]; return c ? c.textContent.trim() : ''; };
  const decodeMaybe = async (s) => { if (/^[0-9a-f]+$/i.test(s) && s.length > 8 && /^78/i.test(s)) { try { return new TextDecoder().decode(await unzlib(unhex(s))); } catch { } } return s; };
  const title = (await decodeMaybe(txt(dom.documentElement, 'Title'))) || file.name.replace(/\.btx$/i, '');
  const set = { id: uid('TS'), name: title, items: [], from: 'btx', view: 'grid' }; let skipped = 0; const A = toolAssets();
  const keepAsset = (doc, m) => { if (!m.asset || !doc.assets[m.asset]) return; A[m.asset] = doc.assets[m.asset]; if (doc.assetImg && doc.assetImg[m.asset]) TOOL_ASSETS.img[m.asset] = doc.assetImg[m.asset]; };
  for (const el of kids(dom.documentElement, 'ToolChestItem')) {
    try {
      const ctx = PDFLib.PDFContext.create(); const R = { ctx, pull: async () => {}, resolve: async (o) => (o instanceof PDFRef ? ctx.lookup(o) : o), get: async (r) => ctx.lookup(r) }; const doc = sampleDoc(); doc.assets = {}; doc.assetImg = {};
      const res = await btxResources(el, ctx); const mode = /drawing/i.test(txt(el, 'Mode')) ? 'drawing' : 'properties';
      const head = await btxPart(el, ctx, R, res, doc); const parts = [head];
      const walkKids = async (e) => { for (const c of kids(e, 'Child')) { parts.push(await btxPart(c, ctx, R, res, doc)); await walkKids(c); } }; await walkKids(el);
      const ms = parts.map((p) => p.m).filter(Boolean);
      if (!ms.length) { // a stamp whose picture is not in the file: keep it as a text stamp with its name
        const d = head.d; const sub = d && d.get(PDFName.of('Subtype')) ? d.get(PDFName.of('Subtype')).asString() : '';
        if (sub === '/Stamp') { const nm = pdfText(d.get(PDFName.of('Name'))).replace(/^\//, '') || pdfText(d.get(PDFName.of('Subj'))) || 'Stamp'; const col = pdfRgbHex(d.lookup(PDFName.of('C'))) || '#d6331f'; set.items.push({ name: pdfText(d.get(PDFName.of('Subj'))) || nm, tool: 'stamp', text: nm.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase(), style: { stroke: col, fontColor: col, width: 2 }, mode: 'properties' }); continue; }
        skipped++; continue;
      }
      // the group's first markup is the one named like the item; its nesting list carries the group's name
      const itemId = txt(el, 'Name'); const idOf = (d) => { const v = d && d.get(PDFName.of('TempNameID')); return v && v.asString ? v.asString().replace(/^\//, '') : ''; };
      const prim = parts.find((p) => p.m && idOf(p.d) === itemId) || head; const nd = prim.d || head.d;
      const nest = nd && (nd.lookup(PDFName.of('TempGroupNesting')) || nd.lookup(PDFName.of('GroupNesting'))); const groupName = (nest instanceof PDFArray && nest.size() ? pdfText(nest.lookup(0)) : '').trim();
      ms.forEach((m) => keepAsset(doc, m));
      if (ms.length === 1) {
        const m = ms[0]; const c = G.bbox(m.pts); const cx = (c.x + c.x2) / 2, cy = (c.y + c.y2) / 2;
        set.items.push({ name: m.subject || groupName || TOOLS[m.type].label, tool: m.type, style: m.style, subject: m.subject, text: m.type === 'stamp' ? m.text : undefined, depth: m.depth, mode: m.type === 'count' ? 'properties' : mode, asset: m.asset, ext: m.ext && (m.ext.it || m.ext.bsi) ? { it: m.ext.it || undefined, bsi: m.ext.bsi || undefined } : undefined,
          shape: m.type === 'count' ? undefined : { pts: m.pts.map(([x, y]) => [x - cx, y - cy]), text: TEXT_TYPES.has(m.type) ? m.text : null, runs: m.runs || null } });
      } else { // a grouped tool (a legend, a stamp built from markups, a cloud with its callout): placed as a group
        const all = G.bbox(ms.flatMap((m) => m.pts)); const cx = (all.x + all.x2) / 2, cy = (all.y + all.y2) / 2;
        set.items.push({ name: groupName || prim.m && prim.m.subject || 'Group', tool: 'group', mode: 'drawing', subject: groupName || undefined,
          shapes: ms.map((m) => ({ type: m.type, pts: m.pts.map(([x, y]) => [x - cx, y - cy]), style: m.style, text: m.text, runs: m.runs || null, subject: m.subject, depth: m.depth, asset: m.asset, primary: m === prim.m || undefined, ext: m.ext && m.ext.it ? { it: m.ext.it } : undefined })) });
      }
    } catch (e) { console.warn('tool skipped', e); skipped++; }
  }
  store.set('toolAssets', A);
  return { set, skipped };
}
async function importBtxFiles(files) {
  let n = 0; for (const f of files) { try { const { set, skipped } = await importBtx(f); state.toolsets.push(set); n++; toast(`Imported ${set.items.length} tool${set.items.length === 1 ? '' : 's'} from “${set.name}”${skipped ? ` (${skipped} not supported)` : ''}`); } catch (e) { toast(e.message || String(e), 'error'); } }
  if (n) { saveToolsets(); renderToolsets(); openPanel('toolsets'); }
}
// little picture of a tool, like the Tool Chest shows (stamp artwork is drawn once it has been rendered)
function toolPreview(it) {
  try {
    const doc = sampleDoc(); const ms = toolMarkups(it); const boxes = ms.map((m) => markupBBox(m, doc)); const b = G.bbox(boxes.flatMap((x) => [[x.x, x.y], [x.x2, x.y2]])); const pad = Math.max(4, Math.max(b.w, b.h) * 0.04);
    const missing = ms.filter((m) => m.asset && !TOOL_ASSETS.img[m.asset] && doc.assets[m.asset]); if (missing.length) toolAssetImages(missing.map((m) => m.asset));
    const vb = `${num(b.x - pad, 1)} ${num(b.y - pad, 1)} ${num(b.w + 2 * pad, 1)} ${num(b.h + 2 * pad, 1)}`;
    const prims = ms.flatMap((m) => dl(m, doc).filter((p) => p.k !== 'text' || TEXT_TYPES.has(m.type) || m.type === 'stamp' || m.type === 'count' || it.tool === 'group'));
    return `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${prims.map(primSvg).join('')}</svg>`;
  } catch { return icon(TOOLS[it.tool] ? TOOLS[it.tool].icon : 'stamp'); }
}
let _assetImgBusy = null;
function toolAssetImages(ids) {
  if (_assetImgBusy) return; const A = toolAssets(); const doc = { assets: A, assetImg: TOOL_ASSETS.img };
  _assetImgBusy = (async () => { for (const id of ids) await assetImage(doc, id).catch(() => {}); })().finally(() => { _assetImgBusy = null; if (typeof _pvCache !== 'undefined') _pvCache.clear(); if (panelShown('toolsets')) renderToolsets(); });
}
// Revu's "Recent Tools": the last looks you used
function noteRecentTool(m) {
  if (!m || !TOOLS[m.type] || ['textedit', 'sketch', 'image'].includes(m.type)) return; const c = G.bbox(m.pts); const cx = (c.x + c.x2) / 2, cy = (c.y + c.y2) / 2;
  const it = { name: m.subject || TOOLS[m.type].label, tool: m.type, style: deep(m.style), subject: m.subject, text: m.type === 'stamp' ? m.text : undefined, stampId: m.type === 'stamp' ? m.stampId : undefined, depth: m.depth,
    shape: m.type === 'count' || m.type === 'stamp' && m.asset ? undefined : { pts: m.pts.map(([x, y]) => [x - cx, y - cy]), text: TEXT_TYPES.has(m.type) ? m.text : null, runs: m.runs ? deep(m.runs) : null, curves: CV.has(m) ? deep(m.curves) : undefined } };
  const key = JSON.stringify([it.tool, it.style, it.subject]); state.recentTools = [it, ...(state.recentTools || []).filter((x) => JSON.stringify([x.tool, x.style, x.subject]) !== key)].slice(0, 12); store.set('recentTools', state.recentTools); if (panelShown('toolsets')) renderToolsets();
}
