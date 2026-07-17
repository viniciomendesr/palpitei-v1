'use client';

/**
 * A LIGA POR DENTRO — quem está nela e o código pra chamar mais gente.
 *
 * É aqui que "Chame a galera" (mockup) deixa de ser slogan: o convite é um
 * código curto que o fã manda no grupo. Sem esta tela, criar liga privada seria
 * criar um grupo de uma pessoa só.
 *
 * A rota devolve 404 pra quem não é membro — o MESMO 404 de liga inexistente, de
 * propósito (id vaza em print e em log de proxy; um 403 confirmaria que a liga
 * existe). Esta tela não tenta distinguir os dois casos porque o servidor não
 * conta a diferença.
 */

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

  const id = params?.id;
  // Mesma corrida do resto do app: a sessão local revive na hora, a Privy leva
  // uns segundos pra ficar `ready`. Buscar antes é 401 garantido.
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
      // Clipboard bloqueado (contexto sem HTTPS, permissão negada): o código está
      // na tela em fonte grande, dá pra digitar. Nada de "Copiado!" mentiroso.
    }
  };

  const membros = (n: number) => (n === 1 ? t.ligaMembroUm : fill(t.ligaMembros, { n }));

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

          {/* O convite */}
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

          {/* Quem está na liga */}
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
                    // Apelido ausente é dito como ausente. Inventar um nome — ou
                    // pior, tirar do e-mail (E12) — mentiria pra liga inteira e
                    // vazaria o endereço da pessoa.
                    color: m.handle ? 'var(--text-hi)' : 'var(--text-muted)',
                    fontStyle: m.handle ? 'normal' : 'italic',
                  }}
                >
                  {m.handle ?? t.ligaSemApelido}
                  {/* Quem é você na lista. O servidor é quem marca — a tela não
                      compara id nenhum, porque não recebe id de membro. */}
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
              {/* "lidera", não "você lidera": o dono pode ser outra pessoa, e
                  colar o rótulo da home aqui diria a todo mundo que ele é você. */}
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
        </>
      )}
    </Screen>
  );
}
