# Security and quality review

Review of the Pre-MLR Checker prototype (Prompt 16, 2026-10-04). It lists the risks found, what was done about each, and what remains. Re-check this list before any deployment beyond a developer's machine.

## Risk checklist

| #   | Risk                                       | Severity | Status                                                                                                                                                                                                                         |
| --- | ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | SSRF through the link checker              | High     | **Fixed.** Connections are checked when they open (every redirect hop) and pinned to the checked address.                                                                                                                      |
| 2   | SSRF through the crawler's browser         | High     | **Fixed**, with one residual risk (below). Every browser request and redirect hop is checked; WebSockets and service workers are blocked.                                                                                      |
| 3   | SSRF through robots.txt, unbounded body    | High     | **Fixed.** Uses the guarded fetch; bodies are capped at 512 KB.                                                                                                                                                                |
| 4   | Internal error details returned to clients | Medium   | **Fixed.** Unexpected errors return `Internal error` with a request id; details go to the log. Failed scans show a short reason.                                                                                               |
| 5   | Unlimited scan queue; no scan time limit   | Medium   | **Fixed.** `MAX_QUEUED_SCANS`, `MAX_ACTIVE_SCANS_PER_USER` (429 when reached) and `SCAN_TIMEOUT_MINUTES`.                                                                                                                      |
| 6   | Missing security headers                   | Medium   | **Fixed.** `nosniff`, `X-Frame-Options: DENY`, CSP `default-src 'none'; frame-ancestors 'none'`, `no-referrer`, `no-store`.                                                                                                    |
| 7   | Cross-site request forgery                 | Low      | **Fixed (defence in depth).** SameSite=Strict cookie, plus state-changing requests with a foreign `Origin` get 403.                                                                                                            |
| 8   | Test coverage not measured                 | Medium   | **Fixed.** `npm run coverage`; gaps in error paths covered (numbers below).                                                                                                                                                    |
| 9   | File path traversal                        | —        | **OK.** Screenshot and PDF paths are resolved and must stay under `DATA_DIR`; file names are generated; download names are sanitised.                                                                                          |
| 10  | Input validation                           | —        | **OK.** Zod on every body and query; Fastify's 1 MB body limit; ids only reach parameterised queries.                                                                                                                          |
| 11  | Secrets and credentials                    | —        | **OK.** `.env` is git-ignored; passwords (scrypt) and session tokens (SHA-256) are stored only as hashes; cookies and auth headers are redacted from logs.                                                                     |
| 12  | XSS                                        | —        | **OK.** React escapes all crawled and LLM text (no `dangerouslySetInnerHTML`); the site-map SVG has a strict CSP; the PDF renders with JavaScript off and no network.                                                          |
| 13  | Prompt injection from crawled pages        | Low      | **Accepted.** Output is validated (quotes must appear on the page; only known rule ids and severities). Findings are advisory and reviewed by a person.                                                                        |
| 14  | Vulnerable dependencies                    | Low      | **Accepted for now.** `npm audit`: 6 moderate, in `esbuild` (via `drizzle-kit`, dev tool only) and `uuid` (via `exceljs`; the affected `buf` argument isn't used). Neither is reachable from the web API. Re-check on upgrade. |

## How the network guard works (`mlr-backend/src/net/guard.ts`)

- Only `http:` and `https:` URLs. Hostnames are resolved, and the request is refused if **any** resulting address is private: loopback, RFC 1918, carrier-grade NAT, link-local (including cloud metadata `169.254.169.254`), multicast, reserved and documentation ranges, IPv6 unique-local and link-local, and IPv4 embedded in IPv4-mapped or NAT64 addresses.
- **Allowlist:** `SCAN_PRIVATE_ALLOWLIST` (host or host:port, comma-separated) lets scans reach named private hosts, such as the local Examplin site (`localhost:4100,127.0.0.1:4100`). Keep it as narrow as possible; never add a whole host without a port in shared environments.
- **Server-side requests** (link checks, robots.txt) go through an undici agent that checks each connection's address when it opens and connects to that exact address. Redirect hops and DNS rebinding are covered.
- **Browser traffic** (pages, images, scripts, frames, redirects) goes through a local forward proxy (`src/net/proxy.ts`) bound to 127.0.0.1 with a random password. The proxy checks each target and connects to the checked address, so redirects and DNS rebinding are covered. Loopback is proxied too (`<-loopback>` removes Chromium's localhost bypass). The browser does its own TLS through the tunnel, so sites see a normal browser. Service workers and WebSockets are blocked. Blocked pages are recorded as "Blocked: private network address".
- **Link checks and bot protection:** sites behind bot protection (e.g. Cloudflare) refuse plain HTTP checks with 401/403/429 or a challenge. Those links are re-checked in the guarded browser (up to 30 per scan). A link counts as broken only for 404/410, server errors or connection failures. Links still refused become an info note ("couldn't confirm automatically"), never a broken-link finding.
- **Start URL:** `POST /api/scans` refuses private targets up front with a clear message.

## Residual risks

- **WebRTC.** Page scripts could attempt peer-to-peer (UDP) connections, which don't use the proxy. They can't read responses back into the crawl, but an egress firewall is the complete fix.
- **Login throttling is in memory.** A restart resets the counters, and there is no per-IP limit. Put the app behind a proxy with rate limiting if it is reachable by many people.
- **Accounts are local.** There's no MFA or password reset flow; replace the session layer with company SSO before wider use (the `sessions`/`currentUser` layer is the seam).
- **The LLM sees crawled content.** A page can try to steer it; validation limits the damage, but a person must review every finding (the product already requires this).

## Deployment notes

- Serve over HTTPS and set `COOKIE_SECURE=true`.
- Serve the frontend and API from the same origin (or set `CORS_ORIGIN` to the frontend origin). State-changing requests from any other origin are refused.
- Keep `.env` out of version control; `PRECEDENT_PSEUDONYM_KEY` and `ANTHROPIC_API_KEY` are secrets.
- Run the server as an unprivileged user with an egress firewall that blocks private ranges (closes the WebRTC gap above).
- Back up the SQLite database (or move to Postgres): it holds the audit log, which is append-only by design.

## Before using real company data

- Get IT/security approval for the LLM platform and where data is stored.
- Get permission from the MLR process owners for historic comments.
- Replace the public rule pack with the company's approved rules (a file change).
- Review this checklist again with IT security.

## Test coverage (2026-10-04)

| App      | Lines | Branches | Functions |
| -------- | ----- | -------- | --------- |
| Backend  | 96.6% | 84.4%    | 95.3%     |
| Frontend | 86.3% | 74.3%    | 87.0%     |

Lower spots: the AG Grid component in jsdom (its behaviour is tested in a real browser by `mlr-backend/test/ui-e2e.test.ts`, which this number doesn't count), the Anthropic branch of the provider factory, and `migrate.ts`/`server.ts` (entry points). Run `npm run coverage` for the current numbers and an HTML report in each app's `coverage/` folder.
