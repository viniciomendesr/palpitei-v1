# Palpitei v1

Jogo social de inteligência esportiva sobre o dado ao vivo da **TxLINE**: placar, eventos
e odds viram pergunta, palpite e explicação, com XP, ranking e ligas. Submissão da trilha
**Consumer and Fan Experiences** (Superteam World Cup Hackathon / TxODDS).
**Não há dinheiro real na v1** — XP é pontuação, não valor.

Monorepo: `apps/web` (PWA Next.js, mobile-only, dark-only) · `packages/core` (motores
puros) · `packages/txline` (cliente + ingestão) · `packages/db` (Postgres) ·
`packages/ds` (design system).

## 🔴 Leia `docs/CONTEXT.md` antes de escrever qualquer linha

Não é formalidade e não é opcional nem para uma tarefa pequena. **As armadilhas deste
projeto falham em SILÊNCIO** — sem erro, sem log, sem teste vermelho. Você não vai
tropeçar nelas: vai descobrir na frente do jurado. Já aconteceu de alguém ler o CONTEXT,
documentar uma armadilha e **reintroduzi-la no commit seguinte**.

Este arquivo é só o mapa. **A verdade está no CONTEXT** — se os dois divergirem, vale o
CONTEXT, e conserte este.

| Onde | O quê |
|---|---|
| **[docs/CONTEXT.md](docs/CONTEXT.md)** | **Comece aqui.** Armadilhas, regras do hackathon, decisões, contratos. §11 = o que custou sangue nesta v1. |
| [docs/handoff-v0-para-v1.md](docs/handoff-v0-para-v1.md) | O handoff da bancada v0 (documento histórico de 16/07). |
| [packages/ds/CONVENTIONS.md](packages/ds/CONVENTIONS.md) | Contrato do design. Leia inteiro antes de fazer UI. |

## O prazo, e a única chance

- **Submissão: 19/07/2026 23:59 UTC** (listing Brasil 18/07 23:59 BR).
- **France × England — 18/07 21:00 UTC, fixture `18257865`.** É a **janela do vídeo** e a
  **única chance** de exercitar o caminho ao vivo antes do prazo.

  A trilha exige *"a live product that works during a match"* e hoje **o caminho ao vivo
  nunca processou um evento real**: `startLiveIngest` (`packages/txline/src/ingest/live.ts`)
  **não tem nenhum chamador**, e `TXLINE_LIVE_INGEST=false`. **São duas travas.** Ver
  **CONTEXT §10**. Sem segunda chance: Spain × Argentina (19/07 19:00 UTC) cai ~5h antes
  do prazo.

  Quando a partida acabar: **`npm run cache:match 18257865`**. O dataset da devnet
  rotaciona — a partida do replay atual (`18241006`) **já sumiu** do snapshot e só existe
  porque foi gravada. Se não gravar, perdeu.

## As regras que, violadas, custam a submissão

1. **Nenhum payload da TxLINE versionado** (T&C §7 — o repo é público, o dado é
   licenciado só para o hackathon). Cache vai para o **Postgres**, nunca para `.cache/`
   commitado. Nem em doc, nem em teste, nem em issue.
2. **A identidade é o `privy_did` verificado do Bearer — `body.userId` NUNCA.** Atrás de
   link público com ranking valendo, id vindo do cliente é fraude de um `curl`. O motor
   roda no **servidor**: cliente que decide o próprio XP é a mesma fraude com outro nome.
3. **O modo demo (§5.1) não pode depender de rede.** É requisito: o jurado testa sem
   custo e **sem criar carteira**. É o caminho que não pode falhar.
4. **Sem fallback silencioso e sem dado inventado.** Produto funcional; mockup =
   desclassificação. O fã logado vê **erro**, nunca mock com cara de real — cada sala
   mostra o **selo da origem**, e rótulo de proveniência que mente é o G6. O gerador
   sintético é opt-in, dev-only, e jamais entra em demo ou submissão.

## Como rodar

```bash
npm install
cp .env.example .env          # preencha as credenciais (o arquivo explica cada uma)
npm run build:ds              # design system → dist/
npm run db:migrate            # aplica o schema
npm test                      # motores de domínio
npm run dev                   # http://localhost:3000
npm run privy:doctor          # quando Google/Phantom falharem — antes de acusar o código
```

Testar Privy no celular exige HTTPS (`npm run dev:https` + `npm run lan:url`) e a origem
liberada em Allowed origins. Detalhes no [README](README.md).

**`REPLAY_SPEED=12` no `.env`, e não é gosto:** a 60× a janela do palpite vira 8 min de
jogo contra 10 de horizonte, e a regra de justiça **anula quase tudo** (sem XP). O default
do código ainda é 60 — rodar sem a chave devolve o problema em silêncio. CONTEXT §11.

## Método (a regra da casa)

> **Medir antes de afirmar, desconfiar do número que agrada, e nunca herdar uma premissa
> sem verificar — nem de uma doc sua.**

Vale para esta doc. Toda afirmação sobre estado externo (Privy, devnet, banco) precisa de
**data** e do **comando que a reproduz**; sem os dois, é premissa. Em 17/07 o CONTEXT foi
pego afirmando como "medido" uma tabela da Privy **invertida** e já vencida — estado
externo muda sozinho, a doc não. Se você mediu, **escreva a data**. Se não conseguiu
verificar, escreva **"não verificado"**.

Não use emoji em UI ou texto de produto (ícone é SVG inline). Voz: pt-BR casual de
torcida, **nunca jargão de aposta**.
