import type { NetworkGuard } from './guard.js';
/** Set on proxy responses that refused a private target, so the crawler can say why. */
export declare const BLOCKED_HEADER = "x-pre-mlr-blocked";
export interface GuardProxy {
    /** e.g. "http://127.0.0.1:53211", for Playwright's `proxy.server`. */
    server: string;
    username: string;
    password: string;
    /** host:port targets refused so far (newest last). */
    blocked: string[];
    close(): Promise<void>;
}
/**
 * A local forward proxy for the crawler's browser. Every connection the browser makes (pages,
 * subresources, redirects, WebSockets) goes through it; each target is checked by the guard and the
 * connection pinned to the checked address, so DNS can't change in between. Because the browser
 * does its own TLS through the tunnel, sites see a normal browser (bot protection lets it in).
 * Bound to 127.0.0.1 and protected by a random password, so only our browser can use it.
 */
export declare function startGuardProxy(guard: NetworkGuard): Promise<GuardProxy>;
