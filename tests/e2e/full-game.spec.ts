/**
 * E2E · 完整对局流程（建议清单 #17）：
 * 创建房间 → 叫分 → 出牌 → 结算。
 *
 * 稳定性关键：种子 AI 玩家未绑定可用模型 → AI 走内置本地兜底策略，
 * 出牌确定性、零网络依赖；人类侧用「提示 → 出牌/过牌」的最短操作路径推进，
 * 直至结算弹窗出现。
 */

import { expect, test, type Page } from '@playwright/test';
import { seedGameReady } from './helpers';

/** 人类回合动作：提示 → 出牌；无牌可压时过牌。返回是否实际执行了动作。 */
async function actAsHuman(page: Page): Promise<boolean> {
  const playBtn = page.getByRole('button', { name: /^出牌/ });
  // ActionBar 仅在人类出牌回合渲染；不可见说明不是人类回合（或已结算）
  if (!(await playBtn.isVisible().catch(() => false))) {
    return false;
  }
  await page.getByRole('button', { name: /^提示/ }).click();
  // 提示会选中一手合法牌 → 出牌可用；无牌可压时提示无效 → 过牌
  await page.waitForTimeout(120);
  if (await playBtn.isEnabled().catch(() => false)) {
    await playBtn.click();
  } else {
    await page.getByRole('button', { name: /^过牌/ }).click();
  }
  return true;
}

/** 处理叫分：轮到人类时优先抢 3 分当地主（人类先出，流程最确定）；只能不叫时不叫。 */
async function handleBidding(page: Page): Promise<void> {
  const bidThree = page.getByRole('button', { name: '叫 3 分' });
  const passBid = page.getByRole('button', { name: '不叫' });
  await expect
    .poll(
      async () =>
        (await bidThree.isVisible().catch(() => false)) || (await passBid.isVisible().catch(() => false)),
      { timeout: 15000, intervals: [250] },
    )
    .toBe(true);
  if (await bidThree.isVisible().catch(() => false)) {
    await bidThree.click();
  } else {
    await passBid.click();
  }
}

test('完整对局：创建房间 → 叫分 → 出牌 → 结算弹窗', async ({ page }) => {
  await seedGameReady(page);
  await page.goto('/room');

  // 房间页：把两个种子 AI 分配到座位 2 / 3（绑定不存在的配置 → 对局中走本地策略）
  await page.getByLabel('座位 2 的 AI 玩家').selectOption('ply-e2e-1');
  await page.getByLabel('座位 3 的 AI 玩家').selectOption('ply-e2e-2');
  await expect(page.getByText('已就位 2 / 2')).toBeVisible();
  await page.getByRole('button', { name: '开始游戏' }).click();
  await expect(page).toHaveURL(/\/table$/);

  // 发牌完成：人类手牌 17 张（农民）或 20 张（地主含底牌）
  await expect(page.getByText(/剩 (17|20) 张/).first()).toBeVisible({ timeout: 15000 });

  // 叫分阶段
  await handleBidding(page);

  // 出牌阶段：循环推进直至结算（整体限时防死循环）
  const deadline: number = Date.now() + 170_000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error('对局未在时限内结束（疑似推进死锁）');
    }
    if (await page.getByText('对局结算').isVisible().catch(() => false)) {
      break;
    }
    const acted: boolean = await actAsHuman(page);
    if (!acted) {
      await page.waitForTimeout(300);
    }
  }

  // 结算弹窗：胜负横幅 + 再来一局入口
  await expect(page.getByText('对局结算')).toBeVisible();
  await expect(page.getByText(/地主获胜|农民获胜/)).toBeVisible();
  await expect(page.getByRole('button', { name: '再来一局' })).toBeVisible();
});
