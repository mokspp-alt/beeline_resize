import { z } from 'zod';

/**
 * DesignIR — нормализованное описание исходного макета (design D2).
 * Геометрия всех узлов — относительно левого верхнего угла корневого фрейма.
 */

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type Rect = z.infer<typeof RectSchema>;

export const ConstraintTypeSchema = z.enum(['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE']);

export const ConstraintsSchema = z.object({
  horizontal: ConstraintTypeSchema,
  vertical: ConstraintTypeSchema,
});
export type Constraints = z.infer<typeof ConstraintsSchema>;

export const PaddingSchema = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
});
export type Padding = z.infer<typeof PaddingSchema>;

export const AutoLayoutSchema = z.object({
  mode: z.enum(['HORIZONTAL', 'VERTICAL', 'GRID']),
  wrap: z.boolean().default(false),
  itemSpacing: z.number(),
  counterAxisSpacing: z.number().optional(),
  padding: PaddingSchema,
  primaryAxisAlign: z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']),
  counterAxisAlign: z.enum(['MIN', 'CENTER', 'MAX', 'BASELINE']),
  primarySizing: z.enum(['FIXED', 'AUTO']),
  counterSizing: z.enum(['FIXED', 'AUTO']),
});
export type AutoLayout = z.infer<typeof AutoLayoutSchema>;

export const SizingSchema = z.enum(['FIXED', 'HUG', 'FILL']);

/** Параметры узла как ребёнка auto layout. */
export const ChildLayoutSchema = z.object({
  positioning: z.enum(['AUTO', 'ABSOLUTE']),
  sizingH: SizingSchema,
  sizingV: SizingSchema,
  grow: z.number().default(0),
});
export type ChildLayout = z.infer<typeof ChildLayoutSchema>;

/** Ссылка на переменную (токен) дизайн-системы. */
export const VariableRefSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  name: z.string().optional(),
  collectionName: z.string().optional(),
  libraryName: z.string().optional(),
});
export type VariableRef = z.infer<typeof VariableRefSchema>;

/** Ссылка на стиль (текстовый, цветовой, эффект, сетка). */
export const StyleRefSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  name: z.string(),
  isRemote: z.boolean().optional(),
});
export type StyleRef = z.infer<typeof StyleRefSchema>;

export const FontNameSchema = z.object({ family: z.string(), style: z.string() });
export type FontName = z.infer<typeof FontNameSchema>;

export const TextInfoSchema = z.object({
  characters: z.string(),
  fontSize: z.number().positive(),
  font: FontNameSchema,
  /** px или AUTO; проценты переводятся в px при захвате. */
  lineHeight: z.union([z.number(), z.literal('AUTO')]),
  align: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']),
  autoResize: z.enum(['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE']),
  textStyle: StyleRefSchema.optional(),
  /** true, если в слое несколько шрифтов/размеров; берутся значения первого символа. */
  mixed: z.boolean().default(false),
});
export type TextInfo = z.infer<typeof TextInfoSchema>;

export const FillSchema = z.object({
  type: z.enum(['SOLID', 'IMAGE', 'GRADIENT', 'VIDEO', 'OTHER']),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  /** #RRGGBB для SOLID */
  color: z.string().optional(),
  variable: VariableRefSchema.optional(),
  imageHash: z.string().optional(),
  scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional(),
});
export type Fill = z.infer<typeof FillSchema>;

export const ComponentRefSchema = z.object({
  /** Ключ главного компонента (для importComponentByKeyAsync). */
  key: z.string(),
  name: z.string(),
  componentSetKey: z.string().optional(),
  componentSetName: z.string().optional(),
  /** Имя библиотеки, если компонент из подключённой библиотеки. */
  libraryName: z.string().optional(),
  isRemote: z.boolean(),
  /** Значения свойств варианта: { Size: 'L', State: 'Default' }. */
  variantProps: z.record(z.string(), z.string()).default({}),
  /** Текстовые/булевы/instance-swap свойства компонента. */
  componentProps: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
  /** id узлов внутри инстанса, у которых есть overrides. */
  overriddenNodeIds: z.array(z.string()).default([]),
});
export type ComponentRef = z.infer<typeof ComponentRefSchema>;

export const NodeTypeSchema = z.enum([
  'FRAME',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'TEXT',
  'RECTANGLE',
  'ELLIPSE',
  'POLYGON',
  'STAR',
  'LINE',
  'VECTOR',
  'BOOLEAN_OPERATION',
  'OTHER',
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export interface DesignNode {
  id: string;
  name: string;
  type: NodeType;
  visible: boolean;
  bbox: Rect;
  rotation?: number;
  opacity?: number;
  constraints?: Constraints;
  autoLayout?: AutoLayout;
  childLayout?: ChildLayout;
  clipsContent?: boolean;
  cornerRadius?: number;
  isMask?: boolean;
  text?: TextInfo;
  fills?: Fill[];
  component?: ComponentRef;
  /** Привязки полей узла к переменным: { itemSpacing: {...}, paddingLeft: {...}, cornerRadius: {...} } */
  boundVariables?: Record<string, VariableRef>;
  /** Стили узла, кроме текстового: { fill: {...}, effect: {...}, grid: {...} } */
  styles?: Record<string, StyleRef>;
  children?: DesignNode[];
}

export const DesignNodeSchema: z.ZodType<DesignNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: NodeTypeSchema,
    visible: z.boolean(),
    bbox: RectSchema,
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    constraints: ConstraintsSchema.optional(),
    autoLayout: AutoLayoutSchema.optional(),
    childLayout: ChildLayoutSchema.optional(),
    clipsContent: z.boolean().optional(),
    cornerRadius: z.number().optional(),
    isMask: z.boolean().optional(),
    text: TextInfoSchema.optional(),
    fills: z.array(FillSchema).optional(),
    component: ComponentRefSchema.optional(),
    boundVariables: z.record(z.string(), VariableRefSchema).optional(),
    styles: z.record(z.string(), StyleRefSchema).optional(),
    children: z.array(DesignNodeSchema).optional(),
  }),
) as z.ZodType<DesignNode>;

export const DesignIRSchema = z.object({
  version: z.literal(1),
  source: z.object({
    nodeId: z.string(),
    name: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    fileKey: z.string().optional(),
    pageName: z.string().optional(),
  }),
  root: DesignNodeSchema,
  /** Все шрифты, используемые в макете. */
  fonts: z.array(FontNameSchema),
});
export type DesignIR = z.infer<typeof DesignIRSchema>;

/** Обход дерева в глубину. */
export function walk(node: DesignNode, visit: (n: DesignNode, parent: DesignNode | null) => void, parent: DesignNode | null = null): void {
  visit(node, parent);
  for (const child of node.children ?? []) walk(child, visit, node);
}

/** Индекс узлов по id. */
export function indexNodes(root: DesignNode): Map<string, DesignNode> {
  const map = new Map<string, DesignNode>();
  walk(root, (n) => map.set(n.id, n));
  return map;
}
