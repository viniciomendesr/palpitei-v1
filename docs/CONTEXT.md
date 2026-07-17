# Palpitei v1 — contexto para quem vai construir

**Leia isto antes de escrever qualquer linha.** Se você é um agente com uma tarefa
específica, leia mesmo assim: as armadilhas abaixo falham em **silêncio** e você não
vai tropeçar nelas — vai descobrir na frente do jurado.

> **Como ler esta doc.** Toda afirmação sobre estado externo (Privy, devnet, banco)
> vem com **data** e com o **comando que a reproduz**. Se estiver sem os dois, é
> **premissa**, não medição — trate como suspeita e meça.
>
> Isto não é formalidade: em 16/07 a tabela do §3 dizia "medido" e estava **invertida**
> (afirmava tudo `false`/`off`/`[]` numa app que já vinha `true`). A doc violou a
> própria nota de método do §9. Estado externo **muda sozinho**; a doc, não.

---

## 1. O que é, e com que prazo

Palpitei é um jogo social de inteligência esportiva: pega o dado ao vivo da TxLINE
(placar, eventos, odds) e vira pergunta, palpite e explicação simples, com XP,
ranking e ligas. **Não há dinheiro real na v1** — XP é pontuação, não valor.

- Trilha: **Consumer and Fan Experiences** (Superteam World Cup Hackathon / TxODDS).
- **Prazo: 19/07/2026 23:59 UTC** (listing Brasil 18/07 23:59 BR).
- **Critério nº 1 da trilha é acessibilidade para o fã comum.** Toda decisão empata
  a favor de menos atrito. Peso de bundle e tempo até o primeiro palpite são features.
- Janela de demo ao vivo: **France × England 18/07 21:00 UTC** (grave o vídeo aqui).
  Spain × Argentina 19/07 19:00 UTC é ~5h antes do prazo — tarde demais para descobrir problema.

  **Snapshot da devnet — medido em 17/07 02:20 UTC** (`CompetitionId: 72`). O snapshot
  inteiro tinha **2 fixtures**, e só estas:

  | fixtureId | partida | início (UTC) | no snapshot em 17/07 |
  |---|---|---|---|
  | **18257865** | France × England | 18/07 21:00 | presente |
  | **18257739** | Spain × Argentina | 19/07 19:00 | presente |
  | **18241006** | England × Argentina | (encerrada) | **AUSENTE** — só existe no cache |

  Reproduz com `fetchFixtures()` de `packages/txline/src/api.ts` (bate em
  `GET /api/fixtures/snapshot?competitionId=72`).

  **A1 não é teoria: está acontecendo.** `18241006` — a partida que sustenta todo o
  replay de hoje — **já saiu do snapshot**. Ela só existe porque foi persistida no
  Postgres (962 eventos, seq 2→963; 3758 odds). **Se você não gravar, perdeu.** Grave o
  `cache:match` da 18257865 assim que ela acabar.

  O caminho **ao vivo nunca processou um evento real** (achado A7: os streams SSE só foram
  vistos "abertos e saudáveis com 0 eventos"). A trilha exige "a live product that works
  during a match". **18257865 é a única chance real de exercitar isso antes do prazo** — e
  hoje `startLiveIngest` **não tem chamador**. Ver §10.
- v2 (**Presságio**, valor real em USDC) é **outro webapp**. A v1 só precisa deixar a
  identidade compartilhável. Não misture dinheiro aqui.

## 2. Regras do hackathon que restringem o código

| Regra | Consequência prática |
|---|---|
| **§5.1** — jurados testam sem custo e **sem criar carteira** | O **modo demo** (login instantâneo, conta de teste) não é enfeite: é requisito. Está no mockup. |
| **§7** — dado da TxLINE licenciado só para o hackathon, **sem redistribuição** | **Nada de payload da TxLINE versionado no repo público.** Cache vai para o Postgres, nunca para `.cache/` commitado. |
| TxLINE obrigatória como fonte primária/ao vivo | Replay sintético é **opt-in e dev-only**. Nunca em demo/submissão. Badge de fonte em cada sala. |
| Produto funcional, não mockup | Mockup/pitch = desclassificação automática. |
| §8.1 | Pode entrar nas 2 trilhas, ganha no máx. 1 prêmio. |

## 3. As armadilhas silenciosas (herdadas do v0 — não redescubra)

O v0 (`../palpitei-v0`) é uma bancada de integração que existe para **aposentar risco
antes da v1**. Ele produziu 40 achados (`../palpitei-v0/docs/achados.md`) e um handoff
(`../palpitei-v0/docs/handoff-v1.md`). O essencial:

> As desta seção vieram do **v0**. As que custaram sangue **nesta v1**, sobre a partida
> real, estão no **§11** — inclusive um G7 que **nós mesmos** reintroduzimos depois de
> documentá-lo aqui. Ler não imuniza.

### Tempo
- **Os motores NUNCA leem `Date.now()`.** O tempo deles é o `ts` do evento da TxLINE,
  via a abstração `Clock`. Ao vivo `now()=Date.now()`; em replay o relógio ancora no
  **último evento emitido** (`cursorClock`), não no relógio de parede — um relógio
  derivado do relógio de parede diverge do agendador e **fecha janelas sozinho** (bug real, B2).
- **Justiça:** a janela do palpite fecha **antes** do evento que o resolve. Se o evento
  resolvedor chega com a janela aberta, a pergunta é **anulada** (sem XP), não resolvida.

### "Ausente vs zero" — o mesmo feed exige três leituras opostas
| Onde | Regra | Se errar |
|---|---|---|
| Bloco `Score` ausente no evento (A4) | ausente **≠** zero | placar regride a 0–0 → gols fantasma |
| `Score.Total` sem a chave (G7) | ausente **=** zero | linhas somem da tela |
| `Prices: []` com `PriceNames` cheio (G8) | vazio **≠** zeros | "a chance caiu para 0%" — 115 explicações fantasma |

**Antes de mapear arrays paralelos (`PriceNames` ↔ `Prices` ↔ `Pct`), confira o tamanho dos três.**

> **As três regras não vivem separadas — o bug mora na INTERAÇÃO.** Medido em 17/07: a
> leitura **certa** do G7 (`?? 0` para chave ausente) é justamente a que produz o `{0,0}`
> de placeholder que dispara o **A4** (placar regredindo). Conferir cada regra isolada
> **não basta**. Ver §11, "As chaves ENTRAM no `Total` durante o jogo".

### Dados
- `/scores/updates` **é a linha do tempo** (962 eventos, seq contínuo 2→963). O snapshot
  é um **amostrador** (37 linhas, 1 por tipo de ação) — serve para estado atual, não para replay.
- `/odds/snapshot` devolve **UMA linha**. Construir o explicador nele deixa a feature sem
  dados e **sem erro nenhum** (G2). A série vem de `/odds/updates`.
- `/scores/historical` voltou **vazio para tudo** na devnet (A2). Reconferir antes de usar.
- `message_id` é **string**, não número. Parser numérico colapsa a série inteira num registro.
- Gols/escanteios por **delta** do bloco Score, não pelo campo `Participant`.
- O dataset da devnet **rotaciona**: se você não gravou, perdeu. Persista na primeira vez que vir.
- Prova de Merkle exige `(fixtureId, seq)` **reais** de um `game_finalised` observado.

### Privy
- `createOnLogin` defaulta a **`'off'`** → login social funciona e o usuário entra
  **sem carteira Solana**: o requisito da trilha cai calado. Use `'users-without-wallets'`
  (com `'all-users'`, quem entra com a própria carteira ganha uma embutida por cima).
- **E7 — a Privy que não sobe.** O v0 registrou: `PrivyProvider` que não inicializa
  renderiza **`null`, sem erro nem log** → tela branca e muda para o jurado.

  **Medição de 17/07 que CONTRADIZ isso, registrada aqui de propósito:** com a origem
  **não** liberada, a tela de login **renderizou normal** e quem gritou foi o **watchdog
  de 8s**. Ou seja: o provider **monta e renderiza os filhos**; o que não vem é o `ready`.
  O código corrobora — `Ponte` (onde vive o watchdog) é **filha** do `PrivyProvider`; se
  ele renderizasse `null`, `Ponte` nunca montaria e o watchdog **não teria como disparar**.
  Disparou.

  **Não estamos apagando o achado do v0:** "renderiza null" pode ser outro modo de falha
  (appId inválido, rede fora, versão diferente do SDK) — não foi reproduzido nesta app.
  O que muda é a **expectativa**: não conte com tela branca para perceber. Conte com
  **`ready` que nunca chega**, que é silêncio, não branco.

  De qualquer modo a conclusão prática é a mesma e é por isso que ela sobrevive à
  contradição: **o watchdog com timeout é obrigatório** (`READY_TIMEOUT_MS = 8_000`,
  `PrivyIsland.tsx`). Ele é o único que fala.

  Detalhe que já mordeu: `stuck` é `stuck && !ready`. O timer é de mão única, então numa
  conexão lenta a ilha ficava pronta em 9s, o login funcionava — e o alerta vermelho
  ficava na tela para sempre, empurrando o fã para o demo sem motivo. **Se ficou pronta,
  não travou.**
- **Na divergência entre código e painel, vale o código.** O painel não salva sozinho:
  toggle ligado ≠ salvo → 403 só quando o usuário clica.
- **O apelido NUNCA sai do e-mail** (E12): ele é público (ranking/ligas) e derivá-lo do
  e-mail vaza o endereço da pessoa. O onboarding pede.
- Diagnostique pela config real da app, não pelo painel:
  ```bash
  curl -s https://auth.privy.io/api/v1/apps/$PRIVY_APP_ID -H "privy-app-id: $PRIVY_APP_ID"
  ```
- `exportWallet()` só resolve quando o usuário **fecha o modal**; se o modal não abrir, a
  promise não settla e o botão trava em "Abrindo…" para sempre. Envolva em timeout.

### Estado REAL da app de produção (medido em 17/07 02:19 UTC)

App de produção `palpitei-v1` = `cmrnum7sz00ft0cjruc4dtkj2`. Reproduz com:

```bash
curl -s https://auth.privy.io/api/v1/apps/cmrnum7sz00ft0cjruc4dtkj2 \
  -H "privy-app-id: cmrnum7sz00ft0cjruc4dtkj2"
# ou, com veredito em vez de JSON cru:
npm run privy:doctor
```

**A app já está configurada.** Esta tabela é o que o comando devolveu em 17/07 — não é
um "precisa ser":

| Campo | Veio em 17/07 | Se estivesse errado |
|---|---|---|
| `google_oauth` | `true` | `false` → Opção A (padrão) dá 403 **só no clique** |
| `solana_wallet_auth` | `true` | `false` → `wallet_auth:true` sozinho oferece carteira **EVM**, não Phantom |
| `embedded_wallet_config.solana.create_on_login` | `"users-without-wallets"` | `"off"` (o default de fábrica) → o fã entra **sem carteira Solana** e o requisito cai calado |
| `allowed_domains` | **5 origens** (inclui `http://localhost:3000`, `https://localhost:3000`) | sem a origem → a Privy não fica `ready`; ver o quadro do E7 abaixo |

> **Esta tabela dizia o contrário até 17/07.** Ela afirmava, sob o rótulo "medido em 16/07",
> que os quatro campos vinham `false`/`off`/`[]`. Quem lesse ia "consertar" uma app que já
> estava certa — ou pior, desconfiar do código por causa de uma doc. **Estado externo muda;
> a doc não muda junto.** Rode o comando; não confie nesta tabela mais do que nele.

`mode` segue `user-controlled-server-wallets-only`: chave remontada em **enclave**, não em
iframe. A arquitetura da carteira é *configuração da sua app*, não propriedade fixa do
produto da Privy (E15).

> **A ordem "corrija a 2.4 antes de submeter" já foi cumprida — não refaça.** Verificado no
> `palpitei-v1-documentacao-tecnica.docx` em 17/07: a linha da Privy na tabela comparativa
> 2.4 hoje diz *"ONDE a chave é remontada depende do modo configurado NA SUA APP — iframe
> isolado no cliente OU enclave (server wallets). A app do v0 devolveu
> mode=user-controlled-server-wallets-only, ou seja, enclave"*, com o `curl` ao lado. O
> parágrafo de custódia carrega a mesma ressalva. **Não existe mais "iframe isolado" afirmado
> sem qualificação na doc técnica.**

## 4. O que NÃO pode entrar na v1

- 🔴 **`body.userId` aceito sem verificação.** No v0 o `resolveUser()` cai para
  `body.userId` se não houver header. Atrás de link público com ranking valendo é fraude
  trivial. **O token da Privy é o único caminho.** `verifyAuthToken` → DID → find-or-create.
- ✅ **O `PRIVY_APP_SECRET` do v0** (passou pelo campo de credencial do Google, E10):
  **RESOLVIDO — não herde, e não é mais preciso rotacionar.** Verificado em 17/07: o
  segredo do `palpitei-v1/.env` tem hash **diferente** do `palpitei-v0/.env`
  (`sha256 a32afa…` vs `4ff74d…`), e são apps diferentes
  (`cmrnum7sz00ft0cjruc4dtkj2` na v1 vs `cmrnjqusy006w0bl2x3fmubn5` no v0). Não é
  rotação de segredo na mesma app: é **app nova com segredo novo**, que resolve E10 e
  o item abaixo de uma vez. Reproduz comparando os hashes — **nunca imprima o valor**.
- ✅ **App Privy de dev** → **RESOLVIDO**: a v1 roda numa app própria
  (`cmrnum7sz00ft0cjruc4dtkj2`). Continua valendo: **o domínio de produção precisa
  entrar em Allowed origins antes do deploy** — hoje as 5 origens liberadas são de
  desenvolvimento (localhost e IPs de LAN). Apple, se for usar, exige credencial
  própria **antes do primeiro usuário** (porta de mão única, E8).
- 🔴 **Payload da TxLINE versionado** (§7).
- 🟡 Estado em memória: o XP some no primeiro restart.

## 5. Decisões desta v1 (tomadas em 16/07)

| # | Decisão | Porquê |
|---|---|---|
| 1 | **Monorepo com pacotes isolados** | Fronteira de pacote impede agentes paralelos de colidirem. `packages/core`, `packages/txline`, `packages/ds`, `apps/web`. |
| 2 | **Supabase como Postgres — sem Supabase Auth** | Postgres de verdade, migrations e backup prontos, zero ops, e o prazo é 2,5 dias. **Auth continua sendo a Privy** (o DID é a identidade): duas fontes de identidade foi exatamente o bug que o v0 viu. Sem client Supabase no browser; acesso só pelo backend. |
| 3 | **Identidade = `privy_did`**, não a carteira | A carteira muda (Opção B depois ganha embutida) e o **mesmo endereço aparece 2x** (embutida + Phantom após export). Find-or-create por DID. Carteiras extras em `user_wallets` (1:N). |
| 4 | **Motores puros portados do v0** | `questions`, `markets`, `ranking`, `explain`, `clock`. Não reescreva; injete o repositório em vez do singleton `store`. **Medido em 17/07: `npm test -w @palpitei/core` → 27/27 pass** (o "23 testes" herdado do v0 envelheceu). |
| 5 | **Design system vendorizado** em `packages/ds` | O repo é público e precisa ser autossuficiente. Consertados na vendorização: `styles.css` não importava `tokens/app-frame.css` (AppFrame perdia as 10 vars `--app-*` **sem erro**), e o peer de React foi alargado para 18\|\|19. |

## 6. Design system — as regras que não se negociam

Fonte: `packages/ds/CONVENTIONS.md` (leia inteiro antes de fazer UI).

- **Mobile-only, dark-only.** Não existe layout de desktop: no desktop o **mesmo** telefone
  fica centrado numa coluna de 420px. Nunca construa tela larga, sidebar ou multi-coluna.
- **Tudo dentro de exatamente um `<AppFrame>`** na raiz. Dentro dele, `minHeight:'100%'` —
  **nunca `100vh`** (é a janela toda; estoura o frame no desktop).
- **Zero classes CSS.** Componentes por props; o resto com `var(--*)` inline. **Nunca**
  hardcode hex, raio ou fonte.
- Componentes: `AppFrame` `Button` `Badge` `Chip` `Card` `SegTabs` `Toggle` `ProgressBar`
  `ListRow` `MatchCard`. Leia o `.d.ts` ao lado de cada um — é o contrato.
- **Voz: pt-BR casual e de torcida** ("a galera", "bora"), segunda pessoa. Gíria de futebol,
  **nunca jargão de aposta**: diz "Acima/Abaixo", nunca "Hi-Lo"; "atualizada ao vivo", nunca "odds".
  Rótulos de seção CURTOS e MAIÚSCULOS. Números em pt-BR (`1.240`). **Sem emoji** —
  ícone é SVG inline ou forma em CSS. A marca é tipo, não imagem: `P!` itálico-900 em
  quadrado lime, girado `-6deg`.
- `--fw-medium` é **600**, não 500.

## 7. O mockup é a especificação da UI

Projeto Claude Design `afc48231-349b-42df-975e-420e88fc618b`, arquivo `Palpitei Prototype.dc.html`
(cópia local de trabalho em `docs/mockup.html`). Telas:

`login` (Google/Privy · carteira · **demo**) → `onboarding` (0 boas-vindas · 1 apelido ·
2 time do coração · 3 pronto) → `home` (abas Ao Vivo / Próximos / Replays, missão do dia,
ligas privadas) → `sala` (cabeçalho do placar, abas Lances / Estatísticas / Ranking,
**bottom sheet do desafio** com timer) → `resultado do desafio` (tela cheia, leitura do jogo)
→ `fim de jogo` → `ranking` → `perfil` → `premium` (paywall · planos · checkout · done)
→ `bottom nav` (Início / Ranking / Perfil).

O protótipo é **bilíngue pt/en** e tem 4 desafios hardcoded — na v1 eles vêm do motor de
perguntas sobre o dado real.

## 8. Contratos herdados do v0

```
REST  POST /api/login              (Bearer da Privy → find-or-create por DID)
      POST /api/account/handle     (o fã escolhe o apelido — nunca derive do e-mail)
      POST /api/account/team       (time do coração; null = pulou — não invente time)
      GET  /api/state              (o fã como o BANCO o conhece + aproveitamento)
      GET  /api/ranking            (top 50 por XP + a minha linha fora do corte)
      GET  /api/fixtures
      POST /api/rooms/:id/join     POST /api/rooms/:id/leave
      POST /api/rooms/:id/predictions

WS    /ws → score_event, odds_event, odds_explain, question_open/closed/resolved/void,
            ranking, game_end, replay_done
```

**A sessão local é CACHE, não verdade (ligado em 17/07).** O que era TODO virou
contrato: a tela de login chama `POST /api/login` e é o **find-or-create por DID
que decide** conta nova (→ onboarding) × conta velha (→ home, sessão hidratada do
banco) — antes, todo retorno virava "conta nova" e o UNIQUE recusava o próprio
apelido do fã (409) no passo 1. `refreshState()` (session.tsx) realinha o cache
com o `GET /api/state` ao entrar em home/perfil. O modo demo segue 100% local (§5.1).

**O primeiro pacote do SSE fala na 1ª pessoa (17/07).** `room_state` sai de
`estadoDaSalaPara(sala, userId)` (rooms.ts) e traz, além do estado do jogo:
`questions` com `closesInRealMs` REAL (a tela não chuta mais 60s) e `xp` (piso do
motor); `minhas` (recibos do fã — F5 não apaga palpite); `resultados` (o
histórico liquidado dele, mais recente primeiro). A fonte é
`engine.respostasDe(userId)` (core, com teste). E o apelido entra no ranking da
sala **na chegada** (`registrarApelido`, stream route) — antes só entrava quando
uma pergunta resolvia, e quem escolhia o apelido depois do palpite ficava "sem
apelido" até o próximo lance liquidar. Medido em 17/07 com harness sobre a
18241006 (fixture real, 2 fãs descartáveis, replay 60×): recibo, prazo,
histórico e apelido voltaram no pacote inicial; fãs de teste apagados ao final.

`walletSource: "privy_embedded" | "external" | "simulated"` — as duas primeiras cumprem
"sign up through Solana". `simulated` é o modo demo.

**Fontes de replay** (corrigido em 17/07 — a lista herdada do v0 estava errada):

```
txline-updates | txline-cache | txline-historical | txline-snapshot | txline-live | synthetic
```

O v0 legou a lista **sem `txline-updates`** — justamente o valor que o cache **grava na
prática**. Medido no Postgres em 17/07: a única partida em cache (`18241006`) tem
`cache_source = 'txline-updates'`. Com o vocabulário velho, a única saída era rotular a
partida gravada como `txline-cache` — **rótulo de proveniência mentindo, que é o G6 na
letra**, na doc que manda pôr selo de fonte em cada sala.

Quem está certo é **o código que grava**, não a doc: `MatchCacheFonte`
(`packages/txline/src/cache.ts`), `CacheSource` (`packages/db`) e `ReplaySource`
(`apps/web/src/lib/api.ts`) já convergiram nos seis valores acima. Os três espelham um ao
outro **de propósito** — se mexer num, mexa nos três; tipo divergente entre pacotes só
aparece na hora de ligar um no outro.

`synthetic` é **opt-in e dev-only** (`TXLINE_ALLOW_SYNTHETIC`, só a string `"true"` liga) e
nunca vai para demo ou submissão.

## 9. Nota de método (do handoff do v0, vale repetir)

> Medir antes de afirmar, desconfiar do número que agrada, e nunca herdar uma premissa
> sem verificar — nem de uma doc sua.

O v0 comemorou `odds_explain: 125` como prova de que o explicador vivia. Eram **115
fantasmas**; o real era 10. **Contador que sobe demais é sintoma, não troféu.**

E em 17/07 esta doc foi pega violando a própria regra: o §3 afirmava "medido em 16/07"
uma tabela **invertida** sobre a app da Privy. Não bastou medir uma vez — o estado
externo andou e a doc ficou. Daí a regra do topo: **data + comando, ou é premissa.**

---

## 10. O que falta e TEM HORA MARCADA — o caminho ao vivo

> **`startLiveIngest` não tem nenhum chamador.** Verificado em 17/07:
> ```bash
> grep -rn "startLiveIngest" apps packages scripts | grep -v node_modules
> # packages/txline/src/index.ts:63     (só reexporta)
> # packages/txline/src/ingest/live.ts:247  (a própria definição)
> ```
> Nenhum `import` o executa. **O caminho ao vivo nunca processou um evento real (A7)** e
> a trilha exige *"a live product that works during a match"*.

**A janela é 18/07 21:00 UTC — France × England, fixture `18257865`. Uma chance, sem
segunda.** (Spain × Argentina, 19/07 19:00 UTC, cai ~5h antes do prazo global: tarde
demais para descobrir problema.)

**São DUAS travas, não uma.** Ligar o ingestor exige as duas:

| Trava | Estado em 17/07 | Onde |
|---|---|---|
| `startLiveIngest` sem chamador | **ninguém chama** | `packages/txline/src/ingest/live.ts:247` |
| `TXLINE_LIVE_INGEST=false` | **desligado** no `.env` | `packages/txline/src/config.ts:70` |

Cuidado com a segunda: o getter é `trim(...) !== "false"`, então **ausente = LIGADO**.
Apagar a linha não desliga — **liga**. Hoje ela está explicitamente `false`.

**"open / 0 eventos" NÃO é sucesso — é o estado A7.** Os streams conectam e silenciam
quando não há partida coberta. Só `normalizados > 0` prova que o caminho vive. O
`LiveStatus` de `live.ts` já expõe `recebidos`/`normalizados`/`descartados` e
`primeiroEventoEm` justamente para isso: **contador que não sobe é sintoma**.

O que só esse jogo responde (do handoff do v0, ainda aberto):

- Chega evento? Em que volume/latência? → dimensiona WebSocket e UI.
- **`/scores/updates` serve DURANTE o jogo?** Se sim, é a fonte da v1 inteira.
- Payload de **`penalty`** — nunca observado; bloqueia o modo "vai sair pênalti?".
- Campo **`Participant`** (hoje contornado por delta).
- **`/scores/historical` logo após o apito final** → fecha o A2, que é a crítica mais
  forte do nosso feedback à TxODDS. **Reconferir antes de enviar**: é injusto reportar
  como quebrado algo que eles tenham corrigido.

E, assim que a partida acabar: **`npm run cache:match 18257865`**. O dataset rotaciona
(A1) — a 18241006 já sumiu do snapshot. Se não gravar, perdeu.

> 🔴 **CONFIRA ONDE O CACHE CAIU — o script tem fallback e ele te engana calado.**
> Lendo `packages/txline/scripts/cache-match.ts:40-65` (verificado em 17/07, **não
> executado**): se o `@palpitei/db` estiver indisponível (DB fora, `build:db` não rodado,
> `DATABASE_URL` errada), o script **não falha** — emite um `console.warn` e **cai para
> arquivo** em `packages/txline/.cache/fixtures`.
>
> **E a app nunca lê esse arquivo.** Verificado: `apps/web` lê partida só via
> `@palpitei/db` (`fixtures/route.ts`, `rooms.ts`, `rooms/[id]/route.ts`);
> `createFileMatchCacheStore` só é usado pelo próprio script e pelos testes. Ou seja, no
> dia 18/07 você roda o cache, vê "gravado", e **a sala continua vazia** — com o motivo
> num `warn` que rolou pra fora da tela. É o §11 "o `warn` que você aprende a ignorar",
> na noite em que não há segunda chance.
>
> **O script imprime `onde` — leia essa linha.** Tem que dizer `Postgres (@palpitei/db)`.
> Se disser `arquivo em …`, **não gravou onde a app procura**. Confirme no banco:
> ```sql
> select fixture_id, cache_source, count(*) from match_events
>   join matches using (fixture_id) where fixture_id = 18257865 group by 1,2;
> ```
> (O `.gitignore` cobre `.cache/`, então o §7 está protegido mesmo no fallback — o
> problema aqui não é vazar payload, é **achar que gravou**.)

---

## 11. Armadilhas medidas NESTA v1 (16–17/07)

As do §3 vieram do v0. Estas custaram sangue **aqui**, sobre o England × Argentina
(`18241006`, 962 eventos). Cada uma com a medição que a revelou.

### A TxLINE ANUNCIA e depois CONTABILIZA

Medido: escanteio no **seq 76** com `corners 0-0`, e no **seq 77** — 12s depois, **mesmo
minuto** — com `corners 1-0`. Dois eventos de verdade, seq diferente, nenhum é lixo. Mas
é **UM** escanteio. Renderizar os dois faz o fã ler "escanteio · escanteio".

É a lição do gol **generalizada**: a ação `goal` aparece **9×** e o placar muda **3×** (as
outras 6 são VAR/amend/repetição) — contar ação daria **9 × 2** num jogo que terminou
**1 × 2**.

> **A regra: quem tem contador, vale o DELTA do contador — nunca a repetição da ação.**
> Um lugar só: `apps/web/src/server/lances.ts`.

**Prova de que fecha:** 7 lances de escanteio para um placar final de **1×6** escanteios;
4 de cartão para **1×3**; 3 gols para **1×2**. O feed conta exatamente o que o contador diz.

Corolário medido: **a regra já divergiu por estar duplicada.** A rota REST filtrava por
delta e o servidor de sala não → na tela, "37’ Chute" **4×** e "36’ Cartão amarelo" **3×**.
Mesma pergunta, duas respostas, e a errada era a que o fã via. Por isso `lances.ts` existe.

### O G7 mordeu de novo — e fomos nós que causamos

Puseram `shot: 'Shots'` no mapa de contadores. O `Total` **desta** partida é só
`{ Goals, Corners, YellowCards }` — **`Shots` não existe**. O `?? 0` (que é a leitura
**CERTA** para chave ausente) fez o contador nunca andar, e os **16 chutes SUMIRAM** do
feed. "Chave ausente = zero → linhas somem da tela", na letra, no repo que documenta o G7.

> **Só entra no mapa de contadores chave que o feed daquela partida realmente traz.**
> O conjunto **varia por partida** — não é constante do produto. Chute não tem contador:
> vai por deduplicação por clock, como o kickoff.

### As chaves ENTRAM no `Total` durante o jogo — não no apito

A premissa óbvia ("o `Total` tem as chaves da partida desde o começo") é **falsa**.
Medido na 18241006 (`select` sobre `match_events`, 17/07):

| | n |
|---|---|
| eventos com `hasScore` (de 962) | **47** |
| …com a chave `Goals` | **24** |
| …**sem** a chave `Goals` | **23** |
| …com `Corners` | 46 |
| …com `YellowCards` | 38 |

E os marcos: **primeiro evento com bloco `Score` = seq 76, e o `Total` dele vem VAZIO**
(zero chaves). O seq 77 traz **uma** chave (`Corners`) — que é a mesma medição do
"anuncia e depois contabiliza", vista por dentro: **o contador nasce quando o lance
acontece**. A chave `Goals` só aparece no **1º gol, seq 539**.

**Consequência 1 — a linha PISCA e SOME.** Quem fizer o óbvio:

```
state.totals = ev.totals     // ERRADO
```

troca o mapa inteiro a cada evento, e todo evento que não cita `Goals` apaga a linha de
Gols da aba de estatísticas. **É merge por chave, nunca substituição** (`rooms.ts`).

**Consequência 2 — o A4 entra pela porta do G7, e é aqui que mora o bug.** Sem a chave,
`ev.goals` vem `{0,0}` de **placeholder** — o `?? 0` do G7 está certo para "a chave não
existe", mas o resultado dele encontra o A4: se um evento **sem** `Goals` chegasse
**depois** de um gol, o placar **regrediria a 0–0 no meio do jogo**.

> **Nesta partida isso não acontece — por SORTE, não por garantia.** Medido: o último
> evento com Score e **sem** a chave `Goals` é o **seq 503**, e o primeiro **com** ela é o
> **seq 539**. Depois do 539 a chave **nunca mais falta** (0 eventos). É *só por isso* que
> o placar fecha **1 × 2**. **O France × England é outra partida e não deve nada a essa
> sorte.**

Por isso existe o guard `falaDeGols` em `apps/web/src/server/rooms.ts`: **só move o placar
quem realmente fala de gols**.

```
falaDeGols = ev.totals?.p1?.Goals !== undefined || ev.totals?.p2?.Goals !== undefined
```

**A lição geral:** o §3 lista "ausente ≠ zero" (A4) e "ausente = zero" (G7) como duas
regras opostas do mesmo feed. O que esta medição acrescenta é que **elas se encontram**:
a leitura certa do G7 produz o dado que dispara o A4. Conferir cada regra isolada não
basta — **o bug mora na interação entre as duas**.

### `REPLAY_SPEED=60` fazia a regra de justiça anular quase tudo

Aritmética, que é o argumento — não gosto:

```
windowMs = max(45s de jogo, MIN_REAL_WINDOW_MS × speed)     // MIN_REAL_WINDOW_MS = 8_000
60× → max(45_000, 480_000) = 8,0 min de janela / 10 min de horizonte do hilo_corners
12× → max(45_000,  96_000) = 1,6 min de janela / 10 min de horizonte
```

O piso de **8s REAIS** existe para o fã ter tempo de reagir; a 60× esse piso come o
horizonte inteiro → o escanteio chega com a **janela ainda aberta** → a pergunta é
**ANULADA** (sem XP). **Não é bug: é a regra funcionando contra uma velocidade que não
cabe nela.** Custo de baixar para 12×: o replay leva ~7,5 min reais em vez de ~1,5
(medido: **476,9s** o replay inteiro).

**Medido no banco em 17/07 02:19 UTC**, com o `.env` em 12×:

| Estado das `questions` | n |
|---|---|
| `resolved` | 75 |
| `void` | 11 |
| **taxa de resolução (entre liquidadas)** | **87,2%** |

Bate com a previsão de ~84% da aritmética. **Todos os 11 voids** têm
`void_reason = 'evento resolvedor chegou com a janela aberta (regra de justiça)'`, e
**9 dos 11 são `hilo_corners`** — exatamente o tipo que a aritmética acusa. A regra não
está quebrada; ela está calibrada.

> 🔴 **ARMADILHA ATIVA: o default do código ainda é 60, e diverge do `.env.example`.**
> ```
> apps/web/src/server/rooms.ts:36   process.env.REPLAY_SPEED ?? 60
> packages/txline/src/config.ts:83  numEnv("REPLAY_SPEED", 60)
> .env.example:111                  REPLAY_SPEED=12   ← a raiz
> packages/txline/.env.example:76   REPLAY_SPEED=60   ← DIVERGE
> ```
> Rodar **sem** a chave no `.env` te devolve **silenciosamente** a velocidade que anula
> quase tudo, e o sintoma é "as perguntas não dão XP" — não "a velocidade está errada".
> `rooms.ts:322` loga `REPLAY_SPEED=… (env=AUSENTE)` no boot da sala: **leia esse log.**

### A corrida do Bearer — 401 num fã LOGADO (aconteceu DUAS vezes)

`setAuthTokenProvider` roda num efeito do `PrivyIsland`, que é **mãe** das telas. **O
React roda efeitos de baixo pra cima** → a tela (filha) dispara o fetch **um ciclo ANTES**
de o provider ser registrado → o registrado ainda é o closure que capturou
`authenticated: false` → token `null` → **401 num fã logado, que lê "sem sessão
verificada"**. Só o **segundo** fetch acertava.

Diagnóstico que prova que o token não era o problema: com Bearer manual do storage, a
**mesma rota devolvia 200**. O cliente é que não anexava.

Duas correções, e as duas são necessárias:
1. Provider com deps **`[]`** lendo `authenticated`/`getAccessToken` por **ref** — nunca
   obsoleto, registrado uma vez (`PrivyIsland.tsx`).
2. As telas esperam **`privy.ready && privy.authenticated`** antes de buscar: a sessão
   local revive do `sessionStorage` na hora, a ilha leva segundos.

> **A Privy não erra alto — erra fora de hora.** Mesma família do E7/E14. E note: esta
> lição foi aprendida, documentada, e **reintroduzida no commit seguinte** (`useSala`
> nascia sempre ativo). Saber não basta.

### O `privy-doctor` MENTIU — e mentir aqui é pior que não existir

A versão anterior usava `redirect: 'manual'` e procurava a falha no **CORPO**. O Google
responde **302** com um corpo-stub de ~1,4 kB e põe o motivo no header **`Location`**
(`…/signin/oauth/error?authError=…`). O grep no corpo nunca achava nada: **o doctor
imprimia "ok" enquanto o Google recusava 100% dos logins com `redirect_uri_mismatch`.**

Segunda armadilha na mesma função: procurar **"Error 400" é dependente de locale** — sai
"Erro 400" em pt-BR. O `authError` é **base64** e carrega o motivo **sempre em inglês**;
é nele que dá para confiar. Corrigido em `scripts/privy-doctor.mjs`.

**Allowed origins da Privy ≠ Authorized redirect URIs do Google.** São painéis
diferentes. O callback do Google é sempre `https://auth.privy.io/api/v1/oauth/callback`.

### O `warn` que você aprende a ignorar é o próximo bug

`https://localhost:3000` **não estava** em Allowed origins — e `npm run dev:https` roda
**exatamente nele**. O login quebrava com **403 no `POST /api/v1/sessions`**. O
`privy:doctor` avisava com `warn` em **TODA** execução, e por isso foi lido como ruído.

Hoje (17/07) essa origem **está** liberada. Mas o doctor **segue emitindo `warn`** para
todo IP de LAN não liberado (3 numa execução de 17/07 — o número depende das interfaces
de rede da sua máquina, então não o trate como constante). **O ruído continua lá**,
esperando o próximo. Se você for testar no celular pelo IP do Mac, o `warn` daquele IP
**é o seu bug**, não ruído.

> Por que este é estruturalmente perigoso: o doctor **grita `FAIL`** para o que está
> quebrado e **sussurra `warn`** para o que só quebra *no seu fluxo* — e é justamente o
> segundo que te morde no celular. Um `warn` constante treina o leitor a não ler.

### `questions` ficavam `open` PARA SEMPRE

A sala chamava `saveQuestion` **só na abertura**, nunca ao resolver/anular. Sintoma:
**101 perguntas no banco, partida terminada, palpites já liquidados, e nenhuma fora de
`'open'`** — `correct` e `voidReason` nunca chegavam. O `questionRepo.save` **já era** um
upsert defensivo feito para isso ("resolvida nunca volta a abrir"); **a sala é que não
chamava**. Um repositório correto não salva quem não o chama.

Corrigido — medido em 17/07: 86 de 123 perguntas fora de `'open'`, 75 com `correct`
gravado. **Residual honesto:** 37 seguem `open`, criadas entre 01:31 e 02:19 por salas
derrubadas no meio do replay (13 são `final_result`, que só resolve no apito final).
**Não verificado** se isso é resíduo esperado de sala abortada ou bug de teardown.

### `level` é coluna GERADA no Postgres

```sql
level integer not null generated always as ((floor(sqrt(xp/100.0)) + 1)::int) stored
```

`update users set level = …` **estoura**. Escreva `xp`; o nível é derivado pelo banco.
Verificado no schema real em 17/07, não só na migration.

### O que o motor produz sobre dado real (e a ressalva)

- Harness com **relógio manual**: **13 perguntas, 13 resolvidas, 0 anuladas**. "Como
  termina England x Argentina?" resolveu em **`p2`** — que é o resultado real (**1 × 2**).
- **Ressalva que impede o número de virar troféu:** esses 13/13/0 vieram de relógio
  manual, **sem a pressão de janela real**. Na sala a 12× a taxa é **87,2%** (acima).
  São dois setups, não um número melhorando. Citar 13/13/0 como "o motor resolve tudo"
  é o `odds_explain: 125` de novo.

### O cache é o único jeito de ter a partida

`18241006` (England × Argentina) **já sumiu** do snapshot de fixtures da devnet —
verificado em 17/07 02:20 UTC, o snapshot inteiro tem **2 fixtures** e ela não está
entre elas. Ela só existe porque foi persistida: **962 eventos** (seq 2→963) e **3758
odds** no Postgres, `cache_source = 'txline-updates'`. **A1 não é risco futuro: já
aconteceu.** As duas partidas futuras ainda estão no snapshot — grave a 18257865 assim
que ela acabar.

### Duas que só apareceram rodando

- **XP era "+0" na tela**: `XP_BASE` não era exportado do core. Exportar em vez de
  copiar a tabela — **copiar é o bug nº 1 de novo** (a regra do lance duplicada).
- **Carência de 30s antes de derrubar sala vazia**: sem ela um F5 reinicia a partida do
  zero e o palpite recém-dado aponta para `questionId` que não existe mais.
