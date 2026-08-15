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

/** 出厂默认采样温度（斗地主是确定性博弈，偏低更稳） */
export const DEFAULT_TEMPERATURE = 0.3;

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
  /** API Key，明文存 localStorage（PRD D1 已接受，加密为 P2） */
  apiKey: string;
  /** 已拉取的可用模型 id 列表 */
  availableModels: string[];
  /** 用户选定的默认模型 id */
  selectedModel: string;
  /** AI 思考模式（推理强度），默认 'auto' */
  thinkingMode: ThinkingMode;
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
