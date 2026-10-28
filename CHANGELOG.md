# Changelog

All notable changes to Nexus One are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
