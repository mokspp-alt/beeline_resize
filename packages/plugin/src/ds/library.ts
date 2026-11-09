import type { DesignSystemConfig, LibraryRole } from '@beeline-resize/shared';

/**
 * Библиотеки Carnica в текущем файле (spec design-system-integration → Carnica library set).
 * Plugin API не даёт список включённых библиотек напрямую, поэтому:
 * - библиотеки с переменными видны через teamLibrary (по libraryName);
 * - для китов и иконок проверяется импорт «пробного» компонента из скана.
 */

export interface LibraryDeps {
  availableCollections(): Promise<Array<{ key: string; name: string; libraryName: string }>>;
  probeComponent(key: string): Promise<boolean>;
}

export type LibraryState = 'enabled' | 'missing' | 'unknown';

export interface LibraryStatus {
  role: LibraryRole;
  name: string;
  state: LibraryState;
}

const TOKEN_ROLES: LibraryRole[] = ['colors', 'typography', 'sizes'];

export async function libraryStatus(ds: DesignSystemConfig, deps: LibraryDeps): Promise<LibraryStatus[]> {
  let collections: Array<{ libraryName: string }> = [];
  try {
    collections = await deps.availableCollections();
  } catch {
    collections = [];
  }
  const withVars = new Set(collections.map((c) => c.libraryName));
  const out: LibraryStatus[] = [];
  for (const [role, lib] of Object.entries(ds.libraries) as Array<[LibraryRole, NonNullable<DesignSystemConfig['libraries'][LibraryRole]>]>) {
    let state: LibraryState = 'unknown';
    if (withVars.has(lib.name)) state = 'enabled';
    else if (lib.probeComponentKey) state = (await deps.probeComponent(lib.probeComponentKey).catch(() => false)) ? 'enabled' : 'missing';
    else if (TOKEN_ROLES.includes(role)) state = 'missing';
    out.push({ role, name: lib.name, state });
  }
  return out;
}

export interface DsSummary {
  connected: boolean;
  message: string;
  /** Адаптация под Web/App без вариантов и замен из-за отсутствующего кита. */
  missingKits: Array<'web' | 'app'>;
  /** Не включена ни одна библиотека токенов — нужно подтверждение. */
  tokensMissing: boolean;
}

export function summarize(statuses: LibraryStatus[]): DsSummary {
  const missing = statuses.filter((s) => s.state === 'missing');
  const missingKits: Array<'web' | 'app'> = [];
  if (missing.some((s) => s.role === 'ui-kit-web')) missingKits.push('web');
  if (missing.some((s) => s.role === 'ui-kit-app')) missingKits.push('app');
  const tokens = statuses.filter((s) => TOKEN_ROLES.includes(s.role));
  const tokensMissing = tokens.length > 0 && tokens.every((s) => s.state === 'missing');
  const connected = statuses.length > 0 && statuses.every((s) => s.state === 'enabled');
  return {
    connected,
    missingKits,
    tokensMissing,
    message: connected
      ? 'Carnica подключена'
      : missing.length > 0
        ? `Не включены: ${missing.map((m) => m.name).join(', ')} — Assets → Libraries`
        : 'Статус части библиотек неизвестен — запустите скан дизайн-системы',
  };
}
