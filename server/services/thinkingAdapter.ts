/**
 * 思考（推理）参数适配器。
 *
 * 不同服务商对「思考模式」的参数形状各不相同，原样把 `thinking` / `reasoning_effort`
 * 透传给所有上游会导致严格网关返回 400（例如 OpenAI o 系列根本没有 `thinking` 字段，
 * DeepSeek 用 `thinking:true` 而非 `reasoning_effort`，Qwen/QwQ 用 `enable_thinking`）。
 *
 * 本模块把「抽象思考意图」翻译成「服务商认得的字段形状」，是修复「部分模型开思考就报错」的
 * 唯一适配点。识别不出的严格网关**默认省略**任何思考字段（fail-safe），宁可模型不思考也不让它 400。
 *
 * 纯函数、无副作用、不依赖 express，便于单测与在服务端/脚本中复用。
 */

/** 已识别的服务商（仅覆盖走 OpenAI 兼容 /chat/completions 端点的服务商） */
export type ThinkingProvider = 'openai-o' | 'deepseek' | 'qwen' | 'unknown';

/** 思考强度（与上游约定一致） */
export type ThinkingEffort = 'low' | 'medium' | 'high';

/** 抽象思考意图（来自前端的 resolveThinking 结果） */
export interface ResolvedThinking {
  thinking: boolean;
  reasoningEffort?: ThinkingEffort;
}

/** 取 baseUrl 的 host（小写），解析失败返回空串 */
function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 由 baseUrl + model 推断服务商。
 * 优先级：host（最可靠）→ model 关键词（兼容代理/中转场景）。
 */
export function detectProvider(baseUrl: string, model: string): ThinkingProvider {
  const host: string = safeHost(baseUrl);
  if (host.includes('deepseek')) return 'deepseek';
  if (host.includes('dashscope') || host.includes('aliyun')) return 'qwen';

  const m: string = model.toLowerCase();
  if (m.includes('deepseek') || m.includes('reasoner')) return 'deepseek';
  if (m.includes('qwq') || m.includes('qwen')) return 'qwen';
  // o1 / o3 / o4 作为独立词段出现（o1-preview / o3-mini / o4-mini 等）
  if (/\bo[134]\b/.test(m)) return 'openai-o';

  return 'unknown';
}

/**
 * 把抽象思考意图翻译成上游 body 片段。
 *
 * @param provider 识别出的服务商
 * @param thinking 是否开启思考（来自 resolveThinking）
 * @param reasoningEffort 思考强度（来自 resolveThinking）
 * @returns 应合并进上游请求体的字段；不开启思考或识别不出时返回空对象
 */
export function buildThinkingBody(
  provider: ThinkingProvider,
  thinking: boolean,
  reasoningEffort?: ThinkingEffort,
): Record<string, unknown> {
  if (!thinking) return {};

  switch (provider) {
    case 'openai-o':
      // OpenAI o 系列只认 reasoning_effort，**没有 thinking 布尔字段**；
      // 发 thinking:true 会触发 additional properties 400。
      return { reasoning_effort: reasoningEffort ?? 'medium' };

    case 'deepseek':
      // DeepSeek reasoner 用 thinking 布尔开关，不吃 reasoning_effort。
      return { thinking: true };

    case 'qwen':
      // DashScope OpenAI 兼容路径用 enable_thinking 开关。
      // 其 effort 字段在该兼容路径下未标准化，省略以防 400（fail-safe）。
      return { enable_thinking: true };

    case 'unknown':
    default:
      // fail-safe：识别不出的严格网关默认不发任何思考字段，避免 400。
      return {};
  }
}

/** 便捷封装：一次调用完成「识别 + 翻译」 */
export function resolveThinkingBody(
  baseUrl: string,
  model: string,
  resolved: ResolvedThinking,
): Record<string, unknown> {
  return buildThinkingBody(detectProvider(baseUrl, model), resolved.thinking, resolved.reasoningEffort);
}
