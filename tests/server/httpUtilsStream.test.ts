import { describe, it, expect } from 'vitest';
import { readStreamByLine } from '../../server/services/httpUtils';
import { ErrorCode } from '../../server/types';

/** 构造一个逐行延迟吐数据的 SSE 风格 Response（node:fetch 全局，Node 18+ 可用） */
function slowStreamResponse(lines: string[], delayMs: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const line of lines) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        controller.enqueue(encoder.encode(`${line}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('readStreamByLine 外部中止识别（客户端断连 ≠ 超时）', () => {
  it('流中途外部中止 → ProxyError(CLIENT_ABORTED)，而不是误报「空闲超时」', async () => {
    const controller = new AbortController();
    const lines = ['data: 1', 'data: 2', 'data: 3', 'data: 4'];
    const pending = readStreamByLine(
      slowStreamResponse(lines, 150),
      () => {},
      { overallMs: 60_000, idleTimeoutMs: 20_000, signal: controller.signal },
    );
    // 首块尚未到达时客户端断连（换局/取消的典型时序）
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({
      code: ErrorCode.CLIENT_ABORTED,
      message: expect.stringContaining('客户端已断开'),
    });
  });

  it('调用前信号已中止 → 直接 CLIENT_ABORTED（不会把预取消流当正常读完）', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readStreamByLine(slowStreamResponse([], 0), () => {}, {
        overallMs: 60_000,
        idleTimeoutMs: 20_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CLIENT_ABORTED });
  });

  it('无外部信号时的空闲超时仍归一化为 NETWORK_TIMEOUT（原行为不回归）', async () => {
    // 首块立即到达后无限停顿：空闲计时器（下限 1000ms）触发中止
    const encoder = new TextEncoder();
    const stalled = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: only\n'));
          // 有意不 close：模拟上游挂流
        },
      }),
      { status: 200 },
    );
    await expect(
      readStreamByLine(stalled, () => {}, { overallMs: 60_000, idleTimeoutMs: 1000 }),
    ).rejects.toMatchObject({
      code: ErrorCode.NETWORK_TIMEOUT,
      message: expect.stringContaining('空闲超时'),
    });
  });
});
