/**
 * 游戏状态机（T04 核心，DESIGN §4.3 / §T04）。
 *
 * 职责：
 *  - 发牌、叫分、出牌/过牌、回合流转、倍数结算的全状态编排；
 *  - 通过「注入式 AI 驱动器」驱动 AI 决策，**不 import `src/ai/`**，
 *    从而保证 T04 单独交付即可用本地兜底驱动跑通完整对局（见 §四 架构决策）；
 *  - 人类出牌/过牌/提示/选牌的交互状态也在此统一管理。
 *
 * 依赖方向：
 *  - 只读 `roomStore`（房间快照）、`playerStore`（AI 玩家展示名）；
 *  - 通过 `registerAIDrivers` 接受 T05 注入的 LLM 驱动器；
 *  - 不直接触碰 `logStore`（T05 负责，避免循环依赖）。
 *
 * 状态形状严格遵循 `src/types/game.ts` 的 `GameState`，QA 与 AI 提示词均依赖这些字段名；
 * 额外增加的 UI 态字段（选牌、人类座位等）为只读辅助，不影响契约字段。
 */

import { create } from 'zustand';
import type { Card, HandPattern } from '@/types/card';
import { CardType } from '@/types/card';
import {
  GamePhase,
  type BidScore,
  type BidRecord,
  type GameState,
  type Player,
  type PlayRecord,
  type SeatIndex,
  type SettlementResult,
} from '@/types/game';
import type { Room, RoomMode, Seat, Persona } from '@/types/config';
import {
  calculateSettlement,
  createShuffledDeal,
  findHints,
  findMinimalPlay,
  getLegalBids,
  getNextBidder,
  isBiddingFinished,
  removeCards,
  resolveBidding,
  validatePass,
  validatePlay,
} from '@/engine';
import {
  DecisionSource,
  type AIPlayDriver,
  type AIBidDriver,
  type AIPlayInput,
  type AIBidInput,
  type AIDecision,
  type AIBidDecision,
  type AIModelBinding,
} from '@/types/ai';
import { useRoomStore } from './roomStore';
import { usePlayerStore } from './playerStore';
import { useConfigStore } from './configStore';
import { useHistoryStore } from './historyStore';
import { resolveTimeoutMs } from './settingsStore';
import { isThinkingEnabled } from '@/ai/thinking';
import { logSink } from './logStore';
import { playSfx, startBackground, stopBackground, speak } from '@/audio/soundService';
import { describePlay, describePass } from '@/audio/cardSpeech';
import {
  generateBanter,
  templateBanter,
  getCachedBanter,
  warmBanterPool,
  resetBanterPool,
  type BanterEvent,
  type BanterContext,
} from '@/audio/banter';
import { toast } from '@/components/common/Toast';
import type { GameRecord, SeatSummary } from '@/types/history';

/**
 * 解析某座位 AI 玩家的模型绑定。
 *
 * 解析链：`Player.aiPlayerId` → `AIPlayer` → `ModelConfig` → `AIModelBinding`。
 * 任一环缺失（玩家被删、配置被删、未拉取模型）都返回 null，
 * 编排层收到 null 会走本地兜底策略并在思考日志中说明原因，不会中断对局。
 *
 * 注意：`AIPlayer.modelId` 用于覆盖配置的默认模型，未设置时回落 `selectedModel`。
 */
function resolveBinding(aiPlayerId: string | undefined): AIModelBinding | null {
  if (!aiPlayerId) {
    return null;
  }
  const player = usePlayerStore.getState().getPlayer(aiPlayerId);
  if (!player) {
    return null;
  }
  const config = useConfigStore.getState().getConfig(player.modelConfigId);
  if (!config) {
    return null;
  }
  const model: string = player.modelId ?? config.selectedModel;
  if (!config.baseUrl || !config.apiKey || !model) {
    return null;
  }
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model,
    thinkingMode: config.thinkingMode,
    temperature: config.temperature,
  };
}

/**
 * 仅解析某 ModelConfig 的 baseUrl / apiKey 凭证（不含聊天模型）。
 * 用于 TTS 这类只需要密钥 / 服务商、不需要聊天模型的服务，
 * 使 TTS 可以使用与聊天配置不同的密钥。
 *
 * @param configId 模型配置 id（可为 undefined，表示回落到聊天配置）
 */
function resolveConfigCredential(configId: string | undefined): { baseUrl: string; apiKey: string } | null {
  if (!configId) {
    return null;
  }
  const config = useConfigStore.getState().getConfig(configId);
  if (!config) {
    return null;
  }
  if (!config.baseUrl || !config.apiKey) {
    return null;
  }
  return { baseUrl: config.baseUrl, apiKey: config.apiKey };
}

// =============================================================================
// 语音台词：解析说话者 + 生成并播报（趣味核心，不属于 src/ai 决策驱动器）
// =============================================================================

/** 未显式配置音色时，按座位分配的不同默认音色（保证三家一听就分得清） */
const DEFAULT_SEAT_VOICE: Record<SeatIndex, string> = { 0: 'onyx', 1: 'nova', 2: 'alloy' };

/** 未显式配置 TTS 模型名时的默认模型 */
const DEFAULT_TTS_MODEL_NAME: string = 'tts-1';

/** 催促去重键（每回合只催一次） */
let urgedTurnKey: string | null = null;

/** 解析某座位的「说话者」信息：名字、模型绑定、音色、人设 */
function resolveSpeaker(seat: SeatIndex): {
  name: string;
  /** 聊天（AI 思考 + 台词文本生成）绑定 */
  binding: AIModelBinding | null;
  /** TTS 合成专用凭证（与聊天配置解耦，可来自不同的密钥 / 服务商） */
  ttsBaseUrl?: string;
  ttsApiKey?: string;
  voice?: string;
  ttsModel?: string;
  persona: Persona;
} | null {
  const st = useGameStore.getState();
  const player = st.players[seat];
  if (!player) return null;
  const aiId = player.aiPlayerId;
  const binding = aiId ? resolveBinding(aiId) : null;
  const aiPlayer = aiId ? usePlayerStore.getState().getPlayer(aiId) : null;
  // TTS 凭证：优先用玩家单独指定的 ttsConfigId，否则回落到聊天配置
  const ttsCred = resolveConfigCredential(aiPlayer?.ttsConfigId ?? aiPlayer?.modelConfigId);
  return {
    name: player.name,
    binding,
    ttsBaseUrl: ttsCred?.baseUrl,
    ttsApiKey: ttsCred?.apiKey,
    voice: aiPlayer?.voice ?? DEFAULT_SEAT_VOICE[seat],
    ttsModel: aiPlayer?.ttsModel ?? DEFAULT_TTS_MODEL_NAME,
    persona: aiPlayer?.persona ?? 'steady',
  };
}

/**
 * 触发某座位的台词：有云端音色则云端 TTS，否则浏览器念模板。
 * 全程异步、失败回退，绝不影响对局状态。
 *
 * 延迟关键的「方案 B」分层（避免上一版「逐次调 LLM 导致下家已出牌本家才出声」）：
 *  - play（出牌）：最高频且必须报牌 → 用「人设模板 + 牌面」，零 LLM 延迟、必含牌面；
 *  - pass / taunt / slow（过牌 / 嘲讽 / 催促）：优先取「开局预热的 LLM 台词池」（即时），
 *    池空再走原 LLM 生成，再否则人设模板；
 *  - bomb / win / lose（炸弹 / 胜负）：低频、允许稍慢，走原 LLM 生成保留戏剧性。
 */
function triggerBanter(seat: SeatIndex, event: BanterEvent, ctx?: BanterContext): void {
  const speaker = resolveSpeaker(seat);
  if (!speaker) return;
  const baseCtx: BanterContext = { ...ctx, selfName: speaker.name };
  // TTS 凭证（baseUrl/apiKey）与聊天配置解耦：可单独指定 ttsConfigId 用不同密钥的 TTS 服务。
  const canSpeakCloud = Boolean(speaker.ttsBaseUrl && speaker.ttsApiKey && speaker.voice);
  const speakOpts = canSpeakCloud
    ? { voiceId: speaker.voice, model: speaker.ttsModel, baseUrl: speaker.ttsBaseUrl, apiKey: speaker.ttsApiKey }
    : undefined;

  // 出牌：高频 + 必须报牌，用「人设模板 + 牌面」，跳过 LLM（零延迟、必含牌面）
  if (event === 'play') {
    speak(templateBanter('play', speaker.persona, baseCtx), speakOpts);
    return;
  }

  // 过牌：优先预热 LLM 池（即时），否则人设模板
  if (event === 'pass') {
    const cached = getCachedBanter('pass', speaker.persona);
    speak(cached ?? templateBanter('pass', speaker.persona, baseCtx), speakOpts);
    return;
  }

  // 催促 / 嘲讽：优先预热 LLM 池（即时），池空再走原 LLM 生成，再否则模板
  if (event === 'taunt' || event === 'slow') {
    const cached = getCachedBanter(event, speaker.persona);
    if (cached) {
      speak(cached, speakOpts);
      return;
    }
    if (canSpeakCloud && speaker.binding) {
      void (async () => {
        let text: string;
        try {
          text = await generateBanter({
            event,
            persona: speaker.persona,
            binding: speaker.binding as AIModelBinding,
            ctx: baseCtx,
          });
        } catch {
          text = templateBanter(event, speaker.persona, baseCtx);
        }
        speak(text, speakOpts);
      })();
      return;
    }
    speak(templateBanter(event, speaker.persona, baseCtx), speakOpts);
    return;
  }

  // 炸弹 / 胜负：低频、允许稍慢，走原 LLM 生成（保留戏剧性），失败回模板
  if (canSpeakCloud && speaker.binding) {
    void (async () => {
      let text: string;
      try {
        text = await generateBanter({
          event,
          persona: speaker.persona,
          binding: speaker.binding as AIModelBinding,
          ctx: baseCtx,
        });
      } catch {
        text = templateBanter(event, speaker.persona, baseCtx);
      }
      speak(text, speakOpts);
    })();
  } else {
    speak(templateBanter(event, speaker.persona, baseCtx), speakOpts);
  }
}

/** 开局时为所有 AI 玩家（按人设去重）后台预热「过牌 / 嘲讽 / 催促」台词池 */
function warmBanterForSeats(): void {
  resetBanterPool();
  const st = useGameStore.getState();
  const seen = new Set<string>();
  for (const player of st.players) {
    if (player.kind !== 'AI' || !player.aiPlayerId) continue;
    const binding = resolveBinding(player.aiPlayerId);
    if (!binding) continue;
    const aiPlayer = usePlayerStore.getState().getPlayer(player.aiPlayerId);
    const persona = aiPlayer?.persona ?? 'steady';
    for (const evt of ['pass', 'taunt', 'slow'] as BanterEvent[]) {
      const key = `${persona}|${evt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warmBanterPool(evt, persona, binding, 4);
    }
  }
}

/** 出牌播报：AI 用台词（含牌面），人类用浏览器念报牌 */
function announcePlay(seat: SeatIndex, playPattern: HandPattern): void {
  const cardText: string = describePlay(playPattern);
  const st = useGameStore.getState();
  if (st.players[seat].kind === 'AI') {
    triggerBanter(seat, 'play', { cardText });
  } else {
    speak(cardText);
  }
}

/** 叫分阶段播报：AI 用台词（含分值），人类用浏览器念报分 */
function announceBid(seat: SeatIndex, score: BidScore, isGrab: boolean): void {
  const speaker = resolveSpeaker(seat);
  if (!speaker) return;
  const canSpeakCloud = Boolean(speaker.ttsBaseUrl && speaker.ttsApiKey && speaker.voice);
  const speakOpts = canSpeakCloud
    ? { voiceId: speaker.voice, model: speaker.ttsModel, baseUrl: speaker.ttsBaseUrl, apiKey: speaker.ttsApiKey }
    : undefined;
  const baseCtx: BanterContext = { selfName: speaker.name, bidScore: score };
  let text: string;
  if (score === 0) {
    text = templateBanter('bidpass', speaker.persona, baseCtx);
  } else {
    const verb: string = isGrab ? '抢' : '叫';
    text = verb + templateBanter('bid', speaker.persona, baseCtx);
  }
  speak(text, speakOpts);
}

/** 人类回合倒计时秒数（PRD D4） */
export const HUMAN_TURN_SECONDS: number = 30;

/** 观战模式 AI 行动节流（毫秒），保证可看清每一步 */
export const SPECTATE_STEP_MS: number = 950;

/** 人机模式 AI 行动延迟（毫秒） */
export const AI_STEP_MS: number = 700;

/** 连续流局（全员不叫）达到此阈值后强制产生地主，避免无限重发 */
const MAX_REDEAL: number = 6;

// =============================================================================
// 兜底本地驱动器（不放在 src/ai/，由本文件内置，保证 T04 可独立跑通）
// =============================================================================

/**
 * 本地出牌兜底：自由出牌出最小合法牌；需压牌时出能压过的最小合法牌，无解则过牌。
 */
async function localPlayDriver(input: AIPlayInput): Promise<AIDecision> {
  const { hand, isFreeTurn, lastPlay } = input;
  const target: HandPattern | null = isFreeTurn ? null : lastPlay ? lastPlay.pattern : null;
  const play: Card[] | null = findMinimalPlay(hand, target);
  if (play === null) {
    return {
      isPass: true,
      cards: [],
      reason: '本地策略：无牌可压，过牌',
      source: DecisionSource.FALLBACK_PASS,
      warnings: [],
      latencyMs: 0,
    };
  }
  return {
    isPass: false,
    cards: play,
    reason: '本地策略：出最小可压牌',
    source: DecisionSource.FALLBACK_MINIMAL,
    warnings: [],
    latencyMs: 0,
  };
}

/**
 * 本地叫分兜底：按手牌强度（大小王 + 2 + 炸弹）简单打分，取合法叫分。
 * 必须调 `getLegalBids(highestBid)` 保证合法。
 */
async function localBidDriver(input: AIBidInput): Promise<AIBidDecision> {
  const { hand, highestBid } = input;

  let bombs = 0;
  const byRank = new Map<number, number>();
  for (const card of hand) {
    byRank.set(card.rank, (byRank.get(card.rank) ?? 0) + 1);
  }
  for (const count of byRank.values()) {
    if (count === 4) {
      bombs += 1;
    }
  }
  // 大小王（rank 16/17）每张 3 分，2（rank 15）每张 2 分，炸弹每个 4 分
  const jokers: number = hand.filter((card: Card): boolean => card.rank >= 16).length;
  const twos: number = hand.filter((card: Card): boolean => card.rank === 15).length;
  const strength: number = jokers * 3 + twos * 2 + bombs * 4 + (hand.length > 0 ? 1 : 0);

  let want: BidScore = 0;
  if (strength >= 9) {
    want = 3;
  } else if (strength >= 6) {
    want = 2;
  } else if (strength >= 3) {
    want = 1;
  }

  const legal: BidScore[] = getLegalBids(highestBid);
  let chosen: BidScore = 0;
  if (want > highestBid && legal.includes(want)) {
    chosen = want;
  }

  return {
    score: chosen,
    reason: `本地策略：手牌强度 ${strength}`,
    source: DecisionSource.FALLBACK_MINIMAL,
    warnings: [],
    latencyMs: 0,
  };
}

/** 当前生效的 AI 驱动器（默认本地兜底，T05 通过 registerAIDrivers 替换） */
let playDriver: AIPlayDriver = localPlayDriver;
let bidDriver: AIBidDriver = localBidDriver;

/**
 * T05 的 aiOrchestrator 启动时调用，将本地兜底驱动替换为 LLM 驱动。
 *
 * @param play 出牌驱动器
 * @param bid 叫分驱动器
 */
export function registerAIDrivers(play: AIPlayDriver, bid: AIBidDriver): void {
  playDriver = play;
  bidDriver = bid;
}

/** 恢复本地兜底驱动（测试 / 降级用） */
export function resetAIDrivers(): void {
  playDriver = localPlayDriver;
  bidDriver = localBidDriver;
}

/**
 * 状态推进游标。
 *
 * `aiAct` 在动作前后各取一次，字符串相同即代表「规则层拒绝了该动作、状态零变化」。
 * 之所以不看 `playCards` / `pass` 的返回值：`bid` 返回 void 无返回值可看，
 * 且驱动器抛异常时根本走不到调用点；只有比对状态本身才是可靠的推进判据。
 *
 * 一旦状态零变化，UI 侧 effect 依赖不变 ⇒ 定时器不再重挂 ⇒ 整局永久死锁，
 * 因此 `aiAct` 必须自己兜底把状态推动起来。
 */
function cursorOf(s: GameStoreState): string {
  return `${s.phase}|${s.currentSeat}|${s.bidHistory.length}|${s.playHistory.length}|${s.redealCount}|${s.turn}`;
}

/**
 * `aiAct` 重入锁。
 *
 * UI 定时器、兜底链、无头脚本都可能并发调用 `aiAct`；并发进入会让两个 await
 * 基于同一份旧快照决策，产生重复出牌或对错误座位下手。
 */
let aiActing: boolean = false;

/** 安全提取异常文本（驱动器可能 throw 任意值） */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 安全渲染牌面文本（坏驱动器可能返回 undefined / 残缺对象） */
function cardsText(cards: Card[] | undefined): string {
  if (!Array.isArray(cards) || cards.length === 0) {
    return '空';
  }
  return cards.map((c: Card): string => (c && c.label ? c.label : '?')).join(' ');
}

// =============================================================================
// 辅助函数
// =============================================================================

/** 构造空玩家占位（IDLE 阶段使用） */
function emptyPlayer(seat: SeatIndex): Player {
  return { seat, name: '', kind: 'AI', hand: [], isLandlord: false };
}

/** 依据房间座位构造对局三玩家（含 AI 展示名 / 头像解析） */
function buildPlayers(room: Room): [Player, Player, Player] {
  const names: Record<number, string> = {};
  const avatars: Record<number, string | undefined> = {};
  for (const seat of room.seats) {
    if (seat.kind === 'AI' && seat.aiPlayerId) {
      const found = usePlayerStore.getState().getPlayer(seat.aiPlayerId);
      names[seat.index] = found?.name ?? `AI-${seat.aiPlayerId.slice(0, 4)}`;
      avatars[seat.index] = found?.avatar;
    }
  }
  const make = (seat: Seat): Player => ({
    seat: seat.index,
    name: seat.kind === 'HUMAN' ? '我' : (names[seat.index] ?? `玩家${seat.index + 1}`),
    kind: seat.kind,
    aiPlayerId: seat.aiPlayerId,
    avatar: seat.kind === 'AI' ? (avatars[seat.index] ?? undefined) : undefined,
    hand: [],
    isLandlord: false,
  });
  return [make(room.seats[0]), make(room.seats[1]), make(room.seats[2])];
}

/** 取房间中的人类座位（无人类则返回 null，即观战模式） */
function humanSeatOf(room: Room): SeatIndex | null {
  const human = room.seats.find((s: Seat): boolean => s.kind === 'HUMAN');
  return human ? human.index : null;
}

/** 初始闲置状态（所有契约字段齐备，避免 QA 读到 undefined） */
const IDLE_STATE: GameState = {
  phase: GamePhase.IDLE,
  players: [emptyPlayer(0), emptyPlayer(1), emptyPlayer(2)],
  bottomCards: [],
  bottomRevealed: false,
  landlordSeat: null,
  currentSeat: 0,
  lastPlay: null,
  isFreeTurn: true,
  playHistory: [],
  bidHistory: [],
  highestBid: 0,
  biddingStartSeat: 0,
  baseScore: 0,
  multiplier: 1,
  settlement: null,
  turn: 0,
};

// =============================================================================
// Store 类型
// =============================================================================

/** gameStore 的完整 state 形状（GameState 契约 + UI 辅助态 + actions） */
export interface GameStoreState extends GameState {
  /** 人类座位；观战模式为 null */
  humanSeat: SeatIndex | null;
  /** 当前对局模式 */
  roomMode: RoomMode | null;
  /** 人类已选中的牌 id（与手牌实例对应） */
  selectedCardIds: string[];
  /** 提示循环索引，-1 表示尚未循环 */
  hintCycleIndex: number;
  /** 自动过牌开关：勾选后人类回合「要不起」时自动过牌（无需手动/AI） */
  autoPassEnabled: boolean;
  /** 流局重发计数 */
  redealCount: number;

  /** 从房间快照开始一局（房间为空时引导用户回房间页） */
  startGame: (room?: Room) => boolean;
  /** 人类点击叫分 */
  humanBid: (score: BidScore) => void;
  /** 统一叫分入口（人类或 AI 调用） */
  bid: (score: BidScore, seat?: SeatIndex, reason?: string) => void;
  /** 出牌（人类或 AI 调用），返回是否成功 */
  playCards: (cards: Card[], seat?: SeatIndex, reason?: string) => boolean;
  /** 过牌（人类或 AI 调用），返回是否成功 */
  pass: (seat?: SeatIndex, reason?: string) => boolean;
  /** 执行当前座位的 AI 决策（人类座位原地返回）。供 UI 定时器与无头测试驱动 */
  aiAct: () => Promise<void>;
  /** 切换一张牌的选中态 */
  toggleSelect: (cardId: string) => void;
  /** 清空选牌 */
  clearSelection: () => void;
  /** 人类点「出牌」：用当前选中的牌调用 playCards */
  playSelected: () => boolean;
  /** 人类点「过牌」 */
  passSelected: () => boolean;
  /** 人类点「提示」：循环切换一手合法牌到选中态 */
  applyHint: () => void;
  /** 倒计时归零自动处理：自由出牌则出最小牌，否则过牌 */
  autoTimeout: () => void;
  /** 人类出牌慢时，令某 AI 对手催促一次（去重） */
  urgeHuman: () => void;
  /** 切换自动过牌开关 */
  setAutoPassEnabled: (enabled: boolean) => void;
  /** 整体重置为闲置态 */
  resetGame: () => void;
}

// =============================================================================
// Store 实现
// =============================================================================

export const useGameStore = create<GameStoreState>((set, get) => {
  /** 进入出牌阶段：定地主、明牌底牌、地主并底牌、当前座位回到地主 */
  function startPlaying(landlordSeat: SeatIndex, baseScore: number): void {
    const st = get();
    const landlordHand: Card[] = [...st.players[landlordSeat].hand, ...st.bottomCards];
    const players: [Player, Player, Player] = [
      { ...st.players[0], isLandlord: st.players[0].seat === landlordSeat },
      { ...st.players[1], isLandlord: st.players[1].seat === landlordSeat },
      { ...st.players[2], isLandlord: st.players[2].seat === landlordSeat },
    ];
    players[landlordSeat] = { ...players[landlordSeat], hand: landlordHand };

    set({
      phase: GamePhase.PLAYING,
      landlordSeat,
      baseScore,
      bottomRevealed: true,
      players,
      currentSeat: landlordSeat,
      isFreeTurn: true,
      lastPlay: null,
      multiplier: 1,
      turn: 0,
      playHistory: [],
      selectedCardIds: [],
      hintCycleIndex: -1,
    });
    // 进入出牌阶段：起播循环背景音（受 soundService 内部解锁/开关约束）
    startBackground();
  }

  /** 回合计数的推进：连续两家 pass 后回到上一手出牌者，恢复自由出牌 */
  function advanceTurn(): void {
    const st = get();
    const candidate: SeatIndex = ((st.currentSeat + 1) % 3) as SeatIndex;
    // 当轮转回到「上一手有效出牌者」时，说明其余两家均已 pass —— 自由出牌
    if (st.lastPlay !== null && candidate === st.lastPlay.seat) {
      set({ currentSeat: candidate, isFreeTurn: true, lastPlay: null });
    } else {
      set({ currentSeat: candidate });
    }
  }

  /** 结算：计算并写入 SettlementResult，进入 SETTLED，并落库历史记录 */
  function settle(winnerSeat: SeatIndex): void {
    const st = get();
    const landlordWin: boolean = winnerSeat === (st.landlordSeat as SeatIndex);
    const settlement: SettlementResult = calculateSettlement({
      landlordSeat: st.landlordSeat as SeatIndex,
      landlordWin,
      baseScore: st.baseScore,
      playHistory: st.playHistory,
    });
    set({ phase: GamePhase.SETTLED, settlement });
    // 对局结束：停背景音，并按「人类是否获胜」播放胜负提示
    stopBackground();
    const humanSeat: SeatIndex | null = st.humanSeat;
    if (humanSeat === null || winnerSeat === humanSeat) {
      playSfx('win');
    } else {
      playSfx('lose');
    }
    // AI 玩家胜负台词（异步、失败自动回退模板）
    for (const p of st.players) {
      if (p.kind === 'AI') {
        triggerBanter(p.seat, p.seat === winnerSeat ? 'win' : 'lose');
      }
    }
    // 落库历史（玩家可回看牌局 / 累计模型积分）。失败不影响对局结束。
    try {
      const seats: SeatSummary[] = st.players.map((p, seat): SeatSummary => ({
        seat: seat as SeatIndex,
        name: p.name,
        kind: p.kind,
        avatar: p.avatar,
        aiPlayerId: p.aiPlayerId,
        isLandlord: p.isLandlord,
        model: p.kind === 'AI' ? (resolveBinding(p.aiPlayerId)?.model ?? null) : null,
        score: settlement.seatScores[seat],
      }));
      const record: GameRecord = {
        id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        finishedAt: Date.now(),
        mode: (st.roomMode ?? 'HUMAN_VS_AI') as GameRecord['mode'],
        landlordWin,
        winnerSeat,
        baseScore: settlement.baseScore,
        multiplier: settlement.multiplier,
        unitScore: settlement.unitScore,
        isSpring: settlement.isSpring,
        isAntiSpring: settlement.isAntiSpring,
        multiplierDetail: settlement.multiplierDetail,
        seats,
        bidHistory: st.bidHistory,
        playHistory: st.playHistory,
      };
      useHistoryStore.getState().addRecord(record);
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn('[history] 保存对局记录失败（不影响对局结束）：', err);
    }
  }

  /** 构造 AI 出牌输入快照 */
  function buildPlayInput(st: GameStoreState, seat: SeatIndex): AIPlayInput {
    const binding = resolveBinding(st.players[seat].aiPlayerId);
    // 思考态（推理模型）显著更慢，按模式放宽硬超时，避免思考被打断后退化为贪心兜底
    const thinkingOn: boolean = binding ? isThinkingEnabled(binding.thinkingMode ?? 'auto', binding.model) : false;
    return {
      seat,
      playerName: st.players[seat].name,
      binding,
      hand: st.players[seat].hand,
      landlordSeat: st.landlordSeat as SeatIndex,
      bottomCards: st.bottomCards,
      handCounts: [
        st.players[0].hand.length,
        st.players[1].hand.length,
        st.players[2].hand.length,
      ],
      lastPlay: st.lastPlay,
      isFreeTurn: st.isFreeTurn,
      playHistory: st.playHistory,
      multiplier: st.multiplier,
      baseScore: st.baseScore,
      // 超时按房间模式取自全局设置：人机默认 8s 保节奏，观战默认 20s 让模型想清楚；
      // 思考态进一步放宽到 30s / 60s
      timeoutMs: resolveTimeoutMs(st.roomMode, thinkingOn),
      onLog: logSink,
    };
  }

  /**
   * 兜底日志：模型动作被规则层拒绝并被自动纠正时，必须让用户在思考日志面板看得见，
   * 不允许悄悄改写（REQ-U2）。
   */
  function logGuard(
    seat: SeatIndex,
    level: 'warn' | 'error',
    message: string,
    source: DecisionSource,
  ): void {
    const player: Player | undefined = get().players[seat];
    logSink({
      seat,
      playerName: player ? player.name : `座位${seat + 1}`,
      level,
      message,
      source,
    });
  }

  /** 构造 AI 叫分输入快照 */
  function buildBidInput(st: GameStoreState, seat: SeatIndex): AIBidInput {
    const binding = resolveBinding(st.players[seat].aiPlayerId);
    const thinkingOn: boolean = binding ? isThinkingEnabled(binding.thinkingMode ?? 'auto', binding.model) : false;
    return {
      seat,
      playerName: st.players[seat].name,
      binding,
      hand: st.players[seat].hand,
      bidHistory: st.bidHistory,
      highestBid: st.highestBid,
      // 同上：叫分阶段也遵循同一份按模式区分的超时设置；思考态放宽
      timeoutMs: resolveTimeoutMs(st.roomMode, thinkingOn),
      onLog: logSink,
    };
  }

  return {
    ...IDLE_STATE,
    humanSeat: null,
    roomMode: null,
    selectedCardIds: [],
    hintCycleIndex: -1,
    autoPassEnabled: false,
    redealCount: 0,

    startGame: (roomArg?: Room): boolean => {
      const room: Room | null = roomArg ?? useRoomStore.getState().room;
      if (!room) {
        toast.error('尚未创建房间，请先到「创建房间」页面');
        return false;
      }

      // 进入新对局前先停掉上一局可能残留的背景音
      stopBackground();

      const players: [Player, Player, Player] = buildPlayers(room);
      const deal = createShuffledDeal(Math.random);
      const biddingStartSeat: SeatIndex = (Math.floor(Math.random() * 3) as SeatIndex);

      set({
        ...IDLE_STATE,
        phase: GamePhase.BIDDING,
        players: [
          { ...players[0], hand: deal.hands[0] },
          { ...players[1], hand: deal.hands[1] },
          { ...players[2], hand: deal.hands[2] },
        ],
        bottomCards: deal.bottomCards,
        bottomRevealed: false,
        landlordSeat: null,
        currentSeat: biddingStartSeat,
        lastPlay: null,
        isFreeTurn: true,
        playHistory: [],
        bidHistory: [],
        highestBid: 0,
        biddingStartSeat,
        baseScore: 0,
        multiplier: 1,
        settlement: null,
        turn: 0,
        humanSeat: humanSeatOf(room),
        roomMode: room.mode,
        selectedCardIds: [],
        hintCycleIndex: -1,
        redealCount: 0,
      });
      // 开局即后台预热 AI 台词池（过牌/嘲讽/催促），出牌时即时取用，不卡节奏
      warmBanterForSeats();
      // 开局语音播报：消除叫分阶段沉默，提示玩家进入叫地主流程
      speak('开始叫地主！');
      return true;
    },

    humanBid: (score: BidScore): void => {
      const st = get();
      if (st.phase !== GamePhase.BIDDING) return;
      if (st.humanSeat === null || st.currentSeat !== st.humanSeat) return;
      get().bid(score, st.humanSeat);
    },

    bid: (score: BidScore, seatArg?: SeatIndex, reason?: string): void => {
      const st = get();
      if (st.phase !== GamePhase.BIDDING) return;
      const seat: SeatIndex = (seatArg ?? st.currentSeat) as SeatIndex;
      if (seat !== st.currentSeat) return;

      const legal: BidScore[] = getLegalBids(st.highestBid);
      if (!legal.includes(score)) {
        // 非法叫分（理论上 UI 与驱动器都已过滤），静默忽略
        return;
      }

      const record: BidRecord = { seat, score, ...(reason !== undefined ? { reason } : {}) };
      const bidHistory: BidRecord[] = [...st.bidHistory, record];
      const highestBid: number = Math.max(st.highestBid, score);
      playSfx('bid');
      announceBid(seat, score, score > 0 && st.highestBid > 0);

      if (isBiddingFinished(bidHistory)) {
        const result = resolveBidding(bidHistory);
        // 先把「最后一手叫分」落库，避免定地主时丢失该条记录（UI 叫分历史需要完整）
        set({ bidHistory, highestBid });
        if (result.needRedeal) {
          const redealCount: number = st.redealCount + 1;
          if (redealCount > MAX_REDEAL) {
            // 兜底：连续流局过多，强制当前最后一个叫分者当地主、底分 1
            startPlaying(seat, 1);
            set({ redealCount });
          } else {
            const fresh = createShuffledDeal(Math.random);
            set({
              players: [
                { ...st.players[0], hand: fresh.hands[0], isLandlord: false },
                { ...st.players[1], hand: fresh.hands[1], isLandlord: false },
                { ...st.players[2], hand: fresh.hands[2], isLandlord: false },
              ],
              bottomCards: fresh.bottomCards,
              bottomRevealed: false,
              landlordSeat: null,
              currentSeat: st.biddingStartSeat,
              lastPlay: null,
              isFreeTurn: true,
              playHistory: [],
              bidHistory: [],
              highestBid: 0,
              baseScore: 0,
              multiplier: 1,
              settlement: null,
              turn: 0,
              selectedCardIds: [],
              hintCycleIndex: -1,
              redealCount,
            });
          }
          return;
        }
        startPlaying(result.landlordSeat as SeatIndex, result.baseScore);
        return;
      }

      set({
        bidHistory,
        highestBid,
        currentSeat: getNextBidder(bidHistory, st.biddingStartSeat) as SeatIndex,
      });
    },

    playCards: (cards: Card[], seatArg?: SeatIndex, reason?: string): boolean => {
      const st = get();
      if (st.phase !== GamePhase.PLAYING) return false;
      const seat: SeatIndex = (seatArg ?? st.currentSeat) as SeatIndex;
      if (seat !== st.currentSeat) return false;

      const hand: Card[] = st.players[seat].hand;
      const target: HandPattern | null = st.isFreeTurn ? null : st.lastPlay ? st.lastPlay.pattern : null;
      const result = validatePlay(hand, cards, target);
      if (!result.valid || !result.pattern) {
        toast.error(result.reason || '出牌不合法');
        return false;
      }

      const newHand: Card[] = removeCards(hand, cards);
      const playPattern: HandPattern = result.pattern;
      const record: PlayRecord = {
        seat,
        cards: [...cards],
        pattern: playPattern,
        isPass: false,
        turn: st.turn,
        ...(reason !== undefined ? { reason } : {}),
      };

      const isBomb: boolean =
        playPattern.type === (CardType.BOMB as CardType) || playPattern.type === (CardType.ROCKET as CardType);
      const multiplier: number = isBomb ? st.multiplier * 2 : st.multiplier;

      const players: [Player, Player, Player] = [
        st.players[0].seat === seat ? { ...st.players[0], hand: newHand } : st.players[0],
        st.players[1].seat === seat ? { ...st.players[1], hand: newHand } : st.players[1],
        st.players[2].seat === seat ? { ...st.players[2], hand: newHand } : st.players[2],
      ];

      if (newHand.length === 0) {
        set({
          players,
          playHistory: [...st.playHistory, record],
          lastPlay: record,
          isFreeTurn: false,
          multiplier,
          turn: st.turn + 1,
        });
        playSfx(isBomb ? 'bomb' : 'play');
      announcePlay(seat, playPattern);
        settle(seat);
        return true;
      }

      set({
        players,
        playHistory: [...st.playHistory, record],
        lastPlay: record,
        isFreeTurn: false,
        multiplier,
        turn: st.turn + 1,
      });
      playSfx(isBomb ? 'bomb' : 'play');
      announcePlay(seat, playPattern);
      advanceTurn();
      return true;
    },

    pass: (seatArg?: SeatIndex, reason?: string): boolean => {
      const st = get();
      if (st.phase !== GamePhase.PLAYING) return false;
      const seat: SeatIndex = (seatArg ?? st.currentSeat) as SeatIndex;
      if (seat !== st.currentSeat) return false;

      const target: HandPattern | null = st.lastPlay ? st.lastPlay.pattern : null;
      const result = validatePass(target);
      if (!result.valid) {
        toast.error(result.reason || '当前不能过牌');
        return false;
      }

      const record: PlayRecord = {
        seat,
        cards: [],
        pattern: null,
        isPass: true,
        turn: st.turn,
        ...(reason !== undefined ? { reason } : {}),
      };
      set({
        playHistory: [...st.playHistory, record],
        turn: st.turn + 1,
      });
      playSfx('pass');
      if (st.players[seat].kind === 'AI') triggerBanter(seat, 'pass');
      else speak(describePass());
      advanceTurn();
      return true;
    },

    /**
     * 执行当前座位的 AI 决策。
     *
     * 健壮性契约（P0）：**本函数每次调用都必须保证状态推进**，否则自己兜底。
     * 因为 UI 的调度 effect 依赖状态变化重挂定时器，只要状态零变化就再无下一次
     * 调用，整局永久死锁、用户只能刷新页面。故对以下坏输入必须免疫：
     *   1. 驱动器返回手牌里不存在的牌；
     *   2. 驱动器返回非法牌型；
     *   3. 自由回合驱动器坚持过牌（规则不允许）；
     *   4. 驱动器直接抛异常；
     *   5. 叫分驱动器返回非法分数。
     * store 的自洽性不能依赖调用方的善意。
     */
    aiAct: async (): Promise<void> => {
      // 重入保护：定时器抖动与手动触发可能并发进入，
      // 两个 await 基于同一旧快照决策会导致重复出牌 / 错座位动作。
      if (aiActing) return;
      aiActing = true;

      try {
        const st = get();

        // ------------------------------------------------------------------
        // 叫分阶段
        // ------------------------------------------------------------------
        if (st.phase === GamePhase.BIDDING) {
          const next: SeatIndex | null = getNextBidder(st.bidHistory, st.biddingStartSeat);
          if (next === null || next !== st.currentSeat) return;
          const seat: SeatIndex = st.currentSeat;
          if (st.players[seat].kind === 'HUMAN') return;

          const before: string = cursorOf(st);
          let decision: AIBidDecision | null = null;

          try {
            decision = await bidDriver(buildBidInput(st, seat));
          } catch (err: unknown) {
            logGuard(
              seat,
              'error',
              `叫分驱动器抛出异常（${errText(err)}），已转入本地兜底`,
              DecisionSource.FALLBACK_ERROR,
            );
          }

          // 对局代际校验（H1）：await 期间局面已推进或对局已重开，丢弃过期决策，
          // 防止旧局模型决策写入新局（叫分历史污染 / 错座位动作）
          if (cursorOf(get()) !== before) return;

          if (decision !== null) {
            try {
              get().bid(decision.score, seat, decision.reason);
            } catch (err: unknown) {
              logGuard(
                seat,
                'error',
                `应用模型叫分时异常（${errText(err)}），已转入本地兜底`,
                DecisionSource.FALLBACK_ERROR,
              );
            }
          }
          if (cursorOf(get()) !== before) return;

          // 状态零变化 ⇒ 该叫分被规则层拒绝。0 分（不叫）恒在合法集合内，必然推进。
          if (decision !== null) {
            logGuard(
              seat,
              'warn',
              `模型叫分 ${String(decision.score)} 非法（当前最高 ${get().highestBid} 分），已自动改为「不叫」`,
              DecisionSource.FALLBACK_MINIMAL,
            );
          }
          get().bid(0, seat, decision?.reason);

          if (cursorOf(get()) === before) {
            logGuard(
              seat,
              'error',
              '叫分兜底（不叫）仍未推进状态，叫分阶段可能已异常，请检查 gameStore 状态',
              DecisionSource.FALLBACK_ERROR,
            );
          }
          return;
        }

        // ------------------------------------------------------------------
        // 出牌阶段
        // ------------------------------------------------------------------
        if (st.phase === GamePhase.PLAYING) {
          const seat: SeatIndex = st.currentSeat;
          if (st.players[seat].kind === 'HUMAN') return;

          const before: string = cursorOf(st);
          let decision: AIDecision | null = null;

          try {
            decision = await playDriver(buildPlayInput(st, seat));
          } catch (err: unknown) {
            logGuard(
              seat,
              'error',
              `出牌驱动器抛出异常（${errText(err)}），已转入本地兜底`,
              DecisionSource.FALLBACK_ERROR,
            );
          }

          // 对局代际校验（H1）：await 期间局面已推进或对局已重开，丢弃过期决策
          if (cursorOf(get()) !== before) return;

          if (decision !== null) {
            try {
              if (decision.isPass) {
                get().pass(seat, decision.reason);
              } else {
                get().playCards(decision.cards, seat, decision.reason);
              }
            } catch (err: unknown) {
              logGuard(
                seat,
                'error',
                `应用模型出牌时异常（${errText(err)}），已转入本地兜底`,
                DecisionSource.FALLBACK_ERROR,
              );
            }
          }
          if (cursorOf(get()) !== before) return;

          // ---- 兜底链：状态零变化，说明模型动作被规则层拒绝 ----
          const cur = get();
          // await 期间局面若已被其它路径推进（人类操作 / 重开局），不再强行补动作
          if (cur.phase !== GamePhase.PLAYING || cur.currentSeat !== seat) return;

          const rejected: string =
            decision === null
              ? '模型决策不可用'
              : decision.isPass
                ? '模型要求过牌，但当前是自由回合（必须出牌）'
                : `模型出牌 [${cardsText(decision.cards)}] 不合法`;

          const hand: Card[] = cur.players[seat].hand;
          const target: HandPattern | null = cur.isFreeTurn
            ? null
            : cur.lastPlay
              ? cur.lastPlay.pattern
              : null;

          // 1) 出最小合法牌：自由回合出全场最小牌，跟牌回合出能压过上家的最小牌
          const minimal: Card[] | null = findMinimalPlay(hand, target);
          if (minimal !== null && minimal.length > 0 && get().playCards(minimal, seat, decision?.reason)) {
            logGuard(
              seat,
              'warn',
              `${rejected}，已自动改为出最小合法牌 [${cardsText(minimal)}]`,
              DecisionSource.FALLBACK_MINIMAL,
            );
            return;
          }

          // 2) 出不了牌则过牌（自由回合不允许过，pass 会返回 false 落到第 3 步）
          if (get().pass(seat, decision?.reason)) {
            logGuard(
              seat,
              'warn',
              `${rejected}，且无牌可压，已自动改为过牌`,
              DecisionSource.FALLBACK_PASS,
            );
            return;
          }

          // 3) 兜底链全败：绝不静默，写 error 供 QA 定位
          if (cursorOf(get()) === before) {
            logGuard(
              seat,
              'error',
              `${rejected}，且本地兜底（出最小牌 / 过牌）均失败，回合无法推进`,
              DecisionSource.FALLBACK_ERROR,
            );
          }
        }
      } finally {
        aiActing = false;
      }
    },

    toggleSelect: (cardId: string): void => {
      const st = get();
      if (st.humanSeat === null) return;
      // M8：仅人类出牌回合允许选中，阻止 AI 回合/叫分阶段点牌并跨回合残留
      if (st.phase !== GamePhase.PLAYING || st.currentSeat !== st.humanSeat) return;
      const exists: boolean = st.selectedCardIds.includes(cardId);
      set({
        selectedCardIds: exists
          ? st.selectedCardIds.filter((id: string): boolean => id !== cardId)
          : [...st.selectedCardIds, cardId],
        hintCycleIndex: -1,
      });
    },

    clearSelection: (): void => set({ selectedCardIds: [], hintCycleIndex: -1 }),

    playSelected: (): boolean => {
      const st = get();
      if (st.humanSeat === null) return false;
      const hand: Card[] = st.players[st.humanSeat].hand;
      const selected: Card[] = hand.filter((c: Card): boolean => st.selectedCardIds.includes(c.id));
      if (selected.length === 0) {
        toast.warning('请先选择要出的牌');
        return false;
      }
      const ok: boolean = get().playCards(selected, st.humanSeat);
      if (ok) set({ selectedCardIds: [], hintCycleIndex: -1 });
      return ok;
    },

    passSelected: (): boolean => {
      const st = get();
      if (st.humanSeat === null) return false;
      const ok: boolean = get().pass(st.humanSeat);
      if (ok) set({ selectedCardIds: [], hintCycleIndex: -1 });
      return ok;
    },

    applyHint: (): void => {
      const st = get();
      if (st.humanSeat === null || st.phase !== GamePhase.PLAYING) return;
      const hand: Card[] = st.players[st.humanSeat].hand;
      const target: HandPattern | null = st.isFreeTurn ? null : st.lastPlay ? st.lastPlay.pattern : null;
      const hints: Card[][] = findHints(hand, target);
      if (hints.length === 0) {
        toast.info('没有能压过的牌，只能过牌');
        return;
      }
      const nextIndex: number = (st.hintCycleIndex + 1) % hints.length;
      const chosen: Card[] = hints[nextIndex];
      set({ selectedCardIds: chosen.map((c: Card): string => c.id), hintCycleIndex: nextIndex });
    },

    autoTimeout: (): void => {
      const st = get();
      if (st.phase !== GamePhase.PLAYING || st.humanSeat === null || st.currentSeat !== st.humanSeat) return;
      if (st.isFreeTurn) {
        // 必须出牌：自动出最小合法牌
        const min: Card[] | null = findMinimalPlay(st.players[st.humanSeat].hand, null);
        if (min && min.length > 0) {
          get().playCards(min, st.humanSeat);
        } else {
          // 极端情况（手牌为空在之前已结算），无操作
          toast.warning('时间到，自动出最小牌');
        }
      } else {
        // 可过牌则自动过
        get().pass(st.humanSeat);
      }
    },

    urgeHuman: (): void => {
      const st = get();
      if (st.humanSeat === null) return;
      const key: string = `${st.currentSeat}|${st.turn}`;
      if (urgedTurnKey === key) return;
      urgedTurnKey = key;
      const aiSeats = ([0, 1, 2] as SeatIndex[]).filter((s) => st.players[s].kind === 'AI');
      if (aiSeats.length === 0) return;
      const seat: SeatIndex = aiSeats[Math.floor(Math.random() * aiSeats.length)];
      triggerBanter(seat, 'slow', { opponentName: st.players[st.humanSeat].name });
    },

    /** 切换自动过牌开关（不随开局/重发重置，属会话偏好；仅初始为关闭） */
    setAutoPassEnabled: (enabled: boolean): void => set({ autoPassEnabled: enabled }),

    resetGame: (): void => {
      stopBackground();
      // H1：释放重入锁，防止退出/重开对局时在途 aiAct 锁死新局 AI 回合
      //（在途调用恢复后经 cursorOf 代际校验会自行丢弃过期决策）
      aiActing = false;
      set({
        ...IDLE_STATE,
        humanSeat: null,
        roomMode: null,
        selectedCardIds: [],
        hintCycleIndex: -1,
        redealCount: 0,
      });
    },
  };
});

export default useGameStore;
