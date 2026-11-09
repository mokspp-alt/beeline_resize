import type { DesignIR, DesignNode } from '@beeline-resize/shared';
import { walk } from '@beeline-resize/shared/tree';

/** Предупреждения о качестве исходника (spec figma-source-capture → Source validation warnings). */

export type WarningCode = 'missing-font' | 'no-constraints' | 'out-of-bounds' | 'raster-text';

export interface SourceWarning {
  code: WarningCode;
  message: string;
  nodeIds: string[];
  /** Для missing-font: имя шрифта. */
  font?: string;
  /** Адаптация продолжается только после подтверждения пользователя. */
  requiresConfirm: boolean;
}

export interface WarningInput {
  ir: DesignIR;
  /** Шрифты, отсутствующие в текущей сессии: «family::style» → id текстовых слоёв. */
  missingFonts: Map<string, string[]>;
}

const RASTER_TEXT_NAME = /(text|title|heading|caption|label|текст|заголов|надпис|подпис)/i;

export function collectWarnings({ ir, missingFonts }: WarningInput): SourceWarning[] {
  const out: SourceWarning[] = [];

  for (const [font, nodeIds] of missingFonts) {
    const [family, style] = font.split('::');
    const name = `${family} ${style}`;
    out.push({
      code: 'missing-font',
      font: name,
      nodeIds,
      requiresConfirm: true,
      message: `Шрифт «${name}» недоступен — затронуто слоёв: ${nodeIds.length}. Текст в результатах нельзя будет изменить.`,
    });
  }

  const { width: W, height: H } = ir.source;
  const outside: string[] = [];
  const rasterText: string[] = [];

  walk(ir.root, (n, parent) => {
    if (!parent) return;
    if (!n.visible) return;

    // Свободная раскладка, в которой ни у одного ребёнка не настроены constraints.
    if (isFreeLayout(n) && (n.children?.length ?? 0) > 1 && n.children!.every(isDefaultConstraints)) {
      out.push({
        code: 'no-constraints',
        nodeIds: [n.id],
        requiresConfirm: false,
        message: `«${n.name}»: элементы позиционированы абсолютно без constraints и auto layout — адаптация будет менее точной.`,
      });
    }

    const b = n.bbox;
    const fullyInside = b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= W + 0.5 && b.y + b.height <= H + 0.5;
    if (!fullyInside && parent.id === ir.root.id) outside.push(n.id);

    const hasImage = n.fills?.some((f) => f.type === 'IMAGE' && f.visible);
    if (hasImage && n.type !== 'TEXT' && RASTER_TEXT_NAME.test(n.name)) rasterText.push(n.id);
  });

  // Корень тоже проверяем на свободную раскладку.
  if (isFreeLayout(ir.root) && (ir.root.children?.length ?? 0) > 1 && ir.root.children!.every(isDefaultConstraints)) {
    out.push({
      code: 'no-constraints',
      nodeIds: [ir.root.id],
      requiresConfirm: false,
      message: `«${ir.root.name}»: элементы позиционированы абсолютно без constraints и auto layout — адаптация будет менее точной.`,
    });
  }

  if (outside.length > 0) {
    out.push({
      code: 'out-of-bounds',
      nodeIds: outside,
      requiresConfirm: false,
      message: `Слоёв за границами фрейма: ${outside.length}. Они могут попасть в результаты неожиданно.`,
    });
  }
  if (rasterText.length > 0) {
    out.push({
      code: 'raster-text',
      nodeIds: rasterText,
      requiresConfirm: false,
      message: `Похоже на текст в растровом изображении (${rasterText.length}). Такой текст не будет перестраиваться.`,
    });
  }
  return out;
}

function isFreeLayout(n: DesignNode): boolean {
  return (n.type === 'FRAME' || n.type === 'COMPONENT') && !n.autoLayout;
}

function isDefaultConstraints(n: DesignNode): boolean {
  return !n.constraints || (n.constraints.horizontal === 'MIN' && n.constraints.vertical === 'MIN');
}

export function needsConfirmation(warnings: SourceWarning[]): boolean {
  return warnings.some((w) => w.requiresConfirm);
}
