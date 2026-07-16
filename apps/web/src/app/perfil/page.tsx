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
 * e-mail. Quando o backend entrar, salvar chama POST /api/account/handle.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toggle, ProgressBar, ListRow, Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronRight, Pencil, Crown, Layers } from '@/components/Icons';
import { NicknameInput, isNicknameValid, MAX_NICK } from '@/components/NicknameInput';
import { useI18n, type Lang } from '@/lib/i18n';
import { useSession, initialsOf } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';

export default function PerfilPage() {
  const router = useRouter();
  const { t, fmt, lang, setLang } = useI18n();
  const { session, update, logout } = useSession();
  const ready = useRequireSession();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!ready || !session) return null;

  const invalid = !isNicknameValid(draft);
  const initials = initialsOf(session.nickname, session.accountType);

  const authLabel =
    session.authMethod === 'google'
      ? t.authGoogle
      : session.authMethod === 'wallet'
        ? '7xKq…9fPz · Solana'
        : t.walletDemo;

  const openEdit = () => {
    setDraft(session.nickname);
    setEditing(true);
  };

  const saveName = () => {
    // TODO: POST /api/account/handle — e só fechar o painel quando o servidor confirmar.
    if (invalid) return;
    update({ nickname: draft.trim() });
    setEditing(false);
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
          <NicknameInput value={draft} onChange={setDraft} invalid={invalid} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: fw.bold, color: 'var(--text-muted)' }}>
              {draft.trim().length}/{MAX_NICK}
            </span>
            <span style={{ fontSize: 11, fontWeight: fw.heavy, color: invalid ? 'var(--text-muted)' : 'var(--lime)' }}>
              {invalid ? t.nameHintShort : t.nameHintOk}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <Button variant="ghost" full onClick={() => setEditing(false)}>
                {t.cancel}
              </Button>
            </div>
            <div style={{ flex: 1 }}>
              <Button full disabled={invalid} onClick={saveName}>
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
