/** Shown wherever a request is refused because it targets an internal address. */
export declare const BLOCKED_MESSAGE = "Blocked: private network address";
/** True for addresses inside any blocked range, including IPv4 embedded in IPv6 forms. */
export declare function isPrivateAddress(ip: string): boolean;
export type UrlCheck = {
    ok: true;
} | {
    ok: false;
    reason: 'scheme' | 'private' | 'unresolved';
    message: string;
};
/**
 * Decides which hosts scans may reach. Public addresses are allowed; private ones only when the
 * exact host[:port] is on the allowlist (e.g. a local test site). Hostnames are resolved and every
 * resolved address must be public.
 */
export declare class NetworkGuard {
    private readonly allow;
    private readonly resolve;
    constructor(opts?: {
        /** "host" or "host:port" entries that may be private (e.g. "localhost:4100"). */
        allow?: string[];
        /** DNS lookup, replaceable in tests. */
        resolve?: (host: string) => Promise<string[]>;
    });
    isAllowlisted(hostname: string, port: number): boolean;
    /** The public addresses of a host, or why it must not be contacted. */
    addressesFor(hostname: string, port: number): Promise<string[] | (UrlCheck & {
        ok: false;
    })>;
    /** Whether a URL may be requested: http(s) only, and a public (or allowlisted) host. */
    checkUrl(raw: string): Promise<UrlCheck>;
    /**
     * fetch whose connections are checked when they open (so every redirect hop is covered) and
     * pinned to the checked address (so DNS can't change between the check and the connection).
     */
    readonly fetch: typeof fetch;
    private readonly dispatcher;
    close(): Promise<void>;
}
