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
