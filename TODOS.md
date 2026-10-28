# TODOS

## Rendering

### Recover from WebGL context loss

**What:** Handle `webglcontextlost` / `webglcontextrestored` on the R3F canvas: show a visible message while lost, restore the scene when the context returns.

**Why:** After laptop sleep or a GPU driver reset, the campus freezes on its last frame with no message. Nothing in `docs/PLAN.md` covers it (task 9.4 restarts the collector, not the renderer).

**Context:** Found in the task 1.1 eng review (Codex outside voice, finding X2). Task 1.1 adds an error boundary for WebGL _startup_ failure only. three.js already logs `WebGLRenderer: Context Lost.`; R3F exposes the renderer via `useThree(s => s.gl)`, so listeners can attach to `gl.domElement`. Start by forcing loss with the `WEBGL_lose_context` extension in a dev build. Best fit: a new step before Phase 9's clean-account checks.

**Effort:** M (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.1 (canvas + error boundary), task 1.3 (`window.__nexus` for an e2e check)

## Packaging

### Do not load the Electron spike from file://

**What:** In task 1.7, load the built UI through a custom protocol (as planned for 8.1) or a loopback server instead of `dist/index.html` over `file://`.

**Why:** Vite emits `type="module"` scripts with `crossorigin` and root-relative asset URLs. Under `file://` the origin is `null`, so module and CORS loads can fail even with `base: './'`. The 1.7 spike would then fail for a reason unrelated to packaging.

**Context:** Raised by the /ship red-team review of task 1.1 (inference, not yet reproduced). `docs/PLAN.md` 1.7 currently says to load `dist/index.html`; 8.1 already plans an `app://` protocol. Start 1.7 by packaging the current build and checking the renderer console; if module loads fail, switch to `protocol.handle` early and update the plan wording.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.7

## Tooling

### Add the last two config-fence wiring rows

**What:** Add two rows to the `configRows` table in `lint/module-fences.test.js`: `collector/` importing `react` (expect `eslint(no-restricted-imports)` with the browser-libraries message) and `src/` importing `electron` (expect `eslint(no-restricted-imports)` with the src message).

**Why:** Task 1.2 shipped the fence test suite (`vp test`, 120 cases) with every other config fence pinned. These two groups are only covered by manual probes, so an override edit that drops them would pass `vp test`. A later override for the same rule silently replaces the earlier one.

**Context:** Found by the task 1.2 /ship red team (run 3, pass 2). Follow the existing rows: one `.txt` fixture under `lint/fixtures/`, copied to a `__wiring_*` path that `.gitignore` already covers.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** None

### Separate type environments for collector/ and electron/

**What:** Before task 1.7, give `collector/` and `electron/` their own tsconfig (Node types, no DOM lib) and include them in the build's type-check.

**Why:** `vp check` type-checks those folders with `src` defaults (DOM lib, no Node types), so `window` would pass there and `process` would fail. The `build` script's `tsc` reads `tsconfig.json` (`include: ["src"]`) and skips them entirely (task 1.2 probe P8). `src/shared/` has the same problem in reverse: it must load in plain Node, yet `window` and `document` type-check there (task 1.2 /ship red team); give it a lib without DOM or add `no-restricted-globals` for browser globals.

**Context:** Found in the task 1.2 CEO review (D6). Task 1.3 set the pattern: `@types/node` is installed; `e2e/tsconfig.json` and `test/tsconfig.json` extend the root and add `types: ["node"]`; `vp check` reads the nearest tsconfig. Reuse it for `collector/` and `electron/` (for example a `collector/tsconfig.json` with `types: ["node"]`, `lib: ["ES2023"]`), then confirm `vp check` uses it for those paths. Node imports in `src/` still fail: the `import/no-nodejs-modules` lint rule at check time, and `lint/build-guards.js` at build time.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.2; must land before or with task 1.7

### Check the production bundle for collector/ and Node code

**What:** Task 1.3's `lint/build-guards.js` already fails the build on any Node built-in (from any importer) and on `__nexus`. Remaining: assert that the browser bundle contains no `collector/` code (pick a marker string in task 4.1 that only collector code contains), and add a matching check that a collector build contains no React or Three.

**Why:** The task 1.2 lint fences (`lint/module-fences.js` plus `vite.config.ts` bans) are an honest-mistake guard, not a guarantee. These known bypasses need deliberate effort and are accepted there; only a bundle check catches them. The build guard now covers imports of any Node built-in (bare or `node:`, from any importer), so Node-only npm packages imported from `src/` (for example `vite-plus`, `typescript`) and `createRequire` reached through destructuring now fail `vp build` (task 1.3 refuter, scratch builds). The bypasses below are not covered by it and still apply to the remaining checks:

- `file://` specifiers, or any specifier hidden with `// @ts-expect-error`
- React-importing transitive packages not in `browserLibs` (for example `its-fine`, `suspend-react`, `scheduler`)
- inline `oxlint-disable` comments for the fence rules
- files in gitignored folders under `src/` (`vp check` skips them, Vite bundles them)
- bare-relative or percent-encoded `new URL("sub/../..", import.meta.url)` strings
- `process.getBuiltinModule`
- `import x = require(...)` (today also blocked by TS1294), extglob `..`, alias specifiers (none configured yet), HTML/CSS entry points

**Context:** Decided in the task 1.2 /ship review (D6, run 2). `electron/` fences are decided in task 1.7; until then it is intentionally unfenced. No collector code exists yet, so this waits for task 4.1. Fail the check on any marker match.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P1
**Depends on:** Task 4.1

### Give Phase 3 e2e a test target before agents exist

**What:** Pick a target for the e2e tests of 3.2 (pick), 3.3 (glide) and 3.4 (follow), for example desks from 2.5 or a test fixture object. Also have 3.1 register the camera-controls target through the `__nexus` registry.

**Why:** Those tasks test against agents, which arrive in 4.5/4.6 after Phase 3. `useThree()`'s camera has no target, so the e2e tests cannot read it without a registered hook.

**Context:** CEO D9 and D11 in `docs/plans/1.3-test-harness-debug-api.md`; `docs/PLAN.md` steps 3.2-3.4.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 2.5; must land before task 3.2

### Harden the module-fence rule and staged hook

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

### Lock down the collector WebSocket beyond loopback

**What:** In task 4.4, have the collector WebSocket server validate `Origin` against an allowlist and require a per-launch random token handed out by Electron main or the dev server.

**Why:** Any web page in the user's browser can open `ws://127.0.0.1` (cross-site WebSocket hijacking) and read transcripts; binding to loopback alone does not stop it.

**Context:** Decided in the task 1.2 /ship review (D9). Test with a foreign `Origin` and with a missing token; both must be rejected.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P1
**Depends on:** Task 4.4
