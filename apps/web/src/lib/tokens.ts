/**
 * Acesso tipado aos tokens de peso da fonte.
 *
 * Por que existe: `fontWeight` do csstype só aceita número, 'bold'/'normal' e os
 * globais — não aceita `var(--*)`. Sem isto, toda tela precisaria de um cast, ou
 * (pior) alguém escreveria o número na mão. O cast mora aqui, uma vez.
 *
 * ATENÇÃO: `--fw-medium` é **600**, não os 500 de costume. Escrever 500 achando
 * que é "medium" dá um peso que não existe na escala — o mockup faz isso em
 * alguns pontos e nós NÃO reproduzimos o engano: onde ele diz 500, aqui é
 * fw.medium.
 *
 * Estes cinco são a escala inteira. Não existe outro peso.
 */

import type { CSSProperties } from 'react';

type FontWeight = CSSProperties['fontWeight'];

const token = (name: string): FontWeight => `var(${name})` as unknown as FontWeight;

export const fw = {
  /** 400 */
  regular: token('--fw-regular'),
  /** 600 — não 500 */
  medium: token('--fw-medium'),
  /** 700 */
  bold: token('--fw-bold'),
  /** 800 */
  heavy: token('--fw-heavy'),
  /** 900 — o display e a marca */
  black: token('--fw-black'),
} as const;
