import type { ScanCollection } from '@beeline-resize/shared';

const INTERESTING = /(breakpoint|screen|viewport|width|ширин|spac|gap|padding|indent|отступ|icon)/i;

/**
 * Коллекции переменных библиотек Carnica для скана (5.4): моды и значения нужных FLOAT-переменных.
 * Импортируется одна переменная на коллекцию (чтобы узнать моды) и только «интересные» FLOAT.
 */
export async function scanLibraryCollections(libraryNames: string[]): Promise<ScanCollection[]> {
  const wanted = new Set(libraryNames);
  const out: ScanCollection[] = [];
  for (const c of await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()) {
    if (!wanted.has(c.libraryName)) continue;
    const vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(c.key);
    if (vars.length === 0) continue;
    const first = await figma.variables.importVariableByKeyAsync(vars[0]!.key);
    const collection = await figma.variables.getVariableCollectionByIdAsync(first.variableCollectionId);
    if (!collection) continue;
    const modeName = new Map(collection.modes.map((m) => [m.modeId, m.name]));
    const variables: ScanCollection['variables'] = [];
    for (const lv of vars.filter((v) => v.resolvedType === 'FLOAT' && INTERESTING.test(v.name))) {
      const v = lv.key === first.key ? first : await figma.variables.importVariableByKeyAsync(lv.key);
      const values: Record<string, unknown> = {};
      for (const [modeId, value] of Object.entries(v.valuesByMode)) values[modeName.get(modeId) ?? modeId] = value;
      variables.push({ key: v.key, name: v.name, type: v.resolvedType, values });
    }
    out.push({ key: c.key, name: c.name, libraryName: c.libraryName, modes: collection.modes.map((m) => m.name), variables });
  }
  return out;
}
