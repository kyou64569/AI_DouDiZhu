/**
 * 打包前校验解压期静态启动图 desktop/splash.bmp（24 位 BMP，供 NSIS 便携壳使用）。
 *
 * 为什么需要：splash.bmp 是 desktop/splash.html 的截图产物（scripts/make-splash-bmp.mjs），
 * 不在任何自动生成链里。它既是 electron-builder `portable.splashImage` 的必需输入
 * （缺失会让打包直接失败），又必须随 splash.html 一起更新（否则静态图与动画首帧不一致，
 * 破坏「静态图 → 动画无缝衔接」的设计目标，而且不会有任何报错）。
 *
 * 检查项：
 * 1. 文件存在且是合法 BMP 头（缺失/损坏 → 退出码 1，拦构建并给出修复命令）；
 * 2. splash.html 比 splash.bmp 新 → 仅警告（git 新 clone 的 mtime 不可靠，不能据此拦构建）。
 *
 * 运行：node scripts/check-splash-bmp.mjs（desktop:build 链自动执行）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BMP = path.resolve(__dirname, '..', 'desktop', 'splash.bmp');
const HTML = path.resolve(__dirname, '..', 'desktop', 'splash.html');
const REGEN = 'npx electron scripts/make-splash-bmp.mjs';

function fail(msg) {
  console.error(`[check-splash-bmp] ✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(BMP)) {
  fail(
    `缺少 ${BMP}\n` +
      `  它是便携版解压期启动图，electron-builder 的 portable.splashImage 必需。\n` +
      `  生成：${REGEN}\n` +
      `  若是刚 clone 的仓库：确认该二进制文件已提交（git add desktop/splash.bmp）。`,
  );
}

const buf = fs.readFileSync(BMP);
if (buf.length < 54 || buf.toString('ascii', 0, 2) !== 'BM') {
  fail(`${BMP} 不是合法 BMP（长度 ${buf.length} 或文件头标记异常），请重新生成：${REGEN}`);
}
const bmpWidth = buf.readUInt32LE(18);
const bmpHeight = buf.readInt32LE(22);
const bpp = buf.readUInt16LE(28);
if (bpp !== 24 || bmpWidth <= 0 || bmpHeight === 0) {
  fail(`${BMP} 参数异常（${bmpWidth}x${Math.abs(bmpHeight)} @ ${bpp}bpp），NSIS 需要 24 位未压缩 BMP，请重新生成：${REGEN}`);
}

// 光看 bpp 不够：BI_RLE 压缩、或带调色板的 24bpp BMP 都能通过上面的检查，
// 却会让 NSIS 壳显示异常。本脚本自产自销（偏移固定 54、BI_RGB），断言一下更省心。
const dataOffset = buf.readUInt32LE(10);
const compression = buf.readUInt32LE(30);
if (dataOffset !== 54 || compression !== 0) {
  fail(
    `${BMP} 不是裸 24 位 BMP（像素数据偏移 ${dataOffset}，压缩方式 ${compression}；需要 54 / BI_RGB=0），` +
      `NSIS 壳可能显示异常，请重新生成：${REGEN}`,
  );
}

// 尺寸上限：启动画面窗口是 560x460 DIP，NSIS 壳按像素 1:1 贴这张图，
// 图片更大时动画窗口盖不住它，交接瞬间会露出边。
// 下限不设：更小的图只是显示不铺满，不会错位。
const SPLASH_MAX_W = 560;
const SPLASH_MAX_H = 460;
if (bmpWidth > SPLASH_MAX_W || Math.abs(bmpHeight) > SPLASH_MAX_H) {
  fail(
    `${BMP} 尺寸 ${bmpWidth}x${Math.abs(bmpHeight)} 超过启动窗上限 ${SPLASH_MAX_W}x${SPLASH_MAX_H}，` +
      `动画窗会盖不住静态图、交接时露边。请在显示缩放 100% 的机器上重新生成：${REGEN}`,
  );
}

// 时效性：只在 splash.html 明显更新时提醒（2s 容差避开 checkout 顺序造成的同秒抖动）
try {
  const htmlTime = fs.statSync(HTML).mtimeMs;
  const bmpTime = fs.statSync(BMP).mtimeMs;
  if (htmlTime - bmpTime > 2000) {
    console.warn(
      `[check-splash-bmp] ⚠ splash.html 比 splash.bmp 新，静态启动图可能已过期：\n` +
        `  重新生成：${REGEN}`,
    );
  }
} catch {
  /* 拿不到 mtime 就不提醒 */
}

console.log(
  `[check-splash-bmp] ✓ ${path.basename(BMP)} ${bmpWidth}x${Math.abs(bmpHeight)} @24bpp，${buf.length} bytes`,
);
