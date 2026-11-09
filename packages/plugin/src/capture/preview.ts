import type { DesignIR } from '@beeline-resize/shared';

/** Превью исходника (spec figma-source-capture → Source preview capture). */

export const PREVIEW_MAX_SIDE = 1600;

export function previewScale(width: number, height: number): number {
  return Math.min(1, PREVIEW_MAX_SIDE / Math.max(width, height));
}

export async function exportPreview(node: SceneNode): Promise<Uint8Array> {
  const scale = previewScale(node.width, node.height);
  return node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
}

export interface DataPolicy {
  allowPreview: boolean;
  maskTexts: boolean;
}

export interface AdaptSourcePayload {
  ir: DesignIR;
  /** PNG в base64, только если разрешено политикой. */
  preview?: string;
}

/**
 * Собирает исходник для запроса на бэкенд. При запрещённом превью
 * растровые данные не попадают в запрос, даже если были сняты.
 */
export async function buildSourcePayload(
  ir: DesignIR,
  policy: DataPolicy,
  takePreview: () => Promise<Uint8Array>,
): Promise<AdaptSourcePayload> {
  if (!policy.allowPreview) return { ir };
  const png = await takePreview();
  return { ir, preview: toBase64(png) };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 без btoa/Buffer — в sandbox плагина их нет. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}
