/** Шрифты, отсутствующие в текущей сессии Figma: «family::style» → id текстовых слоёв. */
export function findMissingFonts(root: SceneNode, mixed: symbol): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const visit = (n: SceneNode) => {
    if (n.type === 'TEXT' && n.hasMissingFont) {
      const fonts =
        n.fontName === mixed ? (n.getRangeAllFontNames(0, n.characters.length) as FontName[]) : [n.fontName as FontName];
      for (const f of fonts) {
        const key = `${f.family}::${f.style}`;
        out.set(key, [...(out.get(key) ?? []), n.id]);
      }
    }
    if ('children' in n) for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}
