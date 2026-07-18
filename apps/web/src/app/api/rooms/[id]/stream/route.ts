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

import { createLobbyRepo, createUserRepo } from '@palpitei/db';
import { createDb } from '@/server/db';
import { getLobby } from '@/server/lobbies';
import { podeAcessarLobbyIniciado } from '@/server/lobby-acesso';
import { PULSO, iniciarPulso } from '@/server/pulso';
import { consumirTicketSse } from '@/server/sse-ticket';
import {
  abrirSala,
  assinar,
  chaveDaSala,
  estadoDaSalaPara,
  parsePartyId,
  parseRoomId,
  rankingDaSala,
  registrarApelido,
} from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // `treino-18241006` = a mesma partida, XP zero, nada persistido. A regra de
  // parse é uma só (parseRoomId) — a mesma do POST do palpite.
  const rawRoomId = (await params).id;
  const roomId = parseRoomId(rawRoomId);
  if (!roomId) {
    return Response.json({ error: 'sala inválida' }, { status: 400 });
  }

  const partyId = parsePartyId(new URL(req.url).searchParams.get('party'));
  if (!partyId) {
    return Response.json({ error: 'código do grupo inválido' }, { status: 400 });
  }
  // O ticket foi emitido por um POST com Authorization Bearer e é de uso
  // único. A URL de SSE nunca recebe o token de longa duração da Privy.
  const did = consumirTicketSse(new URL(req.url).searchParams.get('ticket'), {
    purpose: 'room',
    roomId: rawRoomId,
    partyId,
  });
  if (!did) {
    return Response.json(
      { error: 'sem sessão verificada — o modo demo não usa esta rota' },
      { status: 401 },
    );
  }
  // O id interno do fã: e o `question_resolved` do §8 manda `gained`, que e o XP
  // DELE. A associação persistida, e não o Map de presença do processo, autoriza
  // a conexão: quem saiu do lobby não pode reutilizar a URL antiga.
  const dbUser = createDb();
  let userId: string;
  let userHandle: string | null;
  try {
    const user = await createUserRepo(dbUser).findByPrivyDid(did);
    if (!user) return Response.json({ error: 'você não participa desse lobby' }, { status: 403 });
    const persistent = await createLobbyRepo(dbUser).findForMember(partyId, user.id);
    if (!podeAcessarLobbyIniciado(persistent, roomId)) {
      return Response.json({ error: 'você não participa desse lobby' }, { status: 403 });
    }
    userId = user.id;
    userHandle = user.handle;
  } catch (e) {
    console.error('[palpitei] autorização do stream falhou:', e instanceof Error ? e.message : e);
    return Response.json({ error: 'não deu para verificar seu acesso ao lobby' }, { status: 500 });
  } finally {
    await dbUser.close?.();
  }

  // A autorização persistida aconteceu antes de tocar na sala em memória. Agora
  // ela só decide se o runner do processo está disponível.
  const lobby = getLobby(chaveDaSala(roomId.fixtureId, roomId.treino, partyId));
  if (!lobby || lobby.phase !== 'started') {
    return Response.json({ error: 'a partida ainda não começou no lobby' }, { status: 409 });
  }
  const sala = await abrirSala(roomId.fixtureId, roomId.treino, partyId);
  if (!sala) return Response.json({ error: 'partida não encontrada no cache' }, { status: 404 });

  // O apelido FRESCO do banco entra na sala já na chegada — sem isto o ranking só
  // aprendia o nome quando uma pergunta resolvia.
  registrarApelido(sala, userId, userHandle);

  const enc = new TextEncoder();
  let desassinar = () => {};
  let pararPulso = () => {};

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

      // O pulso: comentário SSE a cada ~20s. O stream só fala quando há lance,
      // e AO VIVO há minutos de silêncio — proxy (o edge do Railway incluído)
      // derruba conexão SSE ociosa. Ver src/server/pulso.ts. O enqueue em
      // conexão morta lança, e o iniciarPulso engole: o abort abaixo limpa.
      pararPulso = iniciarPulso(() => controller.enqueue(enc.encode(PULSO)));

      // O abort do cliente é o único sinal confiável de que ele foi embora.
      req.signal.addEventListener('abort', () => {
        pararPulso();
        desassinar();
        try {
          controller.close();
        } catch {
          // já fechado
        }
      });
    },
    cancel() {
      pararPulso();
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
