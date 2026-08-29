/**
 * E2E 共享工具（建议清单 #17）。
 *
 * 关键策略：用 addInitScript 在页面脚本执行前写入 localStorage 种子数据——
 * AI 玩家绑定一个「不存在的配置 id」→ resolveBinding 返回 null → AI 走内置本地
 * 兜底策略（确定性、零延迟、不调用任何 LLM），让完整对局测试稳定且快速。
 */

import type { Page } from '@playwright/test';

/** 种子 AI 玩家（绑定不存在的配置 → 走本地策略） */
const SEED_PLAYERS: readonly unknown[] = [
  { id: 'ply-e2e-1', name: 'AI·甲', modelConfigId: 'cfg-not-exist', createdAt: 0, updatedAt: 0 },
  { id: 'ply-e2e-2', name: 'AI·乙', modelConfigId: 'cfg-not-exist', createdAt: 0, updatedAt: 0 },
];

/** 种子设置：已看过新手引导（避免引导弹窗挡住牌桌交互） */
const SEEN_SETTINGS: unknown = {
  humanTimeoutMs: 8000,
  spectateTimeoutMs: 20000,
  hasSeenTutorial: true,
};

/**
 * 在页面加载前写入种子数据。每个测试都有独立的浏览器上下文（localStorage 隔离），
 * 因此不会污染其他测试。
 */
export async function seedGameReady(page: Page): Promise<void> {
  const players: readonly unknown[] = SEED_PLAYERS;
  const settings: unknown = SEEN_SETTINGS;
  await page.addInitScript(
    ({ seedPlayers, seedSettings }) => {
      window.localStorage.setItem('dz.meta.version', '1');
      window.localStorage.setItem('dz.players', JSON.stringify(seedPlayers));
      window.localStorage.setItem('dz.settings', JSON.stringify(seedSettings));
    },
    { seedPlayers: players, seedSettings: settings },
  );
}

/** 等待某个条件出现（轮询，不抛错），超时返回 false。用于牌桌这种「状态驱动 UI」的流程控制。 */
export async function waitForPredicate(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 300,
): Promise<boolean> {
  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
