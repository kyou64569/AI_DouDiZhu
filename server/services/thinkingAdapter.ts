/**
 * 思考（推理）参数适配器 —— 方言注册表（指南 §6 数据驱动）。
 *
 * 前端只表达「意图档位」（off / low / medium / high / null=未设置），本模块把意图翻译成
 * 各厂商认得的请求体字段。各家在「关闭思考」的字段位置 / 形状 / 类型上互不兼容，且错法
 * 全部静默通过（网关照收 200 然后继续思考），所以方言必须做成注册表条目而不是 if-else：
 *
 * | 方言 | 关闭表达 | 强度表达 | 代表厂商 |
 * | --- | --- | --- | --- |
 * | openai-native | `enable_thinking:false` | `reasoning_effort` | Qwen3 / vLLM |
 * | chat-template | `chat_template_kwargs.enable_thinking:false` | `reasoning_effort` | 小红书 Dots / Agnes / 书生发现网关 |
 * | thinking-flag | `thinking:"disabled"`（字符串） | `reasoning_effort` | MiniMax-M3 |
 * | thinking-type | `thinking:{"type":"disabled"}`（对象） | `reasoning_effort` | 腾讯混元 |
 * | effort-only | `reasoning_effort:"none"` | `reasoning_effort` | OpenAI o 系 |
 * | thinking-mode | `thinking_mode:false`（布尔） | 无 | 仅 Intern-S1 官方端点（discovery 网关不认） |
 * | nvidia | `thinking:false`（布尔） | 无 | NVIDIA NIM / Nemotron |
 * | deepseek-thinking | （无已知禁用字段） | 无 | DeepSeek 旧式 |
 *
 * 硬性约定：
 * - `level === null`（未设置）时**任何方言都不写任何字段**——跟随模型默认，与显式 off 严格区分，
 *   也是存量配置请求体逐字节不变的保证；
 * - `auto` 方言按 baseUrl host / model 关键词检测，检测不出时**省略**所有思考字段（fail-safe，
 *   宁可不思考也不让严格网关 400）；
 * - thinking-mode / nvidia 方言没有强度档，任何档位都不发 reasoning_effort。
 *
 * 纯函数、无副作用、不依赖 express，便于单测。
 */

/** 思考档位（前端能力折叠后的最终意图） */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

/** 思考强度（仅 low/medium/high 档位携带） */
export type ThinkingEffort = 'low' | 'medium' | 'high';

/** 具体方言键（不含 auto；auto 在入口处先解析成具体方言或 null） */
export type ThinkingProfileKey =
  | 'openai-native'
  | 'chat-template'
  | 'thinking-flag'
  | 'thinking-type'
  | 'effort-only'
  | 'thinking-mode'
  | 'nvidia'
  | 'deepseek-thinking';

/** 前端可选的方言集合（auto + 全部具体方言） */
export type ThinkingProfileSelection = 'auto' | ThinkingProfileKey;

/** 全部合法选择值（路由校验用） */
export const THINKING_PROFILE_SELECTIONS: readonly ThinkingProfileSelection[] = [
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

/** 全部合法档位值（路由校验用） */
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'low', 'medium', 'high'];

/** 归一化后的思考规格（指南 §2 第 1 段的产物） */
export interface ThinkingSpec {
  /** null = 未设置（不发任何字段）；'off' = 显式关闭 */
  level: ThinkingLevel | null;
  /** 是否显式关闭（level === 'off'） */
  disableThinking: boolean;
  /** 思考强度，仅非关闭档位携带 */
  effort: ThinkingEffort | null;
}

/** 把档位翻译成规格：effort 恒等于档位（能力折叠已在前端完成） */
function toSpec(level: ThinkingLevel | null): ThinkingSpec {
  const hasEffort: boolean = level === 'low' || level === 'medium' || level === 'high';
  return {
    level,
    disableThinking: level === 'off',
    effort: hasEffort ? (level as ThinkingEffort) : null,
  };
}

// ---------- 预算层（指南 §2 第 2 段 / §7.2） ----------

/**
 * 分级输出预算：思考 token 计入输出上限，低档位易把业务 JSON 截断。
 * 仅在调用方未指定 max_tokens 时按档位抬高；off 与未设置一律不动预算（存量配置零变化的保证）。
 */
const THINKING_BUDGET: Record<ThinkingEffort, number> = {
  low: 4096,
  medium: 8192,
  high: 24576,
};

/**
 * 解析最终生效的方言键：'auto' 按 baseUrl/model 检测，检测不出返回 null。
 */
export function resolveProfileKey(
  profile: ThinkingProfileSelection,
  baseUrl: string,
  model: string,
): ThinkingProfileKey | null {
  return profile === 'auto' ? detectProfileKey(baseUrl, model) : profile;
}

/**
 * 计算应随请求发送的 max_tokens。
 *
 * 规则（指南 §7.2）：
 * 1. 调用方显式填写的值**永远优先**（它同时是输出上限，无论思考是否开启）——
 *    超过网关天花板会换来 400，只有运维知道自家模型的上限，400 是可见信号而非静默截断；
 * 2. off 与未设置（null）→ 不发送 max_tokens 字段（存量配置请求体逐字节不变）；
 * 3. effort-only 方言（OpenAI o 系）→ 不自动抬预算：真实 OpenAI API 对推理模型只收
 *    max_completion_tokens、发 max_tokens 会 400，该系模型默认输出预算也足够大；
 * 4. 其余方言按档位套分级预算（binary 模型折叠后的满血档同样受惠）。
 *
 * @param profile 已解析的具体方言键（null = auto 检测不出，fail-safe 分支，同样不动预算）
 * @param level 思考档位
 * @param userMaxTokens 调用方显式指定的输出上限（未指定为 undefined）
 * @returns 应写入 body.max_tokens 的值；undefined 表示不发送该字段
 */
export function applyThinkingBudget(
  profile: ThinkingProfileKey | null,
  level: ThinkingLevel | null,
  userMaxTokens: number | undefined,
): number | undefined {
  if (typeof userMaxTokens === 'number' && Number.isFinite(userMaxTokens) && userMaxTokens > 0) {
    return userMaxTokens;
  }
  if (level === null || level === 'off') {
    return undefined;
  }
  if (profile === null || profile === 'effort-only') {
    return undefined;
  }
  return THINKING_BUDGET[level];
}

/**
 * 方言注册表：每条方言把规格写进请求体。
 *
 * 注意与指南 §6 的差异：本项目代理请求体由 llmProxy 固定字段拼装、无 extra_body 兜底通道，
 * 因此暂不需要「返回占用字段集合」的保护机制；引入兜底通道时应补上（指南 §7.8）。
 */
export const THINKING_PROFILES: Record<
  ThinkingProfileKey,
  (body: Record<string, unknown>, spec: ThinkingSpec) => void
> = {
  // Qwen3 / vLLM 事实标准：顶层 enable_thinking + reasoning_effort。
  // 未设置（null）什么都不发——不要对纯 instruct 模型发 enable_thinking:true，会 400。
  'openai-native': (body: Record<string, unknown>, spec: ThinkingSpec): void => {
    if (spec.level === null) return;
    if (spec.disableThinking) {
      body.enable_thinking = false;
      return;
    }
    body.enable_thinking = true;
    if (spec.effort !== null) body.reasoning_effort = spec.effort;
  },

  // 小红书 Dots / Agnes：必须嵌套在 chat_template_kwargs 里，顶层写法被静默忽略。
  'chat-template': (body: Record<string, unknown>, spec: ThinkingSpec): void => {
    if (spec.level === null) return;
    const kwargs: Record<string, unknown> =
      body.chat_template_kwargs !== null && typeof body.chat_template_kwargs === 'object'
        ? (body.chat_template_kwargs as Record<string, unknown>)
        : {};
    kwargs.enable_thinking = !spec.disableThinking;
    body.chat_template_kwargs = kwargs;
    if (!spec.disableThinking && spec.effort !== null) body.reasoning_effort = spec.effort;
  },

  // MiniMax-M3：字符串形状。取值集合是厂商自定义的（官方另有 adaptive 默认值），勿假定通用。
  'thinking-flag': (body: Record<string, unknown>, spec: ThinkingSpec): void => {
    if (spec.level === null) return;
    body.thinking = spec.disableThinking ? 'disabled' : 'enabled';
    if (!spec.disableThinking && spec.effort !== null) body.reasoning_effort = spec.effort;
  },

  // 腾讯混元 hy3/hy4：对象形状。与 thinking-flag 同字段名、不同形状，互不通用。
  'thinking-type': (body: Record<string, unknown>, spec: ThinkingSpec): void => {
    if (spec.level === null) return;
    body.thinking = { type: spec.disableThinking ? 'disabled' : 'enabled' };
    if (!spec.disableThinking && spec.effort !== null) body.reasoning_effort = spec.effort;
  },

  // 无独立开关，仅靠 reasoning_effort；显式关闭发 "none"（该写法尚无真网关实证，接前先探测）。
  'effort-only': (body: Record<string, unknown>, spec: ThinkingSpec): void => {
    if (spec.level === null) return;
    body.reasoning_effort = spec.disableThinking ? 'none' : spec.effort;
  },

  // Intern-S1：布尔 thinking_mode，且没有强度档——任何档位都不发 reasoning_effort。
  'thinking-mode': (body: Record<string, unknown>, spec: ThinkingSpec): void => {
    if (spec.level === null) return;
    body.thinking_mode = !spec.disableThinking;
  },

  // NVIDIA NIM / Nemotron：布尔 thinking，且没有强度档——任何档位都不发 reasoning_effort
  // （网关不认强度字段；字符串写法 thinking:"disabled" 会被直接 400，指南 §3.7）。
  // 与 thinking-mode 一样须配 thinkingCapability:'binary'，否则 UI 会假装能分级。
  'nvidia': (body: Record<string, unknown>, spec: ThinkingSpec): void => {
    if (spec.level === null) return;
    body.thinking = !spec.disableThinking;
  },

  // DeepSeek 旧式布尔开关（本仓兼容保留）：reasoner 本就默认思考，无已知禁用字段，
  // 显式关闭时省略（fail-safe），避免赌上游会不会忽略。
  'deepseek-thinking': (body: Record<string, unknown>, spec: ThinkingSpec): void => {
    if (spec.level === null || spec.disableThinking) return;
    body.thinking = true;
  },
};

/** 取 baseUrl 的 host（小写），解析失败返回空串 */
function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 由 baseUrl + model 推断方言（'auto' 的解析规则）。
 * 优先级：host（最可靠）→ model 关键词（兼容代理/中转场景）。
 * 识别不出时返回 null（调用方应省略所有思考字段，fail-safe）。
 */
export function detectProfileKey(baseUrl: string, model: string): ThinkingProfileKey | null {
  const host: string = safeHost(baseUrl);
  if (host.includes('deepseek')) return 'deepseek-thinking';
  if (host.includes('nvidia')) return 'nvidia'; // NVIDIA NIM（integrate.api.nvidia.com 等）
  // Intern 两个端点分家（指南 §3.6/§9 实测）：chat.intern-ai.org.cn（Intern-S1 官方端点）
  // 认布尔 thinking_mode；discovery-api.intern-ai.org.cn（书生方舟聚合网关）只认
  // chat_template_kwargs.enable_thinking（thinking_mode 与顶层 enable_thinking 均被忽略，
  // 配 off 会静默失效继续思考）。host 判定必须先于 model 关键词——该网关下挂
  // deepseek-v4 / qwen3.8 等异构模型，按模型名判会误入 deepseek / qwen 方言。
  if (host.includes('chat.intern-ai')) return 'thinking-mode';
  if (host.includes('intern-ai')) return 'chat-template';

  const m: string = model.toLowerCase();
  if (m.includes('deepseek') || m.includes('reasoner')) return 'deepseek-thinking';
  if (host.includes('dashscope') || host.includes('aliyun')) return 'openai-native';
  if (m.includes('qwq') || m.includes('qwen')) return 'openai-native';
  // o1 / o3 / o4 作为独立词段出现（o1-preview / o3-mini / o4-mini 等）
  if (/\bo[134]\b/.test(m)) return 'effort-only';

  return null;
}

/**
 * 把「方言选择 + 档位」翻译成应合并进上游请求体的字段片段。
 *
 * @param profile 方言选择（'auto' 或具体方言）
 * @param level 思考档位；null = 未设置，返回空对象（不发任何思考字段）
 * @param baseUrl 上游地址（auto 检测用）
 * @param model 模型 id（auto 检测用）
 * @returns 应合并进请求体的字段；无需表达思考意图时为空对象
 */
export function buildThinkingBody(
  profile: ThinkingProfileSelection,
  level: ThinkingLevel | null,
  baseUrl: string,
  model: string,
): Record<string, unknown> {
  const spec: ThinkingSpec = toSpec(level);
  if (spec.level === null) {
    return {};
  }

  const key: ThinkingProfileKey | null = resolveProfileKey(profile, baseUrl, model);
  if (key === null) {
    // fail-safe：识别不出的严格网关默认不发任何思考字段，避免 400
    return {};
  }

  const body: Record<string, unknown> = {};
  THINKING_PROFILES[key](body, spec);
  return body;
}
