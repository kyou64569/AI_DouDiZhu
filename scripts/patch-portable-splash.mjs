/**
 * 给 electron-builder 的便携版 NSIS 模板打补丁（幂等，构建链自动执行）。
 *
 * 背景：便携 exe 的解压期静态启动图（portable.splashImage）窗口，被模板里
 * `BgImage::Destroy` 一行在解压完成后立刻销毁——而 Electron 主进程还要过几秒才
 * 能出现首帧（Chromium 启动 + 杀毒扫描），这段就是用户看到的「空白」。
 * 注释掉该行后，图片窗口存活到应用退出（随壳进程一起消失），视觉上与
 * Electron 启动画面无缝衔接：静态图（解压期）→ 动画+进度条 → 主窗口，全程无空窗。
 *
 * 为什么放仓库里：补丁打在 node_modules 模板上，npm install 会重置，
 * 所以 desktop:build 链在 electron-builder 之前自动重跑本脚本；幂等可重复执行。
 * 代价：游戏运行期间图片窗口一直存在，藏在游戏窗口后面（最小化游戏时会露出）。
 *
 * 运行：node scripts/patch-portable-splash.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(
  __dirname,
  '..',
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'portable.nsi',
);
const TARGET = 'BgImage::Destroy';
const MARK = '# [patched-by-ai-doudizhu]';

if (!fs.existsSync(TEMPLATE)) {
  // electron-builder 未安装（如全新 CI 环境先装依赖）：跳过不拦构建
  console.warn(`[patch-portable-splash] 未找到 ${TEMPLATE}（electron-builder 未安装？），跳过`);
  process.exit(0);
}

const src = fs.readFileSync(TEMPLATE, 'utf8');

if (src.includes(`${MARK} ${TARGET}`)) {
  console.log('[patch-portable-splash] 模板已打过补丁，跳过');
  process.exit(0);
}

const occurrences = src.split(TARGET).length - 1;
if (occurrences !== 1) {
  // 模板结构随 electron-builder 升级变化时宁可报错让人核对，不静默放过
  console.error(
    `[patch-portable-splash] 模板中 "${TARGET}" 出现 ${occurrences} 次（预期 1 次），` +
      `electron-builder 可能已升级改版，请人工核对 ${TEMPLATE} 后调整本脚本`,
  );
  process.exit(1);
}

const patched = src.replace(
  TARGET,
  `${MARK} ${TARGET} —— 保留解压图窗口直至应用退出，消除 Electron 启动空窗`,
);
fs.writeFileSync(TEMPLATE, patched);
console.log(`[patch-portable-splash] 已打补丁: ${TEMPLATE}`);
