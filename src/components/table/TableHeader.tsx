/**
 * 牌桌顶部信息栏（T04，视觉重构）。
 *
 * 展示：底分、当前倍数、对局模式、退出按钮。倍数随炸弹/王炸实时更新。
 * 退出按钮在游戏途中也可点击，调用 onExit 真正清局并返回房间页。
 *
 * 视觉重构：
 *  - 玻璃拟态顶栏（半透明深色 + 模糊 + 顶部内高光）；
 *  - 信息胶囊：底分/模式深色胶囊，倍数金色渐变胶囊（关键信息）；
 *  - 声音/语音/退出全部改为内联 SVG 图标，hover 高亮。
 */

import { memo } from 'react';
import type { RoomMode } from '@/types/config';
import { ROOM_MODE_LABEL } from '@/store/roomStore';
import { useSoundStore } from '@/store/soundStore';
import { formatMultiplier } from '@/utils/format';
import { cn } from '@/utils/cn';

export interface TableHeaderProps {
  /** 底分（最高叫分） */
  baseScore: number;
  /** 当前倍数 */
  multiplier: number;
  /** 对局模式 */
  mode: RoomMode | null;
  /** 退出对局回调：清空牌桌 + 清房间 + 返回房间页（游戏途中也可触发） */
  onExit?: () => void;
  /** 自动过牌开关状态 */
  autoPassEnabled: boolean;
  /** 切换自动过牌 */
  onToggleAutoPass: () => void;
  /** 额外类名 */
  className?: string;
}

/** 音量图标 */
function VolumeIcon({ muted }: { muted: boolean }): JSX.Element {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M11 5L6 9H2v6h4l5 4V5z" strokeLinejoin="round" />
      {muted ? (
        <path d="M16 9l6 6M22 9l-6 6" strokeLinecap="round" />
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 010 7" strokeLinecap="round" />
          <path d="M18.5 5.5a9.5 9.5 0 010 13" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** TTS 喊牌图标 */
function VoiceIcon({ enabled }: { enabled: boolean }): JSX.Element {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M11 5L6 9H2v6h4l5 4V5z" strokeLinejoin="round" />
      {enabled ? (
        <>
          <path d="M15 9.5a3.5 3.5 0 010 5" strokeLinecap="round" />
          <path d="M18 7a7 7 0 010 10" strokeLinecap="round" />
        </>
      ) : (
        <path d="M16 9l6 6M22 9l-6 6" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** 退出图标 */
function ExitIcon(): JSX.Element {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 顶部信息栏。 */
export const TableHeader = memo(function TableHeader({
  baseScore,
  multiplier,
  mode,
  onExit,
  autoPassEnabled,
  onToggleAutoPass,
  className,
}: TableHeaderProps): JSX.Element {
  const soundEnabled = useSoundStore((s) => s.enabled);
  const volume = useSoundStore((s) => s.volume);
  const setEnabled = useSoundStore((s) => s.setEnabled);
  const setVolume = useSoundStore((s) => s.setVolume);
  const ttsEnabled = useSoundStore((s) => s.ttsEnabled);
  const setTtsEnabled = useSoundStore((s) => s.setTtsEnabled);

  return (
    <header
      className={cn(
        'glass-panel flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl px-4 py-2.5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        {/* 底分 */}
        <div className="flex items-center gap-1.5 rounded-lg bg-black/30 px-2.5 py-1">
          <span className="text-xs text-white/60">底分</span>
          <span className="text-sm font-bold tabular-nums text-white">{baseScore}</span>
        </div>

        {/* 倍数：金色强调 */}
        <div className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-gold-300 to-gold-500 px-2.5 py-1 shadow-[0_2px_10px_rgba(245,158,11,0.35)]">
          <span className="text-xs font-medium text-gold-950/70">倍数</span>
          <span className="text-sm font-black tabular-nums text-gold-950">{formatMultiplier(multiplier)}</span>
        </div>

        {mode ? (
          <div className="flex items-center gap-1.5 rounded-lg bg-black/30 px-2.5 py-1">
            <span className="text-xs text-white/60">模式</span>
            <span className="text-sm font-medium text-white/90">{ROOM_MODE_LABEL[mode]}</span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 md:gap-2">
        {/* 自动过牌：勾选后要不起时立即过牌，无需手动/AI 思考 */}
        <label
          title={autoPassEnabled ? '自动过牌已开启：要不起时立即过牌' : '开启自动过牌：要不起时立即过牌'}
          className={cn(
            'flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-xl px-2.5 transition-all duration-150 active:scale-95',
            autoPassEnabled
              ? 'bg-gold-400/25 text-gold-300 hover:bg-gold-400/35'
              : 'bg-white/10 text-white/70 hover:bg-white/15',
          )}
        >
          <input
            type="checkbox"
            checked={autoPassEnabled}
            onChange={onToggleAutoPass}
            aria-label="自动过牌"
            className="h-3.5 w-3.5 cursor-pointer accent-gold-400"
          />
          <span className="text-xs font-medium">自动过牌</span>
        </label>

        {/* 喊牌语音 */}
        <button
          type="button"
          onClick={() => setTtsEnabled(!ttsEnabled)}
          title={ttsEnabled ? '关闭喊牌语音' : '开启喊牌语音'}
          aria-pressed={ttsEnabled}
          aria-label={ttsEnabled ? '关闭喊牌语音' : '开启喊牌语音'}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 active:scale-95',
            ttsEnabled ? 'bg-gold-400/25 text-gold-300 hover:bg-gold-400/35' : 'bg-white/10 text-white/70 hover:bg-white/15',
          )}
        >
          <VoiceIcon enabled={ttsEnabled} />
        </button>

        {/* 声音 + 音量 */}
        <div className="flex items-center gap-2 rounded-xl bg-white/10 py-1 pl-1 pr-2">
          <button
            type="button"
            onClick={() => setEnabled(!soundEnabled)}
            title={soundEnabled ? '关闭声音' : '开启声音'}
            aria-pressed={soundEnabled}
            aria-label={soundEnabled ? '关闭声音' : '开启声音'}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150 active:scale-95',
              soundEnabled ? 'text-white hover:bg-white/10' : 'text-white/50',
            )}
          >
            <VolumeIcon muted={!soundEnabled} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={soundEnabled ? volume : 0}
            disabled={!soundEnabled}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="音量"
            title="音量"
            className="h-1 w-16 cursor-pointer accent-gold-400 disabled:opacity-40 md:w-20"
          />
        </div>

        {/* 退出对局 */}
        <button
          type="button"
          onClick={onExit}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-sm font-medium text-white/85 transition-all duration-150 hover:bg-red-500/25 hover:text-white active:scale-95"
        >
          <ExitIcon />
          <span className="hidden sm:inline">退出对局</span>
        </button>
      </div>
    </header>
  );
});

export default TableHeader;
