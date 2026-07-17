'use client';

/**
 * RESULTADO DO DESAFIO — tela cheia, com a LEITURA DO JOGO.
 *
 * A leitura é o coração do produto: o lance transforma uma pergunta em história
 * de futebol. Quando há série de preços, ela pode mostrar a mudança de chance;
 * no replay demo os números são explicitamente simulados.
 *
 * Voz: "atualizada ao vivo", nunca "odds". Nunca jargão de aposta.
 *
 * As duas barras (antes/agora) vêm do explicador, que na v1 lê a SÉRIE de
 * /odds/updates. Construir isso sobre /odds/snapshot deixa a feature sem dados e
 * SEM ERRO NENHUM (achado G2 do v0) — o snapshot devolve uma linha só.
 */

import type { ChallengeText } from '@/lib/i18n';
import type { ChallengeSpec } from '@/lib/mock';
import { useI18n, ordinal, fill } from '@/lib/i18n';
import { fw } from '@/lib/tokens';
import { Button, Chip, Badge } from '@/components/ds';
import { Screen } from '@/components/Shell';
import { Star, Check, Close, Triangle } from '@/components/Icons';

export interface LastResult {
  correct: boolean;
  timeout: boolean;
  gained: number;
  correctId: string;
  final: boolean;
}

interface Props {
  spec: ChallengeSpec;
  text: ChallengeText;
  result: LastResult;
  level: number;
  xp: number;
  /** Posição do fã no ranking da sala, pra fechar com a provocação. */
  myPos: number;
  onNext: () => void;
  onSeeProgress: () => void;
}

export function ChallengeResult({ spec, text, result, level, xp, myPos, onNext, onSeeProgress }: Props) {
  const { t, fmt, lang } = useI18n();

  const win = result.correct;
  const color = win ? 'var(--lime)' : 'var(--red)';
  // O lime tem tokens de tinta (--lime-a14/--lime-line); o --red não tem
  // equivalente. Daí o color-mix: a cor continua saindo do TOKEN, então retunar
  // --red retuna estas também. Escrever rgba(255,90,90,…) na mão congelaria uma
  // cópia do token que ninguém lembra de atualizar.
  const bg = win ? 'var(--lime-a14)' : 'color-mix(in srgb, var(--red) 10%, transparent)';
  const border = win ? 'var(--lime-line)' : 'color-mix(in srgb, var(--red) 40%, transparent)';

  const title = win ? t.resWin : result.timeout ? t.resTimeout : t.resMiss;
  const narrative = win ? text.subWin : result.timeout ? text.subTimeout : text.subMiss;
  const probabilityReading =
    spec.before !== null && spec.after !== null ? { before: spec.before, after: spec.after } : null;

  const pos = ordinal(myPos, lang);
  const rankNote = fill(win ? t.rankNoteUp : t.rankNoteSame, { pos });

  return (
    <Screen style={{ display: 'flex', flexDirection: 'column', padding: '8px 24px 26px' }}>
      <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', padding: '4px 0 6px' }}>
        <Chip>
          <Badge tone="solid">
            {t.lv} {level}
          </Badge>
          <span style={{ fontWeight: fw.heavy }}>{fmt(xp)} XP</span>
        </Chip>
      </div>

      <div style={{ textAlign: 'center', marginTop: 8, animation: 'popIn .45s cubic-bezier(.2,.9,.3,1.2) both' }}>
        <div
          style={{
            width: 128,
            height: 128,
            borderRadius: '50%',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: bg,
            border: `2.5px solid ${border}`,
          }}
        >
          {win ? (
            <Check size={60} width={2.6} />
          ) : result.timeout ? (
            // Tempo esgotado não é "errou": é o relógio. O 0s diz isso melhor que um X.
            <span style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 44, color: 'var(--red)', letterSpacing: -2 }}>
              0s
            </span>
          ) : (
            <Close size={54} width={2.8} />
          )}
        </div>

        <div
          style={{
            fontWeight: fw.black,
            fontStyle: 'italic',
            fontSize: 38,
            letterSpacing: -1.5,
            textTransform: 'uppercase',
            marginTop: 20,
            lineHeight: 'var(--leading-tight)',
            color,
          }}
        >
          {title}
        </div>

        <p
          style={{
            fontSize: 15,
            lineHeight: 'var(--leading-body)',
            fontWeight: fw.medium,
            color: 'var(--text-2)',
            margin: '14px auto 0',
            maxWidth: 300,
            textWrap: 'pretty',
          }}
        >
          {narrative}
        </p>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            marginTop: 16,
            padding: '7px 15px',
            borderRadius: 'var(--r-pill)',
            background: bg,
            border: `1px solid ${border}`,
          }}
        >
          <Star size={14} color={color} />
          <span style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 15, color }}>
            +{result.gained} XP
          </span>
        </div>
      </div>

      {/* LEITURA DO JOGO */}
      <div
        style={{
          marginTop: 26,
          background: 'var(--surface-1)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-3xl)',
          padding: 18,
        }}
      >
        <div style={{ fontWeight: fw.black, fontSize: 10.5, letterSpacing: 1, color: 'var(--lime)' }}>
          {t.resReadingHdr}
        </div>
        <div style={{ fontWeight: fw.bold, fontSize: 15.5, lineHeight: 1.4, marginTop: 8, textWrap: 'pretty' }}>
          {text.reading}
        </div>

        {probabilityReading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 16 }}>
            <ProbBar label={t.resBefore} pct={probabilityReading.before} tone="var(--text-faint)" valueColor="var(--text-2)" />
            <ProbBar label={t.resAfter} pct={probabilityReading.after} tone="var(--lime)" valueColor="var(--lime)" animate />
          </div>
        )}

        <div style={{ fontSize: 11.5, fontWeight: fw.medium, color: 'var(--text-faint)', marginTop: probabilityReading ? 14 : 12 }}>
          {text.probLabel}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 11,
          marginTop: 12,
          padding: '14px 16px',
          borderRadius: 'var(--r-2xl)',
          background: 'var(--lime-a06)',
          border: '1px solid var(--lime-line)',
        }}
      >
        <Triangle />
        <span style={{ fontSize: 13, fontWeight: fw.bold, color: 'var(--text-1)', lineHeight: 1.4, textWrap: 'pretty' }}>
          {rankNote}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 16 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
        <Button size="lg" full onClick={onNext}>
          {result.final ? t.resBackToFinal : t.resBackToGame}
        </Button>
        <Button variant="ghost" full onClick={onSeeProgress}>
          {t.resSeeProgress}
        </Button>
      </div>
    </Screen>
  );
}

/** Uma barra de probabilidade da leitura do jogo (antes / agora). */
function ProbBar({
  label,
  pct,
  tone,
  valueColor,
  animate = false,
}: {
  label: string;
  pct: number;
  tone: string;
  valueColor: string;
  animate?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 11.5, fontWeight: fw.bold, color: 'var(--text-muted)', minWidth: 44 }}>{label}</span>
      <div
        style={{
          flex: 1,
          height: 9,
          borderRadius: 'var(--r-pill)',
          background: 'var(--surface-sunken)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 'var(--r-pill)',
            background: tone,
            width: `${pct}%`,
            ...(animate ? { transition: 'width .6s cubic-bezier(.2,.8,.3,1)' } : {}),
          }}
        />
      </div>
      <span style={{ fontSize: 13, fontWeight: fw.black, color: valueColor, minWidth: 38, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  );
}
