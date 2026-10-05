# Pre-MLR Checker

Internal prototype that crawls a website and runs an advisory pre-MLR (Medical, Legal, Regulatory) check. A human author makes every final decision.

> Prototype pre-review based on public sources. Advisory only; not a substitute for MLR review.
> Use public rules and fictional or public test sites only.

## Layout

| Folder               | What                                                              |
| -------------------- | ----------------------------------------------------------------- |
| `mlr-backend/`       | Fastify + TypeScript API, Drizzle ORM (SQLite in dev), Playwright |
| `mlr-frontend/`      | React + Vite + TypeScript single-page app                         |
| `packages/shared/`   | Zod schemas and types shared by both apps                         |
| `rule-packs/public/` | Public rule pack (YAML, one file per rule). See its README.       |
| `docs/`              | Build plan (`BUILD_PROMPTS.md`)                                   |

## Prerequisites

- Node.js 22 or newer (developed on Node 24) and npm.

## Setup

```sh
npm install                                  # installs all workspaces and builds packages/shared
npx -w mlr-backend playwright install chromium   # browser for crawling and screenshots
cp .env.example mlr-backend/.env             # optional: defaults work for local dev
npm run user -w mlr-backend -- add --name "Your Name" --role rule_admin   # asks for a password
```

There's no sign-up page: accounts are added from the command line (see **Accounts and roles**).

## Run

```sh
npm run dev
```

- Frontend: http://localhost:5173 (proxies `/api` to the backend)
- Backend: http://localhost:8000, health check at http://localhost:8000/api/health

Run one app with `npm run dev -w mlr-backend` or `npm run dev -w mlr-frontend`. While you edit, `packages/shared` rebuilds in watch mode as part of `npm run dev`.

## Test, lint, build

```sh
npm test            # both apps (Vitest)
npm run lint        # ESLint (backend), oxlint (frontend)
npm run typecheck
npm run build
npm run coverage    # tests with coverage; HTML reports in each app's coverage/ folder
```

Run a single test file or test name:

```sh
npm test -w mlr-backend -- health              # file name filter
npm test -w mlr-backend -- -t "reports ok"     # test name filter
npm test -w mlr-frontend -- App
```

## Database

SQLite at `mlr-backend/data/pre-mlr.db` (git-ignored). After you change `mlr-backend/src/db/schema.ts`:

```sh
npm run db:generate -w mlr-backend   # write a migration to mlr-backend/drizzle/
npm run db:migrate -w mlr-backend    # apply migrations
```

## How a scan works

`POST /api/scans` takes `{ startUrl, maxPages?, maxDepth?, product?: { brandNames, establishedName }, rules?: { enable, disable } }` and runs these steps:

1. Crawl the site with Playwright, taking desktop and mobile screenshots and recording text, links and page details.
2. Check links. This sends HEAD/GET requests to every linked URL, **including external sites**. Same-site URLs disallowed by robots.txt are skipped. Some sites (e.g. behind Cloudflare) refuse automated requests with 401/403/429; those links are re-checked by loading them in the crawler's browser. A link is reported broken only when it's really missing (404/410), the server fails, or it can't be reached. If a site still refuses, the link gets an _info_ note ("couldn't confirm automatically; open it to check"), once per link, not a broken-link finding.
3. Run the deterministic rules from the rule pack and record the findings.
4. If an LLM provider is configured, run the LLM rules page by page.
5. If embeddings are on, attach up to three similar past MLR comments to each finding (see below).

Endpoints: `GET /api/scans/:id`, `/pages`, `/sitemap.svg`, `/sitemap.png`, `/report.pdf`.

**Safety limits:**

- **No internal hosts:** scans can't reach private network addresses: loopback, private ranges, link-local and cloud metadata, and similar. That covers the start URL, every page, image, script and redirect hop the crawler's browser requests, link checks and robots.txt. To scan a local test site, list it in `SCAN_PRIVATE_ALLOWLIST` (for example `localhost:4100,127.0.0.1:4100`). See `docs/SECURITY.md`.
- **Queue limits:** at most `MAX_QUEUED_SCANS` (5) scans can be waiting or running at once, and `MAX_ACTIVE_SCANS_PER_USER` (2) per user. More are refused with a "try again" message.
- **Time limit:** a scan that runs longer than `SCAN_TIMEOUT_MINUTES` (30) is stopped and marked failed.

## LLM analysis (optional)

The rule pack's LLM rules (implied off-label use, risk/benefit balance) run only when you enable them:

```sh
LLM_PROVIDER=mock npm run dev                                   # offline, deterministic stand-in
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run dev         # Claude (default claude-opus-5-5, effort high)
```

With `anthropic`, each page's text and a scaled desktop screenshot go to the Anthropic API. **Use public or fictional sites only.**

- Each page gets structured findings (rule, evidence quote, explanation, suggested rewrite, confidence) and a short page tip.
- Output is checked before anything is saved. Quotes must appear verbatim on the page, only the given rules can be cited, and severity is capped at the rule's. Invalid output is retried once.
- Results are cached by page content, so re-scanning an unchanged page makes no API call.
- Token usage and estimated cost are stored per page in `llm_analyses`.
- Prompts are versioned files in `mlr-backend/prompts/page-analysis/`.

## Model evaluation

The harness crawls the Examplin site once, then runs the LLM layer with each configured model and scores its findings against `test-sites/examplin/expected-findings.yaml`. It reports precision, recall, false positives and misses, failed pages, latency, tokens and cost per scan.

```sh
npm run eval -w mlr-backend                                     # default list: mock only (free)
npm run eval -w mlr-backend -- --models opus-high,sonnet --runs 3 --yes --max-cost-usd 5
```

- **Models:** they're listed in `mlr-backend/eval/models.yaml` (id, provider, model, effort, fallback). Add a line there to evaluate another model.
- **Paid runs:** models that call the Anthropic API run only with `--yes`. The harness prints an estimate first, and stops starting new runs once actual spend passes `--max-cost-usd`.
- **Reports:** written to `eval-results/` (git-ignored) as Markdown, listing every false positive and miss, plus JSON.
- **Small test set:** Examplin currently plants only two LLM-detectable flaws, so precision and recall can only move in large steps. Add more cases to the test site for finer comparisons.

## Precedent comments (historic MLR feedback)

Import a proofing-tool comment export (.xlsx or .csv) into the `precedents` table:

```sh
npm run precedent:import -w mlr-backend -- --file <export.xlsx> --site <host> [--mapping default] [--dry-run] [--strict]
```

- **Columns:** they're matched through a mapping file in `mlr-backend/precedent/mappings/`. Copy `default.yaml` to support another export layout.
- **Bad rows:** rows with an empty comment, invalid date, unknown status or missing brand are skipped and listed by row number. `--strict` aborts the whole import instead.
- **Re-imports:** importing the same rows again adds nothing.
- **Privacy:** reviewer names are replaced by keyed pseudonyms (`PRECEDENT_PSEUDONYM_KEY`, required). Emails and phone numbers in comment text are redacted. **Names mentioned inside comment text aren't detected**, so check real data before importing it.
- **Test data:** a fictional test dataset is in `test-sites/precedent/`. Use no real company data until approved.

### Classification and trends

Classify the imported comments against the rule pack's categories, then open **Precedent trends** (http://localhost:5173/precedents):

```sh
npm run precedent:classify -w mlr-backend -- --provider mock      # offline keyword stand-in
npm run precedent:classify -w mlr-backend -- --provider anthropic --yes [--model claude-opus-5-5] [--max-cost-usd 2]
npm run precedent:classify -w mlr-backend -- --provider mock --labels ../test-sites/precedent/synthetic-mlr-comments.labels.json
```

- **What's stored:** each comment gets a category (or "no matching rule"), the closest rule if one fits, a confidence and a short topic. Comments are sent in batches of 20. Invalid answers are retried once, and anything still invalid is stored as unclassified rather than guessed.
- **Re-runs:** comments already classified with the same provider, model, prompt version and rule pack are skipped. Use `--force` to redo them. Every change of category is written to the audit log.
- **Paid runs:** `--provider anthropic` prints a cost estimate and refuses to run without `--yes`. It sends comment text (never reviewer names) to the API, so use fictional or approved data only.
- **Scoring:** `--labels` compares the results with an answer key. The mock scores 100% on the synthetic set because its keywords were written for it; that number checks the pipeline, not a model.
- **Dashboard:** comment counts by category over time (one small chart per category, by month or quarter), by brand and by reviewer function, plus **candidate new rules**: recurring themes among comments no rule covers, grouped by text and topic similarity. All of it is advisory context with less authority than the rules.

### Similar past comments on findings

As the last scan step, each finding gets up to three historic comments that are similar to it:

- **Which comments:** only those classified into the **same category** as the finding's rule, from the last `PRECEDENT_MAX_AGE_MONTHS` (36). Comments from the scan's brand or site rank slightly higher. Near-identical repeats are shown once, and weak matches are left out rather than shown.
- **Similarity:** sentence embeddings from a small local model (`EMBEDDINGS=local`). It is downloaded once (about 23 MB) into `DATA_DIR/models`, and no text leaves the machine. Run `npm run precedent:embed -w mlr-backend` after an import to download it and embed every comment ahead of the first scan. `EMBEDDINGS=hash` is an offline word-overlap fallback.
- **Where they show:** the review grid's detail panel ("Similar past MLR comments"), and up to two per page in the PDF side panel ("Past MLR feedback"). Both are labelled advisory, with less authority than the rules.
- **Promote to rule candidate:** rule admins see this action on each past comment and on each recurring theme on the trends page. It records a proposal (shown under **Rule candidates** on the trends page) and writes it to the audit log. It doesn't create a rule.

## Reviewing findings

Open http://localhost:5173. Start a scan, then select it to open the review grid:

- Filter by severity, status, category, page or text. Grouping by page is on by default.
- **Accept**, **Reject**, **Edit fix** or **Comment** on each finding, or select several and use the bulk actions.
- The side panel shows the page screenshot with the evidence highlighted, the rule's source and the change history.

The PDF (**Download PDF**) reflects the review at the moment you download it:

- A findings summary (by severity, status and category).
- Each page's tip and findings beside its screenshots, with numbered evidence markers on the desktop view, author decisions and edited fixes.
- A full findings list at the end.

Rejected findings are left out and only counted.

Every change is written to the audit log under the signed-in user's name. If someone else changed a finding first, you're told and shown their version. Nothing is overwritten.

## Accounts and roles

Everyone signs in with a name and password. Every API route except the health check and sign-in needs a session.

| Role         | Can                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `author`     | Run scans, review findings, download reports, view rules and precedent trends.                      |
| `rule_admin` | Everything an author can, plus create, edit, retire and restore rules, and promote rule candidates. |

```sh
npm run user -w mlr-backend -- add --name "Pat Author" --role author      # prompts for a password (12+ characters)
npm run user -w mlr-backend -- passwd --name "Pat Author"
npm run user -w mlr-backend -- role --name "Pat Author" --role rule_admin
npm run user -w mlr-backend -- disable --name "Pat Author"                # or enable
npm run user -w mlr-backend -- list
```

- Passwords are stored only as scrypt hashes. `--password-stdin` reads a password from stdin for scripts. Passwords are never taken as command-line arguments.
- Sessions use an HttpOnly, SameSite=Strict cookie that lasts `SESSION_TTL_HOURS` (12). Set `COOKIE_SECURE=true` anywhere that isn't local http. Only a hash of the session token is stored.
- A new password, a role change or disabling an account signs that user out everywhere. After 5 failed sign-ins for a name, sign-in is refused for 15 minutes.
- Account changes are written to the audit log.

## Rule library

**Rules** in the app lists every rule with its category, severity, check type, on-by-default setting, latest version and how many scans and findings used it.

- **Rule page:** the current (or a chosen) version, every version with what changed, which scans used which version, and the history. "Download YAML" gives a version in the rule-pack file format.
- **Editing (rule admins):** saving always creates a new version. Settings are edited as YAML and validated like the pack. If someone else saved first, the save is refused and you reopen the latest version. **Retire** leaves a rule out of new scans. Old scans and their findings keep the versions they ran with.
- **Per scan:** "Rules for this scan" on the new-scan form turns rules on or off for that scan only. "Rules used" on the review page shows the versions a scan ran with. Each finding links to the exact rule version that produced it.
- **Rule pack files vs the app:** the pack in `rule-packs/` still loads at startup. If a rule was edited in the app, a YAML version that isn't newer is skipped, and a startup warning lists it. To bring the files up to date, download the app's version as YAML and commit it. A newer YAML version is loaded as usual.

## Demo site

`npm run serve:examplin` serves the fictional Examplin site at http://localhost:4100. Because it runs on your machine (a private address), add it to the allowlist in `mlr-backend/.env` first: `SCAN_PRIVATE_ALLOWLIST=localhost:4100,127.0.0.1:4100`. See `test-sites/examplin/README.md` for a ready-made scan request.

## Configuration

See `.env.example`. Secrets only go in `.env` files, which are git-ignored. `docs/SECURITY.md` has the security review, residual risks and deployment notes.
