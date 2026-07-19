import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enfileirarPersistenciaAntesDePublicar, type FilaDeEventos } from '../src/server/eventPipeline.ts';

test('an event is only published after the slow persistence finishes', async () => {
  const fila: FilaDeEventos = { fila: Promise.resolve() };
  const ordem: string[] = [];
  let liberarPersistencia!: () => void;
  const persistenciaLenta = new Promise<void>((resolve) => {
    liberarPersistencia = resolve;
  });

  enfileirarPersistenciaAntesDePublicar(
    fila,
    async () => {
      ordem.push('persistir:início');
      await persistenciaLenta;
      ordem.push('persistir:fim');
    },
    () => ordem.push('publicar'),
    () => ordem.push('falha'),
  );

  await Promise.resolve();
  assert.deepEqual(ordem, ['persistir:início'], 'the sala never sees an event pending commit');

  liberarPersistencia();
  await fila.fila;
  assert.deepEqual(ordem, ['persistir:início', 'persistir:fim', 'publicar']);
});

test('a persistence failure suppresses publishing without killing the stream queue', async () => {
  const fila: FilaDeEventos = { fila: Promise.resolve() };
  const publicados: string[] = [];
  const falhas: string[] = [];

  enfileirarPersistenciaAntesDePublicar(
    fila,
    async () => {
      throw new Error('Postgres indisponível');
    },
    () => publicados.push('evento-falho'),
    (erro) => falhas.push(erro instanceof Error ? erro.message : String(erro)),
  );
  enfileirarPersistenciaAntesDePublicar(
    fila,
    async () => {},
    () => publicados.push('evento-seguinte'),
    (erro) => falhas.push(erro instanceof Error ? erro.message : String(erro)),
  );

  await fila.fila;
  assert.deepEqual(publicados, ['evento-seguinte']);
  assert.deepEqual(falhas, ['Postgres indisponível']);
});

test('the queue awaits the async fan-out before the next event', async () => {
  const fila: FilaDeEventos = { fila: Promise.resolve() };
  const ordem: string[] = [];
  let liberarBroker!: () => void;
  const brokerLento = new Promise<void>((resolve) => {
    liberarBroker = resolve;
  });

  enfileirarPersistenciaAntesDePublicar(
    fila,
    async () => { ordem.push('persistir-1'); },
    async () => {
      ordem.push('publicar-1');
      await brokerLento;
      ordem.push('broker-1');
    },
    () => { ordem.push('falha'); },
  );
  enfileirarPersistenciaAntesDePublicar(
    fila,
    async () => { ordem.push('persistir-2'); },
    () => { ordem.push('publicar-2'); },
    () => { ordem.push('falha'); },
  );

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(ordem, ['persistir-1', 'publicar-1']);
  liberarBroker();
  await fila.fila;
  assert.deepEqual(ordem, ['persistir-1', 'publicar-1', 'broker-1', 'persistir-2', 'publicar-2']);
});
