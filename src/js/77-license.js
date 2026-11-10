// ===== Licensing — lockdown, never destruction ==============================================================
// MeBulb never deletes, corrupts or "destroys" a customer's drawings, licensed or not. Enforcement is a
// lockdown: an unlicensed or lapsed copy still opens PDFs and lets you mark up ON SCREEN, but it will not
// SAVE or EXPORT anything until it is activated, so an unlicensed copy can't produce usable output. Files on
// disk are never touched by the licence state. Replace validateLicense() with a call to your own server.
const LICENSE = { status: 'ok', name: '', key: '', until: 0, ...store.get('license', {}) };
function licenseActive() { if (LICENSE.status === 'ok') return true; if (LICENSE.status === 'trial') return !LICENSE.until || Date.now() < +LICENSE.until; return false; }
function licenseLabel() {
  if (LICENSE.status === 'ok') return LICENSE.name ? `Licensed to ${LICENSE.name}` : 'Licensed';
  if (LICENSE.status === 'trial') return LICENSE.until ? `Trial to ${new Date(+LICENSE.until).toLocaleDateString()}` : 'Trial';
  if (LICENSE.status === 'expired') return 'Licence expired — activate to save';
  return 'Not activated — activate to save';
}
function setLicense(info) { Object.assign(LICENSE, info || {}); store.set('license', LICENSE); updateLicenseUI(); try { renderSaveBadge(); } catch { } }
function updateLicenseUI() { const b = $('#lic-badge'); if (!b) return; const lock = !licenseActive(); b.hidden = licenseActive() && LICENSE.status === 'ok'; b.textContent = licenseLabel(); b.className = 'lic-badge' + (lock ? ' locked' : ''); b.title = lock ? 'MeBulb is not activated: you can mark up on screen, but saving and exporting are off until you activate. No files are changed.' : licenseLabel(); }
// called where output would be produced; returns false and prompts when locked
function licenseGate(action) { if (licenseActive()) return true; licenseBlock(action); return false; }
function licenseBlock(action) { toast(`MeBulb isn't activated, so it can't ${action}. Your markups are safe on screen — activate to save.`, 'error'); activateDialog(action); }
async function activateDialog(action) {
  const r = await openDialog({ title: 'Activate MeBulb', body: `<p>${action ? `To ${esc(action)}, enter` : 'Enter'} your licence key.${LICENSE.status === 'expired' ? ' Your licence has expired.' : ''}</p>${field('Licence key', '<input type="text" name="key" autocomplete="off" spellcheck="false" placeholder="MEBULB-XXXXXX" class="code-in">')}<p class="muted sm">Nothing on disk is changed while unlicensed — you simply can't save or export until this is done.</p>`, buttons: [{ label: 'Not now', value: false }, { label: 'Activate', value: true, primary: true }], onOpen: (box) => setTimeout(() => { const i = box.querySelector('input[name=key]'); if (i) i.focus(); }, 30) });
  if (!r || !r.value) return; const key = String(r.form.key || '').trim(); if (!key) return;
  if (await validateLicense(key)) toast('MeBulb activated. Thank you!'); else toast('That key was not accepted. Check it, or contact your supplier.', 'error');
}
// Replace with a call to your licensing backend; it must resolve true only for a genuinely valid key.
async function validateLicense(key) {
  if (!/^MEBULB-[A-Z0-9][A-Z0-9-]{4,}$/i.test(key)) return false; // scaffold: accepts a well-formed offline key so the flow is usable/testable
  setLicense({ status: 'ok', key }); return true;
}
function deactivateLicense() { setLicense({ status: 'unlicensed', key: '' }); }
