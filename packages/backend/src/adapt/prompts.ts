import type { DesignIR, RoleMap } from '@beeline-resize/shared';
import { outline } from './roles.js';

export const ANALYZE_SYSTEM = `Ты — арт-директор, который адаптирует макеты Figma под разные размеры.
Определи смысловую роль и приоритет (0–100) значимых элементов макета.
Роли: logo, heading, subheading, body, cta (кнопка/призыв), price, legal (сноски и юридический текст), hero-image (главное изображение), background (фон на весь кадр), icon, navigation (верхняя навигация/хедер), tab-bar (нижняя панель вкладок), status-bar, card, list, form, container, decor, other.
Правила:
- cta и logo — самые важные в рекламе (90–100), legal и decor — наименее (≤25).
- Для изображений укажи focal — фокусную точку (лицо, товар) в долях 0..1 от размеров элемента, иначе null.
- group объединяет связанные элементы (например, заголовок+цена+кнопка = "offer"), иначе null.
- Используй только id из описания. Не придумывай элементы.`;

export function analyzeUser(ir: DesignIR): string {
  return `Макет «${ir.source.name}», ${ir.source.width}×${ir.source.height}. Описание узлов (box = x, y, ширина, высота):
${JSON.stringify(outline(ir))}`;
}

export const PLAN_SYSTEM = `Ты — арт-директор, который адаптирует макет под класс целевых размеров.
Верни семантический план, а не пиксели: геометрию посчитает солвер.
- composition: stack (вертикальный стек), row (один ряд), split-h (изображение сбоку, текст рядом), split-v (изображение сверху, текст снизу), overlay (текст поверх фонового изображения), grid (сетка колонок).
- columns: число колонок для повторяющихся элементов (карточек) или null.
- order: id значимых элементов в порядке чтения (сверху вниз / слева направо).
- hide: что скрыть в этом классе размеров с причиной. Никогда не скрывай logo и cta.
- focal: фокусные точки изображений (0..1).
- containers: контейнеры, которые нужно перестроить (HORIZONTAL/VERTICAL/GRID).
Классы: web:mobile (<768, одна колонка), web:tablet (768–1279), web:desktop; app:ios-phone, app:android-phone, app:*-tablet (учитывай safe area и закреплённые бары); banner:strip (узкая полоса ≥4:1), banner:landscape, banner:square, banner:portrait, banner:tall (≤1:2.5).
Используй только id из описания.`;

export function planUser(ir: DesignIR, roles: RoleMap, sizeClass: string, sizes: Array<{ width: number; height: number | 'auto' }>): string {
  const roleList = Object.entries(roles.roles).map(([id, r]) => ({ id, role: r.role, priority: r.priority }));
  return `Класс: ${sizeClass}. Размеры класса: ${sizes.map((s) => `${s.width}×${s.height}`).join(', ')}.
Исходник «${ir.source.name}» ${ir.source.width}×${ir.source.height}.
Роли: ${JSON.stringify(roleList)}
Узлы: ${JSON.stringify(outline(ir, 2, 60))}`;
}
