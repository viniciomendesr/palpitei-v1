
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
  maximumScale: 1,
  viewportFit: 'cover',
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
