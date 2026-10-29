# Fence and packaged-boot hardening (#95, #98, #111)

Branch: `chore/95-98-111-fence-and-boot-hardening` (from `main` at `c40a508`).
Source: TODOS.md entries for issues #95, #98 and #111. All three are P2 follow-ups of closed tasks (1.2 and 1.7). #111 depended on #106, which is closed (packaged boot runs in CI, `.github/workflows/ci.yml:59-63`).

## Plan under review

1. **#95** Add two rows to `configRows` in `lint/module-fences.test.js:222`: `collector/` importing `react` (expect `eslint(no-restricted-imports)` with the browser-libraries message, `vite.config.ts:33`) and `src/` importing `electron` (expect `eslint(no-restricted-imports)` with the src message, `vite.config.ts:27`). One `.txt` fixture each under `lint/fixtures/`, copied to a `__wiring_*` path that `.gitignore:39-43` covers.
2. **#98** Eight hardening items for `lint/module-fences.js` and the staged hook (`vite.config.ts:38-52`), each with a RuleTester or wiring case:
   1. Full check when `tsconfig.json` or `package.json` is staged.
   2. Root-absolute specifiers checked against a fixed folder list, not the disk (`lint/module-fences.js:116-119`).
   3. Relative specifiers resolved from the importer's real path when the importer is a symlink (`lint/module-fences.js:111`).
   4. Fail loudly for a file outside the repo root (`zoneOf` returns null for `../...`, `lint/module-fences.js:58`).
   5. Cover `import.meta.resolve(...)` like `new URL(..., import.meta.url)`.
   6. Confirm `no-restricted-imports` group semantics for nested names and type-only imports.
   7. On case-sensitive file systems, test root entries before lower-casing (`lint/module-fences.js:118`).
   8. Leftover `__wiring_*` scratch files can fail a full check.
3. **#111** In `e2e/packaged.spec.ts:29-36`, `assertBooted` also asserts no `[role=alert]`, as `e2e/smoke.spec.ts:30` does, and the assertion is proven to fail against a packaged build whose renderer cannot start.

## Pre-review audit

- Branch is fresh from `main`; no stashes, no other branches, no in-flight PRs.
- Recently touched: `lint/module-fences.test.js` (10 commits in 30 days), `lint/module-fences.js` (6), `vite.config.ts` (17). These files are the hot spot of the repo's tooling; 1.2 needed three /ship runs to close bypasses. Recurring area: the fence rule has had repeated edge-case rounds. Treat each new resolution rule as a possible new bypass.
- Prior learnings applied: `oxlint-github-format-drops-messages` (wiring rows must keep `--format=default`), `lexical-containment-misses-symlinks` (symlink handling in the fence), `vp-check-formats-plan-markdown` (run `vp check --fix` on this file before commit).
- Design doc: `~/.gstack/projects/bjorkgard-nexus-one/nathanael-main-design-20261026-125434.md` is the product-level doc; it has no section for these follow-ups.
- Landscape: Chromium's `--disable-3d-apis` is documented as disabling WebGL; Electron docs steer GPU-off toward `app.disableHardwareAcceleration()` (web search, unverified). The probe below shows `--disable-3d-apis` does not turn WebGL off in this packaged build.

### Probes (run 2026-10-29 on this branch, packaged build `release/mac-arm64` from Oct 29 00:07)

| ID  | Command                                                                                         | Result                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | leftover `src/ui/__wiring_bad.ts` (fixture `cross-zone.txt`), `vp lint`                         | `Found 0 warnings and 0 errors` (gitignored file skipped)                                                                                                     |
| P2  | same file, full `vp check`                                                                      | exit 0: format, lint and type check all pass (48 files)                                                                                                       |
| P3  | same file, `tsc --noEmit -p tsconfig.json` (the `build` script's second step, `package.json:9`) | `error TS2307: Cannot find module '../../collector/x'`, exit 2                                                                                                |
| P4  | packaged app via Playwright `_electron.launch`, `args: ["--disable-3d-apis"]`                   | switch reaches `app.commandLine`, WebGL and WebGL2 contexts still created, no alert                                                                           |
| P5  | `args: ["--disable-webgl", "--disable-webgl2"]`                                                 | WebGL still available, no alert                                                                                                                               |
| P6  | `args: ["--disable-gpu", "--disable-software-rasterizer"]`                                      | no WebGL; alert "WebGL is unavailable: THREE.WebGLRenderer: Error creating WebGL context."; canvas not visible; 5 console errors; 5 `[renderer]` stderr lines |

### Premise table

| Premise          | Claim                                                                     | Receipt                                                                                                                                                                                                         | Verdict                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| #111 silent case | "A WebGL startup failure that logs nothing would pass CI's packaged step" | P6; `src/App.tsx:29-31` logs every caught error; the boundary replaces `<Canvas>` (`src/App.tsx:34-46`) so `assertBooted`'s canvas check (`e2e/packaged.spec.ts:30`) already fails                              | **finding**: the box path is never silent today. Existing test fails 3 ways under P6. The new assertion is a 4th, redundant signal for this build |
| #111 proof       | assertion can be proven against a non-starting renderer                   | P6                                                                                                                                                                                                              | verified: GPU-off launch gives the real box                                                                                                       |
| #98.8            | leftover scratch files fail a full pre-commit check                       | P1, P2, P3                                                                                                                                                                                                      | **finding**: pre-commit `vp check` ignores them; `tsc` in `vp run build` and `vp run pack` fails                                                  |
| #98.1            | staged-only type check misses broken unchanged importers                  | `vite.config.ts:42-51`; CI runs full `vp check` (`.github/workflows/ci.yml:50`)                                                                                                                                 | unverified locally (not probed); CI already catches it, so the gap is local-only                                                                  |
| #98.5            | `import.meta.resolve` is unchecked                                        | `lint/module-fences.js:215-229` handles only `require`, `import.meta.glob`, `createRequire`; `import(import.meta.resolve(...))` is NON_STATIC (`lint/module-fences.test.js:155`) but a bare call is not checked | verified by static read                                                                                                                           |
| #98.4            | outside-repo file is silently unchecked                                   | `toRepoPath` gives `../...`; `zoneOf` returns null (`lint/module-fences.js:58`)                                                                                                                                 | verified by static read                                                                                                                           |
| #95              | the two config fences have no wiring row                                  | `lint/module-fences.test.js:222-289` has no collector-react or src-electron row                                                                                                                                 | verified                                                                                                                                          |

unverified=1

## Decision ledger

| ID and owner                               | Contract and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Current                               | Proposed                                                                                                                                                            | Status   | Exact approval and scope                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 / #111 approach (reviewer)              | #111 asks for a no-alert assertion plus proof it fails on a non-starting renderer. P6 shows the box path already fails the test 3 ways                                                                                                                                                                                                                                                                                                                                                                                  | Issue text: add assertion, prove once | A) assertion + permanent GPU-off packaged test expecting the box; B) assertion only, P6 as the recorded one-off proof; C) close #111 as covered by existing checks  | approved | User answer D1: "Assertion + GPU-off test (recommended)"; scope: no-alert check in `assertBooted` plus one packaged test launched with `--disable-gpu --disable-software-rasterizer` that expects the "WebGL is unavailable" box                                                                                    |
| D3 / #98.2 root-absolute check (Section 1) | `lint/module-fences.js:116-119` asks the disk whether the first segment exists; `/dist/x` flips after `vp run build`. Tracked root entries today: `.github .gitignore .gstack .vite-hooks .vscode AGENTS.md CHANGELOG.md CLAUDE.md README.md TODOS.md collector docs e2e electron index.html lint package-lock.json package.json playwright.config.ts playwright.electron.config.ts src test tsconfig.json vite.config.ts`; untracked outputs: `dist dist-electron release node_modules test-results playwright-report` | disk check                            | A) fixed list of all tracked roots + known output dirs, guard test vs `git ls-files`; B) keep disk check, also always fence a fixed output-dir list; C) leave as is | approved | User answer D3: "Fixed list + guard test (recommended)"; scope: replace the `fs.existsSync` root check with a fixed lower-case set of tracked roots plus `dist`, `dist-electron`, `release`, `node_modules`, `test-results`, `playwright-report`, and a `vp test` guard comparing it to `git ls-files` root entries |

## Answered decision (D1)

Commitment comparison:

```text
Commitment                              | Source            | Current      | A            | B            | C
assertBooted asserts no [role=alert]    | #111 What         | planned      | yes          | yes          | no
proof the assertion can fail            | #111 What         | planned      | in CI, every run | P6 record only | P6 record only
packaged boundary shows readable box    | none (new)        | untested     | tested in CI | untested     | untested
extra packaged launch in CI             | -                 | 0            | 1 (~5 s)     | 0            | 0
#111 closed by this branch              | CLAUDE.md TODOS   | yes          | yes          | yes          | yes (as covered)
```

Question: D1 — D1: How should #111 prove the packaged app's WebGL error box is caught?
Header: #111 proof
A) Assertion + GPU-off test (recommended)
Add the no-alert check to assertBooted and a second packaged test that launches with `--disable-gpu --disable-software-rasterizer` and expects the "WebGL is unavailable" box. Effort S, risk low.
B) Assertion only
Add the no-alert check to assertBooted; record probe P6 in this plan as the one-time proof. Effort S, risk low.
C) Close #111 as covered
Change no test; close #111 citing P6 (canvas, console and stderr checks already fail). Effort S, zero implementation work, risk low.

Actual answer: A "Assertion + GPU-off test (recommended)" (D1).

## Step 0 (HOLD SCOPE)

Mode: HOLD SCOPE (answer D2: "HOLD SCOPE (recommended)"). No expansions; no deferrals proposed.

**Complexity check.** Estimated 11-13 changed files (estimate): `lint/module-fences.js`, `lint/module-fences.test.js`, 2 new fixtures, `vite.config.ts`, `tsconfig.json`, `e2e/packaged.spec.ts`, `TODOS.md`, this plan, plus `/ship`'s version bump and changelog. Above 8, but each file is a one-purpose edit and no new module or service is added. The minimum change set is the three issues as written; nothing is deferrable without re-deferring an owner-scheduled item.

**More probes (2026-10-29)**

| ID  | Command                                                                                                                 | Result                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| P7  | `vp lint` on `src/shared/__wiring_t1.ts` with `import type { ReactNode } from "react"`                                  | `eslint(no-restricted-imports)` reported: type-only imports are banned   |
| P8  | same, `import { jsx } from "react/jsx-runtime"`                                                                         | reported: nested names match `react/**`                                  |
| P9  | same, `export type T = import("react").ReactNode`                                                                       | **not reported** (`Found 0 warnings and 0 errors`)                       |
| P10 | `tsconfig.json` with `"exclude": ["src/**/__wiring_*", "src/ui/__fence_link__"]`, leftover `src/ui/__wiring_node_fs.ts` | `tsc --noEmit` exit 0; `vp lint` on that file still reports its 2 errors |

**Temporal interrogation**

- Hour 1: the fence rule is an oxlint JS plugin (`lint/module-fences.js`); RuleTester cases run in `vp test`; wiring rows spawn real `vp lint --format=default`. `.gitignore:39-43` already covers `__wiring_*`.
- Hour 2-3: #98.2 needs a choice (D3). #98.4 "fail loudly" = a lint diagnostic on the file, not a thrown error (a throw aborts every file's lint). #98.7 is subsumed if D3 removes the disk check.
- Hour 4-5: #98.8 does not fail pre-commit (P1, P2); it fails `tsc` in `vp run build`/`pack` (P3). Fix is the `tsconfig.json` exclude (P10). #98.6's confirmation found P9 (bare `import("react")` type is not banned).
- Hour 6+: #111 GPU-off test needs `--disable-gpu --disable-software-rasterizer` (P6), not `--disable-3d-apis` (P4).
- Effort: human ~1 day / CC ~1 h.

## Answered decision (D3)

Commitment comparison:

```text
Commitment                                   | Source       | Current | A           | B                  | C
same result before and after a build         | #98.2 Why    | no      | yes         | yes                | no
no disk read for root-absolute specifiers    | #98.2 What   | no      | yes         | no                 | no
new root folder fenced                       | builder-06   | yes (once on disk) | yes, guard test fails until listed | yes (once on disk) | yes
/logo.svg-style public URLs allowed          | 1.2 tests    | yes     | yes         | yes                | yes
```

Question: D3 — D3: How should the fence decide whether `/x` is repo code or a public asset URL?
Header: #98 root-abs
A) Fixed list + guard test (recommended)
Replace the disk check with a fixed set of root entries (tracked roots plus `dist`, `dist-electron`, `release`, `node_modules`, `test-results`, `playwright-report`); a `vp test` case fails when `git ls-files` shows a root entry not in the set. Effort S, risk low.
B) Disk check + output list
Keep `fs.existsSync`, but always fence the six output dirs. Effort S, risk low.
C) Leave as is
No change; `/dist/x` keeps flipping after a build. Effort S, zero implementation work, risk low.

Actual answer: A "Fixed list + guard test (recommended)" (D3).

## Review sections

### Section 1: Architecture

```
  vite.config.ts lint.overrides ──> oxlint built-ins (no-restricted-imports, ...)   <── #95 wiring rows pin 2 more
  vite.config.ts lint.jsPlugins ──> lint/module-fences.js (no-cross-zone)
                                       │ realPath(importer) ──> zoneOf()            <── #98.3 dir from real path
                                       │                       └─ null + outside repo ──> outsideRepo report (#98.4)
                                       │ resolveFrom(spec)
                                       │   "." ──> path.resolve(realDir, spec)
                                       │   "/" ──> ROOT_ENTRIES.has(first) ? fenced : public URL   <── D3 (was fs.existsSync)
                                       │ visitors: import/export/import()/require/glob/new URL
                                       │           + import.meta.resolve(spec)    <── #98.5
  vite.config.ts staged["*"] ──> full `vp check` when vite.config.ts, lint/module-fences.js,
                                  */tsconfig.json or package.json is staged      <── #98.1
  tsconfig.json exclude ──> tsc in `vp run build` skips __wiring_* / __fence_link__ (#98.8)
  e2e/packaged.spec.ts ──> assertBooted + [role=alert] count 0 (#111)
                       └─> GPU-off launch expects "WebGL is unavailable" box (D1)
```

- OK: no new module, service or runtime code. All changes are dev tooling and tests; the shipped app is unchanged.
- OK: D3 removes the rule's only disk read for root-absolute specifiers; `realPath` remains for symlinks (needed by #98.3).
- WARNING (carry to implementation): the `target === ""` branch (`lint/module-fences.js:119`) must stay fenced; `import.meta.glob("/*.ts")` must keep reporting SRC (`lint/module-fences.test.js:150`).
- Rollback: revert the PR; nothing persists. Time: minutes.

### Section 2: Error & Rescue Map

```
  CODEPATH                         | WHAT CAN GO WRONG                        | HANDLING
  ---------------------------------|------------------------------------------|----------------------------------------
  no-cross-zone create()           | importer real path outside repo root     | NEW: report `outsideRepo` on Program; lint exits non-zero
  resolveFrom("/x")                | first segment not in ROOT_ENTRIES        | public URL, allowed (by design, D3); guard test catches unlisted tracked roots
  resolveFrom("/")                 | empty target                             | fenced (keep `target === ""`)
  import.meta.resolve(arg)         | non-literal arg                          | NEW: NON_STATIC report
  realPath(importer)               | importer missing on disk                 | existing: deepest existing parent
  ROOT_ENTRIES guard test          | git missing / not a repo                 | assert spawn status 0 with stderr in message; never pass on empty output
  staged["*"]                      | nested tsconfig.json staged              | full check (suffix match), costs time only
  GPU-off packaged test            | future Electron ignores the switches     | test fails: box not visible (loud)
  tsconfig exclude                 | pattern misses a scratch path            | `tsc` fails in build (loud, as today)
```

0 CRITICAL GAPS. "Fail loudly" for #98.4 is a lint diagnostic, not a thrown error: a throw would abort the whole lint run and hide other files' results.

### Section 3: Security & Threat Model

The fence is the boundary that keeps Node and Electron code out of the browser bundle.

- D3 makes unlisted root folders public URLs (fail-open). Likelihood low (guard test fails on any new tracked root), impact medium. Mitigated by D3's guard test.
- Untracked folders not in the six-entry output list (for example a new `coverage/`) are treated as public URLs. Likelihood low, impact low: nothing tracked imports build output. Accepted as part of D3's scope.
- Guard test spawns `git ls-files` with fixed arguments; no injection path. No new dependencies, secrets or user input.

### Section 4: Data flow and edge cases

```
  specifier ─> strip ?query/#hash ─> "."/"/"? ─> resolve ─> toRepoPath (lower-case) ─> zone allow-list ─> report?
     │ empty ""            ─> neither "." nor "/" ─> unchecked (bare, other rules)
     │ "/"                  ─> target "" ─> fenced
     │ "/Collector/x"       ─> lower-cased "collector" in ROOT_ENTRIES ─> fenced (#98.7 resolved: no disk lookup at all)
     │ "/logo.svg"          ─> not in ROOT_ENTRIES ─> public URL, allowed
     │ "/dist/x"            ─> in ROOT_ENTRIES ─> fenced, before and after build (D3)
     │ symlinked importer   ─> zone and dir both from real path (#98.3)
     │ importer outside repo─> outsideRepo report (#98.4)
```

ROOT_ENTRIES must hold lower-case names (`agents.md`, `claude.md`, ...) because `toRepoPath` lower-cases. Lint is synchronous; no async ordering. Wiring rows run sequentially within one Vitest file. No user-visible interaction is added.

### Section 5: Code quality

- `ROOT_ENTRIES` is a named export of `lint/module-fences.js` so the guard test reads the same set; no duplicate list.
- #95 fixtures follow the zone-prefix naming: `collector-react.txt`, `ui-electron.txt`.
- `create()` gains two small branches (outside repo, `import.meta.resolve`); no method passes 5 branches beyond today's `CallExpression`.
- New symlink fixture for #98.3 needs its own `.gitignore` entry next to `/src/ui/__fence_link__`.
- P9 finding: `import("react")` type queries in `src/shared` are not banned while `import type` is (P7). Type positions are erased at build time, so the plain-Node invariant holds. Record as confirmed semantics with a test pinning it; no rule change in HOLD scope.

### Section 6: Tests

```
  NEW BEHAVIOR                         | TEST TYPE        | ASSERTION                                         | REJECTS
  -------------------------------------|------------------|---------------------------------------------------|-----------------------------
  #95 collector -> react               | wiring (vp lint) | eslint(no-restricted-imports) + browserMessage     | collector override dropped
  #95 src -> electron                  | wiring (vp lint) | eslint(no-restricted-imports) + electronMessage    | src override dropped
  #98.1 tsconfig/package.json staged   | unit (staged fn) | returns "vp check" for each                        | partial check on config edit
  #98.2 D3 fixed list                  | RuleTester       | "/dist/x" reported; "/logo.svg" allowed; "/" fenced| disk-dependent result
  #98.2 guard                          | unit             | every `git ls-files` root entry (lower-cased) in ROOT_ENTRIES | unlisted new root
  #98.3 symlinked importer             | RuleTester       | importer via symlinked dir resolves from real dir  | lexical-dir resolution
  #98.4 outside repo                   | RuleTester       | file outside repo root gets outsideRepo            | silent no-op
  #98.5 import.meta.resolve            | RuleTester       | cross-zone literal -> SRC; non-literal -> NON_STATIC | unchecked resolve
  #98.6 group semantics                | wiring           | type-only + react/jsx-runtime reported (P7, P8); import("react") type allowed (P9) | semantics drift
  #98.7 case                           | RuleTester       | "/Collector/x" fenced                              | case-dependent miss
  #98.8 scratch files                  | manual + CI      | leftover __wiring file, `tsc --noEmit` exit 0 (P10)| build failure
  #111 no box on boot                  | packaged e2e     | [role=alert] count 0 in assertBooted               | silent box
  D1 GPU-off                           | packaged e2e     | box with "WebGL is unavailable" visible            | dead locator / blank window
```

no_claim: wiring rows prove one violating fixture per rule, not full pattern coverage; the GPU-off test proves the no-GPU path only, not context loss after boot (#89).
Flakiness: GPU-off test depends on Chromium switch behavior on the macOS runner (P6 was local arm64). Verify on CI before merge.

### Section 7: Performance

Two more wiring spawns (~1 s each, P1 timing), one more packaged launch in CI (~5 s, P4-P6 timing), one `git ls-files` per test run (ms). Lint rule work per file unchanged or smaller (no `existsSync`). No issues found beyond these costs.

### Section 8: Observability

Each new failure surfaces as a lint diagnostic with a specific message or a named test failure. `outsideRepo` message must name the file path so the cause is clear. No runtime logging changes.

### Section 9: Deployment

No runtime deploy. CI (`.github/workflows/ci.yml`) runs check, unit, e2e, pack and packaged tests on macOS; that is the post-merge check. Rollback: revert PR.

### Section 10: Long-term trajectory

Debt: one list to maintain (guard-tested). Reversibility 5/5. Fits repo conventions (RuleTester + wiring rows, packaged spec). A new engineer finds the list next to a comment and a failing test that names the missing entry.

### Section 11: Design & UX

SKIPPED (no UI scope). The app UI is unchanged; the GPU-off test only observes the existing box.

### Outside voice (Codex, gpt-6-astra, completed)

| ID          | Finding                                                                                                                                                                                                                   | Evidence check                                                               | Disposition                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1 (High)   | D3 opens a bypass: a root-absolute target that resolves through a symlink outside the repo has first segment `..`; today `fs.existsSync(repoRoot/..)` is true so it is fenced, a fixed set would treat it as a public URL | confirmed by static read of `lint/module-fences.js:116-119` and `toRepoPath` | Required repair inside D3 (keeps an existing guarantee, no behavior change vs today): a resolved target outside the repo (`..` first segment) stays fenced before the public-URL exception. RuleTester case with a symlink to a folder outside the repo               |
| O2 (Medium) | D1's GPU-off test asserts the box exists but does not exercise `assertBooted`'s no-alert check                                                                                                                            | confirmed: the two assertions are separate today                             | Implementation detail inside D1: one shared `errorBox` locator used by `assertBooted` and the GPU-off test, and the GPU-off test asserts that `expect(errorBox).toHaveCount(0)` rejects. Calling all of `assertBooted` is not used: its canvas check fails first (P6) |
| O3 (Low)    | #98.5 adds an SRC report to `import(import.meta.resolve("../../collector/x.ts"))`, which `lint/module-fences.test.js:155` expects to give only NON_STATIC                                                                 | confirmed                                                                    | Update that case to expect both NON_STATIC and SRC; both diagnostics are true                                                                                                                                                                                         |

No reopened decisions. Cross-model: Codex agreed with scope and found 3 gaps the native review missed; no disagreement remains.

## TODO choices

None proposed. HOLD SCOPE; no evidenced gap left outside accepted scope. P9 (bare `import("react")` type queries allowed in `src/shared`) is recorded as confirmed semantics with a pinning test, not a TODO: type positions are erased and cannot break the plain-Node invariant.

Approval readiness: PASS. Checked D1 (answer D1 "Assertion + GPU-off test (recommended)"; O2 is implementation inside D1), D3 (answer D3 "Fixed list + guard test (recommended)"; O1 keeps the existing escape fence inside D3), O3 (factual test correction inside #98.5 scope). Mode D2 "HOLD SCOPE (recommended)" approves no remedy. #95, #98.1, #98.3-#98.8 and #111 are the issues' own requested work. 0 unresolved.

## Reality rows

- REALITY: premise-table pass unverified=1 (#98.1 local staged-only gap not probed; CI full check at `.github/workflows/ci.yml:50`) `docs/plans/95-fence-and-boot-hardening.md:46`
- REALITY: already-done pass `git log origin/main --since=2026-10-27` on `lint/module-fences.js`, `e2e/packaged.spec.ts` shows only 1.7 base commits (db4e807, bad0aa1, da1a01d); none implements these items `lint/module-fences.js:116`
- REALITY: surface-check pass `vp lint --format=default`, `vp check`, `tsc --noEmit -p`, `_electron.launch({ args })` all run in P1-P10; `--disable-3d-apis` is a real switch but does not disable WebGL here (P4) `e2e/packaged.spec.ts:14`
- REALITY: binding-decisions pass branch decision search empty; 1.2 decisions honored: builder-06 public-URL rule kept (D3 keeps `/logo.svg` allowed), `--format=default` kept `lint/module-fences.test.js:302`
- REALITY: numbers pass changed files [estimated] `docs/plans/95-fence-and-boot-hardening.md:88`; ~1 s per lint spawn [measured: P1] `docs/plans/95-fence-and-boot-hardening.md:32`; ~5 s per packaged launch [measured: P4-P6] `docs/plans/95-fence-and-boot-hardening.md:35-37`
- REALITY: deferred-asks finding #111 "silent" premise corrected (P6); #98.8 symptom moved from pre-commit to build (P1-P3); every requested item kept `TODOS.md:131-195`
- REALITY: pr-count pass one PR for three issues, default policy (no `.gstack/ship-policy.json`) `TODOS.md:131`

PLAN_REALITY: phase=ceo rows=7/7 missing=none unverified=1 verdict=complete

## NOT in scope

- Nothing deferred or rejected. Option C of D3 ("Leave as is") and options B/C of D1 were declined by the user's answers.

## What already exists

- `lint/module-fences.test.js:222-339` wiring harness and `configRows`: reused for #95 and #98.6.
- RuleTester setup and symlink fixture pattern (`lint/module-fences.test.js:46-55`): reused for #98.3 and O1.
- `staged` function tests (`lint/module-fences.test.js:357-372`): extended for #98.1.
- `CanvasErrorBoundary` (`src/App.tsx:19-47`) and the smoke check (`e2e/smoke.spec.ts:30`): the packaged test reuses the same `[role=alert]` locator.
- `realPath` (`lint/module-fences.js:13-26`): reused for the importer directory.

## Dream state delta

```
  CURRENT                                   THIS PLAN                                 12-MONTH IDEAL
  fence result depends on disk/build;  ──>  deterministic root check, symlink-safe ──> every fence rule pinned by a test,
  2 config fences untested; packaged       importer, all config fences pinned,        packaged app tested for each
  test blind to the error box              packaged no-GPU path tested                 degraded-render path (#89)
```

## Error & Rescue Registry

| Codepath                   | Failure                           | Rescued                   | User (developer) sees                       |
| -------------------------- | --------------------------------- | ------------------------- | ------------------------------------------- |
| `no-cross-zone` create()   | importer outside repo             | Y: `outsideRepo` report   | lint error naming the file                  |
| `resolveFrom("/x")`        | resolved target escapes repo (O1) | Y: fenced                 | zone error                                  |
| `resolveFrom("/x")`        | first segment unlisted            | by design: public URL     | nothing; guard test fails for tracked roots |
| `import.meta.resolve(arg)` | non-literal                       | Y: NON_STATIC             | lint error                                  |
| ROOT_ENTRIES guard         | `git` fails                       | Y: test fails with stderr | red `vp test`                               |
| GPU-off packaged test      | switches stop working             | Y: test fails             | red CI step                                 |

## Failure Modes Registry

```
  CODEPATH              | FAILURE MODE                     | RESCUED? | TEST? | USER SEES?          | LOGGED?
  ----------------------|----------------------------------|----------|-------|---------------------|--------
  resolveFrom root-abs  | /dist/x flips after build        | Y (D3)   | Y     | same error always   | lint
  resolveFrom root-abs  | symlink escape treated as public | Y (O1)   | Y     | zone error          | lint
  resolveFrom root-abs  | new tracked root unlisted        | Y        | Y     | guard test red      | vp test
  create()              | importer outside repo            | Y        | Y     | outsideRepo error   | lint
  create()              | symlinked importer dir           | Y        | Y     | correct zone result | lint
  visitors              | import.meta.resolve unchecked    | Y        | Y     | zone error          | lint
  staged hook           | config staged, partial check     | Y        | Y     | full check runs     | hook
  build tsc             | leftover __wiring file           | Y        | manual| build passes        | -
  packaged boot         | error box shown                  | Y        | Y     | CI red              | CI
```

9 total, 0 CRITICAL GAPS.

## Stale diagram audit

`lint/module-fences.js:6-10` header comment describes the disk-based public-URL rule; it becomes stale with D3 and must be rewritten in the same change. No ASCII diagrams in the other touched files.

## Implementation Tasks

- [ ] **T1 (P2, human: ~30min / CC: ~5min)** — lint tests — Add #95 wiring rows
  - Surfaced by: #95; Section 6
  - Files: `lint/fixtures/collector-react.txt`, `lint/fixtures/ui-electron.txt`, `lint/module-fences.test.js`
  - Verify: `vp test lint/module-fences.test.js`; delete each override's group locally and see its row fail
- [ ] **T2 (P2, human: ~2h / CC: ~15min)** — fence rule — Fixed root set, escape fence, guard test (#98.2, #98.7, D3, O1)
  - Surfaced by: D3; O1; Section 4
  - Files: `lint/module-fences.js` (`ROOT_ENTRIES` export, `resolveFrom`, header comment), `lint/module-fences.test.js`, `.gitignore` (new symlink fixture)
  - Verify: RuleTester: `/dist/x` reported, `/logo.svg` allowed, `/` fenced, `/Collector/x` fenced, root-abs through symlink to outside repo fenced; guard test vs `git ls-files`
- [ ] **T3 (P2, human: ~2h / CC: ~15min)** — fence rule — Symlinked importer, outside-repo report, import.meta.resolve (#98.3, #98.4, #98.5, O3)
  - Surfaced by: #98; Section 2
  - Files: `lint/module-fences.js`, `lint/module-fences.test.js`, `.gitignore`
  - Verify: RuleTester cases for each; `lint/module-fences.test.js:155` expects NON_STATIC and SRC
- [ ] **T4 (P2, human: ~1h / CC: ~10min)** — tooling — Staged full check, group semantics pins, scratch exclude (#98.1, #98.6, #98.8)
  - Surfaced by: #98; P7-P10
  - Files: `vite.config.ts`, `tsconfig.json`, `lint/module-fences.test.js`, fixtures for P7-P9
  - Verify: staged tests return `vp check` for `tsconfig.json`, `collector/tsconfig.json`, `package.json`; wiring rows for P7/P8 report, P9 passes; leftover `__wiring` file then `tsc --noEmit` exit 0
- [ ] **T5 (P2, human: ~1h / CC: ~10min)** — packaged e2e — No-alert check and GPU-off test (#111, D1, O2)
  - Surfaced by: D1; O2
  - Files: `e2e/packaged.spec.ts`
  - Verify: `npm run pack && npm run test:packaged` green locally and in CI; GPU-off test asserts the shared locator's `toHaveCount(0)` rejects and the box text matches "WebGL is unavailable"
- [ ] **T6 (P2, human: ~15min / CC: ~5min)** — docs — Move #95, #98, #111 to Completed in `TODOS.md`; close issues with the PR
  - Surfaced by: CLAUDE.md TODOS rule
  - Files: `TODOS.md`
  - Verify: `gh issue view 95 98 111` closed by the PR

## Completion Summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | HOLD SCOPE                                  |
  | System Audit         | #111 silent case absent (P6); #98.8 hits    |
  |                      | build not pre-commit (P1-P3); P9 type gap   |
  | Step 0               | HOLD; D1 GPU-off test; D3 fixed root set    |
  | Section 1  (Arch)    | 1 issue (D3), 1 warning (keep "/" fenced)   |
  | Section 2  (Errors)  | 9 error paths mapped, 0 GAPS                |
  | Section 3  (Security)| 2 issues found, 0 High severity             |
  | Section 4  (Data/UX) | 7 edge cases mapped, 0 unhandled            |
  | Section 5  (Quality) | 1 issue found (P9 semantics, pinned)        |
  | Section 6  (Tests)   | Diagram produced, 0 gaps                    |
  | Section 7  (Perf)    | 0 issues found                              |
  | Section 8  (Observ)  | 0 gaps found                                |
  | Section 9  (Deploy)  | 1 risk flagged (GPU switches on CI runner)  |
  | Section 10 (Future)  | Reversibility: 5/5, debt items: 1           |
  | Section 11 (Design)  | SKIPPED (no UI scope)                       |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (0 items)                           |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 6 rows, 0 CRITICAL GAPS                     |
  | Failure modes        | 9 total, 0 CRITICAL GAPS                    |
  | TODOS.md updates     | 0 items proposed                            |
  | Scope proposals      | 0 proposed, 0 accepted (HOLD)               |
  | CEO plan             | skipped by mode                             |
  | Outside voice        | codex completed, 3 findings, 3 resolved     |
  | Lake Score           | 1/1 (D3)                                    |
  | Diagrams produced    | 4 (architecture, error map, data flow,      |
  |                      | dream state)                                |
  | Stale diagrams found | 1 (module-fences.js header comment)         |
  | Unresolved decisions | 0                                           |
  | Reality rows         | 7/7 rows (PLAN_REALITY), 1 unverified       |
  +====================================================================+
```

## Eng review (plan-eng-review, 2026-10-29)

Target: `docs/plans/95-fence-and-boot-hardening.md` (named in the invocation). Report file: this plan. CEO decisions D1 (GPU-off packaged test), D3 (fixed root set + guard test) and O1-O3 are carried forward unchanged. The CEO ledger IDs D1-D3 above and the eng question numbers below (Eng D1, ...) are separate series.

### Scope Challenge

Scope record: feature answers: none (no cuts proposed); structure: A "Smaller arrangement (recommended)" (Eng D1); accepted scope: CEO scope unchanged, #95 rows reuse `lint/fixtures/shared-react.txt` (copied to `collector/__wiring_react.ts`) and `lint/fixtures/collector-electron.txt` (copied to `src/ui/__wiring_electron.ts`), no new #95 fixtures; pending remedies: none.

Result: scope accepted as-is (smaller arrangement keeps scope).

Complexity: ~11 changed files after Eng D1 (estimate: `lint/module-fences.js`, `lint/module-fences.test.js`, 3 fixtures for P7-P9, `vite.config.ts`, `tsconfig.json`, `.gitignore`, `e2e/packaged.spec.ts`, `TODOS.md`, this plan), 0 new classes or services.

Findings:

- E1 [INFORMATIONAL] (confidence: 9/10) `lint/module-fences.test.js:261` — the CEO plan's P10 exclude `"src/**/__wiring_*"` does not match the five `src/data/mock__wiring_*.ts` copies (`["mock-nondeterminism.txt", "src/data/mock__wiring_date.ts", ...]`). Probe: `path.matchesGlob("src/data/mock__wiring_date.ts", "src/**/__wiring_*")` is `false`; `"src/**/*__wiring_*"` is `true`. Factual correction inside approved #98.8: use `"src/**/*__wiring_*"`. No behavior change, no question.

Prior learning applied: lexical-containment-misses-symlinks (confidence 9/10, from 2026-10-28), for #98.3 and O1.
Prior learning applied: oxlint-github-format-drops-messages (confidence 9/10, from 2026-10-28), new wiring rows keep `--format=default`.

### 1. Architecture

Design-twice: no new module, service or public boundary; one line only. Red-flag screen: `ROOT_ENTRIES` is a hand-synced list (flag 8), already answered by D3's guard test, which fails `vp test` when `git ls-files` and the set disagree.

- E2 [INFORMATIONAL] (confidence: 9/10) `lint/module-fences.js:111` — `const dir = path.dirname(context.filename);` resolves relative specifiers from the lexical path while `zoneOf` uses the real path (`toRepoPath` calls `realPath`, line 32). Confirms #98.3; the planned fix is `path.dirname(realPath(context.filename))`. Already in scope.

No new choices. Dispositions: E2 accepted (issue #98 scope).

### 2. Code quality

- E3 [INFORMATIONAL] (confidence: 8/10) `vite.config.ts:45` — `["/vite.config.ts", "/lint/module-fences.js"].some((suffix) => file.endsWith(suffix))`: adding `"/tsconfig.json"` also matches `collector/`, `e2e/`, `electron/` and `test/tsconfig.json`. Intended: each changes a type environment. `"/package.json"` matches only the root file (no nested package.json is tracked). Already in scope (#98.1).
- E4 [INFORMATIONAL] (confidence: 8/10) `lint/module-fences.js:6-10` — header comment describes the disk-based public-URL rule; it must be rewritten with D3 in the same change. Already listed in the CEO stale-diagram audit.

No shared-code extraction: `ROOT_ENTRIES` is one exported set read by its guard test; no second caller. Dispositions: E3, E4 accepted (in scope).

### 3. Tests

Framework: Vitest via `vp test` (unit, `lint/**`), Playwright `test:packaged` (packaged app), per CLAUDE.md `## Testing`.

```
CODE PATHS                                                     USER (DEVELOPER) FLOWS
[+] lint/module-fences.js                                      [+] commit with a staged config file
  ├── create(): importer zone                                    └── [GAP→T4] tsconfig/package.json -> full `vp check`
  │   ├── [★★★ TESTED] src/shared/src/collector/electron  :21-215
  │   ├── [GAP→T3] importer real path outside repo -> outsideRepo [+] build after an interrupted `vp test`
  │   └── [GAP→T3] importer via symlinked dir -> real dir          └── [GAP→T4] leftover *__wiring_* copy, `tsc` passes
  ├── resolveFrom("/x")                                        [+] packaged app start
  │   ├── [★★★ TESTED] /logo.svg allowed, /collector/x fenced    ├── [★★ TESTED] boots, reloads :13-42
  │   ├── [GAP→T2] /dist/x fenced with no dist/ on disk          ├── [GAP→T5] no [role=alert] after boot
  │   ├── [GAP→T2] /Collector/x fenced (lower-cased lookup)      └── [GAP→T5] [→E2E] GPU off -> "WebGL is unavailable" box
  │   ├── [GAP→T2] root-abs via symlink escaping repo (O1)
  │   └── [★★ TESTED] "/" fenced (glob "/*.ts") :150
  ├── import.meta.resolve(arg)
  │   ├── [GAP→T3] literal cross-zone -> SRC
  │   ├── [GAP→T3] non-literal -> NON_STATIC
  │   └── [UPDATE→T3] import(import.meta.resolve(..)) :155 expects NON_STATIC + SRC (O3)
  └── ROOT_ENTRIES guard [GAP→T2] git ls-files roots ⊆ set
[+] vite.config.ts lint.overrides (wiring)
  ├── [GAP→T1] collector -> react (browserMessage)
  ├── [GAP→T1] src -> electron (electronMessage)
  ├── [GAP→T4] src/shared `import type` react reported (P7)
  ├── [GAP→T4] src/shared react/jsx-runtime reported (P8)
  └── [GAP→T4] src/shared `import("react")` type allowed (P9, pinned semantics)
[+] tsconfig.json exclude
  └── [GAP→T4] every wiring/fence copy path under src/ matched by an exclude pattern (would have caught E1)

COVERAGE today: 4/22 paths  |  after plan: 22/22 planned
GAPS: 18 (1 E2E: GPU-off), all mapped to tasks
```

- E5 [CRITICAL] (confidence: 9/10) `docs/plans/95-fence-and-boot-hardening.md` Section 6 row "#98.8 scratch files | manual + CI" — #98 requires "add a RuleTester or wiring case with each fix", and E1 shows a manual check missed real paths. Required proof of approved #98.8 behavior, so no question: a unit test asserts that every path in the wiring `copies` list and the fence-link paths under `src/` match a `tsconfig.json` `exclude` pattern (`path.matchesGlob`, Node 26 per `.github/workflows/ci.yml:41`). Value: protects=leftover wiring copies never reach `tsc` in `vp run build`; fails_when=a new wiring zone path is added without a matching exclude; why_new=no test reads tsconfig exclude; seam=none; no_claim=tsc behavior itself (pattern match only, unit).

Value cards for the other new tests:

- T1 rows: protects=collector and src config fences stay wired; fails_when=either override group or message is removed; why_new=no configRows row covers them; seam=none; no_claim=other names in the same group.
- T2 RuleTester + guard: protects=root-abs result independent of disk; fails_when=disk check returns or a tracked root is unlisted; why_new=no case runs without dist/; seam=`ROOT_ENTRIES` export (also read by the rule); no_claim=untracked unlisted folders (accepted by D3).
- T3 RuleTester: protects=symlinked importers, outside-repo files and import.meta.resolve are checked; fails_when=lexical dir returns, the outsideRepo report is removed or the visitor is removed; why_new=none covered; seam=none; no_claim=Windows cross-drive paths.
- T4 staged + wiring: protects=full check on config edits, type-only/nested group semantics; fails_when=suffix list or groups change; why_new=staged tests cover only vite.config/module-fences; seam=none; no_claim=lint-staged invocation itself.
- T5 packaged: protects=packaged app shows no error box on boot and the shared locator matches the real box; fails_when=assertion removed from the GPU-off check or box markup changes; why_new=packaged spec never checks [role=alert]; seam=none; no_claim=context loss after boot (#89).

Tests made obsolete: none. Test Plan Artifact: written (path in the report).

Dispositions: E5 accepted as required proof of #98.8 (issue text), added to T4.

### 4. Performance

No issues found. Scale: +2 wiring spawns (~1 s each, P1), +3 for P7-P9, +1 packaged launch (~5 s, P6), 1 `git ls-files` per unit run (ms). The rule drops one `fs.existsSync` per root-absolute specifier.

### Worktree parallelization

| Step                  | Modules touched                                          | Depends on |
| --------------------- | -------------------------------------------------------- | ---------- |
| T1-T4 fence + tooling | `lint/`, `vite.config.ts`, `tsconfig.json`, `.gitignore` | —          |
| T5 packaged e2e       | `e2e/`                                                   | —          |
| T6 TODOS              | `TODOS.md`                                               | T1-T5      |

Lane A: T1 → T2 → T3 → T4 (shared `lint/module-fences.*`). Lane B: T5 (independent). Launch A + B; merge both; then T6.
Conflict flags: none between lanes.

### Outside voice (Codex, gpt-6-astra, eng phase, completed)

Prompt held the first 30 KB of the plan body ("Plan truncated for size") plus the full eng section as review context.

## Decision ledger (eng)

### X1: Root-absolute specifiers without an extension

Finding: X1, INFORMATIONAL, confidence 9/10, `lint/module-fences.js:116-119`, reviewer: Codex (eng outside voice). Quote: `return target === "" || fs.existsSync(path.join(repoRoot, first)) ? target : null;`
Plan baseline: D3 approved a fixed set of exact root entry names (`vite.config.ts`, `src`, ...), answer D3 "Fixed list + guard test (recommended)".
Runtime evidence: static read. `import x from "/vite.config"` from `src/ui`: first segment `vite.config` is not on disk today and not in D3's planned set, so it is a public URL and allowed. Vite resolves `/vite.config` to the root `vite.config.ts`. Pre-existing bypass; relative `../../vite.config` is already fenced (`lint/module-fences.test.js:133`).
Comparison grid:

```text
Commitment                               | Current (D3 plan) | A                       | B
/src/x, /collector/x fenced              | yes               | yes                     | yes
/vite.config (extensionless root file)   | allowed           | fenced                  | allowed
/logo.svg, /assets/x.png allowed         | yes               | yes                     | yes
match rule                               | exact entry name  | entry name or its stem  | exact entry name
D3 guard test                            | yes               | yes                     | yes
X2, X3                                   | pending           | pending                 | pending
```

Question D2:
D2 — X1: Should `/vite.config` (a root file without its extension) be fenced?
Header: X1 root stem
A) Apply: fence entry stems (recommended)
Also fence a root-absolute first segment equal to a root entry's name without its last extension (`vite.config.ts` gives `vite.config`). Add RuleTester cases. Effort S, risk low.
B) Keep exact names
Leave D3 as planned; `/vite.config` stays a public URL. Effort S, zero implementation work, risk low.
C) Investigate first
Probe what Vite resolves for `/vite.config` and `/launder` before choosing; no rule change now. Effort S, risk low.
D) Defer to TODOS.md
Record the gap as a TODO; this branch ships D3 as planned. Effort S, risk low.

State: approved
Actual answer: A "Apply: fence entry stems (recommended)" (Eng D2)
Accepted scope: `resolveFrom` fences a root-absolute first segment that equals a `ROOT_ENTRIES` name or that name without its last extension (`vite.config.ts` -> `vite.config`); RuleTester cases `/vite.config` and `/playwright.config` reported, `/logo.svg` still allowed
History: none

### X2: Extensionless target that is a file symlink

Finding: X2, INFORMATIONAL, confidence 7/10, `lint/module-fences.js:13-26`, reviewer: Codex (eng outside voice). Quote: `rest.unshift(path.basename(current)); current = parent;`
Plan baseline: not in plan; #98.3 covers symlinked importers only.
Runtime evidence: static read. `src/ui/link.ts` -> `../../collector/x.ts`, `import "./link"`: `realPath("src/ui/link")` misses, keeps parent `src/ui`, so the target stays in `src`. Needs a committed file symlink in `src/`; none exists (`git ls-files -s` mode 120000 not probed). Pre-existing.
Comparison grid:

```text
Commitment                                  | Current | A                              | B
dir-symlink targets (./__fence_link__/x)    | fenced  | fenced                         | fenced
extensionless file-symlink target           | allowed | fenced (try .ts/.tsx/.js/.mjs/.json and /index.*) | allowed
new TODO                                    | no      | no                             | yes
```

Question D3:
D3 — X2: Should the fence resolve extensions to catch file symlinks?
Header: X2 file link
A) Defer to TODOS.md (recommended)
Add a P3 TODO with the reproduction; no rule change on this branch. Effort S, risk low.
B) Apply: try extensions
In `realPath`, try `.ts`, `.tsx`, `.js`, `.mjs`, `.json` and `/index.*` before falling back. Add a file-symlink RuleTester case. Effort M, risk medium.
C) Keep as is
No change and no TODO. Effort S, zero implementation work, risk low.

State: approved
Actual answer: B "Apply: try extensions" (Eng D3; user picked over the recommended Defer)
Accepted scope: `realPath` (or the target resolution that calls it) tries `.ts`, `.tsx`, `.js`, `.mjs`, `.json` and `/index.*` for a missing target before falling back; RuleTester case with a committed-style file symlink `src/ui/__fence_file_link__.ts` -> `../../collector/...` imported as `./__fence_file_link__` reports SRC; `.gitignore` entry for the fixture
History: none

### X3: Computed `import.meta["..."]` access

Finding: X3, INFORMATIONAL, confidence 9/10, `lint/module-fences.js:69-77`, reviewer: Codex (eng outside voice). Quote: `node.type === "MemberExpression" && !node.computed && node.property.name === property`
Plan baseline: #98.5 approved dot-form `import.meta.resolve`.
Runtime evidence: static read. `import.meta["resolve"](...)`, `import.meta["glob"](...)` and `new URL(x, import.meta["url"])` all skip the check today.
Comparison grid:

```text
Commitment                                   | Current        | A                      | B
import.meta.resolve/glob/url (dot)           | checked (#98.5)| checked                | checked
import.meta["resolve"|"glob"|"url"] literal  | unchecked      | checked                | unchecked
import.meta[expr] non-literal                | unchecked      | NON_STATIC report      | unchecked
```

Question D4:
D4 — X3: Should `isImportMeta` also match `import.meta["name"]`?
Header: X3 computed
A) Apply: match computed (recommended)
`isImportMeta` accepts a string-literal computed key; a non-literal computed member on `import.meta` reports NON_STATIC. RuleTester cases for resolve, glob and url. Effort S, risk low.
B) Keep dot-form only
No change; computed access stays unchecked. Effort S, zero implementation work, risk low.
C) Defer to TODOS.md
Record as a TODO. Effort S, risk low.

State: approved
Actual answer: A "Apply: match computed (recommended)" (Eng D4)
Accepted scope: `isImportMeta` accepts a string-literal computed key (`import.meta["resolve"]`); a non-literal computed member on `import.meta` used as a callee or URL base reports NON_STATIC; RuleTester cases for resolve, glob and url
History: none

Approval readiness (eng): PASS. Checked Eng D1 (structure A "Smaller arrangement (recommended)"), X1 (Eng D2 A), X2 (Eng D3 B), X3 (Eng D4 A). E1 is a factual correction inside approved #98.8; E2-E4 are issue scope; E5 is required proof of #98.8 per the issue text. CEO D1, D3, O1-O3 carried forward. 0 unresolved.

TODO choices: none. X2 was applied, not deferred; no other gap left.

## Eng outputs

### NOT in scope

- Full module resolution in the fence (package `exports`, tsconfig paths, Vite aliases): no alias or path mapping exists (`tsconfig.json` has no `paths`); X2 adds only extension and index probing for missing targets.

### What already exists

Reused: wiring harness and `configRows` (`lint/module-fences.test.js:222-339`), RuleTester symlink setup (`:46-55`), staged tests (`:357-372`), `realPath` (`lint/module-fences.js:13-26`, extended by X2), `isImportMeta` (`:69-77`, extended by X3), fixtures `shared-react.txt` and `collector-electron.txt` (Eng D1).

### Failure modes (new paths)

| Path                      | Realistic failure                                           | Test       | Handling                                    | User sees                 |
| ------------------------- | ----------------------------------------------------------- | ---------- | ------------------------------------------- | ------------------------- |
| stem match (X1)           | public asset named like a root stem (`/readme`) gets fenced | RuleTester | lint error                                  | clear error, rename asset |
| extension probing (X2)    | probing picks `.ts` where Vite would pick `.tsx`            | RuleTester | both fenced the same way if in another zone | correct zone result       |
| computed import.meta (X3) | `import.meta[key]` with a variable                          | RuleTester | NON_STATIC                                  | clear error               |
| exclude patterns (E1/E5)  | new wiring path not excluded                                | unit (E5)  | `vp test` fails                             | clear error               |

0 critical gaps.

## Implementation Tasks (eng, supersedes the CEO list above)

- [ ] **T1 (P2, human: ~20min / CC: ~5min)** — lint tests — Add #95 wiring rows reusing fixtures
  - Surfaced by: #95; Eng D1
  - Files: `lint/module-fences.test.js`
  - Verify: `vp test lint/module-fences.test.js`; drop each override group locally and see its row fail
- [ ] **T2 (P2, human: ~3h / CC: ~20min)** — fence rule — Fixed root set with stems, escape fence, guard, extension probing (#98.2, #98.7, D3, O1, X1, X2)
  - Surfaced by: D3; O1; Eng D2 (X1); Eng D3 (X2)
  - Files: `lint/module-fences.js` (`ROOT_ENTRIES` export, `resolveFrom`, `realPath`, header comment), `lint/module-fences.test.js`, `.gitignore`
  - Verify: RuleTester: `/dist/x`, `/Collector/x`, `/vite.config`, `/` fenced; `/logo.svg` allowed; root-abs symlink escape fenced; `./__fence_file_link__` reports SRC; guard vs `git ls-files`
- [ ] **T3 (P2, human: ~2h / CC: ~15min)** — fence rule — Symlinked importer, outsideRepo, import.meta.resolve, computed import.meta (#98.3-#98.5, O3, X3)
  - Surfaced by: #98; E2; O3; Eng D4 (X3)
  - Files: `lint/module-fences.js`, `lint/module-fences.test.js`, `.gitignore`
  - Verify: RuleTester cases for each; `:155` expects NON_STATIC and SRC; `import.meta["resolve"|"glob"|"url"]` checked; `import.meta[k]` NON_STATIC
- [ ] **T4 (P2, human: ~1h / CC: ~10min)** — tooling — Staged full check, group-semantics pins, scratch exclude + guard (#98.1, #98.6, #98.8, E1, E5)
  - Surfaced by: #98; P7-P10; E1; E5
  - Files: `vite.config.ts`, `tsconfig.json` (`exclude: ["src/**/*__wiring_*", "src/ui/__fence_*"]`), `lint/module-fences.test.js`, 3 fixtures for P7-P9
  - Verify: staged returns `vp check` for `tsconfig.json`, `collector/tsconfig.json`, `package.json`; P7/P8 rows report, P9 exits 0; E5 unit test passes and fails when a pattern is removed
- [ ] **T5 (P2, human: ~1h / CC: ~10min)** — packaged e2e — Shared error-box locator, no-alert check, GPU-off test (#111, D1, O2)
  - Surfaced by: D1; O2
  - Files: `e2e/packaged.spec.ts`
  - Verify: `npm run pack && npm run test:packaged` locally and in CI
- [ ] **T6 (P2, human: ~15min / CC: ~5min)** — docs — Move #95, #98, #111 to Completed; close issues with the PR
  - Files: `TODOS.md`
  - Verify: issues closed by the PR

Parallelization: 2 lanes. Lane A: T1 → T2 → T3 → T4 (shared `lint/module-fences.*`). Lane B: T5. Then T6.

### Reality rows (eng)

- REALITY: premise-table pass unverified=1 (X2 committed file symlinks: none assumed, `git ls-files -s` mode 120000 not probed) `lint/module-fences.js:13`
- REALITY: already-done pass no commits on this branch beyond base c40a508; origin/main log for touched files shows only 1.7 base commits `lint/module-fences.js:116`
- REALITY: surface-check pass `path.matchesGlob` exists on Node v26.13.0 (probe) and CI pins Node 26 `.github/workflows/ci.yml:41`
- REALITY: binding-decisions pass CEO D1, D3, O1-O3 carried unchanged; Eng D1-D4 recorded `docs/plans/95-fence-and-boot-hardening.md:57`
- REALITY: numbers pass ~11 files [estimated] and spawn costs [measured: P1, P6] `docs/plans/95-fence-and-boot-hardening.md:32`
- REALITY: deferred-asks pass every #95, #98 and #111 item is a task (T1-T6); nothing deferred `TODOS.md:131`
- REALITY: pr-count pass one PR, 2 lanes merge before it `TODOS.md:131`

PLAN_REALITY: phase=eng rows=7/7 missing=none unverified=1 verdict=complete

### Completion summary (eng)

- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, Eng D1)
- Reality rows: 7/7 applicable rows emitted (PLAN_REALITY below), 1 unverified premise
- Architecture Review: 1 issue found (E2)
- Code Quality Review: 2 issues found (E3, E4)
- Test Review: diagram produced, 1 gap identified beyond planned coverage (E5)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex (gpt-6-astra), completed, 2 findings split into X1-X3, all answered
- Parallelization: 2 lanes, 1 parallel pair / 4 sequential steps in lane A
- Lake Score: 3/3 (Eng D2, D3 and D4 each picked the 10/10 option)

## GSTACK REVIEW REPORT

| Review         | Trigger                                                         | Why                             | Runs | Status       | Findings                                                                          |
| -------------- | --------------------------------------------------------------- | ------------------------------- | ---- | ------------ | --------------------------------------------------------------------------------- |
| CEO Review     | `/plan-ceo-review`                                              | Scope & strategy                | 1    | CLEAR        | mode: HOLD_SCOPE, 0 critical gaps                                                 |
| Outside Review | codex (`/plan-ceo-review` and `/plan-eng-review` outside voice) | Independent 2nd opinion         | 2    | issues_found | CEO: 3 findings, 3 resolved; Eng: 2 findings (as X1-X3), 3 resolved; 0 unresolved |
| Eng Review     | `/plan-eng-review`                                              | Architecture & tests (required) | 1    | ISSUES OPEN  | 4 issues, 0 critical gaps (all mapped to T1-T6, 0 unresolved)                     |
| Design Review  | `/plan-design-review`                                           | UI/UX gaps                      | 0    | —            | —                                                                                 |
| DX Review      | `/plan-devex-review`                                            | Developer experience gaps       | 0    | —            | —                                                                                 |

- **OUTSIDE COVERAGE:** codex (gpt-6-astra), plan-review CEO phase, completed, 3 findings (O1-O3) resolved; codex (gpt-6-astra), plan-review eng phase, completed, 2 findings split into X1-X3, answered Eng D2-D4 (eng prompt held the first 30 KB of the plan body plus the full eng section).
- **CROSS-MODEL:** native eng review and Codex agree on structure and tests; Codex found the extensionless root-file and file-symlink bypasses and the computed `import.meta` bypass, which the native pass missed. Native found E1 (exclude pattern misses `mock__wiring_*`), which Codex did not raise. No disagreement remains.
- **VERDICT:** CEO CLEARED; Eng ISSUES OPEN with every finding mapped to a task and 0 unresolved decisions — eng review required.

NO UNRESOLVED DECISIONS
