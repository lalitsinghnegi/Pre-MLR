export declare const MIN_PASSWORD_LENGTH = 12;
/** "scrypt$N$r$p$salt$hash" (base64), so parameters can be raised later without breaking old hashes. */
export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword(password: string, stored: string): Promise<boolean>;
/** A valid hash of a random password: verified against when the user doesn't exist, so timing doesn't reveal names. */
export declare const DUMMY_HASH: string;
export declare function passwordProblem(password: string): string | null;
