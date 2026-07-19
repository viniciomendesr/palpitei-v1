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

test('an empty sala drains the replay after the grace period instead of allowing a restart', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = salaFake();
  scheduleShutdownIfEmpty(fake.sala);

  t.mock.timers.tick(29_999);
  assert.equal(fake.drenou(), 0);
  t.mock.timers.tick(1);
  assert.equal(fake.drenou(), 1);
  assert.equal(fake.encerrou(), 0);
});

test('reconnecting during the grace period preserves the replay in progress', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = salaFake();
  scheduleShutdownIfEmpty(fake.sala);
  fake.sala.subs.add({});
  cancelShutdown(fake.sala);

  t.mock.timers.tick(30_000);
  assert.equal(fake.drenou(), 0);
});

test('an empty live sala stays attached to the channel instead of ending the match', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = salaFake(false, true);
  scheduleShutdownIfEmpty(fake.sala);

  t.mock.timers.tick(30_000);
  assert.equal(fake.drenou(), 0);
  assert.equal(fake.encerrou(), 0);
});

test('the final whistle does not prevent draining while odds remain on the timeline', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = salaFake(true, false, true);
  scheduleShutdownIfEmpty(fake.sala);

  t.mock.timers.tick(30_000);
  assert.equal(fake.drenou(), 1);
  assert.equal(fake.encerrou(), 0);
});

test('a finished result stays available before cleanup', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = salaFake(true);
  scheduleShutdownIfEmpty(fake.sala);

  t.mock.timers.tick(10 * 60_000 - 1);
  assert.equal(fake.encerrou(), 0);
  t.mock.timers.tick(1);
  assert.equal(fake.encerrou(), 1);
});
