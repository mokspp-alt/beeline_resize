/**
 * Кадрирование изображения по фокусной точке (spec layout-adaptation → Image focal cropping).
 * Возвращает imageTransform для scaleMode CROP: видимое окно изображения в долях 0..1.
 */
export type Transform = [[number, number, number], [number, number, number]];

export function cropTransform(
  nodeW: number,
  nodeH: number,
  imgW: number,
  imgH: number,
  focal: { x: number; y: number },
): Transform {
  // как FILL: изображение покрывает узел целиком
  const scale = Math.max(nodeW / imgW, nodeH / imgH);
  const fx = Math.min(1, nodeW / scale / imgW);
  const fy = Math.min(1, nodeH / scale / imgH);
  const ox = clamp(focal.x - fx / 2, 0, 1 - fx);
  const oy = clamp(focal.y - fy / 2, 0, 1 - fy);
  return [
    [fx, 0, ox],
    [0, fy, oy],
  ];
}

/** Видимое окно изображения: [x0, x1] × [y0, y1] в долях. */
export function visibleWindow(t: Transform) {
  return { x0: t[0][2], x1: t[0][2] + t[0][0], y0: t[1][2], y1: t[1][2] + t[1][1] };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
