/**
 * 唯一 id 生成。基于 `nanoid`，统一项目内的 id 生成入口。
 */

import { customAlphabet, nanoid } from 'nanoid';

/** 牌 id 用的短字母表，保证可读性（避免易混淆字符） */
const SHORT_ALPHABET: string = '23456789abcdefghjkmnpqrstuvwxyz';

/** 生成 4 位短 id 的函数 */
const shortId = customAlphabet(SHORT_ALPHABET, 4);

/**
 * 生成通用实体 id（ModelConfig / AIPlayer / Room / ThinkingLog 等）。
 *
 * @param prefix 可选前缀，便于日志中辨识来源
 * @returns 形如 `cfg_V1StGXR8_Z5jdHi6B` 的字符串
 */
export function createId(prefix: string = ''): string {
  const raw: string = nanoid(16);
  return prefix.length > 0 ? `${prefix}_${raw}` : raw;
}

/**
 * 生成牌的唯一 id。
 *
 * 格式为 `{suit}-{rank}-{short}`，如 `SPADE-3-a1b2`。
 * 同 rank 同花色也不会重复，用于在手牌中精确定位实例。
 *
 * @param suit 花色
 * @param rank 等级 3~17
 * @returns 全局唯一的牌 id
 */
export function createCardId(suit: string, rank: number): string {
  return `${suit}-${rank}-${shortId()}`;
}

/**
 * 生成 4 位短随机串，供需要轻量唯一后缀的场景使用。
 */
export function createShortId(): string {
  return shortId();
}
