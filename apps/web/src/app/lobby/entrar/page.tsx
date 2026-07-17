'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { useI18n } from '@/lib/i18n';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';

export default function EntrarLobbyPage() {
  const router = useRouter();
  const { t } = useI18n();
  const ready = useRequireSession();
  const [code, setCode] = useState('');
  const normalized = code.replace(/[\s-]/g, '').toUpperCase();
  if (!ready) return null;

  return (
    <Screen padding="28px 22px" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <h1 style={{ margin: 0, fontSize: 27, fontWeight: fw.black }}>{t.lobbyEnterTitle}</h1>
      <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.lobbyEnterBody}</p>
      <input
        autoFocus value={code} onChange={(event) => setCode(event.target.value.toUpperCase())}
        placeholder={t.entrarLigaPlaceholder} maxLength={8}
        style={{ height: 58, marginTop: 18, borderRadius: 'var(--r-xl)', border: '1px solid var(--border-2)', background: 'var(--surface-1)', color: 'var(--text-hi)', padding: '0 18px', fontSize: 22, fontWeight: fw.black, letterSpacing: 4, textTransform: 'uppercase' }}
      />
      <Button full size="lg" disabled={!/^[A-HJKMNP-Z2-9]{6}$/.test(normalized)} onClick={() => router.push(`/convite/${normalized}`)} style={{ marginTop: 14 }}>
        {t.lobbyEnterCta}
      </Button>
      <Button full variant="secondary" onClick={() => router.push('/home')} style={{ marginTop: 10 }}>
        {t.backHome}
      </Button>
    </Screen>
  );
}
