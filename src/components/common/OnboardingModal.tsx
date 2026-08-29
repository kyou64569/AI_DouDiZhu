/**
 * 新手引导弹窗（建议清单 #14）。
 *
 * 五步交互式引导：欢迎 → 牌型图鉴（13 种牌型真实牌面示例）→ 叫分与地主 →
 * 出牌操作 → 键盘快捷键。首次进入应用自动弹出（settingsStore.hasSeenTutorial），
 * 也可从顶栏「新手引导」随时重看。
 *
 * 纯展示组件：不直接触碰 localStorage，关闭时由调用方负责标记「已看过」。
 */

import { useState } from 'react';
import type { Card, Suit } from '@/types/card';
import { getRankLabel } from '@/engine/constants';
import { CardGroup } from '@/components/card/CardGroup';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { cn } from '@/utils/cn';

/* ------------------------- 牌面示例构造 ------------------------- */

/** 示例牌面记号 → 点数（与关卡/测试解析器同口径） */
const TOKEN_RANK: Readonly<Record<string, number>> = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14, '2': 15, 小王: 16, 大王: 17,
};

const SUIT_CYCLE: readonly Suit[] = ['SPADE', 'HEART', 'CLUB', 'DIAMOND'];

let exampleSeq = 0;

/** 把牌面文本转成确定性的示例牌（仅用于引导展示，不参与对局） */
function makeExampleCards(spec: string): Card[] {
  const used: Map<number, number> = new Map<number, number>();
  return spec
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const rank: number = TOKEN_RANK[token];
      const seen: number = used.get(rank) ?? 0;
      used.set(rank, seen + 1);
      exampleSeq += 1;
      return {
        id: `onboard-${exampleSeq}`,
        suit: rank >= 16 ? 'JOKER' : SUIT_CYCLE[seen % SUIT_CYCLE.length],
        rank,
        label: getRankLabel(rank),
      };
    });
}

/** 牌型图鉴：13 种牌型 + 示例 */
const CARD_TYPE_EXAMPLES: readonly { name: string; spec: string; desc: string }[] = [
  { name: '单张', spec: '10', desc: '任意一张牌' },
  { name: '对子', spec: 'K K', desc: '两张同点数' },
  { name: '三张', spec: 'Q Q Q', desc: '三张同点数' },
  { name: '三带一', spec: 'J J J 5', desc: '三张 + 一张单牌' },
  { name: '三带一对', spec: '9 9 9 4 4', desc: '三张 + 一个对子' },
  { name: '顺子', spec: '3 4 5 6 7', desc: '至少 5 张连续单牌，最大到 A' },
  { name: '连对', spec: '8 8 9 9 10 10', desc: '至少 3 组连续对子' },
  { name: '飞机', spec: 'Q Q Q K K K', desc: '至少 2 组连续三张' },
  { name: '飞机带单张', spec: 'Q Q Q K K K 3 4', desc: '飞机 + 等量单张' },
  { name: '飞机带对子', spec: 'Q Q Q K K K 3 3 4 4', desc: '飞机 + 等量对子' },
  { name: '四带二', spec: 'A A A A 6 7', desc: '四张 + 两张单牌（或两对）' },
  { name: '炸弹', spec: '2 2 2 2', desc: '四张同点数，可压一切非炸弹' },
  { name: '王炸', spec: '小王 大王', desc: '大王 + 小王，最大牌型' },
] as const;

/* ------------------------- 引导步骤 ------------------------- */

/** 键盘快捷键行（与 ActionBar 角标一致） */
const SHORTCUTS: readonly { keys: string; desc: string }[] = [
  { keys: 'Enter', desc: '出牌（选好牌后）' },
  { keys: 'Space', desc: '过牌' },
  { keys: 'H', desc: '提示（循环给出可压的合法牌）' },
  { keys: 'Esc', desc: '取消选牌' },
  { keys: '1 / 2 / 3', desc: '叫分阶段直接叫分' },
] as const;

export interface OnboardingModalProps {
  /** 是否展示 */
  open: boolean;
  /** 关闭回调（跳过 / 完成都会触发；调用方据此标记「已看过」） */
  onClose: () => void;
}

/**
 * 新手引导弹窗。
 */
export function OnboardingModal({ open, onClose }: OnboardingModalProps): JSX.Element | null {
  const [step, setStep] = useState<number>(0);
  const totalSteps: number = 5;
  const isLast: boolean = step === totalSteps - 1;

  const goNext = (): void => {
    if (isLast) {
      onClose();
      return;
    }
    setStep((s: number): number => Math.min(totalSteps - 1, s + 1));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`🎓 新手引导 · ${step + 1}/${totalSteps}`}
      size="lg"
      variant="dark"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: totalSteps }, (_, i: number) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-200',
                  i === step ? 'w-5 bg-gold-400' : 'w-1.5 bg-white/20',
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isLast ? (
              <Button variant="ghost" onClick={onClose} className="text-slate-400 hover:text-slate-200">
                跳过
              </Button>
            ) : null}
            {step > 0 ? (
              <Button variant="secondary" onClick={() => setStep((s: number): number => s - 1)}>
                上一步
              </Button>
            ) : null}
            <Button variant="gold" onClick={goNext}>
              {isLast ? '完成，开始游戏' : '下一步'}
            </Button>
          </div>
        </div>
      }
    >
      {step === 0 ? (
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-300">
          <p>
            欢迎来到 <span className="font-semibold text-gold-300">AI 斗地主</span>
            ：一副标准的斗地主，由大语言模型（LLM）扮演你的对手。
          </p>
          <ul className="flex flex-col gap-1.5 text-xs text-slate-400">
            <li>🧑 人机模式：你占一个座位，与两个 AI 对战；</li>
            <li>🤖 观战模式：三个 AI 互相打，你旁观它们的决策与对话；</li>
            <li>🧩 残局挑战：预设牌面速攻关，对手为内置策略 AI，不消耗模型调用；</li>
            <li>⚙️ 每个 AI 玩家可以绑定不同的模型、难度与性格，在「AI 玩家」页配置。</li>
          </ul>
          <p className="text-xs text-slate-500">提示：本引导可随时点击顶栏「新手引导」重新打开。</p>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate-400">斗地主共 13 种合法牌型。牌力顺序：3 最小 → 大王最大；2 和双王不能参与顺子、连对、飞机。</p>
          <ul className="scrollbar-thin flex max-h-[44vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {CARD_TYPE_EXAMPLES.map((example) => (
              <li
                key={example.name}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <div className="w-32 flex-none">
                  <p className="text-sm font-medium text-slate-200">{example.name}</p>
                  <p className="text-[11px] leading-snug text-slate-500">{example.desc}</p>
                </div>
                <CardGroup cards={makeExampleCards(example.spec)} size="sm" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-2.5 text-sm leading-relaxed text-slate-300">
          <p>开局先「叫地主」：按手牌强度叫 1 / 2 / 3 分（或选择不叫）。</p>
          <ul className="flex flex-col gap-1.5 text-xs text-slate-400">
            <li>· 只能叫比当前最高分更高的分；</li>
            <li>· 叫分最高者成为<b className="text-gold-300">地主</b>，获得 3 张底牌（共 20 张），其余两家为农民阵营；</li>
            <li>· 叫了几分，本局<b>底分</b>就是几分；</li>
            <li>· 每出一个炸弹/王炸倍数 ×2，春天再翻倍——结算分数 = 底分 × 倍数。</li>
          </ul>
          <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
            农民是<b>队友</b>：队友出牌走得顺时不要抢压自己人；任何人剩牌 ≤2 张时都要全力拦截。
          </p>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-2.5 text-sm leading-relaxed text-slate-300">
          <p>轮到你出牌时，点击手牌选中（再点取消），然后：</p>
          <ul className="flex flex-col gap-1.5 text-xs text-slate-400">
            <li>· <b className="text-gold-300">提示</b>：规则引擎帮你算好所有能压过上家的合法牌，循环切换；</li>
            <li>· <b className="text-gold-300">出牌</b>：打出当前选中的牌（自由回合必须出牌）；</li>
            <li>· <b className="text-gold-300">过牌</b>：要不起时选择放弃这一轮；</li>
            <li>· 顶部可开启<b>自动过牌</b>：要不起时自动帮你过，不用干等。</li>
          </ul>
          <p className="text-xs text-slate-500">
            每回合限时 30 秒，超时会自动替你出最小牌或过牌。出牌区会即时显示三家的牌与剩余张数。
          </p>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-slate-300">最后一招：用键盘操作更快。</p>
          <ul className="flex flex-col gap-1.5">
            {SHORTCUTS.map((item) => (
              <li key={item.keys} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                <kbd className="rounded border border-white/25 bg-black/30 px-2 py-0.5 font-sans font-semibold text-gold-300">
                  {item.keys}
                </kbd>
                <span className="text-slate-400">{item.desc}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">准备就绪——去「创建房间」开一局，或先来两把「残局挑战」练练手！</p>
        </div>
      ) : null}
    </Modal>
  );
}

export default OnboardingModal;
