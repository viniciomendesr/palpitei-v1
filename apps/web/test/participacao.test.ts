import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFirstParticipation } from '../src/server/participacao.ts';

/** 18/07 21:19 UTC — when the live palpites for 18257865 were recorded. */
const AO_VIVO = Date.UTC(2026, 6, 18, 21, 19);
/** 19/07 01:13 UTC — the measured replay, hours after the 23:06 whistle. */
const REPLAY_1 = Date.UTC(2026, 6, 19, 1, 13);
const REPLAY_2 = Date.UTC(2026, 6, 19, 9, 0);

test('with no palpite at all there is no participation', () => {
  assert.equal(pickFirstParticipation([]), null);
});

test('the first replay is the record; later replays do not overwrite it', () => {
  const escolhida = pickFirstParticipation([
    { runId: 'r1', live: false, firstAt: REPLAY_1 },
    { runId: 'r2', live: false, firstAt: REPLAY_2 },
  ]);
  assert.equal(escolhida?.runId, 'r1');
});

test('the arrival order of the list decides nothing', () => {
  const escolhida = pickFirstParticipation([
    { runId: 'r2', live: false, firstAt: REPLAY_2 },
    { runId: 'r1', live: false, firstAt: REPLAY_1 },
  ]);
  assert.equal(escolhida?.runId, 'r1');
});

test('whoever played live has the live run as their record, even after an earlier replay', () => {
  // A replay from ANOTHER rodada may have a lower wall clock; live wins for
  // being live, not for being older.
  const escolhida = pickFirstParticipation([
    { runId: 'replay-antigo', live: false, firstAt: AO_VIVO - 86_400_000 },
    { runId: 'sessao-ao-vivo', live: true, firstAt: AO_VIVO },
  ]);
  assert.equal(escolhida?.runId, 'sessao-ao-vivo');
});

test('between two live sessions the older one by real clock wins', () => {
  const escolhida = pickFirstParticipation([
    { runId: 'sessao-b', live: true, firstAt: AO_VIVO + 600_000 },
    { runId: 'sessao-a', live: true, firstAt: AO_VIVO },
  ]);
  assert.equal(escolhida?.runId, 'sessao-a');
});

test('a replay after the live run does not become the record', () => {
  const escolhida = pickFirstParticipation([
    { runId: 'sessao-ao-vivo', live: true, firstAt: AO_VIVO },
    { runId: 'replay', live: false, firstAt: REPLAY_1 },
  ]);
  assert.equal(escolhida?.live, true);
});
