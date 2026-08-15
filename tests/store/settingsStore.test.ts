/**
 * 全局设置切片（AI 决策超时）。
 *
 * 重点验证：
 * - clampTimeoutMs：越界夹取、非法值回落、取整；
 * - pickTimeoutMs：观战模式取长超时，人机 / null 取短超时；
 * - store 的 set / reset：内存态正确且始终落在合法区间；
 * - resolveTimeoutMs：组件外读取与 store 内取值一致。
 *
 * 注意：vitest 环境为 node，没有 localStorage。persist 层会探测失败并静默回落，
 * 因此本测试只断言内存态，不断言持久化副作用。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_HUMAN_TIMEOUT_MS,
  DEFAULT_SPECTATE_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  THINKING_HUMAN_TIMEOUT_MS,
  THINKING_SPECTATE_TIMEOUT_MS,
  clampTimeoutMs,
  pickTimeoutMs,
  resolveTimeoutMs,
  useSettingsStore,
  type AppSettings,
} from '@/store/settingsStore';

/** 构造设置对象 */
function settings(humanTimeoutMs: number, spectateTimeoutMs: number): AppSettings {
  return { humanTimeoutMs, spectateTimeoutMs };
}

describe('clampTimeoutMs', () => {
  it('区间内的值原样保留', () => {
    expect(clampTimeoutMs(8000, DEFAULT_HUMAN_TIMEOUT_MS)).toBe(8000);
    expect(clampTimeoutMs(20000, DEFAULT_HUMAN_TIMEOUT_MS)).toBe(20000);
  });

  it('低于下界夹到下界，高于上界夹到上界', () => {
    expect(clampTimeoutMs(0, DEFAULT_HUMAN_TIMEOUT_MS)).toBe(MIN_TIMEOUT_MS);
    expect(clampTimeoutMs(-1, DEFAULT_HUMAN_TIMEOUT_MS)).toBe(MIN_TIMEOUT_MS);
    expect(clampTimeoutMs(999999, DEFAULT_HUMAN_TIMEOUT_MS)).toBe(MAX_TIMEOUT_MS);
  });

  it('非有限数一律回落到 fallback', () => {
    expect(clampTimeoutMs(Number.NaN, 8000)).toBe(8000);
    expect(clampTimeoutMs(Number.POSITIVE_INFINITY, 8000)).toBe(8000);
    expect(clampTimeoutMs('abc', 8000)).toBe(8000);
    expect(clampTimeoutMs(null, 8000)).toBe(8000);
    expect(clampTimeoutMs(undefined, 8000)).toBe(8000);
  });

  it('小数会被取整', () => {
    expect(clampTimeoutMs(8000.6, 8000)).toBe(8001);
  });

  it('fallback 本身越界时仍会被夹取', () => {
    expect(clampTimeoutMs('bad', 100)).toBe(MIN_TIMEOUT_MS);
  });
});

describe('pickTimeoutMs', () => {
  it('观战模式取观战超时', () => {
    expect(pickTimeoutMs(settings(8000, 20000), 'AI_SPECTATE')).toBe(20000);
  });

  it('人机模式取人机超时', () => {
    expect(pickTimeoutMs(settings(8000, 20000), 'HUMAN_VS_AI')).toBe(8000);
  });

  it('模式为 null 时按人机处理（更保守的短超时）', () => {
    expect(pickTimeoutMs(settings(8000, 20000), null)).toBe(8000);
  });

  it('被篡改的存量数据也会被夹回合法区间', () => {
    expect(pickTimeoutMs(settings(0, 0), 'HUMAN_VS_AI')).toBe(MIN_TIMEOUT_MS);
    expect(pickTimeoutMs(settings(1e9, 1e9), 'AI_SPECTATE')).toBe(MAX_TIMEOUT_MS);
  });
});

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetTimeouts();
  });

  it('默认值符合 PRD D4（人机 8s）与观战放宽约定（20s）', () => {
    const state = useSettingsStore.getState();
    expect(state.humanTimeoutMs).toBe(DEFAULT_HUMAN_TIMEOUT_MS);
    expect(state.spectateTimeoutMs).toBe(DEFAULT_SPECTATE_TIMEOUT_MS);
    expect(DEFAULT_HUMAN_TIMEOUT_MS).toBe(8000);
    expect(DEFAULT_SPECTATE_TIMEOUT_MS).toBe(20000);
  });

  it('setHumanTimeoutMs 写入并夹取', () => {
    useSettingsStore.getState().setHumanTimeoutMs(15000);
    expect(useSettingsStore.getState().humanTimeoutMs).toBe(15000);

    useSettingsStore.getState().setHumanTimeoutMs(1);
    expect(useSettingsStore.getState().humanTimeoutMs).toBe(MIN_TIMEOUT_MS);

    useSettingsStore.getState().setHumanTimeoutMs(1e6);
    expect(useSettingsStore.getState().humanTimeoutMs).toBe(MAX_TIMEOUT_MS);
  });

  it('设置其中一项不会污染另一项', () => {
    useSettingsStore.getState().setHumanTimeoutMs(12000);
    expect(useSettingsStore.getState().spectateTimeoutMs).toBe(DEFAULT_SPECTATE_TIMEOUT_MS);

    useSettingsStore.getState().setSpectateTimeoutMs(25000);
    expect(useSettingsStore.getState().humanTimeoutMs).toBe(12000);
  });

  it('resetTimeouts 恢复出厂值', () => {
    useSettingsStore.getState().setHumanTimeoutMs(30000);
    useSettingsStore.getState().setSpectateTimeoutMs(5000);
    useSettingsStore.getState().resetTimeouts();

    const state = useSettingsStore.getState();
    expect(state.humanTimeoutMs).toBe(DEFAULT_HUMAN_TIMEOUT_MS);
    expect(state.spectateTimeoutMs).toBe(DEFAULT_SPECTATE_TIMEOUT_MS);
  });

  it('timeoutForMode / resolveTimeoutMs 与设置保持一致', () => {
    useSettingsStore.getState().setHumanTimeoutMs(9000);
    useSettingsStore.getState().setSpectateTimeoutMs(24000);

    expect(useSettingsStore.getState().timeoutForMode('HUMAN_VS_AI')).toBe(9000);
    expect(useSettingsStore.getState().timeoutForMode('AI_SPECTATE')).toBe(24000);
    expect(resolveTimeoutMs('HUMAN_VS_AI')).toBe(9000);
    expect(resolveTimeoutMs('AI_SPECTATE')).toBe(24000);
    expect(resolveTimeoutMs(null)).toBe(9000);
  });

  it('任何写入路径都不会产生非法超时', () => {
    const inputs: number[] = [-1, 0, 1, 4999, 5000, 8000, 30000, 30001, Number.NaN];
    for (const value of inputs) {
      useSettingsStore.getState().setHumanTimeoutMs(value);
      const actual: number = useSettingsStore.getState().humanTimeoutMs;
      expect(actual).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS);
      expect(actual).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
    }
  });
});

describe('pickTimeoutMs · 思考态延长', () => {
  const base: AppSettings = { humanTimeoutMs: 8000, spectateTimeoutMs: 20000 };

  it('人机模式开思考 → 8s 抬升到 30s', () => {
    expect(pickTimeoutMs(base, 'HUMAN_VS_AI', true)).toBe(THINKING_HUMAN_TIMEOUT_MS);
  });

  it('观战模式开思考 → 20s 抬升到 60s', () => {
    expect(pickTimeoutMs(base, 'AI_SPECTATE', true)).toBe(THINKING_SPECTATE_TIMEOUT_MS);
  });

  it('不开思考 → 维持用户设置', () => {
    expect(pickTimeoutMs(base, 'HUMAN_VS_AI', false)).toBe(8000);
    expect(pickTimeoutMs(base, 'AI_SPECTATE', false)).toBe(20000);
  });

  it('思考态只增不减：用户设置比思考下限还长时以用户为准', () => {
    const generous: AppSettings = { humanTimeoutMs: 50000, spectateTimeoutMs: 20000 };
    expect(pickTimeoutMs(generous, 'HUMAN_VS_AI', true)).toBe(50000);
  });

  it('mode 为 null 时按人机模式处理', () => {
    expect(pickTimeoutMs(base, null, true)).toBe(THINKING_HUMAN_TIMEOUT_MS);
  });

  it('resolveTimeoutMs 透传 thinking 参数', () => {
    useSettingsStore.getState().setHumanTimeoutMs(8000);
    expect(resolveTimeoutMs('HUMAN_VS_AI')).toBe(8000);
    expect(resolveTimeoutMs('HUMAN_VS_AI', true)).toBe(THINKING_HUMAN_TIMEOUT_MS);
  });
});
