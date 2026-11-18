/**
 * 启动画面 preload（仅 desktop/splash.html 使用）。
 *
 * 以 CommonJS 编写（Electron preload 要求 CJS），职责单一：
 * 把主进程的进度事件经 contextBridge 安全暴露给启动页，
 * 不开放任何 Node 能力（contextIsolation 保持开启）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('doudizhuSplash', {
  /**
   * 订阅启动进度。
   * @param {(payload: { percent: number, label?: string }) => void} callback
   */
  onProgress(callback) {
    ipcRenderer.on('splash:progress', (_event, payload) => {
      callback(payload);
    });
  },
});
