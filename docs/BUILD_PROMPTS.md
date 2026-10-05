# Pre-MLR Checker: Claude Code Build Prompts

Put this file in your repo (e.g. `docs/BUILD_PROMPTS.md`). Run the prompts in order, one at a time. After each one: run the tests, run the app, commit to git, then continue. Use `/clear` between phases.

## Master runner prompt (use this instead of pasting everything)

```
Read docs/BUILD_PROMPTS.md. We will work through it one numbered prompt at a time, in order. Start with Prompt 0. For each prompt: (1) show a short plan and wait for my OK, (2) implement it, (3) run the tests and the app, (4) summarise what works and what doesn't, (5) STOP and wait for me to say "next". Never start the next prompt on your own.
```

To resume later: "Read docs/BUILD_PROMPTS.md and tell me which prompts appear to be done based on the repo, then propose the next one."

## Ground rules

- Prototype uses public rules and fictional or public test sites only. No confidential AbbVie content until IT approves an LLM platform and data handling.
- The tool is advisory. A human author makes every final decision.

---

## Phase A: Foundation

### Prompt 0: Project context (run `/init` first)

```
I'm building an internal web tool called "Pre-MLR Checker" for a pharma company. It scans a website and does a pre-MLR (Medical, Legal, Regulatory) check. Write these goals into CLAUDE.md along with our conventions:

1. Crawl a given website and run layered rule checks.
2. Show recommendations in a grid where a human author accepts, rejects, or edits each item. The tool is advisory only; the human makes the final decision.
3. Generate a PDF: a site-map graphic first, then every page screenshot (all desktop first, then all mobile).
4. Use an LLM to suggest a correction tip per page, shown in a side panel in the report.
5. Later, add a "precedent" layer: historic MLR review comments (exported from a proofing tool) that give trend context and similar past feedback.

Architecture: (a) deterministic rules engine, (b) LLM analysis layer, (c) precedent layer, (d) human review grid. Rules are versioned data, not hard-coded logic. Every finding stores rule source, severity, evidence, suggested fix, and the author's decision, with an audit trail.

Stack: Python + FastAPI + Playwright backend, SQLite for dev (Postgres-ready), Next.js + TypeScript frontend with AG Grid. The LLM provider must sit behind an interface so it can be swapped. Never commit secrets; use .env. Prototype uses public rules and fictional data only.
Don't write code yet. Show me the CLAUDE.md for approval.
```

### Prompt 1: Scaffold

```
Plan first, then scaffold the monorepo: /backend (FastAPI), /frontend (Next.js), /docs. Add a README with run instructions, a .gitignore, an .env.example, a health-check endpoint, and a basic test setup for both sides. Make sure both apps start locally.
```

## Phase B: Scan, site map, PDF (first demo)

### Prompt 2: Crawler and screenshots

```
Build the crawler in the backend using Playwright. Input: a start URL, max pages, and max depth. It should stay on the same domain, respect robots.txt, skip duplicates and non-HTML links, and record each page's URL, title, extracted visible text, links, and parent page. For every page, take a full-page screenshot at desktop (1440px wide) and mobile (390px wide), and store them on disk. Save everything in the database as a "scan" with pages. Add API endpoints to start a scan and check its status, and tests against a local static test site.
```

### Prompt 3: Site-map graph

```
From the scan's page and link data, build a site-map graph (parent to child hierarchy, not every link). Render it as an image (SVG and PNG) using Graphviz or similar, with readable page labels and the home page at the top. Add an endpoint that returns the image and a test.
```

### Prompt 4: PDF report (screenshots only)

```
Build the PDF generator: page 1 title and scan details, page 2 the site-map graphic, then all desktop screenshots (one per PDF page with URL and title as a heading), then all mobile screenshots in the same way. Leave a reserved side panel area on each screenshot page for notes (empty for now). Add an endpoint to download the PDF, and test it on a small site.
```

**Checkpoint: demo this to yourself or a colleague before continuing.**

## Phase C: Rules and review grid

### Prompt 5: Data model and rules framework

```
Design the rule and finding model. Rules are stored as versioned data with: id, title, category (e.g. safety info, references, claims, branding, accessibility), severity, description, source/citation of the rule, and a check type (deterministic or llm). Findings store: scan, page, rule id and version, evidence (text snippet and/or screenshot crop path), suggested fix, status (open, accepted, rejected, edited), author comment, who changed it and when. Add migrations, an append-only audit log of every status change, and tests. Show the schema for review before implementing.
```

### Prompt 6: Public rule pack and deterministic checks

```
Create a "public rule pack" as versioned data files (YAML or JSON), not code. Each rule has: id, version, title, category, severity, check_type (deterministic or llm), description, source citation, source URL, last_verified date, and for LLM rules a prompt template. Seed it with about 15 rules for pharma website pre-review covering: Important Safety Information presence and prominence, links to Prescribing Information and Medication Guide (present and not broken), adverse-event reporting statement, unreferenced efficacy or numeric claims, superlative/absolute language (editable phrase list), implied off-label use, comparative claims, risk-versus-benefit prominence balance, trademark usage, footer/date/privacy links, alt text, and broken links. Cite public sources only (21 CFR 202.1 and public FDA guidance), and add a TODO where you are unsure of the source. Load the pack into the rules engine, implement the deterministic checks with tests, and show me the full rule list for review before implementing.
```

### Prompt 7: Fictional test site with planted flaws

```
Create a small static test website of 6 to 8 pages for a fictional drug, "Examplin", with deliberately planted problems that match each rule in the pack: a missing ISI on one page, a broken Prescribing Information link, an unreferenced numeric claim, the word "best", tiny low-contrast risk text, and an image with no alt text. Add an expected-findings file listing what the checker should flag, and a test that runs a scan against it and compares results. Use a fictional drug and company only.
```

### Prompt 8: Findings API and review grid

```
Build the review UI. Frontend: a scan list page, then a scan detail page with an AG Grid of findings, with columns for page, rule, category, severity, evidence, suggested fix, and status. Add filters, grouping by page, and row actions: Accept, Reject, Edit suggested fix, and add comment. Include bulk actions and a side preview showing the page screenshot with the evidence location if available. Every change calls the API and writes to the audit log. Show a visible disclaimer: "Prototype pre-review based on public sources. Advisory only; not a substitute for MLR review." Keep it simple and accessible.
```

## Phase D: LLM layer

### Prompt 9: LLM analysis

```
Add the LLM layer. Create an LLMProvider interface with an Anthropic implementation, with the model name and API key configured by environment variables. For each page, send the page text, the screenshot, and the applicable LLM-type rules, and ask for strictly structured JSON: a list of findings (rule id, severity, evidence quote, explanation, suggested rewrite, confidence) plus one short "page tip" summary. Validate the JSON against a schema and retry once on failure. Add caching per page content hash, rate-limit handling, a mock provider for tests, and prompt text stored in versioned files. The system prompt must say: this is a prototype based on public sources only, the output is advisory and not legal advice, cite only the rule provided, never invent regulations or guidance, and if unsure return a low-confidence finding or none.
```

### Prompt 10: Model evaluation harness

```
Build an evaluation script that runs the Examplin test site through the LLM layer using a configurable list of models, then compares each model's findings to the expected-findings file. Report precision, recall, false positives, latency, and cost per scan in a table. Make the model list configurable so I can add models later.
```

### Prompt 11: Tips in the PDF

```
Update the PDF so each page's tip and its findings appear in the side panel next to that page's screenshot (desktop first, then mobile), with severity indicators. Add a summary page after the site map with counts by severity and category. Include only findings that haven't been rejected, and show author decisions where they exist. Add the footer disclaimer: "Prototype pre-review based on public sources. Advisory only; not a substitute for MLR review." Test with sample data.
```

## Phase E: Precedent layer (historic MLR feedback)

### Prompt 12: Synthetic data and ingestion

```
Create a precedent-ingestion module. First, generate a realistic synthetic dataset of 150 fictional MLR review comments in an Excel layout like a proofing-tool comments export (columns such as proof name, page, comment text, reviewer function, status, date, brand, country), for fictional brands only. Then build an importer that reads Excel or CSV files, validates columns with a configurable column mapping, pseudonymizes reviewer names, and stores the comments in a "precedent" table linked to site, brand, and date. Add tests. Do not use any real company data.
```

### Prompt 13: Classification and trends

```
Add a classification step that maps each precedent comment to a rule category in our rule pack using the LLM provider interface (with the mock provider for tests), storing the category, a confidence score, and a "no matching rule" flag. Build a trends endpoint and a simple dashboard showing frequency by category over time, by brand, and by reviewer function. Add a report of recurring "no matching rule" clusters as candidate new rules.
```

### Prompt 14: Retrieval in the grid

```
When a finding is created, retrieve the top 3 similar precedent comments (embedding similarity plus filters for category and recency) and attach them to the finding as "Precedent" evidence with source site, date, reviewer function, and outcome. Show them in the review grid's detail panel and in the PDF page tip, clearly labeled advisory and lower authority than rules. Include a "promote to rule candidate" action visible only to rule admins, with an audit log entry.
```

## Phase F: Administration and hardening

### Prompt 15: Rule library management

```
Add a rule management screen: list, create, edit, and version rules; enable or disable them per scan; and see which rule version produced which finding. Add role-based access (author vs rule-admin) with simple authentication, and make sure old scans keep referencing the rule versions they were run with.
```

### Prompt 16: Hardening

```
Review the whole project for security and quality: input validation, SSRF protection on the crawler (block internal IPs and unsafe schemes), file path safety, secrets handling, error handling and logging, concurrency limits on scans, and test coverage. Produce a checklist of risks and fix the high-priority ones. Update the README and docs.
```

---

## Handy prompts between steps

- After each step: `Run the tests and the app, then summarise what works and what doesn't.`
- When stuck: `Reproduce this error, explain the root cause, then fix it with the smallest change.`
- Before merging: `Review the diff as a strict code reviewer and list issues by severity.`

## Before using real AbbVie data

- Get IT/security approval for the LLM platform and where data is stored.
- Get permission from the MLR process owners for historic comments.
- Replace the public rule pack with the company's approved rules (it is data, so this is a file change).
