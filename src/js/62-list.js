// ===== Markup list ===============================================================
function listRows(doc) {
  const L = state.list; const q = L.q.trim().toLowerCase(); const cur = currentPage();
  let rows = doc.markups.map((m) => ({ m, info: MEASURE_TYPES.has(m.type) ? measureInfo(m, doc) : null }));
  rows = rows.filter(({ m }) => {
    if (L.pageOnly && m.page !== cur) return false;
    if (L.type === 'markups' && MEASURE_TYPES.has(m.type)) return false;
    if (L.type === 'measures' && !MEASURE_TYPES.has(m.type)) return false;
    if (L.type.startsWith('s:') && m.subject !== L.type.slice(2)) return false;
    if (L.status !== 'all' && m.status !== L.status) return false;
    if (q && ![m.subject, m.text, m.comment, m.author, m.status].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const key = { page: (r) => r.m.page * 1e6 + doc.markups.indexOf(r.m), subject: (r) => r.m.subject.toLowerCase(), label: (r) => (r.m.text || '').toLowerCase(), measure: (r) => (r.info ? r.info.value : -Infinity), comment: (r) => (r.m.comment || '').toLowerCase(), status: (r) => r.m.status, author: (r) => r.m.author.toLowerCase(), date: (r) => r.m.modified, layer: (r) => { const l = layerOf(doc, r.m.layer); return l ? l.name : ''; } }[L.sort] || ((r) => r.m.page);
  rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * L.dir; });
  return rows;
}
function renderList() {
  const wrap = $('#list'); if (!wrap || !state.listOpen) return; const doc = activeDoc();
  const body = $('#list-body'); const foot = $('#list-foot');
  if (!doc) { body.innerHTML = ''; foot.innerHTML = ''; return; }
  // type filter options
  const subjects = [...new Set(doc.markups.map((m) => m.subject))].sort();
  const tsel = $('#list-type'); const curT = state.list.type;
  tsel.innerHTML = `<option value="all">All types</option><option value="markups">Markups only</option><option value="measures">Measurements only</option>${subjects.map((s) => `<option value="s:${esc(s)}">${esc(s)}</option>`).join('')}`; tsel.value = curT; if (tsel.value !== curT) { state.list.type = 'all'; tsel.value = 'all'; }
  const rows = listRows(doc);
  $$('#list thead th[data-sort]').forEach((th) => { th.classList.toggle('sorted', th.dataset.sort === state.list.sort); th.dataset.dir = state.list.sort === th.dataset.sort ? (state.list.dir > 0 ? 'asc' : 'desc') : ''; });
  body.innerHTML = rows.length ? rows.map(({ m, info }) => {
    const l = layerOf(doc, m.layer); const pl = doc.pages[m.page] && doc.pages[m.page].label;
    const col = m.type === 'highlight' || m.type === 'note' ? (m.type === 'note' ? m.style.fill : m.style.stroke) : m.style.stroke;
    return `<tr data-id="${m.id}" class="${state.sel.has(m.id) ? 'on' : ''}"><td class="c-subj"><span class="dotc" style="--c:${esc(col)}"></span>${icon(TOOLS[m.type] ? TOOLS[m.type].icon : 'rect', 'tiny')}<span>${esc(m.subject)}</span>${m.locked ? icon('lock', 'tiny dim') : ''}</td><td class="c-page num">${m.page + 1}${pl && pl !== String(m.page + 1) ? ` <span class="dim">${esc(pl)}</span>` : ''}</td><td class="c-label">${esc(m.type === 'note' ? '' : m.text || '')}</td><td class="c-meas num">${info ? esc(info.text) : ''}</td><td class="c-comment">${esc(m.comment || '')}</td><td><span class="status st-${m.status.toLowerCase()}">${esc(m.status)}</span></td><td>${esc(m.author)}</td><td class="num dim">${esc(fmtDate(m.modified))}</td><td>${l ? esc(l.name) : '<span class="dim">—</span>'}</td></tr>`;
  }).join('') : `<tr class="empty"><td colspan="9">${doc.markups.length ? 'No markups match these filters.' : 'No markups yet. Pick a tool above and draw on the page.'}</td></tr>`;
  // totals per subject for measurements
  const groups = new Map();
  rows.forEach(({ m, info }) => { if (!info || info.kind === 'Angle' || info.kind === 'Size') return; const k = `${m.subject}|${info.kind}|${info.unit}`; const g = groups.get(k) || { subject: m.subject, kind: info.kind, unit: info.unit, sum: 0, n: 0 }; g.sum += info.value; g.n++; groups.set(k, g); });
  foot.innerHTML = `<span class="lf-count">${rows.length} of ${doc.markups.length}</span>` + [...groups.values()].map((g) => `<span class="total" title="${g.n} item${g.n > 1 ? 's' : ''}"><b>${esc(g.subject)}</b> ${g.kind === 'Count' ? g.sum : g.sum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${esc(g.unit)}</span>`).join('');
}
function syncListSelection() { $$('#list-body tr[data-id]').forEach((tr) => tr.classList.toggle('on', state.sel.has(tr.dataset.id))); }
function bindList() {
  $('#list-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return; const doc = activeDoc(); const id = tr.dataset.id; const m = getMarkup(id); if (!m) return;
    if (state.tool !== 'select') setTool('select');
    if (e.shiftKey || e.ctrlKey || e.metaKey) { if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id); } else { state.sel.clear(); state.sel.add(id); }
    refreshSelection(); if (!(e.shiftKey || e.ctrlKey || e.metaKey)) zoomToBox(m.page, markupBBox(m, doc));
  });
  $('#list-body').addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr) return; const m = getMarkup(tr.dataset.id); if (m && TEXT_TYPES.has(m.type)) editText(m, false); else { const c = $('#prop-comment'); if (c) c.focus(); } });
  $$('#list thead th[data-sort]').forEach((th) => th.addEventListener('click', () => { const k = th.dataset.sort; if (state.list.sort === k) state.list.dir *= -1; else { state.list.sort = k; state.list.dir = 1; } renderList(); }));
  $('#list-q').addEventListener('input', (e) => { state.list.q = e.target.value; renderList(); });
  $('#list-type').addEventListener('change', (e) => { state.list.type = e.target.value; renderList(); });
  $('#list-status').addEventListener('change', (e) => { state.list.status = e.target.value; renderList(); });
  $('#list-page').addEventListener('change', (e) => { state.list.pageOnly = e.target.checked; renderList(); });
  $('#list-csv').addEventListener('click', exportCsv);
  $('#list-selall').addEventListener('click', () => { const doc = activeDoc(); if (!doc) return; setTool('select'); state.sel = new Set(listRows(doc).map((r) => r.m.id)); refreshSelection(); });
}
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
async function exportCsv() {
  const doc = activeDoc(); if (!doc) return; const rows = listRows(doc);
  const head = ['Page', 'Page label', 'Subject', 'Type', 'Label', 'Measurement', 'Value', 'Unit', 'Depth', 'Scale', 'Comment', 'Status', 'Author', 'Created', 'Modified', 'Layer', 'Colour'];
  const lines = [head.join(',')];
  rows.forEach(({ m, info }) => { const sc = scaleFor(doc, m.page); const l = layerOf(doc, m.layer); lines.push([m.page + 1, doc.pages[m.page] && doc.pages[m.page].label, m.subject, TOOLS[m.type] ? TOOLS[m.type].short || TOOLS[m.type].label : m.type, m.type === 'note' ? '' : m.text, info ? info.text : '', info ? +info.value.toFixed(4) : '', info ? info.unit : '', m.type === 'volume' ? m.depth : '', MEASURE_TYPES.has(m.type) ? sc.label : '', m.comment, m.status, m.author, m.created, m.modified, l ? l.name : '', m.style.stroke].map(csvCell).join(',')); });
  await saveFile(doc.name.replace(/\.pdf$/i, '') + ' - markups.csv', '﻿' + lines.join('\r\n'), 'text/csv');
}
