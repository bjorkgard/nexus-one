# Project rules

These rules apply to this repo and win over global rules when they conflict.

## Review plans

Every plan review (`/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/plan-devex-review`, `/autoplan`, or any other review that produces a working plan and report) stores its plan file in `docs/plans/`.

- **File name:** `docs/plans/<task-id>-<slug>.md`, using the `docs/PLAN.md` task id. Example: `docs/plans/1.1-install-stack.md`. For work outside `docs/PLAN.md`, use `<issue-number>-<slug>.md`.
- **One file per task:** later reviews of the same task append to that file, above its `## GSTACK REVIEW REPORT`. Do not create a second file.
- **Commit:** the file is committed with the task's branch.
- **Task buckets:** `.claude/scratch/<slug>/` keeps only STATE, FINDINGS, DECISIONS, `briefs/` and `reports/`. Briefs and reports may link to the plan file in `docs/plans/`, but must not keep their own copy of it.
