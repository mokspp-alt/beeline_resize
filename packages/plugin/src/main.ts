import { checkSelection } from './capture/selection.js';
import { captureDesign, figmaCaptureDeps } from './capture/serialize.js';
import { collectWarnings } from './capture/warnings.js';
import { findMissingFonts } from './capture/fonts.js';
import { exportPreview, toBase64 } from './capture/preview.js';
import { applyPlan, figmaApplyDeps } from './apply/apply.js';
import { libraryStatus, summarize } from './ds/library.js';
import { scanLibraryCollections } from './ds/collections.js';
import { RunSession } from './run/session.js';
import type { MainToUi, SavedSets, SelectionInfo, UiToMain } from './messages.js';

figma.showUI(__html__, { width: 400, height: 680, themeColors: true });

const post = (msg: MainToUi) => figma.ui.postMessage(msg);
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

function selectionInfo(): SelectionInfo {
  const r = checkSelection(figma.currentPage.selection);
  if (r.ok) {
    const n = r.node;
    return { ok: true, source: { id: n.id, name: n.name, width: n.width, height: n.height } };
  }
  return { ok: false, message: r.message, ...(r.code === 'not-frame' && r.suggestion ? { suggestionId: r.suggestion.id } : {}) };
}

async function libraryCollections(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for (const c of await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()) map.set(c.key, c.libraryName);
  } catch {
    // нет доступа к teamLibrary — продолжаем без имён библиотек
  }
  return map;
}

let session: RunSession | undefined;
let sessionSource: FrameNode | ComponentNode | InstanceNode | undefined;
let sessionDs: Parameters<typeof applyPlan>[3];
const applyDeps = figmaApplyDeps();

async function handle(msg: UiToMain) {
  switch (msg.type) {
    case 'init': {
      const token = ((await figma.clientStorage.getAsync('token')) as string | undefined) ?? '';
      const sets = ((await figma.clientStorage.getAsync('sets')) as SavedSets | undefined) ?? {};
      post({ type: 'init', token, sets, userId: figma.currentUser?.id ?? 'anonymous' });
      post({ type: 'selection', selection: selectionInfo() });
      return;
    }
    case 'save-token':
      return figma.clientStorage.setAsync('token', msg.token);
    case 'save-sets':
      return figma.clientStorage.setAsync('sets', msg.sets);
    case 'select-node': {
      const n = await figma.getNodeByIdAsync(msg.nodeId);
      if (n && n.type !== 'DOCUMENT' && n.type !== 'PAGE') {
        figma.currentPage.selection = [n as SceneNode];
        figma.viewport.scrollAndZoomIntoView([n as SceneNode]);
      }
      return;
    }
    case 'capture': {
      const r = checkSelection(figma.currentPage.selection);
      if (!r.ok) return post({ type: 'capture-error', message: r.message });
      const root = r.node;
      const ir = await captureDesign(root, figmaCaptureDeps(await libraryCollections(), new Map()), { pageName: figma.currentPage.name });
      const warnings = collectWarnings({ ir, missingFonts: findMissingFonts(root, figma.mixed) });
      const preview = msg.allowPreview ? toBase64(await exportPreview(root)) : undefined;
      return post({ type: 'captured', ir, warnings, ...(preview ? { preview } : {}) });
    }
    case 'ds-status': {
      const statuses = await libraryStatus(msg.ds, {
        availableCollections: () => figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync(),
        probeComponent: async (key) => {
          try {
            await figma.importComponentByKeyAsync(key);
            return true;
          } catch {
            return false;
          }
        },
      });
      return post({ type: 'ds-status', statuses, summary: summarize(statuses) });
    }
    case 'run-start': {
      const r = checkSelection(figma.currentPage.selection);
      if (!r.ok) return post({ type: 'capture-error', message: r.message });
      // checkSelection пропускает только FRAME, COMPONENT и INSTANCE
      const source = r.node as FrameNode | ComponentNode | InstanceNode;
      sessionSource = source;
      sessionDs = msg.ds ?? undefined;
      session = new RunSession(
        {
          source,
          pageNodes: () => figma.currentPage.children,
          apply: (plan, report) => applyPlan(source, plan, report, sessionDs, applyDeps),
          commitUndo: () => figma.commitUndo(),
        },
        new Map(msg.targets.map((t) => [t.id, t])),
        msg.regenerate,
      );
      return;
    }
    case 'apply-plan': {
      if (!session) return;
      try {
        const applied = await session.onPlan(msg.plan, msg.report);
        if (applied) post({ type: 'applied', applied });
      } catch (e) {
        post({ type: 'apply-error', targetId: msg.plan.targetId, message: err(e) });
      }
      return;
    }
    case 'run-cancel':
      session?.cancel();
      return finishRun();
    case 'run-finish':
      return finishRun();
    case 'scan-collections': {
      try {
        post({ type: 'scan-collections', collections: await scanLibraryCollections(msg.libraryNames) });
      } catch (e) {
        post({ type: 'scan-error', message: err(e) });
      }
      return;
    }
  }
}

function finishRun() {
  if (!session) return;
  const frames = session.finish();
  session = undefined;
  post({ type: 'run-finished', count: frames.length });
  if (frames.length > 0) figma.notify(`Готово: ${frames.length} фреймов`);
}

// Сообщения обрабатываются строго по очереди: планы применяются в порядке прихода
let queue: Promise<void> = Promise.resolve();
figma.ui.onmessage = (msg: UiToMain) => {
  queue = queue.then(() => handle(msg)).catch((e) => post({ type: 'capture-error', message: err(e) }));
};
figma.on('selectionchange', () => post({ type: 'selection', selection: selectionInfo() }));
