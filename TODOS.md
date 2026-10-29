# TODOS

## Rendering

### Add key-light shadows with the first casters

**Issue:** [#130](https://github.com/bjorkgard/nexus-one/issues/130)

**What:** Turn on key-light shadows when the tower shell adds the first shadow casters: pick the shadow map type, fit the light's shadow camera to the campus box, tune softness against the 2.1 "night studio diorama" target look, and budget the extra draw calls.

**Why:** Task 2.1 keeps the key light but ships no shadows, because nothing casts one yet and VSM would cost two full-screen blur passes per frame for an invisible result (CEO D13 in `docs/plans/2.1-isometric-stage.md`).

**Context:** three 0.186 removed `PCFSoftShadowMap` and falls back to PCF with a warning (`node_modules/three/build/three.module.js:9152`); R3F `<Canvas shadows>` with a boolean picks it (`@react-three/fiber` events file, line 1719). `shadows="variance"` (VSM) supports `shadow.radius`/`blurSamples` but adds two blur draws per frame (`three.module.js:9415-9419`). Key-light direction is `LOOK.keyLightDir` in `src/world/stage-look.ts`. The 2.1 e2e asserts exactly 2 draw calls for the empty stage; update it when shadows land. Consider `shadow.autoUpdate = false` for static casters.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 2.1 (light baseline); lands with task 2.3 (first casters)

### Recover from WebGL context loss

**Issue:** [#89](https://github.com/bjorkgard/nexus-one/issues/89)

**What:** Handle `webglcontextlost` / `webglcontextrestored` on the R3F canvas: show a visible message while lost, restore the scene when the context returns.

**Why:** After laptop sleep or a GPU driver reset, the campus freezes on its last frame with no message. Nothing in `docs/PLAN.md` covers it (task 9.4 restarts the collector, not the renderer).

**Context:** Found in the task 1.1 eng review (Codex outside voice, finding X2). Task 1.1 adds an error boundary for WebGL _startup_ failure only. three.js already logs `WebGLRenderer: Context Lost.`; R3F exposes the renderer via `useThree(s => s.gl)`, so listeners can attach to `gl.domElement`. Start by forcing loss with the `WEBGL_lose_context` extension in a dev build. Best fit: a new step before Phase 9's clean-account checks.

**Effort:** M (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.1 (canvas + error boundary), task 1.3 (`window.__nexus` for an e2e check)

### Production perf build with the overlay

**Issue:** [#108](https://github.com/bjorkgard/nexus-one/issues/108)

**What:** Add a `vp build --mode perf` build that keeps the 1.8 performance overlay (stats panels and counters) in an otherwise production React build, and extend the build guard so the default production build still excludes it.

**Why:** The 1.8 overlay is dev-only, and dev React adds overhead, so the manual fps reading in task 2.10 would measure dev-mode cost instead of what the packaged app does.

**Context:** Deferred in the task 1.8 CEO review (E2, decision D4; `docs/plans/1.8-performance-overlay.md`). The overlay mounts through `import.meta.env.DEV ? lazy(...) : null` and the guard in `lint/build-guards.js` rejects `__nexus`, `nexus-perf-overlay` and `nexus-probe` in production chunks. A perf mode needs its own gate (for example `import.meta.env.MODE === "perf"`) and a guard test that the default build still has none of those markers. Start by building both modes and grepping the output.

**Effort:** M (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.8 (overlay), must land before task 2.10 (geometry performance check)

### __nexus.frameStats() hook for the soak

**Issue:** [#109](https://github.com/bjorkgard/nexus-one/issues/109)

**What:** Register a dev-only `__nexus.frameStats()` hook that returns fps and frame-time p50/p95 over a rolling window, so e2e and the one-hour soak can read frame timing as data.

**Why:** Task 10.4 samples fps every minute, but no hook exposes fps today; the 1.8 overlay shows it only to a person.

**Context:** Deferred in the task 1.8 CEO review (E4, decision D6; `docs/plans/1.8-performance-overlay.md`). The overlay's `PerfStats` component runs inside the R3F canvas with a `useFrame` callback, which is the natural place to collect frame deltas. Hooks are typed in `src/debug/nexus.ts` (`NexusHooks`) and listed in the smoke test's hook-name assertion (`e2e/smoke.spec.ts`), which must be updated. Let 10.4 choose the sampling window.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P3
**Depends on:** Task 1.8 (overlay), lands with task 10.4 (one-hour soak)

## Data

### Prune ended sessions and agents from reducer state

**Issue:** [#102](https://github.com/bjorkgard/nexus-one/issues/102)

**What:** In task 4.5, prune ended sessions and agents from the shared reducer state after a retention window, keeping their counts and usage sums, so state and the reconnect snapshot stay bounded.

**Why:** The 1.6 reducer keeps every ended session and agent forever. That is correct and small at the 10.4 soak size, but the Electron app can run for days, and every reconnect sends the whole snapshot. 4.5's ring buffer bounds events only, not these records.

**Context:** Found in the task 1.6 CEO review (Section 7, finding S7-1; TD1 in `docs/plans/1.6-data-source-transport.md`). The reducer is pure copy-on-write (O5) with usage sums per agent and model (O7). 1.6 prints the default mock snapshot size as a baseline. Test by reducing a long mock stream, advancing past the retention window, and checking that ended entities are gone while totals are unchanged.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.6 (reducer), task 4.5 (store)

## Packaging

### Set Electron window safety options explicitly

**Issue:** [#104](https://github.com/bjorkgard/nexus-one/issues/104)

**What:** In `electron/main.ts` (added by task 1.7), set `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false` explicitly in `webPreferences`, and deny `window.open` and navigation away from `app://nexus`. Also flip the Electron fuses in the electron-builder config (`electronFuses`): `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `onlyLoadAppFromAsar: true`, `enableEmbeddedAsarIntegrityValidation: true`; confirm the packaged Playwright launch still works.

**Why:** Task 1.7 relies on Electron 45 defaults for these flags (unverified). Nothing in code states them, so a changed default or a later edit would pass unnoticed. With default fuses, anyone who can run the binary can set `ELECTRON_RUN_AS_NODE` to run arbitrary JS as the app (task 1.7 /ship review, deferred by the owner).

**Context:** Deferred in the task 1.7 CEO review (D3, `docs/plans/1.7-packaging-spike.md`): 8.2 owns the whole security baseline with its tests. 1.7 loads the UI from `app://nexus` through `protocol.handle`, so a navigation allowlist can match that origin.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.7; part of task 8.2

### Single-instance lock for the Electron app

**Issue:** [#105](https://github.com/bjorkgard/nexus-one/issues/105)

**What:** In task 8.1, call `app.requestSingleInstanceLock()` in `electron/main.ts`; a second launch focuses the existing window and exits.

**Why:** Double-clicking the app twice opens a second process and window. Harmless in the 1.7 spike, but once 8.1 runs the collector in Electron, two instances would fight over the WebSocket port and tail the same transcripts.

**Context:** Section 4 of the task 1.7 CEO review (`docs/plans/1.7-packaging-spike.md`, D12). Test: launch the packaged app twice; one process remains and its window is focused.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P3
**Depends on:** Task 1.7; must land with task 8.1

## Tooling

### Check the production bundle for collector/ and Node code

**Issue:** [#93](https://github.com/bjorkgard/nexus-one/issues/93)

**What:** Task 1.3's `lint/build-guards.js` already fails the build on any Node built-in (from any importer) and on `__nexus`. Remaining: assert that the browser bundle contains no `collector/` code (pick a marker string in task 4.1 that only collector code contains), and add a matching check that a collector build contains no React or Three.

**Why:** The task 1.2 lint fences (`lint/module-fences.js` plus `vite.config.ts` bans) are an honest-mistake guard, not a guarantee. These known bypasses need deliberate effort and are accepted there; only a bundle check catches them. The build guard now covers imports of any Node built-in (bare or `node:`, from any importer), so Node-only npm packages imported from `src/` (for example `vite-plus`, `typescript`) and `createRequire` reached through destructuring now fail `vp build` (task 1.3 refuter, scratch builds). The bypasses below are not covered by it and still apply to the remaining checks:

- `file://` specifiers, or any specifier hidden with `// @ts-expect-error`
- React-importing transitive packages not in `browserLibs` (for example `its-fine`, `suspend-react`, `scheduler`)
- inline `oxlint-disable` comments for the fence rules
- files in gitignored folders under `src/` (`vp check` skips them, Vite bundles them)
- bare-relative or percent-encoded `new URL("sub/../..", import.meta.url)` strings
- `process.getBuiltinModule`
- `import x = require(...)` (today also blocked by TS1294), extglob `..`, alias specifiers (none configured yet), HTML/CSS entry points

**Context:** Decided in the task 1.2 /ship review (D6, run 2). Task 1.7 added the `electron/` zone: it imports only `electron/` and `src/shared/`, no browser libraries, no `createRequire` or CommonJS. No collector code exists yet, so this waits for task 4.1. Fail the check on any marker match.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P1
**Depends on:** Task 4.1

### Lock down the collector WebSocket beyond loopback

**Issue:** [#94](https://github.com/bjorkgard/nexus-one/issues/94)

**What:** In task 4.4, have the collector WebSocket server validate `Origin` against an allowlist and require a per-launch random token handed out by Electron main or the dev server.

**Why:** Any web page in the user's browser can open `ws://127.0.0.1` (cross-site WebSocket hijacking) and read transcripts; binding to loopback alone does not stop it.

**Context:** Decided in the task 1.2 /ship review (D9). Test with a foreign `Origin` and with a missing token; both must be rejected.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P1
**Depends on:** Task 4.4

### Give Phase 3 e2e a test target before agents exist

**Issue:** [#97](https://github.com/bjorkgard/nexus-one/issues/97)

**What:** Pick a target for the e2e tests of 3.2 (pick), 3.3 (glide) and 3.4 (follow), for example desks from 2.5 or a test fixture object. Also have 3.1 register the camera-controls target through the `__nexus` registry.

**Why:** Those tasks test against agents, which arrive in 4.5/4.6 after Phase 3. `useThree()`'s camera has no target, so the e2e tests cannot read it without a registered hook.

**Context:** CEO D9 and D11 in `docs/plans/1.3-test-harness-debug-api.md`; `docs/PLAN.md` steps 3.2-3.4.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 2.5; must land before task 3.2

## Design

### Write DESIGN.md from the 2.1 design decisions

**Issue:** [#131](https://github.com/bjorkgard/nexus-one/issues/131)

**What:** Write `DESIGN.md` (via `/design-consultation`) from the 2.1 design decisions: colour tokens, Instrument Sans type scale, spacing, the 600 ms reveal motion rule, the thin-stroke "N" wordmark and the calm error-panel pattern.

**Why:** Task 2.1's design review created the first real design system pieces, but they live only in `docs/plans/2.1-isometric-stage.md` and `src/shared/tokens.ts`. Phase 5 panels and Phase 7 alerts need a type scale, spacing rules and component patterns; without a shared document each panel invents its own.

**Context:** Decisions Q1-Q12 in the "Design review" section of `docs/plans/2.1-isometric-stage.md`; approved mockups in `~/.gstack/projects/bjorkgard-nexus-one/designs/isometric-stage-20261029/variant-A.png` and `.../error-panel-20261029/variant-A.png`. Task 5.1 plans "Tailwind tokens and a GlassPanel"; those tokens must extend `src/shared/tokens.ts` (single source, design Q8), not start a second set. Start by running `/design-consultation` with the 2.1 plan as input.

**Effort:** M (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 2.1 (tokens.ts exists); must land before or with task 5.1

## Completed

### Run the pre-commit full check against the staged index

**Issue:** [#122](https://github.com/bjorkgard/nexus-one/issues/122)

**What:** When `.vite-hooks/pre-commit` takes the full-check branch, check what will be committed (the index), not the working tree.

**Why:** The full `vp check` runs outside lint-staged and reads the files on disk, so an unstaged edit can hide a staged break. For example: stage the deletion of `a.ts`, and leave unstaged the edit that removes `b.ts`'s import of it. CI's full check still catches this, so the gap is local only.

**Context:** Found by the /ship red team of #116; the hook comment documents the limit. Options: run the check in a temporary `git worktree` of the index, or route the full check through lint-staged so it hides unstaged changes (lint-staged skips commits that stage only symlinks, which is why the hook decides on its own today). Avoid `git stash` in the hook.

**Effort:** M (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** None

**Completed:** unreleased (2026-10-29)

### Harden the pre-commit hook's git diff against config and env

**Issue:** [#125](https://github.com/bjorkgard/nexus-one/issues/125)

**What:** Make the `git diff --cached --raw -M` call in `.vite-hooks/pre-commit` (and in `needsFullCheck` in `vite.config.ts`) ignore settings that hide or reshape entries: pass `--ignore-submodules=none` and clear `GIT_PRINT_SHA1_ELLIPSIS`.

**Why:** With `diff.ignoreSubmodules=all`, or `ignore = all` in `.gitmodules`, a staged submodule add is left out of the diff, so the commit takes the partial check. With `GIT_PRINT_SHA1_ELLIPSIS=yes` the hook's pattern misses deletion, rename and type-change entries.

**Context:** Found by the refuters during #116. Add a hook test case for each setting, as the existing real-hook cases in `lint/module-fences.test.js` do.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P3
**Depends on:** None

**Completed:** unreleased (2026-10-29)

### Close the remaining module-fence resolution gaps

**Issue:** [#116](https://github.com/bjorkgard/nexus-one/issues/116)

**What:** Make `lint/module-fences.js` see these import spellings the way Vite resolves them:

- `/@fs/<absolute path>` specifiers (today the first segment `@fs` is treated as a `public/` asset URL)
- `import "./x.js"` where only `x.ts` exists (Vite swaps `.js` for `.ts`)
- a folder whose `package.json` `main` points into another zone (Vite reads it before `index.*`)
- type-only imports that resolve to `.d.ts`, `.d.mts` or `.d.cts`
- percent-encoded root paths such as `/%63ollector/x`, `import.meta?.url` as a `new URL` base, `(0, import.meta.resolve)(...)` and a destructured `resolve`

Also run the full pre-commit check when a staged change is a symlink, a deletion or a rename, since those can change the result for importers that are not staged.

**Why:** Each spelling lets `src/` import `collector/` or `electron/` code with the fence silent. All need a planted symlink or an unusual spelling, and CI's full `vp check` still catches the staged-hook case.

**Context:** Found by the /ship reviews of #95/#98/#111 (red team, refuter, adversarial pass); see the review record in `docs/plans/95-fence-and-boot-hardening.md`. Add a RuleTester case per spelling, red first, as the existing `__fence_*` symlink rows do.

**Effort:** M (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** None

**Completed:** v0.9.4 (2026-10-29)

### Add the last two config-fence wiring rows

**Issue:** [#95](https://github.com/bjorkgard/nexus-one/issues/95)

**What:** Add two rows to the `configRows` table in `lint/module-fences.test.js`: `collector/` importing `react` (expect `eslint(no-restricted-imports)` with the browser-libraries message) and `src/` importing `electron` (expect `eslint(no-restricted-imports)` with the src message).

**Why:** Task 1.2 shipped the fence test suite (`vp test`, 120 cases) with every other config fence pinned. These two groups are only covered by manual probes, so an override edit that drops them would pass `vp test`. A later override for the same rule silently replaces the earlier one.

**Context:** Found by the task 1.2 /ship red team (run 3, pass 2). Follow the existing rows: one `.txt` fixture under `lint/fixtures/`, copied to a `__wiring_*` path that `.gitignore` already covers.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** None

**Completed:** v0.9.1 (2026-10-29); review record in `docs/plans/95-fence-and-boot-hardening.md`

### Harden the module-fence rule and staged hook

**Issue:** [#98](https://github.com/bjorkgard/nexus-one/issues/98)

**What:** Close the remaining edge cases found in the task 1.2 /ship reviews:

- pre-commit type-checks only staged files, so a renamed export can break unchanged importers; also run the full check when `tsconfig.json` or `package.json` is staged
- root-absolute specifiers depend on what is on disk (`/dist/x` changes after a build); check against a fixed list of source folders instead
- resolve relative specifiers from the importer's real path when the importer is a symlink
- fail loudly if the rule sees a file outside the repo root (today it silently checks nothing)
- cover `import.meta.resolve(...)` like `new URL(..., import.meta.url)`
- confirm `no-restricted-imports` group semantics for nested names and type-only imports
- on case-sensitive file systems, test root entries before lower-casing
- leftover `__wiring_*` scratch files can fail a full pre-commit check

**Why:** None affects ordinary code today, but each can give a wrong lint result in a specific setup.

**Context:** Deferred by the owner in the task 1.2 /ship run 3 (D3, D4). Each item has a reproduction in `docs/plans/1.2-module-boundaries.md` or the bucket findings; add a RuleTester or wiring case with each fix.

**Effort:** M (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** None

**Completed:** v0.9.1 (2026-10-29); review record in `docs/plans/95-fence-and-boot-hardening.md`

### Assert the packaged app shows no WebGL error box

**Issue:** [#111](https://github.com/bjorkgard/nexus-one/issues/111)

**What:** In `e2e/packaged.spec.ts`, make `assertBooted` also assert that no WebGL error box (`[role=alert]`) is shown, and prove the assertion fails against a packaged build whose renderer cannot start.

**Why:** The packaged boot test checks for a visible canvas, the label and logged errors, but not the error boundary the smoke spec checks (`e2e/smoke.spec.ts:30`). A WebGL startup failure that logs nothing would pass CI's packaged step.

**Context:** `e2e/packaged.spec.ts:29-36`. Renderer console errors and crashes already reach stderr from launch (1.7 D10), so logged failures are caught; this closes the silent case. Codex outside voice in `docs/plans/1.9-ci.md` (O3).

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.7; #106 (lands with 1.9)

**Completed:** v0.9.1 (2026-10-29); review record in `docs/plans/95-fence-and-boot-hardening.md`

### Package and boot the app in CI

**Issue:** [#106](https://github.com/bjorkgard/nexus-one/issues/106)

**What:** In task 1.9, add a macOS job that runs `vp run build && vp run pack && vp run test:packaged`.

**Why:** Task 1.7's packaged boot test runs from its own Playwright config, so the normal e2e run skips it, and 1.9's planned commands (`docs/PLAN.md:101`) neither pack nor boot. A broken package would pass CI.

**Context:** Outside voice O1 in `docs/plans/1.7-packaging-spike.md` (D11). electron-builder downloads the Electron binary (~100 MB) at pack time, not `vp install`; cache it in the workflow.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.7; lands with task 1.9

**Completed:** v0.9.0 (2026-10-29)

### Do not load the Electron spike from file://

**Issue:** [#92](https://github.com/bjorkgard/nexus-one/issues/92)

**What:** In task 1.7, load the built UI through a custom protocol (as planned for 8.1) or a loopback server instead of `dist/index.html` over `file://`.

**Why:** Vite emits `type="module"` scripts with `crossorigin` and root-relative asset URLs. Under `file://` the origin is `null`, so module and CORS loads can fail even with `base: './'`. The 1.7 spike would then fail for a reason unrelated to packaging.

**Context:** Raised by the /ship red-team review of task 1.1 (inference, not yet reproduced). `docs/PLAN.md` 1.7 currently says to load `dist/index.html`; 8.1 already plans an `app://` protocol. Start 1.7 by packaging the current build and checking the renderer console; if module loads fail, switch to `protocol.handle` early and update the plan wording.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.7

**Completed:** v0.7.0 (2026-10-28)

### Separate type environments for collector/ and electron/

**Issue:** [#96](https://github.com/bjorkgard/nexus-one/issues/96)

**What:** Before task 1.7, give `collector/` and `electron/` their own tsconfig (Node types, no DOM lib) and include them in the build's type-check.

**Why:** `vp check` type-checks those folders with `src` defaults (DOM lib, no Node types), so `window` would pass there and `process` would fail. The `build` script's `tsc` reads `tsconfig.json` (`include: ["src"]`) and skips them entirely (task 1.2 probe P8). `src/shared/` has the same problem in reverse: it must load in plain Node, yet `window` and `document` type-check there (task 1.2 /ship red team); give it a lib without DOM or add `no-restricted-globals` for browser globals.

**Context:** Found in the task 1.2 CEO review (D6). Task 1.3 set the pattern: `@types/node` is installed; `e2e/tsconfig.json` and `test/tsconfig.json` extend the root and add `types: ["node"]`; `vp check` reads the nearest tsconfig. Reuse it for `collector/` and `electron/` (for example a `collector/tsconfig.json` with `types: ["node"]`, `lib: ["ES2023"]`), then confirm `vp check` uses it for those paths. Node imports in `src/` still fail: the `import/no-nodejs-modules` lint rule at check time, and `lint/build-guards.js` at build time.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.2; must land before or with task 1.7

**Completed:** v0.7.0 (2026-10-28)

### Make the 1.6 snapshot restore in-flight state

**Issue:** [#90](https://github.com/bjorkgard/nexus-one/issues/90)

**What:** In task 1.6, define `Snapshot` in `src/shared/protocol.ts` so it restores open tool calls (`callId`, `tool`, start ts), queued tasks and attention state, not only the `Project`, `Session` and `Agent` entities.

**Why:** A client that connects mid-session otherwise loses waiting agents and queued trays until the next event, and a `tool_call_end` that then arrives has no matching start.

**Context:** Raised by the task 1.4 CEO review outside voice (Codex, finding O2); the owner kept 1.4's entities as they are and gave the snapshot to 1.6 (D12 in `docs/plans/1.4-canonical-event-schema.md`). Test it by connecting `LiveSource` after a `tool_call_start`, a `task_queued` and a `needs_attention`, then sending the matching end events and checking the store.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P1
**Depends on:** Task 1.4 (schema), task 1.6

**Completed:** v0.6.0 (2026-10-28)

### Drop duplicate events by id across reconnects

**Issue:** [#91](https://github.com/bjorkgard/nexus-one/issues/91)

**What:** In task 1.6, have the client skip events whose `id` it has already applied (a bounded set of recent ids), including events resent after a reconnect.

**Why:** Task 1.4 made each `tokens` event one model call's usage, so totals are sums; a resent event would double-count spend and tokens/min with no error.

**Context:** Decision D10 in `docs/plans/1.4-canonical-event-schema.md` (outside voice finding O3). Every event carries a unique `id` (envelope). Test by resending the last few events after a reconnect and checking that token totals do not change.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P1
**Depends on:** Task 1.4 (schema), task 1.6

**Completed:** v0.6.0 (2026-10-28)

### Give 1.6 a minimal shared event reducer

**Issue:** [#100](https://github.com/bjorkgard/nexus-one/issues/100)

**What:** In task 1.6, add a minimal pure event reducer in `src/shared/` (events in, `Project` / `Session` / `Agent` state out) that `MockSource` and `LiveSource` use to build snapshots and that task 4.5's store later wraps instead of duplicating.

**Why:** Decision D13 of the task 1.5 review gives 1.6 the job of building the mock snapshot by replaying events, but the store reducer is task 4.5, three phases later, and phases run in order. Without an owner in 1.6, it is either blocked or writes a throwaway reducer that 4.5 duplicates.

**Context:** Raised by the task 1.5 CEO review outside voice (Codex, finding O3); owner accepted it as a 1.6 TODO (D25 in `docs/plans/1.5-mock-event-generator.md`). The generator emits events only, in ts order (D13); `checkStream` in `src/shared/check-stream.ts` (D15) already tracks open tool calls, tasks and attention per agent, which the reducer can mirror. Test by reducing the default mock stream and checking entity counts against the 10.1 shape (1 project, 3 sessions, 8 subagents).

**Effort:** S (human) / S (CC+gstack)
**Priority:** P1
**Depends on:** Task 1.5 (mock generator), task 1.6

**Completed:** v0.6.0 (2026-10-28)

### Resolve fence imports with Vite's own resolver

**Issue:** [#126](https://github.com/bjorkgard/nexus-one/issues/126)

**What:** Make `lint/module-fences.js` resolve each fenced specifier with Vite's own resolver (for example the dev server's `pluginContainer.resolveId`, with the project's `vite.config.ts`) and fence the resolved file, instead of re-implementing Vite's resolution rules by hand.

**Why:** Each /ship adversarial pass on #116 found new spellings that Vite resolves into another zone while the hand-written rule passes them. Two proven ones are still open on `main`: `./ok.ts?/../../../electron/main.ts` (the rule cuts at `?` or `#` before resolving, while Vite normalizes the `..` first; the same works with `#`, root-absolute paths, `import()`, `import.meta.resolve` and `new URL`), and an absolute disk path such as `/<repo>/electron/main.ts` (the rule treats it as a `public/` URL, while Vite loads the file). Fixing spellings one at a time has not converged.

**Context:** Both bypasses were reproduced with real oxlint and real Vite resolution by the /ship adversarial pass of #116; that pass's harness called `pluginContainer.resolveId` from `node_modules/vite`. Oxlint runs JS plugins synchronously, so check whether a resolver can run synchronously or be precomputed per lint run. Keep the existing RuleTester rows as the acceptance suite and add red-first rows for both bypasses. #121 (importer `package.json` maps) and #123 (relative percent-decoding) are other cases of the same cause.

**Effort:** L (human) / M (CC+gstack)
**Priority:** P1
**Depends on:** None

**Completed:** unreleased (2026-10-29)

### Fence imports redirected by the importer's package.json

**Issue:** [#121](https://github.com/bjorkgard/nexus-one/issues/121)

**What:** Make `lint/module-fences.js` fence imports that the importer's nearest `package.json` redirects: its `browser` object map (for example `"./x.js": "../../electron/secret.ts"`) and its `imports` map (`#s`). Today the fence reads only the target folder's `package.json`, and a `#` specifier resolves to nothing, so both are allowed.

**Why:** Vite applies both maps when it bundles. With a `src/foo/package.json` in place, `vite build` bundled `electron/` code into `src/` while the fence reported nothing. The root `package.json` can do the same for every `src/` file.

**Context:** Proven by the /ship adversarial pass of #116 (`vite build` plus oxlint in a scratch project). Two fix options: resolve the nearest `package.json` `browser` and `imports` maps for each importer and fence the mapped values, or report every `#` specifier and ban `package.json` files inside fenced zones. Add red-first RuleTester rows with a planted `package.json`, like the existing `__fence_pkg_*` fixtures.

**Effort:** M (human) / S (CC+gstack)
**Priority:** P1
**Depends on:** None

**Completed:** unreleased (2026-10-29)

### Percent-decode relative specifiers in the module fence

**Issue:** [#123](https://github.com/bjorkgard/nexus-one/issues/123)

**What:** Find out whether Vite decodes percent-escapes in relative specifiers (`./%2e%2e/electron/x`) and, if it does, decode them in `resolveFrom` before resolving, as root-absolute specifiers already are.

**Why:** If Vite decodes them, `./%2e%2e/...` climbs out of the importer's folder while the fence resolves a folder literally named `%2e%2e`.

**Context:** Found by a refuter during #116 and not checked against Vite. The production build does not decode root-absolute paths, but the dev server does, so check both. Write a red-first RuleTester row before the fix.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** None

**Completed:** unreleased (2026-10-29)

### Fence `new URL` with a destructured `import.meta.url` base

**Issue:** [#124](https://github.com/bjorkgard/nexus-one/issues/124)

**What:** Report or check `const { url } = import.meta; new URL(x, url)`, where the `new URL` base is a variable that holds the importer's URL.

**Why:** The fence checks a `new URL` path only when `import.meta.url` appears in the base expression itself, so a destructured or copied `url` hides the import.

**Context:** Deferred during #116 because following the variable needs data flow the rule does not have. The simplest fix is to report destructuring `url` from `import.meta` as non-static, as `resolve` and `glob` already are, after checking that no repo code relies on it.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P3
**Depends on:** None

**Completed:** unreleased (2026-10-29)
