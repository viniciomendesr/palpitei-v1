// Testes da camada de repositório contra um Postgres DE VERDADE.
//
// Não precisa de banco instalado, nem de Docker, nem da internet: o PGlite é o
// Postgres compilado para WASM, e o socket-server faz ele falar o protocolo de
// rede — então o `pg` conecta nele igualzinho conectaria no Supabase. O que
// está sendo exercitado aqui é o MESMO código que vai para produção, contra o
// MESMO motor de banco (não um mock, não um SQLite fingindo).
//
//   npm test -w @palpitei/db
//
// O que estes testes protegem é sempre a mesma coisa: as falhas SILENCIOSAS.
// Nenhuma delas dá erro em produção — todas dão número errado no ranking do
// jurado. Por isso o teste tenta ATIVAMENTE pagar duas vezes, regredir placar,
// colapsar a série de odds e roubar apelido.

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
} from '../dist/index.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
/**
 * TODAS as migrations, na ordem — não só a 0001.
 *
 * Ficar preso à 0001 significaria que a tabela criada na migration seguinte não
 * existe no teste: o teste da feature nova falharia com "relation does not
 * exist" e pareceria bug do código. Migration nova entra aqui.
 */
const MIGRATIONS = [
  resolve(AQUI, '../../../supabase/migrations/0001_init.sql'),
  resolve(AQUI, '../../../supabase/migrations/0002_leagues.sql'),
];
const PORTA = 5599;

/**
 * Espera uma rejeição E limpa a conexão depois.
 *
 * Peculiaridade do HARNESS, não do código: o socket-server do PGlite FECHA a
 * conexão depois de responder um erro de SQL. O Postgres de verdade não faz
 * isso — erro de constraint deixa a conexão perfeitamente usável (foi medido:
 * com 100ms de espera a query seguinte passa; sem espera, o pool entrega o
 * cliente moribundo e vem ECONNRESET). Como o pool descarta o cliente morto
 * sozinho, uma query sacrificial devolve o pool ao normal.
 *
 * Fica registrado para ninguém "consertar" o pool por causa de um artefato do
 * banco de teste.
 */
async function rejeitaCom(fn, matcher) {
  await assert.rejects(fn, matcher);
  await p.db.query('select 1').catch(() => {}); // drena o cliente morto (só PGlite)
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
// Identidade
// ---------------------------------------------------------------------------

test('find-or-create é pelo DID, e a carteira pode mudar sem criar conta nova', async () => {
  const a = await p.users.findOrCreateByPrivyDid(DID, {
    wallet: 'Wallet111',
    walletSource: 'privy_embedded',
  });
  // Segundo login, MESMO DID, carteira diferente (o fã vinculou a Phantom).
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
  // Modo demo (§5.1) é conta real do ponto de vista do banco, mas o namespace
  // do DID e a origem da carteira têm de contar a mesma história.
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
  // O createOnLogin da Privy defaulta a 'off': o login social entra e o fã fica
  // SEM carteira Solana. O schema guarda NULL exatamente para essa regressão dar
  // para ver. Se a leitura inventar uma origem, o requisito da trilha volta a
  // cair calado — e ainda por cima marcando um did:privy:* real como modo demo.
  const u = await p.users.findOrCreateByPrivyDid('did:privy:e2_sem_carteira');
  assert.equal(u.wallet, null);
  assert.equal(u.walletSource, null, 'ausente é ausente: NULL não pode virar "simulated"');

  // A combinação que o ?? 'simulated' fabricava é a que o banco RECUSA gravar.
  await rejeitaCom(
    () => p.db.query(
      `insert into users (privy_did, wallet_pubkey, wallet_source)
       values ('did:privy:impossivel', 'K', 'simulated')`
    ),
    /users_did_namespace_ck/
  );

  // E a consulta de diagnóstico que o próprio schema documenta tem que enxergar.
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
// O XP não pode ser pago duas vezes — o teste mais importante do arquivo
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

  // Uma entrega duplicada reemite o gol: a mesma pergunta resolve de novo.
  const dois = await p.predictions.settle('pred_idem', 'won', 150);
  assert.equal(dois.pagou, false, 'a segunda resolução NÃO pode pagar');

  // E de novo, agora pelo caminho que a sala usa (question_resolved).
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
// Ingestão: idempotência, A4 e a série de odds
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
    // kickoff do 2º tempo: o normalize entrega totals zerados + hasScore=false
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
  // Este é o bug do v0 em forma de teste: num() devolvia -1 para os dois e o
  // Map guardava um só. A série inteira (3.758 eventos) virava 1 registro.
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
      Prices: [], // mercado sem cotação naquele instante
    },
  ]);
  const desalinhadas = await p.odds.listaDesalinhadas(900002);
  const alvo = desalinhadas.find((d) => d.messageId === 'sem-cotacao');
  assert.ok(alvo, 'a linha tem que estar lá');
  assert.equal(alvo.nomes, 3);
  assert.equal(alvo.precos, 0, 'vazio ≠ [0,0,0] — inventar zeros gerou 115 explicações fantasma no v0');
});

// ---------------------------------------------------------------------------
// Cache de partida (substitui o .cache/ em disco — T&C §7)
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

  // 900001 tem perguntas mas nenhum match_event: cache.list() lista quem tem TIMELINE.
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
  // Um segundo upsert vindo de uma fonte mais pobre (sem StartTime).
  const depois = await p.matches.upsert({ fixtureId: 900005, p1: 'A', p2: 'B' });
  assert.equal(depois.startTime, 1_700_000_000_000, 'perder o start_ts é o G4 de volta');
  assert.deepEqual(await p.matches.semStartTs(), [], 'o detector do G4 tem que estar limpo');
});

test('upsert sem state NÃO rebaixa uma partida ao vivo para "scheduled"', async () => {
  // É o caminho real da demo: a partida está AO VIVO e alguém reupserta de uma
  // fonte que não carrega estado (matchCacheStore.save, refresh do /fixtures).
  // O 'scheduled' do VALUES é default de INSERT — não pode vazar para o UPDATE.
  await p.matches.upsert({ fixtureId: 900006, p1: 'França', p2: 'Inglaterra', startTime: 1, state: 'live' });
  const depois = await p.matches.upsert({ fixtureId: 900006, p1: 'França', p2: 'Inglaterra' });
  assert.equal(depois.state, 'live', 'não saber o estado não é motivo para rebaixar a partida');
  assert.equal((await p.matches.list({ state: 'live' })).some((m) => m.fixtureId === 900006), true,
    'a sala tem que continuar na aba "Ao Vivo"');

  // E o cache da partida (gravado logo que ela acaba) não pode ressuscitá-la.
  await p.matches.setState(900006, 'finished');
  await p.matches.upsert({ fixtureId: 900006, p1: 'França', p2: 'Inglaterra' }, { source: 'txline-cache' });
  assert.equal((await p.matches.findById(900006)).state, 'finished');

  // Quem sabe o estado continua mandando nele.
  const vivo = await p.matches.upsert({ fixtureId: 900006, p1: 'França', p2: 'Inglaterra', state: 'live' });
  assert.equal(vivo.state, 'live', 'state explícito tem que valer');
});

// ---------------------------------------------------------------------------
// Mercado (prévia da v2, USDC simulado)
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
  // O motor marca o mercado como resolvido em memória e emite market_resolved.
  // Se quem escuta gravar o mercado ANTES de chamar markets.resolve(), o save()
  // não pode virar o state para 'resolved': isso mataria o CAS e o resolve()
  // devolveria {pagou:false} — ninguém recebe e nada estoura.
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

  // A ordem perigosa: grava resolvido, DEPOIS paga.
  const resolvido = { ...aberto, state: 'resolved', winner: 'p1', pools: { p1: 1000, draw: 0, p2: 0 } };
  await p.markets.save(resolvido);
  const pago = await p.markets.resolve(resolvido, [{ ...bet, payoutCents: 950 }]);

  assert.equal(pago.pagou, true, 'save() não pode resolver: quem resolve é quem paga');
  assert.equal(pago.creditados, 1);
  assert.equal((await p.users.findById(u.id)).balanceCents, saldoInicial - 1000 + 950);

  // E continua valendo o outro lado: resolvido não volta atrás por save().
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
// Missões e conquistas
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
// EnginePorts — o contrato com @palpitei/core
// ---------------------------------------------------------------------------

test('EnginePorts: uid tem prefixo e não repete', async () => {
  const ids = new Set(Array.from({ length: 1000 }, () => p.ports.uid('pred')));
  assert.equal(ids.size, 1000);
  assert.ok([...ids][0].startsWith('pred_'));
});

test('EnginePorts: escrita que falha NÃO derruba o processo — e flush() conta a verdade', async () => {
  // O core chama as portas sem await. Se a Promise rejeitar solta, o Node 22
  // mata o processo: o fã veria {ok:true} e o servidor morreria em seguida.
  const erros = [];
  const ports = createEnginePorts(p.db, { onError: (e, ctx) => erros.push(ctx) });

  // Palpite órfão: a pergunta não existe -> violação de FK no banco.
  ports.savePrediction({ id: 'pred_boom', userId: '00000000-0000-0000-0000-000000000000', questionId: 'q_inexistente', choice: 'p1', placedAt: 1 });
  assert.equal(ports.pendentes(), 1);

  await assert.rejects(() => ports.flush(), /não dá para gravar o palpite|violates/);
  assert.equal(erros.length, 1, 'o erro tem que ser reportado, não engolido em silêncio');
  await p.db.query('select 1').catch(() => {});

  // E o processo continua vivo para o próximo palpite.
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
  // O motor preenche result/awardedXp e manda salvar de novo (fire-and-forget).
  p.ports.savePrediction({ ...pred, result: 'won', awardedXp: 225 });
  await p.ports.flush();
  p.ports.savePrediction({ ...pred, result: 'won', awardedXp: 225 }); // replay
  await p.ports.flush();
  const xp1 = (await p.users.findById(u.id)).xp;
  assert.equal(xp1 - xp0, 225, 'o replay nao paga de novo nem pela porta');
});

// ---------------------------------------------------------------------------
// Boot: a RLS ligada sem policy é uma armadilha para a role errada
// ---------------------------------------------------------------------------

test('assertDbReady detecta a role sujeita à RLS (o banco "funcionando" e vazio)', async () => {
  // schema_migrations é criada pelo migrate.mjs, não pela 0001 — aqui ela é
  // encenada para o assertDbReady poder chegar no que interessa.
  await p.db.query(`create table if not exists schema_migrations (
    version text primary key, checksum text not null,
    applied_at timestamptz not null default now())`);
  await p.db.query(`insert into schema_migrations (version, checksum) values ('0001_init', 'x')
                    on conflict (version) do nothing`);

  // A dona do schema ignora a RLS: tem que passar.
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
        // ESTE é o ponto: a leitura NÃO dá erro. A RLS sem policy só devolve
        // zero linhas — e count(*) devolve UMA linha dizendo n=0. Um check do
        // tipo "voltou linha?" nunca dispararia.
        const [c] = await tx.query(`select count(*)::int as n from users`);
        assert.equal(c.n, 0, 'a RLS zera a leitura em silêncio: é este o banco vazio');
        return assertDbReady(tx);
      }),
    /SUJEITA à RLS/,
    'a role errada tem que falhar ALTO no boot, não servir um banco vazio'
  );
});

// ---------------------------------------------------------------------------
// Ligas privadas
//
// O que estes testes protegem: a liga existir DE VERDADE. Antes da 0002 ela era
// um contador na sessão do browser (`session.leaguesCount++`) que sumia no F5 —
// e o "1 membro · você lidera" era string fixa do dicionário. Por isso os testes
// abaixo insistem em duas coisas: o número sai do banco, e o gate do free não
// pode ser furado por corrida.
// ---------------------------------------------------------------------------

async function faNovo(sufixo) {
  return p.users.findOrCreateByPrivyDid(`demo:liga-${sufixo}-${Math.random().toString(36).slice(2, 8)}`);
}

test('a liga PERSISTE, e o dono já entra como membro', async () => {
  const dono = await faNovo('persiste');
  const liga = await p.leagues.create(dono.id, 'Resenha FC');

  // Relido do banco, não do objeto que create() devolveu: é o F5.
  const lido = await p.leagues.findById(liga.id);
  assert.equal(lido.name, 'Resenha FC');
  assert.equal(lido.ownerId, dono.id);
  // 1 membro porque o DONO tem linha em league_members — não porque alguém
  // somou "+1" em cima de uma lista vazia.
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
  // O defeito clássico: ler o contador fora de trava. Os dois pedidos leem 0, os
  // dois criam, o fã free fica com 2 ligas — e ninguém vê erro nenhum. É por
  // isso que o create trava a linha do fã com `for update`.
  //
  // LIMITE DO HARNESS (não do código): aqui NÃO dá para afirmar QUAL erro a
  // perdedora recebe. O PGlite é Postgres de uma thread só (WASM): enquanto a
  // primeira transação segura a trava, ele não consegue atender a segunda
  // conexão, e o socket-server a derruba com ECONNRESET antes de o gate chegar a
  // responder. É a mesma classe de artefato já documentada no `rejeitaCom` lá em
  // cima.
  //
  // Contra o Postgres de verdade (Supabase, medido) a perdedora recebe
  // LeagueLimitError/402 — o caminho do paywall. O que ESTE teste garante nos
  // dois motores é o invariante que importa: o fã free não termina com 2 ligas.
  const dono = await faNovo('corrida');
  const r = await Promise.allSettled([
    p.leagues.create(dono.id, 'Corrida Um'),
    p.leagues.create(dono.id, 'Corrida Dois'),
  ]);
  const criou = r.filter((x) => x.status === 'fulfilled').length;
  assert.equal(criou, 1, 'exatamente uma pode ter sido criada');
  assert.equal(await p.leagues.countOwned(dono.id), 1, 'o free não pode terminar com 2 ligas');
  await p.db.query('select 1').catch(() => {}); // drena o cliente morto (só PGlite)
});

test('entrar pelo código põe o amigo na liga — e repetir não duplica', async () => {
  const dono = await faNovo('convite-dono');
  const amigo = await faNovo('convite-amigo');
  const liga = await p.leagues.create(dono.id, 'Time da Firma');

  const entrou = await p.leagues.joinByCode(amigo.id, liga.inviteCode);
  assert.equal(entrou.memberCount, 2);

  // Clicar no link duas vezes é o caso NORMAL, não o exótico.
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
  // Se gastasse, o primeiro amigo que você chamasse — que provavelmente já tem
  // a própria liga — não conseguiria aceitar o convite.
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
  // O onboarding grava o apelido só na sessão local; `users.handle` é NULL. A
  // tela diz "sem apelido" — inventar um nome aqui mentiria pra liga inteira.
  assert.equal(membro.handle, null);
  assert.equal(membro.role, 'owner');
});

test('nome de liga vazio, curto ou gigante não entra', async () => {
  const dono = await faNovo('nome');
  await p.users.setPremium(dono.id, true);
  for (const ruim of ['', '  ', 'ab', 'x'.repeat(25)]) {
    await assert.rejects(() => p.leagues.create(dono.id, ruim), LeagueNameInvalidError);
  }
  // O espaço repetido é normalizado, não recusado.
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

  // A cota do free conta ligas CRIADAS: a linha sumiu, a cota voltou.
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

  // Liga que existe mas não é dele × liga que não existe: o MESMO erro, de
  // propósito — um 403 aqui contaria a quem só tem o id que a liga existe.
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
  // Sem o índice parcial, isto passaria e a tela mostraria "você lidera" para
  // duas pessoas — sem erro nenhum.
  await rejeitaCom(
    () =>
      p.db.query(`insert into league_members (league_id, user_id, role) values ($1, $2, 'owner')`, [
        liga.id,
        outro.id,
      ]),
    /league_members_one_owner_uk|duplicate key/
  );
});
