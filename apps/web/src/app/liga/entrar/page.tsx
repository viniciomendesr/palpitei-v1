'use client';

/**
 * ENTRAR NUMA LIGA — o outro lado do "chame a galera".
 *
 * Entrar NÃO gasta a cota do free: a cota é sobre a liga que você CRIA. Se
 * gastasse, o primeiro amigo que você chamasse — que provavelmente já tem a
 * própria liga — não conseguiria aceitar o convite, e o convite morreria no
 * primeiro convidado. Por isso esta tela não tem gate nenhum.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { useI18n } from '@/lib/i18n';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';
import { api } from '@/lib/api';

/** O código tem 6 caracteres — ver o ALFABETO do leagueRepo. */
const TAM_CODIGO = 6;

export default function EntrarLigaPage() {
  const router = useRouter();
  const { t } = useI18n();
  const ready = useRequireSession();
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  if (!ready) return null;

  const valido = codigo.trim().length === TAM_CODIGO;

  const entrar = async () => {
    if (!valido || entrando) return;
    setEntrando(true);
    setErro(null);
    try {
      const { league } = await api.joinLeague(codigo);
      router.replace(`/liga/${league.id}`);
    } catch (e) {
      // 404 = código que não abre liga nenhuma. A mensagem vem do servidor, em
      // pt-BR e sem culpar o fã: pode ser erro de quem mandou.
      setErro(e instanceof Error ? e.message : t.ligaErro);
      setEntrando(false);
    }
  };

  return (
    <Screen padding="18px 18px 20px">
      <button
        onClick={() => router.push('/home')}
        style={{
          all: 'unset',
          cursor: 'pointer',
          fontSize: 12.5,
          fontWeight: fw.bold,
          color: 'var(--text-muted)',
        }}
      >
        {t.ligaVoltar}
      </button>

      <div
        style={{
          marginTop: 18,
          fontSize: 10.5,
          fontWeight: fw.black,
          letterSpacing: 1,
          color: 'var(--text-faint)',
        }}
      >
        {t.entrarLigaTitulo}
      </div>

      <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 24, marginTop: 10 }}>
        {t.entrarLigaLead}
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
        {t.entrarLigaSub}
      </div>

      <input
        value={codigo}
        // Maiúscula na hora: o código é gravado em maiúscula, e o servidor
        // normaliza de novo. Aqui é só pra tela não parecer que recusou o que o
        // fã digitou certo em minúscula.
        onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[\s-]/g, ''))}
        maxLength={TAM_CODIGO}
        placeholder={t.entrarLigaPlaceholder}
        aria-label={t.entrarLigaTitulo}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(e) => e.key === 'Enter' && entrar()}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          marginTop: 20,
          height: 52,
          padding: '0 14px',
          borderRadius: 'var(--r-xl)',
          background: 'var(--surface-sunken)',
          border: `1.5px solid ${valido ? 'var(--lime-line)' : 'var(--border-2)'}`,
          color: 'var(--text-hi)',
          fontFamily: 'var(--font-mono, var(--font-sans))',
          fontSize: 22,
          fontWeight: fw.black,
          letterSpacing: 4,
          textAlign: 'center',
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
        <Button full disabled={!valido || entrando} onClick={entrar}>
          {entrando ? t.entrarLigaEntrando : t.entrarLigaCta}
        </Button>
      </div>
    </Screen>
  );
}
