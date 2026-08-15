/**
 * localStorage 统一读写封装（DESIGN §8.6）。
 *
 * 硬性约定：
 * 1. 全项目**只有本文件**直接触碰 `localStorage`，其余模块一律调用这里的函数。
 * 2. 所有读取路径均 try/catch，遇到「键不存在 / 非法 JSON / 类型不符 / 用户手工篡改」
 *    时一律回落到默认值，绝不抛异常导致页面白屏。
 * 3. 写入失败（隐私模式、配额超限）只记录一次告警并返回 false，不影响内存态。
 */

/** 应用使用的全部 localStorage 键名（DESIGN §8.6，禁止各处硬编码） */
export const STORAGE_KEYS = {
  /** ModelConfig[] */
  CONFIGS: 'dz.configs',
  /** AIPlayer[] */
  PLAYERS: 'dz.players',
  /** 数据版本号，用于后续迁移 */
  VERSION: 'dz.meta.version',
  /** 密钥风险告知已确认标记，值固定为 "1" */
  KEY_WARNING_ACK: 'dz.meta.keyWarningAck',
  /** AppSettings（AI 决策超时等全局偏好） */
  SETTINGS: 'dz.settings',
  /** SoundSettings（音效总开关 / 背景音开关 / 主音量） */
  SOUND: 'dz.sound',
  /** 对局历史记录（GameRecord[]） */
  HISTORY: 'dz.history',
} as const;

/** 键名字面量类型 */
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** 当前数据版本号 */
export const DATA_VERSION: string = '1';

/** 密钥告知已确认时写入的值 */
const ACK_VALUE: string = '1';

/** 存储可用性探测结果缓存，undefined 表示尚未探测 */
let storageAvailableCache: boolean | undefined = undefined;

/** 写入失败告警是否已打印过（避免刷屏） */
let writeWarnPrinted: boolean = false;

/**
 * 探测 localStorage 是否真正可用。
 *
 * Safari 无痕模式下 `localStorage` 对象存在但写入会抛异常，
 * 因此必须做一次真实读写探测而不能只判断对象是否存在。
 *
 * @returns 可用返回 true
 */
export function isStorageAvailable(): boolean {
  if (storageAvailableCache !== undefined) {
    return storageAvailableCache;
  }
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      storageAvailableCache = false;
      return false;
    }
    const probeKey: string = '__dz_probe__';
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    storageAvailableCache = true;
  } catch {
    storageAvailableCache = false;
  }
  return storageAvailableCache;
}

/**
 * 读取原始字符串。
 *
 * @param key 存储键
 * @returns 不存在或读取异常时返回 null
 */
export function readRaw(key: string): string | null {
  if (!isStorageAvailable()) {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 写入原始字符串。
 *
 * @param key 存储键
 * @param value 字符串值
 * @returns 写入成功返回 true
 */
export function writeRaw(key: string, value: string): boolean {
  if (!isStorageAvailable()) {
    return false;
  }
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err: unknown) {
    if (!writeWarnPrinted) {
      writeWarnPrinted = true;
      const detail: string = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[persist] 本地存储写入失败，数据仅保留在内存中：${detail}`);
    }
    return false;
  }
}

/**
 * 删除某个键。
 *
 * @param key 存储键
 * @returns 删除成功返回 true
 */
export function removeItem(key: string): boolean {
  if (!isStorageAvailable()) {
    return false;
  }
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取并反序列化 JSON。
 *
 * 任何异常（键不存在、非法 JSON、被手工改成 `"{{{"`）都会返回 `fallback`。
 *
 * @param key 存储键
 * @param fallback 解析失败时的默认值
 * @returns 解析结果或默认值
 */
export function readJson<T>(key: string, fallback: T): T {
  const raw: string | null = readRaw(key);
  if (raw === null || raw.length === 0) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || parsed === undefined) {
      return fallback;
    }
    return parsed as T;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(`[persist] 键 "${key}" 的内容不是合法 JSON，已回落到默认值`);
    return fallback;
  }
}

/**
 * 序列化并写入 JSON。
 *
 * @param key 存储键
 * @param value 任意可序列化值
 * @returns 写入成功返回 true
 */
export function writeJson<T>(key: string, value: T): boolean {
  let serialized: string = '';
  try {
    serialized = JSON.stringify(value);
  } catch (err: unknown) {
    const detail: string = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[persist] 键 "${key}" 序列化失败：${detail}`);
    return false;
  }
  return writeRaw(key, serialized);
}

/**
 * 读取一个「实体数组」并逐项做类型守卫过滤。
 *
 * 这是防篡改的关键：即使用户把 `dz.configs` 改成对象、字符串或掺入残缺元素，
 * 也只会得到一个合法子集（最坏情况是空数组），页面不会崩。
 *
 * @param key 存储键
 * @param isValid 单项类型守卫
 * @returns 合法元素组成的数组，异常时为空数组
 */
export function readArray<T>(key: string, isValid: (item: unknown) => item is T): T[] {
  const parsed: unknown = readJson<unknown>(key, null);
  if (!Array.isArray(parsed)) {
    if (parsed !== null) {
      // eslint-disable-next-line no-console
      console.warn(`[persist] 键 "${key}" 期望数组但得到 ${typeof parsed}，已回落为空数组`);
    }
    return [];
  }
  const valid: T[] = [];
  let dropped: number = 0;
  for (const item of parsed) {
    if (isValid(item)) {
      valid.push(item);
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[persist] 键 "${key}" 中有 ${dropped} 条数据结构非法，已跳过`);
  }
  return valid;
}

/**
 * 数据迁移调度（L9 骨架）。
 * 当前仅有 v1，无实际迁移；后续结构性变更时在此注册 `from → 升级动作`。
 * 迁移必须幂等（用户可能在迁移中途刷新/关闭）；未知旧版本（如被篡改）不强行迁移。
 * 任何持久化读取前都应先调用 ensureDataVersion()。
 */
type Migration = () => void;
const MIGRATIONS: Readonly<Record<string, Migration>> = {
  // '1': () => { /* v1 → v2 示例：字段改名 / 结构重排 */ },
};

/**
 * 确保数据版本号已写入；版本落后时沿迁移链逐级升级。
 */
export function ensureDataVersion(): void {
  const current: string | null = readRaw(STORAGE_KEYS.VERSION);
  if (current === DATA_VERSION) return;
  let version: string = current ?? '';
  let guard: number = 0;
  while (version !== DATA_VERSION && guard < 16) {
    const migrate: Migration | undefined = MIGRATIONS[version];
    if (migrate === undefined) break;
    migrate();
    version = String(Number(version) + 1);
    guard += 1;
  }
  writeRaw(STORAGE_KEYS.VERSION, DATA_VERSION);
}

/**
 * 读取当前数据版本号。
 *
 * @returns 未写入时返回空字符串
 */
export function readDataVersion(): string {
  return readRaw(STORAGE_KEYS.VERSION) ?? '';
}

/**
 * 密钥风险告知是否已被用户确认过（PRD D1）。
 *
 * @returns 已确认返回 true
 */
export function isKeyWarningAcknowledged(): boolean {
  return readRaw(STORAGE_KEYS.KEY_WARNING_ACK) === ACK_VALUE;
}

/**
 * 记录用户已确认密钥风险告知，后续不再弹窗。
 */
export function acknowledgeKeyWarning(): void {
  writeRaw(STORAGE_KEYS.KEY_WARNING_ACK, ACK_VALUE);
}

/**
 * 撤销密钥风险告知标记（仅调试用，便于重新验证首次弹窗）。
 */
export function resetKeyWarningAck(): void {
  removeItem(STORAGE_KEYS.KEY_WARNING_ACK);
}

/**
 * 清空本应用写入的全部本地数据。
 *
 * @returns 实际删除的键数量
 */
export function clearAllAppData(): number {
  let count: number = 0;
  for (const key of Object.values(STORAGE_KEYS)) {
    if (removeItem(key)) {
      count += 1;
    }
  }
  return count;
}

/** 类型守卫工具：判断是否为非空字符串 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 类型守卫工具：判断是否为普通对象（非 null、非数组） */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把任意值安全转为字符串数组（过滤非字符串项）。
 *
 * @param value 任意值
 * @returns 字符串数组，非数组输入返回空数组
 */
export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item: unknown): item is string => typeof item === 'string');
}

/**
 * 把任意值安全转为数字（用于 createdAt / updatedAt 这类时间戳）。
 *
 * @param value 任意值
 * @param fallback 非法时的默认值
 */
export function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
