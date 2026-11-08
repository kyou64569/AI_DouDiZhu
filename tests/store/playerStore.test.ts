import { describe, it, expect, beforeEach } from 'vitest';
import {
  usePlayerStore,
  validatePlayerInput,
  MIN_PLAYER_TIMEOUT_SECONDS,
  MAX_PLAYER_TIMEOUT_SECONDS,
} from '@/store/playerStore';
import type { AIPlayerInput } from '@/store/playerStore';

/** 标准输入构造器（其余可选项留空） */
function baseInput(overrides: Partial<AIPlayerInput> = {}): AIPlayerInput {
  return {
    name: '测试玩家',
    modelConfigId: 'cfg-1',
    modelId: '',
    remark: '',
    avatar: '',
    voice: '',
    ttsModel: '',
    ttsConfigId: '',
    persona: '',
    difficulty: '',
    personality: '',
    timeoutSeconds: '',
    ...overrides,
  };
}

describe('AI 玩家思考超时配置（timeoutSeconds）', () => {
  beforeEach(() => {
    usePlayerStore.getState().clearPlayers();
  });

  it('validatePlayerInput：留空合法；5~120 整数合法', () => {
    expect(validatePlayerInput(baseInput())).toBeNull();
    expect(validatePlayerInput(baseInput({ timeoutSeconds: String(MIN_PLAYER_TIMEOUT_SECONDS) }))).toBeNull();
    expect(validatePlayerInput(baseInput({ timeoutSeconds: '90' }))).toBeNull();
    expect(validatePlayerInput(baseInput({ timeoutSeconds: String(MAX_PLAYER_TIMEOUT_SECONDS) }))).toBeNull();
  });

  it('validatePlayerInput：非整数 / 越界 / 非数字报错', () => {
    expect(validatePlayerInput(baseInput({ timeoutSeconds: '4' }))).toContain('思考超时');
    expect(validatePlayerInput(baseInput({ timeoutSeconds: '121' }))).toContain('思考超时');
    expect(validatePlayerInput(baseInput({ timeoutSeconds: '8.5' }))).toContain('思考超时');
    expect(validatePlayerInput(baseInput({ timeoutSeconds: 'abc' }))).toContain('思考超时');
  });

  it('addPlayer：字符串秒数转为数字并持久化到玩家字段', () => {
    const result = usePlayerStore.getState().addPlayer(baseInput({ name: '商汤', timeoutSeconds: '90' }));
    expect(result.ok).toBe(true);
    expect(result.player?.timeoutSeconds).toBe(90);
  });

  it('addPlayer：留空 → timeoutSeconds 为 undefined（跟随全局设置）', () => {
    const result = usePlayerStore.getState().addPlayer(baseInput());
    expect(result.ok).toBe(true);
    expect(result.player?.timeoutSeconds).toBeUndefined();
  });

  it('updatePlayer：可修改并清除超时配置', () => {
    const store = usePlayerStore.getState();
    const created = store.addPlayer(baseInput({ name: '谷歌', timeoutSeconds: '120' }));
    expect(created.player?.timeoutSeconds).toBe(120);

    const updated = usePlayerStore
      .getState()
      .updatePlayer(created.player!.id, baseInput({ name: '谷歌' }));
    expect(updated.ok).toBe(true);
    expect(updated.player?.timeoutSeconds).toBeUndefined();
  });
});
