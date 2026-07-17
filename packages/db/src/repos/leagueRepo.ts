// leagueRepo — as ligas privadas.
//
// O que este arquivo substitui: um `session.leaguesCount++` no browser, que
// sumia no F5. Liga que some no refresh não é liga — é um número.
//
// Como todo repo daqui, este não sabe verificar token nenhum: quem chama já tem
// de ter passado pelo verifyAuthToken da Privy. O `ownerId`/`userId` que chega
// aqui SEMPRE saiu do DID verificado, nunca do corpo do request (CONTEXT §4).

import { randomInt } from 'node:crypto';
import type { Db, Executor, Row } from '../pool.js';
import type { League, LeagueMember, LeagueRole } from '../types.js';
import {
  InviteCodeInvalidError,
  LeagueLimitError,
  LeagueNameInvalidError,
  LeagueNotFoundError,
  UserNotFoundError,
  constraintName,
  isUniqueViolation,
} from '../errors.js';

/**
 * O free inclui 1 liga CRIADA (mockup: "O free inclui 1 liga · desbloqueie
 * ilimitadas"). Entrar na liga de um amigo não gasta esta cota — ver `joinByCode`.
 */
export const LIGAS_FREE = 1;

/**
 * Sem I, L, O, 0 e 1: o código é lido em voz alta e digitado por gente com
 * pressa. Tirar os sósias na GERAÇÃO é o que evita ter de adivinhar, na leitura,
 * se o fã quis dizer O ou 0 — adivinhar aí é que faz "código inválido" virar
 * mistério.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TAM_CODIGO = 6;

/** Quantas vezes tentar outro código antes de desistir. Ver `create`. */
const TENTATIVAS_CODIGO = 5;

const COLS = `
  l.id, l.name, l.owner_id, l.invite_code,
  (select count(*) from league_members m2 where m2.league_id = l.id)::int as member_count,
  extract(epoch from l.created_at) * 1000 as created_ms
`;

function mapLeague(r: Row): League {
  return {
    id: String(r.id),
    name: String(r.name),
    ownerId: String(r.owner_id),
    inviteCode: String(r.invite_code),
    // Contado no banco. É o campo que aposenta o "1 membro" fixo do dicionário.
    memberCount: Number(r.member_count),
    createdAt: Math.round(Number(r.created_ms)),
  };
}

/**
 * `randomInt` e não `Math.random()`: o código é a credencial de entrada da liga.
 * `Math.random()` é previsível o bastante para alguém enumerar códigos de fora —
 * e "liga privada" com convite adivinhável é privada só no nome.
 *
 * `randomInt` também é uniforme (rejeita amostra em vez de usar `% n`, que
 * enviesa os primeiros símbolos do alfabeto e encurta o espaço de busca na
 * prática).
 */
function gerarCodigo(): string {
  let saida = '';
  for (let i = 0; i < TAM_CODIGO; i++) saida += ALFABETO[randomInt(ALFABETO.length)];
  return saida;
}

/** Normaliza o que o fã digitou. Não "conserta" caractere nenhum — ver ALFABETO. */
export function normalizarCodigo(code: string): string {
  return String(code ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
}

/** Regras do nome da liga. Espelha o CHECK da 0002 — o banco é quem manda. */
export function validarNomeDeLiga(nome: string): string {
  // Espaço repetido e quebra de linha viram um espaço só: sem isto "Resenha  FC"
  // e "Resenha FC" viram duas ligas indistinguíveis na lista.
  const limpo = String(nome ?? '').replace(/\s+/g, ' ').trim();
  if (limpo.length < 3 || limpo.length > 24) {
    throw new LeagueNameInvalidError('o nome da liga precisa ter de 3 a 24 caracteres');
  }
  // Caractere de controle vira nome INVISÍVEL na lista: dois nomes diferentes
  // aparecem idênticos na tela e o fã não distingue a própria liga.
  //
  // O teste é por codepoint, e não por regex, de propósito: escape de controle
  // em regex literal é fácil de escrever errado, e o erro passa despercebido —
  // a regex compila e simplesmente não casa com nada.
  for (const ch of limpo) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f) {
      throw new LeagueNameInvalidError('o nome da liga tem caractere que não dá pra mostrar');
    }
  }
  return limpo;
}

export function createLeagueRepo(db: Db) {
  const repo = {
    async findById(id: string): Promise<League | null> {
      const rows = await db.query(`select ${COLS} from leagues l where l.id = $1`, [id]);
      return rows[0] ? mapLeague(rows[0]) : null;
    },

    /**
     * Busca protegida pela associação. Junta o antigo isMember()+findById()
     * numa ida ao Postgres e mantém o mesmo contrato de privacidade: sem linha
     * significa tanto "não existe" quanto "você não é membro".
     */
    async findForMember(id: string, userId: string): Promise<League | null> {
      const rows = await db.query(
        `select ${COLS}
           from leagues l
           join league_members acesso
             on acesso.league_id = l.id and acesso.user_id = $2
          where l.id = $1`,
        [id, userId]
      );
      return rows[0] ? mapLeague(rows[0]) : null;
    },

    /** Quantas ligas o fã CRIOU. É este número que o gate do free enxerga. */
    async countOwned(userId: string): Promise<number> {
      const rows = await db.query(`select count(*)::int as n from leagues where owner_id = $1`, [
        userId,
      ]);
      return Number(rows[0]?.n ?? 0);
    },

    /** Contagem barata para cabeçalho/estado; não carrega cada liga só para usar `.length`. */
    async countForUser(userId: string): Promise<number> {
      const rows = await db.query(
        `select count(*)::int as n from league_members where user_id = $1`,
        [userId]
      );
      return Number(rows[0]?.n ?? 0);
    },

    /**
     * As ligas do fã: as que ele criou E as que ele entrou por convite.
     *
     * `iLead` sai da tabela, não de `ownerId === userId` na tela: quem lidera é
     * um dado do banco, e o índice parcial da 0002 garante que é um só.
     */
    async listForUser(userId: string): Promise<(League & { iLead: boolean })[]> {
      const rows = await db.query(
        `select ${COLS}, m.role
           from league_members m
           join leagues l on l.id = m.league_id
          where m.user_id = $1
          order by m.joined_at, l.created_at`,
        [userId]
      );
      return rows.map((r) => ({ ...mapLeague(r), iLead: r.role === 'owner' }));
    },

    /**
     * Cria a liga e põe o dono como membro, numa transação só.
     *
     * ─── por que o `for update` na linha do fã ───
     *
     * O gate do free ("1 liga") é um contador, e contador lido fora de trava
     * perde corrida em silêncio: dois POST simultâneos do MESMO fã leem 0 os
     * dois, e os dois criam — o fã free fica com 2 ligas e ninguém vê erro
     * nenhum. É o mesmo defeito do SELECT-antes-de-UPDATE que o `setHandle`
     * recusa.
     *
     * Aqui não dá para delegar ao UNIQUE (o limite não é "um nome único", é uma
     * contagem, e ela muda quando o fã vira premium), então a trava é explícita:
     * as duas transações disputam a MESMA linha de `users`, e a segunda só lê o
     * contador depois que a primeira gravou. Sem a trava, o CHECK não existiria
     * em lugar nenhum do sistema — o gate seria só um `if` no browser.
     */
    async create(ownerId: string, name: string): Promise<League> {
      const nome = validarNomeDeLiga(name);

      const id = await db.withTx(async (tx: Executor) => {
        const [dono] = await tx.query(`select is_premium from users where id = $1 for update`, [
          ownerId,
        ]);
        if (!dono) throw new UserNotFoundError(ownerId);

        // Premium cria quantas quiser; o free tem a cota. A pergunta é feita ao
        // banco, sob a trava — nunca ao cliente.
        if (!dono.is_premium) {
          const [c] = await tx.query(`select count(*)::int as n from leagues where owner_id = $1`, [
            ownerId,
          ]);
          if (Number(c?.n ?? 0) >= LIGAS_FREE) throw new LeagueLimitError();
        }

        // O código é aleatório e o UNIQUE do banco é quem decide se colidiu —
        // não um "select where invite_code = ..." antes de gravar, que é a
        // corrida de sempre. Colisão em 31^6 é rara, e é justamente por ser rara
        // que ela não pode ser tratada com esperança: o SAVEPOINT deixa tentar
        // outro código sem derrubar a transação inteira.
        for (let tentativa = 0; tentativa < TENTATIVAS_CODIGO; tentativa++) {
          await tx.query('savepoint liga_codigo');
          try {
            const [liga] = await tx.query(
              `insert into leagues (name, owner_id, invite_code)
               values ($1, $2, $3)
               returning id`,
              [nome, ownerId, gerarCodigo()]
            );
            // `insert ... returning` sem linha só acontece se o insert não
            // gravou — e aí seguir em frente criaria a liga fantasma que a
            // tela lista e o banco não tem.
            if (!liga) throw new Error('[db] insert da liga não devolveu id');
            const novoId = String(liga.id);
            // O dono é membro como qualquer um: é o que faz `count(*)` ser o
            // número de gente na liga, sem "+1" em lugar nenhum.
            await tx.query(
              `insert into league_members (league_id, user_id, role) values ($1, $2, 'owner')`,
              [novoId, ownerId]
            );
            await tx.query('release savepoint liga_codigo');
            return novoId;
          } catch (e) {
            await tx.query('rollback to savepoint liga_codigo');
            // Só a colisão de código merece outra tentativa. Qualquer outra
            // violação (a PK de league_members, por exemplo) é bug, e bug tem
            // que subir barulhento em vez de virar 5 tentativas silenciosas.
            if (isUniqueViolation(e) && constraintName(e) === 'leagues_invite_code_key') continue;
            throw e;
          }
        }
        throw new Error('[db] não consegui gerar um código de convite único — tente de novo');
      });

      const liga = await repo.findById(id);
      if (!liga) throw new LeagueNotFoundError();
      return liga;
    },

    /**
     * Entra numa liga pelo código do convite.
     *
     * ENTRAR NÃO GASTA A COTA DO FREE, e isto é decisão de produto, não
     * esquecimento: a cota é sobre a liga que você CRIA ("seu grupo, seu
     * escudo"). Se entrar contasse, o primeiro amigo que você chamasse — que
     * provavelmente já tem a própria liga — não conseguiria aceitar o convite, e
     * o "chame a galera" morreria no primeiro convidado.
     *
     * Idempotente: quem já é membro e clica no link de novo entra na mesma liga,
     * sem erro e sem duplicar. Quem faz isso é o `on conflict do nothing` sobre
     * a PK (league_id, user_id).
     */
    async joinByCode(userId: string, code: string): Promise<League> {
      const codigo = normalizarCodigo(code);
      const rows = await db.query(`select id from leagues where invite_code = $1`, [codigo]);
      if (!rows[0]) throw new InviteCodeInvalidError();

      const id = String(rows[0].id);
      await db.query(
        `insert into league_members (league_id, user_id) values ($1, $2)
         on conflict (league_id, user_id) do nothing`,
        [id, userId]
      );

      const liga = await repo.findById(id);
      if (!liga) throw new LeagueNotFoundError();
      return liga;
    },

    /** A liga é PRIVADA: quem não é membro não vê nem o nome, nem o convite. */
    async isMember(leagueId: string, userId: string): Promise<boolean> {
      const rows = await db.query(
        `select 1 from league_members where league_id = $1 and user_id = $2`,
        [leagueId, userId]
      );
      return rows.length > 0;
    },

    async listMembers(leagueId: string): Promise<LeagueMember[]> {
      const rows = await db.query(
        `select m.user_id, m.role, u.handle,
                extract(epoch from m.joined_at) * 1000 as joined_ms
           from league_members m
           join users u on u.id = m.user_id
          where m.league_id = $1
          order by (m.role = 'owner') desc, m.joined_at`,
        [leagueId]
      );
      return rows.map((r) => ({
        userId: String(r.user_id),
        // NULL fica NULL: o fã que ainda não escolheu apelido aparece como "sem
        // apelido" na tela. Inventar um nome aqui (ou pior, tirar do e-mail —
        // E12) mentiria para a liga inteira.
        handle: (r.handle as string | null) ?? null,
        role: r.role as LeagueRole,
        joinedAt: Math.round(Number(r.joined_ms)),
      }));
    },
  };

  return repo;
}

export type LeagueRepo = ReturnType<typeof createLeagueRepo>;
