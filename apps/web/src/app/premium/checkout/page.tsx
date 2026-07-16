'use client';

/**
 * PREMIUM · CHECKOUT — resumo do plano e forma de pagamento.
 *
 * MAQUETE. Nenhum gateway está plugado e NADA cobra ninguém: o botão só marca
 * `isPremium` na sessão local e segue pra tela de pronto. Quando um gateway de
 * verdade entrar, ele NÃO entra aqui no cliente — o cliente pede a intenção ao
 * servidor e o servidor fala com o gateway.
 *
 * A opção "Carteira Solana · USDC" mostra o caminho pra v2 (Presságio), onde o
 * valor é real. Na v1 ela é maquete como as outras — não misture dinheiro aqui.
 */

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { ChevronLeft, Lock, CardIcon, PixIcon, WalletIcon } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { useSession, type PayMethodId } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';

export default function CheckoutPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { session, update } = useSession();
  const ready = useRequireSession();

  if (!ready || !session) return null;

  const annual = session.selectedPlan === 'anual';
  const planName = annual ? t.plAnnual : t.plMonthly;
  const planPrice = annual ? t.plAnnualPrice : t.plMonthlyPrice;
  // O anual começa com 7 dias grátis, então hoje não cobra nada.
  const todayCharge = annual ? t.todayFree : t.plMonthlyPrice;

  const methods: { id: PayMethodId; title: string; sub: string; icon: React.ReactNode }[] = [
    { id: 'card', title: t.ckCard, sub: t.ckCardSub, icon: <CardIcon /> },
    { id: 'pix', title: t.ckPix, sub: t.ckPixSub, icon: <PixIcon /> },
    { id: 'wallet', title: t.ckWallet, sub: t.ckWalletSub, icon: <WalletIcon /> },
  ];

  const confirm = () => {
    // TODO: pedir a intenção de cobrança ao servidor. Gateway NUNCA no cliente.
    update({ isPremium: true });
    router.push('/premium/pronto');
  };

  return (
    <Screen style={{ display: 'flex', flexDirection: 'column', padding: '8px 22px 26px' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0 16px' }}>
        <button
          onClick={() => router.push('/premium/planos')}
          aria-label={t.cancel}
          style={{
            all: 'unset',
            cursor: 'pointer',
            width: 34,
            height: 34,
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-1)',
            border: '1px solid var(--border-1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronLeft />
        </button>
        <span style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 20, letterSpacing: -0.5 }}>
          {t.ckTitle}
        </span>
      </div>

      {/* resumo */}
      <div
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-2xl)',
          padding: '16px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: fw.heavy, letterSpacing: 0.5, color: 'var(--text-muted)' }}>
              {t.ckPlan}
            </div>
            <div style={{ fontWeight: fw.heavy, fontSize: 16, marginTop: 3 }}>
              {planName} · {t.pxPremium}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 22 }}>{planPrice}</div>
            <div style={{ fontSize: 11, fontWeight: fw.bold, color: 'var(--text-muted)' }}>{t.plPerMonth}</div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid var(--border-1)',
            marginTop: 14,
            paddingTop: 14,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: fw.bold, color: 'var(--text-2)' }}>{t.ckToday}</span>
          <span style={{ fontWeight: fw.black, fontSize: 16, color: 'var(--lime)' }}>{todayCharge}</span>
        </div>
        {annual && (
          <div style={{ fontSize: 11.5, fontWeight: fw.medium, color: 'var(--text-muted)', marginTop: 6 }}>
            {t.ckTrialLine}
          </div>
        )}
      </div>

      {/* forma de pagamento */}
      <div style={{ fontSize: 10, fontWeight: fw.black, letterSpacing: 1, color: 'var(--text-faint)', margin: '22px 0 10px' }}>
        {t.ckPayHdr}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {methods.map((m) => {
          const on = session.payMethod === m.id;
          return (
            <button
              key={m.id}
              onClick={() => update({ payMethod: m.id })}
              aria-pressed={on}
              style={{
                all: 'unset',
                boxSizing: 'border-box',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 13,
                width: '100%',
                padding: '14px 16px',
                borderRadius: 'var(--r-xl)',
                background: on ? 'var(--lime-a10)' : 'var(--surface-1)',
                border: `1.5px solid ${on ? 'var(--lime)' : 'var(--border-1)'}`,
              }}
            >
              <span
                style={{
                  flex: 'none',
                  width: 38,
                  height: 38,
                  borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {m.icon}
              </span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span style={{ display: 'block', fontWeight: fw.heavy, fontSize: 14.5 }}>{m.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', fontWeight: fw.medium }}>
                  {m.sub}
                </span>
              </span>
              <span
                style={{
                  flex: 'none',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `2px solid ${on ? 'var(--lime)' : 'var(--border-2)'}`,
                }}
              >
                {on && <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--lime)' }} />}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 18 }} />
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          paddingTop: 14,
          background: 'linear-gradient(180deg, transparent, var(--bg-app) 32%)',
        }}
      >
        <Button size="lg" full onClick={confirm}>
          {t.ckPay} · {todayCharge}
        </Button>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 11,
            fontWeight: fw.medium,
            color: 'var(--text-muted)',
            marginTop: 10,
          }}
        >
          <Lock />
          {t.ckFoot}
        </div>
      </div>
    </Screen>
  );
}
