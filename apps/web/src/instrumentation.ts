/** Starts the idempotent live channel once per Node.js process. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
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
