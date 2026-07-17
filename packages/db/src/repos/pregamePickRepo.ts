// pregamePickRepo — o palpite pré-jogo do fã e o pagamento do XP no apito final.
//
// A mesma disciplina do predictionRepo (leia o cabeçalho de lá): o XP é FUNÇÃO
// da liquidação, não um "+=". A rota GET liquida "lazy" — recalcula a cada
// leitura de uma partida encerrada — então o pagamento TEM de ser idempotente. O
// UPDATE de liquidação só morde `where settled_at is null`: rodar de novo não
// paga de novo.
//
// A REGRA DE PONTUAÇÃO não vive aqui: ela é `gradePregame` em @palpitei/core, e
// entra por INJEÇÃO. Este pacote não importa o core de propósito (a fronteira
// está documentada em types.ts) — a rota, que já depende dos dois, passa a
// função. Assim o repositório continua sabendo só de persistência.
//
// O TRAVA-NO-APITO não é aqui: a rota compara `Date.now()` com `matches.start_ts`
// e recusa a edição depois do apito. O repositório é burro de propósito — um
// psql aberto ou um seed entram por baixo dele, e a porta é a rota.

import type { Db, Executor } from '../pool.js';

/** O que a tela manda salvar. NULL = mercado não preenchido. */
export interface PregamePickFields {
  result: 'home' | 'draw' | 'away' | null;
  scoreA: number;
  scoreB: number;
  scoreSet: boolean;
  goals: 'over' | 'under' | null;
  /** Linha de meio gol da TxLINE que estava aberta ao confirmar. */
  goalsLine: number | null;
  corners: 'over' | 'under' | null;
  /** Linha de meio gol da TxLINE que estava aberta ao confirmar. */
  cornersLine: number | null;
}

/** Uma linha de palpite pré-jogo, como o resto do app a lê (epoch ms nos tempos). */
export interface PregamePick extends PregamePickFields {
  id: string;
  userId: string;
  fixtureId: number;
  submittedAt: number | null;
  settledAt: number | null;
  resultCorrect: boolean | null;
  scoreCorrect: boolean | null;
  goalsCorrect: boolean | null;
  cornersCorrect: boolean | null;
  awardedXp: number | null;
}

/** O desfecho real da partida, do dado no apito. */
export interface PregameFinalTotals {
  goalsP1: number;
  goalsP2: number;
  cornersTotal: number;
}

/** A regra de pontuação, injetada de @palpitei/core (gradePregame). */
export type PregameGradeFn = (
  pick: PregamePickFields,
  final: PregameFinalTotals
) => {
  resultCorrect: boolean | null;
  scoreCorrect: boolean | null;
  goalsCorrect: boolean | null;
  cornersCorrect: boolean | null;
  awardedXp: number;
};

const COLS =
  'id, user_id, fixture_id, result, score_a, score_b, score_set, goals, goals_line, corners, corners_line, ' +
  'submitted_at, settled_at, result_correct, score_correct, goals_correct, corners_correct, awarded_xp';

const ms = (v: unknown): number | null => (v == null ? null : new Date(v as string).getTime());

function mapPick(r: Record<string, unknown>): PregamePick {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    fixtureId: Number(r.fixture_id),
    result: (r.result as PregamePick['result']) ?? null,
    scoreA: Number(r.score_a ?? 0),
    scoreB: Number(r.score_b ?? 0),
    scoreSet: r.score_set === true,
    goals: (r.goals as PregamePick['goals']) ?? null,
    goalsLine: r.goals_line == null ? null : Number(r.goals_line),
    corners: (r.corners as PregamePick['corners']) ?? null,
    cornersLine: r.corners_line == null ? null : Number(r.corners_line),
    submittedAt: ms(r.submitted_at),
    settledAt: ms(r.settled_at),
    resultCorrect: r.result_correct == null ? null : r.result_correct === true,
    scoreCorrect: r.score_correct == null ? null : r.score_correct === true,
    goalsCorrect: r.goals_correct == null ? null : r.goals_correct === true,
    cornersCorrect: r.corners_correct == null ? null : r.corners_correct === true,
    awardedXp: r.awarded_xp == null ? null : Number(r.awarded_xp),
  };
}

export function createPregamePickRepo(db: Db) {
  const repo = {
    /** O palpite deste fã nesta partida, ou null. */
    async getByUserFixture(userId: string, fixtureId: number): Promise<PregamePick | null> {
      const rows = await db.query(
        `select ${COLS} from pregame_picks where user_id = $1 and fixture_id = $2`,
        [userId, fixtureId]
      );
      return rows[0] ? mapPick(rows[0]) : null;
    },

    /**
     * Grava (ou atualiza) o palpite. Um por fã por partida — garantido pelo
     * UNIQUE, não por um SELECT-antes-de-INSERT. `submitted_at` é marcado na 1ª
     * confirmação e PRESERVADO nas edições seguintes (coalesce).
     */
    async upsert(userId: string, fixtureId: number, pick: PregamePickFields): Promise<PregamePick> {
      const rows = await db.query(
        `insert into pregame_picks
           (user_id, fixture_id, result, score_a, score_b, score_set, goals, goals_line, corners, corners_line, submitted_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
         on conflict (user_id, fixture_id) do update set
           result   = excluded.result,
           score_a  = excluded.score_a,
           score_b  = excluded.score_b,
           score_set = excluded.score_set,
           goals    = excluded.goals,
           goals_line = excluded.goals_line,
           corners  = excluded.corners,
           corners_line = excluded.corners_line,
           submitted_at = coalesce(pregame_picks.submitted_at, excluded.submitted_at),
           updated_at = now()
         returning ${COLS}`,
        [
          userId,
          fixtureId,
          pick.result,
          pick.scoreA,
          pick.scoreB,
          pick.scoreSet,
          pick.goals,
          pick.goalsLine,
          pick.corners,
          pick.cornersLine,
        ]
      );
      return mapPick(rows[0]!);
    },

    /**
     * Liquida TODOS os palpites de uma partida encerrada, numa transação só.
     * `grade` (gradePregame do core) diz o que cada mercado acertou; o CAS em
     * `settled_at is null` garante que reprocessar não paga de novo. Só escreve
     * `users.xp` — o nível é coluna gerada e se ajusta sozinho.
     */
    async settleFixture(
      fixtureId: number,
      final: PregameFinalTotals,
      grade: PregameGradeFn
    ): Promise<{ liquidados: number; jaEstavam: number }> {
      return db.withTx(async (tx: Executor) => {
        // Não trava com `for update`: quem serializa é o PRÓPRIO update com CAS.
        // Duas liquidações lazy concorrentes leem as duas a linha como não
        // liquidada; o `update ... where settled_at is null` toma o lock da linha,
        // e a 2ª, ao destravar, reavalia o WHERE contra a linha já liquidada e
        // casa 0 linhas — ninguém paga duas vezes. (O `for update` aqui só
        // provocava um artefato do socket do PGlite: RETURNING vazio num UPDATE
        // que mexeu na linha.)
        const rows = await tx.query(
          `select ${COLS} from pregame_picks
            where fixture_id = $1 and submitted_at is not null and settled_at is null`,
          [fixtureId]
        );

        let liquidados = 0;
        let jaEstavam = 0;
        for (const row of rows) {
          const pick = mapPick(row);
          const g = grade(
            {
              result: pick.result,
              scoreA: pick.scoreA,
              scoreB: pick.scoreB,
              scoreSet: pick.scoreSet,
              goals: pick.goals,
              goalsLine: pick.goalsLine,
              corners: pick.corners,
              cornersLine: pick.cornersLine,
            },
            final
          );
          const xp = Math.max(0, Math.trunc(g.awardedXp));

          const upd = await tx.query(
            `update pregame_picks
                set settled_at = now(),
                    result_correct = $2, score_correct = $3,
                    goals_correct = $4, corners_correct = $5,
                    awarded_xp = $6, updated_at = now()
              where id = $1 and settled_at is null
              returning user_id`,
            [pick.id, g.resultCorrect, g.scoreCorrect, g.goalsCorrect, g.cornersCorrect, xp]
          );
          if (upd.length === 0) {
            // Só cai aqui numa corrida: outra liquidação lazy virou a chave entre
            // o nosso SELECT e o nosso UPDATE. O CAS garante que ela pagou, nós não.
            jaEstavam++;
            continue;
          }
          if (xp > 0) {
            await tx.query(`update users set xp = xp + $2, updated_at = now() where id = $1`, [
              String(upd[0]!.user_id),
              xp,
            ]);
          }
          liquidados++;
        }
        return { liquidados, jaEstavam };
      });
    },
  };

  return repo;
}

export type PregamePickRepo = ReturnType<typeof createPregamePickRepo>;
