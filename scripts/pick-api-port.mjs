/**
 * 后端端口预探测脚本（端口占用自动跳转）。
 *
 * 在 dev 启动前运行：从 BASE(默认 8787) 起逐个探测可用端口，
 * 把结果写入项目根 `.apiport`（Vite 代理与 server 启动时读取，保证联动一致）。
 *
 * 用法：node scripts/pick-api-port.mjs
 * 退出码：0 = 探测成功（.apiport 已写入）；1 = 连续 20 个端口均被占用
 */
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = Number(process.env.PORT ?? 8787);
const FILE = resolve(process.cwd(), '.apiport');
const MAX_TRIES = 20;

/** 尝试监听端口，成功(空闲)立即释放并返回 true */
function tryListen(port) {
  return new Promise((done) => {
    const srv = createServer();
    srv.once('error', () => done(false));
    srv.once('listening', () => srv.close(() => done(true)));
    srv.listen(port, '127.0.0.1');
  });
}

for (let port = BASE; port < BASE + MAX_TRIES; port += 1) {
  if (await tryListen(port)) {
    writeFileSync(FILE, String(port), 'utf8');
    console.log(`[pick-api-port] 后端端口可用: ${port} → ${FILE}`);
    process.exit(0);
  }
  console.log(`[pick-api-port] 端口 ${port} 被占用，尝试下一个…`);
}

console.error(`[pick-api-port] ${MAX_TRIES} 个端口(${BASE}~${BASE + MAX_TRIES - 1})均被占用，请先释放端口`);
process.exit(1);
