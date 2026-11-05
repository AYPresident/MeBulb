// Runs the main browser test suites one after another and prints a summary.
const { spawnSync } = require('child_process'); const path = require('path');
const SUITES = ['flow', 'flow2', 'flow3', 'r4', 'r5', 'label', 'incr', 'textmark', 'revu', 'stamps', 'btx', 'equip', 'r7', 'r8', 'r9', 'ocr', 'igs']; // igs skips itself without the client files
const only = process.argv.slice(2); let failed = 0; const t0 = Date.now();
for (const s of only.length ? only : SUITES) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s + '.js')], { encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || ''); const pass = (out.match(/^PASS |\sPASS$/gm) || []).length; const fail = out.match(/^FAIL .*|^.*\sFAIL$/gm) || [];
  const bad = r.status !== 0 || fail.length; if (bad) failed++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${s.padEnd(9)} ${pass} passed${fail.length ? ', ' + fail.length + ' failed' : ''}${r.status && !fail.length ? ' (exit ' + r.status + ')' : ''}`);
  for (const f of fail) console.log('       ' + f);
  if (r.status && !fail.length) console.log(out.split('\n').slice(-12).map((l) => '       ' + l).join('\n'));
}
console.log(`${failed ? failed + ' suite(s) failed' : 'all suites passed'} in ${Math.round((Date.now() - t0) / 1000)} s`); process.exitCode = failed ? 1 : 0;
