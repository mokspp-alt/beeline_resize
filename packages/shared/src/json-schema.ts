import { z } from 'zod';
import { RoleMapSchema } from './roles.js';
import { PlanTemplateSchema } from './plan.js';

/** JSON Schema для structured output LLM (draft 2020-12, вход — что модель должна вернуть). */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
}

export const roleMapJsonSchema = () => toJsonSchema(RoleMapSchema);
export const planTemplateJsonSchema = () => toJsonSchema(PlanTemplateSchema);
