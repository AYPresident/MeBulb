const { launch } = require('./harness');
(async () => {
  const { browser, page } = await launch({ viewport: { width: 400, height: 800 } });
  const r = await page.evaluate(() => { const out = []; document.querySelectorAll('body *').forEach(el => { const b = el.getBoundingClientRect(); if (b.right > window.innerWidth + 1 && el.offsetParent !== null) { let p = el.parentElement, clipped = false; while (p && p !== document.body) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(cs.overflowX)) { clipped = true; break; } p = p.parentElement; } if (!clipped) out.push(el.tagName + '#' + el.id + '.' + String(el.className).slice(0, 30) + ' r=' + Math.round(b.right)); } }); return { sw: document.documentElement.scrollWidth, list: out.slice(0, 15) }; });
  console.log(JSON.stringify(r, null, 1));
  await page.screenshot({ path: 'test/out/view-phone.png' });
  await browser.close();
})();
