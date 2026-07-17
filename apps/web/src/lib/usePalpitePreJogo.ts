// O cérebro da tela de palpite pré-jogo.
//
// Dois caminhos, o mesmo desenho do useFixtures:
//   demo   → tudo local (fixtures do mock, palpite no sessionStorage). Sem rede:
//            é o caminho do jurado e ele não pode depender de nada (§5.1).
//   logado → GET/POST /api/pregame/:id, com a guarda da corrida do Bearer
//            (privy.ready && authenticated antes de buscar). Falha → ERRO na
//            tela, nunca mock (G6).
//
// A regra de pontuação e os pesos vêm do @palpitei/core (PREGAME_XP) — a mesma
// fonte que o servidor usa para liquidar. Copiar a tabela seria o bug nº 1.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PREGAME_XP } from '@palpitei/core';
import { useSession } from './session';
import { usePrivyAuth } from '@/components/privy/PrivyIsland';
import { useI18n } from './i18n';
import { api, ApiError, type PregamePick } from './api';
import { fixtures } from './mock';
import { timeVisual } from './teamVisual';

export type Resultado = 'home' | 'draw' | 'away' | null;
export type AcimaAbaixo = 'over' | 'under' | null;

export interface Mercados {
  result: Resultado;
  scoreA: number;
  scoreB: number;
  scoreTouched: boolean;
  goals: AcimaAbaixo;
  corners: AcimaAbaixo;
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
  /** null = já travou (o apito passou). */
  closesText: string | null;
  /** Amigos que já palpitaram — só no demo; null no logado (não inventa dado). */
  friends: number | null;
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

const VAZIO: Mercados = { result: null, scoreA: 0, scoreB: 0, scoreTouched: false, goals: null, corners: null };

/** Extras sociais/tempo do demo, por id — batem com o mockup. */
const DEMO_EXTRAS: Record<string, { friends: number; closesPt: string; closesEn: string }> = {
  'bra-mar': { friends: 12, closesPt: '3h 20min', closesEn: '3h 20min' },
  'fra-cro': { friends: 7, closesPt: '6h 20min', closesEn: '6h 20min' },
  'ing-eua': { friends: 4, closesPt: 'amanhã, às 16:00', closesEn: 'tomorrow, 16:00' },
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "Hoje, 18:00" / "Amanhã, 21:00" / "24/07, 16:00" — o horário do apito. */
function textoDoApito(startTs: number, agora: number, lang: 'pt' | 'en'): string {
  const d = new Date(startTs);
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dia = new Date(startTs).setHours(0, 0, 0, 0);
  const hoje = new Date(agora).setHours(0, 0, 0, 0);
  const diff = Math.round((dia - hoje) / 86_400_000);
  const hojeW = lang === 'en' ? 'Today' : 'Hoje';
  const amanhaW = lang === 'en' ? 'Tomorrow' : 'Amanhã';
  if (diff <= 0) return `${hojeW}, ${hhmm}`;
  if (diff === 1) return `${amanhaW}, ${hhmm}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}, ${hhmm}`;
}

/** "3h 20min" / "45min" — quanto falta pro apito; null se já passou. */
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
    corners: p.corners,
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

  // A sessão revive num efeito do provider — nos primeiros renders ela é null.
  // Esperar a hidratação evita tratar um fã logado, que recarregou uma fixture
  // numérica, como demo e exibir um erro espúrio antes de a Privy ficar pronta.
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

  // ---- carga do demo (local, sem rede) ----------------------------------
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
    const extra = DEMO_EXTRAS[fixtureId];
    let salvo: Mercados | null = null;
    let jaEnviou = false;
    try {
      const raw = sessionStorage.getItem(demoKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Mercados & { submitted?: boolean };
        salvo = { result: parsed.result, scoreA: parsed.scoreA, scoreB: parsed.scoreB, scoreTouched: parsed.scoreTouched, goals: parsed.goals, corners: parsed.corners };
        jaEnviou = parsed.submitted === true;
      }
    } catch {
      /* sessionStorage indisponível: começa do zero, sem quebrar */
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
      kickoffText: fx.status,
      closesText: extra ? (lang === 'en' ? extra.closesEn : extra.closesPt) : null,
      friends: extra?.friends ?? 0,
      locked: false,
      finished: false,
      submitted: jaEnviou,
      final: null,
      correctness: null,
      awardedXp: null,
    });
    setLoading(false);
    // fixtureId muda a tela inteira; lang/t só reformatam rótulos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, ehDemo, fixtureId, lang]);

  // ---- carga do fã logado (API) -----------------------------------------
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
          kickoffText: startTs != null ? textoDoApito(startTs, agora, lang) : '',
          closesText: r.locked || startTs == null ? null : textoDoFechamento(startTs, agora, lang),
          friends: null, // logado: sem dado real de amigos ainda — não inventa
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

  // O toast some sozinho — a tela não tem toast global que faça isso por ela.
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

  const setResult = useCallback((r: Exclude<Resultado, null>) => { if (!travado) setM((s) => ({ ...s, result: r })); }, [travado]);
  const setGoals = useCallback((v: Exclude<AcimaAbaixo, null>) => { if (!travado) setM((s) => ({ ...s, goals: v })); }, [travado]);
  const setCorners = useCallback((v: Exclude<AcimaAbaixo, null>) => { if (!travado) setM((s) => ({ ...s, corners: v })); }, [travado]);
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
        /* sessionStorage indisponível: o palpite não persiste entre reloads, mas o fluxo segue */
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
        corners: m.corners,
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
