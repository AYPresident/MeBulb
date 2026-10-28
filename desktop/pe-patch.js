// Give the renamed Electron executable MeBulb's icon and version information, in place.
// The original resources are larger than ours, so nothing in the PE layout moves: icon images
// and the version block are overwritten and their recorded sizes updated. (The Electron
// binary is not code-signed, so there is no signature to invalidate.)
'use strict';
const fs = require('fs'); const path = require('path');

function patch(exe, { version = '0.0.0' } = {}) {
  const d = fs.readFileSync(exe); const A = path.join(__dirname, 'assets');
  const pe = d.readUInt32LE(0x3c); if (d.readUInt32LE(pe) !== 0x4550) throw new Error('not a PE file');
  if (d.readUInt32LE(pe + 24 + (d.readUInt16LE(pe + 24) === 0x20b ? 112 : 96) + 8 * 4 + 4)) throw new Error('executable is signed; not patching');
  const nsec = d.readUInt16LE(pe + 6), optsz = d.readUInt16LE(pe + 20); const opt = pe + 24; const ddir = opt + (d.readUInt16LE(opt) === 0x20b ? 112 : 96);
  const rsrcRva = d.readUInt32LE(ddir + 16); const secs = [];
  for (let i = 0; i < nsec; i++) { const o = pe + 24 + optsz + i * 40; secs.push({ va: d.readUInt32LE(o + 12), vs: d.readUInt32LE(o + 8), ro: d.readUInt32LE(o + 20), rs: d.readUInt32LE(o + 16) }); }
  const off = (rva) => { const s = secs.find((x) => rva >= x.va && rva < x.va + Math.max(x.vs, x.rs)); if (!s) throw new Error('bad rva'); return rva - s.va + s.ro; };
  const base = off(rsrcRva); const leaves = [];
  (function walk(o, p) { const n = d.readUInt16LE(base + o + 12) + d.readUInt16LE(base + o + 14); for (let k = 0; k < n; k++) { const e = base + o + 16 + k * 8; const name = d.readUInt32LE(e), sub = d.readUInt32LE(e + 4); const id = name & 0x80000000 ? 'str' : name; if (sub & 0x80000000) walk(sub & 0x7fffffff, [...p, id]); else leaves.push({ path: [...p, id], entry: base + sub, rva: d.readUInt32LE(base + sub), size: d.readUInt32LE(base + sub + 4) }); } })(0, []);
  const put = (leaf, data) => { if (data.length > leaf.size) throw new Error(`resource ${leaf.path} too small`); const o = off(leaf.rva); d.fill(0, o, o + leaf.size); data.copy(d, o); d.writeUInt32LE(data.length, leaf.entry + 4); };
  // icons: group 14 lists the images (type 3) by id with their sizes
  const group = leaves.find((l) => l.path[0] === 14); if (!group) throw new Error('no icon group');
  const go = off(group.rva); const count = d.readUInt16LE(go + 4);
  for (let i = 0; i < count; i++) {
    const e = go + 6 + i * 14; const w = d[e] || 256; const id = d.readUInt16LE(e + 12); const leaf = leaves.find((l) => l.path[0] === 3 && l.path[1] === id); if (!leaf) continue;
    const file = w === 256 ? 'icon-256.png' : `icon-${w}.dib`; if (!fs.existsSync(path.join(A, file))) continue;
    const img = fs.readFileSync(path.join(A, file)); put(leaf, img); d.writeUInt32LE(img.length, e + 8); d.writeUInt16LE(32, e + 6);
  }
  // version information
  const ver = leaves.find((l) => l.path[0] === 16); if (ver) put(ver, versionInfo(d.subarray(off(ver.rva), off(ver.rva) + ver.size), version));
  fs.writeFileSync(exe, d);
}

// VS_VERSIONINFO with MeBulb's strings; the fixed part is taken from the original and renumbered
function versionInfo(orig, version) {
  const fixedAt = (() => { for (let i = 0; i + 4 < orig.length; i += 4) if (orig.readUInt32LE(i) === 0xfeef04bd) return i; throw new Error('no fixed info'); })();
  const fixed = Buffer.from(orig.subarray(fixedAt, fixedAt + 52)); const [a, b, c] = version.split('.').map((x) => +x || 0);
  fixed.writeUInt32LE((a << 16) | b, 8); fixed.writeUInt32LE(c << 16, 12); fixed.writeUInt32LE((a << 16) | b, 16); fixed.writeUInt32LE(c << 16, 20);
  const w = (s) => Buffer.from(s + '\0', 'utf16le'); const pad = (buf) => (buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]) : buf);
  // one block: header, key, padding, value, padding, children
  const block = (key, value, type, children = [], valueLen) => {
    const head = Buffer.alloc(6); let body = pad(Buffer.concat([head, w(key)]));
    if (value) body = pad(Buffer.concat([body, value]));
    for (const ch of children) body = pad(Buffer.concat([body, ch]));
    body.writeUInt16LE(trimLen(body, children, value), 0); body.writeUInt16LE(valueLen != null ? valueLen : value ? value.length : 0, 2); body.writeUInt16LE(type, 4); return body;
  };
  const trimLen = (b) => b.length;
  const str = (k, v) => block(k, w(v), 1, [], v.length + 1);
  const strings = [['CompanyName', 'MeBulb'], ['FileDescription', 'MeBulb'], ['FileVersion', version], ['InternalName', 'MeBulb'], ['LegalCopyright', 'MeBulb. Built with Electron (MIT licence).'], ['OriginalFilename', 'MeBulb.exe'], ['ProductName', 'MeBulb'], ['ProductVersion', version]];
  const table = block('040904b0', null, 1, strings.map(([k, v]) => str(k, v)));
  const sfi = block('StringFileInfo', null, 1, [table]);
  const tr = Buffer.alloc(4); tr.writeUInt16LE(0x0409, 0); tr.writeUInt16LE(0x04b0, 2);
  const vfi = block('VarFileInfo', null, 1, [block('Translation', tr, 0)]);
  return block('VS_VERSION_INFO', fixed, 0, [sfi, vfi]);
}
module.exports = { patch, versionInfo };
if (require.main === module) { patch(process.argv[2], { version: process.argv[3] || '0.4.0' }); console.log('patched', process.argv[2]); }
