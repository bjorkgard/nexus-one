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
