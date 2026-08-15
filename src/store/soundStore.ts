/**
 * 声音偏好切片。
 *
 * 为什么单独成文件：与 settingsStore 一样属于「全局偏好」，但主题不同（声音开关/背景音/音量），
 * 拆开避免一个巨型 settings 对象。同样遵循 persist 范式，不引入新机制。
 *
 * 依赖方向：本文件 import soundService 以把最新偏好推送过去（configure），
 * 但 soundService 是叶子模块、不反向 import 本 store，无循环依赖。
 */

import { create } from 'zustand';
import { STORAGE_KEYS, ensureDataVersion, isPlainObject, readJson, toFiniteNumber, writeJson } from './persist';
import {
  configure as configureSound,
  setTtsEnabled as configureTts,
  unlock as unlockSound,
} from '@/audio/soundService';

/** 声音偏好形状 */
export interface SoundSettings {
  /** 总开关（默认开；受浏览器自动播放策略约束，需用户手势解锁后才真正出声） */
  enabled: boolean;
  /** 背景音开关 */
  bgEnabled: boolean;
  /** 主音量 0~1 */
  volume: number;
  /** TTS 喊牌开关（默认开） */
  ttsEnabled: boolean;
}

export const MIN_VOLUME: number = 0;
export const MAX_VOLUME: number = 1;

/** 出厂默认值：默认开启声音 + 背景音 + TTS 喊牌 */
export const DEFAULT_SOUND: SoundSettings = {
  enabled: true,
  bgEnabled: true,
  volume: 0.6,
  ttsEnabled: true,
};

/** 把任意输入夹到 [0, 1] */
function clampVolume(value: unknown, fallback: number): number {
  const num: number = toFiniteNumber(value, fallback);
  if (num < MIN_VOLUME) return MIN_VOLUME;
  if (num > MAX_VOLUME) return MAX_VOLUME;
  return num;
}

/** 从 localStorage 载入，异常一律回落默认 */
function loadSound(): SoundSettings {
  const raw: unknown = readJson<unknown>(STORAGE_KEYS.SOUND, DEFAULT_SOUND);
  if (!isPlainObject(raw)) return { ...DEFAULT_SOUND };
  const obj = raw as Record<string, unknown>;
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_SOUND.enabled,
    bgEnabled: typeof obj.bgEnabled === 'boolean' ? obj.bgEnabled : DEFAULT_SOUND.bgEnabled,
    volume: clampVolume(obj.volume, DEFAULT_SOUND.volume),
    ttsEnabled: typeof obj.ttsEnabled === 'boolean' ? obj.ttsEnabled : DEFAULT_SOUND.ttsEnabled,
  };
}

/** 写回 localStorage */
function persist(settings: SoundSettings): void {
  ensureDataVersion();
  writeJson<SoundSettings>(STORAGE_KEYS.SOUND, settings);
}

/** 把当前偏好推送给声音服务（纯副作用，无返回值） */
function pushToService(settings: SoundSettings): void {
  configureSound({
    enabled: settings.enabled,
    bgEnabled: settings.bgEnabled,
    volume: settings.volume,
    ttsEnabled: settings.ttsEnabled,
  });
  configureTts(settings.ttsEnabled);
}

export interface SoundStoreState extends SoundSettings {
  /** 重新从 localStorage 载入 */
  hydrate: () => void;
  /** 设置总开关（开启时顺便解锁音频上下文） */
  setEnabled: (value: boolean) => void;
  /** 设置背景音开关 */
  setBgEnabled: (value: boolean) => void;
  /** 设置主音量（自动夹取到 [0, 1]） */
  setVolume: (value: number) => void;
  /** 设置 TTS 喊牌开关 */
  setTtsEnabled: (value: boolean) => void;
  /** 在用户手势内解锁音频上下文 */
  unlock: () => void;
  /** 恢复出厂默认 */
  reset: () => void;
}

export const useSoundStore = create<SoundStoreState>((set, get) => {
  const initial: SoundSettings = loadSound();
  pushToService(initial);

  return {
    ...initial,

    hydrate: (): void => {
      const s: SoundSettings = loadSound();
      pushToService(s);
      set(s);
    },

    setEnabled: (value: boolean): void => {
      const s: SoundSettings = { ...get(), enabled: value };
      persist(s);
      pushToService(s);
      set({ enabled: value });
      // 开启声音即视为一次用户意图，顺手解锁（若尚未解锁）
      if (value) unlockSound();
    },

    setBgEnabled: (value: boolean): void => {
      const s: SoundSettings = { ...get(), bgEnabled: value };
      persist(s);
      pushToService(s);
      set({ bgEnabled: value });
    },

    setVolume: (value: number): void => {
      const vol: number = clampVolume(value, DEFAULT_SOUND.volume);
      const s: SoundSettings = { ...get(), volume: vol };
      persist(s);
      pushToService(s);
      set({ volume: vol });
    },

    unlock: (): void => {
      unlockSound();
    },

    setTtsEnabled: (value: boolean): void => {
      const s: SoundSettings = { ...get(), ttsEnabled: value };
      persist(s);
      pushToService(s);
      set({ ttsEnabled: value });
      // 开启 TTS 视为一次用户意图，顺手预热语音列表（若尚未预热）
      if (value) unlockSound();
    },

    reset: (): void => {
      persist(DEFAULT_SOUND);
      pushToService(DEFAULT_SOUND);
      set({ ...DEFAULT_SOUND });
    },
  };
});

export default useSoundStore;
