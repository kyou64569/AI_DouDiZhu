// @vitest-environment jsdom
/**
 * 模型选择器「全选 / 取消全选」批量勾选测试。
 *
 * 背景：拉取模型后默认全选，模型太多时用户需要一键清空再单独勾选（用户反馈）。
 * 验证：
 *  - 全选（无关键字）→ 勾选全部，默认模型回落为第一个；
 *  - 取消全选（无关键字）→ 清空全部勾选，默认模型回到占位提示；
 *  - 有关键字时批量只作用于命中的子集：取消全选保留视图外已勾选项，全选不误伤已勾选项。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ModelConfigPage } from '@/pages/ModelConfigPage';
import { useConfigStore, DRAFT_KEY } from '@/store/configStore';
import type { ModelItem } from '@/types/api';

const MODELS: ModelItem[] = [
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat' },
];

/** 渲染模型配置页（Modal 走 portal，查询一律用 document.body） */
function renderPage(): { unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <MemoryRouter>
        <ModelConfigPage />
      </MemoryRouter>,
    );
  });
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** 找到文本精确匹配的按钮并点击 */
function clickButton(text: string): void {
  const btn: HTMLButtonElement | undefined = [...document.body.querySelectorAll('button')].find(
    (b: HTMLButtonElement): boolean => b.textContent?.trim() === text,
  );
  expect(btn, `按钮「${text}」应存在`).toBeDefined();
  act(() => {
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 设置搜索框关键字（React 受控输入必须走原生 value setter） */
function typeKeyword(keyword: string): void {
  const input: HTMLInputElement | null = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="搜索模型"]',
  );
  expect(input, '搜索框应存在').not.toBeNull();
  const setter: (v: string) => void = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setter.call(input!, keyword);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 统计勾选状态（ModelPicker 的 checkbox） */
function countChecked(): { checked: number; total: number } {
  const boxes: NodeListOf<HTMLInputElement> = document.body.querySelectorAll(
    'input[type="checkbox"]',
  );
  let checked = 0;
  boxes.forEach((b: HTMLInputElement): void => {
    if (b.checked) checked += 1;
  });
  return { checked, total: boxes.length };
}

/** 默认模型下拉的当前值（若某个 select 选中了候选模型 id 则返回它） */
function selectedDefault(): string | undefined {
  const values: string[] = [...document.body.querySelectorAll('select')].map(
    (s: HTMLSelectElement): string => s.value,
  );
  return values.find((v: string): boolean => MODELS.some((m: ModelItem): boolean => m.id === v));
}

/** 打开新增表单并注入已拉取的模型列表（openCreate 会先 clearTransient，须在其后注入） */
function openFormWithModels(): void {
  clickButton('+ 新增配置');
  act(() => {
    useConfigStore.setState({ fetchedModels: { [DRAFT_KEY]: MODELS } });
  });
}

describe('模型选择器 全选 / 取消全选', () => {
  beforeEach(() => {
    // 跳过首次密钥风险告知弹窗，避免干扰 DOM 查询
    window.localStorage.setItem('dz.meta.keyWarningAck', '1');
    act(() => {
      useConfigStore.setState({ configs: [], fetchedModels: {}, testResults: {} });
    });
  });

  afterEach(() => {
    act(() => {
      useConfigStore.setState({ configs: [], fetchedModels: {}, testResults: {} });
      useConfigStore.getState().clearTransient(DRAFT_KEY);
    });
    window.localStorage.removeItem('dz.meta.keyWarningAck');
  });

  it('打开新增表单 → 全选勾选全部并回落默认模型为第一个', () => {
    const t = renderPage();
    openFormWithModels();
    expect(countChecked()).toEqual({ checked: 0, total: 3 });

    clickButton('全选');
    expect(countChecked()).toEqual({ checked: 3, total: 3 });
    expect(selectedDefault()).toBe('gemini-3-pro');
    t.unmount();
  });

  it('取消全选 → 清空全部勾选，默认模型回到占位提示', () => {
    const t = renderPage();
    openFormWithModels();
    clickButton('全选');
    clickButton('取消全选');
    expect(countChecked()).toEqual({ checked: 0, total: 3 });
    expect(selectedDefault()).toBeUndefined();
    expect(document.body.textContent).toContain('请先勾选至少一个模型');
    t.unmount();
  });

  it('有关键字时：取消全选只取消命中项，视图外已勾选项保留', () => {
    const t = renderPage();
    openFormWithModels();
    clickButton('全选'); // 3 个全勾
    typeKeyword('gemini'); // 视图只剩 2 个 gemini
    clickButton('取消全选');
    // deepseek-chat 不在搜索范围内，保留勾选
    expect(document.body.textContent).toContain('已勾选 1 / 3 个模型');
    t.unmount();
  });

  it('有关键字时：全选只并入命中项，不误伤已有勾选', () => {
    const t = renderPage();
    openFormWithModels();
    typeKeyword('gemini');
    clickButton('全选'); // 只勾 2 个 gemini
    expect(document.body.textContent).toContain('已勾选 2 / 3 个模型');
    typeKeyword(''); // 清空搜索框 → deepseek-chat 仍未勾选
    clickButton('全选'); // 并入最后一个
    expect(countChecked()).toEqual({ checked: 3, total: 3 });
    t.unmount();
  });
});
