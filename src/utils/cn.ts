/**
 * Tailwind 条件类名拼接。
 * 对 `clsx` 做一层薄封装，统一项目内的调用入口。
 */

import clsx, { type ClassValue } from 'clsx';

/**
 * 合并类名。支持字符串、数组、对象条件形式。
 *
 * @example
 * cn('px-2', isActive && 'bg-brand-500', { 'opacity-50': disabled })
 *
 * @param inputs 任意数量的类名片段
 * @returns 拼接后的类名字符串
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(...inputs);
}

export default cn;
