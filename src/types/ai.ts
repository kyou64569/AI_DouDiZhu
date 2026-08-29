/**
 * AI 决策与思考日志类型（DESIGN §4.5）。
 */

import type { Card } from './card';
import type { BidRecord, BidScore, PlayRecord, SeatIndex } from './game';
import type { Difficulty, Personality, ThinkingMode } from './config';

/** 决策来源 —— 用于日志标注与 QA 判断降级是否生效 */
export enum DecisionSource {
  /** LLM 正常返回且校验通过 */
  LLM = 'LLM',
  /** LLM 返回非法，兜底出最小合法牌 */
  FALLBACK_MINIMAL = 'FALLBACK_MINIMAL',
  /** LLM 返回非法且无合法牌可出，兜底过牌 */
  FALLBACK_PASS = 'FALLBACK_PASS',
  /** 请求超时或网络错误后兜底 */
  FALLBACK_ERROR = 'FALLBACK_ERROR',
}

/** LLM 原始返回结构（约定的 JSON 契约，PRD D4） */
export interface AIRawResponse {
  /** "play" 出牌 | "pass" 过牌 */
  action: 'play' | 'pass';
  /** 牌面标签数组，如 ["3","3","K"]；pass 时为空 */
  cards: string[];
  /** 决策理由，展示于思考日志（REQ-U2） */
  reason: string;
}

/** AI 最终决策（编排层输出，store 消费） */
export interface AIDecision {
  /** 是否过牌 */
  isPass: boolean;
  /** 要出的真实 Card 实例（已映射到手牌） */
  cards: Card[];
  /** 决策理由 */
  reason: string;
  /** 决策来源，标识是否走了降级 */
  source: DecisionSource;
  /** 降级过程中记录的告警，供日志展示 */
  warnings: string[];
  /** 本次决策耗时（毫秒） */
  latencyMs: number;
}

/** 日志级别 */
export type LogLevel = 'info' | 'warn' | 'error';

/** 思考日志条目（REQ-U2） */
export interface ThinkingLog {
  id: string;
  seat: 0 | 1 | 2;
  playerName: string;
  /** 日志级别 */
  level: LogLevel;
  /** 正文 */
  message: string;
  /** 决策来源，非决策类日志为 undefined */
  source?: DecisionSource;
  timestamp: number;
}

/** AI 决策轨迹（aiAct 逐次采集，用于复盘选手与决策质量统计，建议清单 #8/#9） */
export interface AIDecisionTrace {
  /** 决策座位 */
  seat: SeatIndex;
  /** 阶段 */
  phase: 'bid' | 'play';
  /** 出牌阶段的回合序号（对应 playHistory.turn）；叫分阶段为 -1 */
  turn: number;
  /** 是否过牌 */
  isPass: boolean;
  /** 拟出牌张数（过牌为 0） */
  cardCount: number;
  /** 决策来源（LLM / FALLBACK_*） */
  source: DecisionSource;
  /** 降级 / 告警信息 */
  warnings: string[];
  /** 决策理由 */
  reason: string;
  /** 决策耗时（毫秒） */
  latencyMs: number;
}

/* =============================================================================
 * AI 驱动器契约 —— T04（gameStore）与 T05（aiOrchestrator）的唯一交汇点。
 * 本段由主理人锁定，T04 与 T05 均只读引用，任何一方不得修改字段名或签名。
 * 设计意图：gameStore 不直接 import ai/ 模块，而是接受注入的驱动器函数，
 * 从而使 T04 与 T05 可完全并行开发，且 T04 单独交付即可跑通完整对局。
 * ========================================================================== */

/** AI 调用 LLM 所需的模型绑定信息（由 aiPlayerId 解析得到，扁平传递） */
export interface AIModelBinding {
  /** 服务 Base URL */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 具体模型 id */
  model: string;
  /** 思考模式（推理强度），缺省回落 'auto' */
  thinkingMode?: ThinkingMode;
  /** 采样温度 0~2，缺省回落 0.3 */
  temperature?: number;
  /** 决策难度（简单/普通/困难/大师），缺省回落 normal；影响温度、思考强度与提示词分层 */
  difficulty?: Difficulty;
  /** 决策性格（激进/均衡/保守），缺省回落 balanced；注入提示词影响风格 */
  personality?: Personality;
}

/** 日志回调：编排层向外吐日志，由调用方决定写到哪里 */
export type AILogSink = (log: Omit<ThinkingLog, 'id' | 'timestamp'>) => void;

/** AI 出牌决策的输入快照（纯数据，不含任何 store 实例） */
export interface AIPlayInput {
  /** 决策者座位 */
  seat: SeatIndex;
  /** 决策者展示名 */
  playerName: string;
  /** 模型绑定；为 null 时编排层直接走本地兜底策略 */
  binding: AIModelBinding | null;
  /** 决策者当前手牌 */
  hand: Card[];
  /** 地主座位 */
  landlordSeat: SeatIndex;
  /** 已明牌的底牌 */
  bottomCards: Card[];
  /** 三家手牌数，索引即 seat */
  handCounts: [number, number, number];
  /** 场上最近一手有效出牌，无则 null */
  lastPlay: PlayRecord | null;
  /** 是否自由出牌（无需压过上家） */
  isFreeTurn: boolean;
  /** 完整出牌历史 */
  playHistory: PlayRecord[];
  /** 当前倍数 */
  multiplier: number;
  /** 底分 */
  baseScore: number;
  /** 硬超时毫秒，默认 8000（PRD D4） */
  timeoutMs?: number;
  /** 日志回调 */
  onLog?: AILogSink;
  /** 外部中止信号（H1：对局切换时中止在途 LLM 请求） */
  signal?: AbortSignal;
}

/** AI 叫分决策的输入快照 */
export interface AIBidInput {
  seat: SeatIndex;
  playerName: string;
  binding: AIModelBinding | null;
  /** 决策者当前 17 张手牌 */
  hand: Card[];
  /** 已产生的叫分记录 */
  bidHistory: BidRecord[];
  /** 当前最高叫分，无人叫为 0 */
  highestBid: number;
  timeoutMs?: number;
  onLog?: AILogSink;
  /** 外部中止信号（H1：对局切换时中止在途 LLM 请求） */
  signal?: AbortSignal;
}

/** AI 叫分决策结果 */
export interface AIBidDecision {
  /** 叫分值，0 表示不叫 */
  score: BidScore;
  /** 决策理由 */
  reason: string;
  /** 决策来源 */
  source: DecisionSource;
  /** 降级告警 */
  warnings: string[];
  /** 耗时毫秒 */
  latencyMs: number;
}

/** 出牌驱动器函数签名 */
export type AIPlayDriver = (input: AIPlayInput) => Promise<AIDecision>;

/** 叫分驱动器函数签名 */
export type AIBidDriver = (input: AIBidInput) => Promise<AIBidDecision>;
