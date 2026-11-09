import type { DesignNode } from './ir.js';
import type { DesignSystemConfig, LibraryRole, MatchKey, Substitution, VariantRule } from './ds-config.js';
import type { AdaptationMode, Operation, ReportItem } from './plan.js';
import type { SizePreset } from './presets.js';
import { appPlatform, modeForPreset } from './classify.js';
import { walk } from './tree.js';

/**
 * Правила дизайн-системы для целевого размера (spec design-system-integration).
 * Чистые функции: бэкенд строит по ним операции плана, плагин их применяет.
 */

export interface TargetContext {
  preset: Pick<SizePreset, 'id' | 'group' | 'width' | 'height' | 'deviceClass'>;
  mode: AdaptationMode;
}

export function platformOf(t: TargetContext): 'web' | 'ios' | 'android' {
  return appPlatform(t.preset) ?? 'web';
}

/** Ключи соответствия в порядке приоритета: платформа, класс устройства, default. */
export function matchKeys(t: TargetContext): MatchKey[] {
  return [platformOf(t), t.preset.deviceClass, 'default'];
}

function pick<T>(map: Partial<Record<MatchKey, T>>, keys: MatchKey[]): T | undefined {
  for (const k of keys) if (map[k] !== undefined) return map[k];
  return undefined;
}

/** Явные моды коллекций переменных: { collectionKey: modeName } (Variable mode switching). */
export function resolveVariableModes(ds: DesignSystemConfig | undefined, t: TargetContext): Record<string, string> {
  const out: Record<string, string> = {};
  if (!ds) return out;
  for (const [purpose, c] of Object.entries(ds.collections)) {
    // коллекция брейкпоинтов реагирует на класс устройства, платформы — на платформу
    const keys: MatchKey[] =
      purpose === 'platform' ? [platformOf(t), 'default'] : purpose === 'breakpoint' ? [t.preset.deviceClass, 'default'] : matchKeys(t);
    const mode = pick(c.modes, keys);
    if (mode) out[c.key] = mode;
  }
  return out;
}

function ruleMatches(rule: VariantRule, ds: DesignSystemConfig, n: DesignNode): boolean {
  const c = n.component;
  if (!c) return false;
  if (rule.componentSetKey && c.componentSetKey) return rule.componentSetKey === c.componentSetKey;
  if ((c.componentSetName ?? c.name) !== rule.componentSet) return false;
  const lib = ds.libraries[rule.library];
  return !c.libraryName || !lib || c.libraryName === lib.name;
}

function substitutionMatches(s: Substitution, ds: DesignSystemConfig, n: DesignNode, t: TargetContext): boolean {
  const c = n.component;
  if (!c) return false;
  if (s.confirmed === false) return false;
  const name = c.componentSetName ?? c.name;
  const key = c.componentSetKey ?? c.key;
  const sameComponent = s.from.key ? s.from.key === key || s.from.key === c.key : s.from.name === name;
  if (!sameComponent) return false;
  const lib = ds.libraries[s.from.library as LibraryRole];
  if (c.libraryName && lib && c.libraryName !== lib.name) return false;
  if (s.when.mode && s.when.mode !== t.mode) return false;
  if (s.when.platform && s.when.platform !== platformOf(t)) return false;
  if (s.when.deviceClass && !s.when.deviceClass.includes(t.preset.deviceClass)) return false;
  return true;
}

/** Библиотека UI-kit, из которой должен быть компонент для режима (Platform UI kit selection). */
export function kitForMode(ds: DesignSystemConfig, mode: AdaptationMode): LibraryRole {
  return ds.kitByMode[mode];
}

export interface DsOperations {
  variableModes: Record<string, string>;
  operations: Operation[];
  report: ReportItem[];
}

/**
 * Операции ДС для размера: переключение вариантов, замены компонентов (в т.ч. WEB↔APP),
 * отчёт о компонентах без аналога в ките платформы.
 */
export function resolveDsOperations(root: DesignNode, ds: DesignSystemConfig | undefined, t: TargetContext): DsOperations {
  const result: DsOperations = { variableModes: resolveVariableModes(ds, t), operations: [], report: [] };
  if (!ds) return result;
  const keys = matchKeys(t);
  const targetKit = ds.libraries[kitForMode(ds, t.mode)];

  walk(root, (n) => {
    if (n.type !== 'INSTANCE' || !n.component) return;

    const sub = ds.substitutions.find((s) => substitutionMatches(s, ds, n, t));
    if (sub) {
      if (sub.to.key) {
        result.operations.push({ op: 'swapComponent', nodeId: n.id, componentKey: sub.to.key });
      } else {
        result.report.push({
          targetId: t.preset.id,
          kind: 'warning',
          nodeId: n.id,
          message: `замена «${sub.from.name}» → «${sub.to.name}» без ключа компонента: запустите скан дизайн-системы`,
        });
      }
      return;
    }

    // Компонент из кита другой платформы без настроенной замены
    const lib = n.component.libraryName;
    const otherKit = Object.entries(ds.libraries).find(
      ([role, l]) => (role === 'ui-kit-web' || role === 'ui-kit-app') && l && l.name === lib && l.name !== targetKit?.name,
    );
    if (otherKit && targetKit && t.mode !== 'banner') {
      const name = n.component.componentSetName ?? n.component.name;
      result.report.push({
        targetId: t.preset.id,
        kind: 'no-app-analog',
        nodeId: n.id,
        message: t.mode === 'app' ? `нет App-аналога для ${name}` : `нет Web-аналога для ${name}`,
      });
    }

    const props: Record<string, string> = {};
    for (const rule of ds.variants) {
      if (!ruleMatches(rule, ds, n)) continue;
      const value = pick(rule.byClass, keys);
      if (value && n.component.variantProps[rule.property] !== value) props[rule.property] = value;
    }
    if (Object.keys(props).length > 0) result.operations.push({ op: 'swapVariant', nodeId: n.id, props });
  });
  return result;
}

/** Ближайшее значение из шкалы (размеры иконок, отступы). */
export function nearestInScale(value: number, scale: readonly number[], prefer: 'down' | 'nearest' = 'nearest'): number | undefined {
  if (scale.length === 0) return undefined;
  const sorted = [...scale].sort((a, b) => a - b);
  if (prefer === 'down') {
    const lower = sorted.filter((s) => s <= value);
    return lower.length > 0 ? lower[lower.length - 1] : sorted[0];
  }
  return sorted.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best), sorted[0]!);
}

/**
 * Привязка нового значения к токену (Design system compliance): если в шкале токенов
 * есть точное значение — bindVariable, иначе отклонение «нет токена».
 */
export function tokenFor(
  ds: DesignSystemConfig | undefined,
  field: string,
  value: number,
  nodeId: string,
  targetId: string,
): { op?: Operation; report?: ReportItem } {
  const key = ds?.spacingTokens?.[String(value)];
  if (key) return { op: { op: 'bindVariable', nodeId, field, variableKey: key } };
  return { report: { targetId, kind: 'no-token', nodeId, message: `нет токена для ${field} ${value}` } };
}

export { modeForPreset };

/** Текстовый стиль ДС с тем же кеглем (и семейством, если известно). */
export function textStyleFor(ds: DesignSystemConfig | undefined, fontSize: number, family?: string) {
  const styles = ds?.textStyles ?? [];
  return (
    styles.find((s) => s.fontSize === fontSize && (!family || !s.fontFamily || s.fontFamily === family)) ??
    styles.find((s) => s.fontSize === fontSize)
  );
}
