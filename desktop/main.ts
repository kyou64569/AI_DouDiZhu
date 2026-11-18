/**
 * Electron 桌面版主进程（仅桌面版使用，网页版流程完全不经过本文件）。
 *
 * 职责（与 server/index.ts 的薄代理思路一致）：
 * 1. 打包/生产模式：在主进程内启动打包进来的 Express（server.mjs，生产模式托管 dist/
 *    并提供 LLM/TTS 代理），拿到实际端口后打开桌面窗口加载 `http://localhost:{port}`；
 * 2. 开发模式（DESKTOP_DEV=1）：不动 server（由 `npm run dev` 的 tsx watch 负责），
 *    直接加载 Vite 页面，享受热更新。
 *
 * 明确不做：任何游戏逻辑、持久化、代理实现 —— 全部复用现有前端与 server 代码。
 *
 * 端口约定：桌面版基础端口 8790（网页版生产 8787 / dev 由 .apiport 联动），
 * 被占用时 server 内置逻辑自动 +1 跳号，实际端口通过 onPortBound 钩子回传。
 */

import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

/** ESM 主进程没有 __dirname，用 import.meta.url 推导（打包后指向 out/，其上级即应用根目录） */
const __dirname: string = path.dirname(fileURLToPath(import.meta.url));

/** 启动时间线打点：写 userData/boot-timeline.log（诊断双击 exe → 主窗口各阶段耗时；失败不影响启动） */
const BOOT_T0: number = Date.now();

/** boot-timeline.log 体积上限：超过即重建（只保留本次启动的时间线，防止长期使用无限增长） */
const BOOT_LOG_MAX_BYTES: number = 256 * 1024;

function bootLog(msg: string): void {
  const line: string = `[boot +${Date.now() - BOOT_T0}ms] ${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    const dir: string = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    const file: string = path.join(dir, 'boot-timeline.log');
    try {
      if (fs.statSync(file).size > BOOT_LOG_MAX_BYTES) {
        fs.writeFileSync(file, '');
      }
    } catch {
      /* 文件还不存在（首次启动），直接追加即可 */
    }
    fs.writeFileSync(file, `${line}\n`, { flag: 'a' });
  } catch {
    /* 写失败静默 */
  }
}

/** 开发模式：加载 Vite 页面而非进程内 server */
const IS_DEV: boolean = process.env.DESKTOP_DEV === '1';

/** 开发模式下 Vite 的默认端口（与 vite.config.ts 的 WEB_PORT 默认值一致） */
const DEV_WEB_URL: string = 'http://localhost:5174';

/** 桌面版基础端口（与网页版生产端口 8787 错开，二者可同时运行） */
const DESKTOP_BASE_PORT: number = 8790;

/**
 * server 打包产物（esbuild 生成到 out/server.mjs，源码树中不存在）。
 * 用变量而非字面量做动态导入：TypeScript 不会尝试解析构建产物，
 * esbuild 也因此把它保留为运行时导入而不是打进主进程包。
 */
const SERVER_BUNDLE_URL: string = './server.mjs';

/** out/server.mjs 暴露的接口（来自 server/index.ts 的 onPortBound 导出） */
interface ServerBundle {
  onPortBound: (listener: (port: number) => void) => void;
}

/** 等待 server 绑定端口的超时（毫秒），超时视为启动失败 */
const PORT_WAIT_TIMEOUT_MS: number = 20000;

/**
 * 主窗口从 loadURL 到 ready-to-show 的超时（毫秒）。
 * 页面既 ready 也不 fail（内嵌服务僵死不回包）时启动画面会永久停在 84%，
 * 超时后直接亮主窗口 —— 页面若随后加载完成会自然呈现，不至于把用户锁在启动画面上。
 */
const LOAD_READY_TIMEOUT_MS: number = 30000;

/** 主窗口引用（singleInstance 锁回调里聚焦用） */
let mainWindow: BrowserWindow | null = null;

/**
 * 启动画面窗口引用。双击 exe 到主窗口可显示之间有数秒空窗
 * （进程内启动 Express + 端口绑定 + 页面加载），用无边框启动窗播放
 * 斗地主发牌动画 + 进度条填补，主窗口就绪后无缝替换（避免白屏）。
 */
let splashWindow: BrowserWindow | null = null;

/**
 * 启动画面页面是否已完成加载。
 * webContents.send 在页面加载完成前发出的消息会被整条丢弃（渲染进程还没注册监听），
 * 而 36%（app ready）、52%（server bundle 导入完成）、68%（端口绑定）都可能早于
 * did-finish-load —— 不缓冲的话进度条会从初始 6% 直接跳到 84%，中间阶段形同虚设。
 */
let splashPageReady: boolean = false;

/** 页面就绪前最后一次进度（只保留最新，页面也只展示最新阶段），就绪后补发一次 */
let pendingSplashProgress: { percent: number; label: string } | null = null;

/** 启动画面资源路径（out/ 的上级即应用根目录，开发与打包后一致） */
const SPLASH_HTML: string = path.join(__dirname, '..', 'desktop', 'splash.html');
const SPLASH_PRELOAD: string = path.join(__dirname, '..', 'desktop', 'splash-preload.cjs');

/**
 * 隐藏解压壳可见窗口的 PowerShell 脚本（__PPID__ 由调用方替换）。
 * EnumWindows 枚举父进程的全部可见顶层窗口（即静态启动图）并 SW_HIDE。
 *
 * 施隐藏前按「进程名 / 可执行文件路径 / 主窗口标题」三者任一命中 AI斗地主 才执行：
 * 便携壳的进程名与路径都来自 exe 文件名，用户改名成 game.exe 后两者都不再匹配；
 * 但窗口标题由 NSIS 脚本的 `Name "${PRODUCT_NAME}"` 编译进壳里（productName 固定为
 * AI斗地主），改名不影响 —— 补上标题判定即可覆盖重命名这个便携版常见用法。
 * 命中不了就静默跳过：开发模式（父进程是 npm 链）、安装版（父进程是 explorer）、
 * 命令行启动（父进程是 cmd/powershell）都不会误藏。
 */
const HIDE_STUB_PS: string = `
$parent = Get-Process -Id __PPID__ -ErrorAction SilentlyContinue
$procName = ''
$procPath = ''
$procTitle = ''
try { $procName = $parent.ProcessName } catch {}
try { $procPath = $parent.Path } catch {}
try { $procTitle = $parent.MainWindowTitle } catch {}
if ($parent -and ($procName -like '*AI斗地主*' -or $procPath -like '*AI斗地主*' -or $procTitle -like '*AI斗地主*')) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class StubWin {
  private delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public static List<IntPtr> VisibleOf(uint targetPid) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { uint wpid; GetWindowThreadProcessId(h, out wpid); if (wpid == targetPid && IsWindowVisible(h)) { r.Add(h); } return true; }, IntPtr.Zero);
    return r;
  }
}
'@
  [StubWin]::VisibleOf($parent.Id) | ForEach-Object { [StubWin]::ShowWindow($_, 0) | Out-Null }
}`;

/** 创建启动画面窗口（alwaysOnTop + skipTaskbar：纯过渡层，不占任务栏） */
function createSplash(): void {
  const splash: BrowserWindow = new BrowserWindow({
    // 560x460 DIP：100% 缩放下物理像素就是 560x460，125%/150% 下更大，所以
    // 无论系统 DPI 缩放都能完全盖住 552x453 的静态启动图（NSIS 壳按像素 1:1 显示 BMP）。
    // 页面内容 flex 居中，多余区域是同色渐变背景，不会露出边框。
    width: 560,
    height: 460,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0b3d2a',
    title: 'AI 斗地主',
    webPreferences: {
      // splash.html 无任何 Node 需求，preload 仅桥接进度事件（contextIsolation 保持开启）
      preload: SPLASH_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow = splash;
  splash.webContents.on('did-finish-load', (): void => {
    bootLog('启动画面页面加载完成');
    // 页面内联脚本到此刻才注册好 ipcRenderer.on：把加载期间攒下的进度补发一次
    splashPageReady = true;
    const pending: { percent: number; label: string } | null = pendingSplashProgress;
    pendingSplashProgress = null;
    if (pending !== null && !splash.isDestroyed()) {
      splash.webContents.send('splash:progress', pending);
    }
  });
  splash.webContents.on(
    'did-fail-load',
    (_e, code, desc): void => bootLog(`启动画面页面加载失败 code=${code} desc=${desc}`),
  );
  // 版本号经 query 传入，页面右下角展示
  void splash
    .loadFile(SPLASH_HTML, { query: { v: app.getVersion() } })
    .then((): void => bootLog('启动画面 loadFile 成功'))
    .catch((err: unknown): void => bootLog(`启动画面 loadFile 异常：${String(err)}`));
}

/** 向启动画面推送阶段进度（页面未就绪则缓存，就绪后补发；窗口已销毁时静默跳过） */
function setSplashProgress(percent: number, label: string): void {
  if (splashWindow === null || splashWindow.isDestroyed()) {
    return;
  }
  if (!splashPageReady) {
    pendingSplashProgress = { percent, label };
    return;
  }
  splashWindow.webContents.send('splash:progress', { percent, label });
}

/** 关闭启动画面（主窗口就绪或启动失败兜底时调用） */
function closeSplash(): void {
  splashPageReady = false;
  pendingSplashProgress = null;
  if (splashWindow !== null && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

/**
 * 隐藏解压壳的静态图窗口（便携版专属）。
 *
 * 模板补丁让解压图窗口存活到应用退出以消除 Electron 启动空窗；但主窗口接管后
 * 它藏在游戏窗口后面，游戏最小化时会露出。此处按「父进程 pid + 确认为解压壳」
 * 核验后，用系统自带 PowerShell 隐藏壳的全部可见顶层窗口——只藏不杀，壳进程
 * 照常存活并在应用退出后自清理临时目录。
 * 「确认为解压壳」= 进程名 / exe 路径 / 主窗口标题三者任一含 AI斗地主（见 HIDE_STUB_PS）。
 * 不匹配即静默跳过：开发模式（父进程是 npm 链）、安装版（父进程是 explorer）、
 * 命令行启动（父进程是 cmd）都不会误藏；隐藏失败则退化为图片藏于游戏窗口后。
 */
function hideParentStubWindow(): void {
  if (IS_DEV) return;
  const ppid: number = process.ppid;
  if (!ppid || ppid <= 0) return;
  const command: string = HIDE_STUB_PS.replace('__PPID__', String(ppid));
  const child = execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { timeout: 15_000 },
    (): void => {}, // 结果无关紧要：失败退化为已知瑕疵
  );
  child.on('error', (): void => {}); // 系统无 powershell 等极端情况，静默
}

/**
 * 创建主窗口并加载指定 URL。
 * 窗口标题最终由页面 <title>（AI 斗地主）接管，这里的 title 只是加载前的占位。
 */
function createWindow(url: string): void {
  const iconPath: string = path.join(__dirname, '..', 'desktop', 'icon.ico');
  const win: BrowserWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'AI 斗地主',
    backgroundColor: '#0f5132',
    show: false,
    // 打包后 exe 自带图标，任务栏图标跟随进程；这里仅开发模式（electron .）需要
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      // 安全默认：渲染进程不接触 Node 能力，页面与主进程隔离
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;

  /** 交接只做一次：ready-to-show、加载失败、看门狗超时三条路径互斥 */
  let handedOver: boolean = false;

  setSplashProgress(84, '正在加载界面资源…');

  // 看门狗：页面迟迟不 ready-to-show 时不把用户锁在启动画面里
  const loadWatchdog: NodeJS.Timeout = setTimeout((): void => {
    if (handedOver || win.isDestroyed()) return;
    handedOver = true;
    bootLog(`主窗口 ${LOAD_READY_TIMEOUT_MS / 1000}s 内未 ready-to-show，超时兜底直接显示`);
    closeSplash();
    win.show();
    hideParentStubWindow();
  }, LOAD_READY_TIMEOUT_MS);

  // 首帧就绪再显示，避免白屏闪烁；进度条走满后关启动画面、亮主窗口
  win.once('ready-to-show', (): void => {
    if (handedOver || win.isDestroyed()) return;
    handedOver = true;
    clearTimeout(loadWatchdog);
    bootLog('主窗口 ready-to-show，交接');
    setSplashProgress(100, '启动完成');
    // 略作停留让进度条动画收尾，再无缝交接给主窗口
    setTimeout((): void => {
      // 这 280ms 内窗口被销毁（进程被外部终止等极端场景）时 win.show() 会抛
      // "Object has been destroyed"，先清掉启动画面再收工
      if (win.isDestroyed()) {
        closeSplash();
        return;
      }
      closeSplash();
      win.show();
      // 主窗口已盖住一切：此时隐藏解压壳的静态图窗口，避免游戏最小化时露出
      hideParentStubWindow();
    }, 280);
  });

  // 加载失败（如 server 意外退出）给出可见错误，而不是停在白屏
  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame): void => {
      // 只认主框架；-3（ERR_ABORTED）是导航被取消/窗口关闭的常规噪音，不是真失败
      if (!isMainFrame || errorCode === -3 || handedOver) return;
      handedOver = true;
      clearTimeout(loadWatchdog);
      closeSplash();
      dialog.showErrorBox(
        '页面加载失败',
        `无法加载 ${validatedURL}\n错误码 ${errorCode}：${errorDescription}\n\n点击「确定」后程序将退出，请重新启动。`,
      );
      // 主窗口以 show:false 创建，加载失败后永远不会触发 ready-to-show；
      // 不主动退出的话，用户关掉错误框就只剩一个无窗口的僵尸进程
      // （窗口对象还活着，window-all-closed 也不会触发）。
      app.quit();
    },
  );

  // 外部链接一律走系统浏览器，桌面窗口内不允许开新窗
  win.webContents.setWindowOpenHandler(({ url: target }): { action: 'deny' } => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  win.on('closed', (): void => {
    clearTimeout(loadWatchdog);
    mainWindow = null;
  });

  void win.loadURL(url);
}

/** 聚焦已存在的主窗口（第二实例启动时调用） */
function focusMainWindow(): void {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
}

/**
 * 生产/打包模式启动：进程内启动 server.mjs，端口绑定成功后开窗。
 * server 与窗口同进程生命周期 —— 窗口全关即 app.quit，进程退出时 server 一并结束。
 */
async function startBundled(): Promise<void> {
  // server/index.ts 按 NODE_ENV 决定是否托管 dist/，桌面打包模式固定为 production
  process.env.NODE_ENV = 'production';
  // 桌面版基础端口 8790；被占用时 server 自动 +1 跳号
  process.env.PORT = String(DESKTOP_BASE_PORT);
  // server 生产模式的 CORS 白名单默认只含 8787 系；桌面版页面源是 8790 系（含跳号余地），
  // 通过环境变量只扩展本进程白名单，server 代码与网页版行为不变
  const origins: string[] = [];
  for (let p: number = DESKTOP_BASE_PORT; p < DESKTOP_BASE_PORT + 20; p += 1) {
    origins.push(`http://localhost:${p}`, `http://127.0.0.1:${p}`);
  }
  process.env.ALLOWED_ORIGINS = origins.join(',');

  // 超时兜底：server 绑定失败（如端口段被防火墙策略锁死）时给出可见错误
  const timeout: NodeJS.Timeout = setTimeout((): void => {
    if (mainWindow === null) {
      closeSplash();
      dialog.showErrorBox(
        '启动失败',
        `内部服务在 ${PORT_WAIT_TIMEOUT_MS / 1000} 秒内未能就绪（基础端口 ${DESKTOP_BASE_PORT}）。\n请检查是否有安全软件拦截本机端口，或重启程序重试。`,
      );
      app.quit();
    }
  }, PORT_WAIT_TIMEOUT_MS);

  const server: ServerBundle = (await import(SERVER_BUNDLE_URL)) as ServerBundle;
  bootLog('server bundle 动态导入完成');
  setSplashProgress(52, '正在启动内嵌服务…');
  server.onPortBound((port: number): void => {
    clearTimeout(timeout);
    bootLog(`端口绑定完成 port=${port}`);
    setSplashProgress(68, '正在连接对局服务…');
    createWindow(`http://localhost:${port}`);
  });
}

// ---------- 应用生命周期 ----------

// 单实例锁：重复双击 exe 时聚焦已开窗口，而不是再起一套内部服务
const gotSingleInstanceLock: boolean = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  app.whenReady().then((): void => {
    // 游戏含音效，放开自动播放限制（点击触发本就允许，这里覆盖边缘场景）
    app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

    // 生产模式去掉默认菜单（File/Edit/View），桌面程序观感；开发模式保留菜单便于调试
    if (!IS_DEV) {
      Menu.setApplicationMenu(null);
    }

    // 启动画面先行：填补「双击 exe → 主窗口可显示」之间的数秒空窗
    bootLog('app ready，创建启动画面');
    createSplash();
    // 首档 36%：与解压期静态启动图的 30% 衔接（视觉上进度不倒退）
    setSplashProgress(36, '正在启动内嵌服务…');

    if (IS_DEV) {
      setSplashProgress(40, '正在等待开发服务器…');
      createWindow(DEV_WEB_URL);
    } else {
      startBundled().catch((err: unknown): void => {
        const detail: string = err instanceof Error ? err.message : String(err);
        closeSplash();
        dialog.showErrorBox('启动失败', `内部服务未能启动：${detail}\n请重启程序重试。`);
        app.quit();
      });
    }
  });

  // 所有窗口关闭即退出（Windows 单平台约定，无 macOS 常驻需求）
  app.on('window-all-closed', (): void => {
    app.quit();
  });
}
