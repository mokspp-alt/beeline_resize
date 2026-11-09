import { createHash } from 'node:crypto';
import { indexNodes, type DesignIR, type RoleMap } from '@beeline-resize/shared';
import { generateStructured } from '../llm/structured.js';
import { fallbackReason, LlmError, type LlmImage, type LlmProvider } from '../llm/types.js';
import type { RunUsage, UserLimiter } from '../llm/limits.js';
import { heuristicRoles } from './roles.js';
import { ANALYZE_SYSTEM, analyzeUser } from './prompts.js';
import { RoleWireSchema, roleWireToMap, strictJsonSchema } from './wire.js';

export interface LlmContext {
  provider?: LlmProvider;
  limiter: UserLimiter;
  user: string;
  timeoutMs: number;
  usage: RunUsage;
  signal?: AbortSignal;
  /** Причина, по которой LLM не используется для этого запуска (политика). */
  disabledReason?: string;
}

export interface RolesResult {
  roleMap: RoleMap;
  ai: boolean;
  reason?: string;
}

const ROLE_SCHEMA = strictJsonSchema(RoleWireSchema);
const cache = new Map<string, RoleMap>();

export function irHash(ir: DesignIR): string {
  return createHash('sha256').update(JSON.stringify(ir)).digest('hex').slice(0, 32);
}

/**
 * Шаг анализа (design D3): роли один раз на исходник, кэш по хэшу DesignIR.
 * Роли от LLM дополняются эвристикой для узлов, которые модель не разметила.
 */
export async function analyzeRoles(ir: DesignIR, llm: LlmContext, preview?: string): Promise<RolesResult> {
  const heuristic = heuristicRoles(ir);
  if (!llm.provider) return { roleMap: heuristic, ai: false, reason: llm.disabledReason ?? 'без AI: провайдер не настроен' };

  const hash = irHash(ir);
  const cached = cache.get(hash);
  if (cached) return { roleMap: cached, ai: true };

  try {
    const images: LlmImage[] | undefined = preview ? [{ mediaType: 'image/png', data: preview }] : undefined;
    const res = await llm.limiter.run(llm.user, () =>
      generateStructured(
        llm.provider!,
        { system: ANALYZE_SYSTEM, user: analyzeUser(ir), ...(images ? { images } : {}), schemaName: 'element_roles', jsonSchema: ROLE_SCHEMA, maxTokens: 16000 },
        RoleWireSchema,
        { timeoutMs: llm.timeoutMs, ...(llm.signal ? { signal: llm.signal } : {}) },
      ),
    );
    llm.usage.add(res.usage);
    const ids = new Set(indexNodes(ir.root).keys());
    const { map, unknown } = roleWireToMap(res.value, ids);
    if (Object.keys(map.roles).length === 0 || unknown.length > res.value.elements.length / 2) {
      throw new LlmError('invalid-output', `модель вернула неизвестные id: ${unknown.slice(0, 5).join(', ')}`);
    }
    const merged: RoleMap = { sourceHash: hash, roles: { ...heuristic.roles, ...map.roles } };
    cache.set(hash, merged);
    return { roleMap: merged, ai: true };
  } catch (e) {
    return { roleMap: heuristic, ai: false, reason: fallbackReason(e) };
  }
}

export function clearRoleCache() {
  cache.clear();
}
