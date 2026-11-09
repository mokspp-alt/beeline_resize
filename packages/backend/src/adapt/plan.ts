import {
  ALWAYS_VISIBLE_BANNER_ROLES,
  indexNodes,
  type AdaptationMode,
  type Composition,
  type DesignIR,
  type PlanTemplate,
  type RoleMap,
  type SizePreset,
} from '@beeline-resize/shared';
import { generateStructured } from '../llm/structured.js';
import { fallbackReason, LlmError } from '../llm/types.js';
import type { LlmContext } from './analyze.js';
import { PLAN_SYSTEM, planUser } from './prompts.js';
import { PlanWireSchema, planWireToTemplate, strictJsonSchema } from './wire.js';

const PLAN_SCHEMA = strictJsonSchema(PlanWireSchema);

function hasRole(roles: RoleMap, role: string): boolean {
  return Object.values(roles.roles).some((r) => r.role === role);
}

/** Детерминированный шаблон для класса размеров (фолбэк, spec layout-adaptation → Deterministic fallback). */
export function defaultTemplate(sizeClass: string, mode: AdaptationMode, roles: RoleMap): PlanTemplate {
  let composition: Composition = 'stack';
  let columns: number | undefined;
  const media = hasRole(roles, 'hero-image');
  const bg = hasRole(roles, 'background');
  switch (sizeClass) {
    case 'banner:strip':
      composition = 'row';
      break;
    case 'banner:landscape':
      composition = media ? 'split-h' : bg ? 'overlay' : 'stack';
      break;
    case 'banner:square':
      composition = media ? 'split-v' : bg ? 'overlay' : 'stack';
      break;
    case 'banner:portrait':
      composition = media ? 'split-v' : bg ? 'overlay' : 'stack';
      break;
    case 'banner:tall':
      composition = 'stack';
      break;
    case 'web:mobile':
      columns = 1;
      break;
    case 'web:tablet':
      columns = 2;
      break;
  }
  const order = Object.entries(roles.roles)
    .sort((a, b) => b[1].priority - a[1].priority)
    .map(([id]) => id);
  return { sizeClass, mode, composition, ...(columns ? { columns } : {}), order, hide: [], focal: {}, operations: [], notes: [] };
}

/** Проверка шаблона от LLM (spec layout-adaptation → Plan validation). */
export function validateTemplate(t: PlanTemplate, ir: DesignIR, roles: RoleMap): string[] {
  const ids = new Set(indexNodes(ir.root).keys());
  const errors: string[] = [];
  const check = (id: string, where: string) => {
    if (!ids.has(id)) errors.push(`${where}: нет элемента ${id}`);
  };
  t.order.forEach((id) => check(id, 'order'));
  t.hide.forEach((h) => {
    check(h.nodeId, 'hide');
    const role = roles.roles[h.nodeId]?.role;
    if (role && ALWAYS_VISIBLE_BANNER_ROLES.includes(role)) errors.push(`hide: нельзя скрывать ${role} (${h.nodeId})`);
  });
  Object.keys(t.focal).forEach((id) => check(id, 'focal'));
  t.operations.forEach((o) => check(o.nodeId, o.op));
  return errors;
}

export interface TemplateResult {
  template: PlanTemplate;
  ai: boolean;
  reason?: string;
}

/** Шаг планирования: один шаблон на класс размеров (design D3). */
export async function planForClass(
  ir: DesignIR,
  roles: RoleMap,
  sizeClass: string,
  mode: AdaptationMode,
  presets: Array<Pick<SizePreset, 'width' | 'height'>>,
  llm: LlmContext,
): Promise<TemplateResult> {
  const fallback = defaultTemplate(sizeClass, mode, roles);
  if (!llm.provider) return { template: fallback, ai: false, reason: llm.disabledReason ?? 'без AI: провайдер не настроен' };
  try {
    const res = await llm.limiter.run(llm.user, () =>
      generateStructured(
        llm.provider!,
        { system: PLAN_SYSTEM, user: planUser(ir, roles, sizeClass, presets), schemaName: 'layout_plan', jsonSchema: PLAN_SCHEMA, maxTokens: 16000 },
        PlanWireSchema,
        { timeoutMs: llm.timeoutMs, ...(llm.signal ? { signal: llm.signal } : {}) },
      ),
    );
    llm.usage.add(res.usage);
    const template = planWireToTemplate(res.value, sizeClass, mode);
    const errors = validateTemplate(template, ir, roles);
    if (errors.length > 0) throw new LlmError('invalid-output', errors.slice(0, 3).join('; '));
    return { template, ai: true };
  } catch (e) {
    return { template: fallback, ai: false, reason: fallbackReason(e) };
  }
}
