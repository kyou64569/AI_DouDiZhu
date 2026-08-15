/**
 * 游戏状态相关类型（DESIGN §4.3）。
 * 字段名为 QA 测试与 AI 提示词的共同依赖，不得擅自修改。
 */

import type { Card, HandPattern } from './card';

/** 游戏阶段状态机 */
export enum GamePhase {
  /** 未开始 */
  IDLE = 'IDLE',
  /** 发牌中 */
  DEALING = 'DEALING',
  /** 叫分中 */
  BIDDING = 'BIDDING',
  /** 出牌中 */
  PLAYING = 'PLAYING',
  /** 已结算 */
  SETTLED = 'SETTLED',
}

/** 座位索引：0 / 1 / 2 */
export type SeatIndex = 0 | 1 | 2;

/** 玩家类型 */
export type PlayerKind = 'HUMAN' | 'AI';

/** 对局中的玩家 */
export interface Player {
  /** 座位索引 */
  seat: SeatIndex;
  /** 展示名称 */
  name: string;
  /** 人类 or AI */
  kind: PlayerKind;
  /** AI 玩家配置 id（kind 为 AI 时必填，关联 AIPlayer.id） */
  aiPlayerId?: string;
  /** 头像 emoji 或 URL（取自绑定的 AIPlayer 配置；未配置时由渲染端按 kind 回退） */
  avatar?: string;
  /** 当前手牌 */
  hand: Card[];
  /** 是否地主 */
  isLandlord: boolean;
}

/** 一次出牌记录（过牌时 cards 为空、pattern 为 null） */
export interface PlayRecord {
  seat: SeatIndex;
  cards: Card[];
  /** 过牌时为 null */
  pattern: HandPattern | null;
  /** 是否为「过」 */
  isPass: boolean;
  /** 回合序号，从 0 递增 */
  turn: number;
  /** AI 思考过程（决策理由）。仅 AI 决策时由驱动器填充，人类出牌为 undefined。可选字段，旧历史记录可能缺失。 */
  reason?: string;
}

/** 叫分值：0 表示不叫 */
export type BidScore = 0 | 1 | 2 | 3;

/** 叫分记录 */
export interface BidRecord {
  seat: SeatIndex;
  /** 0 表示不叫，1/2/3 为叫分 */
  score: BidScore;
  /** AI 叫分思考过程（决策理由），可选字段，人类/旧记录可能缺失 */
  reason?: string;
}

/** 倍数构成的单项明细 */
export interface MultiplierDetailItem {
  /** 倍数来源描述，如「炸弹」「春天」 */
  reason: string;
  /** 该项的倍数因子 */
  factor: number;
}

/** 结算结果 */
export interface SettlementResult {
  /** 地主是否获胜 */
  landlordWin: boolean;
  /** 底分（最高叫分） */
  baseScore: number;
  /** 最终倍数 */
  multiplier: number;
  /** 单局基础分 = baseScore * multiplier */
  unitScore: number;
  /** 各座位得分，正数为赢负数为输，索引即 seat */
  seatScores: [number, number, number];
  /** 是否春天 */
  isSpring: boolean;
  /** 是否反春天 */
  isAntiSpring: boolean;
  /** 倍数构成明细，用于结算弹窗展示 */
  multiplierDetail: MultiplierDetailItem[];
}

/** 游戏总状态（gameStore 的 state 形状） */
export interface GameState {
  phase: GamePhase;
  /** 三个玩家，索引即 seat */
  players: [Player, Player, Player];
  /** 3 张底牌 */
  bottomCards: Card[];
  /** 底牌是否已明牌（定地主后为 true，PRD D5） */
  bottomRevealed: boolean;
  /** 地主座位，未定为 null */
  landlordSeat: SeatIndex | null;
  /** 当前轮到的座位 */
  currentSeat: SeatIndex;
  /** 场上最近一手有效出牌（非过牌），无则 null */
  lastPlay: PlayRecord | null;
  /** 当前是否自由出牌（无需压过上家） */
  isFreeTurn: boolean;
  /** 全部出牌历史 */
  playHistory: PlayRecord[];
  /** 叫分记录 */
  bidHistory: BidRecord[];
  /** 当前最高叫分 */
  highestBid: number;
  /** 叫分起始座位 */
  biddingStartSeat: SeatIndex;
  /** 底分 */
  baseScore: number;
  /** 当前倍数 */
  multiplier: number;
  /** 结算结果，未结算为 null */
  settlement: SettlementResult | null;
  /** 回合计数 */
  turn: number;
}
