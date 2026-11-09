import type { AdaptationMode } from './plan.js';
import type { SizePreset } from './presets.js';

/**
 * Классы размеров для планирования (design D3): один план-шаблон на класс.
 *
 * - web:mobile | web:tablet | web:desktop — по ширине (<768, <1280, ≥1280)
 * - app:ios-phone | app:ios-tablet | app:android-phone | app:android-tablet
 * - banner:strip | banner:landscape | banner:square | banner:portrait | banner:tall — по соотношению сторон
 */
export type SizeClass = string;

export function modeForPreset(preset: Pick<SizePreset, 'group'>): AdaptationMode {
  switch (preset.group) {
    case 'web':
      return 'web';
    case 'app-ios':
    case 'app-android':
      return 'app';
    default:
      return 'banner';
  }
}

export function bannerClass(width: number, height: number): SizeClass {
  const r = width / height;
  if (r >= 4) return 'banner:strip';
  if (r >= 1.5) return 'banner:landscape';
  if (r >= 0.85) return 'banner:square';
  if (r >= 0.4) return 'banner:portrait';
  return 'banner:tall';
}

export function webClass(width: number): SizeClass {
  if (width < 768) return 'web:mobile';
  if (width < 1280) return 'web:tablet';
  return 'web:desktop';
}

export function appClass(platform: 'ios' | 'android', width: number, height: number): SizeClass {
  const kind = Math.min(width, height) < 600 ? 'phone' : 'tablet';
  return `app:${platform}-${kind}`;
}

/** Платформа App по группе пресета; для пользовательских размеров — undefined. */
export function appPlatform(preset: Pick<SizePreset, 'group'>): 'ios' | 'android' | undefined {
  if (preset.group === 'app-ios') return 'ios';
  if (preset.group === 'app-android') return 'android';
  return undefined;
}

export interface Classified {
  mode: AdaptationMode;
  sizeClass: SizeClass;
}

/**
 * Режим и класс размера. `modeOverride` — ручное переопределение режима пользователем
 * (spec layout-adaptation → Adaptation mode selection).
 */
export function classify(
  preset: Pick<SizePreset, 'group' | 'width' | 'height'>,
  modeOverride?: AdaptationMode,
): Classified {
  const mode = modeOverride ?? modeForPreset(preset);
  const height = preset.height === 'auto' ? Math.round(preset.width * 2) : preset.height;
  switch (mode) {
    case 'web':
      return { mode, sizeClass: webClass(preset.width) };
    case 'app':
      return { mode, sizeClass: appClass(appPlatform(preset) ?? 'ios', preset.width, height) };
    case 'banner':
      return { mode, sizeClass: bannerClass(preset.width, height) };
  }
}

/** Группировка размеров по классам, чтобы планировать один раз на класс. */
export function groupByClass<T extends Pick<SizePreset, 'group' | 'width' | 'height' | 'id'>>(
  presets: T[],
  overrides: Record<string, AdaptationMode> = {},
): Map<SizeClass, { mode: AdaptationMode; presets: T[] }> {
  const out = new Map<SizeClass, { mode: AdaptationMode; presets: T[] }>();
  for (const p of presets) {
    const { mode, sizeClass } = classify(p, overrides[p.id]);
    const entry = out.get(sizeClass) ?? { mode, presets: [] };
    entry.presets.push(p);
    out.set(sizeClass, entry);
  }
  return out;
}
