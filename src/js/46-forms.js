// ===== Form fields: fill in the viewer, write values on save ===============
async function loadFields(doc) {
  if (doc.fieldsLoaded || !doc.pdf) return; doc.fieldsLoaded = true; doc.fields = {};
  let objs = null; try { objs = await doc.pdf.getFieldObjects(); } catch { }
  doc.hasForms = !!(objs && Object.keys(objs).length); if (!doc.hasForms) return;
  for (let i = 0; i < doc.numPages; i++) {
    let anns = []; try { anns = await (await doc.pdf.getPage(i + 1)).getAnnotations(); } catch { }
    const T = doc.pages[i].T;
    doc.fields[i] = anns.filter((a) => a.subtype === 'Widget' && a.fieldType && a.fieldType !== 'Sig' && !a.hidden && !a.pushButton).map((a) => {
      const r = a.rect; const pts = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map((p) => [T[0] * p[0] + T[2] * p[1] + T[4], T[1] * p[0] + T[3] * p[1] + T[5]]); const b = G.bbox(pts);
      const type = a.fieldType === 'Tx' ? (a.multiLine ? 'textarea' : 'text') : a.fieldType === 'Btn' ? (a.radioButton ? 'radio' : 'checkbox') : a.fieldType === 'Ch' ? (a.combo ? 'combo' : 'list') : 'text';
      return { id: a.id, name: a.fieldName, type, x: b.x, y: b.y, w: b.w, h: b.h, value: a.fieldValue, on: a.exportValue || a.buttonValue || 'Yes', options: a.options || [], readOnly: !!a.readOnly, maxLen: a.maxLen || 0, fontSize: (a.defaultAppearanceData && a.defaultAppearanceData.fontSize) || 0, align: a.textAlignment || 0 };
    });
  }
  // the fields are drawn as live inputs; with storage-mode rendering keep their widgets off the canvas
  if (doc.hasOwnAnnots) Object.values(doc.fields).flat().forEach((f) => doc.pdf.annotationStorage.setValue(f.id, { noView: true }));
  doc.pageEls && doc.pageEls.forEach((el) => { el._scale = 0; }); scheduleRender(); renderFormLayers();
  const n = Object.values(doc.fields).reduce((s, l) => s + l.length, 0); if (n) toast(`This PDF has ${n} form field${n === 1 ? '' : 's'}. Use Select and click a field to fill it in.`);
}
function fieldValue(doc, f) { return Object.prototype.hasOwnProperty.call(doc.formValues, f.name) ? doc.formValues[f.name] : f.value; }
function renderFormLayers() {
  const doc = activeDoc(); if (!doc || !doc.pageEls || !doc.hasForms) return;
  doc.pageEls.forEach((el, i) => {
    let layer = el.querySelector('.forms'); const fs = doc.fields[i] || [];
    if (!fs.length) { if (layer) layer.remove(); return; }
    if (!layer) { layer = document.createElement('div'); layer.className = 'forms'; el.appendChild(layer); }
    const pg = doc.pages[i];
    layer.innerHTML = fs.map((f, k) => {
      const st = `left:${(f.x / pg.w) * 100}%;top:${(f.y / pg.h) * 100}%;width:${(f.w / pg.w) * 100}%;height:${(f.h / pg.h) * 100}%;--fs:${f.fontSize || Math.max(6, Math.min(f.h * 0.68, 14))}`;
      const v = fieldValue(doc, f); const common = `data-f="${k}" style="${st}" title="${esc(f.name)}"${f.readOnly ? ' disabled' : ''}`;
      if (f.type === 'checkbox') return `<input type="checkbox" class="ff" ${common}${v && v !== 'Off' ? ' checked' : ''}>`;
      if (f.type === 'radio') return `<input type="radio" class="ff" name="r-${esc(f.name)}" ${common}${v === f.on ? ' checked' : ''}>`;
      if (f.type === 'combo' || f.type === 'list') return `<select class="ff" ${common}${f.type === 'list' ? ' size="2"' : ''}>${f.type === 'combo' ? '<option value=""></option>' : ''}${f.options.map((o) => `<option value="${esc(o.exportValue)}"${o.exportValue === v || o.displayValue === v ? ' selected' : ''}>${esc(o.displayValue)}</option>`).join('')}</select>`;
      if (f.type === 'textarea') return `<textarea class="ff" ${common}>${esc(v || '')}</textarea>`;
      return `<input type="text" class="ff" ${common} value="${esc(v || '')}"${f.maxLen ? ` maxlength="${f.maxLen}"` : ''}${f.align === 1 ? ' data-align="center"' : f.align === 2 ? ' data-align="right"' : ''}>`;
    }).join('');
  });
}
function bindForms() {
  const snap = (el) => { const doc = activeDoc(); if (doc && !el._snap) el._snap = snapshot(doc); };
  V.pages.addEventListener('focusin', (e) => { if (e.target.classList.contains('ff')) snap(e.target); });
  V.pages.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('ff')) { e.stopPropagation(); snap(e.target); } }, true);
  V.pages.addEventListener('change', (e) => {
    const el = e.target; if (!el.classList.contains('ff')) return; const doc = activeDoc(); const page = +el.closest('.page').dataset.i; const f = doc.fields[page][+el.dataset.f];
    let v = el.value; if (f.type === 'checkbox') v = el.checked ? f.on : 'Off'; if (f.type === 'radio') v = el.checked ? f.on : fieldValue(doc, f);
    if (el._snap) { doc.undo.push(el._snap); doc.redo = []; el._snap = null; }
    doc.formValues[f.name] = v; markDirty(doc);
    if (f.type === 'radio' || f.type === 'checkbox') renderFormLayers(); // keep same-named widgets in step
  });
  V.pages.addEventListener('keydown', (e) => { if (e.target.classList && e.target.classList.contains('ff')) e.stopPropagation(); });
}
function applyFormValues(pdfDoc, doc, font, flatten) {
  const names = Object.keys(doc.formValues || {}); if (!names.length && !flatten) return;
  let form; try { form = pdfDoc.getForm(); } catch (e) { console.warn(e); return; }
  names.forEach((name) => {
    const v = doc.formValues[name];
    try {
      const f = form.getField(name); const L = PDFLib;
      if (f instanceof L.PDFTextField) f.setText(v == null ? '' : String(v));
      else if (f instanceof L.PDFCheckBox) { if (v && v !== 'Off') f.check(); else f.uncheck(); }
      else if (f instanceof L.PDFRadioGroup) { if (!v || v === 'Off') f.clear(); else f.select(v); }
      else if (f instanceof L.PDFDropdown || f instanceof L.PDFOptionList) { if (v) f.select(v); else f.clear(); }
    } catch (e) { console.warn('form field not written:', name, e.message); }
  });
  try { form.updateFieldAppearances(font); } catch (e) { console.warn('appearance update failed', e.message); }
  if (flatten) { try { form.flatten(); } catch (e) { console.warn('form flatten failed', e.message); } }
}
