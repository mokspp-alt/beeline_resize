import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { DesignSystemConfigSchema, presetsInGroup, type PresetCatalog } from '@beeline-resize/shared';
import { buildApp } from './app.js';
import { settingsFromEnv } from './settings.js';

const REPO_CONFIG = path.resolve(__dirname, '../../../config');
const TOKEN = 'team-token';
const SECRET = 'sk-ant-SECRET-123';

const settings = () =>
  settingsFromEnv({ PLUGIN_TOKEN: TOKEN, LLM_PROVIDER: 'anthropic', LLM_MODEL: 'claude-sonnet-5-5', ANTHROPIC_API_KEY: SECRET });

const auth = { authorization: `Bearer ${TOKEN}` };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'br-config-'));
  await cp(REPO_CONFIG, dir, { recursive: true });
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe('GET /health', () => {
  it('отвечает 200 без авторизации', async () => {
    const res = await buildApp({ settings: settings(), configDir: dir }).inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('авторизация', () => {
  it('без токена — 401', async () => {
    const res = await buildApp({ settings: settings(), configDir: dir }).inject({ url: '/config' });
    expect(res.statusCode).toBe(401);
  });

  it('с неверным токеном — 401', async () => {
    const res = await buildApp({ settings: settings(), configDir: dir }).inject({ url: '/config', headers: { authorization: 'Bearer nope' } });
    expect(res.statusCode).toBe(401);
  });

  it('бэкенд не стартует без PLUGIN_TOKEN', () => {
    expect(() => settingsFromEnv({})).toThrow(/PLUGIN_TOKEN/);
  });
});

describe('GET /config', () => {
  it('отдаёт каталог по умолчанию, конфиг Carnica, провайдера и политику — без ключей', async () => {
    const res = await buildApp({ settings: settings(), configDir: dir }).inject({ url: '/config', headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.catalog.presets.length).toBeGreaterThan(30);
    expect(body.designSystem.designSystem).toBe('Carnica');
    expect(body.provider).toEqual({ name: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(res.body).not.toContain(SECRET);
    expect(res.body).not.toContain(TOKEN);
  });

  it('изменение config/presets.json видно без пересборки и перезапуска', async () => {
    const app = buildApp({ settings: settings(), configDir: dir });
    const get = async () => (await app.inject({ url: '/config', headers: auth })).json().catalog as PresetCatalog;
    expect(presetsInGroup(await get(), 'banner-display').some((p) => p.width === 1000 && p.height === 120)).toBe(false);

    const base = (await get()).presets;
    const team: PresetCatalog = {
      presets: [
        ...base,
        { id: 'banner-display:1000x120', name: '1000×120', group: 'banner-display', width: 1000, height: 120, orientation: 'landscape', deviceClass: 'banner' },
      ],
      sets: {},
    };
    await writeFile(path.join(dir, 'presets.json'), JSON.stringify(team));
    expect(presetsInGroup(await get(), 'banner-display').some((p) => p.width === 1000 && p.height === 120)).toBe(true);
  });

  it('брейкпоинты из конфигурации ДС заменяют группу web', async () => {
    const file = path.join(dir, 'design-system.json');
    const ds = JSON.parse(await readFile(file, 'utf8'));
    ds.breakpoints = [
      { mode: 'Mobile', width: 360 },
      { mode: 'Tablet', width: 768 },
      { mode: 'Desktop', width: 1440 },
    ];
    await writeFile(file, JSON.stringify(ds));
    const res = await buildApp({ settings: settings(), configDir: dir }).inject({ url: '/config', headers: auth });
    const web = presetsInGroup(res.json().catalog, 'web').map((p) => `${p.width}x${p.height}`);
    expect(web).toEqual(['360xauto', '768xauto', '1440xauto']);
  });

  it('невалидный presets.json — 500, а не молчаливый откат', async () => {
    await writeFile(path.join(dir, 'presets.json'), JSON.stringify({ presets: [{ id: 'x' }] }));
    const res = await buildApp({ settings: settings(), configDir: dir }).inject({ url: '/config', headers: auth });
    expect(res.statusCode).toBe(500);
  });
});

describe('конфигурация Carnica', () => {
  it('текущий config/design-system.json проходит схему и содержит шесть библиотек', async () => {
    const raw = JSON.parse(await readFile(path.join(REPO_CONFIG, 'design-system.json'), 'utf8'));
    const ds = DesignSystemConfigSchema.parse(raw);
    expect(Object.keys(ds.libraries).sort()).toEqual(['colors', 'icons', 'sizes', 'typography', 'ui-kit-app', 'ui-kit-web']);
    expect(ds.libraries['ui-kit-web']).toMatchObject({ name: '06_Carnica-UI-kit-WEB', fileKey: 'et3X0ja6o9iITvuJZA1k5C' });
    expect(ds.kitByMode).toEqual({ web: 'ui-kit-web', app: 'ui-kit-app', banner: 'ui-kit-web' });
  });

  it('схема отклоняет неизвестную роль библиотеки и кит не из UI-kit', () => {
    expect(
      DesignSystemConfigSchema.safeParse({
        designSystem: 'X',
        libraries: { fonts: { name: 'a', fileKey: 'b' } },
        kitByMode: { web: 'ui-kit-web', app: 'ui-kit-app', banner: 'ui-kit-web' },
        minFontSize: { web: 12, app: 12, banner: 10 },
      }).success,
    ).toBe(false);
    expect(
      DesignSystemConfigSchema.safeParse({
        designSystem: 'X',
        libraries: {},
        kitByMode: { web: 'colors', app: 'ui-kit-app', banner: 'ui-kit-web' },
        minFontSize: { web: 12, app: 12, banner: 10 },
      }).success,
    ).toBe(false);
  });
});

describe('логи', () => {
  it('не содержат токен плагина и ключи провайдера', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const app = buildApp({ settings: settings(), configDir: dir, logger: { stream } });
    await app.inject({ url: '/config', headers: auth });
    app.log.info({ credentials: settings().credentials }, 'проверка маскирования');
    const all = lines.join('');
    expect(all).toContain('incoming request');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(SECRET);
  });
});
