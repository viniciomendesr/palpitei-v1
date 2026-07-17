/**
 * GET /api/rooms/:id/stream — a sala, ao vivo, por SSE. Exige login.
 *
 * O CONTEXT §8 herdou do v0 um `WS /ws`. Route handler do Next não faz WebSocket
 * (não há acesso ao upgrade do socket), e SSE entrega o mesmo contrato para o
 * que esta sala precisa: o servidor fala, o cliente escuta. Palpite é POST — não
 * precisa de canal de subida. Trocar por WS depois não mexe na tela.
 *
 * Os eventos são os mesmos nomes do §8: score_event, question_open,
 * question_closed, question_resolved, game_end, replay_done.
 */

import { PrivyClient } from '@privy-io/server-auth';
import { createDb, createUserRepo } from '@palpitei/db';
import { abrirSala, assinar, estadoDaSalaPara, rankingDaSala, registrarApelido } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? '';

async function didVerificado(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization') ?? '';
  const url = new URL(req.url);
  // EventSource não manda header. O token vem na query, e é por isso que este
  // endpoint é só LEITURA: token em URL entra em log de proxy e em histórico.
  // Quem muda estado (palpite) é POST, com o Bearer no header.
  const token = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : (url.searchParams.get('token') ?? '');
  if (!token || !APP_ID || !APP_SECRET) return null;
  try {
    const { userId } = await new PrivyClient(APP_ID, APP_SECRET).verifyAuthToken(token);
    return userId ?? null;
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const did = await didVerificado(req);
  if (!did) {
    return Response.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }

  const fixtureId = Number((await params).id);
  if (!Number.isFinite(fixtureId)) {
    return Response.json({ error: 'fixture inválida' }, { status: 400 });
  }

  const sala = await abrirSala(fixtureId);
  if (!sala) {
    return Response.json({ error: 'partida não encontrada no cache' }, { status: 404 });
  }

  // O id interno do fã: e o `question_resolved` do §8 manda `gained`, que e o XP
  // DELE. Sem saber quem esta ouvindo, nao da pra dizer quanto ELE ganhou.
  const dbUser = createDb();
  let userId: string | null = null;
  try {
    const user = await createUserRepo(dbUser).findOrCreateByPrivyDid(did);
    userId = user.id;
    // O apelido FRESCO do banco entra na sala já na chegada — sem isto o
    // ranking só aprendia o nome quando uma pergunta resolvia, e quem escolheu
    // o apelido depois do primeiro palpite ficava "sem apelido" até lá.
    registrarApelido(sala, user.id, user.handle);
  } catch {
    // Sem usuario, o fa ainda assiste — so nao recebe XP proprio.
  } finally {
    await dbUser.close?.();
  }

  const enc = new TextEncoder();
  let desassinar = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const mandar = (msg: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(msg)}\n\n`));
        } catch {
          // Conexão já fechada: o cleanup abaixo resolve.
        }
      };

      // O primeiro pacote é o estado INTEIRO, na voz DESTE fã: placar e feed
      // (sem isto quem chega no minuto 60 vê 0 × 0 até o próximo lance), MAIS o
      // que ele já respondeu e o que os palpites dele renderam — um F5 derruba
      // a tela, não o palpite, e o recibo tem que renascer junto.
      mandar(estadoDaSalaPara(sala, userId));
      // Pelo mesmo motivo, o ranking de agora: ele só é republicado quando uma
      // pergunta resolve, e sem este pacote quem chega no minuto 60 vê a aba
      // vazia — "ninguém pontuou" — até o próximo desafio cair.
      mandar(rankingDaSala(sala, userId));
      desassinar = assinar(sala, { userId, enviar: mandar });

      // O abort do cliente é o único sinal confiável de que ele foi embora.
      req.signal.addEventListener('abort', () => {
        desassinar();
        try {
          controller.close();
        } catch {
          // já fechado
        }
      });
    },
    cancel() {
      desassinar();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx/proxy adora bufferizar SSE até o stream parecer travado.
      'X-Accel-Buffering': 'no',
    },
  });
}
