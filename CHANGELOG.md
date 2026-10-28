# Changelog

All notable changes to Nexus One are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
