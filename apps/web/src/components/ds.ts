'use client';

/**
 * Reexport do design system atrás de uma fronteira de cliente.
 *
 * Os componentes do @palpitei/ds são puros (nenhum usa hook), mas recebem
 * handlers — e função não atravessa a fronteira do servidor. Importar por aqui
 * marca todos como client reference de uma vez, em vez de espalhar 'use client'
 * por cada tela e descobrir o erro só no build.
 *
 * Os 10 componentes do sistema. Não existe outro, e não é pra inventar: o
 * contrato de cada um está no .d.ts ao lado do fonte em packages/ds/components/core/.
 */
export {
  AppFrame,
  Button,
  Badge,
  Chip,
  SegTabs,
  Card,
  Toggle,
  ProgressBar,
  ListRow,
  MatchCard,
} from '@palpitei/ds';
