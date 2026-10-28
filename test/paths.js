// Where the build and tests find their tools: the project's own node_modules (after `npm install`),
// or a shared tools folder (MEBULB_TOOLS, default /opt/npm-tools) on machines set up that way.
const fs = require('fs'); const path = require('path');
const SHARED = process.env.MEBULB_TOOLS || '/opt/npm-tools';
function modDir(name) {
  for (const base of [path.join(__dirname, '..'), SHARED]) { const d = path.join(base, 'node_modules', name); if (fs.existsSync(path.join(d, 'package.json'))) return d; }
  throw new Error(`${name} is not installed. Run npm install in the project folder.`);
}
module.exports = { modDir, playwright: () => require(modDir('playwright')), pdfjsDir: () => modDir('pdfjs-dist'), pdfLibDir: () => modDir('pdf-lib') };
