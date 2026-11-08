/**
 * AI 玩家切片（REQ-A1 / A2 / A3）。
 *
 * 职责：AI 玩家的增删改查、localStorage 持久化（键 `dz.players`）、
 * 以及「正在房间中使用」的保护校验。
 *
 * 依赖方向：playerStore → roomStore（只读，用于使用中保护）。
 * roomStore 不反向依赖本文件，因此不存在循环引用。
 */

import { create } from 'zustand';
import type { AIPlayer, Difficulty, Persona, Personality } from '@/types/config';
import { DIFFICULTIES, PERSONALITIES, PERSONAS } from '@/types/config';
import { createId } from '@/utils/id';
import { toast } from '@/components/common/Toast';
import { useRoomStore } from './roomStore';
import {
  STORAGE_KEYS,
  ensureDataVersion,
  isNonEmptyString,
  isPlainObject,
  readArray,
  toFiniteNumber,
  writeJson,
} from './persist';

/** 新建 / 编辑 AI 玩家时的输入字段（不含 id 与时间戳） */
export interface AIPlayerInput {
  /** 玩家名称 */
  name: string;
  /** 绑定的 ModelConfig.id */
  modelConfigId: string;
  /** 绑定的具体模型 id，留空表示使用配置的默认模型 */
  modelId: string;
  /** 备注 */
  remark: string;
  /** 头像 emoji */
  avatar: string;
  /** TTS 音色 id（任意服务商支持的值；可选） */
  voice?: string;
  /** TTS 模型名（可选，默认 tts-1） */
  ttsModel?: string;
  /** TTS 单独绑定的模型配置 id（可选，留空则跟随聊天配置） */
  ttsConfigId?: string;
  /** 台词人设（可选） */
  persona?: string;
  /** 决策难度（可选；'' 表示跟随默认「普通」） */
  difficulty?: string;
  /** 决策性格（可选；'' 表示跟随默认「均衡」） */
  personality?: string;
  /** AI 决策超时秒数（可选；'' 表示跟随全局设置。5~120 的整数） */
  timeoutSeconds?: string;
}

/** 变更结果，供页面统一处理提示 */
export interface PlayerMutationResult {
  ok: boolean;
  /** 失败原因或成功描述 */
  message: string;
  /** 成功时返回受影响的玩家 */
  player?: AIPlayer;
}

/** 空输入模板，供页面初始化表单 */
export const EMPTY_PLAYER_INPUT: AIPlayerInput = {
  name: '',
  modelConfigId: '',
  modelId: '',
  remark: '',
  avatar: '',
  voice: '',
  ttsModel: '',
  ttsConfigId: '',
  persona: '',
  difficulty: '',
  personality: '',
  timeoutSeconds: '',
};

/** 名称最大长度 */
const MAX_NAME_LENGTH: number = 20;

/**
 * 类型守卫：判断 localStorage 中的一项是否为合法 AIPlayer。
 *
 * @param item 任意值
 */
function isAIPlayer(item: unknown): item is AIPlayer {
  if (!isPlainObject(item)) {
    return false;
  }
  return isNonEmptyString(item.id) && isNonEmptyString(item.name) && typeof item.modelConfigId === 'string';
}

/**
 * 把可能残缺的持久化数据补全为完整 AIPlayer。
 *
 * @param raw 已通过类型守卫的原始对象
 */
function normalizePlayer(raw: AIPlayer): AIPlayer {
  const record: Record<string, unknown> = raw as unknown as Record<string, unknown>;
  const now: number = Date.now();
  return {
    id: raw.id,
    name: raw.name,
    modelConfigId: typeof raw.modelConfigId === 'string' ? raw.modelConfigId : '',
    modelId: typeof record.modelId === 'string' ? (record.modelId as string) : undefined,
    remark: typeof record.remark === 'string' ? (record.remark as string) : undefined,
    avatar: typeof record.avatar === 'string' ? (record.avatar as string) : undefined,
    voice: isVoiceValue(record.voice) ? record.voice.trim() : undefined,
    ttsModel: isTtsModelValue(record.ttsModel) ? record.ttsModel.trim() : undefined,
    ttsConfigId: optionalText(record.ttsConfigId),
    persona: isPersona(record.persona) ? (record.persona as Persona) : undefined,
    difficulty: isDifficulty(record.difficulty) ? (record.difficulty as Difficulty) : undefined,
    personality: isPersonality(record.personality) ? (record.personality as Personality) : undefined,
    timeoutSeconds: normalizeTimeoutSeconds(record.timeoutSeconds),
    createdAt: toFiniteNumber(record.createdAt, now),
    updatedAt: toFiniteNumber(record.updatedAt, now),
  };
}

/**
 * 从 localStorage 载入 AI 玩家列表。
 * 任何异常都会退化为空数组，不会抛出。
 */
function loadPlayers(): AIPlayer[] {
  return readArray<AIPlayer>(STORAGE_KEYS.PLAYERS, isAIPlayer).map(normalizePlayer);
}

/**
 * 写回 localStorage。
 *
 * @param players 最新列表
 */
function persistPlayers(players: AIPlayer[]): void {
  ensureDataVersion();
  writeJson<AIPlayer[]>(STORAGE_KEYS.PLAYERS, players);
}

/**
 * 校验输入字段。
 *
 * @param input 表单输入
 * @returns 校验不通过时返回中文错误信息，通过返回 null
 */
/** 可选文本字段归一化：非字符串或空白一律视为「未填」。 */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed: string = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 音色名守卫：任意非空、长度合理即视为合法（支持用户手填服务商特有音色 id） */
function isVoiceValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const t: string = value.trim();
  return t.length > 0 && t.length <= 64;
}

/** TTS 模型名守卫：同上 */
function isTtsModelValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const t: string = value.trim();
  return t.length > 0 && t.length <= 64;
}

/** 人设守卫 */
function isPersona(value: unknown): value is Persona {
  return typeof value === 'string' && (PERSONAS as readonly string[]).includes(value);
}

/** 难度守卫 */
function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value);
}

/** 性格守卫 */
function isPersonality(value: unknown): value is Personality {
  return typeof value === 'string' && (PERSONALITIES as readonly string[]).includes(value);
}

/** 玩家决策超时范围（秒）：下限与全局一致，上限对齐服务端 120s 钳制 */
export const MIN_PLAYER_TIMEOUT_SECONDS: number = 5;
export const MAX_PLAYER_TIMEOUT_SECONDS: number = 120;

/**
 * 把任意输入归一化为合法的玩家决策超时秒数：5~120 的整数保留，其余视为未填写。
 * 表单值是字符串（'90'），localStorage 旧数据是数字，两种都要兼容。
 */
function normalizeTimeoutSeconds(value: unknown): number | undefined {
  const num: number = typeof value === 'number' ? value : Number(value);
  if (Number.isInteger(num) && num >= MIN_PLAYER_TIMEOUT_SECONDS && num <= MAX_PLAYER_TIMEOUT_SECONDS) {
    return num;
  }
  return undefined;
}

export function validatePlayerInput(input: AIPlayerInput): string | null {
  const name: string = input.name.trim();
  if (name.length === 0) {
    return '请填写玩家名称';
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `玩家名称不能超过 ${MAX_NAME_LENGTH} 个字符`;
  }
  if (input.modelConfigId.trim().length === 0) {
    return '请选择绑定的模型配置';
  }
  // 思考超时为后加字段：留空合法；显式填写（表单为字符串）必须是 5~120 的整数
  const raw: Record<string, unknown> = input as unknown as Record<string, unknown>;
  const timeout: unknown = raw.timeoutSeconds;
  if (timeout !== undefined && timeout !== null && String(timeout).trim() !== '') {
    const num: number = Number(timeout);
    if (!Number.isInteger(num) || num < MIN_PLAYER_TIMEOUT_SECONDS || num > MAX_PLAYER_TIMEOUT_SECONDS) {
      return `思考超时需为 ${MIN_PLAYER_TIMEOUT_SECONDS}~${MAX_PLAYER_TIMEOUT_SECONDS} 的整数秒`;
    }
  }
  return null;
}

/** playerStore 的 state 与 action */
export interface PlayerStoreState {
  /** 全部 AI 玩家 */
  players: AIPlayer[];

  /** 重新从 localStorage 载入（用于多标签页同步或调试） */
  hydrate: () => void;

  /** 新增 AI 玩家 */
  addPlayer: (input: AIPlayerInput) => PlayerMutationResult;

  /** 编辑 AI 玩家。正在房间中使用时阻断（REQ-A3） */
  updatePlayer: (id: string, input: AIPlayerInput) => PlayerMutationResult;

  /** 删除 AI 玩家。正在房间中使用时阻断（REQ-A3） */
  deletePlayer: (id: string) => PlayerMutationResult;

  /** 按 id 查找 */
  getPlayer: (id: string) => AIPlayer | undefined;

  /** 找出所有绑定到指定模型配置的玩家（供配置删除保护使用） */
  findPlayersByConfig: (modelConfigId: string) => AIPlayer[];

  /** 该玩家是否正在房间座位上（REQ-A3） */
  isPlayerInUse: (id: string) => boolean;

  /** 清空全部玩家（调试用） */
  clearPlayers: () => void;
}

/**
 * AI 玩家 store。
 * 初始状态直接同步读取 localStorage，避免首屏闪空。
 */
export const usePlayerStore = create<PlayerStoreState>((set, get) => ({
  players: loadPlayers(),

  hydrate: (): void => {
    set({ players: loadPlayers() });
  },

  addPlayer: (input: AIPlayerInput): PlayerMutationResult => {
    const error: string | null = validatePlayerInput(input);
    if (error !== null) {
      return { ok: false, message: error };
    }

    const now: number = Date.now();
    const player: AIPlayer = {
      id: createId('ply'),
      name: input.name.trim(),
      modelConfigId: input.modelConfigId.trim(),
      // modelId / remark / avatar 均为可选字段，缺失时不能直接 .trim()，否则整条新增会崩
      modelId: optionalText(input.modelId),
      remark: optionalText(input.remark),
      avatar: optionalText(input.avatar),
      voice: isVoiceValue(input.voice) ? input.voice.trim() : undefined,
      ttsModel: isTtsModelValue(input.ttsModel) ? input.ttsModel.trim() : undefined,
      ttsConfigId: optionalText(input.ttsConfigId),
      persona: isPersona(input.persona) ? (input.persona as Persona) : undefined,
      difficulty: isDifficulty(input.difficulty) ? (input.difficulty as Difficulty) : undefined,
      personality: isPersonality(input.personality) ? (input.personality as Personality) : undefined,
      timeoutSeconds: normalizeTimeoutSeconds(input.timeoutSeconds),
      createdAt: now,
      updatedAt: now,
    };

    const next: AIPlayer[] = [...get().players, player];
    set({ players: next });
    persistPlayers(next);
    return { ok: true, message: `已创建 AI 玩家「${player.name}」`, player };
  },

  updatePlayer: (id: string, input: AIPlayerInput): PlayerMutationResult => {
    const existing: AIPlayer | undefined = get().players.find((p: AIPlayer): boolean => p.id === id);
    if (existing === undefined) {
      return { ok: false, message: '未找到该 AI 玩家，可能已被删除' };
    }

    if (get().isPlayerInUse(id)) {
      return { ok: false, message: `「${existing.name}」正在房间座位中使用，请先将其移出座位再编辑` };
    }

    const error: string | null = validatePlayerInput(input);
    if (error !== null) {
      return { ok: false, message: error };
    }

    const updated: AIPlayer = {
      ...existing,
      name: input.name.trim(),
      modelConfigId: input.modelConfigId.trim(),
      modelId: optionalText(input.modelId),
      remark: optionalText(input.remark),
      avatar: optionalText(input.avatar),
      voice: isVoiceValue(input.voice) ? input.voice.trim() : undefined,
      ttsModel: isTtsModelValue(input.ttsModel) ? input.ttsModel.trim() : undefined,
      ttsConfigId: optionalText(input.ttsConfigId),
      persona: isPersona(input.persona) ? (input.persona as Persona) : undefined,
      difficulty: isDifficulty(input.difficulty) ? (input.difficulty as Difficulty) : undefined,
      personality: isPersonality(input.personality) ? (input.personality as Personality) : undefined,
      timeoutSeconds: normalizeTimeoutSeconds(input.timeoutSeconds),
      updatedAt: Date.now(),
    };

    const next: AIPlayer[] = get().players.map((p: AIPlayer): AIPlayer => (p.id === id ? updated : p));
    set({ players: next });
    persistPlayers(next);
    return { ok: true, message: `已保存「${updated.name}」`, player: updated };
  },

  deletePlayer: (id: string): PlayerMutationResult => {
    const existing: AIPlayer | undefined = get().players.find((p: AIPlayer): boolean => p.id === id);
    if (existing === undefined) {
      return { ok: false, message: '未找到该 AI 玩家，可能已被删除' };
    }

    if (get().isPlayerInUse(id)) {
      return { ok: false, message: `「${existing.name}」正在房间座位中使用，无法删除` };
    }

    const next: AIPlayer[] = get().players.filter((p: AIPlayer): boolean => p.id !== id);
    set({ players: next });
    persistPlayers(next);
    return { ok: true, message: `已删除「${existing.name}」`, player: existing };
  },

  getPlayer: (id: string): AIPlayer | undefined => {
    return get().players.find((p: AIPlayer): boolean => p.id === id);
  },

  findPlayersByConfig: (modelConfigId: string): AIPlayer[] => {
    return get().players.filter((p: AIPlayer): boolean => p.modelConfigId === modelConfigId);
  },

  isPlayerInUse: (id: string): boolean => {
    // 只读 roomStore 的座位占用情况，不产生反向依赖
    return useRoomStore.getState().isPlayerSeated(id);
  },

  clearPlayers: (): void => {
    set({ players: [] });
    persistPlayers([]);
  },
}));

/**
 * 在组件外弹出变更结果提示的便捷函数。
 *
 * @param result 任一 CRUD 返回值
 * @returns 原样返回 `result.ok`，便于链式判断
 */
export function notifyPlayerResult(result: PlayerMutationResult): boolean {
  if (result.ok) {
    toast.success(result.message);
  } else {
    toast.error(result.message);
  }
  return result.ok;
}

export default usePlayerStore;
