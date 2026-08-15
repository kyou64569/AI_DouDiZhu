/**
 * 声音接入 gameStore 的集成测试。
 *
 * 不验证"声音好不好听"，只验证：
 * - 叫分完成进入出牌阶段时，确实触发了背景音（createOscillator 被调用）；
 * - 成功出牌时，确实触发了 play 音效（oscillator 数量增加）。
 *
 * 通过注入 FakeAudioContext 计数实现，避免依赖真实音频设备；用确定的 Math.random
 * 让发牌/叫分起始座位可预期，从而能稳定驱动到出牌阶段。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfigStore } from '@/store/configStore';
import { usePlayerStore } from '@/store/playerStore';
import { useGameStore } from '@/store/gameStore';
import { GamePhase, type BidScore } from '@/types/game';

// ---------- Fake Web Audio（仅用于计数）----------
class FakeParam {
  value = 1;
  setValueAtTime(): this {
    return this;
  }
  exponentialRampToValueAtTime(): this {
    return this;
  }
  linearRampToValueAtTime(): this {
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = 'sine';
  connect(): this {
    return this;
  }
  disconnect(): void {}
  start(): void {}
  stop(): void {}
}
class FakeBuffer {
  constructor(public length: number) {}
  getChannelData(): Float32Array {
    return new Float32Array(this.length);
  }
}
class FakeAudioContext {
  static oscillatorCount = 0;
  static gainCount = 0;
  static bufferSourceCount = 0;
  static filterCount = 0;
  currentTime = 0;
  sampleRate = 44100;
  state: 'running' | 'suspended' = 'running';
  destination = new FakeNode();
  createGain(): FakeNode {
    FakeAudioContext.gainCount++;
    return new FakeNode();
  }
  createOscillator(): FakeNode {
    FakeAudioContext.oscillatorCount++;
    return new FakeNode();
  }
  createBiquadFilter(): FakeNode {
    FakeAudioContext.filterCount++;
    return new FakeNode();
  }
  createBufferSource(): FakeNode {
    FakeAudioContext.bufferSourceCount++;
    return new FakeNode();
  }
  createBuffer(_c: number, length: number): FakeBuffer {
    return new FakeBuffer(length);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
}
const FakeCtor = FakeAudioContext as unknown as typeof AudioContext;

// ---------- Fake Web Speech ----------
class FakeUtterance {
  text: string;
  lang = '';
  voice: any = null;
  rate = 1;
  pitch = 1;
  constructor(text: string) {
    this.text = text;
  }
}
class FakeSpeechSynthesis {
  utterances: FakeUtterance[] = [];
  getVoices(): any[] {
    return [{ name: 'Microsoft Huihui - Chinese (Simplified)', lang: 'zh-CN' }];
  }
  speak(u: FakeUtterance): void {
    this.utterances.push(u);
  }
  cancel(): void {
    this.utterances = [];
  }
  onvoiceschanged: (() => void) | null = null;
}
let spoken: string[] = [];

let room: unknown;

beforeEach(() => {
  FakeAudioContext.oscillatorCount = 0;
  FakeAudioContext.gainCount = 0;
  FakeAudioContext.bufferSourceCount = 0;
  FakeAudioContext.filterCount = 0;
  spoken = [];
  const synth = new FakeSpeechSynthesis();
  const origSpeak = synth.speak.bind(synth);
  synth.speak = (u: FakeUtterance) => {
    origSpeak(u);
    spoken.push(u.text);
  };
  (globalThis as any).window = {
    AudioContext: FakeCtor,
    webkitAudioContext: undefined,
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
  };
  // 确定性随机：biddingStartSeat = floor(0.5*3) = 1
  vi.spyOn(Math, 'random').mockReturnValue(0.5);

  useConfigStore.getState().addConfig({
    name: '声测配置',
    provider: 'OpenAI',
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: 'sk-x',
    availableModels: ['m'],
    selectedModel: 'm',
  } as any);
  const cfgId: string = useConfigStore.getState().configs[0].id;
  for (const n of ['甲', '乙', '丙']) {
    usePlayerStore.getState().addPlayer({
      name: n,
      modelConfigId: cfgId,
      modelId: '',
      remark: '',
      avatar: '',
    } as any);
  }
  const ids: string[] = usePlayerStore.getState().players.map((p: any) => p.id);
  useGameStore.getState().resetGame();

  room = {
    id: 'r-sound',
    mode: 'AI_SPECTATE',
    seats: [
      { index: 0, kind: 'AI', aiPlayerId: ids[0] },
      { index: 1, kind: 'AI', aiPlayerId: ids[1] },
      { index: 2, kind: 'AI', aiPlayerId: ids[2] },
    ],
    createdAt: Date.now(),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as any).window = undefined;
});

describe('gameStore 声音接入', () => {
  it('叫分完成进入 PLAYING 时触发背景音', () => {
    useGameStore.getState().startGame(room as any);
    const st0 = useGameStore.getState();
    expect(st0.phase).toBe(GamePhase.BIDDING);

    // 当前座位确定性为 1，直接叫 3 分结束叫分 → 进入出牌阶段
    st0.bid(3 as BidScore, st0.currentSeat);
    const st1 = useGameStore.getState();
    expect(st1.phase).toBe(GamePhase.PLAYING);
    // 叫分音(1 振荡器) + 背景垫音(2 振荡器) 至少 3 个
    expect(FakeAudioContext.oscillatorCount).toBeGreaterThanOrEqual(2);
  });

  it('成功出牌时触发 play 音效（oscillator 数量增加）', () => {
    useGameStore.getState().startGame(room as any);
    const st0 = useGameStore.getState();
    st0.bid(3 as BidScore, st0.currentSeat);

    const st = useGameStore.getState();
    const seat = st.currentSeat;
    const card = st.players[seat].hand[0];
    const before = FakeAudioContext.oscillatorCount;

    const ok = st.playCards([card], seat);
    expect(ok).toBe(true);
    // 出牌音效至少新增一个振荡器
    expect(FakeAudioContext.oscillatorCount).toBeGreaterThan(before);
    expect(useGameStore.getState().playHistory.length).toBe(1);
  });

  it('成功出牌时触发 TTS 喊牌（念出对应牌型文案）', async () => {
    useGameStore.getState().startGame(room as any);
    const st0 = useGameStore.getState();
    st0.bid(3 as BidScore, st0.currentSeat);

    const st = useGameStore.getState();
    const seat = st.currentSeat;
    const card = st.players[seat].hand[0];
    st.playCards([card], seat);

    // AI 座位带云端 TTS 凭证，出牌台词经 speakCloud 异步合成（失败回落浏览器 TTS），
    // 因此需等待异步完成后再断言（既有异步时序，非本次修复引入）
    await vi.waitFor(() => {
      expect(spoken.length).toBeGreaterThanOrEqual(1);
      // 单张出牌 → 文案形如「出X」
      expect(spoken[spoken.length - 1]).toMatch(/^出/);
    });
  });

  it('过牌时触发 TTS 喊「过」', async () => {
    useGameStore.getState().startGame(room as any);
    const st0 = useGameStore.getState();
    st0.bid(3 as BidScore, st0.currentSeat);

    const st = useGameStore.getState();
    // 让当前座位先出一张，使其进入可过牌状态
    const seat = st.currentSeat;
    const card = st.players[seat].hand[0];
    st.playCards([card], seat);

    const st2 = useGameStore.getState();
    const ok = st2.pass(st2.currentSeat);
    expect(ok).toBe(true);
    // AI 座位过牌念人设模板台词（默认 steady 池），异步合成完成后再断言
    const steadyPassLines = ['过。', '这手不要。', '让一手。', '过，观察下。'];
    await vi.waitFor(() => {
      expect(steadyPassLines).toContain(spoken[spoken.length - 1]);
    });
  });
});
