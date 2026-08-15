/**
 * AI 玩家管理页（PRD 4.2 / REQ-A1 ~ A3）。
 *
 * 能力：
 * - AI 玩家增 / 改 / 删，字段：名称、绑定的模型配置（必选）、绑定的具体模型 id、备注、头像
 * - 列表展示名称 + 绑定模型 + 备注
 * - 使用中保护：正在房间座位上的玩家禁止编辑 / 删除（REQ-A3）
 */

import { useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import Select, { type SelectOption } from '@/components/common/Select';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/routes';
import { formatDateTime } from '@/utils/format';
import type { AIPlayer, ModelConfig, Persona } from '@/types/config';
import { VOICE_SUGGESTION_LIST, VOICE_LABELS, PERSONAS, PERSONA_LABELS } from '@/types/config';
import { useConfigStore } from '@/store/configStore';
import {
  EMPTY_PLAYER_INPUT,
  notifyPlayerResult,
  usePlayerStore,
  type AIPlayerInput,
} from '@/store/playerStore';
import { useRoomStore } from '@/store/roomStore';

/** 常用头像 emoji 候选 */
const AVATAR_CHOICES: readonly string[] = ['🤖', '🐱', '🐶', '🦊', '🐼', '🐯', '👾', '🧠'] as const;

/**
 * AI 玩家管理页。
 */
export function AIPlayerPage(): JSX.Element {
  const players: AIPlayer[] = usePlayerStore((state) => state.players);
  const addPlayer = usePlayerStore((state) => state.addPlayer);
  const updatePlayer = usePlayerStore((state) => state.updatePlayer);
  const deletePlayer = usePlayerStore((state) => state.deletePlayer);

  const configs: ModelConfig[] = useConfigStore((state) => state.configs);
  const seatPlayerIds = useRoomStore((state) => state.seatPlayerIds);

  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AIPlayerInput>({ ...EMPTY_PLAYER_INPUT });
  const [formError, setFormError] = useState<string>('');
  const [deleteTarget, setDeleteTarget] = useState<AIPlayer | null>(null);

  /** 配置 id → 配置对象，便于列表展示绑定信息 */
  const configMap: Map<string, ModelConfig> = useMemo((): Map<string, ModelConfig> => {
    return new Map<string, ModelConfig>(configs.map((c: ModelConfig): [string, ModelConfig] => [c.id, c]));
  }, [configs]);

  /** 绑定配置的下拉选项（只允许绑定已存在的配置） */
  const configOptions: SelectOption[] = useMemo((): SelectOption[] => {
    return configs.map(
      (c: ModelConfig): SelectOption => ({
        value: c.id,
        label: c.provider.length > 0 ? `${c.name}（${c.provider}）` : c.name,
      }),
    );
  }, [configs]);

  /** 当前草稿选中的配置 */
  const draftConfig: ModelConfig | undefined = configMap.get(draft.modelConfigId);

  /** 草稿配置下可选的具体模型 */
  const modelOptions: SelectOption[] = useMemo((): SelectOption[] => {
    if (draftConfig === undefined) {
      return [];
    }
    return draftConfig.availableModels.map((id: string): SelectOption => ({ value: id, label: id }));
  }, [draftConfig]);

  /** 座位占用集合，用于使用中保护提示 */
  const seatedIds: Set<string> = useMemo((): Set<string> => {
    const set: Set<string> = new Set<string>();
    for (const id of seatPlayerIds) {
      if (id !== null) {
        set.add(id);
      }
    }
    return set;
  }, [seatPlayerIds]);

  /** 把存储的音色值转成展示名（命中已知音色给中文标签，否则显示原始值） */
  const voiceLabelOf = (voice: string | undefined): string => {
    if (!voice) return '默认音色';
    const label = (VOICE_LABELS as Record<string, string>)[voice];
    return label ?? voice;
  };

  /** 人设下拉选项（空值 = 跟随默认「稳重」） */
  const personaOptions: SelectOption[] = useMemo((): SelectOption[] => {
    const auto: SelectOption = { value: '', label: '跟随默认（稳重）' };
    const rest: SelectOption[] = (PERSONAS as readonly Persona[]).map(
      (p: Persona): SelectOption => ({ value: p, label: PERSONA_LABELS[p] }),
    );
    return [auto, ...rest];
  }, []);

  /** TTS 服务商下拉选项（空值 = 跟随聊天配置） */
  const ttsConfigOptions: SelectOption[] = useMemo((): SelectOption[] => {
    const auto: SelectOption = { value: '', label: '跟随聊天配置（默认）' };
    return [auto, ...configOptions];
  }, [configOptions]);

  /** 打开新建表单 */
  const openCreate = (): void => {
    setEditingId(null);
    setDraft({
      ...EMPTY_PLAYER_INPUT,
      modelConfigId: configs.length === 1 ? configs[0].id : '',
      ttsConfigId: '',
      avatar: AVATAR_CHOICES[0],
    });
    setFormError('');
    setFormOpen(true);
  };

  /** 打开编辑表单 */
  const openEdit = (player: AIPlayer): void => {
    if (seatedIds.has(player.id)) {
      notifyPlayerResult({ ok: false, message: `「${player.name}」正在房间座位中使用，请先将其移出座位再编辑` });
      return;
    }
    setEditingId(player.id);
    setDraft({
      name: player.name,
      modelConfigId: player.modelConfigId,
      modelId: player.modelId ?? '',
      remark: player.remark ?? '',
      avatar: player.avatar ?? '',
      voice: player.voice ?? '',
      ttsModel: player.ttsModel ?? '',
      ttsConfigId: player.ttsConfigId ?? '',
      persona: player.persona ?? '',
    });
    setFormError('');
    setFormOpen(true);
  };

  /** 关闭表单 */
  const closeForm = (): void => {
    setFormOpen(false);
    setFormError('');
  };

  /** 更新草稿字段 */
  const patchDraft = (patch: Partial<AIPlayerInput>): void => {
    setDraft((prev: AIPlayerInput): AIPlayerInput => ({ ...prev, ...patch }));
    setFormError('');
  };

  /** 切换绑定配置时，清空不再适用的具体模型 */
  const handleConfigChange = (configId: string): void => {
    const target: ModelConfig | undefined = configMap.get(configId);
    setDraft((prev: AIPlayerInput): AIPlayerInput => {
      const keepModel: boolean =
        target !== undefined && prev.modelId.length > 0 && target.availableModels.includes(prev.modelId);
      return { ...prev, modelConfigId: configId, modelId: keepModel ? prev.modelId : '' };
    });
    setFormError('');
  };

  /** 保存 */
  const handleSave = (): void => {
    const result = editingId === null ? addPlayer(draft) : updatePlayer(editingId, draft);
    if (!result.ok) {
      setFormError(result.message);
      notifyPlayerResult(result);
      return;
    }
    notifyPlayerResult(result);
    closeForm();
  };

  /** 确认删除 */
  const handleDelete = (): void => {
    if (deleteTarget === null) {
      return;
    }
    const result = deletePlayer(deleteTarget.id);
    notifyPlayerResult(result);
    if (result.ok) {
      setDeleteTarget(null);
    }
  };

  /** 生成某玩家的绑定描述文本 */
  const describeBinding = (player: AIPlayer): string => {
    const config: ModelConfig | undefined = configMap.get(player.modelConfigId);
    if (config === undefined) {
      return '⚠ 绑定的模型配置已不存在';
    }
    const modelId: string = player.modelId ?? config.selectedModel;
    return `${config.name} · ${modelId.length > 0 ? modelId : '未指定模型'}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="app-icon-badge" aria-hidden="true">
            🧠
          </span>
          <div>
            <h1 className="app-page-title">AI 玩家</h1>
            <p className="app-page-desc">共 {players.length} 个玩家 · 每个玩家绑定一个模型配置</p>
          </div>
        </div>
        <Button onClick={openCreate} disabled={configs.length === 0}>
          + 新建玩家
        </Button>
      </div>

      {/* 无配置时的引导 */}
      {configs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-amber-400/40 bg-amber-500/10 px-4 py-10 text-center">
          <p className="text-sm text-amber-300">还没有任何模型配置，无法创建 AI 玩家</p>
          <Link to={ROUTES.CONFIG} className="text-sm font-medium text-gold-300 underline underline-offset-4 hover:text-gold-200">
            前往「模型配置」新增一个配置
          </Link>
        </div>
      ) : null}

      {/* 列表 */}
      {players.length === 0 ? (
        configs.length > 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-12 text-center">
            <p className="text-sm text-slate-300">还没有任何 AI 玩家</p>
            <p className="max-w-md text-xs text-slate-500">创建 AI 玩家后即可在房间中为它们分配座位。</p>
            <Button onClick={openCreate}>+ 新建第一个玩家</Button>
          </div>
        ) : null
      ) : (
        <ul className="flex flex-col gap-3">
          {players.map((player: AIPlayer) => {
            const inUse: boolean = seatedIds.has(player.id);
            const missingConfig: boolean = !configMap.has(player.modelConfigId);
            return (
              <li
                key={player.id}
                className="app-card flex flex-col gap-3 p-4 transition-all duration-150 hover:border-white/20 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-white/10 text-xl shadow-innerTop ring-1 ring-white/10">
                    {player.avatar && player.avatar.length > 0 ? player.avatar : '🤖'}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-100">{player.name}</span>
                      {player.remark && player.remark.length > 0 ? (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-slate-300">
                          {player.remark}
                        </span>
                      ) : null}
                      {inUse ? (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300 ring-1 ring-emerald-400/30">
                          房间座位中
                        </span>
                      ) : null}
                    </div>
                    <p className={missingConfig ? 'mt-1 text-xs text-red-300' : 'mt-1 text-xs text-slate-400'}>
                      {describeBinding(player)}
                    </p>
                    {player.voice !== undefined || player.persona !== undefined || player.ttsModel !== undefined || player.ttsConfigId !== undefined ? (
                      <p className="mt-0.5 text-xs text-slate-500">
                        🎙 {voiceLabelOf(player.voice)} · {player.persona !== undefined ? PERSONA_LABELS[player.persona] : '默认人设'}
                        {' · TTS '}
                        {player.ttsModel !== undefined ? player.ttsModel : 'tts-1'}
                        {player.ttsConfigId !== undefined && configMap.get(player.ttsConfigId)
                          ? ` · 服务「${configMap.get(player.ttsConfigId)?.name ?? ''}」`
                          : ''}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-slate-500">更新于 {formatDateTime(player.updatedAt)}</p>
                  </div>
                </div>

                <div className="flex flex-none items-center gap-2">
                  <Button size="sm" variant="secondary" disabled={inUse} onClick={() => openEdit(player)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="danger" disabled={inUse} onClick={() => setDeleteTarget(player)}>
                    删除
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 新建 / 编辑表单 */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingId === null ? '新建 AI 玩家' : '编辑 AI 玩家'}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm}>
              取消
            </Button>
            <Button onClick={handleSave}>保存</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="玩家名称"
            required
            value={draft.name}
            onChange={(e) => patchDraft({ name: e.target.value })}
            placeholder="如：小明"
          />

          <Select
            label="绑定的模型配置"
            required
            options={configOptions}
            value={draft.modelConfigId}
            placeholder="请选择模型配置"
            onChange={(e) => handleConfigChange(e.target.value)}
            hint="只能绑定已存在的模型配置"
          />

          {draftConfig !== undefined && modelOptions.length > 0 ? (
            <Select
              label="绑定的具体模型"
              options={modelOptions}
              value={draft.modelId}
              placeholder={`使用配置默认模型${draftConfig.selectedModel ? `（${draftConfig.selectedModel}）` : ''}`}
              onChange={(e) => patchDraft({ modelId: e.target.value })}
              hint="留空则跟随所选配置的默认模型"
            />
          ) : (
            <Input
              label="绑定的具体模型 id"
              value={draft.modelId}
              onChange={(e) => patchDraft({ modelId: e.target.value })}
              placeholder="如：gpt-4o"
              hint={
                draftConfig === undefined
                  ? '请先选择模型配置'
                  : '该配置尚未拉取模型列表，可先手动填写模型 id，或去配置页点击「拉取模型」'
              }
              disabled={draftConfig === undefined}
            />
          )}

          <Input
            label="备注"
            value={draft.remark}
            onChange={(e) => patchDraft({ remark: e.target.value })}
            placeholder="如：激进 / 稳健"
          />

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-300">头像</span>
            <div className="flex flex-wrap gap-2">
              {AVATAR_CHOICES.map((emoji: string) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => patchDraft({ avatar: emoji })}
                  aria-label={`选择头像 ${emoji}`}
                  className={
                    draft.avatar === emoji
                      ? 'flex h-9 w-9 items-center justify-center rounded-lg border-2 border-gold-400 bg-gold-500/15 text-lg shadow-glowGold'
                      : 'flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-lg transition-all duration-150 hover:bg-white/10 active:scale-95'
                  }
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-1 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">语音 / 台词（AI 趣味）</p>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Input
                  label="TTS 音色"
                  value={draft.voice ?? ''}
                  onChange={(e) => patchDraft({ voice: e.target.value })}
                  placeholder="如：onyx / zh-CN-XiaoxiaoNeural"
                  hint="填你的 TTS 服务商支持的任何音色 id；留空则用座位默认音色（浏览器中文音兜底）"
                />
                <div className="flex flex-wrap gap-2">
                  {VOICE_SUGGESTION_LIST.map((v) => (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => patchDraft({ voice: v.value })}
                      className={
                        (draft.voice ?? '') === v.value
                          ? 'rounded-lg border-2 border-gold-400 bg-gold-500/15 px-2.5 py-1 text-xs text-gold-200 shadow-glowGold'
                          : 'rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-slate-300 transition-all duration-150 hover:bg-white/10 active:scale-95'
                      }
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <Input
                label="TTS 模型"
                value={draft.ttsModel ?? ''}
                onChange={(e) => patchDraft({ ttsModel: e.target.value })}
                placeholder="tts-1"
                hint="对应 /audio/speech 的 model 字段；留空默认 tts-1"
              />

              <Select
                label="TTS 服务商（语音）"
                options={ttsConfigOptions}
                value={draft.ttsConfigId ?? ''}
                placeholder="跟随聊天配置"
                onChange={(e) => patchDraft({ ttsConfigId: e.target.value })}
                hint="TTS 可与聊天用不同的密钥 / 服务商：选一个提供 TTS 的模型配置即可。部分聊天配置不含 TTS 模型，需在此另行指定；留空则跟随上方聊天配置。"
              />

              <Select
                label="台词人设"
                options={personaOptions}
                value={draft.persona ?? ''}
                placeholder="跟随默认"
                onChange={(e) => patchDraft({ persona: e.target.value })}
                hint="决定 AI 出牌 / 嘲讽 / 催促 / 胜负时的台词风格（毒舌 / 稳重 / 话痨 / 萌新）"
              />
            </div>
          </div>

          {formError.length > 0 ? (
            <p className="rounded-xl bg-red-500/15 px-3 py-2 text-xs text-red-300 ring-1 ring-red-400/30">{formError}</p>
          ) : null}
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="删除 AI 玩家"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">确定要删除「{deleteTarget?.name ?? ''}」吗？删除后不可恢复。</p>
      </Modal>
    </div>
  );
}

export default AIPlayerPage;
