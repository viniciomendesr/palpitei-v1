import type { SalaResultado } from './useSala';

export function calcularResumoDaSala(
  resultados: SalaResultado[],
  rankingCount: number,
  chancesCount: number,
) {
  return {
    picks: resultados.length,
    hits: resultados.filter(
      (result) =>
        !result.voidReason &&
        result.correctOptionId !== undefined &&
        result.minhaEscolha === result.correctOptionId,
    ).length,
    xp: resultados.reduce((total, result) => total + result.gained, 0),
    players: rankingCount,
    movements: chancesCount,
  };
}
