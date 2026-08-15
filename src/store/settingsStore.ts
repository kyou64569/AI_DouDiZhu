/**
 * 全局偏好设置切片。
 *
 * 目前只承载一项：**AI 决策硬超时**。
 *
 * 背景（为什么要有这个文件）：
 * PRD D4 把 AI 决策超时定为 8s，此前以字面量 `8000` 硬编码在 `gameStore` 的
 * `buildPlayInput` / `buildBidInput` 两处。真实使用中，推理型（thinking）模型、
 * 超长 prompt、跨境网络或上游 429 排队都会常态化突破 8s，于是后端
 * `llmProxy.fetchWithTimeout` 抛出「请求上游超时（8000ms）」，AI 编排层降级为
 * 本地启发式出牌 —— 游戏虽不中断，但模型实际从未参与决策。
 *
 * 因此把超时抽成可配置项，并**按房间模式区分**：
 * - 人机模式（HUMAN_VS_AI）：人在等待，节奏优先，默认仍是 8s；
 * - 观战模式（AI_SPECTATE）：无人等待，质量优先，默认放宽到 20s。
 *
 * 依赖方向：本文件不 import 任何其他 store，属于叶子模块，可被 gameStore 安全引用。
 */

import { create } from 'zustand';
import type { RoomMode } from '@/types/config';
import { STORAGE_KEYS, ensureDataVersion, isPlainObject, readJson, toFiniteNumber, writeJson } from './persist';

/** 超时可调下界（毫秒）。低于此值几乎必然超时，无实用意义 */
export const MIN_TIMEOUT_MS: number = 5000;

/** 超时可调上界（毫秒）。思考态可放宽到 60s，故上限提到 60000 */
export const MAX_TIMEOUT_MS: number = 60000;

/** 人机模式默认超时（PRD D4） */
export const DEFAULT_HUMAN_TIMEOUT_MS: number = 8000;

/** 观战模式默认超时。无人等待，给模型更多思考时间 */
export const DEFAULT_SPECTATE_TIMEOUT_MS: number = 20000;

/** 思考态（推理模型）人机模式超时：思考耗时远大于普通调用 */
export const THINKING_HUMAN_TIMEOUT_MS: number = 30000;

/** 思考态观战模式超时：无人等待，更宽裕 */
export const THINKING_SPECTATE_TIMEOUT_MS: number = 60000;

/** 可持久化的设置形状 */
export interface AppSettings {
  /** 人机模式下的 AI 决策硬超时（毫秒） */
  humanTimeoutMs: number;
  /** 观战模式下的 AI 决策硬超时（毫秒） */
  spectateTimeoutMs: number;
}

/** 出厂默认值 */
export const DEFAULT_SETTINGS: AppSettings = {
  humanTimeoutMs: DEFAULT_HUMAN_TIMEOUT_MS,
  spectateTimeoutMs: DEFAULT_SPECTATE_TIMEOUT_MS,
};

/**
 * 把任意输入夹到 [MIN_TIMEOUT_MS, MAX_TIMEOUT_MS]。
 *
 * 非有限数（NaN / Infinity / 字符串）一律回落到 `fallback`，
 * 保证被用户手工篡改的 localStorage 不会把超时设成 0 或负数。
 *
 * @param value 原始值
 * @param fallback 非法时使用的默认值
 * @returns 取整后的合法毫秒数
 */
export function clampTimeoutMs(value: unknown, fallback: number): number {
  const num: number = toFiniteNumber(value, fallback);
  if (num < MIN_TIMEOUT_MS) {
    return MIN_TIMEOUT_MS;
  }
  if (num > MAX_TIMEOUT_MS) {
    return MAX_TIMEOUT_MS;
  }
  return Math.round(num);
}

/**
 * 从 localStorage 载入设置，任何异常均回落到默认值。
 */
function loadSettings(): AppSettings {
  const raw: unknown = readJson<unknown>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  if (!isPlainObject(raw)) {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    humanTimeoutMs: clampTimeoutMs(raw.humanTimeoutMs, DEFAULT_HUMAN_TIMEOUT_MS),
    spectateTimeoutMs: clampTimeoutMs(raw.spectateTimeoutMs, DEFAULT_SPECTATE_TIMEOUT_MS),
  };
}

/**
 * 写回 localStorage。
 *
 * @param settings 最新设置
 */
function persistSettings(settings: AppSettings): void {
  ensureDataVersion();
  writeJson<AppSettings>(STORAGE_KEYS.SETTINGS, settings);
}

/**
 * 依据房间模式挑选生效的超时值。纯函数，便于单测。
 *
 * `mode` 为 null（尚未进入房间）时按人机模式处理，取更保守的短超时。
 * `thinking` 为 true（该模型本轮会走推理/思考）时，超时抬升到思考态下限，
 * 但**只增不减**：用户若已把超时调得比下限还长，以用户设置为准。
 *
 * @param settings 当前设置
 * @param mode 房间模式
 * @param thinking 本次调用是否开启思考模式
 * @returns 该模式下的硬超时毫秒数
 */
export function pickTimeoutMs(settings: AppSettings, mode: RoomMode | null, thinking = false): number {
  const spectate: boolean = mode === 'AI_SPECTATE';
  const base: number = spectate
    ? clampTimeoutMs(settings.spectateTimeoutMs, DEFAULT_SPECTATE_TIMEOUT_MS)
    : clampTimeoutMs(settings.humanTimeoutMs, DEFAULT_HUMAN_TIMEOUT_MS);

  if (!thinking) {
    return base;
  }

  // 思考态只允许「延长」，绝不缩短用户已配置的超时
  const floor: number = spectate ? THINKING_SPECTATE_TIMEOUT_MS : THINKING_HUMAN_TIMEOUT_MS;
  return clampTimeoutMs(Math.max(base, floor), base);
}

/** settingsStore 的 state 与 action */
export interface SettingsStoreState extends AppSettings {
  /** 重新从 localStorage 载入 */
  hydrate: () => void;

  /** 设置人机模式超时（自动夹取到合法区间） */
  setHumanTimeoutMs: (value: number) => void;

  /** 设置观战模式超时（自动夹取到合法区间） */
  setSpectateTimeoutMs: (value: number) => void;

  /** 恢复出厂默认 */
  resetTimeouts: () => void;

  /** 按房间模式取生效超时；thinking 为 true 时返回思考态更长的超时 */
  timeoutForMode: (mode: RoomMode | null, thinking?: boolean) => number;
}

/**
 * 全局设置 store。
 * 初始状态同步读取 localStorage，保证刷新后立即生效。
 */
export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  ...loadSettings(),

  hydrate: (): void => {
    set(loadSettings());
  },

  setHumanTimeoutMs: (value: number): void => {
    const humanTimeoutMs: number = clampTimeoutMs(value, DEFAULT_HUMAN_TIMEOUT_MS);
    set({ humanTimeoutMs });
    persistSettings({ humanTimeoutMs, spectateTimeoutMs: get().spectateTimeoutMs });
  },

  setSpectateTimeoutMs: (value: number): void => {
    const spectateTimeoutMs: number = clampTimeoutMs(value, DEFAULT_SPECTATE_TIMEOUT_MS);
    set({ spectateTimeoutMs });
    persistSettings({ humanTimeoutMs: get().humanTimeoutMs, spectateTimeoutMs });
  },

  resetTimeouts: (): void => {
    set({ ...DEFAULT_SETTINGS });
    persistSettings({ ...DEFAULT_SETTINGS });
  },

  timeoutForMode: (mode: RoomMode | null, thinking = false): number => {
    const state: SettingsStoreState = get();
    return pickTimeoutMs({ humanTimeoutMs: state.humanTimeoutMs, spectateTimeoutMs: state.spectateTimeoutMs }, mode, thinking);
  },
}));

/**
 * 供 store 层（非 React 组件）在组件外读取生效超时的便捷函数。
 *
 * @param mode 房间模式
 */
export function resolveTimeoutMs(mode: RoomMode | null, thinking = false): number {
  return useSettingsStore.getState().timeoutForMode(mode, thinking);
}

export default useSettingsStore;
