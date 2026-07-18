/** Adapts verified database identities to the stricter core-user contract. */

import type { User as CoreUser } from '@palpitei/core';
import type { User as DbUser } from '@palpitei/db';

/** Converts a database user to a core user and rejects incomplete wallet identities. */
export function toCoreUser(u: DbUser): CoreUser {
  if (!u.wallet || !u.walletSource) {
    throw new Error(
      `[E2] fã ${u.id} sem carteira Solana — a Privy não provisionou. ` +
        `Confira create_on_login na config REAL (npm run privy:doctor).`,
    );
  }
  return {
    id: u.id,
    // Handles are optional until onboarding completes; the engine does not read this field.
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

/** Selects a Solana wallet from Privy-verified accounts, never from client input. */
export function findSolanaWallet(
  accounts: { type: string; chainType?: string; walletClientType?: string; address?: string }[],
): { wallet: string; walletSource: 'privy_embedded' | 'external' } | null {
  const solanaWallets = accounts.filter((account) => account.type === 'wallet' && account.chainType === 'solana');
  // Prefer the embedded wallet provisioned during social login.
  const embedded = solanaWallets.find((wallet) => wallet.walletClientType === 'privy');
  if (embedded?.address) return { wallet: embedded.address, walletSource: 'privy_embedded' };
  const external = solanaWallets.find((wallet) => wallet.address);
  if (external?.address) return { wallet: external.address, walletSource: 'external' };
  return null;
}
