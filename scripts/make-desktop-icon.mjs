/**
 * 生成桌面版应用图标 desktop/icon.ico（256×256，PNG 内嵌式 ICO）。
 *
 * 纯 Node 实现（zlib + 手写 PNG/ICO 封装），不新增运行时依赖。
 * 图案：深绿桌面底 + 白色扑克牌 + 红色方块，呼应斗地主主题与 index.html 的 theme-color。
 * 4×4 超采样抗锯齿。重新生成：node scripts/make-desktop-icon.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'desktop', 'icon.ico');

const SIZE = 256;
const SS = 4; // 每像素超采样数（SS×SS 子样本）
const TOTAL = SIZE * SS;

// ---- 画布（超采样分辨率） ----
const canvas = new Uint8Array(TOTAL * TOTAL * 4); // RGBA

function putPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= TOTAL || y >= TOTAL) return;
  const i = (y * TOTAL + x) * 4;
  const sa = a / 255;
  const da = canvas[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  canvas[i] = Math.round((r * sa + canvas[i] * da * (1 - sa)) / outA);
  canvas[i + 1] = Math.round((g * sa + canvas[i + 1] * da * (1 - sa)) / outA);
  canvas[i + 2] = Math.round((b * sa + canvas[i + 2] * da * (1 - sa)) / outA);
  canvas[i + 3] = Math.round(outA * 255);
}

/** 圆角矩形覆盖测试（归一化坐标系） */
function inRoundedRect(x, y, x0, y0, x1, y1, rad) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + rad, Math.min(x, x1 - rad));
  const cy = Math.max(y0 + rad, Math.min(y, y1 - rad));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

/** 菱形（四边形）覆盖测试 */
function inDiamond(x, y, cx, cy, hw, hh) {
  const dx = Math.abs(x - cx) / hw;
  const dy = Math.abs(y - cy) / hh;
  return dx + dy <= 1;
}

const S = (v) => (v / 256) * TOTAL; // 256 坐标系 → 画布坐标系

// 底：深绿圆角方（radius 46/256）
for (let y = 0; y < TOTAL; y += 1) {
  for (let x = 0; x < TOTAL; x += 1) {
    if (inRoundedRect(x, y, 0, 0, TOTAL - 1, TOTAL - 1, S(46))) {
      // 轻微纵向渐变增加质感
      const t = y / TOTAL;
      const r = Math.round(15 + t * 8);
      const g = Math.round(81 + t * 30);
      const b = Math.round(50 + t * 18);
      putPx(x, y, r, g, b, 255);
    }
  }
}

// 白色扑克牌（radius 14/256），带浅灰描边
const cardX0 = S(58), cardY0 = S(34), cardX1 = S(198), cardY1 = S(222), cardR = S(14);
for (let y = 0; y < TOTAL; y += 1) {
  for (let x = 0; x < TOTAL; x += 1) {
    if (inRoundedRect(x, y, cardX0, cardY0, cardX1, cardY1, cardR)) {
      putPx(x, y, 250, 250, 247, 255); // 牌面
    }
  }
}
// 描边：只画在牌边缘一圈（在底图之上重画深灰）
for (let y = 0; y < TOTAL; y += 1) {
  for (let x = 0; x < TOTAL; x += 1) {
    if (inRoundedRect(x, y, cardX0, cardY0, cardX1, cardY1, cardR)
      && !inRoundedRect(x, y, cardX0 + S(3), cardY0 + S(3), cardX1 - S(3), cardY1 - S(3), cardR)) {
      putPx(x, y, 120, 120, 120, 255);
    }
  }
}

// 红色方块 ♦
for (let y = 0; y < TOTAL; y += 1) {
  for (let x = 0; x < TOTAL; x += 1) {
    if (inDiamond(x, y, S(128), S(116), S(30), S(40))) {
      putPx(x, y, 211, 47, 47, 255);
    }
  }
}

// 两点式黑桃省略，用两个黑色圆点模拟「地主牌标记」
function dot(cx, cy, rad, r, g, b) {
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y += 1) {
    for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) putPx(x, y, r, g, b, 255);
    }
  }
}
dot(S(100), S(178), S(9), 33, 33, 33);
dot(S(156), S(178), S(9), 33, 33, 33);

// ---- 超采样下采样到 256 ----
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const i = ((y * SS + sy) * TOTAL + (x * SS + sx)) * 4;
        r += canvas[i];
        g += canvas[i + 1];
        b += canvas[i + 2];
        a += canvas[i + 3];
      }
    }
    const n = SS * SS;
    const o = (y * SIZE + x) * 4;
    out[o] = Math.round(r / n);
    out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n);
    out[o + 3] = Math.round(a / n);
  }
}

// ---- PNG 编码（filter 0 逐行） ----
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// ---- ICO 封装（PNG 内嵌条目，Vista+ 支持 256px） ----
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; // width 256 → 0
entry[1] = 0; // height 256 → 0
entry[2] = 0; // palette
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12); // data offset

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, entry, png]));
console.log(`图标已生成: ${OUT} (${png.length + 22} bytes)`);
