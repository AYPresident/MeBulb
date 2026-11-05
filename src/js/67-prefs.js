// ===== Preferences and keyboard shortcut editor ====================================
function savePrefs() { store.set('prefs', state.prefs); }
async function prefsDialog() {
  const P0 = state.prefs;
  const r = await openDialog({ title: 'Preferences', wide: true, body: `
    <section class="psec"><h3>General</h3>
      ${field('Your name (shown on markups and in live sessions)', `<input type="text" name="author" value="${esc(state.author)}" maxlength="60">`)}
      <div class="field two"><div><label>Theme</label><select name="theme">${[['system', 'Follow Windows'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}"${state.theme === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label>Units</label><select name="units">${[['m', 'Metres (m, m²)'], ['mm', 'Millimetres (mm, m²)'], ['ftin', 'Feet-inches (ft, sf)']].map(([v, l]) => `<option value="${v}"${state.units === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    </section>
    <section class="psec"><h3>Sketches and risers</h3>
      ${field('When you drag a riser label on one floor', `<select name="linkLabelMode">${[['ask', 'Ask each time'], ['floor', 'Move it on that floor only'], ['follow', 'Move it the same way on every floor']].map(([v, l]) => `<option value="${v}"${P0.linkLabelMode === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
      <label class="check"><input type="checkbox" name="autonum"${state.sketchAutoNum ? ' checked' : ''}> Number new sketches automatically (M1, M2, M3…)</label>
    </section>
    <section class="psec"><h3>Live sessions (desktop app)</h3>
      ${field('When others are working on a PDF you open', `<select name="liveJoin">${[['ask', 'Ask me'], ['always', 'Join automatically'], ['never', 'Work alone']].map(([v, l]) => `<option value="${v}"${(P0.liveJoin || 'ask') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
    </section>
    <section class="psec"><h3>Files</h3>
      ${field('Stream files larger than (MB) instead of loading them whole', `<input type="number" name="largeFileMB" min="8" max="2000" value="${P0.largeFileMB}">`)}
      <div class="field two"><div><label>Autosave the PDF (desktop app)</label><select name="autosavePdf">${AUTOSAVE_CHOICES.map((v) => `<option value="${v}"${autosaveMins() === v ? ' selected' : ''}>${v ? `Every ${v} minute${v === 1 ? '' : 's'}` : 'Off'}</option>`).join('')}</select></div>
      <div><label>Recovery copy of unsaved markups</label><select name="recoveryMins">${[[0, 'A few seconds after each change'], [1, 'Every minute'], [2, 'Every 2 minutes'], [5, 'Every 5 minutes']].map(([v, l]) => `<option value="${v}"${+(P0.recoveryMins || 0) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <p class="muted sm" style="margin-top:-4px">Autosave writes the PDF itself (only a PDF you can write; in a live session, only by the person holding the file). The recovery copy stays on this PC and is offered back if MeBulb stops before you save: File ▸ Recover unsaved work.</p>
    </section>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }] });
  if (!r || !r.value) return; const f = r.form;
  state.author = f.author.trim() || 'Reviewer'; store.set('author', state.author);
  if (f.theme !== state.theme) setTheme(f.theme); if (f.units !== state.units) setUnits(f.units);
  state.prefs = { ...P0, liveJoin: f.liveJoin, linkLabelMode: f.linkLabelMode, largeFileMB: clamp(+f.largeFileMB || 48, 8, 2000), autosavePdf: +f.autosavePdf || 0, recoveryMins: +f.recoveryMins || 0 }; savePrefs(); renderSaveBadge();
  state.sketchAutoNum = !!f.autonum; store.set('sketchAutoNum', state.sketchAutoNum);
  refreshPanels(); toast('Preferences saved');
}

// ----- keyboard shortcuts ------------------------------------------------------------------------
function shortcutsDialog() {
  const groups = {}; Object.values(COMMANDS).forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
  const order = ['File', 'Edit', 'Navigate', 'Markup', 'Shapes', 'Measure', 'Sketch to scale', 'Arrange', 'View', 'Document', 'Window', 'Help', 'General'];
  const row = (c) => { const ks = keysFor(c.id); const changed = !!state.shortcuts[c.id]; return `<div class="sc-row" data-cmd="${c.id}"><span class="sc-ic">${cmdIcon(c) ? icon(cmdIcon(c), 'tiny') : ''}</span><span class="sc-label">${esc(c.label)}</span><span class="sc-keys">${ks.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ') || '<span class="dim">—</span>'}</span><button type="button" class="btn sm" data-sc="set">Change</button><button type="button" class="icon-btn sm" data-sc="clear" title="Remove shortcut" aria-label="Remove shortcut">${icon('close')}</button>${changed ? `<button type="button" class="btn sm" data-sc="reset" title="Back to the default">Default</button>` : ''}</div>`; };
  const body = () => `<div class="sc-top"><input type="search" id="sc-q" placeholder="Search commands or keys" aria-label="Search commands"><button type="button" class="btn sm" data-sc="resetall">Reset all to defaults</button></div><p class="muted sm">Defaults follow Bluebeam Revu where it has the same command, so your habits carry over. Ctrl+Shift+V pastes copied properties in MeBulb (in Revu it is Paste in Place, which here is Ctrl+Shift+Alt+V).</p>
    <div class="sc-list">${order.filter((g) => groups[g]).map((g) => `<h4>${esc(g)}</h4>${groups[g].map(row).join('')}`).join('')}</div>`;
  openDialog({ title: 'Keyboard shortcuts', wide: true, body: body(), buttons: [{ label: 'Done', value: true, primary: true }], onOpen: (box) => wireShortcuts(box, body) });
}
function wireShortcuts(box, body) {
  const form = box.querySelector('#dlg-form');
  const filter = () => { const q = (box.querySelector('#sc-q').value || '').toLowerCase(); box.querySelectorAll('.sc-row').forEach((r) => { r.hidden = q && !r.textContent.toLowerCase().includes(q); }); };
  const redraw = () => { const q = box.querySelector('#sc-q').value; form.innerHTML = body(); box.querySelector('#sc-q').value = q; filter(); rebuildKeymap(); renderToolbars(); renderNavbar(); renderStrips(); };
  form.addEventListener('input', (e) => { if (e.target.id === 'sc-q') filter(); });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sc]'); if (!b) return; const id = b.closest('.sc-row') && b.closest('.sc-row').dataset.cmd; const a = b.dataset.sc;
    if (a === 'resetall') { state.shortcuts = {}; store.set('shortcuts', state.shortcuts); redraw(); return; }
    if (a === 'clear') { state.shortcuts[id] = []; store.set('shortcuts', state.shortcuts); redraw(); return; }
    if (a === 'reset') { delete state.shortcuts[id]; store.set('shortcuts', state.shortcuts); redraw(); return; }
    if (a === 'set') {
      const cell = b.closest('.sc-row').querySelector('.sc-keys'); cell.innerHTML = '<span class="sc-wait">Press the keys… (Esc to cancel)</span>'; state.capturingKey = true;
      const cap = (ev) => {
        ev.preventDefault(); ev.stopPropagation(); const combo = comboOf(ev); if (!combo) return;
        window.removeEventListener('keydown', cap, true); setTimeout(() => { state.capturingKey = false; }, 0);
        if (combo === 'Escape') { redraw(); return; }
        const n = normCombo(combo); const eff = effectiveShortcuts();
        Object.entries(eff).forEach(([cid, ks]) => { if (cid !== id && ks.map(normCombo).includes(n)) { state.shortcuts[cid] = ks.filter((k) => normCombo(k) !== n); toast(`${n} moved from “${COMMANDS[cid] ? COMMANDS[cid].label : cid}”`); } });
        state.shortcuts[id] = [n]; store.set('shortcuts', state.shortcuts); redraw();
      };
      window.addEventListener('keydown', cap, true);
    }
  });
}
