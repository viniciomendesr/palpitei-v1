'use client';

/**
 * Bottom nav — Início / Ranking / Perfil.
 *
 * Só aparece nessas três rotas (era `showNav` no protótipo): a sala, o
 * onboarding, o login e o fluxo premium ocupam a tela inteira.
 */

import { usePathname, useRouter } from 'next/navigation';
import { HomeIcon, RankingIcon, ProfileIcon } from './Icons';
import { useI18n } from '@/lib/i18n';
import { fw } from '@/lib/tokens';

/** As rotas que mostram a nav. Fora daqui, a tela é cheia. */
export const NAV_ROUTES = ['/home', '/ranking', '/perfil'] as const;

export function shouldShowNav(pathname: string): boolean {
  return (NAV_ROUTES as readonly string[]).includes(pathname);
}

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  const items = [
    { href: '/home', label: t.navHome, Icon: HomeIcon },
    { href: '/ranking', label: t.navRanking, Icon: RankingIcon },
    { href: '/perfil', label: t.navPerfil, Icon: ProfileIcon },
  ];

  return (
    <nav
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        padding: '8px 24px 22px',
        // AppFrame só aplica safe-area no modo scroll; aqui o scroll é nosso, o inset também.
        paddingBottom: 'calc(22px + env(safe-area-inset-bottom, 0px))',
        borderTop: '1px solid var(--border-1)',
        background: 'var(--surface-header)',
      }}
    >
      {items.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <button
            key={href}
            onClick={() => router.push(href)}
            aria-current={active ? 'page' : undefined}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              minWidth: 'var(--tap-min)',
              color: active ? 'var(--lime)' : 'var(--text-muted)',
            }}
          >
            <Icon />
            <span style={{ fontSize: 10.5, fontWeight: fw.heavy }}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
