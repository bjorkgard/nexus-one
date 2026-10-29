# Changelog

All notable changes to Nexus One are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.4] - 2026-10-29

### Fixed

- The module fence now resolves imports the way Vite does in more cases, so these spellings no longer let `src/` reach `collector/` or `electron/` code unreported:
  - `/@fs/<absolute path>` imports, which were treated as `public/` asset URLs.
  - Percent-encoded root paths such as `/%63ollector/x`.
  - `./x.js` when only `x.ts` exists. Vite swaps `.js` for `.ts` (and `.mjs` for `.mts`, `.cjs` for `.cts`) before trying other extensions, and the fence now does the same, in the same order.
  - Type-only imports that resolve to a `.d.ts`, `.d.mts` or `.d.cts` file.
  - A folder whose `package.json` (`main`, `module`, `jsnext:main`, `jsnext`, `browser`, `exports`, `types` or `typings`, including nested folders and `browser` maps) points into another zone. A `package.json` that starts with a byte-order mark is read as Vite reads it, and one that exists but cannot be parsed is reported instead of ignored.
- `new URL(path, base)` is checked whenever `import.meta.url` appears anywhere in the base, such as `import.meta?.url`, `import.meta.url ?? ""`, a template literal, a ternary, `String(...)` or a TypeScript cast.
- `import.meta.resolve` and `import.meta.glob` are reported when they are used other than as a direct call, for example when copied into a variable, destructured, passed as an argument or wrapped in `(0, ...)`, because the fence cannot follow them there.
- The pre-commit hook runs the full `vp check` when a commit stages a deletion, rename, type change, symlink or submodule, or when `git` fails. Before, such a commit could run only a partial check, or none at all, though it can change what other files import.

## [0.9.3] - 2026-10-29

### Fixed

- An `import.meta.glob` pattern that contains `#` is now reported by the module fence. Vite keeps the `#` and resolves the pattern as written, so `./a#/../../electron/*.ts` reached `electron/` while the fence read only `./a`.

## [0.9.2] - 2026-10-29

### Fixed

- An `import.meta.glob` is fenced by the folder it searches again. A folder outside the zone no longer passes because its `index.ts`, or a `.ts` file beside it, links into an allowed zone.
- Every file an `import.meta.glob` matches is now checked by its real path. A file or folder inside the searched folder that links to another zone is reported, including links reached through a `**` walk. The fence lists matches with tinyglobby, the matcher Vite uses, now a declared dev dependency.

## [0.9.1] - 2026-10-29

### Changed

- The module fence now judges a root-absolute import such as `/collector/x` against a fixed list of the repo's root folders and files, without reading the disk. A root file imported without its extension, such as `/vite.config`, is blocked too, and so are `/.git` and `/.claude` paths. Any other root-absolute path is still allowed as a `public/` asset URL. A unit test fails when a tracked root entry is missing from the list.
- The fence resolves imports the way Vite does. It tries Vite's extensions in Vite's order, accepts only regular files, and prefers a `x.ts` file or an `x/index.ts` over the folder `x/`. A symlink can no longer hide an import from another zone.
- `import.meta.resolve(...)` and the bracket forms `import.meta["resolve"]`, `import.meta["glob"]` and `import.meta["url"]` are now checked. A computed key the fence cannot read is reported as a non-static import.
- Staging `tsconfig.json` or `package.json` now runs the full check in the pre-commit hook, since both change what every file is checked against.

### Fixed

- A linted file whose real path is outside the repo now gets its own lint error naming the file instead of passing unchecked.
- Relative imports in a symlinked folder are resolved from the folder's real location.
- Leftover scratch files from the fence tests no longer break the type check in `vp run build`.
- The packaged-app test now fails when the app shows its "WebGL is unavailable" error box, and a second test starts the app with the GPU off to prove the check finds the real box.

## [0.9.0] - 2026-10-29

### Added

- Every pull request and every push to `main` now runs CI on GitHub. One Apple Silicon macOS job checks lint, module fences and types, runs the unit tests and the dev-server Playwright tests, packages the app and boots the packaged app. A type error, a failing test or a broken package turns the `ci` check red, and `main` only accepts pull requests whose `ci` check is green and up to date.
- When a CI run fails or is cancelled, its Playwright report and traces are attached to the run for 14 days, so a failure can be opened without reproducing it locally.
- Dependabot proposes weekly updates for the GitHub Actions the workflow uses and for npm packages with version ranges. Packages pinned to an exact version are left alone and are upgraded by hand when a GitHub vulnerability alert names them.

### Changed

- `vp run pack` never tries to publish a release, including when it runs in CI.
- The README's new CI section explains what runs, how to read a red run, when a re-run is enough, and how to recover if CI on `main` itself breaks.

### Fixed

- The "emit applies a valid new session_start" e2e test no longer fails at random when the mock data source emits an event at the same moment.
- The module-fence lint tests now pass on GitHub Actions, where the linter's default output format leaves out the rule messages the tests check.

## [0.8.0] - 2026-10-28

### Added

- Press backtick in `vp run dev` to show or hide a performance overlay in the top-right corner. On a Swedish keyboard, use Shift + ´. It shows FPS and CPU graphs, a GPU graph where the browser supports GPU timing, draw calls, triangles, geometries, textures and JS heap. Draw calls turn yellow from 240 and red from 300, the budget in `docs/PLAN.md`. Held keys, Cmd/Ctrl/Alt combinations and typing in text fields do not toggle it.
- Add `?probe=box` to the dev URL to draw one 12-triangle box, so the counters show a known non-zero draw.
- If the overlay or the debug bridge fails in dev, it logs one console error and disappears instead of blanking the 3D view.

### Changed

- The production build now fails if the overlay, the probe box or the overlay's stats code ends up in the bundle, not only the `__nexus` debug API. A unit test checks that each guarded marker still appears in the file it protects.

## [0.7.0] - 2026-10-28

### Added

- The app now runs as a standalone macOS app. `vp run pack` builds the app bundle under `release/mac-arm64/`, which opens with a double-click and needs no dev server. The build is unsigned, so the first launch of a downloaded copy may need Open from the right-click menu.
- The app loads its built page from `app://nexus` instead of plain files. That address serves only regular files inside the built `dist/` folder. Other hosts, `..` and encoded-slash escapes, symlinks that point outside, NUL bytes and malformed encoding all return 404.
- If the packaged app cannot start, for example because `dist/index.html` is missing, it shows a "Nexus One failed to start" dialog with the reason and exits. Renderer errors and crashes are written to the terminal as `[renderer]` lines.
- `vp run start` opens the built app in Electron without packaging, for a quick check of main-process changes.
- `vp run test:packaged` launches the packaged app and checks the 3D canvas, the label, the `app://nexus/index.html` address and that the console stays free of errors on first load and after a reload. Run it after `vp run pack`.

### Changed

- `electron/`, `collector/` and `src/shared/` are type-checked as Node code without browser globals, so `window` or `document` there fails `vp check`.
- `electron/` code may import only `electron/` and `src/shared/`; React, Three, `createRequire` and CommonJS are rejected there.
- All libraries are now development dependencies. They are bundled into the app, so the packaged app ships no `node_modules`.

## [0.6.0] - 2026-10-28

### Added

- The app now has a data source. Open it with `?source=mock` (the default) to play the seeded mock stream, or `?source=live` to connect to a local collector at `ws://127.0.0.1:47821`. Add `?port=` to pick another port between 1024 and 65535. Switching source needs no code change.
- A shared wire protocol in `src/shared/protocol.ts`: the server sends a hello, then a snapshot, then numbered events. The snapshot carries open tool calls, queued tasks, attention state and token totals per agent and model, so a client that connects mid-session sees the full current picture.
- A pure shared reducer (`src/shared/reduce.ts`) turns events into project, session and agent state, and `applyOnce` (`src/shared/apply-once.ts`) skips any event id seen among the last 4,096. Resent events after a reconnect no longer double-count tokens.
- The client recovers on its own. It resyncs from a fresh snapshot after a missed event, an out-of-order message or a rejected frame. It waits at most 5 s for hello and snapshot, and retries with backoff from 250 ms up to 2 s. It reports `incompatible` when the protocol version does not match.
- Dev-only `__nexus.emit(event)`, `__nexus.setClock(ts)` and `__nexus.dataState()` hooks let tests send events, move the mock clock (forward or back) and read status, counts and counters. They are absent from production builds.

### Changed

- Inbound frames over 8 MiB, non-JSON or binary frames are rejected before parsing, and warnings never include message text.
- If the data source fails to start, the app still renders and reports the error.

## [0.5.0] - 2026-10-28

### Added

- `createMockStream(options?)` in `src/data/mock.ts` produces a seeded, repeatable stream of events to build and test against before live data exists. The same seed always gives the same events, and events are produced one at a time, so a 100-agent, one-hour run never sits in memory.
- The default stream is a fixed scenario of 1 project, 3 sessions (Claude and Codex) and 8 subagents, with all 13 event types. It always includes one agent that goes quiet for 6 minutes and then recovers, one that waits 6 minutes for the user, one that repeats the same call 5 times, one with 3 errors in a row and one slow 3-minute call. Each of these ends in a recovery step. `MOCK_ROLES` names those agents and `MOCK_TIMING` holds their timings, so later tests can find them.
- Options `agents` and `durationMs` add busy extra agents in 2 more projects for load and soak runs. `timeScale` speeds the stream up, and `origin` sets where timestamps start. Bad or unknown options fail at once with an error that names the option.
- `checkStream(events, { complete })` in `src/shared/check-stream.ts` checks any stream, mock or live, and returns a list of named problems instead of throwing. It catches broken ordering, duplicate ids, unpaired tool calls, subagents without a parent, events after an agent or session ended, a session that ends with work still open, and items left open at the end. It reports at most 100 problems plus a total.

### Changed

- `vp check` now fails if `src/data/mock.ts` or its test reads the clock or unseeded randomness (`Date`, `Math.random`, `performance.now`, `performance.timeOrigin`, `crypto`), so the mock stream stays repeatable.

## [0.4.0] - 2026-10-28

### Added

- `src/shared/schema.ts` defines every event the app handles (13 types, from `session_start` to `task_dequeued`) and the `Project`, `Session` and `Agent` records with zod. The collector and the app both import their types from this one file.
- `parseEvent(input)` checks any incoming value and returns either the typed event or a list of problems (`path` and `code`). It never throws, even on hostile input, so one bad line cannot stop a stream.
- Events with unknown fields, wrong enum values, negative or fractional numbers, or over-long strings are rejected. Ids are capped at 256 characters, names at 200, message text at 4000 and tool errors at 1000.
- JSON fixtures in `src/shared/fixtures/` hold one valid example of every event and record, for use by later mock and reducer tests.

### Changed

- `vp check` now fails if code in `src/` outside `src/shared/` imports `zod`, so event shapes stay declared in one place.

## [0.3.0] - 2026-10-28

### Added

- `npx playwright test` now runs a browser smoke test against the dev server on port 5199. It fails on any console error, page error or WebGL error banner, and checks that the canvas fills the window and the "Nexus One" label shows. Run `vp exec playwright install chromium` once first.
- In dev builds, `window.__nexus` exposes `getCamera()`, `project(worldPos)` and `rendererInfo()`, so browser tests can read the camera, map a 3D point to a clickable page position and count draw calls. `project` reports `visible: false` for points the camera does not draw.
- Browser tests call these hooks through a typed helper, so a misspelled hook name or wrong argument is a type error in `vp check`.
- New hooks are added with `registerNexus` (or `registerNexusModule` for module-level code, which cleans up on hot reload); the README explains how.
- `vp test` now also runs unit tests for the debug API and Node-backed tests in `test/`.

### Changed

- Every `vp build` now fails if a Node built-in reaches the browser bundle (from your code or a dependency), or if `__nexus` appears in production output. Before, a Node import shipped as a silent empty stub.

## [0.2.0] - 2026-10-26

### Added

- The codebase now has fixed module areas: `src/world`, `src/sim`, `src/ui`, `src/data`, `src/shared`, `collector/` (Node-only) and `electron/` (main and preload).
- `vp check` now stops code from crossing those areas by mistake. Browser code in `src/` can only import other `src/` code, `src/shared/` only imports itself, and `collector/` only reaches `src/` through `src/shared/`. Imports are checked on the real resolved path, so odd spellings, symlinks, query suffixes, globs and `new URL(..., import.meta.url)` are caught too.
- Node built-ins, the `electron` package, CommonJS `require` and React/Three (including React-based helpers such as `zustand`) are blocked where they would break the browser bundle or the plain-Node collector. JSX is not allowed in `collector/` or `src/shared/`.
- `vp test` now runs a test suite (`lint/module-fences.test.js`) that pins every fence rule, including a check that the real linter config enforces them.

### Changed

- `npm run build` now runs `vp check` first, so a fence or lint error fails the build.
- The pre-commit hook runs a full `vp check` when the lint config or the fence rule changes, and handles file names with spaces or quotes correctly.

## [0.1.0] - 2026-10-26

### Added

- Nexus One now opens as a full-window 3D canvas (React Three Fiber on three.js) with a "Nexus One" title overlay styled with Tailwind CSS.
- If the 3D view cannot start, for example when WebGL is blocked or unavailable, the app shows a readable error message instead of a blank page, and screen readers announce it.
- The whole window uses a dark background, including overscroll areas and the moment before the app loads.
- Component edits during development now update in place without a page reload (Fast Refresh).

### Removed

- The Vite starter page, its counter demo and starter images.
