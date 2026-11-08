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

/** ESM 主进程没有 __dirname，用 import.meta.url 推导（打包后指向 out/，其上级即应用根目录） */
const __dirname: string = path.dirname(fileURLToPath(import.meta.url));

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

/** 主窗口引用（singleInstance 锁回调里聚焦用） */
let mainWindow: BrowserWindow | null = null;

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

  // 首帧就绪再显示，避免白屏闪烁
  win.once('ready-to-show', (): void => {
    win.show();
  });

  // 加载失败（如 server 意外退出）给出可见错误，而不是停在白屏
  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL): void => {
      dialog.showErrorBox(
        '页面加载失败',
        `无法加载 ${validatedURL}\n错误码 ${errorCode}：${errorDescription}\n\n请尝试重新启动程序。`,
      );
    },
  );

  // 外部链接一律走系统浏览器，桌面窗口内不允许开新窗
  win.webContents.setWindowOpenHandler(({ url: target }): { action: 'deny' } => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  win.on('closed', (): void => {
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
      dialog.showErrorBox(
        '启动失败',
        `内部服务在 ${PORT_WAIT_TIMEOUT_MS / 1000} 秒内未能就绪（基础端口 ${DESKTOP_BASE_PORT}）。\n请检查是否有安全软件拦截本机端口，或重启程序重试。`,
      );
      app.quit();
    }
  }, PORT_WAIT_TIMEOUT_MS);

  const server: ServerBundle = (await import(SERVER_BUNDLE_URL)) as ServerBundle;
  server.onPortBound((port: number): void => {
    clearTimeout(timeout);
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

    if (IS_DEV) {
      createWindow(DEV_WEB_URL);
    } else {
      startBundled().catch((err: unknown): void => {
        const detail: string = err instanceof Error ? err.message : String(err);
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
