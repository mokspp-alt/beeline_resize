import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATALOG,
  DesignSystemConfigSchema,
  nearestInScale,
  resolveDsOperations,
  resolveVariableModes,
  tokenFor,
  type DesignNode,
  type DesignSystemConfig,
} from './index.js';

const preset = (id: string) => DEFAULT_CATALOG.presets.find((p) => p.id === id)!;

const ds: DesignSystemConfig = DesignSystemConfigSchema.parse({
  designSystem: 'Carnica',
  libraries: {
    'ui-kit-web': { name: '06_Carnica-UI-kit-WEB', fileKey: 'et3X0ja6o9iITvuJZA1k5C' },
    'ui-kit-app': { name: '05_Carnica-UI-kit-APP', fileKey: 'jiVAy6oXsM7sxlhYetiZ50' },
    sizes: { name: '03_Carnica-sizes', fileKey: '9xzHSCOejO5SJmdkLNJX0W' },
  },
  kitByMode: { web: 'ui-kit-web', app: 'ui-kit-app', banner: 'ui-kit-web' },
  collections: {
    breakpoint: { library: 'sizes', key: 'col-bp', modes: { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop' } },
    platform: { library: 'sizes', key: 'col-platform', modes: { web: 'Web', ios: 'iOS', android: 'Android' } },
  },
  variants: [
    { library: 'ui-kit-web', componentSet: 'Button', property: 'Size', byClass: { mobile: 'M', desktop: 'L' } },
    { library: 'ui-kit-app', componentSet: 'NavigationBar', property: 'Platform', byClass: { ios: 'iOS', android: 'Android' } },
  ],
  substitutions: [
    { from: { library: 'ui-kit-web', name: 'Header/Desktop' }, to: { library: 'ui-kit-web', name: 'Header/Mobile', key: 'k-header-mobile' }, when: { mode: 'web', deviceClass: ['mobile'] } },
    { from: { library: 'ui-kit-web', name: 'Button' }, to: { library: 'ui-kit-app', name: 'Button', key: 'k-app-button' }, when: { mode: 'app' } },
  ],
  minFontSize: { web: 12, app: 12, banner: 10 },
  spacingTokens: { '16': 'var-spacing-16' },
});

const inst = (id: string, set: string, lib: string, variantProps: Record<string, string>): DesignNode => ({
  id,
  name: set,
  type: 'INSTANCE',
  visible: true,
  bbox: { x: 0, y: 0, width: 100, height: 40 },
  component: { key: `k-${id}`, name: set, componentSetName: set, libraryName: lib, isRemote: true, variantProps, componentProps: {}, overriddenNodeIds: [] },
});

const root = (children: DesignNode[]): DesignNode => ({ id: 'r', name: 'r', type: 'FRAME', visible: true, bbox: { x: 0, y: 0, width: 1440, height: 900 }, children });

describe('моды переменных', () => {
  it('Web-брейкпоинт: 360 → Mobile, платформа Web', () => {
    expect(resolveVariableModes(ds, { preset: preset('web:360xauto'), mode: 'web' })).toEqual({ 'col-bp': 'Mobile', 'col-platform': 'Web' });
  });
  it('Платформа App: Android', () => {
    expect(resolveVariableModes(ds, { preset: preset('app-android:412x917'), mode: 'app' })['col-platform']).toBe('Android');
  });
  it('без конфигурации ДС — пусто', () => {
    expect(resolveVariableModes(undefined, { preset: preset('web:360xauto'), mode: 'web' })).toEqual({});
  });
});

describe('варианты и замены компонентов', () => {
  it('Размер кнопки: L → M на мобильном', () => {
    const r = resolveDsOperations(root([inst('b', 'Button', '06_Carnica-UI-kit-WEB', { Size: 'L' })]), ds, { preset: preset('web:360xauto'), mode: 'web' });
    expect(r.operations).toEqual([{ op: 'swapVariant', nodeId: 'b', props: { Size: 'M' } }]);
  });

  it('вариант уже нужный — операции нет', () => {
    const r = resolveDsOperations(root([inst('b', 'Button', '06_Carnica-UI-kit-WEB', { Size: 'L' })]), ds, { preset: preset('web:1440xauto'), mode: 'web' });
    expect(r.operations).toEqual([]);
  });

  it('Платформенный компонент: NavigationBar iOS → Android', () => {
    const r = resolveDsOperations(root([inst('nav', 'NavigationBar', '05_Carnica-UI-kit-APP', { Platform: 'iOS' })]), ds, { preset: preset('app-android:360x800'), mode: 'app' });
    expect(r.operations).toEqual([{ op: 'swapVariant', nodeId: 'nav', props: { Platform: 'Android' } }]);
  });

  it('Хедер сайта: Header/Desktop → Header/Mobile', () => {
    const r = resolveDsOperations(root([inst('h', 'Header/Desktop', '06_Carnica-UI-kit-WEB', {})]), ds, { preset: preset('web:360xauto'), mode: 'web' });
    expect(r.operations).toEqual([{ op: 'swapComponent', nodeId: 'h', componentKey: 'k-header-mobile' }]);
  });

  it('Web-исходник в App-размер: кнопка из UI-kit WEB → кнопка UI-kit APP', () => {
    const r = resolveDsOperations(root([inst('b', 'Button', '06_Carnica-UI-kit-WEB', { Size: 'L' })]), ds, { preset: preset('app-ios:393x852'), mode: 'app' });
    expect(r.operations).toEqual([{ op: 'swapComponent', nodeId: 'b', componentKey: 'k-app-button' }]);
    expect(r.report).toEqual([]);
  });

  it('Нет соответствия между китами → «нет App-аналога» в отчёте, компонент остаётся', () => {
    const r = resolveDsOperations(root([inst('c', 'PromoCard', '06_Carnica-UI-kit-WEB', {})]), ds, { preset: preset('app-ios:393x852'), mode: 'app' });
    expect(r.operations).toEqual([]);
    expect(r.report).toEqual([{ targetId: 'app-ios:393x852', kind: 'no-app-analog', nodeId: 'c', message: 'нет App-аналога для PromoCard' }]);
  });

  it('неподтверждённая (предложенная сканом) замена не применяется', () => {
    const draft = { ...ds, substitutions: ds.substitutions.map((s) => ({ ...s, confirmed: false })) };
    const r = resolveDsOperations(root([inst('h', 'Header/Desktop', '06_Carnica-UI-kit-WEB', {})]), draft, { preset: preset('web:360xauto'), mode: 'web' });
    expect(r.operations.filter((o) => o.op === 'swapComponent')).toEqual([]);
  });
});

describe('токены', () => {
  it('Отступ из токена: 16 → spacing/16', () => {
    expect(tokenFor(ds, 'itemSpacing', 16, 'n', 't').op).toEqual({ op: 'bindVariable', nodeId: 'n', field: 'itemSpacing', variableKey: 'var-spacing-16' });
  });
  it('Отсутствующий токен → отклонение в отчёте', () => {
    expect(tokenFor(ds, 'fontSize', 13, 'n', 't').report).toEqual({ targetId: 't', kind: 'no-token', nodeId: 'n', message: 'нет токена для fontSize 13' });
  });
  it('Иконка в мобильном размере: только размеры из токенов', () => {
    expect(nearestInScale(28, [16, 24, 32], 'down')).toBe(24);
    expect(nearestInScale(12, [16, 24, 32], 'down')).toBe(16);
    expect(nearestInScale(30, [16, 24, 32])).toBe(32);
  });
});
