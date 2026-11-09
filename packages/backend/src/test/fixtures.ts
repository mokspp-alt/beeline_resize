import type { AutoLayout, DesignIR, DesignNode } from '@beeline-resize/shared';

/** Фикстуры DesignIR для тестов адаптации. */

let seq = 0;
const id = (p: string) => `${p}:${++seq}`;

type N = Partial<DesignNode> & Pick<DesignNode, 'name'>;

export function n(type: DesignNode['type'], props: N, children?: DesignNode[]): DesignNode {
  return {
    id: props.id ?? id(type.toLowerCase()),
    type,
    visible: true,
    bbox: { x: 0, y: 0, width: 100, height: 100 },
    ...props,
    ...(children ? { children } : {}),
  };
}

export function text(name: string, characters: string, fontSize: number, bbox: DesignNode['bbox'], extra: Partial<DesignNode> = {}): DesignNode {
  return n('TEXT', {
    name,
    bbox,
    text: { characters, fontSize, font: { family: 'Beeline Sans', style: 'Regular' }, lineHeight: 'AUTO', align: 'LEFT', autoResize: 'HEIGHT', mixed: false },
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
    ...extra,
  });
}

export function image(name: string, bbox: DesignNode['bbox'], extra: Partial<DesignNode> = {}): DesignNode {
  return n('RECTANGLE', { name, bbox, fills: [{ type: 'IMAGE', visible: true, opacity: 1, imageHash: 'img', scaleMode: 'FILL' }], ...extra });
}

export function instance(name: string, setName: string, bbox: DesignNode['bbox'], extra: Partial<DesignNode> = {}, children?: DesignNode[]): DesignNode {
  return n(
    'INSTANCE',
    {
      name,
      bbox,
      component: {
        key: `key-${setName}`,
        name: 'Size=L',
        componentSetKey: `set-${setName}`,
        componentSetName: setName,
        libraryName: '06_Carnica-UI-kit-WEB',
        isRemote: true,
        variantProps: { Size: 'L' },
        componentProps: {},
        overriddenNodeIds: [],
      },
      ...extra,
    },
    children,
  );
}

const al = (mode: AutoLayout['mode'], gap: number, pad = 0, extra: Partial<AutoLayout> = {}): AutoLayout => ({
  mode,
  wrap: false,
  itemSpacing: gap,
  padding: { top: pad, right: pad, bottom: pad, left: pad },
  primaryAxisAlign: 'MIN',
  counterAxisAlign: 'MIN',
  primarySizing: 'AUTO',
  counterSizing: 'FIXED',
  ...extra,
});

function ir(name: string, width: number, height: number, children: DesignNode[], rootExtra: Partial<DesignNode> = {}): DesignIR {
  return {
    version: 1,
    source: { nodeId: `root:${name}`, name, width, height },
    fonts: [{ family: 'Beeline Sans', style: 'Regular' }],
    root: n('FRAME', { id: `root:${name}`, name, bbox: { x: 0, y: 0, width, height }, ...rootExtra }, children),
  };
}

/** Рекламный баннер 1080×1080: логотип, заголовок, текст, цена, кнопка, фото, сноска. */
export function promoBanner(): DesignIR {
  return ir('Promo', 1080, 1080, [
    instance('Logo', 'Logo', { x: 64, y: 64, width: 220, height: 64 }, { id: 'logo' }),
    text('Title', 'Безлимитный интернет', 72, { x: 64, y: 200, width: 560, height: 180 }, { id: 'title' }),
    text('Description', 'Подключите тариф и пользуйтесь интернетом без ограничений в любой точке страны', 32, { x: 64, y: 400, width: 560, height: 120 }, { id: 'body' }),
    text('Price', 'от 450 ₽/мес', 56, { x: 64, y: 560, width: 420, height: 70 }, { id: 'price' }),
    instance('Button', 'Button', { x: 64, y: 680, width: 280, height: 72 }, { id: 'cta' }, [
      text('Label', 'Подключить', 24, { x: 104, y: 700, width: 200, height: 32 }, { id: 'cta-label' }),
    ]),
    image('Photo', { x: 620, y: 160, width: 400, height: 640 }, { id: 'photo' }),
    text('Legal', 'Подробнее об условиях на beeline.ru. ПАО «ВымпелКом». Реклама. Предложение действует до 31.12', 18, { x: 64, y: 960, width: 950, height: 50 }, { id: 'legal' }),
  ]);
}

/** Лендинг 1440: хедер, герой (текст + картинка), ряд из 4 карточек, футер. */
export function landing(): DesignIR {
  const card = (i: number) =>
    instance(`Card ${i}`, 'Card', { x: 120 + (i - 1) * 312, y: 900, width: 288, height: 360 }, { id: `card${i}`, childLayout: { positioning: 'AUTO', sizingH: 'FIXED', sizingV: 'HUG', grow: 0 } });
  return ir('Landing', 1440, 1600, [
    n('FRAME', { id: 'header', name: 'Header', bbox: { x: 0, y: 0, width: 1440, height: 80 }, autoLayout: al('HORIZONTAL', 24, 120) }, [
      instance('Logo', 'Logo', { x: 120, y: 20, width: 140, height: 40 }, { id: 'web-logo' }),
    ]),
    n('FRAME', { id: 'hero', name: 'Hero', bbox: { x: 0, y: 80, width: 1440, height: 720 }, autoLayout: al('HORIZONTAL', 48, 120) }, [
      n('FRAME', { id: 'hero-text', name: 'Hero text', bbox: { x: 120, y: 200, width: 560, height: 400 }, autoLayout: al('VERTICAL', 24) }, [
        text('H1', 'Мобильная связь для всей семьи', 64, { x: 120, y: 200, width: 560, height: 160 }, { id: 'h1' }),
        text('Lead', 'Один тариф на всех, общий пакет минут и гигабайт', 24, { x: 120, y: 380, width: 560, height: 64 }, { id: 'lead' }),
      ]),
      image('Hero image', { x: 760, y: 120, width: 560, height: 640 }, { id: 'hero-img' }),
    ]),
    n('FRAME', { id: 'cards', name: 'Cards', bbox: { x: 0, y: 860, width: 1440, height: 440 }, autoLayout: al('HORIZONTAL', 24, 120) }, [card(1), card(2), card(3), card(4)]),
    n('FRAME', { id: 'footer', name: 'Footer', bbox: { x: 0, y: 1400, width: 1440, height: 200 }, autoLayout: al('VERTICAL', 16, 120) }, [
      text('Copyright', '© ПАО «ВымпелКом», 2026', 14, { x: 120, y: 1440, width: 400, height: 20 }, { id: 'copy' }),
    ]),
  ]);
}

/** Экран Android-приложения 360×800: статус-бар, верхний бар, контент, таб-бар. */
export function appScreen(): DesignIR {
  return ir('Home', 360, 800, [
    n('FRAME', { id: 'status', name: 'Status bar', bbox: { x: 0, y: 0, width: 360, height: 24 } }),
    instance('Top app bar', 'NavigationBar', { x: 0, y: 24, width: 360, height: 64 }, { id: 'nav', component: { key: 'k-nav', name: 'Platform=Android', componentSetName: 'NavigationBar', componentSetKey: 'set-nav', libraryName: '05_Carnica-UI-kit-APP', isRemote: true, variantProps: { Platform: 'Android' }, componentProps: {}, overriddenNodeIds: [] } }),
    text('Title', 'Мой тариф', 28, { x: 16, y: 104, width: 328, height: 36 }, { id: 'app-title' }),
    n('FRAME', { id: 'balance', name: 'Balance card', bbox: { x: 16, y: 156, width: 328, height: 160 } }, [
      text('Balance', '1 250 ₽', 32, { x: 32, y: 180, width: 200, height: 40 }, { id: 'balance-value' }),
    ]),
    instance('Button', 'Button', { x: 16, y: 340, width: 328, height: 40 }, { id: 'app-cta', component: { key: 'k-btn-app', name: 'Size=M', componentSetName: 'Button', componentSetKey: 'set-btn-app', libraryName: '05_Carnica-UI-kit-APP', isRemote: true, variantProps: { Size: 'M' }, componentProps: {}, overriddenNodeIds: [] } }),
    instance('Tab bar', 'TabBar', { x: 0, y: 720, width: 360, height: 56 }, { id: 'tabs', component: { key: 'k-tab', name: 'Platform=Android', componentSetName: 'TabBar', componentSetKey: 'set-tab', libraryName: '05_Carnica-UI-kit-APP', isRemote: true, variantProps: { Platform: 'Android' }, componentProps: {}, overriddenNodeIds: [] } }),
  ]);
}

/** Форма заявки 1440: поля и кнопка отправки. */
export function formPage(): DesignIR {
  return ir('Form', 1440, 900, [
    text('Form title', 'Оставьте заявку', 48, { x: 120, y: 80, width: 600, height: 60 }, { id: 'form-title' }),
    n('FRAME', { id: 'form', name: 'Form', bbox: { x: 120, y: 180, width: 600, height: 400 }, autoLayout: al('VERTICAL', 16) }, [
      instance('Input name', 'Input', { x: 120, y: 180, width: 600, height: 56 }, { id: 'in1' }),
      instance('Input phone', 'Input', { x: 120, y: 252, width: 600, height: 56 }, { id: 'in2' }),
      instance('Submit button', 'Button', { x: 120, y: 340, width: 240, height: 56 }, { id: 'submit' }),
    ]),
  ]);
}

/** Баннер 1200×630 с фото товара справа (для проверки кадрирования). */
export function productBanner(): DesignIR {
  return ir('Product', 1200, 630, [
    image('Phone photo', { x: 0, y: 0, width: 1200, height: 630 }, { id: 'bg-photo' }),
    instance('Logo', 'Logo', { x: 48, y: 48, width: 160, height: 48 }, { id: 'p-logo' }),
    text('Title', 'Новый смартфон в рассрочку', 56, { x: 48, y: 200, width: 520, height: 140 }, { id: 'p-title' }),
    instance('Button', 'Button', { x: 48, y: 480, width: 240, height: 64 }, { id: 'p-cta' }),
  ]);
}
