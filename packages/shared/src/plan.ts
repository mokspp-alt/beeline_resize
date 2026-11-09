import { z } from 'zod';
import { PaddingSchema } from './ir.js';

/** Режимы адаптации (spec layout-adaptation → Adaptation mode selection). */
export const AdaptationModeSchema = z.enum(['web', 'app', 'banner']);
export type AdaptationMode = z.infer<typeof AdaptationModeSchema>;

/** Фиксированный словарь композиций (design D2). */
export const CompositionSchema = z.enum([
  /** вертикальный стек сверху вниз */
  'stack',
  /** горизонтальный ряд */
  'row',
  /** медиа слева/справа, текст рядом */
  'split-h',
  /** медиа сверху, текст снизу */
  'split-v',
  /** текст поверх фонового изображения */
  'overlay',
  /** сетка колонок */
  'grid',
]);
export type Composition = z.infer<typeof CompositionSchema>;

const nodeId = z.string().min(1);
const FocalSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

export const OperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('setLayout'),
    nodeId,
    mode: z.enum(['HORIZONTAL', 'VERTICAL', 'NONE']),
    wrap: z.boolean().optional(),
    itemSpacing: z.number().nonnegative().optional(),
    padding: PaddingSchema.optional(),
    primaryAxisAlign: z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']).optional(),
    counterAxisAlign: z.enum(['MIN', 'CENTER', 'MAX']).optional(),
  }),
  z.object({
    op: z.literal('setGrid'),
    nodeId,
    columns: z.number().int().min(1).max(12),
    gap: z.number().nonnegative(),
  }),
  z.object({ op: z.literal('reorder'), nodeId, order: z.array(nodeId) }),
  z.object({ op: z.literal('hide'), nodeId, reason: z.string() }),
  z.object({ op: z.literal('show'), nodeId }),
  z.object({
    op: z.literal('setSize'),
    nodeId,
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    sizingH: z.enum(['FIXED', 'HUG', 'FILL']).optional(),
    sizingV: z.enum(['FIXED', 'HUG', 'FILL']).optional(),
  }),
  z.object({
    op: z.literal('setPosition'),
    nodeId,
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    op: z.literal('setTextSize'),
    nodeId,
    fontSize: z.number().positive(),
    lineHeight: z.number().positive().optional(),
  }),
  z.object({ op: z.literal('swapVariant'), nodeId, props: z.record(z.string(), z.string()) }),
  z.object({ op: z.literal('swapComponent'), nodeId, componentKey: z.string() }),
  z.object({ op: z.literal('crop'), nodeId, focal: FocalSchema }),
  z.object({
    op: z.literal('bindVariable'),
    nodeId,
    /** поле узла: itemSpacing, paddingLeft, cornerRadius, fontSize, ... */
    field: z.string(),
    variableKey: z.string(),
  }),
]);
export type Operation = z.infer<typeof OperationSchema>;
export type OperationKind = Operation['op'];

/**
 * PlanTemplate — ответ LLM на шаге планирования (design D3): один шаблон на класс
 * размеров. Не содержит пикселей целевого размера — их считает солвер.
 */
export const PlanTemplateSchema = z.object({
  sizeClass: z.string(),
  mode: AdaptationModeSchema,
  composition: CompositionSchema,
  /** Число колонок для повторяющихся элементов (карточки и т.п.). */
  columns: z.number().int().min(1).max(12).optional(),
  /** Порядок значимых элементов сверху вниз / слева направо. */
  order: z.array(nodeId).default([]),
  /** Элементы, которые следует скрыть в этом классе размеров. */
  hide: z.array(z.object({ nodeId, reason: z.string() })).default([]),
  /** Фокусные точки изображений. */
  focal: z.record(z.string(), FocalSchema).default({}),
  /** Дополнительные семантические операции (варианты, раскладка контейнеров). */
  operations: z.array(OperationSchema).default([]),
  notes: z.array(z.string()).default([]),
});
export type PlanTemplate = z.infer<typeof PlanTemplateSchema>;

/** LayoutPlan — итоговый план для одного целевого размера (после солвера). */
export const LayoutPlanSchema = z.object({
  targetId: z.string(),
  width: z.number().positive(),
  /** 'auto' — высота по содержимому (web). */
  height: z.union([z.number().positive(), z.literal('auto')]),
  mode: AdaptationModeSchema,
  sizeClass: z.string(),
  composition: CompositionSchema,
  /** Явные моды переменных: { collectionKey: modeName }. */
  variableModes: z.record(z.string(), z.string()).default({}),
  operations: z.array(OperationSchema),
  /** Построен ли план с участием LLM. */
  ai: z.boolean(),
  fallbackReason: z.string().optional(),
});
export type LayoutPlan = z.infer<typeof LayoutPlanSchema>;

/** Пункты отчёта (spec figma-output-generation → Adaptation report). */
export const ReportItemSchema = z.object({
  targetId: z.string(),
  kind: z.enum(['fallback', 'hidden', 'no-token', 'no-app-analog', 'overflow', 'library-missing', 'warning', 'error']),
  nodeId: z.string().optional(),
  message: z.string(),
});
export type ReportItem = z.infer<typeof ReportItemSchema>;
