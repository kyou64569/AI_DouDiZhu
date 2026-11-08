/**
 * 模型配置页（PRD 4.1 / REQ-M1 ~ M4）。
 *
 * 能力：
 * - 配置增 / 改 / 删，字段：配置名称、Provider、Base URL、API Key
 * - 「拉取模型」调用 /api/llm/models，返回结果以可搜索、可多选列表呈现（REQ-M2）
 * - 「连通性测试」展示成功状态与响应延迟，且全程不写回任何已保存配置（REQ-M3）
 * - 配置持久化至 localStorage，刷新不丢（REQ-M4）
 * - 首次进入弹一次密钥安全告知，确认后写标记不再弹（PRD D1）
 * - API Key 输入框默认密文（复用 Input 的 password 显示/隐藏能力）
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import Select, { type SelectOption } from '@/components/common/Select';
import { toast } from '@/components/common/Toast';
import { cn } from '@/utils/cn';
import { downloadTextFile, exportTimestamp } from '@/utils/download';
import { formatDateTime, formatLatency, maskKeyForDisplay } from '@/utils/format';
import type { ModelItem } from '@/types/api';
import type {
  AIPlayer,
  ApiFormat,
  ConnectionTestResult,
  ModelConfig,
  ThinkingCapability,
  ThinkingMode,
  ThinkingProfile,
} from '@/types/config';
import {
  API_FORMATS,
  API_FORMAT_LABELS,
  THINKING_CAPABILITIES,
  THINKING_CAPABILITY_LABELS,
  THINKING_LABELS,
  THINKING_MODES,
  THINKING_PROFILES,
  THINKING_PROFILE_LABELS,
} from '@/types/config';
import {
  DRAFT_KEY,
  EMPTY_CONFIG_INPUT,
  EMPTY_MODEL_ITEMS,
  notifyConfigResult,
  toConfigInput,
  useConfigStore,
  type ModelConfigInput,
} from '@/store/configStore';
import { usePlayerStore } from '@/store/playerStore';
import {
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  DEFAULT_HUMAN_TIMEOUT_MS,
  DEFAULT_SPECTATE_TIMEOUT_MS,
  useSettingsStore,
} from '@/store/settingsStore';
import {
  acknowledgeKeyWarning,
  exportAllAppData,
  exportAllAppDataMasked,
  importAllAppData,
  isKeyWarningAcknowledged,
} from '@/store/persist';

/** 模型选择器的属性 */
interface ModelPickerProps {
  /** 候选模型（拉取结果 ∪ 已保存的可用模型） */
  models: ModelItem[];
  /** 已勾选的模型 id */
  selectedIds: string[];
  /** 默认模型 id */
  defaultModel: string;
  /** 勾选变化回调 */
  onToggle: (modelId: string) => void;
  /** 默认模型变化回调 */
  onDefaultChange: (modelId: string) => void;
  /** 批量设置勾选集合（全选 / 取消全选），最终集合整体替换 */
  onBulkSelect: (ids: string[]) => void;
}

/**
 * 可搜索、可多选的模型列表（REQ-M2）。
 * 勾选项写入 `availableModels`，其中一个被指定为 `selectedModel`。
 * 全选 / 取消全选只作用于当前搜索命中的子集，便于先按关键字筛选再批量勾选。
 */
function ModelPicker({
  models,
  selectedIds,
  defaultModel,
  onToggle,
  onDefaultChange,
  onBulkSelect,
}: ModelPickerProps): JSX.Element {
  const [keyword, setKeyword] = useState<string>('');

  const filtered: ModelItem[] = useMemo((): ModelItem[] => {
    const kw: string = keyword.trim().toLowerCase();
    if (kw.length === 0) {
      return models;
    }
    return models.filter(
      (m: ModelItem): boolean => m.id.toLowerCase().includes(kw) || m.name.toLowerCase().includes(kw),
    );
  }, [models, keyword]);

  /** 全选：把当前搜索命中的模型并入勾选集合（视图外的已勾选项保留） */
  const handleSelectAll = (): void => {
    const merged: Set<string> = new Set<string>(selectedIds);
    for (const m of filtered) {
      merged.add(m.id);
    }
    onBulkSelect([...merged]);
  };

  /** 取消全选：从勾选集合中移除当前搜索命中的模型（空搜索时即清空全部） */
  const handleDeselectAll = (): void => {
    const hit: Set<string> = new Set<string>(filtered.map((m: ModelItem): string => m.id));
    onBulkSelect(selectedIds.filter((id: string): boolean => !hit.has(id)));
  };

  const defaultOptions: SelectOption[] = useMemo(
    (): SelectOption[] => selectedIds.map((id: string): SelectOption => ({ value: id, label: id })),
    [selectedIds],
  );

  if (models.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-white/20 bg-white/[0.03] px-3 py-4 text-center text-xs text-slate-500">
        尚未拉取模型。填写 Base URL 与 API Key 后点击「拉取模型」。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索模型名称或 id…"
        aria-label="搜索模型"
      />

      <div className="max-h-52 overflow-y-auto rounded-xl border border-white/15 scrollbar-thin">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-slate-500">没有匹配「{keyword}」的模型</p>
        ) : (
          <ul className="divide-y divide-white/8">
            {filtered.map((model: ModelItem) => {
              const checked: boolean = selectedIds.includes(model.id);
              return (
                <li key={model.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-white/5',
                      checked && 'bg-brand-500/15',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(model.id)}
                      className="h-4 w-4 flex-none accent-brand-400"
                    />
                    <span className="flex-1 truncate text-slate-200">{model.id}</span>
                    {model.name && model.name !== model.id ? (
                      <span className="max-w-[40%] truncate text-xs text-slate-500">{model.name}</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          已勾选 {selectedIds.length} / {models.length} 个模型
        </p>
        <div className="flex flex-none gap-2">
          <Button size="sm" variant="secondary" onClick={handleSelectAll} title="勾选当前搜索命中的全部模型">
            全选
          </Button>
          <Button size="sm" variant="secondary" onClick={handleDeselectAll} title="取消勾选当前搜索命中的全部模型（清空搜索框即为全部）">
            取消全选
          </Button>
        </div>
      </div>

      <Select
        label="默认模型"
        options={defaultOptions}
        value={defaultModel}
        placeholder={selectedIds.length === 0 ? '请先勾选至少一个模型' : '请选择默认模型'}
        onChange={(e) => onDefaultChange(e.target.value)}
        hint="AI 玩家未单独指定模型时使用该默认模型"
      />
    </div>
  );
}

/** 连通性测试结果徽标的属性 */
interface TestBadgeProps {
  result: ConnectionTestResult | undefined;
}

/** 连通性测试结果展示（成功显示延迟 ms） */
function TestBadge({ result }: TestBadgeProps): JSX.Element | null {
  if (result === undefined) {
    return null;
  }
  if (result.success) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-400/30">
        ✓ 响应 {formatLatency(result.latencyMs)}
      </span>
    );
  }
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300 ring-1 ring-red-400/30"
      title={result.error ?? '连通失败'}
    >
      ✕ {result.error ?? '连通失败'}
    </span>
  );
}

/** 毫秒转秒的展示文本 */
function msToSecText(ms: number): string {
  return String(Math.round(ms / 1000));
}

/** 单个超时输入框的属性 */
interface TimeoutFieldProps {
  label: string;
  hint: string;
  valueMs: number;
  defaultMs: number;
  onCommit: (ms: number) => void;
}

/**
 * 秒为单位的超时输入框。
 *
 * 编辑过程中只更新本地草稿，**失焦或回车时才提交**，
 * 否则用户刚敲下 "1"（想输 15）就会被立刻夹成 5，输入体验极差。
 */
function TimeoutField({ label, hint, valueMs, defaultMs, onCommit }: TimeoutFieldProps): JSX.Element {
  const [draft, setDraft] = useState<string>(msToSecText(valueMs));

  // 外部值变化（如「恢复默认」）时同步回草稿
  useEffect((): void => {
    setDraft(msToSecText(valueMs));
  }, [valueMs]);

  const commit = (): void => {
    const parsed: number = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      toast.warning('输入无效，已恢复默认值');
    }
    const ms: number = Number.isFinite(parsed) ? parsed * 1000 : defaultMs;
    onCommit(ms);
    setDraft(msToSecText(Math.min(Math.max(ms, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)));
  };

  return (
    <Input
      type="number"
      min={MIN_TIMEOUT_MS / 1000}
      max={MAX_TIMEOUT_MS / 1000}
      step={1}
      label={label}
      hint={hint}
      value={draft}
      suffix={<span className="text-xs text-slate-400">秒</span>}
      onChange={(e): void => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e): void => {
        if (e.key === 'Enter') {
          commit();
        }
      }}
    />
  );
}

/**
 * AI 决策超时设置卡片。
 *
 * 对应「模型请求失败（请求上游超时（8000ms））」这一类提示：
 * 超时只代表模型没在时限内返回，AI 编排层会降级为本地兜底策略，对局不会中断。
 * 推理型模型建议把观战模式调到 20s 以上。
 */
function TimeoutSettingsCard(): JSX.Element {
  const humanTimeoutMs: number = useSettingsStore((state) => state.humanTimeoutMs);
  const spectateTimeoutMs: number = useSettingsStore((state) => state.spectateTimeoutMs);
  const setHumanTimeoutMs = useSettingsStore((state) => state.setHumanTimeoutMs);
  const setSpectateTimeoutMs = useSettingsStore((state) => state.setSpectateTimeoutMs);
  const resetTimeouts = useSettingsStore((state) => state.resetTimeouts);

  const isDefault: boolean =
    humanTimeoutMs === DEFAULT_HUMAN_TIMEOUT_MS && spectateTimeoutMs === DEFAULT_SPECTATE_TIMEOUT_MS;

  return (
    <section className="app-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="app-section-title text-slate-100">AI 决策超时</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            模型未在时限内返回时，本手将由本地兜底策略接管并在思考日志中标注，对局不会中断。
            推理型模型响应普遍偏慢，可适当调大。
          </p>
        </div>
        <Button variant="ghost" disabled={isDefault} onClick={resetTimeouts}>
          恢复默认
        </Button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TimeoutField
          label="人机模式"
          hint={`默认 ${msToSecText(DEFAULT_HUMAN_TIMEOUT_MS)} 秒 · 你在等待，节奏优先`}
          valueMs={humanTimeoutMs}
          defaultMs={DEFAULT_HUMAN_TIMEOUT_MS}
          onCommit={setHumanTimeoutMs}
        />
        <TimeoutField
          label="观战模式"
          hint={`默认 ${msToSecText(DEFAULT_SPECTATE_TIMEOUT_MS)} 秒 · 无人等待，质量优先`}
          valueMs={spectateTimeoutMs}
          defaultMs={DEFAULT_SPECTATE_TIMEOUT_MS}
          onCommit={setSpectateTimeoutMs}
        />
      </div>

      <p className="mt-2 text-xs text-slate-500">
        可调范围 {MIN_TIMEOUT_MS / 1000}~{MAX_TIMEOUT_MS / 1000} 秒，修改即时保存并在下一手生效。
      </p>
    </section>
  );
}

/**
 * 模型配置页。
 */
export function ModelConfigPage(): JSX.Element {
  const configs: ModelConfig[] = useConfigStore((state) => state.configs);
  const testResults = useConfigStore((state) => state.testResults);
  const fetchedModels = useConfigStore((state) => state.fetchedModels);
  const testingKeys: string[] = useConfigStore((state) => state.testingKeys);
  const fetchingKeys: string[] = useConfigStore((state) => state.fetchingKeys);
  const addConfig = useConfigStore((state) => state.addConfig);
  const updateConfig = useConfigStore((state) => state.updateConfig);
  const deleteConfig = useConfigStore((state) => state.deleteConfig);
  const fetchModels = useConfigStore((state) => state.fetchModels);
  const testConnection = useConfigStore((state) => state.testConnection);
  const clearTransient = useConfigStore((state) => state.clearTransient);

  const players: AIPlayer[] = usePlayerStore((state) => state.players);

  const [showKeyWarning, setShowKeyWarning] = useState<boolean>(false);
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModelConfigInput>({ ...EMPTY_CONFIG_INPUT });
  const [formError, setFormError] = useState<string>('');
  const [deleteTarget, setDeleteTarget] = useState<ModelConfig | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** 导出全部配置为 JSON 文件（含 API Key，提示妥善保管） */
  const handleExport = (): void => {
    downloadConfigJson(exportAllAppData(), 'doudizhu-config');
    toast.success('配置已导出。文件含 API Key，请勿上传到 git 或公开位置');
  };

  /** 导出脱敏版配置（M-3）：API Key 前 6 后 3 脱敏，适合分享/调试 */
  const handleExportMasked = (): void => {
    downloadConfigJson(exportAllAppDataMasked(), 'doudizhu-config-masked');
    toast.success('已导出脱敏配置（API Key 已打码），可安全分享');
  };

  /** 生成并下载 JSON 文件（复用全局下载工具） */
  const downloadConfigJson = (json: string, prefix: string): void => {
    downloadTextFile(json, `${prefix}-${exportTimestamp()}.json`, 'application/json');
  };

  /** 导入配置文件：校验后写回 localStorage，刷新页面生效 */
  const handleImportFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file: File | undefined = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    const reader: FileReader = new FileReader();
    reader.onload = (): void => {
      const result = importAllAppData(String(reader.result ?? ''));
      if (result.ok) {
        toast.success(result.message);
        window.setTimeout(() => window.location.reload(), 1500);
      } else {
        toast.error(result.message);
      }
    };
    reader.readAsText(file);
  };

  /** 表单当前使用的临时状态 key：编辑态用配置 id，新增态用草稿键 */
  const formKey: string = editingId ?? DRAFT_KEY;

  // 首次进入弹一次密钥安全告知（PRD D1）
  useEffect(() => {
    if (!isKeyWarningAcknowledged()) {
      setShowKeyWarning(true);
    }
  }, []);

  /** 每个配置被多少个 AI 玩家绑定，用于删除保护提示 */
  const boundCountMap: Record<string, number> = useMemo((): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const player of players) {
      map[player.modelConfigId] = (map[player.modelConfigId] ?? 0) + 1;
    }
    return map;
  }, [players]);

  /** 候选模型 = 本次拉取结果 ∪ 草稿中已勾选但未在拉取结果里的 id */
  const pickerModels: ModelItem[] = useMemo((): ModelItem[] => {
    const fetched: ModelItem[] = fetchedModels[formKey] ?? (EMPTY_MODEL_ITEMS as ModelItem[]);
    const seen: Set<string> = new Set<string>(fetched.map((m: ModelItem): string => m.id));
    const extra: ModelItem[] = draft.availableModels
      .filter((id: string): boolean => !seen.has(id))
      .map((id: string): ModelItem => ({ id, name: id }));
    return [...fetched, ...extra];
  }, [fetchedModels, formKey, draft.availableModels]);

  /** 打开新增表单 */
  const openCreate = (): void => {
    clearTransient(DRAFT_KEY);
    setEditingId(null);
    setDraft({ ...EMPTY_CONFIG_INPUT });
    setFormError('');
    setFormOpen(true);
  };

  /** 打开编辑表单 */
  const openEdit = (config: ModelConfig): void => {
    setEditingId(config.id);
    setDraft(toConfigInput(config));
    setFormError('');
    setFormOpen(true);
  };

  /** 关闭表单并清理草稿态 */
  const closeForm = (): void => {
    setFormOpen(false);
    setFormError('');
    clearTransient(DRAFT_KEY);
  };

  /** 更新草稿的单个字段 */
  const patchDraft = (patch: Partial<ModelConfigInput>): void => {
    setDraft((prev: ModelConfigInput): ModelConfigInput => ({ ...prev, ...patch }));
    setFormError('');
  };

  /** 勾选 / 取消勾选某个模型 */
  const toggleModel = (modelId: string): void => {
    setDraft((prev: ModelConfigInput): ModelConfigInput => {
      const exists: boolean = prev.availableModels.includes(modelId);
      const nextModels: string[] = exists
        ? prev.availableModels.filter((id: string): boolean => id !== modelId)
        : [...prev.availableModels, modelId];
      const nextDefault: string =
        prev.selectedModel === modelId && exists ? (nextModels[0] ?? '') : prev.selectedModel || modelId;
      return {
        ...prev,
        availableModels: nextModels,
        selectedModel: nextModels.includes(nextDefault) ? nextDefault : (nextModels[0] ?? ''),
      };
    });
  };

  /** 批量设置勾选集合（全选 / 取消全选）：默认模型不在集合内时回落到集合第一个 */
  const bulkSelectModels = (ids: string[]): void => {
    setDraft((prev: ModelConfigInput): ModelConfigInput => {
      const nextDefault: string = ids.includes(prev.selectedModel) ? prev.selectedModel : (ids[0] ?? '');
      return { ...prev, availableModels: ids, selectedModel: nextDefault };
    });
  };

  /** 表单内点击「拉取模型」 P2：显式捕获未处理 rejection */
  const handleFetchModels = async (): Promise<void> => {
    try {
      const models: ModelItem[] = await fetchModels(
        { baseUrl: draft.baseUrl, apiFormat: draft.apiFormat, apiKey: draft.apiKey },
        formKey,
      );
      if (models.length === 0) {
        return;
      }
      // 首次拉取且尚未勾选任何模型时，默认全选，减少用户操作
      setDraft((prev: ModelConfigInput): ModelConfigInput => {
        if (prev.availableModels.length > 0) {
          return prev;
        }
        const ids: string[] = models.map((m: ModelItem): string => m.id);
        return { ...prev, availableModels: ids, selectedModel: prev.selectedModel || (ids[0] ?? '') };
      });
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  /** 表单内点击「连通性测试」（不写回任何已保存配置） */
  const handleTestDraft = async (): Promise<void> => {
    try {
      await testConnection({ baseUrl: draft.baseUrl, apiFormat: draft.apiFormat, apiKey: draft.apiKey }, formKey);
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  /** 列表行点击「测试」（同样只读，不修改配置） */
  const handleTestSaved = async (config: ModelConfig): Promise<void> => {
    await testConnection({ baseUrl: config.baseUrl, apiFormat: config.apiFormat, apiKey: config.apiKey }, config.id);
  };

  /** 保存表单 */
  const handleSave = (): void => {
    const result =
      editingId === null ? addConfig(draft) : updateConfig(editingId, draft);
    if (!result.ok) {
      setFormError(result.message);
      notifyConfigResult(result);
      return;
    }
    notifyConfigResult(result);
    closeForm();
  };

  /** 确认删除 */
  const handleDelete = (): void => {
    if (deleteTarget === null) {
      return;
    }
    const result = deleteConfig(deleteTarget.id);
    notifyConfigResult(result);
    if (result.ok) {
      setDeleteTarget(null);
    }
  };

  const isFetching: boolean = fetchingKeys.includes(formKey);
  const isTestingForm: boolean = testingKeys.includes(formKey);

  return (
    <div className="flex flex-col gap-4">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="app-icon-badge" aria-hidden="true">
            🛰️
          </span>
          <div>
            <h1 className="app-page-title">模型配置</h1>
            <p className="app-page-desc">
              共 {configs.length} 个配置 · 数据保存在本机浏览器，刷新不会丢失
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={handleExport}>
            导出配置
          </Button>
          <Button variant="ghost" onClick={handleExportMasked} title="API Key 脱敏后导出，可安全分享">
            导出(脱敏)
          </Button>
          <Button variant="ghost" onClick={() => fileInputRef.current?.click()}>
            导入配置
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button onClick={openCreate}>+ 新增配置</Button>
        </div>
      </div>

      {/* 全局：AI 决策超时 */}
      <TimeoutSettingsCard />

      {/* 列表 */}
      {configs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-12 text-center">
          <p className="text-sm text-slate-300">还没有任何模型配置</p>
          <p className="max-w-md text-xs text-slate-500">
            新增一个 OpenAI 兼容服务的配置（Base URL + API Key），即可拉取模型并创建 AI 玩家。
          </p>
          <Button onClick={openCreate}>+ 新增第一个配置</Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {configs.map((config: ModelConfig) => {
            const boundCount: number = boundCountMap[config.id] ?? 0;
            return (
              <li
                key={config.id}
                className="app-card flex flex-col gap-3 p-4 transition-all duration-150 hover:border-white/20 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">{config.name}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-slate-300">
                      {config.provider || '未填写 Provider'}
                    </span>
                    {boundCount > 0 ? (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300 ring-1 ring-amber-400/30">
                        {boundCount} 个 AI 玩家绑定中
                      </span>
                    ) : null}
                    <TestBadge result={testResults[config.id]} />
                  </div>

                  <p className="mt-1 truncate text-xs text-slate-400" title={config.baseUrl}>
                    {config.baseUrl}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Key {maskKeyForDisplay(config.apiKey)} · 默认模型{' '}
                    {config.selectedModel.length > 0 ? config.selectedModel : '未选择'} · 可用模型{' '}
                    {config.availableModels.length} 个 · 更新于 {formatDateTime(config.updatedAt)}
                  </p>
                </div>

                <div className="flex flex-none flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={testingKeys.includes(config.id)}
                    onClick={() => {
                      void handleTestSaved(config);
                    }}
                  >
                    连通性测试
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(config)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(config)}>
                    删除
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 密钥安全告知（首次进入弹一次，PRD D1） */}
      <Modal
        open={showKeyWarning}
        title="密钥安全提示"
        closeOnOverlay={false}
        closeOnEsc={false}
        size="sm"
        footer={
          <Button
            onClick={() => {
              acknowledgeKeyWarning();
              setShowKeyWarning(false);
            }}
          >
            我已知晓
          </Button>
        }
      >
        <div className="flex flex-col gap-2 text-sm leading-6 text-slate-300">
          <p>密钥仅存于本机浏览器，请勿在公共设备使用。</p>
          <p className="text-xs text-slate-500">
            本应用为单机工具，API Key 以明文保存在当前浏览器的 localStorage 中，不会上传到任何第三方服务器；
            调用大模型时仅经由本机 Node 代理转发到你填写的 Base URL。
          </p>
        </div>
      </Modal>

      {/* 新增 / 编辑表单 */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingId === null ? '新增模型配置' : '编辑模型配置'}
        size="lg"
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label="配置名称"
              required
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              placeholder="如：配置A"
            />
            <Input
              label="Provider"
              required
              value={draft.provider}
              onChange={(e) => patchDraft({ provider: e.target.value })}
              placeholder="如：OpenAI / DeepSeek / 本地 vLLM"
            />
          </div>

          <Input
            label="Base URL"
            required
            value={draft.baseUrl}
            onChange={(e) => patchDraft({ baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
            hint="服务根路径，通常以版本段结尾（OpenAI 兼容 /v1；Gemini /v1beta；Anthropic /v1，留空会自动补）"
          />

          <Select
            label="API 协议格式"
            options={API_FORMATS.map((f: ApiFormat): SelectOption => ({ value: f, label: API_FORMAT_LABELS[f] }))}
            value={draft.apiFormat}
            onChange={(e) => patchDraft({ apiFormat: e.target.value as ApiFormat })}
            hint="默认 OpenAI 兼容；直连 Google Gemini（generativelanguage.googleapis.com）选 Gemini 原生、直连 Claude（api.anthropic.com）选 Anthropic 原生，思考档位与openai 完全一致。注意：TTS 语音目前仅支持 OpenAI 兼容格式"
          />

          <Input
            label="API Key"
            required
            type="password"
            value={draft.apiKey}
            onChange={(e) => patchDraft({ apiKey: e.target.value })}
            placeholder="sk-..."
            hint="默认密文展示，点击右侧眼睛图标可切换显示"
          />

          {/* 拉取模型与连通性测试 */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <Button
              size="sm"
              variant="secondary"
              loading={isFetching}
              onClick={() => {
                void handleFetchModels();
              }}
            >
              拉取模型
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={isTestingForm}
              onClick={() => {
                void handleTestDraft();
              }}
            >
              连通性测试
            </Button>
            <TestBadge result={testResults[formKey]} />
            <span className="ml-auto text-xs text-slate-500">测试与拉取均不会修改已保存的配置</span>
          </div>

          <ModelPicker
            models={pickerModels}
            selectedIds={draft.availableModels}
            defaultModel={draft.selectedModel}
            onToggle={toggleModel}
            onDefaultChange={(modelId: string) => patchDraft({ selectedModel: modelId })}
            onBulkSelect={bulkSelectModels}
          />

          {/* AI 思考模式与采样温度 */}
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <Select
              label="AI 思考模式（推理强度）"
              options={THINKING_MODES.map((m: ThinkingMode): SelectOption => ({ value: m, label: THINKING_LABELS[m] }))}
              value={draft.thinkingMode}
              onChange={(e) => patchDraft({ thinkingMode: e.target.value as ThinkingMode })}
              hint="自动：推理型模型（DeepSeek-R1 / QwQ / o 系列等）自动开启；关闭则纯快速回答；手动选低/中/高可显式控制推理强度"
            />
            <Select
              label="思考方言（参数形状）"
              options={THINKING_PROFILES.map((p: ThinkingProfile): SelectOption => ({
                value: p,
                label: THINKING_PROFILE_LABELS[p],
              }))}
              value={draft.thinkingProfile}
              onChange={(e) => patchDraft({ thinkingProfile: e.target.value as ThinkingProfile })}
              hint="各家关闭/开启思考的请求字段位置与形状不同且错误不报错。默认自动检测；若你的厂商思考关不掉/开不了，请对照厂商文档改选具体方言"
            />
            <Select
              label="模型思考能力"
              options={THINKING_CAPABILITIES.map((c: ThinkingCapability): SelectOption => ({
                value: c,
                label: THINKING_CAPABILITY_LABELS[c],
              }))}
              value={draft.thinkingCapability}
              onChange={(e) => patchDraft({ thinkingCapability: e.target.value as ThinkingCapability })}
              hint="部分模型只支持开/关（选低中高都会满血思考）：声明「仅开/关」可避免假分级；无思考能力的模型则完全不发思考参数"
            />
            <Input
              label="输出上限 max_tokens（选填）"
              type="number"
              min={1}
              step={1}
              value={draft.maxTokens === null ? '' : String(draft.maxTokens)}
              onChange={(e) => {
                const raw: string = e.target.value;
                if (raw.trim() === '') {
                  patchDraft({ maxTokens: null });
                  return;
                }
                const n: number = Number(raw);
                patchDraft({ maxTokens: Number.isInteger(n) && n >= 1 ? n : null });
              }}
              hint="留空：思考开启时自动按档位抬预算（低 4096 / 中 8192 / 高 24576），关闭/未设置不发送；填写后始终以填写值为准（网关报 max_tokens 超上限 400 时，请填它家的天花板）"
            />
            <Input
              label="采样温度（0~2）"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={String(draft.temperature)}
              onChange={(e) => {
                const n: number = Number(e.target.value);
                patchDraft({ temperature: Number.isFinite(n) ? n : 0 });
              }}
              hint="斗地主是确定性博弈，越低越稳（建议 0.2~0.4）；越高出牌越随机"
            />
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
        title="删除模型配置"
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
        <p className="text-sm text-slate-300">
          确定要删除配置「{deleteTarget?.name ?? ''}」吗？删除后不可恢复。
        </p>
        {deleteTarget !== null && (boundCountMap[deleteTarget.id] ?? 0) > 0 ? (
          <p className="mt-2 rounded-xl bg-amber-500/15 px-3 py-2 text-xs text-amber-300 ring-1 ring-amber-400/30">
            该配置正被 {boundCountMap[deleteTarget.id]} 个 AI 玩家绑定，删除会被阻断。请先前往「AI 玩家」页解绑或删除相关玩家。
          </p>
        ) : null}
      </Modal>
    </div>
  );
}

export default ModelConfigPage;
