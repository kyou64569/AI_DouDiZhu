/**
 * 对局历史记录类型（前端 localStorage 持久化，后端不碰持久化）。
 *
 * 设计要点：
 * - 每局结束时由 gameStore.settle() 构造一条 GameRecord 并存入 historyStore；
 * - 存储的是「结算快照 + 可展开摘要」（bidHistory / playHistory 原样保留，
 *   但 UI 只做静态文本展示，不做逐手动画复盘）；
 * - 排行榜 LeaderboardEntry 由多条 GameRecord 聚合得到，不单独存储。
 */

import type {
  BidRecord,
  PlayRecord,
  SeatIndex,
  SettlementResult,
  PlayerKind,
} from './game';
import type { RoomMode } from './config';

/** 单座位在本局中的决策质量统计（建议清单 #9；人类座位 / 旧记录缺失） */
export interface SeatDecisionStats {
  /** 决策总次数（出牌 + 叫分） */
  decisions: number;
  /** LLM 正常决策次数（source === LLM） */
  llmDecisions: number;
  /** 降级兜底决策次数（source 以 FALLBACK_ 开头） */
  fallbackDecisions: number;
  /** 决策平均耗时（毫秒） */
  avgDecisionMs: number;
}

/** 单座位在本局中的摘要信息 */
export interface SeatSummary {
  /** 座位索引 */
  seat: SeatIndex;
  /** 展示名称 */
  name: string;
  /** 人类 or AI */
  kind: PlayerKind;
  /** 头像 emoji 或 URL（结算时从 AIPlayer 配置快照，未配置时为空、由渲染端按 kind 回退） */
  avatar?: string;
  /** 绑定的 AI 玩家配置 id（kind 为 AI 时填写）。渲染端可据此实时取 AI 玩家页配置的头像，
   * 这样即便旧记录未存 avatar，也能按用户配置还原各自头像，而不是统一回退到 🤖。 */
  aiPlayerId?: string;
  /** 是否地主 */
  isLandlord: boolean;
  /** AI 玩家绑定的模型 id；人类座位为 null */
  model: string | null;
  /** 本局得分（来自 settlement.seatScores，正赢负输） */
  score: number;
  /** AI 决策质量统计（建议清单 #9；人类座位与旧记录为 undefined） */
  stats?: SeatDecisionStats;
}

/** AI 复盘中被选中点评的关键手（建议清单 #8） */
export interface AIReviewHand {
  /** 行动座位 */
  seat: SeatIndex;
  /** 该手在 playHistory 中的下标（0 基）。与回放页帧编号同口径；不是回合计数（含过牌会跳号） */
  playIndex: number;
  /** 出牌描述（含牌型名，如「出 33 55（连对）」） */
  play: string;
  /** 模型当时的决策理由 */
  reason: string;
  /** 该手是否发生了降级兜底 */
  degraded: boolean;
  /** 该手的降级 / 告警信息 */
  warnings: string[];
}

/** AI 复盘结果（结算后异步生成，建议清单 #8） */
export interface AIReview {
  /** pending=生成中；done=成功；failed=失败（含不可用） */
  status: 'pending' | 'done' | 'failed';
  /** 执行复盘的模型 id */
  model?: string;
  /** 被复盘的关键手（与 comments 一一对应） */
  hands?: AIReviewHand[];
  /** 总体评价 */
  summary?: string;
  /** 逐手点评 */
  comments?: string[];
  /** 失败原因 */
  error?: string;
  /** 生成时间戳 */
  generatedAt: number;
}

/** 两个模型同场对战的 H2H 战绩（建议清单 #9） */
export interface HeadToHeadEntry {
  /** 模型 A id（与 modelB 按字典序固定方向，保证聚合稳定） */
  modelA: string;
  /** 模型 B id */
  modelB: string;
  /** A 净胜分高于 B 的局数 */
  aWins: number;
  /** B 高于 A 的局数 */
  bWins: number;
  /** 同分的局数 */
  draws: number;
  /** 同场对局总数 */
  games: number;
}

/** 一局完整记录 */
export interface GameRecord {
  /** 唯一 id（时间戳 + 随机串），用于 key 与去重 */
  id: string;
  /** 结束时间戳（ms） */
  finishedAt: number;
  /** 对局模式 */
  mode: RoomMode;
  /** 地主是否获胜 */
  landlordWin: boolean;
  /** 获胜方座位（地主座位或某农民座位，用于列表展示「谁赢了」） */
  winnerSeat: SeatIndex;
  /** 底分（最高叫分） */
  baseScore: number;
  /** 最终倍数 */
  multiplier: number;
  /** 单局基础分 = baseScore * multiplier */
  unitScore: number;
  /** 是否春天 */
  isSpring: boolean;
  /** 是否反春天 */
  isAntiSpring: boolean;
  /** 倍数构成明细 */
  multiplierDetail: SettlementResult['multiplierDetail'];
  /** 三家摘要 */
  seats: SeatSummary[];
  /** 叫分记录 */
  bidHistory: BidRecord[];
  /** 出牌记录（每手 who / cards / pattern / isPass） */
  playHistory: PlayRecord[];
  /** AI 复盘（结算后异步生成并回填；未生成 / 不可用为 undefined，建议清单 #8） */
  aiReview?: AIReview;
}

/** 模型排行榜条目（由 GameRecord[] 聚合） */
export interface LeaderboardEntry {
  /** 聚合键：模型 id；人类统一为 '__human__' */
  key: string;
  /** 展示名：模型 id，人类为「人类」 */
  label: string;
  /** 累计净胜分（所有对局该身份得分求和） */
  totalScore: number;
  /** 参与座位局数 */
  games: number;
  /** 获胜局数（该身份得分 > 0） */
  wins: number;
  /** 胜率 0~1 */
  winRate: number;
  /** LLM 决策成功率（source===LLM 的比例）；无决策数据为 null（建议清单 #9） */
  llmSuccessRate: number | null;
  /** LLM 决策平均耗时（毫秒）；无决策数据为 null */
  avgLatencyMs: number | null;
  /** 降级兜底决策累计次数 */
  fallbackCount: number;
}
