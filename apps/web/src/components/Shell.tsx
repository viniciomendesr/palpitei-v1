'use client';


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
