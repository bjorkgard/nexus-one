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

### Automated test for the module-boundary lint fences

**What:** In task 1.3, add a Vitest test that lints one fixture file per fence (src → collector, src → electron, src → Node built-in, src/shared → React, collector → React/Three, collector → src/ui) with the real `vite.config.ts` and asserts each named rule fires.

**Why:** Task 1.2 proves the fences once, by hand. A later override for the same rule silently replaces the earlier one (task 1.2 probe P11), so a config edit can disable a fence while `vp check` still passes. There is no CI.

**Context:** Decided in the task 1.2 CEO review (D4, `docs/plans/1.2-module-boundaries.md`). Fixtures must sit outside the paths `vp check` scans, or be linted from a temp copy, so the normal check stays green. Assert rule names (`eslint(no-restricted-imports)`, `import(no-nodejs-modules)`), not just a non-zero exit: Node and `electron` imports also fail through missing types (probes P4, P7).

**Effort:** S (human) / S (CC+gstack)
**Priority:** P2
**Depends on:** Task 1.2 (fences), task 1.3 (Vitest via `vp test`)

### Separate type environments for collector/ and electron/

**What:** Before task 1.7, give `collector/` and `electron/` their own tsconfig (Node types, no DOM lib) and include them in the build's type-check.

**Why:** `vp check` type-checks those folders with `src` defaults (DOM lib, no Node types), so `window` would pass there and `process` would fail. The `build` script's `tsc` reads `tsconfig.json` (`include: ["src"]`) and skips them entirely (task 1.2 probe P8).

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
