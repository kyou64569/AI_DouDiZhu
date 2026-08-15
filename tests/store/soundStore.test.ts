/**
 * 声音偏好切片（soundStore）单元测试。
 *
 * 重点验证：
 * - 出厂默认值（默认开启声音 + 背景音）；
 * - setVolume 自动夹取到 [0, 1]；
 * - setEnabled / setBgEnabled / reset 内存态正确；
 * - 模块加载时会把偏好推送给 soundService（不抛异常）。
 *
 * 注意：vitest 环境为 node，没有 localStorage，persist 会探测失败并静默回落，
 * 因此只断言内存态，不断言持久化副作用（与 settingsStore 测试一致）。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SOUND, MAX_VOLUME, MIN_VOLUME, useSoundStore } from '@/store/soundStore';

describe('useSoundStore', () => {
  beforeEach(() => {
    useSoundStore.getState().reset();
  });

  it('出厂默认：声音与背景音均开启，音量 0.6', () => {
    const state = useSoundStore.getState();
    expect(state.enabled).toBe(true);
    expect(state.bgEnabled).toBe(true);
    expect(state.volume).toBeCloseTo(DEFAULT_SOUND.volume, 5);
  });

  it('setVolume 写入并夹取到 [0, 1]', () => {
    useSoundStore.getState().setVolume(0.3);
    expect(useSoundStore.getState().volume).toBeCloseTo(0.3, 5);

    useSoundStore.getState().setVolume(-5);
    expect(useSoundStore.getState().volume).toBe(MIN_VOLUME);

    useSoundStore.getState().setVolume(99);
    expect(useSoundStore.getState().volume).toBe(MAX_VOLUME);
  });

  it('setEnabled 切换总开关', () => {
    useSoundStore.getState().setEnabled(false);
    expect(useSoundStore.getState().enabled).toBe(false);
    useSoundStore.getState().setEnabled(true);
    expect(useSoundStore.getState().enabled).toBe(true);
  });

  it('setBgEnabled 切换背景音开关', () => {
    useSoundStore.getState().setBgEnabled(false);
    expect(useSoundStore.getState().bgEnabled).toBe(false);
    useSoundStore.getState().setBgEnabled(true);
    expect(useSoundStore.getState().bgEnabled).toBe(true);
  });

  it('reset 恢复出厂默认', () => {
    useSoundStore.getState().setEnabled(false);
    useSoundStore.getState().setVolume(0.1);
    useSoundStore.getState().reset();
    const state = useSoundStore.getState();
    expect(state.enabled).toBe(DEFAULT_SOUND.enabled);
    expect(state.bgEnabled).toBe(DEFAULT_SOUND.bgEnabled);
    expect(state.volume).toBeCloseTo(DEFAULT_SOUND.volume, 5);
  });
});
