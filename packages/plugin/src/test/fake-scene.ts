/**
 * Фейковый граф сцены Figma для тестов применения плана. Повторяет поведение,
 * на которое опирается плагин: клонирование с новыми id, resize, порядок детей,
 * свойства компонентов, моды переменных, ограничения layoutSizing.
 */
export const MIXED = Symbol('mixed');

let seq = 1000;

export class FNode {
  id: string;
  parent: FNode | null = null;
  children: FNode[] = [];
  x = 0;
  y = 0;
  width = 100;
  height = 100;
  visible = true;
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' = 'NONE';
  layoutWrap: 'WRAP' | 'NO_WRAP' = 'NO_WRAP';
  itemSpacing = 0;
  counterAxisSpacing = 0;
  paddingTop = 0;
  paddingRight = 0;
  paddingBottom = 0;
  paddingLeft = 0;
  primaryAxisSizingMode: 'FIXED' | 'AUTO' = 'FIXED';
  layoutPositioning: 'AUTO' | 'ABSOLUTE' = 'AUTO';
  clipsContent = false;
  fills: unknown[] = [];
  // текст
  characters = '';
  fontSize = 16;
  fontName: { family: string; style: string } | symbol = { family: 'Beeline Sans', style: 'Regular' };
  lineHeight: unknown = { unit: 'AUTO' };
  textAutoResize = 'HEIGHT';
  textStyleId = '';
  // компонент
  componentProperties: Record<string, { type: string; value: string | boolean }> = {};
  mainComponent: { key: string; name: string } | null = null;
  // моды и привязки
  explicitModes: Record<string, string> = {};
  bound: Record<string, string> = {};
  pluginData: Record<string, string> = {};
  private _sizingH = 'FIXED';
  private _sizingV = 'FIXED';

  constructor(
    public type: string,
    public name: string,
    props: Partial<FNode> = {},
    children: FNode[] = [],
  ) {
    this.id = `${++seq}:1`;
    Object.assign(this, props);
    for (const c of children) this.appendChild(c);
  }

  get layoutSizingHorizontal() {
    return this._sizingH;
  }
  set layoutSizingHorizontal(v: string) {
    if (v === 'FILL' && (!this.parent || this.parent.layoutMode === 'NONE')) throw new Error('FILL требует auto layout у родителя');
    if (v === 'HUG' && this.type !== 'TEXT' && this.layoutMode === 'NONE') throw new Error('HUG требует auto layout');
    this._sizingH = v;
  }
  get layoutSizingVertical() {
    return this._sizingV;
  }
  set layoutSizingVertical(v: string) {
    if (v === 'FILL' && (!this.parent || this.parent.layoutMode === 'NONE')) throw new Error('FILL требует auto layout у родителя');
    if (v === 'HUG' && this.type !== 'TEXT' && this.layoutMode === 'NONE') throw new Error('HUG требует auto layout');
    this._sizingV = v;
  }

  appendChild(c: FNode) {
    c.parent?.removeChild(c);
    c.parent = this;
    this.children.push(c);
  }
  insertChild(i: number, c: FNode) {
    c.parent?.removeChild(c);
    c.parent = this;
    this.children.splice(i, 0, c);
  }
  private removeChild(c: FNode) {
    this.children = this.children.filter((x) => x !== c);
  }
  remove() {
    this.parent?.removeChild(this);
    this.parent = null;
  }

  resize(w: number, h: number) {
    if (this.parent?.type === 'INSTANCE') throw new Error('нельзя менять размер внутри инстанса');
    this.width = w;
    this.height = h;
  }

  clone(): FNode {
    const copy = this.deepCopy();
    this.parent?.appendChild(copy);
    return copy;
  }

  private deepCopy(): FNode {
    const copy = new FNode(this.type, this.name);
    for (const [k, v] of Object.entries(this)) {
      if (k === 'id' || k === 'parent' || k === 'children') continue;
      (copy as any)[k] = typeof v === 'object' && v !== null && typeof v !== 'symbol' ? structuredClone(v) : v;
    }
    copy.fontName = this.fontName;
    for (const c of [...this.children]) copy.appendChild(c.deepCopy());
    return copy;
  }
  detachInstance(): FNode {
    this.type = 'FRAME';
    this.mainComponent = null;
    return this;
  }
  createInstance(): FNode {
    const inst = this.clone();
    inst.type = 'INSTANCE';
    return inst;
  }

  getRangeAllFontNames() {
    return [this.fontName as { family: string; style: string }];
  }
  async setTextStyleIdAsync(id: string) {
    this.textStyleId = id;
  }
  setProperties(props: Record<string, string>) {
    for (const [k, v] of Object.entries(props)) {
      const key = Object.keys(this.componentProperties).find((p) => p === k || p.split('#')[0] === k);
      if (!key) throw new Error(`нет свойства ${k}`);
      this.componentProperties[key]!.value = v;
    }
  }
  swapComponent(comp: { key: string; name: string; props?: Record<string, { type: string; value: string }> }) {
    this.mainComponent = { key: comp.key, name: comp.name };
    this.componentProperties = structuredClone(comp.props ?? {});
  }
  setExplicitVariableModeForCollection(collection: { key: string }, modeId: string) {
    this.explicitModes[collection.key] = modeId;
  }
  setBoundVariable(field: string, v: { key: string }) {
    this.bound[field] = v.key;
  }
  setPluginData(k: string, v: string) {
    this.pluginData[k] = v;
  }
  getPluginData(k: string) {
    return this.pluginData[k] ?? '';
  }
}

export const page = (...children: FNode[]) => new FNode('PAGE', 'Page', {}, children);
