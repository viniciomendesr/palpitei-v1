/**
 * Development-only validation for parallel challenge, translation, and chance
 * structures. A mismatch would otherwise render incomplete UI without an error.
 */

import { dicts, type Lang } from './i18n';
import { CHALLENGES } from './mock';

/** Checks that mechanics and translations describe the same challenges and options. */
export function checkChallengeShape(): string[] {
  const problems: string[] = [];

  for (const lang of Object.keys(dicts) as Lang[]) {
    const ch = dicts[lang].ch;

    // Parallel arrays must have the same length.
    if (ch.length !== CHALLENGES.length) {
      problems.push(
        `[${lang}] ch tem ${ch.length} desafios e CHALLENGES tem ${CHALLENGES.length}: ` +
          `a sala renderiza null (tela preta, sem erro) no índice que faltar.`,
      );
    }

    // Each mechanics option needs a label, and every label needs an option.
    CHALLENGES.forEach((spec, i) => {
      const text = ch[i];
      if (!text) return; // Already reported above.

      for (const id of spec.optIds) {
        if (!(id in text.opts)) {
          problems.push(`[${lang}] desafio ${i}: a opção "${id}" não tem rótulo — o botão sai vazio.`);
        }
        // A missing percentage is valid; a dangling option key is not.
      }

      for (const id of Object.keys(text.opts)) {
        if (!spec.optIds.includes(id)) {
          problems.push(`[${lang}] desafio ${i}: o rótulo "${id}" não tem opção — texto morto.`);
        }
      }

      // The correct option must be one of the offered options.
      if (!spec.optIds.includes(spec.correct)) {
        problems.push(
          `[${lang}] desafio ${i}: a resposta certa "${spec.correct}" não está entre as opções — ` +
            `ninguém consegue acertar.`,
        );
      }
    });
  }

  return problems;
}

if (process.env.NODE_ENV !== 'production') {
  const problems = checkChallengeShape();
  if (problems.length > 0) {
    // Report shape errors without preventing the rest of the app from loading.
    console.error('[palpitei] forma dos desafios inconsistente:\n' + problems.join('\n'));
  }
}
