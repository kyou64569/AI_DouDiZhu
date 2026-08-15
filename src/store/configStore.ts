/**
 * 模型配置切片（REQ-M1 ~ M4）。
 *
 * 职责：模型配置 CRUD、localStorage 持久化（键 `dz.configs`）、
 * 拉取模型列表、连通性测试。
 *
 * 重要约束（REQ-M3）：`testConnection` 与 `fetchModels` **绝不写回 configs**，
 * 它们只更新内存中的临时状态（testResults / fetchedModels），
 * 只有 `addConfig` / `updateConfig` / `deleteConfig` 会触碰持久化数据。
 *
 * 依赖方向：configStore → playerStore（只读，用于删除保护）。
 */

import { create } from 'zustand';
import type { ConnectionTestResult, ModelConfig, ThinkingMode } from '@/types/config';
import { DEFAULT_TEMPERATURE, DEFAULT_THINKING_MODE, THINKING_MODES } from '@/types/config';
import type { ModelItem } from '@/types/api';
import { fetchModels as apiFetchModels, testConnection as apiTestConnection } from '@/api/llm';
import { toErrorMessage } from '@/api/client';
import { createId } from '@/utils/id';
import { toast } from '@/components/common/Toast';
import { usePlayerStore } from './playerStore';
import {
  STORAGE_KEYS,
  ensureDataVersion,
  isNonEmptyString,
  isPlainObject,
  readArray,
  toFiniteNumber,
  toStringArray,
  writeJson,
} from './persist';
import type { AIPlayer } from '@/types/config';

/** 新建 / 编辑模型配置时的输入字段 */
export interface ModelConfigInput {
  /** 配置名称 */
  name: string;
  /** 服务商名称 */
  provider: string;
  /** Base URL */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 勾选保留的可用模型 id 列表 */
  availableModels: string[];
  /** 默认模型 id */
  selectedModel: string;
  /** AI 思考模式（推理强度） */
  thinkingMode: ThinkingMode;
  /** 采样温度 0~2 */
  temperature: number;
}

/** 拉取模型 / 连通性测试所需的凭据（不含 id，可来自未保存的草稿） */
export interface LLMCredentials {
  baseUrl: string;
  apiKey: string;
}

/** 变更结果 */
export interface ConfigMutationResult {
  ok: boolean;
  message: string;
  config?: ModelConfig;
  /** 删除被阻断时，列出仍在绑定该配置的 AI 玩家名称 */
  blockedBy?: string[];
}

/** 草稿（新增未保存的配置）在 testResults / fetchedModels 中使用的键 */
export const DRAFT_KEY: string = '__draft__';

/** 空输入模板，供页面初始化表单 */
export const EMPTY_CONFIG_INPUT: ModelConfigInput = {
  name: '',
  provider: '',
  baseUrl: '',
  apiKey: '',
  availableModels: [],
  selectedModel: '',
  thinkingMode: DEFAULT_THINKING_MODE,
  temperature: DEFAULT_TEMPERATURE,
};

/** 名称最大长度 */
const MAX_NAME_LENGTH: number = 30;

/** 供 useMemo 等场景复用的空数组常量，避免每次渲染产生新引用 */
export const EMPTY_MODEL_ITEMS: readonly ModelItem[] = [];

/**
 * 类型守卫：判断 localStorage 中的一项是否为合法 ModelConfig。
 *
 * @param item 任意值
 */
function isModelConfig(item: unknown): item is ModelConfig {
  if (!isPlainObject(item)) {
    return false;
  }
  return isNonEmptyString(item.id) && isNonEmptyString(item.name) && typeof item.baseUrl === 'string';
}

/**
 * 把可能残缺的持久化数据补全为完整 ModelConfig。
 *
 * @param raw 已通过类型守卫的原始对象
 */
function normalizeConfig(raw: ModelConfig): ModelConfig {
  const record: Record<string, unknown> = raw as unknown as Record<string, unknown>;
  const now: number = Date.now();
  return {
    id: raw.id,
    name: raw.name,
    provider: typeof record.provider === 'string' ? (record.provider as string) : '',
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    apiKey: typeof record.apiKey === 'string' ? (record.apiKey as string) : '',
    availableModels: toStringArray(record.availableModels),
    selectedModel: typeof record.selectedModel === 'string' ? (record.selectedModel as string) : '',
    thinkingMode: normalizeThinkingMode(record.thinkingMode),
    temperature: clampTemperature(record.temperature, DEFAULT_TEMPERATURE),
    createdAt: toFiniteNumber(record.createdAt, now),
    updatedAt: toFiniteNumber(record.updatedAt, now),
  };
}

/** 从 localStorage 载入模型配置列表，异常时返回空数组 */
function loadConfigs(): ModelConfig[] {
  return readArray<ModelConfig>(STORAGE_KEYS.CONFIGS, isModelConfig).map(normalizeConfig);
}

/**
 * 写回 localStorage。
 *
 * @param configs 最新列表
 */
function persistConfigs(configs: ModelConfig[]): void {
  ensureDataVersion();
  writeJson<ModelConfig[]>(STORAGE_KEYS.CONFIGS, configs);
}

/**
 * 规范化 Base URL：去掉首尾空白与结尾多余斜杠。
 *
 * @param baseUrl 原始输入
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** 把任意输入归一化为合法思考模式，无法识别时回落默认档 */
function normalizeThinkingMode(value: unknown): ThinkingMode {
  return THINKING_MODES.includes(value as ThinkingMode) ? (value as ThinkingMode) : DEFAULT_THINKING_MODE;
}

/** 把任意输入夹到合法温度区间 [0, 2]，非有限数回落 fallback */
function clampTemperature(value: unknown, fallback: number): number {
  const num: number = toFiniteNumber(value, fallback);
  if (num < 0) {
    return 0;
  }
  if (num > 2) {
    return 2;
  }
  return num;
}

/**
 * 校验模型配置输入。
 *
 * @param input 表单输入
 * @returns 校验不通过时返回中文错误信息，通过返回 null
 */
export function validateConfigInput(input: ModelConfigInput): string | null {
  const name: string = input.name.trim();
  if (name.length === 0) {
    return '请填写配置名称';
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `配置名称不能超过 ${MAX_NAME_LENGTH} 个字符`;
  }
  if (input.provider.trim().length === 0) {
    return '请填写 Provider 名称';
  }
  const baseUrl: string = normalizeBaseUrl(input.baseUrl);
  if (baseUrl.length === 0) {
    return '请填写 Base URL';
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return 'Base URL 需以 http:// 或 https:// 开头';
  }
  if (input.apiKey.trim().length === 0) {
    return '请填写 API Key';
  }
  // 思考模式与温度为后加字段：缺失时按默认值处理，只有「显式填了非法值」才报错，
  // 避免旧数据 / 旧调用方因缺字段被整条拦下。
  const raw: Record<string, unknown> = input as unknown as Record<string, unknown>;
  const temperature: unknown = raw.temperature;
  if (
    temperature !== undefined &&
    (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)
  ) {
    return '温度必须在 0~2 之间';
  }
  const thinkingMode: unknown = raw.thinkingMode;
  if (thinkingMode !== undefined && !THINKING_MODES.includes(thinkingMode as ThinkingMode)) {
    return '请选择有效的思考模式';
  }
  return null;
}

/**
 * 校验拉取模型 / 连通性测试所需的最小凭据。
 *
 * @param cred 凭据
 * @returns 不通过时返回中文错误信息
 */
function validateCredentials(cred: LLMCredentials): string | null {
  const baseUrl: string = normalizeBaseUrl(cred.baseUrl);
  if (baseUrl.length === 0) {
    return '请先填写 Base URL';
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return 'Base URL 需以 http:// 或 https:// 开头';
  }
  if (cred.apiKey.trim().length === 0) {
    return '请先填写 API Key';
  }
  return null;
}

/** configStore 的 state 与 action */
export interface ConfigStoreState {
  /** 全部模型配置 */
  configs: ModelConfig[];

  /** 连通性测试结果，key 为配置 id 或 `DRAFT_KEY`。不持久化 */
  testResults: Record<string, ConnectionTestResult>;

  /** 已拉取的模型列表（含展示名），key 同上。不持久化 */
  fetchedModels: Record<string, ModelItem[]>;

  /** 正在执行连通性测试的 key，空闲为 null */
  testingKey: string | null;

  /** 正在拉取模型列表的 key，空闲为 null */
  fetchingKey: string | null;

  /** 重新从 localStorage 载入 */
  hydrate: () => void;

  /** 新增配置 */
  addConfig: (input: ModelConfigInput) => ConfigMutationResult;

  /** 编辑配置 */
  updateConfig: (id: string, input: ModelConfigInput) => ConfigMutationResult;

  /** 删除配置。存在绑定该配置的 AI 玩家时阻断 */
  deleteConfig: (id: string) => ConfigMutationResult;

  /** 按 id 查找 */
  getConfig: (id: string) => ModelConfig | undefined;

  /**
   * 拉取模型列表（REQ-M2）。不修改任何已保存配置。
   *
   * @param cred 凭据（可来自未保存草稿）
   * @param key 结果存放键，默认 `DRAFT_KEY`
   * @returns 归一化后的模型列表，失败返回空数组
   */
  fetchModels: (cred: LLMCredentials, key?: string) => Promise<ModelItem[]>;

  /**
   * 连通性测试（REQ-M3）。不修改任何已保存配置。
   *
   * @param cred 凭据（可来自未保存草稿）
   * @param key 结果存放键，默认 `DRAFT_KEY`
   */
  testConnection: (cred: LLMCredentials, key?: string) => Promise<ConnectionTestResult>;

  /** 清空指定 key 的临时测试结果与模型列表 */
  clearTransient: (key: string) => void;

  /** 清空全部配置（调试用） */
  clearConfigs: () => void;
}

/**
 * 模型配置 store。
 * 初始状态同步读取 localStorage，保证刷新后立即可见（REQ-M4）。
 */
export const useConfigStore = create<ConfigStoreState>((set, get) => ({
  configs: loadConfigs(),
  testResults: {},
  fetchedModels: {},
  testingKey: null,
  fetchingKey: null,

  hydrate: (): void => {
    set({ configs: loadConfigs() });
  },

  addConfig: (input: ModelConfigInput): ConfigMutationResult => {
    const error: string | null = validateConfigInput(input);
    if (error !== null) {
      return { ok: false, message: error };
    }

    const now: number = Date.now();
    const available: string[] = [...input.availableModels];
    const config: ModelConfig = {
      id: createId('cfg'),
      name: input.name.trim(),
      provider: input.provider.trim(),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      apiKey: input.apiKey.trim(),
      availableModels: available,
      selectedModel: available.includes(input.selectedModel) ? input.selectedModel : (available[0] ?? ''),
      thinkingMode: normalizeThinkingMode(input.thinkingMode),
      temperature: clampTemperature(input.temperature, DEFAULT_TEMPERATURE),
      createdAt: now,
      updatedAt: now,
    };

    const next: ModelConfig[] = [...get().configs, config];
    set({ configs: next });
    persistConfigs(next);
    return { ok: true, message: `已保存配置「${config.name}」`, config };
  },

  updateConfig: (id: string, input: ModelConfigInput): ConfigMutationResult => {
    const existing: ModelConfig | undefined = get().configs.find((c: ModelConfig): boolean => c.id === id);
    if (existing === undefined) {
      return { ok: false, message: '未找到该配置，可能已被删除' };
    }

    const error: string | null = validateConfigInput(input);
    if (error !== null) {
      return { ok: false, message: error };
    }

    const available: string[] = [...input.availableModels];
    const updated: ModelConfig = {
      ...existing,
      name: input.name.trim(),
      provider: input.provider.trim(),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      apiKey: input.apiKey.trim(),
      availableModels: available,
      selectedModel: available.includes(input.selectedModel) ? input.selectedModel : (available[0] ?? ''),
      thinkingMode: normalizeThinkingMode(input.thinkingMode),
      temperature: clampTemperature(input.temperature, DEFAULT_TEMPERATURE),
      updatedAt: Date.now(),
    };

    const next: ModelConfig[] = get().configs.map((c: ModelConfig): ModelConfig => (c.id === id ? updated : c));
    set({ configs: next });
    persistConfigs(next);
    return { ok: true, message: `已保存配置「${updated.name}」`, config: updated };
  },

  deleteConfig: (id: string): ConfigMutationResult => {
    const existing: ModelConfig | undefined = get().configs.find((c: ModelConfig): boolean => c.id === id);
    if (existing === undefined) {
      return { ok: false, message: '未找到该配置，可能已被删除' };
    }

    // 绑定保护：存在引用该配置的 AI 玩家时阻断，避免产生悬空引用
    const bound: AIPlayer[] = usePlayerStore.getState().findPlayersByConfig(id);
    if (bound.length > 0) {
      const names: string[] = bound.map((p: AIPlayer): string => p.name);
      return {
        ok: false,
        message: `配置「${existing.name}」正被 ${bound.length} 个 AI 玩家绑定（${names.join('、')}），请先解绑或删除这些玩家`,
        blockedBy: names,
      };
    }

    const next: ModelConfig[] = get().configs.filter((c: ModelConfig): boolean => c.id !== id);
    set({ configs: next });
    persistConfigs(next);
    get().clearTransient(id);
    return { ok: true, message: `已删除配置「${existing.name}」`, config: existing };
  },

  getConfig: (id: string): ModelConfig | undefined => {
    return get().configs.find((c: ModelConfig): boolean => c.id === id);
  },

  fetchModels: async (cred: LLMCredentials, key: string = DRAFT_KEY): Promise<ModelItem[]> => {
    const invalid: string | null = validateCredentials(cred);
    if (invalid !== null) {
      toast.warning(invalid);
      return [];
    }

    set({ fetchingKey: key });
    try {
      const res = await apiFetchModels({
        baseUrl: normalizeBaseUrl(cred.baseUrl),
        apiKey: cred.apiKey.trim(),
      });
      const models: ModelItem[] = Array.isArray(res.models) ? res.models : [];
      set((state: ConfigStoreState) => ({
        fetchedModels: { ...state.fetchedModels, [key]: models },
      }));

      if (models.length === 0) {
        toast.warning('该服务未返回任何模型，请确认 Base URL 是否指向 /v1 根路径');
      } else {
        toast.success(`已拉取到 ${models.length} 个模型`);
      }
      return models;
    } catch (err: unknown) {
      toast.error(`拉取模型失败：${toErrorMessage(err)}`);
      return [];
    } finally {
      set({ fetchingKey: null });
    }
  },

  testConnection: async (cred: LLMCredentials, key: string = DRAFT_KEY): Promise<ConnectionTestResult> => {
    const invalid: string | null = validateCredentials(cred);
    if (invalid !== null) {
      toast.warning(invalid);
      const result: ConnectionTestResult = {
        success: false,
        latencyMs: 0,
        error: invalid,
        testedAt: Date.now(),
      };
      set((state: ConfigStoreState) => ({ testResults: { ...state.testResults, [key]: result } }));
      return result;
    }

    set({ testingKey: key });
    const startedAt: number = Date.now();
    try {
      const res = await apiTestConnection({
        baseUrl: normalizeBaseUrl(cred.baseUrl),
        apiKey: cred.apiKey.trim(),
      });
      const result: ConnectionTestResult = {
        success: res.success === true,
        latencyMs: Number.isFinite(res.latencyMs) ? res.latencyMs : Date.now() - startedAt,
        testedAt: Date.now(),
      };
      set((state: ConfigStoreState) => ({ testResults: { ...state.testResults, [key]: result } }));

      if (result.success) {
        toast.success(`连通成功，响应 ${Math.round(result.latencyMs)}ms`);
      } else {
        toast.error('连通性测试失败：服务返回不可用');
      }
      return result;
    } catch (err: unknown) {
      const message: string = toErrorMessage(err);
      const result: ConnectionTestResult = {
        success: false,
        latencyMs: Date.now() - startedAt,
        error: message,
        testedAt: Date.now(),
      };
      set((state: ConfigStoreState) => ({ testResults: { ...state.testResults, [key]: result } }));
      toast.error(`连通性测试失败：${message}`);
      return result;
    } finally {
      set({ testingKey: null });
    }
  },

  clearTransient: (key: string): void => {
    set((state: ConfigStoreState) => {
      const nextResults: Record<string, ConnectionTestResult> = { ...state.testResults };
      const nextModels: Record<string, ModelItem[]> = { ...state.fetchedModels };
      delete nextResults[key];
      delete nextModels[key];
      return { testResults: nextResults, fetchedModels: nextModels };
    });
  },

  clearConfigs: (): void => {
    set({ configs: [] });
    persistConfigs([]);
  },
}));

/**
 * 在组件外弹出变更结果提示的便捷函数。
 *
 * @param result 任一 CRUD 返回值
 * @returns 原样返回 `result.ok`
 */
export function notifyConfigResult(result: ConfigMutationResult): boolean {
  if (result.ok) {
    toast.success(result.message);
  } else {
    toast.error(result.message);
  }
  return result.ok;
}

/**
 * 由 ModelConfig 生成表单输入对象。
 *
 * @param config 已保存的配置
 */
export function toConfigInput(config: ModelConfig): ModelConfigInput {
  return {
    name: config.name,
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    availableModels: [...config.availableModels],
    selectedModel: config.selectedModel,
    thinkingMode: config.thinkingMode,
    temperature: config.temperature,
  };
}

export default useConfigStore;
