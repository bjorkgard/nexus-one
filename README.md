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
- `npx playwright test` — Run the Playwright tests (smoke and data source) against the dev server on port 5199.
- `vp exec playwright install chromium` — One-time download of the browser Playwright uses.
- `vp run build` — Run `vp check` and the TypeScript compiler, then create a production build in `dist/`. Any `vp build` fails if a Node built-in or `__nexus` reaches the browser bundle.
- `vp run preview` — Serve the production build locally after building.
- `vp run pack` — Build the UI and the Electron main process, then package an unsigned macOS app into `release/mac-arm64/Nexus One.app` (about 1 minute).
- `vp run start` — Build, then launch the Electron app from source.
- `vp run test:packaged` — Run after `vp run pack`: launch the packaged app with Playwright and check that it renders.

The packaged build is unsigned (8.5 owns signing), so the first launch of a downloaded copy may need right-click → Open. To see main-process and `[renderer]` logs, run the binary from a terminal: `"release/mac-arm64/Nexus One.app/Contents/MacOS/Nexus One"`.

Use `vp run <name>` for scripts defined in `package.json`. Built-in commands such as `vp check` and `vp test` run directly.

## Project structure

- `index.html` — HTML entry point.
- `src/main.tsx` — Application entry; mounts React into `#app`.
- `src/App.tsx` — Root component with the 3D canvas and its error boundary.
- `src/style.css` — Tailwind import and base layout styles.
- `src/world/` — Geometry.
- `src/sim/` — Simulation and animation state.
- `src/ui/` — Dashboard.
- `src/data/` — Client store and data sources. `mock.ts` exports `createMockStream(options?)`, the seeded, repeatable mock event stream (same seed, same events), plus `MOCK_ROLES` and `MOCK_TIMING` for finding its scripted agents. A lint rule bans `Date`, `Math.random`, `performance.now`, `performance.timeOrigin` and `crypto` in `mock.ts` and its test.
  - `source.ts` — `createDataClient(transport)`: the one gate for epoch, seq cursor and dedup; `selectSource(search)` reads `?source=` and `?port=`.
  - `live-source.ts` — `liveTransport(port)`: WebSocket transport to `127.0.0.1` with backoff and a hello+snapshot deadline.
  - `mock-source.ts` — `mockTransport()`: plays the mock stream with a movable clock; a backward seek rebuilds state in a new epoch.
  - `boot.ts` — `startDataSource()`: picks the transport, starts the client and registers the dev hooks; called once from `src/main.tsx`.
- `src/debug/` — Dev-only `window.__nexus` test hooks.
- `src/shared/` — Types and schema shared with `collector/`; imports no React, Three, Node, or other `src/` folders; ESM only (no `require`); `schema.ts` is the only place event shapes are declared, and trust edges call its `parseEvent` (returns issues, never throws); `check-stream.ts` exports `checkStream(events, { complete })`, which validates any event stream and returns named problems instead of throwing.
  - `protocol.ts` — Wire messages (`hello`, `snapshot`, `event`) and `parseServerMessage`.
  - `reduce.ts` — Pure event reducer, plus `toSnapshot` / `fromSnapshot`.
  - `apply-once.ts` — `applyOnce`, the dedup entry: bounded recent-id ring plus reducer.
- `collector/` — Node-only code; imports no React, Three, Electron, or `src/` except `src/shared/`; ESM only (no `require`).
- `electron/` — Electron main process. `main.ts` is start-up and the window; `resolve.ts` is the `app://` file policy. Imports only `electron/` and `src/shared/`; no browser libraries (React, Three, zustand, three-stdlib); no `createRequire` or CommonJS.
- `package.json` `dependencies` is empty on purpose: it means "loaded by Electron main at run time". Everything else is bundled (Vite for the renderer, `vp pack` for main) and goes in `devDependencies`.
- Module fences: `src/` may import only `src/`, `src/shared/` only itself, and `collector/` and `electron/` only themselves and `src/shared/`; `src/` also cannot import Node built-ins. `vp check` enforces this as an allow-list on resolved paths in `lint/module-fences.js`, and dynamic imports, globs and `new URL` in those folders must use static string specifiers.
- Inside `src/`, only `src/shared/` may import `zod`; the rest of `src/` imports schemas and types from `src/shared/schema.ts` (`vp check` enforces this).
- `lint/` — Local Oxlint plugin with the module-fence rule, and the build-guard plugin (`lint/build-guards.js`).
- `e2e/` — Playwright specs and the typed `__nexus` helper.
- `test/` — Node-backed tests, such as the build guards.
- `playwright.config.ts` — Playwright configuration.
- `playwright.electron.config.ts` — Playwright configuration for the packaged app (`vp run test:packaged`).
- `vite.config.ts` — Vite+ configuration, plugins, formatting, linting, type checking, and staged-file checks.
- `tsconfig.json` — TypeScript compiler configuration. `electron/`, `collector/` and `src/shared/` each add a `tsconfig.json` that drops the DOM library, so browser globals such as `window` fail type checking there.
- `.vite-hooks/pre-commit` — Runs checks on staged files before committing.
- `TODOS.md` — Deferred work.
- `CHANGELOG.md` — Release notes.
- `AGENTS.md` — Vite+ toolchain instructions for coding agents.
- `CLAUDE.md` — Project rules for Claude Code, including where plan reviews are stored.
- `docs/PLAN.md` — Phased build plan.
- `docs/plans/` — Per-task plan and review files.

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

`vp test` runs the `src/` and `electron/` unit tests, the `lint/` fence tests (`lint/module-fences.test.js`, the RuleTester suite for the module-fence rule) and the `test/` build-guard tests.

## Test locations

- Browser-safe unit tests live next to the code in `src/`.
- Main-process unit tests live next to the code in `electron/` (for example `resolve.test.ts`, which covers the `app://` file policy).
- Tests that need Node live in `test/`, because the `src/` fence bans Node built-ins, tests included.
- Browser tests live in `e2e/`.

## Adding a `__nexus` hook

- Add the name and signature to `NexusHooks` in `src/debug/nexus.ts`.
- In a React component, call `registerNexus` in an effect and return its unregister function as the cleanup.
- In module-scope code, call `registerNexusModule(import.meta.hot, name, fn)`.
- Both are no-ops outside dev, and the build fails if `__nexus` reaches production.
- Call hooks from e2e with `nexus(page, name, ...args)` from `e2e/nexus.ts`.

The pre-commit hook runs `vp staged`, which applies `vp check --fix` to staged files. Review any automatic fixes before pushing.

Keep credentials out of version control. `.env` and `.env.*` files are ignored, except `.env.example`, which should contain placeholders only. Dependencies (`node_modules/`) and build output (`dist/`, `dist-electron/` and `release/`) are also ignored.
