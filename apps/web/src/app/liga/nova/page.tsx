'use client';

/**
 * CRIAR LIGA — o nome, e só.
 *
 * Por que esta tela existe: a liga precisa de um NOME, e o botão do protótipo
 * criava "Minha Liga" sem perguntar nada porque não criava liga nenhuma — só
 * incrementava um contador local. Liga de verdade tem nome que a galera
 * reconhece no grupo do zap.
 *
 * O gate do free é do SERVIDOR (402, sob trava no banco). A home evita trazer o
 * fã até aqui quando ele já gastou a cota, mas quem responde é a rota — por isso
 * o 402 é tratado aqui, e não presumido impossível.
 */

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
      // Vai direto pra liga: quem acabou de criar quer o código pra chamar a
      // galera, não a home.
      router.replace(`/liga/${league.id}`);
    } catch (e) {
      // 402 é o paywall, não um erro do fã: manda pro /premium em vez de mostrar
      // uma mensagem vermelha sobre algo que ele não fez de errado.
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
          // A borda é o feedback, igual ao campo do apelido: cinza enquanto
          // curto, lime quando vale.
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
