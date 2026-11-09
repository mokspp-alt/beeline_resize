import { GROUP_LABELS, type PresetGroup } from '@beeline-resize/shared/labels';

/**
 * Имя результата (spec figma-output-generation → Naming and placement):
 * `<имя исходника> / <группа> / <имя размера> <ширина>×<высота>`.
 */
export function resultName(source: string, preset: { group: PresetGroup; name: string; width: number; height: number | 'auto' }): string {
  const size = `${preset.width}×${preset.height}`;
  // не дублируем размер, если он уже есть в имени пресета («Web 360», «Leaderboard 728×90»)
  const base = preset.name
    .replace(new RegExp(`\\s*${preset.width}×${preset.height}$`), '')
    .replace(new RegExp(`\\s*${preset.width}$`), '')
    .trim();
  return `${source} / ${GROUP_LABELS[preset.group]} / ${base ? `${base} ` : ''}${size}`;
}

/** Следующий свободный суффикс версии: «v2», «v3»… */
export function nextVersionName(name: string, existing: string[]): string {
  const base = name.replace(/ v\d+$/, '');
  let v = 2;
  while (existing.includes(`${base} v${v}`)) v++;
  return `${base} v${v}`;
}
