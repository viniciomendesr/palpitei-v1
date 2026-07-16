# Palpitei

Jogo social de inteligência esportiva. Pega o dado ao vivo da **TxLINE** (placar, eventos e
odds) e transforma em pergunta, palpite e explicação simples — com XP, ranking ao vivo e
ligas entre amigos.

Submissão da trilha **Consumer and Fan Experiences** do Superteam World Cup Hackathon (TxODDS).

> **Não há dinheiro real aqui.** O XP é pontuação, não valor. Mercados com valor real em USDC
> são a v2 (**Presságio**), um webapp separado que compartilha só a identidade.

## O loop

```
evento da TxLINE chega  →  abre um desafio (janela curta)
      →  você palpita antes de fechar
      →  o próximo evento oficial resolve
      →  XP, ranking ao vivo e a leitura do que mudou
```

A janela **sempre fecha antes** do lance que resolve o desafio. Se o lance chega com a janela
aberta, a pergunta é anulada — justo para todo mundo.

## Estrutura

| Pacote | Papel |
|---|---|
| `apps/web` | PWA Next.js (App Router). Mobile-only, dark-only. |
| `packages/core` | Motores puros: perguntas, mercado, ranking, explicador, relógio. Sem I/O. |
| `packages/txline` | Cliente da TxLINE + ingestão (SSE ao vivo e replay). |
| `packages/db` | Schema Postgres e repositórios. |
| `packages/ds` | Design system (componentes, tokens, fontes). |
| `supabase/migrations` | Migrations versionadas. |

## Como rodar

```bash
npm install
cp .env.example .env          # preencha as credenciais (veja o arquivo)
npm run build:ds              # design system → dist/
npm run db:migrate            # aplica o schema
npm test                      # motores de domínio
npm run dev                   # http://localhost:3000
```

## Como abrir no celular

O servidor de desenvolvimento escuta em `0.0.0.0`, entao outros dispositivos da
mesma rede conseguem acessar pelo IP do Mac. Para usar a carteira embutida da
Privy no celular, use HTTPS: embedded wallets dependem de contexto seguro, e
`http://<ip-do-mac>` nao conta como seguro.

```bash
npm run lan:url               # mostra a URL para abrir no celular
npm run dev:https             # modo recomendado para testar a Privy no celular
```

No smartphone, conectado ao mesmo Wi-Fi do Mac, abra a URL impressa em
`Celular HTTPS`, por exemplo:

```text
https://172.20.10.2:3000
```

Importante: `localhost` no smartphone e o proprio smartphone, nao o Mac. Por
isso a URL precisa usar o IP do Mac.

Se a tela ficar branca ou a Privy nao inicializar, adicione tambem essa origem
no painel da Privy em Allowed origins:

```text
http://localhost:3000
https://localhost:3000
http://<ip-do-mac>:3000
https://<ip-do-mac>:3000
```

Se o navegador do celular nao conectar, confira:

- Mac e celular estao na mesma rede.
- Para login/carteira Privy, a URL usa `https`.
- O Firewall do macOS permitiu conexoes de entrada para o Node.js.

## Diagnostico da Privy

Quando Google ou Phantom falharem, rode:

```bash
npm run privy:doctor
```

O login Google da Privy usa sempre este callback no Google Cloud:

```text
https://auth.privy.io/api/v1/oauth/callback
```

Se aparecer `redirect_uri_mismatch`, corrija o OAuth Client ID mostrado pelo
doctor no Google Cloud em **Authorized redirect URIs**. Allowed origins da Privy
e Authorized redirect URIs do Google sao configuracoes diferentes.

## Documentação

| Arquivo | O quê |
|---|---|
| **[docs/CONTEXT.md](docs/CONTEXT.md)** | **Comece aqui.** As armadilhas silenciosas herdadas da bancada v0, as regras do hackathon que restringem o código e as decisões já tomadas. |
| [docs/handoff-v0-para-v1.md](docs/handoff-v0-para-v1.md) | O handoff da bancada de integração: o que já está provado, o que dói, o que segue em aberto. |
| [packages/ds/CONVENTIONS.md](packages/ds/CONVENTIONS.md) | O contrato do design. Leia antes de fazer UI. |

## Uma nota sobre o dado

Os dados da TxLINE são licenciados **só para o hackathon** e não podem ser redistribuídos
(T&C §7). Nenhum payload é versionado neste repositório: a partida gravada vive no Postgres,
não em disco.

A TxLINE é a fonte primária. O gerador sintético existe só para desenvolvimento offline, é
opt-in e **nunca** aparece em demo ou submissão — cada sala mostra um selo da origem do dado.
