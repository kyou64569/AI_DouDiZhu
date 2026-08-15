/**
 * 统一日志输出。
 *
 * 硬约束（DESIGN §1.6 / §8.4）：
 * - API Key 禁止原样出现在任何日志中；
 * - 脱敏逻辑只允许在本文件实现，其他文件一律调用 `maskApiKey` / `maskDeep`，
 *   禁止各处自行拼接密钥字符串。
 *
 * 日志格式：`[ISO时间] [级别] [模块] key=value ...`
 */

/** 日志级别，按严重程度递增 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 级别权重，用于 LOG_LEVEL 过滤 */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** 从环境变量读取的最低输出级别，默认 info */
function resolveMinLevel(): LogLevel {
  const raw: string = String(process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

/** 可能承载密钥的字段名（小写比对） */
const SENSITIVE_KEYS: readonly string[] = [
  'apikey',
  'api_key',
  'authorization',
  'token',
  'access_token',
  'secret',
  'password',
  'bearer',
];

/**
 * 对 API Key 做脱敏。
 *
 * 规则（DESIGN §8.4）：
 * - 长度 ≥ 12：保留前 6 位与后 3 位，中间替换为 `***`，如 `sk-abc***xyz`；
 * - 长度 < 12：整体替换为 `***`；
 * - 空值 / 非字符串：返回 `***`。
 *
 * @param key 原始密钥
 * @returns 脱敏后的字符串，绝不包含完整密钥
 */
export function maskApiKey(key: unknown): string {
  if (typeof key !== 'string') {
    return '***';
  }
  const trimmed: string = key.trim();
  if (trimmed.length === 0) {
    return '***';
  }
  if (trimmed.length < 12) {
    return '***';
  }
  const head: string = trimmed.slice(0, 6);
  const tail: string = trimmed.slice(-3);
  return `${head}***${tail}`;
}

/**
 * 深度脱敏任意结构中的敏感字段。
 * 用于日志打印整个请求体的场景，避免遗漏。
 *
 * @param value 任意值（对象 / 数组 / 原始值）
 * @param depth 当前递归深度，内部使用
 * @returns 脱敏后的深拷贝，可安全用于日志输出
 */
export function maskDeep(value: unknown, depth: number = 0): unknown {
  // 防御超深/循环结构
  if (depth > 6) {
    return '[深度截断]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskDeep(item, depth + 1));
  }
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const rawKey of Object.keys(src)) {
      const lower: string = rawKey.toLowerCase();
      if (SENSITIVE_KEYS.includes(lower)) {
        out[rawKey] = maskApiKey(src[rawKey]);
      } else {
        out[rawKey] = maskDeep(src[rawKey], depth + 1);
      }
    }
    return out;
  }
  return value;
}

/**
 * 把结构化字段序列化为 `key=value` 串。
 * 敏感字段自动脱敏，对象值序列化为 JSON（同样脱敏）。
 */
function formatFields(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(fields)) {
    const lower: string = key.toLowerCase();
    const raw: unknown = fields[key];
    if (raw === undefined) {
      continue;
    }
    let text: string;
    if (SENSITIVE_KEYS.includes(lower)) {
      text = maskApiKey(raw);
    } else if (raw === null) {
      text = 'null';
    } else if (typeof raw === 'object') {
      try {
        text = JSON.stringify(maskDeep(raw));
      } catch {
        text = '[不可序列化]';
      }
    } else {
      text = String(raw);
    }
    // 含空格的值加引号，保证日志可被简单解析
    const needQuote: boolean = /\s/.test(text);
    parts.push(`${key}=${needQuote ? JSON.stringify(text) : text}`);
  }
  return parts.join(' ');
}

/** 实际写出一行日志 */
function write(level: LogLevel, module: string, message: string, fields: Record<string, unknown>): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[resolveMinLevel()]) {
    return;
  }
  const ts: string = new Date().toISOString();
  const fieldText: string = formatFields(fields);
  const line: string = `[${ts}] [${level.toUpperCase()}] [${module}] ${message}${fieldText ? ' ' + fieldText : ''}`;

  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

/** 统一日志器 */
export const logger = {
  /**
   * 调试日志
   * @param module 模块名，如 `llm/chat`
   * @param message 正文
   * @param fields 结构化字段，敏感字段自动脱敏
   */
  debug(module: string, message: string, fields: Record<string, unknown> = {}): void {
    write('debug', module, message, fields);
  },

  /** 常规日志 */
  info(module: string, message: string, fields: Record<string, unknown> = {}): void {
    write('info', module, message, fields);
  },

  /** 告警日志 */
  warn(module: string, message: string, fields: Record<string, unknown> = {}): void {
    write('warn', module, message, fields);
  },

  /** 错误日志 */
  error(module: string, message: string, fields: Record<string, unknown> = {}): void {
    write('error', module, message, fields);
  },
};

export default logger;
