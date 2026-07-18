/** Domain errors translated to HTTP statuses by the application layer. */

export class HandleTakenError extends Error {
  readonly code = 'handle_taken';
  readonly status = 409;
  constructor(handle: string) {
    // User-facing message in pt-BR.
    super(`o apelido "${handle}" já é de outra pessoa — escolhe outro`);
    this.name = 'HandleTakenError';
  }
}

export class HandleInvalidError extends Error {
  readonly code = 'handle_invalid';
  readonly status = 400;
  constructor(motivo: string) {
    super(motivo);
    this.name = 'HandleInvalidError';
  }
}

export class UserNotFoundError extends Error {
  readonly code = 'user_not_found';
  readonly status = 404;
  constructor(id: string) {
    super(`usuário ${id} não existe — refaz o login`);
    this.name = 'UserNotFoundError';
  }
}

export class LeagueNameInvalidError extends Error {
  readonly code = 'league_name_invalid';
  readonly status = 400;
  constructor(motivo: string) {
    super(motivo);
    this.name = 'LeagueNameInvalidError';
  }
}

/**
 * Free accounts may create one league. 402 identifies a paywall and lets the UI
 * route the fan to /premium rather than showing an authorization error.
 */
export class LeagueLimitError extends Error {
  readonly code = 'league_limit';
  readonly status = 402;
  constructor() {
    super('o free inclui 1 liga — vire premium pra criar quantas quiser');
    this.name = 'LeagueLimitError';
  }
}

/**
 * Only a league owner can delete it. Non-members receive the same 404 as for a
 * missing league to avoid revealing its existence.
 */
export class LeagueNotOwnerError extends Error {
  readonly code = 'league_not_owner';
  readonly status = 403;
  constructor() {
    super('só quem lidera a liga pode apagá-la');
    this.name = 'LeagueNotOwnerError';
  }
}

export class LeagueNotFoundError extends Error {
  readonly code = 'league_not_found';
  readonly status = 404;
  constructor() {
    super('essa liga não existe');
    this.name = 'LeagueNotFoundError';
  }
}

export class InviteCodeInvalidError extends Error {
  readonly code = 'invite_code_invalid';
  readonly status = 404;
  constructor() {
    super('esse código não abre nenhuma liga — confere com quem te chamou');
    this.name = 'InviteCodeInvalidError';
  }
}

export class LobbyNotFoundError extends Error {
  readonly code = 'lobby_not_found';
  readonly status = 404;
  constructor() {
    super('esse lobby não existe mais — pede um convite novo');
    this.name = 'LobbyNotFoundError';
  }
}

export class LobbyUnavailableError extends Error {
  readonly code = 'lobby_unavailable';
  readonly status = 409;
  constructor(motivo = 'esse lobby não aceita novas entradas agora') {
    super(motivo);
    this.name = 'LobbyUnavailableError';
  }
}

/** PostgreSQL unique-constraint violation. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

/** PostgreSQL foreign-key violation. */
export function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23503';
}

export function constraintName(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null) return (e as { constraint?: string }).constraint;
  return undefined;
}
