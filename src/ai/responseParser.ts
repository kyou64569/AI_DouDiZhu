/**
 * LLM 返回解析（容错优先）。
 *
 * 模型输出千奇百怪，本模块负责从各种脏输出里抠出结构化决策：
 * - ```json ... ``` 代码围栏包裹
 * - 前后夹带解释文字（"好的，我分析一下…{json}…希望有帮助"）
 * - 单引号、尾随逗号、中文引号
 * - cards 是字符串而非数组（"3,3,K"）
 * - action 大小写不一（"Play" / "PASS"）
 *
 * 铁律：任何情况下都【不抛异常】，解析失败一律返回 null。
 */

import type { AIRawResponse } from '@/types/ai';

/** 解析结果：成功返回归一化对象，失败返回 null。 */
export type ParsedPlay = AIRawResponse | null;

/** 叫分解析结果。 */
export interface ParsedBid {
  score: number;
  reason: string;
}

/**
 * 把中文引号、全角符号归一化为 ASCII。
 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u201c\u201d]/g, '"') // 中文双引号
    .replace(/[\u2018\u2019]/g, "'") // 中文单引号
    .replace(/\uff1a/g, ':') // 全角冒号
    .replace(/\uff0c/g, ',') // 全角逗号
    .replace(/\uff08/g, '(')
    .replace(/\uff09/g, ')')
    .replace(/\uff3b/g, '[')
    .replace(/\uff3d/g, ']')
    .replace(/\uff5b/g, '{')
    .replace(/\uff5d/g, '}');
}

/**
 * 剥掉 markdown 代码围栏。
 * 支持 ```json ... ```、``` ... ```、~~~ ... ~~~
 */
function stripCodeFence(text: string): string {
  const fencePattern = /```(?:json|JSON|js|javascript)?\s*([\s\S]*?)```/;
  const match: RegExpExecArray | null = fencePattern.exec(text);
  if (match !== null && typeof match[1] === 'string') {
    return match[1].trim();
  }
  const tildePattern = /~~~(?:json)?\s*([\s\S]*?)~~~/;
  const tildeMatch: RegExpExecArray | null = tildePattern.exec(text);
  if (tildeMatch !== null && typeof tildeMatch[1] === 'string') {
    return tildeMatch[1].trim();
  }
  // 只有开头围栏没有结尾的情况
  const openOnly = /```(?:json|JSON)?\s*([\s\S]*)$/;
  const openMatch: RegExpExecArray | null = openOnly.exec(text);
  if (openMatch !== null && typeof openMatch[1] === 'string') {
    return openMatch[1].replace(/```\s*$/, '').trim();
  }
  return text;
}

/**
 * 从任意文本中提取第一个「花括号平衡」的 JSON 片段。
 * 会正确跳过字符串字面量里的花括号。
 */
function extractJsonBlock(text: string): string | null {
  const start: number = text.indexOf('{');
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch: string = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * 从任意文本中提取最后一个「花括号平衡」的 JSON 片段。
 * 模型常在长推理后把最终结论放在最后，前面的 JSON 可能是草稿或自我纠正，
 * 因此优先取最后一个块更贴近模型真实意图。会正确跳过字符串字面量里的花括号。
 */
function extractLastJsonBlock(text: string): string | null {
  const start: number = text.lastIndexOf('{');
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch: string = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * 修复常见的非标准 JSON 写法：
 * - 单引号 → 双引号
 * - 尾随逗号
 * - 未加引号的键名
 */
function repairJson(text: string): string {
  let result: string = text;

  // 键名单引号 → 双引号
  result = result.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match: string, inner: string) => {
    const escapedInner: string = inner.replace(/"/g, '\\"');
    return `"${escapedInner}"`;
  });

  // 未加引号的键名：{ action: "play" } → { "action": "play" }
  result = result.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');

  // 尾随逗号：{"a":1,} 或 [1,2,]
  result = result.replace(/,(\s*[}\]])/g, '$1');

  return result;
}

/**
 * 多策略 JSON.parse：原样 → 修复后 → 提取块后修复。
 * 全部失败返回 null，绝不抛异常。
 */
function tryParseObject(raw: string): Record<string, unknown> | null {
  const candidates: string[] = [];

  const cleaned: string = stripCodeFence(normalizeQuotes(raw)).trim();
  candidates.push(cleaned);

  // 优先取最后一个 JSON 块（模型最终结论通常在最后），并保留第一个块作为兜底候选，
  // 避免把草稿/自我纠正的过期 action 当成最终决策。
  const lastBlock: string | null = extractLastJsonBlock(cleaned);
  if (lastBlock !== null) {
    candidates.push(lastBlock);
    candidates.push(repairJson(lastBlock));
  }
  const firstBlock: string | null = extractJsonBlock(cleaned);
  if (firstBlock !== null && firstBlock !== lastBlock) {
    candidates.push(firstBlock);
    candidates.push(repairJson(firstBlock));
  }
  candidates.push(repairJson(cleaned));

  for (const candidate of candidates) {
    if (candidate.length === 0) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 忽略，继续尝试下一个候选
    }
  }

  return null;
}

/**
 * 把 cards 字段归一化为字符串数组。
 * 支持数组、逗号分隔字符串、空格分隔字符串。
 */
function normalizeCardsField(value: unknown): string[] {
  if (Array.isArray(value)) {
    const result: string[] = [];
    for (const item of value) {
      if (typeof item === 'string') {
        const trimmed: string = item.trim();
        if (trimmed.length > 0) {
          result.push(trimmed);
        }
      } else if (typeof item === 'number' && Number.isFinite(item)) {
        result.push(String(item));
      }
    }
    return result;
  }

  if (typeof value === 'string') {
    // "3,3,K" / "3 3 K" / "3、3、K"
    return value
      .split(/[,，、\s|]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return [String(value)];
  }

  return [];
}

/**
 * 归一化 action 字段：大小写不敏感，兼容中文表述。
 */
function normalizeAction(value: unknown, cardsCount: number): 'play' | 'pass' | null {
  if (typeof value !== 'string') {
    // 没有 action 字段时，按有无牌推断
    return cardsCount > 0 ? 'play' : null;
  }

  const normalized: string = value.trim().toLowerCase();

  if (normalized === 'play') {
    return 'play';
  }
  if (normalized === 'pass') {
    return 'pass';
  }
  // 中文与其他常见变体（L5：仅精确匹配「出」，避免把「不出」误判为 play）
  if (normalized.includes('play') || value.includes('出牌') || value === '出') {
    return 'play';
  }
  if (
    normalized.includes('pass') ||
    normalized.includes('skip') ||
    normalized.includes('fold') ||
    value.includes('过牌') ||
    value.includes('不出') ||
    value.includes('过')
  ) {
    return 'pass';
  }

  return cardsCount > 0 ? 'play' : null;
}

/** 提取 reason 字段，做长度保护。 */
function normalizeReason(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed: string = value.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

/**
 * 解析 LLM 的出牌返回。
 *
 * @param raw 模型返回的原始文本
 * @returns 归一化的 AIRawResponse；无法解析返回 null（不抛异常）
 */
export function parsePlayResponse(raw: string): ParsedPlay {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  const obj: Record<string, unknown> | null = tryParseObject(raw);
  if (obj === null) {
    return null;
  }

  // 兼容 cards / card / play / tiles 等别名
  const cardsRaw: unknown =
    obj.cards ?? obj.card ?? obj.play ?? obj.tiles ?? obj.hand ?? obj.selected;
  const cards: string[] = normalizeCardsField(cardsRaw);

  const actionRaw: unknown = obj.action ?? obj.act ?? obj.type ?? obj.decision ?? obj.move;
  const action: 'play' | 'pass' | null = normalizeAction(actionRaw, cards.length);

  if (action === null) {
    return null;
  }

  const reason: string = normalizeReason(obj.reason ?? obj.thought ?? obj.explanation ?? obj.why);

  // action 为 play 但没有任何牌 → 视为解析失败，交由上层降级
  if (action === 'play' && cards.length === 0) {
    return null;
  }

  return {
    action,
    cards: action === 'pass' ? [] : cards,
    reason,
  };
}

/**
 * 解析 LLM 的叫分返回。
 *
 * @param raw 模型返回的原始文本
 * @returns `{ score, reason }`；无法解析返回 null（不抛异常）
 */
export function parseBidResponse(raw: string): ParsedBid | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  const obj: Record<string, unknown> | null = tryParseObject(raw);
  if (obj === null) {
    return null;
  }

  const scoreRaw: unknown = obj.score ?? obj.bid ?? obj.points ?? obj.value ?? obj.call;
  let score: number | null = null;

  if (typeof scoreRaw === 'number' && Number.isFinite(scoreRaw)) {
    score = Math.trunc(scoreRaw);
  } else if (typeof scoreRaw === 'string') {
    // "2" / "2分" / "叫2分" / "不叫"
    if (scoreRaw.includes('不叫') || scoreRaw.trim().toLowerCase() === 'pass') {
      score = 0;
    } else {
      const digitMatch: RegExpExecArray | null = /(-?\d+)/.exec(scoreRaw);
      if (digitMatch !== null) {
        score = Number.parseInt(digitMatch[1], 10);
      }
    }
  }

  if (score === null || !Number.isFinite(score)) {
    return null;
  }

  const reason: string = normalizeReason(obj.reason ?? obj.thought ?? obj.explanation ?? obj.why);

  return { score, reason };
}
