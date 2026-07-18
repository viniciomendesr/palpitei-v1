/** Typed access to font-weight tokens; `medium` is 600, not 500. */

import type { CSSProperties } from 'react';

type FontWeight = CSSProperties['fontWeight'];

const token = (name: string): FontWeight => `var(${name})` as unknown as FontWeight;

export const fw = {
  /** 400 */
  regular: token('--fw-regular'),
  /** 600, not 500. */
  medium: token('--fw-medium'),
  /** 700 */
  bold: token('--fw-bold'),
  /** 800 */
  heavy: token('--fw-heavy'),
  /** 900 for display text and branding. */
  black: token('--fw-black'),
} as const;
