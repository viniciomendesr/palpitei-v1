import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFirstParticipation } from '../src/server/participacao.ts';

/** 18/07 21:19 UTC — quando os palpites ao vivo da 18257865 foram registrados. */
const AO_VIVO = Date.UTC(2026, 6, 18, 21, 19);
/** 19/07 01:13 UTC — o replay medido, horas depois do apito das 23:06. */
const REPLAY_1 = Date.UTC(2026, 6, 19, 1, 13);
const REPLAY_2 = Date.UTC(2026, 6, 19, 9, 0);

test('sem palpite nenhum, não existe participação', () => {
  assert.equal(pickFirstParticipation([]), null);
});

test('o primeiro replay é o registro; replays posteriores não sobrescrevem', () => {
  const escolhida = pickFirstParticipation([
    { runId: 'r1', live: false, firstAt: REPLAY_1 },
    { runId: 'r2', live: false, firstAt: REPLAY_2 },
  ]);
  assert.equal(escolhida?.runId, 'r1');
});

test('a ordem de chegada da lista não decide nada', () => {
  const escolhida = pickFirstParticipation([
    { runId: 'r2', live: false, firstAt: REPLAY_2 },
    { runId: 'r1', live: false, firstAt: REPLAY_1 },
  ]);
  assert.equal(escolhida?.runId, 'r1');
});

test('quem jogou ao vivo tem o ao vivo como registro, mesmo replayando antes', () => {
  // Um replay de OUTRA rodada pode ter relógio de parede menor; ao vivo ganha
  // por ser ao vivo, não por ser mais antigo.
  const escolhida = pickFirstParticipation([
    { runId: 'replay-antigo', live: false, firstAt: AO_VIVO - 86_400_000 },
    { runId: 'sessao-ao-vivo', live: true, firstAt: AO_VIVO },
  ]);
  assert.equal(escolhida?.runId, 'sessao-ao-vivo');
});

test('entre duas sessões ao vivo vale a mais antiga pelo relógio real', () => {
  const escolhida = pickFirstParticipation([
    { runId: 'sessao-b', live: true, firstAt: AO_VIVO + 600_000 },
    { runId: 'sessao-a', live: true, firstAt: AO_VIVO },
  ]);
  assert.equal(escolhida?.runId, 'sessao-a');
});

test('replay depois do ao vivo não vira o registro', () => {
  const escolhida = pickFirstParticipation([
    { runId: 'sessao-ao-vivo', live: true, firstAt: AO_VIVO },
    { runId: 'replay', live: false, firstAt: REPLAY_1 },
  ]);
  assert.equal(escolhida?.live, true);
});
