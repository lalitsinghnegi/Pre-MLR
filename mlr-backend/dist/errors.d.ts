/** Errors carrying an HTTP status so routes can map them directly. */
export declare class AppError extends Error {
    readonly statusCode: number;
    readonly details?: unknown | undefined;
    constructor(message: string, statusCode: number, details?: unknown | undefined);
}
export declare class NotFoundError extends AppError {
    constructor(message: string);
}
export declare class ValidationError extends AppError {
    constructor(message: string, details?: unknown);
    /** Builds an error whose message lists each issue, e.g. "Invalid update: Nothing to update". */
    static fromIssues(prefix: string, issues: {
        message: string;
        path: PropertyKey[];
    }[]): ValidationError;
}
/** The caller's view is out of date (stale revision, or immutable data would change). */
export declare class ConflictError extends AppError {
    constructor(message: string, details?: unknown);
}
/** The caller is known but not allowed to do this (e.g. not a rule admin). */
export declare class ForbiddenError extends AppError {
    constructor(message: string);
}
/** Not signed in, or the session has expired. */
export declare class UnauthorizedError extends AppError {
    constructor(message?: string);
}
/** Too many attempts; try again later. */
export declare class TooManyRequestsError extends AppError {
    constructor(message: string);
}
