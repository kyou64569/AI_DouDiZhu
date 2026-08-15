/**
 * AI 台词生成层（语音趣味核心）。
 *
 * 职责：把「游戏事件 + 玩家人设」翻译成一句短中文台词，供 TTS 念出。
 * 两条来源：
 *  1. 模板库（templateBanter）：零延迟、零成本、零毒性风险，作为保底与离线路径；
 *  2. LLM 生成（generateBanter）：复用玩家现有 LLM 绑定调 /api/llm/chat，
 *     更随机有梗，但必须过内容过滤 isSafeBanter，失败回退模板。
 *
 * 本文件位于 src/audio（与 soundService/cardSpeech 同级），不属于 src/ai 决策驱动器，
 * 因此 gameStore 引入它不破坏「gameStore 不 import src/ai」的解耦契约。
 */

import type { AIModelBinding } from '@/types/ai';
import type { Persona } from '@/types/config';
import { chatCompletion } from '@/api/llm';

/** 触发台词的事件 */
export type BanterEvent = 'play' | 'bomb' | 'pass' | 'win' | 'lose' | 'slow' | 'taunt' | 'bid' | 'bidpass';

/** 台词上下文（可选占位填充） */
export interface BanterContext {
  /** 打出的牌文案，如 "一对三"（play 事件使用） */
  cardText?: string;
  /** 对手名字（slow / taunt 使用） */
  opponentName?: string;
  /** 自己名字（填充 self 占位） */
  selfName?: string;
  /** 叫分分值（bid / bidpass 事件使用），如 1/2/3 */
  bidScore?: number;
}

/** 台词生成输入 */
export interface BanterInput {
  event: BanterEvent;
  persona: Persona;
  binding: AIModelBinding;
  ctx?: BanterContext;
}

/** 人设提示词 */
const PERSONA_PROMPT: Record<Persona, string> = {
  provocative: '你毒舌、爱挑衅，出牌时喜欢打压对手、放狠话。',
  steady: '你沉稳老练，话不多但偶尔来一句冷静的嘲讽。',
  chatty: '你话痨、爱嘚瑟，赢了就狂欢，出牌爱碎碎念。',
  rookie: '你是萌新，语气可爱、偶尔嘴瓢，输了会撒娇。',
};

/** 事件情境提示 */
const EVENT_HINT: Record<BanterEvent, string> = {
  play: '你刚打出一手牌',
  bomb: '你刚甩出炸弹/王炸',
  pass: '你选择过牌',
  win: '你赢下了这局',
  lose: '你这局输了',
  slow: '对手出牌磨磨蹭蹭',
  taunt: '你想挑衅对手',
  bid: '你刚叫了分（要当地主）',
  bidpass: '你选择不叫（不当地主）',
};

/** 模板台词池（占位：{card} 牌面 / {opp} 对手 / {self} 自己） */
const POOLS: Record<BanterEvent, Record<Persona, string[]>> = {
  play: {
    provocative: ['{card}！就这？', '看好了，{card}！', '{card}，认不认？', '吃我{card}！', '{card}，接得住吗', '哼，{card}带走'],
    steady: ['{card}。', '出{card}。', '{card}，稳。', '打{card}。', '{card}，正常操作。'],
    chatty: ['我出{card}啦，跟不跟～', '{card}！该我表演了', '喏，{card}～', '看招，{card}！', '{card}嘿嘿，接好', '轮到我，{card}奉上～'],
    rookie: ['我、我出{card}…', '{card}可以吗？', '诶嘿{card}！', '那、那个{card}…', '{card}！我好像出对了？'],
  },
  bomb: {
    provocative: ['炸弹！怕了吧？', '轰！看你咋接', '四个带走，拜拜'],
    steady: ['炸弹，清场。', '王炸，收尾。'],
    chatty: ['boom！炸弹来咯～', '嘿嘿，炸你一下！'],
    rookie: ['哇炸弹！我有的！', '炸、炸弹！'],
  },
  pass: {
    provocative: ['过！你行你上', '不要，逗你玩', '过，急啥', '这把不跟，留给你表演'],
    steady: ['过。', '这手不要。', '让一手。', '过，观察下。'],
    chatty: ['我这把过啦～', '过过过，看你表演', '嘿，过！', '先过，看你们表演～'],
    rookie: ['我过…是不是错了', '过吧过吧', '我、我过…', '先过一下下…'],
  },
  win: {
    provocative: ['赢了！就这水平？', '躺赢，下次别来了', '认输吧你'],
    steady: ['这局我赢了。', '拿下。'],
    chatty: ['耶！我赢啦～', '哈哈哈赢咯，再来！'],
    rookie: ['我赢了？！真的吗！', '耶，我赢啦！'],
  },
  lose: {
    provocative: ['哼，让你一把', '下次必赢', '运气好罢了'],
    steady: ['这局输了。', '技不如人。'],
    chatty: ['啊…输了，不服！', '你赢了啦，讨厌'],
    rookie: ['我输啦…呜呜', '下次我一定行！'],
  },
  slow: {
    provocative: ['{opp}你磨蹭啥呢？', '快点啊，睡着了？', '再犹豫我替你打'],
    steady: ['{opp}，该你了。', '请快一点。'],
    chatty: ['{opp}～别想太久嘛', '催催，轮到你啦！'],
    rookie: ['{opp}慢慢来…我等得都困了', '该你咯，不急不急…（其实有点急）'],
  },
  taunt: {
    provocative: ['就你这牌也敢叫？', '菜就少说话', '等着被炸吧'],
    steady: ['牌不错，但还不够。', '看你能撑几手。'],
    chatty: ['嘿嘿，你慌不慌～', '我可盯着你呢'],
    rookie: ['你你好厉害…但我也不差！', '唔，好紧张'],
  },

  bid: {
    provocative: ['{score}分，地主归我', '{score}分谁抢得过', '{score}分，怕了没'],
    steady: ['{score}分。', '{score}分，稳。', '{score}分，正常。'],
    chatty: ['{score}分～地主我当定啦', '{score}分！该我表演', '{score}分嘿嘿'],
    rookie: ['{score}分…我好像行', '{score}分可以吗', '那、那个{score}分'],
  },
  bidpass: {
    provocative: ['不叫，让你们先表演', '不叫，逗你们玩'],
    steady: ['不叫。', '这把先不叫。'],
    chatty: ['不叫啦～让你们', '不叫，这把我观战'],
    rookie: ['我、我不叫…', '不叫不叫'],
  },
};

/** 内容安全黑名单（极简，防明显脏话；模板本身安全，主要挡 LLM 越界） */
const BAD_WORDS: string[] = ['傻逼', '操你', '妈的', '草你', '去死', '废物', '滚蛋', '贱人', '蠢猪', '狗东西'];

/** 台词最大长度 */
const MAX_BANTER_LEN: number = 24;

/** 从数组随机取一项 */
function pick(arr: string[]): string {
  if (arr.length === 0) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 内容安全过滤：必须含中文、长度受限、不含黑名单词。
 */
export function isSafeBanter(text: string): boolean {
  const t: string = text.trim();
  if (t.length === 0 || t.length > MAX_BANTER_LEN) return false;
  if (!/[一-龥]/.test(t)) return false;
  for (const w of BAD_WORDS) {
    if (t.includes(w)) return false;
  }
  return true;
}

/**
 * 模板台词（保底路径）。
 */
export function templateBanter(event: BanterEvent, persona: Persona, ctx?: BanterContext): string {
  const line: string = pick(POOLS[event][persona]);
  return line
    .replace(/\{card\}/g, ctx?.cardText ?? '')
    .replace(/\{opp\}/g, ctx?.opponentName ?? '对面')
    .replace(/\{self\}/g, ctx?.selfName ?? '我')
    .replace(/\{score\}/g, ctx?.bidScore !== undefined ? String(ctx.bidScore) : '');
}

/**
 * LLM 生成台词：调玩家现有 LLM 绑定，复用 /api/llm/chat。
 * 任何失败（超时/解析/不安全）都回退模板，绝不抛异常。
 */
export async function generateBanter(input: BanterInput): Promise<string> {
  const { event, persona, binding, ctx } = input;
  const system: string =
    `你是斗地主 AI 玩家${ctx?.selfName ? `「${ctx.selfName}」` : ''}。${PERSONA_PROMPT[persona]}\n` +
    `规则：只回一句中文口语（不超过 12 字），可带标点，不要解释、不要引号、不要括号说明。` +
    `情境是「${EVENT_HINT[event]}」时该说什么。`;
  const user: string =
    `情境：${EVENT_HINT[event]}` +
    `${ctx?.cardText ? `，你打出：${ctx.cardText}` : ''}` +
    `${ctx?.opponentName ? `，对手是${ctx.opponentName}` : ''}。说一句。`;

  try {
    const res = await chatCompletion(
      {
        baseUrl: binding.baseUrl,
        apiKey: binding.apiKey,
        model: binding.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.9,
        timeoutMs: 6000,
      },
      { timeoutMs: 8000 },
    );
    let text: string = res.content.replace(/["'「」'']/g, '').replace(/\n/g, ' ').trim();
    if (text.includes('。')) text = text.split('。')[0];
    text = text.slice(0, MAX_BANTER_LEN);
    if (isSafeBanter(text)) return text;
    return templateBanter(event, persona, ctx);
  } catch {
    return templateBanter(event, persona, ctx);
  }
}

// =============================================================================
// 预热台词池（方案 B）：把 LLM 生成的人设台词在空闲期提前生成并缓存，
// 出牌 / 过牌 / 催促时直接取缓存 + TTS 合成（仅网络耗时，无 LLM 等待），
// 既保留人设趣味，又不会因逐次调用 LLM 而拖慢出牌节奏。
// 缓存按 persona|event 维度共享（不同玩家同人设复用同一池），降低预热调用量。
// =============================================================================

const banterPool: Map<string, string[]> = new Map();
const WARM_QUEUE: Array<{ event: BanterEvent; persona: Persona; binding: AIModelBinding }> = [];
let warmRunning = false;

/** M6：预热队列上限，防止反复 warm 导致队列无限增长 */
const WARM_QUEUE_MAX = 64;
/** M6：各 key 连续预热失败熔断阈值，防止后台无限串行请求 LLM */
const WARM_FAIL_LIMIT = 8;
const warmFailCount: Map<string, number> = new Map();

function poolKey(event: BanterEvent, persona: Persona): string {
  return `${persona}|${event}`;
}

/** 取一条缓存台词（不消耗，允许复用；池空返回 null） */
export function getCachedBanter(event: BanterEvent, persona: Persona): string | null {
  const pool = banterPool.get(poolKey(event, persona));
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 重置全部预热池（新开一局时调用，避免上一局人设残留） */
export function resetBanterPool(): void {
  banterPool.clear();
  WARM_QUEUE.length = 0;
  warmFailCount.clear();
}

/**
 * 预热某 (persona, event) 池：补到 count 条为止（幂等，已够则跳过）。
 * 内部用单消费者队列错峰生成，避免开局瞬间打爆上游 LLM。
 * M6：按 key 去重 + 队列上限 + 连续失败熔断，防止队列无限膨胀。
 */
export function warmBanterPool(event: BanterEvent, persona: Persona, binding: AIModelBinding, count = 4): void {
  const key = poolKey(event, persona);
  // 熔断：连续失败过多则停止预热该 key
  if ((warmFailCount.get(key) ?? 0) >= WARM_FAIL_LIMIT) return;
  const have = banterPool.get(key)?.length ?? 0;
  const need = Math.max(0, count - have);
  // 已排队同 key 任务数（去重）+ 队列总量上限
  const queued = WARM_QUEUE.filter((t) => poolKey(t.event, t.persona) === key).length;
  const toPush = Math.min(need - queued, WARM_QUEUE_MAX - WARM_QUEUE.length);
  for (let i = 0; i < toPush; i++) WARM_QUEUE.push({ event, persona, binding });
  if (!warmRunning && WARM_QUEUE.length > 0) void drainWarm();
}

async function drainWarm(): Promise<void> {
  warmRunning = true;
  try {
    while (WARM_QUEUE.length > 0) {
      const task: { event: BanterEvent; persona: Persona; binding: AIModelBinding } = WARM_QUEUE.shift() as {
        event: BanterEvent;
        persona: Persona;
        binding: AIModelBinding;
      };
      const key = poolKey(task.event, task.persona);
      try {
        const line = await generateBanter({ event: task.event, persona: task.persona, binding: task.binding, ctx: {} });
        warmFailCount.set(key, 0);
        const pool = banterPool.get(key) ?? [];
        if (!pool.includes(line)) {
          pool.push(line);
          banterPool.set(key, pool);
        }
      } catch {
        // 单条失败忽略，池空时自有模板兜底；累计失败计数用于熔断
        warmFailCount.set(key, (warmFailCount.get(key) ?? 0) + 1);
      }
      // 轻微错峰，避免瞬间并发请求
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    warmRunning = false;
  }
}
