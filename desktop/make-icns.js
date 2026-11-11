// Build a real macOS .icns from assets/icon.png (no mac tools needed).
// ICNS is a simple container: 'icns' magic, big-endian total length, then
// entries of [4-byte OSType][4-byte entry length][PNG bytes]. Modern macOS
// reads PNG-encoded entries, so we pack several sizes at the PNG-capable types.
'use strict';
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const SRC = path.join(__dirname, 'assets/icon.png');
const OUT = process.argv[2] || path.join(__dirname, 'assets/icon.icns');
const TMP = fs.mkdtempSync('/tmp/icns-');
// OSType -> pixel size (PNG-based types understood by macOS 10.7+)
const TYPES = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
const parts = [];
for (const [type, size] of TYPES) {
  const p = path.join(TMP, `${type}.png`);
  execSync(`convert ${SRC} -resize ${size}x${size} -strip ${p}`);
  const png = fs.readFileSync(p);
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(png.length + 8, 4);
  parts.push(head, png);
}
const body = Buffer.concat(parts);
const header = Buffer.alloc(8);
header.write('icns', 0, 'ascii');
header.writeUInt32BE(body.length + 8, 4);
fs.writeFileSync(OUT, Buffer.concat([header, body]));
fs.rmSync(TMP, { recursive: true, force: true });
console.log('icns:', OUT, (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB,', TYPES.length, 'sizes');
