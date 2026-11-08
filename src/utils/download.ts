/**
 * 浏览器端文件下载工具。
 *
 * 统一 Blob + a[download] + revokeObjectURL 的下载套路，
 * 供配置导出（ModelConfigPage）与对局/思考日志导出（ThinkingLogPanel）复用。
 */

/**
 * 把文本内容保存为本地文件。
 *
 * @param content 文件内容
 * @param filename 下载文件名（含扩展名）
 * @param mime MIME 类型，默认纯文本 UTF-8
 */
export function downloadTextFile(content: string, filename: string, mime: string = 'text/plain;charset=utf-8'): void {
  const blob: Blob = new Blob([content], { type: mime });
  const url: string = URL.createObjectURL(blob);
  const a: HTMLAnchorElement = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 生成导出文件名的时间戳段（如 20261101-1530），避免跨平台非法字符 */
export function exportTimestamp(): string {
  const d: Date = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
