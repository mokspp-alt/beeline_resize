import { z } from 'zod';
import { CompositionSchema, ElementRoleSchema, type PlanTemplate, type RoleMap } from '@beeline-resize/shared';

/**
 * «Проводные» схемы ответа LLM. Совместимы со structured outputs всех провайдеров:
 * только массивы объектов (без record), все поля обязательны, необязательные — nullable.
 * Диапазоны проверяет zod после ответа; в JSON Schema числовые ограничения не передаются.
 */

const Focal = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

export const RoleWireSchema = z.object({
  elements: z.array(
    z.object({
      nodeId: z.string(),
      role: ElementRoleSchema,
      priority: z.number().int().min(0).max(100),
      group: z.string().nullable(),
      focal: Focal.nullable(),
    }),
  ),
});
export type RoleWire = z.infer<typeof RoleWireSchema>;

export const PlanWireSchema = z.object({
  composition: CompositionSchema,
  columns: z.number().int().min(1).max(12).nullable(),
  order: z.array(z.string()),
  hide: z.array(z.object({ nodeId: z.string(), reason: z.string() })),
  focal: z.array(z.object({ nodeId: z.string(), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })),
  containers: z.array(
    z.object({
      nodeId: z.string(),
      layout: z.enum(['HORIZONTAL', 'VERTICAL', 'GRID']),
      columns: z.number().int().min(1).max(12).nullable(),
    }),
  ),
  notes: z.array(z.string()),
});
export type PlanWire = z.infer<typeof PlanWireSchema>;

const DROP_KEYS = new Set(['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format', 'default']);

/** JSON Schema для structured outputs: additionalProperties:false и все свойства в required. */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  const fix = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(fix);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (!DROP_KEYS.has(k)) out[k] = fix(v);
    if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as object);
    }
    return out;
  };
  return fix(raw) as Record<string, unknown>;
}

export function roleWireToMap(w: RoleWire, knownIds: Set<string>): { map: RoleMap; unknown: string[] } {
  const roles: RoleMap['roles'] = {};
  const unknown: string[] = [];
  for (const e of w.elements) {
    if (!knownIds.has(e.nodeId)) {
      unknown.push(e.nodeId);
      continue;
    }
    roles[e.nodeId] = {
      role: e.role,
      priority: e.priority,
      ...(e.group ? { group: e.group } : {}),
      ...(e.focal ? { focal: e.focal } : {}),
    };
  }
  return { map: { roles }, unknown };
}

export function planWireToTemplate(w: PlanWire, sizeClass: string, mode: PlanTemplate['mode']): PlanTemplate {
  return {
    sizeClass,
    mode,
    composition: w.composition,
    ...(w.columns ? { columns: w.columns } : {}),
    order: w.order,
    hide: w.hide,
    focal: Object.fromEntries(w.focal.map((f) => [f.nodeId, { x: f.x, y: f.y }])),
    operations: w.containers.map((c) =>
      c.layout === 'GRID' || (c.columns && c.columns > 1 && c.layout === 'HORIZONTAL')
        ? { op: 'setGrid' as const, nodeId: c.nodeId, columns: c.columns ?? 2, gap: 16 }
        : { op: 'setLayout' as const, nodeId: c.nodeId, mode: c.layout as 'HORIZONTAL' | 'VERTICAL' },
    ),
    notes: w.notes,
  };
}
