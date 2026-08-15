/**
 * 对局历史 store（前端 localStorage 持久化，后端不碰持久化）。
 *
 * 职责：
 *  - 启动时从 `dz.history` 载入已存记录（经类型守卫过滤，防篡改致白屏）；
 *  - addRecord 追加新局并写回，封顶 MAX_RECORDS 避免 localStorage 膨胀；
 *  - clear 清空全部记录；
 *  - 导出纯函数 computeLeaderboard，按「模型 / 人类」聚合净胜分与胜率，供战绩页排行。
 *
 * 不依赖 gameStore，避免循环依赖；gameStore 反向依赖本模块完成落库。
 */

import { create } from 'zustand';
import { isNonEmptyString, isPlainObject, readArray, STORAGE_KEYS, writeJson } from './persist';
import type { GameRecord, LeaderboardEntry } from '@/types/history';
import type { SeatIndex } from '@/types/game';

/** 最多保留多少局（超出丢弃最旧） */
const MAX_RECORDS = 100;

/** 人类座位的聚合键（与人类 model 字段的 null 区分） */
const HUMAN_KEY = '__human__';

function isSeatIndex(value: unknown): value is SeatIndex {
  return value === 0 || value === 1 || value === 2;
}

function isPlayerKind(value: unknown): value is 'HUMAN' | 'AI' {
  return value === 'HUMAN' || value === 'AI';
}

/**
 * 单条 GameRecord 的类型守卫（防 localStorage 被篡改后页面崩溃）。
 * 不深挖 playHistory / bidHistory 内部（Card 为普通对象），只确保关键结构齐备。
 */
export function isGameRecord(value: unknown): value is GameRecord {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (typeof value.finishedAt !== 'number' || !Number.isFinite(value.finishedAt)) return false;
  if (value.mode !== 'HUMAN_VS_AI' && value.mode !== 'AI_SPECTATE') return false;
  if (!Array.isArray(value.seats) || value.seats.length !== 3) return false;
  for (const s of value.seats) {
    if (!isPlainObject(s)) return false;
    if (!isSeatIndex(s.seat)) return false;
    if (!isPlayerKind(s.kind)) return false;
    if (typeof s.name !== 'string') return false;
    if (typeof s.score !== 'number') return false;
    if (s.model !== null && typeof s.model !== 'string') return false;
  }
  if (!Array.isArray(value.bidHistory)) return false;
  if (!Array.isArray(value.playHistory)) return false;
  return true;
}

/** 从 localStorage 载入记录，按结束时间倒序（最新在前） */
function loadRecords(): GameRecord[] {
  const valid: GameRecord[] = readArray<GameRecord>(STORAGE_KEYS.HISTORY, isGameRecord);
  return valid
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, MAX_RECORDS);
}

/**
 * 由多条对局记录聚合出模型排行榜。
 *
 * 聚合口径（用户需求「看哪个模型最厉害」）：
 *  - 按「模型 id」聚合（人类统一为一组）；
 *  - totalScore = 该身份所有对局得分求和（净胜分，越高越强）；
 *  - wins = 该身份得分 > 0 的局数；winRate = wins / games；
 *  - 排序：先按 totalScore 降序，再按 wins 降序。
 */
export function computeLeaderboard(records: GameRecord[]): LeaderboardEntry[] {
  const map = new Map<string, { label: string; totalScore: number; games: number; wins: number }>();

  const bump = (key: string, label: string) => {
    let entry = map.get(key);
    if (!entry) {
      entry = { label, totalScore: 0, games: 0, wins: 0 };
      map.set(key, entry);
    }
    return entry;
  };

  for (const rec of records) {
    for (const seat of rec.seats) {
      const key: string = seat.model ?? HUMAN_KEY;
      const entry = bump(key, seat.model ?? '人类');
      entry.games += 1;
      entry.totalScore += seat.score;
      if (seat.score > 0) {
        entry.wins += 1;
      }
    }
  }

  const entries: LeaderboardEntry[] = [];
  for (const [key, entry] of map) {
    entries.push({
      key,
      label: entry.label,
      totalScore: entry.totalScore,
      games: entry.games,
      wins: entry.wins,
      winRate: entry.games > 0 ? entry.wins / entry.games : 0,
    });
  }

  entries.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.wins - a.wins;
  });
  return entries;
}

/** 人类身份的常量键（供 UI 判断） */
export const HUMAN_LEADERBOARD_KEY = HUMAN_KEY;

interface HistoryStoreState {
  /** 全部对局记录（最新在前） */
  records: GameRecord[];
  /** 追加一局 */
  addRecord: (record: GameRecord) => void;
  /** 清空全部 */
  clear: () => void;
}

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  records: loadRecords(),

  addRecord: (record: GameRecord) => {
    if (!isGameRecord(record)) {
      return;
    }
    const next: GameRecord[] = [record, ...get().records].slice(0, MAX_RECORDS);
    set({ records: next });
    writeJson(STORAGE_KEYS.HISTORY, next);
  },

  clear: () => {
    set({ records: [] });
    writeJson(STORAGE_KEYS.HISTORY, []);
  },
}));
