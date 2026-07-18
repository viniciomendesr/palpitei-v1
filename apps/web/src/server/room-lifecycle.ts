/** Minimal room state required for abandonment and retention management. */
export type ManagedRoom = {
  subs: Set<unknown>;
  shutdownTimer: ReturnType<typeof setTimeout> | null;
  state: { finished: boolean };
  /** Replays have a runner; live rooms remain attached until `game_finalised`. */
  runner: { finishNow(): void; readonly isRunning: boolean } | null;
  close(): void;
};

export const ABANDONMENT_GRACE_MS = 30_000;
export const FINISHED_ROOM_RETENTION_MS = 10 * 60_000;
export const WATCHDOG_MARGIN_MS = 30_000;

export function cancelShutdown(room: ManagedRoom): void {
  if (room.shutdownTimer) clearTimeout(room.shutdownTimer);
  room.shutdownTimer = null;
}

export function scheduleFinishedRoomCleanup(room: ManagedRoom): void {
  cancelShutdown(room);
  room.shutdownTimer = setTimeout(() => {
    room.shutdownTimer = null;
    if (room.subs.size === 0) room.close();
  }, FINISHED_ROOM_RETENTION_MS);
}

export function scheduleAbandonmentDrain(room: ManagedRoom): void {
  if (room.shutdownTimer) return;
  room.shutdownTimer = setTimeout(() => {
    room.shutdownTimer = null;
    if (room.subs.size === 0 && room.runner?.isRunning) {
      // Drain the remaining timeline so persisted picks and the final summary remain consistent.
      room.runner?.finishNow();
    }
  }, ABANDONMENT_GRACE_MS);
}

export function scheduleShutdownIfEmpty(room: ManagedRoom): void {
  if (room.subs.size !== 0) return;
  // Keep draining an active runner even after `game_end` so it can publish completion.
  if (room.runner?.isRunning) scheduleAbandonmentDrain(room);
  else if (room.state.finished) scheduleFinishedRoomCleanup(room);
  else scheduleAbandonmentDrain(room);
}
