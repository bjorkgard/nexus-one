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

**Context:** Found in the task 1.2 CEO review (D6). Start with a `tsconfig.node.json` (`types: ["node"]`, `lib: ["ES2023"]`) and project references, add `@types/node`, then confirm `vp check` uses it for those paths. Once `@types/node` is installed, Node imports in `src/` fail only through the `import/no-nodejs-modules` lint rule; that is intended.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.2; must land before or with task 1.7

### Pick a home for Node-backed tests before the fences bite

**What:** In task 1.3, choose where tests that need Node live (for example `test/` at the repo root, or next to code in `collector/`), outside `src/**`, and record it in the README.

**Why:** Task 1.2 bans Node built-ins everywhere under `src/**`, test files included. Task 1.6 tests `LiveSource` against an in-test WebSocket server (`docs/PLAN.md:78`). Without a chosen location, the first such test lands next to its code, fails the fence, and the easy fix is to weaken the fence.

**Context:** Raised by the Codex outside voice in the task 1.2 eng review (X2, Eng D4 in `docs/plans/1.2-module-boundaries.md`). Keep the `src/**` fence unchanged. Check whether 1.6 needs Node built-ins at all or only the `ws` package; `ws` is not a built-in, so only `import/no-nodejs-modules` matters.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.2 (fences); do it in task 1.3, before task 1.6

### Check the production bundle for collector/ and Node code

**What:** Extend task 1.3's bundle check (it already greps `dist/` for `__nexus`) to assert that the browser bundle contains no `collector/` code and no Node built-in import, and add a matching check that a collector build (once one exists) contains no React or Three.

**Why:** The task 1.2 lint fences (`lint/module-fences.js` plus `vite.config.ts` bans) are an honest-mistake guard, not a guarantee. These known bypasses need deliberate effort and are accepted there; only a bundle check catches them:

- `file://` specifiers, or any specifier hidden with `// @ts-expect-error`
- React-importing transitive packages not in `browserLibs` (for example `its-fine`, `suspend-react`, `scheduler`)
- inline `oxlint-disable` comments for the fence rules
- Node-only npm packages imported from `src/` (for example `vite-plus`, `typescript`)
- files in gitignored folders under `src/` (`vp check` skips them, Vite bundles them)
- bare-relative or percent-encoded `new URL("sub/../..", import.meta.url)` strings
- `createRequire` reached through destructuring or `process.getBuiltinModule`
- `import x = require(...)` (today also blocked by TS1294), extglob `..`, alias specifiers (none configured yet), HTML/CSS entry points

**Context:** Decided in the task 1.2 /ship review (D6, run 2). `electron/` fences are decided in task 1.7; until then it is intentionally unfenced. Pick marker strings that only collector code contains, and a list of `node:` / built-in specifiers; fail the check on any match.

**Effort:** S (human) / S (CC+gstack)
**Priority:** P1
**Depends on:** Task 1.3

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
