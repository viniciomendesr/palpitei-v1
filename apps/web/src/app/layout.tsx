/**
 * Layout raiz.
 *
 * O CSS do design system entra AQUI e em nenhum outro lugar — é ele que traz as
 * fontes, os tokens de cor/tipo/espaço e as 10 vars --app-* que o AppFrame
 * consome. (Na vendorização o styles.css não importava tokens/app-frame.css e o
 * AppFrame perdia largura, altura e raio SEM ERRO NENHUM. Já está consertado;
 * não desfaça mexendo na ordem dos imports.)
 *
 * Dark-only: não existe tema claro e nenhum token suporta um. `colorScheme:'dark'`
 * avisa o browser pra não inverter os controles nativos.
 */

import type { Metadata, Viewport } from 'next';
import '@palpitei/ds/styles.css';
import './globals.css';
import { Providers } from './providers';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = {
  title: 'Palpitei Copa do Mundo 2026',
  description: 'Palpite ao vivo, desafie seus amigos e se divirta.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Palpitei',
  appleWebApp: {
    capable: true,
    title: 'Palpitei',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    // SVG na aba do browser (nítido em qualquer densidade); PNG no resto.
    // O manifest só aponta PNG: o Chrome RECUSA ícone SVG na instalação
    // ("resource isn't a valid image") e o app deixa de ser instalável —
    // em silêncio, só um warning no console. Verificado neste app.
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // App de telefone: zoom por pinça atrapalha o alvo de toque do desafio.
  maximumScale: 1,
  viewportFit: 'cover',
  // Literal porque metadata do documento não enxerga var(--*). É o valor EXATO
  // de --bg-app (tokens/colors.css). Se aquele token mudar, mude aqui e no
  // manifest.webmanifest junto — é o único lugar do app que duplica um token.
  themeColor: '#0B0E0D',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
