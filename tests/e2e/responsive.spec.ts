/**
 * E2E · 响应式断点（建议清单 #17 / DESIGN §8.8）：
 * <768px 汉堡菜单 + 展开导航；≥768px 导航内联、汉堡隐藏。
 */

import { expect, test } from '@playwright/test';

/** 首次访问会有引导弹窗，先关掉 */
async function dismissOnboarding(page: import('@playwright/test').Page): Promise<void> {
  const skip = page.getByRole('dialog').getByRole('button', { name: '跳过' });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

test('移动端（375px）：汉堡菜单出现，展开后可见导航项', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/room');
  await dismissOnboarding(page);

  const burger = page.getByRole('button', { name: '展开菜单' });
  await expect(burger).toBeVisible();

  await burger.click();
  const mobileNav = page.getByRole('navigation', { name: '移动端导航' });
  await expect(mobileNav).toBeVisible();
  await expect(mobileNav.getByRole('link', { name: '创建房间' })).toBeVisible();
  await expect(mobileNav.getByRole('button', { name: '新手引导' })).toBeVisible();

  // 再次点击收起
  await page.getByRole('button', { name: '收起菜单' }).click();
  await expect(mobileNav).toBeHidden();
});

test('桌面端（1280px）：导航内联展示，汉堡隐藏', async ({ page }) => {
  await page.goto('/room');
  await dismissOnboarding(page);

  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '创建房间' })).toBeVisible();
  await expect(page.getByRole('button', { name: '展开菜单' })).toBeHidden();
});
