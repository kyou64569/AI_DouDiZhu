/**
 * 声音服务（Web Audio 程序化合成 + 浏览器内置 TTS 喊牌，零素材依赖）。
 *
 * 为什么是程序化合成而非音频文件：
 * 本游戏是轻交互卡牌对战，出牌/过牌/叫分/炸弹/胜负提示用振荡器即时合成完全够用，
 * 背景音用一段极轻的合成垫音循环，避免引入 mp3/wav 的版权、体积与素材来源问题。
 *
 * 关键约束（务必遵守）：
 * 1. 浏览器自动播放策略：AudioContext 初始为 `suspended`，必须在用户手势内 `resume()`。
 *    本模块提供 `unlock()`，由 UI 的「开始游戏」按钮或音效开关点击触发。
 * 2. 测试 / SSR 守卫：Node 环境（vitest `environment: 'node'`）没有 `window`/`AudioContext`，
 *    所有方法在无环境时必须静默 no-op，绝不抛异常，保证单测与 jsdom 脚本不崩。
 * 3. 本模块是叶子模块，不 import 任何 store，store/组件通过 `configure/playSfx/...` 调用。
 */

import { synthesizeSpeech, TTS_TIMEOUT_MS } from '@/api/tts';

/** 支持的音效类型 */
export type SfxType = 'play' | 'pass' | 'bid' | 'bomb' | 'win' | 'lose';

/** 声音配置（由 soundStore 推送） */
interface SoundConfig {
  /** 总开关 */
  enabled: boolean;
  /** 背景音开关 */
  bgEnabled: boolean;
  /** 主音量 0~1 */
  volume: number;
  /** TTS（喊牌）开关 */
  ttsEnabled?: boolean;
}

const DEFAULT_VOLUME: number = 0.6;

let enabled: boolean = true;
let bgEnabled: boolean = true;
let volume: number = DEFAULT_VOLUME;
let ttsEnabled: boolean = true;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bg: { osc: OscillatorNode[]; gain: GainNode } | null = null;
let bgPlaying: boolean = false;

/** 取（惰性创建）AudioContext；无环境返回 null */
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor: typeof AudioContext | undefined = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
      return null;
    }
  }
  return ctx;
}

/**
 * 由 soundStore 推送最新配置。
 */
export function configure(cfg: Partial<SoundConfig>): void {
  if (typeof cfg.enabled === 'boolean') enabled = cfg.enabled;
  if (typeof cfg.bgEnabled === 'boolean') bgEnabled = cfg.bgEnabled;
  if (typeof cfg.ttsEnabled === 'boolean') ttsEnabled = cfg.ttsEnabled;
  if (typeof cfg.volume === 'number' && Number.isFinite(cfg.volume)) {
    volume = Math.min(1, Math.max(0, cfg.volume));
  }
  if (master && ctx) master.gain.value = volume;
  if (!bgEnabled && bgPlaying) stopBackground();
}

/**
 * 在用户手势内调用，解除浏览器自动播放限制。
 */
export function unlock(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') {
    void c.resume().catch(() => {});
  }
  // 语音列表常异步加载，趁手势内预热，之后 onvoiceschanged 再补选
  primeVoices();
}

/** 单个振荡器音：支持起止频率滑音 + 指数包络 */
function tone(
  freqStart: number,
  freqEnd: number,
  dur: number,
  type: OscillatorType,
  peak: number,
  delay = 0,
): void {
  const c = ctx;
  const m = master;
  if (!c || !m) return;
  const t0: number = c.currentTime + delay;
  const osc: OscillatorNode = c.createOscillator();
  const g: GainNode = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t0);
  if (freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(m);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 噪声爆破（用于出牌"啪"与炸弹轰鸣） */
function noise(dur: number, peak: number, filterFreq: number, delay = 0): void {
  const c = ctx;
  const m = master;
  if (!c || !m) return;
  const t0: number = c.currentTime + delay;
  const len: number = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf: AudioBuffer = c.createBuffer(1, len, c.sampleRate);
  const data: Float32Array = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src: AudioBufferSourceNode = c.createBufferSource();
  src.buffer = buf;
  const filt: BiquadFilterNode = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = filterFreq;
  const g: GainNode = c.createGain();
  g.gain.setValueAtTime(Math.max(0.0001, peak), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt).connect(g).connect(m);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/**
 * 播放指定音效。未解锁 / 关闭 / 无环境时静默返回。
 */
export function playSfx(type: SfxType): void {
  const c = getCtx();
  if (!c || !master) return;
  if (c.state === 'suspended') return; // 尚未在用户手势内解锁
  if (!enabled) return;

  switch (type) {
    case 'play':
      // 出牌：轻噪点 + 短促下滑音，干净利落
      noise(0.05, 0.22, 1800);
      tone(240, 130, 0.09, 'triangle', 0.4);
      break;
    case 'pass':
      // 过牌：两声低柔短音
      tone(180, 150, 0.07, 'sine', 0.16);
      tone(150, 120, 0.07, 'sine', 0.14, 0.06);
      break;
    case 'bid':
      // 叫分：明亮方波短鸣
      tone(520, 640, 0.12, 'square', 0.16);
      break;
    case 'bomb':
      // 炸弹/王炸：轰鸣 + 低频下扫
      noise(0.3, 0.5, 900);
      tone(140, 45, 0.32, 'sawtooth', 0.5);
      break;
    case 'win':
      // 胜利：上行琶音
      [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.32, i * 0.12));
      break;
    case 'lose':
      // 失败：下行叹息
      [392, 330, 262].forEach((f, i) => tone(f, f, 0.2, 'sine', 0.28, i * 0.14));
      break;
  }
}

/**
 * 启动循环背景垫音（极轻、低通、双振荡微失谐）。
 */
export function startBackground(): void {
  const c = getCtx();
  if (!c || !master) return;
  if (c.state === 'suspended') return;
  if (!enabled || !bgEnabled) return;
  if (bgPlaying) return;

  const gain: GainNode = c.createGain();
  gain.gain.value = 0.05;
  const filt: BiquadFilterNode = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 480;

  const o1: OscillatorNode = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = 110;
  const o2: OscillatorNode = c.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = 110.6; // 微失谐产生暖意

  o1.connect(filt);
  o2.connect(filt);
  filt.connect(gain).connect(master);
  o1.start();
  o2.start();
  bg = { osc: [o1, o2], gain };
  bgPlaying = true;
}

/**
 * 停止背景音（带 0.15s 淡出）。
 */
export function stopBackground(): void {
  if (!bg || !ctx) {
    bgPlaying = false;
    return;
  }
  const { osc, gain } = bg;
  try {
    const t: number = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.forEach((o) => {
      try {
        o.stop(t + 0.2);
      } catch {
        /* 已停止则忽略 */
      }
    });
  } catch {
    /* 忽略 */
  }
  bg = null;
  bgPlaying = false;
}

// ---------- TTS（浏览器内置 Web Speech API，零成本 / 零密钥 / 零后端）----------

let preferredVoice: SpeechSynthesisVoice | null = null;

/** 取语音合成器；无环境返回 null */
function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { speechSynthesis?: SpeechSynthesis };
  return w.speechSynthesis ?? null;
}

/** 在已加载的语音里挑一个中文语音 */
function pickChineseVoice(): SpeechSynthesisVoice | null {
  const synth: SpeechSynthesis | null = getSynth();
  if (!synth) return null;
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = synth.getVoices();
  } catch {
    voices = [];
  }
  if (!voices.length) return null;
  return (
    voices.find((v) => /zh[-_]?CN/i.test(v.lang)) ?? // 普通话（大陆）
    voices.find((v) => /^zh/i.test(v.lang)) ?? // 任意中文
    voices.find((v) => /chinese|中文|普通话/i.test(v.name)) ?? // 按名字兜底
    null
  );
}

/**
 * 预热语音列表。语音在浏览器里常异步加载，须在用户手势内调用一次，
 * 之后 onvoiceschanged 触发时再选一次。无环境时静默返回。
 */
export function primeVoices(): void {
  const synth: SpeechSynthesis | null = getSynth();
  if (!synth) return;
  preferredVoice = pickChineseVoice();
  try {
    synth.onvoiceschanged = () => {
      preferredVoice = pickChineseVoice();
    };
  } catch {
    /* 忽略 */
  }
}

/** 设置 TTS 开关；关闭时取消正在播报的内容 */
export function setTtsEnabled(value: boolean): void {
  ttsEnabled = value;
  if (!value) cancelSpeech();
}

/** 取消当前及排队的语音播报 */
export function cancelSpeech(): void {
  const synth: SpeechSynthesis | null = getSynth();
  if (synth) {
    try {
      synth.cancel();
    } catch {
      /* 忽略 */
    }
  }
  if (currentCloudAudio) {
    try {
      currentCloudAudio.pause();
    } catch {
      /* 忽略 */
    }
    currentCloudAudio = null;
  }
}

/**
 * 说话选项。传入云端音色配置（voiceId + baseUrl + apiKey）时走云端 TTS，
 * 否则回退浏览器内置中文 TTS（全局单一音色）。
 */
export interface SpeakOptions {
  /** 云端音色 id（OpenAI 兼容） */
  voiceId?: string;
  /** 云端 TTS 模型，默认 tts-1 */
  model?: string;
  /** 上游 baseUrl（与模型配置同源） */
  baseUrl?: string;
  /** 上游 apiKey */
  apiKey?: string;
  /** 语速 0.25~4.0，默认 1.0 */
  speed?: number;
  /** 云端失败是否回退浏览器 TTS，默认 true */
  fallbackToBrowser?: boolean;
}

/** 云端 TTS 默认模型 */
const DEFAULT_TTS_MODEL = 'tts-1';
/** 当前正在播放的云端音频（用于打断上一条，避免叠音） */
let currentCloudAudio: HTMLAudioElement | null = null;
/** 文本+音色 → 音频 URL 缓存（避免重复合成） */
const audioCache = new Map<string, string>();
/** 缓存上限 */
const MAX_AUDIO_CACHE = 40;

/**
 * 用浏览器内置 TTS 念出一句话（默认选中文语音）。
 */
function speakBrowser(text: string): void {
  const synth: SpeechSynthesis | null = getSynth();
  if (!synth) return;
  // 取消上一条，避免连续出牌时语音排队堆积互相打架
  try {
    synth.cancel();
  } catch {
    /* 忽略 */
  }
  const w = window as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };
  const Ctor = w.SpeechSynthesisUtterance;
  if (!Ctor) return;
  let u: SpeechSynthesisUtterance;
  try {
    u = new Ctor(text);
  } catch {
    return;
  }
  const v = preferredVoice ?? pickChineseVoice();
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  } else {
    u.lang = 'zh-CN';
  }
  u.rate = 1.1;
  u.pitch = 1;
  try {
    synth.speak(u);
  } catch {
    /* 忽略 */
  }
}

/** 走云端 TTS 代理合成并播放（带缓存，失败回退浏览器） */
async function speakCloud(text: string, opts: SpeakOptions): Promise<void> {
  const voiceId: string = opts.voiceId as string;
  const baseUrl: string = opts.baseUrl as string;
  const apiKey: string = opts.apiKey as string;
  const model: string = opts.model ?? DEFAULT_TTS_MODEL;
  const cacheKey: string = `${voiceId}|${model}|${opts.speed ?? 1}|${text}`;
  try {
    let url: string | undefined = audioCache.get(cacheKey);
    if (!url) {
      const res = await synthesizeSpeech(
        { baseUrl, apiKey, model, voice: voiceId, input: text, speed: opts.speed },
        { timeoutMs: TTS_TIMEOUT_MS },
      );
      // ⚠️ audioBase64 是「base64 文本」，必须先 atob 解码成二进制串，再逐字节转 Uint8Array。
      // 直接对 base64 串做 charCodeAt 会得到 base64 字符的 ASCII 码（乱码），
      // 生成的 Blob 无法被浏览器解码，play() 失败 → 全部回退到浏览器 TTS（单一女声）。
      const binary: string = atob(res.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: res.contentType || 'audio/mpeg' });
      url = URL.createObjectURL(blob);
      audioCache.set(cacheKey, url);
      if (audioCache.size > MAX_AUDIO_CACHE) {
        const oldest = audioCache.keys().next().value as string | undefined;
        if (oldest) {
          URL.revokeObjectURL(audioCache.get(oldest) as string);
          audioCache.delete(oldest);
        }
      }
    }
    if (currentCloudAudio) {
      try {
        // M5：标记旧实例已被新语音取代——其 play() 因 pause 中断产生的 AbortError
        // 不再触发浏览器回退，防止与新语音双声叠音
        (currentCloudAudio as HTMLAudioElement & { _replaced?: boolean })._replaced = true;
        currentCloudAudio.pause();
      } catch {
        /* 忽略 */
      }
    }
    const audio = new Audio(url);
    currentCloudAudio = audio;
    // 防止 play 拒绝与媒体 error 事件重复触发回退
    let fellBack = false;
    const tryBrowser = (): void => {
      if (fellBack) return;
      fellBack = true;
      if (opts.fallbackToBrowser !== false) speakBrowser(text);
    };
    audio.addEventListener('error', tryBrowser);
    audio.play().catch((err: unknown) => {
      // 被新语音取代而中断（AbortError）或已被标记替换：不回退浏览器 TTS
      const replaced: boolean = Boolean((audio as HTMLAudioElement & { _replaced?: boolean })._replaced);
      const isAbort: boolean =
        typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError';
      if (replaced || isAbort) return;
      tryBrowser();
    });
  } catch {
    if (opts.fallbackToBrowser !== false) speakBrowser(text);
  }
}

/**
 * 念出一句话。
 * - 传入云端音色配置（voiceId + baseUrl + apiKey）时走云端 TTS（按音色区分 AI）；
 * - 否则回退浏览器内置中文 TTS（全局单一音色）。
 * 未开启 / 无环境 / 文本为空时静默返回。
 */
export function speak(text: string, opts?: SpeakOptions): void {
  if (!ttsEnabled) return;
  if (!text || !text.trim()) return;
  if (opts && opts.voiceId && opts.baseUrl && opts.apiKey) {
    void speakCloud(text, opts);
    return;
  }
  speakBrowser(text);
}

export default { configure, unlock, playSfx, startBackground, stopBackground, speak, cancelSpeech, primeVoices, setTtsEnabled };
