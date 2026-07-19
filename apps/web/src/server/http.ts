/** Shared authenticated-route helpers for verified DIDs and safe domain-error responses. */

import { NextResponse } from 'next/server';
import { PrivyClient } from '@privy-io/server-auth';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? '';

/** Returns the DID verified from the Bearer token, or null. Client-supplied identities are never accepted. */
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

/** Database domain errors carry public status and code fields. */
function ehErroDeDominio(e: unknown): e is Error & { status: number; code: string } {
  return (
    e instanceof Error &&
    typeof (e as { status?: unknown }).status === 'number' &&
    typeof (e as { code?: unknown }).code === 'string'
  );
}

/** Maps known domain errors and hides untrusted database details behind a generic 500. */
export function erroParaResposta(e: unknown, contexto: string): NextResponse {
  if (ehErroDeDominio(e)) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  console.error(`[palpitei] ${contexto} failed:`, e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'não deu pra fazer isso agora' }, { status: 500 });
}
