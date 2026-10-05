/** Errors carrying an HTTP status so routes can map them directly. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, details);
  }

  /** Builds an error whose message lists each issue, e.g. "Invalid update: Nothing to update". */
  static fromIssues(
    prefix: string,
    issues: { message: string; path: PropertyKey[] }[],
  ): ValidationError {
    const text = issues
      .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
      .join('; ');
    return new ValidationError(`${prefix}: ${text}`, issues);
  }
}

/** The caller's view is out of date (stale revision, or immutable data would change). */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, details);
  }
}

/** The caller is known but not allowed to do this (e.g. not a rule admin). */
export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 403);
  }
}

/** Not signed in, or the session has expired. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue.') {
    super(message, 401);
  }
}

/** Too many attempts; try again later. */
export class TooManyRequestsError extends AppError {
  constructor(message: string) {
    super(message, 429);
  }
}
