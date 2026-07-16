'use client';

/**
 * PREMIUM · PRONTO — a confirmação, e o convite pra usar o que acabou de liberar.
 *
 * O CTA cria a liga na hora e volta pra home: quem assinou por causa da liga não
 * deve ter que procurar onde criar.
 */

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { Crown } from '@/components/Icons';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useRequireSession } from '@/lib/guard';
import { fw } from '@/lib/tokens';

export default function PremiumProntoPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { session, update } = useSession();
  const ready = useRequireSession();

  if (!ready || !session) return null;

  const createLeague = () => {
    update({ leaguesCount: session.leaguesCount + 1 });
    router.push('/home');
  };

  return (
    <>
      <Screen
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          padding: '24px 24px 26px',
        }}
      >
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: '50%',
            background: 'var(--lime-a14)',
            border: '1.5px solid var(--lime-line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'popIn .5s cubic-bezier(.2,.9,.3,1.2) both',
          }}
        >
          <Crown size={46} color="var(--lime)" />
        </div>

        <div
          style={{
            fontWeight: fw.black,
            fontStyle: 'italic',
            fontSize: 28,
            letterSpacing: -0.8,
            marginTop: 22,
            textWrap: 'pretty',
          }}
        >
          {t.ckDoneTitle}
        </div>
        <p
          style={{
            fontSize: 15,
            lineHeight: 'var(--leading-body)',
            fontWeight: fw.medium,
            color: 'var(--text-2)',
            marginTop: 12,
            maxWidth: 290,
            textWrap: 'pretty',
          }}
        >
          {t.ckDoneBody}
        </p>
      </Screen>

      <div style={{ flex: 'none', padding: '0 24px 26px' }}>
        <Button size="lg" full onClick={createLeague}>
          {t.ckDoneCta}
        </Button>
      </div>
    </>
  );
}
