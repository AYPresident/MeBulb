// Generates metrics.json: advance widths (per 1000 em) of the PDF standard fonts
// for character codes 32..255 (Latin-1) plus a few extra punctuation code points.
const P = require('/opt/npm-tools/node_modules/pdf-lib');
const EXTRA = [8211, 8212, 8216, 8217, 8220, 8221, 8226, 8230, 8364, 8482, 8240];
(async () => {
  const d = await P.PDFDocument.create();
  const fonts = { reg: 'Helvetica', bold: 'HelveticaBold', treg: 'TimesRoman', tbold: 'TimesRomanBold', tital: 'TimesRomanItalic', tbi: 'TimesRomanBoldItalic' };
  const out = {};
  for (const [k, name] of Object.entries(fonts)) {
    const font = await d.embedFont(P.StandardFonts[name]);
    const arr = [];
    for (let c = 32; c <= 255; c++) {
      let w = 0;
      if (c >= 127 && c < 160) w = 0; else { try { w = Math.round(font.widthOfTextAtSize(String.fromCharCode(c), 1000)); } catch { w = 0; } }
      arr.push(w);
    }
    const ex = {};
    for (const c of EXTRA) { try { ex[c] = Math.round(font.widthOfTextAtSize(String.fromCodePoint(c), 1000)); } catch { } }
    out[k] = arr; out[k + 'X'] = ex;
  }
  require('fs').writeFileSync(__dirname + '/metrics.json', JSON.stringify(out));
  console.log('ok', Object.keys(out).join(','), JSON.stringify(out).length);
})();
