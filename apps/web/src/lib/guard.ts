'use client';

/**
 * Guarda de rota: sem sessão, volta pro login.
 *
 * Devolve `false` enquanto a sessão não hidratou — a tela deve renderizar null
 * nesse intervalo. Sem isso, o primeiro render (servidor, sem sessionStorage)
 * diverge do segundo (cliente, com sessão) e o React acusa hydration mismatch.
 *
 * Isto é conveniência de navegação, NÃO segurança. A autorização de verdade
 * acontece no servidor, no Bearer da Privy — nunca no que o cliente diz ser.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from './session';

export function useRequireSession(): boolean {
  const { session, hydrated } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !session) router.replace('/');
  }, [hydrated, session, router]);

  return hydrated && !!session;
}
