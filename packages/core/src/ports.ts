import type { Bet, Prediction, User } from "./types.ts";

/**
 * As dependências de PERSISTÊNCIA que os motores precisam — injetadas, nunca
 * importadas. No v0 os motores falavam com o singleton `store` (memória), e o
 * XP sumia no primeiro restart. Aqui o mesmo motor roda com o repositório
 * Postgres (produção) e com um fake em memória (testes), sem tocar em domínio.
 *
 * Regra: nada aqui devolve dado. Os motores mandam gravar; quem lê é a aplicação.
 */
export type EnginePorts = {
  /** Gera um id único com o prefixo dado (ex.: "q" -> "q_1a2b"). */
  uid(prefix: string): string;

  savePrediction(p: Prediction): void;

  saveBet(b: Bet): void;

  /**
   * Chamado quando o motor MUTA o usuário (crédito de XP, débito/crédito de
   * saldo). Opcional: o fake em memória já enxerga a mutação pelo próprio
   * objeto, mas o repositório Postgres precisa deste gancho — sem ele o XP
   * vive só na memória do processo e some no restart.
   */
  saveUser?(u: User): void;
};
