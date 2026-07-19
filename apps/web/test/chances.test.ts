import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idDaOpcaoChance, redigeChance } from '../src/lib/chances.ts';

// The renderer is pure and receives its dictionary. These templates mirror the
// i18n dictionaries, which this Node test cannot import because they contain JSX.

const ptDic = {
  chanceUp: 'A chance de {nome} subiu de {de}% para {para}%{causa}.',
  chanceDown: 'A chance de {nome} caiu de {de}% para {para}%{causa}.',
  chanceDraw: 'empate',
  chanceCtx: {
    goal: 'depois do gol',
    corner: 'depois do escanteio',
    red_card: 'depois do cartão vermelho',
    yellow_card: 'depois do cartão amarelo',
    penalty: 'depois do pênalti',
    var: 'depois da revisão do VAR',
    kickoff: 'depois do pontapé inicial',
  } as Record<string, string>,
};

const enDic = {
  chanceUp: "{nome}'s chance rose from {de}% to {para}%{causa}.",
  chanceDown: "{nome}'s chance fell from {de}% to {para}%{causa}.",
  chanceDraw: 'The draw',
  chanceCtx: {
    goal: 'after the goal',
    corner: 'after the corner',
    red_card: 'after the red card',
    yellow_card: 'after the yellow card',
    penalty: 'after the penalty',
    var: 'after the VAR review',
    kickoff: 'after kick-off',
  } as Record<string, string>,
};

const base = { id: 'odds-1:part1', ts: 1_000, minute: 34, text: 'frase do core (fallback)' };

test('idDaOpcaoChance uses the same 1X2 contract as the final question options', () => {
  assert.equal(idDaOpcaoChance('part1'), 'p1');
  assert.equal(idDaOpcaoChance('X'), 'draw');
  assert.equal(idDaOpcaoChance('away'), 'p2');
  assert.equal(idDaOpcaoChance('over'), null);
});

test('pt: rise with a cause — team name replaces the feed priceName', () => {
  assert.equal(
    redigeChance(
      { ...base, priceName: 'part1', fromPct: 58, toPct: 74.5, contextAction: 'goal' },
      ptDic,
      'França',
      'Inglaterra',
    ),
    'A chance de França subiu de 58.0% para 74.5% depois do gol.',
  );
});

test('pt: a fall with NO contextAction gets no cause at all (never invent one)', () => {
  assert.equal(
    redigeChance(
      { ...base, priceName: 'draw', fromPct: 33.3, toPct: 28.1 },
      ptDic,
      'França',
      'Inglaterra',
    ),
    'A chance de empate caiu de 33.3% para 28.1%.',
  );
});

test('feed name map: part2|2|away -> teamB, 1|home -> teamA, x -> draw', () => {
  const b = { ...base, fromPct: 20, toPct: 25 };
  const frase = (priceName: string) =>
    redigeChance({ ...b, priceName }, ptDic, 'França', 'Inglaterra');
  assert.match(frase('part2'), /^A chance de Inglaterra subiu/);
  assert.match(frase('2'), /^A chance de Inglaterra subiu/);
  assert.match(frase('away'), /^A chance de Inglaterra subiu/);
  assert.match(frase('1'), /^A chance de França subiu/);
  assert.match(frase('home'), /^A chance de França subiu/);
  assert.match(frase('x'), /^A chance de empate subiu/);
  // Feed casing does not matter because the map compares lowercase names.
  assert.match(frase('Part1'), /^A chance de França subiu/);
});

test('an unmatched priceName is emitted RAW — never an invented name', () => {
  assert.equal(
    redigeChance(
      { ...base, priceName: 'Over', fromPct: 40, toPct: 46, contextAction: 'corner' },
      ptDic,
      'França',
      'Inglaterra',
    ),
    'A chance de Over subiu de 40.0% para 46.0% depois do escanteio.',
  );
});

test('unknown contextAction = no cause (a cause only comes from the map, G6)', () => {
  assert.equal(
    redigeChance(
      { ...base, priceName: 'part1', fromPct: 50, toPct: 56, contextAction: 'substitution' },
      ptDic,
      'França',
      'Inglaterra',
    ),
    'A chance de França subiu de 50.0% para 56.0%.',
  );
});

test('percentages ALWAYS use 1 decimal (toFixed), even for round numbers', () => {
  assert.equal(
    redigeChance({ ...base, priceName: 'part1', fromPct: 60, toPct: 55 }, ptDic, 'A', 'B'),
    'A chance de A caiu de 60.0% para 55.0%.',
  );
});

test('en: rise with a cause', () => {
  assert.equal(
    redigeChance(
      { ...base, priceName: 'part1', fromPct: 58, toPct: 74.5, contextAction: 'goal' },
      enDic,
      'France',
      'England',
    ),
    "France's chance rose from 58.0% to 74.5% after the goal.",
  );
});

test('en: draw falling, no cause', () => {
  assert.equal(
    redigeChance({ ...base, priceName: 'x', fromPct: 33.3, toPct: 28.1 }, enDic, 'France', 'England'),
    "The draw's chance fell from 33.3% to 28.1%.",
  );
});
