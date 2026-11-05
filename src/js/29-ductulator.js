// ===== Ductulator: velocity and friction loss for ducts and risers ===========================================
// Darcy-Weisbach with the Colebrook friction factor, on the hydraulic diameter (4A/P) at the real velocity.
// Galvanised sheet (roughness 0.09 mm), air at about 20 °C (1.2 kg/m³, ν 1.51e-5 m²/s). A duct or riser over
// the friction limit (1 Pa/m unless changed) is flagged.
const AIR = { rho: 1.2, nu: 1.51e-5, eps: 0.09 };
const fricLimit = () => +(state.prefs.paLimit || 1);
const velLimit = () => +(state.prefs.velLimit || 0); // 0: no velocity check
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
function calcWarn(c) { const out = []; if (c.pa > fricLimit() + 1e-9) out.push(`${num(c.pa, 2)} Pa/m is over ${num(fricLimit(), 2)} Pa/m`); if (velLimit() > 0 && c.v > velLimit() + 1e-9) out.push(`${num(c.v, 1)} m/s is over ${num(velLimit(), 1)} m/s`); return out; }
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
function ductCalcFor(doc, m) { const D = ductD(m); const q = ductQ(doc, m); return ductCalc(q, D.shape === 'round' ? { shape: 'round', d: D.d } : { shape: 'rect', w: D.w, h: D.h }); }
// a riser's airflow: set on the riser (or its linked set), or the sum of the grilles in its walls on every floor
function riserQ(doc, r) { const L = linkOf(doc, r); const set = L && L.q > 0 ? +L.q : r.q > 0 ? +r.q : 0; if (set) return set; const ids = new Set(riserInstances(doc, r).map((x) => x.id)); return doc.markups.reduce((a, g) => a + (g.type === 'grille' && ids.has(g.on) ? +(grilleD(g).q || 0) : 0), 0); }
function sizeMm(sz) { return sz.shape === 'circle' ? { shape: 'round', d: sz.d * 25.4 } : { shape: 'rect', w: sz.w * 25.4, h: sz.h * 25.4 }; }

// ----- the calculator in the Ductwork panel ---------------------------------------------------------------------
const DCALC = { q: 300, shape: 'rect', w: 400, h: 200, d: 250, ...store.get('ductCalc', {}) };
function ductCalcHtml() {
  const C = DCALC; const c = ductCalc(+C.q, C.shape === 'round' ? { shape: 'round', d: +C.d } : { shape: 'rect', w: +C.w, h: +C.h }); const w = calcWarn(c); const sg = +C.q > 0 ? suggestSizes(+C.q) : null;
  return `<section class="psec dcalc"><h3>Ductulator</h3>
    <div class="field two"><div><label>Airflow (L/s)</label><input type="number" class="num" data-dc="q" value="${C.q}" min="0" step="10"></div><div><label>Shape</label><select data-dc="shape"><option value="rect"${C.shape !== 'round' ? ' selected' : ''}>Rectangular</option><option value="round"${C.shape === 'round' ? ' selected' : ''}>Round</option></select></div></div>
    ${C.shape === 'round' ? `<div class="field two"><div><label>Diameter (mm)</label><input type="number" class="num" data-dc="d" value="${C.d}" min="50" step="25"></div><div></div></div>` : `<div class="field two"><div><label>Width (mm)</label><input type="number" class="num" data-dc="w" value="${C.w}" min="50" step="50"></div><div><label>Depth (mm)</label><input type="number" class="num" data-dc="h" value="${C.h}" min="50" step="50"></div></div>`}
    <div class="dc-out${w.length ? ' warn' : ''}" role="status"><div><b>${num(c.v, 2)}</b> m/s</div><div><b>${num(c.pa, 2)}</b> Pa/m</div><div class="muted sm">Dh ${Math.round(c.dh)} mm · equal-friction Ø${Math.round(c.de)} · Re ${Math.round(c.re).toLocaleString()} · ${num(c.vp || 0, 1)} Pa velocity pressure</div>${w.length ? `<div class="dc-warn">${icon('warn')} ${esc(w.join('; '))}</div>` : ''}</div>
    ${sg ? `<p class="muted sm" style="margin:8px 0 4px">Smallest sizes at ${num(fricLimit(), 2)} Pa/m or less${velLimit() ? ` and ${num(velLimit(), 1)} m/s` : ''}:</p><div class="dc-sugg">${sg.round ? `<button class="chip" data-dcs="round:${sg.round.d}" title="${esc(calcLine(sg.round.c))}">Ø${sg.round.d}</button>` : ''}${sg.rect.map((r) => `<button class="chip" data-dcs="rect:${r.w}:${r.h}" title="${esc(calcLine(r.c))}">${r.w}×${r.h}</button>`).join('')}</div>` : ''}
    <div class="field two" style="margin-top:8px"><div><label>Friction limit (Pa/m)</label><input type="number" class="num" data-dc="lim" value="${fricLimit()}" min="0.1" step="0.1"></div><div><label>Velocity limit (m/s)</label><input type="number" class="num" data-dc="vlim" value="${velLimit() || ''}" min="0" step="0.5" placeholder="none"></div></div>
    <div class="btn-row"><button class="btn sm" data-dw="calc-apply" title="Give the selected ducts this airflow and size">Apply to selected duct</button><button class="btn sm" data-dw="calc-from" title="Read the airflow and size of the selected duct or riser">From selection</button></div></section>`;
}
function bindDuctCalc(el) {
  el.addEventListener('change', (e) => {
    const i = e.target.closest('[data-dc]'); if (!i) return; const k = i.dataset.dc; const v = i.value;
    if (k === 'lim') { state.prefs.paLimit = clamp(+v || 1, 0.05, 20); savePrefs(); renderAllMarks(); refreshPanels(); }
    else if (k === 'vlim') { state.prefs.velLimit = +v > 0 ? +v : 0; savePrefs(); renderAllMarks(); refreshPanels(); }
    else { DCALC[k] = k === 'shape' ? v : +v || 0; store.set('ductCalc', DCALC); }
    renderDuctPanel();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dcs]'); if (!b) return; const [sh, a, c] = b.dataset.dcs.split(':'); if (sh === 'round') { DCALC.shape = 'round'; DCALC.d = +a; } else { DCALC.shape = 'rect'; DCALC.w = +a; DCALC.h = +c; } store.set('ductCalc', DCALC); renderDuctPanel();
  });
}
function ductCalcApply() {
  const doc = activeDoc(); const ds = selected(doc).filter((m) => m.type === 'duct'); if (!ds.length) { toast('Select a duct first'); return; }
  applyToSelection((x) => { if (x.type !== 'duct') return; const D = ductD(x); x.duct = DCALC.shape === 'round' ? { ...D, shape: 'round', d: +DCALC.d, q: +DCALC.q || null } : { ...D, shape: 'rect', w: +DCALC.w, h: +DCALC.h, q: +DCALC.q || null }; });
  toast(`${ds.length} duct${ds.length === 1 ? '' : 's'} set to ${DCALC.shape === 'round' ? 'Ø' + DCALC.d : DCALC.w + '×' + DCALC.h}, ${DCALC.q} L/s`);
}
function ductCalcFrom() {
  const doc = activeDoc(); const m = selected(doc)[0]; if (!m) { toast('Select a duct or riser first'); return; }
  if (m.type === 'duct') { const D = ductD(m); Object.assign(DCALC, D.shape === 'round' ? { shape: 'round', d: D.d } : { shape: 'rect', w: D.w, h: D.h }); const q = ductQ(doc, m); if (q) DCALC.q = q; }
  else if (m.type === 'sketch') { const z = sizeMm(sketchSize(doc, m)); Object.assign(DCALC, z.shape === 'round' ? { shape: 'round', d: Math.round(z.d) } : { shape: 'rect', w: Math.round(Math.max(z.w, z.h)), h: Math.round(Math.min(z.w, z.h)) }); const q = riserQ(doc, m); if (q) DCALC.q = q; }
  else { toast('Select a duct or riser'); return; }
  store.set('ductCalc', DCALC); renderDuctPanel();
}
