# Changelog

All notable changes to Nexus One are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
