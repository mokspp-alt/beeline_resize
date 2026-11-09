import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DesignSystemConfigSchema, buildDraftConfig, type ScanCollection, type ScanLibrary } from './index.js';

const base = DesignSystemConfigSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, '../../../config/design-system.json'), 'utf8')));

const collections: ScanCollection[] = [
  {
    key: 'col-bp',
    name: 'Breakpoints',
    libraryName: '03_Carnica-sizes',
    modes: ['Mobile', 'Tablet', 'Desktop'],
    variables: [
      { key: 'v-bp', name: 'breakpoint/width', type: 'FLOAT', values: { Mobile: 360, Tablet: 768, Desktop: 1440 } },
      { key: 'v-sp16', name: 'spacing/16', type: 'FLOAT', values: { Mobile: 16 } },
      { key: 'v-sp24', name: 'spacing/24', type: 'FLOAT', values: { Mobile: 24 } },
      { key: 'v-ic24', name: 'icon/size/m', type: 'FLOAT', values: { Mobile: 24 } },
      { key: 'v-ic16', name: 'icon/size/s', type: 'FLOAT', values: { Mobile: 16 } },
    ],
  },
  { key: 'col-pl', name: 'Platform', libraryName: '05_Carnica-UI-kit-APP', modes: ['iOS', 'Android'], variables: [] },
  { key: 'col-other', name: 'Чужая', libraryName: 'Other lib', modes: ['Mobile', 'Desktop'], variables: [] },
];

const scans: ScanLibrary[] = [
  {
    role: 'ui-kit-web',
    name: '06_Carnica-UI-kit-WEB',
    components: [{ key: 'w-btn-l', name: 'Size=L', componentSetKey: 's-w-btn', componentSetName: 'Button' }],
    componentSets: [{ key: 's-w-btn', name: 'Button' }, { key: 's-w-hdr', name: 'Header' }],
    styles: [],
  },
  {
    role: 'ui-kit-app',
    name: '05_Carnica-UI-kit-APP',
    components: [
      { key: 'a-nav-ios', name: 'Platform=iOS', componentSetKey: 's-a-nav', componentSetName: 'NavigationBar' },
      { key: 'a-nav-and', name: 'Platform=Android', componentSetKey: 's-a-nav', componentSetName: 'NavigationBar' },
    ],
    componentSets: [{ key: 's-a-btn', name: 'Button' }, { key: 's-a-nav', name: 'NavigationBar' }],
    styles: [],
  },
  { role: 'typography', name: '02_Carnica-typography', components: [], componentSets: [], styles: [{ key: 'ts-h1', name: 'H1', type: 'TEXT', fontSize: 48 }] },
  { role: 'colors', name: '01_Carnica-colors-2.0', components: [], componentSets: [], styles: [], error: 'нет доступа к файлу «01_Carnica-colors-2.0»: HTTP 403' },
];

describe('5.4 черновик конфигурации Carnica', () => {
  const { config, notes } = buildDraftConfig(base, collections, scans);

  it('проходит схему и сохраняет шесть библиотек', () => {
    expect(DesignSystemConfigSchema.safeParse(config).success).toBe(true);
    expect(Object.keys(config.libraries)).toHaveLength(6);
  });

  it('коллекции брейкпоинтов и платформы, ширины брейкпоинтов', () => {
    expect(config.collections.breakpoint).toMatchObject({ library: 'sizes', key: 'col-bp', modes: { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop' } });
    expect(config.collections.platform).toMatchObject({ library: 'ui-kit-app', key: 'col-pl', modes: { ios: 'iOS', android: 'Android' } });
    expect(config.breakpoints).toEqual([
      { mode: 'Mobile', width: 360 },
      { mode: 'Tablet', width: 768 },
      { mode: 'Desktop', width: 1440 },
    ]);
  });

  it('токены отступов, размеры иконок, текстовые стили, пробные компоненты', () => {
    expect(config.spacingTokens).toEqual({ '16': 'v-sp16', '24': 'v-sp24' });
    expect(config.iconSizes).toEqual([16, 24]);
    expect(config.textStyles).toEqual([{ key: 'ts-h1', name: 'H1', fontSize: 48 }]);
    expect(config.libraries['ui-kit-web']!.probeComponentKey).toBe('w-btn-l');
  });

  it('платформенный вариант и предложенные (неподтверждённые) замены WEB↔APP', () => {
    expect(config.variants).toContainEqual({ library: 'ui-kit-app', componentSet: 'NavigationBar', componentSetKey: 's-a-nav', property: 'Platform', byClass: { ios: 'iOS', android: 'Android' } });
    expect(config.substitutions).toHaveLength(2);
    expect(config.substitutions.every((s) => s.confirmed === false)).toBe(true);
    expect(config.substitutions[0]).toMatchObject({ from: { name: 'Button', key: 's-w-btn' }, to: { key: 's-a-btn' }, when: { mode: 'app' } });
  });

  it('заметки: ошибка доступа и что проверить вручную', () => {
    expect(notes).toContain('нет доступа к файлу «01_Carnica-colors-2.0»: HTTP 403');
    expect(notes.some((n) => n.includes('confirmed: true'))).toBe(true);
  });
});
