/**
 * Node 代理入口。
 *
 * 只承担两个职责（DESIGN §1.2）：
 * 1. LLM 请求透传代理 —— 绕开浏览器 CORS；
 * 2. 生产环境静态托管 dist/ 并做 SPA fallback。
 *
 * 明确不做：游戏逻辑、持久化、密钥存储、用户认证、提示词构造。
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import llmRouter from './routes/llm.js';
import ttsRouter from './routes/tts.js';
import { ErrorCode, type ApiResponse } from './types.js';
import { isPrivateUpstreamAllowed } from './services/httpUtils.js';
import { logger } from './utils/logger.js';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);

/** 项目根目录（server/ 的上一级） */
const PROJECT_ROOT: string = path.resolve(__dirname, '..');

/** 前端构建产物目录 */
const DIST_DIR: string = path.join(PROJECT_ROOT, 'dist');

/** 端口联动文件（scripts/pick-api-port.mjs 在 dev 启动前写入） */
const API_PORT_FILE: string = path.join(PROJECT_ROOT, '.apiport');

/** 基础端口（可用 PORT 环境变量覆盖） */
const BASE_PORT: number = Number(process.env.PORT ?? 8787);

/** 端口被占用时自动跳转的最大尝试次数 */
const PORT_MAX_TRIES: number = 20;

/** 是否生产模式 */
const IS_PRODUCTION: boolean = process.env.NODE_ENV === 'production';

/** 解析实际监听端口：dev 优先读取 .apiport（若存在且有效），否则从 BASE_PORT 开始自动探测 */
function resolvePort(): number {
  if (!IS_PRODUCTION) {
    try {
      const p: number = Number(fs.readFileSync(API_PORT_FILE, 'utf8').trim());
      if (Number.isInteger(p) && p > 0 && p < 65536) {
        return p;
      }
    } catch {
      /* 文件缺失或无效 → 从 BASE_PORT 开始探测 */
    }
  }
  return BASE_PORT;
}

/** dev 模式下把当前实际端口写回联动文件，保持 Vite 代理一致 */
function syncPortFile(port: number): void {
  if (IS_PRODUCTION) return;
  try {
    fs.writeFileSync(API_PORT_FILE, String(port), 'utf8');
  } catch {
    /* 写失败不影响服务，仅代理可能指向旧端口 */
  }
}

const MODULE: string = 'server';

const app: Express = express();

// ---------- 中间件 ----------

// P1 CORS：本地单机工具默认仅允许同源/localhost，生产更严格；通过 ALLOWED_ORIGINS 环境变量可扩展
const ALLOWED_ORIGINS: string[] = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
if (ALLOWED_ORIGINS.length === 0) {
  ALLOWED_ORIGINS.push(
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:8787',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:8787',
  );
}
app.use(
  cors({
    origin: (origin, callback): void => {
      // 同源请求（无 origin，如 curl、同源 fetch）一律放行；否则检查白名单
      if (!origin) {
        callback(null, true);
        return;
      }
      const allowed: boolean = ALLOWED_ORIGINS.includes(origin);
      if (allowed || !IS_PRODUCTION) {
        // 本地单机场景：未命中白名单也放行但记录 warn，便于局域网调试不中断；公网部署时应收紧为拒绝
        if (!allowed) {
          logger.warn(MODULE, `CORS：来源 ${origin} 不在白名单，已按非生产模式放行`);
        }
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: false,
  }),
);

// P2 安全头（轻量 helmet 替代，无需新增依赖）
app.use((_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

// LLM 提示词可能较长，放宽 body 上限
app.use(express.json({ limit: '4mb' }));

// 访问日志（不打印请求体，避免密钥泄漏）
app.use((req: Request, _res: Response, next: NextFunction): void => {
  if (req.path.startsWith('/api')) {
    logger.debug(MODULE, '收到请求', { method: req.method, path: req.path });
  }
  next();
});

// ---------- 路由 ----------

/** 健康检查 */
app.get('/api/health', (_req: Request, res: Response): void => {
  const body: ApiResponse<{ status: string; mode: string; time: number }> = {
    code: ErrorCode.OK,
    data: { status: 'ok', mode: IS_PRODUCTION ? 'production' : 'development', time: Date.now() },
    message: 'ok',
  };
  res.status(200).json(body);
});

app.use('/api/llm', llmRouter);
app.use('/api/tts', ttsRouter);

/** 未匹配的 /api 路径统一返回结构化 404 */
app.use('/api', (req: Request, res: Response): void => {
  const body: ApiResponse<null> = {
    code: ErrorCode.UPSTREAM_NOT_FOUND,
    data: null,
    message: `接口不存在：${req.method} ${req.path}`,
  };
  res.status(404).json(body);
});

// ---------- 生产环境静态托管 ----------

if (IS_PRODUCTION) {
  if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));

    // SPA fallback：任意非 /api 路径都返回 index.html，刷新子路由不 404
    app.get('*', (_req: Request, res: Response): void => {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });

    logger.info(MODULE, '静态托管已启用', { dir: DIST_DIR });
  } else {
    logger.warn(MODULE, 'dist 目录不存在，静态托管未启用，请先执行 npm run build', { dir: DIST_DIR });

    app.get('*', (_req: Request, res: Response): void => {
      res
        .status(503)
        .type('text/plain; charset=utf-8')
        .send('前端产物尚未构建。请先运行：npm run build');
    });
  }
}

// ---------- 全局错误兜底 ----------
 // P2 不向客户端泄露内部 detail，detail 仅写入日志

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  const detail: string = err instanceof Error ? err.message : String(err);
  logger.error(MODULE, '未捕获的中间件异常', { msg: detail });
  const body: ApiResponse<null> = {
    code: ErrorCode.UNKNOWN,
    data: null,
    message: '服务内部错误，请稍后重试',
  };
  res.status(500).json(body);
});

// 进程级兜底：unhandledRejection 仅日志；uncaughtException 日志后延迟退出由进程管理器重启（P3）
process.on('unhandledRejection', (reason: unknown): void => {
  const detail: string = reason instanceof Error ? reason.message : String(reason);
  logger.error(MODULE, '未处理的 Promise 拒绝', { msg: detail });
});

process.on('uncaughtException', (err: Error): void => {
  logger.error(MODULE, '未捕获的异常', { msg: err.message, stack: err.stack });
  setTimeout(() => process.exit(1), 1000);
});

// P3 优雅关闭：等待在途请求完成（10s 超时强制退出），并清理 .apiport
let httpServer: ReturnType<typeof app.listen> | null = null;
function gracefulShutdown(signal: string): void {
  logger.info(MODULE, `收到 ${signal}，开始优雅关闭...`);
  if (httpServer) {
    httpServer.close(() => {
      if (!IS_PRODUCTION) {
        try { fs.unlinkSync(API_PORT_FILE); } catch { /* ignore */ }
      }
      logger.info(MODULE, '服务已关闭');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  } else {
    process.exit(0);
  }
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ---------- 启动 ----------

/**
 * 启动 HTTP 服务。端口被占用（EADDRINUSE）时自动 +1 跳转到下一端口
 * （dev 模式成功绑定后才写回 .apiport 供 Vite 代理联动），最多重试 PORT_MAX_TRIES 次。
 */
function startServer(initialPort: number): void {
  let currentPort = initialPort;
  let attemptsLeft = PORT_MAX_TRIES;

  const tryBind = (): void => {
    const server = app.listen(currentPort, (): void => {
      httpServer = server;
      // 成功绑定后才写入 .apiport，避免 TOCTOU 问题
      syncPortFile(currentPort);
      logger.info(MODULE, 'Node 代理已启动', {
        port: currentPort,
        mode: IS_PRODUCTION ? 'production' : 'development',
        url: `http://localhost:${currentPort}`,
      });
      if (isPrivateUpstreamAllowed()) {
        logger.warn(MODULE, 'ALLOW_PRIVATE_UPSTREAM 已开启：允许 baseUrl 指向内网/私有地址（含局域网模型），请确认当前网络环境可信');
      }
      if (!IS_PRODUCTION) {
        logger.info(MODULE, '开发模式：前端请访问 Vite 服务', { url: 'http://localhost:5173' });
      }
    });

    server.on('error', (err: NodeJS.ErrnoException): void => {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        const next: number = currentPort + 1;
        logger.warn(MODULE, `端口 ${currentPort} 被占用，自动跳转 ${next}`, { msg: err.message });
        currentPort = next;
        attemptsLeft -= 1;
        tryBind();
        return;
      }
      // 所有尝试失败，清理 .apiport 文件并退出
      logger.error(MODULE, 'HTTP 服务启动失败', { msg: err.message });
      if (!IS_PRODUCTION) {
        try {
          fs.unlinkSync(API_PORT_FILE);
        } catch {
          /* 删除失败不影响退出 */
        }
      }
      process.exit(1);
    });
  };

  tryBind();
}

startServer(resolvePort());

export default app;
