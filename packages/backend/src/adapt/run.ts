import {
  classify,
  groupByClass,
  type AdaptationMode,
  type DesignIR,
  type DesignSystemConfig,
  type LayoutPlan,
  type ReportItem,
  type RoleMap,
  type SizePreset,
} from '@beeline-resize/shared';
import { applyDataPolicy } from '../llm/policy.js';
import { RunUsage, type UserLimiter } from '../llm/limits.js';
import { fallbackReason, type LlmProvider } from '../llm/types.js';
import type { DataPolicySettings } from '../settings.js';
import { analyzeRoles, type LlmContext } from './analyze.js';
import { defaultTemplate, planForClass } from './plan.js';
import { solve } from './solver.js';
import { validateGeometry } from './validate.js';

export interface AdaptRequest {
  ir: DesignIR;
  preview?: string;
  targets: SizePreset[];
  modeOverrides?: Record<string, AdaptationMode>;
  confidential?: boolean;
}

export type AdaptEvent =
  | { type: 'roles'; roles: RoleMap; ai: boolean; reason?: string }
  | { type: 'plan'; plan: LayoutPlan; report: ReportItem[] }
  | { type: 'error'; targetId: string; message: string }
  | { type: 'done'; usage: ReturnType<RunUsage['toJSON']>; durationMs: number };

export interface RunDeps {
  provider?: LlmProvider;
  limiter: UserLimiter;
  policy: DataPolicySettings;
  timeoutMs: number;
  ds?: DesignSystemConfig;
  user: string;
  signal?: AbortSignal;
}

/**
 * Запуск адаптации: роли (1 раз) → шаблон на класс размеров (параллельно) → солвер на каждый размер.
 * События отдаются по мере готовности (design D9).
 */
export async function runAdaptation(req: AdaptRequest, deps: RunDeps, emit: (e: AdaptEvent) => void): Promise<void> {
  const started = Date.now();
  const usage = new RunUsage();

  // Политика данных: что можно отправить провайдеру
  let llmIr = req.ir;
  let preview: string | undefined;
  let disabledReason: string | undefined;
  let provider = deps.provider;
  if (provider) {
    try {
      const out = applyDataPolicy({ ir: req.ir, ...(req.preview ? { preview: req.preview } : {}), ...(req.confidential ? { confidential: true } : {}) }, deps.policy, provider.name);
      llmIr = out.ir;
      preview = out.preview;
    } catch (e) {
      provider = undefined;
      disabledReason = fallbackReason(e);
    }
  }
  const llm: LlmContext = {
    ...(provider ? { provider } : {}),
    limiter: deps.limiter,
    user: deps.user,
    timeoutMs: deps.timeoutMs,
    usage,
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(disabledReason ? { disabledReason } : {}),
  };

  const roles = await analyzeRoles(llmIr, llm, preview);
  emit({ type: 'roles', roles: roles.roleMap, ai: roles.ai, ...(roles.reason ? { reason: roles.reason } : {}) });

  const classes = groupByClass(req.targets, req.modeOverrides ?? {});
  await Promise.all(
    [...classes.entries()].map(async ([sizeClass, { mode, presets }]) => {
      if (deps.signal?.aborted) return;
      const t = await planForClass(llmIr, roles.roleMap, sizeClass, mode, presets, llm);
      for (const preset of presets) {
        if (deps.signal?.aborted) return;
        try {
          const m = classify(preset, req.modeOverrides?.[preset.id]).mode;
          const base = { ir: req.ir, roles: roles.roleMap, preset, mode: m, ...(deps.ds ? { ds: deps.ds } : {}) };
          let input = { ...base, template: t.template, ai: t.ai && roles.ai, ...(t.reason || roles.reason ? { fallbackReason: t.reason ?? roles.reason } : {}) };
          let result = solve(input);
          let errors = validateGeometry(input, result);
          if (errors.length > 0 && t.ai) {
            // План модели дал невалидную геометрию — детерминированный шаблон
            input = { ...base, template: defaultTemplate(sizeClass, m, roles.roleMap), ai: false, fallbackReason: 'без AI: план модели не прошёл проверку геометрии' };
            result = solve(input);
            errors = validateGeometry(input, result);
          }
          const report = [...result.report, ...errors.map((message) => ({ targetId: preset.id, kind: 'warning' as const, message }))];
          emit({ type: 'plan', plan: result.plan, report });
        } catch (e) {
          emit({ type: 'error', targetId: preset.id, message: e instanceof Error ? e.message : String(e) });
        }
      }
    }),
  );
  emit({ type: 'done', usage: usage.toJSON(), durationMs: Date.now() - started });
}
