import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { buildApp } from '../app.js';
import { settingsFromEnv } from '../settings.js';
import type { FetchLike } from '../llm/types.js';
import type { LibraryScan } from './scan.js';

const CONFIG = path.resolve(__dirname, '../../../../config');

/** Записанные ответы Figma REST API: UI-kit WEB/APP и typography; colors — 403. */
const figma: FetchLike = async (input, init) => {
  const url = String(input);
  const headers = new Headers(init?.headers as HeadersInit);
  if (headers.get('x-figma-token') !== 'figd_test') return new Response('{}', { status: 403 });
  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
  const m = url.match(/\/v1\/files\/([^/]+)\/(component_sets|components|styles|nodes)/)!;
  const [, key, kind] = m;
  if (key === 'abOiwE5nz8PJ41TVWLQAYr') return new Response('{}', { status: 403 });
  const kit = key === 'et3X0ja6o9iITvuJZA1k5C' ? 'web' : key === 'jiVAy6oXsM7sxlhYetiZ50' ? 'app' : 'other';
  if (kind === 'component_sets') {
    return json({ meta: { component_sets: kit === 'other' ? [] : [{ key: `set-btn-${kit}`, name: 'Button', node_id: '1:1' }] } });
  }
  if (kind === 'components') {
    return json({
      meta: {
        components:
          kit === 'other'
            ? [{ key: `c-${key}`, name: 'Icon', node_id: '5:5' }]
            : [
                { key: `btn-${kit}-l`, name: 'Size=L', node_id: '1:2', containing_frame: { containingStateGroup: { name: 'Button', nodeId: '1:1' } } },
                { key: `btn-${kit}-m`, name: 'Size=M', node_id: '1:3', containing_frame: { containingStateGroup: { name: 'Button', nodeId: '1:1' } } },
              ],
      },
    });
  }
  if (kind === 'styles') {
    return json({
      meta: { styles: key === 'slIC6wNF9z7bmVRozl2Sc9' ? [{ key: 'ts-h1', name: 'Heading/H1', style_type: 'TEXT', node_id: '9:1' }] : [] },
    });
  }
  return json({ nodes: { '9:1': { document: { style: { fontSize: 48, fontFamily: 'Beeline Sans' } } } } });
};

const settings = (env: Record<string, string>) => settingsFromEnv({ PLUGIN_TOKEN: 't', LLM_PROVIDER: 'none', ...env });
const auth = { authorization: 'Bearer t' };

describe('5.3 скан библиотек Carnica через REST API', () => {
  it('компоненты UI-kit WEB/APP с наборами, стили typography с кеглем, ошибка доступа по библиотеке', async () => {
    const app = buildApp({ settings: settings({ FIGMA_TOKEN: 'figd_test' }), configDir: CONFIG, provider: null, figmaFetch: figma });
    const res = await app.inject({ method: 'POST', url: '/ds/scan', headers: auth });
    expect(res.statusCode).toBe(200);
    const libs = res.json().libraries as LibraryScan[];
    const by = Object.fromEntries(libs.map((l) => [l.role, l]));
    expect(libs).toHaveLength(6);
    expect(by['ui-kit-web']!.components).toEqual([
      { key: 'btn-web-l', name: 'Size=L', componentSetKey: 'set-btn-web', componentSetName: 'Button' },
      { key: 'btn-web-m', name: 'Size=M', componentSetKey: 'set-btn-web', componentSetName: 'Button' },
    ]);
    expect(by['ui-kit-app']!.componentSets).toEqual([{ key: 'set-btn-app', name: 'Button' }]);
    expect(by.icons!.components[0]!.key).toBe('c-agbEZYd5CsJcRDWnFlkgFe');
    expect(by.typography!.styles).toEqual([{ key: 'ts-h1', name: 'Heading/H1', type: 'TEXT', fontSize: 48, fontFamily: 'Beeline Sans' }]);
    expect(by.colors!.error).toBe('нет доступа к файлу «01_Carnica-colors-2.0»: HTTP 403');
    expect(res.body).not.toContain('figd_test');
  });

  it('без FIGMA_TOKEN — 400 с понятной ошибкой', async () => {
    const app = buildApp({ settings: settings({}), configDir: CONFIG, provider: null });
    const res = await app.inject({ method: 'POST', url: '/ds/scan', headers: auth });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('FIGMA_TOKEN');
  });
});
