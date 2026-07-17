/**
 * A leitura de chance da sala — os pedaços PUROS do fio odds → tela.
 *
 * Vive fora de rooms.ts pelo mesmo motivo que lances.ts: é a lógica testável
 * (mescla da linha do tempo, tradução de nome do feed, cap do histórico) sem o
 * processo da sala em volta. rooms.ts só liga os fios.
 */

import type { NormEvent, OddsEvent, ScoreEvent } from '@palpitei/core';

/**
 * Uma explicação de cotação como a SALA a guarda e o §8 a transmite. `text` é a
 * frase pt que o core já emite — fallback/log; a tela redige a própria frase
 * bilíngue pelos campos estruturados.
 */
export type LeituraDeChance = {
  ts: number;
  minute: number | null;
  priceName: string;
  fromPct: number;
  toPct: number;
  /** A causa em forma ('goal', 'corner', …) — ausente sem lance na janela. */
  contextAction?: string;
  text: string;
};

/** O teto do histórico que viaja no room_state. */
export const MAX_LEITURAS = 60;

/**
 * Mescla placar e cotações numa linha do tempo só, por ts. NO EMPATE, o placar
 * vem ANTES: o explicador precisa do lance como contexto ANTES da cotação que
 * ele move ("subiu depois do gol" só sai se o gol já passou por ele).
 *
 * É uma mescla de dois cursores, não um sort: a série de placar segue a ordem
 * de seq — que é a verdade dela — mesmo quando o ts vem fora de ordem (A3).
 * Um sort por ts reordenaria lances entre si.
 */
export function mesclarLinhaDoTempo(placar: ScoreEvent[], odds: OddsEvent[]): NormEvent[] {
  const linha: NormEvent[] = [];
  let i = 0;
  let j = 0;
  while (i < placar.length && j < odds.length) {
    if (placar[i]!.ts <= odds[j]!.ts) linha.push(placar[i++]!);
    else linha.push(odds[j++]!);
  }
  while (i < placar.length) linha.push(placar[i++]!);
  while (j < odds.length) linha.push(odds[j++]!);
  return linha;
}

/** O pct atual de cada opção do 1X2. Chave ausente = o feed ainda não disse. */
export type Pct1x2 = { p1?: number; draw?: number; p2?: number };

/**
 * Nome do preço no feed → id da opção da pergunta final_result.
 * O 1X2 real manda "part1"/"draw"/"part2"; os aliases ficam por segurança
 * (mesma lista do describe() do explicador). Desconhecido é null — nunca um
 * chute: pct inventado com cara de real é o G6.
 */
export function idDaOpcao1x2(priceName: string): keyof Pct1x2 | null {
  const n = priceName.toLowerCase();
  if (n === 'part1' || n === '1' || n === 'home') return 'p1';
  if (n === 'draw' || n === 'x') return 'draw';
  if (n === 'part2' || n === '2' || n === 'away') return 'p2';
  return null;
}

/**
 * Registra no mapa o último 1X2 conhecido. Só mexe nas opções que ESTE evento
 * cita: as outras seguem valendo (a última leitura de cada uma é a verdade
 * dela, como nos totais). Nome que não é opção do 1X2 não entra.
 */
export function atualizarPct1x2(mapa: Pct1x2, ev: OddsEvent): void {
  for (const price of ev.prices) {
    const opcao = idDaOpcao1x2(price.name);
    if (opcao) mapa[opcao] = price.pct;
  }
}

/** Mais recente PRIMEIRO, com teto: a sala não é um log infinito. */
export function registrarLeitura(chances: LeituraDeChance[], leitura: LeituraDeChance): void {
  chances.unshift(leitura);
  if (chances.length > MAX_LEITURAS) chances.length = MAX_LEITURAS;
}
