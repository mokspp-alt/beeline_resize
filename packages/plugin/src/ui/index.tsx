import { render } from 'preact';
import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import {
  GROUP_LABELS,
  LayoutPlanSchema,
  buildDraftConfig,
  makeCustomPreset,
  type AdaptationMode,
  type DesignIR,
  type DesignSystemConfig,
  type PresetGroup,
  type SizePreset,
} from '@beeline-resize/shared';
import type { MainToUi, SavedSets, SelectionInfo, UiToMain } from '../messages.js';
import type { SourceWarning } from '../capture/warnings.js';
import type { DsSummary, LibraryStatus } from '../ds/library.js';
import { Api, type BackendConfig } from './api.js';
import { isRunning, kindLabel, progress, type TargetRow } from './state.js';


/* ───────────── мост к main ───────────── */

const send = (msg: UiToMain) => parent.postMessage({ pluginMessage: msg }, '*');
type Listener = (m: MainToUi) => void;
const listeners = new Set<Listener>();
window.onmessage = (e: MessageEvent) => {
  const m = e.data?.pluginMessage as MainToUi | undefined;
  if (m) listeners.forEach((l) => l(m));
};
function waitFor<T extends MainToUi['type']>(...types: T[]): Promise<Extract<MainToUi, { type: T }>> {
  return new Promise((resolve) => {
    const l: Listener = (m) => {
      if ((types as string[]).includes(m.type)) {
        listeners.delete(l);
        resolve(m as Extract<MainToUi, { type: T }>);
      }
    };
    listeners.add(l);
  });
}

const GROUPS: PresetGroup[] = ['web', 'app-ios', 'app-android', 'banner-display', 'banner-social', 'custom'];

/* ───────────── приложение ───────────── */

function App() {
  const [tab, setTab] = useState<'adapt' | 'settings' | 'ds'>('adapt');
  const [token, setToken] = useState('');
  const [userId, setUserId] = useState('anonymous');
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [selection, setSelection] = useState<SelectionInfo>({ ok: false });
  const [savedSets, setSavedSets] = useState<SavedSets>({});
  const [ds, setDs] = useState<{ statuses: LibraryStatus[]; summary: DsSummary } | null>(null);

  const api = useMemo(() => new Api(__BACKEND_URL__, token, userId), [token, userId]);

  useEffect(() => {
    const l: Listener = (m) => {
      if (m.type === 'init') {
        setToken(m.token ?? '');
        setSavedSets(m.sets ?? {});
        setUserId(m.userId ?? 'anonymous');
        setReady(true);
        if (!m.token) setTab('settings');
      } else if (m.type === 'selection') setSelection(m.selection);
      else if (m.type === 'ds-status' && m.summary) setDs({ statuses: m.statuses, summary: m.summary });
    };
    listeners.add(l);
    send({ type: 'init' });
    return () => listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    setConfigError('');
    api
      .config()
      .then((c) => {
        setConfig(c);
        if (c.designSystem) send({ type: 'ds-status', ds: c.designSystem });
      })
      .catch((e: Error) => setConfigError(e.message));
  }, [api, ready, token]);

  return (
    <div>
      <nav class="tabs">
        <button class={tab === 'adapt' ? 'on' : ''} onClick={() => setTab('adapt')}>Адаптация</button>
        <button class={tab === 'ds' ? 'on' : ''} onClick={() => setTab('ds')}>Дизайн-система</button>
        <button class={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Настройки</button>
      </nav>
      {configError && <p class="warn">{configError}</p>}
      {tab === 'settings' && <Settings token={token} config={config} onSave={(t) => (send({ type: 'save-token', token: t }), setToken(t))} />}
      {tab === 'ds' && <DsTab api={api} config={config} ds={ds} />}
      {tab === 'adapt' && config && (
        <Adapt api={api} config={config} selection={selection} ds={ds} savedSets={savedSets} onSaveSets={(s) => (send({ type: 'save-sets', sets: s }), setSavedSets(s))} />
      )}
      {tab === 'adapt' && !config && !configError && <p class="muted">Загрузка конфигурации…</p>}
    </div>
  );
}

/* ───────────── настройки ───────────── */

function Settings(p: { token: string; config: BackendConfig | null; onSave(t: string): void }) {
  const [t, setT] = useState(p.token ?? '');
  return (
    <section>
      <label>
        Командный токен
        <input type="password" value={t} onInput={(e) => setT((e.target as HTMLInputElement).value)} placeholder="Токен от администратора" />
      </label>
      <button onClick={() => p.onSave(t.trim())} disabled={!t.trim()}>Сохранить</button>
      <p class="muted">Бэкенд: {__BACKEND_URL__}</p>
      {p.config && (
        <p class="muted">
          Модель: {p.config.provider.name === 'none' ? 'без AI' : `${p.config.provider.name} · ${p.config.provider.model}`}
        </p>
      )}
    </section>
  );
}

/* ───────────── дизайн-система ───────────── */

function DsStatusView({ ds }: { ds: { statuses: LibraryStatus[]; summary: DsSummary } | null }) {
  const [open, setOpen] = useState(false);
  if (!ds) return <p class="muted">Дизайн-система: проверка…</p>;
  return (
    <div class="ds">
      <p class={ds.summary.connected ? 'ok' : 'warn'} onClick={() => setOpen(!open)}>
        {ds.summary.message} {open ? '▾' : '▸'}
      </p>
      {open && (
        <ul>
          {ds.statuses.map((s) => (
            <li key={s.role}>
              {s.state === 'enabled' ? '✓' : s.state === 'missing' ? '✗' : '?'} {s.name}
              {s.state === 'missing' && <span class="muted"> — Assets → Libraries</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DsTab(p: { api: Api; config: BackendConfig | null; ds: { statuses: LibraryStatus[]; summary: DsSummary } | null }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const base = p.config?.designSystem;

  const scan = async () => {
    if (!base) return;
    setBusy(true);
    setError('');
    try {
      const libs = await p.api.scan();
      send({ type: 'scan-collections', libraryNames: Object.values(base.libraries).map((l) => l!.name) });
      const m = await waitFor('scan-collections', 'scan-error');
      if (m.type === 'scan-error') throw new Error(m.message);
      const r = buildDraftConfig(base, m.collections, libs);
      setDraft(JSON.stringify(r.config, null, 2));
      setNotes(r.notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <DsStatusView ds={p.ds} />
      <p class="muted">Для администратора: соберите черновик config/design-system.json по библиотекам Carnica, проверьте и закоммитьте его в репозиторий.</p>
      <button onClick={scan} disabled={busy || !base}>{busy ? 'Сканирую…' : 'Сканировать дизайн-систему'}</button>
      {error && <p class="warn">{error}</p>}
      {notes.length > 0 && (
        <ul class="notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {draft && (
        <>
          <textarea readOnly value={draft} rows={14} />
          <button onClick={() => copy(draft)}>Скопировать JSON</button>
        </>
      )}
    </section>
  );
}

function copy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

/* ───────────── адаптация ───────────── */

function Adapt(p: {
  api: Api;
  config: BackendConfig;
  selection: SelectionInfo;
  ds: { statuses: LibraryStatus[]; summary: DsSummary } | null;
  savedSets: SavedSets;
  onSaveSets(s: SavedSets): void;
}) {
  const catalog = p.config.catalog;
  const [custom, setCustom] = useState<SizePreset[]>([]);
  const all = useMemo(() => [...catalog.presets, ...custom], [catalog, custom]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'auto' | AdaptationMode>('auto');
  const [confidential, setConfidential] = useState(false);
  const [rows, dispatch] = useReducer(progress, [] as TargetRow[]);
  const [confirm, setConfirm] = useState<{ text: string[]; resolve(ok: boolean): void } | null>(null);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState('');
  const abort = useRef<AbortController | null>(null);
  const running = isRunning(rows);

  useEffect(() => {
    const l: Listener = (m) => {
      if (m.type === 'applied') dispatch({ type: 'applied', targetId: m.applied.targetId, frameId: m.applied.frameId, name: m.applied.name, report: m.applied.report });
      else if (m.type === 'apply-error') dispatch({ type: 'error', targetId: m.targetId, message: m.message });
    };
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);

  const ask = (text: string[]) => new Promise<boolean>((resolve) => setConfirm({ text, resolve }));

  const run = async (only?: SizePreset) => {
    const presets = only ? [only] : all.filter((x) => selected.has(x.id));
    if (presets.length === 0) return;
    setError('');
    setUsage('');
    if (p.ds?.summary.tokensMissing && !(await ask(['Библиотеки токенов Carnica не включены: результаты не будут привязаны к токенам.']))) return;

    send({ type: 'capture', allowPreview: p.config.policy.allowPreview });
    const cap = await waitFor('captured', 'capture-error');
    if (cap.type === 'capture-error') return setError(cap.message);
    const warnings: SourceWarning[] = cap.warnings;
    if (warnings.some((w) => w.requiresConfirm) && !(await ask(warnings.map((w) => w.message)))) return;
    setConfirm(null);

    send({
      type: 'run-start',
      targets: presets.map((x) => ({ id: x.id, group: x.group, name: x.name, width: x.width, height: x.height })),
      ds: p.config.designSystem,
      regenerate: Boolean(only),
    });
    dispatch({ type: 'start', presets });
    const ac = new AbortController();
    abort.current = ac;
    try {
      await p.api.adapt(
        {
          ir: cap.ir as DesignIR,
          ...(cap.preview ? { preview: cap.preview } : {}),
          targets: presets,
          ...(mode !== 'auto' ? { modeOverrides: Object.fromEntries(presets.map((x) => [x.id, mode])) } : {}),
          ...(confidential ? { confidential: true } : {}),
        },
        ac.signal,
        (e) => {
          if (e.type === 'roles') dispatch({ type: 'roles' });
          else if (e.type === 'plan') {
            const parsed = LayoutPlanSchema.safeParse(e.plan);
            if (!parsed.success) return dispatch({ type: 'error', targetId: e.plan.targetId, message: 'план не прошёл проверку' });
            dispatch({ type: 'planned', targetId: e.plan.targetId, ai: e.plan.ai, ...(e.plan.fallbackReason ? { fallbackReason: e.plan.fallbackReason } : {}) });
            send({ type: 'apply-plan', plan: parsed.data, report: e.report });
          } else if (e.type === 'error') dispatch({ type: 'error', targetId: e.targetId, message: e.message });
          else if (e.type === 'done') setUsage(e.usage.calls ? `LLM: ${e.usage.calls} вызовов, ${e.usage.inputTokens + e.usage.outputTokens} токенов, ${Math.round(e.durationMs / 100) / 10} с` : `Без AI, ${e.durationMs} мс`);
        },
      );
      send({ type: 'run-finish' });
      await waitFor('run-finished');
      dispatch({ type: 'finish' });
    } catch (e) {
      if (!ac.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
        send({ type: 'run-finish' });
        dispatch({ type: 'finish' });
      }
    } finally {
      abort.current = null;
    }
  };

  const cancel = () => {
    abort.current?.abort();
    send({ type: 'run-cancel' });
    dispatch({ type: 'cancel' });
  };

  return (
    <section>
      <Source selection={p.selection} />
      <DsStatusView ds={p.ds} />
      <SizePicker
        all={all}
        sets={catalog.sets}
        selected={selected}
        setSelected={setSelected}
        onAddCustom={(x) => (setCustom([...custom.filter((c) => c.id !== x.id), x]), setSelected(new Set([...selected, x.id])))}
        savedSets={p.savedSets}
        onSaveSets={p.onSaveSets}
        onLoadSet={(presets) => {
          setCustom([...custom, ...presets.filter((x) => x.group === 'custom' && !custom.some((c) => c.id === x.id))]);
          setSelected(new Set(presets.map((x) => x.id)));
        }}
      />
      <div class="row">
        <label>
          Режим{' '}
          <select value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value as typeof mode)}>
            <option value="auto">Авто по группе</option>
            <option value="web">Web</option>
            <option value="app">App</option>
            <option value="banner">Баннер</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={confidential} onChange={(e) => setConfidential((e.target as HTMLInputElement).checked)} /> Конфиденциально
        </label>
      </div>
      {confirm && (
        <div class="confirm">
          {confirm.text.map((t) => (
            <p key={t} class="warn">{t}</p>
          ))}
          <button onClick={() => (confirm.resolve(true), setConfirm(null))}>Продолжить</button>{' '}
          <button class="secondary" onClick={() => (confirm.resolve(false), setConfirm(null))}>Отмена</button>
        </div>
      )}
      <div class="row">
        {!running ? (
          <button disabled={!p.selection.ok || selected.size === 0} onClick={() => run()}>
            Адаптировать ({selected.size})
          </button>
        ) : (
          <button class="secondary" onClick={cancel}>Отменить</button>
        )}
      </div>
      {error && <p class="warn">{error}</p>}
      {usage && <p class="muted">{usage}</p>}
      <Report rows={rows} running={running} onRegenerate={(x) => run(x)} />
    </section>
  );
}

function Source({ selection }: { selection: SelectionInfo }) {
  if (selection.ok && selection.source) {
    const s = selection.source;
    return (
      <p class="source">
        Исходник: <b>{s.name}</b> {Math.round(s.width)}×{Math.round(s.height)}
      </p>
    );
  }
  return (
    <p class="warn">
      {selection.message ?? 'Выберите один фрейм-исходник'}
      {selection.suggestionId && (
        <>
          {' '}
          <a onClick={() => send({ type: 'select-node', nodeId: selection.suggestionId! })}>Выбрать</a>
        </>
      )}
    </p>
  );
}

function SizePicker(p: {
  all: SizePreset[];
  sets: Record<string, string>;
  selected: Set<string>;
  setSelected(s: Set<string>): void;
  onAddCustom(x: SizePreset): void;
  savedSets: SavedSets;
  onSaveSets(s: SavedSets): void;
  onLoadSet(presets: SizePreset[]): void;
}) {
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [customError, setCustomError] = useState('');
  const [setName, setSetName] = useState('');
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(p.selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    p.setSelected(next);
  };
  const add = () => {
    const r = makeCustomPreset(Number(w), Number(h));
    if (!r.ok) return setCustomError(r.error);
    setCustomError('');
    p.onAddCustom(r.preset);
    setW('');
    setH('');
  };

  return (
    <div class="sizes">
      <div class="row wrap">
        {Object.entries(p.sets).map(([id, label]) => (
          <button key={id} class="chip" onClick={() => toggle(p.all.filter((x) => x.set === id).map((x) => x.id), true)}>
            {label}
          </button>
        ))}
        {Object.keys(p.savedSets).map((name) => (
          <button key={name} class="chip saved" onClick={() => p.onLoadSet(p.savedSets[name]!)}>
            ★ {name}
          </button>
        ))}
      </div>
      {GROUPS.map((g) => {
        const items = p.all.filter((x) => x.group === g);
        if (items.length === 0) return null;
        const allOn = items.every((x) => p.selected.has(x.id));
        return (
          <details key={g} open={g === 'web'}>
            <summary>
              <label onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={allOn} onChange={() => toggle(items.map((x) => x.id), !allOn)} /> {GROUP_LABELS[g]}
              </label>{' '}
              <span class="muted">{items.filter((x) => p.selected.has(x.id)).length}/{items.length}</span>
            </summary>
            {items.map((x) => (
              <label key={x.id} class="size">
                <input type="checkbox" checked={p.selected.has(x.id)} onChange={(e) => toggle([x.id], (e.target as HTMLInputElement).checked)} />
                {x.name} <span class="muted">{x.width}×{x.height}</span>
              </label>
            ))}
          </details>
        );
      })}
      <div class="row">
        <input class="num" placeholder="Ш" value={w} onInput={(e) => setW((e.target as HTMLInputElement).value)} />×
        <input class="num" placeholder="В" value={h} onInput={(e) => setH((e.target as HTMLInputElement).value)} />
        <button class="secondary" onClick={add}>Добавить</button>
      </div>
      {customError && <p class="warn">{customError}</p>}
      <div class="row">
        <input placeholder="Имя набора" value={setName} onInput={(e) => setSetName((e.target as HTMLInputElement).value)} />
        <button
          class="secondary"
          disabled={!setName.trim() || p.selected.size === 0}
          onClick={() => {
            p.onSaveSets({ ...p.savedSets, [setName.trim()]: p.all.filter((x) => p.selected.has(x.id)) });
            setSetName('');
          }}
        >
          Сохранить набор
        </button>
      </div>
    </div>
  );
}

const STATUS: Record<TargetRow['status'], string> = { queued: 'в очереди', processing: 'обработка', done: 'готово', error: 'ошибка', cancelled: 'отменено' };

function Report(p: { rows: TargetRow[]; running: boolean; onRegenerate(x: SizePreset): void }) {
  if (p.rows.length === 0) return null;
  const select = (id: string) => send({ type: 'select-node', nodeId: id });
  return (
    <div class="report">
      {p.rows.map((r) => (
        <div key={r.preset.id} class={`target ${r.status}`}>
          <div class="row">
            <b onClick={() => r.frameId && select(r.frameId)} class={r.frameId ? 'link' : ''}>
              {r.preset.name} {r.preset.width}×{r.preset.height}
            </b>
            <span class="muted">{STATUS[r.status]}</span>
            {r.status === 'done' && <span class={r.ai ? 'badge ai' : 'badge'}>{r.ai ? 'AI' : 'без AI'}</span>}
            {!p.running && (r.status === 'done' || r.status === 'error') && (
              <button class="mini secondary" onClick={() => p.onRegenerate(r.preset)}>
                Перегенерировать
              </button>
            )}
          </div>
          {r.error && <p class="warn">{r.error}</p>}
          {r.report.map((it, i) => (
            <p key={i} class={`item ${it.nodeId ? 'link' : ''}`} onClick={() => it.nodeId && select(it.nodeId)}>
              <span class="kind">{kindLabel(it.kind)}</span> {it.message}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

render(<App />, document.getElementById('root')!);
