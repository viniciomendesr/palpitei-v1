/** Starts the idempotent live channel once per Node.js process. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { iniciarCanalAoVivo } = await import('./server/live');
  iniciarCanalAoVivo();
}
