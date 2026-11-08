/**
 * 模型配置、AI 玩家与房间类型（DESIGN §4.4）。
 */

/** AI 思考模式（推理强度）。off=不思考；low/medium/high=分级推理；auto=按模型自动判断是否推理 */
export type ThinkingMode = 'off' | 'low' | 'medium' | 'high' | 'auto';

/** 全部思考模式（用于 UI 渲染） */
export const THINKING_MODES: ThinkingMode[] = ['off', 'low', 'medium', 'high', 'auto'];

/** 思考模式中文标签 */
export const THINKING_LABELS: Record<ThinkingMode, string> = {
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  auto: '自动',
};

/** 出厂默认思考模式 */
export const DEFAULT_THINKING_MODE: ThinkingMode = 'auto';

/**
 * 思考方言（thinkingProfile）：把「思考意图档位」翻译成各厂商认得的请求体字段。
 * 各方言在「关闭思考」的字段位置 / 形状 / 类型上互不兼容，必须分条声明（方言一览见 server/services/thinkingAdapter.ts 头注释）：
 * - openai-native：顶层 `enable_thinking` + `reasoning_effort`（Qwen3 / vLLM 事实标准）
 * - chat-template：嵌套 `chat_template_kwargs.enable_thinking`（小红书 Dots / Agnes / 书生方舟发现网关 discovery-api；顶层写法被静默忽略）
 * - thinking-flag：字符串 `thinking:"enabled"/"disabled"`（MiniMax-M3）
 * - thinking-type：对象 `thinking:{"type":"enabled"/"disabled"}`（腾讯混元；与上一条同名字段不同形状，互不通用）
 * - effort-only：仅 `reasoning_effort`，无独立开关（OpenAI o 系；关闭=发 "none"）
 * - thinking-mode：布尔 `thinking_mode`，无强度档（仅 Intern-S1 官方端点 chat.intern-ai.org.cn；传字符串会被 400；
 *   书生方舟发现网关 discovery-api 不认此字段，须用 chat-template）
 * - nvidia：布尔 `thinking`（NVIDIA NIM / Nemotron；无强度档，建议配 binary 能力声明；传字符串会被 400）
 * - deepseek-thinking：布尔 `thinking`（DeepSeek 旧式写法，本仓兼容保留，无已知禁用字段）
 * - auto：按 baseUrl host / model 关键词自动检测（存量默认，检测不出时不发任何思考字段）
 */
export type ThinkingProfile =
  | 'auto'
  | 'openai-native'
  | 'chat-template'
  | 'thinking-flag'
  | 'thinking-type'
  | 'effort-only'
  | 'thinking-mode'
  | 'nvidia'
  | 'deepseek-thinking';

/** 全部思考方言（用于 UI 渲染） */
export const THINKING_PROFILES: ThinkingProfile[] = [
  'auto',
  'openai-native',
  'chat-template',
  'thinking-flag',
  'thinking-type',
  'effort-only',
  'thinking-mode',
  'nvidia',
  'deepseek-thinking',
];

/** 思考方言中文标签 */
export const THINKING_PROFILE_LABELS: Record<ThinkingProfile, string> = {
  auto: '自动检测',
  'openai-native': '标准型（Qwen3 / vLLM）',
  'chat-template': '嵌套型（Dots / Agnes / 书生发现网关）',
  'thinking-flag': '字符串型（MiniMax）',
  'thinking-type': '对象型（腾讯混元）',
  'effort-only': '仅强度（OpenAI o 系）',
  'thinking-mode': '布尔开关（仅 Intern-S1 官方端点）',
  nvidia: '英伟达 NIM（布尔）',
  'deepseek-thinking': 'DeepSeek 旧式（布尔）',
};

/** 出厂默认思考方言（自动检测：保持存量配置行为不变） */
export const DEFAULT_THINKING_PROFILE: ThinkingProfile = 'auto';

/**
 * 模型思考能力声明（thinkingCapability），避免「假分级」：
 * - graded：真分级，低/中/高各自生效
 * - binary：只支持开/关，低/中/高在前端归一成「高（满血）」再发
 * - none：无思考能力，不传任何思考参数
 */
export type ThinkingCapability = 'graded' | 'binary' | 'none';

/** 全部思考能力（用于 UI 渲染） */
export const THINKING_CAPABILITIES: ThinkingCapability[] = ['graded', 'binary', 'none'];

/** 思考能力中文标签 */
export const THINKING_CAPABILITY_LABELS: Record<ThinkingCapability, string> = {
  graded: '分级推理（低/中/高生效）',
  binary: '仅开/关（档位按满血发送）',
  none: '无思考能力（不发参数）',
};

/** 出厂默认思考能力 */
export const DEFAULT_THINKING_CAPABILITY: ThinkingCapability = 'graded';

/**
 * API 协议格式（apiFormat）：同一套「思考意图档位」在不同协议下的请求/响应形状由服务端翻译。
 * - openai：OpenAI 兼容 /chat/completions（默认，方言由 thinkingProfile 表达）
 * - gemini：Google Gemini 原生 generateContent（thinkingConfig.thinkingLevel）
 * - anthropic：Anthropic 原生 /v1/messages（thinking.budget_tokens，max_tokens 必填）
 */
export type ApiFormat = 'openai' | 'gemini' | 'anthropic';

/** 全部协议格式（用于 UI 渲染） */
export const API_FORMATS: ApiFormat[] = ['openai', 'gemini', 'anthropic'];

/** 协议格式中文标签 */
export const API_FORMAT_LABELS: Record<ApiFormat, string> = {
  openai: 'OpenAI 兼容（/chat/completions）',
  gemini: 'Gemini 原生（generateContent）',
  anthropic: 'Anthropic 原生（/v1/messages）',
};

/** 出厂默认协议格式 */
export const DEFAULT_API_FORMAT: ApiFormat = 'openai';

/** 出厂默认采样温度（斗地主是确定性博弈，偏低更稳） */
export const DEFAULT_TEMPERATURE = 0.3;

// ---- AI 决策难度（建议清单 #1）----

/** AI 决策难度：easy=简单（高温度、无记牌器）；normal=普通（默认）；hard=困难（低温度+记牌器+战术）；master=大师（few-shot+深度思考） */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'master';

/** 全部难度（用于 UI 渲染） */
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'master'];

/** 难度中文标签 */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
  master: '大师',
};

/** 出厂默认难度 */
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

// ---- AI 决策性格（建议清单 #2）----

/** AI 决策性格：aggressive=激进（抢分压牌）；conservative=保守（惜牌多过）；balanced=均衡（默认） */
export type Personality = 'aggressive' | 'conservative' | 'balanced';

/** 全部性格（用于 UI 渲染） */
export const PERSONALITIES: Personality[] = ['aggressive', 'balanced', 'conservative'];

/** 性格中文标签 */
export const PERSONALITY_LABELS: Record<Personality, string> = {
  aggressive: '激进',
  balanced: '均衡',
  conservative: '保守',
};

/** 出厂默认性格 */
export const DEFAULT_PERSONALITY: Personality = 'balanced';

// ---- 语音 / 人设（TTS 台词，REQ-趣味）----

/** AI 台词人设 */
export type Persona = 'provocative' | 'steady' | 'chatty' | 'rookie';

/** 全部人设（用于 UI 渲染） */
export const PERSONAS: Persona[] = ['provocative', 'steady', 'chatty', 'rookie'];

/** 人设中文标签 */
export const PERSONA_LABELS: Record<Persona, string> = {
  provocative: '毒舌',
  steady: '稳重',
  chatty: '话痨',
  rookie: '萌新',
};

/** OpenAI 兼容 TTS 音色候选（不同音色用不同 id 区分 AI 玩家） */
export const VOICE_OPTIONS = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

/** 音色 id 类型 */
export type VoiceId = (typeof VOICE_OPTIONS)[number];

/** 音色中文标签（说明音色特质，便于选配） */
export const VOICE_LABELS: Record<VoiceId, string> = {
  alloy: 'Alloy（中性）',
  ash: 'Ash（低沉）',
  coral: 'Coral（温暖）',
  echo: 'Echo（明亮）',
  fable: 'Fable（故事感）',
  onyx: 'Onyx（男低音）',
  nova: 'Nova（女声）',
  shimmer: 'Shimmer（清亮）',
};

/** 出厂默认音色 */
export const DEFAULT_VOICE: VoiceId = 'alloy';

/** 音色候选（用于 UI 快捷选择；用户也可手填任意服务商音色 id） */
export const VOICE_SUGGESTION_LIST: ReadonlyArray<{ value: string; label: string }> = (
  VOICE_OPTIONS as readonly string[]
).map((v) => ({ value: v, label: VOICE_LABELS[v as VoiceId] }));

/** 模型配置（REQ-M1） */
export interface ModelConfig {
  id: string;
  /** 配置名称，如 "配置A" */
  name: string;
  /** 服务商名称，如 "OpenAI" */
  provider: string;
  /** Base URL，如 "https://api.openai.com/v1" */
  baseUrl: string;
  /** API 协议格式，默认 'openai'（OpenAI 兼容）；Gemini/Anthropic 原生协议选对应项 */
  apiFormat: ApiFormat;
  /** API Key，明文存 localStorage（PRD D1 已接受，加密为 P2） */
  apiKey: string;
  /** 已拉取的可用模型 id 列表 */
  availableModels: string[];
  /** 用户选定的默认模型 id */
  selectedModel: string;
  /** AI 思考模式（推理强度），默认 'auto' */
  thinkingMode: ThinkingMode;
  /** 思考方言（厂商参数形状）选择，默认 'auto' 自动检测 */
  thinkingProfile: ThinkingProfile;
  /** 模型思考能力声明，默认 'graded' 分级 */
  thinkingCapability: ThinkingCapability;
  /** 输出上限 max_tokens；null=未填写（思考开启时按档位自动抬预算） */
  maxTokens: number | null;
  /** 采样温度 0~2，默认 0.3 */
  temperature: number;
  createdAt: number;
  updatedAt: number;
}

/** 连通性测试结果（REQ-M3） */
export interface ConnectionTestResult {
  success: boolean;
  /** 响应延迟（毫秒） */
  latencyMs: number;
  /** 失败时的错误信息 */
  error?: string;
  testedAt: number;
}

/** AI 玩家（REQ-A1） */
export interface AIPlayer {
  id: string;
  /** 玩家名称，如 "小明" */
  name: string;
  /** 绑定的 ModelConfig.id */
  modelConfigId: string;
  /** 绑定的具体模型 id（覆盖配置的默认模型，可选） */
  modelId?: string;
  /** 备注，如 "激进" */
  remark?: string;
  /** 头像 emoji 或 URL */
  avatar?: string;
  /** TTS 音色 id（任意服务商支持的值，如 onyx / zh-CN-XiaoxiaoNeural；不填则回退浏览器内置中文音） */
  voice?: string;
  /** TTS 模型名（对应 /audio/speech 的 model 字段，不填默认 tts-1） */
  ttsModel?: string;
  /**
   * TTS 单独绑定的模型配置 id（提供 TTS 密钥 / 服务商）。
   * 留空则跟随聊天配置 `modelConfigId`。
   * 用于「聊天配置不含 TTS 模型、需另行用其他密钥的 TTS 服务」的场景，
   * 使 TTS 与 AI 聊天的密钥彻底解耦。
   */
  ttsConfigId?: string;
  /** 台词人设（毒舌/稳重/话痨/萌新） */
  persona?: Persona;
  /** 决策难度（简单/普通/困难/大师），影响采样温度、提示词信息量与思考强度 */
  difficulty?: Difficulty;
  /** 决策性格（激进/均衡/保守），注入提示词影响叫分与出牌风格 */
  personality?: Personality;
  /**
   * 该玩家的 AI 决策超时秒数（5~120）。
   * 未填写时跟随全局设置（人机 8s / 观战 20s，思考态放宽到 30s / 60s）；
   * 填写后为该玩家的固定决策硬超时（覆盖全局，含思考态），供慢思考模型使用。
   */
  timeoutSeconds?: number;
  createdAt: number;
  updatedAt: number;
}

/** 对局模式 */
export type RoomMode = 'HUMAN_VS_AI' | 'AI_SPECTATE';

/** 座位配置 */
export interface Seat {
  index: 0 | 1 | 2;
  kind: 'HUMAN' | 'AI';
  /** kind 为 AI 时绑定的 AIPlayer.id */
  aiPlayerId?: string;
}

/** 房间（REQ-R1） */
export interface Room {
  id: string;
  mode: RoomMode;
  /** 三个座位 */
  seats: [Seat, Seat, Seat];
  createdAt: number;
}
