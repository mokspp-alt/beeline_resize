import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CATALOG,
  DesignSystemConfigSchema,
  PresetCatalogSchema,
  withDsBreakpoints,
  type DesignSystemConfig,
  type PresetCatalog,
} from '@beeline-resize/shared';

/** Каталог config/: CONFIG_DIR, ./config или ../../config (запуск из packages/backend). */
export function resolveConfigDir(explicit?: string): string {
  const candidates = [explicit, process.env.CONFIG_DIR, path.resolve('config'), path.resolve('../../config')].filter(
    (p): p is string => Boolean(p),
  );
  return candidates.find((p) => existsSync(p)) ?? candidates[0] ?? path.resolve('config');
}

interface Cached<T> {
  mtimeMs: number;
  value: T;
}

/**
 * Читает JSON-файл конфигурации с проверкой схемы. Перечитывает файл при изменении mtime,
 * поэтому правки командного каталога видны без пересборки и перезапуска (spec size-presets → Team catalog override).
 */
export class ConfigStore {
  private cache = new Map<string, Cached<unknown>>();

  constructor(readonly dir: string) {}

  private async readJson<T>(file: string, parse: (raw: unknown) => T): Promise<T | undefined> {
    const full = path.join(this.dir, file);
    let st;
    try {
      st = await stat(full);
    } catch {
      return undefined;
    }
    const hit = this.cache.get(full);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.value as T;
    const value = parse(JSON.parse(await readFile(full, 'utf8')));
    this.cache.set(full, { mtimeMs: st.mtimeMs, value });
    return value;
  }

  async designSystem(): Promise<DesignSystemConfig | undefined> {
    return this.readJson('design-system.json', (raw) => DesignSystemConfigSchema.parse(raw));
  }

  /** Командный каталог (config/presets.json) или каталог по умолчанию, с брейкпоинтами ДС. */
  async catalog(): Promise<PresetCatalog> {
    const team = await this.readJson('presets.json', (raw) => PresetCatalogSchema.parse(raw));
    const ds = await this.designSystem();
    return withDsBreakpoints(team ?? DEFAULT_CATALOG, ds?.breakpoints);
  }
}
