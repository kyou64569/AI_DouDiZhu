// @vitest-environment jsdom
/**
 * 新手引导标记（建议清单 #14）：
 * 默认未看过 → markTutorialSeen 后置 true 并持久化 → hydrate 能读回；
 * 被篡改的存量数据（非 === true）一律回落「未看过」。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS, useSettingsStore } from '@/store/settingsStore';

describe('新手引导标记 hasSeenTutorial', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSettingsStore.setState({ ...DEFAULT_SETTINGS });
    useSettingsStore.getState().hydrate();
  });

  it('默认未看过（false）', () => {
    expect(useSettingsStore.getState().hasSeenTutorial).toBe(false);
  });

  it('markTutorialSeen 置 true 并持久化，hydrate 后仍为 true', () => {
    useSettingsStore.getState().markTutorialSeen();
    expect(useSettingsStore.getState().hasSeenTutorial).toBe(true);

    useSettingsStore.setState({ ...DEFAULT_SETTINGS });
    useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().hasSeenTutorial).toBe(true);
  });

  it('重置超时偏好不会清掉「已看过」标记', () => {
    useSettingsStore.getState().markTutorialSeen();
    useSettingsStore.getState().resetTimeouts();
    expect(useSettingsStore.getState().hasSeenTutorial).toBe(true);
    expect(useSettingsStore.getState().humanTimeoutMs).toBe(DEFAULT_SETTINGS.humanTimeoutMs);
  });

  it('被篡改的数据（非布尔 true）回落为未看过', () => {
    window.localStorage.setItem('dz.settings', JSON.stringify({ humanTimeoutMs: 8000, spectateTimeoutMs: 20000, hasSeenTutorial: 'yes' }));
    useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().hasSeenTutorial).toBe(false);
  });
});
