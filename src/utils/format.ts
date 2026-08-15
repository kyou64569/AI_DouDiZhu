/**
 * 格式化工具：延迟、时间戳、牌面 label、分数等。
 * 纯函数，无副作用。
 */

/**
 * 格式化延迟毫秒为可读文本。
 *
 * @param ms 毫秒数
 * @returns 如 `238ms`、`1.24s`
 */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * 格式化时间戳为 `HH:mm:ss`。
 *
 * @param timestamp 毫秒时间戳
 */
export function formatTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '--:--:--';
  }
  const d: Date = new Date(timestamp);
  const hh: string = String(d.getHours()).padStart(2, '0');
  const mm: string = String(d.getMinutes()).padStart(2, '0');
  const ss: string = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * 格式化时间戳为 `YYYY-MM-DD HH:mm`。
 *
 * @param timestamp 毫秒时间戳
 */
export function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '—';
  }
  const d: Date = new Date(timestamp);
  const y: number = d.getFullYear();
  const mo: string = String(d.getMonth() + 1).padStart(2, '0');
  const da: string = String(d.getDate()).padStart(2, '0');
  const hh: string = String(d.getHours()).padStart(2, '0');
  const mi: string = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${hh}:${mi}`;
}

/**
 * 格式化秒数为 `mm:ss`。
 *
 * @param seconds 秒
 */
export function formatSeconds(seconds: number): string {
  const safe: number = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mm: string = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss: string = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * 格式化得分，正数补 `+` 号。
 *
 * @param score 分数
 */
export function formatScore(score: number): string {
  if (!Number.isFinite(score)) {
    return '0';
  }
  return score > 0 ? `+${score}` : String(score);
}

/**
 * 格式化倍数展示。
 *
 * @param multiplier 倍数
 */
export function formatMultiplier(multiplier: number): string {
  const safe: number = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return `×${safe}`;
}

/**
 * 对 API Key 做前端展示脱敏（仅用于列表展示，不用于日志）。
 * 与后端 `logger.maskApiKey` 规则一致：保留前 6 后 3。
 *
 * @param key 原始密钥
 */
export function maskKeyForDisplay(key: string): string {
  const trimmed: string = String(key ?? '').trim();
  if (trimmed.length === 0) {
    return '（未填写）';
  }
  if (trimmed.length < 12) {
    return '***';
  }
  return `${trimmed.slice(0, 6)}***${trimmed.slice(-3)}`;
}

/**
 * 截断长文本并加省略号。
 *
 * @param text 原文
 * @param maxLength 最大保留长度，默认 60
 */
export function truncate(text: string, maxLength: number = 60): string {
  const safe: string = String(text ?? '');
  if (safe.length <= maxLength) {
    return safe;
  }
  return `${safe.slice(0, maxLength)}…`;
}

/**
 * 把牌面 label 数组拼为可读串。
 *
 * @param labels 如 `['3','3','K']`
 * @returns 如 `3 3 K`
 */
export function formatCardLabels(labels: string[]): string {
  if (!Array.isArray(labels) || labels.length === 0) {
    return '—';
  }
  return labels.join(' ');
}
