/**
 * Invariantes de forma — o que precisa bater ANTES de a tela mapear.
 *
 * CONTEXT.md §3: "Antes de mapear arrays paralelos (`PriceNames` ↔ `Prices` ↔
 * `Pct`), confira o tamanho dos três." A sala tem exatamente esse desenho, com
 * três estruturas indexadas em paralelo e NENHUMA delas dona da outra:
 *
 *   CHALLENGES[i]        a mecânica (xp, opção certa, optIds, pct)
 *   dicts[lang].ch[i]    o texto (enunciado, rótulo de cada opção)
 *   spec.pct[optId]      a chance de cada opção
 *
 * Se qualquer par sair de sincronia o modo de falha é SILENCIOSO, que é o pior
 * jeito de descobrir: `CHALLENGES[ci]` ou `t.ch[ci]` volta undefined e a sala
 * inteira renderiza `null` — tela preta, sem erro, sem log, na frente do jurado.
 * Um rótulo faltando some do botão; uma chance faltando some do botão.
 *
 * Por isso a checagem é ruidosa e roda no import, em desenvolvimento: quem
 * quebrar a forma descobre no primeiro reload, não na demo ao vivo. Em produção
 * ela não roda — a essa altura o dado vem do motor, e é lá que a validação mora.
 */

import { dicts, type Lang } from './i18n';
import { CHALLENGES } from './mock';

/** Confere que mecânica e texto descrevem o MESMO conjunto de desafios e opções. */
export function checkChallengeShape(): string[] {
  const problems: string[] = [];

  for (const lang of Object.keys(dicts) as Lang[]) {
    const ch = dicts[lang].ch;

    // 1. Os dois arrays paralelos têm o mesmo tamanho?
    if (ch.length !== CHALLENGES.length) {
      problems.push(
        `[${lang}] ch tem ${ch.length} desafios e CHALLENGES tem ${CHALLENGES.length}: ` +
          `a sala renderiza null (tela preta, sem erro) no índice que faltar.`,
      );
    }

    // 2. Cada opção da mecânica tem rótulo, e cada rótulo tem opção?
    CHALLENGES.forEach((spec, i) => {
      const text = ch[i];
      if (!text) return; // já reportado acima

      for (const id of spec.optIds) {
        if (!(id in text.opts)) {
          problems.push(`[${lang}] desafio ${i}: a opção "${id}" não tem rótulo — o botão sai vazio.`);
        }
        // pct AUSENTE é legítimo (G8: ausente ≠ 0%) — a tela omite o número.
        // O que não pode é a chave existir apontando pra lugar nenhum.
      }

      for (const id of Object.keys(text.opts)) {
        if (!spec.optIds.includes(id)) {
          problems.push(`[${lang}] desafio ${i}: o rótulo "${id}" não tem opção — texto morto.`);
        }
      }

      // 3. A opção certa é uma das ofertadas? Senão o desafio é inganhável.
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
    // console.error e não throw: a forma quebrada de UM desafio não deve derrubar
    // o app inteiro — mas também não pode passar despercebida.
    console.error('[palpitei] forma dos desafios inconsistente:\n' + problems.join('\n'));
  }
}
