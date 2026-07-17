# Modo Ao Vivo — arquitetura da janela única (France × England, fixture 18257865)

**Alvo:** France × England, `fixtureId 18257865`, **18/07/2026 21:00 UTC** — única chance de exercitar o caminho ao vivo antes da submissão (19/07 23:59 UTC). Spain × Argentina (19/07 19:00 UTC) cai tarde demais para descobrir problema (CONTEXT §1).

**Princípio de projeto:** o caminho ao vivo **reusa o pipeline do replay** — mesmo motor, mesmo filtro de lances, mesmo handler de evento, mesma sala. O que muda é (a) de onde vêm os eventos (`startLiveIngest` em vez de `ReplayRunner`), (b) a velocidade do relógio (1×), e (c) a persistência acontecer **durante** o jogo. Duplicar regra é o bug nº 1 do projeto (a regra do lance já divergiu uma vez entre a rota REST e a sala — `apps/web/src/server/lances.ts` existe por isso). O adaptador live carrega **duas regras próprias, e só duas, cada uma espelhando uma régua que já existe num único lugar**: o dedupe de kickoff (§4.3, régua de `lances.ts`) e o filtro de mercado de odds (§2.1, critério da projeção do `oddsRepo`). As duas nasceram de refutação com medição na revisão adversarial deste documento — sem elas o live diverge do replay em silêncio.

Tudo abaixo foi conferido no código em **17/07** (inclusive uma passada adversarial que refutou duas afirmações da primeira versão — corrigidas em §4.2/§4.3 e §2.1); afirmações sobre a devnet/infra carregam data ou o rótulo **"não verificado"**.

---

## 0. O estado de partida (medido em 17/07)

| Peça | Estado | Onde |
|---|---|---|
| `startLiveIngest(onEvent)` | pronto, **sem nenhum chamador** (grep: só definição + reexport) | `packages/txline/src/ingest/live.ts:247` |
| `TXLINE_LIVE_INGEST` | `false` no `.env` (linha 46) e no Railway — **desligado** | `packages/txline/src/config.ts` (getter `!== "false"`: **ausente = LIGADO**) |
| Sala | só nasce de timeline pré-existente no Postgres (`criarSala` → 404 se `matches` ou `match_events` vazios) | `apps/web/src/server/rooms.ts:208-236` |
| Relógio da sala | `cursorClock(cursor, REPLAY_SPEED)` com `REPLAY_SPEED=12` do `.env` (default 60) | `rooms.ts:69,237` · `packages/core/src/clock.ts` |
| Persistência ao vivo | **inexistente** — `startLiveIngest` só chama `onEvent`; nada grava | — |
| Peças de persistência prontas | `eventRepo.upsert(ev)` unitário idempotente (UNIQUE `(fixture_id, seq)`), `oddsRepo.upsertManyRaw(rows)` (conflito por `message_id`), `matchRepo.upsert`/`setState`, `findSeqGaps` | `packages/db/src/repos/` |
| Deploy | Railway, **1 réplica Node persistente**, `npm start`, `railway.json` | raiz do repo |
| A7 | **o caminho ao vivo nunca processou um evento real** — streams só vistos "open / 0 eventos" | header de `live.ts` |

---

## 1. Visão geral do fluxo

```
TxLINE devnet
  /scores/stream ──┐                       ┌─► sala live 18257865 (Map em rooms.ts)
  /odds/stream ────┤  SSE + JWT + retomada │     ├─ QuestionEngine (o MESMO)
                   ▼                       │     ├─ criarFiltroDeLances (o MESMO)
        startLiveIngest(onEvent)           │     ├─ OddsExplainer (o MESMO)
        (packages/txline — não conhece     │     ├─ dedupe de kickoff (§4.3)
         salas nem banco)                  │     └─ processarEvento(...) ◄── EXTRAÍDO
                   │                       │          do closure hoje passado ao
                   ▼                       │          ReplayRunner — UMA regra
   apps/web/src/server/live.ts (NOVO)      │
     ├─ filtro: ev.fixtureId === LIVE_FIXTURE_ID ── descarta o resto (contado)
     ├─ filtro odds: 1X2 de jogo inteiro (§2.1) ─── o resto persiste, não roteia
     ├─ persiste: eventRepo.upsert / oddsRepo.upsertManyRaw([ev.raw])  ◄─ A1
     └─ roteia: barramento em processo ────┘
                   │
                   ▼
   Postgres (matches / match_events / match_odds)
     └─ catch-up de quem entra no meio do jogo + sobrevivência a restart
```

Um processo Node, uma réplica Railway — o `Map` de salas e o singleton do ingest vivem no mesmo lugar, de propósito (é a decisão já tomada em `docs/realtime-stack.md`: SSE + réplica única nesta entrega).

---

## 2. O chamador de `startLiveIngest` — onde vive, quem inicia, lifecycle

### 2.1. Novo módulo: `apps/web/src/server/live.ts`

É a única peça realmente nova. Responsabilidades, nesta ordem por evento:

1. **Filtrar por fixture.** Os streams entregam **todas** as fixtures. `ev.fixtureId !== LIVE_FIXTURE_ID` → descarta, mas **conta** (`ignoradosDeOutrasFixtures`) — descarte silencioso é como bug se esconde. `LIVE_FIXTURE_ID` é env explícita (`18257865` no dia do jogo). Explícito ganha de esperto com horas no relógio; multi-sala é v-depois.
2. **Persistir** (ver §3) — antes de qualquer coisa que possa lançar.
3. **Filtrar mercado antes de rotear odds.** O caminho de replay **nunca** entrega qualquer mercado à sala: o filtro vive na SQL da projeção — `oddsRepo.listReplayByFixture` só devolve `market_type = '1X2_PARTICIPANT_RESULT' and market_period is null` (`oddsRepo.ts:197-206`). Já `normalizeOdds` aceita **qualquer** mercado com `PriceNames/Prices` (`normalize.ts:83-141`): over/under, handicap e 1X2 **de período**. Rotear tudo corromperia `atualizarPct1x2` (`chances.ts:76-81` não checa `marketType`/`marketPeriod` — um 1X2 de 1º tempo com nomes `part1/draw/part2` entra como se fosse jogo inteiro) e afogaria o `OddsExplainer` (medido no header do `oddsRepo.ts`: 34.971 eventos de odds numa partida real, só 3.758 são 1X2 de jogo inteiro — ~9× mais volume; a família das "115 explicações fantasma" do v0). **O ramo live aplica o MESMO critério da projeção no roteamento:** `ev.marketType === MERCADO_1X2 && ev.marketPeriod == null` (importando a constante de `@palpitei/db` — não uma cópia da string), com contador `foraDoMercado` no status. Isso também mantém o catch-up (§2.4) e o tempo real consistentes: quem entra no minuto 60 lê do banco **já filtrado** e reconstrói o mesmo estado de quem assistiu do início.
4. **Rotear** para a sala live aberta, se houver, via um pequeno barramento em processo (um `Set` de handlers registrados pela sala; padrão `globalThis` como `fixtures.ts` e `lobbies.ts` já fazem, para sobreviver ao HMR do dev).

O módulo expõe `iniciarCanalAoVivo()` (idempotente, guardada por singleton em `globalThis`) e um status próprio que agrega `liveStatus` do pacote + contadores de persistência/roteamento.

### 2.2. Quem chama: `instrumentation.ts` do Next

`apps/web/src/instrumentation.ts` com `register()` — o hook oficial do Next 15 que roda **uma vez por boot do processo servidor** (`npm start` no Railway). Dentro dele:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { iniciarCanalAoVivo } = await import('./server/live');
  await iniciarCanalAoVivo();
}
```

**Não verificado nesta app** que o `instrumentation.ts` roda limpo com a config atual do `next.config.mjs` — testar em dev **hoje (17/07)**, não no dia do jogo. **Plano B, já pronto no design:** como `iniciarCanalAoVivo()` é idempotente, ela é chamada **na primeira linha** do handler de `GET /api/live/status` (§6) — antes de qualquer outra coisa que o handler faça — garantindo o boot no primeiro `curl` do runbook. Como a rota é pública read-only (decisão no §6), não há verificação de auth que possa curto-circuitar o plano B.

`iniciarCanalAoVivo()` faz, no boot:

1. **Trava explícita da aplicação (a 3ª trava, ver §5):** só prossegue se `process.env.TXLINE_LIVE_INGEST === 'true'` **e** `LIVE_FIXTURE_ID` estiver definida. Isso neutraliza a semântica perigosa do getter do pacote ("ausente = ligado") sem tocá-lo.
2. **Semeia a fixture** (resolve o gap do `matches`): `fetchFixtures()` → acha `18257865` → `createMatchRepo(db).upsert(fx, { source: 'txline-live' })`. Sem essa linha com `start_ts`, a sala dá 404 e a janela da `final_result` degrada (G4 — comentário em `matchRepo.ts:37-41`). O upsert usa coalesce e nunca piora dado. Se o snapshot falhar no boot, loga **alto** e tenta de novo com backoff — sem a linha não há sala live.
3. `startLiveIngest(onEvent)` com o handler descrito em 2.1.

**Lifecycle:** o processo Railway é persistente com `restartPolicyType: ON_FAILURE`; se cair, o boot refaz tudo (a idempotência do `startLiveIngest` e do upsert cuidam do resto). Não há shutdown gracioso a construir — `stopLiveIngest()` existe se precisar, mas na janela do jogo ninguém desliga nada.

### 2.3. Como o evento chega ao pipeline da sala — extração, não duplicação

Hoje **toda** a lógica por evento vive no closure `(ev) => { ... }` passado ao `ReplayRunner` dentro de `criarSala` (`rooms.ts:489-591`): âncora do cursor, odds → `atualizarPct1x2` + explicador, score → engine, guard `falaDeGols`, merge de `totals` chave a chave, `ehLance` e o broadcast de `score_event` com o acumulado.

**Mudança:** extrair esse corpo para uma função nomeada no próprio `rooms.ts`:

```ts
function processarEvento(sala: Room, ctx: CtxDaSala, ev: NormEvent): void
```

onde `CtxDaSala` carrega o que hoje é capturado pelo closure (`explicador`, `ehLance`, `publicarBruto`, `cursor`, `state`, `engine`). O `ReplayRunner` passa a receber `(ev) => processarEvento(sala, ctx, ev)`; a assinatura da sala de replay **não muda em nada**. A sala live registra no barramento o mesmo `processarEvento`, envelopado só pelo dedupe de kickoff do §4.3. **Uma regra, dois alimentadores.** É a mesma jogada do `XP_BASE` exportado e do `lances.ts`: a alternativa (copiar o handler) é o modo de falha já pago duas vezes neste projeto.

### 2.4. A sala live nasce sem timeline (gap 3)

`criarSala` ganha um ramo live, decidido por `fixtureId === Number(process.env.LIVE_FIXTURE_ID)`:

- `matches.findById` continua obrigatório (a semeadura do §2.2 garante) — sem a linha, 404 honesto.
- `listReplayByFixture` **vazio deixa de ser 404** no ramo live: no apito inicial há zero eventos gravados e isso é o esperado.
- **Âncora do relógio antes do primeiro evento.** O código atual assume timeline não vazia (`cursor.matchTs = linhaDoTempo[0]!.ts`, `rooms.ts:236`; `kickoff = eventos.find(...) ?? eventos[0]!`, `rooms.ts:238`) — com zero eventos, uma implementação ingênua deixa `matchTs` `undefined` → `clock.now()` = `NaN` → janelas do motor quebram **sem erro nenhum**. No ramo live com timeline vazia, o cursor ancora explicitamente em `matchTs = start_ts` da fixture semeada (não nulo — é critério do runbook às 20:00) e `realAt = Date.now()`; o primeiro evento real re-ancora como sempre. Até lá, `state.minute`/`clockSeconds` ficam `null` e a UI mostra o estado de espera do §6 — nunca um relógio inventado.
- **Catch-up com dedupe:** a sala (a) registra o handler no barramento **antes** de ler o banco, bufferizando o que chegar; (b) lê `listReplayByFixture` + `oddsRepo.listReplayByFixture` e passa tudo **sincronamente** por `processarEvento` (sem runner — é fast-forward: o engine abre/fecha/resolve pelas `ts` dos eventos, exatamente como faz no replay); (c) drena o buffer descartando score com `seq <= últimoSeq` do catch-up e odds com `messageId` já visto no catch-up. Quem entra no minuto 60 vê placar, totais e feed reconstruídos — é o mesmo mecanismo que o `room_state` do replay já explora.
- **Sem `ReplayRunner`** no ramo live: `sala.runner` vira opcional (ou um objeto nulo com `stop()` vazio) — `encerrar()` chama `runner.stop()` hoje.
- **Fim de jogo (gap 11):** não há `onDone` de runner. O fio já existe no motor: `QuestionEngine.onScoreEvent` trata `game_finalised` (ou `statusId===100 && period===100`, `questions.ts:109-110`) e emite `game_end`, que o `emit` da sala já usa para `state.finished = true`. No ramo live, ao ver `game_end`, publicar também `replay_done` com `source: 'txline-live'` (é o evento que a tela usa para encerrar; manter o nome do §8 — renomear contrato a 24h do jogo é risco gratuito) e chamar `matchRepo.setState(fixtureId, 'finished')`.
- **Estado `live` no banco (gap 9):** no **primeiro evento normalizado** da fixture, `live.ts` chama `matchRepo.setState(18257865, 'live')` (uma vez). A aba "Ao Vivo" da home já marca `live: fx.gameState === 2` a partir do snapshot da devnet (`fixtures/route.ts`) — **não verificado** se a devnet muda `gameState` para 2 durante o jogo; o `setState` no banco é o cinto de segurança para a listagem do cache. O fluxo de lobby é o mesmo do replay (criar lobby, host inicia, `phase='started'` libera o stream) — nada a mudar ali, apenas ensaiar o caminho no dry-run.

---

## 3. Persistência DURANTE o jogo (A1)

**Por que durante, não no fim:** o dataset da devnet rotaciona — a `18241006` já sumiu do snapshot (medido 17/07 02:20 UTC). Gravar só no apito final é apostar tudo num processo que não pode reiniciar. E um restart do Railway no minuto 60 sem persistência perderia a partida inteira.

**Como:** em `live.ts`, por evento da fixture-alvo:

- score → `eventRepo.upsert(ev)` — unitário, `on conflict (fixture_id, seq) do nothing`. O comentário no topo do `eventRepo.ts` diz que ele foi feito **exatamente** para isto: o SSE reconecta com `Last-Event-ID` e reenvia; reenvio vira no-op.
- odds → `oddsRepo.upsertManyRaw([ev.raw])` — não existe upsert unitário de odds (verificado 17/07); o `upsertManyRaw` com array de 1 resolve, conflito por `message_id`. `normalizeOdds` **já preserva o payload cru** em `ev.raw` (`normalize.ts:139`, verificado 17/07) — nenhuma mudança no normalize é necessária. A persistência recebe **todos** os mercados da fixture (o `upsertManyRaw` filtra internamente com `eh1x2JogoInteiro` — o mesmo critério da projeção); o filtro explícito do §2.1 vale para o **roteamento** à sala.
- Escrita **assíncrona, fila curta, falha contada e logada alto** (`falhasDePersistencia` no status): o caminho da tela não espera o banco, mas erro de banco **nunca** é engolido mudo — é a regra 4 do CLAUDE.md.
- `matchRepo.upsert(..., { source: 'txline-live' })` na semeadura + `setState('live')` no 1º evento: é a primeira vez que o vocabulário `txline-live` (que existe nos três tipos espelhados — `MatchCacheFonte`, `CacheSource`, `ReplaySource`) será **gravado** de verdade.

**Backstop pós-jogo:** `npm run cache:match 18257865` assim que acabar, mesmo com a persistência ao vivo funcionando — a varredura de `/updates` preenche qualquer buraco de seq (reconexão que o `Last-Event-ID` não repôs), e o UNIQUE torna a sobreposição gratuita. **O alerta do CONTEXT §10 vale inteiro:** o script tem fallback silencioso para arquivo (`resolveStore`, `cache-match.ts:36-65`) — **ler a linha `destino:`**; tem que dizer `Postgres (@palpitei/db)`. Se disser `arquivo em …`, não gravou onde a app lê (e o `.gitignore` protege o §7, mas "achar que gravou" é o bug). Verificação no banco no runbook (§8 abaixo).

**Buraco de seq durante o jogo:** `findSeqGaps(18257865)` pode rodar a qualquer momento (SQL pronta no runbook, 21:45). Se aparecer buraco no intervalo, rodar `cache:match` **no meio do jogo** é seguro e idempotente — repõe o que faltou no banco (a sala em memória não reprocessa o evento perdido; limitação aceita e documentada — o dado fica salvo, e a pergunta que dependia dele resolve pelo evento seguinte ou anula).

---

## 4. Relógio ao vivo e a aritmética das janelas

### 4.1. Qual Clock

`packages/core/src/clock.ts` tem `liveClock()` (speed 1, `now()=Date.now()`) pronto e sem uso. **Decisão: a sala live usa `cursorClock(cursor, 1)` — o mesmo `cursorClock` de hoje, com speed 1** — em vez de trocar de tipo de relógio. Motivos:

- A speed 1, `cursorClock` ≡ `liveClock` entre eventos (`matchTs + Δreal × 1`), **mas ancorado no `ts` do feed**: se o relógio do feed da devnet divergir do relógio de parede do container (skew, `ts` simulado), o motor continua no tempo **do feed** — que é a regra da casa ("os motores nunca leem `Date.now()`; o tempo deles é o `ts` do evento"). `liveClock()` puro reintroduziria uma dependência de `Date.now()` alinhado ao feed que ninguém mediu.
- Zero mudança estrutural: `processarEvento` já re-ancora o cursor a cada evento; a sala live só passa `1` onde a de replay passa `REPLAY_SPEED`.
- O receio do B2 (runner comprime buracos e o relógio de parede diverge) não existe ao vivo — não há compressão — então as duas opções seriam corretas; esta é a de menor diff.

**`REPLAY_SPEED` não participa do ramo live.** A speed do ramo live é a constante `1`, hardcoded — não uma env. Usar a env (12 hoje, default 60 se ausente, em **dois** lugares independentes) é a armadilha já paga do §11.

`state.replaySpeed = 1` no `RoomState` — o cliente interpola o minuto entre eventos com essa taxa, e a 1× o badge do relógio anda em tempo real, como deve.

### 4.2. A conta das janelas (por que 1× muda tudo)

`questions.ts`: `windowMs(base) = max(base, MIN_REAL_WINDOW_MS × clock.speed)`, com `MIN_REAL_WINDOW_MS = 8_000`.

| | speed 60 | speed 12 | **speed 1 (ao vivo)** |
|---|---|---|---|
| `next_goal` (base 60s) | max(60s, 480s) = **480s de jogo** = 8s reais | max(60s, 96s) = 96s de jogo = 8s reais | **max(60s, 8s) = 60s de jogo = 60s reais** |
| `hilo_corners` (base 45s, horizonte 600s) | 480s de janela / 600s de horizonte → anulação quase certa | 96s / 600s → resolve na maioria, mas é o tipo que mais anula: dos 11 voids medidos em 17/07, **9 são hilo_corners** (a taxa geral entre liquidadas é 87,2% — a específica da hilo é necessariamente menor; **não calculada por tipo**) | **45s / 600s → o piso de 8s nem é atingido** |
| `final_result` (base 600s) | 600s de jogo = 10s reais | = 50s reais | **600s de jogo = 10 min reais — mas ver §4.3: sem o dedupe de kickoff, viram ~3s** |
| `closesInRealMs` (`toRealMs`) | ÷60 | ÷12 | **÷1 — ms de jogo = ms reais** |

Leitura: **a 1× o piso `MIN_REAL_WINDOW_MS` fica inerte** (8s < todas as bases) e as janelas de `next_goal`/`hilo` assumem seus valores de projeto pela primeira vez. A regra de justiça continua podendo anular — um gol nos primeiros 60s de uma `next_goal` recém-aberta anula a pergunta, e isso é a regra funcionando — mas a patologia do replay acelerado (piso comendo o horizonte) desaparece. A `final_result`, porém, tem uma armadilha própria a 1× — o §4.3.

### 4.3. O par de kickoff e a `final_result` — a exceção que exige um dedupe

**Medido no Postgres (17/07, fixture 18241006): o feed manda o kickoff EM PAR.** Seq 15 (`ts=1784142020270`) e seq 17 (`ts=1784142023104`) — Δ = **2,8s**; o 2º tempo idem (seq 428/430). E `handleKickoff` (`questions.ts:268-293`) fecha a `pendingFinal` quando `opensAt < ev.ts && teveTempoMinimoNoReplay`, onde `teveTempoMinimoNoReplay` (`questions.ts:274-276`) é `clock.speed <= 1 || …` — **a speed ≤1 o guard é sempre true**, ou seja, ele age na direção OPOSTA à que se esperaria: a 1× ele **desliga** a exigência de janela mínima e autoriza o fechamento imediato. A 12× o mesmo par não fecha nada (2,8s de jogo < 96s exigidos) — por isso o replay nunca mostrou o problema. Sem correção, a `final_result` — a pergunta de 150 XP do vídeo — abriria no primeiro kickoff e fecharia no segundo: **~3 segundos de janela**, morrendo calada (o `question_open` ainda anuncia `closesInRealMs` de 10 min, então o critério ingênuo do runbook passaria).

**Decisão: dedupe de kickoff por `clockSeconds` no ramo live, ANTES do motor.** É a mesma régua que `lances.ts` já usa para dedupar kickoff no feed da tela (`lances.ts:104-105`, o set `vistos`) — a regra tem um dono; o adaptador live a reaplica na entrada do motor, não a reinventa (extrair o helper de `lances.ts` se a implementação pedir). Com o par dedupado: a `final_result` abre no kickoff real e fecha em `opensAt + 600s` (10 min reais) ou no kickoff do 2º tempo — o que vier primeiro —, que é o comportamento de projeto. O kickoff do 2º tempo **não** é vítima do dedupe (clockSeconds ~2700 ≠ 0). O motor (`questions.ts`) **não muda** — a mudança vive no adaptador live e está documentada aqui como uma das duas exceções ao "nenhuma regra nova" (a outra é o filtro de mercado do §2.1).

Residual honesto: o par medido veio do replay da 18241006; **não verificado** que o France × England ao vivo repetirá o padrão (pode vir par, evento único, ou trio). O dedupe é inofensivo nos três casos, e o runbook (20:55 e 21:00) confere a janela real da `final_result` pelos contadores, não por esperança.

---

## 5. As três travas e o plano de flags

O CONTEXT §10 documenta **duas** travas (sem chamador + `TXLINE_LIVE_INGEST=false`). Esta arquitetura adiciona uma **terceira, de sinal invertido e seguro**: o chamador (`live.ts`) exige `TXLINE_LIVE_INGEST === 'true'` **literal** e `LIVE_FIXTURE_ID` definida. Isso importa porque o getter do pacote é `trim(...) !== "false"` — **apagar a linha do env LIGA o ingest do pacote**. Com a trava da aplicação exigindo `'true'` explícito, o estado default do sistema (env ausente) volta a ser **desligado**, que é o único default aceitável para um caminho que consome a API da devnet.

| Ambiente | `TXLINE_LIVE_INGEST` | `LIVE_FIXTURE_ID` | `REPLAY_SPEED` | Efeito |
|---|---|---|---|---|
| Dev (agora → 18/07) | `false` (como está, linha 46 do `.env`) | ausente | 12 | live morto, replay normal. HMR do dev duplicaria streams se ligado — mais um motivo para ficar `false`. |
| Dry-run (18/07 de manhã, local ou Railway) | `true` | `18257865` | 12 | streams abrem, **"open / 0 eventos" esperado** (jogo não começou) — valida só credencial/conexão/boot. Desligar após o teste. |
| Produção pré-jogo | `false` explícito (como está no Railway desde 17/07) | ausente | 12 | replay/demo funcionam, live morto. |
| **Dia do jogo, ~20:00 UTC** | **`true`** | **`18257865`** | 12 (irrelevante para o ramo live — speed é 1 hardcoded) | ingest + persistência + sala live. |
| Pós-jogo (19/07) | `false` de volta | remover | 12 | replay da 18257865 recém-gravada vira o caminho da demo. |
| Sempre, em todo ambiente | `TXLINE_ALLOW_SYNTHETIC` **AUSENTE** | | | sintético jamais em demo/submissão. |

**Local durante o jogo: flags desligadas.** Um segundo ingest no laptop não corromperia o banco (idempotência por seq/message_id), mas dobraria o consumo da devnet e criaria uma segunda fonte de log para confundir o diagnóstico na noite em que só há uma chance.

---

## 6. Honestidade de estado — "open / 0 eventos" NÃO é sucesso

A7 é o risco raiz: os streams conectam e silenciam quando não há partida coberta; só `liveStatus.normalizados > 0` prova vida. A arquitetura trata isso como feature de produto, não como log:

- **Rota de diagnóstico `GET /api/live/status`** (nova, leitura). **Decisão: pública, read-only, de propósito** — ela expõe só contadores operacionais (`recebidos/normalizados/descartados/reconexoes/foraDoMercado/…`), `segundosEmSilencio`, `lastEventId`, e o `count(*)` corrente de `match_events`/`match_odds` da fixture; **nenhum dado de fã**. Se fosse "autenticada como as demais" (que respondem 401 fechado — `state/route.ts:29`, confirmado na produção em 17/07), todo `curl` do runbook falharia em 401 e o plano B de boot do §2.2 poderia nunca disparar. Único cuidado: `iniciarCanalAoVivo()` na **primeira linha** do handler. A `ultimaAmostra` (300 chars de payload cru) fica **fora** da resposta pública — payload da TxLINE não sai por rota aberta (§7 do hackathon); ela continua nos logs do Railway, que são privados.
- **UI da sala live:** selo de fonte **`txline-live`** setado **explicitamente** no ramo live. Nota de precisão (corrigida em revisão): `rooms.ts:244` usa `fixture.cacheSource ?? 'txline-cache'`, e a semeadura do §2.2 grava `source: 'txline-live'` — então o selo já sairia certo do banco hoje. Setar explícito é cinto-e-suspensório contra escrita futura por cima do `cache_source` (ex.: o `cache:match` pós-jogo grava `'txline-updates'` — `cache-match.ts:113` + coalesce do `matchRepo` — e uma sala live reaberta depois disso herdaria o rótulo errado). Enquanto `normalizados === 0`, a sala mostra estado honesto: **"AO VIVO · aguardando o feed da TxLINE"** com placar vazio — nunca 0×0 inventado, nunca fallback para replay com cara de live. O fã logado vê espera ou erro; mock com cara de real é a regra 4 do CLAUDE.md.
- **Logs que o `live.ts` acrescenta aos do pacote:** o pacote já loga as 3 primeiras amostras cruas (o diagnóstico do "payload divergiu do replay → tudo vira `descartados`"), o marco "PRIMEIRO evento ao vivo recebido", e descartes em 1º/2º/a cada 50. O `live.ts` loga o primeiro evento **da fixture-alvo**, o primeiro persistido, e **todo** erro de persistência/handler (com contador — o `warn` que engole exceção do handler em `live.ts:196-199` é conhecido; os contadores impedem que ele esconda uma hemorragia).
- **Sem fallback silencioso, em nenhum nó:** ingest mudo → a sala diz que está esperando; persistência falhando → contador + log alto; normalize descartando → `descartados` subindo é visível na rota de status; odds fora do mercado → `foraDoMercado` sobe em vez de sumir. Cada modo de falha tem um sintoma **observável de fora**.

---

## 7. Robustez contra as armadilhas medidas

Quase tudo vem **de graça** por reusar `processarEvento` — e é o argumento central contra qualquer reimplementação:

- **A4/G7 e a interação** ("as chaves entram no `Total` durante o jogo"): o guard `falaDeGols` (`rooms.ts:529-535`) e o **merge por chave** de `totals` (`rooms.ts:552-557`) valem no live sem tocar em nada. O CONTEXT avisa que a 18241006 só fechou 1×2 por sorte (depois do seq 539 a chave `Goals` nunca mais faltou) — France × England não deve nada a essa sorte, e o guard existe exatamente para isso.
- **Anuncia-e-contabiliza:** o delta por contador vive em `criarFiltroDeLances` (`lances.ts`), instanciado por sala — a régua é da partida. O mapa `CONTADORES` (`Corners/YellowCards/RedCards`) segue a regra "só entra chave que o feed traz"; se o France × England trouxer chave nova (`Shots`?), ela aparece nos `totals` da aba de estatísticas (merge por chave mostra o que vier) mas **não** vira lance dedupado — comportamento degradado seguro, nunca linha fantasma. O kickoff em par tem tratamento próprio no motor via §4.3.
- **`message_id` é string:** `oddsRepo` e `normalize` já tratam (verificado no header do `oddsRepo.ts`); a persistência live usa o mesmo caminho.
- **`penalty` e `Participant` nunca observados:** `penalty` não está no `Set` `LANCES` → não vira lance no feed da tela (perda estética, não corrupção); o motor não depende dele; gols continuam por delta do contador, nunca por `Participant`. Se aparecer, os payloads ficam gravados no `raw` para estudo pós-jogo — é uma das perguntas abertas do handoff que este jogo responde.
- **Payload ao vivo divergente do replay (A7 propriamente):** se `normalizeScore/normalizeOdds` devolverem `null`, tudo cai em `descartados` e a tela fica muda — as amostras cruas logadas são o diagnóstico, e o go/no-go do runbook decide em minutos. Nenhuma mitigação prévia é possível sem um evento real; a mitigação é observabilidade + o plano B honesto.
- **Reconexão:** backoff 1s→15s e `Last-Event-ID` já existem no pacote; retomada **nunca testada com eventos reais** — se a devnet não honrar, o buraco fica visível em `findSeqGaps` e o `cache:match` intra/pós-jogo repõe no banco (§3).
- **Restart do processo no meio do jogo:** os eventos persistidos sobrevivem (A1 resolvido); a sala renasce vazia de fãs mas o catch-up reconstrói placar/totais/feed; perguntas do processo morto ficam `open` no banco (residual já conhecido do §11) e os fãs re-palpitam nas novas. Recuperação de checkpoint do runner é explicitamente Fase 3 do `realtime-stack.md` — fora desta entrega.

---

## 8. Runbook — 18/07, horários UTC

**Pré-requisitos na véspera (17/07–18/07 manhã):** implementação dos §§2-6 mergeada; dry-run local de `instrumentation.ts` + dry-run com flags ligadas ("open / 0 eventos" esperado, valida credencial `TXLINE_API_TOKEN` + guest JWT nos streams); ensaio do fluxo lobby→sala com a sala de replay; **origem do Railway adicionada em Allowed origins da Privy** (pendência vermelha do CONTEXT §4 — sem ela não há login de fã real no vídeo; conferir com `npm run privy:doctor`).

A SQL de buracos de seq, pronta para colar (é a query de `eventRepo.findSeqGaps`, `eventRepo.ts:221-228`):

```sql
select anterior + 1 as de, seq - 1 as ate, seq - anterior - 1 as faltam
  from (select seq, lag(seq) over (order by seq) as anterior
          from match_events where fixture_id = 18257865) t
 where anterior is not null and seq - anterior > 1
 order by de;
```

| Hora (UTC) | Ação | Critério |
|---|---|---|
| **18:00** | Deploy final no Railway. `curl https://palpitei-v1-production.up.railway.app/api/live/status` (rota pública, sem token — §6) → live desligado, replay ok. | Demo de replay intacta (é o plano B do vídeo). |
| **20:00** | Setar no Railway `TXLINE_LIVE_INGEST=true`, `LIVE_FIXTURE_ID=18257865` → redeploy. `railway logs`: "ingestor ao vivo: abrindo streams SSE". | `scores=open`, `odds=open` no `/api/live/status`. Fixture semeada: `select fixture_id, start_ts, state, cache_source from matches where fixture_id=18257865;` → linha com **`start_ts` não nulo** (é a âncora do relógio do §2.4). |
| **20:15–20:55** | Vigiar `/api/live/status` a cada ~5 min. Pré-jogo pode trazer odds/escalações antes do apito (não verificado — a devnet nunca foi vista ao vivo). Criar lobby da 18257865 com a conta do vídeo, **não** iniciar ainda. | Se `normalizados > 0` antes das 21:00: A7 já está morto, comemorar nos logs. `count(*)` de `match_odds` subindo confirma persistência; `foraDoMercado` subindo junto é normal (~9× mais mercados que o roteado). |
| **21:00** | Apito. Vigiar o marco `PRIMEIRO evento ao vivo recebido` e o primeiro `roteadosParaSala`. Host inicia o lobby; abrir a sala. | Placar/feed reagindo; `question_open` de `next_goal`/`hilo` com `closesInRealMs` na casa de minuto (se vier ÷12, o speed do ramo live está errado). **`final_result`: conferir que ela segue ABERTA ~1 min após o kickoff** — se fechou em segundos, o par de kickoff passou pelo dedupe do §4.3 (padrão de feed diferente do medido); anotar e seguir: as demais perguntas não dependem dele. |
| **21:10 — GO/NO-GO** | **GO:** `scores.normalizados > 0` e sala reagindo → gravar o vídeo ao vivo (~21:15–21:50, tempo de pegar 1–2 perguntas resolvendo e o ranking mexendo). **NO-GO:** `normalizados == 0` com `recebidos == 0` (feed mudo) ou `descartados` subindo sozinho (payload divergente — ler as 3 amostras cruas no log; hotfix de normalize só se for trivialidade óbvia) → gravar o vídeo no **replay da 18241006 com selo honesto `txline-cache`**, sem fingir live. | A decisão é pelos contadores, não por esperança. "Open/0" às 21:10 = NO-GO. |
| **21:45–22:00 (intervalo)** | Rodar a **SQL de buracos acima** no banco. Se houver buraco: rodar `npm run cache:match 18257865` **agora** (idempotente, repõe no banco). | Sem buraco, ou buraco reposto. |
| **~22:50+ (apito final)** | Confirmar `game_end`/`replay_done` na sala e `state='finished'` no banco. **Rodar `npm run cache:match 18257865`** e **ler a linha `destino:`** — tem que dizer `Postgres (@palpitei/db)`; `arquivo em …` = não gravou onde a app lê (fallback silencioso do §10). | Verificação: `select fixture_id, cache_source, count(*) from match_events join matches using (fixture_id) where fixture_id = 18257865 group by 1,2;` — contagem > 0 e a SQL de buracos vazia. |
| **+10 min** | Reconferir `/scores/historical` da fixture (fecha ou confirma o A2 para o feedback à TxODDS — reconferir antes de reportar como quebrado). Anotar volume/latência observados, payload de `penalty` se houve, formato do `Participant` — as perguntas abertas do handoff. | — |
| **23:00** | `TXLINE_LIVE_INGEST=false` de volta no Railway (o jogo acabou; consumo à toa é risco à toa). O replay da 18257865 recém-gravada passa a ser demonstrável. | Demo de replay da partida nova funciona na produção. |

---

## 9. O que explicitamente FICA DE FORA

- **Liveblocks / Ably / PartyKit / Socket.IO** — `realtime-stack.md` já decidiu: SSE + réplica única nesta entrega; Liveblocks só quando `numReplicas > 1` (Fase 2).
- **Multi-réplica / serverless** — o Map de salas e o singleton do ingest são de processo único, assumido e documentado (`railway.json` fixa 1 réplica).
- **Roteamento multi-fixture / multi-sala live** — `LIVE_FIXTURE_ID` única. Generalizar é pós-hackathon.
- **Checkpoint/recuperação do runner e da engine após restart** — Fase 3 do realtime-stack; ao vivo, restart = catch-up de estado + fãs re-palpitam.
- **Backfill automático via `/updates` no caminho live** — o buraco de seq é detectado (SQL do §8) e reposto manualmente com `cache:match` (runbook); automatizar não cabe nas horas.
- **WebSocket** — SSE cumpre o contrato do §8; palpite continua POST.
- **Modo "vai sair pênalti?"** e qualquer pergunta nova dependente de payload nunca observado.
- **Mudanças no motor** (`questions.ts`, `lances.ts`, `clock.ts`) — **zero**. O que a primeira versão deste doc afirmou a mais — "as constantes rodam no regime de projeto sem nenhuma ressalva" — foi refutado com medição (§4.3): o regime de projeto a 1× só existe **com** o dedupe de kickoff e o filtro de mercado no adaptador. As duas regras do adaptador são o preço, documentado, de manter o motor intocado.

## 10. Ordem de implementação (horas, não dias)

1. Extrair `processarEvento` de `criarSala` e religar o `ReplayRunner` a ela — **sem mudança de comportamento**; rodar a suíte e um replay manual da 18241006 como regressão (~1,5h).
2. `apps/web/src/server/live.ts`: trava tripla, semeadura da fixture, filtro de fixture, **filtro de mercado (§2.1)**, persistência, barramento, contadores (~2h).
3. Ramo live em `criarSala`: sem exigência de timeline, âncora explícita do cursor (§2.4), catch-up + dedupe, **dedupe de kickoff (§4.3)**, `cursorClock(cursor, 1)`, `source: 'txline-live'`, `replay_done` no `game_end`, `setState` (~2h).
4. `instrumentation.ts` + `GET /api/live/status` pública (boot idempotente na 1ª linha) (~1h).
5. Dry-run com flags ligadas contra a devnet: streams `open`, semeadura no banco, sala live abre vazia e espera (~1h).

Total ~7,5h de trabalho sequencial, tudo antes da manhã de 18/07 — deixando a tarde para ensaio do runbook e da gravação.
