// ===== Ductulator: velocity and friction loss for ducts and risers ===========================================
// Darcy-Weisbach with the Colebrook friction factor, on the hydraulic diameter (4A/P) at the real velocity.
// Galvanised sheet (roughness 0.09 mm), air at about 20 °C (1.2 kg/m³, ν 1.51e-5 m²/s). A duct or riser over
// the friction limit (1 Pa/m unless changed) is flagged.
const AIR = { rho: 1.2, nu: 1.51e-5, eps: 0.09 };
// surface roughness by material, mm (the usual roughness categories for duct design)
const DUCT_MATS = [['galv', 'Galvanised steel', 0.09], ['smooth', 'Aluminium, stainless or PVC', 0.03], ['lined', 'Duct board or lined duct', 0.9], ['flex', 'Flexible duct', 3], ['shaft', 'Concrete or masonry shaft', 3]];
const matEps = (k) => (DUCT_MATS.find((x) => x[0] === k) || DUCT_MATS[0])[2];
const matName = (k) => (DUCT_MATS.find((x) => x[0] === k) || DUCT_MATS[0])[1];
const fricLimit = () => +(state.prefs.paLimit || 1);
const velLimit = () => +(state.prefs.velLimit || 0); // 0: no velocity check
// velocity the air should stay under, by what the duct carries. Supply runs quieter than exhaust.
const VEL_APPS = [['SA', 'Supply air', 6], ['RA', 'Return air', 5], ['EA', 'Exhaust air', 7], ['OA', 'Outside air', 4.5], ['TA', 'Transfer air', 4], ['KE', 'Kitchen exhaust', 8]];
function velTargets() { const d = {}; VEL_APPS.forEach(([k, , v]) => { d[k] = v; }); return { ...d, ...(state.prefs.velTargets || {}) }; }
const appName = (a) => { const x = VEL_APPS.find(([k]) => k === a); return x ? x[1] : ''; };
// the velocity limit for an application: its target; 'none' means no limit; anything unknown falls back to the global one
function velLimitFor(app) { if (app === 'none') return 0; const t = velTargets(); return app && app in t ? +t[app] : velLimit(); }
function setVelTarget(app, v) { if (!app || app === 'none') return; const t = { ...(state.prefs.velTargets || {}) }; t[app] = Math.max(0, +v || 0); state.prefs.velTargets = t; savePrefs(); }
function riserApp(doc, r) { const L = linkOf(doc, r); return r.velApp || (L && L.velApp) || 'SA'; }
function colebrook(Re, rel) {
  if (!(Re > 0)) return 0; if (Re < 2300) return 64 / Re; // laminar
  let f = 0.25 / Math.pow(Math.log10(rel / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2); // Swamee-Jain start, then iterate
  for (let i = 0; i < 20; i++) { const g = -2 * Math.log10(rel / 3.7 + 2.51 / (Re * Math.sqrt(f))); const nf = 1 / (g * g); if (Math.abs(nf - f) < 1e-10) { f = nf; break; } f = nf; }
  return f;
}
// q in L/s; size { shape: 'rect', w, h } or { shape: 'round', d } in mm
function ductCalc(q, size, opts = {}) {
  const eps = (opts.eps || AIR.eps) / 1000; const round = size.shape === 'round' || size.shape === 'circle';
  const A = round ? Math.PI * Math.pow((size.d || 0) / 1000, 2) / 4 : ((size.w || 0) / 1000) * ((size.h || 0) / 1000); const Pm = round ? Math.PI * (size.d || 0) / 1000 : 2 * ((size.w || 0) + (size.h || 0)) / 1000;
  if (!(A > 0) || !(q > 0)) return { q, A, v: 0, dh: 0, re: 0, f: 0, pa: 0, de: 0 };
  const v = q / 1000 / A; const dh = (4 * A) / Pm; const re = (v * dh) / AIR.nu; const f = colebrook(re, eps / dh); const pa = (f / dh) * AIR.rho * v * v / 2;
  const de = round ? size.d : 1.3 * Math.pow(size.w * size.h, 0.625) / Math.pow(size.w + size.h, 0.25); // equal-friction round size (Huebscher)
  return { q, A, v, dh: dh * 1000, re, f, pa, de, vp: AIR.rho * v * v / 2 };
}
function calcWarn(c) { const out = []; const vl = c.velLim != null ? c.velLim : velLimit(); if (c.pa > fricLimit() + 1e-9) out.push(`${num(c.pa, 2)} Pa/m is over ${num(fricLimit(), 2)} Pa/m`); if (vl > 0 && c.v > vl + 1e-9) out.push(`${num(c.v, 1)} m/s is over ${num(vl, 1)} m/s`); return out; }
// smallest sizes that keep under the limit: round, and rectangular for a few depths (50 mm steps)
function suggestSizes(q, opts = {}) {
  const lim = opts.limit || fricLimit(); const vl = velLimit(); const ok = (c) => c.pa <= lim + 1e-9 && (!vl || c.v <= vl + 1e-9); const out = { round: null, rect: [] };
  for (let d = 100; d <= 2000; d += 50) { const c = ductCalc(q, { shape: 'round', d }); if (ok(c)) { out.round = { d, c }; break; } }
  const depths = opts.depths || [200, 250, 300, 400, 500]; const maxAR = opts.maxAR || 4;
  depths.forEach((h) => { for (let w = Math.max(100, h / maxAR); w <= h * maxAR && w <= 3000; w += 50) { const W = Math.ceil(w / 50) * 50; const c = ductCalc(q, { shape: 'rect', w: W, h }); if (ok(c)) { out.rect.push({ w: Math.max(W, h), h: Math.min(W, h), c }); break; } } });
  const seen = new Set(); out.rect = out.rect.filter((r) => { const k = r.w + 'x' + r.h; if (seen.has(k)) return false; seen.add(k); return true; });
  return out;
}
const calcLine = (c) => (c.q > 0 && c.A > 0 ? `${Math.round(c.q)} L/s · ${num(c.v, 2)} m/s · ${num(c.pa, 2)} Pa/m` : '');
// a duct's airflow: set on it, or the sum of the grilles on it
function ductQ(doc, m) { const D = ductD(m); if (D.q > 0) return +D.q; const s = doc.markups.reduce((a, g) => a + (g.type === 'grille' && g.on === m.id ? +(grilleD(g).q || 0) : 0), 0); return s > 0 ? s : 0; }
function ductCalcFor(doc, m) { const D = ductD(m); const q = ductQ(doc, m); const c = ductCalc(q, D.shape === 'round' ? { shape: 'round', d: D.d } : { shape: 'rect', w: D.w, h: D.h }, { eps: matEps(D.mat) }); c.velLim = velLimitFor(D.velApp || D.service); return c; }
const riserMat = (doc, r) => { const L = linkOf(doc, r); return (L && L.mat) || r.mat || 'galv'; };
function riserCalcFor(doc, r) { const q = riserQ(doc, r); const c = ductCalc(q, sizeMm(sketchSize(doc, r)), { eps: matEps(riserMat(doc, r)) }); c.velLim = velLimitFor(riserApp(doc, r)); return c; }
const sizeOk = (c, vel = velLimit()) => c.pa <= fricLimit() + 1e-9 && (!vel || c.v <= vel + 1e-9);
// the most air a size carries inside the limits (L/s)
function maxFlow(size, eps, vel = velLimit()) { let lo = 0, hi = 1e6; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (sizeOk(ductCalc(mid, size, { eps }), vel)) lo = mid; else hi = mid; } return lo; }
// sizes to offer for an airflow, in the shape's own terms: keep the width, keep the height, a 2:1, and round;
// each is the smallest (50 mm steps) inside the limits
function sizeChoices(q, size, eps, vel = velLimit()) {
  const out = []; if (!(q > 0)) return out; const ok = (z) => sizeOk(ductCalc(q, z, { eps }), vel); const add = (z, why) => { const k = z.shape === 'round' ? 'round:' + z.d : `rect:${z.w}:${z.h}`; if (!out.some((x) => x.key === k)) out.push({ key: k, size: z, why, c: ductCalc(q, z, { eps }) }); };
  const up = (v) => Math.max(50, Math.ceil(v / 50) * 50); const round = size.shape === 'round' || size.shape === 'circle';
  if (!round && size.w > 0 && size.h > 0) {
    const W = up(size.w), H = up(size.h);
    for (let h = 100; h <= 4000; h += 50) if (ok({ shape: 'rect', w: W, h })) { if (h <= W * 4 && W <= h * 4) add({ shape: 'rect', w: W, h }, `keeps the ${W} width`); break; }
    for (let w = 100; w <= 4000; w += 50) if (ok({ shape: 'rect', w, h: H })) { if (w <= H * 4 && H <= w * 4) add({ shape: 'rect', w, h: H }, `keeps the ${H} ${'height'}`); break; }
    const land = size.w >= size.h; for (let b = 100; b <= 3000; b += 50) { const z = land ? { shape: 'rect', w: b * 2, h: b } : { shape: 'rect', w: b, h: b * 2 }; if (ok(z)) { add(z, '2 to 1'); break; } }
    for (let b = 100; b <= 3000; b += 50) if (ok({ shape: 'rect', w: b, h: b })) { add({ shape: 'rect', w: b, h: b }, 'square'); break; }
  } else { [200, 300, 400, 500].forEach((h) => { for (let w = h; w <= h * 4; w += 50) if (ok({ shape: 'rect', w, h })) { add({ shape: 'rect', w, h }, `${h} deep`); break; } }); }
  for (let d = 100; d <= 3000; d += 50) if (ok({ shape: 'round', d })) { add({ shape: 'round', d }, 'round'); break; }
  return out.slice(0, 5);
}
const sizeTxtMm = (z) => (z.shape === 'round' || z.shape === 'circle' ? `Ø${Math.round(z.d)}` : `${Math.round(z.w)}×${Math.round(z.h)}`);
// a riser's airflow: set on the riser (or its linked set), or the sum of the grilles in its walls on every floor
function riserQ(doc, r) { const L = linkOf(doc, r); const set = L && L.q > 0 ? +L.q : r.q > 0 ? +r.q : 0; if (set) return set; const ids = new Set(riserInstances(doc, r).map((x) => x.id)); return doc.markups.reduce((a, g) => a + (g.type === 'grille' && ids.has(g.on) ? +(grilleD(g).q || 0) : 0), 0); }
function sizeMm(sz) { return sz.shape === 'circle' ? { shape: 'round', d: sz.d * 25.4 } : { shape: 'rect', w: sz.w * 25.4, h: sz.h * 25.4 }; }

// ----- one card for size and airflow ---------------------------------------------------------------------------
// The same card sizes a riser, a duct, the next riser or duct to be drawn, and the stand-alone calculator:
// airflow and size in, velocity and friction out (live as you type), sizes that fit to pick from.
// o: { ctx, q, qPh, size (mm), mat, keys: { q, shape, w, h, d, mat }, roundVal, dims: 'mm' | 'sketch', sc, note }
function airOutHtml(q, size, mat, vel) {
  if (vel == null) vel = velLimit();
  const eps = matEps(mat); const c = ductCalc(q, size, { eps }); const has = c.q > 0 && c.A > 0; const lim = fricLimit(), vl = vel; const overP = has && c.pa > lim + 1e-9, overV = has && vl > 0 && c.v > vl + 1e-9;
  const cap = size && (size.d > 0 || (size.w > 0 && size.h > 0)) ? maxFlow(size, eps, vel) : 0; const ch = has ? sizeChoices(q, size, eps, vel) : []; const cur = sizeTxtMm(size);
  const tile = (val, unit, name, over, limTxt) => `<div class="air-tile${has ? (over ? ' over' : ' ok') : ''}"><div class="air-val"><b>${has ? val : '—'}</b> ${unit}</div><div class="air-name">${name}</div>${has ? `<div class="air-st">${over ? icon('warn') + ' Over ' + limTxt : limTxt ? icon('check') + ' Within ' + limTxt : '<span class="muted">No limit set</span>'}</div>` : ''}</div>`;
  return `<div class="air-tiles" role="status">${tile(num(c.v, 2), 'm/s', 'Velocity', overV, vl ? `${num(vl, 1)} m/s` : '')}${tile(num(c.pa, 2), 'Pa/m', 'Friction', overP, `${num(lim, 2)} Pa/m`)}</div>
    ${has ? '' : `<p class="muted sm">Enter the airflow to see velocity and friction${cap > 0 ? `. ${cur} carries up to ${Math.floor(cap / 5) * 5} L/s at ${num(lim, 2)} Pa/m${vl ? ` and ${num(vl, 1)} m/s` : ''}` : ''}.</p>`}
    ${ch.length ? `<div class="air-pick"><div class="air-pick-h">${overP || overV ? `Sizes that carry ${Math.round(q)} L/s within the limits` : `Smallest sizes for ${Math.round(q)} L/s`}</div><div class="air-chips">${ch.map((x) => `<button type="button" class="air-chip${sizeTxtMm(x.size) === cur ? ' cur' : ''}" data-air-set="${x.key}" title="${esc(`${x.why}: ${num(x.c.v, 2)} m/s, ${num(x.c.pa, 2)} Pa/m`)}"><b>${esc(sizeTxtMm(x.size))}</b><span>${esc(x.why)}</span></button>`).join('')}</div></div>` : ''}
    ${has ? `<p class="muted sm air-cap">${cur} carries up to ${Math.floor(cap / 5) * 5} L/s within the limits. Dh ${Math.round(c.dh)} mm · equal-friction Ø${Math.round(c.de)} · velocity pressure ${num(c.vp || 0, 1)} Pa · Re ${Math.round(c.re).toLocaleString()}</p>` : ''}`;
}
function airCardHtml(o) {
  const K = o.keys || {}; const z = o.size; const round = z.shape === 'round' || z.shape === 'circle'; const k = (name) => (K[name] ? ` data-k="${K[name]}"` : ''); const sk = o.dims === 'sketch';
  const app = o.app || 'SA'; const vel = velLimitFor(app);
  const dim = (name, v, label) => `<div><label>${label}</label>${sk ? `<input type="text" inputmode="decimal" data-air="${name}"${k(name)} value="${esc(dimVal(v / 25.4, o.sc))}">` : `<input type="number" data-air="${name}"${k(name)} value="${v > 0 ? Math.round(v) : ''}" min="50" step="50">`}</div>`;
  const u = sk && o.sc && !isMetric(o.sc) ? '' : ' (mm)';
  return `<div class="aircard" data-ctx="${o.ctx}" data-dim="${sk ? 'sketch' : 'mm'}" data-qfall="${o.qFall > 0 ? o.qFall : 0}" data-app="${app}">
    <div class="field two"><div><label>Airflow (L/s)</label><input type="number" data-air="q"${k('q')} value="${o.q > 0 ? Math.round(o.q) : ''}" min="0" step="10" placeholder="${esc(o.qPh || 'L/s')}"${o.qTitle ? ` title="${esc(o.qTitle)}"` : ''}></div>
      <div><label>Shape</label><select data-air="shape"${k('shape')}><option value="rect"${round ? '' : ' selected'}>Rectangle</option><option value="${o.roundVal || 'round'}"${round ? ' selected' : ''}>Round</option></select></div></div>
    ${round ? `<div class="field two">${dim('d', z.d, 'Diameter' + u)}<div></div></div>` : `<div class="field two">${dim('w', z.w, (o.wLabel || 'Width') + u)}${dim('h', z.h, (o.hLabel || 'Height') + u)}</div>`}
    <div class="air-out">${airOutHtml(o.q > 0 ? o.q : o.qFall || 0, round ? { shape: 'round', d: z.d } : { shape: 'rect', w: z.w, h: z.h }, o.mat, vel)}</div>
    ${o.note ? `<p class="muted sm">${o.note}</p>` : ''}
    <details class="air-more"${state.airMore ? ' open' : ''}><summary>Velocity target, limits and material</summary>
      <div class="field two"><div><label>Application</label><select data-air-pref="vapp">${VEL_APPS.map(([kk, l, v]) => `<option value="${kk}"${app === kk ? ' selected' : ''}>${esc(l)} (${num(velTargets()[kk] || v, 1)} m/s)</option>`).join('')}<option value="none"${app === 'none' ? ' selected' : ''}>No velocity limit</option></select></div><div><label>Velocity limit (m/s)</label><input type="number" data-air-pref="vtar" value="${vel || ''}" min="0" step="0.5" placeholder="none"${app === 'none' ? ' disabled' : ''}></div></div>
      <div class="field two"><div><label>Friction limit (Pa/m)</label><input type="number" data-air-pref="lim" value="${fricLimit()}" min="0.1" step="0.1"></div><div><label>Material</label><select data-air="mat"${k('mat')}>${DUCT_MATS.map(([v, l, e]) => `<option value="${v}"${(o.mat || 'galv') === v ? ' selected' : ''}>${esc(l)} (${e} mm)</option>`).join('')}</select></div></div>
      <p class="muted sm">Supply air runs quieter (about 5.5–6 m/s), exhaust faster (6–7 m/s). The velocity limit is kept per application; the friction limit is shared. Straight-run loss only; fittings not included.</p></details>
  </div>`;
}
// what the card says right now, in mm (also while typing)
function airRead(card) {
  const g = (n) => card.querySelector(`[data-air="${n}"]`); const sk = card.dataset.dim === 'sketch'; const sc = sk ? (() => { const T = propTarget(); const d = activeDoc(); return T.kind === 'sel' && T.ms[0] ? scaleForMarkup(d, T.ms[0]) : scaleFor(d, currentPage()); })() : null;
  const mm = (el) => (el ? (sk ? parseSketchDim(el.value, sc) * 25.4 : +el.value) : 0) || 0; const sh = g('shape') ? g('shape').value : 'rect'; const round = sh === 'round' || sh === 'circle';
  const qi = g('q'); const q = +qi.value > 0 ? +qi.value : +(card.dataset.qfall || 0);
  return { q, size: round ? { shape: 'round', d: mm(g('d')) } : { shape: 'rect', w: mm(g('w')), h: mm(g('h')) }, mat: g('mat') ? g('mat').value : 'galv', vel: velLimitFor(card.dataset.app || 'SA') };
}
function airLive(card) { const r = airRead(card); const out = card.querySelector('.air-out'); if (out) out.innerHTML = airOutHtml(r.q, r.size, r.mat, r.vel); }
// picking a size chip
function airApplySize(card, key) {
  const [sh, a, b] = key.split(':'); const z = sh === 'round' ? { shape: 'round', d: +a } : { shape: 'rect', w: +a, h: +b }; const ctx = card.dataset.ctx; const doc = activeDoc();
  if (ctx === 'calc') { Object.assign(DCALC, z); store.set('ductCalc', DCALC); renderDuctPanel(); return; }
  if (ctx === 'ducttool') { saveDuctDefaults({ ...ductDefaults(), ...z }); renderProps(); renderDuctPanelSoon(); return; }
  if (ctx === 'risertool') { const sh2 = z.shape === 'round' ? 'circle' : 'rect'; state.sketchDefaults[sh2] = sh2 === 'circle' ? { shape: 'circle', d: z.d / 25.4 } : { shape: 'rect', w: z.w / 25.4, h: z.h / 25.4 }; store.set('sketchDefaults2', state.sketchDefaults); if ((TOOLS[state.tool] || {}).shape !== sh2) setTool(sh2 === 'circle' ? 'sketchcircle' : 'sketchrect'); renderProps(); return; }
  const m = selected(doc)[0]; if (!m) return;
  if (ctx === 'duct' && m.type === 'duct') { applyToSelection((x) => { if (x.type === 'duct') x.duct = { ...ductD(x), ...z }; }); toast(`Duct resized to ${sizeTxtMm(z)}`); return; }
  if (ctx === 'riser' && m.type === 'sketch') { pushUndo(doc); setSketchSize(doc, m, z.shape === 'round' ? { shape: 'circle', d: z.d / 25.4 } : { shape: 'rect', w: z.w / 25.4, h: z.h / 25.4 }, 'size'); linkSiblings(doc, m).forEach(touch); touch(m); markDirty(doc); renderAllMarks(doc); refreshSelection(); refreshPanels(); renderLinkedPanelSoon(); toast(`${sketchName(doc, m) || 'Riser'} resized to ${sizeTxtMm(z)}${linkOf(doc, m) ? ' on every page that uses this size' : ''}`); }
}
// which application (and so which velocity target) this card checks against
function setAirApp(card, app) {
  const ctx = card.dataset.ctx; const doc = activeDoc();
  if (ctx === 'calc') { DCALC.app = app; store.set('ductCalc', DCALC); renderDuctPanel(); return; }
  if (ctx === 'risertool') { state.riserApp = app; store.set('riserApp', app); renderProps(); return; }
  if (ctx === 'ducttool') { saveDuctDefaults({ ...ductDefaults(), velApp: app }); renderProps(); renderDuctPanelSoon(); return; }
  const m = selected(doc)[0]; if (!m) { renderProps(); return; }
  if (ctx === 'duct' && m.type === 'duct') { pushUndo(doc); applyToSelection((x) => { if (x.type === 'duct') x.duct = { ...ductD(x), velApp: app }; }); }
  else if (ctx === 'riser' && m.type === 'sketch') { pushUndo(doc); const L = linkOf(doc, m); if (L) L.velApp = app; else m.velApp = app; touch(m); }
  markDirty(doc); renderAllMarks(doc); refreshSelection(); refreshPanels(); renderProps();
}
function bindAirCards() {
  document.addEventListener('input', (e) => { const c = e.target.closest && e.target.closest('.aircard'); if (c && e.target.matches('[data-air]')) airLive(c); });
  document.addEventListener('change', (e) => {
    const c = e.target.closest && e.target.closest('.aircard'); if (!c) return; const t = e.target;
    if (t.dataset.airPref) {
      state.airMore = true;
      if (t.dataset.airPref === 'lim') { state.prefs.paLimit = clamp(+t.value || 1, 0.05, 20); savePrefs(); }
      else if (t.dataset.airPref === 'vtar') { setVelTarget(c.dataset.app || 'SA', +t.value); }
      else if (t.dataset.airPref === 'vapp') { setAirApp(c, t.value); return; }
      renderAllMarks(); refreshPanels(); renderProps(); renderDuctPanelSoon(); return;
    }
    if (c.dataset.ctx === 'calc' && t.dataset.air) { const k = t.dataset.air; DCALC[k] = k === 'shape' || k === 'mat' ? t.value : +t.value || 0; store.set('ductCalc', DCALC); renderDuctPanel(); }
    else if (c.dataset.ctx === 'risertool' && t.dataset.air === 'q') { state.sketchQ = +t.value > 0 ? +t.value : 0; store.set('sketchQ', state.sketchQ); renderProps(); }
  });
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-air-set]'); if (b) { const c = b.closest('.aircard'); if (c) airApplySize(c, b.dataset.airSet); } });
  document.addEventListener('toggle', (e) => { if (e.target.matches && e.target.matches('.air-more')) state.airMore = e.target.open; }, true);
}

// ----- the stand-alone calculator (Mechanical panel) -------------------------------------------------------------
const DCALC = { q: 300, shape: 'rect', w: 400, h: 200, d: 250, mat: 'galv', app: 'SA', ...store.get('ductCalc', {}) };
function ductCalcHtml() {
  const C = DCALC; const doc = activeDoc(); const s0 = doc ? selected(doc)[0] : null; const can = s0 && (s0.type === 'duct' || s0.type === 'sketch');
  return `<section class="psec dcalc"><h3>Ductulator</h3>${airCardHtml({ ctx: 'calc', q: +C.q, size: C.shape === 'round' ? { shape: 'round', d: +C.d } : { shape: 'rect', w: +C.w, h: +C.h }, mat: C.mat, app: C.app || 'SA', wLabel: 'Width', hLabel: 'Depth' })}
    <div class="btn-row"><button class="btn sm" data-dw="calc-from"${can ? '' : ' disabled'} title="Read the airflow and size of the selected duct or riser">Read from selection</button><button class="btn sm primary" data-dw="calc-apply"${can ? '' : ' disabled'} title="Give the selected duct or riser this airflow and size">Apply to selection</button></div>
    <p class="muted sm">${can ? 'A selected duct or riser has this same calculator in its properties.' : 'Select a duct or riser to size it here, or use the same calculator in its properties.'}</p></section>`;
}
function bindDuctCalc() { /* the card binds itself: see bindAirCards */ }
function ductCalcApply() {
  const doc = activeDoc(); const ms = selected(doc).filter((m) => m.type === 'duct' || m.type === 'sketch'); if (!ms.length) { toast('Select a duct or riser first'); return; }
  const z = DCALC.shape === 'round' ? { shape: 'round', d: +DCALC.d } : { shape: 'rect', w: +DCALC.w, h: +DCALC.h }; pushUndo(doc);
  ms.forEach((x) => {
    if (x.type === 'duct') x.duct = { ...ductD(x), ...z, q: +DCALC.q || null, mat: DCALC.mat };
    else { setSketchSize(doc, x, z.shape === 'round' ? { shape: 'circle', d: z.d / 25.4 } : { shape: 'rect', w: z.w / 25.4, h: z.h / 25.4 }, 'size'); const L = linkOf(doc, x); if (L) { L.q = +DCALC.q || null; L.mat = DCALC.mat; } else { x.q = +DCALC.q || null; x.mat = DCALC.mat; } linkSiblings(doc, x).forEach(touch); }
    touch(x);
  });
  markDirty(doc); renderAllMarks(doc); refreshSelection(); refreshPanels(); toast(`${ms.length === 1 ? (ms[0].type === 'duct' ? 'Duct' : 'Riser') : ms.length + ' items'} set to ${sizeTxtMm(z)}, ${DCALC.q} L/s`);
}
function ductCalcFrom() {
  const doc = activeDoc(); const m = selected(doc)[0]; if (!m) { toast('Select a duct or riser first'); return; }
  if (m.type === 'duct') { const D = ductD(m); Object.assign(DCALC, D.shape === 'round' ? { shape: 'round', d: D.d } : { shape: 'rect', w: D.w, h: D.h }); DCALC.mat = D.mat || 'galv'; const q = ductQ(doc, m); if (q) DCALC.q = q; }
  else if (m.type === 'sketch') { const z = sizeMm(sketchSize(doc, m)); Object.assign(DCALC, z.shape === 'round' ? { shape: 'round', d: Math.round(z.d) } : { shape: 'rect', w: Math.round(z.w), h: Math.round(z.h) }); DCALC.mat = riserMat(doc, m); const q = riserQ(doc, m); if (q) DCALC.q = q; }
  else { toast('Select a duct or riser'); return; }
  store.set('ductCalc', DCALC); renderDuctPanel();
}
