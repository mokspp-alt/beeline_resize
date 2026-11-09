import { z } from 'zod';

/** Смысловые роли элементов (spec layout-adaptation → Element role detection). */
export const ElementRoleSchema = z.enum([
  'logo',
  'heading',
  'subheading',
  'body',
  'cta',
  'price',
  'legal',
  'hero-image',
  'background',
  'icon',
  'navigation',
  'tab-bar',
  'status-bar',
  'card',
  'list',
  'form',
  'container',
  'decor',
  'other',
]);
export type ElementRole = z.infer<typeof ElementRoleSchema>;

/** Роли, которые в баннере MUST сохраняться всегда. */
export const ALWAYS_VISIBLE_BANNER_ROLES: readonly ElementRole[] = ['logo', 'cta'];

/** Роли, которые в App закрепляются у краёв экрана. */
export const PINNED_APP_ROLES: readonly ElementRole[] = ['navigation', 'tab-bar', 'status-bar'];

export const RoleEntrySchema = z.object({
  role: ElementRoleSchema,
  /** 0–100, выше — важнее. */
  priority: z.number().int().min(0).max(100),
  /** Логическая группа (например, «offer» для заголовка+цены+CTA). */
  group: z.string().optional(),
  /** Фокусная точка изображения в долях 0..1 от размеров узла. */
  focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
});
export type RoleEntry = z.infer<typeof RoleEntrySchema>;

export const RoleMapSchema = z.object({
  /** Хэш DesignIR, по которому построена карта (для кэша). */
  sourceHash: z.string().optional(),
  roles: z.record(z.string(), RoleEntrySchema),
});
export type RoleMap = z.infer<typeof RoleMapSchema>;
