'use client';


import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { useI18n, fill } from '@/lib/i18n';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';
import { api, type ApiLeagueDetail } from '@/lib/api';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';

export default function LigaPage() {
  const router = useRouter();
  const { t } = useI18n();
  const ready = useRequireSession();
  const params = useParams<{ id: string }>();
  const privy = usePrivyAuth();
  const [dados, setDados] = useState<ApiLeagueDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);

  const id = params?.id;
  const podeBuscar = Boolean(id) && privy.ready && privy.authenticated;

  useEffect(() => {
    if (!podeBuscar || !id) return;
    let vivo = true;
    api
      .league(id)
      .then((r) => vivo && setDados(r))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : t.ligaErro));
    return () => {
      vivo = false;
    };
  }, [podeBuscar, id, t.ligaErro]);

  if (!ready) return null;

  const copiar = async () => {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.league.inviteCode);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
    }
  };

  const membros = (n: number) => (n === 1 ? t.ligaMembroUm : fill(t.ligaMembros, { n }));

  const apagar = async () => {
    if (!id || apagando) return;
    setApagando(true);
    setErroApagar(null);
    try {
      await api.deleteLeague(id);
      router.push('/home');
    } catch (e) {
      setErroApagar(e instanceof Error ? e.message : t.ligaApagarErro);
      setApagando(false);
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

      {erro && (
        <div
          role="alert"
          style={{
            marginTop: 24,
            fontSize: 13,
            fontWeight: fw.medium,
            color: 'var(--red)',
            lineHeight: 'var(--leading-body)',
          }}
        >
          {erro}
        </div>
      )}

      {!dados && !erro && (
        <div
          style={{
            marginTop: 24,
            fontSize: 13,
            fontWeight: fw.medium,
            color: 'var(--text-muted)',
          }}
        >
          {t.ligaCarregando}
        </div>
      )}

      {dados && (
        <>
          <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 26, marginTop: 14 }}>
            {dados.league.name}
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              fontWeight: fw.medium,
              marginTop: 3,
            }}
          >
            {dados.league.iLead
              ? `${membros(dados.league.memberCount)} · ${t.ligaVoceLidera}`
              : membros(dados.league.memberCount)}
          </div>

          <div
            style={{
              marginTop: 22,
              padding: 18,
              background: 'linear-gradient(160deg, var(--lime-a10), var(--surface-1))',
              border: '1.5px dashed var(--lime-line)',
              borderRadius: 'var(--r-2xl)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: fw.black,
                letterSpacing: 1,
                color: 'var(--lime)',
              }}
            >
              {t.ligaConviteTitulo}
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: 30,
                fontWeight: fw.black,
                letterSpacing: 5,
                color: 'var(--text-hi)',
                fontFamily: 'var(--font-mono, var(--font-sans))',
              }}
            >
              {dados.league.inviteCode}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--text-muted)',
                fontWeight: fw.medium,
                marginTop: 8,
                lineHeight: 'var(--leading-body)',
              }}
            >
              {t.ligaConviteSub}
            </div>
            <div style={{ marginTop: 14 }}>
              <Button onClick={copiar}>{copiado ? t.ligaConviteCopiado : t.ligaConviteCopiar}</Button>
            </div>
          </div>

          <div
            style={{
              marginTop: 22,
              fontSize: 10.5,
              fontWeight: fw.black,
              letterSpacing: 1,
              color: 'var(--text-faint)',
            }}
          >
            {t.ligaMembrosTitulo}
          </div>

          {dados.members.map((m, i) => (
            <div
              key={`${m.handle ?? 'sem-apelido'}-${i}`}
              style={{
                marginTop: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 14,
                background: 'var(--surface-1)',
                border: '1px solid var(--border-1)',
                borderRadius: 'var(--r-2xl)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: fw.heavy,
                    fontSize: 15,
                    color: m.handle ? 'var(--text-hi)' : 'var(--text-muted)',
                    fontStyle: m.handle ? 'normal' : 'italic',
                  }}
                >
                  {m.handle ?? t.ligaSemApelido}
                  {m.me && (
                    <span
                      style={{ color: 'var(--text-muted)', fontWeight: fw.medium, fontSize: 12.5 }}
                    >
                      {' · '}
                      {t.ligaVoce}
                    </span>
                  )}
                </div>
              </div>
              {m.iLead && (
                <span
                  style={{
                    flex: 'none',
                    fontSize: 10,
                    fontWeight: fw.black,
                    letterSpacing: 0.5,
                    color: 'var(--lime)',
                  }}
                >
                  {t.ligaLidera.toUpperCase()}
                </span>
              )}
            </div>
          ))}

          {dados.league.iLead && (
            <div style={{ marginTop: 26 }}>
              {!confirmando ? (
                <Button variant="danger" size="sm" onClick={() => setConfirmando(true)}>
                  {t.ligaApagar}
                </Button>
              ) : (
                <div
                  style={{
                    padding: 16,
                    background: 'var(--surface-1)',
                    border: '1.5px solid var(--red)',
                    borderRadius: 'var(--r-2xl)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: fw.medium,
                      color: 'var(--text-hi)',
                      lineHeight: 'var(--leading-body)',
                    }}
                  >
                    {t.ligaApagarAviso}
                  </div>
                  {erroApagar && (
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
                      {erroApagar}
                    </div>
                  )}
                  <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                    <Button variant="danger" size="sm" disabled={apagando} onClick={apagar}>
                      {apagando ? t.ligaApagando : t.ligaApagarConfirma}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={apagando}
                      onClick={() => {
                        setConfirmando(false);
                        setErroApagar(null);
                      }}
                    >
                      {t.cancel}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Screen>
  );
}
