// Sigla e cor de um time para a tela de palpite pré-jogo.
//
// O mockup mostra a sigla de três letras e uma cor por seleção. O design system
// não guarda times, e a regra da casa é NUNCA cravar hex (CONVENTIONS §6): então
// a cor de cada time é um TOKEN de acento do DS, escolhido para lembrar a camisa
// sem fingir precisão de bandeira. Time desconhecido cai num fallback
// determinístico (sigla das 3 primeiras letras, cor por hash) — nunca quebra.

interface TeamVisual {
  code: string;
  color: string;
}

/** Times conhecidos (pt e en), para a sigla e a cor baterem em qualquer idioma. */
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

/** Paleta de fallback: os acentos do DS, para times fora do mapa acima. */
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
