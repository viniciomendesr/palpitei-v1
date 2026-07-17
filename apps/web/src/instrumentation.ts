/**
 * Boot do processo servidor (hook oficial do Next 15: roda UMA vez por boot).
 * Liga o canal ao vivo — que é um no-op silencioso quando as travas estão
 * fechadas (TXLINE_LIVE_INGEST !== 'true' ou LIVE_FIXTURE_ID ausente).
 *
 * Plano B, caso este hook não rode na infra do dia: `iniciarCanalAoVivo()` é
 * idempotente e também é chamada na primeira linha de GET /api/live/status —
 * o primeiro curl do runbook garante o boot.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { iniciarCanalAoVivo } = await import('./server/live');
  iniciarCanalAoVivo();
}
