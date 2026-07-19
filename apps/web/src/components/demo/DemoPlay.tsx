'use client';

/**
 * What the demo account played, in THIS session.
 *
 * The demo fan really does place those palpites, so showing them back is not
 * invented data — it is the same truth the demo already tells elsewhere, like
 * the simulated collection and the "Nenhuma. Demonstração local" transaction
 * line. What rule 4 forbids is a record that never happened, or demo data
 * dressed as real; neither applies to replaying the fan their own answers.
 *
 * Two constraints shape the whole design:
 *
 *  · RULE 3 — the judge's path must not touch the network. Nothing here fetches
 *    and nothing here reaches Postgres. It is a plain in-memory Map, mounted
 *    above the routes so it survives client-side navigation sala → home →
 *    summary. A hard reload clears it, and the button goes back to disabled,
 *    which is the same volatility the rest of the demo already has.
 *  · NOTHING LOCALIZED IS STORED. Only the challenge index and the option the
 *    fan chose. The summary rebuilds prompts and labels from the dictionary at
 *    render time, so switching language does not leave a frozen pt-BR record
 *    inside an English screen.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/** One answered challenge. `choice: null` is a timeout, which is not a hit. */
export type DemoAnswer = {
  /** Index into `CHALLENGES` / `t.ch`; the text is resolved when rendering. */
  index: number;
  choice: string | null;
  gained: number;
};

/** One demo run, keyed by the room id the fan played. */
export type DemoRun = {
  answers: DemoAnswer[];
  scoreA: number;
  scoreB: number;
};

interface DemoPlayValue {
  /** Replaces the run for a room; the demo replay is always played from the top. */
  recordRun: (roomId: string, run: DemoRun) => void;
  runOf: (roomId: string) => DemoRun | null;
  /** Room ids with a run in this session, so Home can enable the action. */
  playedRooms: ReadonlySet<string>;
}

const DemoPlayContext = createContext<DemoPlayValue | null>(null);

export function DemoPlayProvider({ children }: { children: ReactNode }) {
  // The ref is the source of truth so `runOf` never reads a stale closure during
  // a render triggered by the very write that produced it; the state exists only
  // to re-render Home when the first answer lands.
  const runs = useRef<Map<string, DemoRun>>(new Map());
  const [playedRooms, setPlayedRooms] = useState<ReadonlySet<string>>(() => new Set());

  const recordRun = useCallback((roomId: string, run: DemoRun) => {
    runs.current.set(roomId, run);
    setPlayedRooms((atual) => (atual.has(roomId) ? atual : new Set(atual).add(roomId)));
  }, []);

  const runOf = useCallback((roomId: string) => runs.current.get(roomId) ?? null, []);

  const value = useMemo<DemoPlayValue>(
    () => ({ recordRun, runOf, playedRooms }),
    [recordRun, runOf, playedRooms],
  );

  return <DemoPlayContext.Provider value={value}>{children}</DemoPlayContext.Provider>;
}

export function useDemoPlay(): DemoPlayValue {
  const ctx = useContext(DemoPlayContext);
  if (!ctx) throw new Error('useDemoPlay precisa estar dentro de <DemoPlayProvider>.');
  return ctx;
}
