'use client';


import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { useI18n } from '@/lib/i18n';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';
import { api, ApiError } from '@/lib/api';

const MIN_NOME = 3;
const MAX_NOME = 24;

export default function NovaLigaPage() {
  const router = useRouter();
  const { t } = useI18n();
  const ready = useRequireSession();
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  if (!ready) return null;

  const valido = nome.trim().length >= MIN_NOME;

  const criar = async () => {
    if (!valido || criando) return;
    setCriando(true);
    setErro(null);
    try {
      const { league } = await api.createLeague(nome);
      router.replace(`/liga/${league.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        router.replace('/premium');
        return;
      }
      setErro(e instanceof Error ? e.message : t.ligaErro);
      setCriando(false);
    }
  };

  return (
    <Screen padding="18px 18px 20px">
      <div
        style={{
          fontSize: 10.5,
          fontWeight: fw.black,
          letterSpacing: 1,
          color: 'var(--text-faint)',
        }}
      >
        {t.novaLigaTitulo}
      </div>

      <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 24, marginTop: 10 }}>
        {t.newLeagueLead}
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          fontWeight: fw.medium,
          marginTop: 4,
          lineHeight: 'var(--leading-body)',
        }}
      >
        {t.newLeagueSub}
      </div>

      <input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        maxLength={MAX_NOME}
        placeholder={t.novaLigaPlaceholder}
        aria-label={t.novaLigaNome}
        onKeyDown={(e) => e.key === 'Enter' && criar()}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          marginTop: 20,
          height: 46,
          padding: '0 14px',
          borderRadius: 'var(--r-xl)',
          background: 'var(--surface-sunken)',
          border: `1.5px solid ${valido ? 'var(--lime-line)' : 'var(--border-2)'}`,
          color: 'var(--text-hi)',
          fontFamily: 'var(--font-sans)',
          fontSize: 15,
          fontWeight: fw.bold,
          outline: 'none',
        }}
      />

      {erro && (
        <div
          role="alert"
          style={{
            marginTop: 10,
            fontSize: 12.5,
            fontWeight: fw.medium,
            color: 'var(--red)',
            lineHeight: 'var(--leading-body)',
          }}
        >
          {erro}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <Button full disabled={!valido || criando} onClick={criar}>
          {criando ? t.novaLigaCriando : t.novaLigaCta}
        </Button>
      </div>
    </Screen>
  );
}
