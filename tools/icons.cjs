'use strict';
// Genera build/icon.png, build/icon.ico y build/tray.ico desde los sprites, sin dependencias.
// Baldosa estándar: a sangre, esquinas al 19 %, el dibujo al 62 % (68 % por debajo de 64 px).
// Como es pixel art, el dibujo se escala solo por enteros: en cada tamaño se elige el Wisp
// (grande de 16 px o chiquito de 11 px) y la escala que más se acercan a ese porcentaje.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { PALETTE, TOP, SKIRT, FACES } = require('../renderer/sprites.js');

const TILE = '#1b1a26';
const OUT = path.join(__dirname, '..', 'build');

// El Wisp grande: cuerpo + colita + cara de reposo
function bigSprite() {
  const rows = TOP.concat(SKIRT[0]).map(r => r.split(''));
  for (const [k, row] of Object.entries(FACES.idle)) {
    for (let i = 0; i < 16; i++) if (row[i] !== '_') rows[Number(k)][i] = row[i];
  }
  return rows.map(r => r.join(''));
}

// El Wisp chiquito, dibujado aparte para que se lea a 16 px
const SMALL = [
  '...ooooo...',
  '.oowwwwwoo.',
  '.owwwwwwso.',
  'owwwwwwwwso',
  'owwewwwewso',
  'owwewwwewso',
  'owwwwwwwwso',
  'owwwwwwwsso',
  'owwwwwwwsso',
  'owwowwwowso',
  '.oo.ooo.oo.',
];
const BIG = bigSprite();

function rgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

function coverage(x, y, size, r) {
  let hit = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
      const dx = Math.max(r - px, 0, px - (size - r));
      const dy = Math.max(r - py, 0, py - (size - r));
      if (dx * dx + dy * dy <= r * r) hit++;
    }
  }
  return hit / 16;
}

function closest(sprite, size, target) {
  const w = sprite[0].length;
  let best = null;
  for (let s = 1; s * w <= size; s++) {
    const off = Math.abs(s * w - target);
    if (!best || off < best.off) best = { sprite, scale: s, off };
  }
  return best;
}

// El grande tiene más detalle (brillo en los ojos, cachetes): gana si queda a 1 px del chiquito
function pickSprite(size) {
  const target = size * (size < 64 ? 0.68 : 0.62);
  const big = closest(BIG, size, target), small = closest(SMALL, size, target);
  return big.off <= small.off + 1 ? big : small;
}

// RGBA sin premultiplicar
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = Math.round(255 * a);
  };
  const tile = rgb(TILE);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, tile, coverage(x, y, size, size * 0.19));

  const { sprite, scale } = pickSprite(size);
  const w = sprite[0].length * scale, h = sprite.length * scale;
  const ox = Math.floor((size - w) / 2), oy = Math.floor((size - h) / 2);
  sprite.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '.') continue;
      const color = rgb(PALETTE[row[i]]);
      for (let v = 0; v < scale; v++) for (let u = 0; u < scale; u++) put(ox + i * scale + u, oy + j * scale + v, color, 1);
    }
  });
  return px;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const px = draw(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// .ico con un PNG adentro por tamaño
function ico(sizes) {
  const images = sizes.map(png);
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((size, n) => {
    const e = 6 + 16 * n;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(images[n].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += images[n].length;
  });
  return Buffer.concat([head, ...images]);
}

module.exports = { png };
if (require.main !== module) return;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.png'), png(512));
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico([16, 20, 24, 32, 40, 48, 64, 128, 256]));
fs.writeFileSync(path.join(OUT, 'tray.ico'), ico([16, 20, 24, 32]));
for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256, 512]) {
  const { sprite, scale } = pickSprite(size);
  console.log(`${size} px: Wisp ${sprite === BIG ? 'grande' : 'chiquito'} ×${scale} (${Math.round(sprite[0].length * scale / size * 100)} %)`);
}
