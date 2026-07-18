# Comentários de código

Este documento concentra o contexto operacional e histórico que seria longo demais
para comentários locais. A fonte de verdade para contratos e armadilhas continua
sendo [CONTEXT.md](CONTEXT.md).

## Critério

Comentários junto ao código devem ser curtos e preservar apenas o que ajuda a
manter o comportamento correto no ponto de mudança:

- contrato público, unidade ou significado de um tipo;
- invariante de segurança, privacidade, integridade ou concorrência;
- motivo não óbvio de uma ordem, um `null`, um merge, uma deduplicação ou um
  timeout;
- diretivas de ferramenta (`eslint`, TypeScript) e avisos de segredo/licença.

Histórico de incidentes, métricas de uma partida, alternativas descartadas,
runbooks e explicações de várias linhas ficam aqui ou em documentação temática.
Não use este documento para registrar payloads da TxLINE ou segredos.

## Sala, SSE e persistência

- [apps/web/src/server/rooms.ts](../apps/web/src/server/rooms.ts) mantém a sala
  no processo e é a autoridade de relógio, XP e serialização SSE. O relógio é
  ancorado em eventos do feed porque o replay comprime pausas; a parede apenas
  interpola entre âncoras. Antes de mudar essa regra, consulte CONTEXT §3 e §11.
- A sala usa o mesmo `processarEvento` para replay e ingestão. Odds atualizam
  probabilidades e explicações; somente eventos de score atualizam placar,
  totais e perguntas. No feed, `hasScore` sem a chave `Goals` não autoriza
  publicar 0–0; totais são parciais e precisam de merge por chave.
- O pacote SSE é personalizado por fã: `gained`, recibos, resultados e `me` no
  ranking não podem incluir dados internos ou respostas de outros usuários.
  Perguntas fechadas respondidas e resultados devem estar no primeiro pacote
  para que um reload não apague o recibo.
- A carência de sala vazia evita que um reload recrie runner e question IDs. O
  catch-up ao vivo assina antes da leitura do banco e deduplica scores por `seq`
  e odds por `messageId`.
- [apps/web/src/lib/useSala.ts](../apps/web/src/lib/useSala.ts) faz reconexão
  manual porque `EventSource` não envia Bearer em header e deve receber um token
  renovado em cada conexão. Ao voltar de background, reconecta uma conexão
  fechada; cada `room_state` substitui, em vez de acumular, o estado local.
- [apps/web/src/lib/relogio.ts](../apps/web/src/lib/relogio.ts) e
  [apps/web/src/lib/reconexao.ts](../apps/web/src/lib/reconexao.ts) isolam duas
  regras testáveis: interpolação de clock sem regressão e backoff exponencial
  limitado.

## Portas do motor e banco

- [packages/db/src/enginePorts.ts](../packages/db/src/enginePorts.ts) adapta as
  portas síncronas/fire-and-forget do core para I/O assíncrono. Rejeições não
  podem escapar para o processo; devem ser registradas e reaparecer via
  `flush` ou, para um palpite, `flushDe(id)`.
- `flushDe` é obrigatório no caminho de um palpite individual: um erro de outro
  fã não pode virar resposta de erro para quem não o causou.
- `saveQuestion` precisa completar antes de `savePrediction` inserir a chave
  estrangeira. Abertura e desfecho da pergunta são ambos persistidos.
- Não adicionar `saveUser` com XP ou saldo absoluto. XP e saldo são operações
  relativas, idempotentes e protegidas por CAS; isso evita perda por cópia velha
  e débito/crédito duplicado.

## Privy, identidade e sessão

- [apps/web/src/components/privy/PrivyIsland.tsx](../apps/web/src/components/privy/PrivyIsland.tsx)
  preserva duas garantias: DID verificado é a identidade, e e-mail nunca vira
  apelido público. A configuração `users-without-wallets` só cria carteira
  embutida para quem não tem uma; `all-users` não é equivalente.
- O watchdog de inicialização da Privy e o timeout de exportação são
  intencionais: erros de origem, SDK ou modal podem não rejeitar sozinhos. O
  provider de token é estável e lê refs atuais para não emitir uma requisição
  com Bearer obsoleto durante a autenticação.
- [apps/web/src/lib/session.tsx](../apps/web/src/lib/session.tsx) trata
  `sessionStorage` como cache. Contas autenticadas são reconciliadas por
  `/api/state`; demo é a exceção local que não pode exigir rede.
- [scripts/privy-doctor.mjs](../scripts/privy-doctor.mjs) lê a causa de erro do
  OAuth em `Location.authError`, e não no corpo/locale de uma página de erro.
  Execute `npm run privy:doctor` ao mudar origens ou configuração OAuth.

## Configuração e desenvolvimento local

- [apps/web/next.config.mjs](../apps/web/next.config.mjs) carrega o `.env` da
  raiz e transpila pacotes de fonte TypeScript. `@palpitei/db` é consumido a
  partir de `dist`, portanto o fluxo de desenvolvimento deve prepará-lo antes
  de executar o app.
- [.env.example](../.env.example) contém somente o mínimo para configurar Privy,
  TxLINE, Postgres e runtime. Segredos continuam fora do repositório; TxLINE é
  uma credencial de serviço e nunca deve chegar ao browser. Para detalhes de
  segurança e operação, consulte CONTEXT e os comandos `db:migrate`,
  `db:status` e `privy:doctor`.
- [packages/txline/.env.example](../packages/txline/.env.example) documenta
  opções do cliente TxLINE. Mantenha endpoint, JWT e token na mesma rede. O
  gerador sintético é exclusivo de desenvolvimento e nunca pode ser usado em
  demo ou submissão; a origem exibida pela UI deve ser verdadeira.
- [scripts/dev-cert.mjs](../scripts/dev-cert.mjs) gera certificado para localhost
  e IPs LAN atuais. HTTPS é necessário para testar carteira embutida via IP de
  celular; a chave e os certificados gerados permanecem ignorados.

## `.gitignore`

O arquivo [.gitignore](../.gitignore) foi mantido sem mudança: ele **não** ignora
Markdown de documentação do projeto. Os padrões existentes cobrem segredos,
artefatos de build, certificado local, cache licenciado da TxLINE e worktrees.
Não há, neste repositório, um padrão inequivocamente destinado a notas Markdown
locais que justifique adicionar uma regra nova.

## Mudanças futuras

Ao alterar uma das áreas acima, deixe no código apenas a regra que precisa
continuar próxima da execução. Atualize este documento quando o motivo for
operacional, histórico ou atravessar mais de um arquivo; atualize
[CONTEXT.md](CONTEXT.md) quando a regra for um contrato ou uma armadilha global.
