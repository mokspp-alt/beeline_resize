import { z } from 'zod';

/**
 * Конфигурация дизайн-системы Carnica (design D5, spec design-system-integration).
 * Файл: config/design-system.json.
 */

export const LibraryRoleSchema = z.enum(['colors', 'typography', 'sizes', 'icons', 'ui-kit-app', 'ui-kit-web']);
export type LibraryRole = z.infer<typeof LibraryRoleSchema>;
export const LIBRARY_ROLES = LibraryRoleSchema.options;

export const LibrarySchema = z.object({
  /** Имя библиотеки, как его показывает Figma (по нему плагин сопоставляет библиотеку). */
  name: z.string().min(1),
  /** File key — для REST API на бэкенде. */
  fileKey: z.string().min(1),
  url: z.string().url().optional(),
});
export type Library = z.infer<typeof LibrarySchema>;

const UiKitRoleSchema = z.enum(['ui-kit-app', 'ui-kit-web']);

/**
 * Ключи соответствий: класс устройства (mobile|tablet|desktop|banner),
 * платформа (web|ios|android) или default.
 */
export const MatchKeySchema = z.enum(['mobile', 'tablet', 'desktop', 'banner', 'web', 'ios', 'android', 'default']);
export type MatchKey = z.infer<typeof MatchKeySchema>;

export const CollectionMappingSchema = z.object({
  library: LibraryRoleSchema,
  /** Ключ коллекции переменных библиотеки. */
  key: z.string().min(1),
  name: z.string().optional(),
  /** Ключ соответствия → имя мода. */
  modes: z.partialRecord(MatchKeySchema, z.string().min(1)),
});
export type CollectionMapping = z.infer<typeof CollectionMappingSchema>;

export const VariantRuleSchema = z.object({
  library: UiKitRoleSchema,
  /** Имя набора компонентов (component set). */
  componentSet: z.string().min(1),
  componentSetKey: z.string().optional(),
  /** Свойство варианта, например Size. */
  property: z.string().min(1),
  /** Ключ соответствия → значение варианта. */
  byClass: z.partialRecord(MatchKeySchema, z.string().min(1)),
});
export type VariantRule = z.infer<typeof VariantRuleSchema>;

export const ComponentPointerSchema = z.object({
  library: z.union([UiKitRoleSchema, z.literal('icons')]),
  /** Имя компонента или набора компонентов. */
  name: z.string().min(1),
  /** Ключ компонента/набора (из скана). */
  key: z.string().optional(),
});
export type ComponentPointer = z.infer<typeof ComponentPointerSchema>;

export const SubstitutionSchema = z.object({
  from: ComponentPointerSchema,
  to: ComponentPointerSchema,
  when: z.object({
    mode: z.enum(['web', 'app', 'banner']).optional(),
    deviceClass: z.array(z.enum(['mobile', 'tablet', 'desktop', 'banner'])).optional(),
    platform: z.enum(['web', 'ios', 'android']).optional(),
  }),
  /** true — подтверждено администратором; false — предложено сканом. */
  confirmed: z.boolean().default(true),
});
export type Substitution = z.infer<typeof SubstitutionSchema>;

export const DesignSystemConfigSchema = z.object({
  designSystem: z.string().min(1),
  libraries: z.partialRecord(LibraryRoleSchema, LibrarySchema),
  kitByMode: z.object({ web: UiKitRoleSchema, app: UiKitRoleSchema, banner: UiKitRoleSchema }),
  /** Коллекции переменных: breakpoint, platform, theme и т.п. */
  collections: z.record(z.string(), CollectionMappingSchema).default({}),
  /** Брейкпоинты ДС — заменяют группу web в каталоге размеров. */
  breakpoints: z.array(z.object({ mode: z.string(), width: z.number().int().positive() })).optional(),
  variants: z.array(VariantRuleSchema).default([]),
  substitutions: z.array(SubstitutionSchema).default([]),
  minFontSize: z.object({ web: z.number().positive(), app: z.number().positive(), banner: z.number().positive() }),
  /** Допустимые размеры иконок из токенов sizes. */
  iconSizes: z.array(z.number().positive()).optional(),
  /** Шкала отступов из токенов sizes: значение → ключ переменной. */
  spacingTokens: z.record(z.string(), z.string()).optional(),
});
export type DesignSystemConfig = z.infer<typeof DesignSystemConfigSchema>;

/** Минимальный размер CTA (spec layout-adaptation → Readability constraints). */
export const MIN_TOUCH_TARGET = { ios: 44, android: 48, web: 0 } as const;
