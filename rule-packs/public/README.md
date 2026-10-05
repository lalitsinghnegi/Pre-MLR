# Public rule pack

Rules are data. Each file in `rules/` is one rule. The backend loads the pack at startup (`RULE_PACK_DIR`).

## Changing a rule

Edit the file **and increase `version`**. Loaded versions can't be changed. Loading a changed rule under an existing version fails at startup, and identical reloads are ignored. Scans keep the rule versions they ran with.

## Fields

| field        | notes                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `id`         | kebab-case, and must match the file name                                                                              |
| `version`    | integer, increases on every change                                                                                    |
| `category`   | `safety_information`, `fair_balance`, `claims`, `references`, `branding`, `links`, `legal_privacy` or `accessibility` |
| `severity`   | `critical`, `major`, `minor` or `info`                                                                                |
| `check_type` | `deterministic` (runs `params.check`) or `llm` (uses `prompt_template`, from Prompt 9)                                |
| `source`     | `citation`, `url`, `note` (caveats and TODOs) and `last_verified` (only set when the URL was opened and checked)      |
| `params`     | for deterministic rules: `check` plus that check's settings (see `mlr-backend/src/checks/registry.ts`)                |

Check types are `required-heading`, `section-readability`, `required-link`, `required-text`, `phrase-list`, `numeric-claims`, `alt-text`, `brand-names` and `link-health`. Adding a rule of an existing type needs no code.
