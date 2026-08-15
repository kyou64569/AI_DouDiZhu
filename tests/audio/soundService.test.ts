/**
 * 声音服务（soundService）单元测试。
 *
 * 重点验证：
 * - 真实调用 Web Audio API（createOscillator / createBufferSource / createBiquadFilter 等）；
 * - 各音效类型确实触发对应节点；
 * - enabled=false / bgEnabled=false 守卫下静默 no-op；
 * - 无 window / AudioContext 环境（如 Node / SSR）下不抛异常。
 *
 * vitest 环境为 node，没有真实 Web Audio，这里提供一个可计数的 FakeAudioContext。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Fake Web Audio ----------
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
  disconnect(): void {
    /* noop */
  }
  start(): void {
    /* noop */
  }
  stop(): void {
    /* noop */
  }
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
  createBuffer(_channels: number, length: number): FakeBuffer {
    return new FakeBuffer(length);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
}

const FakeCtor = FakeAudioContext as unknown as typeof AudioContext;

/** 重置计数并给当前测试装上 fake window */
function installFakeWindow(): void {
  FakeAudioContext.oscillatorCount = 0;
  FakeAudioContext.gainCount = 0;
  FakeAudioContext.bufferSourceCount = 0;
  FakeAudioContext.filterCount = 0;
  (globalThis as any).window = { AudioContext: FakeCtor, webkitAudioContext: undefined };
}

async function loadService() {
  vi.resetModules();
  installFakeWindow();
  return (await import('@/audio/soundService')) as typeof import('@/audio/soundService');
}

beforeEach(() => {
  installFakeWindow();
});

afterEach(() => {
  (globalThis as any).window = undefined;
});

describe('soundService — 音效触发真实音频 API', () => {
  it('playSfx("play") 同时产生振荡器与噪声缓冲源', async () => {
    const svc = await loadService();
    svc.unlock();
    svc.playSfx('play');
    expect(FakeAudioContext.oscillatorCount).toBeGreaterThanOrEqual(1);
    expect(FakeAudioContext.bufferSourceCount).toBeGreaterThanOrEqual(1);
  });

  it('playSfx("bomb") 触发轰鸣（噪声 + 低频振荡）', async () => {
    const svc = await loadService();
    svc.unlock();
    svc.playSfx('bomb');
    expect(FakeAudioContext.bufferSourceCount).toBeGreaterThanOrEqual(1);
    expect(FakeAudioContext.oscillatorCount).toBeGreaterThanOrEqual(1);
  });

  it('playSfx("win") 触发多声部上行琶音', async () => {
    const svc = await loadService();
    svc.unlock();
    svc.playSfx('win');
    // 4 个音 → 至少 4 个振荡器
    expect(FakeAudioContext.oscillatorCount).toBeGreaterThanOrEqual(4);
  });

  it('startBackground 起播并创建双振荡垫音', async () => {
    const svc = await loadService();
    svc.unlock();
    svc.startBackground();
    expect(FakeAudioContext.oscillatorCount).toBeGreaterThanOrEqual(2);
    expect(FakeAudioContext.filterCount).toBeGreaterThanOrEqual(1);
  });

  it('startBackground 重复调用不会叠加多份背景音', async () => {
    const svc = await loadService();
    svc.unlock();
    svc.startBackground();
    const afterFirst = FakeAudioContext.oscillatorCount;
    svc.startBackground();
    expect(FakeAudioContext.oscillatorCount).toBe(afterFirst);
  });

  it('stopBackground 不会抛错且可再次起播', async () => {
    const svc = await loadService();
    svc.unlock();
    svc.startBackground();
    expect(() => svc.stopBackground()).not.toThrow();
    svc.startBackground();
    expect(FakeAudioContext.oscillatorCount).toBeGreaterThanOrEqual(2);
  });
});

describe('soundService — 守卫', () => {
  it('enabled=false 时 playSfx 静默 no-op', async () => {
    const svc = await loadService();
    svc.unlock();
    svc.configure({ enabled: false });
    svc.playSfx('play');
    expect(FakeAudioContext.oscillatorCount).toBe(0);
  });

  it('bgEnabled=false 时 startBackground 静默 no-op', async () => {
    const svc = await loadService();
    svc.unlock();
    svc.configure({ bgEnabled: false });
    svc.startBackground();
    expect(FakeAudioContext.oscillatorCount).toBe(0);
  });

  it('无 window / AudioContext 环境下所有方法不抛异常', async () => {
    vi.resetModules();
    (globalThis as any).window = undefined;
    const svc = (await import('@/audio/soundService')) as typeof import('@/audio/soundService');
    expect(() => {
      svc.playSfx('play');
      svc.playSfx('bomb');
      svc.playSfx('win');
      svc.startBackground();
      svc.stopBackground();
      svc.unlock();
    }).not.toThrow();
  });
});

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

function installFakeSpeech(): FakeSpeechSynthesis {
  const synth = new FakeSpeechSynthesis();
  (globalThis as any).window = {
    AudioContext: FakeCtor,
    webkitAudioContext: undefined,
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
  };
  return synth;
}

describe('soundService — TTS 喊牌', () => {
  it('speak 通过 window.speechSynthesis 念出中文文案', async () => {
    const synth = installFakeSpeech();
    const svc = (await import('@/audio/soundService')) as typeof import('@/audio/soundService');
    svc.speak('出一对七');
    expect(synth.utterances.length).toBe(1);
    expect(synth.utterances[0].text).toBe('出一对七');
    expect(synth.utterances[0].lang).toBe('zh-CN');
  });

  it('ttsEnabled=false 时 speak 静默 no-op', async () => {
    const synth = installFakeSpeech();
    const svc = (await import('@/audio/soundService')) as typeof import('@/audio/soundService');
    svc.setTtsEnabled(false);
    svc.speak('出A');
    expect(synth.utterances.length).toBe(0);
    svc.setTtsEnabled(true); // 复位，避免影响其它用例
  });

  it('空文本不触发播报', async () => {
    const synth = installFakeSpeech();
    const svc = (await import('@/audio/soundService')) as typeof import('@/audio/soundService');
    svc.speak('   ');
    expect(synth.utterances.length).toBe(0);
  });

  it('无 window / speechSynthesis 环境下 speak 不抛异常', async () => {
    vi.resetModules();
    (globalThis as any).window = undefined;
    const svc = (await import('@/audio/soundService')) as typeof import('@/audio/soundService');
    expect(() => svc.speak('出A')).not.toThrow();
  });

  it('configure({ ttsEnabled:false }) 也能关闭 TTS', async () => {
    const synth = installFakeSpeech();
    const svc = (await import('@/audio/soundService')) as typeof import('@/audio/soundService');
    svc.configure({ ttsEnabled: false });
    svc.speak('出A');
    expect(synth.utterances.length).toBe(0);
    svc.configure({ ttsEnabled: true });
  });
});
