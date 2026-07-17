/** Erros do domínio que a camada HTTP traduz em status. */

export class HandleTakenError extends Error {
  readonly code = 'handle_taken';
  readonly status = 409;
  constructor(handle: string) {
    // Mensagem de usuário, em pt-BR e sem culpar o fã.
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
 * O free inclui 1 liga (mockup: "O free inclui 1 liga · desbloqueie ilimitadas").
 *
 * 402 e não 403: não é falta de permissão, é o paywall. O status diz à tela para
 * mandar o fã ao /premium em vez de mostrar "acesso negado" a quem não fez nada
 * de errado.
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
 * Apagar a liga é do LÍDER. Este 403 só aparece para quem JÁ está dentro da
 * liga (membro sem liderança) — quem não é membro recebe o mesmo 404 de liga
 * inexistente, para a tentativa não confirmar que ela existe.
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

/** Violação de unicidade do Postgres. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

/** Violação de chave estrangeira do Postgres. */
export function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23503';
}

export function constraintName(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null) return (e as { constraint?: string }).constraint;
  return undefined;
}
