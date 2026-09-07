// Generates the PWA icons. No image dependencies — the PNGs are written with a
// tiny encoder built on Node's own zlib, so this stays runnable years from now.
//
//   node tools/make-icons.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(OUT, { recursive: true });

const BLUE = [37, 106, 191]; // --accent #256abf
const WHITE = [255, 255, 255];
const SS = 4; // supersampling factor, for smooth edges

// ---------------------------------------------------------------- png encoder

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array of width*height*4 */
function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- drawing

/** Signed-distance test for a rounded rectangle in normalised coordinates. */
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
    if (x >= x0 + r && x <= x1 - r) return true;
    if (y >= y0 + r && y <= y1 - r) return true;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  }
  return false;
};

/** The dumbbell glyph, in a 0..1 box: bar plus two plates a side. */
function glyphHit(x, y) {
  const bar = inRoundRect(x, y, 0.255, 0.455, 0.745, 0.545, 0.03);
  const innerL = inRoundRect(x, y, 0.185, 0.345, 0.285, 0.655, 0.04);
  const innerR = inRoundRect(x, y, 0.715, 0.345, 0.815, 0.655, 0.04);
  const outerL = inRoundRect(x, y, 0.09, 0.405, 0.175, 0.595, 0.035);
  const outerR = inRoundRect(x, y, 0.825, 0.405, 0.91, 0.595, 0.035);
  return bar || innerL || innerR || outerL || outerR;
}

/**
 * shape: 'rounded'  transparent corners, for the web manifest's "any" icons
 *        'maskable' full-bleed, glyph inside Android's 80% safe zone
 *        'square'   full-bleed, for apple-touch-icon (iOS masks it itself and
 *                   composites transparency onto black, so it must be opaque)
 */
function renderIcon(size, shape) {
  const S = size * SS;
  const acc = new Float32Array(size * size * 4);
  const rounded = shape === 'rounded';
  const cornerR = rounded ? 0.22 : 0;
  const glyphScale = shape === 'maskable' ? 0.72 : shape === 'square' ? 0.84 : 1;

  for (let py = 0; py < S; py++) {
    const v = (py + 0.5) / S;
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S;

      const onPlate = rounded ? inRoundRect(u, v, 0, 0, 1, 1, cornerR) : true;
      if (!onPlate) continue;

      // Glyph coordinates, scaled about the centre for the maskable safe zone.
      const gu = (u - 0.5) / glyphScale + 0.5;
      const gv = (v - 0.5) / glyphScale + 0.5;
      const isGlyph = gu >= 0 && gu <= 1 && gv >= 0 && gv <= 1 && glyphHit(gu, gv);
      const [r, g, b] = isGlyph ? WHITE : BLUE;

      const i = (Math.floor(py / SS) * size + Math.floor(px / SS)) * 4;
      acc[i] += r;
      acc[i + 1] += g;
      acc[i + 2] += b;
      acc[i + 3] += 255;
    }
  }

  const n = SS * SS;
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < out.length; i += 4) {
    const a = acc[i + 3] / n;
    // Un-premultiply so the rounded corners stay clean against any background.
    const cov = a / 255;
    out[i] = cov > 0 ? Math.round(acc[i] / n / cov) : 0;
    out[i + 1] = cov > 0 ? Math.round(acc[i + 1] / n / cov) : 0;
    out[i + 2] = cov > 0 ? Math.round(acc[i + 2] / n / cov) : 0;
    out[i + 3] = Math.round(a);
  }
  return encodePng(out, size, size);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect width="100" height="100" rx="22" fill="#256abf"/>
  <g fill="#ffffff">
    <rect x="25.5" y="45.5" width="49" height="9" rx="3"/>
    <rect x="18.5" y="34.5" width="10" height="31" rx="4"/>
    <rect x="71.5" y="34.5" width="10" height="31" rx="4"/>
    <rect x="9" y="40.5" width="8.5" height="19" rx="3.5"/>
    <rect x="82.5" y="40.5" width="8.5" height="19" rx="3.5"/>
  </g>
</svg>
`;

writeFileSync(join(OUT, 'icon.svg'), SVG);
for (const [name, size, shape] of [
  ['icon-192.png', 192, 'rounded'],
  ['icon-512.png', 512, 'rounded'],
  ['icon-180.png', 180, 'square'],
  ['icon-maskable-512.png', 512, 'maskable'],
]) {
  writeFileSync(join(OUT, name), renderIcon(size, shape));
  console.log('wrote', name, `${size}x${size}`, `(${shape})`);
}
console.log('wrote icon.svg');
