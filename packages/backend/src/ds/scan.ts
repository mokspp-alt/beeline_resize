import type { DesignSystemConfig, LibraryRole } from '@beeline-resize/shared';
import type { FetchLike } from '../llm/types.js';

/**
 * Скан библиотек Carnica через Figma REST API (design D5): компоненты, наборы вариантов, стили.
 * Переменные REST отдаёт только на Enterprise — их сканирует плагин.
 */

export interface ScannedComponent {
  key: string;
  name: string;
  componentSetKey?: string;
  componentSetName?: string;
}

export interface ScannedStyle {
  key: string;
  name: string;
  type: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
  fontSize?: number;
  fontFamily?: string;
}

export interface LibraryScan {
  role: LibraryRole;
  name: string;
  fileKey: string;
  components: ScannedComponent[];
  componentSets: Array<{ key: string; name: string }>;
  styles: ScannedStyle[];
  error?: string;
}

export const FIGMA_API = 'https://api.figma.com';

class FigmaHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function get<T>(f: FetchLike, token: string, path: string): Promise<T> {
  const res = await f(`${FIGMA_API}${path}`, { headers: { 'x-figma-token': token } });
  if (!res.ok) throw new FigmaHttpError(res.status);
  return (await res.json()) as T;
}

interface RestComponent {
  key: string;
  name: string;
  node_id: string;
  containing_frame?: { containingStateGroup?: { name: string; nodeId: string } };
}

export async function scanLibrary(role: LibraryRole, lib: { name: string; fileKey: string }, token: string, f: FetchLike = fetch): Promise<LibraryScan> {
  const out: LibraryScan = { role, name: lib.name, fileKey: lib.fileKey, components: [], componentSets: [], styles: [] };
  try {
    const sets = await get<{ meta: { component_sets: Array<{ key: string; name: string; node_id: string }> } }>(f, token, `/v1/files/${lib.fileKey}/component_sets`);
    const setByNode = new Map(sets.meta.component_sets.map((s) => [s.node_id, s]));
    out.componentSets = sets.meta.component_sets.map((s) => ({ key: s.key, name: s.name }));

    const comps = await get<{ meta: { components: RestComponent[] } }>(f, token, `/v1/files/${lib.fileKey}/components`);
    out.components = comps.meta.components.map((c) => {
      const group = c.containing_frame?.containingStateGroup;
      const set = group ? setByNode.get(group.nodeId) : undefined;
      return {
        key: c.key,
        name: c.name,
        ...(set ? { componentSetKey: set.key, componentSetName: set.name } : group ? { componentSetName: group.name } : {}),
      };
    });

    const styles = await get<{ meta: { styles: Array<{ key: string; name: string; style_type: ScannedStyle['type']; node_id: string }> } }>(
      f,
      token,
      `/v1/files/${lib.fileKey}/styles`,
    );
    out.styles = styles.meta.styles.map((s) => ({ key: s.key, name: s.name, type: s.style_type }));

    // Кегль текстовых стилей — из узлов стилей
    const text = styles.meta.styles.filter((s) => s.style_type === 'TEXT');
    for (let i = 0; i < text.length; i += 50) {
      const batch = text.slice(i, i + 50);
      const nodes = await get<{ nodes: Record<string, { document?: { style?: { fontSize?: number; fontFamily?: string } } } | null> }>(
        f,
        token,
        `/v1/files/${lib.fileKey}/nodes?ids=${encodeURIComponent(batch.map((s) => s.node_id).join(','))}`,
      );
      for (const s of batch) {
        const st = nodes.nodes[s.node_id]?.document?.style;
        const target = out.styles.find((x) => x.key === s.key);
        if (target && st?.fontSize) {
          target.fontSize = st.fontSize;
          if (st.fontFamily) target.fontFamily = st.fontFamily;
        }
      }
    }
  } catch (e) {
    out.error =
      e instanceof FigmaHttpError
        ? e.status === 403 || e.status === 404
          ? `нет доступа к файлу «${lib.name}»: HTTP ${e.status}`
          : `ошибка Figma API для «${lib.name}»: HTTP ${e.status}`
        : `ошибка скана «${lib.name}»: ${e instanceof Error ? e.message : String(e)}`;
  }
  return out;
}

export async function scanLibraries(ds: DesignSystemConfig, token: string, f: FetchLike = fetch): Promise<LibraryScan[]> {
  const entries = Object.entries(ds.libraries) as Array<[LibraryRole, { name: string; fileKey: string }]>;
  return Promise.all(entries.map(([role, lib]) => scanLibrary(role, lib, token, f)));
}
