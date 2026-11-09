import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATALOG,
  PresetCatalogSchema,
  classify,
  groupByClass,
  makeCustomPreset,
  presetsInGroup,
  presetsInSet,
  withDsBreakpoints,
  type PresetGroup,
} from './index.js';

const sizes = (group: PresetGroup) =>
  presetsInGroup(DEFAULT_CATALOG, group).map((p) => `${p.width}x${p.height}`);

describe('каталог по умолчанию соответствует spec size-presets', () => {
  it('валиден по схеме и id уникальны', () => {
    PresetCatalogSchema.parse(DEFAULT_CATALOG);
    const ids = DEFAULT_CATALOG.presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Web: 360, 390, 768, 1024, 1280, 1440, 1920 × auto', () => {
    expect(sizes('web')).toEqual(['360xauto', '390xauto', '768xauto', '1024xauto', '1280xauto', '1440xauto', '1920xauto']);
  });

  it('iOS — телефоны и планшеты', () => {
    const s = (set: string) => presetsInSet(DEFAULT_CATALOG, set).map((p) => `${p.width}x${p.height}`);
    expect(s('ios-phones')).toEqual(['375x667', '375x812', '390x844', '393x852', '402x874', '420x912', '440x956']);
    expect(s('ios-tablets')).toEqual(['744x1133', '820x1180', '1032x1376']);
    expect(sizes('app-ios')).toHaveLength(10);
  });

  it('Android', () => {
    expect(sizes('app-android')).toEqual(['360x800', '412x917', '700x840', '800x1280', '1280x800']);
    expect(presetsInSet(DEFAULT_CATALOG, 'android-phones').map((p) => `${p.width}x${p.height}`)).toEqual([
      '360x800',
      '412x917',
    ]);
  });

  it('Баннеры: 10 дисплейных форматов', () => {
    expect(sizes('banner-display')).toEqual([
      '300x250',
      '336x280',
      '300x300',
      '300x600',
      '240x400',
      '160x600',
      '728x90',
      '970x250',
      '320x50',
      '320x100',
    ]);
  });

  it('Соцсети', () => {
    expect(sizes('banner-social')).toEqual(['1080x1080', '1080x1350', '1080x1920', '1200x630', '1920x1080']);
    const stories = presetsInGroup(DEFAULT_CATALOG, 'banner-social').find((p) => p.height === 1920)!;
    expect(stories.orientation).toBe('portrait');
    expect(stories.deviceClass).toBe('banner');
  });

  it('у всех экранов App есть safe area', () => {
    for (const p of DEFAULT_CATALOG.presets.filter((p) => p.group.startsWith('app-'))) {
      expect(p.safeArea, p.name).toBeDefined();
    }
  });
});

describe('пользовательские размеры', () => {
  it('добавляет 1000×120', () => {
    const r = makeCustomPreset(1000, 120);
    expect(r.ok && r.preset.group).toBe('custom');
  });

  it('отклоняет 0×120 и 10000×120', () => {
    expect(makeCustomPreset(0, 120).ok).toBe(false);
    expect(makeCustomPreset(10000, 120).ok).toBe(false);
  });
});

describe('брейкпоинты из дизайн-системы', () => {
  it('заменяют группу web', () => {
    const c = withDsBreakpoints(DEFAULT_CATALOG, [
      { mode: 'Desktop', width: 1440 },
      { mode: 'Mobile', width: 360 },
      { mode: 'Tablet', width: 768 },
    ]);
    expect(presetsInGroup(c, 'web').map((p) => `${p.width}x${p.height}`)).toEqual(['360xauto', '768xauto', '1440xauto']);
    expect(presetsInGroup(c, 'banner-display')).toHaveLength(10);
  });

  it('без брейкпоинтов каталог не меняется', () => {
    expect(withDsBreakpoints(DEFAULT_CATALOG, [])).toBe(DEFAULT_CATALOG);
  });
});

describe('классификация', () => {
  const find = (id: string) => DEFAULT_CATALOG.presets.find((p) => p.id === id)!;

  it('300×250 и 336×280 попадают в один класс', () => {
    expect(classify(find('banner-display:300x250')).sizeClass).toBe(classify(find('banner-display:336x280')).sizeClass);
  });

  it('смешанный запуск: web, app, banner', () => {
    expect(classify(find('web:1280xauto'))).toEqual({ mode: 'web', sizeClass: 'web:desktop' });
    expect(classify(find('app-ios:393x852'))).toEqual({ mode: 'app', sizeClass: 'app:ios-phone' });
    expect(classify(find('banner-display:300x250')).mode).toBe('banner');
  });

  it('ручное переопределение режима', () => {
    expect(classify(find('banner-social:1080x1920'), 'app').mode).toBe('app');
  });

  it('пропорции баннеров', () => {
    expect(classify(find('banner-display:728x90')).sizeClass).toBe('banner:strip');
    expect(classify(find('banner-display:160x600')).sizeClass).toBe('banner:tall');
    expect(classify(find('banner-display:300x600')).sizeClass).toBe('banner:portrait');
    expect(classify(find('banner-social:1920x1080')).sizeClass).toBe('banner:landscape');
    expect(classify(find('banner-social:1080x1080')).sizeClass).toBe('banner:square');
  });

  it('полный каталог даёт заметно меньше классов, чем размеров', () => {
    const classes = groupByClass(DEFAULT_CATALOG.presets);
    expect(classes.size).toBeLessThan(DEFAULT_CATALOG.presets.length / 2);
  });
});
