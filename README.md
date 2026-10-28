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
- `npx playwright test` — Run the Playwright smoke test against the dev server on port 5199.
- `vp exec playwright install chromium` — One-time download of the browser Playwright uses.
- `vp run build` — Run `vp check` and the TypeScript compiler, then create a production build in `dist/`. Any `vp build` fails if a Node built-in or `__nexus` reaches the browser bundle.
- `vp run preview` — Serve the production build locally after building.

Use `vp run <name>` for scripts defined in `package.json`. Built-in commands such as `vp check` and `vp test` run directly.

## Project structure

- `index.html` — HTML entry point.
- `src/main.tsx` — Application entry; mounts React into `#app`.
- `src/App.tsx` — Root component with the 3D canvas and its error boundary.
- `src/style.css` — Tailwind import and base layout styles.
- `src/world/` — Geometry.
- `src/sim/` — Simulation and animation state.
- `src/ui/` — Dashboard.
- `src/data/` — Client store and data sources.
- `src/debug/` — Dev-only `window.__nexus` test hooks.
- `src/shared/` — Types and schema shared with `collector/`; imports no React, Three, Node, or other `src/` folders; ESM only (no `require`).
- `collector/` — Node-only code; imports no React, Three, Electron, or `src/` except `src/shared/`; ESM only (no `require`).
- `electron/` — Electron main and preload; intentionally unfenced until task 1.7 defines main/preload rules.
- Module fences: `src/` may import only `src/`, `src/shared/` only itself, and `collector/` only itself and `src/shared/`; `src/` also cannot import Node built-ins. `vp check` enforces this as an allow-list on resolved paths in `lint/module-fences.js`, and dynamic imports, globs and `new URL` in those folders must use static string specifiers.
- `lint/` — Local Oxlint plugin with the module-fence rule, and the build-guard plugin (`lint/build-guards.js`).
- `e2e/` — Playwright specs and the typed `__nexus` helper.
- `test/` — Node-backed tests, such as the build guards.
- `playwright.config.ts` — Playwright configuration.
- `vite.config.ts` — Vite+ configuration, plugins, formatting, linting, type checking, and staged-file checks.
- `tsconfig.json` — TypeScript compiler configuration.
- `.vite-hooks/pre-commit` — Runs checks on staged files before committing.
- `TODOS.md` — Deferred work.
- `CHANGELOG.md` — Release notes.
- `AGENTS.md` — Vite+ toolchain instructions for coding agents.
- `CLAUDE.md` — Project rules for Claude Code, including where plan reviews are stored.
- `docs/PLAN.md` — Phased build plan.
- `docs/plans/` — Per-task plan and review files.

## Development checks

Before committing changes, run:

```sh
vp check
vp test
npx playwright test
vp run build
```

`vp test` runs the `src/` unit tests, the `lint/` fence tests (`lint/module-fences.test.js`, the RuleTester suite for the module-fence rule) and the `test/` build-guard tests.

## Test locations

- Browser-safe unit tests live next to the code in `src/`.
- Tests that need Node live in `test/`, because the `src/` fence bans Node built-ins, tests included.
- Browser tests live in `e2e/`.

## Adding a `__nexus` hook

- Add the name and signature to `NexusHooks` in `src/debug/nexus.ts`.
- In a React component, call `registerNexus` in an effect and return its unregister function as the cleanup.
- In module-scope code, call `registerNexusModule(import.meta.hot, name, fn)`.
- Both are no-ops outside dev, and the build fails if `__nexus` reaches production.
- Call hooks from e2e with `nexus(page, name, ...args)` from `e2e/nexus.ts`.

The pre-commit hook runs `vp staged`, which applies `vp check --fix` to staged files. Review any automatic fixes before pushing.

Keep credentials out of version control. `.env` and `.env.*` files are ignored, except `.env.example`, which should contain placeholders only. Dependencies (`node_modules/`) and build output (`dist/`) are also ignored.
