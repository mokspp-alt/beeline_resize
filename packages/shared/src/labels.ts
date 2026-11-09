/** Подписи групп — без zod, для бандла main плагина. */
export type PresetGroup = 'web' | 'app-ios' | 'app-android' | 'banner-display' | 'banner-social' | 'custom';

export const GROUP_LABELS: Record<PresetGroup, string> = {
  web: 'Web',
  'app-ios': 'App iOS',
  'app-android': 'App Android',
  'banner-display': 'Баннеры',
  'banner-social': 'Соцсети',
  custom: 'Пользовательские',
};
