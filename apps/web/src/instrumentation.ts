/** Starts the idempotent live channel once per Node.js process. */
export async function register(): Promise<void> {
  // The import must stay nested inside a positive `=== 'nodejs'` check. Next
  // also compiles this file for the edge runtime, and only this shape lets the
  // bundler drop the branch there; an early `return` leaves the Postgres and
  // Redis drivers in the edge bundle, where Node builtins do not resolve and
  // every route answers 500.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Both paths below reach Postgres. Without a database there is nothing for
    // them to do, so a reviewer running the demo on an empty `.env` skips them.
    if (!process.env.DATABASE_URL) {
      console.warn(
        '[palpitei] DATABASE_URL is not set — live ingest and room reconciliation are off. The local demo still works.',
      );
      return;
    }
    const { iniciarCanalAoVivo } = await import('./server/live');
    iniciarCanalAoVivo();
    // A restart wipes the in-memory `salas` map, so a match that ended while no
    // process held the room leaves `game_sessions` active and the lobby started
    // forever. This sweep is the only thing that can revisit those rows; it is
    // idempotent and only touches parties whose match is already `finished`.
    const { reconcileOrphanedRooms, retireFinishedLiveFixtures } = await import('./server/reconciliation');
    void reconcileOrphanedRooms();
    // Same reasoning one level up: the fixture itself is only retired at the
    // terminal event, so a match that ended unattended keeps rebuilding its
    // channel on every boot. Retiring it here is what finally stops that.
    void retireFinishedLiveFixtures();
  }
}
