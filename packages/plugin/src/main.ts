import { checkSelection } from './capture/selection.js';
import { captureDesign, figmaCaptureDeps } from './capture/serialize.js';
import { collectWarnings } from './capture/warnings.js';
import { findMissingFonts } from './capture/fonts.js';
import { exportPreview, toBase64 } from './capture/preview.js';
import type { MainToUi, SelectionInfo, UiToMain } from './messages.js';

figma.showUI(__html__, { width: 380, height: 600, themeColors: true });

const post = (msg: MainToUi) => figma.ui.postMessage(msg);

function selectionInfo(): SelectionInfo {
  const r = checkSelection(figma.currentPage.selection);
  if (r.ok) {
    const n = r.node;
    return { ok: true, source: { id: n.id, name: n.name, width: n.width, height: n.height } };
  }
  return { ok: false, message: r.message, ...(r.code === 'not-frame' && r.suggestion ? { suggestionId: r.suggestion.id } : {}) };
}

function postSelection() {
  post({ type: 'selection', selection: selectionInfo() });
}

/** Имена библиотек по ключам коллекций переменных (для libraryName в DesignIR). */
async function libraryCollections(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for (const c of await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()) map.set(c.key, c.libraryName);
  } catch {
    // нет доступа к teamLibrary — продолжаем без имён библиотек
  }
  return map;
}

async function capture(allowPreview: boolean) {
  const r = checkSelection(figma.currentPage.selection);
  if (!r.ok) return post({ type: 'capture-error', message: r.message });
  const root = r.node;
  const deps = figmaCaptureDeps(await libraryCollections(), new Map());
  const ir = await captureDesign(root, deps, { pageName: figma.currentPage.name });
  const warnings = collectWarnings({ ir, missingFonts: findMissingFonts(root, figma.mixed) });
  const preview = allowPreview ? toBase64(await exportPreview(root)) : undefined;
  post({ type: 'captured', ir, warnings, ...(preview ? { preview } : {}) });
}

figma.on('selectionchange', postSelection);

figma.ui.onmessage = async (msg: UiToMain) => {
  try {
    if (msg.type === 'select-node') {
      const n = await figma.getNodeByIdAsync(msg.nodeId);
      if (n && n.type !== 'DOCUMENT' && n.type !== 'PAGE') {
        figma.currentPage.selection = [n as SceneNode];
        figma.viewport.scrollAndZoomIntoView([n as SceneNode]);
      }
    } else if (msg.type === 'capture') {
      await capture(msg.allowPreview);
    }
  } catch (e) {
    post({ type: 'capture-error', message: e instanceof Error ? e.message : String(e) });
  }
};

postSelection();
