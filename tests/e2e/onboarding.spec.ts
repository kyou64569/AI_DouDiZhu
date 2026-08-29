/**
 * E2E · 新手引导（建议清单 #14）：
 * 首次访问自动弹出 → 走完五步 → 刷新不再弹出；顶栏可手动重开。
 */

import { expect, test } from '@playwright/test';

test.describe('新手引导', () => {
  test('首次访问自动弹出，走完后不再出现，顶栏可重开', async ({ page }) => {
    await page.goto('/room');

    // 首次访问：引导自动弹出（欢迎语可见）
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('欢迎来到')).toBeVisible();

    // 逐步走到最后一步
    const next = dialog.getByRole('button', { name: '下一步' });
    await next.click(); // → 牌型图鉴
    await expect(dialog.getByText('斗地主共 13 种合法牌型')).toBeVisible();
    await expect(dialog.getByText('王炸', { exact: true })).toBeVisible();
    await next.click(); // → 叫分与地主
    await expect(dialog.getByText('开局先「叫地主」')).toBeVisible();
    await next.click(); // → 出牌操作
    await expect(dialog.getByText('轮到你出牌时')).toBeVisible();
    await next.click(); // → 快捷键
    await expect(dialog.getByText('Space')).toBeVisible();

    // 完成 → 关闭并标记已看过
    await dialog.getByRole('button', { name: '完成，开始游戏' }).click();
    await expect(dialog).toBeHidden();

    // 刷新后不再自动弹出
    await page.reload();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 顶栏手动入口可重开
    await page.getByRole('button', { name: '新手引导' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('欢迎来到')).toBeVisible();
  });

  test('引导中途可跳过，同样不再自动弹出', async ({ page }) => {
    await page.goto('/room');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '跳过' }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
