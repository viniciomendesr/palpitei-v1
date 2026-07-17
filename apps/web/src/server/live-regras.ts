/**
 * As regras PURAS do canal ao vivo — separadas de live.ts para serem testáveis
 * sem banco nem stream. Duas decisões moram aqui:
 *
 * 1. A 3ª TRAVA. O getter do pacote txline é `trim(...) !== "false"` — apagar a
 *    linha do env LIGA o ingest (CONTEXT §10). A trava da aplicação inverte o
 *    default: só liga com `TXLINE_LIVE_INGEST === 'true'` LITERAL e uma fixture
 *    explícita. Env ausente = desligado, que é o único default aceitável para um
 *    caminho que consome a devnet.
 *
 * 2. O FILTRO DE MERCADO do roteamento. No replay ele vive na SQL da projeção
 *    (`oddsRepo.listReplayByFixture`: só 1X2 de jogo inteiro). `normalizeOdds`
 *    aceita QUALQUER mercado — over/under, handicap, 1X2 de período — e
 *    `atualizarPct1x2` não checa mercado: rotear tudo corromperia o pct da
 *    final_result em silêncio e afogaria o explicador (~9× mais eventos; a
 *    família das 115 explicações fantasma do v0). O critério é o MESMO da
 *    projeção, pela MESMA constante — não uma cópia da string.
 */

import type { NormEvent } from '@palpitei/core';
import { MERCADO_1X2 } from '@palpitei/db';

type EnvDoCanal = { TXLINE_LIVE_INGEST?: string; LIVE_FIXTURE_ID?: string } & Record<
  string,
  string | undefined
>;

/** A fixture do canal ao vivo, ou null se as travas não abriram. */
export function fixtureAoVivo(env: EnvDoCanal): number | null {
  if (env.TXLINE_LIVE_INGEST !== 'true') return null;
  const id = Number(env.LIVE_FIXTURE_ID);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** O evento terminal que torna a fixture apta para settlement. */
export function eventoEncerraPartida(ev: NormEvent): boolean {
  return ev.kind === 'score' && (ev.action === 'game_finalised' || (ev.statusId === 100 && ev.period === 100));
}

export type ClasseDoEvento = 'rotear' | 'outra_fixture' | 'fora_do_mercado';

/**
 * O que fazer com um NormEvent recém-chegado do stream, do ponto de vista da
 * SALA. (A persistência não passa por aqui: score grava sempre, e odds grava
 * tudo da fixture — o `upsertManyRaw` filtra com o mesmo `eh1x2JogoInteiro`.)
 */
export function classificarParaSala(ev: NormEvent, fixtureId: number): ClasseDoEvento {
  if (ev.fixtureId !== fixtureId) return 'outra_fixture';
  if (ev.kind === 'odds' && (ev.marketType !== MERCADO_1X2 || ev.marketPeriod != null)) {
    return 'fora_do_mercado';
  }
  return 'rotear';
}
