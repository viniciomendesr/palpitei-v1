# Palpite pré-jogo — design

**Data:** 2026-07-17 · **Branch:** `claude/live-architecture` · **Autor:** Claude (worktree `palpitei-v1-claude`)
**Fonte da UI:** mockup `Palpitei Prototype.dc.html` (projeto Claude Design `afc48231-…`), seção `PALPITE PRÉ-JOGO`.

## 1. O que é

Uma tela nova onde o fã **crava palpites antes do apito** de uma partida futura, valendo XP.
Quatro mercados, cada um com seu peso:

| Mercado | Escolha | XP |
|---|---|---|
| Resultado | casa / empate / fora | 30 |
| Placar exato | dois steppers 0–15 | 60 |
| Total de gols | Acima / Abaixo de 2,5 | 25 |
| Escanteios | Acima / Abaixo de 9,5 | 25 |

Editável **até o apito inicial**; depois trava (justo pra todo mundo). Liquida no fim da
partida, creditando XP pelos mercados acertados. Total possível: **140 XP**.

Voz de torcida, sem jargão de aposta ("Acima/Abaixo", nunca "over/odds"), sem emoji
(ícone é SVG inline). Segue `packages/ds/CONVENTIONS.md` e as regras do `docs/CONTEXT.md`.

## 2. Escopo (decidido com o usuário em 17/07)

**Full-stack**, em 4 camadas incrementais:

1. **Tela** (demo + fã logado) — o entregável central, fiel ao mockup.
2. **Entrada pela Home** — na aba "Próximas", o card abre o pré-jogo (CTA "Palpitar"/"Editar").
3. **Persistência** — tabela `pregame_picks` + repo + rotas (colocar/editar/travar/ler).
4. **Settlement** — liquida no fim, credita XP, lendo placar/escanteios reais.

Fora de escopo agora: notificações ("desafiar liga" só mostra toast, como no mockup);
linhas de mercado por partida (usamos linhas fixas 2,5 / 9,5, como o mockup).

## 3. Restrições que moldam o design (do CONTEXT/CLAUDE.md)

- **Identidade = `privy_did` verificado do Bearer, NUNCA `body.userId`.** Motor no servidor.
- **Sem mock com cara de real pro fã logado.** Se a API falhar, ele vê **erro**, não dado
  inventado (G6). O **modo demo é 100% local** (§5.1) e não depende de rede.
- **`level` é coluna GERADA** no Postgres — escrevo só `xp`; nível é derivado.
- **Ausente ≠ zero** ao ler o placar/escanteios finais (A4): uso o último evento com
  bloco `Score`, com fallback, nunca `{0,0}` de placeholder.
- **XP se exporta, não se copia** (bug nº 1): `PREGAME_XP` mora uma vez no core.
- **Sem tocar em arquivo do Codex** (`rooms.ts`, `room-lifecycle.ts`, `replay.ts`,
  `lobbyRepo.ts`, `relogio.ts`) nem no engine `packages/core/src/questions.ts`.
- **`i18n.tsx` é compartilhado** com o Codex: adições **aditivas**, num bloco separado no
  fim de cada dicionário, sem reordenar o existente.

## 4. Arquitetura

Tudo em **arquivos novos**, exceto duas edições aditivas de território meu
(`home/page.tsx`, `i18n.tsx`) e três pontos de "registro" (index/tipo do `@palpitei/db`,
`api.ts`). Nenhum arquivo do Codex nem do engine.

### 4.1 Domínio puro — `packages/core/src/pregame.ts` (novo)
Fonte única da regra de pontuação, testável sem banco:
```ts
export const PREGAME_XP   = { result: 30, score: 60, goals: 25, corners: 25 } as const;
export const PREGAME_LINES = { goals: 2.5, corners: 9.5 } as const;

export interface PregameFinal { goalsP1: number; goalsP2: number; cornersTotal: number; }
export interface PregamePickInput {
  result: 'home'|'draw'|'away'|null;
  scoreA: number; scoreB: number; scoreSet: boolean;
  goals: 'over'|'under'|null;
  corners: 'over'|'under'|null;
}
export interface PregameGrade {
  resultCorrect: boolean|null; scoreCorrect: boolean|null;
  goalsCorrect: boolean|null;  cornersCorrect: boolean|null;
  awardedXp: number;               // soma só dos acertos
}
export function gradePregame(pick: PregamePickInput, final: PregameFinal): PregameGrade;
```
Regras: resultado (p1>p2→home, p2>p1→away, senão draw); placar exato (scoreA==p1 &&
scoreB==p2, só se `scoreSet`); gols (p1+p2 vs 2,5); escanteios (`cornersTotal` vs 9,5).
Sem bônus de rapidez (palpite é pré-jogo; o tempo não conta). `null` = mercado não
preenchido → não pontua, não penaliza.

### 4.2 Banco — `supabase/migrations/0005_pregame_picks.sql` (novo)
```sql
create table if not exists pregame_picks (
  id uuid primary key default gen_random_uuid(),
  user_id    uuid   not null references users (id) on delete cascade,
  fixture_id bigint not null references matches (fixture_id),
  result   text    constraint pregame_result_ck  check (result  in ('home','draw','away')),
  score_a  smallint constraint pregame_score_a_ck check (score_a between 0 and 15),
  score_b  smallint constraint pregame_score_b_ck check (score_b between 0 and 15),
  score_set boolean not null default false,
  goals    text    constraint pregame_goals_ck   check (goals   in ('over','under')),
  corners  text    constraint pregame_corners_ck check (corners in ('over','under')),
  submitted_at timestamptz,                 -- 1º "Confirmar"
  settled_at   timestamptz,                 -- CAS de liquidação (credita 1x)
  result_correct boolean, score_correct boolean, goals_correct boolean, corners_correct boolean,
  awarded_xp integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pregame_user_fixture_uk unique (user_id, fixture_id)
);
create index if not exists pregame_picks_fixture_idx on pregame_picks (fixture_id);
-- RLS habilitada, sem policy (acesso só pelo backend), padrão do 0002.
```
Linhas (2,5 / 9,5) NÃO vão na tabela — são constantes de produto (mockup usa fixas). Se
um dia virarem por-partida, viram colunas; hoje seria dado morto.

### 4.3 Repo — `packages/db/src/repos/pregamePickRepo.ts` (novo)
`createPregamePickRepo(db)`:
- `getByUserFixture(userId, fixtureId)` → linha | null.
- `upsert(userId, fixtureId, picks)` → `insert … on conflict (user_id,fixture_id) do
  update`; grava `submitted_at` no 1º confirm; `updated_at=now()`. **Rejeita se travado**
  (checagem de `start_ts` no route; repo é burro).
- `settleFixture(fixtureId, final)` → para cada pick do fixture, `gradePregame`, e CAS
  idempotente `update … set settled_at=now(), *_correct, awarded_xp where settled_at is
  null returning user_id, awarded_xp`; credita `users.xp = xp + awarded_xp` numa `withTx`.
  **Nunca escreve `level`.** Retorna `{ liquidados, jaEstavam }`.

Espelha `predictionRepo` (CAS + crédito de XP), exporta de `packages/db/src/index.ts` e
entra em `createPalpitei()`/tipo `Palpitei`.

### 4.4 Rotas — `apps/web/src/app/api/pregame/[fixtureId]/…` (novas)
Ambas `runtime='nodejs'`, `dynamic='force-dynamic'`, DID do Bearer (guarda copiada da
rota irmã `rooms/[id]/predictions`).
- `GET /api/pregame/[fixtureId]` → `{ match, pick, locked, finished, results? }`.
  `locked = Date.now() >= match.start_ts`. Se `match.state==='finished'` e ainda não
  liquidado: **liquida lazy** (idempotente) lendo o placar/escanteios finais e devolve os
  resultados. `match` vem de `matchRepo.findById`; final de `eventRepo.listReplayByFixture`
  (regra de delta, último evento com `hasScore`; fallback pra escanteios).
- `POST /api/pregame/[fixtureId]` → body `{result?,scoreA?,scoreB?,scoreSet?,goals?,corners?}`;
  valida (enum/intervalo); **409 se travado**; `upsert`; devolve pick salvo + `xpEmJogo`
  (preview dos mercados preenchidos, via `PREGAME_XP`).

### 4.5 Cliente — `apps/web/src/lib/api.ts` (edição aditiva)
Tipos `PregamePick`, `PregamePickRequest` e `api.pregame.{ get(fixtureId), save(fixtureId, body) }`,
no mesmo wrapper (Bearer automático, `ApiError` no não-2xx).

### 4.6 Tela — `apps/web/src/app/palpite/[fixtureId]/page.tsx` (nova rota)
Fora da `BottomNav` (não está em `NAV_ROUTES`). Molde estrutural: cabeçalho **fixo** +
corpo **rolável** (`<Screen>`) + rodapé **fixo**, como `sala/[id]/page.tsx`. Voltar → `/home`.

Sub-componentes em `apps/web/src/components/palpite/` (unidades pequenas e testáveis):
- `PreJogoHeader` — voltar, título/grupo, badge "PALPITE ENVIADO", os dois times
  (sigla colorida + nome), "VS" + horário, pill "Fecha em … · apito inicial".
- `LinhaSocial` — avatares empilhados + "N amigos … já palpitaram" + botão "Desafiar liga".
- `MercadoResultado` — 3 botões segmentados (usa `segStyle` local, igual mockup).
- `MercadoPlacar` — dois `Stepper` −/+ (0–15) + `×`.
- `MercadoAcimaAbaixo` — 2 botões (reusado por gols e escanteios).
- `Stepper`, `AvataresEmpilhados` — primitivos inline (o DS não tem).
- Rodapé: progresso "N de 4 palpites" + "+X XP em jogo" (ouro) + `<Button size="lg" full>`
  "Confirmar palpites" / "Salvar alterações" (desabilitado com 0 preenchidos).

Estado da tela: local (`result, scoreA, scoreB, scoreTouched, goals, corners`), como o
mockup. XP em jogo e contagem derivados por `PREGAME_XP`.

### 4.7 Fonte de dados — `usePalpitePreJogo(fixtureId, session)` (novo hook)
Mesmo padrão do `useFixtures` (demo × real, e a guarda da corrida do Bearer:
`privy.ready && privy.authenticated` antes de buscar):
- **Demo** (`!session || authMethod==='demo'`): partida e resultado **locais** (mock),
  pick em memória/`sessionStorage`. Sem rede. Liquidação simulada localmente.
- **Fã logado**: `GET /api/pregame/[fixtureId]` hidrata match + pick + locked; `POST` no
  confirmar. Falha → **erro na tela**, nunca mock (G6).

### 4.8 Entrada — `apps/web/src/app/home/page.tsx` (edição aditiva, meu território)
Na aba `next`, o card passa a `onClick` → `router.push('/palpite/'+id)` e CTA "Palpitar"
(ou "Editar" se já enviado). Live/Replays seguem em `openSala`. É a única mudança na Home.

## 5. Fluxo de dados

```
Home (aba Próximas) --Palpitar--> /palpite/[fixtureId]
  demo:   mock local ................ pick local (sessionStorage)
  logado: GET /api/pregame/[id] ..... pick do banco (+ locked/finished)
Confirmar --> POST /api/pregame/[id] --> pregamePickRepo.upsert (rejeita se travado)
              --> volta pra Home + toast "Palpite enviado! · confirma no fim"
Fim da partida (state='finished') --> GET /api/pregame/[id] liquida lazy:
  eventRepo.listReplayByFixture -> final {gols,escanteios} -> gradePregame
  -> settleFixture (CAS settled_at) -> users.xp += awarded_xp
```

## 6. Erros e casos de borda

- **Travado** (`now>=start_ts`): POST → 409 "trava no apito"; tela em modo leitura + badge.
- **401** sem DID válido.
- **Fã logado, API fora**: erro visível; nunca mock.
- **Liquidação idempotente**: CAS em `settled_at`; rodar 2x não paga 2x.
- **Escanteios ausentes no evento final** (A4): cai pro último evento com `Corners`
  presente; se nunca houver, mercado fica sem liquidar (não inventa 0).
- **`level`**: só escrevo `xp`.
- **Placar regride** (A4×G7): uso o último evento com `hasScore`, não substituo cru.

## 7. Testes

- `packages/core/test/pregame.test.ts` — `gradePregame`: 4 mercados, bordas de O/U
  (2 gols vs 3; 9 vs 10 escanteios), placar exato, `scoreSet=false` não pontua.
- `apps/web/test/pregame-route.test.ts` — validação, 409 travado, DID obrigatório,
  upsert idempotente, `xpEmJogo` correto.
- `packages/db/test` — `settleFixture` credita 1x (CAS), soma só acertos, não toca `level`.
- Runner: `node --test`. `npm test` + `npm run typecheck` verdes antes de commitar.

## 8. Ordem de implementação (commits pequenos, protocolo dos 2 agentes)

1. `packages/core/src/pregame.ts` + teste (domínio puro; nada depende dele ainda).
2. Migração `0005` + `pregamePickRepo` + exports + teste de repo.
3. Rotas `GET/POST /api/pregame/[fixtureId]` + `api.ts` + teste de rota.
4. Tela `/palpite/[fixtureId]` + subcomponentes + `usePalpitePreJogo` + i18n (aditivo).
5. Entrada na Home (aba Próximas).
6. Verificação end-to-end (demo e, se der, fã logado sobre replay) + `/code-review`.

Cada passo commitado isolado; reviso o commit `9a2e515` do Codex já feito e evito os
arquivos dele. Quando integrar, resumir a decisão de arquitetura em `docs/CONTEXT.md §12`.
