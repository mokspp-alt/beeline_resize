import { z } from 'zod';

/**
 * Каталог целевых размеров (spec size-presets). Размеры — в единицах Figma 1x
 * (px для Web, pt для iOS, dp для Android).
 */

export const PresetGroupSchema = z.enum(['web', 'app-ios', 'app-android', 'banner-display', 'banner-social', 'custom']);
export type PresetGroup = z.infer<typeof PresetGroupSchema>;

export const DeviceClassSchema = z.enum(['mobile', 'tablet', 'desktop', 'banner']);
export type DeviceClass = z.infer<typeof DeviceClassSchema>;

export const SafeAreaSchema = z.object({
  top: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  left: z.number().nonnegative().default(0),
  right: z.number().nonnegative().default(0),
});
export type SafeArea = z.infer<typeof SafeAreaSchema>;

export const MIN_SIZE = 16;
export const MAX_SIZE = 8192;

const dim = z.number().int().min(MIN_SIZE).max(MAX_SIZE);

export const SizePresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  group: PresetGroupSchema,
  width: dim,
  height: z.union([dim, z.literal('auto')]),
  orientation: z.enum(['portrait', 'landscape', 'square']),
  deviceClass: DeviceClassSchema,
  /** Подгруппа для быстрого выбора: «iOS — телефоны» и т.п. */
  set: z.string().optional(),
  /** Safe area экрана приложения (только app-*). */
  safeArea: SafeAreaSchema.optional(),
});
export type SizePreset = z.infer<typeof SizePresetSchema>;

export const PresetCatalogSchema = z.object({
  presets: z.array(SizePresetSchema).min(1),
  sets: z.record(z.string(), z.string()).default({}),
});
export type PresetCatalog = z.infer<typeof PresetCatalogSchema>;

export const GROUP_LABELS: Record<PresetGroup, string> = {
  web: 'Web',
  'app-ios': 'App iOS',
  'app-android': 'App Android',
  'banner-display': 'Баннеры',
  'banner-social': 'Соцсети',
  custom: 'Пользовательские',
};

export function orientationOf(width: number, height: number | 'auto'): SizePreset['orientation'] {
  if (height === 'auto') return 'portrait';
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

type PresetInput = Omit<SizePreset, 'orientation' | 'id'> & { id?: string };

function preset(p: PresetInput): SizePreset {
  return {
    ...p,
    id: p.id ?? `${p.group}:${p.width}x${p.height}`,
    orientation: orientationOf(p.width, p.height),
  };
}

const web = (width: number, deviceClass: DeviceClass): SizePreset =>
  preset({ group: 'web', name: `Web ${width}`, width, height: 'auto', deviceClass });

const ios = (name: string, width: number, height: number, safeArea: SafeArea, deviceClass: DeviceClass, set: string) =>
  preset({ group: 'app-ios', name, width, height, safeArea, deviceClass, set });

const android = (name: string, width: number, height: number, safeArea: SafeArea, deviceClass: DeviceClass, set: string) =>
  preset({ group: 'app-android', name, width, height, safeArea, deviceClass, set });

const display = (width: number, height: number, name = `${width}×${height}`) =>
  preset({ group: 'banner-display', name, width, height, deviceClass: 'banner' });

const social = (name: string, width: number, height: number) =>
  preset({ group: 'banner-social', name, width, height, deviceClass: 'banner' });

const sa = (top: number, bottom: number): SafeArea => ({ top, bottom, left: 0, right: 0 });

/** Каталог по умолчанию. Значения safe area — портретная ориентация. */
export const DEFAULT_PRESETS: SizePreset[] = [
  // Web — брейкпоинты, высота по содержимому
  web(360, 'mobile'),
  web(390, 'mobile'),
  web(768, 'tablet'),
  web(1024, 'tablet'),
  web(1280, 'desktop'),
  web(1440, 'desktop'),
  web(1920, 'desktop'),

  // iOS — телефоны
  ios('iPhone SE', 375, 667, sa(20, 0), 'mobile', 'ios-phones'),
  ios('iPhone 13 mini', 375, 812, sa(50, 34), 'mobile', 'ios-phones'),
  ios('iPhone 16e', 390, 844, sa(47, 34), 'mobile', 'ios-phones'),
  ios('iPhone 16', 393, 852, sa(59, 34), 'mobile', 'ios-phones'),
  ios('iPhone 17 / 17 Pro', 402, 874, sa(62, 34), 'mobile', 'ios-phones'),
  ios('iPhone Air', 420, 912, sa(68, 34), 'mobile', 'ios-phones'),
  ios('iPhone 17 Pro Max', 440, 956, sa(62, 34), 'mobile', 'ios-phones'),
  // iOS — планшеты
  ios('iPad mini', 744, 1133, sa(24, 20), 'tablet', 'ios-tablets'),
  ios('iPad Air 11"', 820, 1180, sa(24, 20), 'tablet', 'ios-tablets'),
  ios('iPad Pro 13"', 1032, 1376, sa(24, 20), 'tablet', 'ios-tablets'),

  // Android — классы окон Material
  android('Android Compact 360', 360, 800, sa(24, 24), 'mobile', 'android-phones'),
  android('Android Compact 412', 412, 917, sa(24, 24), 'mobile', 'android-phones'),
  android('Android Medium (складной)', 700, 840, sa(24, 24), 'tablet', 'android-tablets'),
  android('Android Expanded (планшет)', 800, 1280, sa(24, 24), 'tablet', 'android-tablets'),
  android('Android Expanded (ландшафт)', 1280, 800, sa(24, 24), 'tablet', 'android-tablets'),

  // Дисплейные баннеры (IAB / РСЯ)
  display(300, 250, 'Medium Rectangle 300×250'),
  display(336, 280, 'Large Rectangle 336×280'),
  display(300, 300),
  display(300, 600, 'Half Page 300×600'),
  display(240, 400),
  display(160, 600, 'Skyscraper 160×600'),
  display(728, 90, 'Leaderboard 728×90'),
  display(970, 250, 'Billboard 970×250'),
  display(320, 50, 'Mobile Banner 320×50'),
  display(320, 100, 'Large Mobile Banner 320×100'),

  // Соцсети
  social('Квадрат 1080×1080', 1080, 1080),
  social('Пост 4:5 1080×1350', 1080, 1350),
  social('Сторис/клипы 1080×1920', 1080, 1920),
  social('Превью ссылки 1200×630', 1200, 630),
  social('Обложка 16:9 1920×1080', 1920, 1080),
];

export const DEFAULT_SETS: Record<string, string> = {
  'ios-phones': 'iOS — телефоны',
  'ios-tablets': 'iOS — планшеты',
  'android-phones': 'Android — телефоны',
  'android-tablets': 'Android — планшеты',
};

export const DEFAULT_CATALOG: PresetCatalog = { presets: DEFAULT_PRESETS, sets: DEFAULT_SETS };

export function presetsInGroup(catalog: PresetCatalog, group: PresetGroup): SizePreset[] {
  return catalog.presets.filter((p) => p.group === group);
}

export function presetsInSet(catalog: PresetCatalog, set: string): SizePreset[] {
  return catalog.presets.filter((p) => p.set === set);
}

export type CustomSizeResult = { ok: true; preset: SizePreset } | { ok: false; error: string };

/** Пользовательский размер (spec size-presets → Custom sizes and saved sets). */
export function makeCustomPreset(width: number, height: number, name?: string): CustomSizeResult {
  const valid = (v: number) => Number.isInteger(v) && v >= MIN_SIZE && v <= MAX_SIZE;
  if (!valid(width) || !valid(height)) {
    return { ok: false, error: `Ширина и высота должны быть целыми числами от ${MIN_SIZE} до ${MAX_SIZE}` };
  }
  return {
    ok: true,
    preset: preset({
      group: 'custom',
      name: name ?? `${width}×${height}`,
      width,
      height,
      deviceClass: 'banner',
    }),
  };
}

/** Брейкпоинт из дизайн-системы: имя мода и ширина. */
export interface DsBreakpoint {
  mode: string;
  width: number;
}

/**
 * Если ДС задаёт брейкпоинты, группа web заменяется ими
 * (spec size-presets → Web breakpoint presets).
 */
export function withDsBreakpoints(catalog: PresetCatalog, breakpoints: DsBreakpoint[] | undefined): PresetCatalog {
  if (!breakpoints || breakpoints.length === 0) return catalog;
  const dsWeb = [...breakpoints]
    .sort((a, b) => a.width - b.width)
    .map((bp) =>
      preset({
        group: 'web',
        name: `Web ${bp.mode} ${bp.width}`,
        width: bp.width,
        height: 'auto',
        deviceClass: webDeviceClass(bp.width),
      }),
    );
  return { ...catalog, presets: [...dsWeb, ...catalog.presets.filter((p) => p.group !== 'web')] };
}

export function webDeviceClass(width: number): DeviceClass {
  if (width < 768) return 'mobile';
  if (width < 1280) return 'tablet';
  return 'desktop';
}
