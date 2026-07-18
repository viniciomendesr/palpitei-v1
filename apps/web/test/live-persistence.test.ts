import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enfileirarPersistenciaAntesDePublicar, type FilaDeEventos } from '../src/server/eventPipeline.ts';

test('só publica um evento depois que a persistência lenta termina', async () => {
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
  assert.deepEqual(ordem, ['persistir:início'], 'a sala não vê evento pendente de commit');

  liberarPersistencia();
  await fila.fila;
  assert.deepEqual(ordem, ['persistir:início', 'persistir:fim', 'publicar']);
});

test('falha de persistência suprime a publicação e não mata a fila do stream', async () => {
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
