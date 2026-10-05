# Examplin test site (fictional)

A static 8-page website for a **fictional** drug, Examplin® (examplitide), from the fictional "Fictional Pharma Co." Each page carries a "Fictional product and company, created for software testing" banner. External links use the reserved `.invalid` domain, so they never reach a real site.

Each page plants specific flaws, listed in an HTML comment at the top of the file. `expected-findings.yaml` lists what the checker should flag:

- `rules_engine` entries must match exactly. `mlr-backend/test/examplin.test.ts` crawls the site and fails on any missing or unexpected finding.
- `llm` entries are scored by the evaluation harness (Prompt 10).
- `cleanPages` must produce no findings.
- Every rule in the public pack must have at least one expected entry.

## Use it

The site runs on your machine, which is a private address, so allow it in `mlr-backend/.env` first: `SCAN_PRIVATE_ALLOWLIST=localhost:4100,127.0.0.1:4100`. Then start a scan from the app (enter `http://localhost:4100/`, the brand names below, and tick the Medication Guide rule under "Rules for this scan"), or with curl:

```sh
npm run serve:examplin        # http://localhost:4100
# Sign in (an account made with `npm run user -w mlr-backend -- add ...`), keeping the session cookie.
curl -c /tmp/pre-mlr.cookies -X POST localhost:8000/api/auth/login -H 'content-type: application/json' \
  -d '{ "name": "Your Name", "password": "your password" }'
curl -b /tmp/pre-mlr.cookies -X POST localhost:8000/api/scans -H 'content-type: application/json' -d '{
  "startUrl": "http://localhost:4100/",
  "product": { "brandNames": ["Examplin"], "establishedName": "examplitide" },
  "rules": { "enable": ["med-guide-link"] }
}'
```

## Changing it

Edit the HTML directly. When you add a rule to the pack, plant a flaw here and add an expected entry. When you change a page, update `expected-findings.yaml`.
