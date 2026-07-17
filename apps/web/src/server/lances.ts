/**
 * O que é um LANCE — a regra, num lugar só.
 *
 * Existe porque ela já divergiu: a rota REST (`/api/rooms/:id`) tinha o filtro
 * por delta e o servidor de sala (`server/rooms.ts`) tinha o ingênuo. Resultado
 * na tela: "37’ Chute · 37’ Chute · 37’ Chute · 37’ Chute" e "36’ Cartão amarelo"
 * três vezes, no replay real. Mesma pergunta, duas respostas, e a errada é a que
 * o fã via.
 *
 * ─── a regra, e por que ela não é óbvia ───
 *
 * A TxLINE ANUNCIA o lance e depois CONTABILIZA. Medido no England × Argentina:
 * escanteio no seq 76 com `corners 0-0`, e no seq 77 — 12s depois, mesmo minuto —
 * com `corners 1-0`. São dois eventos de verdade, com seq diferente; nenhum é
 * lixo. Mas é UM escanteio.
 *
 * Então: quem tem contador, vale o DELTA do contador. É a mesma lição do gol
 * (nove ações `goal` para três gols; contar ação daria 9 × 2 num jogo que
 * terminou 1 × 2), generalizada.
 *
 * A prova de que fecha: o número de lances de cada tipo bate com o placar final
 * daquele contador — 7 escanteios para 1×6, 4 cartões para 1×3.
 */

import type { ScoreEvent } from '@palpitei/core';

/** Só isto vira lance: dos 962 eventos, 194 são `safe_possession`. */
export const LANCES = new Set([
  'kickoff',
  'goal',
  'yellow_card',
  'red_card',
  'corner',
  'shot',
  'substitution',
  'injury',
  'additional_time',
  'halftime_finalised',
  'game_finalised',
]);

/**
 * Lance contado → a chave do contador em `totals`.
 *
 * SÓ ENTRA AQUI CHAVE QUE O FEED REALMENTE TRAZ. Medido no England × Argentina,
 * o `Total` inteiro é `{ Goals, Corners, YellowCards }` — e mais nada. O tipo
 * avisa que "o conjunto varia por partida", e varia mesmo.
 *
 * Isto não é preciosismo: eu já pus `shot: 'Shots'` aqui. Como o Total não tem
 * `Shots`, o `?? 0` (que é a leitura CERTA para chave ausente — G7) fazia o
 * contador nunca andar, e os 16 chutes SUMIRAM do feed. É o G7 na letra: "chave
 * ausente = zero → linhas somem da tela". Chute não tem contador; vai pela
 * deduplicação por clock, como o kickoff.
 *
 * `red_card` fica: não houve nenhum nesta partida, mas a chave existe no
 * vocabulário do feed e some pelo mesmo caminho do YellowCards se houver.
 *
 * Gol fica FORA de propósito: `ev.goals` já é `Total.Goals`, tipado, e é o campo
 * que os motores usam. Duas leituras do mesmo número são duas verdades.
 */
const CONTADORES: Record<string, string> = {
  corner: 'Corners',
  yellow_card: 'YellowCards',
  red_card: 'RedCards',
};

export type FiltroDeLances = (ev: ScoreEvent, mudouPlacar: boolean) => boolean;

/**
 * O kickoff vem EM PAR (medido na 18241006: seq 15 e 17, Δ2,8s; 2º tempo idem,
 * seq 428/430). No feed da tela o filtro abaixo já o dedupa; no MOTOR, a 12× o
 * guard de janela mínima ignora o segundo — mas a 1× (ao vivo) o guard
 * `teveTempoMinimoNoReplay` é sempre true e o par fecharia a final_result ~3s
 * depois de abrir. O ramo live dedupa o kickoff ANTES do motor, com a MESMA
 * régua do filtro de lances (`${action}:${clockSeconds ?? ts}`) — a regra mora
 * aqui para não nascer uma segunda cópia dela.
 *
 * Devolve true quando ESTE evento é um kickoff repetido no mesmo instante de
 * jogo. Só kickoff: qualquer outra ação passa reto (o resto do dedupe da tela
 * continua no filtro de lances; o motor quer ver tudo que não é kickoff duplicado).
 */
export function criarDedupeDeKickoff(): (ev: ScoreEvent) => boolean {
  const vistos = new Set<string>();
  return (ev) => {
    if (ev.action !== 'kickoff') return false;
    const id = `${ev.action}:${ev.clockSeconds ?? ev.ts}`;
    if (vistos.has(id)) return true;
    vistos.add(id);
    return false;
  };
}

/**
 * Um filtro com memória: guarda a régua de cada contador. Cada sala/replay cria
 * o seu — a régua é da partida, não do processo.
 */
export function criarFiltroDeLances(): FiltroDeLances {
  const contado: Record<string, { p1: number; p2: number }> = {};
  const vistos = new Set<string>();

  return (ev, mudouPlacar) => {
    if (!LANCES.has(ev.action)) return false;

    if (ev.action === 'goal') {
      // `goal` que não moveu o placar é VAR/amend, não gol.
      return mudouPlacar;
    }

    const chave = CONTADORES[ev.action];
    if (chave) {
      // Sem bloco Score não dá para saber se o contador andou — e o ANÚNCIO vem
      // justamente antes da contagem. Espera o evento que conta.
      if (!ev.hasScore) return false;
      const agora = {
        // Chave ausente no Total é ZERO (G7) — o oposto do bloco Score ausente
        // (A4). O mesmo feed exige as duas leituras.
        p1: ev.totals?.p1?.[chave] ?? 0,
        p2: ev.totals?.p2?.[chave] ?? 0,
      };
      // A régua começa em zero porque a partida começa em zero: sem isto o
      // primeiro escanteio do jogo seria engolido como "calibração".
      const antes = contado[chave] ?? { p1: 0, p2: 0 };
      contado[chave] = agora;
      return agora.p1 !== antes.p1 || agora.p2 !== antes.p2;
    }

    // Sem contador (kickoff, apito): duplicam no mesmo instante de jogo. Um por
    // clock basta — o kickoff do 1º tempo vem em par, seq 15 e 17.
    const id = `${ev.action}:${ev.clockSeconds ?? ev.ts}`;
    if (vistos.has(id)) return false;
    vistos.add(id);
    return true;
  };
}
