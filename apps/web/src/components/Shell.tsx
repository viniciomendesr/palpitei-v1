'use client';

/**
 * O ÚNICO <AppFrame> do app, na raiz.
 *
 * `scroll={false}` de propósito: quem rola é cada tela, exatamente como no
 * mockup (cada uma é `flex:1;min-height:0;overflow-y:auto`). A sala precisa disso
 * — ela não rola, ela ancora o bottom sheet do desafio em `position:absolute`
 * dentro de si e rola só o miolo. Com o scroll do frame ligado, o sheet subiria
 * junto com o conteúdo.
 *
 * Em troca, o safe-area vira responsabilidade nossa: o AppFrame só aplica os
 * insets no modo scroll. O topo sai aqui; o rodapé, na BottomNav.
 *
 * NUNCA use 100vh aqui dentro: 100vh é a janela inteira e estoura o frame no
 * desktop, onde o app é uma coluna de 420px centrada.
 */

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AppFrame } from './ds';
import { BottomNav, shouldShowNav } from './BottomNav';

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <AppFrame scroll={false}>
      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        {children}
      </main>
      {shouldShowNav(pathname) && <BottomNav />}
    </AppFrame>
  );
}

/**
 * A região rolável padrão de uma tela. Equivale ao `.pp-scroll` do mockup, sem
 * classe: `minHeight:0` é o que deixa o filho de um flex realmente encolher e
 * rolar em vez de empurrar o frame.
 */
export function Screen({
  children,
  padding,
  style,
}: {
  children: ReactNode;
  padding?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
