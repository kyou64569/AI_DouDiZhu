/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 后端 API 端口（端口占用自动跳转联动）。
 * 优先读取 server 启动后写入的 `.apiport`（成功绑定后才写入），
 * 读取失败回落 `PORT ?? 8787`，保证 Vite 代理与 server 实际监听端口一致。
 */
function resolveApiPort(): number {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '.apiport'), 'utf8');
    const p = Number(raw.trim());
    if (Number.isInteger(p) && p > 0 && p < 65536) return p;
  } catch {
    /* 文件不存在（单独跑 dev:web 等）→ 回落默认 */
  }
  return Number(process.env.PORT ?? 8787);
}

const API_PORT: number = resolveApiPort();

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // 开发期把 /api 反代到 Node 代理，绕开浏览器 CORS
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/engine/**', 'src/ai/**'],
    },
  },
});
