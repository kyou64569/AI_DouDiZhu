/**
 * 底部操作条（T04，REQ-R5，视觉重构）。
 *
 * 人类回合可用：出牌 / 过牌 / 提示 / 重选。
 * 出牌按钮在「非自由出牌轮」始终可用；过牌按钮在「自由出牌轮」禁用（必须出牌）。
 *
 * 视觉重构：
 *  - 「出牌」为金色渐变主按钮，选中牌时显示张数徽章；
 *  - 「提示」品牌蓝；「过牌」次级；「重选」幽灵按钮弱化；
 *  - 全部按钮带按压缩放微反馈。
 */

import { memo } from 'react';
import { Button } from '@/components/common/Button';
import { cn } from '@/utils/cn';

export interface ActionBarProps {
  /** 是否有选中牌（用于控制「出牌」可用） */
  hasSelection: boolean;
  /** 已选牌数量（显示在出牌按钮上） */
  selectedCount?: number;
  /** 是否自由出牌轮（自由轮不允许过牌） */
  isFreeTurn: boolean;
  /** 人类是否当前回合 */
  isHumanTurn: boolean;
  /** 点击出牌 */
  onPlay: () => void;
  /** 点击过牌 */
  onPass: () => void;
  /** 点击提示 */
  onHint: () => void;
  /** 点击重选 */
  onClear: () => void;
  /** 额外类名 */
  className?: string;
}

/** 底部操作条。 */
export const ActionBar = memo(function ActionBar({
  hasSelection,
  selectedCount = 0,
  isFreeTurn,
  isHumanTurn,
  onPlay,
  onPass,
  onHint,
  onClear,
  className,
}: ActionBarProps): JSX.Element {
  const enabled: boolean = isHumanTurn;
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-2.5 md:gap-3', className)}>
      <Button
        variant="gold"
        size="lg"
        disabled={!enabled || !hasSelection}
        onClick={onPlay}
        className="relative min-w-[7.5rem]"
      >
        出牌
        {hasSelection && selectedCount > 0 ? (
          <span className="ml-1 rounded-full bg-gold-950/20 px-2 py-0.5 text-xs font-bold tabular-nums">
            {selectedCount} 张
          </span>
        ) : null}
      </Button>
      <Button
        variant="primary"
        size="lg"
        disabled={!enabled}
        onClick={onHint}
        icon={
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0012 3z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
      >
        提示
      </Button>
      <Button variant="secondary" size="lg" disabled={!enabled || isFreeTurn} onClick={onPass}>
        过牌
      </Button>
      <Button variant="ghost" size="lg" disabled={!enabled || !hasSelection} onClick={onClear}>
        重选
      </Button>
    </div>
  );
});

export default ActionBar;
