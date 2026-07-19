/**
 * Rebuilds the demo fan's own palpites into the shape the shared summary reads.
 *
 * Pure on purpose: the demo run stores only the challenge index and the option
 * the fan picked, so prompts and labels are resolved HERE, at render time,
 * against the current dictionary. That is what lets the fan switch language and
 * see their own summary translated instead of frozen in the language they
 * happened to play in.
 *
 * A timeout is `choice: null`, and it stays `null` all the way through: the
 * summary counts a hit as `minhaEscolha === correctOptionId`, so a missed
 * window can never be scored as a correct call.
 */

import type { ChallengeSpec } from './mock';
import type { ChallengeText } from './i18n';
import type { DemoRun } from '@/components/demo/DemoPlay';
import type { SalaResultado } from './useSala';

export function resultadosDoDemo(
  run: DemoRun,
  challenges: readonly ChallengeSpec[],
  textos: readonly ChallengeText[],
): SalaResultado[] {
  const out: SalaResultado[] = [];
  for (const answer of run.answers) {
    const spec = challenges[answer.index];
    const text = textos[answer.index];
    // An index the dictionary does not cover is dropped rather than rendered
    // half-empty; inventing a prompt would be exactly the thing rule 4 forbids.
    if (!spec || !text) continue;
    out.push({
      questionId: `demo-${answer.index}`,
      prompt: text.prompt,
      qtype: text.type,
      correctOptionId: spec.correct,
      gained: answer.gained,
      minhaEscolha: answer.choice,
      options: spec.optIds.map((id) => ({ id, label: text.opts[id] ?? id })),
    });
  }
  return out;
}
