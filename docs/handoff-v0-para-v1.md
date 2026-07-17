# Handoff para a v1 — leia isto primeiro

> ## ⚠ DOCUMENTO HISTÓRICO — congelado em 16/07/2026
>
> **Não comece por aqui. Comece pelo [CONTEXT.md](CONTEXT.md).** Este arquivo é o
> retrato do que o v0 entregou **naquele dia**, e vale como registro do que foi
> aprendido — não como estado atual. A v1 já andou por cima dele.
>
> **O que este arquivo diz e JÁ NÃO VALE** (verificado em 17/07 — detalhes no CONTEXT):
>
> | Onde | O que dizia | Estado em 17/07 |
> |---|---|---|
> | §6 | `PRIVY_APP_SECRET` "não foi rotacionado" | **Feito.** App nova (`cmrnum7sz…`) com segredo novo — hash difere do v0 |
> | §6 | "A app Privy é Dev" | **Feito.** A v1 roda em app própria |
> | §5 / §2 | "Corrija a linha da Privy na tabela 2.4 antes de submeter" (E15) | **Feito** no `.docx`: a 2.4 já diz "iframe **OU** enclave, depende do modo da sua app" |
> | §7 | Fontes de replay sem `txline-updates` | **Errado.** É justamente o que o cache grava. Lista certa no CONTEXT §8 |
> | §2 | **E7**: "PrivyProvider renderiza `null`" → tela branca | **Contradito** por medição: a tela renderiza e o watchdog de 8s dispara; o que falta é o `ready`. O achado fica registrado (pode ser outro modo de falha) — ver CONTEXT §3 |
> | §4 / §8 | "Cache em disco (`.cache/`)" | Na v1 o cache é **Postgres** (§7 do T&C: nada de payload versionado) |
> | §8 | "Como rodar" (`npm start`, porta 4100, `build:auth`) | É o **v0**. Para rodar a v1, veja o [README](../README.md) |
>
> **O que este arquivo diz e CONTINUA valendo, com hora marcada:** o §5 — *o caminho ao
> vivo nunca processou um evento real* (A7). Segue verdade em 17/07: `startLiveIngest`
> **não tem chamador**. Janela: **18/07 21:00 UTC**. Ver **CONTEXT §10**.

**Se você é a sessão/pessoa que vai construir a v1: comece por aqui.**

O v0 é uma bancada de integração. Ele não existe para virar produto — existe para
**aposentar risco antes de a v1 ser escrita**. Este arquivo diz o que ele já
provou, o que ele descobriu que dói, e o que continua em aberto.

Estado verificado em 16/07/2026: typecheck limpo, 23/23 testes, `SMOKE PASS`
com dado real (962 eventos), 40 achados, 17 decisões.

---

## 1. Leia estes três antes de escrever qualquer linha

| Arquivo | Por que |
|---|---|
| **[achados.md](achados.md)** | 40 achados. É o **principal produto do v0**. Boa parte custou horas e **não está em documentação nenhuma da Privy ou da TxODDS**. |
| **[decisoes.md](decisoes.md)** | Cada decisão com o porquê e o que ficou `aberto (v1)`. |
| **[feedback-txline.md](feedback-txline.md)** | Entregável da submissão (resposta em inglês pronta). |

Não é formalidade. Os achados abaixo são armadilhas que **falham em silêncio** —
sem erro, sem log, sem teste vermelho. Você não vai tropeçar nelas: vai
descobrir na frente do jurado.

---

## 2. As armadilhas que vão te pegar (todas silenciosas)

Se você ler só uma seção deste arquivo, leia esta.

| # | Armadilha | Sintoma se ignorar |
|---|---|---|
| **E2** | `createOnLogin` da Privy defaulta a **`'off'`** | Login social funciona e o usuário entra **sem carteira Solana** — o requisito da trilha cai calado |
| **E7** | `PrivyProvider` que não inicializa renderiza **`null`, sem erro nem log** | Origem não liberada em produção → **tela em branco e muda** para o jurado |
| **E9** | `loginMethods` (código) e painel discordam sem aviso | O botão aparece; o **403 só sai quando alguém clica** |
| **E11** | Na divergência, **o código sobrepõe o painel** | `'all-users'` cria carteira embutida por cima de quem entrou com a própria |
| **E8** | Apple: credencial padrão da Privy **não migra** | Um login Apple e você está preso — trocar exige app nova + migrar usuários |
| **G4** | "primeiro evento" ≠ "início da partida" | O feed publica 44 min antes do apito → janela de desafio **nasce fechada** |
| **A4 / G7 / G8** | O mesmo payload exige interpretações **opostas** | ver abaixo — é o mais traiçoeiro |
| **G6** | Rótulo de proveniência com fallback plausível | O badge **mente** sobre a origem do dado |
| **E12** | Identidade do provedor **não vem pronta para exibição pública** | O apelido saía do e-mail → `www.fulano` no ranking de todos: **vazamento de dado pessoal** |
| **E14** | Promise de SDK que depende de UI pode **não settlar** | `try/finally` não salva: o botão morre em "Abrindo…" para sempre |

### A armadilha do "ausente vs zero" (três formas, três respostas)

O mesmo feed exige três leituras diferentes, e errar qualquer uma é silencioso:

| Onde | Regra | Se errar |
|---|---|---|
| Bloco `Score` ausente no evento (**A4**) | ausente **≠** zero | placar "regride" a 0–0 → gols fantasma, VAR fantasma |
| `Score.Total` sem a chave (**G7**) | ausente **=** zero | linhas somem da tela; trata o VAR de graça |
| `Prices: []` com `PriceNames` cheio (**G8**) | vazio **≠** zeros | "a chance caiu para 0%" — 115 explicações fantasma |

**Regra prática:** antes de mapear arrays paralelos (`PriceNames` ↔ `Prices` ↔
`Pct`), confira o tamanho dos três.

### E a premissa que estava errada o tempo todo (E15)

A doc da v1 (2.4) descreve a carteira da Privy como *"Shamir; remontada em
**iframe isolado**"*. A app não roda assim: a config pública devolve

```
embedded_wallet_config.mode: "user-controlled-server-wallets-only"
```

que é a stack de **server wallets** — chave remontada em **enclave**, sob
controle do dono registrado na criação. O "Shamir" está certo; o "iframe" não.

Não muda a tese (o export funcionou e a autocustódia é real, E6) — muda o
**argumento**. Se a v1 publicar "iframe isolado" numa doc que os jurados leem,
publica coisa errada. **Corrija a linha da Privy na tabela comparativa antes de
submeter.**

Lição: a arquitetura do provedor é **configuração da sua app**, não propriedade
fixa do produto dele.

---

## 3. Comece por aqui (o atalho que custou caro)

Os dois maiores achados do v0 vieram de **ler o que já existia**, não de
investigar fundo. Não repita:

```bash
# Config REAL da app Privy — resolve em 1 comando o que custou 3 telas erradas.
# google_oauth, apple_oauth, solana_wallet_auth, embedded_wallet_config,
# allowed_domains. O painel MENTE sobre estado salvo; isto não.
curl -s https://auth.privy.io/api/v1/apps/$PRIVY_APP_ID -H "privy-app-id: $PRIVY_APP_ID"
```

E: **a referência de endpoints da TxLINE está no README do `txline-spike`.** O
`/scores/updates` — que resolveu tudo — estava listado lá desde o início e ficou
semanas sem uso, enquanto contornávamos limites que não existiam.

---

## 4. O que já está provado (não refaça)

- **Pipeline completo** TxLINE → perguntas → XP/ranking → WebSocket → mercado
  paramutuel → **prova de Merkle real** anexada ao recibo. `SMOKE PASS` com 962
  eventos reais.
- **Login social → carteira Solana embutida** (Privy, Opção A) e **login com
  carteira** (Phantom, Opção B). Ambos verificados contra app real.
- **Portabilidade provada:** o endereço `5vD5…3sMR` apareceu **idêntico** no app,
  no modal de export e no Phantom. É a evidência anti-lock-in da doc — e o
  material do vídeo.
- **`/scores/updates` é a linha do tempo**: 962 eventos, seq 2→963 contínuo,
  apito no clock 0, gap mediano 4,2s. Contra 37 amostrados do snapshot.
- **Cache em disco** (`npm run cache:match`): a demo não depende da devnet, que
  **rotaciona** (A1).
- **Matemática do paramutuel** em centavos inteiros, rake 5%, reembolso —
  testada à exaustão off-chain, pronta para virar contrato.

---

## 5. O que continua em aberto

### 🔴 Com hora marcada — o caminho ao vivo NUNCA processou um evento real

Tudo que validamos foi replay. Os streams SSE só foram vistos *"abertos e
saudáveis com **0 eventos**"* (A7). A trilha exige *"a live product that works
during a match"*.

**Janela: France × England, 18/07 21:00 UTC.** (Spain × Argentina é 19/07 19:00
UTC — ~5h antes do prazo global; tarde demais para descobrir problema.)

Só esse jogo responde:

- `LIVE_INGEST=true` com evento de verdade — **código nunca exercitado**
- Volume/latência real (eventos/min) → dimensiona WebSocket e UI
- **`/scores/updates` serve DURANTE o jogo?** Se sim, é a fonte da v1 inteira
- Payload de **`penalty`** (nunca observado) — bloqueia o modo "vai sair pênalti?"
- Campo **`Participant`** (hoje contornado por delta, decisão #6)
- **`historical` logo após o apito final** → fecha o A2, que é a crítica mais
  forte do feedback à TxODDS. **Reconferir antes de enviar** — injusto reportar
  como quebrado algo que eles tenham corrigido.

**Isto não bloqueia começar a v1.** A arquitetura pode andar hoje; este teste
informa a camada de ingestão.

### 🟡 Barato, fecha o v0 (~5 min)

- **Peso do bundle no 4G real** (E5) — 5,3 MB. Critério nº 1 da trilha, e **o
  único ponto que ainda pode reabrir Privy vs Web3Auth**. Medir muda uma decisão
  de arquitetura.

### ⚠️ Risco herdado de propósito

- **`linkWallet()` nunca foi exercitado** (E6/E13). O botão foi removido do v0
  porque não fazia nada visível ali e confundia. **Você vai construir o fluxo de
  depósito da v2 em cima de um caminho sem prova** — e a Privy falhou em
  silêncio em praticamente tudo que testamos (E2, E7, E9, E11). Trate como
  território minado: teste o vínculo isolado ANTES de acoplá-lo ao depósito.
  O porquê do vínculo (continuidade de identidade: sem ele, a Phantom vira conta
  nova e o fã perde XP) está em E13.

### 🟠 Perguntas em aberto que mudam decisão (baratas de responder)

- **`exportWallet()` deu 422 numa carteira já exportada** (E14). Hipótese não
  confirmada: a Privy trata re-export diferente. Se for isso, a v1 precisa
  tratar o caso ("você já exportou esta carteira") em vez de deixar o usuário
  no vácuo. Para confirmar: DevTools → Network → `authenticate` → Response.
- **Em que modo a app está, e por quê** (E15). `user-controlled-server-wallets-only`
  foi escolha ou default? Dá para mudar? Isso decide o parágrafo de custódia da
  doc — e potencialmente a comparação Privy vs Web3Auth inteira.
- ~~Depois de exportar e importar no Phantom, conectar essa carteira cai no
  mesmo DID?~~ **RESPONDIDA: sim** (E16). A carteira exportada foi reconhecida e
  vinculada ao mesmo DID, sem conta nova. Ou seja: **o export sozinho já cobre
  "quero usar minha Phantom nesta conta"** — o que enfraquece ainda mais o caso
  do `linkWallet()` (E13). Confirme antes de construir o vínculo no depósito.

### ⚪ Decisões da v1 (o v0 deixou a interface pronta)

Postgres/Redis (#3) · contrato Anchor (#8) · rollback do VAR (#6) · salas por
instância (#14, ver G5) · gzip no stream · nível 12 do mainnet · tuning do
explicador fora de jogo (A6).

---

## 6. O que NÃO pode ir para a v1

- 🔴 **`body.userId` aceito sem verificação** (#10). Qualquer um se diz qualquer
  usuário. Tolerável numa bancada local; **buraco aberto atrás de link público**.
  O token da Privy tem de ser o único caminho.
- 🔴 **O `PRIVY_APP_SECRET` atual** — passou pelo campo de credencial do Google
  (E10) e não foi rotacionado. **Gere um novo na app de produção; não herde.**
  → ✅ **FEITO (17/07):** a v1 tem app própria e segredo próprio; o hash difere do v0.
- 🔴 **A app Privy é Dev.** Produção precisa de app nova — e as credenciais
  próprias da Apple, se for usar Apple, têm de entrar **antes do primeiro
  usuário** (E8, porta de mão única).
  → ✅ **FEITO (17/07):** app `cmrnum7sz00ft0cjruc4dtkj2`. Apple segue fora, de propósito.
  ⚠ **Aberto:** as 5 Allowed origins de hoje são de dev (localhost/LAN) — o **domínio de
  produção precisa entrar antes do deploy**.
- 🔴 **`.cache/` não pode ser versionado** — T&C §7 licencia os dados da TxLINE
  só para o hackathon e proíbe redistribuição. Em produção: rodar
  `cache:match` no deploy, ou (melhor) tabela no Postgres.
- 🟡 **Estado em memória** (#3): o XP do jurado some no primeiro restart.
- 🟡 **Allowed origins da Privy**: o domínio de produção precisa entrar no
  painel, senão E7 → tela branca e muda.

---

## 7. Contratos que a v1 herda

O v0 expõe os mesmos contratos que a interface real vai consumir:

```
REST  POST /api/login              (Bearer da Privy → find-or-create por DID)
      POST /api/account/sync       (re-sincroniza carteiras vinculadas)
      POST /api/account/handle     (o fã escolhe o apelido — E12: nunca derivar do e-mail)
      GET  /api/state              (rede, credenciais, privy pública, salas)
      GET  /api/fixtures           POST /api/fixtures/refresh
      POST /api/rooms/:id/join     POST /api/rooms/:id/leave
      POST /api/rooms/:id/predictions
      POST /api/rooms/:id/bets
      GET  /api/logs

WS    /ws  → score_event, odds_event, odds_explain, question_open/closed/
             resolved/void, ranking, market_update/resolved/proof,
             game_end, replay_done
```

Modelo de usuário: `walletSource: "privy_embedded" | "external" | "simulated"` —
as duas primeiras cumprem "sign up through Solana" (Opções A e B da doc 2.4).

Fontes de replay: `txline-cache | txline-historical | txline-snapshot | synthetic`.
O **sintético é opt-in e dev-only** — a regra do hackathon exige TxLINE como
fonte primária (A8). Com o cache, ele deixou de ser necessário.

> **SUPERADO em 17/07 — esta lista está errada e não pode ser copiada.** Falta
> `txline-updates`, que é **o valor que o cache realmente grava** (medido: a partida
> `18241006` está no Postgres com `cache_source = 'txline-updates'`), e `txline-live`.
> Com o vocabulário acima, a única forma de rotular a partida gravada era chamá-la de
> `txline-cache` — **rótulo de proveniência mentindo, o G6 na letra**. Lista correta e
> os três tipos que a espelham: **CONTEXT §8**.

---

## 8. Como rodar

```bash
npm install
cp .env.example .env          # devnet por padrão; Privy no painel (ver .env.example)
npm run build:auth            # ilha React da Privy → public/
npm run cache:match           # grava a partida real 18241006 (~2 min)
npm test                      # 23/23
npm run smoke 18241006 60     # E2E: replay real + 2 bots + mercado + prova
npm start                     # http://localhost:4100
```

**Antes de gravar a demo: suba o servidor limpo.** Se houver sala aberta, sua
escolha de velocidade e fonte é **ignorada em silêncio** (G5).

---

## 9. Uma nota de método

Três vezes nesta sessão eu afirmei coisa sobre o painel da Privy de memória, e
mandei o Roberto caçar telas que não existiam. Nas três, ir à fonte (a doc, a API
pública, o `.d.ts` do pacote) resolveu em minutos.

Também comemorei um bug: `odds_explain: 125` parecia prova de que o explicador
tinha ganhado vida. Eram **115 fantasmas** — o número inflado *parecia* vitória.
O real é 10, todas atreladas a gols. **Contador que sobe demais é sintoma, não
troféu** (G8).

E um teste tinha congelado um erro de português (`includes("depois de o gol")`):
passava justamente porque codificava o defeito.

E descrevi a arquitetura da carteira errada o dia inteiro — "Shamir, iframe,
remontada no cliente" — quando a app roda em enclave (E15). A descrição vinha da
doc da v1, e eu a repeti sem conferir. Um comando (`curl` da config da app) teria
mostrado no primeiro minuto.

A v1 vai ter as mesmas tentações. O antídoto é o mesmo: **medir antes de
afirmar, desconfiar do número que agrada, e nunca herdar uma premissa sem
verificar — nem de uma doc sua.**
