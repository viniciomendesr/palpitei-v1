/**
 * A identidade do fã, do DID verificado até o objeto que o motor aceita.
 *
 * ─── por que existe um adaptador entre db.User e core.User ───
 *
 * Os dois tipos divergem, e a divergência é SEMÂNTICA, não desleixo:
 *
 *   db.User.handle       : string | null   ← NULL até o onboarding perguntar
 *   db.User.wallet       : string | null   ← NULL = o fã NÃO TEM carteira
 *   db.User.walletSource : WalletSource | null
 *   core.User.*          : exigem valor
 *
 * O banco guarda NULL de propósito, e o comentário dele explica: colapsar NULL
 * para 'simulated' na leitura inventaria a origem que o schema recusa a
 * inventar, e ainda marcaria um fã real de Google como conta de teste da §5.1.
 * Então este adaptador NÃO coage — ele grita.
 *
 * O motor de perguntas lê apenas `id`, `xp` e `level` (place() usa user.id;
 * addXp muta xp/level). Nada de carteira. Mas o tipo exige, e preencher com
 * mentira só para compilar é como o requisito "sign up through Solana" cai
 * calado.
 */

import type { User as CoreUser } from '@palpitei/core';
import type { User as DbUser } from '@palpitei/db';

/**
 * O fã do banco no formato que o motor aceita.
 *
 * @throws se o fã não tem carteira Solana. Isso é a regressão E2 EM PESSOA: com
 * `create_on_login: 'users-without-wallets'` (verificado ligado na app de
 * produção) todo login social provisiona uma carteira embutida. Se um fã chegar
 * aqui sem carteira, a config da Privy regrediu para o default `'off'` e o
 * requisito nº 1 da trilha caiu — em silêncio, como o E2 sempre cai. Melhor
 * estourar aqui, no servidor, que descobrir na frente do jurado.
 */
export function paraCore(u: DbUser): CoreUser {
  if (!u.wallet || !u.walletSource) {
    throw new Error(
      `[E2] fã ${u.id} sem carteira Solana — a Privy não provisionou. ` +
        `Confira create_on_login na config REAL (npm run privy:doctor).`,
    );
  }
  return {
    id: u.id,
    // NULL aqui é normal: o apelido é escolha do fã e vem no onboarding (E12).
    // O motor não lê este campo; string vazia diz "ainda não escolheu" sem mentir.
    handle: u.handle ?? '',
    wallet: u.wallet,
    walletSource: u.walletSource,
    privyId: u.privyId,
    linkedWallets: u.linkedWallets,
    xp: u.xp,
    level: u.level,
    balanceCents: u.balanceCents,
    createdAt: u.createdAt,
  };
}

/** A carteira Solana do fã, lida da Privy no SERVIDOR — nunca do que o cliente diz. */
export function carteiraSolana(
  contas: { type: string; chainType?: string; walletClientType?: string; address?: string }[],
): { wallet: string; walletSource: 'privy_embedded' | 'external' } | null {
  const solanas = contas.filter((a) => a.type === 'wallet' && a.chainType === 'solana');
  // A embutida primeiro: é a que a Privy provisiona no login social, e é ela que
  // cumpre "sign up through Solana" para quem entrou pelo Google.
  const embutida = solanas.find((w) => w.walletClientType === 'privy');
  if (embutida?.address) return { wallet: embutida.address, walletSource: 'privy_embedded' };
  const externa = solanas.find((w) => w.address);
  if (externa?.address) return { wallet: externa.address, walletSource: 'external' };
  return null;
}
