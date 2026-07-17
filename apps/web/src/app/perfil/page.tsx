'use client';

/**
 * PERFIL — apelido, números, missões e ajustes.
 *
 * O selo de autenticação diz COMO a conta entrou, e importa: no modo demo ele
 * diz "demo · carteira simulada" com todas as letras. O jurado tem que
 * conseguir ver que aquela conta não tem carteira de verdade — a §5.1 permite
 * testar sem carteira, mas não deixa a gente fingir que tem uma.
 *
 * O apelido é editável aqui, e continua sendo escolha do fã (E12): nunca sai do
 * e-mail. Salvar grava no SERVIDOR primeiro (POST /api/account/handle) e só
 * fecha o painel quando ele aceita — a versão local-primeiro pintava o nome na
 * tela com o banco dizendo outro, que é a tela mentindo sobre o que persiste.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toggle, ProgressBar, ListRow, Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronRight, Pencil, Crown, Layers, Copy } from '@/components/Icons';
import { NicknameInput, isNicknameValid, MAX_NICK } from '@/components/NicknameInput';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import { useI18n, type Lang } from '@/lib/i18n';
import { useSession, initialsOf } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';

export default function PerfilPage() {
  const router = useRouter();
  const { t, fmt, lang, setLang } = useI18n();
  const { session, update, logout, refreshState, serverStats } = useSession();
  const privy = usePrivyAuth();
  const ready = useRequireSession();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [carteiraCopiada, setCarteiraCopiada] = useState(false);

  // Os números desta tela são do BANCO (o motor liquida XP lá): realinha o
  // cache local ao entrar. Para o demo é no-op — a conta de teste é local (§5.1).
  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  if (!ready || !session) return null;

  const invalid = !isNicknameValid(draft);
  const initials = initialsOf(session.nickname, session.accountType);

  const authLabel =
    session.authMethod === 'google'
      ? t.authGoogle
      : session.authMethod === 'wallet'
        ? '7xKq…9fPz · Solana'
        : t.walletDemo;

  // Nome/e-mail são dados privados para o próprio fã reconhecer a conta. O
  // apelido público continua sendo o que ele escolheu — nunca derivamos um do
  // outro (E12). A conta demo recebe o mesmo bloco para demonstrar a interface,
  // mas os dados e o código deixam claro que não há carteira real vinculada.
  const emDemo = session.authMethod === 'demo';
  const mostrarDadosConta = emDemo || (privy.ready && privy.authenticated);
  const nomeDaConta = emDemo ? t.profileDemoName : (privy.profile.name ?? t.profileNotProvided);
  const emailDaConta = emDemo ? t.profileDemoEmail : (privy.profile.email ?? t.profileNotProvided);
  const enderecoCarteira = emDemo ? t.profileDemoWallet : (privy.wallets[0]?.address ?? null);
  const avisoCarteira = emDemo ? t.profileDemoWalletDisclaimer : t.profileWalletDisclaimer;

  const copiarCarteira = async () => {
    if (!enderecoCarteira) return;
    try {
      await navigator.clipboard.writeText(enderecoCarteira);
      setCarteiraCopiada(true);
      window.setTimeout(() => setCarteiraCopiada(false), 2_000);
    } catch {
      // Clipboard pode estar bloqueado por permissão do navegador. Não fingimos
      // cópia concluída; o endereço segue visível para seleção manual.
      setCarteiraCopiada(false);
    }
  };

  const openEdit = () => {
    setDraft(session.nickname);
    setErroNome(null);
    setEditing(true);
  };

  const saveName = async () => {
    if (invalid || salvando) return;
    const novo = draft.trim();

    // A conta de teste do demo é local por regra (§5.1) — não há Bearer nem rota.
    if (session.authMethod === 'demo') {
      update({ nickname: novo });
      setEditing(false);
      return;
    }

    // SERVIDOR primeiro, tela depois — a mesma ordem do onboarding, pelo mesmo
    // motivo: local antes do POST deixaria o apelido na tela mesmo com o 409
    // (apelido de outra pessoa) recusando.
    setSalvando(true);
    setErroNome(null);
    const { api, ApiError } = await import('@/lib/api');
    try {
      await api.setHandle(novo);
      update({ nickname: novo });
      setEditing(false);
    } catch (e) {
      // A mensagem do ApiError é a do domínio (pt-BR); erro de rede cru em
      // inglês não é coisa de se jogar na cara de ninguém.
      setErroNome(e instanceof ApiError ? e.message : t.nameSaveFailed);
    } finally {
      setSalvando(false);
    }
  };

  const onLogout = async () => {
    // await: `logout` também derruba a sessão da Privy, e navegar antes disso
    // faz o login reconhecer o fã ainda autenticado e devolvê-lo pro onboarding.
    await logout();
    router.replace('/');
  };

  const missionDone = Math.min(session.streak, 3);
  const missions = [
    { title: t.mission1, pct: (missionDone / 3) * 100, label: `${missionDone}/3` },
    { title: t.mission2, pct: 60, label: '3/5' },
    { title: t.mission3, pct: 0, label: '0/1' },
  ];

  return (
    <Screen padding="16px 18px 20px">
      {/* identidade */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 'var(--r-xl)',
            background: 'var(--lime)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: fw.black,
            fontStyle: 'italic',
            fontSize: 22,
            color: 'var(--on-lime)',
            transform: 'rotate(-4deg)',
            flex: 'none',
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                fontWeight: fw.black,
                fontSize: 20,
                fontStyle: 'italic',
                letterSpacing: -0.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {session.nickname}
            </div>
            <button
              onClick={openEdit}
              aria-label={t.editNameHdr}
              style={{
                all: 'unset',
                cursor: 'pointer',
                flex: 'none',
                width: 28,
                height: 28,
                borderRadius: 'var(--r-sm)',
                background: 'var(--surface-1)',
                border: '1px solid var(--border-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Pencil />
            </button>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 5,
              fontSize: 11.5,
              fontWeight: fw.bold,
              color: 'var(--text-muted)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                borderRadius: 'var(--r-pill)',
                background: 'var(--lime-a10)',
                color: 'var(--lime)',
              }}
            >
              <Layers />
              {authLabel}
            </span>
          </div>
        </div>
      </div>

      {mostrarDadosConta && (
        <section aria-labelledby="dados-da-conta" style={{ marginTop: 'var(--sp-5)' }}>
          <h2
            id="dados-da-conta"
            style={{
              margin: '0 0 var(--sp-3)',
              fontSize: 'var(--micro)',
              fontWeight: fw.black,
              letterSpacing: 'var(--tracking-label)',
              color: 'var(--text-faint)',
            }}
          >
            {t.profileDataTitle}
          </h2>
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-1)',
              borderRadius: 'var(--r-2xl)',
              overflow: 'hidden',
            }}
          >
            <AccountDataRow label={t.profileNameLabel} value={nomeDaConta} />
            <AccountDataRow label={t.profileEmailLabel} value={emailDaConta} divider />
            <AccountDataRow
              label={t.profileWalletLabel}
              value={enderecoCarteira ?? t.profileWalletUnavailable}
              wallet
              onCopy={enderecoCarteira ? copiarCarteira : undefined}
              copyLabel={carteiraCopiada ? t.profileWalletCopied : t.profileCopyWallet}
            />
          </div>
          <p
            style={{
              margin: 'var(--sp-3) 0 0',
              fontSize: 'var(--caption)',
              fontWeight: fw.medium,
              color: 'var(--text-muted)',
              lineHeight: 'var(--leading-body)',
            }}
          >
            {avisoCarteira}
          </p>
        </section>
      )}

      {/* editar apelido */}
      {editing && (
        <div
          style={{
            marginTop: 16,
            background: 'var(--surface-1)',
            border: '1.5px solid var(--lime-line)',
            borderRadius: 'var(--r-2xl)',
            padding: 16,
            animation: 'popIn .3s cubic-bezier(.2,.9,.3,1.2) both',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 1, color: 'var(--lime)' }}>
            {t.editNameHdr}
          </div>
          <NicknameInput
            value={draft}
            onChange={(v) => {
              setDraft(v);
              // Digitou outro apelido: a recusa anterior já não fala deste.
              setErroNome(null);
            }}
            invalid={invalid}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: fw.bold, color: 'var(--text-muted)' }}>
              {draft.trim().length}/{MAX_NICK}
            </span>
            <span style={{ fontSize: 11, fontWeight: fw.heavy, color: invalid ? 'var(--text-muted)' : 'var(--lime)' }}>
              {invalid ? t.nameHintShort : t.nameHintOk}
            </span>
          </div>
          {erroNome && (
            <p
              role="alert"
              style={{ marginTop: 10, fontSize: 12, fontWeight: fw.bold, color: 'var(--red)' }}
            >
              {erroNome}
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <Button variant="ghost" full onClick={() => setEditing(false)}>
                {t.cancel}
              </Button>
            </div>
            <div style={{ flex: 1 }}>
              <Button full disabled={invalid || salvando} onClick={() => void saveName()}>
                {t.save}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* números */}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <StatBox value={fmt(session.xp)} label={t.xpTotal} color="var(--gold)" />
        <StatBox value={`${t.lv} ${session.level}`} label={t.nivel} />
        <StatBox value={String(session.streak)} label={t.sequencia} color="var(--orange)" />
      </div>

      {/* aproveitamento — só para conta real, e só o que o BANCO contou. O demo
          não ganha esta fileira: inventar aproveitamento para a conta de teste
          seria número falso com cara de real (G6). */}
      {session.authMethod !== 'demo' && serverStats && serverStats.total > 0 && (
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <StatBox value={String(serverStats.acertos)} label={t.statAcertos} color="var(--lime)" />
          <StatBox value={String(serverStats.erros)} label={t.statErros} />
          <StatBox value={String(serverStats.anuladas)} label={t.statAnuladas} />
        </div>
      )}

      {/* premium */}
      {session.isPremium ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            width: '100%',
            marginTop: 16,
            padding: '16px 18px',
            background: 'var(--surface-1)',
            border: '1.5px solid var(--lime-line)',
            borderRadius: 'var(--r-2xl)',
          }}
        >
          <PremiumCrest />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: fw.heavy, fontSize: 15.5 }}>{t.pxBadge}</div>
            <div style={{ fontSize: 12.5, color: 'var(--lime)', fontWeight: fw.bold }}>{t.premiumActiveSub}</div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => router.push('/premium')}
          style={{
            all: 'unset',
            cursor: 'pointer',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            width: '100%',
            marginTop: 16,
            padding: '16px 18px',
            background: 'linear-gradient(135deg, var(--lime-a14), var(--surface-1))',
            border: '1.5px solid var(--lime-line)',
            borderRadius: 'var(--r-2xl)',
          }}
        >
          <PremiumCrest />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: fw.heavy, fontSize: 15.5 }}>{t.pxBadge}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: fw.medium }}>
              {t.premiumUpsellSub}
            </div>
          </div>
          <ChevronRight color="var(--lime)" />
        </button>
      )}

      {/* missões */}
      <SectionLabel>{t.missionsHdr}</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {missions.map((m) => (
          <div
            key={m.title}
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-1)',
              borderRadius: 'var(--r-2xl)',
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: fw.heavy, fontSize: 14 }}>{m.title}</span>
              <span style={{ fontSize: 11, fontWeight: fw.heavy, color: 'var(--text-2)' }}>{m.label}</span>
            </div>
            <div style={{ marginTop: 11 }}>
              <ProgressBar value={m.pct} />
            </div>
          </div>
        ))}
      </div>

      {/* ajustes */}
      <SectionLabel>{t.settingsHdr}</SectionLabel>
      <div
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-1)',
          borderRadius: 'var(--r-2xl)',
          overflow: 'hidden',
        }}
      >
        <SettingRow title={t.langTitle} sub={t.langSub} divider>
          <div
            style={{
              display: 'flex',
              gap: 4,
              background: 'var(--surface-sunken)',
              border: '1px solid var(--border-1)',
              borderRadius: 'var(--r-pill)',
              padding: 3,
            }}
          >
            {(['pt', 'en'] as Lang[]).map((l) => {
              const on = lang === l;
              return (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-pressed={on}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    minWidth: 30,
                    textAlign: 'center',
                    padding: '6px 11px',
                    borderRadius: 'var(--r-pill)',
                    fontWeight: fw.heavy,
                    fontSize: 12,
                    transition: 'background .15s, color .15s',
                    background: on ? 'var(--lime)' : 'transparent',
                    color: on ? 'var(--on-lime)' : 'var(--text-muted)',
                  }}
                >
                  {l.toUpperCase()}
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow title={t.notifTitle} sub={t.notifSub} divider>
          <Toggle checked={session.notif} onChange={(v) => update({ notif: v })} />
        </SettingRow>

        <SettingRow title={t.liveTitle} sub={t.liveSub}>
          <Toggle checked={session.live} onChange={(v) => update({ live: v })} />
        </SettingRow>
      </div>

      <div style={{ marginTop: 14 }}>
        <ListRow title={t.howTitle} subtitle={t.howSub} trailing={<ChevronRight />} />
      </div>

      <button
        onClick={onLogout}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          marginTop: 16,
          height: 48,
          borderRadius: 'var(--r-xl)',
          border: '1px solid var(--border-2)',
          color: 'var(--red)',
          fontWeight: fw.heavy,
          fontSize: 14.5,
        }}
      >
        {t.signout}
      </button>
    </Screen>
  );
}

function AccountDataRow({
  label,
  value,
  divider = false,
  wallet = false,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  divider?: boolean;
  wallet?: boolean;
  onCopy?: () => void;
  copyLabel?: string;
}) {
  return (
    <div
      style={{
        padding: 'var(--sp-4)',
        ...(divider ? { borderBottom: '1px solid var(--border-1)' } : {}),
      }}
    >
      <div
        style={{
          fontSize: 'var(--micro)',
          fontWeight: fw.black,
          letterSpacing: 'var(--tracking-label)',
          color: 'var(--text-faint)',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflowWrap: 'anywhere',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--caption)',
            fontWeight: fw.bold,
            color: wallet ? 'var(--lime)' : 'var(--text-1)',
          }}
        >
          {value}
        </span>
        {onCopy && copyLabel && (
          <button
            type="button"
            onClick={() => void onCopy()}
            aria-label={copyLabel}
            title={copyLabel}
            style={{
              all: 'unset',
              cursor: 'pointer',
              flex: 'none',
              width: 'var(--tap-min)',
              height: 'var(--tap-min)',
              borderRadius: 'var(--r-md)',
              background: 'var(--lime-a06)',
              border: '1px solid var(--lime-line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Copy />
          </button>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: fw.black,
        letterSpacing: 1,
        color: 'var(--text-faint)',
        margin: '22px 0 10px',
      }}
    >
      {children}
    </div>
  );
}

function StatBox({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: 'var(--surface-1)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-2xl)',
        padding: 14,
        textAlign: 'center',
      }}
    >
      <div style={{ fontWeight: fw.black, fontSize: 22, color: color ?? 'var(--text-hi)' }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: fw.bold, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function SettingRow({
  title,
  sub,
  divider = false,
  children,
}: {
  title: string;
  sub: string;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 16px',
        ...(divider ? { borderBottom: '1px solid var(--border-1)' } : {}),
      }}
    >
      <div>
        <div style={{ fontWeight: fw.bold, fontSize: 14.5 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: fw.medium }}>{sub}</div>
      </div>
      {children}
    </div>
  );
}

function PremiumCrest() {
  return (
    <div
      style={{
        flex: 'none',
        width: 44,
        height: 44,
        borderRadius: 'var(--r-lg)',
        background: 'var(--lime)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Crown size={22} />
    </div>
  );
}
