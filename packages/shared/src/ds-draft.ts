import { DesignSystemConfigSchema, type DesignSystemConfig, type LibraryRole, type MatchKey } from './ds-config.js';

/**
 * Черновик config/design-system.json по результатам скана (spec design-system-integration →
 * «Автообнаружение для черновой конфигурации»). Администратор проверяет и сохраняет его вручную.
 */

/** Результат REST-скана библиотеки (бэкенд, POST /ds/scan). */
export interface ScanLibrary {
  role: LibraryRole;
  name: string;
  components: Array<{ key: string; name: string; componentSetKey?: string; componentSetName?: string }>;
  componentSets: Array<{ key: string; name: string }>;
  styles: Array<{ key: string; name: string; type: string; fontSize?: number; fontFamily?: string }>;
  error?: string;
}

/** Коллекция переменных библиотеки (плагин, figma.teamLibrary). */
export interface ScanCollection {
  key: string;
  name: string;
  libraryName: string;
  modes: string[];
  variables: Array<{ key: string; name: string; type: string; values: Record<string, unknown> }>;
}

export interface DraftResult {
  config: DesignSystemConfig;
  notes: string[];
}

const DEVICE_RX: Array<[MatchKey, RegExp]> = [
  ['mobile', /(mob|phone|xs\b|sm\b|\b3[6-9]\d\b)/i],
  ['tablet', /(tab|md\b|\b768\b|\b1024\b)/i],
  ['desktop', /(desk|lg\b|xl\b|\b1280\b|\b1440\b|\b1920\b)/i],
];
const PLATFORM_RX: Array<[MatchKey, RegExp]> = [
  ['ios', /ios/i],
  ['android', /android/i],
  ['web', /web/i],
];

function matchModes(modes: string[], rules: Array<[MatchKey, RegExp]>): Partial<Record<MatchKey, string>> {
  const out: Partial<Record<MatchKey, string>> = {};
  for (const [k, rx] of rules) {
    const m = modes.find((x) => rx.test(x));
    if (m) out[k] = m;
  }
  return out;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Свойства вариантов из имён компонентов: «Platform=iOS, Size=M». */
function variantValues(components: ScanLibrary['components'], setName: string): Record<string, Set<string>> {
  const props: Record<string, Set<string>> = {};
  for (const c of components.filter((x) => x.componentSetName === setName)) {
    for (const part of c.name.split(',')) {
      const [k, v] = part.split('=').map((s) => s.trim());
      if (k && v) (props[k] ??= new Set()).add(v);
    }
  }
  return props;
}

export function buildDraftConfig(base: DesignSystemConfig, collections: ScanCollection[], scans: ScanLibrary[]): DraftResult {
  const notes: string[] = [];
  const roleByName = new Map(Object.entries(base.libraries).map(([role, l]) => [l!.name, role as LibraryRole]));
  const scan = (role: LibraryRole) => scans.find((s) => s.role === role);
  for (const s of scans) if (s.error) notes.push(s.error);

  // Библиотеки + пробный компонент для проверки доступности
  const libraries = { ...base.libraries };
  for (const [role, lib] of Object.entries(libraries) as Array<[LibraryRole, NonNullable<DesignSystemConfig['libraries'][LibraryRole]>]>) {
    const probe = scan(role)?.components[0]?.key;
    libraries[role] = { ...lib, ...(probe ? { probeComponentKey: probe } : {}) };
  }

  // Коллекции: брейкпоинты и платформа по именам модов
  const collectionsCfg: DesignSystemConfig['collections'] = {};
  let breakpoints: DesignSystemConfig['breakpoints'];
  for (const c of collections) {
    const role = roleByName.get(c.libraryName);
    if (!role) continue;
    const device = matchModes(c.modes, DEVICE_RX);
    const platform = matchModes(c.modes, PLATFORM_RX);
    if (!collectionsCfg.breakpoint && Object.keys(device).length >= 2) {
      collectionsCfg.breakpoint = { library: role, key: c.key, name: c.name, modes: device };
      const widthVar = c.variables.find((v) => v.type === 'FLOAT' && /(breakpoint|screen|viewport|width|ширин)/i.test(v.name));
      if (widthVar) {
        breakpoints = c.modes
          .map((mode) => ({ mode, width: num(widthVar.values[mode]) }))
          .filter((b): b is { mode: string; width: number } => b.width !== undefined && b.width > 0)
          .map((b) => ({ mode: b.mode, width: Math.round(b.width) }));
      } else {
        notes.push(`брейкпоинты «${c.name}»: не найдена переменная ширины — группа Web останется по умолчанию`);
      }
    } else if (!collectionsCfg.platform && Object.keys(platform).length >= 2) {
      collectionsCfg.platform = { library: role, key: c.key, name: c.name, modes: platform };
    }
  }
  if (!collectionsCfg.breakpoint) notes.push('коллекция с модами брейкпоинтов не найдена');
  if (!collectionsCfg.platform) notes.push('коллекция с модами платформ (iOS/Android/Web) не найдена');

  // Токены отступов и размеров иконок из sizes
  const sizesName = base.libraries.sizes?.name;
  const sizeVars = collections.filter((c) => c.libraryName === sizesName).flatMap((c) => c.variables.map((v) => ({ v, mode: c.modes[0]! })));
  const spacingTokens: Record<string, string> = {};
  const iconSizes = new Set<number>();
  for (const { v, mode } of sizeVars) {
    if (v.type !== 'FLOAT') continue;
    const value = num(v.values[mode]);
    if (value === undefined) continue;
    if (/(spac|gap|padding|indent|отступ)/i.test(v.name) && !(String(value) in spacingTokens)) spacingTokens[String(value)] = v.key;
    if (/icon/i.test(v.name) && /size|размер/i.test(v.name)) iconSizes.add(value);
  }

  // Текстовые стили typography
  const textStyles = (scan('typography')?.styles ?? [])
    .filter((s) => s.type === 'TEXT' && s.fontSize)
    .map((s) => ({ key: s.key, name: s.name, fontSize: s.fontSize!, ...(s.fontFamily ? { fontFamily: s.fontFamily } : {}) }));

  // Платформенные варианты (Platform=iOS/Android) и замены WEB↔APP по совпадающим именам
  const variants: DesignSystemConfig['variants'] = [];
  const substitutions: DesignSystemConfig['substitutions'] = [];
  const web = scan('ui-kit-web');
  const app = scan('ui-kit-app');
  for (const kit of [web, app]) {
    if (!kit) continue;
    for (const set of kit.componentSets) {
      const props = variantValues(kit.components, set.name);
      const platformProp = Object.keys(props).find((p) => /^platform$|^платформа$/i.test(p));
      if (platformProp) {
        const byClass = matchModes([...props[platformProp]!], PLATFORM_RX);
        if (byClass.ios || byClass.android) {
          variants.push({ library: kit.role as 'ui-kit-web' | 'ui-kit-app', componentSet: set.name, componentSetKey: set.key, property: platformProp, byClass });
        }
      }
    }
  }
  if (web && app) {
    const appSets = new Map(app.componentSets.map((s) => [s.name, s]));
    for (const ws of web.componentSets) {
      const as = appSets.get(ws.name);
      if (!as) continue;
      substitutions.push(
        { from: { library: 'ui-kit-web', name: ws.name, key: ws.key }, to: { library: 'ui-kit-app', name: as.name, key: as.key }, when: { mode: 'app' }, confirmed: false },
        { from: { library: 'ui-kit-app', name: as.name, key: as.key }, to: { library: 'ui-kit-web', name: ws.name, key: ws.key }, when: { mode: 'web' }, confirmed: false },
      );
    }
    if (substitutions.length > 0) notes.push(`предложено замен WEB↔APP: ${substitutions.length} — проверьте и поставьте confirmed: true`);
  }
  notes.push('правила размеров компонентов (например, Size по брейкпоинту) задайте вручную в variants');

  const config = DesignSystemConfigSchema.parse({
    ...base,
    libraries,
    collections: collectionsCfg,
    ...(breakpoints && breakpoints.length > 0 ? { breakpoints } : {}),
    variants: [...base.variants, ...variants],
    substitutions: [...base.substitutions, ...substitutions],
    ...(Object.keys(spacingTokens).length ? { spacingTokens } : {}),
    ...(iconSizes.size ? { iconSizes: [...iconSizes].sort((a, b) => a - b) } : {}),
    ...(textStyles.length ? { textStyles } : {}),
  });
  return { config, notes };
}
