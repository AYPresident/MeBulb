// ===== Interaction: tools, drawing, selection, editing ======================
const I = { pan: null, drag: null, space: false, touches: new Map(), pinch: null };

function setTool(t, opts = {}) {
  if (!TOOLS[t]) return;
  if (t !== 'alignpts' && state.alignPick) { state.alignPick = null; }
  if (state.draft) finishDraft(true);
  endCount();
  if (state.editing) commitEdit();
  state.tool = t; state.toolLocked = !!opts.lock;
  if (t !== 'select') { state.sel.clear(); refreshSelection(); }
  if (opts.style) state.toolStyles[t] = { ...(state.toolStyles[t] || {}), ...opts.style };
  state.toolSubjects[t] = opts.subject || null; state.toolText = opts.text || null;
  if (t === 'stamp' && opts.text) state.stampText = opts.text;
  $$('.tool-btn').forEach((b) => { b.classList.toggle('on', b.dataset.tool === t); b.classList.toggle('locked', b.dataset.tool === t && state.toolLocked); });
  V.el.dataset.tool = t;
  if (t === 'highlight' || t === 'strikeout' || t === 'edittext') prefetchText();
  if (t !== 'select' && t !== 'pan') prefetchGeometry();
  renderProps(); updateDraftBar(); renderToolbarsState();
}
function toolDone() { if (!state.toolLocked && !state.reuse && state.tool !== 'select') setTool('select'); }

function snapPoint(p, page, opts = {}) {
  state.snapHint = null; if (opts.noSnap) return p; const d = activeDoc(); const tol = 9 / d.zoom; let best = null, bd = tol, kind = '';
  const consider = (q, k, w = 1) => { const dd = G.dist(p, q) * w; if (dd < bd) { bd = dd; best = q; kind = k; } };
  if (state.snapMarkup) {
    for (const m of d.markups) {
      if (m.page !== page || !layerVisible(d, m.layer) || (opts.exclude && opts.exclude === m.id)) continue;
      if (m.type === 'pen' || m.type === 'highlight' || m.type === 'note' || QUAD_TYPES.has(m.type) || m.type === 'textedit') continue;
      if (m.type === 'sketch') { const g = sizeGeom(sketchSize(d, m), scaleForMarkup(d, m), m.pts[0], sketchRot(d, m)); consider(m.pts[0], 'center'); g.corners.forEach((q) => consider(q, 'end')); continue; }
      for (const q of m.pts) consider(q, 'end'); if (m.holes) m.holes.forEach((h) => h.forEach((q) => consider(q, 'end')));
    }
    if (state.draft && state.draft.page === page && state.draft.mode === 'multi') state.draft.m.pts.slice(0, -1).forEach((q) => consider(q, 'end'));
  }
  if (state.snapContent && !best) { const c = contentSnap(d, page, p, tol); if (c) { best = c.p; kind = c.kind; bd = c.d; } }
  if (!best && state.snapGrid) { const g = gridStep(d, page); if (g) { best = [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g]; kind = 'grid'; } }
  if (best) { state.snapHint = { page, p: best, kind }; return [best[0], best[1]]; }
  return p;
}

function newDraftMarkup(tool, page, pts) {
  if (TOOLS[tool] && TOOLS[tool].mode === 'sketch') {
    const sh = TOOLS[tool].shape; const m = newMarkup('sketch', page, pts, { sz: deep(state.sketchDefaults[sh]), tsz: null, rot: 0 });
    m.style = toolStyle(tool); m.subject = state.toolSubjects[tool] || TOOLS[tool].subject; return m;
  }
  const m = newMarkup(tool, page, pts);
  if (state.toolSubjects[tool]) m.subject = state.toolSubjects[tool];
  if (tool === 'stamp') m.text = state.stampText;
  if (tool === 'volume') m.depth = state.volDepth != null ? state.volDepth : defaultDepth(scaleAt(activeDoc(), page, pts[0]));
  if (tool === 'texthl') { m.style = { ...toolStyle('highlight'), width: 0 }; m.subject = state.toolSubjects.highlight || 'Highlight'; }
  return m;
}

// ----- pointer handling ----------------------------------------------------------
function onPointerDown(e) {
  const doc = activeDoc(); if (!doc || !doc.pageEls) return;
  if (e.target.closest('.txt-edit')) return;
  if (state.editing) commitEdit();
  hideMenu();
  const ae = document.activeElement; if (ae && ae !== V.el && ae !== document.body && !V.el.contains(ae)) ae.blur();
  if (document.activeElement !== V.el) V.el.focus({ preventScroll: true });
  if (e.pointerType === 'touch') {
    I.touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (I.touches.size === 2) { const [a, b] = [...I.touches.values()]; I.pinch = { d: G.dist(a, b), z: doc.zoom }; I.pan = null; I.drag = null; if (state.draft && state.draft.mode !== 'multi' && state.draft.mode !== 'click') cancelDraft(); return; }
  }
  if (e.button === 1 || (e.button === 0 && (I.space || state.tool === 'pan'))) { startPan(e); e.preventDefault(); return; }
  if (e.button === 2) return;
  const i = pageAtClient(e.clientX, e.clientY);
  if (state.tool === 'select') { selectDown(e, i); return; }
  if (i < 0 && !(state.draft && state.draft.mode !== 'drag')) return;
  e.preventDefault(); drawDown(e, i < 0 ? state.draft.page : i);
}
function startPan(e) { I.pan = { x: e.clientX, y: e.clientY, sl: V.el.scrollLeft, st: V.el.scrollTop }; V.el.classList.add('panning'); try { V.el.setPointerCapture(e.pointerId); } catch { } }

function selectDown(e, i) {
  const doc = activeDoc(); const hEl = e.target.closest('.hdl');
  if (hEl) { const m = getMarkup(hEl.dataset.m); if (!m) return; I.drag = { kind: 'handle', id: m.id, h: hEl.dataset.h, page: m.page, orig: deep(m.pts), origHoles: m.holes ? deep(m.holes) : null, moved: false, pid: e.pointerId }; capture(e); e.preventDefault(); return; }
  const mEl = e.target.closest('g.mk');
  if (state.painter) { if (mEl) { const m = getMarkup(mEl.dataset.id); if (m && !state.sel.has(m.id)) { applyPropsTo([m]); toast('Properties applied · Esc to stop'); } } else endPainter(); e.preventDefault(); return; }
  const part = e.target.closest('[data-part="label"]');
  if (mEl && part && i >= 0) { const m = getMarkup(mEl.dataset.id); if (m && m.type === 'sketch' && !isLocked(m, doc) && (state.sel.has(m.id) || e.shiftKey)) {
    if (!state.sel.has(m.id)) { state.sel.clear(); state.sel.add(m.id); refreshSelection(); }
    const L = sketchLabelBox(m, doc); I.drag = { kind: 'label', id: m.id, page: i, start: clientToPage(e, i), orig: L ? [L.x - m.pts[0][0], L.y - m.pts[0][1]] : [0, 0], had: m.labelOff ? m.labelOff.slice() : null, moved: false, sx: e.clientX, sy: e.clientY }; capture(e); e.preventDefault(); return; } }
  if (mEl && i >= 0) {
    const id = mEl.dataset.id; const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) { if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id); } else if (!state.sel.has(id)) { state.sel.clear(); state.sel.add(id); }
    refreshSelection();
    if (state.sel.has(id)) { const orig = {}; const movers = withLinked(doc, selected(doc).filter((m) => !isLocked(m, doc))); movers.forEach((m) => { orig[m.id] = markupGeom(m); }); I.drag = { kind: 'move', page: i, start: clientToPage(e, i), orig, movers: movers.map((m) => m.id), moved: false, sx: e.clientX, sy: e.clientY }; capture(e); }
    e.preventDefault(); return;
  }
  if (i < 0) { if (state.sel.size) { state.sel.clear(); refreshSelection(); } return; }
  if (e.pointerType === 'touch') { startPan(e); return; }
  if (!e.shiftKey && state.sel.size) { state.sel.clear(); refreshSelection(); }
  const p = clientToPage(e, i); state.marquee = { page: i, a: p, b: p }; I.drag = { kind: 'marquee', page: i }; capture(e); e.preventDefault();
}
function capture(e) { try { V.el.setPointerCapture(e.pointerId); } catch { } }

function drawDown(e, i) {
  const doc = activeDoc(); const t = TOOLS[state.tool]; let p = snapPoint(clientToPage(e, i), i); const d = state.draft;
  switch (t.mode) {
    case 'box': state.draft = { mode: 'drag', page: i, m: newDraftMarkup(state.tool, i, [p, p.slice()]), start: p }; capture(e); break;
    case 'sketch': state.draft = { mode: 'sketch', page: i, m: newDraftMarkup(state.tool, i, [p]), start: p, sx: e.clientX, sy: e.clientY, moved: false }; capture(e); break;
    case 'alignpick': alignPickClick(p, i); return;
    case 'textedit': {
      const hit = textHitAt(doc, i, p, 0);
      const ex = doc.markups.find((m) => m.type === 'textedit' && m.page === i && G.pointInPoly(p, m.pts));
      if (ex) { editPdfText(ex); return; }
      if (!hit) { prefetchText(); toast(doc.textCache[i] ? 'Click on a line of PDF text to edit it. Scanned pages need OCR first.' : 'Reading page text\u2026 try again in a moment'); return; }
      startPdfTextEdit(doc, i, hit); return;
    }
    case 'line':
      if (d && d.mode === 'click') { d.m.pts[1] = e.shiftKey ? G.snapAngle(d.m.pts[0], p) : p; finishDraft(); return; }
      state.draft = { mode: 'line', page: i, m: newDraftMarkup(state.tool, i, [p, p.slice()]), sx: e.clientX, sy: e.clientY, moved: false }; capture(e); break;
    case 'free': {
      const hit = state.tool === 'highlight' && textHitAt(doc, i, p, 0);
      if (hit) { state.draft = { mode: 'textsel', page: i, m: newDraftMarkup('texthl', i, []), anchor: hit }; state.draft.m.pts = textQuads(doc, i, hit, hit); }
      else state.draft = { mode: 'free', page: i, m: newDraftMarkup(state.tool, i, [p]) };
      capture(e); break;
    }
    case 'textsel': {
      const hit = textHitAt(doc, i, p, 0);
      if (!hit) { prefetchText(); toast(doc.textCache[i] ? 'Start on a line of PDF text. This page may be a scan with no text layer.' : 'Reading page text… try again in a moment'); return; }
      state.draft = { mode: 'textsel', page: i, m: newDraftMarkup(state.tool, i, []), anchor: hit }; state.draft.m.pts = textQuads(doc, i, hit, hit); if (state.tool === 'strikeout') state.draft.m.subject = state.draft.m.style.variant === 'under' ? 'Underline' : 'Strikethrough'; capture(e); break;
    }
    case 'multi':
      if (!d) { state.draft = { mode: 'multi', page: i, m: newDraftMarkup(state.tool, i, [p, p.slice()]), sx: e.clientX, sy: e.clientY, down: true, dragBox: !!t.dragBox, start: p }; capture(e); break; }
      if (d.page !== i) return;
      {
        const pts = d.m.pts; const real = pts.length - 1;
        if (e.shiftKey && real > 0) p = G.snapAngle(pts[real - 1], p);
        if (t.closed && real >= 3 && G.dist(p, pts[0]) < 8 / doc.zoom) { finishDraft(); return; }
        pts[real] = p; pts.push(p.slice()); d.down = true; d.sx = e.clientX; d.sy = e.clientY;
        if (t.maxPts && real + 1 >= t.maxPts) { finishDraft(); return; }
      }
      break;
    case 'count': {
      let m = state.countId && getMarkup(state.countId);
      if (m && m.page === i) { pushUndo(); m.pts.push(p); touch(m); renderMarkupEl(m); renderList(); }
      else { m = newDraftMarkup('count', i, [p]); addMarkup(m); state.countId = m.id; }
      updateDraftBar(); break;
    }
    case 'callout': state.draft = { mode: 'callout', page: i, m: newDraftMarkup('callout', i, [p, p.slice(), p.slice()]), start: p, sx: e.clientX, sy: e.clientY }; placeCalloutBox(state.draft, p, false); capture(e); break;
    case 'point':
      if (state.tool === 'note') { const m = newDraftMarkup('note', i, [[p[0] - 9, p[1] - 9]]); addMarkup(m); state.sel.clear(); state.sel.add(m.id); refreshSelection(); toolDone(); setTimeout(() => { const c = $('#prop-comment'); if (c) c.focus(); }, 30); }
      else if (state.tool === 'stamp') {
        placeStamp(doc, i, p).then((m) => { if (!m) return; addMarkup(m); state.sel.clear(); state.sel.add(m.id); refreshSelection(); toolDone(); }).catch((err) => { console.error(err); toast('Could not place the stamp: ' + err.message, 'error'); });
      }
      break;
  }
  renderDraft();
}
function placeCalloutBox(d, p, moved) {
  const tip = d.m.pts[0]; const W = 150, H = 34; if (!moved) p = [tip[0] + 50, tip[1] - 50];
  const right = p[0] >= tip[0];
  d.m.pts[1] = [right ? p[0] : p[0] - W, p[1] - H / 2]; d.m.pts[2] = [right ? p[0] + W : p[0], p[1] + H / 2];
}

function onPointerMove(e) {
  const doc = activeDoc(); if (!doc || !doc.pageEls) return;
  if (e.pointerType === 'touch' && I.touches.has(e.pointerId)) {
    I.touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (I.pinch && I.touches.size === 2) { const [a, b] = [...I.touches.values()]; setZoom(I.pinch.z * (G.dist(a, b) / I.pinch.d), { clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 }); return; }
  }
  if (I.pan) { V.el.scrollLeft = I.pan.sl - (e.clientX - I.pan.x); V.el.scrollTop = I.pan.st - (e.clientY - I.pan.y); return; }
  const pi = pageAtClient(e.clientX, e.clientY); updateCoords(e, pi);
  if (I.drag) { dragMove(e); return; }
  const d = state.draft;
  if (!d) { if (state.tool !== 'select' && state.tool !== 'pan' && pi >= 0) { const had = !!state.snapHint; snapPoint(clientToPage(e, pi), pi); if (had || state.snapHint) renderDraft(); } return; }
  const i = d.page; let p = clientToPage(e, i);
  const moved = d.sx != null && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5;
  switch (d.mode) {
    case 'drag': {
      p = snapPoint(p, i); const a = d.start;
      if (e.shiftKey) { const s = Math.max(Math.abs(p[0] - a[0]), Math.abs(p[1] - a[1])); p = [a[0] + Math.sign(p[0] - a[0] || 1) * s, a[1] + Math.sign(p[1] - a[1] || 1) * s]; }
      d.m.pts[1] = p; break;
    }
    case 'line': case 'click': p = snapPoint(p, i); d.m.pts[1] = e.shiftKey ? G.snapAngle(d.m.pts[0], p) : p; if (moved) d.moved = true; break;
    case 'free': { const last = d.m.pts[d.m.pts.length - 1]; if (G.dist(last, p) > 1.2 / doc.zoom) d.m.pts.push(p); break; }
    case 'multi': {
      if (d.dragBox && d.down && d.m.pts.length === 2 && (moved || d.boxDrag)) { d.boxDrag = true; d.m.pts = G.rectPts(d.start, p); d.m.pts.push(p.slice()); break; }
      if (d.boxDrag) { d.m.pts = G.rectPts(d.start, p); d.m.pts.push(p.slice()); break; }
      p = snapPoint(p, i); const pts = d.m.pts; if (e.shiftKey && pts.length > 1) p = G.snapAngle(pts[pts.length - 2], p); pts[pts.length - 1] = p; break;
    }
    case 'callout': placeCalloutBox(d, p, moved); break;
    case 'textsel': { const hit = textHitAt(doc, i, p, 1); if (hit) d.m.pts = textQuads(doc, i, d.anchor, hit); break; }
    case 'sketch': {
      if (!moved && !d.moved) break; d.moved = true; p = snapPoint(p, i); const a = d.start; const sc = scaleAt(doc, i, a); const m = d.m;
      if (m.sz.shape === 'circle') { m.pts = [a]; m.sz = { shape: 'circle', d: roundInch(2 * G.dist(a, p) * sc.inPerPt, sc) }; }
      else { let w = roundInch(Math.abs(p[0] - a[0]) * sc.inPerPt, sc), h = roundInch(Math.abs(p[1] - a[1]) * sc.inPerPt, sc); if (e.shiftKey) w = h = Math.max(w, h); m.sz = { shape: 'rect', w, h }; m.pts = [[a[0] + Math.sign(p[0] - a[0] || 1) * (w / sc.inPerPt) / 2, a[1] + Math.sign(p[1] - a[1] || 1) * (h / sc.inPerPt) / 2]]; }
      break;
    }
  }
  renderDraft();
}

function dragMove(e) {
  const doc = activeDoc(); const g = I.drag;
  if (g.kind === 'marquee') { state.marquee.b = clientToPage(e, g.page); renderDraft(); return; }
  if (g.kind === 'move') {
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return;
    const p = clientToPage(e, g.page); let dx = p[0] - g.start[0], dy = p[1] - g.start[1];
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const ms = g.movers.map((id) => getMarkup(id)).filter(Boolean); if (!ms.length) return;
    if (!g.moved) { pushUndo(doc); g.moved = true; }
    ms.forEach((m) => { const o = g.orig[m.id]; const f = (q) => [q[0] + dx, q[1] + dy]; m.pts = o.pts.map(f); if (o.holes) m.holes = o.holes.map((h) => h.map(f)); if (o.base) m.base = f(o.base); renderMarkupEl(m, doc); });
    syncLinked(doc, ms.filter((m) => m.type === 'sketch')).forEach((x) => renderMarkupEl(x, doc));
    new Set(ms.map((m) => m.page)).forEach((pg) => renderSel(doc, pg)); return;
  }
  if (g.kind === 'label') {
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return; const m = getMarkup(g.id); if (!m) return;
    if (!g.moved) { pushUndo(doc); g.moved = true; } const p = clientToPage(e, g.page); m.labelOff = [g.orig[0] + p[0] - g.start[0], g.orig[1] + p[1] - g.start[1]]; renderMarkupEl(m, doc); return;
  }
  if (g.kind === 'handle') {
    const m = getMarkup(g.id); if (!m) return; let p = snapPoint(clientToPage(e, m.page), m.page, { exclude: m.id });
    if (!g.moved) { pushUndo(doc); g.moved = true; }
    applyHandle(m, g.h, p, g.orig, e.shiftKey, g.origHoles);
    if (m.type === 'sketch' && m.link) linkSiblings(doc, m).forEach((x) => renderMarkupEl(x, doc)); else renderMarkupEl(m, doc);
    renderSel(doc, m.page); renderDraft(); if (m.type === 'sketch') renderPropbar();
  }
}
function applyHandle(m, h, p, orig, shift, origHoles) {
  if (m.type === 'sketch') { applySketchHandle(m, h, p, shift); return; }
  if (h[0] === 'h') { const [hk, hi] = h.slice(1).split('.').map(Number); if (m.holes && m.holes[hk]) m.holes[hk][hi] = p; return; }
  const k = +h.slice(1);
  if (h[0] === 'v') {
    if (shift && orig.length > 1) { const ref = orig[k > 0 ? k - 1 : 1]; p = G.snapAngle(ref, p); }
    m.pts[k] = p; return;
  }
  const boxCorners = (a, b) => { const r = boxRect(a, b); return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]; };
  if (h[0] === 'c' || h[0] === 'b') {
    const ia = h[0] === 'c' ? 0 : 1; const cs = boxCorners(orig[ia], orig[ia + 1]); const opp = cs[(k + 2) % 4];
    if (shift && m.type === 'image' && m.imgW) { const ar = m.imgW / m.imgH; const w = Math.abs(p[0] - opp[0]); p = [p[0], opp[1] + Math.sign(p[1] - opp[1] || 1) * (w / ar)]; }
    m.pts[ia] = [Math.min(opp[0], p[0]), Math.min(opp[1], p[1])]; m.pts[ia + 1] = [Math.max(opp[0], p[0]), Math.max(opp[1], p[1])]; return;
  }
  if (h[0] === 's') {
    const b = G.bbox(orig); const cs = [[b.x, b.y], [b.x2, b.y], [b.x2, b.y2], [b.x, b.y2]]; const opp = cs[(k + 2) % 4], cor = cs[k];
    const sx = cor[0] - opp[0] ? (p[0] - opp[0]) / (cor[0] - opp[0]) : 1, sy = cor[1] - opp[1] ? (p[1] - opp[1]) / (cor[1] - opp[1]) : 1;
    m.pts = orig.map((q) => [opp[0] + (q[0] - opp[0]) * sx, opp[1] + (q[1] - opp[1]) * sy]);
  }
}

function onPointerUp(e) {
  const doc = activeDoc(); if (!doc) return;
  if (e.pointerType === 'touch') { I.touches.delete(e.pointerId); if (I.touches.size < 2) I.pinch = null; }
  if (I.pan) { I.pan = null; V.el.classList.remove('panning'); scheduleRender(); return; }
  if (I.drag) {
    const g = I.drag; I.drag = null;
    if (g.kind === 'marquee') {
      const q = state.marquee; state.marquee = null; const b = boxRect(q.a, q.b);
      // left to right (blue): only markups entirely inside; right to left (green): anything the window touches
      const crossing = q.b[0] < q.a[0];
      if (b.w > 2 || b.h > 2) doc.markups.forEach((m) => { if (m.page !== q.page || !layerVisible(doc, m.layer)) return; const mb = markupBBox(m, doc); if (crossing ? markupTouchesRect(m, doc, b, mb) : mb.x >= b.x && mb.y >= b.y && mb.x2 <= b.x + b.w && mb.y2 <= b.y + b.h) state.sel.add(m.id); });
      renderDraft(); refreshSelection(); return;
    }
    if (g.kind === 'label') { const m = getMarkup(g.id); if (g.moved && m) { touch(m); refreshPanels(); finishLabelDrag(m, g.had); } return; }
    if (g.moved) { selected(doc).forEach(touch); refreshPanels(); }
    state.snapHint = null; renderDraft(); return;
  }
  const d = state.draft; if (!d) return;
  switch (d.mode) {
    case 'drag': {
      const b = boxRect(d.m.pts[0], d.m.pts[1]);
      if (b.w < 3 && b.h < 3) { const def = { text: [180, 28], image: [d.m.imgW || 160, d.m.imgH || 120], stamp: [140, 44] }[d.m.type] || [60, 40]; const a = d.start; d.m.pts = [[a[0], a[1]], [a[0] + def[0], a[1] + def[1]]]; }
      else d.m.pts = [[b.x, b.y], [b.x + b.w, b.y + b.h]];
      finishDraft(); break;
    }
    case 'line': if (d.moved) finishDraft(); else { d.mode = 'click'; renderDraft(); } break;
    case 'free': d.m.pts = G.simplify(d.m.pts, 0.5 / doc.zoom); if (d.m.pts.length === 1) d.m.pts.push([d.m.pts[0][0] + 0.5, d.m.pts[0][1]]); finishDraft(); break;
    case 'multi': d.down = false; if (d.boxDrag) { d.m.pts.pop(); finishDraft(); } break;
    case 'callout': finishDraft(); break;
    case 'textsel': if (d.m.pts.length >= 4) finishDraft(); else cancelDraft(); break;
    case 'sketch': finishDraft(); break;
  }
}

function onDblClick(e) {
  const d = state.draft;
  if (d && d.mode === 'multi') { finishDraft(); return; }
  if (state.tool === 'count' && state.countId) { endCount(); return; }
  if (state.tool !== 'select') return;
  const mEl = e.target.closest('g.mk'); if (!mEl) return; const m = getMarkup(mEl.dataset.id); if (!m || isLocked(m)) return;
  if (TEXT_TYPES.has(m.type)) editText(m, false);
  else if (m.type === 'textedit') editPdfText(m);
  else if (m.type === 'sketch') { openRight('props'); setTimeout(() => { const c = $('#props [data-k="sz.w"], #props [data-k="sz.d"]'); if (c) { c.focus(); c.select(); } }, 20); }
  else if (m.type === 'stamp' && m.asset && m.stampId) editStampFields(m);
  else if (m.type === 'note' || MEASURE_TYPES.has(m.type) || m.type === 'stamp') { setTimeout(() => { const c = $(m.type === 'stamp' ? '#prop-text' : '#prop-comment'); if (c) c.focus(); }, 20); }
}

// ----- draft lifecycle ---------------------------------------------------------------
function dedupe(pts, tol) { const out = []; for (const p of pts) if (!out.length || G.dist(out[out.length - 1], p) > tol) out.push(p); return out; }
function finishDraft(fromToolChange) {
  const d = state.draft; if (!d) return; const doc = activeDoc(); state.draft = null; state.snapHint = null; const m = d.m; const t = TOOLS[m.type] || {};
  if (d.mode === 'multi' && !d.boxDrag) { m.pts.pop(); m.pts = dedupe(m.pts, 0.5 / doc.zoom); }
  if (d.mode === 'click' || d.mode === 'line') { if (G.dist(m.pts[0], m.pts[1]) < 1) { renderDraft(); return; } }
  const minPts = t.maxPts || (t.closed ? 3 : 2);
  if ((d.mode === 'multi') && m.pts.length < minPts) { renderDraft(); if (!fromToolChange) toast(`${t.short || t.label} needs at least ${minPts} points`); return; }
  renderDraft();
  if (m.type === 'calibrate') { calibrateDialog(m.page, G.dist(m.pts[0], m.pts[1]), [(m.pts[0][0] + m.pts[1][0]) / 2, (m.pts[0][1] + m.pts[1][1]) / 2]); return; }
  if (m.type === 'zoom') { zoomToBox(m.page, G.bbox(m.pts)); toolDone(); return; }
  if (m.type === 'viewport') { const b = boxRect(m.pts[0], m.pts[1]); if (b.w < 10 || b.h < 10) { toast('Drag a larger box for the viewport'); return; } viewportDialog(m.page, b); toolDone(); return; }
  if (m.type === 'cutout') {
    const target = getMarkup(state.cutoutFor); state.cutoutFor = null;
    if (!target || target.page !== m.page) { toast('Draw the cutout on the same page as its area'); toolDone(); return; }
    pushUndo(doc); target.holes = (target.holes || []).concat([m.pts]); touch(target); renderMarks(doc, m.page); refreshPanels();
    state.sel.clear(); state.sel.add(target.id); setTool('select'); refreshSelection(); toast(`Cutout removed ${fmtArea(G.area(m.pts), scaleForMarkup(doc, target))}`); return;
  }
  if (m.type === 'sketch') {
    state.sketchDefaults[m.sz.shape] = deep(m.sz); store.set('sketchDefaults2', state.sketchDefaults);
    const nm = (state.sketchNext || '').trim(); if (nm) { m.name = nm; if (state.sketchAutoNum) { const used = sketchNamesUsed(doc); used.add(nm); state.sketchNext = nextName(nm, used); store.set('sketchNext', state.sketchNext); } }
  }
  addMarkup(m);
  state.sel.clear(); state.sel.add(m.id);
  if (!fromToolChange) toolDone();
  refreshSelection();
  if (TEXT_TYPES.has(m.type) && !fromToolChange) editText(m, true);
}
function cancelDraft() { if (!state.draft && !state.marquee) return; state.draft = null; state.marquee = null; state.snapHint = null; renderDraft(); }
function endCount() { if (state.countId) { state.countId = null; updateDraftBar(); if (state.tool === 'count') toolDone(); } }
function draftUndoPoint() { const d = state.draft; if (!d || d.mode !== 'multi') return; if (d.m.pts.length > 2) { d.m.pts.splice(d.m.pts.length - 2, 1); renderDraft(); } else cancelDraft(); }

// ----- text editing (rich text: see 22-richtext.js) ---------------------------------
function editText(m, isNew) {
  if (state.editing) commitEdit();
  const doc = activeDoc(); const el = doc.pageEls[m.page]; if (!el) return;
  const ed = document.createElement('div'); ed.className = 'txt-edit'; ed.contentEditable = 'true'; ed.spellcheck = true;
  ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-multiline', 'true'); ed.setAttribute('aria-label', 'Markup text');
  state.editing = { id: m.id, isNew, before: JSON.stringify([m.text || '', m.runs || null]), snap: isNew ? null : snapshot(doc), ta: ed, sel: null };
  el.appendChild(ed); rtRenderEditor(ed, m); positionEditor(); renderMarkupEl(m);
  try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch { }
  ed.addEventListener('input', () => { rtReadEditor(ed, m); positionEditor(); renderMarkupEl(m); });
  ed.addEventListener('keydown', (e) => {
    e.stopPropagation(); const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (e.key === 'Escape' || (e.key === 'Enter' && mod)) { e.preventDefault(); commitEdit(); return; }
    if (mod && !e.altKey && (k === 'b' || k === 'i' || k === 'u')) { e.preventDefault(); rtFormat(k, 'toggle'); return; }
    if (mod && e.shiftKey && (k === 'x' || k === '5')) { e.preventDefault(); rtFormat('s', 'toggle'); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); rtFormat(e.shiftKey ? 'sup' : 'sub', 'toggle'); return; }
  });
  ed.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t.replace(/\r\n?/g, '\n')); });
  ed.addEventListener('drop', (e) => e.preventDefault());
  ed.addEventListener('blur', () => { setTimeout(() => { const a = document.activeElement; if (!state.editing || state.editing.ta !== ed) return; if (a === ed || (a && a.closest && a.closest('#propbar, #pop'))) return; commitEdit(); }, 0); });
  setTimeout(() => { ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); state.editing && (state.editing.sel = rtGetSel(ed)); renderPropbar(); }, 0);
}
// keep the remembered selection and the toolbar's B/I/U state in step with the caret
document.addEventListener('selectionchange', () => {
  const ed = state.editing; if (!ed || document.activeElement !== ed.ta) return; const sel = rtGetSel(ed.ta); if (!sel) return;
  const prev = ed.sel; ed.sel = sel; if (!prev || prev.a !== sel.a || prev.b !== sel.b) renderPropbarSoon();
});
const renderPropbarSoon = debounce(() => renderPropbar(), 60);
function positionEditor() {
  const ed = state.editing; if (!ed) return; const m = getMarkup(ed.id); if (!m) return; const z = viewerZoom(); const L = textLayout(m); const s = m.style; const el = ed.ta;
  if (Math.abs((parseFloat(el.dataset.z) || z) - z) > 1e-6) { const sel = rtGetSel(el); rtReadEditor(el, m); rtRenderEditor(el, m); if (sel && document.activeElement === el) rtSetSel(el, sel.a, sel.b); }
  Object.assign(el.style, { left: L.x * z + 'px', top: L.y * z + 'px', width: Math.max(L.w * z, 40) + 'px', minHeight: L.h * z + 'px', padding: `${L.pad * z}px`, textAlign: s.align || 'left' });
}
function commitEdit() {
  const ed = state.editing; if (!ed) return; state.editing = null; const doc = activeDoc(); const m = getMarkup(ed.id);
  if (m && ed.ta.isConnected) rtReadEditor(ed.ta, m);
  ed.ta.remove(); if (!m) return;
  rtTrimEnd(m);
  if (ed.isNew && !m.text.trim()) { doc.markups = doc.markups.filter((x) => x.id !== m.id); doc.undo.pop(); state.sel.delete(m.id); renderMarks(doc, m.page); refreshPanels(); return; }
  if (!ed.isNew && JSON.stringify([m.text, m.runs || null]) !== ed.before) { doc.undo.push(ed.snap); doc.redo = []; markDirty(doc); touch(m); }
  // shrink-wrap the stored box height to the text
  fitTextBox(m);
  renderMarks(doc, m.page); refreshPanels();
}

// ----- keyboard ------------------------------------------------------------------------
// Commands (68-commands.js) own almost every key; this handles the few that depend on what
// is happening right now (drawing, nudging, typing a sketch size, space to pan).
function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
const TEXT_EDIT_KEYS = new Set(['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Delete', 'Home', 'End', 'Ctrl+ArrowLeft', 'Ctrl+ArrowRight', 'Shift+=', '=', '-', '+']);
function onKeyDown(e) {
  if ($('.modal-back:not([hidden])')) { if (e.key === 'Escape' && !state.capturingKey) closeDialog(null); return; }
  const mod = e.ctrlKey || e.metaKey; const k = e.key; const combo = comboOf(e);
  if (isTyping(e)) { if (combo && (mod || e.altKey || /^F\d+$/.test(combo)) && !TEXT_EDIT_KEYS.has(combo)) dispatchShortcut(e); return; }
  const doc = activeDoc();
  if (k === ' ') { if (!I.space) { I.space = true; V.el.classList.add('space'); } e.preventDefault(); return; }
  if (k === 'Escape') { if (state.painter) { endPainter(); return; } if (state.alignPick) { cancelAlignPick(); return; } if (state.cutoutFor && state.tool === 'cutout') { state.cutoutFor = null; } if (state.draft) cancelDraft(); else if (state.countId) endCount(); else if (state.tool !== 'select') setTool('select'); else if (state.sel.size) { state.sel.clear(); refreshSelection(); } hideMenu(); closeMenus(); return; }
  if (doc && k === 'Enter' && !mod) { if (state.draft) { e.preventDefault(); finishDraft(); } else if (state.countId) endCount(); else { const ms = selected(); if (ms.length === 1 && TEXT_TYPES.has(ms[0].type)) { e.preventDefault(); editText(ms[0], false); } } return; }
  if (doc && k === 'Backspace' && state.draft && state.draft.mode === 'multi') { e.preventDefault(); draftUndoPoint(); return; }
  if (doc && k === 'Backspace' && !mod) { e.preventDefault(); deleteSelected(); return; }
  if (doc && (k === 'c' || k === 'C') && !mod && !e.altKey && !e.shiftKey && state.draft && state.draft.mode === 'multi' && TOOLS[state.draft.m.type] && TOOLS[state.draft.m.type].closed) { e.preventDefault(); finishDraft(); return; } // C closes the shape, as in Revu
  if (doc && k.startsWith('Arrow') && !mod && !e.altKey && state.sel.size) {
    e.preventDefault(); const st = e.shiftKey ? 10 : 1; const dx = k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, dy = k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0;
    const ms = selected(doc).filter((m) => !isLocked(m, doc)); if (!ms.length) return; pushUndo(doc);
    ms.forEach((m) => { mapMarkupPoints(m, (p) => [p[0] + dx, p[1] + dy]); touch(m); }); const sib = syncLinked(doc, ms.filter((m) => m.type === 'sketch')); sib.forEach(touch);
    new Set(ms.concat(sib).map((m) => m.page)).forEach((p) => renderMarks(doc, p)); renderList(); return;
  }
  if (doc && k.startsWith('Arrow') && !mod && !e.altKey && !state.sel.size) { e.preventDefault(); const st = e.shiftKey ? 240 : 60; V.el.scrollLeft += k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0; V.el.scrollTop += k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0; return; }
  if (doc && /^[0-9]$/.test(k) && !mod && !e.altKey && TOOLS[state.tool] && TOOLS[state.tool].mode === 'sketch') { // type a size straight away
    const f = $('#propbar [data-k="sz.w"], #propbar [data-k="sz.d"]'); if (f) { e.preventDefault(); f.focus(); f.value = k; f.setSelectionRange(1, 1); } return;
  }
  dispatchShortcut(e);
}
function onKeyUp(e) { if (e.key === ' ') { I.space = false; V.el.classList.remove('space'); } }

function onWheel(e) {
  if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault();
  const d = activeDoc(); if (!d) return; const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022)); setZoom(d.zoom * f, e);
}

// ----- context menu ------------------------------------------------------------------------
function onContextMenu(e) {
  e.preventDefault();
  if (state.draft && state.draft.mode === 'multi') { finishDraft(); return; }
  if (state.draft) { cancelDraft(); return; }
  if (state.countId) { endCount(); return; }
  const doc = activeDoc(); if (!doc) return; const i = pageAtClient(e.clientX, e.clientY);
  const mEl = e.target.closest('g.mk'); const items = [];
  if (mEl) {
    const id = mEl.dataset.id; if (!state.sel.has(id)) { state.sel.clear(); state.sel.add(id); } if (state.tool !== 'select') setTool('select'); refreshSelection();
    const m = getMarkup(id);
    if (TEXT_TYPES.has(m.type)) items.push(['Edit text', () => editText(m, false)]);
    if (m.type === 'textedit') items.push(['Edit text', () => editPdfText(m)]);
    if (m.type === 'sketch') {
      items.push(['Place on other pages\u2026', () => placeOnPagesDialog(m)]);
      items.push(sketchTrans(doc, m) ? ['Remove transition', () => sketchAction('rmtrans', m)] : ['Add transition here\u2026', () => sketchAction('addtrans', m)]);
      if (m.link) items.push(['Unlink from set', () => sketchAction('unlink', m)], ['Delete on all pages', () => sketchAction('delall', m), 'danger']);
      if (m.labelOff) items.push(['Reset label position', () => resetLabel(m)]);
      items.push(['-']);
    }
    if (CUTOUT_TYPES.has(m.type)) { items.push(['Add cutout', () => startCutout(m)]); if (m.holes && m.holes.length) items.push(['Remove cutouts', () => applyToSelection((x) => { x.holes = []; })]); items.push(['-']); }
    items.push(['Copy', () => copySelected(false)], ['Duplicate', duplicateSelected], ['Bring to front', () => reorderSelected(true)], ['Send to back', () => reorderSelected(false)]);
    items.push(['Add to tool set…', () => addSelectionToToolset()]);
    items.push(['-'], ...STATUSES.map((s) => [`Status: ${s}`, () => applyToSelection((x) => { x.status = s; })]));
    items.push(['-'], [isLocked(m) ? 'Unlock' : 'Lock', () => applyToSelection((x) => { x.locked = !m.locked; }, { ignoreLock: true })], ['Delete', deleteSelected, 'danger']);
  } else {
    if (state.clipboard) items.push(['Paste', () => pasteClipboard(false)]);
    if (i >= 0) items.push(['Set page scale…', () => scaleDialog(i)], ['Calibrate…', () => setTool('calibrate')], ['Rotate page clockwise', () => rotatePages([i], 90)]);
    items.push(['Fit width', () => fitWidth()], ['Fit page', fitPage]);
  }
  showMenu(e.clientX, e.clientY, items);
}
function showMenu(x, y, items) {
  const menu = $('#ctx'); menu.innerHTML = items.map((it, k) => (it[0] === '-' ? '<hr>' : `<button data-k="${k}" class="${it[2] || ''}">${esc(it[0])}</button>`)).join('');
  menu.hidden = false; const r = menu.getBoundingClientRect(); menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  menu.onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; hideMenu(); items[+b.dataset.k][1](); };
}
function hideMenu() { const m = $('#ctx'); if (m) m.hidden = true; }

// ----- text-aware markup helpers -------------------------------------------------------------
function prefetchText() { const d = activeDoc(); if (!d || !d.pdf) return; visiblePages(d, 0.5).forEach((i) => { if (!d.textCache[i]) pageText(d, i).catch(() => {}); }); }
function itemLocal(it, p) { const dx = p[0] - it.x, dy = p[1] - it.y; const c = Math.cos(it.ang), s = Math.sin(it.ang); return [dx * c + dy * s, -dx * s + dy * c]; }
// strict=0: point must be on a text run; strict=1: nearest run on the page
function textHitAt(doc, page, p, loose) {
  const t = doc.textCache[page]; if (!t) return null; let best = null, bd = Infinity;
  t.items.forEach((it, k) => {
    if (!it.str.trim() || it.w <= 0) return; const [lx, ly] = itemLocal(it, p); const top = -it.fh * it.asc, bot = it.fh * (1 - it.asc);
    const dx = lx < 0 ? -lx : lx > it.w ? lx - it.w : 0, dy = ly < top ? top - ly : ly > bot ? ly - bot : 0; const dd = Math.hypot(dx, dy * 2);
    if (dd < bd) { bd = dd; best = { k, c: clamp(Math.floor((lx / it.w) * it.str.length), 0, it.str.length - 1) }; }
  });
  if (!best) return null; if (!loose && bd > 2) return null; return best;
}
function textQuads(doc, page, a, b) {
  const t = doc.textCache[page]; const ia = t.starts[a.k] + a.c, ib = t.starts[b.k] + b.c; const s = Math.min(ia, ib), e = Math.max(ia, ib);
  const quads = []; let k = s;
  while (k <= e) { const [item, off] = t.map[k]; if (off < 0) { k++; continue; } let j = k; while (j + 1 <= e && t.map[j + 1][0] === item && t.map[j + 1][1] >= 0) j++; const r = itemRect(t.items[item], off, t.map[j][1] + 1); quads.push(r); k = j + 1; }
  return quads.flat().map((p) => [p[0], p[1]]);
}
