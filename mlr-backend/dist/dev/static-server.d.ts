export interface StaticSite {
    url: string;
    close(): Promise<void>;
}
/**
 * Serves a fixture directory like a typical web server: "/x" maps to x.html, a directory without
 * a trailing slash redirects to "/x/", and "/x/" serves x/index.html. Unknown paths return a 404 page.
 */
export declare function serveStatic(root: string, listenPort?: number): Promise<StaticSite>;
