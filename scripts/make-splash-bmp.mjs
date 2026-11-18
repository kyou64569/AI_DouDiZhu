/**
 * 生成便携版解压期启动图 desktop/splash.bmp（24 位 BMP）。
 *
 * 背景：electron-builder 便携 exe 每次启动要先自解压（数秒），该阶段发生在
 * Electron 进程起来之前，应用内动画无法覆盖。NSIS 壳支持解压期显示一张静态
 * BMP（package.json 的 portable.splashImage），于是用 Electron 无头渲染
 * desktop/splash.html 的同款画面定格成 BMP，视觉上与解压后的动画无缝衔接：
 *   静态启动图（解压期，双击即现）→ 发牌动画 + 真实进度条（Electron 就绪后）→ 主窗口。
 *
 * 实现：BrowserWindow 加载 splash.html → 冻结动画定格「发牌完成 + 解压文案」→
 * capturePage 取 BGRA 原始像素 → 手写 24 位 BMP 封装（行序自底向上，行宽 4 字节对齐）。
 * 纯 Node + 既有 electron devDependency，不新增任何依赖。
 * 注意：本脚本是 .mjs 纯 JS（不经 tsc），不能写 TypeScript 注解。
 *
 * 重新生成：npm run make:splash-bmp（等价于 npx electron scripts/make-splash-bmp.mjs）。
 * 注意必须用 electron 跑，不能 `node` 跑——本脚本 import 的 electron 是运行时 API，
 * 裸 node 下拿到的是可执行文件路径字符串而不是 app/BrowserWindow。
 *
 * ⚠️ 改 desktop/splash.html（文案/配色/布局/牌面）后必须重跑本脚本：splash.bmp 是
 *    splash.html 的截图产物，不重跑就会让「解压期静态图」与「动画首帧」对不上，
 *    恰好破坏无缝衔接的设计目标，且不会有任何报错。desktop:build 会跑
 *    scripts/check-splash-bmp.mjs 做存在性/时效性/尺寸校验。
 *
 * ⚠️ DPI：capturePage 给的是物理像素，输出尺寸 = 窗口 DIP × 系统缩放比例。
 *    本机窗口 440x360，125% 缩放产出 552x453 —— 当前提交的 splash.bmp 就是这个尺寸。
 *    100% 缩放会产出 440x360（仍可用，只是显示略小）；超过 560x460 的产物会被
 *    check-splash-bmp 直接拦下，因为主窗口启动画面只有 560x460 DIP，盖不住会露边。
 *    换机器重跑前先确认显示缩放比例。
 */

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'desktop', 'splash.bmp');
const HTML = path.resolve(__dirname, '..', 'desktop', 'splash.html');

// capturePage 在部分机器的 GPU 合成器上抛 UnknownVizError；截图用软件渲染足够
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    // 10 秒硬超时：任何一步挂死都能退出进程而不是悬着
    setTimeout(() => {
      console.error('生成超时（10s），强制退出');
      app.exit(1);
    }, 10_000).unref();

    console.log('step1: 创建窗口');
    // show: true —— 隐藏窗口的 capturePage 在部分环境返回空白帧，一次性脚本短暂亮窗无妨
    const win = new BrowserWindow({
      width: 440,
      height: 360,
      useContentSize: true,
      show: true,
      frame: false,
      webPreferences: { backgroundThrottling: false },
    });
    console.log('step2: 加载页面');
    await win.loadFile(HTML);
    // 等发牌动画播完（三张牌 delay+duration ≈ 1.1s），否则抓到的是牌未落定的空帧
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.log('step3: 冻结动画并定格初始态');

    // 冻结动画并定格「初始态」：牌落定、进度 30%、解压文案；版本号留给运行期动画页展示
    await win.webContents.executeJavaScript(`
      // 页面在没有 IPC 桥时会走兜底 demo setInterval（约 1s 一次改进度条），
      // 冻结后若它再 tick 一次，截到的就是 demo 中间态文案。句柄在闭包里取不到，
      // 而 clearInterval 对无效 id 是 no-op，直接按小整数区间扫一遍即可。
      for (let id = 1; id < 4096; id += 1) { clearInterval(id); }
      const style = document.createElement('style');
      style.textContent = '*{animation:none!important;transition:none!important}';
      document.head.appendChild(style);
      document.getElementById('fill').style.width = '30%';
      document.getElementById('pct').textContent = '30%';
      document.getElementById('phase').textContent = '正在解压程序，请稍候…';
      document.getElementById('ver').textContent = '';
      undefined;
    `);
    console.log('step4: capturePage 取帧');
    const image = await win.webContents.capturePage();
    const { width, height } = image.getSize();
    const bgra = image.toBitmap(); // 物理像素，BGRA 顺序
    // 高 DPI 缩放（125%/150%）机器上 getSize() 与 toBitmap() 的物理像素口径可能不一致
    // （一个按 DIP 一个按物理像素），此时下面的逐像素拷贝会读到错位数据、安静产出花屏图。
    // 直接断言：宁可报错让人核对缩放比例，也不要写出坏图。
    if (width * height * 4 !== bgra.length) {
      throw new Error(
        `尺寸与位图数据不一致：${width}x${height} 期望 ${width * height * 4} 字节，` +
          `实际 ${bgra.length} 字节（高 DPI 下 getSize 与 toBitmap 口径不同），` +
          '请把显示器缩放临时调到 100% 后重跑本脚本',
      );
    }
    console.log(`step5: 取到 ${width}x${height} 帧，写 BMP`);

    // ---- 手写 24 位 BMP：行序自底向上，BGR 三字节，行宽按 4 字节对齐 ----
    const rowBytes = width * 3;
    const rowStride = (rowBytes + 3) & ~3;
    const pixelBytes = rowStride * height;
    const fileSize = 54 + pixelBytes;
    const bmp = Buffer.alloc(fileSize);
    bmp.write('BM', 0);
    bmp.writeUInt32LE(fileSize, 2);
    bmp.writeUInt32LE(54, 10); // 像素数据偏移（BITMAPFILEHEADER 14 + INFOHEADER 40）
    bmp.writeUInt32LE(40, 14); // BITMAPINFOHEADER
    bmp.writeUInt32LE(width, 18);
    bmp.writeInt32LE(height, 22); // 正值 = 自底向上行序
    bmp.writeUInt16LE(1, 26); // planes
    bmp.writeUInt16LE(24, 28); // bpp
    bmp.writeUInt32LE(0, 30); // BI_RGB 不压缩
    bmp.writeUInt32LE(pixelBytes, 34);
    for (let y = 0; y < height; y += 1) {
      const srcY = height - 1 - y;
      for (let x = 0; x < width; x += 1) {
        const si = (srcY * width + x) * 4;
        const di = 54 + y * rowStride + x * 3;
        // toBitmap 是 BGRA，BMP 每像素也是 BGR —— 三个通道按序直拷即可
        bmp[di] = bgra[si]; // B
        bmp[di + 1] = bgra[si + 1]; // G
        bmp[di + 2] = bgra[si + 2]; // R
      }
    }

    fs.writeFileSync(OUT, bmp);
    console.log(`启动图已生成: ${OUT} (${width}x${height}, ${fileSize} bytes)`);
    app.exit(0);
  } catch (err) {
    console.error('生成失败:', err);
    app.exit(1);
  }
});
