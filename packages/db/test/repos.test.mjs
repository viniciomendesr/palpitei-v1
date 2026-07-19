// Repository integration tests run against PGlite through the PostgreSQL wire protocol.
// They focus on invariants that would otherwise fail silently in production.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

import {
  createPalpitei,
  createEnginePorts,
  assertDbReady,
  HandleTakenError,
  LeagueLimitError,
  InviteCodeInvalidError,
  LeagueNameInvalidError,
  LeagueNotFoundError,
  LeagueNotOwnerError,
  LobbyUnavailableError,
} from '../dist/index.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
/** Keep the test schema aligned with every production migration. */
const MIGRATIONS = [
  resolve(AQUI, '../../../supabase/migrations/0001_init.sql'),
  resolve(AQUI, '../../../supabase/migrations/0002_leagues.sql'),
  resolve(AQUI, '../../../supabase/migrations/0003_lobbies.sql'),
  resolve(AQUI, '../../../supabase/migrations/0004_lobby_presence.sql'),
  resolve(AQUI, '../../../supabase/migrations/0005_pregame_picks.sql'),
  resolve(AQUI, '../../../supabase/migrations/0006_pregame_txline_lines.sql'),
  resolve(AQUI, '../../../supabase/migrations/0007_live_sessions_templates.sql'),
];
const PORTA = 5599;

/** PGlite closes the socket after a SQL error, unlike PostgreSQL; drain that client. */
async function rejeitaCom(fn, matcher) {
  await assert.rejects(fn, matcher);
  await p.db.query('select 1').catch(() => {}); // drain the dead PGlite client
}

let pg;
let server;
let p;

before(async () => {
  pg = await PGlite.create();
  for (const m of MIGRATIONS) await pg.exec(readFileSync(m, 'utf8'));
  server = new PGLiteSocketServer({ db: pg, port: PORTA, host: '127.0.0.1' });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORTA}/postgres`;
  p = createPalpitei();
});

after(async () => {
  await p?.close();
  await server?.stop();
  await pg?.close();
});

const DID = 'did:privy:teste1';

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

test('find-or-create é pelo DID, e a carteira pode mudar sem criar conta nova', async () => {
  const a = await p.users.findOrCreateByPrivyDid(DID, {
    wallet: 'Wallet111',
    walletSource: 'privy_embedded',
  });
  // A second login may use the same DID with a different linked wallet.
  const b = await p.users.findOrCreateByPrivyDid(DID, {
    wallet: 'Wallet222',
    walletSource: 'external',
  });
  assert.equal(a.id, b.id, 'mesmo DID tem que ser a mesma conta');
  assert.equal(b.wallet, 'Wallet222');
});

test('login sem carteira NÃO apaga a carteira que já se conhecia (ausente ≠ zero)', async () => {
  const antes = await p.users.findOrCreateByPrivyDid(DID);
  assert.equal(antes.wallet, 'Wallet222', 'a Privy não mandar carteira não é motivo para esquecer a dela');
});

test('o MESMO endereço entra 2x quando muda a origem (E16: exportou e importou no Phantom)', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:e16', {
    wallet: 'MesmoEndereco',
    walletSource: 'privy_embedded',
  });
  await p.users.linkWallet(u.id, 'MesmoEndereco', 'external');
  const carteiras = await p.users.listWallets(u.id);
  assert.equal(carteiras.length, 2, 'deduplicar só por pubkey apagaria a proveniência');
  assert.deepEqual(carteiras.map((c) => c.source).sort(), ['external', 'privy_embedded']);
});

test('o usuário nasce SEM apelido — o onboarding pede (E12: nunca derivar do e-mail)', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:semapelido');
  assert.equal(u.handle, null);
});

test('apelido tomado devolve 409, inclusive com outra caixa', async () => {
  const a = await p.users.findOrCreateByPrivyDid('did:privy:h1');
  const b = await p.users.findOrCreateByPrivyDid('did:privy:h2');
  await p.users.setHandle(a.id, 'você.craque');
  await rejeitaCom(() => p.users.setHandle(b.id, 'VOCÊ.CRAQUE'), (e) => {
    assert.ok(e instanceof HandleTakenError);
    assert.equal(e.status, 409);
    return true;
  });
});

test('conta demo não pode se passar por conta com carteira de verdade', async () => {
  // Demo DID namespaces and wallet sources must remain consistent.
  const demo = await p.users.findOrCreateByPrivyDid('demo:jurado1', {
    wallet: 'SimKey',
    walletSource: 'simulated',
  });
  assert.equal(demo.walletSource, 'simulated');
  await rejeitaCom(
    () => p.db.query(`insert into users (privy_did, wallet_pubkey, wallet_source) values ('demo:falso', 'X', 'privy_embedded')`),
    /users_did_namespace_ck/
  );
});

test('fã da Privy SEM carteira lê walletSource NULL — não "simulated" (E2 tem que ficar visível)', async () => {
  // A social Privy login may have no Solana wallet; preserve NULL rather than
  // fabricating a source or misclassifying the account as demo.
  const u = await p.users.findOrCreateByPrivyDid('did:privy:e2_sem_carteira');
  assert.equal(u.wallet, null);
  assert.equal(u.walletSource, null, 'ausente é ausente: NULL não pode virar "simulated"');

  // The database rejects the invalid combination a simulated fallback created.
  await rejeitaCom(
    () => p.db.query(
      `insert into users (privy_did, wallet_pubkey, wallet_source)
       values ('did:privy:impossivel', 'K', 'simulated')`
    ),
    /users_did_namespace_ck/
  );

  // The schema's diagnostic query must identify those accounts.
  const [diag] = await p.db.query(
    `select count(*)::int as n from users
      where privy_did like 'did:privy:%' and wallet_pubkey is null`
  );
  assert.ok(diag.n >= 1, 'o detector do E2 tem que conseguir contar estes casos');
});

test('nível é FUNÇÃO do xp — a fórmula do v0, calculada pelo banco', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:xp');
  assert.equal(u.level, 1);
  const casos = [
    [0, 1],
    [100, 2],
    [400, 3],
    [900, 4],
    [1240, 4], // floor(sqrt(12.4)) + 1
  ];
  let acumulado = 0;
  for (const [xp, nivelEsperado] of casos) {
    const atualizado = await p.users.addXp(u.id, xp - acumulado);
    acumulado = xp;
    assert.equal(atualizado.xp, xp);
    assert.equal(atualizado.level, nivelEsperado, `xp ${xp} => nível ${nivelEsperado}`);
    assert.equal(atualizado.level, Math.floor(Math.sqrt(xp / 100)) + 1, 'tem que bater com a fórmula do v0');
  }
});

// ---------------------------------------------------------------------------
// XP settlement idempotency
// ---------------------------------------------------------------------------

test('resolver o MESMO palpite duas vezes paga UMA vez (entrega duplicada é idempotente)', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:idem');
  await p.matches.upsert({ fixtureId: 900001, p1: 'França', p2: 'Inglaterra', startTime: 1_700_000_000_000 });
  await p.questions.save({
    id: 'q_idem',
    fixtureId: 900001,
    type: 'next_goal',
    prompt: 'Quem marca o próximo gol?',
    options: [{ id: 'p1', label: 'França' }, { id: 'p2', label: 'Inglaterra' }],
    opensAt: 1_700_000_000_000,
    closesAt: 1_700_000_060_000,
    state: 'open',
  });
  await p.predictions.place({
    id: 'pred_idem',
    userId: u.id,
    questionId: 'q_idem',
    choice: 'p1',
    placedAt: 1_700_000_010_000,
  });

  const xpAntes = (await p.users.findById(u.id)).xp;

  const um = await p.predictions.settle('pred_idem', 'won', 150);
  assert.equal(um.pagou, true);

  // A duplicated delivery can resolve the same question again.
  const dois = await p.predictions.settle('pred_idem', 'won', 150);
  assert.equal(dois.pagou, false, 'a segunda resolução NÃO pode pagar');

  // Repeat through the room's question_resolved path.
  const tres = await p.predictions.settleQuestion('q_idem', [
    { userId: u.id, result: 'won', awardedXp: 150 },
  ]);
  assert.equal(tres.pagos, 0);
  assert.equal(tres.jaEstavam, 1);

  const xpDepois = (await p.users.findById(u.id)).xp;
  assert.equal(xpDepois - xpAntes, 150, 'três resoluções, um pagamento');
});

test('duas rodadas valendo da mesma fixture pagam XP com questionIds diferentes', async () => {
  const veterano = await p.users.findOrCreateByPrivyDid('did:privy:replay-repetido');
  await p.matches.upsert({ fixtureId: 900002, p1: 'England', p2: 'Argentina', startTime: 1_700_000_000_000 });
  const xpAntes = (await p.users.findById(veterano.id)).xp;

  for (const rodada of [1, 2]) {
    const questionId = `q_replay_${rodada}`;
    const predictionId = `pred_replay_${rodada}`;
    await p.questions.save({
      id: questionId,
      fixtureId: 900002,
      type: 'next_goal',
      prompt: 'Quem marca o próximo gol?',
      options: [{ id: 'p1', label: 'England' }, { id: 'p2', label: 'Argentina' }],
      opensAt: 1_700_000_000_000 + rodada,
      closesAt: 1_700_000_060_000 + rodada,
      state: 'open',
    });
    await p.predictions.place({
      id: predictionId,
      userId: veterano.id,
      questionId,
      choice: 'p1',
      placedAt: 1_700_000_010_000 + rodada,
    });
    const liquidacao = await p.predictions.settle(predictionId, 'won', 150);
    assert.equal(liquidacao.pagou, true, `rodada ${rodada} deve ser elegível`);
  }

  const xpDepois = (await p.users.findById(veterano.id)).xp;
  assert.equal(
    xpDepois - xpAntes,
    300,
    'cada nova pergunta paga; só repetir a mesma liquidação é bloqueado',
  );
});

test('a auditoria confirma: users.xp é a soma do que foi registrado', async () => {
  const u = await p.users.findByPrivyDid('did:privy:idem');
  const audit = await p.users.recomputeXp(u.id);
  assert.equal(audit.bateu, true, 'se não bate, algum caminho pagou XP a mais — é bug, não sorte');
});

test('anulada não paga e NÃO quebra a sequência do fã (a culpa não é dele)', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:void');
  await p.questions.save({
    id: 'q_void', fixtureId: 900001, type: 'next_goal', prompt: 'Quem marca?',
    options: [{ id: 'p1', label: 'França' }], opensAt: 1, closesAt: 2, state: 'open',
  });
  await p.predictions.place({ id: 'pred_w', userId: u.id, questionId: 'q_void', choice: 'p1', placedAt: 1 });
  await p.predictions.settle('pred_w', 'won', 100);
  assert.equal((await p.users.findById(u.id)).currentStreak, 1);

  await p.questions.save({
    id: 'q_void2', fixtureId: 900001, type: 'next_goal', prompt: 'Quem marca?',
    options: [{ id: 'p1', label: 'França' }], opensAt: 1, closesAt: 2, state: 'void',
    voidReason: 'evento resolvedor chegou com a janela aberta (regra de justiça)',
  });
  await p.predictions.place({ id: 'pred_v', userId: u.id, questionId: 'q_void2', choice: 'p1', placedAt: 1 });
  const r = await p.predictions.settle('pred_v', 'void', 999);
  assert.equal(r.awardedXp, 0, 'anulada não paga XP nem se mandarem 999');

  const depois = await p.users.findById(u.id);
  assert.equal(depois.currentStreak, 1, 'anulação é decisão do sistema: não pode custar a sequência');
});

test('errar zera a sequência, mas o recorde fica', async () => {
  const u = await p.users.findByPrivyDid('did:privy:void');
  await p.questions.save({
    id: 'q_lost', fixtureId: 900001, type: 'next_goal', prompt: 'Quem marca?',
    options: [{ id: 'p1', label: 'França' }], opensAt: 1, closesAt: 2, state: 'open',
  });
  await p.predictions.place({ id: 'pred_l', userId: u.id, questionId: 'q_lost', choice: 'p1', placedAt: 1 });
  await p.predictions.settle('pred_l', 'lost', 0);
  const d = await p.users.findById(u.id);
  assert.equal(d.currentStreak, 0);
  assert.equal(d.bestStreak, 1);
});

test('um palpite por fã por pergunta — garantido pelo banco', async () => {
  const u = await p.users.findByPrivyDid('did:privy:idem');
  await rejeitaCom(
    () => p.predictions.place({ id: 'pred_outro_id', userId: u.id, questionId: 'q_idem', choice: 'p2', placedAt: 5 }),
    /já palpitou/
  );
});

test('palpite em pergunta não gravada falha com mensagem que explica o que fazer', async () => {
  const u = await p.users.findByPrivyDid('did:privy:idem');
  await rejeitaCom(
    () => p.predictions.place({ id: 'pred_orfao', userId: u.id, questionId: 'q_nao_existe', choice: 'p1', placedAt: 1 }),
    /questionRepo\.save/
  );
});

// ---------------------------------------------------------------------------
// ingestion idempotency, A4, and odds series
// ---------------------------------------------------------------------------

const evento = (seq, extra = {}) => ({
  kind: 'score', fixtureId: 900002, seq, ts: 1_700_000_000_000 + seq * 1000,
  action: 'goal', hasScore: true,
  goals: { p1: 1, p2: 0 }, corners: { p1: 0, p2: 0 },
  totals: { p1: { Goals: 1, Corners: 0 }, p2: { Goals: 0, Corners: 0 } },
  raw: { Seq: seq, Action: 'goal' },
  ...extra,
});

test('reenviar o mesmo evento é no-op (o stream reconecta com Last-Event-ID e REENVIA)', async () => {
  await p.matches.upsert({ fixtureId: 900002, p1: 'A', p2: 'B', startTime: 1_700_000_000_000 });
  const um = await p.events.upsertMany([evento(2), evento(3), evento(4)]);
  assert.equal(um.gravados, 3);

  const dois = await p.events.upsertMany([evento(3), evento(4), evento(5)]);
  assert.equal(dois.gravados, 1, 'só o 5 é novo');
  assert.equal(dois.repetidos, 2, 'o 3 e o 4 já estavam lá');
  assert.equal(await p.events.count(900002), 4);
});

test('buraco no seq é evento PERDIDO e a consulta enxerga', async () => {
  await p.events.upsertMany([evento(9)]); // pula 6,7,8
  const buracos = await p.events.findSeqGaps(900002);
  assert.deepEqual(buracos, [{ de: 6, ate: 8, faltam: 3 }]);
});

test('A4: evento sem bloco Score não pode carregar totais — o banco recusa', async () => {
  await rejeitaCom(
    () => p.db.query(
      `insert into match_events (fixture_id, seq, ts, action, has_score, score_totals, raw)
       values (900002, 77, 1, 'kickoff', false, '{"p1":{"Goals":0}}'::jsonb, '{}'::jsonb)`
    ),
    /match_events_has_score_ck/
  );
});

test('A4: evento sem Score grava NULL e o último placar CONHECIDO não regride', async () => {
  await p.events.upsertMany([
    evento(20, { hasScore: true, totals: { p1: { Goals: 2 }, p2: { Goals: 1 } }, goals: { p1: 2, p2: 1 } }),
    // Second-half kickoff: normalize supplies zero totals with hasScore=false.
    evento(21, { action: 'kickoff', hasScore: false, totals: { p1: { Goals: 0 }, p2: { Goals: 0 } }, goals: { p1: 0, p2: 0 } }),
  ]);
  const placar = await p.events.ultimoPlacar(900002);
  assert.deepEqual(placar, { p1: 2, p2: 1 }, 'o evento sem Score não pode zerar o placar');

  const lidos = await p.events.listByFixture(900002);
  const semScore = lidos.find((e) => e.seq === 21);
  assert.equal(semScore.hasScore, false);
  assert.equal(semScore.totals, undefined, 'sem bloco Score não existem totais');
});

test('replay compacto não transporta o payload raw que o motor não consome', async () => {
  const lidos = await p.events.listReplayByFixture(900002);
  assert.ok(lidos.length > 0);
  assert.equal(lidos[0].raw, undefined);
  assert.equal(typeof lidos[0].seq, 'number');
  assert.equal(typeof lidos[0].hasScore, 'boolean');
});

test('message_id é STRING: ids que Number() colapsaria continuam sendo registros distintos', async () => {
  // Numeric parsing previously collapsed distinct string IDs into one Map entry.
  const linha = (messageId, ts) => ({
    FixtureId: 900002,
    MessageId: messageId,
    Ts: ts,
    SuperOddsType: '1X2_PARTICIPANT_RESULT',
    MarketPeriod: null,
    PriceNames: ['part1', 'draw', 'part2'],
    Prices: [2076, 3200, 4100],
    Pct: ['48.1', '31.2', '24.3'],
  });
  const r = await p.odds.upsertManyRaw([
    linha('1837922149:00003:000572-10021-stab', 1),
    linha('1837922149:00004:000572-10021-stab', 2),
  ]);
  assert.equal(r.gravados, 2, 'dois MessageId diferentes = dois registros');
  assert.equal(await p.odds.count(900002), 2);
});

test('replay de odds é compacto, normalizado e preserva o MessageId opaco', async () => {
  const lidos = await p.odds.listReplayByFixture(900002);
  const alvo = lidos.find((e) => e.messageId === '1837922149:00003:000572-10021-stab');
  assert.ok(alvo);
  assert.equal(alvo.raw, null, 'payload de auditoria não cruza o caminho interativo');
  assert.deepEqual(alvo.prices, [
    { name: 'part1', odds: 2.076, pct: 48.1 },
    { name: 'draw', odds: 3.2, pct: 31.2 },
    { name: 'part2', odds: 4.1, pct: 24.3 },
  ]);
});

test('a ingestão filtra ao mercado da v1 e CONTA o que descartou', async () => {
  const r = await p.odds.upsertManyRaw([
    { FixtureId: 900002, MessageId: 'ou-1', Ts: 3, SuperOddsType: 'OVERUNDER_PARTICIPANT_GOALS', PriceNames: ['over'], Prices: [1900] },
    { FixtureId: 900002, MessageId: '1x2-1t', Ts: 4, SuperOddsType: '1X2_PARTICIPANT_RESULT', MarketPeriod: '1', PriceNames: ['part1'], Prices: [1500] },
    { FixtureId: 900002, MessageId: 'vale', Ts: 5, SuperOddsType: '1X2_PARTICIPANT_RESULT', MarketPeriod: null, PriceNames: ['part1'], Prices: [1500] },
  ]);
  assert.equal(r.gravados, 1, 'só 1X2 de jogo inteiro entra');
  assert.equal(r.foraDoMercado, 2, 'filtro que descarta em silêncio esconde o bug');
});

test('G8: Prices vazio com PriceNames cheio é DADO REAL — grava vazio, não zeros', async () => {
  await p.odds.upsertManyRaw([
    {
      FixtureId: 900002, MessageId: 'sem-cotacao', Ts: 6,
      SuperOddsType: '1X2_PARTICIPANT_RESULT', MarketPeriod: null,
      PriceNames: ['part1', 'draw', 'part2'],
      Prices: [], // market had no quote at that instant
    },
  ]);
  const desalinhadas = await p.odds.listaDesalinhadas(900002);
  const alvo = desalinhadas.find((d) => d.messageId === 'sem-cotacao');
  assert.ok(alvo, 'a linha tem que estar lá');
  assert.equal(alvo.nomes, 3);
  assert.equal(alvo.precos, 0, 'vazio ≠ [0,0,0] — inventar zeros gerou 115 explicações fantasma no v0');
});

// ---------------------------------------------------------------------------
// match cache (replaces the on-disk .cache/ — T&C §7)
// ---------------------------------------------------------------------------

test('cache: grava e lê a timeline, e é idempotente', async () => {
  const cache = {
    fixtureId: 900003,
    p1: 'França',
    p2: 'Inglaterra',
    startTime: 1_700_000_000_000,
    gravadoEm: 1_700_000_500_000,
    fonte: 'txline-updates',
    scores: [
      { FixtureId: 900003, Seq: 2, Ts: 1_700_000_000_000, Action: 'kickoff', Clock: { Running: true, Seconds: 0 } },
      { FixtureId: 900003, Seq: 3, Ts: 1_700_000_060_000, Action: 'goal', Score: { Participant1: { Total: { Goals: 1, Corners: 2 } }, Participant2: { Total: { Goals: 0, Corners: 1 } } } },
    ],
    odds: [
      { FixtureId: 900003, MessageId: 'm1', Ts: 1_700_000_000_000, SuperOddsType: '1X2_PARTICIPANT_RESULT', MarketPeriod: null, PriceNames: ['part1'], Prices: [2076] },
    ],
  };

  const s1 = await p.cache.save(cache);
  assert.equal(s1.scoresGravados, 2);
  assert.equal(s1.oddsGravadas, 1);
  assert.deepEqual(s1.buracos, []);

  const s2 = await p.cache.save(cache);
  assert.equal(s2.scoresGravados, 0, 'regravar o mesmo cache não duplica nada');
  assert.equal(s2.scoresRepetidos, 2);

  const lido = await p.cache.load(900003);
  assert.equal(lido.fixtureId, 900003);
  assert.equal(lido.p1, 'França');
  assert.equal(lido.startTime, 1_700_000_000_000);
  assert.equal(lido.scores.length, 2, 'volta o payload CRU, na ordem do seq');
  assert.equal(lido.scores[0].Action, 'kickoff');
  assert.equal(lido.odds.length, 1);
  assert.equal(lido.gravadoEm, 1_700_000_500_000, 'a idade do cache é do cache, não de agora');

  // 900001 has questions but no match events; cache.list() returns timeline owners.
  assert.deepEqual(await p.cache.list(), [900002, 900003]);
  assert.equal(await p.cache.load(111111), null, 'sem timeline = null, para o replay cair na API');
});

test('cache sem startTime é RECUSADO (G4: o desafio nasceria fechado)', async () => {
  await rejeitaCom(
    () => p.cache.save({ fixtureId: 900004, p1: 'A', p2: 'B', startTime: NaN, gravadoEm: 1, fonte: 'txline-updates', scores: [{ FixtureId: 900004, Seq: 1 }], odds: [] }),
    /G4/
  );
});

test('upsert de partida nunca sobrescreve start_ts conhecido com nulo', async () => {
  await p.matches.upsert({ fixtureId: 900005, p1: 'A', p2: 'B', startTime: 1_700_000_000_000 });
  // A later upsert from a source that lacks StartTime.
  const depois = await p.matches.upsert({ fixtureId: 900005, p1: 'A', p2: 'B' });
  assert.equal(depois.startTime, 1_700_000_000_000, 'perder o start_ts é o G4 de volta');
  assert.deepEqual(await p.matches.semStartTs(), [], 'o detector do G4 tem que estar limpo');
});

test('upsert sem state NÃO rebaixa uma partida ao vivo para "scheduled"', async () => {
  // A partial source must not downgrade a live match through the INSERT default.
  await p.matches.upsert({ fixtureId: 900006, p1: 'França', p2: 'Inglaterra', startTime: 1, state: 'live' });
  const depois = await p.matches.upsert({ fixtureId: 900006, p1: 'França', p2: 'Inglaterra' });
  assert.equal(depois.state, 'live', 'não saber o estado não é motivo para rebaixar a partida');
  assert.equal((await p.matches.list({ state: 'live' })).some((m) => m.fixtureId === 900006), true,
    'a sala tem que continuar na aba "Ao Vivo"');

  // A cache saved at full time must not resurrect the fixture.
  await p.matches.setState(900006, 'finished');
  await p.matches.upsert({ fixtureId: 900006, p1: 'França', p2: 'Inglaterra' }, { source: 'txline-cache' });
  assert.equal((await p.matches.findById(900006)).state, 'finished');

  // An explicit state remains authoritative.
  const vivo = await p.matches.upsert({ fixtureId: 900006, p1: 'França', p2: 'Inglaterra', state: 'live' });
  assert.equal(vivo.state, 'live', 'state explícito tem que valer');
});

test('listCached só devolve partida ENCERRADA — a de hoje não pode virar "replay"', async () => {
  // A live fixture persists status events before kick-off, and the fixtures route
  // turns every row from listCached into a replay + training card. Filtering only
  // by "has events" put tonight's match in the Replays tab as "watch it again".
  const aoVivo = 900007;
  await p.matches.upsert({ fixtureId: aoVivo, p1: 'França', p2: 'Inglaterra', startTime: 3_000_000, state: 'live' });
  await p.events.upsertMany([
    { kind: 'score', fixtureId: aoVivo, seq: 2, ts: 3_000_100, action: 'status', hasScore: false, raw: { Seq: 2 } },
  ]);

  const comEventos = await p.matches.listCached();
  assert.equal(
    comEventos.some((m) => m.fixtureId === aoVivo),
    false,
    'partida ao vivo com eventos NÃO é replay',
  );

  // After the final whistle it becomes a legitimate replay.
  await p.matches.setState(aoVivo, 'finished');
  assert.equal(
    (await p.matches.listCached()).some((m) => m.fixtureId === aoVivo),
    true,
    'encerrada e com timeline gravada, aí sim é replay',
  );
});

// ---------------------------------------------------------------------------
// market (v2 preview, simulated USDC)
// ---------------------------------------------------------------------------

test('a mesma aposta não debita duas vezes, e o mercado não paga duas vezes', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:mkt');
  const saldoInicial = (await p.users.findById(u.id)).balanceCents;

  await p.markets.save({
    id: 'mkt_1', fixtureId: 900001, kind: 'resultado_final',
    labels: { p1: 'França', draw: 'Empate', p2: 'Inglaterra' },
    rakeBps: 500, closesAt: null, state: 'open', pools: { p1: 0, draw: 0, p2: 0 },
  });

  const bet = { id: 'bet_1', marketId: 'mkt_1', userId: u.id, outcome: 'p1', amountCents: 1000, ts: 1 };
  assert.equal(await p.markets.saveBet(bet), true);
  assert.equal(await p.markets.saveBet(bet), false, 'a mesma aposta não entra duas vezes');
  assert.equal((await p.users.findById(u.id)).balanceCents, saldoInicial - 1000, 'um débito só');

  const mercado = { id: 'mkt_1', fixtureId: 900001, kind: 'resultado_final', labels: { p1: 'F', draw: 'E', p2: 'I' }, rakeBps: 500, closesAt: null, state: 'resolved', pools: { p1: 1000, draw: 0, p2: 0 }, winner: 'p1' };
  const pago = await p.markets.resolve(mercado, [{ ...bet, payoutCents: 950 }]);
  assert.equal(pago.pagou, true);
  const denovo = await p.markets.resolve(mercado, [{ ...bet, payoutCents: 950 }]);
  assert.equal(denovo.pagou, false, 'resolver duas vezes NÃO pode pagar duas vezes');
  assert.equal((await p.users.findById(u.id)).balanceCents, saldoInicial - 1000 + 950);
});

test('saveMarket do mercado já resolvido NÃO queima o CAS do pagamento', async () => {
  // Saving an in-memory resolved market must not consume resolve()'s settlement CAS.
  const u = await p.users.findOrCreateByPrivyDid('did:privy:mkt_ordem');
  const saldoInicial = (await p.users.findById(u.id)).balanceCents;

  const aberto = {
    id: 'mkt_ordem', fixtureId: 900001, kind: 'resultado_final',
    labels: { p1: 'França', draw: 'Empate', p2: 'Inglaterra' },
    rakeBps: 500, closesAt: null, state: 'open', pools: { p1: 0, draw: 0, p2: 0 },
  };
  await p.markets.save(aberto);
  const bet = { id: 'bet_ordem', marketId: 'mkt_ordem', userId: u.id, outcome: 'p1', amountCents: 1000, ts: 1 };
  await p.markets.saveBet(bet);

  // Exercise the risky order: save resolved, then settle.
  const resolvido = { ...aberto, state: 'resolved', winner: 'p1', pools: { p1: 1000, draw: 0, p2: 0 } };
  await p.markets.save(resolvido);
  const pago = await p.markets.resolve(resolvido, [{ ...bet, payoutCents: 950 }]);

  assert.equal(pago.pagou, true, 'save() não pode resolver: quem resolve é quem paga');
  assert.equal(pago.creditados, 1);
  assert.equal((await p.users.findById(u.id)).balanceCents, saldoInicial - 1000 + 950);

  // A resolved market must not reopen through save().
  await p.markets.save({ ...aberto, state: 'open' });
  const [linha] = await p.db.query(`select state from markets where id = 'mkt_ordem'`);
  assert.equal(linha.state, 'resolved', 'mercado resolvido não reabre por reprocessamento');
});

test('saldo não fica negativo nem se o motor achar que dá', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:pobre');
  await rejeitaCom(
    () => p.markets.saveBet({ id: 'bet_gigante', marketId: 'mkt_1', userId: u.id, outcome: 'p1', amountCents: 99_999_999, ts: 1 }),
    /saldo insuficiente/
  );
});

// ---------------------------------------------------------------------------
// missions and achievements
// ---------------------------------------------------------------------------

test('conquista desbloqueia e paga uma vez só', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:conq');
  const xp0 = (await p.users.findById(u.id)).xp;
  assert.equal(await p.gamification.unlock(u.id, 'primeiro_palpite'), true);
  assert.equal(await p.gamification.unlock(u.id, 'primeiro_palpite'), false);
  const xp1 = (await p.users.findById(u.id)).xp;
  assert.equal(xp1 - xp0, 50, 'desbloquear de novo não pode pagar de novo');
});

test('missão paga só na virada do alvo', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:missao');
  const xp0 = (await p.users.findById(u.id)).xp;
  let r = await p.gamification.progress(u.id, 'streak_3', 1);
  assert.equal(r.concluiuAgora, false);
  r = await p.gamification.progress(u.id, 'streak_3', 1);
  assert.equal(r.concluiuAgora, false);
  r = await p.gamification.progress(u.id, 'streak_3', 1);
  assert.equal(r.concluiuAgora, true, '3/3 conclui');
  assert.equal(r.progresso, 3);

  r = await p.gamification.progress(u.id, 'streak_3', 1);
  assert.equal(r.concluiuAgora, false, 'progresso extra depois de concluída não paga de novo');

  const xp1 = (await p.users.findById(u.id)).xp;
  assert.equal(xp1 - xp0, 150, 'a missão paga uma vez');

  const lista = await p.gamification.listMissions(u.id);
  const streak = lista.find((m) => m.code === 'streak_3');
  assert.equal(streak.progress, 4);
  assert.ok(streak.completedAt > 0);
});

// ---------------------------------------------------------------------------
// EnginePorts — @palpitei/core contract
// ---------------------------------------------------------------------------

test('EnginePorts: uid tem prefixo e não repete', async () => {
  const ids = new Set(Array.from({ length: 1000 }, () => p.ports.uid('pred')));
  assert.equal(ids.size, 1000);
  assert.ok([...ids][0].startsWith('pred_'));
});

test('EnginePorts: escrita que falha NÃO derruba o processo — e flush() conta a verdade', async () => {
  // Core calls ports without await; unhandled rejections must not terminate Node.
  const erros = [];
  const ports = createEnginePorts(p.db, { onError: (e, ctx) => erros.push(ctx) });

  // Orphan prediction: the database rejects its missing question foreign key.
  ports.savePrediction({ id: 'pred_boom', userId: '00000000-0000-0000-0000-000000000000', questionId: 'q_inexistente', choice: 'p1', placedAt: 1 });
  assert.equal(ports.pendentes(), 1);

  await assert.rejects(() => ports.flush(), /não dá para gravar o palpite|violates/);
  assert.equal(erros.length, 1, 'o erro tem que ser reportado, não engolido em silêncio');
  await p.db.query('select 1').catch(() => {});

  // The process remains usable for the next prediction.
  await ports.flush();
  assert.equal(ports.pendentes(), 0);
});

test('EnginePorts: savePrediction registra e depois resolve, pagando uma vez', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:ports');
  p.ports.saveQuestion({
    id: 'q_ports', fixtureId: 900001, type: 'final_result', prompt: 'Como termina?',
    options: [{ id: 'p1', label: 'França' }], opensAt: 1, closesAt: 2, state: 'open',
  });
  await p.ports.flush();
  const pred = { id: p.ports.uid('pred'), userId: u.id, questionId: 'q_ports', choice: 'p1', placedAt: 1 };
  p.ports.savePrediction(pred);
  await p.ports.flush();

  const xp0 = (await p.users.findById(u.id)).xp;
  // The engine fills result/awardedXp and resaves it asynchronously.
  p.ports.savePrediction({ ...pred, result: 'won', awardedXp: 225 });
  await p.ports.flush();
  p.ports.savePrediction({ ...pred, result: 'won', awardedXp: 225 }); // replay
  await p.ports.flush();
  const xp1 = (await p.users.findById(u.id)).xp;
  assert.equal(xp1 - xp0, 225, 'o replay nao paga de novo nem pela porta');
});

// ---------------------------------------------------------------------------
// recoverable sessions, live fixtures, and templates
// ---------------------------------------------------------------------------

test('templates ativos são versionados e a sessão fixa o conjunto no seu início', async () => {
  const templates = await p.questionTemplates.listActive();
  assert.deepEqual(templates.map((t) => t.questionType).sort(), ['final_result', 'hilo_corners', 'next_goal']);

  const fixture = 991_007;
  await p.matches.upsert({ fixtureId: fixture, p1: 'Brasil', p2: 'México', startTime: 2_000_000 });
  const templateSet = Object.fromEntries(templates.map((t) => [t.questionType, { id: t.id, version: t.version }]));
  const first = await p.sessions.findOrCreateActive({
    fixtureId: fixture,
    partyId: 'ABC123',
    treino: false,
    engineVersion: 'questions-v2',
    templateSet,
  });
  const again = await p.sessions.findOrCreateActive({
    fixtureId: fixture,
    partyId: 'ABC123',
    treino: false,
    engineVersion: 'questions-v2',
    templateSet: {},
  });
  assert.equal(again.id, first.id, 'restart não pode criar uma execução paralela do mesmo grupo');
  assert.deepEqual(again.templateSet, templateSet, 'a versão original fica pinada');
});

test('checkpoint persiste cursores e estado da sessão para recuperação', async () => {
  const fixture = 991_008;
  await p.matches.upsert({ fixtureId: fixture, p1: 'França', p2: 'Inglaterra', startTime: 2_000_000 });
  const session = await p.sessions.findOrCreateActive({
    fixtureId: fixture,
    partyId: 'DEF456',
    treino: false,
    engineVersion: 'questions-v2',
    templateSet: {},
  });
  await p.sessions.checkpoint(session.id, { engine: { tracked: [] }, room: { score: { p1: 1, p2: 0 } } }, {
    lastScoreSeq: 42,
    lastOddsTs: 2_100_000,
    lastOddsMessageId: 'odds-42',
  });
  const restored = await p.sessions.findOrCreateActive({
    fixtureId: fixture,
    partyId: 'DEF456',
    treino: false,
    engineVersion: 'ignored',
    templateSet: {},
  });
  assert.equal(restored.lastScoreSeq, 42);
  assert.equal(restored.lastOddsTs, 2_100_000);
  assert.equal(restored.lastOddsMessageId, 'odds-42');
  assert.equal(restored.snapshot.room.score.p1, 1);
});

test('registro de fixtures live permite ativar e desativar sem editar env', async () => {
  const fixture = 991_009;
  await p.matches.upsert({ fixtureId: fixture, p1: 'Espanha', p2: 'Argentina', startTime: 2_000_000 });
  await p.liveFixtures.activate(fixture, 10);
  assert.ok((await p.liveFixtures.listActive()).some((f) => f.fixtureId === fixture));
  await p.liveFixtures.deactivate(fixture);
  assert.equal((await p.liveFixtures.listActive()).some((f) => f.fixtureId === fixture), false);
});

test('desativar carimba deactivated_at e a segunda chamada não mexe na linha', async () => {
  const fixture = 991_010;
  await p.matches.upsert({ fixtureId: fixture, p1: 'França', p2: 'Inglaterra', startTime: 2_000_000 });
  await p.liveFixtures.activate(fixture);

  await p.liveFixtures.deactivate(fixture);
  const [primeira] = await p.db.query(
    'select active, deactivated_at, updated_at from live_fixtures where fixture_id = $1',
    [fixture],
  );
  assert.equal(primeira.active, false);
  assert.ok(primeira.deactivated_at, 'o fim da partida precisa carimbar deactivated_at');
  assert.equal(
    (await p.liveFixtures.listActive()).some((f) => f.fixtureId === fixture),
    false,
    'listActive não pode devolver fixture desativada — é ela que recria o canal',
  );
  assert.ok(
    (await p.liveFixtures.listInactive()).some((f) => f.fixtureId === fixture),
    'quem já foi desativada precisa ser listável para o canal local parar',
  );

  // Real idempotency: a redelivered game_finalised must not rewrite the stamp.
  await p.liveFixtures.deactivate(fixture);
  const [segunda] = await p.db.query(
    'select active, deactivated_at, updated_at from live_fixtures where fixture_id = $1',
    [fixture],
  );
  assert.equal(segunda.active, false);
  assert.equal(String(segunda.deactivated_at), String(primeira.deactivated_at));
  assert.equal(String(segunda.updated_at), String(primeira.updated_at));
});

test('varredura desativa fixture de partida ENCERRADA e não toca em quem ainda joga', async () => {
  // Deactivation happens at the terminal event, so a match that ended before this
  // code existed keeps its row active forever and the 15s poll rebuilds its channel.
  // The boot sweep is the only leg that can reach those.
  const encerrada = 991_020;
  const rolando = 991_021;
  await p.matches.upsert({ fixtureId: encerrada, p1: 'França', p2: 'Inglaterra', startTime: 2_000_000, state: 'finished' });
  await p.matches.upsert({ fixtureId: rolando, p1: 'Espanha', p2: 'Argentina', startTime: 2_000_000, state: 'live' });
  await p.liveFixtures.activate(encerrada);
  await p.liveFixtures.activate(rolando);

  const alvos = await p.liveFixtures.deactivateFinishedMatches();
  assert.deepEqual(alvos, [encerrada], 'só a encerrada sai do registro ao vivo');
  assert.equal((await p.liveFixtures.listActive()).some((f) => f.fixtureId === encerrada), false);
  assert.equal(
    (await p.liveFixtures.listActive()).some((f) => f.fixtureId === rolando),
    true,
    'desativar a errada mataria o canal de uma partida em andamento',
  );

  const [linha] = await p.db.query('select deactivated_at from live_fixtures where fixture_id = $1', [encerrada]);
  assert.ok(linha.deactivated_at, 'a varredura também precisa carimbar deactivated_at');

  // Idempotent: another boot finds nothing left to retire.
  assert.deepEqual(await p.liveFixtures.deactivateFinishedMatches(), []);
});

test('reativar uma fixture desativada limpa o carimbo (o registro é reutilizável)', async () => {
  const fixture = 991_012;
  await p.matches.upsert({ fixtureId: fixture, p1: 'Espanha', p2: 'Argentina', startTime: 2_000_000 });
  await p.liveFixtures.activate(fixture);
  await p.liveFixtures.deactivate(fixture);
  await p.liveFixtures.activate(fixture);
  const [linha] = await p.db.query(
    'select active, deactivated_at from live_fixtures where fixture_id = $1',
    [fixture],
  );
  assert.equal(linha.active, true);
  assert.equal(linha.deactivated_at, null);
  assert.equal((await p.liveFixtures.listInactive()).some((f) => f.fixtureId === fixture), false);
});

test('sessão órfã de partida encerrada é finalizada, e varrer de novo não muda nada', async () => {
  const fixture = 991_011;
  await p.matches.upsert({ fixtureId: fixture, p1: 'França', p2: 'Inglaterra', startTime: 2_000_000 });
  const sessao = await p.sessions.findOrCreateActive({
    fixtureId: fixture,
    partyId: '7C4HP6',
    treino: false,
    engineVersion: 'questions-v2',
    templateSet: {},
  });

  // Match still running: the sweep must not close any room.
  const cedoDemais = await p.sessions.finishOrphansOfFinishedMatches();
  assert.equal(
    cedoDemais.some((o) => o.fixtureId === fixture),
    false,
    'partida em andamento não pode ter a sala fechada pela varredura',
  );

  await p.matches.setState(fixture, 'finished');
  const varridas = (await p.sessions.finishOrphansOfFinishedMatches()).filter(
    (o) => o.fixtureId === fixture,
  );
  assert.deepEqual(varridas.map((o) => o.partyId), ['7C4HP6']);
  assert.deepEqual(varridas.map((o) => o.treino), [false]);
  const [linha] = await p.db.query('select status, finished_at from game_sessions where id = $1', [
    sessao.id,
  ]);
  assert.equal(linha.status, 'finished');
  assert.ok(linha.finished_at, 'game_sessions_finished_ck exige finished_at');

  // Idempotent: a rerun (another boot, another redelivery) returns and changes nothing.
  const segunda = (await p.sessions.finishOrphansOfFinishedMatches()).filter(
    (o) => o.fixtureId === fixture,
  );
  assert.deepEqual(segunda, []);
  const [depois] = await p.db.query('select status, finished_at from game_sessions where id = $1', [
    sessao.id,
  ]);
  assert.equal(String(depois.finished_at), String(linha.finished_at));
});

test('varredura por fixture não encosta na sala de outra partida', async () => {
  const encerrada = 991_013;
  const rolando = 991_014;
  for (const [id, p1, p2] of [[encerrada, 'França', 'Inglaterra'], [rolando, 'Espanha', 'Argentina']]) {
    await p.matches.upsert({ fixtureId: id, p1, p2, startTime: 2_000_000 });
  }
  await p.sessions.findOrCreateActive({
    fixtureId: encerrada,
    partyId: '58GBHK',
    treino: false,
    engineVersion: 'questions-v2',
    templateSet: {},
  });
  const viva = await p.sessions.findOrCreateActive({
    fixtureId: rolando,
    partyId: 'ZZ9999',
    treino: false,
    engineVersion: 'questions-v2',
    templateSet: {},
  });
  await p.matches.setState(encerrada, 'finished');
  await p.matches.setState(rolando, 'finished');

  const so = await p.sessions.finishOrphansOfFinishedMatches(encerrada);
  assert.deepEqual(so.map((o) => o.partyId), ['58GBHK']);
  const [outra] = await p.db.query('select status from game_sessions where id = $1', [viva.id]);
  assert.equal(outra.status, 'active', 'a sala da outra fixture segue de pé');
});

// ---------------------------------------------------------------------------
// boot: RLS without a policy is hazardous for the wrong role
// ---------------------------------------------------------------------------

test('assertDbReady detecta a role sujeita à RLS (o banco "funcionando" e vazio)', async () => {
  // migrate.mjs creates schema_migrations; create it here for assertDbReady.
  await p.db.query(`create table if not exists schema_migrations (
    version text primary key, checksum text not null,
    applied_at timestamptz not null default now())`);
  await p.db.query(`insert into schema_migrations (version, checksum) values ('0001_init', 'x')
                    on conflict (version) do nothing`);

  // The schema owner bypasses RLS and must pass.
  const ok = await assertDbReady(p.db);
  assert.equal(ok.migrations, 1);

  await p.db.query(`drop role if exists fa_rls`).catch(() => {});
  await p.db.query(`create role fa_rls nologin`);
  await p.db.query(`grant usage on schema public to fa_rls`);
  await p.db.query(`grant select on users, schema_migrations to fa_rls`);

  await assert.rejects(
    () =>
      p.db.withTx(async (tx) => {
        await tx.query(`set local role fa_rls`);
        // RLS without a policy returns zero rows rather than an error, including
        // a count row with n=0, so readiness must detect the empty result.
        const [c] = await tx.query(`select count(*)::int as n from users`);
        assert.equal(c.n, 0, 'a RLS zera a leitura em silêncio: é este o banco vazio');
        return assertDbReady(tx);
      }),
    /SUJEITA à RLS/,
    'a role errada tem que falhar ALTO no boot, não servir um banco vazio'
  );
});

// ---------------------------------------------------------------------------
// private leagues
// ---------------------------------------------------------------------------

async function faNovo(sufixo) {
  return p.users.findOrCreateByPrivyDid(`demo:liga-${sufixo}-${Math.random().toString(36).slice(2, 8)}`);
}

test('a liga PERSISTE, e o dono já entra como membro', async () => {
  const dono = await faNovo('persiste');
  const liga = await p.leagues.create(dono.id, 'Resenha FC');

  // Reload from storage rather than trusting the object returned by create().
  const lido = await p.leagues.findById(liga.id);
  assert.equal(lido.name, 'Resenha FC');
  assert.equal(lido.ownerId, dono.id);
  // The owner is persisted in league_members, so the count is derived data.
  assert.equal(lido.memberCount, 1, 'o dono é membro: o count É o número de gente na liga');
  assert.match(lido.inviteCode, /^[A-HJKMNP-Z2-9]{6}$/, 'o código não pode ter sósia (I, L, O, 0, 1)');
});

test('o free inclui 1 liga: a 2ª leva ao paywall, não a um silêncio', async () => {
  const dono = await faNovo('gate');
  await p.leagues.create(dono.id, 'Primeira');
  await assert.rejects(() => p.leagues.create(dono.id, 'Segunda'), LeagueLimitError);
  assert.equal(await p.leagues.countOwned(dono.id), 1, 'a 2ª não pode ter entrado');
});

test('premium cria quantas quiser', async () => {
  const dono = await faNovo('premium');
  await p.users.setPremium(dono.id, true);
  await p.leagues.create(dono.id, 'Uma');
  await p.leagues.create(dono.id, 'Duas');
  await p.leagues.create(dono.id, 'Três');
  assert.equal(await p.leagues.countOwned(dono.id), 3);
});

test('o gate NÃO pode ser furado por dois pedidos simultâneos do mesmo fã', async () => {
  // The invariant is one owned league for a free user. PGlite serializes the
  // competing request differently than PostgreSQL, so do not assert its error type.
  const dono = await faNovo('corrida');
  const r = await Promise.allSettled([
    p.leagues.create(dono.id, 'Corrida Um'),
    p.leagues.create(dono.id, 'Corrida Dois'),
  ]);
  const criou = r.filter((x) => x.status === 'fulfilled').length;
  assert.equal(criou, 1, 'exatamente uma pode ter sido criada');
  assert.equal(await p.leagues.countOwned(dono.id), 1, 'o free não pode terminar com 2 ligas');
  await p.db.query('select 1').catch(() => {}); // drain the dead PGlite client
});

test('entrar pelo código põe o amigo na liga — e repetir não duplica', async () => {
  const dono = await faNovo('convite-dono');
  const amigo = await faNovo('convite-amigo');
  const liga = await p.leagues.create(dono.id, 'Time da Firma');

  const entrou = await p.leagues.joinByCode(amigo.id, liga.inviteCode);
  assert.equal(entrou.memberCount, 2);

  // Reopening the invite link is a normal idempotency case.
  const denovo = await p.leagues.joinByCode(amigo.id, liga.inviteCode);
  assert.equal(denovo.memberCount, 2, 'o mesmo fã não pode contar duas vezes no ranking da liga');
});

test('o código é aceito em minúscula e com espaço — o fã cola do zap', async () => {
  const dono = await faNovo('normaliza');
  const amigo = await faNovo('normaliza-amigo');
  const liga = await p.leagues.create(dono.id, 'Copa da Rua');
  const entrou = await p.leagues.joinByCode(amigo.id, `  ${liga.inviteCode.toLowerCase()}  `);
  assert.equal(entrou.id, liga.id);
});

test('código que não abre liga nenhuma é 404, não um 200 mudo', async () => {
  const fa = await faNovo('codigo-ruim');
  await assert.rejects(() => p.leagues.joinByCode(fa.id, 'ZZZZZZ'), InviteCodeInvalidError);
});

test('ENTRAR na liga de um amigo NÃO gasta a cota do free', async () => {
  // Joining another league must not consume the user's owned-league allowance.
  const dono = await faNovo('cota-dono');
  const amigo = await faNovo('cota-amigo');
  const liga = await p.leagues.create(dono.id, 'Liga do Dono');
  await p.leagues.joinByCode(amigo.id, liga.inviteCode);

  const propria = await p.leagues.create(amigo.id, 'Liga do Amigo');
  assert.ok(propria.id, 'entrou numa liga e AINDA pode criar a dele');

  const dele = await p.leagues.listForUser(amigo.id);
  assert.equal(dele.length, 2, 'vê as duas: a que entrou e a que criou');
  assert.equal(dele.filter((l) => l.iLead).length, 1, 'lidera só a que criou');
});

test('quem não foi convidado não é membro — a liga é privada', async () => {
  const dono = await faNovo('privada');
  const estranho = await faNovo('estranho');
  const liga = await p.leagues.create(dono.id, 'Só Nossa');
  assert.equal(await p.leagues.isMember(liga.id, estranho.id), false);
  assert.equal(await p.leagues.isMember(liga.id, dono.id), true);
});

test('o apelido do membro pode ser NULL — e continua NULL (E12: nunca do e-mail)', async () => {
  const dono = await faNovo('sem-apelido');
  const liga = await p.leagues.create(dono.id, 'Sem Nome Ainda');
  const [membro] = await p.leagues.listMembers(liga.id);
  // A missing persisted handle must remain NULL rather than being fabricated.
  assert.equal(membro.handle, null);
  assert.equal(membro.role, 'owner');
});

test('nome de liga vazio, curto ou gigante não entra', async () => {
  const dono = await faNovo('nome');
  await p.users.setPremium(dono.id, true);
  for (const ruim of ['', '  ', 'ab', 'x'.repeat(25)]) {
    await assert.rejects(() => p.leagues.create(dono.id, ruim), LeagueNameInvalidError);
  }
  // Repeated whitespace is normalized rather than rejected.
  const liga = await p.leagues.create(dono.id, '  Resenha    FC  ');
  assert.equal(liga.name, 'Resenha FC');
});

test('o LÍDER apaga a liga: os membros saem junto e a cota do free VOLTA', async () => {
  const dono = await faNovo('apaga-dono');
  const amigo = await faNovo('apaga-amigo');
  const liga = await p.leagues.create(dono.id, 'Vai Sumir FC');
  await p.leagues.joinByCode(amigo.id, liga.inviteCode);

  await p.leagues.delete(liga.id, dono.id);

  assert.equal(await p.leagues.findById(liga.id), null, 'a liga tem que sumir do banco, não da tela');
  const [m] = await p.db.query(
    `select count(*)::int as n from league_members where league_id = $1`,
    [liga.id],
  );
  assert.equal(m.n, 0, 'apagar a liga leva os membros junto (FK on delete cascade da 0002)');
  assert.equal(await p.leagues.listForUser(amigo.id).then((l) => l.length), 0,
    'o amigo não pode continuar vendo uma liga que não existe');

  // The free quota counts owned leagues, so deletion restores the allowance.
  assert.equal(await p.leagues.countOwned(dono.id), 0, 'a cota do free tem que voltar');
  const outra = await p.leagues.create(dono.id, 'A Que Ficou');
  assert.ok(outra.id, 'o free apagou a dele e pode criar outra no lugar');
});

test('membro que NÃO lidera não apaga: 403 honesto, e a liga fica', async () => {
  const dono = await faNovo('naolidera-dono');
  const amigo = await faNovo('naolidera-amigo');
  const liga = await p.leagues.create(dono.id, 'Fica FC');
  await p.leagues.joinByCode(amigo.id, liga.inviteCode);

  await assert.rejects(
    () => p.leagues.delete(liga.id, amigo.id),
    (e) => {
      assert.ok(e instanceof LeagueNotOwnerError);
      assert.equal(e.status, 403, 'membro sem liderança é 403 — ele JÁ vê a liga, não há o que esconder');
      return true;
    },
  );
  assert.ok(await p.leagues.findById(liga.id), 'a liga não pode ter sumido');
  assert.equal((await p.leagues.findById(liga.id)).memberCount, 2, 'e ninguém saiu dela');
});

test('quem NÃO é membro recebe o MESMO 404 de liga inexistente — apagar não vaza existência', async () => {
  const dono = await faNovo('estranho-dono');
  const estranho = await faNovo('estranho-fa');
  const liga = await p.leagues.create(dono.id, 'Invisível FC');

  // Use the same error for an unknown league and a non-member to avoid leaking existence.
  await assert.rejects(() => p.leagues.delete(liga.id, estranho.id), LeagueNotFoundError);
  await assert.rejects(
    () => p.leagues.delete('00000000-0000-0000-0000-000000000000', estranho.id),
    LeagueNotFoundError,
  );
  assert.ok(await p.leagues.findById(liga.id), 'tentativa de fora não pode apagar nada');
});

test('uma liga tem UM dono — o banco recusa o segundo', async () => {
  const dono = await faNovo('um-dono');
  const outro = await faNovo('um-dono-outro');
  const liga = await p.leagues.create(dono.id, 'Um Dono Só');
  // The partial index enforces a single owner per league.
  await rejeitaCom(
    () =>
      p.db.query(`insert into league_members (league_id, user_id, role) values ($1, $2, 'owner')`, [
        liga.id,
        outro.id,
      ]),
    /league_members_one_owner_uk|duplicate key/
  );
});

// ---------------------------------------------------------------------------
// persistent lobby: invitation, host, and members survive web-process restarts
// ---------------------------------------------------------------------------

test('lobby nasce com código seguro e anfitrião como primeiro membro', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-host');
  await p.matches.upsert({ fixtureId: 910001, p1: 'England', p2: 'Argentina', startTime: 1_700_000_000_000 });
  const lobby = await p.lobbies.create(host.id, 910001, false);

  assert.match(lobby.inviteCode, /^[A-HJKMNP-Z2-9]{6}$/);
  assert.equal(lobby.hostUserId, host.id);
  assert.equal(lobby.memberCount, 1);
  assert.equal((await p.lobbies.findForMember(lobby.inviteCode, host.id))?.id, lobby.id);
});

test('entrar por código é idempotente e não troca o anfitrião', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-host-2');
  const friend = await p.users.findOrCreateByPrivyDid('did:privy:lobby-friend');
  await p.matches.upsert({ fixtureId: 910002, p1: 'France', p2: 'England', startTime: 1_700_000_000_000 });
  const created = await p.lobbies.create(host.id, 910002, true);

  await p.lobbies.joinByCode(friend.id, ` ${created.inviteCode.slice(0, 3)}-${created.inviteCode.slice(3)} `);
  const again = await p.lobbies.joinByCode(friend.id, created.inviteCode.toLowerCase());
  assert.equal(again.memberCount, 2);
  assert.equal(again.hostUserId, host.id);
});

test('convite expirado não aceita novo membro', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-expired-host');
  const friend = await p.users.findOrCreateByPrivyDid('did:privy:lobby-expired-friend');
  await p.matches.upsert({ fixtureId: 910003, p1: 'Brazil', p2: 'Portugal', startTime: 1_700_000_000_000 });
  const lobby = await p.lobbies.create(host.id, 910003, false);
  await p.db.query(`update lobbies set expires_at = now() - interval '1 minute' where id = $1`, [lobby.id]);
  await assert.rejects(() => p.lobbies.joinByCode(friend.id, lobby.inviteCode), LobbyUnavailableError);
});

test('sair do lobby revoga a URL antiga e aceitar o convite novamente restaura o vínculo', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-leave-host');
  const friend = await p.users.findOrCreateByPrivyDid('did:privy:lobby-leave-friend');
  await p.matches.upsert({ fixtureId: 910004, p1: 'France', p2: 'England', startTime: 1_700_000_000_000 });
  const lobby = await p.lobbies.create(host.id, 910004, false);
  await p.lobbies.joinByCode(friend.id, lobby.inviteCode);

  await p.lobbies.markLeft(lobby.inviteCode, friend.id);
  assert.equal(await p.lobbies.findForMember(lobby.inviteCode, friend.id), null);
  assert.equal((await p.lobbies.findByCode(lobby.inviteCode))?.memberCount, 1);

  await p.lobbies.joinByCode(friend.id, lobby.inviteCode);
  assert.equal((await p.lobbies.findForMember(lobby.inviteCode, friend.id))?.memberCount, 2);
});

test('sair no meio da partida e voltar devolve a MESMA sala (o convite não morre no apito inicial)', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-rejoin-host');
  const friend = await p.users.findOrCreateByPrivyDid('did:privy:lobby-rejoin-friend');
  await p.matches.upsert({ fixtureId: 910007, p1: 'France', p2: 'England', startTime: 1_700_000_000_000 });
  const lobby = await p.lobbies.create(host.id, 910007, false);
  await p.lobbies.joinByCode(friend.id, lobby.inviteCode);
  await p.lobbies.markStarted(lobby.inviteCode, host.id);

  await p.lobbies.markLeft(lobby.inviteCode, friend.id);
  assert.equal(await p.lobbies.findForMember(lobby.inviteCode, friend.id), null);

  const devolta = await p.lobbies.joinByCode(friend.id, lobby.inviteCode);
  assert.equal(devolta.id, lobby.id, 'tem que voltar para a mesma sala');
  assert.equal((await p.lobbies.findForMember(lobby.inviteCode, friend.id))?.id, lobby.id);
});

test('amigo que recebe o convite DEPOIS do apito inicial ainda entra', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-late-host');
  const atrasado = await p.users.findOrCreateByPrivyDid('did:privy:lobby-late-friend');
  await p.matches.upsert({ fixtureId: 910008, p1: 'Brazil', p2: 'Portugal', startTime: 1_700_000_000_000 });
  const lobby = await p.lobbies.create(host.id, 910008, false);
  await p.lobbies.markStarted(lobby.inviteCode, host.id);

  const entrou = await p.lobbies.joinByCode(atrasado.id, lobby.inviteCode);
  assert.equal(entrou.memberCount, 2);
  assert.equal((await p.lobbies.findForMember(lobby.inviteCode, atrasado.id))?.id, lobby.id);
});

test('partida encerrada: estranho é recusado, mas quem jogou volta para ler o resultado', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-done-host');
  const friend = await p.users.findOrCreateByPrivyDid('did:privy:lobby-done-friend');
  const estranho = await p.users.findOrCreateByPrivyDid('did:privy:lobby-done-stranger');
  await p.matches.upsert({ fixtureId: 910009, p1: 'Spain', p2: 'Argentina', startTime: 1_700_000_000_000 });
  const lobby = await p.lobbies.create(host.id, 910009, false);
  await p.lobbies.joinByCode(friend.id, lobby.inviteCode);
  await p.lobbies.markStarted(lobby.inviteCode, host.id);
  await p.lobbies.markFinished(lobby.inviteCode, host.id);
  await p.lobbies.markLeft(lobby.inviteCode, friend.id);

  await rejeitaCom(() => p.lobbies.joinByCode(estranho.id, lobby.inviteCode), LobbyUnavailableError);
  const devolta = await p.lobbies.joinByCode(friend.id, lobby.inviteCode);
  assert.equal(devolta.id, lobby.id);
});

test('lotação: sala em jogo recusa membro NOVO mas nunca quem já tinha vaga', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-cheia-host');
  const friend = await p.users.findOrCreateByPrivyDid('did:privy:lobby-cheia-friend');
  const estranho = await p.users.findOrCreateByPrivyDid('did:privy:lobby-cheia-stranger');
  await p.matches.upsert({ fixtureId: 910010, p1: 'France', p2: 'Spain', startTime: 1_700_000_000_000 });
  const lobby = await p.lobbies.create(host.id, 910010, false);
  await p.lobbies.joinByCode(friend.id, lobby.inviteCode);
  await p.db.query('update lobbies set max_players = 2 where id = $1', [lobby.id]);
  await p.lobbies.markStarted(lobby.inviteCode, host.id);

  await rejeitaCom(() => p.lobbies.joinByCode(estranho.id, lobby.inviteCode), LobbyUnavailableError);
  // The returning fan already held a slot: refusing them would strand a mere refresh.
  await p.lobbies.markLeft(lobby.inviteCode, friend.id);
  await p.lobbies.joinByCode(estranho.id, lobby.inviteCode); // a vaga liberada foi ocupada
  assert.equal((await p.lobbies.joinByCode(friend.id, lobby.inviteCode)).memberCount, 3);
});

test('convite expirado recusa até quem já era membro', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-exp-rejoin-host');
  const friend = await p.users.findOrCreateByPrivyDid('did:privy:lobby-exp-rejoin-friend');
  await p.matches.upsert({ fixtureId: 910011, p1: 'England', p2: 'Spain', startTime: 1_700_000_000_000 });
  const lobby = await p.lobbies.create(host.id, 910011, false);
  await p.lobbies.joinByCode(friend.id, lobby.inviteCode);
  await p.lobbies.markStarted(lobby.inviteCode, host.id);
  await p.lobbies.markLeft(lobby.inviteCode, friend.id);
  await p.db.query(`update lobbies set expires_at = now() - interval '1 minute' where id = $1`, [lobby.id]);

  await rejeitaCom(() => p.lobbies.joinByCode(friend.id, lobby.inviteCode), LobbyUnavailableError);
});

test('apenas o anfitrião encerra e o encerramento é idempotente', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-finish-host');
  const friend = await p.users.findOrCreateByPrivyDid('did:privy:lobby-finish-friend');
  await p.matches.upsert({ fixtureId: 910005, p1: 'Brazil', p2: 'Portugal', startTime: 1_700_000_000_000 });
  const lobby = await p.lobbies.create(host.id, 910005, false);
  await p.lobbies.joinByCode(friend.id, lobby.inviteCode);
  await p.lobbies.markStarted(lobby.inviteCode, host.id);

  await assert.rejects(() => p.lobbies.markFinished(lobby.inviteCode, friend.id), LobbyUnavailableError);
  await p.lobbies.markFinished(lobby.inviteCode, host.id);
  await p.lobbies.markFinished(lobby.inviteCode, host.id);
  assert.equal((await p.lobbies.findByCode(lobby.inviteCode))?.phase, 'finished');
});

test('o runner consegue encerrar o lobby quando todos fecharam o navegador', async () => {
  const host = await p.users.findOrCreateByPrivyDid('did:privy:lobby-system-finish');
  await p.matches.upsert({ fixtureId: 910006, p1: 'England', p2: 'Argentina', startTime: 1_700_000_000_000 });
  const lobby = await p.lobbies.create(host.id, 910006, true);
  await p.lobbies.markStarted(lobby.inviteCode, host.id);

  await p.lobbies.markFinishedBySystem(lobby.inviteCode);
  await p.lobbies.markFinishedBySystem(lobby.inviteCode);
  assert.equal((await p.lobbies.findByCode(lobby.inviteCode))?.phase, 'finished');
});

// ---------------------------------------------------------------------------
// pre-match picks: four markets and idempotent settlement
// ---------------------------------------------------------------------------

// Scoring is injected so the repository can be tested without depending on core.
const gradeFake = (pick, final) => {
  const outcome =
    final.goalsP1 > final.goalsP2 ? 'home' : final.goalsP2 > final.goalsP1 ? 'away' : 'draw';
  const resultCorrect = pick.result === null ? null : pick.result === outcome;
  const scoreCorrect = !pick.scoreSet ? null : pick.scoreA === final.goalsP1 && pick.scoreB === final.goalsP2;
  const goalsCorrect = pick.goals === null ? null : pick.goals === (final.goalsP1 + final.goalsP2 > pick.goalsLine ? 'over' : 'under');
  const cornersCorrect = pick.corners === null ? null : pick.corners === (final.cornersTotal > pick.cornersLine ? 'over' : 'under');
  const awardedXp =
    (resultCorrect ? 30 : 0) + (scoreCorrect ? 60 : 0) + (goalsCorrect ? 25 : 0) + (cornersCorrect ? 25 : 0);
  return { resultCorrect, scoreCorrect, goalsCorrect, cornersCorrect, awardedXp };
};

test('pregame: upsert grava um palpite e reler devolve o que foi salvo', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:pregame1');
  await p.matches.upsert({ fixtureId: 920001, p1: 'França', p2: 'Inglaterra', startTime: 1_700_000_000_000 });

  const salvo = await p.pregame.upsert(u.id, 920001, {
    result: 'home', scoreA: 2, scoreB: 1, scoreSet: true, goals: 'over', goalsLine: 2.5, corners: null, cornersLine: null,
  });
  assert.equal(salvo.result, 'home');
  assert.equal(salvo.scoreA, 2);
  assert.equal(salvo.scoreSet, true);
  assert.ok(salvo.submittedAt, 'confirmar marca submitted_at');

  const lido = await p.pregame.getByUserFixture(u.id, 920001);
  assert.equal(lido.result, 'home');
  assert.equal(lido.goals, 'over');
  assert.equal(lido.goalsLine, 2.5, 'a linha TxLINE viaja junto com o palpite');
  assert.equal(lido.corners, null);
});

test('pregame: reeditar NÃO duplica a linha e preserva o submitted_at original', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:pregame2');
  await p.matches.upsert({ fixtureId: 920002, p1: 'A', p2: 'B', startTime: 1_700_000_000_000 });

  const um = await p.pregame.upsert(u.id, 920002, {
    result: 'home', scoreA: 0, scoreB: 0, scoreSet: false, goals: null, goalsLine: null, corners: null, cornersLine: null,
  });
  const dois = await p.pregame.upsert(u.id, 920002, {
    result: 'away', scoreA: 1, scoreB: 3, scoreSet: true, goals: 'under', goalsLine: 3.5, corners: 'over', cornersLine: 9.5,
  });

  assert.equal(dois.result, 'away', 'a edição vale');
  assert.equal(dois.scoreSet, true);
  assert.equal(dois.goalsLine, 3.5, 'edição troca a linha junto com o mercado');
  assert.equal(dois.submittedAt, um.submittedAt, 'submitted_at é de quando confirmou a 1ª vez');

  const [linha] = await p.db.query(`select count(*)::int as n from pregame_picks where user_id = $1 and fixture_id = 920002`, [u.id]);
  assert.equal(linha.n, 1, 'um palpite por fã por partida');
});

test('pregame: liquidar credita o XP dos acertos, e liquidar de novo paga ZERO', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:pregame-settle');
  await p.matches.upsert({ fixtureId: 920003, p1: 'França', p2: 'Inglaterra', startTime: 1_700_000_000_000 });
  // Match every prediction for a 2–1 final score and 12 corners: 140 XP.
  await p.pregame.upsert(u.id, 920003, {
    result: 'home', scoreA: 2, scoreB: 1, scoreSet: true, goals: 'over', goalsLine: 2.5, corners: 'over', cornersLine: 9.5,
  });
  const xpAntes = (await p.users.findById(u.id)).xp;
  const final = { goalsP1: 2, goalsP2: 1, cornersTotal: 12 };

  const um = await p.pregame.settleFixture(920003, final, gradeFake);
  assert.equal(um.liquidados, 1);
  assert.equal(um.jaEstavam, 0);

  const depois = await p.users.findById(u.id);
  assert.equal(depois.xp - xpAntes, 140, 'quatro acertos = 140 XP');

  // Lazy settlement can run on every GET; settled_at prevents duplicate awards.
  const dois = await p.pregame.settleFixture(920003, final, gradeFake);
  assert.equal(dois.liquidados, 0, 'a segunda liquidação não paga');
  assert.equal(dois.jaEstavam, 0, 'o filtro já pulou a linha liquidada');
  assert.equal((await p.users.findById(u.id)).xp - xpAntes, 140, 'segue 140, não 280');

  const lido = await p.pregame.getByUserFixture(u.id, 920003);
  assert.ok(lido.settledAt, 'ficou marcado como liquidado');
  assert.equal(lido.awardedXp, 140);
  assert.equal(lido.resultCorrect, true);
});

test('pregame: só os acertos pagam — resultado certo e placar errado credita 30', async () => {
  const u = await p.users.findOrCreateByPrivyDid('did:privy:pregame-parcial');
  await p.matches.upsert({ fixtureId: 920004, p1: 'França', p2: 'Inglaterra', startTime: 1_700_000_000_000 });
  await p.pregame.upsert(u.id, 920004, {
    result: 'home', scoreA: 3, scoreB: 0, scoreSet: true, goals: 'under', goalsLine: 2.5, corners: null, cornersLine: null,
  });
  const xpAntes = (await p.users.findById(u.id)).xp;

  // A 2–1 final selects over and only the outcome prediction is correct.
  await p.pregame.settleFixture(920004, { goalsP1: 2, goalsP2: 1, cornersTotal: 3 }, gradeFake);

  const lido = await p.pregame.getByUserFixture(u.id, 920004);
  assert.equal(lido.resultCorrect, true);
  assert.equal(lido.scoreCorrect, false);
  assert.equal(lido.goalsCorrect, false);
  assert.equal(lido.cornersCorrect, null, 'não preencheu escanteios');
  assert.equal(lido.awardedXp, 30);
  assert.equal((await p.users.findById(u.id)).xp - xpAntes, 30);
});

test('totaisFinais: usa o último valor CONHECIDO de cada chave (§11: a chave entra no meio do jogo)', async () => {
  await p.matches.upsert({ fixtureId: 920010, p1: 'A', p2: 'B', startTime: 1 });
  await p.events.upsertMany([
    // seq 76: first score event with no totals keys yet
    evento(76, { fixtureId: 920010, action: 'corner', hasScore: true, goals: { p1: 0, p2: 0 }, corners: { p1: 0, p2: 0 }, totals: { p1: {}, p2: {} } }),
    // seq 77: the corners counter appears
    evento(77, { fixtureId: 920010, action: 'corner', hasScore: true, corners: { p1: 1, p2: 0 }, totals: { p1: { Corners: 1 }, p2: { Corners: 0 } } }),
    // seq 539: first goal; the Goals key appears only now
    evento(539, { fixtureId: 920010, action: 'goal', hasScore: true, goals: { p1: 1, p2: 0 }, corners: { p1: 4, p2: 2 }, totals: { p1: { Goals: 1, Corners: 4 }, p2: { Goals: 0, Corners: 2 } } }),
    // seq 900: final score is 2–1 with 6–4 corners (10 total)
    evento(900, { fixtureId: 920010, action: 'goal', hasScore: true, goals: { p1: 2, p2: 1 }, corners: { p1: 6, p2: 4 }, totals: { p1: { Goals: 2, Corners: 6 }, p2: { Goals: 1, Corners: 4 } } }),
  ]);

  const t = await p.events.totaisFinais(920010);
  assert.deepEqual(t.goals, { p1: 2, p2: 1 });
  assert.deepEqual(t.corners, { p1: 6, p2: 4 }, 'escanteios finais = 10 no total');
});

test('totaisFinais: evento final SEM bloco Score não zera o que já se sabia (A4)', async () => {
  await p.matches.upsert({ fixtureId: 920011, p1: 'A', p2: 'B', startTime: 1 });
  await p.events.upsertMany([
    evento(10, { fixtureId: 920011, action: 'goal', hasScore: true, goals: { p1: 2, p2: 1 }, corners: { p1: 5, p2: 4 }, totals: { p1: { Goals: 2, Corners: 5 }, p2: { Goals: 1, Corners: 4 } } }),
    // game_finalised may omit Score; normalize produces hasScore=false.
    evento(11, { fixtureId: 920011, action: 'game_finalised', hasScore: false, goals: { p1: 0, p2: 0 }, corners: { p1: 0, p2: 0 }, totals: { p1: {}, p2: {} } }),
  ]);
  const t = await p.events.totaisFinais(920011);
  assert.deepEqual(t.goals, { p1: 2, p2: 1 }, 'o evento sem Score não pode regredir o placar');
  assert.deepEqual(t.corners, { p1: 5, p2: 4 });
  assert.equal(await p.events.totaisFinais(999999), null, 'partida sem timeline = null');
});
