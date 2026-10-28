# Project rules

These rules apply to this repo and win over global rules when they conflict.

## Review plans

Every plan review (`/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/plan-devex-review`, `/autoplan`, or any other review that produces a working plan and report) stores its plan file in `docs/plans/`.

- **File name:** `docs/plans/<task-id>-<slug>.md`, using the `docs/PLAN.md` task id. Example: `docs/plans/1.1-install-stack.md`. For work outside `docs/PLAN.md`, use `<issue-number>-<slug>.md`.
- **One file per task:** later reviews of the same task append to that file, above its `## GSTACK REVIEW REPORT`. Do not create a second file.
- **Commit:** the file is committed with the task's branch.
- **Task buckets:** `.claude/scratch/<slug>/` keeps only STATE, FINDINGS, DECISIONS, `briefs/` and `reports/`. Briefs and reports may link to the plan file in `docs/plans/`, but must not keep their own copy of it.

## TODOS and issues

Every entry in `TODOS.md` has a matching GitHub issue. Whenever you add a TODO (by hand or from `/ship`, `/review`, a plan review or any other skill), create its issue in the same change.

- **Title:** `[TODO <task-id>] <TODO heading>`, where `<task-id>` is the `docs/PLAN.md` task the TODO belongs to or must land before. Use `<phase>.x` for a new step that has no task yet.
- **Labels:** `todo`, the phase label (`phase-N`) and the priority (`P1`, `P2`, ...). Create a missing priority label rather than skipping it.
- **Body:** a link to `TODOS.md`, a `**Plan link:**` line naming the related task issues (`#N`) and dependencies, then the TODO's What, Why, Context, Effort, Priority and Depends on, copied verbatim.
- **Parent:** when the TODO is part of an open task or must land before one, add it as a sub-issue of that task's issue: `gh api -X POST repos/bjorkgard/nexus-one/issues/<parent>/sub_issues -F sub_issue_id=<issue id>` (the numeric `id`, not the issue number). Follow-ups of closed tasks get no parent; name the closed task in the Plan link line.
- **Back-link:** add `**Issue:** [#N](<issue url>)` directly under the TODO heading in `TODOS.md`.
- **Completing:** when a TODO moves to `## Completed`, close its issue with the PR that did the work.
