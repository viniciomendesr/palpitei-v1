// Pre-match prediction state. Demo is local-only; authenticated users use the API.
// Scoring weights come from `@palpitei/core` to match server-side settlement.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PREGAME_XP } from '@palpitei/core';
import { useSession } from './session';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import { useI18n } from './i18n';
import { api, ApiError, type PregameMarket, type PregamePick } from './api';
import { fixtures } from './mock';
import { formatKickoff } from './kickoff';
import { timeVisual } from './teamVisual';

export type Resultado = 'home' | 'draw' | 'away' | null;
export type AcimaAbaixo = 'over' | 'under' | null;

export interface Mercados {
  result: Resultado;
  scoreA: number;
  scoreB: number;
  scoreTouched: boolean;
  goals: AcimaAbaixo;
  goalsLine: number | null;
  corners: AcimaAbaixo;
  cornersLine: number | null;
}

export interface PregameVM {
  teamA: string;
  teamB: string;
  codeA: string;
  codeB: string;
  colA: string;
  colB: string;
  group: string;
  kickoffText: string;
  /** null when the pick window has already closed. */
  closesText: string | null;
  /** Friends who have picked, available only in demo mode. */
  friends: number | null;
  /** Markets offered by TxLINE that the product can settle. */
  markets: PregameMarket[];
  /** `false` means the source could not be read, not a 0% probability. */
  txlineOddsAvailable: boolean;
  locked: boolean;
  finished: boolean;
  submitted: boolean;
  final: { goalsA: number; goalsB: number; cornersTotal: number } | null;
  correctness: { result: boolean | null; score: boolean | null; goals: boolean | null; corners: boolean | null } | null;
  awardedXp: number | null;
}

export interface Toast {
  title: string;
  sub: string;
}

const VAZIO: Mercados = {
  result: null,
  scoreA: 0,
  scoreB: 0,
  scoreTouched: false,
  goals: null,
  goalsLine: null,
  corners: null,
  cornersLine: null,
};

const SEM_MERCADOS: PregameMarket[] = [];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Formats remaining time to kickoff, or null after kickoff. */
function textoDoFechamento(startTs: number, agora: number, lang: 'pt' | 'en'): string | null {
  const ms = startTs - agora;
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const minW = lang === 'en' ? 'min' : 'min';
  if (h <= 0) return `${m}${minW}`;
  return `${h}h ${pad(m)}${minW}`;
}

function mercadosDePick(p: PregamePick): Mercados {
  return {
    result: p.result,
    scoreA: p.scoreA,
    scoreB: p.scoreB,
    scoreTouched: p.scoreSet,
    goals: p.goals,
    goalsLine: p.goalsLine,
    corners: p.corners,
    cornersLine: p.cornersLine,
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(15, n));
}

export interface UsePalpitePreJogo {
  loading: boolean;
  error: string | null;
  vm: PregameVM | null;
  m: Mercados;
  filled: number;
  xpInPlay: number;
  availableMarkets: number;
  saving: boolean;
  toast: Toast | null;
  setResult: (r: Exclude<Resultado, null>) => void;
  setGoals: (v: Exclude<AcimaAbaixo, null>) => void;
  setCorners: (v: Exclude<AcimaAbaixo, null>) => void;
  step: (side: 'a' | 'b', delta: number) => void;
  confirmar: () => void;
  desafiarLiga: () => void;
  dismissToast: () => void;
}

export function usePalpitePreJogo(fixtureId: string): UsePalpitePreJogo {
  const { t, lang, fmt } = useI18n();
  const { session, hydrated } = useSession();
  const privy = usePrivyAuth();

  // Wait for hydration so an authenticated user is not briefly treated as demo.
  const ehDemo = !session || session.authMethod === 'demo';
  const podeBuscar = hydrated && !ehDemo && privy.ready && privy.authenticated;

  const [m, setM] = useState<Mercados>(VAZIO);
  const [vm, setVm] = useState<PregameVM | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const demoKey = `pregame:demo:${fixtureId}`;

  // Local, network-free demo loading.
  useEffect(() => {
    if (!hydrated || !ehDemo) return;
    const fx = fixtures(t).next.find((f) => f.id === fixtureId);
    if (!fx) {
      setError(t.pmError);
      setLoading(false);
      return;
    }
    const va = timeVisual(fx.teamA);
    const vb = timeVisual(fx.teamB);
    const agora = Date.now();
    const startTs = fx.startTs;
    const locked = startTs != null && startTs <= agora;
    let salvo: Mercados | null = null;
    let jaEnviou = false;
    try {
      const raw = sessionStorage.getItem(demoKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Mercados & { submitted?: boolean };
        salvo = {
          result: parsed.result,
          scoreA: parsed.scoreA,
          scoreB: parsed.scoreB,
          scoreTouched: parsed.scoreTouched,
          // Legacy demo totals are not restored as if TxLINE still offered them.
          goals: null,
          goalsLine: null,
          corners: null,
          cornersLine: null,
        };
        jaEnviou = parsed.submitted === true;
      }
    } catch {
      /* Storage unavailable: start from a clean local state. */
    }
    if (salvo) setM(salvo);
    setSubmitted(jaEnviou);
    setVm({
      teamA: fx.teamA,
      teamB: fx.teamB,
      codeA: va.code,
      codeB: vb.code,
      colA: va.color,
      colB: vb.color,
      group: fx.group,
      kickoffText: startTs != null ? formatKickoff(startTs, agora, lang) : fx.status,
      closesText: locked || startTs == null ? null : textoDoFechamento(startTs, agora, lang),
      // Demo mode does not fabricate friends' predictions.
      friends: null,
      markets: SEM_MERCADOS,
      txlineOddsAvailable: false,
      locked,
      finished: false,
      submitted: jaEnviou,
      final: null,
      correctness: null,
      awardedXp: null,
    });
    setLoading(false);
    // `fixtureId` changes the data; language only reformats labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, ehDemo, fixtureId, lang]);

  // Authenticated API loading.
  useEffect(() => {
    if (ehDemo || !podeBuscar) return;
    const id = Number(fixtureId);
    if (!Number.isInteger(id) || id <= 0) {
      setError(t.pmError);
      setLoading(false);
      return;
    }
    let vivo = true;
    setLoading(true);
    api.pregame
      .get(id)
      .then((r) => {
        if (!vivo) return;
        const va = timeVisual(r.match.teamA);
        const vb = timeVisual(r.match.teamB);
        const agora = Date.now();
        const startTs = r.match.startTs;
        if (r.pick) setM(mercadosDePick(r.pick));
        setSubmitted(!!r.pick?.submittedAt);
        setVm({
          teamA: r.match.teamA,
          teamB: r.match.teamB,
          codeA: va.code,
          codeB: vb.code,
          colA: va.color,
          colB: vb.color,
          group: r.match.competition ?? '',
          kickoffText: startTs != null ? formatKickoff(startTs, agora, lang) : '',
          closesText: r.locked || startTs == null ? null : textoDoFechamento(startTs, agora, lang),
          friends: null, // Do not fabricate social data until a real source exists.
          markets: r.markets,
          txlineOddsAvailable: r.txlineOddsAvailable,
          locked: r.locked,
          finished: r.finished,
          submitted: !!r.pick?.submittedAt,
          final: r.final,
          correctness: r.pick?.settledAt
            ? {
                result: r.pick.resultCorrect,
                score: r.pick.scoreCorrect,
                goals: r.pick.goalsCorrect,
                corners: r.pick.cornersCorrect,
              }
            : null,
          awardedXp: r.pick?.settledAt ? r.pick.awardedXp : null,
        });
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (!vivo) return;
        setError(e instanceof ApiError ? e.message : t.pmError);
        setLoading(false);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ehDemo, podeBuscar, fixtureId, lang]);

  // This screen owns its toast lifecycle because there is no global toast host.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const filled = useMemo(
    () => (m.result ? 1 : 0) + (m.scoreTouched ? 1 : 0) + (m.goals ? 1 : 0) + (m.corners ? 1 : 0),
    [m],
  );
  const xpInPlay = useMemo(
    () =>
      (m.result ? PREGAME_XP.result : 0) +
      (m.scoreTouched ? PREGAME_XP.score : 0) +
      (m.goals ? PREGAME_XP.goals : 0) +
      (m.corners ? PREGAME_XP.corners : 0),
    [m],
  );

  const travado = vm?.locked ?? false;

  const setResult = useCallback((r: Exclude<Resultado, null>) => {
    if (!travado && vm?.markets.some((market) => market.id === 'result')) setM((s) => ({ ...s, result: r }));
  }, [travado, vm?.markets]);
  const setGoals = useCallback((v: Exclude<AcimaAbaixo, null>) => {
    const market = vm?.markets.find((candidate) => candidate.id === 'goals');
    const line = market?.kind === 'over_under' ? market.line : null;
    if (!travado && line != null) setM((s) => ({ ...s, goals: v, goalsLine: line }));
  }, [travado, vm?.markets]);
  const setCorners = useCallback((v: Exclude<AcimaAbaixo, null>) => {
    const market = vm?.markets.find((candidate) => candidate.id === 'corners');
    const line = market?.kind === 'over_under' ? market.line : null;
    if (!travado && line != null) setM((s) => ({ ...s, corners: v, cornersLine: line }));
  }, [travado, vm?.markets]);
  const step = useCallback(
    (side: 'a' | 'b', delta: number) => {
      if (travado) return;
      setM((s) => (side === 'a'
        ? { ...s, scoreA: clamp(s.scoreA + delta), scoreTouched: true }
        : { ...s, scoreB: clamp(s.scoreB + delta), scoreTouched: true }));
    },
    [travado],
  );

  const dismissToast = useCallback(() => setToast(null), []);

  const marcarEnviado = useCallback(() => {
    setSubmitted(true);
    setVm((v) => (v ? { ...v, submitted: true } : v));
    setToast({ title: t.pmToast, sub: `+${fmt(xpInPlay)} XP ${t.pmToastSub}` });
  }, [t, fmt, xpInPlay]);

  const confirmar = useCallback(() => {
    if (filled < 1 || travado || saving) return;
    if (ehDemo) {
      try {
        sessionStorage.setItem(demoKey, JSON.stringify({ ...m, submitted: true }));
      } catch {
        /* Storage unavailable: the pick is not persisted, but the flow continues. */
      }
      marcarEnviado();
      return;
    }
    const id = Number(fixtureId);
    setSaving(true);
    api.pregame
      .save(id, {
        result: m.result,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        scoreSet: m.scoreTouched,
        goals: m.goals,
        goalsLine: m.goalsLine,
        corners: m.corners,
        cornersLine: m.cornersLine,
      })
      .then(() => {
        marcarEnviado();
      })
      .catch((e) => {
        setToast({ title: t.pmError, sub: e instanceof ApiError ? e.message : '' });
      })
      .finally(() => setSaving(false));
  }, [filled, travado, saving, ehDemo, demoKey, m, marcarEnviado, fixtureId, t]);

  const desafiarLiga = useCallback(() => {
    setToast({ title: t.pmChallengeToast, sub: t.pmChallengeToastSub });
  }, [t]);

  return {
    loading,
    error,
    vm: vm ? { ...vm, submitted } : null,
    m,
    filled,
    xpInPlay,
    availableMarkets: 1 + (vm?.markets.length ?? 0),
    saving,
    toast,
    setResult,
    setGoals,
    setCorners,
    step,
    confirmar,
    desafiarLiga,
    dismissToast,
  };
}
