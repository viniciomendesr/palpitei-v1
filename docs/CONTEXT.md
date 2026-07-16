# Palpitei v1 — contexto para quem vai construir

**Leia isto antes de escrever qualquer linha.** Se você é um agente com uma tarefa
específica, leia mesmo assim: as armadilhas abaixo falham em **silêncio** e você não
vai tropeçar nelas — vai descobrir na frente do jurado.

---

## 1. O que é, e com que prazo

Palpitei é um jogo social de inteligência esportiva: pega o dado ao vivo da TxLINE
(placar, eventos, odds) e vira pergunta, palpite e explicação simples, com XP,
ranking e ligas. **Não há dinheiro real na v1** — XP é pontuação, não valor.

- Trilha: **Consumer and Fan Experiences** (Superteam World Cup Hackathon / TxODDS).
- **Prazo: 19/07/2026 23:59 UTC** (listing Brasil 18/07 23:59 BR). Hoje é 16/07.
- **Critério nº 1 da trilha é acessibilidade para o fã comum.** Toda decisão empata
  a favor de menos atrito. Peso de bundle e tempo até o primeiro palpite são features.
- Janela de demo ao vivo: **France × England 18/07 21:00 UTC** (grave o vídeo aqui).
  Spain × Argentina 19/07 19:00 UTC é ~5h antes do prazo — tarde demais para descobrir problema.

  **FixtureIds confirmados no snapshot da devnet em 16/07** (`CompetitionId: 72`):

  | fixtureId | partida | início (UTC) | GameState |
  |---|---|---|---|
  | **18257865** | France × England | 18/07 21:00 | 1 (agendada) |
  | **18257739** | Spain × Argentina | 19/07 19:00 | 1 (agendada) |

  O caminho **ao vivo nunca processou um evento real** (achado A7: os streams SSE só foram
  vistos "abertos e saudáveis com 0 eventos"). A trilha exige "a live product that works
  during a match". **18257865 é a única chance real de exercitar isso antes do prazo.**
  Grave o `cache:match` dessa partida assim que ela acabar — o dataset rotaciona (A1): a
  partida que o v0 cacheou (`18241006`) já sumiu deste snapshot, embora os endpoints de
  dados sigam servindo ela.
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
- `PrivyProvider` que não inicializa renderiza **`null`, sem erro nem log** → tela branca
  e muda para o jurado. Use watchdog com timeout.
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

### Estado REAL da app de produção (medido em 16/07, não presumido)

App nova `palpitei-v1` = `cmrnum7sz00ft0cjruc4dtkj2`. O `curl` acima devolveu **tudo off** —
a app nasce de fábrica sem nada que a trilha exige. Confira antes de acusar o código:

| Campo | Veio | Precisa ser |
|---|---|---|
| `google_oauth` | `false` | `true` — senão a Opção A (padrão) dá 403 **só no clique** |
| `solana_wallet_auth` | `false` | `true` — `wallet_auth:true` sozinho oferece carteira **EVM**, não Phantom |
| `embedded_wallet_config.solana.create_on_login` | `"off"` | `"users-without-wallets"` — senão o fã entra **sem carteira Solana** e o requisito cai calado |
| `allowed_domains` | `[]` | inclui a origem — senão `PrivyProvider` → `null`, **tela branca e muda** |

`mode` voltou `user-controlled-server-wallets-only` de novo: chave remontada em **enclave**,
não em iframe. **A tabela comparativa da doc técnica (2.4) diz "iframe isolado" e está errada
— corrija antes de submeter**, é doc que jurado lê. A arquitetura da carteira é *configuração
da sua app*, não propriedade fixa do produto da Privy (E15).

## 4. O que NÃO pode entrar na v1

- 🔴 **`body.userId` aceito sem verificação.** No v0 o `resolveUser()` cai para
  `body.userId` se não houver header. Atrás de link público com ranking valendo é fraude
  trivial. **O token da Privy é o único caminho.** `verifyAuthToken` → DID → find-or-create.
- 🔴 **O `PRIVY_APP_SECRET` do v0** — passou pelo campo de credencial do Google (E10) e
  **não foi rotacionado**. Gere um novo na app de produção; não herde.
- 🔴 **App Privy de dev.** Produção precisa de app nova, com o domínio de produção em
  Allowed origins (senão E7 → tela branca). Apple, se for usar, exige credencial própria
  **antes do primeiro usuário** (porta de mão única, E8).
- 🔴 **Payload da TxLINE versionado** (§7).
- 🟡 Estado em memória: o XP some no primeiro restart.

## 5. Decisões desta v1 (tomadas em 16/07)

| # | Decisão | Porquê |
|---|---|---|
| 1 | **Monorepo com pacotes isolados** | Fronteira de pacote impede agentes paralelos de colidirem. `packages/core`, `packages/txline`, `packages/ds`, `apps/web`. |
| 2 | **Supabase como Postgres — sem Supabase Auth** | Postgres de verdade, migrations e backup prontos, zero ops, e o prazo é 2,5 dias. **Auth continua sendo a Privy** (o DID é a identidade): duas fontes de identidade foi exatamente o bug que o v0 viu. Sem client Supabase no browser; acesso só pelo backend. |
| 3 | **Identidade = `privy_did`**, não a carteira | A carteira muda (Opção B depois ganha embutida) e o **mesmo endereço aparece 2x** (embutida + Phantom após export). Find-or-create por DID. Carteiras extras em `user_wallets` (1:N). |
| 4 | **Motores puros portados do v0** | `questions`, `markets`, `ranking`, `explain`, `clock` + 23 testes já passam. Não reescreva; injete o repositório em vez do singleton `store`. |
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
      GET  /api/state              GET /api/fixtures
      POST /api/rooms/:id/join     POST /api/rooms/:id/leave
      POST /api/rooms/:id/predictions

WS    /ws → score_event, odds_event, odds_explain, question_open/closed/resolved/void,
            ranking, game_end, replay_done
```

`walletSource: "privy_embedded" | "external" | "simulated"` — as duas primeiras cumprem
"sign up through Solana". `simulated` é o modo demo.

Fontes de replay: `txline-cache | txline-historical | txline-snapshot | synthetic`.

## 9. Nota de método (do handoff do v0, vale repetir)

> Medir antes de afirmar, desconfiar do número que agrada, e nunca herdar uma premissa
> sem verificar — nem de uma doc sua.

O v0 comemorou `odds_explain: 125` como prova de que o explicador vivia. Eram **115
fantasmas**; o real era 10. **Contador que sobe demais é sintoma, não troféu.**
