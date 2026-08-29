/**
 * E2E · 配置 CRUD（建议清单 #17）：
 * 模型配置页与 AI 玩家页的新增 / 编辑 / 删除全链路（真实 UI 操作 + localStorage 持久化）。
 *
 * 断言口径：统一作用域到列表项（listitem），避免顶部 Toast 文案（同样包含配置名）
 * 造成的多匹配 / 误判；删除成功以「列表项清空」为准。
 */

import { expect, test, type Page } from '@playwright/test';

/**
 * 关闭首访时的全部阻塞弹窗：「密钥安全提示」（配置页）与「新手引导」。
 * 两个弹窗的 DOM 先后顺序不定（后者会遮住前者），因此按可点击性循环逐个关闭。
 */
async function dismissBlockingDialogs(page: Page): Promise<void> {
  // 两个弹窗都由 React 挂载后的 effect 打开：过早轮询会「还没打开就判定无弹窗」
  // 而提前返回，留下阻塞后续点击的残留弹窗（高负载/冷缓存下必现）。
  // 因此先等应用外壳渲染完成，再留一段挂载余量，然后才进入关闭循环。
  await page.getByRole('navigation').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  for (let round = 0; round < 6; round += 1) {
    const ack = page.getByRole('button', { name: '我已知晓' });
    const skip = page.getByRole('dialog').getByRole('button', { name: '跳过' });
    const ackVisible: boolean = await ack.isVisible().catch(() => false);
    const skipVisible: boolean = await skip.isVisible().catch(() => false);
    if (!ackVisible && !skipVisible) {
      break;
    }
    if (ackVisible) {
      try {
        await ack.click({ timeout: 2500 });
        continue;
      } catch {
        /* 被上层弹窗遮挡：改关上层或下一轮重试 */
      }
    }
    if (skipVisible) {
      try {
        await skip.click({ timeout: 2500 });
      } catch {
        /* 被上层弹窗遮挡：下一轮重试 */
      }
    }
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** 新建一个模型配置（表单必填：名称 / Provider / Base URL / API Key） */
async function createConfig(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '+ 新增配置' }).click();
  await page.getByLabel('配置名称').fill(name);
  await page.getByLabel('Provider').fill('E2E');
  await page.getByLabel('Base URL').fill('https://e2e.example.com/v1');
  await page.getByLabel('API Key').fill('sk-e2e-test');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
}

test.describe('模型配置 CRUD', () => {
  test('新增 → 编辑 → 删除', async ({ page }) => {
    await page.goto('/config');
    await dismissBlockingDialogs(page);

    // 新增
    await createConfig(page, 'E2E 配置');
    await expect(page.getByRole('listitem')).toHaveCount(1);

    // 编辑（改名后列表项文本更新）
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('配置名称').fill('E2E 配置二');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('listitem').first()).toContainText('E2E 配置二');

    // 删除（确认弹窗）→ 列表清空
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '确认删除' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(0);
  });
});

test.describe('AI 玩家 CRUD', () => {
  test('新增（绑定配置）→ 删除', async ({ page }) => {
    // 先建一个配置供绑定
    await page.goto('/config');
    await dismissBlockingDialogs(page);
    await createConfig(page, 'E2E 配置');

    // 新建 AI 玩家并绑定该配置
    await page.goto('/players');
    await dismissBlockingDialogs(page);
    await page.getByRole('button', { name: '+ 新建玩家' }).click();
    await page.getByLabel('玩家名称').fill('E2E AI');
    const configSelect = page.getByLabel('绑定的模型配置');
    const optionValue: string | null = await configSelect
      .locator('option', { hasText: 'E2E 配置' })
      .first()
      .getAttribute('value');
    expect(optionValue).toBeTruthy();
    await configSelect.selectOption(optionValue as string);
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('listitem').filter({ hasText: 'E2E AI' })).toBeVisible();

    // 删除 → 列表清空
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '确认删除' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(0);
  });
});
