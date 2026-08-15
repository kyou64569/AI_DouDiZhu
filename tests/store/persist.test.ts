/**
 * persist 导出/导入功能测试。
 * 验证：
 *  - exportAllAppData 产出合法 JSON，含全部持久化键，可被 importAllAppData 回写；
 *  - 导入非本应用文件 / 非法 JSON / 缺失 data 段时给出明确错误。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  exportAllAppData,
  importAllAppData,
  readRaw,
  writeRaw,
  STORAGE_KEYS,
} from '@/store/persist';

/** 在 node 环境下模拟 localStorage */
function mockLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        store.set(k, v);
      },
      removeItem: (k: string): void => {
        store.delete(k);
      },
      clear: (): void => {
        store.clear();
      },
    },
  };
}

beforeEach(() => {
  mockLocalStorage();
});

afterEach(() => {
  (globalThis as unknown as { window?: unknown }).window = undefined;
  vi.restoreAllMocks();
});

describe('配置导出 / 导入', () => {
  it('导出包含全部持久化键，且导入可完整回写', () => {
    writeRaw(STORAGE_KEYS.CONFIGS, '[{"id":"c1","name":"测试"}]');
    writeRaw(STORAGE_KEYS.PLAYERS, '[{"id":"p1"}]');
    writeRaw(STORAGE_KEYS.SETTINGS, '{"timeoutMs":8000}');
    writeRaw(STORAGE_KEYS.HISTORY, '[]');

    const json: string = exportAllAppData();
    const parsed: Record<string, unknown> = JSON.parse(json);
    expect(parsed.app).toBe('ai-doudizhu');
    expect(parsed.exportVersion).toBe(1);
    expect(parsed.data).toMatchObject({
      'dz.configs': '[{"id":"c1","name":"测试"}]',
      'dz.players': '[{"id":"p1"}]',
      'dz.settings': '{"timeoutMs":8000}',
    });

    // 清空后导入，应完整恢复
    (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage.clear();
    const result = importAllAppData(json);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('4 项');
    expect(readRaw(STORAGE_KEYS.CONFIGS)).toBe('[{"id":"c1","name":"测试"}]');
    expect(readRaw(STORAGE_KEYS.SETTINGS)).toBe('{"timeoutMs":8000}');
  });

  it('非法 JSON / 非本应用文件 / 缺 data 段 均拒绝', () => {
    expect(importAllAppData('not json').ok).toBe(false);
    expect(importAllAppData('{"app":"other","data":{}}').ok).toBe(false);
    expect(importAllAppData('{"app":"ai-doudizhu","exportVersion":1}').ok).toBe(false);
  });

  it('导入时拒绝错误的导出版本', () => {
    const wrongVersionJson = JSON.stringify({
      app: 'ai-doudizhu',
      exportVersion: 999,
      exportedAt: new Date().toISOString(),
      data: { [STORAGE_KEYS.CONFIGS]: '[{"id":"c1"}]' },
    });
    const result = importAllAppData(wrongVersionJson);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('版本 999 不兼容');
  });

  it('导入时拒绝非字符串值的数据项', () => {
    const invalidValueJson = JSON.stringify({
      app: 'ai-doudizhu',
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      data: {
        [STORAGE_KEYS.CONFIGS]: { invalid: 'object' }, // 应为字符串
        [STORAGE_KEYS.PLAYERS]: '[{"id":"p1"}]',
      },
    });
    const result = importAllAppData(invalidValueJson);
    expect(result.ok).toBe(true); // 仍应成功，但只导入有效项
    expect(result.message).toContain('1 项'); // 只导入了 PLAYERS
    expect(readRaw(STORAGE_KEYS.CONFIGS)).toBeNull(); // CONFIGS 未导入
    expect(readRaw(STORAGE_KEYS.PLAYERS)).toBe('[{"id":"p1"}]');
  });

  it('导入时拒绝不在 EXPORT_KEYS 中的键', () => {
    const extraKeyJson = JSON.stringify({
      app: 'ai-doudizhu',
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      data: {
        [STORAGE_KEYS.CONFIGS]: '[{"id":"c1"}]',
        'dz.malicious.key': 'should be rejected',
      },
    });
    const result = importAllAppData(extraKeyJson);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('1 项');
    expect(readRaw(STORAGE_KEYS.CONFIGS)).toBe('[{"id":"c1"}]');
    expect(readRaw('dz.malicious.key' as any)).toBeNull(); // 恶意键被拒绝
  });

  it('导入前会清空所有导出键，避免残留旧数据', () => {
    // 先写入一些数据
    writeRaw(STORAGE_KEYS.CONFIGS, '[{"id":"old"}]');
    writeRaw(STORAGE_KEYS.PLAYERS, '[{"id":"old_player"}]');

    // 导入只包含 CONFIGS 的数据
    const importJson = JSON.stringify({
      app: 'ai-doudizhu',
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      data: {
        [STORAGE_KEYS.CONFIGS]: '[{"id":"new"}]',
      },
    });

    const result = importAllAppData(importJson);
    expect(result.ok).toBe(true);
    expect(readRaw(STORAGE_KEYS.CONFIGS)).toBe('[{"id":"new"}]');
    expect(readRaw(STORAGE_KEYS.PLAYERS)).toBeNull(); // 旧数据被清空
  });

  it('数据全空时导出仍合法（data 为空对象）', () => {
    const json: string = exportAllAppData();
    const parsed: Record<string, unknown> = JSON.parse(json);
    expect(parsed.data).toEqual({});
  });
});
