// Generates the Voxarium app icon as a PNG using only Node built-ins.
// Run with: npm run icon
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SIZE = 512;
const SS = 3; // supersampling factor
const W = SIZE * SS;

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};

const clamp = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * clamp(t);
const smooth = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// Unit-space design helpers.
function roundedSquareDistance(x, y, radius) {
  const qx = Math.abs(x) - (0.5 - radius);
  const qy = Math.abs(y) - (0.5 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}
function roundRectDistance(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const pixel = new Float64Array(SIZE * SIZE * 4);
const bars = [
  { x: -0.155, h: 0.115, y: 0.02 },
  { x: -0.08, h: 0.2, y: 0.0 },
  { x: 0.0, h: 0.265, y: 0.0 },
  { x: 0.08, h: 0.17, y: 0.03 },
  { x: 0.155, h: 0.09, y: 0.055 },
];

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / SIZE; // 0..1
        const y = (py + (sy + 0.5) / SS) / SIZE;
        const ux = x - 0.5;
        const uy = y - 0.5;

        const edge = roundedSquareDistance(ux, uy, 0.235);
        const shape = 1 - smooth(-0.004, 0.004, edge);
        if (shape <= 0) continue;

        // Diagonal violet -> cyan gradient.
        const t = clamp((x + y) / 2);
        let cr = mix(124, 34, t);
        let cg = mix(92, 211, t);
        let cb = mix(255, 238, t);

        // Soft top-left highlight and bottom vignette.
        const glow = Math.exp(-((x - 0.3) ** 2 + (y - 0.25) ** 2) / 0.09);
        cr = mix(cr, 255, glow * 0.25);
        cg = mix(cg, 255, glow * 0.25);
        cb = mix(cb, 255, glow * 0.25);
        const vignette = smooth(0.4, 0.9, Math.hypot(ux, uy));
        cr *= 1 - vignette * 0.2;
        cg *= 1 - vignette * 0.2;
        cb *= 1 - vignette * 0.12;

        // White waveform pill bars.
        let ink = 0;
        for (const bar of bars) {
          const d = roundRectDistance(x, y, 0.5 + bar.x, 0.5 + bar.y, 0.022, bar.h, 0.022);
          ink = Math.max(ink, 1 - smooth(-0.0025, 0.0025, d));
        }
        // Small accent dot under the waveform.
        const dotD = Math.hypot(x - 0.5, y - 0.745) - 0.012;
        ink = Math.max(ink, 1 - smooth(-0.002, 0.002, dotD));

        cr = mix(cr, 248, ink * 0.96);
        cg = mix(cg, 250, ink * 0.96);
        cb = mix(cb, 255, ink * 0.96);

        r += cr * shape;
        g += cg * shape;
        b += cb * shape;
        a += shape;
      }
    }
    const n = SS * SS;
    const idx = (py * SIZE + px) * 4;
    pixel[idx] = r / n;
    pixel[idx + 1] = g / n;
    pixel[idx + 2] = b / n;
    pixel[idx + 3] = (a / n) * 255;
  }
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[o] = Math.round(pixel[i]);
    raw[o + 1] = Math.round(pixel[i + 1]);
    raw[o + 2] = Math.round(pixel[i + 2]);
    raw[o + 3] = Math.round(pixel[i + 3]);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(join(root, 'build'), { recursive: true });
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'build', 'icon.png'), png);
writeFileSync(join(root, 'public', 'icon.png'), png);
console.log(`[icon] wrote ${png.length} byte icon`);
