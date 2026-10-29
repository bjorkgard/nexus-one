# Nexus One

The Nexus One shell: a React + React Three Fiber + Tailwind app built with [Vite+](https://viteplus.dev/).

## Getting started

Install the Vite+ CLI (`vp`) using the [official installation guide](https://viteplus.dev/guide/), then clone the repository and install dependencies:

```sh
git clone https://github.com/bjorkgard/nexus-one.git
cd nexus-one
vp install
```

The project uses npm, with its version declared in `package.json`. Run `vp install` again after pulling dependency changes.

Start the development server:

```sh
vp run dev
```

Open the local URL printed in the terminal. Changes to source files update the app through hot module replacement.

## Commands

- `vp run dev` — Start the development server.
- `vp check` — Check formatting, lint rules, and TypeScript types.
- `vp test` — Run the unit test suite.
- `npx playwright test` — Run the Playwright tests (smoke, data source, performance overlay and isometric stage) against the dev server on port 5199.
- `vp exec playwright install chromium` — One-time download of the browser Playwright uses.
- `vp run build` — Run `vp check` and the TypeScript compiler, then create a production build in `dist/`. Any `vp build` fails if a Node built-in, `__nexus`, a performance overlay marker or the zone overlay marker reaches the browser bundle.
- `vp run preview` — Serve the production build locally after building.
- `vp run pack` — Build the UI and the Electron main process, then package an unsigned macOS app into `release/mac-arm64/Nexus One.app` (about 1 minute). It never publishes.
- `vp run start` — Build, then launch the Electron app from source.
- `vp run test:packaged` — Run after `vp run pack`: launch the packaged app with Playwright and check that it renders without the "WebGL is unavailable" error box. A second test starts it with the GPU off to prove that check finds the real box.

The packaged build is unsigned (8.5 owns signing), so the first launch of a downloaded copy may need right-click → Open. To see main-process and `[renderer]` logs, run the binary from a terminal: `"release/mac-arm64/Nexus One.app/Contents/MacOS/Nexus One"`.

Use `vp run <name>` for scripts defined in `package.json`. Built-in commands such as `vp check` and `vp test` run directly.

## Project structure

- `index.html` — HTML entry point.
- `src/main.tsx` — Application entry; writes the colour tokens as `--nx-*` CSS variables, then mounts React into `#app`.
- `src/App.tsx` — Root component with the 3D canvas, the stage, the wordmark and the canvas error boundary (which shows `ErrorPanel`); in dev it also mounts the performance overlay and the zone overlay.
- `src/style.css` — Tailwind import, the bundled Instrument Sans font, base layout styles, the stage fade-in and the wordmark and error panel styles.
- `src/world/` — Geometry.
  - `zones.ts` — `createZoneRegistry({ floors })`: the named campus zones (lobby, office floors, garage, loading bay, break room, server room, roof) as boxes, with `byId(id)` and `at(point)` lookups. `floors` counts the lobby and must be an integer from 2 to 40 (default 6).
  - `camera.ts` — Isometric camera maths: view direction, framing bounds, camera rig and `fitZoom`, plus the grid fade.
  - `Stage.tsx` — The ground slab, grid, lights and orthographic camera; refits on resize and calls `onReady` after the first fitted frame. In dev, `?floors=<n>` overrides the floor count (an invalid value shows the error panel) and `?zones=1` frames the whole campus box and turns on the zone overlay.
  - `stage-look.ts` — `LOOK`: the stage's size, grid, light and overlay constants (surface colours come from `src/shared/tokens.ts`).
- `src/sim/` — Simulation and animation state.
- `src/ui/` — Dashboard.
  - `Wordmark.tsx` — The "Nexus One" wordmark in the top-left corner.
  - `ErrorPanel.tsx` — The message and Reload button shown when the 3D view cannot start; in dev it also shows the error text.
  - `applyCssTokens.ts` — Writes every token from `src/shared/tokens.ts` to `<html>` as a `--nx-*` CSS variable.
- `src/data/` — Client store and data sources. `mock.ts` exports `createMockStream(options?)`, the seeded, repeatable mock event stream (same seed, same events), plus `MOCK_ROLES` and `MOCK_TIMING` for finding its scripted agents. A lint rule bans `Date`, `Math.random`, `performance.now`, `performance.timeOrigin` and `crypto` in `mock.ts` and its test.
  - `source.ts` — `createDataClient(transport)`: the one gate for epoch, seq cursor and dedup; `selectSource(search)` reads `?source=` and `?port=`.
  - `live-source.ts` — `liveTransport(port)`: WebSocket transport to `127.0.0.1` with backoff and a hello+snapshot deadline.
  - `mock-source.ts` — `mockTransport()`: plays the mock stream with a movable clock; a backward seek rebuilds state in a new epoch.
  - `boot.ts` — `startDataSource()`: picks the transport, starts the client and registers the dev hooks; called once from `src/main.tsx`.
- `src/debug/` — Dev-only `window.__nexus` test hooks, the performance overlay and the zone overlay (`ZoneOverlay.tsx`: zone box edges and name labels, shown with `?zones=1`).
- `src/shared/` — Types and schema shared with `collector/`; imports no React, Three, Node, or other `src/` folders; ESM only (no `require`); `schema.ts` is the only place event shapes are declared, and trust edges call its `parseEvent` (returns issues, never throws); `check-stream.ts` exports `checkStream(events, { complete })`, which validates any event stream and returns named problems instead of throwing.
  - `protocol.ts` — Wire messages (`hello`, `snapshot`, `event`) and `parseServerMessage`.
  - `reduce.ts` — Pure event reducer, plus `toSnapshot` / `fromSnapshot`.
  - `apply-once.ts` — `applyOnce`, the dedup entry: bounded recent-id ring plus reducer.
  - `tokens.ts` — `TOKENS`, the shared colour tokens (background, slab, grid, text, danger, zone kinds), as data only; `flattenTokens` and `cssVarName` map them to `--nx-*` names.
- `collector/` — Node-only code; imports no React, Three, Electron, or `src/` except `src/shared/`; ESM only (no `require`).
- `electron/` — Electron main process. `main.ts` is start-up and the window; `resolve.ts` is the `app://` file policy. Imports only `electron/` and `src/shared/`; no browser libraries (React, Three, zustand, three-stdlib); no `createRequire` or CommonJS.
- `package.json` `dependencies` is empty on purpose: it means "loaded by Electron main at run time". Everything else is bundled (Vite for the renderer, `vp pack` for main) and goes in `devDependencies`.
- Module fences: `src/` may import only `src/`, `src/shared/` only itself, and `collector/` and `electron/` only themselves and `src/shared/`; `src/` also cannot import Node built-ins. `vp check` enforces this as an allow-list on resolved paths in `lint/module-fences.js`, and dynamic imports, globs and `new URL` in those folders must use static string specifiers. An `import.meta.glob` is fenced by the folder it searches, and each file it matches is also checked by its real path, so a link into another zone is reported. A glob pattern that contains `#` is also reported, because Vite keeps the `#` and the fence cannot follow the path. The fence resolves specifiers the way Vite does (`/@fs/` paths, percent-encoded root paths, `.js` to `.ts` swaps, `.d.ts` type imports and `package.json` entry points, including `browser` maps; an imported folder whose `package.json` is not valid JSON is reported), and reports `import.meta.resolve` and `import.meta.glob` when they are used other than as a direct call.
- Inside `src/`, only `src/shared/` may import `zod`; the rest of `src/` imports schemas and types from `src/shared/schema.ts` (`vp check` enforces this).
- `lint/` — Local Oxlint plugin with the module-fence rule, and the build-guard plugin (`lint/build-guards.js`).
- `e2e/` — Playwright specs and the typed `__nexus` helper.
- `test/` — Node-backed tests, such as the build guards.
- `playwright.config.ts` — Playwright configuration.
- `playwright.electron.config.ts` — Playwright configuration for the packaged app (`vp run test:packaged`).
- `vite.config.ts` — Vite+ configuration, plugins, formatting, linting, type checking, and staged-file checks.
- `tsconfig.json` — TypeScript compiler configuration. `electron/`, `collector/` and `src/shared/` each add a `tsconfig.json` that drops the DOM library, so browser globals such as `window` fail type checking there.
- `.vite-hooks/pre-commit` — Runs checks on staged files before committing; a staged deletion, rename, type change, symlink or submodule runs the full `vp check` instead.
- `.github/workflows/ci.yml` — The `ci` job (see [CI](#ci)). `.github/dependabot.yml` — Weekly Dependabot updates for GitHub Actions and range-versioned npm packages.
- `TODOS.md` — Deferred work.
- `CHANGELOG.md` — Release notes.
- `AGENTS.md` — Vite+ toolchain instructions for coding agents.
- `CLAUDE.md` — Project rules for Claude Code, including where plan reviews are stored.
- `docs/PLAN.md` — Phased build plan.
- `docs/plans/` — Per-task plan and review files.

## Material palette and geometry cache

- `src/world/palette.ts` exports `palette`: 10 shared materials (`ground`, `panel`, `trimCyan`, `trimWhite`, `glass`, `floor`, `furniture`, `screen`, `paint`, `led`) built once. They are read-only: never edit `.color`, `.opacity` or any other property on `palette.*` from a mesh. In dev, writing `color` or `emissive` throws `palette.<name>.<prop> is shared and read-only; tint per object with instance or vertex colour (src/world/palette.ts)`.
- Tint one object with instance colour (`InstancedMesh.setColorAt`). Vertex colours are allowed only when baked into the geometry at build time with the colour data in the geometry cache key (the slab does this). `screen` and `led` are unlit, white-based and take their colour per instance.
- A deliberate different material goes through `variant(name, overrides)`. Allowed keys: `color` (hex), `opacity` (glass only), `roughness` and `metalness` (lit materials only), `emissiveIntensity` (materials with an emissive colour, at most `LOOK.emissiveCeiling`). Unknown keys, bad values and keys that cannot take effect throw. The cache key is the material name plus the overrides, normalised like geometry keys (hex lower-cased, floats rounded to 4 places), so equal overrides share one clone.
- Material budget: palette + variants + the drei Grid must stay under `MATERIAL_BUDGET` (30); `variant()` throws when it would reach it.
- `src/world/geometry-cache.ts`: `getGeometry(kind, params, build)` returns one shared geometry per kind and params. The cache never disposes (app lifetime). On HMR each module clears only its own kinds with `__clearGeometryCache(kinds)`. `__nexus.cacheStats()` returns `{ size, hits, misses }`; `__nexus.rendererInfo()` also reports `materials` and `programs`.
- `?palette=1` (dev only) shows the swatch board: surfaces, vehicle paints and a "Together" vignette, each swatch labelled with its token name and hex. The stage reveal waits for the board (3 s timeout, one console warning). If the board throws, a "Palette board failed: <message>" line replaces it; if it arrives after the timeout, "Palette board timed out". `?zones=1` wins the framing when both are set.
- The board exists only in dev; the build fails if its marker (`nexus-palette-board`) reaches the production bundle.

## Data source

The app starts one data client at boot (`src/data/boot.ts`). Pick the source in the URL:

- `?source=mock|live` — default `mock`. Any other value logs a warning and uses `mock`.
- `?port=` — live port, integer 1024-65535, default 47821. The host is fixed to `127.0.0.1`.

Protocol (`src/shared/protocol.ts`):

- The server sends `hello` (version, epoch), then `snapshot` (epoch, seq, state), then `event` messages (epoch, seq).
- The snapshot carries in-flight state (open tool calls, queued tasks, attention), per-model usage and `recentIds` (the ids already applied).
- Events dedup by seq cursor plus a bounded recent-id set. `applyOnce` in `src/shared/apply-once.ts` is the entry the collector must call.

Recovery rules:

- The client resyncs on a seq gap, an order fault or a rejected message.
- The client waits 5 s for hello and snapshot, then reconnects.
- Reconnect backoff starts at 250 ms, doubles to 2 s and adds jitter.
- A version mismatch sets status `incompatible`.

Known limit: rolling tokens/min restarts from new events after a reconnect.

Dev hooks (see below): `__nexus.emit(event)` applies one event and throws on invalid input; `__nexus.setClock(ts)` moves the mock clock (`?source=mock` only); `__nexus.dataState()` returns source, status, clock, last event id, entity counts and counters.

## Development checks

Before committing changes, run:

```sh
vp check
vp test
npx playwright test
vp run build
```

If you changed `electron/` or packaging, also run `vp run pack` and `vp run test:packaged`.

`vp test` runs the `src/` and `electron/` unit tests, the `lint/` tests (`lint/module-fences.test.js`, the RuleTester suite for the module-fence rule, and `lint/build-guards.test.js`, which checks the guarded dev markers) and the `test/` build-guard tests.

## CI

One GitHub Actions job (`ci`, `.github/workflows/ci.yml`) runs on a `macos-15` arm64 runner for every push to `main` and every pull request. Its steps, in order: restore the Electron and Playwright download cache, install with `vp` (frozen lockfile), install the Playwright browser, `vp check`, `vp test`, `vp exec playwright test`, `vp run pack`, `vp run test:packaged`. `vp run pack` runs the build, so there is no separate build step. Type errors fail at the `vp check` step.

To read a red run, open the failed step by name. When a run fails or is cancelled, it uploads `playwright-report/` and `test-results/` (with Playwright traces) as artifacts, kept for 14 days.

- A network failure at install or pack (the Electron download) may not be a code fault. Re-run the job once.
- A WebGL failure in e2e on the runner means the runner lacks WebGL. Report it; do not add browser flags.
- CI installs with a frozen lockfile. After changing `package.json`, run `vp install` and commit `package-lock.json`.
- Dependabot leaves exact pins in `package.json` alone. Upgrade them by hand when a GitHub vulnerability alert fires.
- Branch protection on `main` requires the `ci` check and an up-to-date branch. If CI on `main` is itself broken, remove protection with `gh api -X DELETE repos/bjorkgard/nexus-one/branches/main/protection`, merge the revert, then re-apply protection. The exact payload is in `docs/plans/1.9-ci.md`.

## Test locations

- Browser-safe unit tests live next to the code in `src/`.
- Main-process unit tests live next to the code in `electron/` (for example `resolve.test.ts`, which covers the `app://` file policy).
- Tests that need Node live in `test/`, because the `src/` fence bans Node built-ins, tests included.
- Browser tests live in `e2e/`.

## Performance overlay

In `vp run dev`, press the backtick key (`` ` ``; on a Swedish keyboard Shift + ´) to show or hide the overlay (FPS and CPU graphs, draw calls, triangles, geometries, textures, heap). Draw calls turn yellow from 240 and red from 300. Add `?probe=box` to the URL to draw a 12-triangle box so the counters have something to show. The overlay and the probe exist only in dev builds.

## Adding a `__nexus` hook

- Add the name and signature to `NexusHooks` in `src/debug/nexus.ts`.
- In a React component, call `registerNexus` in an effect and return its unregister function as the cleanup.
- In module-scope code, call `registerNexusModule(import.meta.hot, name, fn)`.
- Both are no-ops outside dev, and the build fails if `__nexus` reaches production.
- Call hooks from e2e with `nexus(page, name, ...args)` from `e2e/nexus.ts`.

The pre-commit hook runs `vp staged`, which applies `vp check --fix` to staged files, or runs the full `vp check` when the commit stages a deletion, rename, type change, symlink or submodule (or `git` fails). Review any automatic fixes before pushing.

Keep credentials out of version control. `.env` and `.env.*` files are ignored, except `.env.example`, which should contain placeholders only. Dependencies (`node_modules/`) and build output (`dist/`, `dist-electron/` and `release/`) are also ignored.
