// Maps a team name to a display code and design-system accent token.

interface TeamVisual {
  code: string;
  color: string;
}

/** Known Portuguese and English names, so the display stays locale-independent. */
const TIMES: Record<string, TeamVisual> = {
  Argentina: { code: 'ARG', color: 'var(--cyan)' },
  'Cabo Verde': { code: 'CAB', color: 'var(--blue)' },
  'Cape Verde': { code: 'CAB', color: 'var(--blue)' },
  Espanha: { code: 'ESP', color: 'var(--red)' },
  Spain: { code: 'ESP', color: 'var(--red)' },
  Coreia: { code: 'COR', color: 'var(--blue)' },
  'South Korea': { code: 'COR', color: 'var(--blue)' },
  Brasil: { code: 'BRA', color: 'var(--mint)' },
  Brazil: { code: 'BRA', color: 'var(--mint)' },
  Marrocos: { code: 'MAR', color: 'var(--red)' },
  Morocco: { code: 'MAR', color: 'var(--red)' },
  França: { code: 'FRA', color: 'var(--blue)' },
  France: { code: 'FRA', color: 'var(--blue)' },
  Croácia: { code: 'CRO', color: 'var(--red)' },
  Croatia: { code: 'CRO', color: 'var(--red)' },
  Inglaterra: { code: 'ING', color: 'var(--red)' },
  England: { code: 'ENG', color: 'var(--red)' },
  'Estados Unidos': { code: 'EUA', color: 'var(--blue)' },
  'United States': { code: 'USA', color: 'var(--blue)' },
  Itália: { code: 'ITA', color: 'var(--blue)' },
  Italy: { code: 'ITA', color: 'var(--blue)' },
  México: { code: 'MEX', color: 'var(--mint)' },
  Mexico: { code: 'MEX', color: 'var(--mint)' },
  Alemanha: { code: 'ALE', color: 'var(--gold)' },
  Germany: { code: 'GER', color: 'var(--gold)' },
  Portugal: { code: 'POR', color: 'var(--red)' },
};

/** Design-system accent tokens for teams not present in the map. */
const FALLBACK = ['var(--blue)', 'var(--orange)', 'var(--mint)', 'var(--cyan)', 'var(--pink)', 'var(--lime-strong)'];

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function timeVisual(name: string): TeamVisual {
  const conhecido = TIMES[name];
  if (conhecido) return conhecido;
  const code = semAcento(name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || '??';
  return { code, color: FALLBACK[hash(name) % FALLBACK.length]! };
}
