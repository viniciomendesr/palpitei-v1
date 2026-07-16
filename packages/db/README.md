# @palpitei/db

Schema Postgres (Supabase) + camada de repositório.

**Supabase é usado só como Postgres.** Sem Supabase Auth, sem RLS de `auth.uid()`,
sem client Supabase no browser. A identidade é o `privy_did` verificado; só o
backend fala com o banco, por connection string.

```bash
cp .env.example .env      # preencha DATABASE_URL (o .env.example explica onde achar)
npm run db:migrate        # aplica supabase/migrations em ordem; idempotente
npm run db:status         # o que já foi aplicado
npm test -w @palpitei/db  # 30 testes contra Postgres de verdade (PGlite/WASM, sem instalar nada)
```

## Uso

```ts
import { createPalpitei } from '@palpitei/db';

const p = createPalpitei();                       // usa DATABASE_URL
const fa = await p.users.findOrCreateByPrivyDid(did, { wallet, walletSource });
await p.users.setHandle(fa.id, 'craque.10');      // 409 se já for de outra pessoa
```

`p` traz: `users`, `matches`, `events`, `odds`, `questions`, `predictions`,
`markets`, `gamification`, `cache` (timeline da partida), `ports` (EnginePorts)
e `db` (query/withTx crus).

## Se você está ligando isto no core ou na web, leia estes 6 pontos

1. **`ports.flush()` depois de aceitar palpite.** O core chama as portas em
   fire-and-forget. `engine.place()` devolve `{ok:true}` antes de o INSERT
   terminar; sem o flush, uma falha de escrita deixa o fã ouvindo "palpite
   registrado" para um palpite que não existe.

   ```ts
   const r = room.placePrediction(userId, questionId, choice);
   if (!r.ok) return res.status(400).json(r);
   await ports.flush();   // estoura aqui se o banco recusou
   return res.json(r);
   ```

2. **Grave a pergunta no `question_open`.** `predictions` referencia `questions`
   por FK: palpite em pergunta não gravada estoura na hora em que o fã palpita.
   Use `ports.saveQuestion(q)` (ou `questions.save(q)`) no handler do emit.

3. **`saveUser` NÃO é implementado, de propósito.** Ele mandaria um total de XP
   calculado em memória — escrita cega e absoluta, que perde XP quando o mesmo
   fã está em duas salas. O XP de palpite vai por `savePrediction(p)` com
   `result` preenchido (CAS idempotente); o saldo, por `saveBet` +
   `markets.resolve`. Leia o cabeçalho de `src/enginePorts.ts` antes de mexer.

4. **`db.User.handle` é `string | null`; o `core.User.handle` é `string`.** Não é
   descuido: o fã nasce sem apelido porque o onboarding é que pergunta (E12 —
   derivar do e-mail vazaria o endereço dele no ranking). O compilador vai te
   obrigar a decidir; a decisão certa é barrar quem ainda não escolheu:

   ```ts
   if (!fa.handle) return res.status(409).json({ error: 'escolhe seu apelido primeiro' });
   ```

   Idem `wallet` e `walletSource`: os dois são `null` quando a Privy não criou
   carteira (E2 — `createOnLogin` defaulta a `'off'`), e é assim que a regressão
   fica visível em vez de virar uma carteira inventada. **`walletSource === null`
   não é `'simulated'`**: `simulated` é o modo demo (§5.1), e marcar um
   `did:privy:*` real como demo é justamente dizer que ele NÃO cumpriu
   "sign up through Solana" — o banco recusa essa combinação
   (`users_did_namespace_ck`). Quem precisa de carteira testa por `null`:

   ```ts
   if (!fa.wallet) return res.status(409).json({ error: 'sua conta ainda não tem carteira' });
   ```

   O detector da regressão (tem que dar 0):

   ```sql
   select count(*) from users where privy_did like 'did:privy:%' and wallet_pubkey is null;
   ```

5. **Estado de partida: `upsert` não decide, `setState` decide.** `matches.upsert`
   com `state` ausente PRESERVA o estado que já estava lá (não sabe ≠ agendada).
   Para mover a partida de propósito, use `matches.setState(fixtureId, estado)`.

6. **Mercado: quem resolve é quem paga.** `markets.save()` nunca grava
   `state='resolved'` (rebaixa para `'closed'`). A resolução é `markets.resolve(market, bets)`,
   que vira o estado e credita na MESMA transação, sob o CAS. Se você gravar o
   mercado "resolvido" por fora e só depois chamar `resolve()`, sem essa trava
   ninguém receberia e nada estouraria.

## O que o schema garante sozinho

Estas não dependem de ninguém lembrar de nada — o banco recusa:

| Invariante | Como |
|---|---|
| XP não é pago duas vezes num replay | `settle` só morde `where result is null` (CAS) |
| Nível nunca diverge do XP | `level` é coluna GERADA: `floor(sqrt(xp/100)) + 1` |
| Reenvio do stream não duplica evento | `primary key (fixture_id, seq)` |
| Série de odds não colapsa num registro | `message_id` é **TEXT** (é string no feed) |
| Evento sem bloco `Score` não vira 0–0 | `check (has_score or score_totals is null)` (A4) |
| Conta demo não se passa por conta real | `users_did_namespace_ck` (`demo:` vs `did:privy:`) |
| Dois fãs não pegam o mesmo apelido | unique index em `lower(handle)` |
| Carteira sem origem (ou origem sem carteira) não entra | `users_wallet_par_ck` |
| A anon key do Supabase não lê nada | RLS ligada **sem policy** em todas as tabelas |
| A role errada não serve um banco vazio | `assertDbReady` checa `row_security_active('users')` |

Buracos na sequência (evento perdido) são consulta, não descoberta:
`events.findSeqGaps(fixtureId)`. Partidas sem `start_ts` (o G4, que faz o
desafio nascer fechado): `matches.semStartTs()`. Fãs da Privy sem carteira
Solana (o E2): `select count(*) from users where privy_did like 'did:privy:%'
and wallet_pubkey is null` — tem que dar 0.

**`assertDbReady(db)` no boot, sempre.** A RLS ligada sem policy fecha o
PostgREST, mas ela também é uma armadilha: qualquer role que não seja a dona do
schema passa a ler **zero linhas de tudo, sem erro e sem log**. O check não pode
ser "voltou linha?" — `select count(*)` devolve uma linha dizendo `n=0` mesmo
quando a RLS zerou tudo. Por isso ele pergunta `row_security_active('users')`.

## Cache de partida

`p.cache` substitui o `.cache/fixtures/*.json` do v0 — **T&C §7**: o dado da
TxLINE não pode ser redistribuído, e este repositório é público. A timeline mora
em `match_events`/`match_odds` (não num blob à parte: seria uma segunda verdade).

```ts
await p.cache.save(matchCache);   // idempotente; recusa cache sem startTime (G4)
const c = await p.cache.load(18241006);   // null se não há timeline gravada
```

Também responde por `salvarCache` / `lerCache` / `listarCache`, os nomes do v0.
