import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleShutdownIfEmpty,
  cancelShutdown,
} from '../src/server/room-lifecycle.ts';

function salaFake(finished = false, aoVivo = false, runnerAtivo = !finished) {
  let drenou = 0;
  let encerrou = 0;
  const sala = {
    subs: new Set(),
    shutdownTimer: null,
    state: { finished },
    runner: aoVivo
      ? null
      : { isRunning: runnerAtivo, finishNow: () => { drenou++; } },
    close: () => { encerrou++; },
  };
  return { sala, drenou: () => drenou, encerrou: () => encerrou };
}

test('sala vazia drena o replay após a carência em vez de permitir reinício', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = salaFake();
  scheduleShutdownIfEmpty(fake.sala);

  t.mock.timers.tick(29_999);
  assert.equal(fake.drenou(), 0);
  t.mock.timers.tick(1);
  assert.equal(fake.drenou(), 1);
  assert.equal(fake.encerrou(), 0);
});

test('reconectar durante a carência preserva o replay em andamento', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = salaFake();
  scheduleShutdownIfEmpty(fake.sala);
  fake.sala.subs.add({});
  cancelShutdown(fake.sala);

  t.mock.timers.tick(30_000);
  assert.equal(fake.drenou(), 0);
});

test('sala ao vivo vazia continua ligada ao canal em vez de encerrar o jogo', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = salaFake(false, true);
  scheduleShutdownIfEmpty(fake.sala);

  t.mock.timers.tick(30_000);
  assert.equal(fake.drenou(), 0);
  assert.equal(fake.encerrou(), 0);
});

test('apito final não impede dreno quando ainda há odds na timeline', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = salaFake(true, false, true);
  scheduleShutdownIfEmpty(fake.sala);

  t.mock.timers.tick(30_000);
  assert.equal(fake.drenou(), 1);
  assert.equal(fake.encerrou(), 0);
});

test('resultado encerrado permanece disponível antes da limpeza', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = salaFake(true);
  scheduleShutdownIfEmpty(fake.sala);

  t.mock.timers.tick(10 * 60_000 - 1);
  assert.equal(fake.encerrou(), 0);
  t.mock.timers.tick(1);
  assert.equal(fake.encerrou(), 1);
});
