# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

`docs/BUILD_PROMPTS.md` is the phased build plan (Prompts 0–16). All prompts (0–16) are done (context, scaffold, crawler, site map, PDF report, rule/finding model, public rule pack + deterministic checks, Examplin test site, findings API + review grid, LLM layer, model evaluation harness, tips and findings in the PDF, precedent ingestion, precedent classification and trends, similar precedents on findings, rule library and sign-in, security hardening). `docs/SECURITY.md` holds the risk checklist and residual risks. Work through it **one numbered prompt at a time, in order**. For each prompt: show a short plan and wait for approval, implement it, run the tests and the app, summarize what works and what doesn't, then **stop and wait for "next"**. Never start the next prompt unprompted. To resume, check which prompts look done based on the repo and propose the next one.

The build plan was written for Python/FastAPI and Next.js. **The user chose Node + React instead.** Translate the plan's stack references (see Stack below) rather than following them literally.

## Commands

npm workspaces monorepo; run everything from the repo root.

```sh
npm install                       # also builds packages/shared (postinstall)
npm run dev                       # shared (tsc --watch) + backend :8000 + frontend :5173
npm test                          # Vitest, both apps
npm run lint                      # ESLint (mlr-backend), oxlint (mlr-frontend)
npm run typecheck
npm run build

npm test -w mlr-backend -- health            # single file (name filter)
npm test -w mlr-backend -- -t "reports ok"   # single test by name
npm run db:generate -w mlr-backend           # drizzle-kit migration from src/db/schema.ts
npm run db:migrate -w mlr-backend
npx -w mlr-backend playwright install chromium
npm run serve:examplin                       # fictional test site on :4100
npm run eval -w mlr-backend                  # model eval (mock only unless --models … --yes)
npm run precedent:import -w mlr-backend -- --file <xlsx|csv> --site <host> [--dry-run]
npm run precedent:generate -w mlr-backend    # regenerate the synthetic dataset (fixed seed)
npm run precedent:classify -w mlr-backend -- --provider mock [--labels <answer-key.json>] [--force]  # anthropic needs --yes
npm run precedent:embed -w mlr-backend       # embed all precedents (downloads the local model once)
npm run coverage                             # Vitest with V8 coverage, both apps
npm run user -w mlr-backend -- add --name "X" --role author|rule_admin   # accounts (also passwd/role/disable/enable/list)
```

## Code layout

- `mlr-backend/`: Fastify + TS (ESM, `NodeNext`, so relative imports need `.js` extensions). `src/app.ts` `buildApp({config, db?, crawl?})` runs migrations and builds the app without listening. Tests call it with `createDb(':memory:')`, a temp `DATA_DIR`, and optionally a stub `crawl`, then use `app.inject()`. `src/server.ts` is the only file that listens. Env is validated by Zod in `src/config.ts`; `.env` is loaded through `--env-file-if-exists`. Routes are plugins in `src/routes/`, and each takes its dependencies (e.g. `db`) as arguments.
  - **Scan pipeline:** `POST /api/scans` inserts a `queued` scan, then `ScanRunner` (`src/scans/runner.ts`) runs one scan at a time in-process and writes status and progress to the DB. `crawl()` (`src/crawler/crawler.ts`) is a breadth-first Playwright crawl that calls `onPage` for each page. The runner persists each page in a transaction. Tests await `app.scanRunner.idle()` instead of polling. On startup, `running` scans are marked failed and `queued` ones are re-queued.
  - **Pages:** `parent_page_id` is the first page that linked to a page, and it drives the site-map hierarchy. `crawl_index` is the visit order. `links` is a JSON column of every `<a href>`, including skipped external, `mailto:` and PDF links. Pages with HTTP ≥ 400 or a load failure are stored with `error` and no screenshots. Screenshot paths are **relative to `DATA_DIR`** (`scans/<scanId>/<pageId>-{desktop,mobile}.png`).
  - **Browser-side code** passed to `page.evaluate` must be a **plain JS string** (see `EXTRACT_SCRIPT`). Under `tsx` (dev), function callbacks get an injected `__name` helper that crashes in the page. Vitest doesn't do this, so tests won't catch it.
  - **Site map** (`src/sitemap/`): pure functions build the tree from pages and turn it into DOT (`tree.ts`, `dot.ts`). `render.ts` runs Graphviz WASM (`@hpcc-js/wasm-graphviz`, loaded once) to make SVG, applies `unflatten` when a parent has more than 6 children, and uses resvg for PNG. Node numbers are crawl order + 1, so they match the PDF's screenshot order. Labels go through Graphviz HTML-label escaping. Graphviz writes node ids into the SVG as `page&#45;N`.
  - **PDF report** (`src/report/`): `plan.ts` is pure and decides the page sequence (title, site map, **summary**, all desktop, all mobile, **findings list**) and how tall screenshots are sliced.
    - Each screenshot page's side panel gets a share of that page's non-rejected findings and tip (`distributePanels`), sized by conservative text-height estimates (`PANEL`/`APPENDIX` constants, `wrapLines`, `clip`). **The HTML must clip text with the same `clip` limits and use the same font sizes and line heights**, or panels overflow. Whatever doesn't fit gets "+N more … see Findings list, page X".
    - Findings are labelled `page.n`, ordered by severity then position on the page. Desktop slices draw numbered evidence markers, and findings that share a box share one marker.
    - Rejected findings are only counted on the summary page. The PDF reflects the review state at download time. Mobile uses 2 columns per page. Contents page numbers come from the plan, so the **HTML must render exactly one `.page` section per planned page** (tests assert the PDF page count). `html.ts` builds HTML with print CSS. Every crawled string goes through `esc()`. Don't add an `@page` rule, because it overrides `page.pdf()` margins. `pdf.ts` runs Playwright with JS disabled and all network blocked. Screenshot slices are cropped and converted to JPEG by sharp on request, through a route on `http://report.invalid/img/<pdfPage>-<column>.jpg`. Only one PDF is generated at a time. Screenshot paths are resolved under `DATA_DIR`, and anything outside it is ignored.
  - **Rules and findings model:**
    - `rules` holds the stable id. `rule_versions` is **immutable**: any change is a new version. `createRuleVersion` treats identical content as `unchanged`, so pack reloads are safe. It rejects changed content under an existing version, and versions that aren't newer.
    - `scan_rules` freezes the rule versions a scan runs with. `ScanRunner` calls `snapshotScanRules` when a scan starts. Findings must use a rule from the scan's snapshot.
    - `findings.suggested_fix` is never modified; the author's text goes in `edited_fix`. `revision` is used for optimistic concurrency (`expectedRevision` → `ConflictError`). The fingerprint (rule + page + normalized evidence) de-duplicates findings per scan.
    - **All finding and rule changes go through `src/findings/service.ts` and `src/rules/repository.ts`**, which write `audit_log` in the same transaction.
    - `audit_log` is append-only: SQLite triggers in migration `0002` block UPDATE and DELETE. It has no foreign keys, so history outlives deleted scans.
    - Services throw `AppError` subclasses (`src/errors.ts`) that carry HTTP status codes.
    - Triggers and other SQL that drizzle-kit can't generate go in custom migrations (`npx drizzle-kit generate --custom --name <name>`).
  - **Rule pack and checks:**
    - `rule-packs/public/` (repo root) is loaded at startup by `syncRulePack` (`RULE_PACK_DIR`). Each rule is a YAML file. Deterministic rules choose a generic check with `params.check`, and the remaining `params` configure it. The 9 check types are in `src/checks/registry.ts`, each with a Zod params schema that is validated when the pack loads.
    - **To add a rule of an existing kind, add only a YAML file. To change a rule, edit it and bump `version`.**
    - Pipeline (`ScanRunner`): crawl → `runDeterministicChecks` (`src/checks/run.ts`): link checks → each enabled deterministic rule in the scan's snapshot → `recordFindings`. A rule that throws or has bad params is logged and skipped, and the scan still completes. LLM rules are skipped until Prompt 9.
    - Checks are pure functions over `CheckContext`: pages with `facts`, the product profile, and link statuses. Test them without a browser using `test/helpers/check-pages.ts`.
    - `pages.facts` holds text blocks (box, font size/weight, colours, `<sup>`, landmark region) and images. They are captured in the desktop view by `FACTS_SCRIPT`, a `String.raw` plain-JS string. Boxes are desktop screenshot pixels and become `evidenceLocation`.
    - Link checks reuse crawled pages' statuses and store everything else in `link_checks`. Same-site URLs disallowed by robots.txt are skipped. Tests must pass a `fetchImpl` so they never reach the network.
  - **Examplin test site** (`test-sites/examplin/`, repo root): fictional pages with planted flaws, plus `expected-findings.yaml`. `test/examplin.test.ts` requires an **exact** match for deterministic findings, no findings on `cleanPages`, and an expected entry for every pack rule. **When you add or change a rule or check, plant a flaw and update the expected file.** `src/eval/compare.ts` (`compareFindings`) does the matching, and the Prompt 10 eval harness reuses it.
  - The rule snapshot is taken in `POST /api/scans` (transaction with the scan insert), applying `rules.enable/disable`. `ScanRunner`'s snapshot call is an idempotent fallback. `AppError`s map to their HTTP status through the app's error handler.
  - **Review API** (`src/routes/findings.ts`, `src/review/views.ts`):
    - `GET /api/scans` (with counts), `GET /api/scans/:id/findings` (`FindingView` = finding + page + rule), `PATCH /api/findings/:id`, `POST /api/findings/bulk` (all-or-nothing), `GET /api/findings/:id/audit`, and the screenshot endpoint (path-checked under `DATA_DIR`).
    - Changes require `expectedRevision`. A stale one gets 409 with `current`, so the client refreshes instead of overwriting.
    - The actor for every change is the signed-in user's name (`currentUser(req).name`).
  - **LLM layer** (`src/llm/`):
    - `LLMProvider` is the interface: `AnthropicProvider` (official SDK, `client.beta.messages.parse` + `betaZodOutputFormat`, `fallbacks: 'default'`) and `MockProvider` (regex-based, offline). `createProvider(config)` returns null when `LLM_PROVIDER=none`, which is the default.
    - `runLlmAnalysis` (`analyze.ts`) runs after the deterministic checks for the scan's enabled LLM rules. It sends one request per eligible page with the system prompt plus a cached rules block, then the page text and a JPEG screenshot (long edge 1568px).
    - It then runs `validateOutput` and retries once with feedback. Findings with invalid quotes, unknown rule IDs or bad severities are dropped.
    - Results are stored in `llm_analyses`, which doubles as the response cache (keyed by model, settings, prompt version, rule versions and page content).
    - **The SDK's Zod helper sends enums only as description hints, not constraints, so the server-side checks in `schema.ts` are what enforce rule IDs and severities.**
    - **Never make real API calls in tests:** use `MockProvider`, a fake `LLMProvider`, or `new Anthropic({ apiKey, fetch: stub })`. The user declined a paid live run in Prompt 9, so ask before spending money on the API.
    - Prompts live in `prompts/page-analysis/<version>/`. To change them, add a new version directory and bump `PROMPT_VERSION`. Stored analyses record `version#hash`.
  - **Eval harness** (`src/eval/harness.ts`, CLI `scripts/eval.ts`, models in `eval/models.yaml`):
    - It crawls once, then for each model and run clones the scan (pages are copied, screenshots shared) and runs `runLlmAnalysis` with `useCache: false`. It scores **LLM findings only** with `compareFindings`.
    - The spend guard (`guard.ts`) refuses paid models without `--yes` or when the estimate is over budget. The harness also stops between runs once actual spend passes the budget.
    - Tests use `providerFactory` to inject mock or fake providers.
  - **Precedents** (`src/precedent/`):
    - `readTable` reads .xlsx or .csv. CSV values are kept as raw strings, because exceljs' CSV date parsing uses local time and can shift dates by a day.
    - Columns come from a mapping file (`precedent/mappings/*.yaml`). `normalizeRow` validates each row, redacts emails and phone numbers, and pseudonymises the reviewer (HMAC with `PRECEDENT_PSEUDONYM_KEY`, `Reviewer-XXXXXXXX`).
    - `importPrecedents` skips invalid rows (or aborts with `strict`) and duplicates (by fingerprint), writing everything in one transaction with an audit entry.
    - **Never store raw reviewer names.** A test scans the database for them.
    - The synthetic dataset and its answer key (`*.labels.json`) are in `test-sites/precedent/`.
    - **Classification** (`classify.ts`): batches of comments (ids `c1..cN` per batch) go to the `LLMProvider` with task `precedent-classification` and its own output schema (`LlmRequest.outputSchema`; page analysis passes its findings schema). Prompts are in `prompts/precedent-classification/<version>/`. `validateClassifications` enforces ids and categories, and the retry sends only unanswered comments. `precedent_classifications` holds one current row per precedent (`status` ok/failed, category null = no matching rule). A row is current when provider, model, prompt version and `rulePackHash` match; changes are audited per precedent. `MockProvider` classifies by keyword.
    - **Trends** (`trends.ts`, `routes/precedents.ts`): `GET /api/precedents/trends` and `/candidates`, aggregated in JS (no DB date functions). Buckets are the rule categories plus `no_matching_rule` and `unclassified` (`PRECEDENT_BUCKETS` in shared). `clusters.ts` groups no-match comments by TF-IDF of text plus topic (greedy, deterministic). Embedding similarity is planned for Prompt 14.
    - **Retrieval** (`embed.ts`, `retrieve.ts`): `Embedder` interface. `LocalEmbedder` is transformers.js with `Xenova/all-MiniLM-L6-v2` q8, loaded lazily and cached in `DATA_DIR/models`. `HashEmbedder` is lexical and used in tests. Each has its own `minSimilarity`. `attachPrecedents` is the last `ScanRunner` step (phase `matching`); a failure there is logged and the scan still completes. It filters to the same category and to `PRECEDENT_MAX_AGE_MONTHS`, ranks by cosine plus a brand/site boost, skips repeats (same `gistOf` or cosine ≥ 0.95), and replaces the scan's `finding_precedents` rows. Vectors are stored as JSON in `precedent_embeddings`, keyed by embedder id. **The embedder is never called when there are no candidate precedents, so tests never download the model.** Tests pass `embedder` to `buildApp`, or use `TableEmbedder`/`seedPrecedents` from `test/helpers/precedents.ts`.
    - `FindingView.precedents` is used by the grid panel (`SimilarPrecedents.tsx`) and the PDF (`pagePrecedents` → `ReportPageInput.precedents`, at most `PANEL.precedents` per page, counted in the panel height estimate).
    - **Rule candidates** (`candidates.ts`): `POST /api/rule-candidates` is rule-admin only (`ForbiddenError` 403). Duplicate precedent sets get 409. When promoted from a finding, the precedents must be attached to that finding. It writes audit entries for the candidate and for each precedent (action `promoted_to_rule_candidate`). The UI's `PromoteButton` shows only for rule admins, and the server checks again.
    - The dashboard is `mlr-frontend/src/pages/PrecedentsPage.tsx` (`/precedents`, filters in the URL). It uses small multiples rather than a stacked chart, because 10 buckets is too many colours.
  - **Network guard** (`src/net/guard.ts`, see `docs/SECURITY.md`): **every outbound request from a scan must go through it.**
    - `NetworkGuard.checkUrl` allows http(s) only and blocks any private resolved address unless the host[:port] is in `SCAN_PRIVATE_ALLOWLIST`.
    - `guard.fetch` uses an undici agent that checks and pins each connection, so redirect hops and DNS rebinding are covered. The runner passes it as the default `fetchImpl` for link checks and robots.txt.
    - `crawl()` requires `guard`. `launchGuardedBrowser` starts Chromium behind `startGuardProxy` (`src/net/proxy.ts`): a local CONNECT/HTTP proxy that checks and pins every connection. Its bypass is `<-loopback>`, so localhost is proxied too. Don't go back to `route.fetch`: it uses a non-browser HTTP client, which bot protection (Cloudflare) refuses. A redirect to a blocked host shows as the `x-pre-mlr-blocked` header or a proxy `blocked` entry. Service workers and WebSockets are blocked.
    - **Link checks:** 401/403/429 or `cf-mitigated` responses are `refused`. `recheckRefused` (`checks/run.ts`) re-loads them in the guarded browser (`verifyLinksInBrowser`, desktop UA, up to `MAX_BROWSER_CHECKS`). Only 404/410/5xx/connection errors are broken; still-refused links are `unverified` and produce one info finding per URL ("Linked from N pages"). `link_checks` stores `unverified` and `checked_via`. Tests pass `verifyInBrowser` to stub this.
    - `POST /api/scans` refuses private start URLs. Tests that crawl a local site set `SCAN_PRIVATE_ALLOWLIST: new URL(site.url).host`; `test/crawler-ssrf.test.ts` asserts an internal server is never reached.
  - **Limits and errors:** `createScan` enforces `MAX_QUEUED_SCANS`/`MAX_ACTIVE_SCANS_PER_USER` (429, inside the transaction). The runner stops scans after `SCAN_TIMEOUT_MINUTES` and stores only a safe failure message. The app error handler returns `Internal error` + `requestId` for non-`AppError`s (4xx Fastify errors keep their message). An `onSend` hook adds security headers to `/api/*` (`no-store` unless a route sets `cache-control`). Non-GET requests with a foreign `Origin` get 403 (the Vite proxy uses `changeOrigin: false` so `Host` matches). Logs redact cookie and authorization headers.
  - **Auth** (`src/auth/`, `routes/auth.ts`):
    - Local accounts in `users` (scrypt hashes, `name_key` = lower-cased name, unique) and `sessions` (only the token's SHA-256 is stored). The `user` CLI (`scripts/users.ts`) is the only way to add or change accounts.
    - `registerAuth` adds an `onRequest` hook: every `/api/*` route needs a session except `/api/health` and `/api/auth/login`. `/api/me` answers `{ user: null }` when signed out. Routes use `currentUser(req)` or `requireRole(req, 'rule_admin')` (`ForbiddenError` 403).
    - The cookie `pre_mlr_session` is HttpOnly, SameSite=Strict, and Secure when `COOKIE_SECURE`. `LoginThrottle` allows 5 failures per name per 15 minutes (in memory). Changing a password or role, or disabling a user, deletes their sessions.
    - **Tests:** `signIn(app, db, role, name)` in `test/helpers/auth.ts` creates a user, signs in through the real endpoint, and returns an `inject` that sends the cookie. Don't add an auth bypass to `src/`. In-process callers (the eval harness) use services like `createScan` directly.
  - **Rule library** (`src/rules/admin.ts`, `routes/rules.ts`):
    - Endpoints: `GET /api/rules` and `/api/rules/:id` (versions newest first with field `changes`, per-version scans and findings, and per-scan `usage`), `/audit`, `/versions/:v/yaml` (`ruleVersionYaml`). Admin-only: `POST /api/rules`, `/:id/versions` (needs `expectedLatestVersion`, 409 if stale, 400 if unchanged), `/retire`, `/restore`. `GET /api/scans/:id/rules` returns the scan's frozen snapshot.
    - Params are validated with `checkParamsProblems`, the same check the pack loader uses. App versions have origin `admin`.
    - `syncRulePack` skips (and reports in `skipped`) YAML that isn't newer than an app-edited latest version. Unbumped edits to pack-owned rules still throw.
  - `src/dev/static-server.ts` serves the test sites. It's used by tests, the demo script and the eval harness. `src/` must not import from `test/`, because the build only compiles `src/`.
  - Test fixtures live in `test/fixtures/`. `test/helpers/model.ts` seeds rules, scans and pages. `test/helpers/static-server.ts` serves them like a real web server (directory redirects to a trailing slash, `/x` → `x.html`, 404 page).
- `mlr-frontend/`: React 19 + Vite + React Router + TanStack Query + **AG Grid Community**. In dev, Vite proxies `/api` to `localhost:8000`, so API calls use relative `/api/...` URLs (`VITE_API_URL` overrides this). API calls live in `src/api/client.ts` and parse responses with the shared Zod schemas. Query hooks are in `src/api/queries.ts`, and mutations patch the cached findings list.
  - **AG Grid Community has no row grouping or set filter** (Enterprise only). Grouping by page is built in `src/review/model.ts` (`buildRows`: full-width group rows). Filtering is done in React before the rows reach the grid.
  - Keyboard access: the Actions column uses `suppressKeyboardEvent` (`keyboardIntoButtons`) so Tab and Enter reach its buttons. Enter or Space toggles group rows. Keep this working; `test/ui-e2e.test.ts` checks it.
  - Label `<select>`s with `htmlFor`/`id`, not a wrapping `<label>`, which would fold the option text into the accessible name.
  - **Sign-in:** `Layout` shows `LoginPage` while `useMe()` is null. Any 401 from a query or mutation re-checks `/api/me` (the `QueryCache`/`MutationCache` `onError` in `createQueryClient`). `fetch` uses `credentials: 'include'`. Show admin-only UI with `useIsRuleAdmin()`; the server enforces it anyway.
  - **Tests:** `mockApi` falls back to a signed-in author (`signedIn()`), no rules and an empty scan snapshot. Override `/api/me` with `{ user: signedIn({ role: 'rule_admin' }) }` or `{ user: null }`.
  - Rule pages: `RulesPage`, `RuleDetailPage` (`?version=N` shows an older version; settings changes render with `diffLines`), and `RuleEditPage` (settings as YAML via the `yaml` package). The new-scan form has `RulesForScan` (`overridesOf` sends only changes from the defaults), and the review page has `ScanRulesPanel`.
  - **Testing:** in jsdom, AG Grid ignores simulated selection, row focus and full user-event pointer sequences, and auto-height cells never measure. The grid renders all rows synchronously with auto-height off in test mode (`RENDER_ALL`, `AUTO_HEIGHT`). Tests use `fireEvent.click` for in-grid buttons. Anything relying on AG Grid's own event handling is tested in a real browser by `mlr-backend/test/ui-e2e.test.ts`, which starts the backend, a Vite server and the Examplin site.
- `packages/shared/` (`@pre-mlr/shared`): Zod schemas and types for API contracts, plus the `DISCLAIMER` constant. It is **consumed from `dist/`**, so it must be rebuilt after changes. `npm run dev` watches it; otherwise run `npm run build -w packages/shared`. Define API request and response shapes here, not separately in each app.

## What we're building: Pre-MLR Checker

An internal web tool for a pharma company. It crawls a website and runs a pre-MLR (Medical, Legal, Regulatory) check:

1. Crawl a given site and run layered rule checks.
2. Show recommendations in a review grid where a human author accepts, rejects, or edits each item. **The tool is advisory only. The human makes every final decision.**
3. Generate a PDF: title/scan details, then a site-map graphic, then every page screenshot (all desktop first, then all mobile), each with a side panel.
4. Use an LLM to suggest a correction tip per page, shown in the PDF side panel.
5. Later: a "precedent" layer of historic MLR review comments (proofing-tool exports) for trend context and similar past feedback.

## Architecture

Four layers, each feeding findings into one shared model:

- **(a) Deterministic rules engine:** checks such as ISI presence, PI/Med Guide links, alt text, broken links, and superlative phrase lists.
- **(b) LLM analysis layer:** per page, it sends text, screenshot, and the applicable `llm`-type rules, and gets back strictly schema-validated JSON (findings and one page tip).
- **(c) Precedent layer:** imported historic comments, classified to rule categories, retrieved by embedding similarity. Precedent has lower authority than rules and is always labeled advisory.
- **(d) Human review grid:** an AG Grid of findings with accept/reject/edit/comment and bulk actions.

## Key conventions

- **Rules are versioned data, not code.** The rule pack lives in YAML/JSON files with fields: id, version, title, category, severity, check_type (`deterministic` | `llm`), description, source citation, source URL, last_verified, and a prompt template for LLM rules. Swapping in company rules should only require a file change.
- **Every finding stores** the scan, page, rule id and **rule version**, evidence (text snippet and/or screenshot crop), suggested fix, status (`open` | `accepted` | `rejected` | `edited`), author comment, and who changed it and when. Old scans must keep referencing the rule versions they ran with.
- **An append-only audit log** records every status change, including "promote to rule candidate."
- **The LLM provider sits behind an `LLMProvider` interface** (Anthropic implementation plus a mock provider for tests). The model name and API key come from env vars. Prompt text lives in versioned files. Cache by page content hash, validate JSON against a schema, and retry once on failure.
- **LLM system prompt must state:** this is a prototype based on public sources only; the output is advisory, not legal advice; cite only the rule provided; never invent regulations or guidance; if unsure, return a low-confidence finding or none.
- **Required disclaimer text** goes in the UI and the PDF footer: "Prototype pre-review based on public sources. Advisory only; not a substitute for MLR review."
- **Crawler:** Playwright. It stays on the same domain, respects robots.txt, and skips duplicates and non-HTML links. It takes screenshots at desktop 1440px and mobile 390px, stored on disk. The site map uses the parent→child hierarchy, not every link, with home at the top.
- Show schemas and rule lists for review before implementing them (Prompts 5 and 6 require this).

## Stack

This replaces the build plan's Python/Next.js stack:

| Concern                  | Use                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| API                      | Fastify + TypeScript (not FastAPI)                                                                            |
| Validation and contracts | Zod (in `packages/shared`)                                                                                    |
| Database                 | Drizzle ORM + drizzle-kit migrations, better-sqlite3 in dev. Keep it Postgres-ready, with no SQLite-only SQL. |
| Crawler, screenshots     | Playwright (Node)                                                                                             |
| Site map (Prompt 3)      | `@hpcc-js/wasm-graphviz`, so there's no system Graphviz dependency                                            |
| PDF (Prompts 4, 11)      | Playwright `page.pdf()` from HTML templates                                                                   |
| Excel import (Prompt 12) | exceljs                                                                                                       |
| Frontend                 | React + Vite (not Next.js); AG Grid arrives in Prompt 8                                                       |
| Tests                    | Vitest everywhere; React Testing Library + jsdom in the frontend                                              |

Secrets go in `.env` only, with `.env.example` committed.

## Data constraints

- Prototype uses **public rules and fictional/public test data only**. Cite public sources (21 CFR 202.1, public FDA guidance), and add a TODO where a source is uncertain.
- The test site uses the fictional drug "Examplin" with planted flaws and an expected-findings file. Synthetic precedent data uses fictional brands only, and reviewer names are pseudonymized.
- No confidential AbbVie content or real company data until IT/security approves the LLM platform and data handling, and MLR process owners approve use of historic comments.
