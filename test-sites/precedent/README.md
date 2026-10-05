# Synthetic precedent data (fictional)

`synthetic-mlr-comments.xlsx` (and the identical `.csv`) holds 150 **fictional** MLR review comments in a generic proofing-tool export layout: Proof Name, Version, Page, Comment ID, Comment, Reviewer, Reviewer Function, Status, Date, Brand, Country.

- Brands (Examplin, Fictorex, Placebrin, Demovia), the company and every reviewer name are made up.
- Contact details use reserved `.example` and `555-01xx` values.
- No real company data is included.

The file was produced by `npm run precedent:generate -w mlr-backend`, which uses a fixed seed, so it's reproducible. About 20% of the comments are about topics no rule covers (tone, image rights, translation, formatting). The file also contains deliberate problems the importer must report:

- Row 21 has an empty comment.
- Row 46 has an impossible date.
- Row 81 has an unknown status.
- Row 111 has no brand.
- The last row duplicates row 11.

`synthetic-mlr-comments.labels.json` is an answer key giving each comment's intended category. It isn't part of the export, and it's used to test classification.

Import it with:

```sh
# needs PRECEDENT_PSEUDONYM_KEY in mlr-backend/.env (a secret; reviewer names are stored only as keyed pseudonyms)
npm run precedent:import -w mlr-backend -- --file ../test-sites/precedent/synthetic-mlr-comments.xlsx --site examplin.test --dry-run
```
