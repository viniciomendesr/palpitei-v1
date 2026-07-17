/**
 * As duas coisas que toda rota autenticada faz: achar o DID verificado e
 * traduzir erro de domínio em status.
 *
 * Existe porque as rotas de liga são três e a alternativa era colar o mesmo
 * `didVerificado` em cada uma. O `/api/login` e o `/api/rooms/:id/predictions`
 * ainda têm a cópia local deles — não os toquei de propósito: outro agente mexe
 * nesses arquivos em paralelo, e mudança cosmética ali só criaria conflito de
 * merge sem consertar nada.
 */

import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? '';

/**
 * O DID do Bearer, ou null. NUNCA `body.userId` (CONTEXT §4): o v0 tinha um
 * resolveUser() que caía pro corpo quando não havia header, e atrás de link
 * público com ranking valendo isso é fraude de um curl.
 *
 * Sem APP_ID/APP_SECRET isto devolve null — e a rota responde 401. Falhar
 * fechado é o único jeito seguro: um ambiente sem credencial que "deixa passar"
 * é o buraco silencioso que só aparece em produção.
 */
export async function didVerificado(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token || !APP_ID || !APP_SECRET) return null;
  try {
    const { userId } = await new PrivyClient(APP_ID, APP_SECRET).verifyAuthToken(token);
    return userId ?? null;
  } catch {
    return null;
  }
}

/** Erro de domínio: as classes do @palpitei/db carregam `status` e `code`. */
function ehErroDeDominio(e: unknown): e is Error & { status: number; code: string } {
  return (
    e instanceof Error &&
    typeof (e as { status?: unknown }).status === 'number' &&
    typeof (e as { code?: unknown }).code === 'string'
  );
}

/**
 * Erro conhecido vira o status dele, com a mensagem em pt-BR que o fã lê.
 * Qualquer outra coisa vira 500 genérico — o `e.message` de um erro do Postgres
 * pode carregar SQL e nome de coluna, e isso não vai para a tela de ninguém.
 */
export function erroParaResposta(e: unknown, contexto: string): NextResponse {
  if (ehErroDeDominio(e)) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  console.error(`[palpitei] ${contexto} falhou:`, e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'não deu pra fazer isso agora' }, { status: 500 });
}
